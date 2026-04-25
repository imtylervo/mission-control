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
 * Key material lives in two places:
 *   - non-extractable CryptoKey persisted in IndexedDB (private key, post-#574)
 *   - localStorage (deviceId, public key, optional cached device token, gateway URL)
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

  await verifySignRoundtrip(keyPair.privateKey)
  await store.store(keyPair.privateKey)
  const reload = await store.load()
  if (!reload) {
    throw new DeviceIdentityUnavailableError('verify-read returned null')
  }
  await verifySignRoundtrip(reload)

  localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
  localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)

  return {
    deviceId,
    publicKeyBase64,
    privateKey: reload,
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

/** Reads cached device token from localStorage (returned by gateway on successful connect). */
export function getCachedDeviceToken(): string | null {
  return localStorage.getItem(STORAGE_DEVICE_TOKEN)
}

/** Caches the device token returned by the gateway after successful connect. */
export function cacheDeviceToken(token: string): void {
  localStorage.setItem(STORAGE_DEVICE_TOKEN, token)
}

/**
 * Removes all device identity data from both stores (for troubleshooting and
 * for the existing token-only fallback retry path in websocket.ts).
 */
export async function clearDeviceIdentity(): Promise<void> {
  localStorage.removeItem(STORAGE_DEVICE_ID)
  localStorage.removeItem(STORAGE_PUBKEY)
  localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)
  localStorage.removeItem(STORAGE_DEVICE_TOKEN)

  try {
    const store = getStore()
    await store.clear()
  } catch (err) {
    // Best-effort: if IndexedDB isn't reachable, there's nothing left to clear there.
    log.warn('IndexedDB clear skipped:', err)
  }
}
