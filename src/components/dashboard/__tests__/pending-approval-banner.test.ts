import { describe, expect, it } from 'vitest'
import {
  shouldShowPendingApprovalBanner,
  formatPendingApprovalTitle,
  formatPendingApprovalDetail,
  formatPendingApprovalCli,
} from '../pending-approval-banner'
import type { PendingApprovalState } from '@/lib/websocket-utils'

const fullApproval: PendingApprovalState = {
  reason: 'not-paired',
  requestId: 'req_abc123',
  deviceId: 'dev_browser_long_id_12345678',
  requestedRole: 'operator',
  requestedScopes: ['operator.admin'],
  approvedRoles: [],
  approvedScopes: [],
}

describe('shouldShowPendingApprovalBanner — PR-UI6 visibility predicate', () => {
  it('returns false for null', () => {
    expect(shouldShowPendingApprovalBanner(null)).toBe(false)
  })

  it('returns false for undefined (forward-compat with older stores)', () => {
    expect(shouldShowPendingApprovalBanner(undefined)).toBe(false)
  })

  it('returns true for a full approval payload', () => {
    expect(shouldShowPendingApprovalBanner(fullApproval)).toBe(true)
  })

  it('returns true even when reason is null (gateway sent unknown reason)', () => {
    expect(
      shouldShowPendingApprovalBanner({ ...fullApproval, reason: null }),
    ).toBe(true)
  })

  it('returns true even when requestId is null (operator must list first)', () => {
    expect(
      shouldShowPendingApprovalBanner({ ...fullApproval, requestId: null }),
    ).toBe(true)
  })
})

describe('formatPendingApprovalTitle', () => {
  it('uses "pairing pending" for not-paired', () => {
    expect(formatPendingApprovalTitle({ ...fullApproval, reason: 'not-paired' })).toMatch(
      /pairing pending/i,
    )
  })

  it('uses "role upgrade" for role-upgrade', () => {
    expect(formatPendingApprovalTitle({ ...fullApproval, reason: 'role-upgrade' })).toMatch(
      /role upgrade/i,
    )
  })

  it('uses "scope upgrade" for scope-upgrade', () => {
    expect(formatPendingApprovalTitle({ ...fullApproval, reason: 'scope-upgrade' })).toMatch(
      /scope upgrade/i,
    )
  })

  it('uses "device-refresh" for metadata-upgrade', () => {
    expect(formatPendingApprovalTitle({ ...fullApproval, reason: 'metadata-upgrade' })).toMatch(
      /device-refresh|device refresh/i,
    )
  })

  it('falls back to generic pairing for unknown reason (null)', () => {
    expect(formatPendingApprovalTitle({ ...fullApproval, reason: null })).toMatch(
      /pairing pending/i,
    )
  })
})

describe('formatPendingApprovalDetail', () => {
  it('truncates the deviceId to 12 chars + ellipsis', () => {
    const detail = formatPendingApprovalDetail(fullApproval)
    expect(detail).toContain('dev_browser_')
    expect(detail).toContain('…')
    // Important — full deviceId must NOT appear; the operator only needs
    // enough prefix to disambiguate, and a long opaque id makes the banner
    // hard to read at a glance.
    expect(detail).not.toContain('dev_browser_long_id_12345678')
  })

  it('falls back to "this device" when deviceId is null', () => {
    expect(
      formatPendingApprovalDetail({ ...fullApproval, deviceId: null }),
    ).toContain('this device')
  })

  it('says "asking for a higher role" for role-upgrade', () => {
    expect(
      formatPendingApprovalDetail({ ...fullApproval, reason: 'role-upgrade' }),
    ).toMatch(/higher role/i)
  })

  it('says "additional scopes" for scope-upgrade', () => {
    expect(
      formatPendingApprovalDetail({ ...fullApproval, reason: 'scope-upgrade' }),
    ).toMatch(/additional scopes|need approval/i)
  })

  it('says "metadata" for metadata-upgrade', () => {
    expect(
      formatPendingApprovalDetail({ ...fullApproval, reason: 'metadata-upgrade' }),
    ).toMatch(/metadata|re-approved/i)
  })
})

describe('formatPendingApprovalCli', () => {
  it('emits a concrete approve command when requestId is known', () => {
    expect(formatPendingApprovalCli(fullApproval)).toBe(
      'openclaw devices approve req_abc123',
    )
  })

  it('falls back to "list then approve <id>" when requestId is missing', () => {
    const cli = formatPendingApprovalCli({ ...fullApproval, requestId: null })
    expect(cli).toContain('openclaw devices list')
    expect(cli).toContain('openclaw devices approve <requestId>')
  })
})
