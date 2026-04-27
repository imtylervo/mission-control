import { describe, expect, it } from 'vitest'
import {
  formatModelName,
  formatProviderName,
  formatProviderRoute,
  formatFullProviderModel,
  buildTaskStatParts,
  extractWsHost,
} from '@/lib/agent-card-helpers'

describe('formatModelName', () => {
  it('strips provider prefix from model ID', () => {
    expect(formatModelName({ model: { primary: 'anthropic/claude-opus-4-5' } }))
      .toBe('claude-opus-4-5')
  })

  it('returns model name when no prefix', () => {
    expect(formatModelName({ model: { primary: 'gpt-4o' } }))
      .toBe('gpt-4o')
  })

  it('handles deeply nested provider path', () => {
    expect(formatModelName({ model: { primary: 'openai/gpt-4/turbo' } }))
      .toBe('turbo')
  })

  it('returns null for missing config', () => {
    expect(formatModelName(null)).toBeNull()
    expect(formatModelName(undefined)).toBeNull()
    expect(formatModelName({})).toBeNull()
  })

  it('returns null for missing model', () => {
    expect(formatModelName({ model: {} })).toBeNull()
    expect(formatModelName({ model: { primary: '' } })).toBeNull()
  })

  it('returns null for non-string primary', () => {
    expect(formatModelName({ model: { primary: 42 } })).toBeNull()
    expect(formatModelName({ model: { primary: true } })).toBeNull()
  })
})

/**
 * Phase 5.1 — provider/model visibility helpers
 */
describe('formatProviderName', () => {
  it('extracts provider prefix from a 2-segment id', () => {
    expect(formatProviderName({ model: { primary: 'anthropic/claude-opus-4-5' } })).toBe('anthropic')
  })

  it('extracts the FIRST segment for a 9router-style nested id', () => {
    expect(formatProviderName({ model: { primary: '9router/cx/gpt-5.5' } })).toBe('9router')
  })

  it('returns null when there is no provider prefix', () => {
    expect(formatProviderName({ model: { primary: 'gpt-4o' } })).toBeNull()
  })

  it('returns null for missing or non-string config', () => {
    expect(formatProviderName(null)).toBeNull()
    expect(formatProviderName({})).toBeNull()
    expect(formatProviderName({ model: { primary: 42 } })).toBeNull()
    expect(formatProviderName({ model: { primary: '' } })).toBeNull()
  })
})

describe('formatProviderRoute', () => {
  it('extracts the middle route segment for 9router/cx/gpt-5.5', () => {
    expect(formatProviderRoute({ model: { primary: '9router/cx/gpt-5.5' } })).toBe('cx')
  })

  it('joins multiple intermediate segments', () => {
    expect(formatProviderRoute({ model: { primary: '9router/cx/proxy/gpt-5.5' } })).toBe('cx/proxy')
  })

  it('returns null for a 2-segment id (provider/model only)', () => {
    expect(formatProviderRoute({ model: { primary: 'anthropic/claude-opus-4-5' } })).toBeNull()
  })

  it('returns null for a 1-segment id (no provider)', () => {
    expect(formatProviderRoute({ model: { primary: 'gpt-4o' } })).toBeNull()
  })

  it('returns null for missing or non-string config', () => {
    expect(formatProviderRoute(null)).toBeNull()
    expect(formatProviderRoute({})).toBeNull()
    expect(formatProviderRoute({ model: { primary: 42 } })).toBeNull()
    expect(formatProviderRoute({ model: { primary: '' } })).toBeNull()
  })
})

describe('formatFullProviderModel', () => {
  it('returns the full id verbatim for nested ids', () => {
    expect(formatFullProviderModel({ model: { primary: '9router/cx/gpt-5.5' } })).toBe('9router/cx/gpt-5.5')
  })

  it('returns the full id verbatim for 2-segment ids', () => {
    expect(formatFullProviderModel({ model: { primary: 'anthropic/claude-opus-4-5' } })).toBe('anthropic/claude-opus-4-5')
  })

  it('returns the model name verbatim when no prefix', () => {
    expect(formatFullProviderModel({ model: { primary: 'gpt-4o' } })).toBe('gpt-4o')
  })

  it('returns null for missing config', () => {
    expect(formatFullProviderModel(null)).toBeNull()
    expect(formatFullProviderModel({})).toBeNull()
  })
})

describe('buildTaskStatParts', () => {
  it('returns null for undefined stats', () => {
    expect(buildTaskStatParts(undefined)).toBeNull()
    expect(buildTaskStatParts(null)).toBeNull()
  })

  it('returns null when all counts are zero', () => {
    expect(buildTaskStatParts({
      total: 0, assigned: 0, in_progress: 0, quality_review: 0, done: 0, completed: 0,
    })).toBeNull()
  })

  it('includes only non-zero counts', () => {
    const result = buildTaskStatParts({
      total: 5, assigned: 3, in_progress: 0, quality_review: 0, done: 2, completed: 0,
    })
    expect(result).toHaveLength(2)
    expect(result![0]).toEqual({ label: 'assigned', count: 3 })
    expect(result![1]).toEqual({ label: 'done', count: 2, color: 'text-emerald-300' })
  })

  it('returns all four parts when all non-zero', () => {
    const result = buildTaskStatParts({
      total: 10, assigned: 3, in_progress: 2, quality_review: 1, done: 4, completed: 0,
    })
    expect(result).toHaveLength(4)
    expect(result!.map(p => p.label)).toEqual(['assigned', 'active', 'review', 'done'])
  })

  it('assigns correct colors to active/review/done', () => {
    const result = buildTaskStatParts({
      total: 6, assigned: 1, in_progress: 2, quality_review: 1, done: 2, completed: 0,
    })!
    expect(result.find(p => p.label === 'assigned')?.color).toBeUndefined()
    expect(result.find(p => p.label === 'active')?.color).toBe('text-amber-300')
    expect(result.find(p => p.label === 'review')?.color).toBe('text-violet-300')
    expect(result.find(p => p.label === 'done')?.color).toBe('text-emerald-300')
  })
})

describe('extractWsHost', () => {
  it('extracts host from ws:// URL', () => {
    expect(extractWsHost('ws://127.0.0.1:18789')).toBe('127.0.0.1:18789')
  })

  it('extracts host from wss:// URL', () => {
    expect(extractWsHost('wss://gateway.example.com')).toBe('gateway.example.com')
  })

  it('extracts host with port from wss:// URL', () => {
    expect(extractWsHost('wss://gateway.example.com:4443')).toBe('gateway.example.com:4443')
  })

  it('returns dash for empty/undefined URL', () => {
    expect(extractWsHost(undefined)).toBe('—')
    expect(extractWsHost('')).toBe('—')
  })

  it('returns dash for malformed URL', () => {
    expect(extractWsHost('not-a-url')).toBe('—')
  })
})
