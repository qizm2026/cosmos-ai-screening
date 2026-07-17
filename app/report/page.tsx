'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// 报告暂存：同一会话的报告缓存，避免重复生成
const reportCache = new Map<string, {
  condensed_sentence: string
  status_analysis: string
  suggestions: { intro: string; bullets: string[]; footer: string | null }
}>()

function ReportContent() {
  const router = useRouter()
  const params = useSearchParams()
  const sessionId = params.get('session_id') || ''

  const [loading, setLoading] = useState(true)
  const [loadingPhase, setLoadingPhase] = useState<'score' | 'report'>('score')
  const [error, setError] = useState('')
  const [report, setReport] = useState<{
    condensed_sentence: string
    status_analysis: string
    suggestions: { intro: string; bullets: string[]; footer: string | null }
  } | null>(null)

  const hasRun = useRef(false)

  const doGenerate = useCallback(async () => {
    if (!sessionId) { setError('缺少会话信息'); setLoading(false); return }

    // 先检查缓存
    const cached = reportCache.get(sessionId)
    if (cached) {
      setReport(cached)
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadingPhase('score')
    setError('')
    try {
      // Step 1: Score
      const scoreRes = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!scoreRes.ok) throw new Error('评分失败')

      // Step 2: Report
      setLoadingPhase('report')
      const reportRes = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!reportRes.ok) {
        const err = await reportRes.json().catch(() => ({ error: '报告生成失败' }))
        throw new Error(err.error || '报告生成失败')
      }

      const data = await reportRes.json()
      setReport(data)
      // 存入缓存
      reportCache.set(sessionId, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '报告生成出错，请刷新重试')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (hasRun.current || !sessionId) return
    hasRun.current = true
    doGenerate()
  }, [sessionId, doGenerate])

  if (loading) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-text-muted animate-fade-in">
            {loadingPhase === 'score' ? '正在整理对话内容…' : '正在生成你的报告…'}
          </p>
          <div className="flex gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6">
        <p className="text-sm text-accent2 mb-4">{error}</p>
        <div className="flex gap-4">
          <button onClick={doGenerate} className="text-sm text-accent hover:text-accent/80 transition-colors">
            重试
          </button>
          <button onClick={() => router.push('/')} className="text-sm text-text-muted hover:text-accent transition-colors">
            返回首页
          </button>
        </div>
      </main>
    )
  }

  if (!report) return null

  return (
    <main className="min-h-dvh px-6 py-8 max-w-lg mx-auto">
      <button onClick={() => router.push('/chat?session_id=' + sessionId)} className="text-xs text-text-muted hover:text-accent transition-colors mb-8">
        ← 返回查看对话历史
      </button>
      <div className="space-y-12 animate-fade-in-slow">
        {/* Module 1: Condensed sentence */}
        <div className="text-center pt-4">
          <p className="text-xl font-light text-text-primary tracking-[0.05em] leading-relaxed">
            {report.condensed_sentence}
          </p>
          <div className="section-divider mt-8" />
        </div>

        {/* Module 2: Status analysis */}
        <div className="space-y-6 text-body text-sm">
          {report.status_analysis.split('\n\n').map((para, i) => {
            if (!para.trim()) return null
            const isFirst = i === 0
            const isLast = i === report.status_analysis.split('\n\n').filter(Boolean).length - 1
            return (
              <div key={i} className="space-y-4">
                {isFirst && (
                  <h3 className="text-xs text-text-subtle tracking-[0.1em] uppercase">此刻的你</h3>
                )}
                <p className="text-text-muted leading-7">{para.trim()}</p>
                {isLast && (
                  <div className="section-divider" />
                )}
              </div>
            )
          })}
        </div>

        {/* Module 3: Suggestions */}
        <div className="space-y-6">
          <h3 className="text-xs text-text-subtle tracking-[0.1em] uppercase">往前一步</h3>

          <p className="text-sm text-text-muted leading-7">
            {report.suggestions.intro}
          </p>

          <div className="space-y-3">
            {report.suggestions.bullets.map((bullet, i) => (
              <div
                key={i}
                className="glass-card rounded-xl p-4 text-sm text-text-muted leading-7"
              >
                {bullet}
              </div>
            ))}
          </div>

          {report.suggestions.footer && (
            <p className="text-xs text-text-subtle leading-relaxed pt-2">
              {report.suggestions.footer}
            </p>
          )}
        </div>

        {/* Bottom */}
        <div className="flex justify-center pt-8 pb-4">
          <button
            onClick={() => router.push('/')}
            className="rounded-full px-8 py-2.5 text-xs text-text-muted border border-[#E5E2DE] hover:border-accent/40 hover:text-text-primary transition-all duration-500 ease-out tracking-wider"
          >
            重新开始
          </button>
        </div>
      </div>
    </main>
  )
}

export default function ReportPage() {
  return (
    <Suspense fallback={
      <main className="min-h-dvh flex items-center justify-center px-6">
        <p className="text-sm text-text-muted animate-fade-in">正在整理你的报告…</p>
      </main>
    }>
      <ReportContent />
    </Suspense>
  )
}
