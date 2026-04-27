# Phase 1.4 deferred leftover #2 — `chat.history` migrated to gateway WS

**Outcome:** `src/app/api/sessions/transcript/gateway/route.ts` migrated off the legacy `callOpenClawGateway` CLI wrapper onto the native `callOpenClawGatewayWS('chat.history', ...)` helper. The disk-side JSONL fallback inside the same route is unchanged. The deferral marker is removed and the route moves into the migrated-files list of `wrapper-swap-source-discipline.test.ts`.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #20 merge (`bdacfc5`).

## Why this PR exists (and why now)

The Phase 1.4 deferred-leftovers row in `docs/audit/MISSION_CONTROL_ROADMAP.md` recorded:

> `src/app/api/sessions/transcript/gateway/route.ts` × 1 (`chat.history`) — The WS protocol does not export `chat.history` as of 2026-04-27 (per Đào's check).

That deferral reason is now out of date. The locally bundled OpenClaw `2026.4.24` SDK ships `ChatHistoryParamsSchema` on the gateway protocol, so the migration that was blocked when Đào first checked is now a one-line swap (plus the matching test/doc updates).

## Upstream evidence

Source path: `~/.npm-global/lib/node_modules/openclaw/dist`. OpenClaw version `2026.4.24` (verified via `node -p "require('/home/vip.toanvo/.npm-global/lib/node_modules/openclaw/package.json').version"`).

`plugin-sdk/src/gateway/protocol/schema/logs-chat.d.ts:15-18`:

```ts
export declare const ChatHistoryParamsSchema: Type.TObject<{
    sessionKey: Type.TString;
    limit: Type.TOptional<Type.TInteger>;
    maxChars: Type.TOptional<Type.TInteger>;
}>;
```

`plugin-sdk/src/gateway/protocol/index.d.ts:876` exposes `validateChatHistoryParams: AjvPkg.ValidateFunction<...>`, and the same file's re-export block at line 937 lists `ChatHistoryParamsSchema` alongside the other validated schemas the gateway accepts.

The Mission Control payload — `{ sessionKey, limit }` — is a strict subset of the schema's required fields (`sessionKey` is required, `limit` and `maxChars` are optional). No payload reshaping is needed; the migration is a straight swap of the helper.

## What changed

### Production source

- `src/app/api/sessions/transcript/gateway/route.ts`
  - Import swapped: `callOpenClawGateway` (from `@/lib/openclaw-gateway`) → `callOpenClawGatewayWS` (from `@/lib/openclaw-gateway-ws`).
  - Call site updated:
    - `await callOpenClawGateway<{messages?:unknown[]}>('chat.history', { sessionKey, limit }, 15000)`
    - → `await callOpenClawGatewayWS<{messages?:unknown[]}>('chat.history', { sessionKey, limit }, { timeoutMs: 15000 })`
  - Deferral marker comment ("`INTENTIONALLY retained on the legacy CLI wrapper`") replaced with a short PR #21 / Phase 1.4 migration note that cites the upstream schema location and explains why the disk-side fallback is kept.
  - The disk-side JSONL fallback (lines 55-95 in the pre-PR file) is **unchanged**. It still resolves `agentName` from the session key, looks up the `sessionId` from `{stateDir}/agents/{agent}/sessions/sessions.json`, reads `{stateDir}/agents/{agent}/sessions/{sessionId}.jsonl`, and parses via `parseJsonlTranscript`. This path remains useful when the gateway WS handshake fails (e.g. a containerised MC where pairing is missing) and is the route's primary defensive read in those cases.

### Tests

- `src/lib/__tests__/wrapper-swap-source-discipline.test.ts`
  - The transcript-gateway route moves from `DEFERRED_FILES` to `MIGRATED_FILES`. The migrated-files block of the test now asserts:
    - the route does not invoke `callOpenClawGateway` (the legacy CLI wrapper);
    - the route uses `callOpenClawGatewayWS` for at least one gateway call.
  - The deferred-files block correspondingly shrinks to the single remaining row (`spawn/route.ts`), which stays deferred per `docs/audit/PR20_SESSIONS_CREATE_WS_SCHEMA_GAP.md` (the upstream `sessions.create` schema is still missing `runTimeoutSeconds` and `tools.profile`).
  - The "legacy wrapper module is still present" guard at the bottom of the file is unchanged: `src/lib/openclaw-gateway.ts` continues to export `callOpenClawGateway` because `spawn/route.ts` still depends on it. This is intentional and lines up with the "follow-on cleanup gated on the first two unblocks" note in the roadmap.

### Docs

- `docs/audit/PR21_TRANSCRIPT_CHAT_HISTORY_WS_MIGRATION.md` (this file).
- `docs/audit/MISSION_CONTROL_ROADMAP.md` — Phase 1.4 deferred-leftovers row 2 (transcript) is closed; the remaining deferred row is `spawn/route.ts` only. The follow-on-cleanup note about deleting `src/lib/openclaw-gateway.ts` "once both deferred files migrate" stays — only one of the two has migrated, so the wrapper module is still required.

**No `src/lib/openclaw-gateway.ts` deletion in this PR.** That cleanup waits for the `spawn/route.ts` upstream schema gap (PR #20) to clear.

## Behavior delta

| Path | Pre-PR | Post-PR |
| --- | --- | --- |
| Primary read: gateway-side history | `callOpenClawGateway('chat.history', …)` — shells out via the `openclaw` CLI binary (fails with `ENOENT` on a containerised MC where the binary is absent — issue #608's failure mode). | `callOpenClawGatewayWS('chat.history', …)` — direct WS connection to the gateway endpoint resolved by `gatewayWsUrl(...)`. No subprocess. |
| Fallback: disk-side JSONL read | Unchanged. | Unchanged. |
| Source field on success | `source: 'gateway-rpc'` if WS path returned non-empty, else `source: 'gateway'` from disk fallback. | Same. |
| Auth | Existing `requireRole(request, 'viewer')` and `getDetectedGatewayToken()` plumbing on the WS helper — same gateway pairing the rest of MC's WS callers already trust. | Same. |
| Timeout | `15000ms` passed positionally. | `{ timeoutMs: 15000 }` passed via the helper's options bag. Equivalent. |

The catch-and-fallback shape (`try { …WS… } catch (rpcErr) { logger.warn(…); }` then disk read) is preserved exactly as before, so any deployment that loses gateway access mid-call still falls through to the JSONL read with the same error logging.

## Gates

- `npx vitest run src/lib/__tests__/wrapper-swap-source-discipline.test.ts` → **9 passed** (the migrated-files assertion now exercises the transcript route as well).
- `npx tsc --noEmit` → clean.
- `grep -nE "callOpenClawGateway" src/app/api/sessions/transcript/gateway/route.ts` → matches reference the migration comment + the new helper name only; no production call to the legacy `callOpenClawGateway` remains.

The pre-existing `gateway-url.test.ts > buildGatewayWebSocketUrl > uses ws:// for prefixed localhost URL even with https scheme` failure on `phase-0/baseline-audit` is documented in `docs/audit/MISSION_CONTROL_BASELINE.md` residual-risk row 4 and is **not** introduced by this PR.

## Risk and rollback

- Risk: low. The change is one import + one call-site shape on a route that already has a tested disk-side fallback for the failure mode the WS helper might hit.
- Rollback: revert the merge commit. The deferral marker reappears, the test moves the route back into `DEFERRED_FILES`, and `callOpenClawGateway` resumes being called for the gateway-side history. No data migration on disk; nothing else depends on the route's `source` field's exact value.

## What this PR does not close

- `src/lib/openclaw-gateway.ts` continues to ship `callOpenClawGateway`. The single remaining caller is `src/app/api/spawn/route.ts` and the `sessions.create` schema gap is still open per `docs/audit/PR20_SESSIONS_CREATE_WS_SCHEMA_GAP.md`. Deleting the wrapper module waits for either an upstream schema extension or a parity-shim design.
- The third callsite still on the CLI helper — `src/app/api/pipelines/run/route.ts:137` — is **not** in the Phase 1.4 batch; it uses the CLI's own `agent` long-running spawn and needs a separate spawn-vs-RPC design call before any migration.

## Refs

- PR #13 — original wrapper-swap batch.
- PR #20 — `sessions.create` schema gap audit (the still-deferred sibling row).
- `docs/audit/PR10_GATEWAY_CALLER_INVENTORY.md` — Phase 1.3 inventory.
- OpenClaw `2026.4.24` SDK: `~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/logs-chat.d.ts:15-18` (`ChatHistoryParamsSchema`) and `plugin-sdk/src/gateway/protocol/index.d.ts:876` (`validateChatHistoryParams`).
