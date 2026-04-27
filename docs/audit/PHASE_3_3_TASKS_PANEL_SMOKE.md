# Phase 3.3 — Tasks panel smoke + fixes

**Outcome:** source/API smoke for the Tasks panel against the post-PR-#30 base. Create-task, dispatch-to-main-agent, observe-status-updates, and no-CLI-shell-out-regression all PASS by source review plus the existing task test suite (17 tests across 5 files). No code change required.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `db55387` (Phase 3.2 PR #30 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.3:

> Verify create task, dispatch to main agent, observe status updates, no CLI shell-out regression.

Đào (LEAD) assigned this scope to Mai (CODER) after Phase 3.2 closed (Đào msg 1671, ETA 22:15:00+10:00).

## Panel surface

`src/components/panels/task-board-panel.tsx` is the active Tasks panel.

API surface (under `src/app/api/tasks/`):

- `route.ts` — GET (list), POST (create), PUT (bulk update e.g. drag-and-drop status)
- `[id]/route.ts` — single-task read/update/delete
- `[id]/comments/route.ts` — comment thread
- `[id]/branch/route.ts` — branch metadata
- `[id]/broadcast/route.ts` — broadcast to comms
- `queue/route.ts` — task queue view
- `outcomes/route.ts` — outcomes log
- `regression/route.ts` — regression-task surface

Dispatch path: `src/lib/task-dispatch.ts` (covered by `task-dispatch.test.ts`, `task-dispatch-source-discipline.test.ts`, `task-routing.test.ts`).

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Create task | PASS | `POST /api/tasks` (`src/app/api/tasks/route.ts`) creates a task row, validates input, returns the new task. Wired to the panel's "new task" UX. |
| Dispatch to main agent | PASS | `task-dispatch.ts` routes through `callOpenClawGatewayWS(...)` against the OpenClaw gateway WS (no shell-out). Optional `agent.config.dispatchModel` override is read from agent config; default behavior does NOT inject a model override (the gateway-side agent picks). Fallback path: direct Claude API when no gateway is available — also non-shell. Covered by `task-dispatch.test.ts` (3 tests) and `task-routing.test.ts` (4 tests). |
| Observe status updates | PASS | `PUT /api/tasks` accepts bulk status changes (drag-and-drop). Single-task `PATCH/PUT` lives at `[id]/route.ts`. The `tasks-route-noop-update.test.ts` (1 test) pins the no-op-update edge case. Status transitions tested in `task-status.test.ts` (5 tests). |
| No CLI shell-out regression | PASS | `grep -rnE "execSync|spawnSync|spawn\(|child_process" src/lib/task-dispatch.ts src/app/api/tasks/` returns NO matches. The dispatch path is gateway-WS-only. `task-dispatch-source-discipline.test.ts` (4 tests) explicitly enforces this discipline. |

## Gates run (Mai re-verified on post-PR-#30 base)

```
$ git rev-parse HEAD
db5538797827858c5de36446601fe88880f24523  # confirms post-PR-#30 base

$ npx vitest run src/lib/__tests__/task-dispatch.test.ts \
                 src/lib/__tests__/task-dispatch-source-discipline.test.ts \
                 src/lib/__tests__/task-status.test.ts \
                 src/lib/__tests__/task-routing.test.ts \
                 src/lib/__tests__/tasks-route-noop-update.test.ts
✓ 17 tests passed across 5 files (2.56s)

$ npx tsc --noEmit
(clean)

$ grep -rnE "execSync|spawnSync|spawn\(|child_process" src/lib/task-dispatch.ts src/app/api/tasks/
(no matches — confirms no CLI shell-out regression)
```

## Findings / caveats

### C1 — Browser smoke deferred

Drag-and-drop on the kanban / status changes / live activity stream are most naturally exercised in a manual browser pass during Phase 5.x. Source-and-test-level evidence is sufficient for this audit.

### C2 — Direct Claude API fallback exists

`task-dispatch.ts` has a non-gateway fallback that talks to Claude via the Anthropic API directly when no OpenClaw gateway is available. This is also non-shell (HTTP call). It is mentioned here for completeness; it is in scope of Phase 3.3 only insofar as "no CLI shell-out regression" is concerned, and that invariant holds.

### C3 — Optional dispatch-model override

`task-dispatch.ts` reads `agent.config.dispatchModel` if present and uses it; otherwise the gateway-side agent picks the model. The default (no override) is correct per the comment "task dispatch should not inject a model override; the OpenClaw gateway picks the model". This is intentional and out of scope for this audit, captured here so a future provider-routing audit (Phase 5.1) doesn't trip over it.

### C4 — Destructive task actions exist; not exercised

`POST /api/tasks/[id]/broadcast` triggers a broadcast that may notify comms channels. `task-dispatch` POST can spawn a real agent turn. This audit deliberately does NOT fire those against any real task — verification stays at the source-and-test level.

## What this PR does not do

- No `src/` changes — audit doc only.
- No new tests — the 17-test task suite is sufficient for the roadmap-defined checklist.
- Does not browse-smoke the kanban — see C1.
- Does not exercise destructive task-broadcast or live agent dispatch — see C4.

## Risk and rollback

- Risk: none beyond documentation.
- Rollback: revert this PR's diff (single audit doc).

## Refs

- Đào msg 1671 (2026-04-27T11:44Z) — Phase 3.3 assignment, ETA 22:15:00+10:00.
- PR #30 — Phase 3.2 audit, merged at `db55387`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.3 — task definition.
- `src/components/panels/task-board-panel.tsx`
- `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/queue/route.ts`, `src/app/api/tasks/outcomes/route.ts`, `src/app/api/tasks/regression/route.ts`, `src/app/api/tasks/[id]/comments/route.ts`, `src/app/api/tasks/[id]/branch/route.ts`, `src/app/api/tasks/[id]/broadcast/route.ts`
- `src/lib/task-dispatch.ts`, `src/lib/__tests__/task-dispatch.test.ts`, `src/lib/__tests__/task-dispatch-source-discipline.test.ts`, `src/lib/__tests__/task-status.test.ts`, `src/lib/__tests__/task-routing.test.ts`, `src/lib/__tests__/tasks-route-noop-update.test.ts`
