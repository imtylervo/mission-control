'use client'

import { useMissionControl } from '@/store'
import type { PendingApprovalState } from '@/lib/websocket-utils'

/**
 * PR-UI6: pending operator-approval surface for the gateway PAIRING_REQUIRED
 * state. Distinct from PR-UI5's device-identity recovery banner: this one
 * fires when the gateway is reachable and responsive but the operator
 * hasn't approved this device yet (the typical state right after the user
 * clicks "Reset device identity" → reload → fresh deviceId generates →
 * gateway sees a new device → pairing pending).
 *
 * No buttons here — the WS layer is in slow-poll mode and will reconnect
 * automatically the moment `openclaw devices approve <requestId>` lands on
 * the gateway host. The banner just communicates "we're waiting on you,
 * here's what to do".
 *
 * Renders nothing when `connection.pendingApproval === null`.
 */
export function PendingApprovalBanner() {
  const { connection } = useMissionControl()

  if (!shouldShowPendingApprovalBanner(connection.pendingApproval)) return null
  // narrowed by the predicate above
  const approval = connection.pendingApproval as PendingApprovalState

  const title = formatPendingApprovalTitle(approval)
  const detail = formatPendingApprovalDetail(approval)
  const cli = formatPendingApprovalCli(approval)

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pending-approval-banner"
      className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400"
          />
          {title}
        </div>
        <div className="text-xs text-sky-200/80 mt-0.5">{detail}</div>
        {cli && (
          <div
            data-testid="pending-approval-cli"
            className="mt-1 rounded bg-sky-500/20 px-2 py-1 text-xs font-mono text-sky-50"
          >
            {cli}
          </div>
        )}
        <div className="text-[11px] text-sky-200/60 mt-1">
          The browser is polling the gateway every ~10s and will reconnect
          automatically once the operator approves — no further action needed
          here.
        </div>
      </div>
    </div>
  )
}

/**
 * Pure predicate so the rendering decision is unit-testable without
 * mounting React. Exported for `__tests__/pending-approval-banner.test.ts`.
 *
 * `pendingApproval === null` is the happy path. We also tolerate `undefined`
 * for forward compatibility with future stores that omit the field rather
 * than setting it to null.
 */
export function shouldShowPendingApprovalBanner(
  pendingApproval: PendingApprovalState | null | undefined,
): pendingApproval is PendingApprovalState {
  return Boolean(pendingApproval)
}

/**
 * Title line. Vietnamese-friendly English (Tyler reads English fine; the
 * operator running `openclaw devices approve` is the same person, so we
 * don't bother i18n'ing this — the openclaw CLI itself is English-only).
 */
export function formatPendingApprovalTitle(approval: PendingApprovalState): string {
  switch (approval.reason) {
    case 'role-upgrade':
      return 'Gateway role upgrade pending operator approval'
    case 'scope-upgrade':
      return 'Gateway scope upgrade pending operator approval'
    case 'metadata-upgrade':
      return 'Gateway device-refresh approval pending'
    case 'not-paired':
    case null:
    default:
      return 'Gateway pairing pending operator approval'
  }
}

/** Human-readable detail line including the device id (truncated) so the
 *  operator can confirm they're approving the right browser. */
export function formatPendingApprovalDetail(approval: PendingApprovalState): string {
  const deviceFragment = approval.deviceId
    ? `device ${approval.deviceId.slice(0, 12)}…`
    : 'this device'
  switch (approval.reason) {
    case 'role-upgrade':
      return `${deviceFragment} is asking for a higher role than currently approved.`
    case 'scope-upgrade':
      return `${deviceFragment} is asking for additional scopes that need approval.`
    case 'metadata-upgrade':
      return `${deviceFragment} has changed identity metadata and must be re-approved.`
    case 'not-paired':
    case null:
    default:
      return `${deviceFragment} hasn't been paired with the gateway yet.`
  }
}

/** Concrete CLI command for the operator to copy/paste on the gateway host.
 *  Returns `null` when we don't have a `requestId` and the operator should
 *  list pending requests first. */
export function formatPendingApprovalCli(approval: PendingApprovalState): string {
  if (approval.requestId) {
    return `openclaw devices approve ${approval.requestId}`
  }
  return 'openclaw devices list   # then: openclaw devices approve <requestId>'
}
