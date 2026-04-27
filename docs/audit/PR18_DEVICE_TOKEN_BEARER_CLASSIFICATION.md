# Phase 1.6 — `mc-device-token` bearer classification

**Outcome: BEARER-EQUIVALENT.** The OpenClaw gateway version this fork runs against (`2026.4.24`) accepts `mc-device-token` as a stand-alone authentication credential on the connect frame. XSS that exfiltrates the token plus the device id from `localStorage` can replay against the gateway without the device private key (which PR #574 already moved to IndexedDB with `extractable: false`). Storage-migration implementation is tracked as **Phase 1.7** in the roadmap; this PR is the classification audit only.

**Snapshot date:** 2026-04-27 (HEAD of `phase-2/pr18-device-token-bearer-classification`, branched from `phase-0/baseline-audit`).

## Why this PR exists

`docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` (written during PR #2) flagged that the client always co-presents `mc-device-token` with a fresh device signature on connect, and that whether the gateway accepts the token *alone* was a gateway-side audit blocked on having gateway source access. Since the OpenClaw gateway runtime is bundled into the fork's installed `openclaw` npm package, that source is locally available — this PR cites it directly and resolves the open classification question.

## Client-side: where the token lives

| File | Lines | Role |
| --- | --- | --- |
| `src/lib/device-identity.ts` | `29` | `STORAGE_DEVICE_TOKEN = 'mc-device-token'` — `localStorage` key name. |
| `src/lib/device-identity.ts` | `292` | `getCachedDeviceToken()` reads the token from `localStorage`. |
| `src/lib/device-identity.ts` | `297` | `cacheDeviceToken(token)` writes the token to `localStorage`. |
| `src/lib/websocket.ts` | `226` | Reads the cached token at connect time. |
| `src/lib/websocket.ts` | `233` | Mixes the token into the v2 device-auth payload that the device private key signs (`tokenForSignature`). |
| `src/lib/websocket.ts` | `298` | Sends the token as `params.deviceToken` on the connect frame, alongside the signed `device` block. |
| `src/lib/websocket.ts` | `402-403` | Caches whatever new token the gateway returned in the connect-result frame. |

The fact the token *is* mixed into the signed payload at line `233` was the original reason PR #2's audit suspected the token was not bearer-equivalent. The client-side mixing does not affect the gateway's acceptance of the token in isolation, which is what the fallback path below confirms.

## Gateway-side: decisive evidence

Source: `~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js`.
OpenClaw version: `2026.4.24` (verified via `node -p "require('/home/vip.toanvo/.npm-global/lib/node_modules/openclaw/package.json').version"`).

### A. `deviceToken` is a first-class auth method

```text
server.impl-CtLS1ywt.js:10768
  authProvided === "password"        ? "password"
                  ?? "token"          ? "token"
                  ?? "bootstrap-token"? "bootstrap-token"
                  ?? "device-token"   ? "device-token"
                                      : "none"
```

`device-token` is enumerated alongside `password` / `token` / `bootstrap-token`, not as an augmentation of one of them.

### B. `deviceToken` participates in the auth-resolution chain

```text
server.impl-CtLS1ywt.js:10736
  return connectParams.auth?.token
       ?? connectParams.auth?.deviceToken
       ?? connectParams.auth?.bootstrapToken
       ?? null
```

The gateway will resolve a connect to whichever auth field is present, in this priority order. `deviceToken` is a peer of `token` and `bootstrapToken`.

### C. Stand-alone fallback path that does NOT require `device.signature`

This is the load-bearing finding. Lines `10538-10579`:

```text
const deviceTokenCandidate = params.state.deviceTokenCandidate;
if (!params.hasDeviceIdentity || !params.deviceId || authOk || !deviceTokenCandidate)
  return { authResult, authOk, authMethod };

let deviceTokenRateLimited = false;
if (params.rateLimiter) {
  const deviceRateCheck = params.rateLimiter.check(params.clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
  if (!deviceRateCheck.allowed) {
    deviceTokenRateLimited = true;
    authResult = { ok: false, reason: "rate_limited", rateLimited: true, retryAfterMs: ... };
  }
}

if (!deviceTokenRateLimited) {
  if ((await params.verifyDeviceToken({
        deviceId: params.deviceId,
        token:    deviceTokenCandidate,
        role:     params.role,
        scopes:   params.scopes,
      })).ok) {
    authOk = true;
    authMethod = "device-token";
    params.rateLimiter?.reset(params.clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
    if (params.state.sharedAuthProvided)
      params.rateLimiter?.reset(params.clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
  } else {
    authResult = { ok: false, reason: ... ?? "device_token_mismatch" };
    params.rateLimiter?.recordFailure(params.clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
  }
}
return { authResult, authOk, authMethod };
```

The early-return guard requires `hasDeviceIdentity` + non-null `deviceId` + a candidate token, and `authOk === false` (i.e. primary auth — password / regular token / bootstrap-token — is not OK). Inside the guard, **only the token is verified.** There is no read of `params.device.signature` and no chain into `verifyDeviceSignature`.

### D. The `device.signature` path is independent

```text
server.impl-CtLS1ywt.js:10762-10764
  if (verifyDeviceSignature(params.device.publicKey, payloadV3, params.device.signature)) return "v3";
  ...
  if (verifyDeviceSignature(params.device.publicKey, payloadV2, params.device.signature)) return "v2";
```

This is the v2 / v3 challenge-response check that uses the freshly-signed handshake payload from `src/lib/websocket.ts:248` (the v2 payload shape: `v2|deviceId|clientId|clientMode|role|scopes|signedAt|tokenForSignature|nonce`). It is computed in a different code path from the device-token fallback above. The two are *not* chained — passing one does not require passing the other.

### E. Token issuance and on-disk storage (gateway side)

`server.impl-CtLS1ywt.js:11490-11497` issues tokens via `ensureDeviceToken({ deviceId, role, scopes })` after a successful handshake and persists them in `~/.openclaw/devices/paired.json` (file mode `600`). Each entry includes the field set `{ deviceId, publicKey, platform, clientId, clientMode, role, roles, scopes, approvedScopes, tokens, createdAtMs, approvedAtMs }` (verified via Python `json.load` on the file's keys; the `tokens` field's actual values are not shown in this audit). The combination of "token persisted server-side" + "token-only auth path" is what makes this bearer-equivalent.

## Threat path

1. XSS lands on Mission Control via a CSP weakness, library RCE, or operator-mode path.
2. The page reads `localStorage['mc-device-token']` and `localStorage['mc-device-id']`. Both are plain strings with no JS-side gating. The private key, since PR #574, is in IndexedDB as a `CryptoKey` with `extractable: false` — XSS *cannot* exfiltrate it via JS APIs.
3. The XSS payload (or an attacker who received the exfiltrated values out-of-band) connects to the gateway with the stolen `deviceId` placed in `connect.params.device.id` and the stolen token in `connect.params.auth.deviceToken`.
4. The gateway's resolution chain (B above) selects `deviceToken`. Primary auth is not provided so `authOk === false`, satisfying the fallback guard (C above). `verifyDeviceToken({ deviceId, token, ... })` returns `ok: true` because the token matches the stored token for that deviceId. `authMethod = "device-token"`.
5. The connect succeeds. The attacker now holds a session with the role / scopes the gateway issued for that paired device.

The private key never enters the picture.

## Mitigations the gateway already has

- `AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN` per `clientIp` (lines `10546-10548`, `10573`) caps brute-force volume.
- Token issuance is per-(deviceId, role) and tracked with `rotatedAtMs` / `createdAtMs` so the gateway can rotate.

These do not stop a single-shot replay with a valid token. Rate-limiting matters for guessing; it does not matter when the token is already known.

## Mitigations Mission Control still needs (Phase 1.7)

The `localStorage` storage of the token is the bearer-side weakness. PR #574 took the same hardening for the private key by moving it into IndexedDB with `extractable: false`. The token cannot use that mechanism — it is an opaque string, not a `CryptoKey` — so the practical options are:

- **(a) In-memory only.** Token never persists. Reload of the tab forces a re-pair (fresh device-signature handshake produces a fresh token). Highest hardening; biggest UX cost (re-pair on every reload / tab close).
- **(b) `sessionStorage`.** Token survives reloads within one tab, dropped at tab close. Mid-tier hardening — same-origin JS can still read it during the same tab session, so this only mitigates *persisted-XSS* exfil, not *in-page* XSS.
- **(c) `httpOnly` cookie minted by Mission Control's BFF.** Token becomes JS-unreadable. Highest practical hardening; biggest implementation cost — the BFF must proxy the gateway connect frame so the cookie can be attached server-side.

This PR does **not** pick the option. The choice is a UX/security trade-off design call that belongs in Phase 1.7 (`docs/audit/MISSION_CONTROL_ROADMAP.md`).

## Why this is docs-only

The classification is the artifact. No `src/` change is required to record it. The implementation work (storage migration) is a separate PR with its own design call, test plan, and rollback. Bundling them here would be the same scope creep the original PR #2 audit explicitly avoided.

## Files in this PR

- `docs/audit/PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md` (this file).
- `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` (append "Update 2026-04-27" section that confirms the classification with the same line citations).
- `docs/audit/MISSION_CONTROL_ROADMAP.md` (mark row 1.6 ✅ complete via PR #18; add row 1.7 for the storage migration follow-up with the (a)/(b)/(c) decision points).
- `docs/audit/MISSION_CONTROL_BASELINE.md` (residual-risk row 6 updated to reflect the resolved classification).

No source code, no test files, no scripts.

## Risk and rollback

- Risk: very low — this PR is purely classification + roadmap routing. It does not change any runtime behavior.
- Rollback: revert the merge commit. Nothing imports these documents.

## Refs

- `docs/audit/PR2_DEVICE_TOKEN_FOLLOWUP.md` — original investigation.
- `docs/audit/MISSION_CONTROL_BASELINE.md` — residual-risk row 6, now updated.
- PR #574 (upstream) — same XSS-exfil hardening pattern applied to the private key.
- OpenClaw `2026.4.24` runtime: `~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js`.
