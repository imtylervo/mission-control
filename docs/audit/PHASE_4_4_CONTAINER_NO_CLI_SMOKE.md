# Phase 4.4 — Container/Docker smoke (no openclaw CLI)

**Outcome:** added a runtime test that simulates the `#608` deployment class — Mission Control container shipped WITHOUT the `openclaw` CLI binary in PATH — and verifies migrated routes still serve traffic via the gateway WebSocket transport. With `runOpenClaw` mocked to throw `ENOENT`, two of the migrated routes (`POST /api/sessions/[id]/control` for both `terminate` and `monitor` actions) succeed end-to-end and call `callOpenClawGatewayWS`. The mocked `runOpenClaw` is verified to NOT have been called.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `6a125b7` (Phase 4.3 PR #36 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 4.4:

> Verify original #608 deployment class — MC without bundled openclaw CLI still works for WS-migrated paths.

Đào (LEAD) assigned this to Mai (CODER) after Phase 4.3 closed (Đào msg 1685, ETA 22:50:00+10:00).

The earlier Phase 4 work covered the **static** side of this invariant:

- Per-PR source-discipline tests (PRs #11 / #12 / #13 / #22 / #608) assert specific migrated files do not contain forbidden `runOpenClaw([...])` patterns.
- The Phase 4.2 umbrella (PR #35) extended that to file-level invariants across all migrated routes.

Phase 4.4 fills the remaining gap: a **runtime** assertion that, given an actual ENOENT on `runOpenClaw`, the migrated route handlers still return non-5xx and do their work via `callOpenClawGatewayWS`. A regression that silently reintroduces a shell-out would surface at runtime as the ENOENT bubbling out of the route's try/catch and coming back as a 500.

## What changed

### `src/lib/__tests__/container-no-cli-smoke.test.ts` (new)

Three test cases:

1. `POST /api/sessions/[id]/control` with `action=terminate` → asserts `res.status < 500`, `callOpenClawGatewayWS('sessions.abort', ...)` was called, `runOpenClaw` was NOT called.
2. `POST /api/sessions/[id]/control` with `action=monitor` → asserts `res.status < 500`, `callOpenClawGatewayWS('sessions.send', ...)` was called, `runOpenClaw` was NOT called.
3. Sanity: the `runOpenClaw` mock is rigged to throw `Error: spawn openclaw ENOENT` with `code: 'ENOENT'`. This guards against a future refactor that silently neuters the mock.

The mock plumbing uses the `vi.hoisted` pattern (consistent with PR #24's gateway-origin route test): hoisted refs for `requireRole`, `callOpenClawGatewayWS`, `runOpenClaw`, `mutationLimiter`, and `db_helpers.logActivity`. Defaults set in `beforeEach` so each test starts from a clean known state.

### Why this PR scopes to `sessions/[id]/control`

The two other migrated routes (`pipelines/run`, `chat/messages`) have substantially deeper input plumbing (steps, branches, agent registration, conversation lookup) that would balloon the test plumbing without adding signal. The umbrella source-discipline test from PR #35 already pins those routes statically; the runtime test for `sessions/[id]/control` is a representative sample of "does ENOENT on runOpenClaw kill a migrated route?" — and it does not. If a future PR adds another migrated route and we want runtime coverage, extend this file with a parallel describe block.

## Gates run (Mai re-verified on post-PR-#36 base)

```
$ git rev-parse HEAD
6a125b758e647db527a676b37176b6adf2deefea  # confirms post-PR-#36 base

$ npx vitest run src/lib/__tests__/container-no-cli-smoke.test.ts
✓ src/lib/__tests__/container-no-cli-smoke.test.ts (3 tests) 59ms
Test Files  1 passed (1)
Tests       3 passed (3)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Static + runtime is the right combination

A static source-discipline test catches forbidden imports / call expressions but does not catch dynamic dispatch (e.g. a future route that conditionally calls `runOpenClaw` based on some runtime flag). A runtime test catches dynamic dispatch but only on the inputs it exercises. Both layers are necessary; this PR adds the runtime layer for the most common migrated route shape.

### C2 — `runOpenClaw` is still legitimate elsewhere

The umbrella PR #35 explicitly carves out routes that retain `runOpenClaw` for legitimate operational use (`agents add/delete`, `backup create`, `openclaw doctor/version/update`, `channels` operational paths). Those are NOT migrated routes and are NOT covered by this Phase 4.4 test. They will still fail in a no-CLI container — but that is the operator's choice (deploy without CLI = lose those operational paths).

### C3 — Browser smoke vs runtime smoke

Phase 4.3's `dashboard-smoke.spec.ts` is browser-level happy-path. Phase 4.4 is unit-level runtime smoke for the `runOpenClaw` ENOENT scenario. These are complementary, not duplicative — they exercise different call stacks.

### C4 — Future migrations require this file's MIGRATED_ROUTES inventory to grow

If a future PR migrates another route, add a parallel describe block here AND extend the umbrella test in `umbrella-source-discipline.test.ts`. The two tests should stay in sync.

## What this PR does not do

- No `src/` (production) changes — test-only.
- Does not add Docker daemon / containerd integration tests — those would require a running Docker on the dev box and are CI-only.
- Does not extend the runtime ENOENT scenario to `pipelines/run` or `chat/messages` — see "Why this PR scopes to sessions/[id]/control" above.
- Does not change source-discipline conventions or umbrella test inventory.
- Does not introduce new test helpers — uses existing vitest + vi.hoisted patterns.

## Risk and rollback

- Risk: very low. Test-only addition; no production code touched.
- Rollback: revert this PR (single new test file).

## Refs

- Đào msg 1685 (2026-04-27T12:13Z) — Phase 4.4 assignment, ETA 22:50:00+10:00.
- PR #36 — Phase 4.3 dashboard happy-path smoke, merged at `6a125b7`.
- PR #35 — Phase 4.2 source-discipline umbrella (static counterpart).
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 4.4 — task definition.
- Issue context: builderz-labs/mission-control#608 — original deployment class problem.
