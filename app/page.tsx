'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function Icon({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      {children}
      <span className="text-[11px] tracking-wider text-text-subtle">{label}</span>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleStart() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/session', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建会话失败')
      router.push('/chat?session_id=' + data.session_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建会话失败，请重试')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-between px-6 py-14">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        <div className="text-center space-y-4 animate-fade-in-slow">
          <h1 className="text-[2rem] font-light tracking-[0.2em] text-text-primary">
            COSMO
          </h1>
          <p className="text-base text-text-muted">
            一次关于你近期状态的对话
          </p>
        </div>

        <div className="flex gap-10 mt-16 mb-14 animate-fade-in-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
          <Icon label="安全保密">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#A3B5A0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3.5L4.5 7.5v7.5c0 5.5 4.1 10.2 9.5 11 5.4-.8 9.5-5.5 9.5-11v-7.5L14 3.5z" />
              <path d="M10.5 14l2.5 2.5 5-4.5" />
            </svg>
          </Icon>
          <Icon label="自然对话">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#A3B5A0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 18.3a8.3 8.3 0 1 0-15.9-3.5" />
              <path d="M21 18.3l3.5 3.5-1 4.5-4.5-1-3.8-3.8" />
              <path d="M10.5 12.3h7" />
              <path d="M10.5 15.8h4.5" />
            </svg>
          </Icon>
          <Icon label="了解自己">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#A3B5A0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="14" cy="14" r="3.5" />
              <path d="M5.5 14c2-5.5 5-8.5 8.5-8.5s6.5 3 8.5 8.5c-2 5.5-5 8.5-8.5 8.5s-6.5-3-8.5-8.5z" />
            </svg>
          </Icon>
        </div>

        <div className="w-full space-y-3 text-sm leading-relaxed text-text-muted animate-fade-in-up" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
          <p>我会和你聊聊最近的感受，帮你梳理这段时间的状态。</p>
          <p>对话结束后，你会收到一份属于你的报告——不是分数，不是标签，而是基于你说的话整理的分析和建议。</p>
          <p className="text-xs text-text-subtle pt-1">你的对话内容仅用于生成本次报告，不会被用于其他用途。</p>
        </div>
      </div>

      <div className="w-full max-w-sm space-y-4 animate-fade-in-up" style={{ animationDelay: '600ms', animationFillMode: 'both' }}>
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full rounded-full py-3.5 text-base font-light tracking-[0.05em] text-text-primary bg-white/70 border border-[#E5E5DF] hover:bg-white/85 hover:border-accent/40 transition-all duration-500 ease-out disabled:opacity-40"
        >
          {loading ? '正在准备…' : '开始对话'}
        </button>
        {error && (
          <p className="text-xs text-center text-accent2">{error}</p>
        )}
        <p className="text-[11px] text-center text-text-subtle">
          大约 8–10 分钟 · 没有对错 · 想到什么说什么
        </p>
      </div>
    </main>
  )
}
