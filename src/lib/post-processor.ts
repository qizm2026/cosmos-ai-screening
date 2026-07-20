/**
 * 后处理过滤层 — 对 AI 回复做安全兜底
 *
 * 作为最后一道防线，过滤 AI 偶尔产出的违禁表述。
 * 不依赖提示词，覆盖提示词已约束但模型仍可能犯的硬底线。
 *
 * 原则：
 * 1. 只保留硬底线（病理化词汇），风格类约束由 Prompt 覆盖
 * 2. 规则精简优先，避免"越禁止越出现"的白熊效应
 * 3. 高风险意图确认阶段跳过过滤，以免干扰危机干预
 */

// === 禁止模式定义 ===

interface FilterRule {
  name: string
  pattern: RegExp
}

const FORBIDDEN_PATTERNS: FilterRule[] = [
  // 病理化词汇（硬底线——不得出现在任何回复中）
  { name: '病理化-抑郁', pattern: /抑郁/ },
  { name: '病理化-焦虑', pattern: /焦虑/ },
  { name: '病理化-障碍', pattern: /障碍/ },
  { name: '病理化-症状', pattern: /症状/ },
  { name: '病理化-诊断', pattern: /诊断/ },
]

// 安全兜底文案（仅在所有句子都被过滤后使用）
const SAFE_FALLBACK = '嗯，慢慢来，想到什么就说什么就好。'

export type PostProcessResult = {
  filtered: boolean
  cleanedText: string
  hits: string[]
}

/**
 * 对 AI 回复做后处理过滤
 * @param text AI 原始回复（已去除控制标记）
 * @param skipFilter 是否跳过过滤（高风险确认阶段为 true）
 */
export function postProcessReply(text: string, skipFilter = false): PostProcessResult {
  if (skipFilter) {
    return { filtered: false, cleanedText: text, hits: [] }
  }

  const hits: string[] = []

  // 按句子拆分，逐句过滤
  const sentences = text.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(s => s.length > 0)
  const cleanSentences: string[] = []

  for (const sentence of sentences) {
    let shouldRemove = false
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(sentence)) {
        hits.push(`[${rule.name}] in "${sentence.slice(0, 40)}${sentence.length > 40 ? '...' : ''}"`)
        shouldRemove = true
        break
      }
    }
    if (!shouldRemove) {
      cleanSentences.push(sentence)
    }
  }

  if (hits.length > 0) {
    console.log(`[COSMO post-process] filtered ${hits.length} sentence(s):`)
    hits.forEach(h => console.log(`  ${h}`))
  }

  const cleanedText = cleanSentences.join('').trim()
  const filtered = hits.length > 0

  if (filtered && !cleanedText) {
    // 全部被过滤，使用安全兜底
    console.log('[COSMO post-process] all sentences filtered, using safe fallback')
    return { filtered: true, cleanedText: SAFE_FALLBACK, hits }
  }

  return { filtered, cleanedText, hits }
}
