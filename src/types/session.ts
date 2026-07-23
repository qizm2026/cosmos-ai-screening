export type ItemId = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9'

export type CoverageStatus = 'pending' | 'answered' | 'fallback'

export type ItemCoverage = Record<ItemId, CoverageStatus>

export type AnswerQuality = 'sufficient' | 'partial' | 'insufficient' | 'fallback'

export type Phase = 'icebreak' | 'interview' | 'done'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export type FallbackScores = Partial<Record<ItemId, number>>

export type RiskStatus = {
  detected: boolean
  type: 'self_harm' | 'suicide_ideation' | 'extreme_despair' | null
  intervened: boolean
  confirming: boolean
  intervention_text: string | null
  soothing_rounds: number  // 缓和轮次计数: 0=不需要缓和, >0=剩余缓和轮次
}

export type UserContext = {
  occupation: string | null
  age: string | null
  hobbies: string[]
  mentioned_symptoms: string[]
  notes: string[]
}

export type SessionState = {
  phase: Phase
  round: number
  coverage: ItemCoverage
  fallback_scores: FallbackScores
  messages: Message[]
  last_coverage_update: { item: ItemId; status: CoverageStatus } | null
  current_item_index: number
  item_rounds: number
  score_result?: ScoreResult
  report_result?: ReportResult
  risk_status: RiskStatus
  asked_questions: string[]
  user_context: UserContext
  follow_up_count: number
  session_started_at: number  // 时间控制的起始时间戳（12分钟提醒/15分钟强制收尾）
  /** 每个条目的回答质量记录，标记对话中获得的信息充分度 */
  item_answer_quality: Partial<Record<ItemId, AnswerQuality>>
  /** 当前条目对话回答的把握度分数 (0-5)，0=完全模糊 3+=充分，由代码层 detectAnswerVagueness 计算 */
  current_confidence_score: number
  /** Phase 2：当前条目的信息缺失维度，由 SYS 块 missing_dimensions 解析 */
  missing_dimensions: string[]
  /** Phase 3：已完成的条目摘要，用于后续条目的上下文感知 */
  item_summaries: ItemSummary[]
  /** Phase 1：对话中逐项初评分（SYS 块 item_score_guess），供全局校准阶段交叉校验 */
  item_scores_initial: Partial<Record<ItemId, number>>
  /** 对话停滞计数器：连续未推进覆盖的轮次数，覆盖推进时重置。用于检测道别循环等异常 */
  stall_rounds: number
}

/** Phase 3：条目完成时的结构化摘要 */
export type ItemSummary = {
  item_id: ItemId
  /** 2-3句简短摘要 */
  summary: string
  /** 五维信息标记（空字符串=未提及） */
  dimensions: {
    emotion: string
    frequency: string
    duration: string
    symptom: string
    impact: string
  }
  recorded_at: number
}

export type RiskLevel = 'minimal' | 'mild' | 'moderate' | 'severe'

export type ItemScore = {
  item_id: ItemId
  score: number
  justification: string
  is_fallback: boolean
  /** 标记该条目在对话中获取的信息是否不足（供教师报告参考） */
  answer_insufficient?: boolean
  /** Phase 1：对话中逐项初评分（0-3），供前端展示对比 */
  initial_score?: number
  /** Phase 1：全局校准说明（仅当全局校准阶段调整了初评分时填写） */
  calibration_note?: string
}

export type ScoreResult = {
  item_scores: ItemScore[]
  total_score: number
  risk_level: RiskLevel
  q9_nonzero: boolean
  /** 信息不足但已覆盖的条目列表（供教师报告参考） */
  insufficient_items?: ItemId[]
  /** Phase 1：全局校准摘要，如"1个条目初评分被调整：Q1 2→1" */
  calibration_summary?: string
}

export type ReportResult = {
  condensed_sentence: string
  status_analysis: string
  suggestions: ReportSuggestions
}

export type ReportSuggestions = {
  intro: string
  bullets: string[]
  footer: string | null
}
