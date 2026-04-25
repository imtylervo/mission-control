# Mission Control v0 Spec — Tyler AI Team

Status: Draft during Phase 0 audit  
Owner: Đào (spec/coordination) + Mai (architecture/baseline)  
Scope: Product direction and acceptance criteria only. Do not treat as implementation approval until `MISSION_CONTROL_BASELINE.md` is reviewed.

## 1. Purpose

Mission Control should become the operational dashboard for Tyler AI Team: a reliable place to see agents, gateways, tasks, eval status, logs, and safety posture without guessing from scattered chats or CLI output.

The near-term goal is not cosmetic polish. The goal is trust:

- What agents exist?
- What model/tool profile is each agent using?
- Is the OpenClaw gateway healthy?
- Which actions are pending, approved, failed, or blocked?
- Which bugs/security risks are real and reproducible?
- Which eval/shadow-mode results justify promoting an agent?

## 2. Product Principles

1. Evidence before action.
   - No bugfix or feature work should start without baseline/repro or explicit owner judgment.
2. Safety is visible.
   - Model, tool permissions, credential boundaries, and action approvals must be visible enough for Tyler/Mai/Đào to trust operations.
3. Agent state must be understandable.
   - Avoid hidden magic: show role, topic, model, status, recent errors, eval phase, and next required approval.
4. Open source first where generic.
   - Generic Mission Control bug/security fixes should be upstreamable.
   - Tyler-specific workflow can live in fork first, then be generalized later.
5. Do not overfit before understanding.
   - Phase 0 baseline is required before Phase 1 code changes.

## 3. Phase 0 Deliverables

`MISSION_CONTROL_BASELINE.md` should answer:

- Architecture map: app/router/API/state/db/realtime/adapters.
- Feature map: all panels and their purpose.
- OpenClaw adapter map: how Mission Control talks to gateway/agents/channels/cron/logs.
- DB/schema map: tables, migrations, auth/security storage.
- Test baseline: install/build/dev/unit/E2E status.
- Bug repro evidence for priority issues: #608, #613, #574, #576 at minimum.
- Risk map: safe-to-change vs do-not-touch-yet areas.
- Recommended first 3 PRs with acceptance criteria.

Acceptance criteria:

- Baseline document exists under `docs/audit/`.
- Commands used are recorded.
- Failures include error snippets and environment notes.
- At least one manual UI walkthrough screenshot/note exists if app runs.
- Tyler reviews and approves before Phase 1 code begins.

## 4. Phase 1 Candidate Priorities

### Track A — Deployability

Primary goal: Mission Control can run reliably against Tyler's OpenClaw gateway in VPS/container mode.

Candidate issues:

- #608 Gateway integration broken in distributed/containerized setup.
- Docker compose smoke test for Tyler gateway.
- OpenClaw gateway/session/chat integration correctness.

Acceptance criteria:

- Fresh clone install/build passes or failures are documented.
- Docker/local deployment can connect to OpenClaw gateway using intended config.
- Failure states are explicit in UI/logs, not silent.
- No secret/token is printed in logs.

### Track B — Safety/Ops

Primary goal: reduce risk before expanding features.

Candidate issues:

- #613 doctor CPU/RAM spike.
- #574 device private key in localStorage.
- #576 injection-guard regex bypass.

Acceptance criteria:

- Each security bug has repro or “not reproducible” evidence.
- Fixes include tests where practical.
- Sensitive material is not stored in unsafe browser storage unless risk is accepted/documented.
- Injection guard test cases include normalization/encoding/homoglyph examples if applicable.

## 5. Phase 2 Tyler-Stack Features

Priority order after Phase 0/1 validation:

1. OpenClaw gateway/agent integration stable.
2. 9router/cx/gpt-5.5 provider visibility.
3. Shadow mode / eval score panel.
4. Telegram topic-aware logs.
5. Vietnamese locale.
6. Bot avatar gallery.
7. Ollama/free-tier badge.

## 6. Key UX Requirements

### Agent Overview

Must show:

- Agent name, id, role, topic/group if available.
- Current model/provider.
- Tool/capability profile.
- Safety/eval phase: draft, shadow, production, paused.
- Recent health/errors.
- Last meaningful action or pending approval.

### Shadow Eval Panel

Must show:

- Rubric name/version.
- Score by task/category.
- Failed blockers.
- Model tested.
- Prompt/config version if available.
- Promotion recommendation: promote / keep shadow / restrict / rollback.

### Ops/Logs View

Must show:

- Gateway restart/config/plugin events.
- Tool errors.
- Agent eval events.
- Cron/schedule changes.
- Topic-aware filters: HQ, DEV, Income Lab, Ops.

Must not show:

- Raw tokens, API keys, cookies, auth profiles, private keys.

## 7. First 3 PR Candidates (Tentative)

These are tentative until baseline/repro confirms.

1. Fix or document OpenClaw gateway/container connection path (#608).
2. Reduce/guard doctor CPU/RAM spike (#613).
3. Security storage/injection triage fix (#574 or #576 depending repro severity).

## 8. Open Questions

- What are the real 41 panels Mai detected, and which are user-facing vs internal/dev?
- Which authentication/session model is currently intended?
- Is Mission Control meant to manage OpenClaw directly, or observe + deep-link to OpenClaw?
- Which actions should require explicit approval in UI?
- Should Tyler-specific extensions live as plugins, feature flags, or fork-only modules?

## 9. Non-Goals for v0

- Do not redesign the entire UI before baseline.
- Do not add Vietnamese locale before core integration is trustworthy.
- Do not add broad agent autonomy from Mission Control until approval/audit flows are clear.
- Do not store or display secrets for convenience.

## 10. OpenClaw Integration Reality Check

Preliminary finding from Phase 0 Day 1:

`src/lib/adapters/openclaw.ts` is not the full OpenClaw gateway integration. It appears to be a shallow Mission Control framework adapter/event bridge:

- `register(agent)` broadcasts `agent.created`.
- `heartbeat(payload)` broadcasts `agent.status_changed`.
- `reportTask(report)` broadcasts `task.updated`.
- `getAssignments(agentId)` queries Mission Control's own `tasks` table.
- `disconnect()` broadcasts offline status.

What it does **not** appear to do:

- It does not read `~/.openclaw/openclaw.json`.
- It does not connect to the OpenClaw gateway WebSocket/Bot API.
- It does not poll Telegram/channels.
- It does not own gateway/container discovery.
- It does not own chat/session integration for real OpenClaw agents.

Likely real integration ownership to inspect:

- `src/app/api/gateways/**`
- `src/app/api/agents/**`
- `src/app/api/chat/**`
- `src/app/api/exec-approvals/**`
- gateway-control / multi-gateway UI panels
- chat/session panels
- gateway config/state modules under `src/lib/**`

Implication for Phase 1:

- Do not patch `src/lib/adapters/openclaw.ts` first unless baseline proves the bug lives there.
- Issues such as #608 gateway/container broken and #611 gateway-agent chat support likely live in gateway connection/client API layers, not this adapter.

Acceptance criteria for the final baseline:

- Trace the actual UI → API route → gateway/client path for at least one successful gateway operation.
- Trace the failure path for #608 or mark it not reproducible with evidence.
- Identify the owner files for #611 chat/session gateway-agent support before proposing a fix.
