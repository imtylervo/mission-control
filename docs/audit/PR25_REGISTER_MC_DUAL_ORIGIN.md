# Phase 2.2 / PR #25 — `registerMcAsDashboard` dual-origin coverage

**Outcome:** when Mission Control auto-registers itself with the OpenClaw gateway via `registerMcAsDashboard(mcUrl)`, the resulting `gateway.controlUi.allowedOrigins` entry now covers BOTH `http://localhost:PORT` AND `http://127.0.0.1:PORT` (same protocol + port) instead of only the form mcUrl was reached at. Browsers treat the two as different origins and the gateway's allowlist is exact-string match, so single-form registration was the root cause Phase 2.2's "GW Offline despite healthy gateway" symptom — surfaced by PR #24's diagnostic route.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #24 merge (`dc55f71`).

## Why this PR exists

PR #24 (Phase 2.2 PR-A, merged `dc55f71`) added the viewer-gated diagnostic at `GET /api/diagnostics/gateway-origin` that pinpoints the localhost ↔ 127.0.0.1 mismatch. PR #25 is the **fix half** of the same Phase 2.2 split (Đào msg 1611 → 1618). The user-visible improvement: an operator who launches MC at `http://localhost:3000` no longer ends up with a half-configured allowlist that breaks WebSocket connect for anyone who happens to type `127.0.0.1:3000` instead.

## What changed

### `src/lib/gateway-runtime.ts`

1. New private helper `derivePeerLocalOrigin(origin: string): string | null`:
   - Parses the origin via `new URL()`.
   - If `hostname === 'localhost'` (case-insensitive) → swaps to `127.0.0.1`, returns the peer origin string.
   - If `hostname === '127.0.0.1'` → swaps to `localhost`, returns the peer.
   - Anything else (real hostnames, `host.docker.internal`, IPv6, etc.) → returns `null`.
   - Catches `URL` parse errors and returns `null` (never throws upward).
   - Protocol and port are preserved by URL semantics — the swap is host-only.

2. `registerMcAsDashboard(mcUrl)` now:
   - Parses `mcUrl` → `origin`.
   - Computes `peer = derivePeerLocalOrigin(origin)`.
   - Builds `targets = peer ? [origin, peer] : [origin]`.
   - Computes `missing = targets.filter(t => !origins.includes(t))`.
   - If `missing.length === 0` → `{ registered: false, alreadySet: true }` (no write).
   - Otherwise pushes each missing target onto the existing array and writes the file once.
   - Return shape unchanged — `{ registered: boolean; alreadySet: boolean }`.

The error path (EROFS / EACCES / EPERM treated as non-fatal skip; everything else logged at error and falls through to `{ registered: false, alreadySet: false }`) is byte-identical to PR #24's snapshot.

#### Why narrow scope (host-only swap on same protocol + port)

- `host.docker.internal` is **deferred**. It is not what Phase 2.2 surfaced and adding it would broaden the auto-register blast radius beyond the localhost/127.0.0.1 axis. Operators who need it can add manually.
- IPv6 (`[::1]`) is **deferred**. Same reasoning — not the Phase 2.2 root cause, requires careful URL bracket handling, and is rarely the form a browser hits without explicit operator setup.
- Different ports do NOT swap. A gateway allowlist of `http://localhost:3001` does not auto-imply `http://localhost:3000` — that would be a real broadening.
- Foreign hostnames pass through with no peer (single-origin behavior identical to pre-PR #25).

### `src/lib/__tests__/gateway-runtime.test.ts`

Extended from 2 cases to 9. The 2 pre-existing cases continue to pass byte-identically (they exercise foreign-hostname registration which has no peer). The 7 new cases pin the PR-B contract:

1. Localhost-only requested → BOTH `http://localhost:3000` and `http://127.0.0.1:3000` land in the file.
2. 127.0.0.1-only requested → BOTH forms land (symmetric).
3. One form already present → only the missing peer is pushed (idempotence partial).
4. BOTH forms already present → no rewrite, `{ registered: false, alreadySet: true }` — file byte-identical (full idempotence).
5. `https://localhost:8443/dashboard` → preserves protocol AND non-default port on the derived peer.
6. Different port (3001 already present) + register at 3000 → adds 3000 + its 127.0.0.1 peer; does NOT touch 3001 (port-isolation invariant).
7. `host.docker.internal:3000` → adds only that origin, does NOT synthesise localhost or 127 peers (deferred-scope invariant pinned in test).

## Gates

- `npx vitest run src/lib/__tests__/gateway-runtime.test.ts` → **9 passed** (2 pre-existing + 7 new).
- `npx vitest run src/app/api/diagnostics/gateway-origin/__tests__/route.test.ts` → **8 passed** (PR #24 regression — diagnostic route is unchanged, but it shares the gateway-runtime module).
- `npx tsc --noEmit` → clean.
- `grep -nE "derivePeerLocalOrigin" src/lib/gateway-runtime.ts` → confirms helper is module-private (one definition, one call site inside `registerMcAsDashboard`).

The pre-existing `gateway-url.test.ts` failure on `phase-0/baseline-audit` (residual-risk row 4 in `BASELINE.md`) is unrelated and **not** introduced by this PR.

## What this PR does not do

- **No DB migration, no env change, no new dependency.**
- **No UI change.** The diagnostic surface from PR #24 already lets the UI display a specific hint when the allowlist is wrong; PR #25 shrinks the surface area where that hint is needed but does not change the diagnostic itself.
- **No expansion of the auto-register host whitelist.** Only localhost ↔ 127.0.0.1 on the same protocol + port. `host.docker.internal`, IPv6 `[::1]`, and arbitrary aliases remain operator-managed.
- **No change to `dangerouslyDisableDeviceAuth`** — same security invariant as before: MC auto-register touches `allowedOrigins` only, never the device-auth flag.
- **No raw config content reaches the audit log or the chat** — `logger.info` records origin/peer/added (which are bounded to the localhost/127.0.0.1 axis when the peer logic kicks in, or whatever foreign origin the operator passed in, already known to them).

## Risk and rollback

- Risk: low. The function's external contract (return shape + error path) is unchanged. The only new behavior fires when the input origin is `localhost` or `127.0.0.1` — and the new behavior is purely additive (more entries in the allowlist), never removes or rewrites existing entries.
- Rollback: revert this PR's diff. The function reverts to single-origin add, no schema or migration to undo.
- Operational note: operators whose openclaw.json was generated before PR #25 will see one additional entry appear the first time MC restarts after upgrade (the missing peer). That is exactly the intended behavior — the diagnostic route from PR #24 will flip from `mismatch=true` to `mismatch=false` for that operator without any manual edit.
- If an operator wanted the old single-form-only behavior (rare, e.g. they intentionally bind to `localhost` and want to reject `127.0.0.1` callers): they can add the unwanted form manually as a deny-rule layer outside MC's control, since MC only manages additions to `allowedOrigins`.

## Refs

- Đào msg 1611 — Phase 2.2 audit + 2-PR split direction.
- Đào msg 1614 — privacy invariant (still upheld here: no raw config in chat).
- Đào msg 1618 — PR #24 merge ack + PR-B scope assignment.
- PR #24 (`dc55f71`) — diagnostic surface, motivates this fix.
- `src/lib/gateway-runtime.ts:30-50` — `derivePeerLocalOrigin` helper (this PR).
- `src/lib/gateway-runtime.ts:55-95` — `registerMcAsDashboard` updated to dual-origin.
- `src/app/api/diagnostics/gateway-origin/route.ts` — diagnostic from PR #24, unchanged.
