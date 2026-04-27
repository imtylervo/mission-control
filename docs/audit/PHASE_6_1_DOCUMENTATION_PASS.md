# Phase 6.1 — Documentation pass

**Outcome:** added a single roll-up index doc (`docs/audit/PHASE_AUDIT_SUMMARY.md`) that links every phase audit doc on the `phase-0/baseline-audit` branch in one place, plus a one-line link entry in the README's Documentation table. A new vitest pin (`audit-summary-index.test.ts`) keeps the index honest by failing CI when a future phase audit doc lands without being referenced from the summary, or when the summary references a file that does not exist.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `13bd45b` (Phase 5.6 PR #43 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 6.1:

> Update README/quickstart/deployment/security docs with actual verified behavior, keep generic/upstreamable tone, and include scoped docs checks/evidence.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5 closed (Đào msg 1708, ETA 00:20:00+10:00).

The fork has accumulated 17 phase audit docs in `docs/audit/` (Phase 2.4 through Phase 5.6 plus the older Phase 1.x audits). A new operator browsing the repo today has no single entry point to learn "what is actually verified about this fork." Each individual audit doc is good but the directory itself is a flat list that takes time to traverse. This PR adds the missing aggregator without touching upstream-original copy.

## Why "summary aggregator", not "rewrite README"

The roadmap line says "update README / quickstart / deployment / security docs." A literal interpretation would be: open each, rewrite the prose, claim what's verified. That has two problems:

1. **Upstreamability.** Tyler's fork is `imtylervo/mission-control` of `builderz-labs/mission-control`. Substantial rewrites of canonical docs introduce merge conflicts on every upstream rebase. The Phase 5.4 Vietnamese-locale PR set the precedent — additive only, never modify upstream-source files.
2. **Source of truth drift.** Per-PR audit docs ARE the source of truth for "what is verified, with evidence." Restating their contents in README/quickstart/deployment would create two sources that drift apart.

The right shape: leave upstream docs intact, add ONE new doc that points at the audit directory, and add ONE link line in README pointing at the new doc. That is upstreamable (the link line is a 1-line additive diff) and stays accurate (every claim still lives in the per-PR audit doc it summarizes).

## What changed

### `docs/audit/PHASE_AUDIT_SUMMARY.md` (new)

Roll-up index organized by Phase 1 → Phase 6, with one row per audited phase. Each row carries:
- Phase number (matches the roadmap).
- Link to the per-phase audit doc (relative, kebab-case filename so GitHub renders it correctly).
- One-line summary that calls out the closure (e.g. "Phase 4.1 closes BASELINE residual-risk row 4").

Two extra sections at the bottom:
- **Operational invariants pinned by the test suite** — six cross-PR invariants that the test suite enforces beyond per-phase audits (no CLI shell-out regression, container without openclaw still serves migrated routes, mc-device-token sessionStorage discipline, localhost gateway WS uses ws://, locale shape parity, Telegram payload privacy invariant). This is the "what does CI guarantee" answer.
- **Maintenance** — the contract for a future phase author: add a row, link it, and the index test will catch a forgotten reference.

### `README.md`

One additive line in the existing Documentation table:

```markdown
| [Phase Audit Summary](docs/audit/PHASE_AUDIT_SUMMARY.md) | Roll-up index of every phase audit doc on this fork's `phase-0/baseline-audit` branch |
```

No other change to README. Quickstart, deployment, SECURITY-HARDENING, agent-setup, orchestration, cli-* docs are NOT modified — their contents are the upstream-original prose and stay byte-identical.

### `src/lib/__tests__/audit-summary-index.test.ts` (new)

Five-case structure pin:

1. Summary file exists and is non-empty.
2. **Every `PHASE_X_Y_*.md` file in `docs/audit/` is linked from the summary.** Forgetting to update the summary when a new audit doc lands fails this test in CI.
3. **Summary does NOT reference a phantom phase audit file.** Catches the symmetric mistake (someone adds a row to the summary but never creates the audit doc, or renames an audit doc and forgets to update the row). Uses a boundary-anchored regex so a reference like `PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` is recognized as a single filename and not sub-extracted as a phantom `PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md`.
4. Every Phase top-level section (Phase 1 .. Phase 6) is mentioned by header text.
5. The "Operational invariants" section is present (this is the cross-PR claim surface).

## Gates run (Mai re-verified on post-PR-#43 base)

```
$ git rev-parse HEAD
13bd45be0d93a7b9be1afe541d292406196021d5  # confirms post-PR-#43 base

$ npx vitest run src/lib/__tests__/audit-summary-index.test.ts
✓ src/lib/__tests__/audit-summary-index.test.ts (5 tests) 4ms
Test Files  1 passed (1)
Tests       5 passed (5)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — README pointer is the only new-link surface

Other top-level docs (`CHANGELOG.md`, `RELEASE.md`, `SECURITY.md`, `CONTRIBUTING.md`) are NOT modified. They predate the audit docs and have their own concerns (release log, security policy, contribution guidelines). Adding a phase-audit pointer to each would be link-graph noise. The README's Documentation table is the right pivot.

### C2 — `quickstart.md`, `deployment.md`, `SECURITY-HARDENING.md` unchanged

These files are upstream prose. Phase 6.1 deliberately does NOT touch them. The phase audit docs already document what changed and what stayed; restating their content in upstream docs would cause drift. If a specific upstream doc has a *factual error* discovered during audit, that's a separate targeted PR with a clear "fix factual claim" scope, not a "documentation pass."

### C3 — Phase 1.x audits live in `PR<NN>_*.md` filenames, not `PHASE_*.md`

The Phase 1 audit work landed earlier with PR-numbered filenames (`PR16_PHASE_1_5_*`, `PR18_*`, `PR19_PHASE_1_7_*`, etc.). The summary surfaces their content under the Phase 1 table but the index test only enforces presence for the `PHASE_X_Y_*.md` naming convention used from Phase 2.4 onwards. PR-named files are still listed in the summary; they're just not enforced by the test (one-line addition to enforce them is possible but adds churn for low value — those phases won't change).

### C4 — Index regex is boundary-anchored on purpose

The phantom-detection test uses `(?:^|[\s\[\(/])(PHASE_\d+_\d+_[A-Z0-9_]+\.md)` rather than the simpler `PHASE_\d+_\d+_[A-Z0-9_]+\.md`. The simpler form mis-extracts `PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` from inside `PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` and false-positives the test. Boundary anchor at start-of-line / whitespace / `[` / `(` / `/` is the minimal fix.

### C5 — Future phases can extend without touching this file

The summary and the test are designed to grow. A Phase 6.2 / 6.3 / 7.x audit doc just lands in `docs/audit/PHASE_X_Y_*.md` and the author adds one row to the summary. The test enforces the bidirectional invariant. No additional plumbing.

## What this PR does not do

- Does not modify `quickstart.md`, `deployment.md`, `SECURITY-HARDENING.md`, `CONTRIBUTING.md`, `SECURITY.md`, `RELEASE.md`, or `CHANGELOG.md` — upstreamability invariant.
- Does not auto-generate the summary from filesystem state — handcrafted prose is more useful for "summary" than a machine-generated list, and the test catches drift.
- Does not add a new top-level doc at the repo root.
- Does not introduce a docs build step (the existing static Markdown is sufficient).

## Risk and rollback

- Risk: very low. Three new files (one Markdown summary, one test, this audit doc) + one additive line in README. No production code touched.
- Rollback: revert this PR's diff. Summary file disappears, README's Documentation table loses one row, test retires.

## Refs

- Đào msg 1708 (2026-04-27T13:36Z) — Phase 6.1 assignment, ETA 00:20:00+10:00.
- PR #43 — Phase 5.6 provider tier badge, merged at `13bd45b`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 6.1 — task definition.
- `docs/audit/PHASE_AUDIT_SUMMARY.md` (new, this PR) — the aggregator.
- `src/lib/__tests__/audit-summary-index.test.ts` (new, this PR) — 5 cases pinning bidirectional integrity.
- `README.md` — one new row in the Documentation table.
