'use client'

import { useState } from 'react'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY_LEGACY = 'mc-device-privkey'
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const IDB_DB_NAME = 'mc-device-identity'

/**
 * Banner-local reset path. Deliberately does NOT call
 * `lib/device-identity#clearDeviceIdentity` because that helper goes through
 * `store.clear()` which opens an IDB transaction and then awaits a
 * `delete(KEY_PRIVATE)` request — and the Firefox/Camofox IDB hang that
 * PR-UI4 v3 contains affects ALL transactions against the stored CryptoKey,
 * including the delete. The banner would then never call
 * `window.location.reload()` because the await never resolves.
 *
 * `indexedDB.deleteDatabase()` is a different code path that drops the whole
 * DB without opening a transaction first, so it sidesteps the hang. We also
 * race it against a 2s timeout — if even that hangs, we fall through to the
 * reload anyway because localStorage was already cleared and the next page
 * load will get a fresh keypair from precedence-3 in
 * `getOrCreateDeviceIdentity`.
 */
async function resetDeviceIdentityForRepair(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_DEVICE_ID)
    localStorage.removeItem(STORAGE_PUBKEY)
    localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)
    localStorage.removeItem(STORAGE_DEVICE_TOKEN)
  } catch {
    // private mode / quota — best-effort.
  }
  try {
    sessionStorage.removeItem(STORAGE_DEVICE_TOKEN)
  } catch {
    // best-effort.
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(IDB_DB_NAME)
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      } catch {
        resolve()
      }
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ])
}

/**
 * PR-UI5 (Phase 2.1-followup): explicit recovery surface for the
 * device-identity-unavailable failure that PR-UI4 v3 (Option E) leaves the
 * dashboard in.
 *
 * When the WS layer sets `connection.nonRetryableError` with the
 * `device-identity-unavailable` marker, the WS reconnect loop is intentionally
 * stopped (otherwise we'd produce a "pairing storm" of fresh device IDs per
 * Đào msg 1922). The dashboard then needs a user-triggered way to break out
 * of that state. This banner provides it: one click clears the IndexedDB
 * device-identity store + the related localStorage markers, then reloads the
 * page so a clean `getOrCreateDeviceIdentity()` runs from scratch and a
 * single new pairing request is issued.
 *
 * Renders nothing in the happy path (`nonRetryableError === null` or a
 * non-device-identity error).
 */
export function DeviceIdentityRecoveryBanner() {
  const { connection } = useMissionControl()
  const [busy, setBusy] = useState(false)

  if (!shouldShowBanner(connection.nonRetryableError)) return null

  const onReset = async () => {
    if (busy) return
    setBusy(true)
    try {
      await resetDeviceIdentityForRepair()
    } catch {
      // best-effort; reload still gives the user a fresh state because
      // the next getOrCreateDeviceIdentity precedence-1 check will see
      // nothing in localStorage.
    }
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="device-identity-recovery-banner"
      className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium">Gateway can't authenticate this browser</div>
        <div className="text-xs text-amber-200/80 mt-0.5">
          The signing key for this device couldn't be loaded. Reset the device
          identity to issue a new pairing request — the gateway operator will
          need to approve it.
        </div>
      </div>
      <Button
        size="xs"
        variant="outline"
        className="bg-amber-500/20 text-amber-100 border-amber-500/40 hover:bg-amber-500/30"
        onClick={onReset}
        disabled={busy}
      >
        {busy ? 'Resetting…' : 'Reset device identity'}
      </Button>
    </div>
  )
}

/**
 * Pure predicate so the rendering decision is unit-testable without mounting
 * React. Exported for `src/components/dashboard/__tests__`.
 */
export function shouldShowBanner(nonRetryableError: string | null | undefined): boolean {
  if (!nonRetryableError) return false
  return nonRetryableError.includes('device-identity-unavailable')
}
