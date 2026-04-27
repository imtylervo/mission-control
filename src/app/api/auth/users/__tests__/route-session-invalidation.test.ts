/**
 * Phase 2.1 / PR #23 — admin user-management route guards.
 *
 * Two invariants this test pins:
 *
 *   A. Admin password reset on PUT /api/auth/users invalidates the target
 *      user's existing sessions. Without this, a previous-password cookie
 *      stolen via XSS or shoulder-surf stays valid after rotation.
 *
 *   B. DELETE /api/auth/users accepts the user id from the query string
 *      (`?id=NN`) as well as the JSON body. The existing UI sends the id
 *      via the query string; older API clients sent it via the body.
 *      Either form is accepted to remove the mismatch silently observed
 *      during Phase 2.1 audit.
 *
 * The tests stub @/lib/auth and @/lib/db so we don't need a real SQLite
 * file — only the contract between the route and these dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const baseUser = {
  id: 1,
  username: 'admin',
  display_name: 'admin',
  role: 'admin' as const,
  provider: 'local',
  email: null,
  avatar_url: null,
  is_approved: 1 as const,
  workspace_id: 1,
  tenant_id: 1,
}

const targetUser = {
  ...baseUser,
  id: 42,
  username: 'opal',
  display_name: 'opal',
  role: 'operator' as const,
}

// vi.mock factories are hoisted ABOVE const declarations, so the mocks
// they reference must come from vi.hoisted() to be available at hoist time.
const mocks = vi.hoisted(() => ({
  updateUser: vi.fn() as any,
  deleteUser: vi.fn() as any,
  destroyAllUserSessions: vi.fn() as any,
  getUserById: vi.fn() as any,
  getUserFromRequest: vi.fn() as any,
  requireRole: vi.fn() as any,
  logAuditEvent: vi.fn() as any,
}))

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: mocks.getUserFromRequest,
  getAllUsers: vi.fn(() => []),
  createUser: vi.fn(),
  updateUser: mocks.updateUser,
  deleteUser: mocks.deleteUser,
  destroyAllUserSessions: mocks.destroyAllUserSessions,
  getUserById: mocks.getUserById,
  requireRole: mocks.requireRole,
}))

vi.mock('@/lib/db', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  createUserSchema: {},
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { PUT, DELETE } from '../route'

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserFromRequest.mockReturnValue(baseUser)
})

describe('PUT /api/auth/users — password change invalidates target sessions', () => {
  it('calls destroyAllUserSessions when the admin sets a new password', async () => {
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.updateUser.mockReturnValue({ ...targetUser })

    const req = makeRequest('http://test/api/auth/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUser.id, password: 'new-very-long-password' }),
    })
    const res = await PUT(req as any)
    expect(res.status).toBe(200)

    expect(mocks.updateUser).toHaveBeenCalledOnce()
    expect(mocks.updateUser.mock.calls[0][1].password).toBe('new-very-long-password')

    // The session-invalidation call is the heart of the fix.
    expect(mocks.destroyAllUserSessions).toHaveBeenCalledOnce()
    expect(mocks.destroyAllUserSessions).toHaveBeenCalledWith(targetUser.id)
  })

  it('does NOT call destroyAllUserSessions when only display_name/role/email change', async () => {
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.updateUser.mockReturnValue({ ...targetUser, display_name: 'new name' })

    const req = makeRequest('http://test/api/auth/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUser.id, display_name: 'new name' }),
    })
    const res = await PUT(req as any)
    expect(res.status).toBe(200)

    expect(mocks.destroyAllUserSessions).not.toHaveBeenCalled()
  })

  it('does NOT call destroyAllUserSessions when password is the empty string (no-op)', async () => {
    // The route normalises `password: ''` to `undefined` before passing to
    // updateUser, so no actual password change occurs. Session
    // invalidation must follow the same gate.
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.updateUser.mockReturnValue({ ...targetUser })

    const req = makeRequest('http://test/api/auth/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUser.id, password: '' }),
    })
    const res = await PUT(req as any)
    expect(res.status).toBe(200)

    expect(mocks.destroyAllUserSessions).not.toHaveBeenCalled()
  })

  it('audit event records sessions_invalidated:1 when password changes', async () => {
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.updateUser.mockReturnValue({ ...targetUser })

    const req = makeRequest('http://test/api/auth/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUser.id, password: 'rotated' }),
    })
    await PUT(req as any)

    expect(mocks.logAuditEvent).toHaveBeenCalledOnce()
    const evt = mocks.logAuditEvent.mock.calls[0][0]
    expect(evt.action).toBe('user_update')
    expect(evt.detail.password_changed).toBe(true)
    expect(evt.detail.sessions_invalidated).toBe(1)
  })
})

describe('DELETE /api/auth/users — accepts query string OR body', () => {
  it('accepts ?id=NN in the query string', async () => {
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.deleteUser.mockReturnValue(true)

    const req = makeRequest(`http://test/api/auth/users?id=${targetUser.id}`, { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    expect(mocks.deleteUser).toHaveBeenCalledWith(targetUser.id)
  })

  it('accepts {id} in the JSON body', async () => {
    mocks.getUserById.mockReturnValue({ ...targetUser })
    mocks.deleteUser.mockReturnValue(true)

    const req = makeRequest('http://test/api/auth/users', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUser.id }),
    })
    const res = await DELETE(req as any)
    expect(res.status).toBe(200)
    expect(mocks.deleteUser).toHaveBeenCalledWith(targetUser.id)
  })

  it('returns 400 when neither query nor body provides id', async () => {
    const req = makeRequest('http://test/api/auth/users', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('rejects deleting your own account regardless of input shape', async () => {
    const req = makeRequest(`http://test/api/auth/users?id=${baseUser.id}`, { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('returns 400 when id is non-numeric (e.g. "abc")', async () => {
    const req = makeRequest('http://test/api/auth/users?id=abc', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('returns 400 when id is partial-numeric (e.g. "42abc") — strict Number() parse', async () => {
    // parseInt("42abc") would silently accept the leading 42 and target a
    // different user. Number("42abc") is NaN; the strict integer check
    // rejects it cleanly.
    const req = makeRequest('http://test/api/auth/users?id=42abc', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it('returns 400 when id is zero or negative', async () => {
    const req = makeRequest('http://test/api/auth/users?id=0', { method: 'DELETE' })
    const res = await DELETE(req as any)
    expect(res.status).toBe(400)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
})
