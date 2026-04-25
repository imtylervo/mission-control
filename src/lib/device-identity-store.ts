'use client'

import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('DeviceIdentityStore')

const DB_NAME = 'mc-device-identity'
const DB_VERSION = 1
const DB_STORE = 'keys'
const KEY_PRIVATE = 'device-privkey'

export interface DeviceIdentityStore {
  store(key: CryptoKey): Promise<void>
  load(): Promise<CryptoKey | null>
  clear(): Promise<void>
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

function txRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function createIndexedDbDeviceIdentityStore(
  factory: IDBFactory = globalThis.indexedDB
): DeviceIdentityStore {
  if (!factory) {
    // Caller should treat this as a fail-closed signal and surface re-pair UI.
    throw new Error('IndexedDB unavailable in this browser context')
  }

  return {
    async store(key) {
      const db = await openDb(factory)
      try {
        const tx = db.transaction(DB_STORE, 'readwrite')
        const objStore = tx.objectStore(DB_STORE)
        await txRequest(objStore.put(key, KEY_PRIVATE))
      } finally {
        db.close()
      }
    },

    async load() {
      const db = await openDb(factory)
      try {
        const tx = db.transaction(DB_STORE, 'readonly')
        const objStore = tx.objectStore(DB_STORE)
        const value = await txRequest(objStore.get(KEY_PRIVATE))
        // IndexedDB returns undefined for missing keys.
        if (!value) return null
        // Defensive: structured clone preserves CryptoKey, but if a foreign value
        // somehow ended up under the key, refuse to use it.
        if (typeof CryptoKey !== 'undefined' && !(value instanceof CryptoKey)) {
          log.warn('device-identity store contained non-CryptoKey value, ignoring')
          return null
        }
        return value as CryptoKey
      } finally {
        db.close()
      }
    },

    async clear() {
      const db = await openDb(factory)
      try {
        const tx = db.transaction(DB_STORE, 'readwrite')
        const objStore = tx.objectStore(DB_STORE)
        await txRequest(objStore.delete(KEY_PRIVATE))
      } finally {
        db.close()
      }
    },
  }
}

/**
 * In-memory store for tests. Production code MUST NOT use this.
 */
export function createMemoryDeviceIdentityStore(): DeviceIdentityStore {
  let value: CryptoKey | null = null
  return {
    async store(key) {
      value = key
    },
    async load() {
      return value
    },
    async clear() {
      value = null
    },
  }
}
