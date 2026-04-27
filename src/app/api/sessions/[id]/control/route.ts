import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callOpenClawGatewayWS } from '@/lib/openclaw-gateway-ws'
import { db_helpers } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { extractTelegramContextFromHeaders } from '@/lib/telegram-topic'

// Only allow alphanumeric, hyphens, and underscores in session IDs
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const { action } = await request.json()

    if (!SESSION_ID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      )
    }

    if (!['monitor', 'pause', 'terminate'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: monitor, pause, terminate' },
        { status: 400 }
      )
    }

    let result: unknown
    if (action === 'terminate') {
      // PR #13 / 1.3d: sessions_kill (CLI tool name) → sessions.abort (WS method, per Đào msg 1336).
      result = await callOpenClawGatewayWS('sessions.abort', { key: id }, { timeoutMs: 10_000 })
    } else {
      const message = action === 'monitor'
        ? { type: 'control', action: 'monitor' }
        : { type: 'control', action: 'pause' }
      result = await callOpenClawGatewayWS('sessions.send', { key: id, message }, { timeoutMs: 10_000 })
    }

    // Phase 5.3 — capture Telegram chat/topic context (IDs only) when the
    // request originated from the Telegram bot bridge. Headers absent →
    // tgCtx is null and the activity-log row is unchanged.
    const tgCtx = extractTelegramContextFromHeaders(request.headers)

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Session ${action}: ${id}`,
      tgCtx ? { session_key: id, action, ...tgCtx } : { session_key: id, action }
    )

    return NextResponse.json({
      success: true,
      action,
      session: id,
      result,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'Session control error')
    return NextResponse.json(
      { error: error.message || 'Session control failed' },
      { status: 500 }
    )
  }
}
