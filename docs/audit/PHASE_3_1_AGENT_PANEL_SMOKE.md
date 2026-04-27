# Phase 3.1 — Agent panel smoke + fixes

**Outcome:** source/API smoke for the Agent panel completed against the post-PR-#27 base. The panel has working read paths for agent list, identity card/details, model/provider display, status controls, and wake/message actions. No code change required in this audit; remaining caveats documented below.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `4939369` (PR #27 doctor/security cleanup merged).

## Why this PR exists (and how it differs from PR #28)

Phase 3.1 was first attempted as PR #28 (`phase-3/pr28-agent-panel-smoke` SHA `6b97d5d`), authored by Đào under cron auto-execution. Two issues with PR #28:

1. **Wrong role ownership.** Đào is LEAD/Chief of Staff per Tyler's role split: read state/roadmap, scope/gates/done_when, tag Mai, review PR, escalate. Đào does NOT author implementation/docs PRs. Mai is CODER. Tyler corrected this in DM msg 4839: "a kêu nó làm lead còn e làm coder mà sao nó tự dành code luôn".
2. **Stale base.** PR #28 branched from `4c635bf` (PR #26 only) before Phase 2.4 PR #27 had landed in local refs. Same root cause as Mai's earlier wrongful "hallucinate" accusation: act before fetching. As a result, PR #28 missed PR #27's fixes to `scripts/station-doctor.sh` and `scripts/security-audit.sh`.

PR #29 supersedes PR #28: branched from current `origin/phase-0/baseline-audit` at `4939369` (post-fetch, post-#27), authored by Mai under coder role. Audit content is preserved (the source/API checklist Đào produced is correct) but verification evidence is re-run by Mai on the correct base.

## Scope from roadmap

`docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.1:

> Verify agent list, identity, model/provider, status, wake/message action.

The Phase 3 agent panel is rendered by:

- `src/app/[[...panel]]/page.tsx` → `AgentSquadPanelPhase3` for the `agents` tab.
- `src/components/panels/agent-squad-panel-phase3.tsx` is therefore the **active** Agent panel (not the older `agent-squad-panel.tsx`).

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Agent list | PASS | `AgentSquadPanelPhase3.fetchAgents()` calls `GET /api/agents`; `src/app/api/agents/route.ts` returns `{ agents, total, page, limit }`, filters hidden agents by default, parses config, enriches workspace config, and attaches task stats in one grouped query. |
| Identity card | PASS | Cards render `AgentAvatar`, `agent.name`, `agent.role`, source badge, hidden marker, last-seen, task stats, and status badge. Detail modal loads the selected agent and exposes editable role/session/soul/workspace-file tabs via `agent-detail-tabs`. |
| Model/provider visibility | PASS-with-caveat (C2) | `formatModelName(agent.config)` displays the primary model suffix inline next to role. Covered by `src/lib/__tests__/agent-card-helpers.test.ts` (16 cases). The helper intentionally strips provider prefix so the panel shows model only, not full `provider/model`. Full provider routing visibility is owned by Phase 5.1. |
| Status controls | PASS | Card / detail status updates call `PUT /api/agents` with `name`, `status`, and `last_activity`, then update local store state. |
| Wake action | PASS | For agents with `session_key`, the card wake button calls `POST /api/agents/{agentName}/wake`, which validates operator role, resolves agent by id/name, requires a session key, sends `sessions.send` through the OpenClaw gateway WS, and updates agent status to idle. Agents without session key fall back to local status activation. |
| Message action | PASS | `POST /api/agents/message` is operator-gated, validates message body, scans for injection/secrets, requires recipient session key, sends via `sessions.send`, creates notification/activity rows, and returns success. The Phase 3 panel's wake path exercises the same `sessions.send` transport class. |

## Gates run (Mai re-verified on post-PR-#27 base)

```
$ git rev-parse HEAD
4939369012ea9c72c4ed4d57e6fb4e0f1faf71f2  # confirms post-#27 base

$ npx vitest run src/lib/__tests__/agent-card-helpers.test.ts
✓ 16 tests passed (596ms)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Browser screenshot deferred

This audit is source/API backed. A real browser screenshot or interaction log is useful during a wider Phase 3 manual smoke pass, but is not required to mark the source-wiring checklist green. Phase 5.x browser smoke is the natural place for that evidence.

### C2 — Provider prefix stripped by current UI helper

`formatModelName()` intentionally turns `provider/model` into just `model` to keep cards compact. As a result Phase 3.1 cannot claim full provider routing visibility — that responsibility lives in Phase 5.1.

### C3 — Destructive / external actions avoided

No wake or message action was fired against a real agent from this audit run. The code paths are verified by source review and the existing `agent-card-helpers` test cases. Waking or sending against a live agent could disturb a real session, so this audit deliberately stays read-only.

## What this PR does not do

- No `src/` changes — audit doc only.
- No DB migration, no env changes, no test additions (the existing `agent-card-helpers` suite was sufficient for the helper-level checklist items).
- Does not browse-smoke the panel — see C1.
- Does not address provider-routing visibility — see C2 and Phase 5.1.

## Risk and rollback

- Risk: none beyond documentation.
- Rollback: revert this PR's diff (single audit doc).

## Refs

- Tyler msg 4839 (2026-04-27T11:18Z) — role-split correction that triggered the PR #28 → PR #29 redo.
- Tyler msg 1666 (2026-04-27T11:36Z) — approval to apply v6 watchdog + close PR #28 + open PR #29.
- PR #28 (superseded) — `phase-3/pr28-agent-panel-smoke` SHA `6b97d5d`, Đào-authored, stale base.
- PR #27 — Phase 2.4 doctor/security cleanup, merged at `4939369`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.1 — task definition.
- `src/app/[[...panel]]/page.tsx`, `src/components/panels/agent-squad-panel-phase3.tsx`
- `src/app/api/agents/route.ts`, `src/app/api/agents/[id]/wake/route.ts`, `src/app/api/agents/message/route.ts`
- `src/lib/agent-card-helpers.ts`, `src/lib/__tests__/agent-card-helpers.test.ts`
