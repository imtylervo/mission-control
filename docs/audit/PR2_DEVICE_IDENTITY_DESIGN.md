# PR #2 Design — Device Identity Hardening (#574)

**Owner:** Mai (architecture/code) + Đào (security review/AC)
**Status:** Draft for review
**Branch:** `phase-1/pr2-device-identity-design`
**Target after approval:** `phase-1/pr2-device-identity-impl` → PR into `phase-0/baseline-audit`

---

## 1. Problem

`src/lib/device-identity.ts` stores the Ed25519 device **private key** (PKCS8 base64url) in `localStorage` under `mc-device-privkey`. Any XSS, malicious extension, or `console.log` of `localStorage` exfiltrates the raw key material. With it an attacker can impersonate the device against the OpenClaw gateway indefinitely — the v2/v3 challenge-response only proves "holder of `mc-device-privkey`", not "interactive user in a live session".

Phase 0 baseline confirmed source (`MISSION_CONTROL_BASELINE.md`):

```
src/lib/device-identity.ts:18-22
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY = 'mc-device-privkey'   // ← raw PKCS8 base64url (Ed25519 PRIVATE)
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const STORAGE_GATEWAY_URL = 'mc-gateway-url'
```

`createNewIdentity()` (line 68-88) currently generates the keypair with `extractable: true`, exports PKCS8, base64-encodes it, and writes to `localStorage`. On reload, `getOrCreateDeviceIdentity()` (line 96-116) re-imports the PKCS8 as a non-extractable `CryptoKey`. So the **runtime CryptoKey is already non-extractable** — but the **persisted PKCS8 bytes are not**, which is exactly the leak.

## 2. Threat model

### In scope (must fix)

| Threat | Vector | Severity | Status |
|---|---|---|---|
| Key exfiltration via XSS reading `localStorage.getItem('mc-device-privkey')` | DOM-based or stored XSS in any panel | High | Today: trivial. After PR: blocked |
| Key exfiltration via dev-tools / `Object.entries(localStorage)` console snippet | Social-engineered paste | Medium | Today: trivial. After PR: blocked |
| Key persistence on disk through OS-level localStorage backup, browser sync | OS forensic / device theft | Medium | Today: raw key on disk. After PR: only opaque IndexedDB CryptoKey blob |
| Re-import of stolen key on attacker's machine | Pairing attacker's device with victim's identity | High | Today: trivial. After PR: blocked (key non-extractable, no exportable form ever leaves origin) |

### Out of scope (PR #2 does NOT solve, must be honest about it)

| Threat | Why deferred |
|---|---|
| Active XSS calling `crypto.subtle.sign(privKey, attackerPayload)` while page is open | Same-origin script holding the live `CryptoKey` reference can still sign; mitigation is hardening #576 (CSP, injection-guard) |
| Compromised gateway URL (`mc-gateway-url`) pointing victim at attacker server | Separate concern; tracked as future hardening |
| `mc-device-token` (bearer-equivalent if gateway accepts it without re-signing) | **See §10 — this PR splits classification into a follow-up issue per Đào's AC** |
| User session hijack via `auth-token` cookie/storage | Pre-existing auth flow, separate threat model |

## 3. Goals / Non-goals

### Goals

- After migration, `localStorage.getItem('mc-device-privkey') === null` for every user, every browser, on first page load post-deploy.
- Generated `CryptoKey` used for signing has `extractable === false` (verifiable via `crypto.subtle.exportKey` throwing).
- Existing paired devices keep working — same `deviceId`, same `publicKey`, same gateway pairing record. **No re-pair prompt.**
- IndexedDB or WebCrypto unavailable → fail closed with explicit "re-pair required" UI; never silently fall back to writing PKCS8 to localStorage.
- No raw key, PKCS8, or signature-secret material logged in `console`, test fixtures, snapshots, or docs.

### Non-goals

- Not switching to server-stored device store (Option C). That's a future redesign.
- Not introducing httpOnly cookie + server signing endpoint (Option A). Same.
- Not re-architecting the gateway v2/v3 challenge-response. Pubkey + signature format unchanged.
- Not addressing `mc-device-token` semantics in this PR (see §10).

## 4. Considered options

### Option A — httpOnly cookie + server-signed nonces

**Idea:** Move signing to server-side. Client posts `{deviceId, payload}` to `/api/device/sign`, server signs with private key from server vault, returns signature. Cookie carries opaque session ref. Private key never on client.

**Pros:**
- Strongest. JS never holds key material.
- Even active XSS cannot sign arbitrary attacker payloads (server can rate-limit + payload-validate).

**Cons:**
- Requires backend `POST /api/device/sign` endpoint with audit logging + rate limit.
- Migration is heavy: server must accept "import existing pubkey for user X, generate fresh server-side privkey" — but that breaks the pairing record on the gateway side (different pubkey = different deviceId since `deviceId = sha256(pubkey)`).
- Re-pair flow needed for every existing user.
- Gateway side may also need updates if it cared about timing of signature.

**Verdict:** Right answer long-term. Wrong answer for PR #2 (scope too large; high migration risk).

### Option B — WebCrypto non-extractable `CryptoKey` in IndexedDB ✅ **selected**

**Idea:** Generate the keypair with `extractable: false`, store the `CryptoKey` object directly in IndexedDB (which preserves non-extractability across reloads). Stop persisting PKCS8 bytes anywhere.

For existing users: import the legacy PKCS8 once as non-extractable, write to IndexedDB, delete `mc-device-privkey` from localStorage. Same `deviceId`, same `publicKey`, no re-pair.

**Pros:**
- Surgical fix. No backend changes. No gateway protocol change. No re-pair.
- Migration is one-time, automatic, transparent.
- Removes the actual root cause of #574 (raw key bytes at rest in localStorage).
- IndexedDB persists `CryptoKey` objects with their non-extractability intact (per W3C WebCrypto + structured-clone semantics).

**Cons:**
- Does NOT block active in-page XSS signing abuse (see §2 out-of-scope).
- IndexedDB unavailable in some contexts (private mode in some Safari versions, embedded webviews) → must fail closed.
- Adds dependency on IndexedDB code path (small but new surface).

**Verdict:** Best security-per-line-of-change for PR #2. Đào also leans this way (msg 1001).

### Option C — Server-stored device store + opaque session token

**Idea:** Devices live in a `devices` SQLite table with server-side pubkey storage. Client only ever holds an opaque session token. Gateway verifies tokens, not signatures.

**Pros:** Most robust. Centralized revocation, audit, rotation.

**Cons:** Total auth redesign. Gateway integration changes. Out of scope for #574.

**Verdict:** Future work, not this PR.

## 5. Decision

**Option B** for PR #2.

Document A and C as alternatives so the future direction is clear. Open follow-up issue noting Option A as the eventual target if/when the team wants to lift active-XSS-signing protection beyond what CSP + #576 hardening can give.

## 6. Implementation sketch

### 6.1 New module — `src/lib/device-identity-store.ts`

```typescript
// IndexedDB wrapper for non-extractable CryptoKey persistence.
const DB_NAME = 'mc-device-identity'
const DB_STORE = 'keys'
const DB_VERSION = 1
const KEY_PRIVATE = 'device-privkey'

export async function openDeviceIdentityDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storePrivateKey(key: CryptoKey): Promise<void> { /* put */ }
export async function loadPrivateKey(): Promise<CryptoKey | null> { /* get */ }
export async function clearPrivateKey(): Promise<void> { /* delete */ }
```

### 6.2 `device-identity.ts` rewrite

```typescript
const STORAGE_DEVICE_ID = 'mc-device-id'
const STORAGE_PUBKEY = 'mc-device-pubkey'
const STORAGE_PRIVKEY_LEGACY = 'mc-device-privkey'  // ← read-only, for migration
const STORAGE_DEVICE_TOKEN = 'mc-device-token'
const STORAGE_GATEWAY_URL = 'mc-gateway-url'

async function generateNewIdentity(): Promise<DeviceIdentity> {
  // extractable=false for the private key; public key is always extractable per spec.
  const keyPair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const deviceId = await sha256Hex(pubRaw)
  const publicKeyBase64 = toBase64Url(pubRaw)

  await storePrivateKey(keyPair.privateKey)  // IndexedDB
  localStorage.setItem(STORAGE_DEVICE_ID, deviceId)
  localStorage.setItem(STORAGE_PUBKEY, publicKeyBase64)

  return { deviceId, publicKeyBase64, privateKey: keyPair.privateKey }
}

async function migrateLegacyIfPresent(): Promise<DeviceIdentity | null> {
  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)
  const legacyPriv = localStorage.getItem(STORAGE_PRIVKEY_LEGACY)
  if (!storedId || !storedPub || !legacyPriv) return null

  // Re-import as NON-extractable; original PKCS8 bytes are then discarded.
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    fromBase64Url(legacyPriv) as unknown as BufferSource,
    'Ed25519',
    false,                         // extractable: false
    ['sign']
  )
  await storePrivateKey(privateKey)
  localStorage.removeItem(STORAGE_PRIVKEY_LEGACY)  // ← THE fix
  return { deviceId: storedId, publicKeyBase64: storedPub, privateKey }
}

export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  // 1. Check IndexedDB first (post-migration users).
  const idbKey = await loadPrivateKey().catch(() => null)
  const storedId = localStorage.getItem(STORAGE_DEVICE_ID)
  const storedPub = localStorage.getItem(STORAGE_PUBKEY)
  if (idbKey && storedId && storedPub) {
    return { deviceId: storedId, publicKeyBase64: storedPub, privateKey: idbKey }
  }

  // 2. Migration path — legacy localStorage privkey present.
  const migrated = await migrateLegacyIfPresent().catch(() => null)
  if (migrated) return migrated

  // 3. New device.
  return generateNewIdentity()
}
```

### 6.3 Fail-closed semantics

Per Đào's AC: if IndexedDB or WebCrypto throws, **never** write PKCS8 back to localStorage. Surface a re-pair prompt:

```typescript
export class DeviceIdentityUnavailableError extends Error {
  constructor(reason: string) {
    super(`Device identity unavailable: ${reason}. Re-pair required.`)
    this.name = 'DeviceIdentityUnavailableError'
  }
}
```

`websocket.ts` already has a `tokenOnlyFallback` path (line 419-429); we keep that for the case where WebCrypto Ed25519 is unsupported (older browser), but **not** for the case where the key was generated successfully but IndexedDB is broken — that one fails closed.

### 6.4 `clearDeviceIdentity()` updates

Existing function clears localStorage keys. Update it to also `await clearPrivateKey()` (IndexedDB delete). Existing callers in `websocket.ts:429` continue to work via the same export.

## 7. Migration path

| User state pre-deploy | Action on first page load post-deploy | Re-pair? | Token churn? |
|---|---|---|---|
| Never paired (no localStorage keys) | `generateNewIdentity()` runs once | N/A | New device, normal pairing |
| Paired, has all 3 localStorage keys | `migrateLegacyIfPresent()` runs once → IndexedDB populated → `mc-device-privkey` removed | **No** | None — same `deviceId` + `pubkey` |
| Paired, but localStorage `mc-device-privkey` corrupted | Falls through to `generateNewIdentity()` (matches existing line 109-112 behavior) | **Yes** (was already broken) | New device |
| Browser blocks IndexedDB (private mode etc.) | `storePrivateKey` throws → `DeviceIdentityUnavailableError` → UI prompts re-pair after IndexedDB available | **Yes** | New device when re-paired |

The migration is idempotent: running it on an already-migrated device is a no-op (legacy key absent → returns null).

## 8. Acceptance Criteria

Combining Mai's draft + Đào's review additions (msg 1001):

### Security

- [ ] After upgrade, `localStorage.getItem('mc-device-privkey') === null` for migrated users (verified by automated test that seeds legacy state then runs migration).
- [ ] `crypto.subtle.exportKey('pkcs8', identity.privateKey)` throws (extractable: false) — automated test.
- [ ] No code path writes PKCS8 base64 back to localStorage (grep test on `STORAGE_PRIVKEY_LEGACY` shows it's only read + removed, never set).
- [ ] No raw key, PKCS8 string, or signing-secret leaked via `console.log`, test fixtures, snapshots, or rendered DOM.
- [ ] If IndexedDB or WebCrypto fails after key generation, throw `DeviceIdentityUnavailableError`; never fall back to localStorage PKCS8 write.

### Functional

- [ ] Existing paired device (legacy localStorage state seeded) signs WebSocket handshake successfully after migration — same `deviceId`, same `pubkey`, same signature verification result.
- [ ] Refresh / browser restart → `loadPrivateKey()` retrieves the IndexedDB key and signing keeps working.
- [ ] New user (no prior state) → fresh keypair generated with `extractable: false`, registered with gateway as today.
- [ ] `clearDeviceIdentity()` removes both localStorage entries AND the IndexedDB key.
- [ ] `mc-device-token` semantics **explicitly classified** in the PR description:
  - If gateway treats it as bearer-only (no re-signing per request), open follow-up issue and link from PR #2 description (do NOT bundle the fix here).
  - If gateway re-verifies signature each request, document that and leave token in localStorage for now.

### Compatibility

- [ ] Gateway v2/v3 protocol untouched: same `deviceId = sha256(pubkey)`, same payload string, same Ed25519 signature output.
- [ ] No new server-side endpoints.
- [ ] Existing `shouldRetryWithoutDeviceIdentity` token-only fallback path still works for browsers without Ed25519 support.

### Test plan

- [ ] Unit test: `migrateLegacyIfPresent` from seeded localStorage produces same `deviceId` and same `pubkey` as before.
- [ ] Unit test: post-migration, `localStorage.getItem(STORAGE_PRIVKEY_LEGACY) === null`.
- [ ] Unit test: post-migration, `crypto.subtle.exportKey('pkcs8', privateKey)` throws.
- [ ] Unit test: `generateNewIdentity` creates a key with `extractable: false`.
- [ ] Unit test: `clearDeviceIdentity` clears both stores.
- [ ] Unit test: IndexedDB unavailable path → `DeviceIdentityUnavailableError` thrown, never falls back.
- [ ] E2E (Playwright): existing user upgrade — seed localStorage with PKCS8 + ID + pubkey from a fixture, navigate, verify WS handshake completes and migration removes localStorage privkey.
- [ ] No new lint errors. No new `tsc` errors. Coverage threshold (60%) maintained.

## 9. Rollout & rollback

### Rollout

- Single PR (no feature flag). Migration runs on first call to `getOrCreateDeviceIdentity()` after upgrade — typically the first WebSocket connect.
- Migration is local to each browser; no coordination needed.
- No DB migration on the server side.

### Rollback

If a regression surfaces (e.g., IndexedDB corruption on some browser), rollback strategy:

1. Revert PR #2 commit. Existing migrated users now have **no** `mc-device-privkey` in localStorage — so they'd hit `generateNewIdentity()` path on the reverted code → **forced re-pair**.
2. To avoid forced re-pair on rollback, the migration should optionally keep the legacy localStorage key during a "soak window" (e.g., for 7 days post-deploy). **Decision needed:** is the soak-window worth the prolonged exposure?

**Recommendation:** No soak window. The whole point of #574 is to remove the leak; keeping it for 7 days defeats the fix. If we have to roll back, accept the re-pair cost.

## 10. Out-of-scope follow-ups

- **`mc-device-token` classification.** Per Đào's AC, if the token is bearer-equivalent it's a separate vulnerability (#574-followup). Investigation for PR #2: check `websocket.ts:236+` and the gateway protocol docs to determine whether token alone authorizes requests.
- **`mc-gateway-url` integrity.** A poisoned gateway URL is a separate threat (gateway-pinning / TOFU). Out of scope.
- **Active XSS signing abuse.** Mitigation is #576 hardening + CSP, not a key-storage change.
- **Server-side device store (Option C).** Future redesign track.

## 11. Open questions for Đào / Tyler review

1. **Soak window trade-off (§9):** any reason to keep legacy localStorage key for N days for rollback safety? Mai recommends no — Đào agree?
2. **`mc-device-token` classification:** who investigates and opens the follow-up issue — Mai during PR #2 implementation, or Đào during AC pass?
3. **E2E fixture:** PR #2 will need a fixture representing "legacy paired user" (deviceId + pubkey + PKCS8 base64). Should we generate it deterministically with a known throwaway key, or seed at runtime?
4. **Telemetry on migration success rate:** worth adding a one-shot metric `device_identity_migration_outcome={success,fail,skipped}`? Or out of scope?

---

**Mai's recommendation:** wait for Đào AC review (~1 day per process), Tyler approves design, then Mai opens `phase-1/pr2-device-identity-impl` from `phase-0/baseline-audit`.
