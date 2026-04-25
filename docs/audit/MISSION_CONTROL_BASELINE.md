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
