# Phase 2.4 — Doctor / security warning cleanup

**Outcome:** the two diagnostic shell scripts (`scripts/station-doctor.sh` and `scripts/security-audit.sh`) now run end-to-end on Linux without aborting partway through, and the remaining warnings/failures they report are classified as either **fixed in scope** or **accepted exceptions** with rationale below.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` after PR #26 merge (`4c635bf`).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 2.4 ("Doctor/security warning cleanup"), the task was: re-run doctor/security scan after password rotation, clear avoidable warnings or document accepted ones, target a clean status or accepted-exception baseline. Initial run discovered the scripts themselves were the loudest warning — they aborted on the first PASS due to a `set -e` + bash post-increment-of-zero gotcha, masking ~80% of their own output. Fix the scripts first, then triage what they actually report.

## Bugs fixed in this PR

### B1 — `set -euo pipefail` + `((COUNTER++))` aborts on first PASS

Both scripts opened with `set -euo pipefail` and incremented counters via `((PASS++))` / `((SCORE++))` etc. The `((expr))` form returns the value of `expr` as its exit code, and post-increment yields the **pre-increment** value. With counters starting at 0, the first `((PASS++))` returns 0 → errexit fires → script terminates after a single line of output.

Symptom (before fix):

```
$ bash scripts/station-doctor.sh
=== Mission Control Station Doctor ===
--- Service Status ---
  [PASS] Mission Control process is running
$ echo $?
1
```

Fix: replaced `((COUNTER++))` with `COUNTER=$((COUNTER+1))` (assignment-form, always exits 0) and downgraded `set -euo pipefail` → `set -uo pipefail`. These are diagnostic scripts whose entire job is to keep walking past failed checks; errexit is the wrong default for them. Comment in code explains the gotcha so a future contributor doesn't reintroduce it.

### B2 — `http_code` collection prints "000000" on connection failure

`station-doctor.sh:70` had:

```bash
http_code=$(curl -sf -o /dev/null -w "%{http_code}" "..." 2>/dev/null || echo "000")
```

With `-f`, curl on a connection failure exits non-zero **AND** still prints `"000"` via `-w`. The OR fallback then appended another `"000"`, producing `"000000"`. The downstream check `if [[ "$http_code" == "000" ]]` never matched, so a connection failure was misreported as `[WARN] Health API returned HTTP 000000` instead of `[FAIL] Health API not reachable`.

Fix: drop `-f` (so curl exits cleanly even on HTTP 4xx, which is what we want — we'll classify status codes ourselves), capture in a single subshell, and use `|| http_code="000"` only when the curl process itself crashes.

### B3 — `--env-file` flag silently ignored

`security-audit.sh` advertised `Run: bash scripts/security-audit.sh [--env-file .env]` in its header but its arg parser was a single line `ENV_FILE="${1:-.env}"`. Passing `--env-file .env.local` set `ENV_FILE="--env-file"` and the rest of the script then warned that `--env-file` was not a file.

Fix: proper arg loop accepting either `--env-file PATH` (matches the documented form) or a single positional path (preserves backward compatibility with anyone calling `bash scripts/security-audit.sh .env.local`).

### B4 — `stat -f` on Linux GNU stat leaks a filesystem dump into the failure message

`security-audit.sh:50` had:

```bash
perms=$(stat -f '%A' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE" 2>/dev/null)
```

`stat -f` means "BSD format" on macOS but means "filesystem stat" on Linux GNU stat. On Linux it emits a multi-line `File: ".env.local"\n    ID: ... Type: ext2/ext3 ...\n    Block size: 4096 ...` dump to stdout AND exits zero, so the OR fallback never fires and `$perms` becomes that whole dump. The downstream FAIL line then included the dump verbatim, e.g.:

```
[FAIL] .env permissions are   File: ".env.test"
    ID: 1fced5b57f6d3f28 Namelen: 255     Type: ext2/ext3
Block size: 4096       Fundamental block size: 4096
...
```

Fix: try GNU `stat -c '%a'` first (since this repo is overwhelmingly run on Linux and Docker), BSD `stat -f '%A'` as fallback.

## Re-run results after fixes

`bash scripts/station-doctor.sh` (against this dev workstation, MC dev server stopped at the time of run):

```
=== Results: 6 passed, 1 warnings, 2 failures (of 9 checks) ===
```

`bash scripts/security-audit.sh` (no env file → first-run-seed mode per PR #23 contract):

```
=== Security Score: 2 / 8 ===
```

`bash scripts/security-audit.sh --env-file .env.test` (intentional dangerous settings used by the test suite):

```
=== Security Score: 2 / 8 ===
```

Both scripts now reach the summary line and report exit codes consistent with their findings. The script-level B1–B4 defects are gone.

## Accepted exceptions

The remaining warnings/failures are **expected** for Tyler's local dev workflow and will not be fixed in this PR. Each is documented here with rationale so a future operator (or future agent) does not chase them.

### E1 — doctor: `[FAIL] Port 3000 is not responding` and `[FAIL] Health API not reachable`

**Status:** accepted when MC dev server is intentionally stopped.

Tyler runs MC manually (`pnpm dev`) when working on it; otherwise it stays off so it does not compete with `9router` / Camofox / OpenClaw gateway on the same workstation. The doctor's network checks correctly report this. Re-running the doctor after `pnpm dev` is up flips both to PASS. Severity is appropriate: when the operator expects MC to be up and it isn't, FAIL is the right signal.

If we wanted a "diagnostic without expecting MC up" mode, the right shape would be a `--offline-ok` flag that downgrades these two FAILs to INFO. Out of scope here.

### E2 — doctor: `[WARN] No backup directory at <root>/.data/backups`

**Status:** accepted on first-run / pre-backup workstations.

The backup directory is created on first scheduled backup, not on install. This dev workstation has never run a backup. The WARN is harmless and would clear itself the moment a backup runs. Operators who want a permanent green tick can `mkdir -p .data/backups`; Mission Control does not require this directory to be present.

### E3 — security: `[FAIL] AUTH_PASS is not set`

**Status:** accepted when the SQLite admin user has already been seeded.

Per the auth env-loading contract documented in PR #23 (`docs/audit/PR23_AUTH_SESSION_INVALIDATION.md`):

> `AUTH_PASS_B64` and `AUTH_PASS` are first-run seeds for the SQLite admin user only; editing `.env` / `.env.local` after first run does **not** rotate any existing user's password. Rotation now flows through `/api/auth/me` (self-change) or `PUT /api/auth/users` (admin reset).

Once the admin user exists in `users` SQLite table, the env value is no longer consulted. `security-audit.sh` does not have a SQLite-aware downgrade path. Documented as accepted; not changing the script's classification logic in this PR (would require it to read the SQLite DB, which adds runtime + permission scope).

### E4 — security: `[FAIL] API_KEY is not set or uses the default value`

**Status:** accepted for local dev without external HTTP API consumers.

`API_KEY` is consumed in two places:

- `src/lib/security-scan.ts:176-181` — only flips a security-scan field; not load-bearing for any user-visible flow.
- `src/lib/framework-templates.ts` — appears as `YOUR_API_KEY` placeholder text in the framework templates (Curl/Python/Node) shown to the operator on the dashboard. The operator copies the template, replaces the placeholder with whatever API key they've provisioned externally. Internal MC code does not validate `process.env.API_KEY` against incoming requests — that is `MC_API_KEY` / cookie-based auth.

So an unset `API_KEY` simply means "no external HTTP API consumers configured", which is the default state on a fresh install. Production deploys exposing the MC HTTP API to other services should set this; local dev does not.

### E5 — security: `[WARN] MC_ALLOWED_HOSTS is not set (defaults apply)`

**Status:** accepted for local dev.

Defaults cover the localhost / 127.0.0.1 / configured MC origins (the same set Phase 2.2 PR #25 made dual-form). Production deploys with a real public hostname should set this explicitly; local dev is fine on defaults.

### E6 — security: `[WARN] MC_COOKIE_SECURE is not enabled`

**Status:** accepted for local dev (HTTP).

Setting `MC_COOKIE_SECURE=1` makes browsers refuse to send the session cookie over plain HTTP, breaking local dev. Production HTTPS deploys must set this; local dev correctly leaves it off. The script's WARN message already reads "(cookies sent over HTTP)", which is the diagnostic, not a defect.

### E7 — security: `[WARN] HSTS is not enabled`

**Status:** accepted for local dev (HTTP).

Same reasoning as E6. The script's WARN already reads "(set `MC_ENABLE_HSTS=1` for HTTPS deployments)", which is the right operator hint.

## Why this PR does not "downgrade" the FAILs to WARNs in the scripts

The scripts' severity classifications are **correct** for their target audience: an operator preparing a production deploy, who needs a checklist of "what would block prod". Downgrading FAIL → WARN here would silently weaken the prod-deploy gate. The right mechanism is per-deploy waiver flags (e.g. `--ignore=AUTH_PASS,API_KEY`) or env-aware downgrades (e.g. read SQLite to know the admin user is seeded), both of which are larger scope than Phase 2.4 should carry. Captured as a follow-up rather than landed here.

## Gates

- `bash scripts/station-doctor.sh` runs to completion, exits non-zero only when there are real failures (currently 2, both classified as E1).
- `bash scripts/security-audit.sh` runs to completion, prints summary line.
- `bash scripts/security-audit.sh --env-file .env.test` parses the flag correctly (post-B3 fix).
- `npx tsc --noEmit` clean (no TS files touched in this PR).
- No vitest changes (shell-only diff).

The pre-existing `gateway-url.test.ts` failure on `phase-0/baseline-audit` (residual-risk row 4 in `BASELINE.md`) is unrelated and **not** introduced by this PR.

## What this PR does not do

- Does not change the scripts' classification thresholds (FAIL/WARN/PASS lines stay where they were — only the bash-mechanics bugs are fixed).
- Does not add SQLite-aware downgrade for AUTH_PASS / API_KEY.
- Does not add an `--offline-ok` flag to the doctor.
- Does not create `.data/backups/` automatically.
- No source code in `src/` is touched. No vitest changes. No DB migration.

## Risk and rollback

- Risk: very low. Three shell files modified (`station-doctor.sh`, `security-audit.sh`, plus this audit doc). Behavior change is strictly "scripts now finish what they started"; semantics of each individual check are unchanged.
- Rollback: revert this PR's diff. The scripts return to their pre-PR state (i.e. they once again abort on first PASS). No data, schema, or downstream consumer to undo.
- Operational note: any cron/CI that piped these scripts and treated exit 1 as "stale doctor / unfit for prod" should re-validate, since the scripts now reach the summary line and may exit with a different status that more accurately reflects the underlying state.

## Refs

- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 2.4 — task definition.
- `docs/audit/PR23_AUTH_SESSION_INVALIDATION.md` — first-run seed contract (E3 rationale).
- `docs/audit/PR25_REGISTER_MC_DUAL_ORIGIN.md` — dual-origin allowlist (E5 rationale).
- `scripts/station-doctor.sh` — modified (B1, B2 fixes + comment).
- `scripts/security-audit.sh` — modified (B1, B3, B4 fixes + comment).
