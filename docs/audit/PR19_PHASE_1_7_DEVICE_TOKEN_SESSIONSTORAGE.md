# Phase 1.7 — `mc-device-token` storage migration to `sessionStorage`

**Outcome:** the bearer-equivalent `mc-device-token` (classified in PR #18 / Phase 1.6) is moved out of `localStorage` and into `sessionStorage` in Mission Control's client. Persistent-XSS exfil and offline-storage-dump exfil paths are closed. A residual same-tab same-origin XSS risk remains and is documented; the stronger mitigation (`httpOnly` BFF cookie) is left as a future option.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #18 merge (`6faea43`).

## Why this PR exists

PR #18 confirmed that the OpenClaw `2026.4.24` gateway accepts `mc-device-token` as a stand-alone authentication credential — gateway code path `server.impl-CtLS1ywt.js:10538-10579` runs `verifyDeviceToken({ deviceId, token, role, scopes })` with `authMethod="device-token"` without requiring a fresh `device.signature`. With the token in `localStorage` an attacker who lands XSS only needs `mc-device-token` + `mc-device-id` to replay; the IDB-stored private key (which PR #574 already pinned `extractable: false`) never enters the picture.

Đào msg 1552 picked option (b) `sessionStorage` from the three options listed in `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` and the new Phase 1.7 row in `docs/audit/MISSION_CONTROL_ROADMAP.md`:

- **(a) in-memory only** — best hardening, worst UX (re-pair every reload).
- **(b) `sessionStorage`** — closes localStorage persistence + cross-tab leak; same-tab JS still readable; chosen.
- **(c) `httpOnly` BFF cookie** — best practical hardening, big implementation cost (BFF must proxy the gateway connect frame).

Option (b) is the practical hardening that does not require rewriting Mission Control's auth flow. (c) is a candidate for a future PR if the residual same-tab risk turns into a real incident.

## What changed

### Production source

- `src/lib/device-identity.ts`
  - Header comment updated to mention `sessionStorage` for the token alongside the other key-material homes.
  - New `_safeStorage()` helper returns `{ local, session }`, each `Storage | null`. Wraps `window.localStorage` and `window.sessionStorage` in `try/catch` blocks because some browsers throw on storage access in private/lockdown modes (Đào msg 1555 refinement #1). `typeof window === 'undefined'` returns `null` for both for SSR safety.
  - `getCachedDeviceToken()` now reads from `sessionStorage` and, on every call, drops any legacy `localStorage['mc-device-token']` entry **without promoting** the value. Pre-Phase-1.7 builds cannot quietly continue under the new scope — the next handshake must re-mint.
  - `cacheDeviceToken(token)` writes `sessionStorage` only.
  - `clearDeviceIdentity()` removes the token from both `sessionStorage` and `localStorage` defensively.
  - All storage operations are best-effort (Đào msg 1555 refinement #2): a thrown access error degrades to `null` (or no-op write), not a crash.

### Tests

- `src/lib/__tests__/device-identity.test.ts`
  - The existing `clearDeviceIdentity` test seeds **both** a `sessionStorage` token (the new home) and a legacy `localStorage` token, and asserts both are wiped.
  - New `mc-device-token storage (Phase 1.7)` describe block — six tests covering: cache-writes-sessionStorage, read-from-sessionStorage, null-when-empty, legacy-cleanup-without-promotion, sessionStorage-wins-over-stale-legacy, full round-trip.
- `src/lib/__tests__/device-token-storage-source-discipline.test.ts` (new) — five static-analysis assertions on production source modeled after `device-identity-source-discipline.test.ts`:
  - production code does not call `localStorage.setItem` for the token (key constant or string literal),
  - production code does not call `localStorage.getItem` for the token *outside* of a same-block `removeItem` (legacy cleanup is the only allowed read),
  - `cacheDeviceToken`'s body uses `sessionStorage.setItem`,
  - `getCachedDeviceToken`'s body uses `sessionStorage.getItem` and pairs it with the legacy cleanup,
  - the storage key constant has the expected name and value.

### Docs

- `docs/audit/MISSION_CONTROL_ROADMAP.md` — row 1.7 marked `✅ complete via PR #19`; the "Immediate next task recommendation" list strikes Phase 1.7 through.
- `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` — appends a `Update — Phase 1.7 (sessionStorage migration)` section that pins the chosen option, the residual risk, and the future option (c).
- `docs/audit/MISSION_CONTROL_BASELINE.md` — residual-risk row 6 updated to reflect that the `localStorage` exfil path is closed; same-tab same-origin JS reading `sessionStorage` is the new residual.

**No protocol change.** The wire format on `connect` is unchanged: `params.deviceToken` carries the token exactly as before, just sourced from a different web-storage backend on the client.

## Threat-model delta

| Path | Before PR #19 | After PR #19 |
| --- | --- | --- |
| Persistent XSS reading `localStorage` after page is closed (e.g. via a service-worker side channel, a stored payload that fires on next visit) | Token exfilable. | Closed — token is not in `localStorage`. |
| Cross-tab read of the token via shared `localStorage` between MC tabs | Token leaks across tabs. | Closed — `sessionStorage` is per-tab. |
| Offline disk-dump of the browser's `Local Storage` directory | Token recoverable. | Closed — `sessionStorage` is in-memory and not persisted to disk by Chromium / Firefox. |
| Active same-tab same-origin XSS reading `sessionStorage` while the page is open | Token exfilable. | **Still exfilable.** Documented as residual. The mitigation here is option (c) `httpOnly` BFF cookie or option (a) in-memory-only with re-pair-on-reload, both deferred. |
| XSS that wants the device private key | Already blocked by PR #574 (IDB `extractable: false`). | Unchanged. |

## Run command (verification)

There is no live-browser verification step in this PR — the dashboard auth credential is missing on the box (same blocker as PR #17). The unit and source-discipline tests cover the storage-discipline invariants.

```bash
# Targeted vitest gate
npx vitest run \
  src/lib/__tests__/device-identity.test.ts \
  src/lib/__tests__/device-token-storage-source-discipline.test.ts

# Typecheck gate
npx tsc --noEmit

# Grep evidence (production must NOT write the token to localStorage)
grep -nE "localStorage\.setItem.*STORAGE_DEVICE_TOKEN|localStorage\.setItem.*'mc-device-token'" src/lib/*.ts || echo "no production setItem hits — OK"
```

A future browser-smoke run (Phase 1.1's PR #17 harness or a sibling Phase 1.7 harness) can confirm the live cache/round-trip path on the dashboard once an admin credential is restored.

## Pre-existing test failure (NOT introduced by this PR)

`src/lib/__tests__/gateway-url.test.ts > buildGatewayWebSocketUrl > uses ws:// for prefixed localhost URL even with https scheme` continues to fail on this branch. The failure was already present on `phase-0/baseline-audit` before this PR (verified by checking out the base commit `6faea43` and re-running the test). It is documented in `docs/audit/MISSION_CONTROL_BASELINE.md` residual-risk row 4 and is out of scope here.

## Risk and rollback

- Risk: low. The patch is local to one source file's storage helpers; the wire protocol is untouched and the websocket consumers (`src/lib/websocket.ts:226`, `:233`, `:298`, `:402-403`) read/write through the same `getCachedDeviceToken` / `cacheDeviceToken` API.
- Pre-existing users: their next page load drops the legacy `localStorage` entry and (because we deliberately do not promote it) re-mints a fresh token via the existing device-signature handshake. Single re-pair per user, no data loss.
- Rollback: revert the merge commit. Clients holding `sessionStorage` tokens lose them at tab close anyway; the next handshake mints whichever scope the reverted code uses.

## Refs

- PR #18 — bearer-equivalent classification.
- PR #574 (upstream) — XSS-exfil hardening for the private key.
- `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` — original investigation + option enumeration.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` — Phase 1.6 / 1.7 rows.
- `~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js:10538-10579` — gateway fallback path that makes the token bearer-equivalent.
