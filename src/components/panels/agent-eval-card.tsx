'use client'

import { useEffect, useState } from 'react'
import {
  summarizeEvalResults,
  computePromotionReadiness,
  extractRecentFailures,
  formatRubric,
  type PromotionReadiness,
  type EvalSummary,
  type RecentFailure,
} from '@/lib/eval-summary'
import type { EvalLayer, EvalResult, DriftResult } from '@/lib/agent-evals'

/**
 * Phase 5.2 — Shadow / eval score card.
 *
 * Renders a panel with eval phase + per-layer rubric + score + promotion
 * readiness + recent failures. Consumes helpers from `@/lib/eval-summary`
 * (covered by 15 unit tests in `src/lib/__tests__/eval-summary.test.ts`).
 *
 * Data fetched from `/api/agents/evals?agent=<name>&action=history`. The
 * route is operator-gated; viewers see an empty card with the auth error
 * surfaced as the empty-state hint.
 */

interface Props {
  agentName: string
}

interface EvalsHistoryResponse {
  agent: string
  history: Array<{
    eval_layer?: string
    score?: number
    passed?: number | boolean
    detail?: string
    created_at?: number
  }>
  driftTimeline?: Array<unknown>
  // The route may also return a `current` shape in future; today we
  // synthesize the four-layer current view from the most recent history
  // row per layer.
}

const READINESS_LABEL: Record<PromotionReadiness, string> = {
  ready: 'Ready for promotion',
  partial: 'Partial — some layers failed',
  blocked: 'Blocked — drift detected',
  'no-data': 'No eval data yet',
}

const READINESS_TONE: Record<PromotionReadiness, string> = {
  ready: 'text-emerald-300',
  partial: 'text-amber-300',
  blocked: 'text-red-300',
  'no-data': 'text-muted-foreground',
}

const STATUS_TONE: Record<'pass' | 'fail' | 'unknown', string> = {
  pass: 'text-emerald-300',
  fail: 'text-red-300',
  unknown: 'text-muted-foreground',
}

const LAYER_ORDER: EvalLayer[] = ['output', 'trace', 'component', 'drift']

export function AgentEvalCard({ agentName }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<EvalResult[]>([])
  const [drift, setDrift] = useState<DriftResult[]>([])
  const [recent, setRecent] = useState<RecentFailure[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/agents/evals?agent=${encodeURIComponent(agentName)}&action=history`,
        )
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          if (!cancelled) {
            setError(payload?.error || `HTTP ${res.status}`)
            setResults([])
            setDrift([])
            setRecent([])
          }
          return
        }
        const payload = (await res.json()) as EvalsHistoryResponse
        if (cancelled) return

        // Synthesize the "current" 4-layer view from the most recent history
        // row per layer (history is ORDER BY created_at DESC).
        const seenLayer = new Set<EvalLayer>()
        const synthesized: EvalResult[] = []
        for (const row of payload.history ?? []) {
          const layer = row.eval_layer as EvalLayer | undefined
          if (!layer || !LAYER_ORDER.includes(layer)) continue
          if (seenLayer.has(layer)) continue
          seenLayer.add(layer)
          synthesized.push({
            layer,
            score: typeof row.score === 'number' ? row.score : 0,
            passed: !!row.passed,
            detail: row.detail ?? '',
          })
        }
        setResults(synthesized)
        // Drift timeline shape varies; if route returns DriftResult[] we
        // pass it through. If not, skip — promotion-readiness still works.
        const driftArr = Array.isArray(payload.driftTimeline)
          ? (payload.driftTimeline as DriftResult[])
          : []
        setDrift(driftArr)
        setRecent(extractRecentFailures(payload.history ?? [], 5))
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load eval history')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [agentName])

  const summary: EvalSummary = summarizeEvalResults(results)
  const readiness = computePromotionReadiness(results, drift)

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground">Evals</h4>
        {loading ? (
          <span className="text-xs text-muted-foreground">loading…</span>
        ) : (
          <span className={`text-xs ${READINESS_TONE[readiness]}`}>
            {READINESS_LABEL[readiness]}
          </span>
        )}
      </div>

      {error ? (
        <p className="text-xs text-red-300">Failed to load evals: {error}</p>
      ) : loading ? null : results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No eval runs recorded for this agent yet.
        </p>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3">
            Pass rate: <span className="text-foreground">{summary.passed}/{summary.total}</span>
            {' '}({Math.round(summary.passRate * 100)}%)
          </div>

          <ul className="space-y-2">
            {LAYER_ORDER.map((layer) => {
              const status = summary.layerStatus[layer]
              return (
                <li key={layer} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-foreground capitalize">
                      {layer}
                      {' '}
                      <span className={`ml-1 ${STATUS_TONE[status]}`}>
                        {status === 'pass' ? '✓' : status === 'fail' ? '✗' : '–'}
                      </span>
                    </div>
                    <div className="text-2xs text-muted-foreground/80">
                      {formatRubric(layer)}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {recent.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-foreground/90 mb-1">Recent failures</div>
              <ul className="space-y-1">
                {recent.map((f, i) => (
                  <li key={i} className="text-2xs text-muted-foreground/90">
                    <span className="font-mono text-red-300/90">{f.layer}</span>
                    {f.score > 0 && <> · score {Math.round(f.score * 100) / 100}</>}
                    {f.detail && <> · {f.detail}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
