import { describe, expect, it } from 'vitest'
import {
  AVATAR_PERSONAS,
  getPersonaById,
  readPersonaFromAgentConfig,
  buildAvatarConfigPatch,
  deterministicPersonaForName,
} from '@/lib/avatar-gallery'

describe('AVATAR_PERSONAS', () => {
  it('contains at least 8 entries', () => {
    expect(AVATAR_PERSONAS.length).toBeGreaterThanOrEqual(8)
  })

  it('every entry has unique id, non-empty label, non-empty emoji, hue 0..359', () => {
    const ids = new Set<string>()
    for (const p of AVATAR_PERSONAS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/)   // kebab-case constraint
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.emoji.length).toBeGreaterThan(0)
      expect(p.hue).toBeGreaterThanOrEqual(0)
      expect(p.hue).toBeLessThanOrEqual(359)
    }
  })

  it('reserves "mai" and "dao" as the first two entries (Tyler-pinned)', () => {
    expect(AVATAR_PERSONAS[0].id).toBe('mai')
    expect(AVATAR_PERSONAS[1].id).toBe('dao')
  })
})

describe('getPersonaById', () => {
  it('returns the persona for a known id', () => {
    const p = getPersonaById('mai')
    expect(p?.emoji).toBe('🌸')
    expect(p?.label).toContain('Mai')
  })

  it('returns null for null/undefined/empty/unknown ids', () => {
    expect(getPersonaById(null)).toBeNull()
    expect(getPersonaById(undefined)).toBeNull()
    expect(getPersonaById('')).toBeNull()
    expect(getPersonaById('not-in-gallery')).toBeNull()
  })

  it('returns null for non-string ids without throwing', () => {
    expect(getPersonaById(42 as any)).toBeNull()
    expect(getPersonaById({} as any)).toBeNull()
  })
})

describe('readPersonaFromAgentConfig', () => {
  it('reads { avatar: { persona } } shape', () => {
    expect(readPersonaFromAgentConfig({ avatar: { persona: 'mai' } })?.id).toBe('mai')
  })

  it('reads legacy { avatar: "id" } shape', () => {
    expect(readPersonaFromAgentConfig({ avatar: 'dao' })?.id).toBe('dao')
  })

  it('returns null when avatar is missing or unknown', () => {
    expect(readPersonaFromAgentConfig({})).toBeNull()
    expect(readPersonaFromAgentConfig({ avatar: { persona: 'nope' } })).toBeNull()
    expect(readPersonaFromAgentConfig({ avatar: 'nope' })).toBeNull()
    expect(readPersonaFromAgentConfig(null)).toBeNull()
    expect(readPersonaFromAgentConfig(undefined)).toBeNull()
    expect(readPersonaFromAgentConfig('a string' as any)).toBeNull()
  })

  it('does not throw on a config that uses avatar for something unrelated', () => {
    expect(readPersonaFromAgentConfig({ avatar: { something_else: 'x' } })).toBeNull()
  })
})

describe('buildAvatarConfigPatch', () => {
  it('builds the correct patch for a known id', () => {
    expect(buildAvatarConfigPatch('mai')).toEqual({ avatar: { persona: 'mai' } })
  })

  it('builds a clearing patch when personaId is null', () => {
    expect(buildAvatarConfigPatch(null)).toEqual({ avatar: { persona: null } })
  })

  it('throws when given an unknown id (refuses to write garbage)', () => {
    expect(() => buildAvatarConfigPatch('not-a-real-id')).toThrow(/Unknown avatar persona/)
  })
})

describe('deterministicPersonaForName', () => {
  it('returns a persona (never null)', () => {
    const p = deterministicPersonaForName('Mai')
    expect(p).toBeDefined()
    expect(AVATAR_PERSONAS).toContainEqual(p)
  })

  it('is deterministic — same name always picks the same persona', () => {
    expect(deterministicPersonaForName('Đào').id)
      .toBe(deterministicPersonaForName('Đào').id)
    expect(deterministicPersonaForName('mai').id)
      .toBe(deterministicPersonaForName('mai').id)
  })

  it('is case-insensitive', () => {
    expect(deterministicPersonaForName('TYLER').id)
      .toBe(deterministicPersonaForName('tyler').id)
  })

  it('handles null/undefined/empty without throwing', () => {
    expect(deterministicPersonaForName(null)).toBeDefined()
    expect(deterministicPersonaForName(undefined)).toBeDefined()
    expect(deterministicPersonaForName('')).toBeDefined()
  })
})
