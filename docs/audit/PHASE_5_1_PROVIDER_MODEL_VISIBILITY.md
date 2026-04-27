# Phase 5.1 — Provider/model visibility

**Outcome:** the agent panel now shows the full provider routing chain inline next to each agent's role. For nested routing IDs like `9router/cx/gpt-5.5` it renders `<role> · 9router/cx · gpt-5.5`; for plain provider/model IDs like `anthropic/claude-opus-4-5` it renders `<role> · anthropic · claude-opus-4-5`; for un-prefixed IDs like `gpt-4o` it stays `<role> · gpt-4o`. Hover-title on the line surfaces the raw model ID for exact lookup.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `1eb63ed` (Phase 4.4 PR #37 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.1:

> Show 9router/cx/gpt-5.5 and provider routing clearly per agent/session.

Đào (LEAD) assigned this to Mai (CODER) after Phase 4.4 closed (Đào msg 1688, ETA 23:05:00+10:00).

Earlier audits (Phase 3.1 PR #29) flagged this as caveat C2: "`formatModelName()` intentionally turns `provider/model` into just `model`. That keeps cards compact, but it means Phase 3.1 cannot claim full provider routing visibility. This is acceptable because Phase 5.1 explicitly owns provider/model visibility." — Phase 5.1 closes that caveat.

## What changed

### `src/lib/agent-card-helpers.ts`

Refactored to share a private `readPrimaryModelId(config)` helper, then added three new exports:

1. `formatProviderName(config)` — extracts the FIRST segment (the provider prefix). Returns `null` when the ID has no `/`.
   - `"anthropic/claude-opus-4-5"` → `"anthropic"`
   - `"9router/cx/gpt-5.5"` → `"9router"`
   - `"gpt-4o"` → `null`
2. `formatProviderRoute(config)` — extracts the intermediate route segment(s) for nested IDs. Returns `null` when there are fewer than 3 parts.
   - `"9router/cx/gpt-5.5"` → `"cx"`
   - `"9router/cx/proxy/gpt-5.5"` → `"cx/proxy"`
   - `"anthropic/claude-opus-4-5"` → `null` (only 2 parts)
   - `"gpt-4o"` → `null`
3. `formatFullProviderModel(config)` — returns the raw primary model ID verbatim (no transformation). Used in tooltips so the operator can see the exact routing chain.

The existing `formatModelName(config)` is unchanged (returns LAST segment only) so existing call sites keep working.

### `src/lib/__tests__/agent-card-helpers.test.ts`

Extended from 16 cases → 29. The 16 pre-existing cases for `formatModelName`, `buildTaskStatParts`, `extractWsHost` still pass byte-identically. The 13 new cases pin the Phase 5.1 contract:

- `formatProviderName`: 4 cases (2-segment, 3-segment, no-prefix, missing/non-string).
- `formatProviderRoute`: 5 cases (3-segment, 4-segment-multi, 2-segment, 1-segment, missing/non-string).
- `formatFullProviderModel`: 4 cases (nested verbatim, 2-segment verbatim, no-prefix verbatim, missing).

### `src/components/panels/agent-squad-panel-phase3.tsx`

Inside the `agents.map(agent => ...)` block, computed three new locals next to the existing `modelName`:

```ts
const modelName = formatModelName(agent.config)
const providerName = formatProviderName(agent.config)
const providerRoute = formatProviderRoute(agent.config)
const fullProviderModel = formatFullProviderModel(agent.config)
const providerChainPrefix = providerName
  ? (providerRoute ? `${providerName}/${providerRoute}` : providerName)
  : null
```

The role-line `<p>` was extended to render the chain:

```tsx
<p ... title={fullProviderModel || undefined}>
  {agent.role}
  {providerChainPrefix && (<> · <span className="font-mono text-muted-foreground/60">{providerChainPrefix}</span></>)}
  {modelName && (<> · <span className="font-mono text-muted-foreground/80">{modelName}</span></>)}
</p>
```

Visual examples (same role + status + task-stats line as before):

| `agent.config.model.primary` | Rendered |
| --- | --- |
| `anthropic/claude-opus-4-5` | `tester · anthropic · claude-opus-4-5` |
| `9router/cx/gpt-5.5` | `tester · 9router/cx · gpt-5.5` |
| `9router/cx/proxy/gpt-5.5` | `tester · 9router/cx/proxy · gpt-5.5` |
| `gpt-4o` | `tester · gpt-4o` |
| (none) | `tester` |

Hover-title on the line shows the raw ID (`9router/cx/gpt-5.5`) so an operator can copy-paste the exact routing string into a config edit without parsing the dotted segments back together.

The provider prefix uses `text-muted-foreground/60` (slightly dimmer) so the model name `text-muted-foreground/80` remains the primary visual anchor — operators usually scan for the model and reach for the provider only when ambiguity matters.

## Gates run (Mai re-verified on post-PR-#37 base)

```
$ git rev-parse HEAD
1eb63ed76e3fd11031bce3b86f092aaa739d8dc6  # confirms post-PR-#37 base

$ npx vitest run src/lib/__tests__/agent-card-helpers.test.ts
✓ src/lib/__tests__/agent-card-helpers.test.ts (29 tests) 8ms
Test Files  1 passed (1)
Tests       29 passed (29)

$ npx tsc --noEmit
(clean)
```

The 13 new helper tests are pure unit tests (no DOM, no network). The agent-panel rendering change does not have an existing component-level test in this repo (panel currently exercised by Playwright e2e specs), so no new component test is added — the helpers' unit coverage plus the existing dashboard-smoke + agent-comms specs keep the panel covered.

## Findings / caveats

### C1 — Phase 3.1 caveat C2 closed

Phase 3.1's audit (`PHASE_3_1_AGENT_PANEL_SMOKE.md`) explicitly deferred provider routing visibility to Phase 5.1. This PR closes that. Future audits can drop the "Phase 5.1 owns this" disclaimer.

### C2 — Provider chain depth is bounded by `/` segments only

The helpers split by `/` and assume a `provider/[route?]/model` structure. They do NOT introspect a separate `provider:` field or a `routing:` map on the config — those are not present in current shapes. If a future config schema introduces a structured routing object, the helpers should be reworked to read that explicitly rather than re-parse a slash string.

### C3 — UI line truncation

The agent role-line is `truncate`d via Tailwind. On a narrow card width, longer chains like `9router/cx/proxy · gpt-5.5` may be truncated visually. The `title={fullProviderModel}` tooltip ensures the full string is reachable even when truncated. A wider-card refactor (e.g. multi-line role/model layout) is out of scope here.

### C4 — Color contrast intent

`text-muted-foreground/60` for provider chain vs `text-muted-foreground/80` for model name is intentional: provider info is supplementary, model name is the primary scan target. If accessibility audits later want higher contrast, the values can lift to `/70` and `/90` without affecting helper logic.

## What this PR does not do

- Does not change `formatModelName` semantics — existing call sites keep working.
- Does not modify `agent.config.model.primary` storage shape or migration.
- Does not surface provider in detail modal (only card view) — modal already has its own model-display layout, can be extended in a follow-up if needed.
- Does not modify session/transcript views — Phase 5.1 wording is "per agent/session" but the agent panel is the natural primary surface; session views surface model via existing transcript metadata.
- Does not introduce new theme tokens or breakpoints.

## Risk and rollback

- Risk: low. Helpers are pure functions with full unit coverage. Panel change is a single role-line render swap.
- Rollback: revert this PR's diff. Helpers retire the new exports (no production callers outside the panel), panel returns to single-segment model display.

## Refs

- Đào msg 1688 (2026-04-27T12:30Z) — Phase 5.1 assignment, ETA 23:05:00+10:00.
- PR #37 — Phase 4.4 container-no-cli runtime smoke, merged at `1eb63ed`.
- `docs/audit/PHASE_3_1_AGENT_PANEL_SMOKE.md` C2 — deferred provider visibility, now closed by this PR.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.1 — task definition.
- `src/lib/agent-card-helpers.ts` — helpers (this PR).
- `src/lib/__tests__/agent-card-helpers.test.ts` — 13 new unit tests pinning helpers (this PR).
- `src/components/panels/agent-squad-panel-phase3.tsx` — UI render extension (this PR).
