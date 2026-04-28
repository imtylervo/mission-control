import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getAdminPasswordHashMock = vi.fn<() => string | null>()

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: () => ({
      get: () => {
        const hash = getAdminPasswordHashMock()
        return hash ? { password_hash: hash } : undefined
      },
    }),
  }),
}))

import { hashPassword } from '../password'
import { checkAdminCredential } from '../admin-credential-check'

describe('checkAdminCredential — PR #23 contract: SQLite is source of truth post-seed', () => {
  beforeEach(() => {
    getAdminPasswordHashMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes when admin user has a strong hashed password (regardless of AUTH_PASS env)', () => {
    const strongHash = hashPassword('a-properly-strong-password-set-by-admin-2026')
    getAdminPasswordHashMock.mockReturnValue(strongHash)

    const result = checkAdminCredential({})
    expect(result.source).toBe('db')
    expect(result.status).toBe('pass')
    expect(result.detail).toMatch(/database/i)
  })

  it('passes when admin row exists with strong hash, even if AUTH_PASS env is missing', () => {
    const strongHash = hashPassword('another-strong-pass-9X-zk3hF')
    getAdminPasswordHashMock.mockReturnValue(strongHash)

    const result = checkAdminCredential({}) // empty env — historically would have failed
    expect(result.status).toBe('pass')
    expect(result.source).toBe('db')
  })

  it('passes when admin row exists with strong hash, even if AUTH_PASS env is a known insecure default', () => {
    const strongHash = hashPassword('rotated-by-admin-via-dashboard')
    getAdminPasswordHashMock.mockReturnValue(strongHash)

    // PR #23 contract: env value is no longer consulted once DB has admin user.
    const result = checkAdminCredential({ AUTH_PASS: 'admin' })
    expect(result.status).toBe('pass')
    expect(result.source).toBe('db')
  })

  it('fails when admin row exists but the hash matches a known insecure default (admin/admin)', () => {
    const insecureHash = hashPassword('admin')
    getAdminPasswordHashMock.mockReturnValue(insecureHash)

    const result = checkAdminCredential({ AUTH_PASS: 'an-otherwise-strong-env-value' })
    expect(result.source).toBe('db')
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/insecure default/i)
  })

  it('fails when admin row exists but the hash matches "change-me-on-first-login"', () => {
    const insecureHash = hashPassword('change-me-on-first-login')
    getAdminPasswordHashMock.mockReturnValue(insecureHash)

    const result = checkAdminCredential({})
    expect(result.status).toBe('fail')
  })

  it('falls back to AUTH_PASS env first-run-seed scenario when admin row does not exist', () => {
    getAdminPasswordHashMock.mockReturnValue(null)

    const result = checkAdminCredential({ AUTH_PASS: 'first-run-strong-password-x9k2' })
    expect(result.source).toBe('env')
    expect(result.status).toBe('pass')
  })

  it('warns about short AUTH_PASS env in first-run-seed scenario', () => {
    getAdminPasswordHashMock.mockReturnValue(null)

    const result = checkAdminCredential({ AUTH_PASS: 'short' })
    expect(result.source).toBe('env')
    expect(result.status).toBe('warn')
    expect(result.detail).toMatch(/12 characters/i)
  })

  it('fails when AUTH_PASS env is a known insecure default and no admin user exists', () => {
    getAdminPasswordHashMock.mockReturnValue(null)

    const result = checkAdminCredential({ AUTH_PASS: 'admin' })
    expect(result.source).toBe('env')
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/insecure default/i)
  })

  it('fails when no admin row AND no AUTH_PASS env (truly unconfigured)', () => {
    getAdminPasswordHashMock.mockReturnValue(null)

    const result = checkAdminCredential({})
    expect(result.source).toBe('none')
    expect(result.status).toBe('fail')
  })

  it('survives a malformed hash without throwing', () => {
    getAdminPasswordHashMock.mockReturnValue('not-a-valid-scrypt-hash')

    expect(() => checkAdminCredential({})).not.toThrow()
    const result = checkAdminCredential({})
    expect(result.source).toBe('db')
    // A malformed hash never matches any insecure default, so it passes.
    expect(result.status).toBe('pass')
  })
})
