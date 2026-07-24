import type { SessionState } from '@/types/session'
import { PHQ9 } from '@/lib/scales/phq9'

function buildFallbackScoresSection(fallbackScores: SessionState['fallback_scores']): string {
  const entries = Object.entries(fallbackScores) as [string, number][]
  if (entries.length === 0) return '无'
  return entries.map(([item, score]) => `${item}: ${score}`).join(', ')
}

function buildAnswerQualitySection(session: SessionState): string {
  const qualityMap = session.item_answer_quality ?? {}

  const insufficientOnly = Object.entries(qualityMap)
    .filter(([, q]) => q === 'insufficient')
    .map(([id]) => id)

  const partialItems = Object.entries(qualityMap)
    .filter(([, q]) => q === 'partial')
    .map(([id]) => id)

  const allInsufficient = [...insufficientOnly, ...partialItems]
  if (allInsufficient.length === 0) return ''

  let section = `
【对话质量标记】
以下条目的对话获取的信息可能不充分，评分时需特别注意：`

  if (insufficientOnly.length > 0) {
    section += `
- 信息明显不足（需格外谨慎评分）：${insufficientOnly.join('、')}`
  }
  if (partialItems.length > 0) {
    section += `
- 信息部分充分（有线索但不够完整）：${partialItems.join('、')}`
  }

  section += `

对于信息不足的条目：
- 如果对话中完全没有提及该维度的任何信息 → 给 0 分，在 reason 中注明"对话信息不足，无法判断"
- 如果对话中有微弱线索但不足以判断严重程度 → 给 0 分，在 reason 中注明"对话信息不足"
- 不要因为"学生没提=没问题"而默认给低分——只根据实际有的信息判断
- 不要从模糊的回答中过度推断——宁可保守评分，也不要高估严重程度
`
  return section
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

function buildInitialScoresSection(session: SessionState): string {
  const initial = session.item_scores_initial ?? {}
  const entries = Object.entries(initial) as [string, number][]
  if (entries.length === 0) return ''

  const itemLabels: Record<string, string> = {
    Q1: '兴趣与动力', Q2: '情绪状态', Q3: '睡眠状况',
    Q4: '精力与疲劳', Q5: '食欲变化', Q6: '自我感觉',
    Q7: '注意力', Q8: '行为节奏', Q9: '自伤意念',
  }

  return `
【对话中逐项初评分（仅供参考，不可直接用作最终分数）】
以下分数是对话过程中 AI 对每个条目的即时推测——仅基于该条目的单段对话，未考虑条目间的交叉信息。
你在逐项复核时可以参考，但如果全局校准发现矛盾（详见第二阶段指令），请以全局判断为准覆盖初评分。

${entries.map(([item, score]) => `${item}（${itemLabels[item] || item}）: ${score} 分`).join('\n')}
`
}

export function buildScoreSystemPrompt(session: SessionState): string {
  const sections: string[] = []

  sections.push(`你是 COSMO 的评分引擎。读取完整对话记录，对 PHQ-9 的 9 个条目逐一语义评分。

【兜底得分（直接使用，不参与语义判断）】
${buildFallbackScoresSection(session.fallback_scores)}`)

  // Phase 1：注入对话中逐项初评分（供交叉校验参考）
  const initialScoresBlock = buildInitialScoresSection(session)
  if (initialScoresBlock) {
    sections.push(initialScoresBlock)
  }

  sections.push(`【评分逻辑（两阶段：逐项复核 + 偏差释义，对标 AgentMental AGs→AGu）】

第一阶段 — 逐项复核（AGs 角色）
对每个条目逐一进行 PsyCoT 三步推理：

Step 1 — 症状锚定
从对话中提取该条目相关的具体事实，引用学生原话中的关键词句。
- 示例："学生提到'最近两周基本每天都睡不好，躺下去一个小时才能睡着'"
- 如果对话中完全没有该维度的有效信息 → 标记"症状信息缺失"，
  在 matched_anchor_index 填 0，reason 写"对话信息不足，默认 0 分"，跳过后续步骤

Step 2 — 严重度判断
综合以下维度判断症状严重程度：

【频率判断的严格规则 — 强制遵守】
过去两周内出现频率是锚点匹配的核心依据。必须根据学生原话中的时间限定词精确判断：

锚点0（完全没有）：
- 过去两周内完全未出现该症状，或学生明确否认

锚点1（有几天）：
- 频率词：偶尔、有时、有几天、一两次、不是每天都、不是每节都、不是每次都
- 语境界定：学生用"并非每天""不是每节""有时候"等限定词时——即使前面说了"经常"——说明频率未达半数，应匹配锚点1
- 情境性且已消退：症状有明确外部触发（考试、特定事件），且学生表示触发因素消失后症状已结束
- 临界判定：学生描述模糊但未给出具体天数时——宁低不高的原则，默认锚点1

锚点2（一半以上天数）：
- 频率词：经常（且未加限定词"并非每天"）、大多数日子、超过一半、一周三四天以上
- 必要条件：学生明确表示频率超过半数，或有"每天"+"但并非每天"以外的限定词抵消
- 注意：仅说"经常"但后续补充了"也不是每天"——不满足锚点2条件，应回锚点1

锚点3（几乎每天）：
- 频率词：几乎每天、每天、天天、差不多天天
- 必要条件：学生明确表示接近全时段存在，无明显限定词

- 强度：轻度/中度/重度？
- 影响范围：有没有影响到学习、社交、日常起居？

将判断结果用一两句话写入 severity_judgment 字段。severity_judgment 中必须包含"过去两周内有多少天"的具体判断。

【Q8 特殊规则：情境归因排除】
Q8（行动或说话速度变慢，或烦躁或坐立不安）是最容易误判的条目——学生描述的"变慢"往往来自学业压力、疲劳、性格内向，而非临床精神运动改变。评分时必须区分：

- 学生在对话中明确将行为减慢关联到学业压力/考试/作业量时 → 属于情境性反应，锚点0或1
- 锚点1仅限"本人有感觉、幅度轻微"，不应跳到锚点2
- 锚点2/3必要条件：无明确外部归因 + 他人（同学/家人/老师）也注意到 + 持续存在
- 注意：写作业慢（因为题难/不想做）≠ 精神运动迟缓；收拾东西慢（因为不着急/性格慢）≠ 精神运动迟缓

将判断结果用一两句话写入 severity_judgment 字段。

Step 3 — 锚点匹配
将 Step 2 的严重度判断与下方评分锚点对照，输出最匹配的锚点索引（0/1/2/3）。
- matched_anchor_index：从 0-3 中选择最匹配的锚点编号
- reason：说明为什么选这个锚点，综合 Step 1 的证据和 Step 2 的判断

第二阶段 — 偏差释义（AGu 角色）

第一阶段打出的正式分与你收到的初评分可能会出现不一致，这是正常的——
因为你有完整 9 条目上下文的全局视角，而初评分只基于单段对话。

你的任务：感知对话整体的情绪基调和状态氛围，然后逐条比对正式分与初评分。

步骤 1：感知整体基调
通读完整对话，从以下几个方面形成一个对学生的整体印象（不需要逐条写出，心里有数即可）：
- 情绪基调：对话中流露的情绪是偏正面还是偏负面？大部分话题下的语气是轻松、平淡、还是沉重？
- 表达能力：学生描述自己状态时，是具体详细还是模糊简略？
- 功能状态：整体来看，学生的日常生活（学习、社交、作息）受影响的程度大概在什么水平？
- 痛苦程度：学生主观感受到的困扰和痛苦，整体处于什么程度？

步骤 2：比对初评分
逐条检查正式分（matched_anchor_index）与初评分（上面给出的仅供参考分数）是否一致。
- 一致的条目（偏差 0 分）：calibration_note 留空 ""
- 偏差 1 分的条目：属于正常浮动，calibration_note 留空 ""
- 偏差 ≥ 2 分的条目：必须填写 calibration_note，解释为什么你的正式分与初评分差距这么大

步骤 3：写 calibration_note（仅偏差 ≥ 2 分时）
格式："正式分（X分）与初评分（Y分）偏离≥2分。从整体基调来看，[引用情绪基调/功能状态/跨条目矛盾的具体原因]，因此正式分更能反映该条目的真实情况。"
- 原因必须引用"整体情绪基调"或"跨条目矛盾"——不能是随口编的
- 示例："正式分（1分）与初评分（3分）偏离≥2分。从整体基调来看，对话中学生在其他8个条目均表现出积极的社交参与和正常的功能状态，整体情绪偏正面，初评3分缺乏足够的具体症状证据支撑。"
- 示例："正式分（2分）与初评分（0分）偏离≥2分。从整体基调来看，虽然该条目对话简短，但学生在后续话题中反复提及睡眠受影响的线索（如Q3提到熬夜、Q4提到白天很累），跨条目信息暗示该维度确实存在问题。"

重要原则：
- 正式分优先。你拥有更完整的信息，正式分的准确度理应高于初评分。
- calibration_note 的作用不是"修正分数"，而是"解释差异"——
  你的正式分本身就是最终答案，你只是向阅读报告的人解释为什么初评错了。
- 条目之间相互独立。不得因为"Q2 情绪很低所以 Q1 应该也低"这样的理由解释。
- 一个人可以睡不好但情绪还行，也可以情绪低落但不一定兴趣丧失。

【评分参考维度】
不只频率，综合判断：
- 频率：多少天出现、是否持续。注意语境限定词——"经常但并非每天""不是每天都""有时候""偶尔""不是每节都""不是每次都"→ 频率未达半数，应匹配锚点1
- 强度：有点 vs 非常 vs 完全
- 影响范围：是否影响学习、社交、日常功能
- 自我觉察程度：描述越详细，往往越有意识存在
- 语气与语境：犹豫、轻描淡写可能低估；直接具体更可信
- 情境性症状：症状有明确触发原因（如考试压力、特定事件）不等于0分——只要在过去两周内发生过、频率达到"有几天"，就应匹配锚点1
- "已恢复"≠"没发生过"：学生说"考完就恢复了""现在没事了""就那几天"，不代表该条目得0分——发生过就计分
- 锚点0 vs 锚点1：锚点0仅用于"过去两周内完全未出现该症状"。只要出现过≥1天（即使轻微、已恢复、有原因），就是锚点1
${buildAnswerQualitySection(session)}
【各条目评分锚点】
${buildScoreAnchorsSection()}`)

  sections.push(`【Q9 特殊规则（硬编码）】
Q9 任何非零得分 → risk_level 强制为 severe，q9_nonzero 为 true。此规则在 API 层硬编码覆盖，不依赖模型输出。`)

  sections.push(`【输出格式】
严格返回 JSON：
{
  "scores": {
    "Q1": {
      "score": 2,
      "matched_anchor_index": 2,
      "symptom_evidence": "学生提到最近两周基本每天都睡不好...",
      "severity_judgment": "频率接近每天，强度中等，已影响第二天状态",
      "reason": "匹配锚点2：睡眠问题较频繁，影响第二天状态",
      "calibration_note": "正式分（1分）与初评分（3分）偏离≥2分。从整体基调来看，对话中学生在其他8个条目均表现出积极的社交参与和正常的功能状态，整体情绪偏正面，初评3分缺乏足够的具体症状证据支撑。",
      "is_fallback": false
    },
    ...
  },
  "total": 7,
  "risk_level": "mild",
  "q9_nonzero": false,
  "calibration_summary": "1个条目正式分与初评分偏差≥2分：Q1 3→1"
}

calibration_note：正式分与初评分的偏差 ≥ 2 分时，必须填写释义。偏差 0-1 分时留空 ""。
  注意：不需要修正分数——正式分本身就是最终答案。calibration_note 只是解释为什么差异这么大。
calibration_summary：一句话汇总所有偏差释义的情况。无 ≥2 分偏差时写"正式分与初评分基本一致，无需释义"。
risk_level 阈值：0-4=minimal / 5-9=mild / 10-14=moderate / 15-27=severe`)

  return sections.join('\n\n')
}
