import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getGatewayAllowedOrigins } from '@/lib/gateway-runtime'
import { logger } from '@/lib/logger'

/**
 * GET /api/diagnostics/gateway-origin
 *
 * Phase 2.2 / PR #24 — gateway origin diagnostic.
 *
 * Mission Control's UI shows "GW Offline" whenever the WebSocket connect
 * frame is rejected, which conflates several causes. The most common one
 * (per Phase 2.2 audit) is a localhost ↔ 127.0.0.1 origin mismatch with
 * the gateway's `controlUi.allowedOrigins` config: a browser at
 * `http://localhost:3000` cannot connect when the allowlist only has
 * `http://127.0.0.1:3000`, even though the gateway daemon is healthy.
 *
 * This route reads the browser's `Origin` header and the gateway's
 * configured allowlist, then returns a structured diagnostic that the UI
 * can surface as a specific actionable message instead of generic offline.
 *
 * SAFETY (Đào msg 1614): we do NOT echo raw allowlist entries back to the
 * client — operators may consider their gateway hostnames or Tailscale
 * MagicDNS names sensitive. The response carries only:
 *   - the browser's own origin (already known to the browser)
 *   - booleans (has_localhost / has_127 / has_browser_origin)
 *   - counts (allowed_origins_count)
 *   - a derived suggested_action string
 *
 * Auth: requires `viewer` role — anonymous traffic is not allowed.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const browserOrigin = request.headers.get('origin') || null

  let allowedOrigins: string[] | null
  try {
    allowedOrigins = getGatewayAllowedOrigins()
  } catch (err) {
    logger.warn({ err }, 'gateway-origin diagnostic: getGatewayAllowedOrigins threw')
    allowedOrigins = null
  }

  if (allowedOrigins === null) {
    return NextResponse.json({
      browser_origin: browserOrigin,
      gateway_config_readable: false,
      allowed_origins_count: 0,
      has_localhost: false,
      has_127: false,
      has_browser_origin: false,
      mismatch: null,
      suggested_action: (
        'Gateway config (~/.openclaw/openclaw.json) is missing or unreadable. ' +
        'If Mission Control should auto-register its origin, mount the file ' +
        'with write access or add the MC origin manually under ' +
        'gateway.controlUi.allowedOrigins.'
      ),
    })
  }

  // Allowed-origin scan — booleans only. We compare lower-cased substrings
  // so that "https://Localhost:3000" still matches `has_localhost` regardless
  // of capitalisation. Port differences are intentionally NOT folded out:
  // a gateway allowlist of `http://127.0.0.1:3000` does NOT cover a browser
  // that actually navigates to `http://127.0.0.1:3001`.
  const lower = allowedOrigins.map((o) => String(o).toLowerCase())
  const hasLocalhost = lower.some((o) => o.includes('://localhost'))
  const has127 = lower.some((o) => o.includes('://127.0.0.1'))
  const hasBrowserOrigin = browserOrigin
    ? lower.includes(browserOrigin.toLowerCase())
    : false

  const mismatch = browserOrigin ? !hasBrowserOrigin : null

  let suggested = 'Browser origin and gateway allowlist appear consistent.'
  if (mismatch === true) {
    if (hasLocalhost && !has127 && browserOrigin?.includes('://127.0.0.1')) {
      suggested = (
        'Browser is at 127.0.0.1 but gateway allowlist only contains a ' +
        'localhost form. Either open Mission Control via the localhost URL ' +
        'or add the 127.0.0.1 form to gateway.controlUi.allowedOrigins.'
      )
    } else if (has127 && !hasLocalhost && browserOrigin?.includes('://localhost')) {
      suggested = (
        'Browser is at localhost but gateway allowlist only contains a ' +
        '127.0.0.1 form. Either open Mission Control via the 127.0.0.1 URL ' +
        'or add the localhost form to gateway.controlUi.allowedOrigins.'
      )
    } else {
      suggested = (
        'Browser origin is not in the gateway allowlist. Add the browser origin ' +
        'to gateway.controlUi.allowedOrigins (or open Mission Control via an ' +
        'origin that is already on the list).'
      )
    }
  } else if (mismatch === null) {
    suggested = (
      'No Origin header on the request — diagnostic was likely called from a ' +
      'non-browser client. Re-run from the dashboard to get a browser-side ' +
      'comparison.'
    )
  }

  return NextResponse.json({
    browser_origin: browserOrigin,
    gateway_config_readable: true,
    allowed_origins_count: allowedOrigins.length,
    has_localhost: hasLocalhost,
    has_127: has127,
    has_browser_origin: hasBrowserOrigin,
    mismatch,
    suggested_action: suggested,
  })
}
