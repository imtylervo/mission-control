# Phase 2.1 — admin auth/env hardening (PR #23)

**Outcome:** the three concrete gaps Đào pinned in the Phase 2.1 takeover checkpoint are closed in one minimal PR:

1. `PUT /api/auth/users` now invalidates the target user's existing sessions when an admin resets their password (so a stolen / forgotten cookie tied to the previous password cannot stay valid after rotation).
2. `DELETE /api/auth/users` accepts the user id from EITHER the query string (`?id=NN`) OR the JSON body — silencing the UI/API mismatch where the existing UI panel always sends the id via the query string while the original API only read the body.
3. The auth env-loading contract is documented (and only documented — no behavioural change here): `AUTH_PASS_B64` and `AUTH_PASS` are first-run seeds for the SQLite admin user only; editing `.env` / `.env.local` after first run does **not** rotate any existing user's password. Rotation now flows through `/api/auth/me` (self-change) or `PUT /api/auth/users` (admin reset).

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #22 merge (`8e6ffff`).

## Why this PR exists

Đào's takeover checkpoint at `mission-control-watchdog.json#self_takeover_at = 17:46` settled three follow-ups from the watchdog cron audit. Tyler (msg 1583) approved Mai to apply the watchdog cron fix first (separate, already-merged into the cron file via direct write — see `~/.openclaw/cron/jobs.json.bak-20260427-174933`), then pick up the Phase 2.1 PR scope. Đào's msg 1590 explicitly handed the implementation back to Mai with the three items above.

## What changed

### `src/app/api/auth/users/route.ts`

**PUT handler** (admin updates a user):

- Imports `destroyAllUserSessions` from `@/lib/auth` (existing helper at `src/lib/auth.ts:229-232`, which executes `DELETE FROM user_sessions WHERE user_id = ?`).
- After a successful `updateUser(...)`, if the request payload included a non-empty `password` field, calls `destroyAllUserSessions(userId)`. Empty-string passwords are not treated as a change (the route already normalises them to `undefined` before calling `updateUser`).
- The audit-log `detail` now records `sessions_invalidated: 1` so the audit trail makes the rotation visible without leaking timing or counts.
- Self-update via `PUT /api/auth/users { id: <currentUser.id>, password }` — the route still allows it, and the session-invalidation will *also* drop the admin's own current session. That is the correct security default: admins resetting their own password should re-authenticate. A future UX refinement could keep the current session alive by passing the cookie token through `destroySession` filtering, but that adds policy decisions ("trust the in-flight cookie?" "rotate it instead?") that are not in this PR's scope.

**DELETE handler** (admin deletes a user):

- Reads `id` first from `URL(request.url).searchParams.get('id')`, then falls back to `await request.json()`'s `id` field.
- Returns `400 Request body required` is replaced by `400 User ID is required`, which is the correct error regardless of which channel the caller used.
- Adds a `Number.isNaN(parseInt(...))` check so a non-numeric id (`?id=abc`) cleanly rejects with 400 instead of silently letting `parseInt("abc")` return `NaN` and matching no rows.

The existing UI in `src/components/panels/user-management-panel.tsx:167` (`fetch('/api/auth/users?id=...', {method:'DELETE'})`) and any direct API caller using a JSON body now both work. UI is unchanged.

### `src/app/api/auth/users/__tests__/route-session-invalidation.test.ts` (new)

Nine vitest cases covering both invariants:

- PUT with `password: 'new-...'` calls `destroyAllUserSessions(targetUserId)`.
- PUT with only `display_name`/`role`/`email` does NOT call `destroyAllUserSessions`.
- PUT with `password: ''` (empty string) is treated as a no-op for session invalidation, matching the behavior of `updateUser` itself.
- The audit log records `sessions_invalidated: 1` only when the password actually changed.
- DELETE accepts `?id=NN` (query string).
- DELETE accepts `{id: NN}` in JSON body.
- DELETE returns 400 when neither query nor body provides an id.
- DELETE rejects deleting your own account (regardless of input shape).
- DELETE rejects a non-numeric id with 400.

The route module is loaded with `@/lib/auth`, `@/lib/db`, `@/lib/validation`, `@/lib/rate-limit`, `@/lib/logger` mocked — no SQLite file is required for the unit tests to run.

## Auth env-loading contract (docs-only refresher)

This PR does not change env loading. Documenting the rules because the Phase 2.1 audit found operators were unsure whether editing `.env.local` rotates anything:

- `AUTH_PASS_B64` is preferred over `AUTH_PASS`. Both live in env, only the first valid value is used. (`src/lib/db.ts:113-127`.)
- The seed runs **once**, on first SQLite open, when `users` is empty. (`src/lib/auth.ts` first-run seed block.)
- After the first user exists, the values in `.env` / `.env.local` are no longer consulted by user-creation paths. Re-deploying with a new `AUTH_PASS_B64` value does not rotate the admin password.
- Rotation paths:
  - `PATCH /api/auth/me` — self-service password change. The current session stays valid after a successful rotation (the cookie is rebound to the new password's session id).
  - `PUT /api/auth/users` — admin resets another user's password. **All of that user's existing sessions are now destroyed** (this PR's behavior).
- Session lifecycle helpers in `src/lib/auth.ts`:
  - `destroySession(token)` — drop one session.
  - `destroyAllUserSessions(userId)` — drop every session for a user.
  - Stale-session GC at `src/lib/auth.ts:180` runs `DELETE FROM user_sessions WHERE expires_at < ?` on each session validate.

The deployment doc and the security baseline both already point at these helpers; this PR keeps them as the single source of truth and just makes the admin reset path call into them.

## What this PR does not do

- No DB migration. The existing `user_sessions` table already has the columns needed (`token`, `user_id`, `expires_at`, etc.); session invalidation re-uses `destroyAllUserSessions`.
- No `.env`-driven rotation. Rotation continues to flow through the API.
- No change to `/api/auth/me` self-rotation behavior.
- No UI change. The UI's existing query-string DELETE call works as-is.

## Gates

- `npx vitest run src/app/api/auth/users/__tests__/route-session-invalidation.test.ts` → **9 passed**.
- `npx vitest run src/lib/__tests__/auth.test.ts` → **13 passed** (existing auth tests, regression check).
- `npx tsc --noEmit` → clean.
- `grep -nE "destroyAllUserSessions" src/app/api/auth/users/route.ts` → import + call present in PUT handler.
- `grep -nE "searchParams.get\\('id'\\)" src/app/api/auth/users/route.ts` → confirms DELETE handler reads query first.

The pre-existing `gateway-url.test.ts` failure on `phase-0/baseline-audit` (residual-risk row 4 in `BASELINE.md`) is unrelated and **not** introduced by this PR.

## Risk and rollback

- Risk: low. Two narrow behavior changes on routes admins rarely hit at peak traffic; both preserve the existing happy path.
- Rotation rollback: if an operator wants to undo the session invalidation behavior, revert this PR's PUT-handler diff alone — DELETE handler change is independent and safe to keep.
- Operational note: after deploy, any admin-initiated password reset will sign the target user out of every device. Document this in the runbook so support can pre-warn operators.

## Refs

- Đào msg 1590 — Phase 2.1 PR scope handoff.
- Đào takeover checkpoint at `mission-control-watchdog.json#self_takeover_at = 2026-04-27T17:46:00`.
- `src/lib/auth.ts:223-232` — `destroySession` / `destroyAllUserSessions` helpers (existing, this PR does not modify).
- `src/lib/db.ts:113-127` — `AUTH_PASS_B64` / `AUTH_PASS` first-run seed loader (existing, no change).
- `src/components/panels/user-management-panel.tsx:167` — UI DELETE call shape (no change).
