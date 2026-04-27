# Phase 3.1 — Agent panel smoke + fixes

**Outcome:** source/API smoke for the Agent panel completed. The panel has working read paths for agent list, identity-ish card/details, model/provider display, status controls, and wake/message actions. No code change was required in this checkpoint; remaining caveats are documented below for later browser-level Phase 3 evidence.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after Phase 2.4 PR #27 (`4939369`).

## Scope from roadmap

`docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.1:

> Verify agent list, identity, model/provider, status, wake/message action.

This audit checks the current Phase 3 agent panel implementation used by the main route:

- `src/app/[[...panel]]/page.tsx` renders `AgentSquadPanelPhase3` for the `agents` tab.
- `src/components/panels/agent-squad-panel-phase3.tsx` is therefore the active Agent panel, not the older `agent-squad-panel.tsx`.

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Agent list | PASS | `AgentSquadPanelPhase3.fetchAgents()` calls `GET /api/agents`; `src/app/api/agents/route.ts` returns `{ agents, total, page, limit }`, filters hidden agents by default, parses config, enriches workspace config, and attaches task stats in one grouped query. |
| Identity/card | PASS | Cards render `AgentAvatar`, `agent.name`, `agent.role`, source badge, hidden marker, last-seen, task stats, and status badge. Detail modal loads the selected agent and exposes editable role/session/soul/workspace-file tabs via `agent-detail-tabs`. |
| Model/provider visibility | PASS-with-caveat | `formatModelName(agent.config)` displays the primary model suffix inline next to role. Covered by `src/lib/__tests__/agent-card-helpers.test.ts`. Caveat: current helper intentionally strips provider prefix, so this is model visibility, not full provider+model. Full provider routing visibility is already a separate roadmap item (Phase 5.1). |
| Status controls | PASS | Card/detail status updates call `PUT /api/agents` with `name`, `status`, and `last_activity`, then update local store state. |
| Wake action | PASS | For agents with `session_key`, the card wake button calls `POST /api/agents/{agentName}/wake`, which validates operator role, resolves agent by id/name, requires a session key, sends `sessions.send` through the OpenClaw gateway WS, and updates agent status to idle. Agents without session key fall back to local status activation only. |
| Message action | PASS | `POST /api/agents/message` is operator-gated, validates message body, scans for injection/secrets, requires recipient session key, sends via `sessions.send`, creates notification/activity rows, and returns success. The Phase 3 panel's wake path exercises the same gateway `sessions.send` transport class. |

## Gates run

- `npx vitest run src/lib/__tests__/agent-card-helpers.test.ts`
- `npx tsc --noEmit`

Both passed on this branch.

## Findings / caveats

### C1 — Browser screenshot not captured in this checkpoint

This checkpoint is source/API backed. A real browser screenshot/log snippet is still useful during the broader Phase 3 manual smoke pass, but not required to patch code here because the source wiring and targeted helper tests pass.

### C2 — Provider prefix is stripped by current UI helper

`formatModelName()` intentionally turns `provider/model` into just `model`. That keeps cards compact, but it means Phase 3.1 cannot claim full provider routing visibility. This is acceptable because Phase 5.1 explicitly owns provider/model visibility.

### C3 — Destructive/external actions avoided

No wake/message action was fired against a real agent from this audit run. The code paths are verified by source review and existing tests because waking/sending can disturb live sessions.

## Risk and rollback

- Risk: none beyond documentation. No production source changed.
- Rollback: revert this audit doc.

## Refs

- `src/app/[[...panel]]/page.tsx`
- `src/components/panels/agent-squad-panel-phase3.tsx`
- `src/app/api/agents/route.ts`
- `src/app/api/agents/[id]/wake/route.ts`
- `src/app/api/agents/message/route.ts`
- `src/lib/agent-card-helpers.ts`
- `src/lib/__tests__/agent-card-helpers.test.ts`
