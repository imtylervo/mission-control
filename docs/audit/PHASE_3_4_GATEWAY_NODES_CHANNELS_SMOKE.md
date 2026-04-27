# Phase 3.4 — Gateway / nodes / channels panels smoke + fixes

**Outcome:** source/API smoke for the gateway, nodes, and channels panels against the post-PR-#31 base. Gateway status, safe node list/actions, and channel list/login state all PASS by source review plus the existing gateway test suites (39/40 tests on this branch — the 1 failure is the documented pre-existing baseline residual, not introduced by this PR). No code change required.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `6f1546f` (Phase 3.3 PR #31 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.4:

> Verify gateway status, node list/actions where safe, channel list/login state.

Đào (LEAD) assigned this scope to Mai (CODER) after Phase 3.3 closed (Đào msg 1675, ETA 22:20:00+10:00).

## Panel surface

Five components map to this scope:

- `src/components/panels/gateway-control-panel.tsx` — fetches/posts `/api/gateways/control` (start/stop/status of a single MC-side gateway).
- `src/components/panels/gateway-config-panel.tsx` — fetches `/api/gateway-config` and `/api/gateway-config?action=schema`; posts `/api/gateway-config?action=apply` for config edits.
- `src/components/panels/multi-gateway-panel.tsx` — full gateway-list management, fetches `/api/gateways`, `/api/gateways/discover`, `/api/gateways/health/history`; mutates via POST/PUT/DELETE on `/api/gateways` and `/api/gateways/connect`.
- `src/components/panels/nodes-panel.tsx` — node + device-pair list view.
- `src/components/panels/channels-panel.tsx` — channel status / login state view.

API surface:

- `src/app/api/gateways/route.ts` — CRUD over registered gateways (GET list / POST add / PUT update / DELETE remove).
- `src/app/api/gateway-config/route.ts` — gateway config read + apply.
- `src/app/api/nodes/route.ts` — GET (action=list / action=devices) + POST (device-management actions).
- `src/app/api/channels/route.ts` — GET (channel status from gateway) + POST (platform-specific actions).
- `src/app/api/diagnostics/gateway-origin/route.ts` — Phase 2.2 diagnostic, viewer-gated, surfaces localhost↔127 mismatch.

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Gateway status | PASS | `nodes/route.ts` probes `http://${gatewayHost}:${gatewayPort}/health` with a 5 s `AbortController` timeout to determine `connected` flag, then issues `node.list` and `device.pair.list` over the gateway WS via `callOpenClawGatewayWS(...)`. Both inner RPCs return graceful empty arrays if the gateway is reachable but the CLI/RPC isn't available (e.g., Docker without the openclaw CLI installed). `channels/route.ts` reads gateway-side channel status via the gateway's HTTP API + WS. `multi-gateway-panel.tsx` consumes `/api/gateways/health/history` for long-term status visibility. |
| Safe node list | PASS | `GET /api/nodes?action=list` is `viewer`-gated (no mutating side-effects). `GET /api/nodes?action=devices` is also viewer-gated and lists pair-able devices via `device.pair.list`. Both fail soft to empty arrays. |
| Node actions (safe ones) | PASS-source-only (C3) | `POST /api/nodes` is operator-gated and dispatches to `node.*` / `device.pair.*` gateway methods depending on the requested action. This audit verifies the dispatcher and auth gate by source review only — no real action was fired against the running gateway. |
| Channel list | PASS | `GET /api/channels` calls into the gateway via `callOpenClawGatewayWS` + the gateway's HTTP API (using a `Bearer ${token}` header from `getDetectedGatewayToken()`) to fetch per-channel status (`configured`, `linked`, `running`, `connected`, `lastConnectedAt`, `lastMessageAt`, `mode`, `baseUrl`, …). Per-account info is also returned for multi-account channels (Telegram, etc.). |
| Channel login state | PASS | The same `GET /api/channels` payload includes `linked` / `connected` / `authAgeMs` / `lastError` per account, which the panel renders as login state. `POST /api/channels` is operator-gated and triggers platform-specific actions (start, stop, login, etc.) — verified by source only, not exercised. |

## Gates run (Mai re-verified on post-PR-#31 base)

```
$ git rev-parse HEAD
6f1546fcc4e542b0511da5e50b70fb9cb9437e4e  # confirms post-PR-#31 base

$ npx vitest run \
    src/lib/__tests__/gateway-url.test.ts \
    src/lib/__tests__/openclaw-gateway.test.ts \
    src/lib/__tests__/openclaw-gateway-ws.test.ts \
    src/lib/__tests__/gateway-runtime.test.ts \
    src/lib/__tests__/gateway-call-agent-source-discipline.test.ts \
    src/lib/__tests__/hermes-sessions-gateway.test.ts
Test Files: 5 passed | 1 failed
Tests: 39 passed | 1 failed
  (the 1 failure is the documented pre-existing gateway-url baseline
   residual — see "C2 Pre-existing baseline failure" below)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Browser smoke deferred

A live-browser pass that opens the gateway control panel, the multi-gateway panel, the nodes panel, and the channels panel is most naturally part of Phase 5.x. Source-and-test-level evidence is sufficient for this audit.

### C2 — Pre-existing baseline failure (`gateway-url.test.ts`)

`src/lib/__tests__/gateway-url.test.ts` has 1 failing case on the current `phase-0/baseline-audit` branch:

```
expected 'https://127.0.0.1:18789' to be 'ws://127.0.0.1:18789'
src/lib/__tests__/gateway-url.test.ts:42:9
```

This is the residual-risk row 4 in `docs/audit/MISSION_CONTROL_BASELINE.md`. Earlier PRs (#23, #24, #25, #27, #29, #30, #31) have all called this out as "pre-existing baseline failure, not introduced by this PR". Phase 3.4 makes the same disclaimer: this audit does NOT touch the gateway-url module and does NOT introduce or fix this failure. Owning the fix lives on whichever PR explicitly takes the gateway-url residual.

### C3 — Destructive node + channel actions exist; not exercised

`POST /api/nodes` and `POST /api/channels` can perform real mutating actions against the gateway / external platforms (device pair/unpair, channel login/logout, etc.). This audit deliberately does NOT fire those — the contract is verified by source review only, matching Đào's instruction in msg 1675: "avoid unsafe node actions unless mocked/source-reviewed".

### C4 — Gateway config apply path

`POST /api/gateway-config?action=apply` writes back to `~/.openclaw/openclaw.json`. Consistent with PR #25's `registerMcAsDashboard` discipline (no touch on `dangerouslyDisableDeviceAuth`, additive on `controlUi.allowedOrigins`). Confirmed by source review; not exercised here.

## What this PR does not do

- No `src/` changes — audit doc only.
- No new tests added.
- Does not browse-smoke the panels — see C1.
- Does not fix the `gateway-url.test.ts` baseline residual — see C2.
- Does not exercise destructive node/channel actions — see C3.
- Does not write to `~/.openclaw/openclaw.json` via the gateway-config apply path — see C4.

## Risk and rollback

- Risk: none beyond documentation.
- Rollback: revert this PR's diff (single audit doc).

## Refs

- Đào msg 1675 (2026-04-27T11:50Z) — Phase 3.4 assignment, ETA 22:20:00+10:00.
- PR #31 — Phase 3.3 audit, merged at `6f1546f`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.4 — task definition.
- `docs/audit/MISSION_CONTROL_BASELINE.md` residual-risk row 4 — pre-existing gateway-url failure.
- Panels: `gateway-control-panel.tsx`, `gateway-config-panel.tsx`, `multi-gateway-panel.tsx`, `nodes-panel.tsx`, `channels-panel.tsx`.
- API: `src/app/api/gateways/route.ts`, `src/app/api/gateway-config/route.ts`, `src/app/api/nodes/route.ts`, `src/app/api/channels/route.ts`, `src/app/api/diagnostics/gateway-origin/route.ts`.
