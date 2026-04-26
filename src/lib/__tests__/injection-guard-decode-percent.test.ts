/**
 * Tests for decodePercent (PR #4 commit 2b).
 *
 * Covers the percent-encoding decode strategy in isolation.
 * scanForInjection wiring lands in commit 3 and is NOT tested here.
 *
 * Fixture discipline (per Đào caveats msg 1208 / 1213): trigger-keyword
 * fixtures are assembled from neutral pieces at runtime so the source file
 * does not contain literal full attack templates.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePercent } from '@/lib/injection-guard'

// ---------------------------------------------------------------------------
// Empty / no-trigger
// ---------------------------------------------------------------------------

describe('decodePercent — empty + no-trigger', () => {
  it('returns [] for empty input', () => {
    expect(decodePercent('')).toEqual([])
  })

  it('returns [] for null-ish input', () => {
    // @ts-expect-error testing runtime guard
    expect(decodePercent(null)).toEqual([])
    // @ts-expect-error testing runtime guard
    expect(decodePercent(undefined)).toEqual([])
  })

  it('returns [] when input contains no %XX triple', () => {
    expect(decodePercent('Hello, world! Just a normal sentence.')).toEqual([])
  })

  it('returns [] for a lone percent sign with no hex digits', () => {
    expect(decodePercent('100% sure')).toEqual([])
  })

  it('returns [] when decoded form is identical to input', () => {
    // %XX trigger pattern but decodeURIComponent will throw on %XX with
    // non-hex letters; this case has VALID %20 -> ' ' so decoded differs.
    // Use a different angle: input is already-decoded, no %XX present.
    expect(decodePercent('hello world')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Happy path — benign + non-attack
// ---------------------------------------------------------------------------

describe('decodePercent — benign decode', () => {
  it('decodes hello%20world to "hello world" (Đào caveat msg 1213)', () => {
    expect(decodePercent('hello%20world')).toEqual(['hello world'])
  })

  it('decodes URL-encoded punctuation', () => {
    expect(decodePercent('%20%21%22')).toEqual([' !"'])
  })

  it('decodes a UTF-8 multi-byte sequence', () => {
    // %E4%B8%AD is the UTF-8 encoding of U+4E2D ("middle" / 中)
    expect(decodePercent('%E4%B8%AD')).toEqual(['中'])
  })

  it('decodes a percent-encoded query string', () => {
    expect(decodePercent('?q=hello%20world&page=2')).toEqual(['?q=hello world&page=2'])
  })

  it('decodes a Vietnamese fragment correctly', () => {
    // %E1%BA%A1 = á (U+1EA1), %20 = space
    expect(decodePercent('Xin%20ch%C3%A0o')).toEqual(['Xin chào'])
  })
})

// ---------------------------------------------------------------------------
// Malformed input — fail-soft
// ---------------------------------------------------------------------------

describe('decodePercent — malformed input fail-soft', () => {
  it('returns [] when given an invalid escape (%ZZ)', () => {
    expect(decodePercent('%ZZ%69gnore')).toEqual([])
  })

  it('returns [] when given a truncated escape (%6)', () => {
    expect(decodePercent('hello%6')).toEqual([])
  })

  it('returns [] when given a stray % at the end', () => {
    expect(decodePercent('hello%')).toEqual([])
  })

  it('returns [] when one of several escapes is malformed', () => {
    // decodeURIComponent throws on first malformed escape
    expect(decodePercent('%20valid%ZZinvalid')).toEqual([])
  })

  it('does not throw on garbage', () => {
    expect(() => decodePercent('%')).not.toThrow()
    expect(() => decodePercent('%%%')).not.toThrow()
    expect(() => decodePercent('%XY%ZW%QQ')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Trigger-keyword case — assembled from pieces (Đào msg 1213)
// ---------------------------------------------------------------------------

describe('decodePercent — trigger-keyword decoding', () => {
  it('decodes a trigger keyword built from pieces at runtime', () => {
    // Build the encoded form from neutral pieces so the source file does
    // not contain a literal full attack template (Đào caveat msg 1213).
    // %69 = "i". Concatenating produces an encoded form of a phrase that
    // the existing prompt-override rule would otherwise flag at scan time.
    const encoded = '%69' + ['gnore', ' previous', ' instructions'].join('')
    const out = decodePercent(encoded)
    // The decoded form is whatever the pieces assemble to. We do NOT scan
    // here (commit 3 covers scan integration); we just confirm the decoder
    // round-trips the input without dropping it.
    expect(out.length).toBe(1)
    expect(out[0].startsWith('i')).toBe(true)
    expect(out[0].includes(' previous')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pure / no-mutation
// ---------------------------------------------------------------------------

describe('decodePercent — pure + no-mutation', () => {
  it('does not mutate the input string', () => {
    const original = 'hello%20world'
    const before = original
    decodePercent(original)
    expect(original).toBe(before)
  })

  it('returns a fresh string array each call (no shared state)', () => {
    const a = decodePercent('hello%20world')
    const b = decodePercent('hello%20world')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Test-source discipline
// ---------------------------------------------------------------------------

describe('test-source discipline (CI grep guards)', () => {
  it('this test file contains no literal zero-width bytes', () => {
    const src = readFileSync(__filename, 'utf8')
    const offending: number[] = []
    const banned = ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']
    for (let i = 0; i < src.length; i++) {
      if (banned.includes(src[i])) offending.push(i)
    }
    expect(offending).toEqual([])
  })

  it('this test file contains no literal C0/C1 control bytes (except tab/LF/CR)', () => {
    const src = readFileSync(__filename, 'utf8')
    const offending: number[] = []
    for (let i = 0; i < src.length; i++) {
      const cp = src.charCodeAt(i)
      const allowed = cp === 0x09 || cp === 0x0A || cp === 0x0D
      const c0 = cp < 0x20 && !allowed
      const c1 = cp === 0x7F || (cp >= 0x80 && cp <= 0x9F)
      if (c0 || c1) offending.push(i)
    }
    expect(offending).toEqual([])
  })
})
