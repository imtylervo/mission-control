/**
 * Phase 2.2 / PR #24 — gateway-origin diagnostic route.
 *
 * Pins six invariants the route must hold so a future refactor can't
 * regress the safety-critical bits (no raw allowlist values leaked,
 * non-browser callers handled, mismatch detection accurate):
 *
 *   1. Returns gateway_config_readable=false + actionable hint when the
 *      OpenClaw config is missing/unreadable.
 *   2. Reports has_localhost / has_127 / has_browser_origin booleans
 *      based on substring matching (case-insensitive).
 *   3. mismatch = false + "consistent" suggestion when the browser
 *      origin IS in the allowlist.
 *   4. mismatch = true + localhost-vs-127 specific suggestion when the
 *      allowlist has only one form and the browser is at the other.
 *   5. mismatch = null when no Origin header (non-browser caller).
 *   6. Response shape carries NO raw allowlist entries — only counts +
 *      booleans + the browser's own origin (already known to it).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn() as any,
  getGatewayAllowedOrigins: vi.fn() as any,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mocks.requireRole,
}))

vi.mock('@/lib/gateway-runtime', () => ({
  getGatewayAllowedOrigins: mocks.getGatewayAllowedOrigins,
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { GET } from '../route'

const viewer = {
  id: 1,
  username: 'viewer',
  display_name: 'viewer',
  role: 'viewer' as const,
  workspace_id: 1,
  tenant_id: 1,
}

function makeReq(origin: string | null): Request {
  const headers: Record<string, string> = {}
  if (origin) headers['origin'] = origin
  return new Request('http://test/api/diagnostics/gateway-origin', { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockReturnValue(viewer)
})

describe('GET /api/diagnostics/gateway-origin', () => {
  it('returns gateway_config_readable=false when getGatewayAllowedOrigins() is null', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue(null)
    const res = await GET(makeReq('http://localhost:3000') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gateway_config_readable).toBe(false)
    expect(body.allowed_origins_count).toBe(0)
    expect(body.has_localhost).toBe(false)
    expect(body.has_127).toBe(false)
    expect(body.has_browser_origin).toBe(false)
    expect(body.mismatch).toBeNull()
    expect(body.suggested_action).toMatch(/missing or unreadable/i)
  })

  it('reports consistent + mismatch=false when browser origin is in the allowlist', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue([
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ])
    const res = await GET(makeReq('http://localhost:3000') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gateway_config_readable).toBe(true)
    expect(body.has_localhost).toBe(true)
    expect(body.has_127).toBe(true)
    expect(body.has_browser_origin).toBe(true)
    expect(body.allowed_origins_count).toBe(2)
    expect(body.mismatch).toBe(false)
    expect(body.suggested_action).toMatch(/consistent/i)
  })

  it('detects localhost-only allowlist when browser is at 127.0.0.1', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue(['http://localhost:3000'])
    const res = await GET(makeReq('http://127.0.0.1:3000') as any)
    const body = await res.json()
    expect(body.has_localhost).toBe(true)
    expect(body.has_127).toBe(false)
    expect(body.has_browser_origin).toBe(false)
    expect(body.mismatch).toBe(true)
    expect(body.suggested_action).toMatch(/Browser is at 127\.0\.0\.1 but gateway allowlist only contains a localhost form/)
  })

  it('detects 127.0.0.1-only allowlist when browser is at localhost (the typical Phase 2.2 symptom)', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue(['http://127.0.0.1:3000'])
    const res = await GET(makeReq('http://localhost:3000') as any)
    const body = await res.json()
    expect(body.has_127).toBe(true)
    expect(body.has_localhost).toBe(false)
    expect(body.has_browser_origin).toBe(false)
    expect(body.mismatch).toBe(true)
    expect(body.suggested_action).toMatch(/Browser is at localhost but gateway allowlist only contains a 127\.0\.0\.1 form/)
  })

  it('handles "no Origin header" (non-browser caller) with mismatch=null', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue(['http://localhost:3000'])
    const res = await GET(makeReq(null) as any)
    const body = await res.json()
    expect(body.browser_origin).toBeNull()
    expect(body.mismatch).toBeNull()
    expect(body.suggested_action).toMatch(/non-browser client/i)
  })

  it('does NOT echo raw allowlist entries in the response (privacy invariant)', async () => {
    const sensitive = ['http://10.0.7.42:3000', 'https://internal.tailnet.ts.net:3000']
    mocks.getGatewayAllowedOrigins.mockReturnValue(sensitive)
    const res = await GET(makeReq('http://10.0.7.42:3000') as any)
    const body = await res.json()
    const serialized = JSON.stringify(body)

    // The browser's own origin is allowed to appear (already known to it).
    // Any other allowlist entry must NOT leak.
    expect(serialized).not.toContain('internal.tailnet')
    expect(serialized).not.toContain('10.0.7.42:3001')  // unrelated port not present
    // The list itself is exposed only as a count.
    expect(body.allowed_origins_count).toBe(2)
  })

  it('honours requireRole — returns auth.error when viewer role is not satisfied', async () => {
    mocks.requireRole.mockReturnValueOnce({ error: 'Authentication required', status: 401 })
    const res = await GET(makeReq('http://localhost:3000') as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Authentication required')
    // requireRole error path must short-circuit before reading the gateway config.
    expect(mocks.getGatewayAllowedOrigins).not.toHaveBeenCalled()
  })

  it('matches origins case-insensitively (e.g. "Localhost" still trips has_localhost)', async () => {
    mocks.getGatewayAllowedOrigins.mockReturnValue(['HTTP://Localhost:3000'])
    const res = await GET(makeReq('http://localhost:3000') as any)
    const body = await res.json()
    expect(body.has_localhost).toBe(true)
  })
})
