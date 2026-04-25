/**
 * Source-discipline check for PR #574 (Đào AC msg 1004):
 *
 *   "production source được read/remove legacy key, không được write;
 *    tests được seed."
 *
 * This test reads the production module(s) and asserts that the legacy
 * localStorage key constant `STORAGE_PRIVKEY_LEGACY` is only ever
 * `getItem`-ed or `removeItem`-ed, never `setItem`-ed.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const PRODUCTION_FILES = [
  'device-identity.ts',
  'device-identity-store.ts',
  'websocket.ts',
]

describe('device-identity source discipline (#574)', () => {
  it('production source must NOT setItem the legacy private key constant', () => {
    for (const file of PRODUCTION_FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')

      // Allow the constant declaration line itself.
      const lines = src.split('\n')
      const offendingLines: Array<{ file: string; line: number; text: string }> = []

      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? ''
        if (
          /\.setItem\(\s*STORAGE_PRIVKEY_LEGACY\b/.test(text) ||
          /\.setItem\(\s*['"]mc-device-privkey['"]/.test(text)
        ) {
          offendingLines.push({ file, line: i + 1, text: text.trim() })
        }
      }

      expect(offendingLines, `${file} must not write the legacy privkey to localStorage`).toEqual([])
    }
  })

  it('legacy private key constant exists with the expected name and value', () => {
    const src = readFileSync(join(ROOT, 'device-identity.ts'), 'utf8')
    expect(src).toMatch(/const STORAGE_PRIVKEY_LEGACY = ['"]mc-device-privkey['"]/)
  })

  it('the new IndexedDB store module exists and exports the expected API', () => {
    const src = readFileSync(join(ROOT, 'device-identity-store.ts'), 'utf8')
    expect(src).toMatch(/export function createIndexedDbDeviceIdentityStore/)
    expect(src).toMatch(/export function createMemoryDeviceIdentityStore/)
    expect(src).toMatch(/export interface DeviceIdentityStore/)
  })
})
