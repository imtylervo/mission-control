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
- **Status: ✅ complete via PR #12 (`ce2d8ee`).** Notifications delivery agent invocation, plus the matching `chat/messages` invoke + `agent.wait` companion, all migrated from `runOpenClaw(['gateway','call','agent',...])` to `callOpenClawGatewayWS('agent', ...)` and `callOpenClawGatewayWS('agent.wait', ...)`. Source-discipline guard added at `src/lib/__tests__/gateway-call-agent-source-discipline.test.ts`.
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
- **Status: ✅ complete via PRs #10 (`d100739`) inventory, #11 (`f681f41`) sessions_send batch, #12 (`ce2d8ee`) gateway-call-agent batch, and #13 (`b0c7c334`) callOpenClawGateway wrapper-swap batch.** Inventory doc lives at `docs/audit/PR10_GATEWAY_CALLER_INVENTORY.md` and remains the source-of-truth for any follow-on Tier 3 / KEEP CLI / NEEDS DESIGN decisions.
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
- **Status: ⚠️ substantially complete via PR #13 (`b0c7c334`); two design-deferred leftovers documented below.** 14 of 17 inventoried `callOpenClawGateway` callsites migrated to `callOpenClawGatewayWS`. Source-discipline guard at `src/lib/__tests__/wrapper-swap-source-discipline.test.ts` covers both the migrated files and the deferred ones (asserts the deferral marker comment is present so a future cleanup pass cannot silently strip the legacy call).
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

#### 1.4 deferred leftovers — design tickets needed before migration

These three callsites are intentionally retained on the legacy `callOpenClawGateway` wrapper (with marker comment `INTENTIONALLY retained on the legacy` at the call site) until the design questions below are resolved. The wrapper module `src/lib/openclaw-gateway.ts` and its parser test `openclaw-gateway.test.ts` are kept alive for the same reason.

| Callsite | Deferral reason | Unblock condition |
| --- | --- | --- |
| `src/app/api/spawn/route.ts` × 2 (`sessions_spawn`) | WS `sessions.create` schema lacks `runTimeoutSeconds`, tools profile, runtime, and cleanup fields that the CLI tool accepts (per Đào msg 1336). Silently mapping would introduce a parity bug. | Either extend the WS `sessions.create` schema to cover these fields, OR design a parity shim on the MC server that translates the CLI-style spawn payload into a series of WS calls (`sessions.create` + follow-up `sessions.patch` for the missing fields). |
| `src/app/api/sessions/transcript/gateway/route.ts` × 1 (`chat.history`) | The WS protocol does not export `chat.history` as of 2026-04-27 (per Đào's check). | Either add `chat.history` to the gateway WS protocol, OR pick an alternative read path (disk-side transcript reader is already the existing CLI fallback in this route). |
| `src/app/api/pipelines/run/route.ts:137` (`runOpenClaw(['agent', '--message', ...])`) | NOT in the Phase 1.4 batch. Uses the CLI's own `agent` long-running spawn (not `gateway call agent` RPC); spawn-vs-RPC parity needs a design call (does the caller need a long-lived stream of agent output, or a single deferred result?). | Separate design ticket — see follow-up note in `docs/audit/PR10_GATEWAY_CALLER_INVENTORY.md`. |

Follow-on cleanup gated on the first two unblocks:
- Delete `src/lib/openclaw-gateway.ts` and its unit test once both deferred files migrate.
- Simplify `chat/messages/route.ts` catch blocks (orphaned CLI-quirk recovery branches) and remove the local `parseGatewayJson` function.
- Update `task-dispatch-source-discipline.test.ts` test #4 from "callOpenClawGateway is still available" to "callOpenClawGateway has been removed".

### 1.5 #574 legacy migration verification follow-up
- Owner: Đào design, Mai execute if feasible
- Priority: medium
- **Status: ✅ complete via PR #16. Migration is VERIFIED on Chromium end-to-end. The earlier partial-failure observed on Camoufox/Firefox during PR #5 sub-task 5a is documented as a Firefox-side CryptoKey-IDB roundtrip quirk, NOT an MC app bug.** Fixture format was confirmed valid by source review of pre-#574 commit `1411296`. See `docs/audit/PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` for the full evidence + reproducible test script at `docs/audit/scripts/pr16-mc-574-migration-test.js`.
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
- **Status: ✅ complete via PR #18.** Classified as **bearer-equivalent** based on local OpenClaw `2026.4.24` gateway source (`~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js:10538-10579`): `verifyDeviceToken` runs as a fallback auth path that grants `authMethod="device-token"` without requiring a fresh `device.signature` in the same connect frame. XSS that reads `mc-device-token` + `mc-device-id` from `localStorage` can replay against the gateway and acquire a session without the private key. Storage-migration implementation tracked as Phase 1.7 below. See `docs/audit/PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md` and the appended "Update 2026-04-27" section in `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md`.
- Problem:
  - Need determine if `mc-device-token` is bearer-equivalent and should be treated like a secret.
- Tasks:
  - Use `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` as starting point.
  - Inspect gateway-side token usage.
  - Update baseline/security doc with classification.
- Done when:
  - Classified as bearer-equivalent or non-bearer with evidence.

### 1.7 `mc-device-token` storage migration (XSS-exfil hardening)
- Owner: Đào design, Mai implement
- Priority: medium-high (security follow-up to Phase 1.6 classification)
- **Status: ✅ complete via PR #19.** Đào msg 1552 picked option (b) `sessionStorage`. Storage helpers in `src/lib/device-identity.ts` rewritten to read/write `sessionStorage`; pre-Phase-1.7 `localStorage['mc-device-token']` entries are dropped on first read without promotion (so next handshake re-mints under the new scope). All storage operations are best-effort with `try/catch` so private/lockdown browsing modes degrade gracefully. New source-discipline test pins the invariant. See `docs/audit/PR19_PHASE_1_7_DEVICE_TOKEN_SESSIONSTORAGE.md`.
- Problem:
  - Phase 1.6 classified `mc-device-token` as bearer-equivalent. Storing it in `localStorage` makes it trivially XSS-readable, defeating the same threat model PR #574 addressed for the private key (which lives in IndexedDB with `extractable: false`).
- Decision points (Đào to pick before implementation):
  - **(a) in-memory only** — drop on tab close; force re-pair on reload. Highest hardening, biggest UX cost.
  - **(b) `sessionStorage` ✅ chosen** — survives reloads within tab, dropped at close. Mid-tier hardening; still same-origin JS-readable so only mitigates *persisted* XSS exfil.
  - **(c) `httpOnly` BFF cookie** — JS-unreadable; requires the Mission Control server to proxy the gateway connect frame. Highest practical hardening, biggest implementation cost. Future option if same-tab residual risk turns into incident.
- Tasks (after option pick):
  - Move `cacheDeviceToken` / `getCachedDeviceToken` off `localStorage`.
  - Update `src/lib/websocket.ts` consumers (lines `226`, `233`, `298`, `402-403`).
  - Add a source-discipline test that asserts `localStorage` has no `'mc-device-token'` write site and no read site outside the chosen storage abstraction.
  - Update `docs/audit/MISSION_CONTROL_BASELINE.md` row to reflect the closed bearer-exfil path.
- Done when:
  - `mc-device-token` no longer present in `localStorage` on a fresh session.
  - Source-discipline test guards against regression.
  - Browser smoke confirms reconnect flow still works under the chosen option.
- Gates:
  - `pnpm run typecheck`.
  - Targeted vitest source-discipline test.
  - Browser smoke (Chromium under Playwright if `MC_STORAGE_STATE_FILE` is available, otherwise manual).

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

Phase 1.2, 1.3, and 1.4 (substantially) are now complete — see the Status lines on each section. The remaining Phase 1 candidates, in suggested order:

1. **Phase 1.1 — Hydration nonce mismatch follow-up.** PR #15 applied Option A (`suppressHydrationWarning`). PR #17 is a draft harness that runs the dashboard-route verification; it is **PENDING dashboard auth** because the rotated admin password file is not on the box. Once a credential is restored, run the harness and either close the row ✅ or escalate to Option D (Next.js bump).
2. ~~**Phase 1.5 — #574 legacy migration verification.**~~ **Done via PR #16.** Migration verified end-to-end on Chromium (with the real fixture format from pre-#574 commit `1411296`). The Camoufox partial-failure observed in PR #5 sub-task 5a is reclassified as a Firefox-side CryptoKey-IDB roundtrip quirk, not an MC bug. Code path unchanged.
3. ~~**Phase 1.6 — `mc-device-token` classification.**~~ **Done via PR #18.** Classified **bearer-equivalent** based on local OpenClaw `2026.4.24` gateway source: `verifyDeviceToken` runs as a fallback auth path that grants `authMethod="device-token"` without requiring a fresh `device.signature`.
4. ~~**Phase 1.7 — `mc-device-token` storage migration.**~~ **Done via PR #19.** Token moved from `localStorage` to `sessionStorage` (option (b) per Đào design call). Persistent-XSS / cross-tab / disk-dump exfil paths closed; same-tab same-origin JS read remains as residual (mitigated by future option (c) `httpOnly` BFF cookie if needed).

The Phase 1.4 design-deferred leftovers (spawn `sessions_spawn`, transcript `chat.history`) and the Phase 1.4 NEEDS DESIGN item (`pipelines/run`) are tracked under "1.4 deferred leftovers" above and should be picked up only after Đào opens explicit design tickets for them.
