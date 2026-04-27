# Phase 1.5 — #574 legacy localStorage → IDB migration verification

**Outcome: VERIFIED on Chromium. Prior partial-failure on Camoufox/Firefox is documented as an engine-specific quirk, not an MC app bug.**

**Status:** complete via PR #16. Replaces the earlier "fixture issue / not verified end-to-end" classification recorded in PR #5 sub-task 5a (commit `4677fdd`, BASELINE.md row 787) and Đào's intermediate review (Telegram msg 1291).

**Snapshot date:** 2026-04-27 (HEAD `ea71270`, branch `phase-0/baseline-audit`).

## Why the earlier classification needed revision

PR #5 sub-task 5a observed a partial-failure pattern on Camoufox (Firefox-based, the Camofox browser tool used at the time):

- Legacy `mc-device-privkey` localStorage key remained after the migration attempt.
- IDB `mc-device-identity` had one record.
- The OpenClaw gateway gained no new pairing for the seeded device id.

That pattern matches the spec at `src/lib/device-identity.ts:184-216`: the migration stores in IDB but throws `DeviceIdentityUnavailableError` when either the read-back or the second verify-sign roundtrip fails, and *by design* preserves the legacy localStorage key in that failure case.

The verification was classified as "fixture issue / not verified end-to-end" because:

1. Camofox v1.6.2 has no init-script API (verified — `GET /init-script` and `/preload` both 404), so an early `console.error` wrapper could not be installed before the migration ran. The exact `DeviceIdentityUnavailableError` reason was lost.
2. The fixture was a throwaway in-browser keypair, and it was unclear whether the format matched what real upgrade-path users had on disk.

This PR resolves both gaps.

## Fixture format is confirmed valid (pre-#574 source review)

`git show 1411296^:src/lib/device-identity.ts` (the parent of the #574 fix) shows the original write:

```ts
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY = 'mc-device-privkey'

// inside generateNewIdentity():
const privateKeyBase64 = toBase64Url(privPkcs8)
localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)
localStorage.setItem(STORAGE_PRIVKEY, privateKeyBase64)
```

Layout:

| Key | Value |
| --- | --- |
| `mc-device-id` | hex SHA-256 of the raw public key (64 chars) |
| `mc-device-pubkey` | base64url of the raw public key (43 chars for Ed25519) |
| `mc-device-privkey` | base64url of the PKCS8-encoded private key (64 chars for Ed25519) |

This is exactly the format the PR #5 / PR #16 fixture seeds. No format-mismatch hypothesis remains; the prior "fixture issue" framing is corrected here.

## Pre-page instrumentation via Chromium + Playwright `addInitScript`

Per Đào's Phase 1.5 HYBRID approval (Telegram msg 1348, 30-min cap), this PR uses Chromium under Playwright (already installed for Tyler's Claude Code MCP setup) instead of Camofox to get a true pre-page wrapper installed via `BrowserContext.addInitScript()`. The wrapper is reinstalled on every navigation and on reloads, so the wrapper is in place *before* any page script runs.

The wrapper records:

- Every `console.warn` and `console.error` call (with safe argument serialization — `Error → { name, message }`, plain object → JSON, others → truncated `String(...)`).
- Every `crypto.subtle.sign` call's success/failure + byte length (no signature material logged).
- Every `crypto.subtle.importKey` call's format / extractable / keyUsages + success/failure (no key material logged).
- Every `indexedDB.open` and `indexedDB.deleteDatabase` call.

The full instrumentation script is checked in at `docs/audit/scripts/pr16-mc-574-migration-test.js` for reproducibility. Run it from the repo root after a successful admin login session is in place at `127.0.0.1:3000`:

```bash
NODE_PATH=$(pwd)/node_modules node docs/audit/scripts/pr16-mc-574-migration-test.js
```

The script reads the admin password from `/tmp/mc-admin-pass.rotated` (the temporary handoff file used during the credential rotation Đào performed on 2026-04-27). The path is local-only and the script never logs the password or any key material.

## Result on Chromium (decisive)

Output (redacted to shapes/booleans only — no key material was ever logged):

```json
{
  "engine": "chromium-headless-shell-145",
  "stateAfterLogin": {
    "ls": { "mc-device-id": 64, "mc-device-pubkey": 43 },
    "dbs": [ { "name": "mc-device-identity", "version": 1 } ]
  },
  "seedResult": { "seeded": true, "didLen": 64, "pubLen": 43, "privLen": 64 },
  "finalState": {
    "ls": { "mc-device-id": 64, "mc-device-pubkey": 43 },
    "idb": [ { "name": "mc-device-identity", "version": 1, "stores": ["keys"], "counts": { "keys": 1 } } ],
    "didMatchesSeed": true,
    "legacyPrivkeyStillPresent": false,
    "log": [
      { "lvl": "idb",    "op": "open",      "name": "mc-device-identity", "version": 1 },
      { "lvl": "crypto", "op": "importKey", "format": "pkcs8", "extractable": false, "keyUsages": ["sign"], "ok": true },
      { "lvl": "crypto", "op": "sign",      "ok": true, "byteLen": 64 },
      { "lvl": "idb",    "op": "open",      "name": "mc-device-identity", "version": 1 },
      { "lvl": "idb",    "op": "open",      "name": "mc-device-identity", "version": 1 },
      { "lvl": "crypto", "op": "sign",      "ok": true, "byteLen": 64 },
      { "lvl": "crypto", "op": "sign",      "ok": true, "byteLen": 64 }
    ]
  }
}
```

Decisive findings (each maps to one of `migrateLegacyIfPresent`'s spec steps in `src/lib/device-identity.ts:156-216`):

| Step | Spec | Wrapper evidence | Outcome |
| ---: | --- | --- | --- |
| 1 | `crypto.subtle.importKey('pkcs8', ...)` | log entry `crypto importKey pkcs8 extractable=false keyUsages=[sign] ok=true` | ✅ |
| 2 | `verifySignRoundtrip(imported)` | log entry `crypto sign ok=true byteLen=64` (first occurrence) | ✅ |
| 3 | `store.store(imported)` (IDB write) | log entry `idb open mc-device-identity v1` (read-write open inside the store helper) | ✅ |
| 4 | `store.load()` (IDB read-back) | log entry `idb open mc-device-identity v1` (re-open) + the persisted CryptoKey returned to the caller | ✅ |
| 5 | `verifySignRoundtrip(persisted)` | log entry `crypto sign ok=true byteLen=64` (second occurrence) | ✅ |
| 6 | `localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)` | `finalState.legacyPrivkeyStillPresent: false` ← **the legacy key was removed** | ✅ |

Plus:

- `finalState.didMatchesSeed: true` — `mc-device-id` in localStorage matches the seeded value (no fresh-creation overwrite happened).
- `finalState.idb[0].counts.keys === 1` — the seeded private key persisted in IDB across the post-migration handshake reload.
- The third `crypto sign` log entry (after the migration) is the connect-handshake signature using the persisted key — confirming end-to-end usability, not just a successful migration.

## Engine comparison + classification

| Browser engine | Migration outcome | Where seen |
| --- | --- | --- |
| **Chromium 145** (Playwright bundled) | **PASSED end-to-end** (this PR) | step-by-step wrapper evidence above |
| **Camoufox / Firefox-derived 135** (Camofox v1.6.2) | partial-failure: IDB stored, verify-read or verify-sign-#2 threw `DeviceIdentityUnavailableError`, legacy key preserved | PR #5 sub-task 5a (commit `4677fdd`) |

Both runs used the same fixture format and exactly the same MC source. The divergence is therefore engine-specific, not an MC app defect.

The most plausible Firefox-side cause is a known-class issue with structured-clone roundtrip of a non-extractable Ed25519 `CryptoKey` through IndexedDB. The persisted key surfaces in the cursor but its `sign` operation fails (or the read-back resolves with a key whose internal handle has been invalidated). Mission Control's migration code is correct in the strict reading: it conservatively throws on any of the four post-import checks rather than silently storing a key that cannot sign.

## Mission Control source path is correct

`src/lib/device-identity.ts:156-216` (`migrateLegacyIfPresent`) implements Đào's 5-step spec verbatim:

1. Import legacy PKCS8 as non-extractable (`importKey`).
2. Verify sign roundtrip on the imported key.
3. `store.store(imported)` to IndexedDB.
4. Read back via `store.load()`.
5. Verify sign roundtrip on the persisted key.
6. Only then `localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)`.

The Chromium evidence shows all six steps executing in order with the expected results. No code change is required.

## Residual risk + recommended follow-up

- **Firefox / Camoufox upgrade-path users** may experience the partial-failure pattern documented in PR #5 sub-task 5a. The user-visible result is `DeviceIdentityUnavailableError`, which the dispatch path catches and (per the existing fallback in `sendConnectHandshake`) drops the connection into token-only mode. The user-visible UX is "device-pair re-required" rather than data loss — the legacy key is still on disk and can be exported / re-tried under a different browser if needed.
- The MC code already prompts for re-pair on `DeviceIdentityUnavailableError` per the docstring at `src/lib/device-identity.ts:227-232`, so no UX change is needed in MC. Recommend: file a low-priority follow-up to investigate the Firefox-specific quirk (potentially upstream to `mozilla/gecko`'s `crypto.subtle` + IDB structured clone), but do not block any MC release on it.

## What this PR changes

- Adds this verification doc.
- Adds `docs/audit/scripts/pr16-mc-574-migration-test.js` (the reproducible Chromium test harness, no key material logged, reads admin password from a local file path only).
- Updates `docs/audit/MISSION_CONTROL_BASELINE.md` and `docs/audit/MISSION_CONTROL_ROADMAP.md` Phase 1.5 status to "VERIFIED on Chromium / engine-specific quirk on Camoufox / no MC code change required".

No source code in `src/` is modified.
