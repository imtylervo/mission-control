# Mission Control — phase audit summary

**Outcome:** roll-up index of every Mission Control phase audit doc landed on the `phase-0/baseline-audit` branch, with the merge commit, the PR-level scope summary, and a one-line "verified" note. Use this as the single entry point when looking for "what is actually verified about this fork" — each line links to the per-PR audit doc with full evidence.

**Snapshot date:** 2026-04-27. Last updated when PR #44 merged.

## How to read this doc

Each row is a phase that was actually audited and merged onto `phase-0/baseline-audit`. The "Audit doc" column links to a per-phase Markdown file with: scope, root-cause analysis, concrete code references, gates run (vitest + tsc + grep + manual), accepted-exception classification, and risk/rollback notes.

The phase numbers match `docs/audit/MISSION_CONTROL_ROADMAP.md`. A phase that does not appear here either was not audited yet or was rolled into a single PR with another phase.

## Phase 1 — Baseline security/deployability follow-ups

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 1.1 | core fix in PR #15 (merged); dashboard-route harness pending in [PR #17](https://github.com/imtylervo/mission-control/pull/17) (OPEN draft, 2/7 test-plan done) | Hydration nonce mismatch — `suppressHydrationWarning` on the inline bootstrap `<script>` in `src/app/layout.tsx`. Verified on `/login` `/setup` `/docs` via curl in PR #15. Dashboard `/` route harness in PR #17 awaiting admin auth credential / Playwright `MC_STORAGE_STATE_FILE`. **Core fix closed; dashboard verification pending.** |
| 1.5 | [PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md](PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md) | #574 legacy localStorage migration verified on Chromium |
| 1.6 | [PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md](PR18_DEVICE_TOKEN_BEARER_CLASSIFICATION.md) | `mc-device-token` classified as bearer-equivalent on the gateway |
| 1.7 | [PR19_PHASE_1_7_DEVICE_TOKEN_SESSIONSTORAGE.md](PR19_PHASE_1_7_DEVICE_TOKEN_SESSIONSTORAGE.md) | `mc-device-token` migrated to `sessionStorage` (XSS-exfil hardening) |
| 1.3b | (commit-level audit) | `runOpenClaw(['gateway','sessions_send',...])` → `callOpenClawGatewayWS('sessions.send', ...)` |
| 1.3c | (commit-level audit) | `runOpenClaw(['gateway','call','agent', ...])` → `callOpenClawGatewayWS('agent', ...)` |
| 1.3d | (commit-level audit) | Generic `callOpenClawGateway` wrapper → native WS via `callOpenClawGatewayWS` (14 of 17 callsites migrated) |

## Phase 2 — Runtime reliability and environment hardening

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 2.1 | [PR23_AUTH_SESSION_INVALIDATION.md](PR23_AUTH_SESSION_INVALIDATION.md) | Admin password reset invalidates target user's existing sessions; `DELETE /api/auth/users` accepts query string OR JSON body |
| 2.2 | [PR24_GATEWAY_ORIGIN_DIAGNOSTIC.md](PR24_GATEWAY_ORIGIN_DIAGNOSTIC.md) + [PR25_REGISTER_MC_DUAL_ORIGIN.md](PR25_REGISTER_MC_DUAL_ORIGIN.md) | Gateway origin diagnostic surfaces `localhost ↔ 127.0.0.1` mismatch; `registerMcAsDashboard` covers both forms |
| 2.3 | (DEV_SERVER_RUNBOOK in main docs) | Safe start/stop/dev-server runbook landed |
| 2.4 | [PHASE_2_4_DOCTOR_SECURITY.md](PHASE_2_4_DOCTOR_SECURITY.md) | `scripts/station-doctor.sh` + `scripts/security-audit.sh` run end-to-end (4 bash bugs fixed); accepted-exception list documented |

## Phase 3 — Core product surface stabilization

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 3.1 | [PHASE_3_1_AGENT_PANEL_SMOKE.md](PHASE_3_1_AGENT_PANEL_SMOKE.md) | Agent panel — list / identity / model / status / wake / message all PASS by source review + `agent-card-helpers` tests |
| 3.2 | [PHASE_3_2_SESSIONS_CHAT_SMOKE.md](PHASE_3_2_SESSIONS_CHAT_SMOKE.md) | Sessions/chat panel — list / transcript / send / abort-control all PASS, `sessions_kill → sessions.abort` migration confirmed |
| 3.3 | [PHASE_3_3_TASKS_PANEL_SMOKE.md](PHASE_3_3_TASKS_PANEL_SMOKE.md) | Tasks panel — create / dispatch / status / **no CLI shell-out regression** (grep `execSync\|spawnSync\|spawn(\|child_process` returns no matches in `task-dispatch.ts` + `src/app/api/tasks/`) |
| 3.4 | [PHASE_3_4_GATEWAY_NODES_CHANNELS_SMOKE.md](PHASE_3_4_GATEWAY_NODES_CHANNELS_SMOKE.md) | Gateway / nodes / channels panels — gateway probe + `node.list` / `device.pair.list` / channel status + login state |
| 3.5 | [PHASE_3_5_MEMORY_LOGS_SMOKE.md](PHASE_3_5_MEMORY_LOGS_SMOKE.md) | Memory / logs panels — tree / content / wikilinks / graph / health / process / log parser / SSE event stream — privacy invariant honored (no raw memory or log content pasted) |

## Phase 4 — Test/CI confidence

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 4.1 | (commit-level fix) | Pre-existing `gateway-url.test.ts` failure resolved — `buildGatewayWebSocketUrl` now correctly downgrades `https://localhost` to `ws://` (BASELINE residual-risk row 4 closed) |
| 4.2 | (umbrella source-discipline test landed) | New `umbrella-source-discipline.test.ts` asserts NO `runOpenClaw(['gateway','call','agent', ...])` / `runOpenClaw(['gateway','sessions_send', ...])` / `runOpenClaw(['agent','--message', ...])` reappears in migrated routes |
| 4.3 | [PHASE_4_3_BROWSER_SMOKE_SUITE.md](PHASE_4_3_BROWSER_SMOKE_SUITE.md) | `tests/dashboard-smoke.spec.ts` — single happy-path Playwright covering login + dashboard load + gateway connect + task dispatch in one fast run |
| 4.4 | [PHASE_4_4_CONTAINER_NO_CLI_SMOKE.md](PHASE_4_4_CONTAINER_NO_CLI_SMOKE.md) | Runtime evidence that migrated routes still serve traffic when `runOpenClaw` is mocked to throw `ENOENT` (the #608 deployment class) |

## Phase 5 — Tyler-stack features

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 5.1 | [PHASE_5_1_PROVIDER_MODEL_VISIBILITY.md](PHASE_5_1_PROVIDER_MODEL_VISIBILITY.md) | Agent cards now show full provider routing chain inline (e.g. `9router/cx · gpt-5.5`); 3 helpers + 13 unit cases |
| 5.2 | [PHASE_5_2_SHADOW_EVAL_PANEL.md](PHASE_5_2_SHADOW_EVAL_PANEL.md) | New "Evals" tab in agent detail modal — per-layer status, promotion readiness, recent failures, rubric description; 4 helpers + 15 unit cases |
| 5.3 | [PHASE_5_3_TELEGRAM_TOPIC_AWARE_LOGS.md](PHASE_5_3_TELEGRAM_TOPIC_AWARE_LOGS.md) | `tg:CHAT:TOPIC[:MSG]` token format + `sanitizeTelegramPayloadForLog` privacy-allow-list sanitizer + wire-in to `POST /api/sessions/[id]/control`; 26 + 5 = 31 unit cases pin the privacy invariant at the route boundary |
| 5.4 | [PHASE_5_4_VIETNAMESE_LOCALE.md](PHASE_5_4_VIETNAMESE_LOCALE.md) | `vi` (Tiếng Việt) added to next-intl; 7 high-impact groups translated; structure-pin test catches MISSING_MESSAGE regressions; **`messages/en.json` UNCHANGED** (upstreamability) |
| 5.5 | [PHASE_5_5_AVATAR_GALLERY.md](PHASE_5_5_AVATAR_GALLERY.md) | 12-persona gallery + picker + new "Avatar" detail-modal tab; storage at `agent.config.avatar.persona` (no schema migration); 17 unit cases |
| 5.6 | [PHASE_5_6_PROVIDER_TIER_BADGE.md](PHASE_5_6_PROVIDER_TIER_BADGE.md) | `free` (emerald) / `paid` (amber) inline badge on agent cards; "unknown" hidden to keep visual signal high; closes Phase 3.1 caveat C2 alongside PR #38 |

## Phase 6 — Release / readiness

| Phase | Audit doc | Summary |
| --- | --- | --- |
| 6.1 | [PHASE_6_1_DOCUMENTATION_PASS.md](PHASE_6_1_DOCUMENTATION_PASS.md) | Documentation pass — phase audit summary aggregator + minimal `README.md` pointer + scoped check that the summary stays in sync with the audit-doc set |
| 6.2 | [PHASE_6_2_UPSTREAM_PR_STRATEGY.md](PHASE_6_2_UPSTREAM_PR_STRATEGY.md) | Upstream/fork split strategy — every Phase 1–6.1 deliverable classified as upstream-ready / upstream-with-conversation / fork-only, with PR sequencing in 4 waves |
| 6.3 | [PHASE_6_3_FINAL_ACCEPTANCE.md](PHASE_6_3_FINAL_ACCEPTANCE.md) | Final acceptance pass — vitest 1256/1256, tsc clean, doctor + security scripts run to completion with results matching Phase 2.4 accepted-exception classification, browser smoke deferred to CI, residuals documented. **v0 acceptance gate: GREEN.** |

## Operational invariants pinned by the test suite

These are the cross-PR invariants the unit + integration test suite enforces, beyond the per-phase audits. A regression on any of these breaks CI before the panel/route can ship.

- **No CLI shell-out regression on migrated routes.** `umbrella-source-discipline.test.ts` (Phase 4.2) + `task-dispatch-source-discipline.test.ts` (Phase 1.3a / #608) + per-PR per-route discipline tests.
- **Container without `openclaw` CLI binary still serves migrated routes.** `container-no-cli-smoke.test.ts` (Phase 4.4) — `runOpenClaw` mocked to ENOENT, sessions/[id]/control still 200s.
- **`mc-device-token` is bearer-equivalent and lives in `sessionStorage`.** `device-token-storage-source-discipline.test.ts` + `device-identity-source-discipline.test.ts`.
- **Localhost gateway WS uses `ws://`, not `https://`.** `gateway-url.test.ts` (17 cases including the Phase 4.1 regression pins).
- **Locale message files share a top-level shape.** `locale-structure.test.ts` (Phase 5.4).
- **Privacy invariant on Telegram-derived activity-log payloads.** `telegram-topic.test.ts` + the route-level boundary assertion in `container-no-cli-smoke.test.ts` (Phase 5.3 wire-in case).

## Maintenance

When a new phase audit doc lands:

1. Add a row in the matching Phase X table above. Include the merge commit and a one-line summary.
2. If the audit doc closes a previously-deferred caveat (e.g. Phase 5.1 closing Phase 3.1 C2), call that out in the per-row "Summary" column.
3. The check in `src/lib/__tests__/audit-summary-index.test.ts` asserts every `docs/audit/PHASE_*.md` file is referenced from this aggregator. If you forget to link a new phase audit, that test will fail in CI.
