/**
 * Tests for src/lib/injection-guard.ts normalization helpers (PR #4 commit 1).
 *
 * Covers PUBLIC pure functions: stripControlChars, stripZeroWidth,
 * applyConfusablesFold, normalize. Decode strategies + scan refactor
 * are validated separately in later commits.
 *
 * Discipline (per PR #4 design §5.2): test fixtures must use explicit
 * \uXXXX escape notation in source. A CI grep guard at the bottom of
 * this file fails the test run if any literal zero-width byte slips in.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_LENGTH,
  MAX_CANDIDATES,
  MAX_DEPTH,
  MAX_B64_CHUNK,
  MIN_B64_CHUNK,
  ROT13_MIN_LETTERS,
  stripControlChars,
  stripZeroWidth,
  applyConfusablesFold,
  normalize,
} from '@/lib/injection-guard'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('injection-guard constants', () => {
  it('preserves MAX_LENGTH default at 50_000 (no behavior change)', () => {
    expect(MAX_LENGTH).toBe(50_000)
  })

  it('exports DoS bounds for tests to reference', () => {
    expect(MAX_CANDIDATES).toBe(8)
    expect(MAX_DEPTH).toBe(2)
    expect(MAX_B64_CHUNK).toBe(1024)
    expect(MIN_B64_CHUNK).toBe(16)
    expect(ROT13_MIN_LETTERS).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// stripControlChars
// ---------------------------------------------------------------------------

describe('stripControlChars', () => {
  it('removes null bytes', () => {
    expect(stripControlChars('a\u0000b')).toBe('ab')
  })

  it('removes other C0 controls (BEL, BS, VT, FF, SO)', () => {
    expect(stripControlChars('a\u0007b\u0008c\u000Bd\u000Ce\u000Ef')).toBe('abcdef')
  })

  it('preserves tab, line-feed, carriage-return', () => {
    expect(stripControlChars('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('removes DEL (U+007F) and C1 controls (U+0080-U+009F)', () => {
    expect(stripControlChars('a\u007Fb\u0080c\u009Fd')).toBe('abcd')
  })

  it('does not touch printable ASCII or normal Unicode', () => {
    expect(stripControlChars('Hello, world! Xin chào.')).toBe('Hello, world! Xin chào.')
  })

  it('returns empty string unchanged', () => {
    expect(stripControlChars('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// stripZeroWidth
// ---------------------------------------------------------------------------

describe('stripZeroWidth', () => {
  it('removes ZWSP (U+200B) between letters', () => {
    expect(stripZeroWidth('a\u200Bb\u200Bc')).toBe('abc')
  })

  it('removes ZWNJ (U+200C), ZWJ (U+200D), WJ (U+2060), BOM (U+FEFF)', () => {
    expect(stripZeroWidth('x\u200Cy\u200Dz\u2060w\uFEFFv')).toBe('xyzwv')
  })

  it('does not strip normal whitespace', () => {
    expect(stripZeroWidth('a b\tc\nd')).toBe('a b\tc\nd')
  })

  it('does not strip emoji or CJK', () => {
    expect(stripZeroWidth('hello 🌸 chào')).toBe('hello 🌸 chào')
  })

  it('handles a sentence with all five zero-width types interleaved', () => {
    expect(stripZeroWidth('i\u200Bg\u200Cn\u200Do\u2060r\uFEFFe')).toBe('ignore')
  })
})

// ---------------------------------------------------------------------------
// applyConfusablesFold
// ---------------------------------------------------------------------------

describe('applyConfusablesFold', () => {
  it('folds Cyrillic а (U+0430) to Latin a', () => {
    expect(applyConfusablesFold('\u0430')).toBe('a')
  })

  it('folds full Cyrillic-spelled trigger word to Latin', () => {
    // "ignore" spelled with Cyrillic і (U+0456), Cyrillic о (U+043E)
    expect(applyConfusablesFold('\u0456gn\u043Ere')).toBe('ignore')
  })

  it('folds Greek alpha (U+03B1) to Latin a', () => {
    expect(applyConfusablesFold('\u03B1lpha')).toBe('alpha')
  })

  it('preserves Latin letters that have no confusable mapping', () => {
    expect(applyConfusablesFold('Hello, world!')).toBe('Hello, world!')
  })

  it('preserves digits and punctuation', () => {
    expect(applyConfusablesFold('abc 123 -- ok?')).toBe('abc 123 -- ok?')
  })

  it('returns input unchanged when no confusable present', () => {
    expect(applyConfusablesFold('Vietnamese: Xin chào')).toBe('Vietnamese: Xin chào')
  })

  it('handles empty string', () => {
    expect(applyConfusablesFold('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// normalize — full pipeline
// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('returns empty string for null-ish input', () => {
    expect(normalize('')).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normalize(null)).toBe('')
    // @ts-expect-error testing runtime guard
    expect(normalize(undefined)).toBe('')
  })

  it('preserves a benign Vietnamese sentence', () => {
    expect(normalize('Cập nhật dashboard hiển thị trạng thái agent realtime'))
      .toBe('Cập nhật dashboard hiển thị trạng thái agent realtime')
  })

  it('strips zero-width chars BEFORE NFKC (so post-strip text looks clean)', () => {
    // ZWSP between letters of a benign word
    const input = 'h\u200Be\u200Bl\u200Bl\u200Bo'
    expect(normalize(input)).toBe('hello')
  })

  it('strips control chars BEFORE NFKC', () => {
    expect(normalize('he\u0000ll\u000Eo')).toBe('hello')
  })

  it('NFKC folds fullwidth Latin into ASCII', () => {
    // Fullwidth uppercase L (U+FF2C) and others
    const fullwidthHello = '\uFF28\uFF45\uFF4C\uFF4C\uFF4F'
    expect(normalize(fullwidthHello)).toBe('Hello')
  })

  it('confusables fold after NFKC catches Cyrillic look-alikes', () => {
    // Cyrillic і (U+0456), Cyrillic о (U+043E) embedded in Latin word
    expect(normalize('\u0456gn\u043Ere')).toBe('ignore')
  })

  it('combined: zero-width + Cyrillic look-alike (vector #1 + zero-width pre-strip)', () => {
    // \u0456 is Cyrillic і, \u200B is ZWSP between letters
    expect(normalize('\u0456\u200Bgn\u200B\u043Ere')).toBe('ignore')
  })

  it('order is deterministic: control strip, zero-width strip, NFKC, confusables', () => {
    // Construct a string that exercises every step
    const s = 'h\u0000\u200B\uFF45\u0456lo' // null + ZWSP + fullwidth-e + Cyrillic-i + 'lo'
    // After control strip:    h\u200B\uFF45\u0456lo
    // After zero-width strip: h\uFF45\u0456lo
    // After NFKC:             he\u0456lo  (fullwidth-e -> Latin e)
    // After confusables:      heilo
    expect(normalize(s)).toBe('heilo')
  })

  it('does not strip emoji', () => {
    expect(normalize('hello 🌸 world')).toBe('hello 🌸 world')
  })

  it('does not strip Vietnamese diacritics', () => {
    expect(normalize('Xin chào, anh khoẻ không?')).toBe('Xin chào, anh khoẻ không?')
  })
})

// ---------------------------------------------------------------------------
// CI grep guard — fail the test run if any literal zero-width byte
// slipped into THIS test source file. Per PR #4 design §5.2.
// ---------------------------------------------------------------------------

describe('test-source discipline (CI grep guard)', () => {
  it('this test file contains no literal U+200B / U+200C / U+200D / U+2060 / U+FEFF bytes', () => {
    const src = readFileSync(__filename, 'utf8')
    const offending: number[] = []
    const banned = ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]
      if (banned.includes(ch)) offending.push(i)
    }
    expect(offending, 'literal zero-width bytes are forbidden in test source — use \\uXXXX notation').toEqual([])
  })

  it('this test file contains no literal C0/C1 control bytes (except \\t \\n \\r)', () => {
    const src = readFileSync(__filename, 'utf8')
    const offending: number[] = []
    for (let i = 0; i < src.length; i++) {
      const cp = src.charCodeAt(i)
      const isAllowed = cp === 0x09 || cp === 0x0A || cp === 0x0D
      const isC0 = cp < 0x20 && !isAllowed
      const isDelOrC1 = cp === 0x7F || (cp >= 0x80 && cp <= 0x9F)
      if (isC0 || isDelOrC1) offending.push(i)
    }
    expect(offending).toEqual([])
  })
})
