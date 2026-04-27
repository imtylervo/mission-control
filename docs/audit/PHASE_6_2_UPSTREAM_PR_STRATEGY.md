# Phase 6.2 — Upstream PR strategy

**Outcome:** strategy doc that classifies every merged phase deliverable on `phase-0/baseline-audit` (Phase 1.x → Phase 6.1) into one of three buckets — **upstream-ready**, **upstream-with-conversation**, or **fork-only** — and recommends PR grouping for upstream contributions back to `builderz-labs/mission-control`. The goal is to land the generic improvements upstream without exporting Tyler-specific opinions, and to keep the fork's Tyler-specific UX intact locally.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `1b7486d` (Phase 6.1 PR #44 merged).

## Why this doc exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 6.2:

> Produce an upstream/fork split strategy doc from the merged audit history — which changes are generic upstream-friendly vs Tyler-specific fork-only, with rationale and suggested PR grouping.

Đào (LEAD) assigned this to Mai (CODER) after Phase 6.1 closed (Đào msg 1710, ETA 00:15:00+10:00).

The fork has accumulated 22 merged PRs across Phases 1–6.1. Some are obviously generic upstream wins (a real bug fix in `gateway-url.ts`); others are obviously fork-only (a Vietnamese locale aimed at Tyler); a third bucket needs a low-cost conversation with the upstream maintainer first. This doc classifies each PR upfront so the upstream contribution sequencing is deliberate, not ad-hoc.

## Classification framework

A PR is **upstream-ready** when ALL of the following hold:

1. The change fixes a real defect or adds a generic capability that any deployment of `mission-control` benefits from.
2. The change is small enough that an upstream reviewer can read it in one sitting without context.
3. The change does NOT depend on Tyler-specific tooling, Vietnamese copy, persona names, or `9router/cx`-flavoured routing.
4. The audit doc on the fork stays useful as the PR description (no rewrite needed for upstream).

A PR is **upstream-with-conversation** when the change is generically useful but the upstream maintainer's design preference is unknown — opening cold would risk a "we'd rather not" review. These should land upstream after a quick GitHub Discussion or short issue clarifying intent.

A PR is **fork-only** when the change is genuinely Tyler-specific (locale, persona names, model id substring choices) or pre-existing-merge specific (some Phase 1.x audits land changes that the upstream branch already has under different names). These stay on `phase-0/baseline-audit` indefinitely.

## Per-phase classification

### Phase 2 — Runtime reliability and environment hardening

| Phase | PR(s) | Bucket | Rationale |
| --- | --- | --- | --- |
| 2.1 | #23 | **Upstream-ready** | Real security bug fix: admin password reset must invalidate target sessions; `DELETE /api/auth/users` accepting both query string and JSON body fixes a real UI/API mismatch. Generic. Tests + audit doc reusable upstream. |
| 2.2 | #24, #25 | **Upstream-ready** | Localhost ↔ 127.0.0.1 mismatch is a real deployment-class bug any operator hits. Diagnostic route + `registerMcAsDashboard` dual-origin fix are both generic. Privacy invariant (no raw allowlist values in response) is good upstream policy. |
| 2.3 | #26 | **Upstream-ready** | Dev-server runbook is generically useful. Doc-only diff, low merge-conflict surface. |
| 2.4 | #27 | **Upstream-ready** | Four real bash bugs in upstream-original `scripts/station-doctor.sh` + `scripts/security-audit.sh` (`set -e` + `((PASS++))` abort, `http_code` "000000" concat, `--env-file` flag never parsed, `stat -f`/`-c` order on Linux). Audit doc lists 7 accepted exceptions cleanly. **Highest-priority upstream PR** because the bugs prevent the scripts from even running to completion. |

### Phase 3 — Core product surface stabilization

| Phase | PR(s) | Bucket | Rationale |
| --- | --- | --- | --- |
| 3.1 | #29 | **Fork-only** (audit doc) | The audit content is useful but documents Tyler's specific install. Upstream's CI already has its own panel coverage; an audit doc dropped onto the upstream branch wouldn't be re-run. |
| 3.2 | #30 | **Fork-only** (audit doc) | Same as 3.1 — useful internally for the fork's history, not generically actionable upstream. |
| 3.3 | #31 | **Upstream-with-conversation** | The "no CLI shell-out regression" check + the existing `task-dispatch-source-discipline.test.ts` are generically useful. Upstream maintainer may want it bundled with PR #35 umbrella. Open issue first to gauge appetite. |
| 3.4 | #32 | **Fork-only** (audit doc) | Snapshot-style audit; not a code change. |
| 3.5 | #33 | **Fork-only** (audit doc) | Snapshot-style audit; privacy invariant is well-stated but not actionable upstream. |

### Phase 4 — Test/CI confidence

| Phase | PR(s) | Bucket | Rationale |
| --- | --- | --- | --- |
| 4.1 | #34 | **Upstream-ready** | The `gateway-url.ts` localhost protocol downgrade is a real bug — the test that was failing on `phase-0/baseline-audit` is upstream's own test. Fix the test (which was already correct) by making the source match. **Highest-confidence upstream PR**: the test was written by upstream, and the fix makes it pass. |
| 4.2 | #35 | **Upstream-with-conversation** | Umbrella source-discipline test is generically useful but introduces a new test convention. Upstream may already have an equivalent (or want a different shape — e.g. ESLint custom rule). Discuss before opening. |
| 4.3 | #36 | **Upstream-ready** | New `tests/dashboard-smoke.spec.ts` is a small Playwright spec following the existing 60+ spec convention. Adds a fast happy-path gate everyone benefits from. Zero src/ changes. |
| 4.4 | #37 | **Upstream-ready** | Container-no-cli runtime smoke directly addresses upstream's own #608. Mock-based, vitest-only. Two test cases. Pure value-add. |

### Phase 5 — Tyler-stack features

| Phase | PR(s) | Bucket | Rationale |
| --- | --- | --- | --- |
| 5.1 | #38 | **Upstream-ready** | Provider routing chain visibility (`9router/cx · gpt-5.5`) is generic; the helpers handle ANY `provider/route/model` path, not just 9router. Tyler-specific only in the example values used in tests, easy to swap. UI change is small + opt-in (no breaking change for existing en-locale users). |
| 5.2 | #39 | **Upstream-ready** | Eval-summary helpers + Evals tab are generic. The engine in `agent-evals.ts` already exists upstream; PR #39 just adds the UI consumer adapter. |
| 5.3 | #40 | **Upstream-with-conversation** | Telegram-topic-aware logs is generically useful for any operator using Telegram, BUT the `tg:CHAT:TOPIC[:MSG]` token format is a fork-author opinion. Upstream might prefer a structured-JSON `telegram_context` field on the activity-log row, or a different namespace prefix. Discuss before opening. |
| 5.4 | #41 | **Fork-only** | Vietnamese locale is by definition Tyler-specific. The 7 translated groups are Tyler-vocabulary register ("Nhân viên" not "Tác nhân"). Upstream may add `vi` themselves later via a community contribution; this fork's translations are not the canonical ones. |
| 5.5 | #42 | **Upstream-with-conversation** | The 12-persona gallery is generically useful (any operator with multiple agents wants visual distinctiveness), BUT the curated list includes `mai`/`dao` (named after this fork's specific agents). Strip those two entries + open upstream as a 10-persona generic gallery. |
| 5.6 | #43 | **Upstream-ready** | Provider tier badge (`free`/`paid`/hidden-`unknown`) is generic — the 6 free + 14 paid provider lists cover the cloud landscape, NOT Tyler-specific. The "9router → unknown" rule is also generic ("router prefix → unknown until operator config resolves it"). |

### Phase 6 — Release / readiness

| Phase | PR(s) | Bucket | Rationale |
| --- | --- | --- | --- |
| 6.1 | #44 | **Fork-only** | Phase audit summary aggregator references `docs/audit/` files specific to the fork's audit work. Useful internally, not actionable upstream. |
| 6.2 | (this doc) | **Fork-only** | This very strategy doc is by definition fork-internal. It's the planning artifact for what TO send upstream, not something to send upstream itself. |

## Recommended upstream PR sequencing

Open these against `builderz-labs/mission-control:main` in this order:

### Wave 1 — High-confidence bug fixes (open immediately, near-zero review risk)

1. **PR-A: Phase 4.1 gateway-url localhost fix.** One file + one test addition. Fixes upstream's own failing test. Small, surgical, low-risk. Likely accepted same-day.
2. **PR-B: Phase 2.4 doctor + security-audit script bash bugs.** Two scripts, four orthogonal bugs (`set -e` + `((COUNTER++))` abort, http_code "000000" concat, `--env-file` flag never parsed, `stat -f`/`-c` order on Linux). Each could be its own PR but they cluster in the same audit doc; bundling reduces upstream review overhead.
3. **PR-C: Phase 2.1 admin auth/env hardening.** Session invalidation + DELETE flexibility. Real security improvement.

### Wave 2 — Mid-risk additive features (open after Wave 1 lands; low rebase risk)

4. **PR-D: Phase 2.2 gateway origin diagnostic + dual-origin fix.** Two PRs upstream-side (or one with both, if maintainer prefers). Covers the deployment-class bug.
5. **PR-E: Phase 4.3 dashboard happy-path Playwright smoke.** Single new spec.
6. **PR-F: Phase 4.4 container-no-cli runtime smoke.** Two vitest cases addressing #608.
7. **PR-G: Phase 2.3 dev-server runbook doc.** Doc-only.

### Wave 3 — Discuss-then-open (issue first, gauge appetite)

8. **Issue: Source-discipline umbrella test convention.** Phase 4.2 (PR #35) — describe the umbrella vs ESLint-custom-rule trade-off.
9. **Issue: Telegram-topic-aware activity logs.** Phase 5.3 (PR #40) — describe the `tg:` token format vs structured `telegram_context` field.
10. **PR-H (after issue resolves): Phase 3.3 task-panel source-discipline tests.** May be combined with PR #35's umbrella depending on maintainer preference.

### Wave 4 — Generic UX additions (lower priority, larger surface)

11. **PR-I: Phase 5.1 provider routing chain visibility.** Helpers + agent panel render extension. Generic.
12. **PR-J: Phase 5.2 eval-summary helpers + Evals tab.** Helpers + new tab.
13. **PR-K: Phase 5.6 provider tier badge.** Helpers + small badge.
14. **PR-L (with edits): Phase 5.5 avatar gallery.** Strip `mai`/`dao` persona entries before opening upstream; the remaining 10 personas are generic.

### Stays on fork forever

- Phase 5.4 Vietnamese locale (PR #41) — Tyler-specific.
- All audit-doc-only PRs in Phase 3.x (#29, #30, #32, #33).
- Phase 6.1 / 6.2 docs (this strategy + the summary aggregator).

## What to drop / rewrite for upstream

When porting a Wave 1–4 PR upstream, the following stripping is required:

- **All `docs/audit/PHASE_*.md` references** in commit messages and PR bodies — those files don't exist upstream. Replace with a short scope summary.
- **All `Đào msg ####`** references — upstream maintainers don't know who Đào is. Replace with "as discussed in fork audit at <commit>" if the discussion was a real design constraint, otherwise just remove.
- **All `Tyler msg ####`** references — same reason.
- **`9router`-flavoured test fixtures** — replace `9router/cx/gpt-5.5` with a more representative `myrouter/route1/gpt-4o` so the example reads as generic.
- **`mai`/`dao` persona entries** in Phase 5.5 — strip; document upstream as a 10-persona gallery with operator-extensible API.

Per-PR audit doc structure (Why / What changed / Gates run / Findings / Risk and rollback) maps cleanly onto a GitHub PR body — keep that structure for upstream PRs to make review fast.

## Risk and contingency

- **Rebase conflicts on the fork** if upstream accepts a Wave 1–2 PR while we still have the original on `phase-0/baseline-audit`. Mitigation: accept the upstream version; revert our local commit; resolve via fast-forward.
- **Upstream maintainer rejects a Wave 3 PR after the issue conversation.** Mitigation: keep the local version on the fork; document the "deferred indefinitely" status in the per-PR audit doc.
- **Upstream merges an alternative implementation of the same idea** (e.g. they ship Vietnamese locale via a community contribution before Tyler's translations land). Mitigation: rebase against their version; merge tools on the conflicting messages JSON.

## What this PR does not do

- Does not actually open any upstream PRs.
- Does not modify upstream-bound code.
- Does not create a tracking issue on the fork (deferred until a Wave 1 PR is actually drafted upstream).
- Does not auto-generate the strategy from filesystem state — strategy is a human-judgement artifact, not a query result.

## Risk and rollback

- Risk: zero. Single new doc, no code, no test.
- Rollback: delete the file.

## Refs

- Đào msg 1710 (2026-04-27T13:43Z) — Phase 6.2 assignment, ETA 00:15:00+10:00.
- PR #44 — Phase 6.1 audit summary aggregator, merged at `1b7486d`.
- `docs/audit/PHASE_AUDIT_SUMMARY.md` — the summary this strategy reads from.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 6.2 — task definition.
- builderz-labs/mission-control — the upstream target.
