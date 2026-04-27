# Phase 2.2 / PR #24 — gateway origin diagnostic route

**Outcome:** a viewer-authenticated diagnostic endpoint at `GET /api/diagnostics/gateway-origin` that lets the UI report the *specific* cause of a `GW Offline` banner when the underlying problem is a localhost ↔ 127.0.0.1 mismatch between the browser's `Origin` header and the gateway's `controlUi.allowedOrigins` allowlist — without echoing raw allowlist entries back to the client.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #23 merge (`777f62e`).

## Why this PR exists

Mission Control surfaces "GW Offline" whenever the WebSocket connect frame is rejected by the OpenClaw gateway, which conflates several unrelated causes (gateway dead, token wrong, port wrong, origin not in allowlist). The Phase 2.2 audit (Đào msg 1611, watchdog state at `2026-04-27T18:51:00`) pinned the most common operator-visible variant: gateway daemon healthy, token correct, but the browser is at one form (`http://localhost:3000`) while `gateway.controlUi.allowedOrigins` only contains the other form (`http://127.0.0.1:3000`). The browser sees a generic offline banner and an operator has no obvious way to learn which of the four causes is actually firing.

This PR is the **diagnostic half** of the planned 2-PR split (PR-A here, PR-B follow-up). It adds a structured read-only endpoint the UI can call to surface a specific actionable hint. **No behavior changes** to the gateway itself, the WebSocket path, or `registerMcAsDashboard()` — those changes belong in PR-B.

## What changed

### `src/lib/gateway-runtime.ts`

Added a single new exported helper:

```ts
export function getGatewayAllowedOrigins(): string[] | null {
  const cfg = readOpenClawConfig()
  if (!cfg) return null
  const list = cfg.gateway?.controlUi?.allowedOrigins
  if (!Array.isArray(list)) return null
  return list.slice()
}
```

It re-uses the existing `readOpenClawConfig()` reader (silent JSON parse errors → `null`, missing file → `null`) and returns a defensive `.slice()` copy so the diagnostic route can iterate without aliasing the cached config. Returns `null` when the config is missing/unreadable, and a (possibly empty) array otherwise. No other helper in this file was touched — `registerMcAsDashboard`, `getDetectedGatewayToken`, `getDetectedGatewayPort` all keep their existing behavior.

### `src/app/api/diagnostics/gateway-origin/route.ts` (new)

`GET` handler. Auth: `requireRole(request, 'viewer')` — anonymous traffic is rejected with the role helper's standard `{ error, status }` shape. Reads the browser's `Origin` header, calls `getGatewayAllowedOrigins()`, and returns a structured payload:

| Field | Type | Meaning |
|---|---|---|
| `browser_origin` | string \| null | `Origin` header echoed back (already known to the browser) |
| `gateway_config_readable` | boolean | `true` iff `getGatewayAllowedOrigins()` returned non-null |
| `allowed_origins_count` | number | length of the allowlist (0 if config unreadable) |
| `has_localhost` | boolean | substring match `://localhost` (case-insensitive) |
| `has_127` | boolean | substring match `://127.0.0.1` (case-insensitive) |
| `has_browser_origin` | boolean | the browser's exact origin string is present in the allowlist (case-insensitive) |
| `mismatch` | boolean \| null | `true` when browser sent an `Origin` header AND it is not in the allowlist; `null` when no `Origin` header (non-browser caller) |
| `suggested_action` | string | derived hint — see below |

The `suggested_action` resolves to one of four strings:
1. **Config unreadable** — `~/.openclaw/openclaw.json` missing/unreadable, point operator at the config and the auto-register path.
2. **localhost-only allowlist + browser at 127.0.0.1** — operator should either change the URL or add the 127.0.0.1 form.
3. **127.0.0.1-only allowlist + browser at localhost** (the typical Phase 2.2 symptom) — symmetric guidance.
4. **No `Origin` header** — diagnostic was probably called from `curl`/`gh`; tell the operator to re-run from the dashboard.

A fifth fallback covers the generic mismatch case (browser origin not in allowlist but neither localhost-vs-127 axis is the cause), instructing the operator to add the browser origin to `gateway.controlUi.allowedOrigins`.

#### Privacy invariant (Đào msg 1614)

The route **never** echoes raw allowlist entries back to the client. Operators may consider the gateway hostname or its Tailscale MagicDNS name sensitive. The response carries only the browser's own origin (already known to it), booleans, counts, and the derived hint. This is enforced by a vitest case (see below) and is the single most important non-functional invariant this PR pins.

#### Lower-cased substring matching

Comparisons fold case so a misconfigured `HTTP://Localhost:3000` still trips `has_localhost`, but ports are intentionally **not** folded out. A gateway allowlist of `http://127.0.0.1:3000` does not cover a browser that actually navigates to `http://127.0.0.1:3001` — that is a real mismatch the diagnostic should flag.

### `src/app/api/diagnostics/gateway-origin/__tests__/route.test.ts` (new)

8 vitest cases pinning the six invariants the route must hold so a future refactor cannot regress the safety bits:

1. `gateway_config_readable=false` + actionable hint when the config is missing/unreadable (returns `200`, not `500` — the diagnostic must succeed even when the config is gone, otherwise the UI cannot tell *why*).
2. Reports `has_localhost` / `has_127` / `has_browser_origin` correctly when the allowlist contains both forms.
3. Detects localhost-only allowlist when browser is at 127.0.0.1 (symmetric variant of the Phase 2.2 symptom).
4. Detects 127.0.0.1-only allowlist when browser is at localhost (the **actual** Phase 2.2 symptom).
5. Returns `mismatch=null` + non-browser hint when no `Origin` header is sent.
6. **Privacy invariant** — uses a synthetic sensitive allowlist (`internal.tailnet.ts.net`, `10.0.7.42`) and asserts none of the raw values appear anywhere in the JSON-stringified response. Only the count is exposed.
7. `requireRole` short-circuits — when auth returns an error shape, `getGatewayAllowedOrigins` is **not** called (no information leak even if config-read had a side effect).
8. Case-insensitive matching — `HTTP://Localhost:3000` still trips `has_localhost`.

Mocks use the `vi.hoisted()` pattern (consistent with PR #23's session-invalidation tests) so the factories remain hoist-safe.

## Gates

- `npx vitest run src/app/api/diagnostics/gateway-origin/__tests__/route.test.ts` → **8 passed**.
- `npx tsc --noEmit` → clean.
- `grep -nE "getGatewayAllowedOrigins" src/lib/gateway-runtime.ts src/app/api/diagnostics/gateway-origin/route.ts` → confirms helper export + single call site.
- Existing PR #23 vitest suite re-run → unchanged (no shared state with this route).

The pre-existing `gateway-url.test.ts` failure on `phase-0/baseline-audit` (residual-risk row 4 in `BASELINE.md`) is unrelated and **not** introduced by this PR.

## What this PR does not do

- **No fix** for the localhost ↔ 127.0.0.1 mismatch itself — that lives in PR-B (`registerMcAsDashboard()` to add both forms when only one is present, gated by an explicit operator opt-in). PR-B requires the diagnostic shipped here so operators can verify the fix landed.
- **No UI change.** The route is consumable, but wiring it into the `GW Offline` banner is a follow-up — keeping this PR review-able as a pure backend addition.
- **No new dependencies, no DB migration, no env changes.**
- **No reads outside `~/.openclaw/openclaw.json`** — the route only invokes the existing `readOpenClawConfig()` path and the existing `requireRole` helper.

## Risk and rollback

- Risk: low. New route, no existing call site touched. The only new export from `gateway-runtime.ts` is `getGatewayAllowedOrigins`; existing exports are byte-identical.
- Rollback: revert this PR's diff. The route file is new; `gateway-runtime.ts` reverts to a 4-export module exactly as it stood after PR #23.
- Operational note: the route is viewer-gated and intentionally returns a `200` (not `500`) when the gateway config is missing — operators reading the UI banner cannot infer "is the config there?" from HTTP status alone, only from the `gateway_config_readable` boolean. This is deliberate; surfacing config presence as a status code would couple unrelated systems.

## Refs

- Đào msg 1611 — Phase 2.2 audit + 2-PR split direction (PR-A diagnostic, PR-B fix).
- Đào msg 1614 — privacy invariant: do not echo raw allowlist values back.
- Watchdog state at `mission-control-watchdog.json#self_takeover_at = 2026-04-27T18:51:00`.
- `src/lib/gateway-runtime.ts:42` — new `getGatewayAllowedOrigins` helper (this PR).
- `src/lib/gateway-runtime.ts:50` — `registerMcAsDashboard` (existing, untouched here, PR-B target).
- `src/app/api/diagnostics/gateway-origin/route.ts` — new viewer-gated diagnostic route (this PR).
