'use client'

import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Message = { role: 'user' | 'assistant'; content: string }
type FallbackOption = { show_fallback: boolean; fallback_item: string | null; fallback_options: string[] }

const QUICK_REPLIES = ['让我想想', '不太确定', '好像有一点吧', '其实还好']

function ChatContent() {
  const router = useRouter()
  const params = useSearchParams()
  const sessionId = params.get('session_id') || ''

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fallback, setFallback] = useState<FallbackOption>({ show_fallback: false, fallback_item: null, fallback_options: [] })
  const [conversationDone, setConversationDone] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const initRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingText, scrollToBottom])

  const sendMessage = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    setError('')
    setStreamingText('')
    setFallback({ show_fallback: false, fallback_item: null, fallback_options: [] })

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '请求失败' }))
        throw new Error(errData.error || '服务异常，请重试')
      }

      // Check for JSON response (init + done session returns history)
      const contentType = res.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        const data = await res.json()
        if (data.messages && Array.isArray(data.messages)) {
          setMessages(data.messages.map((m: { role: string; content: string }) =>
            ({ role: m.role as 'user' | 'assistant', content: m.content })
          ))
        }
        if (data.phase === 'done' || data.is_done) {
          setConversationDone(true)
        }
        setLoading(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应')

      const decoder = new TextDecoder()
      let fullText = ''
      let meta: Record<string, unknown> = {}
      let readingMeta = false
      let metaBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const metaIndex = chunk.indexOf('\n__META__\n')
        if (metaIndex >= 0) {
          fullText += chunk.slice(0, metaIndex)
          readingMeta = true
          metaBuffer = chunk.slice(metaIndex + 10)
        } else if (readingMeta) {
          metaBuffer += chunk
        } else {
          fullText += chunk
          setStreamingText(fullText)
        }
      }

      if (metaBuffer.trim()) {
        try { meta = JSON.parse(metaBuffer.trim()) } catch { meta = {} }
      }

      const cleanReply = fullText.trim()
      if (cleanReply) {
        setMessages(prev => {
          const newMsgs = [...prev, { role: 'assistant' as const, content: cleanReply }]
          return newMsgs
        })
      }
      setStreamingText('')

      // 防御性处理：无论消息是否为空，is_done 都应该触发按钮
      if (meta.is_done) {
        setTimeout(() => setConversationDone(true), 100)
      }

      if (meta.show_fallback) {
        setFallback({ show_fallback: true, fallback_item: (meta.fallback_item as string) || null, fallback_options: (meta.fallback_options as string[]) || [] })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '服务异常，请重试')
    } finally {
      setLoading(false)
      setStreamingText('')
    }
  }, [])

  useEffect(() => {
    if (initRef.current || !sessionId) return
    initRef.current = true
    sendMessage({ session_id: sessionId, init: true })
  }, [sessionId, sendMessage])

  const handleSend = () => {
    if (!input.trim() || loading || conversationDone) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    sendMessage({ session_id: sessionId, user_message: text })
  }

  const handleQuickReply = (text: string) => {
    if (loading || conversationDone) return
    setMessages(prev => [...prev, { role: 'user', content: text }])
    sendMessage({ session_id: sessionId, user_message: text })
  }

  const handleFallbackSelect = (score: number) => {
    if (!fallback.fallback_item) return
    const optionText = fallback.fallback_options[score]
    setMessages(prev => [...prev, { role: 'user', content: optionText }])
    setFallback({ show_fallback: false, fallback_item: null, fallback_options: [] })
    sendMessage({ session_id: sessionId, fallback_item: fallback.fallback_item, fallback_score: score })
  }

  const handleViewReport = () => {
    router.push('/report?session_id=' + sessionId)
  }

  return (
    <main className="min-h-dvh flex flex-col max-w-2xl mx-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E2DE]/50">
        <span className="text-xs text-text-subtle tracking-wider">{conversationDone ? '对话结束' : '对话中'}</span>
        <button onClick={handleViewReport} className="text-xs text-accent tracking-wider hover:text-accent/80 transition-colors font-medium">
          查看报告
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hide">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user' ? 'bg-[#E8EEF2] text-text-primary rounded-br-md' : 'bg-[#F2F0ED] text-text-primary rounded-bl-md'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {streamingText && (
          <div className="flex justify-start animate-fade-in-up">
            <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[#F2F0ED] text-text-primary rounded-bl-md text-sm leading-relaxed">
              {streamingText}
            </div>
          </div>
        )}
        {loading && !streamingText && (
          <div className="flex justify-start">
            <div className="bg-[#F2F0ED] rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {fallback.show_fallback && (
          <div className="flex flex-col gap-2 animate-fade-in-up px-2">
            <p className="text-xs text-text-subtle mb-1">选一个最接近的——</p>
            {fallback.fallback_options.map((option, i) => (
              <button key={i} onClick={() => handleFallbackSelect(i)} className="w-full text-left px-4 py-2.5 rounded-xl border border-[#E5E2DE] bg-white/70 text-sm text-text-primary hover:bg-white hover:border-accent/40 transition-all duration-300">
                {option}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-center text-accent2">{error}</p>}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom area: either input or report button */}
      <div className="px-4 py-3 border-t border-[#E5E2DE]/50">
        {conversationDone ? (
          <button onClick={handleViewReport} className="w-full rounded-full py-3.5 text-base font-light tracking-[0.05em] text-white bg-accent hover:bg-accent/90 transition-all duration-500 ease-out shadow-sm animate-fade-in-up">
            查看报告
          </button>
        ) : (
          <>
            {!fallback.show_fallback && (
              <div className="flex gap-2 mb-2 overflow-x-auto scrollbar-hide">
                {QUICK_REPLIES.map((text) => (
                  <button key={text} onClick={() => handleQuickReply(text)} disabled={loading} className="flex-shrink-0 px-3 py-1.5 rounded-full border border-[#E5E2DE] text-xs text-text-muted hover:border-accent/40 hover:text-text-primary transition-all duration-300 disabled:opacity-40">
                    {text}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }} disabled={loading || fallback.show_fallback} placeholder="说说你的感受…" className="flex-1 rounded-2xl px-4 py-2.5 bg-white/70 border border-[#E5E2DE] text-sm text-text-primary placeholder:text-text-subtle focus:outline-none focus:border-accent/40 transition-all duration-300 disabled:opacity-40" />
              <button onClick={handleSend} disabled={loading || !input.trim() || fallback.show_fallback} className="rounded-2xl px-4 py-2.5 bg-accent text-white text-sm font-light tracking-wider hover:bg-accent/90 transition-all duration-300 disabled:opacity-40 flex-shrink-0">
                发送
              </button>
            </div>
          </>
        )}
      </div>

    </main>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh flex items-center justify-center px-6"><p className="text-sm text-text-muted animate-fade-in">正在准备对话…</p></main>}>
      <ChatContent />
    </Suspense>
  )
}
