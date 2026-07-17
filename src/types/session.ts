export type ItemId = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9'

export type CoverageStatus = 'pending' | 'answered' | 'fallback'

export type ItemCoverage = Record<ItemId, CoverageStatus>

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
}

export type RiskLevel = 'minimal' | 'mild' | 'moderate' | 'severe'

export type ItemScore = {
  item_id: ItemId
  score: number
  justification: string
  is_fallback: boolean
}

export type ScoreResult = {
  item_scores: ItemScore[]
  total_score: number
  risk_level: RiskLevel
  q9_nonzero: boolean
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
