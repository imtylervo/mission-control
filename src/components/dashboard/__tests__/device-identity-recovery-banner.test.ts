import { describe, expect, it } from 'vitest'
import { shouldShowBanner } from '../device-identity-recovery-banner'

/**
 * PR-UI5 (Phase 2.1-followup): predicate that decides whether the device-
 * identity recovery banner renders. Pin the marker shape produced by
 * `src/lib/websocket.ts` when `DeviceIdentityUnavailableError` short-circuits
 * the WS handshake.
 */
describe('shouldShowBanner — PR-UI5 device-identity recovery banner', () => {
  it('returns false for null', () => {
    expect(shouldShowBanner(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(shouldShowBanner(undefined)).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(shouldShowBanner('')).toBe(false)
  })

  it('returns false for an unrelated non-retryable error', () => {
    // e.g. an AUTH_TOKEN_MISSING / ORIGIN_NOT_ALLOWED gateway error that
    // also flips nonRetryableError but isn't a device-identity issue.
    expect(shouldShowBanner('Gateway rejected origin: not allowed')).toBe(
      false,
    )
  })

  it('returns true for the canonical PR-UI4 marker exact prefix', () => {
    expect(
      shouldShowBanner(
        'device-identity-unavailable: localStorage has a paired deviceId but IndexedDB readback timed out — this browser needs to re-pair manually before the WebSocket can authenticate.',
      ),
    ).toBe(true)
  })

  it('returns true even if the marker is embedded mid-string', () => {
    // The websocket layer formats the value as
    // `device-identity-unavailable: <DeviceIdentityUnavailableError.message>`
    // but a future caller might prepend context. Match-by-substring keeps
    // the predicate robust to that.
    expect(
      shouldShowBanner('[2026-04-28T19:00] device-identity-unavailable: ...'),
    ).toBe(true)
  })
})
