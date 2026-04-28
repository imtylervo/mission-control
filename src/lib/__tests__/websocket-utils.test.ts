import { describe, it, expect } from 'vitest'
import {
  ConnectErrorDetailCodes,
  readErrorDetailCode,
  isNonRetryableErrorCode,
  calculateBackoff,
  detectSequenceGap,
  NON_RETRYABLE_ERROR_CODES,
  shouldRetryWithoutDeviceIdentity,
  readPairingApproval,
  calculatePairingPollDelay,
  PAIRING_POLL_BASE_MS,
} from '../websocket-utils'

describe('readErrorDetailCode', () => {
  it('returns null for null/undefined input', () => {
    expect(readErrorDetailCode(null)).toBeNull()
    expect(readErrorDetailCode(undefined)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(readErrorDetailCode('string' as any)).toBeNull()
    expect(readErrorDetailCode(42 as any)).toBeNull()
  })

  it('returns null when no code fields are present', () => {
    expect(readErrorDetailCode({ message: 'something failed' })).toBeNull()
  })

  it('extracts code from error.details.code (preferred)', () => {
    expect(
      readErrorDetailCode({ details: { code: 'AUTH_TOKEN_MISSING' } }),
    ).toBe('AUTH_TOKEN_MISSING')
  })

  it('falls back to error.code when details.code is absent', () => {
    expect(readErrorDetailCode({ code: 'ORIGIN_NOT_ALLOWED' })).toBe(
      'ORIGIN_NOT_ALLOWED',
    )
  })

  it('prefers details.code over top-level code', () => {
    expect(
      readErrorDetailCode({
        code: 'TOP_LEVEL',
        details: { code: 'DETAILS_CODE' },
      }),
    ).toBe('DETAILS_CODE')
  })

  it('ignores empty string codes', () => {
    expect(readErrorDetailCode({ code: '' })).toBeNull()
    expect(readErrorDetailCode({ details: { code: '' } })).toBeNull()
  })
})

describe('isNonRetryableErrorCode', () => {
  it('returns true for all non-retryable codes', () => {
    const nonRetryable = [
      'AUTH_TOKEN_MISSING',
      'AUTH_PASSWORD_MISSING',
      'AUTH_PASSWORD_MISMATCH',
      'AUTH_RATE_LIMITED',
      'ORIGIN_NOT_ALLOWED',
      'DEVICE_SIGNATURE_INVALID',
    ]
    for (const code of nonRetryable) {
      expect(isNonRetryableErrorCode(code)).toBe(true)
    }
  })

  it('returns false for AUTH_TOKEN_MISMATCH (retryable)', () => {
    expect(isNonRetryableErrorCode('AUTH_TOKEN_MISMATCH')).toBe(false)
  })

  it('returns false for unknown codes', () => {
    expect(isNonRetryableErrorCode('UNKNOWN_ERROR')).toBe(false)
    expect(isNonRetryableErrorCode('')).toBe(false)
  })
})

describe('calculateBackoff', () => {
  it('returns 1000ms for attempt 0', () => {
    expect(calculateBackoff(0)).toBe(1000)
  })

  it('returns 1700ms for attempt 1', () => {
    expect(calculateBackoff(1)).toBeCloseTo(1700, 0)
  })

  it('grows exponentially for attempt 5', () => {
    const result = calculateBackoff(5)
    // 1000 * 1.7^5 = 1000 * 14.19857 = ~14198.57
    expect(result).toBeCloseTo(14198.57, 0)
    expect(result).toBeLessThan(15000)
  })

  it('caps at 15000ms for high attempts', () => {
    expect(calculateBackoff(10)).toBe(15000)
    expect(calculateBackoff(20)).toBe(15000)
    expect(calculateBackoff(100)).toBe(15000)
  })
})

describe('shouldRetryWithoutDeviceIdentity', () => {
  it('retries once for DEVICE_SIGNATURE_INVALID when an auth token exists', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'Gateway rejected device signature',
        { details: { code: 'DEVICE_SIGNATURE_INVALID' } },
        true,
        false,
      ),
    ).toBe(true)
  })

  it('retries once for legacy device-signature messages', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        true,
        false,
      ),
    ).toBe(true)
  })

  it('does not retry without an auth token', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        false,
        false,
      ),
    ).toBe(false)
  })

  it('does not retry more than once', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'device_auth_signature_invalid',
        undefined,
        true,
        true,
      ),
    ).toBe(false)
  })

  it('does not retry for unrelated gateway errors', () => {
    expect(
      shouldRetryWithoutDeviceIdentity(
        'origin not allowed',
        { details: { code: 'ORIGIN_NOT_ALLOWED' } },
        true,
        false,
      ),
    ).toBe(false)
  })
})

describe('detectSequenceGap', () => {
  it('returns null when lastSeq is null (first message)', () => {
    expect(detectSequenceGap(null, 1)).toBeNull()
    expect(detectSequenceGap(null, 100)).toBeNull()
  })

  it('returns null for consecutive sequences (no gap)', () => {
    expect(detectSequenceGap(5, 6)).toBeNull()
    expect(detectSequenceGap(0, 1)).toBeNull()
  })

  it('returns null when currentSeq equals lastSeq + 1', () => {
    expect(detectSequenceGap(99, 100)).toBeNull()
  })

  it('returns null for duplicate or out-of-order sequences', () => {
    expect(detectSequenceGap(5, 5)).toBeNull()
    expect(detectSequenceGap(5, 3)).toBeNull()
  })

  it('detects a gap of 2 missed events', () => {
    const result = detectSequenceGap(5, 8)
    expect(result).toEqual({ from: 6, to: 7, count: 2 })
  })

  it('detects a gap of 1 missed event', () => {
    const result = detectSequenceGap(5, 7)
    expect(result).toEqual({ from: 6, to: 6, count: 1 })
  })

  it('detects a large gap', () => {
    const result = detectSequenceGap(10, 110)
    expect(result).toEqual({ from: 11, to: 109, count: 99 })
  })
})

describe('ConnectErrorDetailCodes', () => {
  it('has all expected keys', () => {
    const expectedKeys = [
      'AUTH_TOKEN_MISSING',
      'AUTH_PASSWORD_MISSING',
      'AUTH_PASSWORD_MISMATCH',
      'AUTH_RATE_LIMITED',
      'AUTH_TOKEN_MISMATCH',
      'ORIGIN_NOT_ALLOWED',
      'DEVICE_SIGNATURE_INVALID',
      'PAIRING_REQUIRED',
    ]
    for (const key of expectedKeys) {
      expect(ConnectErrorDetailCodes).toHaveProperty(key)
      expect((ConnectErrorDetailCodes as any)[key]).toBe(key)
    }
  })

  it('NON_RETRYABLE_ERROR_CODES does not include AUTH_TOKEN_MISMATCH', () => {
    expect(NON_RETRYABLE_ERROR_CODES.has('AUTH_TOKEN_MISMATCH')).toBe(false)
  })

  // Critical for PR-UI6: PAIRING_REQUIRED must NOT be classified as
  // non-retryable, otherwise the slow-poll loop never gets to fire and the
  // user is stuck on a dead banner waiting for the operator approval that
  // would have unblocked them.
  it('NON_RETRYABLE_ERROR_CODES does not include PAIRING_REQUIRED', () => {
    expect(NON_RETRYABLE_ERROR_CODES.has('PAIRING_REQUIRED')).toBe(false)
  })
})

describe('readPairingApproval — PR-UI6 PAIRING_REQUIRED parser', () => {
  it('returns null for null/undefined input', () => {
    expect(readPairingApproval(null)).toBeNull()
    expect(readPairingApproval(undefined)).toBeNull()
  })

  it('returns null when the code is not PAIRING_REQUIRED', () => {
    expect(
      readPairingApproval({
        message: 'origin not allowed',
        details: { code: 'ORIGIN_NOT_ALLOWED' },
      }),
    ).toBeNull()
  })

  it('returns null when there is no code at all', () => {
    expect(
      readPairingApproval({ message: 'some random failure', details: {} }),
    ).toBeNull()
  })

  it('parses the canonical openclaw shape (code + reason + ids in details)', () => {
    const result = readPairingApproval({
      message: 'pairing required: device is not approved yet',
      details: {
        code: 'PAIRING_REQUIRED',
        reason: 'not-paired',
        requestId: 'req_abc123',
        deviceId: 'dev_browser_xyz',
        requestedRole: 'operator',
        requestedScopes: ['operator.admin'],
        approvedRoles: [],
        approvedScopes: [],
      },
    })
    expect(result).toEqual({
      reason: 'not-paired',
      requestId: 'req_abc123',
      deviceId: 'dev_browser_xyz',
      requestedRole: 'operator',
      requestedScopes: ['operator.admin'],
      approvedRoles: [],
      approvedScopes: [],
    })
  })

  it('handles each pairing reason variant correctly', () => {
    for (const reason of [
      'not-paired',
      'role-upgrade',
      'scope-upgrade',
      'metadata-upgrade',
    ] as const) {
      const result = readPairingApproval({
        details: { code: 'PAIRING_REQUIRED', reason },
      })
      expect(result?.reason).toBe(reason)
    }
  })

  it('coerces an unknown/garbage reason to null without dropping the whole record', () => {
    const result = readPairingApproval({
      details: {
        code: 'PAIRING_REQUIRED',
        reason: 'totally-bogus-reason',
        requestId: 'req_456',
      },
    })
    // Still pairing-required (so the slow-poll still kicks in), but the
    // banner copy falls back to the generic "pairing" template via reason=null.
    expect(result).not.toBeNull()
    expect(result?.reason).toBeNull()
    expect(result?.requestId).toBe('req_456')
  })

  it('drops empty-string ids (UI must not render empty deviceId / requestId)', () => {
    const result = readPairingApproval({
      details: {
        code: 'PAIRING_REQUIRED',
        reason: 'not-paired',
        requestId: '',
        deviceId: '',
      },
    })
    expect(result?.requestId).toBeNull()
    expect(result?.deviceId).toBeNull()
  })

  it('coerces a missing requestedScopes to empty array (renders cleanly in UI)', () => {
    const result = readPairingApproval({
      details: {
        code: 'PAIRING_REQUIRED',
        reason: 'not-paired',
        requestId: 'req_1',
      },
    })
    expect(result?.requestedScopes).toEqual([])
    expect(result?.approvedRoles).toEqual([])
    expect(result?.approvedScopes).toEqual([])
  })

  it('filters non-string entries out of scope arrays', () => {
    const result = readPairingApproval({
      details: {
        code: 'PAIRING_REQUIRED',
        requestedScopes: ['operator.admin', 42, null, '', 'extra.scope'],
      } as any,
    })
    expect(result?.requestedScopes).toEqual(['operator.admin', 'extra.scope'])
  })

  it('falls back to top-level fields when details is absent (looser legacy shape)', () => {
    // Some less-structured frames carry the code + fields directly at the
    // top level rather than nested under .details. The parser tolerates
    // both for forward compatibility.
    const result = readPairingApproval({
      code: 'PAIRING_REQUIRED',
      reason: 'role-upgrade',
      requestId: 'req_legacy',
      deviceId: 'dev_legacy',
    } as any)
    expect(result?.reason).toBe('role-upgrade')
    expect(result?.requestId).toBe('req_legacy')
    expect(result?.deviceId).toBe('dev_legacy')
  })
})

describe('calculatePairingPollDelay — PR-UI6 slow-poll cadence', () => {
  it('returns base delay with no jitter when rng=0', () => {
    expect(calculatePairingPollDelay(() => 0)).toBe(PAIRING_POLL_BASE_MS)
  })

  it('returns base + 2000ms when rng=1 (full jitter)', () => {
    expect(calculatePairingPollDelay(() => 1)).toBe(PAIRING_POLL_BASE_MS + 2000)
  })

  it('returns a value within the documented range using the default rng', () => {
    const v = calculatePairingPollDelay()
    expect(v).toBeGreaterThanOrEqual(PAIRING_POLL_BASE_MS)
    expect(v).toBeLessThanOrEqual(PAIRING_POLL_BASE_MS + 2000)
  })

  it('keeps the base at exactly 10s — explicitly NOT exponential', () => {
    // Pin the base value: this is a UX contract, not just an implementation
    // detail. If the base drifts (e.g., someone later adds exponential
    // growth or shortens it to 1s), the operator-approval flow either
    // strands the user or storms the gateway.
    expect(PAIRING_POLL_BASE_MS).toBe(10_000)
  })
})
