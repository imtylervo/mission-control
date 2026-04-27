/**
 * Phase 5.4 — locale structure pin.
 *
 * Each locale's messages/<code>.json must have the SAME top-level group
 * keys as messages/en.json. next-intl throws MISSING_MESSAGE at request
 * time when a key referenced in a component is absent from the active
 * locale; pinning structure at the test layer catches regressions before
 * a real user hits an untranslated panel.
 *
 * The test does NOT require every leaf string to be translated — locales
 * may legitimately fall through to the English source for low-traffic
 * surfaces (and Phase 5.4 explicitly translates only the high-impact
 * Tyler-facing groups). It only requires the SHAPE to match so no
 * `useTranslations('panel')` call hits an undefined namespace.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locales, defaultLocale, localeNames, type Locale } from '@/i18n/config'

const REPO_ROOT = join(__dirname, '..', '..', '..')

function loadLocale(code: string): Record<string, unknown> {
  const path = join(REPO_ROOT, 'messages', `${code}.json`)
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw)
}

const enJson = loadLocale(defaultLocale)
const enTopLevel = new Set(Object.keys(enJson))

describe('locale structure (Phase 5.4)', () => {
  it('every locale in src/i18n/config.ts has a corresponding messages/<code>.json file', () => {
    for (const code of locales) {
      // Should not throw.
      const loaded = loadLocale(code)
      expect(loaded).toBeTypeOf('object')
      expect(Object.keys(loaded).length).toBeGreaterThan(0)
    }
  })

  it('every locale has the same top-level group keys as en.json', () => {
    for (const code of locales) {
      if (code === defaultLocale) continue
      const json = loadLocale(code)
      const top = new Set(Object.keys(json))
      const missing = [...enTopLevel].filter((k) => !top.has(k))
      const extra = [...top].filter((k) => !enTopLevel.has(k))
      expect(
        missing,
        `locale ${code} is missing top-level groups: ${missing.join(', ')}`,
      ).toEqual([])
      expect(
        extra,
        `locale ${code} has extra top-level groups not in en.json: ${extra.join(', ')}`,
      ).toEqual([])
    }
  })

  it('every locale in `locales` has a human-readable name in `localeNames`', () => {
    for (const code of locales) {
      expect(localeNames[code as Locale]).toBeTypeOf('string')
      expect(localeNames[code as Locale].length).toBeGreaterThan(0)
    }
  })

  it('Vietnamese (vi) is registered (Phase 5.4 deliverable)', () => {
    expect(locales).toContain('vi')
    expect(localeNames['vi' as Locale]).toBe('Tiếng Việt')
  })

  it('Vietnamese (vi) has at least common.save translated to a non-English value', () => {
    const vi = loadLocale('vi') as { common?: { save?: string } }
    expect(vi.common?.save).toBeDefined()
    expect(vi.common?.save).not.toBe('Save')   // proves it's actually translated
    expect(vi.common?.save).toBe('Lưu')        // pin the specific translation
  })
})
