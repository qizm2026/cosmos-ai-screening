import { NextRequest, NextResponse } from 'next/server'
import type { ItemId, ItemScore, ScoreResult } from '@/types/session'
import { getSession, updateSession } from '@/lib/session-store'
import { buildScoreSystemPrompt } from '@/lib/prompts/score-prompt'
import { jsonCompletion } from '@/lib/deepseek'

type ScoreEntry = {
  score: number
  matched_anchor_index?: number
  symptom_evidence?: string
  severity_judgment?: string
  reason: string
  calibration_note?: string     // 全局校准说明（可选，仅调整初评分时填写）
  is_fallback: boolean
}

type ScoreResponse = {
  scores: Record<string, ScoreEntry>
  total: number
  risk_level: string
  q9_nonzero: boolean
  calibration_summary?: string  // 全局校准摘要，如"1个条目初评分被调整：Q1 2→1"
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const sessionId = body.session_id as string

  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const session = getSession(sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // 如果已有评分结果，直接返回缓存
  if (session.score_result) {
    console.log('[COSMO score] Returning cached result')
    return NextResponse.json(session.score_result)
  }

  // Build conversation text
  const conversationText = session.messages
    .map((m) => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`)
    .join('\n')

  const systemPrompt = buildScoreSystemPrompt(session)
  console.log('[COSMO score] system prompt length:', systemPrompt.length)

  let result: ScoreResponse
  try {
    result = await jsonCompletion<ScoreResponse>({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `对话记录：\n${conversationText}\n\n请根据以上对话对 9 个条目逐一评分。` },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      useThinking: false,
    })
  } catch (e) {
    console.error('[COSMO score] jsonCompletion failed:', e)
    return NextResponse.json({ error: '评分过程出错，请重试' }, { status: 500 })
  }

  // Build item scores
  const itemScores: ItemScore[] = []
  let totalScore = 0
  let q9Nonzero = false
  const insufficientItems: ItemId[] = []

  for (const key of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as ItemId[]) {
    const isFallback = session.fallback_scores[key] !== undefined

    let score: number
    let justification: string
    let calibrationNote: string | undefined

    if (isFallback) {
      // 兜底条目：直接取用户选择题的选择，不经过 LLM 评分
      score = session.fallback_scores[key]!
      justification = `学生通过选择题选择了频率选项（选项索引 ${score}），直接采用兜底计分`
      calibrationNote = undefined
    } else {
      // 非兜底条目：走 LLM PsyCoT 三步推理
      const entry = result.scores?.[key] ?? { score: 0, reason: '评分缺失，默认 0 分', is_fallback: false }
      const rawScore = typeof entry.score === 'number' ? Math.max(0, Math.min(3, Math.round(entry.score))) : 0
      const anchorIndex = typeof entry.matched_anchor_index === 'number'
        ? Math.max(0, Math.min(3, Math.round(entry.matched_anchor_index)))
        : rawScore

      // matched_anchor_index 优先（对标 HopeBot/BDI-FS-GPT 评分解耦）
      score = anchorIndex
      justification = entry.reason || ''
      calibrationNote = entry.calibration_note || undefined
    }

    // 对话质量标记（供教师报告参考）
    const quality = session.item_answer_quality?.[key]
    const answerInsufficient = quality === 'insufficient' || quality === 'partial' || quality === 'fallback'

    // 初评分：优先从 item_scores_initial 取，其次从 fallback_scores 取
    const initialScore = session.item_scores_initial?.[key] ?? session.fallback_scores[key]

    itemScores.push({
      item_id: key,
      score,
      justification,
      is_fallback: isFallback,
      answer_insufficient: answerInsufficient,
      initial_score: initialScore,
      calibration_note: calibrationNote,
    })

    if (answerInsufficient) {
      insufficientItems.push(key)
    }

    totalScore += score
    if (key === 'Q9' && score > 0) q9Nonzero = true
  }

  // Q9 forced rule: any non-zero → risk_level severe
  let riskLevel = getRiskLevel(totalScore)
  if (q9Nonzero) riskLevel = 'severe'

  const scoreResult: ScoreResult = {
    item_scores: itemScores,
    total_score: totalScore,
    risk_level: riskLevel,
    q9_nonzero: q9Nonzero,
    insufficient_items: insufficientItems.length > 0 ? insufficientItems : undefined,
    calibration_summary: result.calibration_summary || undefined,
  }

  updateSession(sessionId, { score_result: scoreResult })

  // 全局校准日志
  if (result.calibration_summary) {
    console.log(`[COSMO score] ${result.calibration_summary}`)
  }
  console.log(`[COSMO score] total=${totalScore}, risk=${riskLevel}, q9_nonzero=${q9Nonzero}, insufficient=${insufficientItems.join(',') || 'none'}`)
  return NextResponse.json(scoreResult)
}

function getRiskLevel(total: number): ScoreResult['risk_level'] {
  if (total <= 4) return 'minimal'
  if (total <= 9) return 'mild'
  if (total <= 14) return 'moderate'
  return 'severe'
}
