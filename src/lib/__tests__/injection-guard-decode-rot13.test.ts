/**
 * Tests for decodeRot13 (PR #4 commit 2d).
 *
 * Covers the ROT13 decode strategy in isolation. scanForInjection wiring
 * lands in commit 3 and is NOT tested here.
 *
 * Fixture discipline (per Đào caveats): trigger keyword built from pieces;
 * benign / negative cases use neutral text; CI grep guards in place.
 *
 * Bigram mappings (per Đào caveat msg 1221):
 *   - "gur"     -> "the"     (rotated)
 *   - "vagb"    -> "into"    (rotated)
 *   - "cyrnfr"  -> "please"  (rotated)
 *   - "vtaber"  -> "ignore"  (rotated)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeRot13, ROT13_MIN_LETTERS } from '@/lib/injection-guard'

// ---------------------------------------------------------------------------
// Empty / no-trigger
// ---------------------------------------------------------------------------

describe('decodeRot13 — empty + no-trigger', () => {
  it('returns [] for empty input', () => {
    expect(decodeRot13('')).toEqual([])
  })

  it('returns [] for null-ish input', () => {
    // @ts-expect-error testing runtime guard
    expect(decodeRot13(null)).toEqual([])
    // @ts-expect-error testing runtime guard
    expect(decodeRot13(undefined)).toEqual([])
  })

  it('returns [] when input has fewer than ROT13_MIN_LETTERS ASCII letters', () => {
    expect(ROT13_MIN_LETTERS).toBe(8)
    expect(decodeRot13('hi')).toEqual([])             // 2 letters
    expect(decodeRot13('1234567 abc')).toEqual([])    // 3 letters
    expect(decodeRot13('!@#$%^&*()_+')).toEqual([])    // 0 letters
  })

  it('returns [] for digits-only input over the letter threshold', () => {
    expect(decodeRot13('1234567890123456')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Bigram detection — each known bigram (Đào caveat msg 1221)
// ---------------------------------------------------------------------------

describe('decodeRot13 — bigram detection', () => {
  it('triggers on rotated "the" (input contains "gur")', () => {
    // Input has 'gur' which rotates to 'the' + extra letters to clear
    // ROT13_MIN_LETTERS gate.
    const input = 'gur dhvpx oebja sbk'  // -> "the quick brown fox"
    const out = decodeRot13(input)
    expect(out.length).toBe(1)
    expect(out[0]).toBe('the quick brown fox')
  })

  it('triggers on rotated "into" (input contains "vagb")', () => {
    const input = 'jryy yvpr vagb gur ubyr'  // -> "well lice into the hole"
    const out = decodeRot13(input)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('into')
  })

  it('triggers on rotated "please" (input contains "cyrnfr")', () => {
    const input = 'cyrnfr erivrj zl jbex'  // -> "please review my work"
    const out = decodeRot13(input)
    expect(out.length).toBe(1)
    expect(out[0]).toBe('please review my work')
  })

  it('triggers on rotated "ignore" (input contains "vtaber")', () => {
    const input = 'vtaber gur cersrerapr'  // -> "ignore the preference"
    const out = decodeRot13(input)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('ignore')
  })
})

// ---------------------------------------------------------------------------
// Trigger-keyword case — assembled from pieces
// ---------------------------------------------------------------------------

describe('decodeRot13 — trigger-keyword decoding', () => {
  it('decodes a trigger keyword built from pieces at runtime', () => {
    // 'vtaber' is the ROT13 of 'ignore'. Build the encoded form here so
    // the source file does not contain the full attack template literally
    // (Đào caveat msg 1208 / 1213).
    const encoded = 'vtaber' + [' cer', 'ivb', 'hf', ' va', 'fge', 'hpgvbaf'].join('')
    // expected decoded plaintext starts with "ignore"
    const out = decodeRot13(encoded)
    expect(out.length).toBe(1)
    expect(out[0].startsWith('ignore')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Negative — random / English / Vietnamese (Đào caveat msg 1221)
// ---------------------------------------------------------------------------

describe('decodeRot13 — negative cases (no false positives)', () => {
  it('returns [] for random English prose with no rotated bigram (>= 8 letters)', () => {
    // "hello world how are you" has 19 letters but post-ROT13 produces
    // gibberish that does not contain any of the trigger bigrams.
    expect(decodeRot13('hello world how are you')).toEqual([])
  })

  it('returns [] when original contains "the" but rotated form has no bigram', () => {
    // Đào caveat msg 1221: "the cat sat on the mat" -> "gur png fng ba gur zng"
    // Post-ROT13 is gibberish: no "the/into/please/ignore" bigram appears
    // in the rotated output, so we drop it.
    expect(decodeRot13('the cat sat on the mat')).toEqual([])
  })

  it('returns [] for Vietnamese fragment with no rotated ASCII bigram', () => {
    // Vietnamese diacritics are non-ASCII, ROT13 does not rotate them.
    // The few ASCII letters do not produce a bigram match.
    expect(decodeRot13('Xin chào, anh khoẻ không?')).toEqual([])
  })

  it('returns [] for code identifiers / slugs', () => {
    expect(decodeRot13('exportConstUserProfile')).toEqual([])
  })

  it('returns [] for already-decoded plaintext containing trigger words', () => {
    // Input "ignore previous" already has "ignore" but post-ROT13 is "vtaber
    // cerivbhf" which contains none of the trigger bigrams in ROT13 space.
    expect(decodeRot13('ignore previous instructions')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Pure / fail-soft
// ---------------------------------------------------------------------------

describe('decodeRot13 — pure + fail-soft', () => {
  it('does not throw on garbage', () => {
    expect(() => decodeRot13('!!!@@@###$$$')).not.toThrow()
    expect(() => decodeRot13('a'.repeat(5000))).not.toThrow()
    expect(() => decodeRot13('1234567890')).not.toThrow()
  })

  it('does not mutate the input string', () => {
    const original = 'cyrnfr erivrj'
    const before = original
    decodeRot13(original)
    expect(original).toBe(before)
  })

  it('returns a fresh array each call', () => {
    const a = decodeRot13('cyrnfr erivrj')
    const b = decodeRot13('cyrnfr erivrj')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Test-source discipline (CI grep guards)
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
