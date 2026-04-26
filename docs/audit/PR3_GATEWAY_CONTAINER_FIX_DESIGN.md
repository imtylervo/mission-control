# PR #3 Design — Gateway Container/Distributed Fix (#608)

**Owner:** Mai (architecture/code) + Đào (security/AC review)
**Status:** Draft for review
**Branch:** `phase-1/pr3-gateway-fix-design`
**Target after approval:** `phase-1/pr3-gateway-fix-impl` → PR into `phase-0/baseline-audit`
**Strategy:** Y (independent narrow fix per Đào msg 1073 + Tyler approval msg 1074), upstream PR #607 = reference only

---

## 1. Problem

Issue [#608](https://github.com/builderz-labs/mission-control/issues/608) reports gateway integration is broken in containerized / distributed deployments. Two distinct bugs combine:

### Bug 1 — `spawn openclaw ENOENT` in MC container
- `src/lib/openclaw-gateway.ts:40 callOpenClawGateway()` uses `runOpenClaw(['gateway', 'call', method, ...])`
- `src/lib/task-dispatch.ts:426` (aegis review path) uses `runOpenClaw(['gateway', 'call', 'agent', '--expect-final', ...])`
- `src/lib/task-dispatch.ts:742` (new-session task dispatch) uses the same `runOpenClaw([...])`
- All three rely on the `openclaw` CLI binary being present on Mission Control's filesystem
- In a containerized MC image (where openclaw binary is not bundled), every gateway call throws `ENOENT`

### Bug 2 — `agent.wait` returns lifecycle metadata only
Even when the CLI exists, the legacy two-step pattern (`agent` invoke + `agent.wait` poll) returns only `{runId, status, startedAt, endedAt}`. The actual LLM response text is dropped because `deliver: false` is set on invocation. Every dispatch ends with `Agent returned empty response`.

**Status of Bug 2 in our fork**: `task-dispatch.ts:739-741` already mitigates by passing `--expect-final` to the CLI, which makes the CLI block until the agent completes and serializes `result.payloads[0].text` into stdout. **However, this mitigation is gated on the CLI being present** — Bug 1 still blocks the container case. Fixing Bug 1 by removing the CLI dependency will require us to re-handle Bug 2 in the new transport (HTTP or WS), since `--expect-final` is a CLI-only convenience.

## 2. Reproduction

**Live Docker repro:** **[blocked]** in current environment — Tyler's setup is direct VM, not containerized. No docker daemon active for MC image build.

**Repro evidence stands without local Docker:**
1. Code reading confirms 3 `runOpenClaw([..., 'gateway', 'call', ...])` call sites unconditional on environment
2. Upstream issue #608 body provides Kubernetes pod repro by jmmc-tools (independent reporter)
3. Upstream PR #607 description claims production verification of the same fix shape
4. Logical proof: any environment without `openclaw` on `$PATH` reaches the spawn → ENOENT path; the CLI is not vendored in MC's npm package or Dockerfile build context (verified: no `openclaw` binary in `node_modules/.bin`).

Mark as **blocked-but-confirmed**. PR description will reference upstream evidence. CI matrix can be added by future maintainer with Docker access.

## 3. Goals / Non-goals

### Goals
- Mission Control task dispatch + aegis review work end-to-end without `openclaw` CLI binary on MC's PATH.
- Full LLM response text reaches MC and is stored as task comment / quality_review notes.
- Tasks transition `assigned → in_progress → review → done` (or `failed` on error) instead of accumulating `dispatch_attempts` indefinitely.
- Existing direct-VM deployments (Tyler's setup) keep working — no behavioral regression for users who currently have the CLI on PATH.

### Non-goals
- **Not bundling** workspace browser, git-log, sessions API routes, or i18n updates (PR #607 mistake).
- Not changing the gateway protocol, auth handshake, or device pairing (#574 territory).
- Not removing the CLI integration entirely — keep `runOpenClaw` in the codebase for `doctor`, `status`, `sessions cleanup` commands that are local-only.
- Not adding container/Docker test matrix in this PR (deferred to follow-up; needs maintainer infra).
- Not touching the `chat.send` to existing-session path's underlying semantics (it's documented as fire-and-forget, not gated on response text).

## 4. Approaches considered

### Approach A — HTTP `/v1/chat/completions` (PR #607's choice)

**Idea:** POST to `http://<gateway-host>:<gateway-port>/v1/chat/completions` with model `openclaw/<agentId>`, get full response via `choices[0].message.content`.

**Pros:**
- Simplest client — single fetch, OpenAI-compatible response shape
- Matches PR #607 strategy (we can cite their approach, not duplicate)
- No protocol expertise needed in MC

**Cons / unknown:**
- **Verification needed**: Tyler's openclaw gateway (PID 771887, port 18789) returned `Not Found` for `POST /v1/chat/completions` and `GET /api/agents` in Mai's smoke probe (`Authorization: Bearer <token>`). Either the endpoint is not exposed in this gateway version, or the auth header was wrong, or the route requires additional path prefix.
- If PR #607 relies on a newer gateway version that exposes `/v1`, our fork users may not have it.
- Need to check gateway version currently shipped in `~/.openclaw/`.

### Approach B — Native WebSocket client (PR #607's secondary track)

**Idea:** Replace `runOpenClaw([..., 'gateway', 'call', method, ...])` with a TypeScript WS client that:
1. Connects to `ws://<gateway>:<port>/ws/<role>` with bearer-token + device-auth handshake (protocol v3)
2. Sends RPC frames `{type: 'req', id, method, params: { agentId, message, idempotencyKey, deliver: true }}`
3. Listens for `frame.type === 'res'` with the full payload text on `result.payloads[0].text` (or per the agent-final event)
4. Resolves the promise when the run reaches a final status

**Pros:**
- Works with the gateway protocol that's known-present (Mai confirmed `ws://localhost:18789` listening; Mission Control's existing client uses this)
- Doesn't depend on a specific HTTP REST shape that may not be there
- Lets us set `deliver: true` directly in invoke params, eliminating Bug 2 cleanly

**Cons:**
- More code (~200 lines including handshake)
- Reuses logic that already exists in `src/lib/websocket.ts` (browser-side WS client) — must be ported to server-side `ws` package, which is what PR #607 did
- Auth handshake re-implementation is testing-heavy

### Approach C — Hybrid: prefer A, fall back to B

**Idea:** Probe `/v1/chat/completions` at startup; use it if available, otherwise WS. Two code paths, doubled test surface.

**Verdict:** rejected — adds maintenance burden for marginal benefit. Choose A or B exclusively.

## 5. Decision request

**Mai recommends Approach B (Native WS client)** because:
1. Smoke probe shows `/v1/chat/completions` returns `Not Found` on Tyler's gateway → A is unverified for our environment
2. WS protocol is explicitly documented in MC's existing browser client (`src/lib/websocket.ts`) → server-side port has clear reference
3. Eliminates Bug 2 by setting `deliver: true` in the RPC params (no `--expect-final` needed)
4. Independent of any specific gateway HTTP version

**Open question for Tyler / Đào:**
- Should we first verify whether Tyler's gateway actually supports `/v1/chat/completions` with the right auth path? If yes → Approach A is simpler. If no → Approach B is required.
- Mai's vote: spend 5 minutes verifying A's availability before committing to B.

## 6. Implementation sketch (Approach B)

### 6.1 New module — `src/lib/openclaw-gateway-ws.ts`

```typescript
import WebSocket from 'ws'
import { config } from './config'
import { getDetectedGatewayToken } from './gateway-runtime'

export interface CallGatewayAgentResult {
  text: string
  sessionId?: string
  runId?: string
}

export async function callOpenClawGatewayWS<T = unknown>(
  method: string,
  params: unknown,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  // Connect → auth handshake → send req → await res with matching id
  // Throws GatewayCallError on protocol error or timeout
}

export async function callGatewayAgent(
  agentId: string,
  message: string,
  opts: { timeoutMs?: number; idempotencyKey?: string; model?: string } = {}
): Promise<CallGatewayAgentResult> {
  // High-level wrapper: invokes 'agent' RPC with deliver:true, waits for final result
  // Returns { text, sessionId, runId }
}
```

### 6.2 Update `src/lib/openclaw-gateway.ts`

```typescript
// Keep parseGatewayJsonOutput export for backward compat (tests still reference it)

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
): Promise<T> {
  return callOpenClawGatewayWS<T>(method, params, { timeoutMs })
}
```

The signature is preserved so all existing call sites (`channels/route.ts`, etc.) keep working.

### 6.3 Update `src/lib/task-dispatch.ts`

Three call sites change:

**Site 1 — `chat.send` to existing session (line 706)**: keep `callOpenClawGateway` (now WS-backed via the wrapper above). No semantic change — still fire-and-forget.

**Site 2 — Aegis review (line 426)**: replace `runOpenClaw([..., 'gateway', 'call', 'agent', '--expect-final', ...])` with:
```typescript
const aegisRunResult = await callGatewayAgent(reviewAgent, prompt, {
  timeoutMs: 120_000,
  idempotencyKey: invokeParams.idempotencyKey,
})
agentResponse = { text: aegisRunResult.text, sessionId: aegisRunResult.sessionId }
```

**Site 3 — New-session dispatch (line 742)**: same pattern as site 2.

### 6.4 No changes outside `src/lib/openclaw-gateway*.ts` and `src/lib/task-dispatch.ts`

Everything else (UI, other API routes, adapters) keeps the same import surface.

## 7. Acceptance Criteria

Combining Đào's done_when (msg 1070 + 1073):

### Functional
- [ ] No `runOpenClaw([..., 'gateway', 'call', ...])` shell-out anywhere in `src/lib/task-dispatch.ts` or `src/lib/openclaw-gateway.ts` (grep test).
- [ ] `runOpenClaw` itself is preserved for `doctor`, `status`, `sessions cleanup` commands (out of #608 scope).
- [ ] Task dispatch returns full LLM text (not lifecycle metadata) — task transitions `assigned → in_progress → review → done`.
- [ ] Aegis review returns full LLM text — `quality_reviews` row stores actual verdict notes.
- [ ] Existing `parseGatewayJsonOutput` export retained so legacy tests don't break.

### Discipline
- [ ] No workspace browser, no new API routes, no i18n changes (Đào msg 1073 #1).
- [ ] Patch is small and reversible (Đào done_when #3).
- [ ] No bundled features or out-of-scope cleanups.

### Tests (vitest)
- [ ] Production source must NOT shell out `openclaw` for `gateway call` — grep test (parallels PR #2 source-discipline test).
- [ ] Empty `agent.wait` lifecycle response (`{runId, status, startedAt, endedAt}` with no text) must throw `Agent returned empty response`, not silently succeed with `text: ''`.
- [ ] WS path correctly parses response text from `result.payloads[0].text` (mock WS server fixture).
- [ ] Timeout path raises `GatewayCallError` and is recoverable (next dispatch attempt does not inherit dead state).
- [ ] Auth header is set on outbound WS connect when `getDetectedGatewayToken()` returns non-empty.

### Evidence
- [ ] Local vitest: target tests pass, no regression in existing 955+ pass count.
- [ ] `tsc --noEmit` clean.
- [ ] **Docker smoke**: `[blocked]` in PR description with reference to upstream #608 reproduction. Maintainer / future PR can add CI matrix when env permits.

## 8. Out of scope (follow-ups)

- Container/Docker test matrix — tracked separately, needs CI infra.
- WhatsApp / Discord channel-specific HTTP paths — already work via `gatewayInternalUrl` HTTP fetch in `channels/route.ts`; not affected.
- Gateway protocol v3 device-auth handshake hardening — see #574 follow-up.
- HTTP `/v1/chat/completions` path — only re-evaluate if upstream confirms general availability.
- Streaming token responses — current MC stores final text only; streaming is a UX feature for a different PR.

## 9. Risk + Rollback

### Risks
- **Auth handshake mismatch**: server-side WS client must replicate the v3 challenge-response correctly. If wrong, gateway rejects connection. **Mitigation**: copy logic from `src/lib/websocket.ts` (browser-side, known-working) and add unit test against a mock gateway that records the exact handshake frames.
- **Timeout drift**: legacy `--timeout 120000` flag was CLI-side; new path needs explicit `setTimeout` + abort. **Mitigation**: dedicated test for timeout path.
- **Existing direct-VM users**: if they had the CLI on PATH and relied on `--expect-final` semantics, the new WS path must match. **Mitigation**: signed integration test with the same mock that exercises both happy + lifecycle-only response paths.

### Rollback
- Revert PR commit. Tasks dispatched after revert start fresh runs. Tasks already in flight when revert lands may show `dispatch_attempts` increment one more time before the next cycle picks the legacy CLI path. No data loss.
- No DB migration in this PR → rollback is `git revert` clean.

## 10. Open questions

1. **Should we verify HTTP `/v1/chat/completions` first?** Mai recommends 5-min probe + Đào confirms before committing to Approach B.
2. **Aegis review path**: should we move `--expect-final` inline parsing logic into the new wrapper as a normalization step, or have callers handle parsing?
3. **Backwards compat for `callOpenClawGateway` callers in `channels/route.ts`**: can they tolerate WS replacing CLI for the few `chat.send`-style calls? Smoke test required.
4. **PR #607 attribution**: should our PR description credit jmmc-tools' approach (PR #607) explicitly so they understand we are not "stealing" their work?

---

**Mai's recommendation**: spend 5 minutes verifying HTTP `/v1/chat/completions` availability. If accessible → Approach A (lighter PR, ~50 lines). If not → Approach B (~250 lines but robust). Either way, scope stays narrow per Đào msg 1073.
