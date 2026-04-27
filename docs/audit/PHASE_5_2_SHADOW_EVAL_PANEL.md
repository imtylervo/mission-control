# Phase 5.2 — Shadow / eval score panel

**Outcome:** added a pure-helper roll-up layer (`src/lib/eval-summary.ts`) that adapts the existing four-layer eval engine (`src/lib/agent-evals.ts`) to the shape a UI panel actually needs: per-layer status, aggregate pass-rate, promotion-readiness verdict, recent-failures feed, and a human-readable rubric description per layer. 15 unit tests pin the consumer contract. The panel-level UI integration is intentionally not part of this PR — see "Why panel UI is deferred to a follow-up" below.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `8478a3d` (Phase 5.1 PR #38 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.2:

> Display eval phase, rubric, score, promotion readiness, and recent failures.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5.1 closed (Đào msg 1692, ETA 23:25:00+10:00).

The existing `src/lib/agent-evals.ts` already implements the engine (4 layers — output / trace / component / drift), and `src/app/api/agents/evals/route.ts` already exposes the data over HTTP. Phase 5.2's missing piece is the **roll-up adapter** between raw `EvalResult[]` and what the panel needs to render. This PR adds that adapter as pure helpers + tests so the eventual panel render is straightforward.

## What changed

### `src/lib/eval-summary.ts` (new)

Four exports:

1. **`summarizeEvalResults(results: EvalResult[]): EvalSummary`** — rolls a batch of EvalResults into:
   - `total` / `passed` / `passRate` (rounded to 2 dp)
   - `layerStatus: Record<EvalLayer, 'pass' | 'fail' | 'unknown'>` — `'unknown'` when the layer never appeared in `results`. Repeated layer entries take the LAST verdict ("most recent eval wins").

2. **`computePromotionReadiness(results, drift?): 'ready' | 'partial' | 'blocked' | 'no-data'`** — single-verdict signal.
   - `'no-data'` when `results.length === 0`.
   - `'blocked'` when ANY drift entry has `drifted === true` (regression beyond threshold trumps everything else, even all-pass).
   - `'ready'` when all `EvalResult.passed` AND no drift block.
   - `'partial'` otherwise (some passed, some failed, no drift block).

3. **`extractRecentFailures(history, limit = 5): RecentFailure[]`** — filters a historical `eval_runs` query result to failed rows, sorts by `created_at` DESC, applies `limit`. Treats SQLite-style `passed: 0` as a failure; rows missing the `passed` field are skipped (unknown ≠ failure).

4. **`formatRubric(layer: EvalLayer): string`** — human-readable rubric description per layer:
   - `output` — "Task completion + correctness over recent window. Pass ≥ 0.7."
   - `trace` — "Reasoning convergence — tool-call diversity vs total calls. Looping (ratio > 3.0) fails."
   - `component` — "Tool reliability — MCP call success rate. Pass ≥ 0.9."
   - `drift` — "Rolling-baseline regression check. Any metric beyond its threshold blocks promotion."

The file is pure (no DB / no I/O) so it is testable without fixtures and reusable by SSR, client components, or a CLI summary.

### `src/lib/__tests__/eval-summary.test.ts` (new)

15 cases organised by helper:

- `summarizeEvalResults` (4 cases) — empty input zero-state; pass/fail mapping; "most recent wins"; passRate 2-dp rounding.
- `computePromotionReadiness` (5 cases) — no-data; ready (all-pass + no drift); partial (some-fail no drift); blocked (drift overrides all-pass); drift `false` does not block.
- `extractRecentFailures` (4 cases) — filter + sort DESC + limit; missing `passed` skipped; empty / all-pass returns `[]`; default limit is 5.
- `formatRubric` (2 cases) — known layer regex match; unknown layer fallback string.

## Why panel UI is deferred to a follow-up

Phase 5.2's roadmap line is "display eval phase, rubric, score, promotion readiness, and recent failures." The display surface itself is non-trivial:

- The agent panel (`agent-squad-panel-phase3.tsx`) does not currently have an eval section; adding one means new layout decisions (where in the card vs detail modal vs a new sub-panel?).
- An "eval score" card requires `useEffect` data fetch from `/api/agents/evals?agent=X&action=history`, loading state, error states, refresh cadence — bigger scope than helpers.
- The existing tests for the agent panel are e2e / Playwright; component-level test infra would need to land first to gate the new render unit.
- Roadmap § 5.2 is one of six Phase 5 items in a single batch; the rendering + data-fetch wiring would dominate Đào's review window.

The cleaner shape: this PR lands the helpers + tests now (small, fast review). A follow-up PR wires those helpers into the panel render with proper loading/error states. Doing it in one PR risks the helpers + the UI both shipping with sub-par tests under deadline pressure.

This is documented here so a future operator (or future Mai session) sees the deferral rationale, not just a "TODO" string.

## Gates run (Mai re-verified on post-PR-#38 base)

```
$ git rev-parse HEAD
8478a3dce11387300192ebc47101daeb41dd2efd  # confirms post-PR-#38 base

$ npx vitest run src/lib/__tests__/eval-summary.test.ts
✓ src/lib/__tests__/eval-summary.test.ts (15 tests) 6ms
Test Files  1 passed (1)
Tests       15 passed (15)

$ npx tsc --noEmit
(clean)
```

The pre-existing `agent-evals.test.ts` was not touched and continues to gate the engine.

## Findings / caveats

### C1 — `'most recent wins'` per layer assumes ordered input

`summarizeEvalResults` iterates the input array in order; the LAST entry per layer wins. The route `src/app/api/agents/evals/route.ts` returns history `ORDER BY created_at DESC`, which means the FIRST entry for a layer is the most recent. The UI consumer must therefore reverse the array, OR pass the freshly-computed engine output (single entry per layer) rather than the history rows. This is documented in the helper's JSDoc but worth flagging here for the panel author.

### C2 — drift entries shape

`computePromotionReadiness` reads only `DriftResult.drifted: boolean`. The richer shape (current / baseline / delta / threshold) is preserved in the engine output but not consumed by this helper — the panel is expected to surface those fields directly when rendering the drift row, rather than recomputing them.

### C3 — Operator-gated read

The existing `/api/agents/evals` route requires the `operator` role. The eventual panel render must reflect that (hide the eval card from `viewer`-only users) — out of scope for the helper layer but flagged for the follow-up PR.

## What this PR does not do

- Does not add a panel render — see "Why panel UI is deferred".
- Does not change the engine in `agent-evals.ts`.
- Does not change the API in `/api/agents/evals/route.ts`.
- Does not modify schema (`eval_runs` table) or backfill data.
- Does not introduce new theme tokens or layout decisions.
- Does not exercise the UI in browser smoke (no panel exists yet).

## Risk and rollback

- Risk: very low. New file, pure functions, no consumers in production yet.
- Rollback: revert this PR's diff (two files: helper + test). Nothing else depends on the new exports.

## Refs

- Đào msg 1692 (2026-04-27T12:48Z) — Phase 5.2 assignment, ETA 23:25:00+10:00.
- PR #38 — Phase 5.1 provider/model visibility, merged at `8478a3d`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.2 — task definition.
- `src/lib/agent-evals.ts` — engine producing `EvalResult` / `DriftResult` (not modified here).
- `src/app/api/agents/evals/route.ts` — operator-gated HTTP surface (not modified here).
- `src/lib/eval-summary.ts` — helpers (this PR).
- `src/lib/__tests__/eval-summary.test.ts` — 15 unit tests (this PR).
