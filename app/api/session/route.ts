import { NextResponse } from 'next/server'
import { createSession } from '@/lib/session-store'

export async function POST() {
  const sessionId = createSession()
  console.log('[COSMO session] Created:', sessionId)
  return NextResponse.json({ session_id: sessionId })
}
