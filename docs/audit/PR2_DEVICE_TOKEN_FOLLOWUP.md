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
