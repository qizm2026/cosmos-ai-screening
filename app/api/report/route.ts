import { NextRequest, NextResponse } from 'next/server'
import type { ReportResult } from '@/types/session'
import { getSession, updateSession } from '@/lib/session-store'
import { buildReportSystemPrompt } from '@/lib/prompts/report-prompt'
import { jsonCompletion } from '@/lib/deepseek'

type ReportResponse = {
  condensed_candidates: [string, string]
  condensed_sentence: string
  status_analysis: string
  suggestions: {
    intro: string
    bullets: string[]
    footer: string | null
  }
}

const FALLBACK_SENTENCE = '完成了一次认真的对话，对自己的了解又多了一点。'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const sessionId = body.session_id as string

  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const session = getSession(sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // 如果已有报告结果，直接返回缓存
  if (session.report_result) {
    console.log('[COSMO report] Returning cached result')
    return NextResponse.json(session.report_result)
  }

  if (!session.score_result) return NextResponse.json({ error: 'No score result found. Run scoring first.' }, { status: 400 })

  const conversationText = session.messages
    .map((m) => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`)
    .join('\n')

  const systemPrompt = buildReportSystemPrompt(session.score_result)
  console.log('[COSMO report] system prompt length:', systemPrompt.length)

  let result: ReportResponse
  try {
    result = await jsonCompletion<ReportResponse>({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `对话记录：\n${conversationText}\n\n请根据以上对话和评分结果生成学生报告。` },
      ],
      temperature: 0.5,
      max_tokens: 4096,
      useThinking: false,
    })
  } catch (e) {
    console.error('[COSMO report] jsonCompletion failed:', e)
    return NextResponse.json({ error: '报告生成出错，请重试' }, { status: 500 })
  }

  // Validate condensed sentence (use fallback if both candidates fail basic checks)
  const sentence = sanitizeCondensedSentence(result.condensed_sentence)
  const candidates = Array.isArray(result.condensed_candidates) && result.condensed_candidates.length >= 2
    ? [result.condensed_candidates[0], result.condensed_candidates[1]]
    : ['', '']

  const reportResult: ReportResult = {
    condensed_sentence: sentence || FALLBACK_SENTENCE,
    status_analysis: result.status_analysis || '这次对话让你更了解自己了。',
    suggestions: {
      intro: result.suggestions?.intro || '接下来，你可以试试这些——',
      bullets: Array.isArray(result.suggestions?.bullets) ? result.suggestions.bullets.filter(Boolean).slice(0, 5) : ['保持让自己舒服的节奏，不用勉强自己。'],
      footer: result.suggestions?.footer || null,
    },
  }

  updateSession(sessionId, { report_result: reportResult })

  console.log('[COSMO report] Generated:', reportResult.condensed_sentence)
  return NextResponse.json(reportResult)
}

function sanitizeCondensedSentence(raw: string): string {
  const cleaned = raw.replace(/^["「]|["」]$/g, '').trim()
  // Prompt 要求 10-15 字，超过 18 字时在自然标点处截断
  if (cleaned.length > 18) {
    const truncated = cleaned.slice(0, 15)
    const lastBreak = truncated.search(/[，,。！？、]/)
    return lastBreak > 8 ? truncated.slice(0, lastBreak) : truncated
  }
  const forbidden = ['抑郁', '焦虑', '障碍', '风险', '症状', '诊断']
  for (const word of forbidden) {
    if (cleaned.includes(word)) return ''
  }
  return cleaned
}
