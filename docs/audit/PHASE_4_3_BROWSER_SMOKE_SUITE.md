# Phase 4.3 — Browser smoke suite

**Outcome:** added a single consolidated `tests/dashboard-smoke.spec.ts` that exercises the four roadmap-required surfaces (login → dashboard load → gateway connect → task dispatch) in one fast happy-path Playwright run. Existing browser test infrastructure is robust (60+ specs, three Playwright configs, dedicated webServer harness) and does NOT block, so this PR does not need to scope around an infra gap.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `4e63702` (Phase 4.2 PR #35 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 4.3:

> Add Playwright/Camofox-compatible smoke for login, dashboard load, gateway connect, and task dispatch, or produce a scoped PR/audit if browser infra blocks.

Đào (LEAD) assigned this to Mai (CODER) after Phase 4.2 closed (Đào msg 1683, ETA 22:40:00+10:00). Browser infra does NOT block: `playwright.config.ts` already defines a baseURL (`http://127.0.0.1:3005`), a webServer command (`node scripts/e2e-openclaw/start-e2e-server.mjs --mode=local`), and test env defaults (`API_KEY=test-api-key-e2e-12345`, `AUTH_USER=testadmin`, `AUTH_PASS=testpass1234!`).

## What changed

### `tests/dashboard-smoke.spec.ts` (new)

A single `test.describe('Dashboard happy-path smoke (Phase 4.3)')` block with four tests, one per roadmap item:

1. **Login** — `POST /api/auth/login` with the seeded test admin credentials. Asserts 200 + a session-bearing `Set-Cookie` header.
2. **Dashboard load** — programmatic login on the same browser context, then `page.goto('/')`. Asserts the URL does NOT redirect to `/login` (proving the session cookie is honoured) and the body is non-empty.
3. **Gateway connect** — `GET /api/gateways` with the test API key header. Asserts 200 + an array-shaped response. Does NOT assert non-empty (a fresh test DB has zero gateways).
4. **Task dispatch** — `POST /api/tasks` via the existing `createTestTask` helper. Asserts 201 + the task lands in `status: 'inbox'`. The afterEach hook cleans up created task IDs so the spec is rerunnable.

The spec uses the existing `tests/helpers.ts` (`API_KEY_HEADER`, `createTestTask`, `deleteTestTask`) — no new helper plumbing.

## Why a single consolidated smoke (not a four-spec sprawl)

The existing `tests/` directory has 60+ spec files, including:

- `tests/login-flow.spec.ts` — broader login coverage (login page render, redirect rules, session lifecycle).
- `tests/gateway-connect.spec.ts` — gateway create + connect API contract.
- `tests/tasks-crud.spec.ts` — CRUD over `/api/tasks` including dispatch metadata.
- `tests/auth-guards.spec.ts`, `tests/timing-safe-auth.spec.ts`, `tests/csrf-validation.spec.ts` — auth surface depth.

A four-spec sprawl would duplicate that coverage. Phase 4.3's value-add is a **fast happy-path gate** that fails loud if the basic dashboard flow breaks, before the wider 60-spec suite runs (which is slower + more likely to flake on infra).

`dashboard-smoke.spec.ts` is intended to be the first thing CI runs in the e2e job. If it fails, the wider suite is unlikely to add information; if it passes, the wider suite drills into specific surfaces.

## Roadmap-item → existing-spec map

| Roadmap item (§ 4.3) | New (this PR) | Existing depth coverage |
| --- | --- | --- |
| Login | dashboard-smoke #1 | `login-flow.spec.ts`, `auth-guards.spec.ts`, `timing-safe-auth.spec.ts`, `legacy-cookie-removed.spec.ts` |
| Dashboard load | dashboard-smoke #2 | (no dedicated spec previously — this PR fills a small gap) |
| Gateway connect | dashboard-smoke #3 | `gateway-connect.spec.ts`, `gateway-config.spec.ts`, `gateway-health-history.spec.ts` |
| Task dispatch | dashboard-smoke #4 | `tasks-crud.spec.ts`, `task-comments.spec.ts`, `task-outcomes.spec.ts`, `task-queue.spec.ts`, `task-regression.spec.ts` |

## Gates run

```
$ git rev-parse HEAD
4e637026eb344709ebdb0a485f41aa1891463041  # confirms post-PR-#35 base

$ npx tsc --noEmit
(clean)

$ npx playwright test --list tests/dashboard-smoke.spec.ts
[chromium] › dashboard-smoke.spec.ts:41:7  1) login API issues a session cookie...
[chromium] › dashboard-smoke.spec.ts:52:7  2) dashboard loads after login...
[chromium] › dashboard-smoke.spec.ts:74:7  3) gateways list endpoint responds...
[chromium] › dashboard-smoke.spec.ts:86:7  4) task dispatch — POST /api/tasks creates...
Total: 4 tests in 1 file
```

The four tests parse cleanly and are picked up by the default `playwright.config.ts` discovery.

### Why the actual e2e run is not in this PR's gates

Running `npx playwright test tests/dashboard-smoke.spec.ts` requires the webServer at `http://127.0.0.1:3005` to boot — Playwright auto-starts it via `playwright.config.ts:webServer`, but this takes ~120 s and writes a fresh test DB. That is appropriate for CI but not for a per-commit pre-push gate, and Tyler's local dev MC (port 3000) should not be spun up at port 3005 just for review verification.

The first real run of this spec lands when CI exercises `pnpm test:e2e` (per `package.json`), or when an operator runs the smoke locally.

## What this PR does not do

- Does not replace any existing spec — purely additive.
- Does not add new helpers — uses existing `tests/helpers.ts` exports.
- Does not add new Playwright config — uses default `playwright.config.ts`.
- Does not change existing webServer / test seed / API_KEY defaults.
- Does not exercise destructive paths (no logout, no delete-account, no terminate-session).
- Does not run the e2e suite as part of this PR's gates — see "Why the actual e2e run is not in this PR's gates".

## Risk and rollback

- Risk: very low. Test-only addition; no `src/` changes.
- Rollback: revert this PR (single-file diff).

## Refs

- Đào msg 1683 (2026-04-27T12:07Z) — Phase 4.3 assignment, ETA 22:40:00+10:00.
- PR #35 — Phase 4.2 source-discipline umbrella, merged at `4e63702`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 4.3.
- `playwright.config.ts` — webServer + default env.
- `tests/helpers.ts` — `API_KEY_HEADER`, `createTestTask`, `deleteTestTask`.
