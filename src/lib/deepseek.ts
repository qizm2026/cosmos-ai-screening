import OpenAI from 'openai'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export class JsonParseError extends Error {
  rawContent: string
  constructor(message: string, rawContent: string) {
    super(message)
    this.name = 'JsonParseError'
    this.rawContent = rawContent
  }
}

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not set in environment variables')
    }
    client = new OpenAI({
      apiKey,
      baseURL: DEEPSEEK_BASE_URL,
    })
  }
  return client
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatCompletionOptions = {
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  model?: string
  useThinking?: boolean
  responseFormat?: 'json_object'
}

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_TOKENS = 2048

const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-v4-pro'
const EVAL_MODEL = process.env.DEEPSEEK_EVAL_MODEL || 'deepseek-v4-pro'

export { CHAT_MODEL, EVAL_MODEL }

const THINKING_EXTRA = {
  thinking: { type: 'enabled' as const },
  reasoning_effort: 'high' as const,
}

export async function textCompletion(options: ChatCompletionOptions): Promise<string> {
  const openai = getClient()

  const extraBody = options.useThinking !== false ? THINKING_EXTRA : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: options.model ?? CHAT_MODEL,
    messages: options.messages,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
  }
  if (extraBody) {
    params.extra_body = extraBody
  }

  const response = await openai.chat.completions.create(params)
  const content = (response.choices[0]?.message?.content ?? '').trim()

  return content
}

const JSON_HINT = `你的每一次回复必须是且仅是一个合法的 JSON 对象。
第一个字符是 {，最后一个字符是 }。
不要输出任何 markdown 代码块、解释性文字、或 JSON 以外的任何内容。
不要在 JSON 前后加任何文字。

`

export async function jsonCompletion<T>(options: ChatCompletionOptions): Promise<T> {
  const openai = getClient()

  const messages = options.messages.map((m) => {
    if (m.role === 'system') {
      return { ...m, content: JSON_HINT + m.content }
    }
    return m
  })

  const extraBody = options.useThinking !== false ? THINKING_EXTRA : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: options.model ?? CHAT_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
  }
  if (options.responseFormat === 'json_object') {
    params.response_format = { type: 'json_object' }
  }
  if (extraBody) {
    params.extra_body = extraBody
  }

  const response = await openai.chat.completions.create(params)

  const usage = response.usage
  console.log(`[DeepSeek jsonCompletion] model=${options.model ?? CHAT_MODEL}, tokens: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}, total=${usage?.total_tokens}`)

  const content = response.choices[0]?.message?.content ?? '{}'

  const attempt = (raw: string): T => {
    try {
      return JSON.parse(raw) as T
    } catch {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      try {
        return JSON.parse(cleaned) as T
      } catch {
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            return JSON.parse(match[0]) as T
          } catch {
            const fixed = match[0].replace(/,(\s*[}\]])/g, '$1')
            try {
              return JSON.parse(fixed) as T
            } catch {
              throw new JsonParseError(`JSON parse failed. Raw: ${raw.slice(0, 300)}`, raw)
            }
          }
        }
        throw new JsonParseError(`JSON parse failed (no braces). Raw: ${raw.slice(0, 300)}`, raw)
      }
    }
  }

  return attempt(content)
}

export function createStreamResponse(reply: string, meta: Record<string, unknown>): Response {
  const encoder = new TextEncoder()
  const metaJson = JSON.stringify(meta)

  const stream = new ReadableStream({
    async start(controller) {
      let i = 0
      while (i < reply.length) {
        const end = Math.min(i + 4, reply.length)
        controller.enqueue(encoder.encode(reply.slice(i, end)))
        i = end
        await new Promise((r) => setTimeout(r, 2))
      }
      controller.enqueue(encoder.encode('\n__META__\n' + metaJson))
      controller.close()
    },
  })

  return new Response(stream)
}

export function createRealStreamResponse(
  options: ChatCompletionOptions,
  onComplete: (fullText: string, enqueue: (text: string) => void) => Promise<Record<string, unknown>>
): Response {
  const encoder = new TextEncoder()
  const openai = getClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: options.model ?? CHAT_MODEL,
    messages: options.messages,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
  }
  if (options.useThinking !== false) {
    params.extra_body = THINKING_EXTRA
  }

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let buffer = ''

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await openai.chat.completions.create(params)

        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta?.content ?? ''
          if (!delta) continue

          fullText += delta
          buffer += delta

          if (buffer.length > 4) {
            const toSend = buffer.slice(0, -4)
            controller.enqueue(encoder.encode(toSend))
            buffer = buffer.slice(-4)
          }
        }

        // Send remaining buffer
        const remaining = buffer
        if (remaining) {
          controller.enqueue(encoder.encode(remaining))
        }

        const meta = await onComplete(fullText, (text: string) => {
          controller.enqueue(encoder.encode(text))
        })
        controller.enqueue(encoder.encode('\n__META__\n' + JSON.stringify(meta)))
      } catch (e) {
        console.error('[DeepSeek realStream] Error:', e)
        const meta = await onComplete(fullText || '', (text: string) => {
          controller.enqueue(encoder.encode(text))
        })
        controller.enqueue(encoder.encode('\n__META__\n' + JSON.stringify(meta)))
      }

      controller.close()
    },
  })

  return new Response(stream)
}
