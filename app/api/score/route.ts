import { NextRequest, NextResponse } from 'next/server'
import type { ItemId, ItemScore, ScoreResult } from '@/types/session'
import { getSession, updateSession } from '@/lib/session-store'
import { buildScoreSystemPrompt } from '@/lib/prompts/score-prompt'
import { jsonCompletion } from '@/lib/deepseek'

type ScoreResponse = {
  scores: Record<string, { score: number; reason: string; is_fallback: boolean }>
  total: number
  risk_level: string
  q9_nonzero: boolean
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
      max_tokens: 4096,
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

  for (const key of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as ItemId[]) {
    const entry = result.scores?.[key] ?? { score: 0, reason: '评分缺失，默认 0 分', is_fallback: false }
    const score = typeof entry.score === 'number' ? Math.max(0, Math.min(3, Math.round(entry.score))) : 0
    const isFallback = entry.is_fallback || session.fallback_scores[key] !== undefined

    itemScores.push({
      item_id: key,
      score,
      justification: entry.reason || '',
      is_fallback: isFallback,
    })

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
  }

  updateSession(sessionId, { score_result: scoreResult })

  console.log(`[COSMO score] total=${totalScore}, risk=${riskLevel}, q9_nonzero=${q9Nonzero}`)
  return NextResponse.json(scoreResult)
}

function getRiskLevel(total: number): ScoreResult['risk_level'] {
  if (total <= 4) return 'minimal'
  if (total <= 9) return 'mild'
  if (total <= 14) return 'moderate'
  return 'severe'
}
