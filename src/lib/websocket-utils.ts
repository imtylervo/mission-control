/**
 * Pure utility functions extracted from the WebSocket module for testability.
 */

/** Known gateway connect error detail codes (structured error codes sent by newer gateways) */
export const ConnectErrorDetailCodes = {
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_PASSWORD_MISSING: 'AUTH_PASSWORD_MISSING',
  AUTH_PASSWORD_MISMATCH: 'AUTH_PASSWORD_MISMATCH',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  DEVICE_SIGNATURE_INVALID: 'DEVICE_SIGNATURE_INVALID',
  /**
   * Gateway flag for "device must be approved by an operator before this
   * connection is allowed". Sent by openclaw 2026.x via the connect res frame
   * (see openclaw `connect-error-details.ts` + `server.impl` which closes 1008
   * after responding). The accompanying `error.details` payload follows the
   * shape pinned by `readPairingApproval` below — reason ∈ {not-paired,
   * role-upgrade, scope-upgrade, metadata-upgrade} plus deviceId/requestId so
   * the UI can show *which* device the operator needs to approve.
   *
   * Important: this is NOT non-retryable. Approval lands at human-time and
   * the WS layer must keep polling on a slow cadence so the connection
   * recovers automatically once the operator approves, without a manual user
   * click. See `calculatePairingPollDelay`.
   */
  PAIRING_REQUIRED: 'PAIRING_REQUIRED',
} as const

/** Error detail shape from gateway frames. */
export interface GatewayErrorDetail {
  message?: string
  code?: string
  details?: { code?: string; [key: string]: any }
  [key: string]: any
}

/** Extract structured error code from a gateway error frame, if present. */
export function readErrorDetailCode(error: GatewayErrorDetail | null | undefined): string | null {
  if (!error || typeof error !== 'object') return null
  // Newer gateways include a structured details object with a code field
  const detailsCode = error.details?.code
  if (typeof detailsCode === 'string' && detailsCode.length > 0) return detailsCode
  // Some frames carry code at the top level
  const topCode = error.code
  if (typeof topCode === 'string' && topCode.length > 0) return topCode
  return null
}

/** Error codes that should never trigger auto-reconnect. */
export const NON_RETRYABLE_ERROR_CODES = new Set<string>([
  ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
  ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
  ConnectErrorDetailCodes.ORIGIN_NOT_ALLOWED,
  ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID,
])

/** Check whether a given error code is non-retryable. */
export function isNonRetryableErrorCode(code: string): boolean {
  return NON_RETRYABLE_ERROR_CODES.has(code)
}

/**
 * Retry once without browser device identity when a valid gateway auth token
 * exists but the browser's cached device credentials appear invalid.
 */
export function shouldRetryWithoutDeviceIdentity(
  message: string,
  error: GatewayErrorDetail | null | undefined,
  hasAuthToken: boolean,
  alreadyRetried: boolean,
): boolean {
  if (!hasAuthToken || alreadyRetried) return false

  const code = readErrorDetailCode(error)
  if (code === ConnectErrorDetailCodes.DEVICE_SIGNATURE_INVALID) return true

  const normalized = message.toLowerCase()
  return (
    normalized.includes('device_auth_signature_invalid') ||
    normalized.includes('device signature invalid') ||
    normalized.includes('invalid device token') ||
    normalized.includes('device token invalid')
  )
}

/**
 * Calculate exponential backoff delay for reconnect attempts.
 * Uses base * 1.7^attempt, capped at 15000ms.
 * Returns only the deterministic base (without jitter) for testability.
 */
export function calculateBackoff(attempt: number): number {
  return Math.min(1000 * Math.pow(1.7, attempt), 15000)
}

/** Reasons the gateway returns alongside PAIRING_REQUIRED — see openclaw
 *  `ConnectPairingRequiredReasons`. Ordered to match the gateway constant. */
export type PairingApprovalReason =
  | 'not-paired'
  | 'role-upgrade'
  | 'scope-upgrade'
  | 'metadata-upgrade'

const PAIRING_APPROVAL_REASONS = new Set<PairingApprovalReason>([
  'not-paired',
  'role-upgrade',
  'scope-upgrade',
  'metadata-upgrade',
])

/**
 * Pending-approval state surfaced to the UI when the gateway responds with
 * PAIRING_REQUIRED. Captures the `error.details` payload from the openclaw
 * connect-error-details contract, normalized so `null`/`[]` mean "field was
 * absent or malformed" — never `undefined` — to make the UI rendering
 * (banner) trivially total.
 */
export interface PendingApprovalState {
  reason: PairingApprovalReason | null
  requestId: string | null
  deviceId: string | null
  requestedRole: string | null
  requestedScopes: string[]
  approvedRoles: string[]
  approvedScopes: string[]
}

/**
 * Decode the gateway's `error.details` payload into a `PendingApprovalState`,
 * or return `null` if the error is NOT a PAIRING_REQUIRED error.
 *
 * Pinned to openclaw 2026.x `buildPairingConnectErrorDetails`. The gateway
 * accepts/produces details in two equivalent shapes:
 *   1. `{ details: { code: 'PAIRING_REQUIRED', reason, requestId, deviceId, ... } }`
 *   2. `{ code: 'PAIRING_REQUIRED', reason, requestId, deviceId, ... }`
 * `readErrorDetailCode` already prefers (1), so we read from `details`
 * first then fall back to the top-level for older / less-structured frames.
 */
export function readPairingApproval(
  error: GatewayErrorDetail | null | undefined,
): PendingApprovalState | null {
  if (!error || typeof error !== 'object') return null
  if (readErrorDetailCode(error) !== ConnectErrorDetailCodes.PAIRING_REQUIRED) return null

  const detailsObj =
    error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details
      : (error as Record<string, unknown>)

  const stringOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null

  const stringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []

  const rawReason = stringOrNull(detailsObj.reason)
  const reason =
    rawReason && PAIRING_APPROVAL_REASONS.has(rawReason as PairingApprovalReason)
      ? (rawReason as PairingApprovalReason)
      : null

  return {
    reason,
    requestId: stringOrNull(detailsObj.requestId),
    deviceId: stringOrNull(detailsObj.deviceId),
    requestedRole: stringOrNull(detailsObj.requestedRole),
    requestedScopes: stringArray(detailsObj.requestedScopes),
    approvedRoles: stringArray(detailsObj.approvedRoles),
    approvedScopes: stringArray(detailsObj.approvedScopes),
  }
}

/** Slow-poll cadence used while pending operator approval. Steady, not
 *  exponential — operator approval lands at human-time, and exponential
 *  backoff just means the user waits longer for no reason after approval. */
export const PAIRING_POLL_BASE_MS = 10_000
const PAIRING_POLL_JITTER_MS = 2_000

/**
 * Compute the next slow-poll delay while the gateway is in PAIRING_REQUIRED
 * state. `rng` is injectable so tests can pin the value; default is
 * `Math.random`. Multiple tabs adding ±2s jitter avoids a synchronized
 * herd hitting the gateway at the same instant.
 */
export function calculatePairingPollDelay(rng: () => number = Math.random): number {
  const jitter = Math.round(rng() * PAIRING_POLL_JITTER_MS)
  return PAIRING_POLL_BASE_MS + jitter
}

/**
 * Detect a gap in event sequence numbers.
 * Returns info about the gap, or null if there is no gap.
 */
export function detectSequenceGap(
  lastSeq: number | null,
  currentSeq: number,
): { from: number; to: number; count: number } | null {
  if (lastSeq === null) return null
  if (currentSeq <= lastSeq + 1) return null
  const from = lastSeq + 1
  const to = currentSeq - 1
  return { from, to, count: to - from + 1 }
}
