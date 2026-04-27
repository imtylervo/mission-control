/**
 * Source-discipline check for Phase 1.7 (Đào msg 1552 design call):
 *
 *   The `mc-device-token` is bearer-equivalent on the OpenClaw gateway
 *   (see PR #18 / `docs/audit/PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md`).
 *   It must therefore live in `sessionStorage`, not `localStorage`. This test
 *   reads the production module(s) and asserts:
 *
 *   1. No production code WRITES `mc-device-token` to `localStorage`.
 *   2. Production code MAY read `localStorage` for the token only as part of
 *      legacy cleanup, and any such read is paired with a remove call.
 *   3. `cacheDeviceToken` writes via `sessionStorage.setItem`.
 *   4. `getCachedDeviceToken` reads via `sessionStorage.getItem`.
 *   5. The token storage key constant has the expected name and value.
 *
 * The intent matches the existing `device-identity-source-discipline.test.ts`
 * pattern that protects the PR #574 private-key invariant: a future
 * refactor cannot silently drop the storage discipline without tripping a
 * red CI signal.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

// Production source files that may legitimately read or write the token.
// New entries must be added here on purpose, not by accident.
const PRODUCTION_FILES = ['device-identity.ts', 'websocket.ts']

const TOKEN_KEY_LITERAL = "'mc-device-token'"
const TOKEN_KEY_LITERAL_DOUBLE = '"mc-device-token"'

function readSource(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

describe('mc-device-token storage discipline (Phase 1.7)', () => {
  it('production source must NOT call localStorage.setItem for the token', () => {
    for (const file of PRODUCTION_FILES) {
      const src = readSource(file)
      const lines = src.split('\n')
      const offending: Array<{ file: string; line: number; text: string }> = []

      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? ''
        if (
          /\blocalStorage\.setItem\(\s*STORAGE_DEVICE_TOKEN\b/.test(text) ||
          new RegExp(`\\blocalStorage\\.setItem\\(\\s*${TOKEN_KEY_LITERAL}`).test(text) ||
          new RegExp(`\\blocalStorage\\.setItem\\(\\s*${TOKEN_KEY_LITERAL_DOUBLE}`).test(text)
        ) {
          offending.push({ file, line: i + 1, text: text.trim() })
        }
      }

      expect(
        offending,
        `${file} must not write 'mc-device-token' to localStorage (it is bearer-equivalent — sessionStorage only)`
      ).toEqual([])
    }
  })

  it('production source must NOT call localStorage.getItem for the token outside of legacy cleanup', () => {
    // We allow reads only when the same line later removes the entry, which
    // is how the legacy migration shim works. A bare getItem without a
    // matching remove suggests the token is being consumed from
    // localStorage, which would re-open the bearer-exfil path.
    for (const file of PRODUCTION_FILES) {
      const src = readSource(file)
      const lines = src.split('\n')
      const offending: Array<{ file: string; line: number; text: string }> = []

      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? ''
        const isGet =
          /\blocalStorage\.getItem\(\s*STORAGE_DEVICE_TOKEN\b/.test(text) ||
          new RegExp(`\\blocalStorage\\.getItem\\(\\s*${TOKEN_KEY_LITERAL}`).test(text) ||
          new RegExp(`\\blocalStorage\\.getItem\\(\\s*${TOKEN_KEY_LITERAL_DOUBLE}`).test(text)
        if (!isGet) continue

        // Look at a small window around the match for a removeItem; the
        // legacy cleanup pattern in device-identity.ts:getCachedDeviceToken
        // does `if (local.getItem(...) !== null) local.removeItem(...)`.
        const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join('\n')
        const hasRemove =
          /\blocalStorage\.removeItem\(\s*STORAGE_DEVICE_TOKEN\b/.test(window) ||
          /\blocal\.removeItem\(\s*STORAGE_DEVICE_TOKEN\b/.test(window) ||
          new RegExp(`\\blocal(Storage)?\\.removeItem\\(\\s*${TOKEN_KEY_LITERAL}`).test(window) ||
          new RegExp(`\\blocal(Storage)?\\.removeItem\\(\\s*${TOKEN_KEY_LITERAL_DOUBLE}`).test(window)

        if (!hasRemove) {
          offending.push({ file, line: i + 1, text: text.trim() })
        }
      }

      expect(
        offending,
        `${file} reads 'mc-device-token' from localStorage outside of legacy cleanup`
      ).toEqual([])
    }
  })

  it('cacheDeviceToken writes via sessionStorage.setItem', () => {
    const src = readSource('device-identity.ts')
    // Locate the function block.
    const fn = src.match(/export function cacheDeviceToken[\s\S]*?\n\}/)
    expect(fn, 'cacheDeviceToken must be exported from device-identity.ts').not.toBeNull()
    const body = fn![0]
    expect(body, 'cacheDeviceToken must use sessionStorage.setItem').toMatch(
      /\bsession\.setItem\(\s*STORAGE_DEVICE_TOKEN\b|\bsessionStorage\.setItem\(\s*STORAGE_DEVICE_TOKEN\b/
    )
    expect(body, 'cacheDeviceToken must NOT use localStorage.setItem').not.toMatch(
      /\blocalStorage\.setItem\(/
    )
  })

  it('getCachedDeviceToken reads via sessionStorage.getItem and may clean up legacy localStorage', () => {
    const src = readSource('device-identity.ts')
    const fn = src.match(/export function getCachedDeviceToken[\s\S]*?\n\}/)
    expect(fn, 'getCachedDeviceToken must be exported from device-identity.ts').not.toBeNull()
    const body = fn![0]
    expect(body, 'getCachedDeviceToken must read sessionStorage').toMatch(
      /\bsession\.getItem\(\s*STORAGE_DEVICE_TOKEN\b|\bsessionStorage\.getItem\(\s*STORAGE_DEVICE_TOKEN\b/
    )
    expect(
      body,
      'getCachedDeviceToken must clean up any legacy localStorage entry'
    ).toMatch(
      /\blocal\.removeItem\(\s*STORAGE_DEVICE_TOKEN\b|\blocalStorage\.removeItem\(\s*STORAGE_DEVICE_TOKEN\b/
    )
  })

  it('the token storage key constant has the expected name and value', () => {
    const src = readSource('device-identity.ts')
    expect(src).toMatch(/const STORAGE_DEVICE_TOKEN = ['"]mc-device-token['"]/)
  })
})
