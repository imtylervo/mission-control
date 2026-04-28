'use client'

import { createClientLogger } from '@/lib/client-logger'
import {
  createIndexedDbDeviceIdentityStore,
  type DeviceIdentityStore,
} from '@/lib/device-identity-store'

const log = createClientLogger('DeviceIdentity')

/**
 * Ed25519 device identity for OpenClaw gateway protocol v3 challenge-response.
 *
 * Key material lives in three places:
 *   - non-extractable CryptoKey persisted in IndexedDB (private key, post-#574)
 *   - localStorage (deviceId, public key, gateway URL)
 *   - sessionStorage (cached device token, post-Phase 1.7) — bearer-equivalent
 *     per Phase 1.6 classification, so it is kept out of localStorage to close
 *     the persisted-XSS exfil path. See docs/audit/PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md
 *     and docs/audit/PR19_PHASE_1_7_DEVICE_TOKEN_SESSIONSTORAGE.md.
 *
 * Falls back gracefully when Ed25519 is unavailable (older browsers) — the
 * handshake proceeds without device identity (auth-token-only mode). When the
 * private key is unrecoverable but Ed25519 IS available, the caller receives a
 * `DeviceIdentityUnavailableError` so it can prompt re-pair instead of silently
 * downgrading.
 */

// localStorage keys (raw private key is NEVER stored here post-#574)
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY_LEGACY = 'mc-device-privkey' // migration-only: read + remove
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const STORAGE_GATEWAY_URL = 'mc-gateway-url'

export { STORAGE_GATEWAY_URL }

export interface DeviceIdentity {
  deviceId: string
  publicKeyBase64: string
  privateKey: CryptoKey
}

export class DeviceIdentityUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `Mission Control could not load this browser's device identity (${reason}). Please re-pair this browser with the gateway.`
    )
    this.name = 'DeviceIdentityUnavailableError'
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Store wiring (DI for tests) ──────────────────────────────────

let storeOverride: DeviceIdentityStore | null = null

/** @internal — test-only seam */
export function __setDeviceIdentityStoreForTests(
  store: DeviceIdentityStore | null
): void {
  storeOverride = store
}

function getStore(): DeviceIdentityStore {
  if (storeOverride) return storeOverride
  return createIndexedDbDeviceIdentityStore()
}

// ── Verification helpers ─────────────────────────────────────────

/**
 * Đào's conservative migration step: prove the imported key can sign before
 * persisting it, then prove the persisted key can sign before destroying the
 * legacy localStorage copy.
 */
async function verifySignRoundtrip(privateKey: CryptoKey): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(16))
  const sig = await crypto.subtle.sign('Ed25519', privateKey, challenge)
  if (!sig || sig.byteLength === 0) {
    throw new Error('verify-sign produced empty signature')
  }
}

// ── Identity construction ────────────────────────────────────────

async function generateNewIdentity(
  store: DeviceIdentityStore
): Promise<DeviceIdentity> {
  // extractable=false applies to the private key. Per W3C WebCrypto, the public
  // key from an asymmetric generateKey is always extractable, so we can still
  // export the raw bytes needed for deviceId and the gateway pairing record.
  const keyPair = await crypto.subtle.generateKey('Ed25519', false, [
    'sign',
    'verify',
  ])

  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const deviceId = await sha256Hex(pubRaw)
  const publicKeyBase64 = toBase64Url(pubRaw)

  // Verify the freshly-generated key can sign before persisting.
  await verifySignRoundtrip(keyPair.privateKey)

  // Persist to IndexedDB so subsequent cold starts can reload via the
  // precedence-1 fast-path. Failures here are surfaced as
  // DeviceIdentityUnavailableError (re-pair signal) since IndexedDB is the
  // canonical post-#574 home for the private key.
  try {
    await store.store(keyPair.privateKey)
  } catch (err) {
    throw new DeviceIdentityUnavailableError(
      `IndexedDB store failed (${(err as Error)?.message || 'unknown'})`,
    )
  }

  // Phase 2.1-followup: do NOT do an immediate readback-verify roundtrip on
  // the same key we just generated.
  //
  // Rationale: a `store.load()` issued microtasks after `store.store()` has
  // been observed to hang (Promise never resolves, await never returns) on
  // Firefox 135 / Camofox in the mc.aothundao.com origin. The hang propagates
  // up through `getOrCreateDeviceIdentity` → `sendConnectHandshake`'s `await`,
  // so the WS handshake reply is never sent and the gateway closes the
  // connection with a handshake-timeout. Net effect for the user: dashboard
  // stays at "Gateway disconnected" forever even though `voicecall` /
  // `sessions.list` over the SAME WS work fine for the MC server-side
  // connection. See docs/audit/PHASE_2_1_FOLLOWUP_DEVICE_IDENTITY.md and
  // gateway log evidence with `code=1000 reason=n/a` from origin
  // `https://mc.aothundao.com`.
  //
  // The freshly-generated `keyPair.privateKey` has already passed
  // `verifySignRoundtrip` above, so we already know it can sign — we don't
  // need to round-trip through IndexedDB to prove it again. The persisted
  // copy IS exercised on every subsequent cold start via the precedence-1
  // fast-path in `getOrCreateDeviceIdentity` (load-then-validate-by-using),
  // so a corrupt persistence will surface there with a real failure (sign
  // throws when called for a real handshake) rather than during the create
  // path that is currently hanging.

  localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
  localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)

  return {
    deviceId,
    publicKeyBase64,
    privateKey: keyPair.privateKey,
  }
}

/**
 * Đào's 5-step migration:
 *   1. Import legacy PKCS8 as non-extractable.
 *   2. Verify it can sign (verify-sign #1).
 *   3. Store in IndexedDB.
 *   4. Re-load from IndexedDB and verify it can sign (verify-read + verify-sign #2).
 *   5. Only after all four pass: remove `mc-device-privkey` from localStorage.
 *
 * If ANY step fails: throw `DeviceIdentityUnavailableError`. Do NOT delete the
 * legacy key blindly; surface re-pair guidance and let the user decide.
 */
async function migrateLegacyIfPresent(
  store: DeviceIdentityStore
): Promise<DeviceIdentity | null> {
  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)
  const legacyPriv = localStorage.getItem(STORAGE_PRIVKEY_LEGACY)
  if (!storedId || !storedPub || !legacyPriv) return null

  let imported: CryptoKey
  try {
    imported = await crypto.subtle.importKey(
      'pkcs8',
      fromBase64Url(legacyPriv) as unknown as BufferSource,
      'Ed25519',
      false, // extractable: false
      ['sign']
    )
  } catch (err) {
    log.warn('legacy private key unimportable, re-pair required')
    throw new DeviceIdentityUnavailableError('legacy key import failed')
  }

  try {
    await verifySignRoundtrip(imported)
  } catch (err) {
    throw new DeviceIdentityUnavailableError('verify-sign failed for legacy key')
  }

  try {
    await store.store(imported)
  } catch (err) {
    throw new DeviceIdentityUnavailableError('IndexedDB store failed')
  }

  let persisted: CryptoKey | null
  try {
    persisted = await store.load()
  } catch (err) {
    throw new DeviceIdentityUnavailableError('IndexedDB read-back failed')
  }
  if (!persisted) {
    throw new DeviceIdentityUnavailableError('IndexedDB read-back returned null')
  }

  try {
    await verifySignRoundtrip(persisted)
  } catch (err) {
    throw new DeviceIdentityUnavailableError(
      'verify-sign failed for persisted key'
    )
  }

  // Only now is it safe to remove the legacy localStorage copy.
  localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)

  return {
    deviceId: storedId,
    publicKeyBase64: storedPub,
    privateKey: persisted,
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Returns the device identity for this browser.
 *
 * Precedence:
 *   1. IndexedDB CryptoKey (post-migration users).
 *   2. Legacy localStorage `mc-device-privkey` → migrate.
 *   3. Generate fresh keypair (new device).
 *
 * Throws `DeviceIdentityUnavailableError` when the private key is unrecoverable
 * (e.g. IndexedDB blocked, key corrupted) so the caller can prompt re-pair
 * instead of silently storing a fresh key under a stale `deviceId` or
 * downgrading to token-only mode.
 */
export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  let store: DeviceIdentityStore
  try {
    store = getStore()
  } catch (err) {
    throw new DeviceIdentityUnavailableError('IndexedDB unavailable')
  }

  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)

  // 1. IndexedDB has the key → fast path.
  let idbKey: CryptoKey | null = null
  try {
    idbKey = await store.load()
  } catch (err) {
    log.warn('IndexedDB read failed, falling through to migration / fresh keypair')
  }
  if (idbKey && storedId && storedPub) {
    return {
      deviceId: storedId,
      publicKeyBase64: storedPub,
      privateKey: idbKey,
    }
  }

  // 2. Legacy localStorage key → migrate.
  if (localStorage.getItem(STORAGE_PRIVKEY_LEGACY)) {
    const migrated = await migrateLegacyIfPresent(store)
    if (migrated) return migrated
  }

  // 3. New device.
  return generateNewIdentity(store)
}

/**
 * Signs an auth payload with the Ed25519 private key.
 * Returns base64url signature and signing timestamp.
 */
export async function signPayload(
  privateKey: CryptoKey,
  payload: string,
  signedAt = Date.now()
): Promise<{ signature: string; signedAt: number }> {
  const encoder = new TextEncoder()
  const payloadBytes = encoder.encode(payload)
  const signatureBuffer = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    payloadBytes
  )
  return {
    signature: toBase64Url(signatureBuffer),
    signedAt,
  }
}

/**
 * Best-effort accessors for the two web-storage backends.
 *
 * Returns null for either store when the runtime can't access it: SSR
 * (no `window`), private browsing modes that throw on storage access,
 * disabled storage in Safari/Firefox lockdown, etc. Callers must always
 * null-check.
 */
function _safeStorage(): { local: Storage | null; session: Storage | null } {
  if (typeof window === 'undefined') return { local: null, session: null }
  let local: Storage | null = null
  let session: Storage | null = null
  try { local = window.localStorage } catch { /* storage disabled */ }
  try { session = window.sessionStorage } catch { /* storage disabled */ }
  return { local, session }
}

/**
 * Reads cached device token from sessionStorage (returned by gateway on
 * successful connect). The token is bearer-equivalent on the gateway (per
 * Phase 1.6 classification) so it lives in sessionStorage instead of
 * localStorage to close the persisted-XSS exfil path. Tab close ⇒ token
 * gone ⇒ next handshake re-mints a fresh token.
 *
 * On read, also clears any legacy `localStorage['mc-device-token']` left by
 * pre-Phase-1.7 builds. The legacy value is NOT promoted into sessionStorage
 * — we force a fresh handshake instead, so any token whose lifecycle started
 * in the wrong scope cannot continue under the new scope.
 *
 * All storage operations are best-effort; a thrown access error degrades to
 * `null` (or no-op write) rather than crashing the auth flow.
 */
export function getCachedDeviceToken(): string | null {
  const { local, session } = _safeStorage()
  if (local) {
    try {
      if (local.getItem(STORAGE_DEVICE_TOKEN) !== null) {
        local.removeItem(STORAGE_DEVICE_TOKEN)
      }
    } catch { /* legacy cleanup is best-effort */ }
  }
  if (!session) return null
  try {
    return session.getItem(STORAGE_DEVICE_TOKEN)
  } catch {
    return null
  }
}

/**
 * Caches the device token returned by the gateway after successful connect.
 * Writes to sessionStorage only — see {@link getCachedDeviceToken} for the
 * Phase 1.6 / 1.7 rationale. Best-effort: a thrown storage error is a no-op.
 */
export function cacheDeviceToken(token: string): void {
  const { session } = _safeStorage()
  if (!session) return
  try {
    session.setItem(STORAGE_DEVICE_TOKEN, token)
  } catch { /* token cache write is best-effort */ }
}

/**
 * Removes all device identity data from every store (for troubleshooting and
 * for the existing token-only fallback retry path in websocket.ts).
 * Best-effort across all branches.
 */
export async function clearDeviceIdentity(): Promise<void> {
  const { local, session } = _safeStorage()
  if (local) {
    try { local.removeItem(STORAGE_DEVICE_ID) } catch {}
    try { local.removeItem(STORAGE_PUBKEY) } catch {}
    try { local.removeItem(STORAGE_PRIVKEY_LEGACY) } catch {}
    // Defense — pre-Phase-1.7 builds may have left a copy here.
    try { local.removeItem(STORAGE_DEVICE_TOKEN) } catch {}
  }
  if (session) {
    try { session.removeItem(STORAGE_DEVICE_TOKEN) } catch {}
  }

  try {
    const store = getStore()
    await store.clear()
  } catch (err) {
    // Best-effort: if IndexedDB isn't reachable, there's nothing left to clear there.
    log.warn('IndexedDB clear skipped:', err)
  }
}
