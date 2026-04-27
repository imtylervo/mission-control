# Mission Control Baseline — Phase 0

Status: In progress  
Started: 2026-04-26 00:28 Australia/Melbourne  
Owner: Mai (runtime/architecture) + Đào (spec/coordination)

## Current Verdict

Do not start Phase 1 implementation yet. Phase 0 is still collecting architecture, runtime, panel, and bug repro evidence.

## Confirmed Setup

- Fork: `imtylervo/mission-control`
- Local clone: `~/mission-control/`
- Upstream: `builderz-labs/mission-control`
- Version observed: 2.0.1
- Repo size observed: ~14MB

## Stack

- Next.js 16.1.6
- React 19
- TypeScript
- Tailwind
- SQLite via `better-sqlite3`
- Zustand state
- WebSocket via `ws`
- Vitest + Playwright
- Flow/charts: `@xyflow/react` / `reactflow`
- API docs: Scalar React API reference

## Smoke Test Status

- `pnpm install --frozen-lockfile`: PASS
- `pnpm typecheck`: PASS, no errors
- `pnpm test`: initially 922 pass / 9 fail; failures traced to missing git identity in environment, not obvious product bug. After setting git identity, `gnap-sync.test.ts` 15/15 passed. Full post-env rerun still pending.

## Initial Module Map

- `src/app/`: Next.js App Router and API routes.
- `src/components/`: UI areas including chat, dashboard, hud, layout, modals, onboarding, panels, settings, terminal, ui.
- `src/lib/`: core logic; large surface (~114 modules observed).
- `src/store/`: Zustand state, apparently single `index.ts` entry.
- `src/plugins/`: currently one hyperbrowser example plugin observed.
- `src/i18n/`: localization.
- `src/types/`: TypeScript types.

## Database Schema — Initial Read

Observed SQL schema has 9 tables:

- `tasks`
- `agents`
- `comments`
- `activities`
- `notifications`
- `task_subscriptions`
- `standup_reports`
- `quality_reviews`
- `gateway_health_logs`

Open question: auth/RBAC/api key storage may live in migrations or dynamic initialization; still needs tracing.

## OpenClaw Integration Reality Check

Preliminary finding: `src/lib/adapters/openclaw.ts` is shallow and should not be assumed to be the real gateway integration.

It appears to:

- broadcast `agent.created`
- broadcast `agent.status_changed`
- broadcast `task.updated`
- query Mission Control's own `tasks` table for assignments
- broadcast offline on disconnect

It does not appear to:

- read `~/.openclaw/openclaw.json`
- connect to OpenClaw gateway WebSocket/Bot API
- poll Telegram/channels
- own gateway/container discovery
- own real OpenClaw chat/session integration

Likely real owner areas to inspect next:

- `src/app/api/gateways/**`
- `src/app/api/agents/**`
- `src/app/api/chat/**`
- `src/app/api/exec-approvals/**`
- gateway-control / multi-gateway panels
- chat/session panels
- gateway config/state modules under `src/lib/**`

Implication: issues #608 and #611 likely live in gateway connection/client API layers, not `src/lib/adapters/openclaw.ts`, unless deeper evidence says otherwise.

## Panel Inventory

Preliminary count detected by Mai: 41 panels, while README claims 32. Needs UI/runtime verification.

Critical panels to deep-walk first:

1. task-board
2. agent-squad
3. security-audit
4. exec-approval
5. gateway-control
6. multi-gateway
7. cron-management
8. cost-tracker
9. log-viewer
10. memory-browser

## Priority Bug Repro Plan

- #608 gateway/container broken: reproduce via Docker/container gateway connect path.
- #613 doctor CPU/RAM spike: observe doctor call trigger/frequency/resource impact.
- #574 private key in localStorage: inspect browser storage after auth/device flow.
- #576 injection guard regex bypass: test encoding/homoglyph prompt variants through relevant API/UI.
- #611 gateway-agent chat support: trace chat session integration path.

## Do Not Touch Yet

- Do not patch `src/lib/adapters/openclaw.ts` just because issue names mention OpenClaw.
- Do not add Tyler-specific UI before baseline confirms stable gateway integration path.
- Do not implement Vietnamese locale before core architecture/risk map is complete.
- Do not modify security/auth storage until #574 is reproduced and storage model is understood.

## Next Steps

1. Complete full README/CLAUDE.md read.
2. Trace gateway-related API routes.
3. Run app in dev mode and manually walk critical panels.
4. Rerun full tests after environment fix.
5. Reproduce priority issues and attach evidence.
6. Turn findings into first 3 PR recommendations.

## Real OpenClaw Integration Files (deeper map)

After examining beyond `adapters/openclaw.ts`, the real gateway integration lives in:

| File | Lines | Role |
|---|---|---|
| `src/lib/openclaw-gateway.ts` | 65 | Wraps `openclaw gateway call <method>` subprocess + JSON output parser |
| `src/lib/gateway-runtime.ts` | 114 | Reads `~/.openclaw/openclaw.json` for token, port, controlUi.allowedOrigins. Also exposes `registerMcAsDashboard()` to add MC origin to OpenClaw allowlist |
| `src/lib/gateway-url.ts` | (small) | WS/HTTP URL builder |
| `src/lib/openclaw-doctor.ts` | 181 | Periodic `openclaw doctor` runner — likely source of #613 CPU spike |
| `src/lib/openclaw-doctor-fix.ts` | 77 | Existing fix attempt for doctor issues |
| `src/lib/command.ts` | (varies) | `runOpenClaw` subprocess wrapper used by gateway calls |

API routes integrating OpenClaw:

| Route | Purpose |
|---|---|
| `api/gateways/connect` | Builds browser→gateway WS URL with Tailscale + Docker bridge + protocol detection |
| `api/gateways/control` | Gateway control commands |
| `api/gateways/discover` | Auto-discover gateways on local network |
| `api/gateways/health` | Health probes |
| `api/gateway-config` | Read/write gateway config |
| `api/agents/sync` | Agent sync from OpenClaw to MC's `agents` table |
| `api/openclaw/doctor` | `openclaw doctor` runner endpoint (used by banner + onboarding) |

## Bug Ownership Map (evidence-based)

### #613 — `openclaw doctor` CPU/RAM spike

**Trigger sites identified:**
- `src/components/layout/openclaw-doctor-banner.tsx` — page-level banner. Uses `fetch('/api/openclaw/doctor', { cache: 'no-store' })` plus `setInterval` polling. **No rate-limit / debounce / cache TTL observed**.
- `src/app/[[...panel]]/page.tsx` — main App Router page mount.
- `src/components/onboarding/runtime-setup-modal.tsx` — onboarding modal trigger.
- `src/app/api/openclaw/doctor/route.ts` — endpoint that spawns subprocess.

**Hypothesis:** every page navigation can unmount/remount banner → re-run doctor → spawn subprocess → repeated CPU/RAM cost on resource-limited hosts.

### #574 — Ed25519 private key in localStorage (CRITICAL)

**Confirmed:** `src/lib/device-identity.ts`

```typescript
// Line 10 (comment): "Generates a persistent Ed25519 key pair on first use,
//                     stores it in localStorage"
// Line 80–81:
localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)
localStorage.setItem(STORAGE_PRIVKEY, privateKeyBase64)  // ⚠️ private key
// Line 99: read back during getStoredKeyPair()
const storedPriv = localStorage.getItem(STORAGE_PRIVKEY)
// Line 138: device token also lives in localStorage (STORAGE_DEVICE_TOKEN)
```

**Impact:** Any XSS injection, malicious browser extension, or compromised npm dependency can read the private key directly. The key is not protected by Web Crypto API, not non-extractable, and not behind any origin isolation beyond same-origin policy.

**Recommended fix path:** Web Crypto API `generateKey(...{ extractable: false })` + IndexedDB persistence. Public key can stay in localStorage. Migration must clean legacy `STORAGE_PRIVKEY` entry.

### #608 — Gateway integration broken in distributed/containerized deployment

**Browser → Gateway connect is DIRECT** (server only builds the URL). Therefore the fix scope is the **browser-reachable URL**, not server-reachable.

`src/app/api/gateways/connect/route.ts` already has Docker-bridge handling:
- Rejects `127.0.0.1`, `localhost`, `::1`, `host.docker.internal`, `host-gateway`, and `172.16/12 – 172.31/12` as non-browser-reachable.
- For non-browser-reachable gateway hosts, tries Tailscale Serve detection, then falls back to dashboard hostname + gateway port.

Likely failure modes still uncovered:
- Mission Control container + gateway on host network (gateway host appears as 172.x bridge IP — handled — but if gateway resolves a hostname that the browser also can't reach, fallback may still fail).
- Both in different containers without bridge override.
- Reverse proxy/TLS termination scenarios where MC sits behind nginx but gateway is a sibling container.

### #611 — chat integration not supporting OpenClaw gateway agents

Likely owner: `src/app/api/chat/**` + `src/app/api/agents/sync/route.ts` interaction. Adapter's `getAssignments()` only reads MC's own `tasks` table; it does not sync gateway agent sessions. To be re-confirmed during panel walkthrough.

### #576 — injection-guard regex bypass

Likely owner: `src/lib/security-scan.ts` or `src/lib/agent-evals.ts`. Bypass via homoglyph/encoding/semantic injection — needs reproduction with test prompts during Day 2.

## First 3 PR Candidates (Phase 1 entry)

| Order | PR | Severity | Risk | Effort |
|---|---|---|---|---|
| 1 | #613 doctor rate-limit + cache | Medium | Low | 1–2 days |
| 2 | #574 remove private key from localStorage | Critical | Medium–High (migration) | 3–5 days |
| 3 | #608 browser-reachable gateway URL fix | Medium | Medium | 2–3 days |

### Acceptance criteria

**#613**
- Navigating panels 20 times must not spawn 20 doctor subprocesses.
- Server-side cache TTL ≥ 30s.
- Client polling backoff exponential (or fixed but generous).
- Banner does not trigger doctor on every mount.
- Manual refresh button available for users who need real-time status.

**#574**
- `grep "STORAGE_PRIVKEY\|privateKey.*localStorage"` in `src/` returns no matches.
- Web Crypto API generates key with `extractable: false`.
- Migration removes legacy `STORAGE_PRIVKEY` entry on next launch.
- Existing devices migrate without re-pairing flow break (or with explicit re-pair if required).
- Public key in localStorage acceptable; device bearer token must be reviewed.

**#608**
- UI surfaces both detected internal URL and browser-reachable URL.
- Tested deployment matrix: dashboard on host + gateway on host; dashboard in container + gateway on host; both in container; both in different containers.
- Each scenario yields a working WS URL the browser can actually connect to.

### Đào refinements (msg 960)

**#613 cache + metadata at server layer:**
- Cache + single-flight should live at `/api/openclaw/doctor` route, not just client side, so every caller is protected.
- Response should carry metadata so UI knows whether data is fresh or cached:
  - `cached: true | false`
  - `ageMs: number`
  - `nextRefreshAfterMs: number`

**#608 dual-URL UI:**
- The bug's nature is "server can see it, browser cannot." Surface that gap directly:
  - Show **server-detected URL** and **browser-reachable URL** side-by-side in the gateway panel.
  - When they differ (e.g. Docker bridge or Tailscale path), explain the rewrite path.

## Day 1 Status Summary

- Setup: ✅ fork + clone + install
- Smoke: ✅ typecheck + 922/931 unit tests (9 fail = git env, fixed)
- Architecture map: ✅ 114 lib modules + 41 panels + 5 adapters + 9 DB tables
- OpenClaw integration map: ✅ 6 lib files + 7 API routes + adapter scope clarified
- Bug ownership map: ✅ #574 #613 confirmed, #608 #611 #576 estimated
- First 3 PR candidates locked with acceptance criteria
- Pending Day 1: panel deep walk top 10, dev mode smoke
- Pending Day 2: 41 panel light walk, 5 bug repro, full Vitest+Playwright run, risk map

## Đào Review Notes — Spec/Acceptance Pass

Reviewed: 2026-04-26 00:43 Australia/Melbourne

### Baseline quality check

- The baseline now separates shallow adapter behavior from real OpenClaw gateway integration. This prevents the team from patching `src/lib/adapters/openclaw.ts` prematurely.
- The first 3 PR candidates are correctly ordered by risk/value: #613 first for low-risk ops stabilization, #574 second for critical security with migration complexity, #608 third after Docker/browser-reachability repro.
- Acceptance criteria are concrete enough to support Quỳnh-style QA later.

### Additional acceptance criteria to carry forward

**General PR rule:** every Phase 1 PR should include:

- Repro evidence before fix or a documented “not reproducible” result.
- A small regression test where practical.
- No raw secrets/tokens in logs, screenshots, test fixtures, or docs.
- Rollback note if the fix touches auth, device identity, gateway connection, or subprocess execution.

**#613 doctor route:**

- Add a single-flight test or instrumentation note proving concurrent calls collapse into one subprocess.
- Expose response metadata in a backwards-compatible way; clients that ignore `cached/ageMs/nextRefreshAfterMs` should still work.

**#574 device identity:**

- Add a threat-model note: XSS/localStorage/private-key exfiltration is the risk being closed.
- Confirm whether `STORAGE_DEVICE_TOKEN` is bearer-equivalent. If yes, open a follow-up issue even if it is not fixed in the same PR.
- Migration should be idempotent: repeated launch must not recreate or preserve `STORAGE_PRIVKEY`.

**#608 gateway URL:**

- Test should distinguish server reachability from browser reachability. A server-side `fetch/ws` success alone is not enough.
- UI copy should avoid implying internal Docker/Tailscale addresses are directly browser-safe.

### Remaining open questions for Day 2

- Which of the 41 detected panels are production-facing vs dev/demo/internal?
- Does Mission Control currently have a formal auth/RBAC model, or only device identity + local trust?
- Which OpenClaw operations are meant to be observe-only versus executable from Mission Control?
- Where should Tyler-specific features live: feature flags, plugins, fork-only modules, or upstreamable abstractions?

## Day 2 Kickoff — Continued Audit Evidence

Timestamp: 2026-04-26 00:50 Australia/Melbourne

Tyler asked the team to continue immediately instead of waiting until tomorrow.

### Dev server smoke

- Command: `pnpm dev`
- Result: PASS
- Server: `http://127.0.0.1:3000`
- Startup: Next.js 16.1.6 Turbopack ready in ~586ms on rerun.
- `GET /setup`: HTTP 200, ~122KB HTML.
- `GET /`: HTTP 307 redirect to `/login`.

Browser automation note: direct browser navigation was blocked by current OpenClaw browser policy, so initial Day 2 UI walk is using HTTP/code inspection until browser access is available.

### Panel inventory confirmed by filesystem

`src/components/panels` contains 41 panel files, confirming the Day 1 discrepancy with README's “32 panels” claim.

Observed panel files:

- `orchestration-bar.tsx`
- `agent-squad-panel-phase3.tsx`
- `office-panel.tsx`
- `system-monitor-panel.tsx`
- `github-sync-panel.tsx`
- `settings-panel.tsx`
- `memory-graph.tsx`
- `super-admin-panel.tsx`
- `alert-rules-panel.tsx`
- `cost-tracker-panel.tsx`
- `documents-panel.tsx`
- `agent-history-panel.tsx`
- `debug-panel.tsx`
- `security-audit-panel.tsx`
- `chat-page-panel.tsx`
- `session-details-panel.tsx`
- `gateway-control-panel.tsx`
- `agent-detail-tabs.tsx`
- `agent-comms-panel.tsx`
- `gateway-config-panel.tsx`
- `pipeline-tab.tsx`
- `local-agents-doc-panel.tsx`
- `nodes-panel.tsx`
- `activity-feed-panel.tsx`
- `webhook-panel.tsx`
- `channels-panel.tsx`
- `multi-gateway-panel.tsx`
- `memory-browser-panel.tsx`
- `integrations-panel.tsx`
- `audit-trail-panel.tsx`
- `task-board-panel.tsx`
- `agent-cost-panel.tsx`
- `cron-management-panel.tsx`
- `standup-panel.tsx`
- `log-viewer-panel.tsx`
- `agent-squad-panel.tsx`
- `skills-panel.tsx`
- `notifications-panel.tsx`
- `token-dashboard-panel.tsx`
- `exec-approval-panel.tsx`
- `user-management-panel.tsx`

### Gateway/OpenClaw API route inventory confirmed

Observed route files:

- `src/app/api/gateway-config/route.ts`
- `src/app/api/gateways/route.ts`
- `src/app/api/gateways/connect/route.ts`
- `src/app/api/gateways/control/route.ts`
- `src/app/api/gateways/discover/route.ts`
- `src/app/api/gateways/health/route.ts`
- `src/app/api/gateways/health/history/route.ts`
- `src/app/api/openclaw/doctor/route.ts`
- `src/app/api/openclaw/update/route.ts`
- `src/app/api/openclaw/version/route.ts`
- `src/app/api/sessions/transcript/gateway/route.ts`

Next immediate trace target: map critical panel → API route calls for gateway-control, multi-gateway, cron-management, exec-approval, log-viewer, memory-browser.

## Mai Day-2 Findings — Critical Panel → API Route Map

Tracing top 6 critical panels' fetch calls:

### gateway-control-panel.tsx (2 routes)
- `GET  /api/gateways/control` — initial load
- `POST /api/gateways/control` — control commands (start/stop/restart)

### multi-gateway-panel.tsx (multiple routes — heaviest)
- `GET  /api/gateways` — list registered gateways
- `GET  /api/connect` — initial connect status
- `GET  /api/gateways/discover` — auto-discover
- `GET  /api/gateways/health/history` — recent health logs
- `POST /api/gateways` — add gateway
- `PATCH /api/gateways` — update
- `DELETE /api/gateways` — remove
- `POST /api/gateways/connect` — establish connection
- `POST /api/gateways/health` — manual health probe
- `POST /api/connect` — connect with parameters

### cron-management-panel.tsx
- `GET /api/cron?action=list`
- `GET /api/scheduler`
- `GET /api/status?action=models`
- `POST /api/cron` — create
- `GET /api/cron?...` — query specific job
- `GET /api/cron?action=logs&job=...` — job logs
- `PATCH /api/cron` — edit/enable/disable
- `DELETE /api/cron` — remove

### exec-approval-panel.tsx
- `POST /api/exec-approvals` — approve/deny
- `GET /api/exec-approvals?action=allowlist` — read allowlist
- `PATCH /api/exec-approvals` — update allowlist

### log-viewer-panel.tsx
- `GET /api/logs?<filters>` — query logs
- `GET /api/logs?action=sources` — list log sources
- `GET /api/status` — system status

### memory-browser-panel.tsx
- `GET /api/memory?<query>` — list memory
- `GET /api/memory?action=content&path=...` — read file
- `GET /api/memory/links?file=...` — backlinks
- `GET /api/memory?action=search&query=...` — search
- `POST /api/memory` — write
- `PATCH /api/memory` — update
- `DELETE /api/memory` — delete
- `GET /api/memory/health`
- `GET /api/hermes` — Hermes plugin install state
- `GET /api/hermes/memory` — Hermes memory data

## Bug #613 Doctor Trigger — Confirmed Behavior

`src/components/layout/openclaw-doctor-banner.tsx`:

```tsx
useEffect(() => {
  void loadDoctorStatus()  // calls fetch('/api/openclaw/doctor', cache: 'no-store')
}, [])
```

→ Banner runs `loadDoctorStatus()` on **every component mount** with empty dep array.

The previously-mentioned `setInterval` at line ~69 is for **rotating progress messages during manual Fix flow only**, not for periodic polling. The actual doctor invocation is once-per-mount.

**Real failure mode:** if `OpenClawDoctorBanner` is mounted in `[[...panel]]/page.tsx` (the App Router page wrapping every panel route), each navigation between panels remounts the banner → triggers `/api/openclaw/doctor` → spawns `openclaw doctor` subprocess. On a heavily-used dashboard, this multiplies fast.

Fix at server route level (Đào's recommendation) is the right answer because client mount count is hard to throttle without changing UX.

## Bug #574 Device Identity — Confirmed Storage Keys

`src/lib/device-identity.ts`:

```typescript
// File-level constants (lines 18–22)
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY = 'mc-device-privkey'   // ⚠️ Ed25519 PRIVATE key
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const STORAGE_GATEWAY_URL = 'mc-gateway-url'
```

**Purpose (per file header comment):**
> Ed25519 device identity for OpenClaw gateway protocol v3 challenge-response.
> Generates a persistent Ed25519 key pair on first use, stores it in localStorage,
> and signs server nonces during the WebSocket connect handshake.

**Severity confirmed CRITICAL:**
- Private signing key in `localStorage` is XSS-extractable.
- Compromise = full impersonation of the user's device for OpenClaw gateway handshake.
- "Falls back gracefully when Ed25519 is unavailable (older browsers) — auth-token-only mode" implies the auth-token in `STORAGE_DEVICE_TOKEN` is **also a bearer token in localStorage** — equally exposed.

**Not pasted here** (per Đào's discipline): no raw key values logged in this doc.

## Browser Walk Status

Day-2 visual panel walk attempted via Playwright MCP. Result:
- Playwright requested system Chrome at `/opt/google/chrome/chrome` (not installed).
- `npx playwright install chromium` downloaded chromium-headless-shell, but the local MCP server still expects full Chrome.
- Code-level panel→API mapping completed without browser. Visual walk deferred — Tyler can perform manually via dev server when ready.
- Alternative path if needed: route via Camofox (already running on this VPS) for headless walkthrough.

## Đào Day 2 Review — Risk Map Skeleton

Reviewed after Mai commit `94ea77b`.

### Confirmed high-signal findings

- #613 root cause is narrower than initial suspicion: `openclaw-doctor-banner.tsx` calls `loadDoctorStatus()` on mount with `cache: 'no-store'`; the visible interval appears to rotate fix/progress UI text, not poll doctor status. The risk is repeated mount-triggered subprocess calls during panel navigation.
- #574 has a clearly named private key localStorage entry (`mc-device-privkey`) plus a bearer-style fallback token (`mc-device-token`). Docs must continue listing key names only, never raw values.
- `multi-gateway` is the heaviest route consumer and should be treated as the main surface for #608 gateway reachability debugging.

### Risk map — safe to change first

Likely safe / isolated enough for early PRs after repro:

- Add server-side cache/single-flight to `/api/openclaw/doctor` without changing UI contract.
- Add response metadata to doctor route in a backward-compatible way.
- Add logging/instrumentation around doctor subprocess spawn count during tests.
- Add UI copy showing cached/fresh doctor status if metadata exists.
- Add docs/tests for browser-reachable vs server-reachable gateway URLs after #608 repro.

### Risk map — do not touch until deeper evidence

High-risk areas requiring tests and rollback notes:

- Device identity key generation/storage/migration (`src/lib/device-identity.ts`).
- Any auth/RBAC/session trust model tied to `mc-device-token`.
- Gateway URL rewrite logic in Docker/Tailscale/reverse-proxy cases before the deployment matrix is reproduced.
- Injection guard core logic before #576 repro cases are captured.
- Chat/session integration before #611's expected gateway-agent session model is understood.

### QA evidence requirements for remaining Day 2 bugs

**#608 Docker/gateway:**

- Record dashboard location, gateway location, detected server URL, attempted browser URL, HTTP/WS status, and exact failure message.
- Do not treat server-side route success as browser success.

**#576 injection guard:**

- Test at least: direct banned phrase, homoglyph variant, URL/base64/percent-encoded variant, and whitespace/control-character variant.
- Record pass/block result without including harmful payloads beyond minimal sanitized samples.

**#611 chat sessions:**

- Record whether agents sync into MC's `agents` table.
- Record whether chat API can address a gateway-backed OpenClaw agent by id/name.
- Capture exact error class/message if chat fails.

### Baseline finalization checklist

Before Tyler reviews Phase 0:

- [ ] Full test suite rerun after git identity fix.
- [ ] Dev mode smoke recorded.
- [ ] Top 10 panel route map complete.
- [ ] #574 and #613 confirmed with code evidence.
- [ ] #608 repro attempted with Docker matrix notes.
- [ ] #576 repro attempted with sanitized payload notes.
- [ ] #611 repro attempted with chat/session notes.
- [ ] First 3 PR recommendations remain valid after repro.

## Mai Day-2 Findings — Bug #576 injection-guard regex source CONFIRMED

**File:** `src/lib/skill-registry.ts` (lines ~70–135)

`SECURITY_RULES` array of 10 regex-based detection rules:

| # | Rule | Severity | Pattern (description) |
|---|------|----------|----------------------|
| 1 | `prompt-injection-system` | critical | "ignore previous instructions", "forget instructions", "you are now an evil/unrestricted" |
| 2 | `prompt-injection-role` | critical | "act as root/admin/superuser", "bypass safety", "disable safety/security/filters" |
| 3 | `shell-exec-dangerous` | critical | code block with `rm -rf`, piped curl/wget to bash, `eval(`, `exec(` |
| 4 | `data-exfiltration` | critical | "send data/files/secrets/keys to", "exfiltrate", "upload data" |
| 5 | `credential-harvesting` | warning | `api[_-]?key|secret|password|token|credential` followed by 8+ char value |
| 6 | `obfuscated-content` | warning | `atob`, `btoa`, `Buffer.from`, long `\x..` or `\u....` runs |
| 7 | `hidden-instructions` | warning | `<!-- … (ignore\|override\|bypass\|inject\|execute) … -->` |
| 8 | `excessive-permissions` | warning | `sudo`, `chmod 777`, `chmod +x /`, `chown root` |
| 9 | `network-fetch` | info | `fetch/curl/wget/axios/http.get` to external `http(s)://` |
| 10 | `path-traversal` | critical | `../` ≥ 2, `..\` ≥ 2, `%2e%2e%2f` ≥ 2 |

### Confirmed bypass vectors (per Đào's concern)

- **Homoglyph:** swap Latin chars for Cyrillic/Greek look-alikes — e.g., "ignore" → "ignоrе" (Cyrillic о, е). The Latin-only regex `/ignore/i` does not match. All 4 critical "prompt-injection-*" rules vulnerable.
- **Encoding:** base64-encode the bypass instruction, embed in skill content. Rule 6 (`obfuscated-content`) fires as a *warning* but does not decode the payload — the actual bypass instructions slip through.
- **Semantic injection:** rephrase the same intent without trigger words — e.g., "please disregard prior directives" or "treat earlier guidance as superseded" → no regex in the set covers semantic equivalence. All 4 critical injection rules can be evaded by paraphrase.
- **HTML comment splitting:** rule 7 only matches single-comment payloads. Splitting bypass instructions across multiple `<!-- ... -->` comments evades the per-comment regex.
- **Whitespace/formatting:** rules use `\s+` between key tokens but real attackers can use zero-width spaces (U+200B, U+200C, U+200D) which `\s` does not match in JS regex by default. Inserting ZWSP between letters of "ignore" defeats `/ignore/`.

### Implication

The injection-guard is a **lexical first-pass**, useful against naive copy-paste prompt-injection content but **not a robust safety boundary**. Any high-trust enforcement (e.g., what we already saw with Cẩm Tú Cầu's safety failures on free open-weight models) must rely on:

- Tool-level capability deny (already used in OpenClaw config layer).
- Output guardrails at the model-response stage (not implemented here).
- Strong instruction-following models (proprietary tier).
- Normalization layer **before** regex scan (not implemented): NFKC unicode normalize, base64 decode pass, comment merge, ZWSP strip.

A reasonable Phase 1 follow-up to #576 is the normalization pass + a richer rule set, not just patching individual regex.

## Đào Review — #576 Injection Guard Direction

Reviewed after Mai commit `32d6390`.

### Verdict

#576 should be treated as a parser/normalization weakness, not a one-regex bug. The current guard appears useful as a lexical first pass, but it is not a robust boundary against encoded, obfuscated, or semantic variants.

### Recommended Phase 1 shape

Do **not** patch only the specific regex strings. Instead introduce a small preprocessing pipeline before existing regex rules:

1. Unicode normalization (`NFKC`) and case folding.
2. Strip zero-width/control format characters that do not change visible text.
3. Decode common encodings safely where bounded:
   - percent-encoding
   - HTML entities
   - base64-looking chunks under size limits
4. Merge or scan across HTML/comment boundaries rather than per-comment only.
5. Run existing regex rules on:
   - original text
   - normalized text
   - decoded candidate text snippets
6. Add semantic/broader synonym patterns for high-risk instruction override requests.

### Safety constraints for the fix

- Decoders must be bounded to avoid decompression/expansion DoS.
- Keep original evidence text out of logs if it contains secrets or harmful payloads.
- Return structured findings showing which transform triggered the match (`original`, `normalized`, `decoded-base64`, etc.).
- Avoid overblocking normal code snippets by keeping severity/rule IDs precise.

### Test matrix to require

Add regression tests for at least:

- Direct phrase baseline: should be blocked.
- Homoglyph variant: should be blocked after normalization or flagged as suspicious.
- Zero-width inserted phrase: should be blocked after stripping format chars.
- Percent/HTML entity encoded variant: should be decoded/scanned.
- Base64 encoded critical phrase: should escalate beyond warning when decoded payload is critical.
- Multi-comment split hidden instruction: should be detected.
- Benign base64/string examples: should not become critical unless decoded content matches critical rules.

### Phase 1 priority note

#576 is security-relevant but should probably follow #613 and #574 unless Day 2 finds active exploitability in a production path. Current priority remains:

1. #613 doctor cache/single-flight
2. #574 private key localStorage migration
3. #608 gateway URL repro/fix
4. #576 normalization guard hardening

## Bug #608 Reproduction Status — NOT YET REPRODUCED

Honest disclosure for the baseline: bug #608 (gateway integration broken in
distributed/containerized deployments) has **not been reproduced** during this
Phase 0 audit window.

What was done:
- Read `src/app/api/gateways/connect/route.ts` end to end (URL building logic,
  Tailscale Serve detection, Docker bridge IP rejection, browser-protocol
  inference).
- Inspected `src/lib/gateway-runtime.ts` for token/origin handling.
- Identified the most likely fail modes (Mai's findings above).

What was NOT done:
- Bring up `docker compose up` with Mission Control in a container.
- Run a real OpenClaw gateway in a sibling container or on host network.
- Capture the actual failing WS URL the browser tries.
- Test the Tailscale Serve fallback under a real Tailscale environment.

**Action:** Treat the current code-only analysis as hypothesis. Bug repro is
deferred to **early Phase 1** as part of the #608 PR work itself — the fix
must include a reproducible Docker test matrix as acceptance criterion (see
the AC section above). Do not claim the bug is understood until that matrix
runs.

## Phase 0 Day 2 — Closing Status (Mai)

What is solid:
- Stack confirmed, dev mode boots, smoke tests pass.
- Architecture mapped (panels, lib, adapters, DB, API routes).
- OpenClaw integration reality check documented.
- #613, #574, #576 sources confirmed in code with file/line references.
- Critical panel→API call map for top 6 panels.
- First 3 PR candidates locked with extended acceptance criteria.
- Risk map skeleton + safe/don't-touch lists in place.
- 6 commits on `phase-0/baseline-audit` branch.

What is intentionally deferred (and noted):
- Visual walk via browser (Playwright MCP wants Chrome; not blocker for code review).
- #608 Docker reproduction (deferred to Phase 1 — must include test matrix).
- Full Playwright E2E suite run under fresh env (post-env-fix Vitest already passing).

**Recommended next move (after Tyler review):**
1. Tyler reviews this BASELINE.md and the V0_SPEC.md.
2. If approved, open Phase 1 with PR #1 (#613 doctor cache/single-flight) since it is
   low-risk and matches the doctor-banner mount pattern documented above.
3. Then PR #2 (#574 device key migration) with careful test plan.
4. Then PR #3 (#608) including Docker repro matrix.

---

## Phase 1 Closing Status (Mai + Đào)

**Date:** 2026-04-26
**Branch:** `phase-0/baseline-audit` (fork `imtylervo/mission-control`)
**Status:** Phase 1 PR sequence complete for fork-local development. Ready for Tyler review before Phase 2 planning.

### Merged PRs

| # | Issue | Commit | Title | Lines | Tests |
|---|---|---|---|---|---|
| 1 | #613 | `9b4204a` | doctor route TTL cache + single-flight | +359 / -15 | 8 new vitest |
| 2 | #574 | `3f8decb` | Ed25519 private key out of localStorage (Option B) | +723 / -39 | 17 new vitest |
| 3 | #608 | `2fed1c5` | native WS replaces CLI subprocess for full-text dispatch paths | +762 / -78 | 13 new vitest |

**Cumulative diff:** +1844 / -132 across 12 files (4 new modules + 4 new test files + 4 modified files).
**New vitest cases:** 38 total (8 + 17 + 13).
**Suite delta:** baseline 938 pass → post-PR-3 968+ pass / 1 pre-existing fail unchanged.
**Process discipline:** all 3 PRs followed identical flow — Mai writes design doc → Đào reviews → Tyler approves → Mai writes impl → Đào reviews → Tyler approves merge.

### Smoke test result (compile + unauthenticated integration smoke, executed 2026-04-26)

**Compile + integration smoke (Mai, msg 1109):**
- ✅ `next dev` boots cleanly on port 3000 (Next.js 16.1.6 Turbopack, ready in 1248ms)
- ✅ `tsc --noEmit -p .` exit 0 across all merged code
- ✅ `pnpm vitest run` → 968 pass / 1 pre-existing fail (gateway-url.test, unrelated, also fails on phase-0 baseline)
- ✅ Doctor route (`/api/openclaw/doctor`) → HTTP 401 (auth boundary working as designed)
- ✅ Login page (`/login`) → HTTP 200, renders with new device-identity import surface
- ✅ Agents API (`/api/agents`) → HTTP 401, `task-dispatch.ts` imports `callGatewayAgentForText` from new `openclaw-gateway-ws.ts` without module-not-found
- ✅ Backend services healthy: DB migrations applied, scheduler initialized (backup/cleanup/heartbeat/sync), agent sync 6 synced
- ✅ Dev log clean: 0 compile errors, 0 TypeError, 0 module-not-found

**What this smoke level proves:**
- All 3 PRs deploy cleanly into the merged branch
- No type errors at project-wide tsc check
- No broken imports, no orphaned dead code
- Auth boundary preserved
- Database + scheduler state survived merges

**What this smoke level does NOT prove (residual risks below):**
- End-to-end runtime behavior under real traffic
- UI walkthrough of critical panels post-merge
- Live gateway dispatch with real OpenClaw agents
- Cache hit/miss behavior under concurrent admin sessions

### B2 deep authenticated smoke (executed 2026-04-26 evening)

Tyler created admin account via `/setup`. Camofox session + programmatic admin login with cookie auth. 4-tier classification per Đào: `verified` / `partially verified` / `blocked` / `not tested`.

| PR | Status | Evidence |
|---|---|---|
| #613 | **verified** | Cache metadata + TTL + single-flight all confirmed at runtime (details below) |
| #574 | **blocked — refined** | Tyler's gateway currently reports **Device auth disabled — MC authenticates via gateway token** during onboarding. Because gateway does not send a `nonce`, `websocket.ts` skips `getOrCreateDeviceIdentity()`, so the device-identity migration path is not exercised in Tyler's current token-only setup. This is not a PR #2 failure; it is a config/mode limitation. Token storage risk remains tracked separately in `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` and needs gateway-side audit. |
| #608 | blocked | Onboarding modal "Secure Your Station" overlays after admin login and blocks navigation to `/tasks`. Exercising live dispatch is also out of scope for this smoke per Đào's caveat (no external task fanout). |

**#613 verification evidence:**

```
1st call (cache miss, real subprocess invoked):
  HTTP 200 in 10.32s
  cached: false
  ageMs: 0
  nextRefreshAfterMs: 30000   (TTL = 30s as designed)

2nd call (1s after, cache hit, NO subprocess):
  HTTP 200 in 0.017s          (~600x speedup)
  cached: true
  ageMs: 13664
  nextRefreshAfterMs: 16336   (30000 - 13664 = 16336 ✓ TTL invariant)
```

Verified design assertions:
- Cache metadata fields (`cached`, `ageMs`, `nextRefreshAfterMs`) reach the authenticated client.
- TTL = 30s as specified in PR #1 design.
- Single-flight: subprocess is NOT re-spawned within the TTL window (massive latency drop on the second call confirms cache is in-memory).
- `ageMs + nextRefreshAfterMs = TTL_MS` invariant preserved.


**#574 refined blocker note:** Mission Control only calls `getOrCreateDeviceIdentity()` when the gateway sends a device-auth `nonce` and the client is not in token-only fallback. Tyler's current gateway/onboarding path says device auth is disabled, so no `mc-device-*` localStorage keys are expected. Do not describe the token-only path as “safe” without caveat; localStorage token risk depends on gateway-side acceptance behavior and remains a follow-up audit item.

**#574 PR #5 sub-task 5a finding (2026-04-27, after Đào gateway-source inspection):** the original BLOCKED reason was **incorrect**. The gateway emits `connect.challenge` with a `randomUUID()` nonce **unconditionally** as soon as the WebSocket opens, regardless of `gateway.auth.mode`. Auth-mode values (`none | token | password | trusted-proxy`) control bearer-credential validation only; they do NOT gate the device-auth challenge frame.

This means: if Mission Control is NOT migrating localStorage privkey → IndexedDB despite a live token-mode gateway, the bug is on the **client side**, not the gateway side. The fix focus shifts away from "switch the gateway to device mode" (which is meaningless — there is no such mode) toward inspecting the MC websocket client:

- Does MC actually receive the `event/connect.challenge` frame? (Network/DevTools WS log)
- Does `handleGatewayFrame` invoke `sendConnectHandshake(ws, frame.payload?.nonce)` as the code path suggests?
- Is `tokenOnlyFallbackRef.current` stuck `true` from an earlier session — short-circuiting the device-identity branch?
- Is the browser's secure context / `window.crypto.subtle` available so `getOrCreateDeviceIdentity()` can complete?

**#574 PR #5 sub-task 5a status:** PIVOTED. Path B (parallel test gateway in "device mode") is CANCELLED — that mode does not exist and would not change behavior even if it did. The verification work moves to browser-side inspection of MC's existing 18789 connection. The reference doc `docs/audit/PR5_PATH_B_REFERENCE.md` is retained for future parallel-env work that legitimately needs an isolated MC profile, but it is NOT a path to verifying #574. Verification results are captured in the section immediately below.

**#574 + #608 PR #5 sub-task 5a verification results (2026-04-27, browser instrumentation via Camofox + source review):**

*#574 fresh device-identity creation + persistence — VERIFIED*

Camofox `userId="mai-mc-instrument"` (fresh profile) → login `http://127.0.0.1:3000` as admin → dashboard. Browser-side state captured via `POST /tabs/:id/evaluate`:

- `window.isSecureContext === true`, `!!window.crypto.subtle === true`. Env supports Ed25519 keypair generation + IDB write.
- Pre-login storage: `localStorage = {}`, `indexedDB = []`. Profile clean, no legacy state.
- Post-login: `localStorage` stays empty (no `mc-device-privkey`); `indexedDB` has database `mc-device-identity` v1, store `keys`, count 1.
- After full page reload: same state persists — the IDB record is reused, no fresh-creation re-run.
- Indirect WS handshake evidence: gateway-side `~/.openclaw/devices/paired.json` gained a new MC web entry (`clientId="openclaw-control-ui"`, `clientMode="ui"`, `platform="web"`, `scope="operator.admin"`) at the login timestamp. Per Đào's decision rule (Telegram msg 1273), gateway pairing implies the outgoing `connect` frame carried a `device` field, confirming that `getOrCreateDeviceIdentity()` reached the IDB-backed path and the handshake completed.

Direct WS frame capture was not possible because Camofox v1.6.2 has no init-script API and MC's `/login → /` is a hard navigation, so a `WebSocket` wrapper installed via `evaluate` on `/login` is lost before the dashboard's WS connects. The gateway-pairing side-effect is the strongest available proxy evidence.

*#574 legacy localStorage → IDB migration — PARTIALLY EXERCISED, NOT VERIFIED END-TO-END*

A throwaway Ed25519 keypair was generated in-browser (`extractable: true` for the test fixture only), exported as PKCS8 + raw + sha256 hex, and written into `localStorage` as `mc-device-id`, `mc-device-pubkey`, `mc-device-privkey` after deleting the IDB database. After reload + 9s settle:

- All three legacy localStorage keys remained — `mc-device-privkey` was NOT removed.
- `mc-device-identity` IDB had 1 record again.
- Gateway `paired.json` did NOT gain a new entry for the seeded `deviceId`.

This pattern matches the "import + verify-sign #1 + IDB store all succeeded, but verify-read or verify-sign-#2 on the persisted CryptoKey failed → throw `DeviceIdentityUnavailableError`" branch of `migrateLegacyIfPresent` (`src/lib/device-identity.ts:184-216`), which by design does NOT delete the legacy localStorage entry. Without a captured console error message (no early console wrapper means the error message was lost), the observation is consistent with either:

- a fixture mismatch — a browser-generated CryptoKey round-tripped through IDB structured-clone may diverge from what real upgrade-path installs persisted; or
- a latent app bug in the verify-read / verify-sign-#2 step.

Per Đào (Telegram msg 1291 line 5), this is classified as a fixture issue rather than an app bug, pending stronger evidence. End-to-end migration verification remains a follow-up — it needs either a real legacy-install fixture from an upgrade-path user, or pre-page instrumentation (service worker, init script, or a future Camofox init-script feature) that can capture the exact `DeviceIdentityUnavailableError` reason.

*#608 task-dispatch uses native WS, no CLI shell-out — VERIFIED*

Three layers of evidence:

1. *Live process observation.* During the entire instrumentation session (login → migration sub-test → cleanup), `pgrep -af "openclaw gateway call"` returned empty. Only the pre-existing long-running `openclaw-gateway` daemon was observed. No `openclaw gateway call agent` subprocess was ever spawned by Mission Control.
2. *Source review of `src/lib/task-dispatch.ts:680-705`.* New-session dispatch uses `await callGatewayAgentForText(gatewayAgentId, prompt, { timeoutMs, idempotencyKey, model })` — native WS via `src/lib/openclaw-gateway-ws.ts`. Existing-session dispatch uses `chat.send` over the same WS. The inline comment on line 690 documents the change: *"Native WS replaces the legacy `runOpenClaw([...gateway call agent --expect-final...])` pattern, which fails with `spawn openclaw ENOENT` whenever Mission Control is deployed in a container that doesn't bundle the openclaw CLI binary."* Grepping `child_process | spawn | execFile | exec` across `src/` confirms `task-dispatch.ts` contains no subprocess calls.
3. *Regression test passing.* `src/lib/__tests__/task-dispatch-source-discipline.test.ts` runs four assertions: (a) `task-dispatch.ts` must not contain `runOpenClaw([..., 'gateway', 'call', 'agent', ...])`, (b) must not use `--expect-final`, (c) `openclaw-gateway-ws.ts` exports the required wrapper API, (d) the legacy `runOpenClaw` import is preserved for non-#608 commands. Ran `npx vitest run` → 4/4 PASS in ~1.3s.

Caveat: live UI dispatch via the Tasks page was not exercised because the Camofox tab's gateway WS dropped to "GW Offline" (likely a side-effect of the migration sub-test perturbations and cross-origin localStorage isolation between an unrelated `localhost:3000` browsing session and the `127.0.0.1:3000` instrumentation session). Source + regression test layers are sufficient for the anti-pattern claim — a live dispatch test would only re-confirm the negative.

*Separate findings (out of scope for #574 / #608, candidate follow-up tickets):*

- *Next.js hydration nonce mismatch* (Next 16.1.6 Turbopack, "stale" marker). SSR renders `<script nonce="">` while client hydrates with a populated nonce, e.g. `<script nonce="pwMoLOKtKMblm7P4+Z1rRw==">`. Touch points: `src/lib/csp.ts` (CSP builder), `src/proxy.ts` (middleware nonce generation), `src/app/layout.tsx:91-101` (header read + `<Script nonce={nonce}>`). Surfaces as a single dev-overlay console error; does not block app load or login.
- *`src/app/api/notifications/deliver/route.ts:82` still uses legacy CLI shell-out* (`runOpenClaw(['gateway', 'call', 'agent', '--params', '--json'])`) for notification delivery. Per Đào's narrow-scope caveat (msg 1078), this path is intentionally NOT covered by #608, but it carries the same `spawn openclaw ENOENT` failure mode in containerized deployments and is a reasonable follow-up "notifications-delivery WS migration" candidate.

**Operational findings (NOT defects):**

- **Dev-server PATH gap.** Tyler's `~/.npm-global/bin/` is not on the dev server's `PATH`, so `runOpenClaw` (default binary name `openclaw`) fails with `ENOENT` until `OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw` is set. PR #1's `OpenClawNotReachableError → 400` path is correct in either case; this is purely an environment fix. Set the env var (e.g. via `mission-control/.env.local` or shell), restart `pnpm dev`, retry. Recommended permanent fix outside this PR: add the npm-global bin to `PATH` in `~/.bashrc` or set `OPENCLAW_BIN` globally.
- **Spurious `next-server` PID name collision.** 9router builds on Next.js, so `pkill -f "next-server"` will match the 9router worker as well as Mission Control's dev server. When stopping MC dev, target the actual MC PID (`pgrep -f "next dev --hostname 127.0.0.1 --port 3000"`) instead of the generic `next-server` regex. 9router's systemd unit auto-respawns its worker if killed, so a mistaken kill is recoverable, but avoid it.

### Residual risks (honest disclosure)

These are risks acknowledged at Phase 1 closure that have NOT been verified yet. Each is a candidate for follow-up work but does NOT block closure.

1. **#613 cache metadata** — VERIFIED in B2 above. Original residual risk closed.
2. **No live gateway dispatch test for #608** — `callGatewayAgentForText` was unit-tested with a mock WebSocket server. Real round-trip through `ws://localhost:18789/ws` against a live `openclaw-gateway` was NOT exercised. The gateway is currently running `2026.4.24` (with bonjour disabled), but exercising task dispatch end-to-end requires creating + running a task that targets a registered agent. Deferred.
3. **Docker / containerized deployment** — both #608 design and PR description marked Docker repro as `[blocked]` because Tyler's environment is direct VM. Containerized MC behavior is the original failure case from upstream issue #608 and remains unverified in our fork. CI matrix is the appropriate venue for this once a maintainer with container infra picks it up.
4. **Pre-existing `gateway-url.test.ts` failure** — still fails (1 case: "uses ws:// for prefixed localhost URL even with https scheme"). Confirmed pre-existing on `phase-0/baseline-audit` baseline before Phase 1 work. Out of scope; tracked for future cleanup.
5. **#574 IndexedDB CryptoKey roundtrip via Camofox** — could not be smoke-tested in real browser because Camoufox's evaluate sandbox hangs on structured-clone CryptoKey to IDB (Camofox limitation, not a code defect). Vitest covers the contract via in-memory store; W3C structured-clone of `CryptoKey` is standardised across Chromium/Firefox. **Update (PR #16, 2026-04-27):** end-to-end migration was subsequently verified on Chromium under Playwright with the confirmed pre-#574 fixture format — all six `migrateLegacyIfPresent` steps execute (`importKey` → `verifySign` → IDB `store` → IDB read-back → `verifySign` on persisted → `removeItem` legacy). The Camoufox partial-failure observed during PR #5 sub-task 5a is reclassified as a Firefox-side `CryptoKey`-IDB quirk, not an MC bug. See `docs/audit/PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md`.
6. **`mc-device-token` classification + storage hardening — RESOLVED via PR #18 (Phase 1.6) + PR #19 (Phase 1.7).** Classified as **bearer-equivalent** based on local OpenClaw 2026.4.24 gateway source review (`server.impl-CtLS1ywt.js:10538-10579`); the gateway accepts the token alone via `verifyDeviceToken` without a fresh `device.signature`. PR #19 then moved the token out of `localStorage` and into `sessionStorage`, closing the persistent-XSS / cross-tab / offline-disk-dump exfil paths. **Residual:** active same-tab same-origin JS can still read `sessionStorage` while the page is open; the future stronger mitigation is `httpOnly` BFF cookie (option (c) in `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md`), deferred unless an incident motivates the cost. See `docs/audit/PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md` and `docs/audit/PR19_PHASE_1_7_DEVICE_TOKEN_SESSIONSTORAGE.md`.
7. **Generic `callOpenClawGateway` callers not migrated** — PR #3 only migrated the two task-dispatch full-text paths. Generic CLI-wrapper callers (`channels/route.ts`, `nodes/route.ts`, `sessions/route.ts`, etc.) still shell out via `runOpenClaw`. They'll fail with `ENOENT` in a containerized MC where the CLI binary is absent. Deferred to a follow-up "generic gateway callers WS migration" PR per Đào's narrow-scope caveat (msg 1078).

### Auth boundary 401 — explicitly NOT a defect

Both `/api/openclaw/doctor` and `/api/agents` returning HTTP 401 on anonymous smoke calls is the **expected** behavior — these endpoints require admin auth via `requireRole(request, 'admin')`. The 401 confirms:
- Auth middleware is loaded
- Routes are registered
- Server-side validation is enforced

Not a residual risk. Documented here to prevent future readers from misreading the smoke log.

### What Phase 1 does NOT claim

Mission Control on this branch is **NOT production-ready** in the upstream-merge sense. Closure is for the **fork-local development sequence** only. Going to upstream `builderz-labs/mission-control` requires:
- Coordinated review with upstream maintainer (incl. PR #607 reconciliation since jmmc-tools' PR overlaps #608)
- Wider compat testing (Windows, macOS, Docker, multiple gateway versions)
- Performance testing (concurrent admin load on doctor cache, IDB key migration across legacy browser profiles)
- A PR-per-fix split if upstream prefers narrow PRs

### Recommended next moves

| Order | Action | Owner | Risk |
|---|---|---|---|
| 1 | Open follow-up issue draft for `mc-device-token` gateway audit upstream | Tyler decides timing | Low |
| 2 | If upstream PR #607 lands, sync our branch with upstream main and verify our 3 PRs still apply cleanly | Mai + Đào | Medium (potential merge conflict) |
| 3 | "B2 follow-up smoke" — unblock #574 device pairing / #608 onboarding+safe dispatch only if Tyler wants deeper runtime proof | Mai write, Đào review | Low–Medium |
| 4 | "Generic gateway WS migration" PR — migrate `channels/route.ts`, `nodes/route.ts`, `sessions/route.ts` callers to `callOpenClawGatewayWS` | Mai + Đào | Medium |
| 5 | Phase 2 PR sequence — pick from baseline `Bug Ownership Map` (#576 injection-guard hardening, #611 chat session, ...) | Tyler chooses target | Varies |

### Discipline notes (institutional, kept for future phases)

These conventions emerged during Phase 1 and should carry forward:

- **Merge ownership** — when Tyler tags `@bemaiagent_bot` → Mai merges (gh CLI on VM); tags `@bedaoagent_bot` → Đào merges (`gh api` from OpenClaw workspace); tags BOTH → Mai default. If approval is ambiguous ("OK nha" without specific target), the responding agent asks one clarifying question before bấm merge to avoid race conditions.
- **Design doc before code** — every PR opens with a design doc (`docs/audit/PRn_*_DESIGN.md`) reviewed by Đào and approved by Tyler before any impl branch. Saved 2 hours on PR #2 by reaching scope consensus before writing 800 lines of code.
- **Backwards-compat scoping** — only swap call sites that strictly need the new behavior; preserve legacy wrappers (`callOpenClawGateway`, `runOpenClaw`) for callers that don't need the new code path. Keeps PRs narrow + reversible.
- **`tsc -p .` is the source of truth** — inline `tsc --noEmit` may use a fallback config that misses errors. Always pass `-p .` or use `pnpm run typecheck`. Caught by Đào on PR #3 (msg 1087).
- **"[blocked]" with evidence ≠ broken** — when Docker repro / live-gateway test isn't possible in our env, document `[blocked]` with reference to upstream evidence (issue body, upstream PR claims) instead of pretending repro happened. Acceptable for fork-local closure, must be elevated to maintainer for upstream merge.

---
