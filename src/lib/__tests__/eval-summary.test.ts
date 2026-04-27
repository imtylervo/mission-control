/**
 * Phase 5.2 — pure helpers for the Shadow/eval score panel.
 *
 * eval-summary.ts is the UI-facing roll-up layer on top of the engine in
 * agent-evals.ts. These tests pin the four exports (summarizeEvalResults,
 * computePromotionReadiness, extractRecentFailures, formatRubric) so a
 * future panel refactor cannot regress the consumer shape.
 */

import { describe, expect, it } from 'vitest'
import {
  summarizeEvalResults,
  computePromotionReadiness,
  extractRecentFailures,
  formatRubric,
  type EvalSummary,
} from '@/lib/eval-summary'
import type { EvalLayer, EvalResult, DriftResult } from '@/lib/agent-evals'

function mkResult(layer: EvalLayer, score: number, passed: boolean, detail = ''): EvalResult {
  return { layer, score, passed, detail }
}

describe('summarizeEvalResults', () => {
  it('returns zero-state for empty input', () => {
    const r = summarizeEvalResults([])
    expect(r.total).toBe(0)
    expect(r.passed).toBe(0)
    expect(r.passRate).toBe(0)
    expect(r.layerStatus).toEqual({
      output: 'unknown',
      trace: 'unknown',
      component: 'unknown',
      drift: 'unknown',
    })
  })

  it('marks PASS / FAIL per layer based on EvalResult.passed', () => {
    const r: EvalSummary = summarizeEvalResults([
      mkResult('output', 0.8, true),
      mkResult('trace', 0.3, false),
      mkResult('component', 0.95, true),
    ])
    expect(r.total).toBe(3)
    expect(r.passed).toBe(2)
    expect(r.passRate).toBe(0.67)
    expect(r.layerStatus.output).toBe('pass')
    expect(r.layerStatus.trace).toBe('fail')
    expect(r.layerStatus.component).toBe('pass')
    expect(r.layerStatus.drift).toBe('unknown')  // not present
  })

  it('"most recent eval wins" when a layer is repeated', () => {
    const r = summarizeEvalResults([
      mkResult('output', 0.5, false),
      mkResult('output', 0.9, true),  // wins
    ])
    expect(r.layerStatus.output).toBe('pass')
    // Both increment counters though — pass-rate is over the row count.
    expect(r.total).toBe(2)
    expect(r.passed).toBe(1)
    expect(r.passRate).toBe(0.5)
  })

  it('rounds passRate to 2 dp', () => {
    const r = summarizeEvalResults([
      mkResult('output', 1, true),
      mkResult('trace', 0, false),
      mkResult('component', 0, false),
    ])
    expect(r.passRate).toBe(0.33)
  })
})

describe('computePromotionReadiness', () => {
  it('returns "no-data" when there are zero EvalResults', () => {
    expect(computePromotionReadiness([])).toBe('no-data')
    expect(computePromotionReadiness([], [])).toBe('no-data')
  })

  it('returns "ready" when ALL layers passed and there is no drift', () => {
    const r = computePromotionReadiness([
      mkResult('output', 0.9, true),
      mkResult('trace', 0.95, true),
      mkResult('component', 0.99, true),
      mkResult('drift', 1.0, true),
    ], [])
    expect(r).toBe('ready')
  })

  it('returns "partial" when some layers failed but no drift block', () => {
    const r = computePromotionReadiness([
      mkResult('output', 0.9, true),
      mkResult('trace', 0.3, false),
    ])
    expect(r).toBe('partial')
  })

  it('returns "blocked" when ANY drift entry is drifted=true (overrides all-passed)', () => {
    const allPass = [
      mkResult('output', 0.9, true),
      mkResult('trace', 0.95, true),
      mkResult('component', 0.99, true),
    ]
    const drift: DriftResult[] = [
      { metric: 'p95_ms', current: 1200, baseline: 800, delta: 400, drifted: true, threshold: 200 },
    ]
    expect(computePromotionReadiness(allPass, drift)).toBe('blocked')
  })

  it('drift entries with drifted=false do NOT block promotion', () => {
    const allPass = [mkResult('output', 0.9, true)]
    const drift: DriftResult[] = [
      { metric: 'p95_ms', current: 800, baseline: 800, delta: 0, drifted: false, threshold: 200 },
    ]
    expect(computePromotionReadiness(allPass, drift)).toBe('ready')
  })
})

describe('extractRecentFailures', () => {
  it('filters to passed=falsey rows, sorts DESC by created_at, applies limit', () => {
    const history = [
      { eval_layer: 'output', score: 0.4, passed: 0, detail: 'old fail',     created_at: 1700000000 },
      { eval_layer: 'trace',  score: 0.6, passed: 0, detail: 'mid fail',     created_at: 1700001000 },
      { eval_layer: 'output', score: 0.9, passed: 1, detail: 'recent pass',  created_at: 1700002000 },
      { eval_layer: 'drift',  score: 0.2, passed: 0, detail: 'newest fail',  created_at: 1700003000 },
    ]
    const r = extractRecentFailures(history, 2)
    expect(r).toHaveLength(2)
    expect(r[0].layer).toBe('drift')   // newest first
    expect(r[0].detail).toBe('newest fail')
    expect(r[1].layer).toBe('trace')   // mid
    // The "old fail" exists in input but is dropped by limit=2.
  })

  it('skips rows with missing `passed` (treated as unknown, not failure)', () => {
    const history = [
      { eval_layer: 'output', score: 0.5, detail: 'no passed field', created_at: 1700000000 },
      { eval_layer: 'trace',  score: 0.4, passed: false, detail: 'real fail', created_at: 1700001000 },
    ]
    const r = extractRecentFailures(history)
    expect(r).toHaveLength(1)
    expect(r[0].layer).toBe('trace')
  })

  it('returns empty array for empty history or all-pass history', () => {
    expect(extractRecentFailures([])).toEqual([])
    expect(extractRecentFailures([
      { eval_layer: 'output', score: 0.9, passed: 1, created_at: 1 },
    ])).toEqual([])
  })

  it('default limit is 5', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      eval_layer: 'output',
      score: 0.1,
      passed: 0,
      detail: `f${i}`,
      created_at: 1700000000 + i,
    }))
    expect(extractRecentFailures(history)).toHaveLength(5)
  })
})

describe('formatRubric', () => {
  it('returns a rubric string per known layer', () => {
    expect(formatRubric('output')).toMatch(/Pass.*0\.7/)
    expect(formatRubric('trace')).toMatch(/Looping/)
    expect(formatRubric('component')).toMatch(/Pass.*0\.9/)
    expect(formatRubric('drift')).toMatch(/baseline/)
  })

  it('returns a fallback string for an unknown layer', () => {
    expect(formatRubric('not-a-layer' as any)).toBe('Unknown rubric.')
  })
})
