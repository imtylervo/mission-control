/**
 * @vitest-environment jsdom
 *
 * Tests for src/lib/device-identity.ts — PR #574 (raw Ed25519 PKCS8 must NOT
 * persist in localStorage; CryptoKey must be non-extractable; migration must
 * be conservative; fail-closed when IndexedDB is broken).
 *
 * Test fixtures use a runtime-generated throwaway keypair per Đào's review
 * (msg 1004): never commit a static PKCS8-looking string into the repo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DeviceIdentityUnavailableError,
  __setDeviceIdentityStoreForTests,
  cacheDeviceToken,
  clearDeviceIdentity,
  getCachedDeviceToken,
  getOrCreateDeviceIdentity,
} from '@/lib/device-identity'
import {
  createMemoryDeviceIdentityStore,
  type DeviceIdentityStore,
} from '@/lib/device-identity-store'

const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY_LEGACY = 'mc-device-privkey'
const STORAGE_DEVICE_TOKEN = 'mc-device-token'

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build a "legacy paired user" fixture at runtime: generate an extractable
 * keypair, export PKCS8 as base64url, seed localStorage exactly as the old
 * createNewIdentity() would have. The throwaway key never leaves the test.
 */
async function seedLegacyLocalStorageIdentity(): Promise<{
  deviceId: string
  publicKeyBase64: string
}> {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey)
  const privPkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
  const deviceId = await sha256Hex(pubRaw)
  const publicKeyBase64 = toBase64Url(pubRaw)
  const privateKeyBase64 = toBase64Url(privPkcs8)

  localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
  localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)
  localStorage.setItem(STORAGE_PRIVKEY_LEGACY, privateKeyBase64)

  return { deviceId, publicKeyBase64 }
}

describe('device-identity (PR #574 hardening)', () => {
  let store: DeviceIdentityStore

  beforeEach(() => {
    localStorage.clear()
    store = createMemoryDeviceIdentityStore()
    __setDeviceIdentityStoreForTests(store)
  })

  afterEach(() => {
    __setDeviceIdentityStoreForTests(null)
    localStorage.clear()
  })

  describe('fresh install (no prior state)', () => {
    it('generates a non-extractable Ed25519 keypair', async () => {
      const id = await getOrCreateDeviceIdentity()

      expect(id.privateKey.extractable).toBe(false)
      expect(id.privateKey.algorithm).toMatchObject({ name: 'Ed25519' })
      expect(id.privateKey.usages).toEqual(expect.arrayContaining(['sign']))
    })

    it('refuses to export the private key as PKCS8', async () => {
      const id = await getOrCreateDeviceIdentity()
      await expect(
        crypto.subtle.exportKey('pkcs8', id.privateKey)
      ).rejects.toBeDefined()
    })

    it('does NOT write the legacy localStorage privkey under any circumstance', async () => {
      await getOrCreateDeviceIdentity()
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBeNull()
    })

    it('persists deviceId + pubkey in localStorage but NOT the private key', async () => {
      const id = await getOrCreateDeviceIdentity()

      expect(localStorage.getItem(STORAGE_DEVICE_ID)).toBe(id.deviceId)
      expect(localStorage.getItem(STORAGE_PUBKEY)).toBe(id.publicKeyBase64)
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBeNull()
    })

    it('is stable across calls (same key + deviceId on second invocation)', async () => {
      const a = await getOrCreateDeviceIdentity()
      const b = await getOrCreateDeviceIdentity()

      expect(b.deviceId).toBe(a.deviceId)
      expect(b.publicKeyBase64).toBe(a.publicKeyBase64)
      // Same CryptoKey reference because it's loaded back from the in-memory store.
      expect(b.privateKey).toBe(a.privateKey)
    })
  })

  describe('legacy paired user → migration', () => {
    it('migrates: same deviceId + pubkey, legacy privkey removed, IDB populated', async () => {
      const seeded = await seedLegacyLocalStorageIdentity()

      const id = await getOrCreateDeviceIdentity()

      expect(id.deviceId).toBe(seeded.deviceId)
      expect(id.publicKeyBase64).toBe(seeded.publicKeyBase64)
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBeNull()
      expect(await store.load()).not.toBeNull()
    })

    it('migrated key is non-extractable', async () => {
      await seedLegacyLocalStorageIdentity()
      const id = await getOrCreateDeviceIdentity()

      expect(id.privateKey.extractable).toBe(false)
      await expect(
        crypto.subtle.exportKey('pkcs8', id.privateKey)
      ).rejects.toBeDefined()
    })

    it('migrated key still produces a valid signature against the original public key', async () => {
      await seedLegacyLocalStorageIdentity()
      const id = await getOrCreateDeviceIdentity()

      const challenge = new TextEncoder().encode('mc-test-challenge')
      const sig = await crypto.subtle.sign('Ed25519', id.privateKey, challenge)

      // Re-import the public key (raw form) and verify.
      const pubRawBytes = Uint8Array.from(atob(
        localStorage.getItem(STORAGE_PUBKEY)!.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (localStorage.getItem(STORAGE_PUBKEY)!.length % 4)) % 4)
      ), c => c.charCodeAt(0))
      const importedPub = await crypto.subtle.importKey(
        'raw',
        pubRawBytes as unknown as BufferSource,
        'Ed25519',
        false,
        ['verify']
      )

      const ok = await crypto.subtle.verify('Ed25519', importedPub, sig, challenge)
      expect(ok).toBe(true)
    })

    it('is idempotent: a second call after migration is a no-op', async () => {
      await seedLegacyLocalStorageIdentity()
      const first = await getOrCreateDeviceIdentity()
      const second = await getOrCreateDeviceIdentity()

      expect(second.deviceId).toBe(first.deviceId)
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBeNull()
    })
  })

  describe('fail-closed semantics (Đào AC)', () => {
    it('throws DeviceIdentityUnavailableError when IndexedDB store throws on persist', async () => {
      await seedLegacyLocalStorageIdentity()

      const brokenStore: DeviceIdentityStore = {
        async store() {
          throw new Error('simulated IndexedDB failure')
        },
        async load() {
          return null
        },
        async clear() {
          /* noop */
        },
      }
      __setDeviceIdentityStoreForTests(brokenStore)

      await expect(getOrCreateDeviceIdentity()).rejects.toBeInstanceOf(
        DeviceIdentityUnavailableError
      )

      // The legacy key must NOT have been removed when migration failed.
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).not.toBeNull()
    })

    it('throws DeviceIdentityUnavailableError when verify-read returns null', async () => {
      await seedLegacyLocalStorageIdentity()

      const lyingStore: DeviceIdentityStore = {
        async store() {
          /* pretend success */
        },
        async load() {
          return null
        },
        async clear() {
          /* noop */
        },
      }
      __setDeviceIdentityStoreForTests(lyingStore)

      await expect(getOrCreateDeviceIdentity()).rejects.toBeInstanceOf(
        DeviceIdentityUnavailableError
      )
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).not.toBeNull()
    })

    it('NEVER writes raw PKCS8 back to localStorage on any failure path', async () => {
      await seedLegacyLocalStorageIdentity()
      const beforePriv = localStorage.getItem(STORAGE_PRIVKEY_LEGACY)

      const brokenStore: DeviceIdentityStore = {
        async store() {
          throw new Error('IDB exploded')
        },
        async load() {
          return null
        },
        async clear() {
          /* noop */
        },
      }
      __setDeviceIdentityStoreForTests(brokenStore)

      await expect(getOrCreateDeviceIdentity()).rejects.toBeInstanceOf(
        DeviceIdentityUnavailableError
      )

      // Legacy key untouched (still the same value, not re-serialized PKCS8 from a fresh keypair).
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBe(beforePriv)
    })

    it('rejects a corrupt legacy localStorage privkey', async () => {
      await seedLegacyLocalStorageIdentity()
      localStorage.setItem(STORAGE_PRIVKEY_LEGACY, 'this-is-not-a-valid-pkcs8-blob')

      await expect(getOrCreateDeviceIdentity()).rejects.toBeInstanceOf(
        DeviceIdentityUnavailableError
      )
    })
  })

  describe('clearDeviceIdentity', () => {
    it('clears localStorage AND the IndexedDB-backed key', async () => {
      const id = await getOrCreateDeviceIdentity()
      // Seed BOTH a sessionStorage token (the new home) and a legacy
      // localStorage token (the pre-Phase-1.7 home). clearDeviceIdentity
      // must wipe both so a re-pair never inherits stale credentials.
      sessionStorage.setItem(STORAGE_DEVICE_TOKEN, 'session-token')
      localStorage.setItem(STORAGE_DEVICE_TOKEN, 'legacy-localstorage-token')

      // Sanity precondition.
      expect(await store.load()).not.toBeNull()
      expect(id).toBeDefined()

      await clearDeviceIdentity()

      expect(localStorage.getItem(STORAGE_DEVICE_ID)).toBeNull()
      expect(localStorage.getItem(STORAGE_PUBKEY)).toBeNull()
      expect(localStorage.getItem(STORAGE_PRIVKEY_LEGACY)).toBeNull()
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
      expect(sessionStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
      expect(await store.load()).toBeNull()
    })
  })

  // Phase 1.7 — mc-device-token storage migration
  describe('mc-device-token storage (Phase 1.7)', () => {
    beforeEach(() => {
      sessionStorage.clear()
    })

    it('cacheDeviceToken writes to sessionStorage, not localStorage', () => {
      cacheDeviceToken('opaque-token-A')
      expect(sessionStorage.getItem(STORAGE_DEVICE_TOKEN)).toBe('opaque-token-A')
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
    })

    it('getCachedDeviceToken reads from sessionStorage', () => {
      sessionStorage.setItem(STORAGE_DEVICE_TOKEN, 'opaque-token-B')
      expect(getCachedDeviceToken()).toBe('opaque-token-B')
    })

    it('getCachedDeviceToken returns null when nothing is cached', () => {
      expect(getCachedDeviceToken()).toBeNull()
    })

    it('getCachedDeviceToken cleans up legacy localStorage token WITHOUT promoting it', () => {
      // Pre-Phase-1.7 build wrote the token to localStorage. After this PR
      // the helper must drop it on first read so it cannot continue under
      // the new scope; the caller will re-mint via fresh handshake.
      localStorage.setItem(STORAGE_DEVICE_TOKEN, 'pre-phase17-token')
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBe('pre-phase17-token')

      const result = getCachedDeviceToken()

      // Returns null: nothing in sessionStorage, and we explicitly do NOT
      // promote the localStorage value.
      expect(result).toBeNull()
      // Legacy entry is removed.
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
      // sessionStorage stays empty (no promotion).
      expect(sessionStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
    })

    it('getCachedDeviceToken returns the sessionStorage value even when a legacy localStorage entry coexists', () => {
      // Stale localStorage from an old build, fresh sessionStorage from a
      // post-Phase-1.7 handshake — sessionStorage wins, localStorage is
      // cleaned up.
      localStorage.setItem(STORAGE_DEVICE_TOKEN, 'stale-legacy')
      sessionStorage.setItem(STORAGE_DEVICE_TOKEN, 'fresh-session')

      expect(getCachedDeviceToken()).toBe('fresh-session')
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
      expect(sessionStorage.getItem(STORAGE_DEVICE_TOKEN)).toBe('fresh-session')
    })

    it('cache + read round-trip uses sessionStorage exclusively', () => {
      cacheDeviceToken('round-trip-token')
      expect(getCachedDeviceToken()).toBe('round-trip-token')
      expect(localStorage.getItem(STORAGE_DEVICE_TOKEN)).toBeNull()
    })
  })
})
