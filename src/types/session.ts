export type ItemId = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9'

export type CoverageStatus = 'pending' | 'answered' | 'fallback'

export type ItemCoverage = Record<ItemId, CoverageStatus>

export type AnswerQuality = 'sufficient' | 'partial' | 'insufficient'

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
  soft_fallback_active: boolean
  skip_soft_fallback: boolean
  consecutive_direct_fallbacks: number
  session_started_at: number  // PRD §4.4: 15分钟时间控制的起始时间戳
  /** 每个条目的回答质量记录，标记对话中获得的信息充分度 */
  item_answer_quality: Partial<Record<ItemId, AnswerQuality>>
  /** 连续低把握(confidenceScore<=1)条目计数，实现PRD §4.6连续跳过规则 */
  consecutive_low_confidence: number
  /** 当前条目对话回答的把握度分数 (0-5)，0=完全模糊 3+=充分 */
  current_confidence_score: number
}

export type RiskLevel = 'minimal' | 'mild' | 'moderate' | 'severe'

export type ItemScore = {
  item_id: ItemId
  score: number
  justification: string
  is_fallback: boolean
  /** 标记该条目在对话中获取的信息是否不足（供教师报告参考） */
  answer_insufficient?: boolean
}

export type ScoreResult = {
  item_scores: ItemScore[]
  total_score: number
  risk_level: RiskLevel
  q9_nonzero: boolean
  /** 信息不足但已覆盖的条目列表（供教师报告参考） */
  insufficient_items?: ItemId[]
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
