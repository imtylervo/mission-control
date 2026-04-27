# Phase 1.4 deferred leftover — `sessions.create` WS schema gap

**Outcome:** the deferral marker on `src/app/api/spawn/route.ts:79+89` is documented as **upstream-blocked** (the gateway WebSocket schema is missing two fields the CLI tool accepts), not an MC implementation bug. The legacy `callOpenClawGateway` wrapper stays in place. This PR is the audit + design artifact for the eventual unblock.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #19 merge (`33a26e1`).

## Why this PR exists

`docs/audit/MISSION_CONTROL_ROADMAP.md` row 1.4 lists three callsites that were intentionally retained on the legacy CLI wrapper during the Phase 1.4 batch migration. The `sessions_spawn` row's "Unblock condition" — *"Either extend the WS `sessions.create` schema to cover these fields, OR design a parity shim on the MC server that translates the CLI-style spawn payload into a series of WS calls"* — has not had a concrete evidence document. This PR closes that documentation gap so a future maintainer (or upstream review) can act on it without re-discovering the same source citations.

## Callsites

`src/app/api/spawn/route.ts`:

| Line | Call | Payload shape |
| --- | --- | --- |
| 79 | `await callOpenClawGateway('sessions_spawn', spawnPayload, 15_000)` | `{ task, label, model?, runTimeoutSeconds, tools: { profile } }` |
| 89 | `await callOpenClawGateway('sessions_spawn', fallbackPayload, 15_000)` (compatibility fallback when older gateway rejects `tools` field) | same as above with `tools` deleted |

The deferral marker comment lives at lines 70-77 in the same file. The marker text is pinned by `src/lib/__tests__/wrapper-swap-source-discipline.test.ts:74`, so a cleanup pass cannot strip the legacy wrapper without first updating the test — which would surface as a red CI signal.

## WS schema gap (verified against local OpenClaw `2026.4.24` SDK)

Source path: `~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/sessions.d.ts`. OpenClaw version verified via `node -p "require('/home/vip.toanvo/.npm-global/lib/node_modules/openclaw/package.json').version"` ⇒ `2026.4.24`.

### `SessionsCreateParamsSchema` (sessions.d.ts:66-74)

```typescript
export declare const SessionsCreateParamsSchema: Type.TObject<{
    key: Type.TOptional<Type.TString>;
    agentId: Type.TOptional<Type.TString>;
    label: Type.TOptional<Type.TString>;
    model: Type.TOptional<Type.TString>;
    parentSessionKey: Type.TOptional<Type.TString>;
    task: Type.TOptional<Type.TString>;
    message: Type.TOptional<Type.TString>;
}>;
```

### `SessionsPatchParamsSchema` (sessions.d.ts:93-115)

`SessionsPatchParamsSchema` does carry 19 mutation fields (`label`, `thinkingLevel`, `fastMode`, `verboseLevel`, `traceLevel`, `reasoningLevel`, `responseUsage`, `elevatedLevel`, `execHost`, `execSecurity`, `execAsk`, `execNode`, `model`, `spawnedBy`, `spawnedWorkspaceDir`, `spawnDepth`, `subagentRole`, `subagentControlScope`, `sendPolicy`, `groupActivation`), so it is not "patch-poor" in general — it is patch-poor for the *specific two fields* that block this migration. This rules out the "shim with sessions.create + sessions.patch" route Đào suggested as a possibility in the original deferral row.

### Field comparison

| Field MC sends to `sessions_spawn` | In `SessionsCreateParamsSchema`? | In `SessionsPatchParamsSchema`? |
| --- | :---: | :---: |
| `task` | ✅ | — |
| `label` | ✅ | ✅ |
| `model` (when present) | ✅ | ✅ |
| `runTimeoutSeconds` | ❌ | ❌ |
| `tools.profile` | ❌ | ❌ |

`runTimeoutSeconds` does exist elsewhere in the SDK — `plugin-sdk/src/config/zod-schema.d.ts:889` (agent-runtime config), `plugin-sdk/src/agents/subagent-spawn-plan.d.ts:14`, `plugin-sdk/src/agents/subagent-spawn.d.ts:24`. The field is a real concept in OpenClaw's runtime model; it just hasn't been surfaced into the per-session WS protocol yet.

A grep for `tools.*profile` / `toolsProfile` / `profile.*tools` in the WS sessions schema returns zero hits.

## Why dropping the fields silently is not acceptable

- **`runTimeoutSeconds`** controls how long a spawned session may run before it is killed. Mission Control sources this from the user-facing `timeoutSeconds` on the spawn API. Dropping it would silently let runaway spawns continue past the operator's intended cutoff. This is a security/correctness regression, not a UX one.
- **`tools.profile`** selects which tool capability profile the spawned agent loads (default sourced from `OPENCLAW_TOOLS_PROFILE`, falling back to `coding`). Dropping it would silently downgrade every spawn to the gateway's default profile — Tyler's MC would suddenly be missing tool capabilities the operator deliberately asked for.

Đào's msg 1336 — *"silently mapping would introduce a parity bug"* — captures this exactly.

## Status quo retained

`src/app/api/spawn/route.ts` lines 79 and 89 stay on `callOpenClawGateway('sessions_spawn', …)`. The wrapper-swap source-discipline test pins the marker. The Phase 1.4 deferred-leftovers row in the roadmap stays open against this PR's evidence.

The only deployment scenario where this matters is a containerized Mission Control where the `openclaw` CLI is absent (issue #608's original failure mode). Tyler's current VPS deployment has the CLI present, so the deferred wrapper does not break anything in production. Migration becomes interesting again the moment a containerized MC is on the table.

## Draft upstream issue body — DO NOT FILE YET

Upstream issue tracker is disabled on the fork (per `docs/audit/MISSION_CONTROL_BASELINE.md`, residual-risk row 1). A future Tyler-approved batch poke against `MemPalace/openclaw` (or the relevant upstream gateway repo) can reuse this body verbatim. The placement decision belongs to Tyler/Đào, not this PR.

> **Title:** `sessions.create` WS schema is missing `runTimeoutSeconds` and `tools.profile` (parity gap with CLI `sessions_spawn`)
>
> **Body:**
>
> The OpenClaw `2026.4.24` plugin SDK declares `SessionsCreateParamsSchema` (in `plugin-sdk/src/gateway/protocol/schema/sessions.d.ts:66-74`) with seven optional fields: `key`, `agentId`, `label`, `model`, `parentSessionKey`, `task`, `message`. The companion `SessionsPatchParamsSchema` (lines 93-115) covers a separate set of 19 mutation fields.
>
> Neither schema accepts `runTimeoutSeconds` or `tools.profile`. The CLI `sessions_spawn` tool does accept both, and they are both load-bearing for callers:
>
> - `runTimeoutSeconds` is the spawn-side run timeout (defined in agent-runtime / subagent-spawn schemas at `plugin-sdk/src/config/zod-schema.d.ts:889`, `plugin-sdk/src/agents/subagent-spawn-plan.d.ts:14`, `plugin-sdk/src/agents/subagent-spawn.d.ts:24`). A consumer migrating from the CLI to the WS protocol cannot enforce a per-spawn timeout without it.
> - `tools.profile` selects the tool capability profile the spawned agent loads. Dropping it silently downgrades every spawn to the gateway's default profile.
>
> Mission Control (downstream consumer at `imtylervo/mission-control`) has retained `callOpenClawGateway('sessions_spawn', …)` for two callsites in `src/app/api/spawn/route.ts` because of this gap; the alternatives — silent payload drop or fork-local protocol extension — both introduce parity bugs.
>
> **Ask:** extend `SessionsCreateParamsSchema` (and/or `SessionsPatchParamsSchema`) to carry `runTimeoutSeconds: number?` and `tools: { profile: string? }?`. Validate on the gateway side using the same constraints applied today by the CLI tool path. Consumers can then migrate to the WS protocol without losing operator-controlled spawn semantics.
>
> Reference: `docs/audit/PR20_SESSIONS_CREATE_WS_SCHEMA_GAP.md` in the `imtylervo/mission-control` fork (this document) carries the source citations and the field-comparison table.

## Files in this PR

- `docs/audit/PR20_SESSIONS_CREATE_WS_SCHEMA_GAP.md` (this file).
- `docs/audit/MISSION_CONTROL_ROADMAP.md` — Phase 1.4 deferred-leftovers row gains a pointer to this doc and the explicit classification *"upstream schema gap / status quo retained; not MC implementation bug"*.

No `src/` code is modified. No `MISSION_CONTROL_BASELINE.md` change in this PR — the existing residual-risk language already covers the deferral. The PR is intentionally narrow.

## Risk and rollback

- Risk: very low — purely an evidence + design artifact. No runtime change, no test change.
- Rollback: revert the merge commit. Nothing else imports these documents.

## Refs

- `docs/audit/PR10_GATEWAY_CALLER_INVENTORY.md` — original Phase 1.3 inventory that flagged this row.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` — Phase 1.4 deferred-leftovers row.
- `src/lib/__tests__/wrapper-swap-source-discipline.test.ts:74` — guard pin on the legacy-wrapper marker comment.
- OpenClaw `2026.4.24` SDK: `~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/sessions.d.ts:66-74` (`SessionsCreateParamsSchema`) and `:93-115` (`SessionsPatchParamsSchema`).
