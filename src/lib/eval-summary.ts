/**
 * Phase 5.2 — pure helpers for the Shadow/eval score panel.
 *
 * The eval engine in `agent-evals.ts` produces per-layer `EvalResult`s and
 * `DriftResult`s. The Mission Control UI needs to render four things from
 * those raw outputs:
 *
 *   1. Eval phase / per-layer status (PASS / FAIL / N/A)
 *   2. Rubric (human-readable description of what each layer checks)
 *   3. Aggregate pass rate / score
 *   4. Promotion readiness signal (ready / partial / blocked / no-data)
 *   5. Recent failures (most recent N failed eval rows from history)
 *
 * Keep this file pure (no DB / no I/O) so it is unit-testable without
 * fixtures and can be consumed identically by SSR, client components, and
 * any future CLI summary command.
 */

import type { EvalLayer, EvalResult, DriftResult } from '@/lib/agent-evals'

export interface EvalSummary {
  total: number
  passed: number
  passRate: number  // 0..1, rounded to 2 dp
  layerStatus: Record<EvalLayer, 'pass' | 'fail' | 'unknown'>
}

export type PromotionReadiness = 'ready' | 'partial' | 'blocked' | 'no-data'

export interface EvalHistoryRow {
  eval_layer?: string
  score?: number
  passed?: number | boolean
  detail?: string
  created_at?: number  // unix seconds
}

export interface RecentFailure {
  layer: string
  score: number
  detail: string
  when: number  // unix seconds, may be 0 when missing
}

/**
 * Roll up an array of EvalResult into pass/total counts plus a per-layer
 * status map. Layers that did NOT appear in `results` are reported as
 * `'unknown'`. Layers that appear multiple times take the LAST entry's
 * verdict (consistent with "most recent eval wins" semantics).
 */
export function summarizeEvalResults(results: EvalResult[]): EvalSummary {
  const layerStatus: Record<EvalLayer, 'pass' | 'fail' | 'unknown'> = {
    output: 'unknown',
    trace: 'unknown',
    component: 'unknown',
    drift: 'unknown',
  }

  let total = 0
  let passed = 0

  for (const r of results) {
    total += 1
    if (r.passed) passed += 1
    layerStatus[r.layer] = r.passed ? 'pass' : 'fail'
  }

  const passRate = total > 0 ? Math.round((passed / total) * 100) / 100 : 0

  return { total, passed, passRate, layerStatus }
}

/**
 * Aggregate eval + drift signal into a single promotion-readiness verdict.
 *
 * Rules:
 *   - `'no-data'`     when there are zero EvalResults (engine hasn't run yet).
 *   - `'blocked'`     when ANY DriftResult.drifted === true (regression
 *                     beyond threshold trumps everything else).
 *   - `'ready'`       when ALL EvalResults passed AND no drift is reported.
 *   - `'partial'`     otherwise (some passed, some failed, no drift block).
 *
 * Drift takes precedence so an agent that "passed" all four layers but
 * regressed against its rolling baseline cannot be promoted on a stale
 * green light.
 */
export function computePromotionReadiness(
  results: EvalResult[],
  drift?: DriftResult[],
): PromotionReadiness {
  if (results.length === 0) return 'no-data'

  if (drift && drift.some((d) => d.drifted)) return 'blocked'

  const allPassed = results.every((r) => r.passed)
  if (allPassed) return 'ready'

  return 'partial'
}

/**
 * Extract the most recent failures from a historical `eval_runs` query.
 * Filters to rows where `passed` is falsey, sorts by `created_at` DESC,
 * and limits to `limit` (default 5).
 *
 * SQLite stores `passed` as 0 / 1 — both number-falsey-zero and boolean-
 * false are treated as a failure. Missing `passed` is treated as
 * "unknown, skip" (NOT a failure) so a row without that column does not
 * pollute the feed.
 */
export function extractRecentFailures(
  history: EvalHistoryRow[],
  limit: number = 5,
): RecentFailure[] {
  const failed = history.filter((row) => row.passed !== undefined && !row.passed)

  failed.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))

  return failed.slice(0, limit).map((row) => ({
    layer: String(row.eval_layer ?? 'unknown'),
    score: typeof row.score === 'number' ? row.score : 0,
    detail: String(row.detail ?? ''),
    when: row.created_at ?? 0,
  }))
}

/**
 * Human-readable rubric description per eval layer. Used by the UI to
 * explain WHAT the score means without forcing the operator to read
 * `agent-evals.ts`.
 */
export function formatRubric(layer: EvalLayer): string {
  switch (layer) {
    case 'output':
      return 'Task completion + correctness over recent window. Pass ≥ 0.7.'
    case 'trace':
      return 'Reasoning convergence — tool-call diversity vs total calls. Looping (ratio > 3.0) fails.'
    case 'component':
      return 'Tool reliability — MCP call success rate. Pass ≥ 0.9.'
    case 'drift':
      return 'Rolling-baseline regression check. Any metric beyond its threshold blocks promotion.'
    default:
      return 'Unknown rubric.'
  }
}
