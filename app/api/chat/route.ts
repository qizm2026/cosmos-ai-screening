import { NextRequest, NextResponse } from 'next/server'
import type { ItemId, SessionState, FallbackScores, UserContext, AnswerQuality } from '@/types/session'
import { getSession, updateSession } from '@/lib/session-store'
import { buildChatSystemPrompt } from '@/lib/prompts/chat-prompt'
import { textCompletion, createStreamResponse, createRealStreamResponse } from '@/lib/deepseek'
import { PHQ9 } from '@/lib/scales/phq9'
import { detectRisk } from '@/lib/risk-detector'
import { postProcessReply } from '@/lib/post-processor'
// QLV removed per PRD V3.3 — question validation handled via system prompt constraints + scoring anchor matching

// V3.3 closing messages — empowering, forward-looking tone (§4.8)
const CLOSING_LOW_RISK = `今天聊到这儿。接下来，系统会为你生成一份个人报告，帮你把刚才聊到的状态整理清楚。`

const CLOSING_MODERATE = `今天聊到这儿。谢谢你愿意把这些感受说给我听——有些话说出来本身就需要勇气。接下来系统会为你生成一份报告，帮你把一些模糊的感受看得更清晰。`

const CLOSING_SEVERE = `今天聊到这儿。你刚才说到的感受，我都听到了——你不是一个人面对这些。接下来系统会为你生成一份报告。有些力量你可能自己还没意识到，但它们已经在起作用了。之后如果需要，有人可以陪你一起往前走。`

function getClosingMessage(riskStatus: SessionState['risk_status']): string {
  if (riskStatus.detected && riskStatus.type === 'suicide_ideation') {
    return CLOSING_SEVERE
  }
  if (riskStatus.detected) {
    return CLOSING_MODERATE
  }
  return CLOSING_LOW_RISK
}

// === User context extraction (heuristic) ===
function extractUserContext(message: string, current: UserContext): UserContext {
  const updated: UserContext = {
    occupation: current.occupation,
    age: current.age,
    hobbies: [...current.hobbies],
    mentioned_symptoms: [...current.mentioned_symptoms],
    notes: [...current.notes],
  }

  // Occupation detection
  if (!updated.occupation) {
    const occPatterns: [RegExp, string][] = [
      [/初[一二三]|七[年级]|八[年级]|九[年级]/, '初中生'],
      [/高[一二三]|高一|高二|高三/, '高中生'],
      [/大学[生]?|研[究生]?|硕士|博士/, '大学生'],
      [/上[班班族]|打工|工作/, '上班族'],
      [/老[师师]?/, '老师'],
    ]
    for (const [pattern, label] of occPatterns) {
      if (pattern.test(message)) {
        updated.occupation = label
        break
      }
    }
  }

  // Age detection
  if (!updated.age) {
    const ageMatch = message.match(/(\d{1,2})\s*岁/)
    if (ageMatch) {
      const age = parseInt(ageMatch[1])
      if (age >= 10 && age <= 60) {
        updated.age = ageMatch[1] + '岁'
      }
    }
  }

  // Hobby detection
  const hobbyPatterns: [RegExp, string][] = [
    [/弹吉他|弹琴|钢琴|小提琴/, '音乐'],
    [/打篮球|踢足球|跑步|游泳|健身|打球/, '运动'],
    [/看书|阅读|小说/, '阅读'],
    [/画画|绘画|素描/, '绘画'],
    [/游戏|打游戏|玩游戏/, '游戏'],
    [/编程|写代码/, '编程'],
    [/摄影|拍照/, '摄影'],
    [/跳舞|舞蹈/, '舞蹈'],
  ]
  for (const [pattern, hobby] of hobbyPatterns) {
    if (pattern.test(message)) {
      if (!updated.hobbies.includes(hobby)) {
        updated.hobbies.push(hobby)
      }
    }
  }

  // Symptom dimension detection
  const symptomPatterns: [RegExp, string][] = [
    [/睡[不着好]|失眠|睡不[安稳]|嗜睡|睡太多/, '睡眠'],
    [/[吃不进]?食欲|吃不下|吃太多|暴食/, '食欲'],
    [/累|疲惫|没力气|没精力/, '精力'],
    [/专注|集中|走神|分心/, '注意力'],
    [/心情|情绪|低落|沮丧|不开心/, '情绪'],
    [/兴趣|提不起劲|不想做/, '兴趣'],
  ]
  for (const [pattern, dim] of symptomPatterns) {
    if (pattern.test(message)) {
      if (!updated.mentioned_symptoms.includes(dim)) {
        updated.mentioned_symptoms.push(dim)
      }
    }
  }

  return updated
}

// === Extract questions from AI reply for anti-repetition ===
function extractQuestions(text: string): string[] {
  const sentences = text.split(/[。！？\n]/).map(s => s.trim()).filter(s => s.length > 5)
  const questions: string[] = []
  for (const s of sentences) {
    if (s.includes('？') || s.includes('?') || /[吗呢吧么]$/.test(s)) {
      questions.push(s)
    }
  }
  return questions
}

// === 启发式模糊回答检测（PRD §4.6 把握度分级，代码层零成本兜底防护）===
function detectAnswerVagueness(message: string): {
  isVague: boolean
  confidenceScore: number  // 0-5，映射 PRD 把握度：高≥3 / 中=2 / 低≤1
  hasConcreteDetail: boolean
} {
  const trimmed = message.trim()
  const len = trimmed.length

  // 极短回答（<6字）→ 必然模糊，把握度=0
  if (len < 6) {
    return { isVague: true, confidenceScore: 0, hasConcreteDetail: false }
  }

  // 检测6类具体信息信号
  const hasFrequencyWord = /[每经常偶尔有时候大概大约多少几]/.test(trimmed)
  const hasNumber = /\d/.test(trimmed)
  const hasDuration = /[天周月年小时分钟]/.test(trimmed)
  const hasIntensity = /[很非常特别极其比较不太有点稍微完全]/.test(trimmed)
  const hasImpact = /[影响导致所以因为结果]/.test(trimmed)
  const hasBehavior = /[做去干吃喝玩乐学习工作上课考试]/.test(trimmed)

  const signalCount = [hasFrequencyWord, hasNumber, hasDuration,
    hasIntensity, hasImpact, hasBehavior].filter(Boolean).length

  // 模糊兜底模式：典型的回避/敷衍/不置可否表达
  const vaguePatterns = [
    /^(还行|还好|就那样|差不多|一般|不知道|不清楚|说不好|不清楚|没想过|没什么|都行|都可以|随便|还行吧|就这样|算了吧|不说了|说不清|不好说)[。！？.!]*$/,
    /^(嗯|哦|啊|呃|哎|对|是|有|没|有吧|可能吧|大概吧|也许吧)[。！？.!]*$/,
    /^(挺好的|还行吧|就这样吧|算了吧|不说了|不知道啊)[。！？.!]*$/,
  ]
  const matchesVaguePattern = vaguePatterns.some(p => p.test(trimmed))

  if (matchesVaguePattern) {
    return { isVague: true, confidenceScore: 0, hasConcreteDetail: false }
  }

  if (signalCount >= 3) {
    // 信号丰富，把握度高
    const confidence = Math.min(5, signalCount + 1)
    return { isVague: false, confidenceScore: confidence, hasConcreteDetail: true }
  }

  if (signalCount === 2) {
    // 中等把握度——字数多则更可信
    const confidence = len > 20 ? 3 : 2
    return { isVague: false, confidenceScore: confidence, hasConcreteDetail: true }
  }

  if (signalCount === 1) {
    return { isVague: true, confidenceScore: 1, hasConcreteDetail: false }
  }

  // 0 个信号但字数>＝6：可能是纯描述性但无具体信息 → 低把握
  return { isVague: true, confidenceScore: 0, hasConcreteDetail: false }
}

export type ChatResponse = {
  reply: string
  show_fallback: boolean
  phase: string
  fallback_item: string | null
  fallback_options: string[] | null
  is_done: boolean
  risk_detected: boolean
  risk_type: string | null
  risk_intervention: string | null
  pause_message: string | null
  hotline: string | null
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const sessionId = body.session_id as string
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // === Handle continue/pause after risk intervention ===
  if (body.risk_action === 'continue') {
    return handleRiskContinue(sessionId, session)
  }

  const userMessage = (body.user_message as string) || ''
  const isInit = body.init === true
  const isEdit = body.is_edit === true
  const now = Date.now()

  // Guard: 对话已结束，优雅拒绝而非报错，让前端重置为「查看报告」状态
  if (session.phase === 'done' && userMessage && !isInit) {
    console.log('[COSMO chat] Session done, returning done state')
    return NextResponse.json({
      messages: session.messages.map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
      is_done: true,
    })
  }

  // === Init: if session is done, return history without calling AI ===
  if (isInit && session.phase === 'done') {
    console.log('[COSMO chat] Init: session done, returning history')
    return NextResponse.json({
      messages: session.messages.map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
      is_done: true,
    })
  }

  // === Handle soft fallback response ===
  if (session.soft_fallback_active && userMessage && !isInit) {
    return handleSoftFallbackResponse(sessionId, session, userMessage, now)
  }

  if (body.fallback_item && typeof body.fallback_score === 'number') {
    return handleFallbackScore(sessionId, session, body.fallback_item, body.fallback_score)
  }

  if (!userMessage && !isInit) {
    return NextResponse.json({ error: 'Missing user_message' }, { status: 400 })
  }

  // === Risk Detection ===
  // No modal popup — pure natural conversation confirmation
  // Step 1: detectRisk → enter confirming phase → AI confirms via riskConfirmingBlock
  // Step 2: AI outputs [!] → trigger Q9 fallback → after Q9 done, enter soothing phase
  // Step 3: Soothing rounds → then resume normal interview
  let riskDetected = session.risk_status.detected
  let riskType = session.risk_status.type
  let riskConfirming = session.risk_status.confirming
  let riskIntervened = session.risk_status.intervened
  let soothingRounds = session.risk_status.soothing_rounds

  if (!isInit && userMessage && !session.risk_status.intervened
      && !session.risk_status.confirming
      && session.risk_status.soothing_rounds === 0) {
    const riskResult = detectRisk(userMessage)
    if (riskResult.detected) {
      riskDetected = true
      riskType = riskResult.type
      riskConfirming = true
      console.log(`[COSMO risk] Detected: ${riskResult.type}, entering natural confirmation phase`)
    }
  }

  // === Risk confirmation: if still confirming AND user repeats risk keywords, escalate ===
  if (riskConfirming && userMessage) {
    const confirmResult = detectRisk(userMessage)
    if (confirmResult.detected) {
      // User repeated high-risk content → confirmed
      riskConfirming = false
      riskIntervened = true
      soothingRounds = 3
      console.log(`[COSMO risk] User repeated high-risk content — auto-confirmed, triggering Q9 fallback`)
    }
  }

  // === Soothing phase: count down rounds ===
  if (!isInit && session.risk_status.soothing_rounds > 0) {
    soothingRounds = session.risk_status.soothing_rounds - 1
    if (soothingRounds === 0) {
      console.log('[COSMO risk] Soothing phase complete, resuming normal interview')
    }
  }

  // === is_edit: roll back last round ===
  let workingSession = session

  if (isEdit && session.messages.length >= 2) {
    const rolledBackMessages = session.messages.slice(0, -2)
    const rolledBackCoverage = { ...session.coverage }
    let rolledBackIndex = session.current_item_index
    let rolledBackRounds = session.item_rounds
    let rolledBackFollowUps = session.follow_up_count

    if (session.item_rounds === 0 && session.current_item_index > 0) {
      rolledBackIndex = session.current_item_index - 1
      rolledBackRounds = 0
      rolledBackFollowUps = 0
      const prevItemId = PHQ9.items[rolledBackIndex]?.id as ItemId
      if (prevItemId) {
        rolledBackCoverage[prevItemId] = 'pending'
        console.log('[COSMO chat] Edit rollback: reset', prevItemId, '-> pending, back to index', rolledBackIndex)
      }
    } else {
      rolledBackRounds = Math.max(0, session.item_rounds - 1)
      rolledBackFollowUps = Math.max(0, session.follow_up_count - 1)
      console.log('[COSMO chat] Edit rollback: same item, rounds', session.item_rounds, '->', rolledBackRounds)
    }

    const rolledBackAsked = [...session.asked_questions]
    if (rolledBackAsked.length > 0) {
      rolledBackAsked.pop()
    }

    workingSession = {
      ...session,
      messages: rolledBackMessages,
      coverage: rolledBackCoverage,
      last_coverage_update: null,
      current_item_index: rolledBackIndex,
      item_rounds: rolledBackRounds,
      follow_up_count: rolledBackFollowUps,
      asked_questions: rolledBackAsked,
      phase: session.phase === 'done' ? 'interview' : session.phase,
      risk_status: { ...session.risk_status, detected: false, type: null, intervention_text: null },
    }
    riskDetected = false
    riskType = null
  }

  // === Risk confirmation (Phase 2) is now handled in onComplete via AI [!] marker ===
  // (Bug C fix: semantic judgment replaces regex-based second-pass detection)

  // === Extract user context from user message ===
  let updatedUserContext = workingSession.user_context
  if (!isInit && userMessage) {
    updatedUserContext = extractUserContext(userMessage, workingSession.user_context)
    if (updatedUserContext !== workingSession.user_context) {
      console.log('[COSMO context] Updated:', JSON.stringify(updatedUserContext))
    }
  }

  // === Normal message handling with REAL STREAMING ===
  const updatedMessages: SessionState['messages'] = isInit
    ? workingSession.messages
    : [...workingSession.messages, { role: 'user' as const, content: userMessage, timestamp: now }]

  const systemPrompt = buildChatSystemPrompt({
    ...workingSession,
    user_context: updatedUserContext,
  })

  // === Time control (PRD §4.4: 15-minute limit) ===
  const elapsedMinutes = (Date.now() - workingSession.session_started_at) / 60000
  const timePressureNote = elapsedMinutes > 12
    ? (elapsedMinutes > 15
      ? `\n\n【时间提醒】对话已超过15分钟。请立即完成剩余话题——对每个还未覆盖的话题直接问一次，信息不足就用 [?] 触发选项。`
      : `\n\n【时间提醒】对话已接近尾声（约${Math.round(elapsedMinutes)}分钟），请尽快完成剩余话题。`)
    : ''

  const finalSystemPrompt = workingSession.risk_status.intervened
    ? systemPrompt + `\n[Note] User expressed difficult feelings earlier. Use a gentler tone, avoid probing risk details. Transition naturally to a lighter topic.` + timePressureNote
    : riskConfirming
    ? systemPrompt + timePressureNote
    : systemPrompt + timePressureNote

  console.log('[COSMO chat] system prompt length:', finalSystemPrompt.length)

  const dialogMessages = [
    { role: 'system' as const, content: finalSystemPrompt },
    ...updatedMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  // === Real streaming: forward DeepSeek tokens to client immediately ===
  return createRealStreamResponse(
    {
      messages: dialogMessages,
      temperature: 0.7,
      max_tokens: 1024,
      useThinking: false,
    },
    async (fullText: string, enqueue: (text: string) => void) => {
      // === Post-processing (runs after AI stream completes) ===

      // === Marker detection ===
      const hasFallbackMarker = fullText.includes('[?]')
      const hasSoftFallback = fullText.includes('[~]')
      let cleanReply = fullText
        .replace(/\[→\]/g, '').replace(/\[~\]/g, '').replace(/\[\?\]/g, '').replace(/\[!\]/g, '').trim()

      // === Post-process filter (skip during risk confirmation to avoid interfering) ===
      const postResult = postProcessReply(cleanReply, workingSession.risk_status.confirming)
      if (postResult.filtered) {
        cleanReply = postResult.cleanedText
      }

      // === Risk escalation: if risk was auto-confirmed or AI marked [!], trigger Q9 fallback ===
      const shouldTriggerQ9 = riskIntervened && !workingSession.risk_status.intervened

      if (riskIntervened && workingSession.risk_status.confirming) {
        riskConfirming = false  // clear confirming when moving to intervened
      }

      // === Extract questions for anti-repetition ===
      const newQuestions = extractQuestions(cleanReply)
      const updatedAskedQuestions = [...workingSession.asked_questions, ...newQuestions]

      // === Coverage advancement (PRD §4.4: AI-driven with code-layer vagueness safeguard) ===
      //   item_rounds=0: AI just asked → rounds=1, wait for answer
      //   item_rounds=1: first answer → AI can probe deeper (natural follow-up)
      //   item_rounds=2: second answer → code-layer vagueness check before advancing
      const updatedCoverage = { ...workingSession.coverage }
      const item = PHQ9.items[workingSession.current_item_index]
      let fallback_item: string | null = null
      let fallback_options: string[] | null = null
      let show_fallback = false
      let newCurrentItemIndex = workingSession.current_item_index
      let newItemRounds = workingSession.item_rounds
      let newFollowUpCount = workingSession.follow_up_count
      let lastCoverageUpdate: SessionState['last_coverage_update'] = workingSession.last_coverage_update
      let sessionReply = cleanReply
      let newConsecutiveDirectFallbacks = workingSession.consecutive_direct_fallbacks
      let newSkipSoftFallback = workingSession.skip_soft_fallback

      // 新增：回答质量追踪（PRD §4.6 把握度分级）
      let newItemAnswerQuality = { ...workingSession.item_answer_quality }
      let newConsecutiveLowConfidence = workingSession.consecutive_low_confidence
      let newCurrentConfidenceScore = workingSession.current_confidence_score

      if (workingSession.phase === 'interview' && item) {
        if (shouldTriggerQ9) {
          const q9Item = PHQ9.items[8]
          show_fallback = true
          fallback_item = q9Item.id
          fallback_options = [...q9Item.fallback_options_original]
          newCurrentItemIndex = 8
          newItemRounds = 0
          newCurrentConfidenceScore = 0
          sessionReply = q9Item.fallback_prompt
          console.log(`[COSMO chat] Risk confirmed — triggering Q9 fallback`)
        } else if (hasSoftFallback) {
          // 防御：如果第一轮回答就加 [~]，说明 AI 太激进，忽略标记
          if (newItemRounds <= 1) {
            console.log(`[COSMO chat] Item ${item.id}: AI triggered [~] at round ${newItemRounds} — too early, ignoring marker`)
            newItemRounds = 1
            newFollowUpCount = 0
          } else {
            // 替换回复为软兜底文案（去掉 AI 可能的跳跃话题文字）
            sessionReply = cleanReply
            newItemRounds = 0
            newFollowUpCount = 0
            newConsecutiveDirectFallbacks = 0
            newSkipSoftFallback = false
            newConsecutiveLowConfidence = 0
            newCurrentConfidenceScore = 0
            console.log(`[COSMO chat] Item ${item.id}: [~] soft fallback — waiting for student response`)
          }
        } else if (hasFallbackMarker) {
          // AI 主动加了硬兜底标记
          // 防御：如果这是第一轮（item_rounds <= 1），说明 AI 太激进，忽略标记正常推进
          if (newItemRounds <= 1) {
            console.log(`[COSMO chat] Item ${item.id}: AI triggered [?] at round ${newItemRounds} — too early, ignoring marker`)
            if (newItemRounds === 1) {
              newItemRounds = 2
              newFollowUpCount = 1
            } else {
              newItemRounds = 1
            }
          } else {
            show_fallback = true
            fallback_item = item.id
            fallback_options = [...item.fallback_options_original]
            // 替换回复为兜底提问文案，不展示 AI 可能跳跃话题的文字
            sessionReply = item.fallback_prompt
            const newConsecutive = workingSession.consecutive_direct_fallbacks + 1
            newConsecutiveDirectFallbacks = newConsecutive
            newSkipSoftFallback = newConsecutive >= 2
            newCurrentConfidenceScore = 0
            newConsecutiveLowConfidence = 0
            console.log(`[COSMO chat] Item ${item.id}: AI triggered hard fallback`)
          }
        } else if (newItemRounds >= 2) {
          // === 关键修复：第2轮回答后，代码层检测模糊度（PRD §4.6）===
          const vagueness = detectAnswerVagueness(userMessage)
          newCurrentConfidenceScore = vagueness.confidenceScore

          if (vagueness.isVague && vagueness.confidenceScore <= 1) {
            // 回答模糊且把握度低(≤1) → 跳过软性提示，直接硬兜底
            show_fallback = true
            fallback_item = item.id
            fallback_options = [...item.fallback_options_original]
            // 替换回复为兜底提问文案
            sessionReply = item.fallback_prompt
            newConsecutiveLowConfidence += 1
            // PRD §4.6 连续低把握跳过规则：连续2次→后续全部跳过软性提示
            if (newConsecutiveLowConfidence >= 2) {
              newSkipSoftFallback = true
            }
            newItemRounds = 0
            newFollowUpCount = 0
            updatedCoverage[item.id as ItemId] = 'fallback'
            newItemAnswerQuality[item.id as ItemId] = 'insufficient'
            console.log(`[COSMO chat] Item ${item.id}: round 2 vague (confidence=${vagueness.confidenceScore}), forcing hard fallback. Low-conf streak: ${newConsecutiveLowConfidence}`)
          } else if (vagueness.isVague && vagueness.confidenceScore === 2) {
            // 把握度中(2)但在第2轮→时间紧迫，走硬兜底
            show_fallback = true
            fallback_item = item.id
            fallback_options = [...item.fallback_options_original]
            // 替换回复为兜底提问文案
            sessionReply = item.fallback_prompt
            newConsecutiveLowConfidence += 1
            if (newConsecutiveLowConfidence >= 2) {
              newSkipSoftFallback = true
            }
            newItemRounds = 0
            newFollowUpCount = 0
            updatedCoverage[item.id as ItemId] = 'fallback'
            newItemAnswerQuality[item.id as ItemId] = 'partial'
            console.log(`[COSMO chat] Item ${item.id}: round 2 medium confidence (2), defaulting to hard fallback`)
          } else {
            // 信息充分 → 正常推进
            updatedCoverage[item.id as ItemId] = 'answered'
            newItemAnswerQuality[item.id as ItemId] = vagueness.confidenceScore >= 4 ? 'sufficient' : 'partial'
            newCurrentItemIndex = Math.min(workingSession.current_item_index + 1, 8)
            newItemRounds = 0
            newFollowUpCount = 0
            newConsecutiveDirectFallbacks = 0
            newConsecutiveLowConfidence = 0
            newSkipSoftFallback = false
            lastCoverageUpdate = { item: item.id as ItemId, status: 'answered' }
            console.log(`[COSMO chat] Item ${item.id}: advancing to ${newCurrentItemIndex} (quality=${newItemAnswerQuality[item.id as ItemId]})`)
          }
        } else if (newItemRounds >= 1) {
          // 第一轮回答：轻量检测，更新计数 + 为下一轮 prompt 注入提示
          const vagueness = detectAnswerVagueness(userMessage)
          newCurrentConfidenceScore = vagueness.confidenceScore

          if (vagueness.isVague && vagueness.confidenceScore <= 1) {
            newConsecutiveLowConfidence += 1
            if (newConsecutiveLowConfidence >= 2) {
              newSkipSoftFallback = true
            }
            console.log(`[COSMO chat] Item ${item.id}: round 1 vague (confidence=${vagueness.confidenceScore}), low-conf streak: ${newConsecutiveLowConfidence}`)
          } else {
            newConsecutiveLowConfidence = 0
          }

          newItemRounds = 2
          newFollowUpCount = 1
          console.log(`[COSMO chat] Item ${item.id}: follow-up round → round 2`)
        } else {
          // item_rounds=0 — AI just asked, waiting for user answer
          newItemRounds = 1
          console.log(`[COSMO chat] Item ${item.id}: question asked, waiting for user answer`)
        }
      }

      // === Phase management ===
      let newPhase = workingSession.phase
      if (workingSession.phase === 'icebreak') {
        const icebreakRounds = workingSession.round + (isInit ? 0 : 1)
        if (icebreakRounds >= 2) {
          newPhase = 'interview'
          newCurrentItemIndex = 0
          newItemRounds = 0
          newFollowUpCount = 0
          console.log('[COSMO chat] Icebreak complete, entering interview')
        }
      }

      // === Missing items safeguard: only redirect when index is at boundary ===
      // Only jump back if we've reached the end (index 8) and items are still pending
      if (newPhase === 'interview' && newCurrentItemIndex >= 8) {
        const anyPending = (Object.keys(updatedCoverage) as ItemId[])
          .find(k => updatedCoverage[k] === 'pending')
        if (anyPending) {
          const pendingIndex = PHQ9.items.findIndex(it => it.id === anyPending)
          if (pendingIndex >= 0 && pendingIndex !== newCurrentItemIndex) {
            newCurrentItemIndex = pendingIndex
            newItemRounds = 0
            console.log(`[COSMO chat] End reached, pending ${anyPending} at index ${pendingIndex} — jumping back`)
          }
        }
      }

      const allCovered = Object.values(updatedCoverage).every(
        (s) => s === 'answered' || s === 'fallback'
      )

      let isDone = false
      if (allCovered) {
        newPhase = 'done'
        isDone = true
        const closingMsg = getClosingMessage(workingSession.risk_status)

        // 如果 AI 回复末尾是问句，说明 AI 不知道这是最后一轮仍提了新问题
        // → 丢弃 AI 原始回复，只显示收尾语，避免"新问题+收尾语"混排
        const aiReplyEndsWithQuestion = /[？?]\s*$/.test(cleanReply)
        if (aiReplyEndsWithQuestion) {
          enqueue('\n\n' + closingMsg)
          sessionReply = closingMsg
          console.log('[COSMO chat] Last item covered but AI asked new question — replaced with closing message')
        } else {
          enqueue('\n\n' + closingMsg)
          sessionReply = cleanReply + '\n\n' + closingMsg
        }
      }

      const coveredCount = Object.values(updatedCoverage).filter(s => s === 'answered' || s === 'fallback').length
      console.log(`[COSMO chat] Coverage: ${coveredCount}/9, done=${isDone}`)

      // === Update session ===

      updateSession(sessionId, {
        phase: newPhase,
        round: isEdit ? Math.max(0, workingSession.round - 1) : (isInit ? workingSession.round : workingSession.round + 1),
        coverage: updatedCoverage,
        last_coverage_update: lastCoverageUpdate,
        current_item_index: newCurrentItemIndex,
        item_rounds: newItemRounds,
        follow_up_count: newFollowUpCount,
        asked_questions: updatedAskedQuestions,
        user_context: updatedUserContext,
        risk_status: {
          detected: riskDetected,
          type: riskType,
          intervened: riskIntervened || workingSession.risk_status.intervened,
          intervention_text: workingSession.risk_status.intervention_text,
          confirming: riskConfirming,
          soothing_rounds: soothingRounds,
        },
        soft_fallback_active: hasSoftFallback,
        skip_soft_fallback: newSkipSoftFallback,
        consecutive_direct_fallbacks: newConsecutiveDirectFallbacks,
        item_answer_quality: newItemAnswerQuality,
        consecutive_low_confidence: newConsecutiveLowConfidence,
        current_confidence_score: newCurrentConfidenceScore,
        messages: [
          ...updatedMessages,
          { role: 'assistant', content: sessionReply, timestamp: now },
        ],
      })

      return {
        show_fallback,
        fallback_item,
        fallback_options,
        is_done: isDone,
        risk_detected: false,  // no modal — all risk handling is via natural conversation
        risk_type: null,
        risk_intervention: null,
        pause_message: null,
        hotline: null,
      }
    }
  )
}

// (Risk flagging removed — risk detection now handled inline via detectRisk)

// === Soft Fallback Response Handler (V3.3) ===
// When AI outputs [~], the user responds naturally. The AI then judges
// whether the response confirms, corrects, or remains vague.
async function handleSoftFallbackResponse(
  sessionId: string,
  session: SessionState,
  userMessage: string,
  now: number
) {
  const updatedMessages: SessionState['messages'] = [
    ...session.messages,
    { role: 'user' as const, content: userMessage, timestamp: now },
  ]

  const systemPrompt = buildChatSystemPrompt({
    ...session,
    soft_fallback_active: true,
  })

  console.log('[COSMO soft-fallback] system prompt length:', systemPrompt.length)

  return createRealStreamResponse(
    {
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...updatedMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 512,
      useThinking: false,
    },
    async (fullText: string, enqueue: (text: string) => void) => {
      const hasFallbackMarker = fullText.includes('[?]')
      const cleanReply = fullText.replace(/\[→\]/g, '').replace(/\[~\]/g, '').replace(/\[\?\]/g, '').trim()

      const updatedCoverage = { ...session.coverage }
      const item = PHQ9.items[session.current_item_index]
      let show_fallback = false
      let fallback_item: string | null = null
      let fallback_options: string[] | null = null
      let newCurrentItemIndex = session.current_item_index
      let sessionReply = cleanReply

      if (item) {
        if (hasFallbackMarker) {
          // User still vague → trigger hard fallback
          show_fallback = true
          fallback_item = item.id
          fallback_options = [...item.fallback_options_original]
          // 替换回复为兜底提问文案
          sessionReply = item.fallback_prompt
          console.log(`[COSMO soft-fallback] Item ${item.id}: user vague, triggering hard fallback`)
        } else {
          // Default: advance
          updatedCoverage[item.id as ItemId] = 'answered'
          newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
          console.log(`[COSMO soft-fallback] Item ${item.id}: advancing to ${newCurrentItemIndex}`)
        }
      }

      // 记录软兜底阶段的回答质量
      const softFallbackQuality: Partial<Record<ItemId, AnswerQuality>> = {}
      if (item) {
        softFallbackQuality[item.id as ItemId] = hasFallbackMarker ? 'insufficient' : 'partial'
      }

      // === Missing items safeguard: only at boundary ===
      if (newCurrentItemIndex >= 8) {
        const anyPending = (Object.keys(updatedCoverage) as ItemId[])
          .find(k => updatedCoverage[k] === 'pending')
        if (anyPending) {
          const pendingIndex = PHQ9.items.findIndex(it => it.id === anyPending)
          if (pendingIndex >= 0 && pendingIndex !== newCurrentItemIndex) {
            newCurrentItemIndex = pendingIndex
            console.log(`[COSMO soft-fallback] End reached, pending ${anyPending} — jumping back`)
          }
        }
      }

      const newQuestions = extractQuestions(cleanReply)
      const updatedAskedQuestions = [...session.asked_questions, ...newQuestions]

      const allCovered = Object.values(updatedCoverage).every(
        (s) => s === 'answered' || s === 'fallback'
      )

      let isDone = false
      if (allCovered) {
        isDone = true
        const closingMsg = getClosingMessage(session.risk_status)

        const aiReplyEndsWithQuestion = /[？?]\s*$/.test(cleanReply)
        if (aiReplyEndsWithQuestion) {
          enqueue('\n\n' + closingMsg)
          sessionReply = closingMsg
        } else {
          enqueue('\n\n' + closingMsg)
          sessionReply = cleanReply + '\n\n' + closingMsg
        }
      }

      updateSession(sessionId, {
        phase: allCovered ? 'done' : 'interview',
        round: session.round + 1,
        coverage: updatedCoverage,
        current_item_index: newCurrentItemIndex,
        item_rounds: 0,
        follow_up_count: 0,
        soft_fallback_active: false,
        skip_soft_fallback: session.skip_soft_fallback,
        consecutive_direct_fallbacks: hasFallbackMarker ? session.consecutive_direct_fallbacks + 1 : 0,
        last_coverage_update: updatedCoverage[item?.id as ItemId] === 'answered' ? { item: item?.id as ItemId, status: 'answered' } : null,
        asked_questions: updatedAskedQuestions,
        item_answer_quality: { ...session.item_answer_quality, ...softFallbackQuality },
        consecutive_low_confidence: hasFallbackMarker ? session.consecutive_low_confidence + 1 : 0,
        current_confidence_score: 0,
        messages: [
          ...updatedMessages,
          { role: 'assistant', content: sessionReply, timestamp: now },
        ],
      })

      return {
        show_fallback,
        fallback_item,
        fallback_options,
        is_done: isDone,
        risk_detected: false,
        risk_type: null,
        risk_intervention: null,
        pause_message: null,
        hotline: null,
      }
    }
  )
}

// === Handle continue after risk intervention ===
async function handleRiskContinue(
  sessionId: string,
  session: SessionState
) {
  // PRD §7.2 Step 4: after "现在回答", directly trigger Q9 fallback
  const q9Item = PHQ9.items[8] // Q9
  const updatedCoverage = { ...session.coverage }

  const now = Date.now()
  const transitionText = '好，那你看看下面哪个更贴近你的感觉——'

  // Mark session as intervened so risk modal doesn't reappear
  session.risk_status = { ...session.risk_status, intervened: true }

  const allCovered = Object.values(updatedCoverage).every(
    (s) => s === 'answered' || s === 'fallback'
  )

  // If all items already covered, just close
  if (allCovered) {
    const closingMsg = getClosingMessage(session.risk_status)
    const reply = transitionText + '\n\n' + closingMsg
    updateSession(sessionId, {
      phase: 'done',
      risk_status: session.risk_status,
      messages: [
        ...session.messages,
        { role: 'assistant', content: reply, timestamp: now },
      ],
    })
    return NextResponse.json({
      reply,
      show_fallback: false,
      fallback_item: null,
      fallback_options: null,
      is_done: true,
      messages: session.messages.concat({ role: 'assistant' as const, content: reply, timestamp: now }).map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
    })
  }

  updateSession(sessionId, {
    current_item_index: 8, // Set to Q9
    item_rounds: 2,
    follow_up_count: 0,
    coverage: updatedCoverage,
    risk_status: session.risk_status,
    messages: [
      ...session.messages,
      { role: 'assistant', content: transitionText, timestamp: now },
    ],
  })

  return createStreamResponse(transitionText, {
    show_fallback: true,
    fallback_item: q9Item.id,
    fallback_options: [...q9Item.fallback_options_original],
    is_done: false,
    risk_detected: false,
    risk_type: null,
    risk_intervention: null,
    pause_message: null,
    hotline: null,
  })
}

async function handleFallbackScore(
  sessionId: string,
  session: SessionState,
  fallbackItem: string,
  fallbackScore: number
) {
  if (!isValidItemId(fallbackItem) || fallbackScore < 0 || fallbackScore > 3) {
    return NextResponse.json({ error: 'Invalid fallback data' }, { status: 400 })
  }

  const scaleItem = PHQ9.items.find((i) => i.id === fallbackItem)
  const optionText = scaleItem?.fallback_options_original[fallbackScore] ?? ''

  const updatedCoverage = { ...session.coverage }
  updatedCoverage[fallbackItem as ItemId] = 'fallback'

  // Find next pending item after the fallback item, skipping already-covered ones
  let newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
  // If we're at Q9 (index 8) and it's now covered, find next pending or stay
  if (updatedCoverage[PHQ9.items[newCurrentItemIndex]?.id as ItemId] !== 'pending') {
    const nextPending = PHQ9.items.findIndex(
      (item, idx) => idx > session.current_item_index && updatedCoverage[item.id as ItemId] === 'pending'
    )
    newCurrentItemIndex = nextPending >= 0 ? nextPending : newCurrentItemIndex
  }

  // === Missing items safeguard: scan from start only if at boundary ===
  if (newCurrentItemIndex >= 8 && updatedCoverage[PHQ9.items[newCurrentItemIndex]?.id as ItemId] !== 'pending') {
    const anyPending = PHQ9.items.findIndex(
      (item) => updatedCoverage[item.id as ItemId] === 'pending'
    )
    if (anyPending >= 0 && anyPending !== newCurrentItemIndex) {
      newCurrentItemIndex = anyPending
      console.log(`[COSMO fallback] End reached, pending at index ${anyPending} — jumping back`)
    }
  }

  const updatedFallbackScores: FallbackScores = { ...session.fallback_scores }
  updatedFallbackScores[fallbackItem as ItemId] = fallbackScore

  const now = Date.now()

  const updatedMessages: SessionState['messages'] = [
    ...session.messages,
    { role: 'user' as const, content: optionText, timestamp: now },
  ]

  const allCovered = Object.values(updatedCoverage).every(
    (s) => s === 'answered' || s === 'fallback'
  )

  if (allCovered) {
    const closingMessage = getClosingMessage(session.risk_status)

    updateSession(sessionId, {
      phase: 'done',
      round: session.round + 1,
      coverage: updatedCoverage,
      last_coverage_update: { item: fallbackItem as ItemId, status: 'fallback' },
      current_item_index: newCurrentItemIndex,
      item_rounds: 0,
      follow_up_count: 0,
      fallback_scores: updatedFallbackScores,
      messages: [
        ...updatedMessages,
        { role: 'assistant', content: closingMessage, timestamp: now },
      ],
    })

    console.log('[COSMO chat] Fallback complete, all 9 covered - closing')

    return NextResponse.json({
      reply: closingMessage,
      show_fallback: false,
      fallback_item: null,
      fallback_options: null,
      is_done: true,
      messages: updatedMessages.concat({ role: 'assistant' as const, content: closingMessage, timestamp: now }).map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
    })
  }

  // More items to cover - call AI for next item
  // If risk was just intervened and Q9 handled, enter soothing phase
  const isPostRiskSoothing = session.risk_status.intervened && fallbackItem === 'Q9'
  const preUpdateSession: SessionState = {
    ...session,
    coverage: updatedCoverage,
    fallback_scores: updatedFallbackScores,
    current_item_index: newCurrentItemIndex,
    item_rounds: 0,
    follow_up_count: 0,
  }
  const systemPrompt = buildChatSystemPrompt(preUpdateSession)

  const finalSystemPrompt = isPostRiskSoothing
    ? systemPrompt + `\n\n【缓和阶段】学生刚经历了高风险确认和Q9兜底。先用轻松的语气聊1-2句无关话题（天气、日常、兴趣爱好等），让学生情绪缓和下来。不要提任何与心理评估相关的话题，就当是在闲聊。之后自然过渡到待覆盖条目。`
    : session.risk_status.intervened
    ? systemPrompt + `\n[Note] User expressed difficult feelings earlier. Use gentler tone.`
    : systemPrompt

  console.log('[COSMO chat] system prompt length:', finalSystemPrompt.length)

  const aiReply = await callAi(finalSystemPrompt, updatedMessages)
  if (aiReply instanceof NextResponse) {
    return aiReply
  }

  const cleanReply = aiReply.replace(/\[→\]/g, '').replace(/\[\?\]/g, '').trim()

  const newQuestions = extractQuestions(cleanReply)
  const updatedAskedQuestions = [...session.asked_questions, ...newQuestions]

  let show_fallback = false
  let fallback_item: string | null = null
  let fallback_options: string[] | null = null
  let reply = cleanReply

  // AI just asked the first question about the new item — item_rounds=1, waiting for user answer
  // Do NOT advance even if AI output [→] (user hasn't answered yet!)
  const currentItem = PHQ9.items[newCurrentItemIndex]
  if (currentItem) {
    console.log(`[COSMO chat] Fallback follow-up: AI asking about ${currentItem.id}, waiting for answer`)
  }

  const coveredCount = Object.values(updatedCoverage).filter(s => s === 'answered' || s === 'fallback').length
  console.log(`[COSMO chat] Coverage: ${coveredCount}/9`)

  updateSession(sessionId, {
    phase: session.phase,
    round: session.round + 1,
    coverage: updatedCoverage,
    last_coverage_update: { item: fallbackItem as ItemId, status: 'fallback' },
    current_item_index: newCurrentItemIndex,
    item_rounds: 1,  // AI just asked the question, waiting for answer
    follow_up_count: 0,
    fallback_scores: updatedFallbackScores,
    asked_questions: updatedAskedQuestions,
    risk_status: {
      ...session.risk_status,
      intervened: session.risk_status.intervened,
      soothing_rounds: isPostRiskSoothing ? 3 : 0,
    },
    messages: [
      ...updatedMessages,
      { role: 'assistant', content: reply, timestamp: now },
    ],
  })

  return createStreamResponse(reply, {
    show_fallback,
    fallback_item,
    fallback_options,
    is_done: false,
    risk_detected: false,
    risk_type: null,
    risk_intervention: null,
    pause_message: null,
    hotline: null,
  })
}

async function callAi(
  systemPrompt: string,
  messages: SessionState['messages']
): Promise<string | NextResponse> {
  const dialogMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  let replyContent = ''
  try {
    replyContent = await textCompletion({
      messages: dialogMessages,
      temperature: 0.7,
      max_tokens: 1024,
      useThinking: false,
    })
  } catch (e) {
    console.error('[COSMO chat] textCompletion failed:', e)
    return NextResponse.json(
      { error: '网络出了点问题，请重试' },
      { status: 500 }
    )
  }

  if (!replyContent) {
    console.warn('[COSMO chat] Empty reply, using fallback')
    replyContent = '嗯，我们继续——你刚才说到的，能再多跟我说一点吗？'
  }

  return replyContent
}

function isValidItemId(id: string): id is ItemId {
  return ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].includes(id)
}
