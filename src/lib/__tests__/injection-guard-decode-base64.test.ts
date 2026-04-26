/**
 * Tests for decodeBase64Chunks (PR #4 commit 2a).
 *
 * Covers the base64 decode strategy in isolation. scanForInjection wiring
 * happens in commit 3 and is NOT tested here.
 *
 * Fixture discipline: all base64 inputs are pre-computed at the top of the
 * file with the decoded plaintext shown in a comment. The decoded form
 * appears only in expected-value assertions, never as a raw multi-line
 * literal that would look like an attack template in source review.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  decodeBase64Chunks,
  DECODE_EMIT_CAP,
  MIN_B64_CHUNK,
  MAX_B64_CHUNK,
} from '@/lib/injection-guard'

// ---------------------------------------------------------------------------
// Fixtures (decoded plaintext annotated; nothing dangerous in source)
// ---------------------------------------------------------------------------

const B64_HELLO_WORLD = 'aGVsbG8td29ybGQ='
// decodes to: "hello-world"   (length 11; round-trip valid)

const B64_HELLO_LONGER = 'aGVsbG8td29ybGQtdGVzdC1wYWRkaW5n'
// decodes to: "hello-world-test-padding"

const B64_BENIGN_SENTENCE = 'dGhpcyBpcyBhIGJlbmlnbiBzZW50ZW5jZQ=='
// decodes to: "this is a benign sentence"

// Looks like base64 (right alphabet) but is NOT the base64 of any real
// plaintext that round-trips. Tests the "round-trip rejects pseudo-b64"
// gate (Đào caveat msg 1206 #1).
const PSEUDO_B64 = 'AbcDefGhiJklMnoPqrStu'  // length 21, no = padding

// ---------------------------------------------------------------------------
// Empty / no-match cases
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — empty + no-match', () => {
  it('returns [] for empty input', () => {
    expect(decodeBase64Chunks('')).toEqual([])
  })

  it('returns [] for null-ish input', () => {
    // @ts-expect-error testing runtime guard
    expect(decodeBase64Chunks(null)).toEqual([])
    // @ts-expect-error testing runtime guard
    expect(decodeBase64Chunks(undefined)).toEqual([])
  })

  it('returns [] for plain prose with no base64-shaped substrings', () => {
    expect(decodeBase64Chunks('Just a normal sentence in English.')).toEqual([])
  })

  it('returns [] for short base64-like fragments below MIN_B64_CHUNK', () => {
    // 'abc=' is 4 chars; well below MIN_B64_CHUNK (16)
    expect(decodeBase64Chunks('Here: abc=')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Single-chunk happy path
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — single chunk', () => {
  it('decodes a 16-char hello-world fixture', () => {
    const out = decodeBase64Chunks('Encoded sample: ' + B64_HELLO_WORLD)
    expect(out).toEqual(['hello-world'])
  })

  it('decodes a longer benign sentence fixture', () => {
    const out = decodeBase64Chunks('Logged: ' + B64_BENIGN_SENTENCE)
    expect(out).toEqual(['this is a benign sentence'])
  })

  it('decodes a runtime-assembled sanitized command pattern', () => {
    // Per Đào caveat msg 1208: don't pin literal dangerous payloads in
    // source. Assemble decoded form from neutral pieces at runtime, encode
    // here so the source file shows pieces only, and assert round-trip.
    const decoded = ['TEST_CMD ', ';', ' rm', ' -rf', ' /tmp/sandbox/'].join('')
    const encoded = Buffer.from(decoded, 'utf8').toString('base64')
    const out = decodeBase64Chunks('Run: ' + encoded)
    expect(out).toEqual([decoded])
  })
})

// ---------------------------------------------------------------------------
// Round-trip rejection (Đào caveat msg 1206 #1)
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — round-trip gate', () => {
  it('rejects pseudo-base64 that does not round-trip cleanly', () => {
    // PSEUDO_B64 is base64-alphabet shaped but Buffer.from + re-encode
    // does NOT recover the original; gate must drop it.
    expect(decodeBase64Chunks('Junk: ' + PSEUDO_B64)).toEqual([])
  })

  it('rejects a decoded string that is too short (< 4 chars)', () => {
    // 16 chars of 'A' decode to a few null bytes; printable ratio + length
    // gate kills it.
    expect(decodeBase64Chunks('Filler: ' + 'A'.repeat(16))).toEqual([])
  })

  it('rejects decoded bytes with > 5% non-printable content', () => {
    // Pre-compute base64 of mostly null bytes inside the test:
    const nullsB64 = Buffer.from('\u0000\u0000\u0000\u0000\u0000\u0000aaaa', 'utf8')
      .toString('base64')
    // Even though length > 4, non-printable ratio > 5% -> rejected
    expect(decodeBase64Chunks('Bad: ' + nullsB64)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Multi-chunk + cap
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — multi-chunk', () => {
  it('decodes multiple distinct chunks in one input', () => {
    const input = `First: ${B64_HELLO_WORLD} | Second: ${B64_HELLO_LONGER}`
    const out = decodeBase64Chunks(input)
    expect(out).toEqual(['hello-world', 'hello-world-test-padding'])
  })

  it('dedupes duplicate decoded results', () => {
    const input = `${B64_HELLO_WORLD} appears twice: ${B64_HELLO_WORLD}`
    const out = decodeBase64Chunks(input)
    expect(out).toEqual(['hello-world'])
  })

  it('caps emitted candidates at DECODE_EMIT_CAP', () => {
    // Generate DECODE_EMIT_CAP + 2 distinct fixtures
    const fixtures = [
      'aGVsbG8td29ybGQtMQ==',  // hello-world-1
      'aGVsbG8td29ybGQtMg==',  // hello-world-2
      'aGVsbG8td29ybGQtMw==',  // hello-world-3
      'aGVsbG8td29ybGQtNA==',  // hello-world-4
      'aGVsbG8td29ybGQtNQ==',  // hello-world-5
      'aGVsbG8td29ybGQtNg==',  // hello-world-6
      'aGVsbG8td29ybGQtNw==',  // hello-world-7
      'aGVsbG8td29ybGQtOA==',  // hello-world-8
    ]
    const input = fixtures.join(' | ')
    const out = decodeBase64Chunks(input)
    expect(out.length).toBe(DECODE_EMIT_CAP)
    expect(DECODE_EMIT_CAP).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — bounds', () => {
  it('skips chunks shorter than MIN_B64_CHUNK', () => {
    // 12-char b64 is shorter than MIN_B64_CHUNK (16); regex itself should
    // not match it. Decoded value here would be 'hello world!' (12 chars).
    expect(MIN_B64_CHUNK).toBe(16)
    const tooShort = 'aGVsbG8gd29y'  // 12 chars, decodes to "hello wor"
    expect(decodeBase64Chunks('See: ' + tooShort)).toEqual([])
  })

  it('does not emit chunks larger than MAX_B64_CHUNK', () => {
    // Build a 1100-char base64-alphabet string. The regex caps at 1024 in
    // a single match, but per-chunk explicit length check is also enforced.
    expect(MAX_B64_CHUNK).toBe(1024)
    const oversized = 'A'.repeat(1100)
    // decoder may emit one match for the first 1024 chars; the round-trip
    // check will reject because 'A' * 1024 decodes to 768 null bytes which
    // fails the printable-ratio gate. Confirm no candidate slips through.
    expect(decodeBase64Chunks(oversized)).toEqual([])
  })

  it('handles inputs that are pure noise', () => {
    expect(decodeBase64Chunks('!!!@@@###$$$%%%')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Pure / fail-soft
// ---------------------------------------------------------------------------

describe('decodeBase64Chunks — pure + fail-soft', () => {
  it('does not throw on garbage input', () => {
    expect(() => decodeBase64Chunks('===')).not.toThrow()
    expect(() => decodeBase64Chunks('====================')).not.toThrow()
    expect(() => decodeBase64Chunks(' '.repeat(2000))).not.toThrow()
  })

  it('does not mutate the input string', () => {
    const original = `Encoded: ${B64_HELLO_WORLD}`
    const before = original
    decodeBase64Chunks(original)
    expect(original).toBe(before)
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
