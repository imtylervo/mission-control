# Phase 1.4 deferred leftover #3 — `pipelines/run` agent migration to WS

**Outcome:** `src/app/api/pipelines/run/route.ts:spawnStep` migrated from the CLI helper `runOpenClaw(['agent', '--message', …])` to the gateway WS `agent` method via `callOpenClawGatewayWS('agent', …)`. This was the last route in the Mission Control fork still calling `runOpenClaw` for an agent invocation; the route no longer depends on the `openclaw` CLI binary being present (so the `ENOENT`-in-containerised-MC failure mode from issue #608 is closed for this code path too).

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #21 merge (`d2237f3`).

## Why this PR exists

The Phase 1.4 deferred-leftovers row 3 in `docs/audit/MISSION_CONTROL_ROADMAP.md` recorded:

> `src/app/api/pipelines/run/route.ts:137` (`runOpenClaw(['agent', '--message', ...])`) — NOT in the Phase 1.4 batch. Uses the CLI's own `agent` long-running spawn (not `gateway call agent` RPC); spawn-vs-RPC parity needs a design call (does the caller need a long-lived stream of agent output, or a single deferred result?).

The design call (Đào msg 1576/1580): the route consumes a **single deferred result**, not a long-lived stream. There is no async tracking — `spawn_id` is a UI-display marker generated locally; the host blocks on a single `await runOpenClaw(...)` for at most 15 s, then writes the trimmed stdout into the pipeline-step result column. WS `agent` produces the same shape via `extractAgentText`, so the migration is a 1-for-1 swap with no behavioural delta beyond removing the CLI dependency.

## Behavior delta

| Aspect | Pre-PR (CLI) | Post-PR (WS) |
| --- | --- | --- |
| Transport | Subprocess: `openclaw agent --message X --timeout Y --json`, stdout consumed via `runOpenClaw` | WS frame: `callOpenClawGatewayWS('agent', params, { timeoutMs: 15000 })` |
| Gateway-side timeout | `--timeout SEC` arg | `params.timeout = template.timeout_seconds` (seconds, per `AgentParamsSchema`) |
| Host-side wait limit | `runOpenClaw timeoutMs: 15000` | `callOpenClawGatewayWS opts.timeoutMs: 15000` |
| Result shape | `stdout` JSON parsed by caller | `extractPipelineAgentText(result)` — handles `payloads[0].text`, `result.text`, `choices[0].message.content` (mirrors the private extractor in `src/lib/openclaw-gateway-ws.ts`) |
| Dedup / retry safety | None (CLI never re-keys a re-spawn) | Deterministic `idempotencyKey: pipeline-${runId}-step-${stepIdx}` — gateway dedupes if the host retries a step |
| `agentId` | CLI uses gateway's default agent | `params.agentId = process.env.OPENCLAW_DEFAULT_AGENT_ID` if set; omitted otherwise so the gateway falls through to its own default. Per Đào msg 1580: do NOT add a DB migration on `workflow_templates` for an explicit per-template agentId in this PR (too much scope); env fallback is the single concession |
| `spawn_id` (UI marker) | Generated locally, written to `pipeline_runs.steps_snapshot` | Unchanged — still `pipeline-${runId}-step-${stepIdx}-${Date.now()}` |
| `model` | Implicit (CLI default) | `params.model = template.model` when present |

The catch-and-record-error shape in `spawnStep` (and the pipeline-keeps-running-for-manual-advance behaviour on a step failure) is preserved exactly.

## Upstream evidence (OpenClaw `2026.4.24`)

`~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/agent.d.ts:95-145` defines `AgentParamsSchema`:

```ts
export declare const AgentParamsSchema: Type.TObject<{
    message: Type.TString;
    agentId: Type.TOptional<Type.TString>;
    model: Type.TOptional<Type.TString>;
    timeout: Type.TOptional<Type.TInteger>;
    deliver: Type.TOptional<Type.TBoolean>;
    idempotencyKey: Type.TString;
    // ... plus optional channel/threading/attachment/internalEvents fields
}>;
```

The MC payload built by `spawnStep` — `{ message, deliver, timeout, idempotencyKey, model?, agentId? }` — is a strict subset of this schema. `idempotencyKey` is the only required field added by the WS route compared to the CLI; the deterministic `pipeline-${runId}-step-${stepIdx}` shape covers it.

`AgentWaitParamsSchema` (lines 156-159) is *not* used by this PR — the pipeline route does not need a separate wait phase because the `agent` call is awaited synchronously and the gateway returns the run result inline once `deliver: true` triggers payload inclusion. (`agent.wait` would be the right call if pipeline ever moved to a fan-out-then-collect model — that's a Phase 2-or-later concern.)

## What changed

- `src/app/api/pipelines/run/route.ts`
  - New `extractPipelineAgentText(result)` helper that mirrors the private `extractAgentText` in `src/lib/openclaw-gateway-ws.ts`. Kept local to this file so the route's result-shape contract stays observable in one place.
  - `spawnStep` body rewritten: builds `params` with the four required/preserving fields (`message`, `deliver: true`, `timeout`, `idempotencyKey`) plus `model` and `agentId` only when their sources are non-empty. Calls `callOpenClawGatewayWS<unknown>('agent', params, { timeoutMs: 15000 })`. Returns `{ success: true, stdout: text.trim() }` so the rest of the pipeline-run code path (which only consumes `stdout`) is unchanged.
  - Replacement migration comment cites the source location of `AgentParamsSchema` and the rationale.
- `src/lib/__tests__/pipelines-run-source-discipline.test.ts` (new) — five static-analysis assertions modeled on the existing source-discipline tests:
  - production code does not invoke `runOpenClaw(...)`,
  - production code does not import from `@/lib/command`,
  - the route uses `callOpenClawGatewayWS('agent', …)`,
  - the deterministic idempotencyKey shape is present,
  - `template.timeout_seconds` flows into `params.timeout`,
  - the host wait limit `timeoutMs: 15000` stays.
- `docs/audit/PR22_PIPELINES_RUN_AGENT_WS_MIGRATION.md` (this file).
- `docs/audit/MISSION_CONTROL_ROADMAP.md` — Phase 1.4 deferred-leftovers row 3 (pipelines/run) strikes through; the only remaining row is `spawn/route.ts × 2`, which stays deferred per `docs/audit/PR20_SESSIONS_CREATE_WS_SCHEMA_GAP.md`.

## Out of scope

- `src/lib/openclaw-gateway.ts` is **still** not deleted. Spawn route (PR #20's open upstream block) keeps it alive.
- DB schema change to add `workflow_templates.agentId` is intentionally **not** in this PR (per Đào msg 1580). A future PR can introduce per-template agent selection if the env-driven fallback proves insufficient.
- The `extractPipelineAgentText` helper duplicates the private `extractAgentText` in `openclaw-gateway-ws.ts`. Promoting one into a shared utility is a small refactor that does not need to land here.

## Gates

- `npx vitest run src/lib/__tests__/pipelines-run-source-discipline.test.ts` → **5 passed**.
- `npx vitest run src/lib/__tests__/wrapper-swap-source-discipline.test.ts` → **9 passed** (regression check).
- `npx tsc --noEmit` → clean.
- `grep -nE 'runOpenClaw' src/app/api/pipelines/run/route.ts` → matches only the migration comment, not a production call.

The pre-existing `gateway-url.test.ts` failure on `phase-0/baseline-audit` is documented in `BASELINE.md` residual-risk row 4 and is **not** introduced by this PR.

## Risk and rollback

- Risk: low. The change is a one-function rewrite on a route whose result is consumed only as `stdout`; the on-failure path (record error in `steps_snapshot`, keep pipeline running for manual advance) is preserved.
- Operational risk: if a deployment relies on the gateway accepting an agent call without `agentId`, set `OPENCLAW_DEFAULT_AGENT_ID` in the env before deploying this PR. Mission Control's existing notification-delivery path (PR #12) already calls the WS `agent` method with `deliver: true` and works against the same gateway; this PR does not change that contract.
- Rollback: revert the merge commit. The `runOpenClaw` import and CLI argument list reappear; the source-discipline guard moves the route back into the "must not call runOpenClaw" expectation, which is what the *original* state already satisfied.

## Refs

- PR #12 — earlier `agent` WS migration that wired `callOpenClawGatewayWS('agent', …)` for notifications/chat.
- PR #13 — wrapper-swap batch.
- PR #20 — `sessions.create` schema gap audit (the still-deferred sibling row).
- PR #21 — `chat.history` migration (the just-closed sibling row).
- OpenClaw `2026.4.24` SDK: `~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/agent.d.ts:95-145` (`AgentParamsSchema`) and `:156-159` (`AgentWaitParamsSchema`, not used here).
