# Mission Control Completion Roadmap — Đào lead

Status: Draft for Tyler approval  
Owner: Đào (coordination/review/merge) + Mai (implementation when tagged)  
Updated: 2026-04-27

## Operating rules

- One active PR at a time unless explicitly marked parallel-safe.
- Every implementation PR needs: scope, done_when, evidence gates, rollback note.
- Đào assigns tasks to Mai with exact scope and reviews before merge.
- Mai should not self-expand scope; file follow-ups instead.
- External/upstream/public/destructive/sensitive actions require Tyler approval.
- Secrets must never be posted in group; redact auth/session/token/cookie values.

## Completion definition

Mission Control is considered “complete enough” for Tyler AI Team when:

1. It runs reliably on Tyler's local/VPS workflow with admin auth and gateway connection.
2. Core dashboard surfaces (agents, sessions/chat, tasks, gateway health, memory/logs) work without CLI-path surprises.
3. Known security issues from the baseline are either fixed, verified, or explicitly tracked as accepted follow-up.
4. Build/typecheck/unit + targeted browser smoke gates pass.
5. Operational docs explain how to start, log in, recover, rotate credentials, and troubleshoot.

---

## Phase 0 — Control plane hygiene and source-of-truth

Goal: make the project safe to operate before more coding.

### 0.1 Credential handoff + admin rotation closure
- Owner: Đào + Tyler
- Status: in progress
- Tasks:
  - Confirm old leaked credential message is deleted or no longer visible.
  - Deliver/replace rotated admin password through a safe path; do not paste in group.
  - Remove temporary password file after Tyler has access or after Tyler chooses a new password.
  - Document credential rotation procedure.
- Done when:
  - Tyler can log in.
  - Old sessions are invalidated.
  - No temp secret file remains.
- Evidence:
  - Login HTTP 200 or UI login confirmed, redacted.
  - `user_sessions` cleared at rotation time.

### 0.2 Mission Control roadmap committed
- Owner: Đào
- Status: proposed
- Tasks:
  - Commit this roadmap under `docs/audit/MISSION_CONTROL_ROADMAP.md` after Tyler approval.
  - Update watchdog state to point to current active phase/task.
- Done when:
  - Roadmap is merged or kept as accepted working doc.

### 0.3 Backlog triage from baseline
- Owner: Đào
- Status: proposed
- Tasks:
  - Convert baseline residuals/follow-ups into ordered tasks.
  - Mark each as fix / verify / docs / defer.
- Done when:
  - Each known issue has owner, priority, and acceptance criteria.

---

## Phase 1 — Finish baseline security/deployability follow-ups

Goal: close the items already discovered during Phase 1/2 audit work.

### 1.1 Hydration nonce mismatch follow-up
- Owner: Mai implementation, Đào review
- Priority: medium
- Problem:
  - Next dev overlay reports SSR/client nonce mismatch: server renders `<script nonce="">`, client hydrates with populated nonce.
  - Touch points: `src/lib/csp.ts`, `src/proxy.ts`, `src/app/layout.tsx`.
- Tasks:
  - Reproduce on fresh page load.
  - Identify whether nonce header is unavailable in server component, stale, or Turbopack-only.
  - Fix or document dev-only false positive.
  - Add small test if feasible.
- Done when:
  - No hydration nonce overlay on dev load, or documented as dev-only with evidence.
- Gates:
  - `pnpm run typecheck` or equivalent.
  - Targeted test if added.
  - Browser screenshot/log after fix.

### 1.2 Notifications delivery WS migration
- Owner: Mai implementation, Đào review
- Priority: high
- Problem:
  - `src/app/api/notifications/deliver/route.ts` still shells out via `runOpenClaw(['gateway','call','agent',...])`.
  - Same container `spawn openclaw ENOENT` risk as #608.
- Tasks:
  - Replace notification delivery gateway-agent call with native WS helper.
  - Preserve payload semantics and error reporting.
  - Add source-discipline regression test narrowly for this route.
- Done when:
  - No CLI shell-out for notification delivery agent call.
  - Test guards no regression.
- Gates:
  - Targeted unit tests.
  - Source grep evidence.

### 1.3 Generic gateway caller inventory
- Owner: Mai inventory, Đào prioritization
- Priority: high
- Problem:
  - Multiple routes still use `runOpenClaw` or generic CLI wrappers.
- Tasks:
  - Inventory all `runOpenClaw`/`callOpenClawGateway` usages.
  - Classify each as: must remain CLI, should migrate WS, safe low priority, or destructive/sensitive.
  - Propose PR split.
- Done when:
  - Inventory table exists with recommended migration order.
- Gates:
  - Grep output included.

### 1.4 Generic gateway WS migration batch 1
- Owner: Mai implementation, Đào review
- Priority: high
- Candidate paths:
  - `channels/route.ts`
  - `nodes/route.ts`
  - `sessions/route.ts`
  - transcript/control routes using gateway RPC
- Tasks:
  - Migrate safe RPC-style callers to `callOpenClawGatewayWS`/native helper.
  - Keep true CLI operations unchanged.
  - Add focused tests/source guards.
- Done when:
  - Core panels do not depend on shelling out for gateway RPC.
- Gates:
  - Unit tests.
  - Manual smoke for affected panels.

### 1.5 #574 legacy migration verification follow-up
- Owner: Đào design, Mai execute if feasible
- Priority: medium
- Problem:
  - Fresh IDB device identity is verified; legacy localStorage migration was only partially exercised with synthetic fixture.
- Tasks:
  - Decide whether real legacy fixture exists or can be generated from a previous MC version.
  - If feasible, run pre-page instrumentation to capture exact error path.
  - Otherwise document accepted limitation.
- Done when:
  - Legacy migration is verified E2E or explicitly accepted as pending upstream/browser-fixture limitation.
- Gates:
  - Redacted browser evidence.

### 1.6 `mc-device-token` classification
- Owner: Đào review, Mai source audit
- Priority: medium
- Problem:
  - Need determine if `mc-device-token` is bearer-equivalent and should be treated like a secret.
- Tasks:
  - Use `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` as starting point.
  - Inspect gateway-side token usage.
  - Update baseline/security doc with classification.
- Done when:
  - Classified as bearer-equivalent or non-bearer with evidence.

---

## Phase 2 — Runtime reliability and environment hardening

Goal: make Tyler's running instance boring and recoverable.

### 2.1 Admin auth/env setup hardening
- Owner: Mai implementation, Đào review
- Tasks:
  - Clarify `.env.local` / `.env` behavior for `AUTH_PASS`, `AUTH_PASS_B64`, and existing DB users.
  - Add docs for password rotation and session invalidation.
  - Consider admin UI/API for password rotation if absent.
- Done when:
  - Tyler can rotate admin password without DB surgery.

### 2.2 Gateway online/offline reliability
- Owner: Mai implementation
- Problem:
  - Camofox tab hit `GW Offline` during instrumentation while gateway was live.
- Tasks:
  - Reproduce gateway offline banner.
  - Distinguish origin/session/storage issues (`localhost` vs `127.0.0.1`) from real gateway errors.
  - Improve UI diagnostics.
- Done when:
  - Offline state explains cause and recovery.

### 2.3 Start/stop/dev-server runbook
- Owner: Đào docs, Mai verify
- Tasks:
  - Document safe commands to start/stop MC dev server without killing unrelated Next/9router processes.
  - Include `OPENCLAW_BIN` requirement.
- Done when:
  - Runbook verified from clean shell.

### 2.4 Doctor/security warning cleanup
- Owner: Mai
- Tasks:
  - Re-run doctor/security scan after password rotation.
  - Clear avoidable warnings or document accepted warnings.
- Done when:
  - Doctor/security status is clean or has accepted exceptions.

---

## Phase 3 — Core product surface stabilization

Goal: ensure the dashboard panels Tyler actually uses are functional.

### 3.1 Agent panel smoke + fixes
- Verify agent list, identity, model/provider, status, wake/message action.

### 3.2 Sessions/chat panel smoke + fixes
- Verify session list, transcript fetch, send message, abort/control where applicable.

### 3.3 Tasks panel smoke + fixes
- Verify create task, dispatch to main agent, observe status updates, no CLI shell-out regression.

### 3.4 Gateway/nodes/channels panels smoke + fixes
- Verify gateway status, node list/actions where safe, channel list/login state.

### 3.5 Memory/logs panel smoke + fixes
- Verify memory tree/content/link endpoints and logs/events display.

Done when for Phase 3:
- A manual smoke checklist passes with screenshots/log snippets.
- Bugs found are fixed or filed with priority.

---

## Phase 4 — Test/CI confidence

Goal: prevent regressions before larger feature work.

### 4.1 Resolve pre-existing `gateway-url.test.ts` failure
- Owner: Mai
- Done when: full unit suite no longer has this known failure, or test is explicitly corrected/documented.

### 4.2 Consolidate source-discipline tests
- Add/maintain tests preventing reintroduction of forbidden CLI shell-out patterns in migrated routes.

### 4.3 Browser smoke suite
- Add Playwright/Camofox-compatible smoke for login, dashboard load, gateway connect, and task dispatch.

### 4.4 Container/Docker smoke
- Verify original #608 deployment class: MC without bundled `openclaw` CLI still works for WS-migrated paths.

---

## Phase 5 — Tyler-stack features

Goal: implement Tyler-specific value after the foundation is stable.

### 5.1 Provider/model visibility
- Show 9router/cx/gpt-5.5 and provider routing clearly per agent/session.

### 5.2 Shadow/eval score panel
- Display eval phase, rubric, score, promotion readiness, and recent failures.

### 5.3 Telegram topic-aware logs
- Link sessions/actions back to Telegram group/topic where possible.

### 5.4 Vietnamese locale / Tyler-friendly copy
- Add Vietnamese-friendly labels for Tyler's daily use without breaking upstreamability.

### 5.5 Bot avatar gallery
- Visual management of agent avatars/personas.

### 5.6 Ollama/free-tier badge
- Surface local/free/paid provider status to avoid cost surprises.

---

## Phase 6 — Release/readiness

Goal: make this maintainable and potentially upstreamable.

### 6.1 Documentation pass
- Update README/quickstart/deployment/security docs with actual verified behavior.

### 6.2 Upstream PR strategy
- Split generic fixes into upstream-friendly PRs.
- Keep Tyler-specific features fork-only until generalized.

### 6.3 Final acceptance pass
- Full test suite.
- Browser smoke.
- Doctor/security scan.
- Roadmap residuals reviewed with Tyler.

---

## Immediate next task recommendation

Start with **Phase 1.3 Generic gateway caller inventory**, then implement **Phase 1.2 Notifications delivery WS migration**.

Reason: it is the same risk class as #608, already found in PR #8, and small enough for Mai to execute cleanly under Đào review.
