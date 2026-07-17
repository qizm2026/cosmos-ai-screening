/**
 * 后处理过滤层 — 对 AI 回复做安全兜底
 *
 * 提示词层面的精简可能会让 AI 偶尔产出违禁表述。
 * 此模块在服务端对 AI 回复做最后一层过滤，不依赖提示词。
 *
 * 注意：高风险意图确认阶段（riskConfirming）跳过过滤，以免干扰危机干预。
 */

// === 禁止模式定义 ===

interface FilterRule {
  name: string
  pattern: RegExp
}

const FORBIDDEN_PATTERNS: FilterRule[] = [
  // 评价性承接（通用模式——匹配任何评判好坏的说法）
  { name: '评价-那挺好的', pattern: /那挺好的/ },
  { name: '评价-挺好的', pattern: /挺好的[。！，\s]/ },
  { name: '评价-还不错', pattern: /状态?还不错/ },
  { name: '评价-状态挺稳', pattern: /状态挺稳/ },
  { name: '评价-各方面都挺', pattern: /各方面都挺/ },
  { name: '评价-没什么问题', pattern: /听起来没什么问题/ },
  { name: '评价-整体平稳', pattern: /整体来看.{0,5}平稳/ },
  { name: '评价-挺难得', pattern: /挺难得的/ },
  { name: '评价-挺不错', pattern: /挺不错的/ },
  { name: '评价-状态还不错', pattern: /状态还不错/ },
  { name: '评价-大部分时间状态', pattern: /大部分时间状态/ },
  { name: '评价-能自己调整', pattern: /能自己调整过来就挺不错的/ },
  { name: '评价-感觉你', pattern: /听你这么说.{0,5}感觉你/ },

  // 评价性承接（通用结构模式，覆盖组合变体）
  { name: '评价-那就好', pattern: /那就好[。！，]?/ },
  { name: '评价-那听起来评价', pattern: /那听起来.{0,10}(不错|平稳|稳定|还可以|挺好的|没什么|状态.{0,4}平稳)/ },
  { name: '评价-感觉状态评价', pattern: /感觉.{0,5}(状态|情况).{0,5}(不错|挺好|还行|平稳|稳定)/ },
  { name: '评价-明白了承接评价', pattern: /明白了[。，]?\s*(那|这|所以|看来)/ },
  { name: '评价-好的承接评价', pattern: /好的[。，]?\s*(那|这|所以|看来|明白了)/ },
  { name: '评价-整体状态评价', pattern: /整体.{0,5}(状态|情况|感觉).{0,5}(不错|挺好|还行|平稳|挺稳)/ },

  // 显式话题切换
  { name: '显式话题切换-换个话题', pattern: /换个话题/ },
  { name: '显式话题切换-那我们聊聊', pattern: /那我们聊聊/ },
  { name: '显式话题切换-接下来聊聊', pattern: /接下来聊聊/ },
  { name: '显式话题切换-最后想问问', pattern: /最后想问问/ },
  { name: '显式话题切换-好的那我们', pattern: /好的那我们聊聊/ },
  { name: '显式话题切换-那谈谈', pattern: /那谈谈/ },

  // 诊断/病理化词汇
  { name: '病理化词汇-抑郁', pattern: /抑郁/ },
  { name: '病理化词汇-焦虑', pattern: /焦虑/ },
  { name: '病理化词汇-障碍', pattern: /障碍/ },
  { name: '病理化词汇-症状', pattern: /症状/ },
  { name: '病理化词汇-诊断', pattern: /诊断/ },

  // 分析口吻
  { name: '分析口吻-听起来挺中性的', pattern: /听起来挺中性的/ },
  { name: '分析口吻-表述不够具体', pattern: /你的表述不够具体/ },
  { name: '分析口吻-回答比较模糊', pattern: /这个回答比较模糊/ },

  // 因果推断前缀
  { name: '因果推断-可能是因为', pattern: /可能是因为/ },
  { name: '因果推断-这说明', pattern: /这说明/ },

  // 评估感受
  { name: '评估感受-我记下了', pattern: /我记下了/ },
  { name: '评估感受-清楚了', pattern: /清楚了/ },
  { name: '评估感受-睡眠这块看来', pattern: /睡眠这块看来没什么困扰/ },
  { name: '评估感受-整体状态', pattern: /最近整体状态都挺平稳/ },

  // 任务化表述
  { name: '任务化-先聊到这儿', pattern: /先聊到这儿/ },
  { name: '任务化-先说到这里', pattern: /先说到这里/ },
  { name: '任务化-大概了解了', pattern: /大概了解了/ },
]

// 安全兜底文案
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

  // 按句子拆分
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
