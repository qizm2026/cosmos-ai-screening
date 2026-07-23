import { NextRequest, NextResponse } from 'next/server'
import type { ItemId, SessionState, FallbackScores, UserContext, AnswerQuality } from '@/types/session'
import { getSession, updateSession } from '@/lib/session-store'
import { buildChatSystemPrompt } from '@/lib/prompts/chat-prompt'
import { textCompletion, createStreamResponse, createRealStreamResponse } from '@/lib/deepseek'
import { PHQ9 } from '@/lib/scales/phq9'
import { detectRisk } from '@/lib/risk-detector'
import { postProcessReply } from '@/lib/post-processor'

// === 对话节奏常量（对标 AgentMental 双参数控制） ===
/** 每条目最大追问轮次，对标 AgentMental d 参数 */
const MAX_ITEM_ROUNDS = 2
/** 信息充分性推进阈值，info_sufficiency >= 2 才推进，对标 AgentMental θ 参数 */
const SUFFICIENCY_THRESHOLD = 2

// === SYS 分析块解析 ===
interface SysAnalysis {
  item_score_guess: number   // 0-3 / -1=无法判断
  /** 0=严重不足 / 1=部分线索 / 2=信息充分，兼容旧格式 info_sufficient: boolean */
  info_sufficiency: number
  risk_confirmed: boolean    // AI是否确认高风险意图
  /** 信息缺失维度，仅 info_sufficiency <= 1 时填写 */
  missing_dimensions?: string[]
  /** Phase 3：条目完成时的结构化摘要，仅推进时填写 */
  item_summary?: {
    summary: string
    emotion: string
    frequency: string
    duration: string
    symptom: string
    impact: string
  }
}

function parseSysBlock(text: string): SysAnalysis | null {
  // 兼容多种格式：
  //   <!--SYS\n{json}\nSYS-->  (标准格式)
  //   <<SYS>>{json}<</SYS>>     (DeepSeek 常见变体)
  //   [SYS]{json}[/SYS]         (旧格式)
  let jsonStr: string | null = null

  // 格式1：HTML注释 <!--SYS...SYS-->
  const htmlMatch = text.match(/<!--SYS\n([\s\S]*?)\nSYS-->/)
  if (htmlMatch) {
    jsonStr = htmlMatch[1]
  }

  // 格式2：尖括号 <<SYS>>...<</SYS>>
  if (!jsonStr) {
    const angleMatch = text.match(/<<SYS>>\s*([\s\S]*?)\s*<{1,2}\/SYS>{1,2}/)
    if (angleMatch) {
      jsonStr = angleMatch[1]
    }
  }

  // 格式3：方括号 [SYS]...[/SYS]
  if (!jsonStr) {
    const bracketMatch = text.match(/\[SYS\]\s*\n?([\s\S]*?)\n?\s*\[\/SYS\]/)
    if (bracketMatch) {
      jsonStr = bracketMatch[1]
    }
  }

  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr)

    // 向后兼容：旧格式 info_sufficient (boolean) → 映射为 info_sufficiency (number)
    let info_sufficiency: number
    if (typeof parsed.info_sufficiency === 'number') {
      info_sufficiency = Math.max(0, Math.min(2, Math.round(parsed.info_sufficiency)))
    } else if (typeof parsed.info_sufficient === 'boolean') {
      info_sufficiency = parsed.info_sufficient ? 2 : 0
    } else {
      info_sufficiency = 0
    }

    return {
      item_score_guess: typeof parsed.item_score_guess === 'number' ? parsed.item_score_guess : -1,
      info_sufficiency,
      risk_confirmed: parsed.risk_confirmed === true,
      missing_dimensions: Array.isArray(parsed.missing_dimensions) ? parsed.missing_dimensions : undefined,
      item_summary: parsed.item_summary || undefined,
    }
  } catch {
    return null
  }
}

function stripSysBlock(text: string): string {
  return text.replace(/<!--SYS\n[\s\S]*?\nSYS-->/g, '')
    .replace(/\[SYS\][\s\S]*?\[\/SYS\]/g, '')
    .replace(/<<SYS>>[\s\S]*?<{1,2}\/SYS>{1,2}/g, '')
    .trim()
}

// === 收尾话术（分级） ===
const CLOSING_LOW_RISK = '今天聊到这儿。接下来，系统会为你生成一份个人报告，帮你把刚才聊到的状态整理清楚。'

const CLOSING_MODERATE = '今天聊到这儿。谢谢你愿意把这些感受说给我听——有些话说出来本身就需要勇气。接下来系统会为你生成一份报告，帮你把一些模糊的感受看得更清晰。'

const CLOSING_SEVERE = '今天聊到这儿。你刚才说到的感受，我都听到了——你不是一个人面对这些。接下来系统会为你生成一份报告。有些力量你可能自己还没意识到，但它们已经在起作用了。之后如果需要，有人可以陪你一起往前走。'

function getClosingMessage(riskStatus: SessionState['risk_status']): string {
  if (riskStatus.detected && riskStatus.type === 'suicide_ideation') {
    return CLOSING_SEVERE
  }
  if (riskStatus.detected) {
    return CLOSING_MODERATE
  }
  return CLOSING_LOW_RISK
}

// === 用户上下文提取（启发式） ===
function extractUserContext(message: string, current: UserContext): UserContext {
  const updated: UserContext = {
    occupation: current.occupation,
    age: current.age,
    hobbies: [...current.hobbies],
    mentioned_symptoms: [...current.mentioned_symptoms],
    notes: [...current.notes],
  }

  if (!updated.occupation) {
    const occPatterns: [RegExp, string][] = [
      [/初[一二三]|七[年级]|八[年级]|九[年级]/, '初中生'],
      [/高[一二三]|高一|高二|高三/, '高中生'],
      [/大学[生]?|研[究生]?|硕士|博士/, '大学生'],
      [/上[班班族]|打工|工作/, '上班族'],
      [/老[师师]?/, '老师'],
    ]
    for (const [pattern, label] of occPatterns) {
      if (pattern.test(message)) { updated.occupation = label; break }
    }
  }

  if (!updated.age) {
    const ageMatch = message.match(/(\d{1,2})\s*岁/)
    if (ageMatch) {
      const age = parseInt(ageMatch[1])
      if (age >= 10 && age <= 60) updated.age = ageMatch[1] + '岁'
    }
  }

  const hobbyPatterns: [RegExp, string][] = [
    [/弹吉他|弹琴|钢琴|小提琴/, '音乐'], [/打篮球|踢足球|跑步|游泳|健身|打球/, '运动'],
    [/看书|阅读|小说/, '阅读'], [/画画|绘画|素描/, '绘画'],
    [/游戏|打游戏|玩游戏/, '游戏'], [/编程|写代码/, '编程'],
    [/摄影|拍照/, '摄影'], [/跳舞|舞蹈/, '舞蹈'],
  ]
  for (const [pattern, hobby] of hobbyPatterns) {
    if (pattern.test(message) && !updated.hobbies.includes(hobby)) {
      updated.hobbies.push(hobby)
    }
  }

  const symptomPatterns: [RegExp, string][] = [
    [/睡[不着好]|失眠|睡不[安稳]|嗜睡|睡太多/, '睡眠'],
    [/[吃不进]?食欲|吃不下|吃太多|暴食/, '食欲'],
    [/累|疲惫|没力气|没精力/, '精力'],
    [/专注|集中|走神|分心/, '注意力'],
    [/心情|情绪|低落|沮丧|不开心/, '情绪'],
    [/兴趣|提不起劲|不想做/, '兴趣'],
  ]
  for (const [pattern, dim] of symptomPatterns) {
    if (pattern.test(message) && !updated.mentioned_symptoms.includes(dim)) {
      updated.mentioned_symptoms.push(dim)
    }
  }

  return updated
}

// === 从 AI 回复中提取问题（防重复） ===
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

// === 模糊回答检测（代码层兜底：仅检测极短/敷衍回答）===
function detectAnswerVagueness(message: string): {
  isVague: boolean
  confidenceScore: number
} {
  const trimmed = message.trim()
  const len = trimmed.length

  // 极短回答（<6字）
  if (len < 6) {
    return { isVague: true, confidenceScore: 0 }
  }

  // 模糊兜底模式
  const vaguePatterns = [
    /^(还行|还好|就那样|差不多|一般|不知道|不清楚|说不好|没想过|没什么|都行|都可以|随便|还行吧|就这样|算了吧|不说了|说不清|不好说)[。！？.!]*$/,
    /^(嗯|哦|啊|呃|哎|对|是|有|没|有吧|可能吧|大概吧|也许吧)[。！？.!]*$/,
    /^(挺好的|还行吧|就这样吧|算了吧|不说了|不知道啊)[。！？.!]*$/,
  ]
  if (vaguePatterns.some(p => p.test(trimmed))) {
    return { isVague: true, confidenceScore: 0 }
  }

  // 6类信号词检测
  const signals = [
    /[每经常偶尔有时候大概大约多少几]/.test(trimmed),
    /\d/.test(trimmed),
    /[天周月年小时分钟]/.test(trimmed),
    /[很非常特别极其比较不太有点稍微完全]/.test(trimmed),
    /[影响导致所以因为结果]/.test(trimmed),
    /[做去干吃喝玩乐学习工作上课考试]/.test(trimmed),
  ]
  const signalCount = signals.filter(Boolean).length

  if (signalCount >= 3) return { isVague: false, confidenceScore: Math.min(5, signalCount + 1) }
  if (signalCount === 2) return { isVague: false, confidenceScore: len > 20 ? 3 : 2 }
  if (signalCount === 1) return { isVague: true, confidenceScore: 1 }
  return { isVague: true, confidenceScore: 0 }
}

// ===================================================================
// POST /api/chat — 核心对话接口
// ===================================================================

export async function POST(request: NextRequest) {
  const body = await request.json()

  const sessionId = body.session_id as string
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const session = getSession(sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // === 风险干预后继续 ===
  if (body.risk_action === 'continue') {
    return handleRiskContinue(sessionId, session)
  }

  const userMessage = (body.user_message as string) || ''
  const isInit = body.init === true
  const now = Date.now()

  // Guard: 对话已结束
  if (session.phase === 'done' && userMessage && !isInit) {
    console.log('[COSMO chat] Session done, returning done state')
    return NextResponse.json({
      messages: session.messages.map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
      is_done: true,
    })
  }

  // Init: session done → 直接返回历史
  if (isInit && session.phase === 'done') {
    console.log('[COSMO chat] Init: session done, returning history')
    return NextResponse.json({
      messages: session.messages.map(m => ({ role: m.role, content: m.content })),
      phase: 'done',
      is_done: true,
    })
  }

  // === 兜底选项提交 ===
  if (body.fallback_item && typeof body.fallback_score === 'number') {
    return handleFallbackScore(sessionId, session, body.fallback_item, body.fallback_score)
  }

  if (!userMessage && !isInit) {
    return NextResponse.json({ error: 'Missing user_message' }, { status: 400 })
  }

  // === 风险检测（无弹窗，纯自然对话确认） ===
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

  // 风险确认阶段用户再次触发 → 自动确认
  if (riskConfirming && userMessage) {
    const confirmResult = detectRisk(userMessage)
    if (confirmResult.detected) {
      riskConfirming = false
      riskIntervened = true
      soothingRounds = 3
      console.log('[COSMO risk] User repeated high-risk content — auto-confirmed, triggering Q9 fallback')
    }
  }

  // 缓和阶段倒计时
  if (!isInit && session.risk_status.soothing_rounds > 0) {
    soothingRounds = session.risk_status.soothing_rounds - 1
    if (soothingRounds === 0) {
      console.log('[COSMO risk] Soothing phase complete, resuming normal interview')
    }
  }

  // === 提取用户上下文 ===
  let updatedUserContext = session.user_context
  if (!isInit && userMessage) {
    updatedUserContext = extractUserContext(userMessage, session.user_context)
  }

  // === 构建消息和 Prompt ===
  const updatedMessages: SessionState['messages'] = isInit
    ? session.messages
    : [...session.messages, { role: 'user' as const, content: userMessage, timestamp: now }]

  const systemPrompt = buildChatSystemPrompt({
    ...session,
    user_context: updatedUserContext,
  })

  const finalSystemPrompt = session.risk_status.intervened
    ? systemPrompt + '\n[Note] User expressed difficult feelings earlier. Use a gentler tone, avoid probing risk details. Transition naturally to a lighter topic.'
    : systemPrompt

  console.log('[COSMO chat] system prompt length:', finalSystemPrompt.length)

  const dialogMessages = [
    { role: 'system' as const, content: finalSystemPrompt },
    ...updatedMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  // === 流式响应 ===
  return createRealStreamResponse(
    {
      messages: dialogMessages,
      temperature: 0.7,
      max_tokens: 1024,
      useThinking: false,
    },
    async (fullText: string, enqueue: (text: string) => void) => {
      // === 解析 AI 分析 JSON ===
      console.log('[COSMO chat] RAW fullText:', fullText.substring(0, 500))
      const sys = parseSysBlock(fullText)
      const cleanReply = stripSysBlock(fullText)

      // === 后处理过滤（风险确认阶段跳过） ===
      const postResult = postProcessReply(cleanReply, session.risk_status.confirming)
      let sessionReply = postResult.cleanedText

      // === 风险确认：AI SYS 标记 risk_confirmed 或代码层自动确认 ===
      const aiRiskConfirmed = sys?.risk_confirmed === true && !session.risk_status.intervened
      const autoRiskConfirmed = riskIntervened && !session.risk_status.intervened
      const shouldTriggerQ9 = aiRiskConfirmed || autoRiskConfirmed

      if (riskIntervened && session.risk_status.confirming) {
        riskConfirming = false
      }

      // === 提取问题（防重复） ===
      const newQuestions = extractQuestions(sessionReply)
      const updatedAskedQuestions = [...session.asked_questions, ...newQuestions]

      // === 覆盖推进逻辑 ===
      const updatedCoverage = { ...session.coverage }
      const item = PHQ9.items[session.current_item_index]
      let fallback_item: string | null = null
      let fallback_options: string[] | null = null
      let show_fallback = false
      let newCurrentItemIndex = session.current_item_index
      let newItemRounds = session.item_rounds
      let newFollowUpCount = session.follow_up_count
      let lastCoverageUpdate = session.last_coverage_update
      let newItemAnswerQuality = { ...session.item_answer_quality }
      let newCurrentConfidenceScore = session.current_confidence_score
      let newItemSummaries = [...session.item_summaries]
      let newMissingDimensions: string[] = []
      let newItemScoresInitial = { ...(session.item_scores_initial ?? {}) } as Record<string, number>

      if (session.phase === 'interview' && item) {
        // Q9 已完成 → 不拦截（AI 在 SYS 中已确认无风险且信息充分）
        const q9AlreadyCovered = updatedCoverage['Q9'] === 'answered'
          || (sys?.info_sufficiency >= SUFFICIENCY_THRESHOLD && item.id === 'Q9' && sys?.risk_confirmed !== true)

        if (shouldTriggerQ9 && !q9AlreadyCovered) {
          // 路径 A：高风险确认 → Q9 兜底
          const q9Item = PHQ9.items[8]
          show_fallback = true
          fallback_item = q9Item.id
          fallback_options = [...q9Item.fallback_options_original]
          newCurrentItemIndex = 8
          newItemRounds = 0
          newCurrentConfidenceScore = 0
          sessionReply = q9Item.fallback_prompt
          console.log('[COSMO chat] Risk confirmed — triggering Q9 fallback')
        } else if (sys) {
          // ===== AI SYS 块存在 =====
          const suff = sys.info_sufficiency

          if (suff >= SUFFICIENCY_THRESHOLD) {
            // 信息充分（info_sufficiency >= 2）→ 正常推进
            updatedCoverage[item.id as ItemId] = 'answered'
            newItemAnswerQuality[item.id as ItemId] = sys.item_score_guess >= 0 ? 'sufficient' : 'partial'
            newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
            newItemRounds = 0
            newFollowUpCount = 0
            lastCoverageUpdate = { item: item.id as ItemId, status: 'answered' }
            // Phase 1：存储逐项初评分（item_score_guess >= 0 才写入，-1 不写入）
            if (sys.item_score_guess >= 0) {
              newItemScoresInitial[item.id] = sys.item_score_guess
            }
            // Phase 3：收集条目摘要
            if (sys.item_summary?.summary) {
              newItemSummaries = collectItemSummary(session, item.id, sys.item_summary)
            }
            console.log(`[COSMO chat] Item ${item.id}: info_sufficiency=${suff} — advancing to ${newCurrentItemIndex}`)
          } else if (newItemRounds < MAX_ITEM_ROUNDS) {
            // 信息不足 + 还有追问额度 → 追问
            newItemRounds = newItemRounds + 1
            newMissingDimensions = sys.missing_dimensions ?? []
            console.log(`[COSMO chat] Item ${item.id}: info_sufficiency=${suff}, rounds ${session.item_rounds}→${newItemRounds} — probing with dims: ${newMissingDimensions.join(',') || 'none'}`)
          } else {
            // 信息不足 + 追问额度用尽
            if (suff === 1) {
              // 部分信息 → forced-choice（LLM 生成二选一，不兜底）
              newItemRounds = newItemRounds + 1
              console.log(`[COSMO chat] Item ${item.id}: partial info, rounds exhausted — triggering forced-choice`)
            } else {
              // suff === 0 → 硬兜底
              show_fallback = true
              fallback_item = item.id
              fallback_options = [...item.fallback_options_original]
              sessionReply = item.fallback_prompt
              updatedCoverage[item.id as ItemId] = 'fallback'
              newItemAnswerQuality[item.id as ItemId] = 'fallback'
              newItemRounds = 0
              newFollowUpCount = 0
              newCurrentConfidenceScore = 0
              console.log(`[COSMO chat] Item ${item.id}: info_sufficiency=0, rounds exhausted — triggering hard fallback`)
            }
          }
        } else {
          // ===== SYS 缺失 =====
          if (newItemRounds === 0) {
            // 第一轮，等 AI 追问
            newItemRounds = 1
            console.log(`[COSMO chat] Item ${item.id}: SYS missing, waiting for AI to probe`)
          } else {
            // 已追问，代码层兜底
            const vagueness = detectAnswerVagueness(userMessage)
            newCurrentConfidenceScore = vagueness.confidenceScore
            if (vagueness.isVague && vagueness.confidenceScore <= 1) {
              show_fallback = true
              fallback_item = item.id
              fallback_options = [...item.fallback_options_original]
              sessionReply = item.fallback_prompt
              updatedCoverage[item.id as ItemId] = 'fallback'
              newItemAnswerQuality[item.id as ItemId] = 'fallback'
              newItemRounds = 0
              newFollowUpCount = 0
              console.log(`[COSMO chat] Item ${item.id}: SYS missing + code-layer force fallback (confidence=${vagueness.confidenceScore})`)
            } else {
              updatedCoverage[item.id as ItemId] = 'answered'
              newItemAnswerQuality[item.id as ItemId] = vagueness.confidenceScore >= 4 ? 'sufficient' : 'partial'
              newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
              newItemRounds = 0
              newFollowUpCount = 0
              lastCoverageUpdate = { item: item.id as ItemId, status: 'answered' }
              console.log(`[COSMO chat] Item ${item.id}: SYS missing but code-layer passes — advancing to ${newCurrentItemIndex}`)
            }
          }
        }

        // forced-choice 后仍无法确定 → 硬兜底
        if (!show_fallback && newItemRounds > MAX_ITEM_ROUNDS) {
          const fcVagueness = detectAnswerVagueness(userMessage)
          if (fcVagueness.isVague && fcVagueness.confidenceScore <= 1) {
            show_fallback = true
            fallback_item = item.id
            fallback_options = [...item.fallback_options_original]
            sessionReply = item.fallback_prompt
            updatedCoverage[item.id as ItemId] = 'fallback'
            newItemAnswerQuality[item.id as ItemId] = 'fallback'
            newItemRounds = 0
            newCurrentConfidenceScore = 0
            // Phase 3：forced-choice 后兜底也收集摘要（如有）
            if (sys?.item_summary?.summary) {
              newItemSummaries = collectItemSummary(session, item.id, sys.item_summary)
            }
            console.log(`[COSMO chat] Item ${item.id}: forced-choice failed — triggering hard fallback`)
          } else {
            // forced-choice 后学生给出了有一定信息量的回答 → 推进覆盖
            updatedCoverage[item.id as ItemId] = 'answered'
            newItemAnswerQuality[item.id as ItemId] = 'partial'
            newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
            newItemRounds = 0
            newFollowUpCount = 0
            newCurrentConfidenceScore = fcVagueness.confidenceScore
            lastCoverageUpdate = { item: item.id as ItemId, status: 'answered' }
            if (sys?.item_score_guess != null && sys.item_score_guess >= 0) {
              newItemScoresInitial[item.id] = sys.item_score_guess
            }
            if (sys?.item_summary?.summary) {
              newItemSummaries = collectItemSummary(session, item.id, sys.item_summary)
            }
            console.log(`[COSMO chat] Item ${item.id}: forced-choice passed (confidence=${fcVagueness.confidenceScore}) — advancing to ${newCurrentItemIndex}`)
          }
        }
      }

      // === 阶段管理 ===
      let newPhase = session.phase
      if (session.phase === 'icebreak') {
        const icebreakRounds = session.round + (isInit ? 0 : 1)
        if (icebreakRounds >= 2) {
          newPhase = 'interview'
          newCurrentItemIndex = 0
          newItemRounds = 0
          newFollowUpCount = 0
          console.log('[COSMO chat] Icebreak complete, entering interview')
        }
      }

      // === 遗漏条目安全网 ===
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
        const closingMsg = getClosingMessage(session.risk_status)

        const aiReplyEndsWithQuestion = /[？?]\s*$/.test(sessionReply)
        if (aiReplyEndsWithQuestion) {
          enqueue('\n\n' + closingMsg)
          sessionReply = closingMsg
        } else {
          enqueue('\n\n' + closingMsg)
          sessionReply = sessionReply + '\n\n' + closingMsg
        }
      }

      const coveredCount = Object.values(updatedCoverage).filter(s => s === 'answered' || s === 'fallback').length
      console.log(`[COSMO chat] Coverage: ${coveredCount}/9, done=${isDone}`)

      // === 更新会话 ===
      updateSession(sessionId, {
        phase: newPhase,
        round: isInit ? session.round : session.round + 1,
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
          intervened: riskIntervened || session.risk_status.intervened,
          intervention_text: session.risk_status.intervention_text,
          confirming: riskConfirming,
          soothing_rounds: soothingRounds,
        },
        item_answer_quality: newItemAnswerQuality,
        current_confidence_score: newCurrentConfidenceScore,
        missing_dimensions: newMissingDimensions,
        item_summaries: newItemSummaries,
        item_scores_initial: newItemScoresInitial as Partial<Record<ItemId, number>>,
        messages: [
          ...updatedMessages,
          { role: 'assistant', content: sessionReply, timestamp: now },
        ],
      })

      return {
        show_fallback,
        fallback_item,
        fallback_options,
        fallback_prompt: show_fallback && item ? item.fallback_prompt : null,
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

// ===================================================================
// handleRiskContinue — 风险干预后继续
// ===================================================================
async function handleRiskContinue(
  sessionId: string,
  session: SessionState
) {
  const q9Item = PHQ9.items[8]
  const updatedCoverage = { ...session.coverage }

  const now = Date.now()
  const transitionText = '好，那你看看下面哪个更贴近你的感觉——'

  session.risk_status = { ...session.risk_status, intervened: true }

  const allCovered = Object.values(updatedCoverage).every(
    (s) => s === 'answered' || s === 'fallback'
  )

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
    current_item_index: 8,
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

// ===================================================================
// handleFallbackScore — 兜底选项提交处理
// ===================================================================
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

  // 找下一个待覆盖条目
  let newCurrentItemIndex = Math.min(session.current_item_index + 1, 8)
  if (updatedCoverage[PHQ9.items[newCurrentItemIndex]?.id as ItemId] !== 'pending') {
    const nextPending = PHQ9.items.findIndex(
      (item, idx) => idx > session.current_item_index && updatedCoverage[item.id as ItemId] === 'pending'
    )
    newCurrentItemIndex = nextPending >= 0 ? nextPending : newCurrentItemIndex
  }

  const updatedFallbackScores: FallbackScores = { ...session.fallback_scores }
  updatedFallbackScores[fallbackItem as ItemId] = fallbackScore

  // Phase 1：兜底条目也写入初评分，确保每条目都有 item_scores_initial
  const updatedItemScoresInitial = { ...(session.item_scores_initial ?? {}) } as Record<string, number>
  updatedItemScoresInitial[fallbackItem] = fallbackScore

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
      item_scores_initial: updatedItemScoresInitial as Partial<Record<ItemId, number>>,
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

  // 还有待覆盖条目 → AI 继续
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
    ? systemPrompt + '\n\n【缓和阶段】学生刚经历了高风险确认和Q9兜底。先用轻松的语气聊1-2句无关话题（天气、日常、兴趣爱好等），让学生情绪缓和下来。不要提任何与心理评估相关的话题，就当是在闲聊。之后自然过渡到待覆盖条目。'
    : session.risk_status.intervened
    ? systemPrompt + '\n[Note] User expressed difficult feelings earlier. Use gentler tone.'
    : systemPrompt

  console.log('[COSMO chat] system prompt length:', finalSystemPrompt.length)

  const aiReply = await callAi(finalSystemPrompt, updatedMessages)
  if (aiReply instanceof NextResponse) return aiReply

  const cleanReply = stripSysBlock(aiReply)

  const newQuestions = extractQuestions(cleanReply)
  const updatedAskedQuestions = [...session.asked_questions, ...newQuestions]

  const coveredCount = Object.values(updatedCoverage).filter(s => s === 'answered' || s === 'fallback').length
  console.log(`[COSMO chat] Coverage: ${coveredCount}/9`)

  updateSession(sessionId, {
    phase: session.phase,
    round: session.round + 1,
    coverage: updatedCoverage,
    last_coverage_update: { item: fallbackItem as ItemId, status: 'fallback' },
    current_item_index: newCurrentItemIndex,
    item_rounds: 1,
    follow_up_count: 0,
    fallback_scores: updatedFallbackScores,
    item_scores_initial: updatedItemScoresInitial as Partial<Record<ItemId, number>>,
    asked_questions: updatedAskedQuestions,
    risk_status: {
      ...session.risk_status,
      intervened: session.risk_status.intervened,
      soothing_rounds: isPostRiskSoothing ? 3 : 0,
    },
    messages: [
      ...updatedMessages,
      { role: 'assistant', content: cleanReply, timestamp: now },
    ],
  })

  return createStreamResponse(cleanReply, {
    show_fallback: false,
    fallback_item: null,
    fallback_options: null,
    is_done: false,
    risk_detected: false,
    risk_type: null,
    risk_intervention: null,
    pause_message: null,
    hotline: null,
  })
}

// ===================================================================
// 工具函数
// ===================================================================

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

// === Phase 3：条目摘要收集 ===
function collectItemSummary(
  _session: SessionState,
  itemId: string,
  summary: NonNullable<SysAnalysis['item_summary']>
): SessionState['item_summaries'] {
  const sessionSummaries = _session.item_summaries ?? []
  return [
    ...sessionSummaries,
    {
      item_id: itemId as ItemId,
      summary: summary.summary || '',
      dimensions: {
        emotion: summary.emotion || '',
        frequency: summary.frequency || '',
        duration: summary.duration || '',
        symptom: summary.symptom || '',
        impact: summary.impact || '',
      },
      recorded_at: Date.now(),
    },
  ]
}
