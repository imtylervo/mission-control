# Phase 1.1 — Hydration nonce mismatch verification harness

**Status:** harness ready, **PENDING dashboard auth** before final close. See "How to run" below; once `/tmp/mc-admin-pass.rotated` (or an equivalent credential) is available again, the harness produces the evidence needed to mark Phase 1.1 ✅ complete or to escalate to Option D.

**Snapshot date:** 2026-04-27 (HEAD of `phase-2/pr17-1-1-hydration-verification`, branched from `phase-0/baseline-audit`).

## Why this PR exists

PR #15 (Option A — `suppressHydrationWarning` on the inline bootstrap `<script>` in `src/app/layout.tsx`) closed the SSR-side fix per Đào msg 1344. PR #15 also explicitly noted in its test plan that the **dashboard `/` route was not directly reproduced**, because that route requires admin authentication and the time-boxed window did not include credential plumbing.

This PR adds a reproducible Chromium harness that exercises the dashboard route once a credential is available, mirroring the PR #16 instrumentation pattern.

The harness is checked in **without running it** because the temporary admin credential file (`/tmp/mc-admin-pass.rotated`, used by PR #16) was rotated/cleaned afterwards and is no longer present on the box. Re-running once the credential is back in place will produce the JSON evidence document for the close-out comment.

## What changed

- New: `docs/audit/scripts/pr17-mc-1-1-hydration-verification.js` — Chromium + Playwright `addInitScript` pre-page wrapper. Captures every `console.warn` / `console.error` event on the dashboard route and tags hydration-mismatch banners (`hydrated`, `did not match`, `Hydration failed`, `server rendered HTML didn't match`). Records also the meta CSP header (if any) and the per-script `nonce` length, never the value.
- New: this audit doc.
- Roadmap update only — `docs/audit/MISSION_CONTROL_ROADMAP.md` row 1.1 gains a "PENDING dashboard auth" status tag so the next reviewer can see at a glance that the close-out evidence is one command away rather than an open question. `docs/audit/MISSION_CONTROL_BASELINE.md` is intentionally NOT touched in this PR; the baseline reclassification waits for the harness verdict in the close-out commit.

**No `src/` code is modified.**

## How to run (Step 2 — when credential is available)

1. Start the dev server in another terminal: `pnpm dev` (binds `127.0.0.1:3000`).
2. Provide a credential. The harness tries the env vars in order:
   - `MC_STORAGE_STATE_FILE=/path/to/playwright-storage.json` — preferred if a prior session is captured (`storageState` Playwright API). No password material is read.
   - `MC_ADMIN_PASS=...` — env var. Reachable via `/proc/<pid>/environ` to other local processes; use only on a single-user box.
   - `MC_ADMIN_PASS_FILE=/path/to/passfile` — path to a file containing the admin password. Default `/tmp/mc-admin-pass.rotated` (PR #16 path) is auto-detected if present.
3. Run from the repo root:
   ```bash
   NODE_PATH=$(pwd)/node_modules node docs/audit/scripts/pr17-mc-1-1-hydration-verification.js
   ```
4. The output is a single JSON document. Copy the `hydration_event_count`, `hydration_event_samples`, and `verdict` fields into the close-out comment. Do **not** paste the script's stderr verbatim if a login flow ran — it does not log the password, but the truncated error messages may include URL fragments.

The harness exits with code `0` for `NO_HYDRATION_WARNING`, `2` for `WARNING_RECURS` (still a successful run, just a different verdict), and `1` for any harness/auth failure.

## What the harness records (and what it deliberately does not)

Records:

- `console.warn` / `console.error` event count + truncated message text. The `safeArg` serializer caps every string at 500 chars and serializes Error objects to `{ name, message }` only.
- For each event: a `isHydration` boolean derived from a four-substring match against the React hydration banners.
- Per-`<script nonce="">` tag on the dashboard: tag name, nonce string **length** (not value), and a `hasContent` boolean. This proves the bootstrap script is rendering with a populated nonce post-fix without leaking the nonce value.
- The meta CSP header `content` length (when present).

Does not record:

- The admin password (file mode reads then stays in memory; env mode is opaque to the harness).
- Any cookie / session / token value — the harness never reads `document.cookie` or storage values.
- Public/private key material — there is no crypto path in this harness.

## Expected outcomes

- **`hydration_event_count === 0` on the dashboard route** → Phase 1.1 closes ✅. Mark roadmap row `1.1` complete via PR #15 + verified via PR #17.
- **`hydration_event_count > 0`** → Option A alone is insufficient on the dashboard. Escalate to Đào for the Option D decision (Next.js `16.1.6 → 16.2.4` bump from PR #15's deferred list, or accept-as-dev-only with explicit doc).

## Pending items for the close-out commit

These are deliberately not done in this PR — they require either credential restoration or a maintainer decision:

- [ ] Run the harness once credentials are available.
- [ ] Append the evidence JSON to this doc under a new "Result" section.
- [ ] If `verdict === NO_HYDRATION_WARNING`: edit `docs/audit/MISSION_CONTROL_ROADMAP.md` row 1.1 to `✅ complete via PR #15 + verified via PR #17`, and the "Immediate next task" list to strike-through Phase 1.1.
- [ ] If `verdict === WARNING_RECURS`: open a sibling issue/PR for the Option D path or the documented-dev-only-limitation path, per Đào's call.

## Risk and rollback

- Risk: low. No `src/` code is modified. The harness writes nothing to disk except its stdout JSON; it does not touch the palace, the database, or any production-facing path.
- Rollback: revert the merge commit. The harness file is a leaf — nothing imports it.
