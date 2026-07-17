import type { SessionState } from '@/types/session'
import { PHQ9 } from '@/lib/scales/phq9'

function buildFallbackScoresSection(fallbackScores: SessionState['fallback_scores']): string {
  const entries = Object.entries(fallbackScores) as [string, number][]
  if (entries.length === 0) return '无'
  return entries.map(([item, score]) => `${item}: ${score}`).join(', ')
}

function buildScoreAnchorsSection(): string {
  const lines: string[] = []
  for (const item of PHQ9.items) {
    const anchors = item.score_anchors
      .map((anchor, i) => `${i}=${anchor}`)
      .join(' / ')
    lines.push(`${item.id}：${anchors}`)
  }
  return lines.join('\n')
}

export function buildScoreSystemPrompt(session: SessionState): string {
  const sections: string[] = []

  sections.push(`你是 COSMO 的评分引擎。读取完整对话记录，对 PHQ-9 的 9 个条目逐一语义评分。

【兜底得分（直接使用，不参与语义判断）】
${buildFallbackScoresSection(session.fallback_scores)}`)

  sections.push(`【评分逻辑（逐条目四步判断）】
Step 1：是否存在异常？→ 否：0 分，结束
Step 2：是否达到最严重程度（3 分锚点）？→ 是：3 分，结束
Step 3：症状更接近 1 分还是 2 分描述？→ 给出 1 或 2 分
Step 4：输出分数 + 判断理由（内部使用）

【评分参考维度】
不只频率，综合判断：
- 频率：多少天出现、是否持续
- 强度：有点 vs 非常 vs 完全
- 影响范围：是否影响学习、社交、日常功能
- 自我觉察程度：描述越详细，往往越有意识存在
- 语气与语境：犹豫、轻描淡写可能低估；直接具体更可信

【各条目评分锚点】
${buildScoreAnchorsSection()}`)

  sections.push(`【Q9 特殊规则（硬编码）】
Q9 任何非零得分 → risk_level 强制为 severe，q9_nonzero 为 true。此规则在 API 层硬编码覆盖，不依赖模型输出。`)

  sections.push(`【输出格式】
严格返回 JSON：
{
  "scores": {
    "Q1": { "score": 0, "reason": "判断理由", "is_fallback": false },
    ...
    "Q9": { "score": 0, "reason": "判断理由", "is_fallback": false }
  },
  "total": 7,
  "risk_level": "mild",
  "q9_nonzero": false
}

risk_level 阈值：0-4=minimal / 5-9=mild / 10-14=moderate / 15-27=severe`)

  return sections.join('\n\n')
}
