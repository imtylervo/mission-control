# `mc-device-token` classification — PR #2 follow-up

**Status:** Investigation complete. Not bundled into PR #2.
**Author:** Mai (during PR #2 implementation, per Đào's AC msg 1004)
**Date:** 2026-04-26

## What `mc-device-token` is

A short, opaque token issued by the gateway after a successful device-authenticated handshake. Cached in `localStorage` under `mc-device-token`. Surfaced via `getCachedDeviceToken()` / `cacheDeviceToken(token)` in `src/lib/device-identity.ts`.

## Where the client uses it

Two places in `src/lib/websocket.ts`:

1. **Mixed into the signed handshake payload** — `tokenForSignature` (line 233) is `authToken ?? cachedToken ?? ''`, then concatenated into the v2 device-auth payload (line 248) that is signed by the device private key. Replaying the token alone without a fresh signature does not pass this check.

2. **Sent as `deviceToken` field on the connect request** — line 298: `deviceToken: tokenOnlyFallbackRef.current ? undefined : (cachedToken || undefined)`. The gateway receives both the `device` block (with fresh signature) AND the `deviceToken` on the same connect frame.

## Where the gateway uses it

Outside this repository. The Mission Control codebase only sends the token; whether the gateway accepts it as proof of pairing **without** also verifying the fresh device signature is gateway-side behavior we cannot audit from this fork.

## Classification

- **In the current client implementation:** the token is **co-presented** with a fresh device signature on every connect. It is not exfiltratable in isolation for impersonation purposes — an attacker who steals the token still needs the private key to mint a valid signature on the next handshake. After PR #2 the private key is no longer in `localStorage`, so the token by itself stops being a useful exfil target.
- **Possible bearer-equivalent path:** if a future or current gateway version accepts `deviceToken` alone (e.g. for a fast-reconnect path), the token becomes bearer-equivalent and `localStorage` storage of it is itself a weakness.

## Decision for PR #2

**Do not bundle token migration into PR #2.** Reasons:

1. After PR #2 lands, the private key is no longer in `localStorage`. Token-alone exfil only matters if the gateway accepts it without a fresh signature — that's a gateway-side audit.
2. Token storage migration is independent of private-key migration and can land separately without coupling.
3. Bundling would expand PR #2 scope into a token-storage redesign that wasn't part of the AC contract.

## Follow-up issue draft (open after PR #2 merges)

> **Title:** Audit gateway `deviceToken` acceptance — is `mc-device-token` bearer-equivalent?
>
> **Body:**
> Mission Control caches `mc-device-token` in `localStorage` after a successful device-authenticated handshake. The client always co-presents this token with a fresh Ed25519 signature on subsequent connects, so client-side the token is not a standalone bearer credential.
>
> Gateway-side behavior is not auditable from this repo. We need to confirm whether the OpenClaw gateway accepts `deviceToken` alone (without a fresh `device.signature`) for any handshake path — including fast-reconnect optimizations.
>
> **If yes** (token is bearer-equivalent on the gateway):
> - Move `mc-device-token` out of `localStorage` (sessionStorage, in-memory + refresh, or an httpOnly cookie minted by Mission Control's BFF).
> - Apply the same XSS-exfil hardening that PR #574 applies to the private key.
>
> **If no** (token always requires a fresh signature):
> - Document the protocol contract in `docs/` so future gateway upgrades don't quietly switch behavior.
> - Consider rotating the localStorage key name + adding a TTL to limit replay window.
>
> Block on: gateway protocol audit (likely needs OpenClaw gateway repo access).
> Refs: builderz-labs/mission-control#574 follow-up.

## Đào's AC item — RESOLVED

> **AC:** "mc-device-token classification/follow-up nếu cần" (msg 1004)

Outcome: **classified, not bundled, follow-up draft above.**

---

## Update 2026-04-27 — Classification confirmed: BEARER-EQUIVALENT (PR #18, Phase 1.6)

The "If yes (token is bearer-equivalent on the gateway)" branch above is the live behavior of the OpenClaw gateway version this fork runs against. Source-side evidence comes from the bundled gateway runtime checked in at `~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js` (OpenClaw `2026.4.24`):

- Lines `10538-10579` define a fallback path that runs when primary auth (password / regular token / bootstrap-token) is **not** OK and the connect frame still carries a `deviceTokenCandidate` plus a known `deviceId`. The path calls `verifyDeviceToken({ deviceId, token, role, scopes })`, sets `authOk = true` and `authMethod = "device-token"` on success, and **does not require `device.signature` to be present or valid in the same frame**.
- The `device.signature` path (line `10762-10764`, `verifyDeviceSignature(publicKey, payloadV2|V3, signature)`) is independent — it is the v2/v3 challenge-response check that uses the freshly-signed handshake payload. It is not chained to the `deviceToken` fallback.
- Line `10768` enumerates `authMethod` as `"password" | "token" | "bootstrap-token" | "device-token" | "none"`. `device-token` is a first-class auth method on this gateway, not an augmentation that requires another signature alongside.
- Line `10736` shows the auth-resolution chain treats `deviceToken` as a peer of `token` and `bootstrapToken` for the connect frame: `connectParams.auth?.token ?? connectParams.auth?.deviceToken ?? connectParams.auth?.bootstrapToken ?? null`.
- Server-side, gateway-issued tokens are persisted per device under the `tokens` field of `~/.openclaw/devices/paired.json` (chmod `600`). No token values are shown in this audit.

Threat path:

1. XSS lands on Mission Control (CSP weakness or library RCE).
2. Reads `localStorage['mc-device-token']` and `localStorage['mc-device-id']` — both are plain strings and trivially exfiltrated; the private key is no longer in `localStorage` post-PR #574.
3. Connects to the gateway with the stolen `deviceId` in `connect.params.device.id` and the stolen token in `connect.params.auth.deviceToken`.
4. Gateway runs the `verifyDeviceToken` fallback above. Token matches the stored token for that `deviceId` → `authOk = true`. Session granted **without the private key**.

Mitigations the gateway already has:

- `AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN` per `clientIp` (lines `10546-10548` / `10573`). This caps brute-force volume but does not stop a single-shot replay with a valid token.
- The per-device token entry in `paired.json` is rotatable on the gateway side (`ensureDeviceToken` returns `rotatedAtMs` / `createdAtMs`). Mission Control does not currently force a rotation on suspected exfil.

Mitigations Mission Control still needs:

- **Take `mc-device-token` out of `localStorage`** so JS cannot read it. PR #574 applied the same hardening to the private key by storing the `CryptoKey` in IndexedDB with `extractable: false`. Token migration cannot use `CryptoKey` (the token is just an opaque string), so the practical options are:
  - **(a) in-memory only** — token never persists; require a fresh device-signature handshake on every reload. Highest hardening, biggest UX cost (device-pair churn on tab close).
  - **(b) `sessionStorage`** — survives reloads within one tab, dropped at tab close. Mid-tier hardening, mid-tier UX cost. Still readable by same-origin JS, so this only mitigates persisted-XSS exfil, not in-page XSS.
  - **(c) `httpOnly` cookie minted by Mission Control's BFF** — JS-unreadable. Highest practical hardening, biggest implementation cost (BFF must proxy the gateway connect frame).
- Choosing among (a) / (b) / (c) is a UX/security trade-off design call; this audit does **not** decide it. The implementation work is tracked as **Phase 1.7** in `docs/audit/MISSION_CONTROL_ROADMAP.md`.

This update closes Phase 1.6 (the classification question). It does not close the storage migration; that work is Phase 1.7.

---

## Update — Phase 1.7 (sessionStorage migration, PR #19, 2026-04-27)

Đào msg 1552 picked **option (b) `sessionStorage`**. PR #19 rewrites `src/lib/device-identity.ts`'s storage helpers:

- `cacheDeviceToken` writes `sessionStorage` only.
- `getCachedDeviceToken` reads `sessionStorage`; on every call it also drops any legacy `localStorage['mc-device-token']` entry **without promoting** the value (any token whose lifecycle started in the wrong scope cannot continue under the new scope; the next handshake re-mints).
- `clearDeviceIdentity` removes the token from both stores defensively.
- All storage operations are wrapped in `try/catch` (per Đào msg 1555 refinement #2) so private/lockdown browsing modes degrade to `null` reads or no-op writes rather than crashing the auth flow.
- A new source-discipline test (`src/lib/__tests__/device-token-storage-source-discipline.test.ts`) pins the invariants statically: production code must not call `localStorage.setItem` for the token, may only call `localStorage.getItem` paired with a same-block `removeItem` (legacy cleanup), and the cache helpers must use `sessionStorage`.

Threat-model delta: the persisted-XSS, cross-tab, and offline-disk-dump exfil paths are **closed**. Same-tab same-origin JS reading `sessionStorage` while the page is open is the **residual** — mitigated by option (c) `httpOnly` BFF cookie if it ever becomes a real incident, but deferred for now because it requires re-architecting the gateway connect proxy.

Phase 1.7 closes here. Phase 1.6 (classification) was already closed by PR #18.
