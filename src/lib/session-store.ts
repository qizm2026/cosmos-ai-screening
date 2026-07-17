import type { SessionState, ItemCoverage } from '@/types/session'

declare global {
  var __cosmo_sessions: Map<string, SessionState> | undefined
}

function getStore(): Map<string, SessionState> {
  if (!globalThis.__cosmo_sessions) {
    globalThis.__cosmo_sessions = new Map()
  }
  return globalThis.__cosmo_sessions
}

function generateId(): string {
  return `cosmo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createInitialCoverage(): ItemCoverage {
  return {
    Q1: 'pending',
    Q2: 'pending',
    Q3: 'pending',
    Q4: 'pending',
    Q5: 'pending',
    Q6: 'pending',
    Q7: 'pending',
    Q8: 'pending',
    Q9: 'pending',
  }
}

export function createSession(): string {
  const id = generateId()
  const store = getStore()
  store.set(id, {
    phase: 'icebreak',
    round: 0,
    coverage: createInitialCoverage(),
    fallback_scores: {},
    messages: [],
    last_coverage_update: null,
    current_item_index: 0,
    item_rounds: 0,
    risk_status: { detected: false, type: null, intervened: false, intervention_text: null, confirming: false, soothing_rounds: 0 },
    asked_questions: [],
    user_context: {
      occupation: null,
      age: null,
      hobbies: [],
      mentioned_symptoms: [],
      notes: [],
    },
    follow_up_count: 0,
    soft_fallback_active: false,
    skip_soft_fallback: false,
    consecutive_direct_fallbacks: 0,
    session_started_at: Date.now(),
  })
  return id
}

export function getSession(id: string): SessionState | undefined {
  return getStore().get(id)
}

export function updateSession(id: string, partial: Partial<SessionState>): SessionState | undefined {
  const store = getStore()
  const existing = store.get(id)
  if (!existing) return undefined

  const updated: SessionState = {
    ...existing,
    ...partial,
  }
  store.set(id, updated)
  return updated
}
