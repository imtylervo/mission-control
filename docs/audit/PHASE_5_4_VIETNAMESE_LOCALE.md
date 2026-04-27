# Phase 5.4 — Vietnamese locale / Tyler-friendly copy

**Outcome:** added `vi` (Tiếng Việt) as a supported locale. `messages/vi.json` is a structural copy of `messages/en.json` with the highest-impact Tyler-facing groups translated to Vietnamese (`common`, `nav`, `auth`, `header`, `settings`, `channels`, `notifications`). Lower-traffic surfaces fall through to English copy until a future translation pass; the structure-pin test catches any namespace divergence before next-intl throws `MISSING_MESSAGE` at request time.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `f97ad05` (Phase 5.3 PR #40 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.4:

> Add Vietnamese-friendly labels/copy for Tyler's daily use without breaking upstreamability.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5.3 closed (Đào msg 1701, ETA 23:45:00+10:00).

The repo already supports 10 locales (`en`, `zh`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`) via `next-intl`. Tyler is Vietnamese-Australian, primary user, native Vietnamese — yet `vi` was not in the list. Adding it is the lightest-touch way to localize without forking upstream copy.

## What changed

### `src/i18n/config.ts`

- Added `'vi'` to the `locales` tuple as the second entry (after `'en'`).
- Added `vi: 'Tiếng Việt'` to `localeNames`.

The position doesn't matter to next-intl, but placing `vi` next to `en` makes Tyler's locale visually adjacent in the language switcher.

### `messages/vi.json` (new)

Created by copying `messages/en.json` byte-for-byte then overriding the most-seen leaf strings in seven Tyler-facing groups:

- **`common`** — 28 action labels (Save → Lưu, Cancel → Huỷ, Loading → Đang tải, Error → Lỗi, Search → Tìm kiếm, Confirm → Xác nhận, Delete → Xoá, Edit → Sửa, Close → Đóng, Back → Quay lại, …).
- **`nav`** — top navigation items (Agents → Nhân viên, Sessions → Phiên, Tasks → Việc, Memory → Bộ nhớ, Logs → Nhật ký, Settings → Cài đặt, Channels → Kênh, Gateway → Cổng, Nodes → Node, Evals → Đánh giá, …).
- **`auth`** — login surface (Login → Đăng nhập, Username → Tên đăng nhập, Password → Mật khẩu, Sign in → Đăng nhập, Sign out → Đăng xuất, Remember me → Ghi nhớ, Forgot password → Quên mật khẩu, …).
- **`header`** — title + subtitle.
- **`settings`** — settings panel labels (Settings → Cài đặt, Language → Ngôn ngữ, Theme → Giao diện, Notifications → Thông báo, General → Chung, Account → Tài khoản, Privacy → Quyền riêng tư).
- **`channels`** — operator-facing channel labels (Channels → Kênh, Connected → Đã kết nối, Disconnected → Đã ngắt, Configure → Cấu hình).
- **`notifications`** — notification labels (Notifications → Thông báo, No notifications → Không có thông báo, Mark all as read → Đánh dấu đã đọc tất cả, Unread → Chưa đọc, Read → Đã đọc).

Every other group in `vi.json` is byte-identical to `en.json`. Tyler will see Vietnamese in the surfaces he actually uses daily and English in deeper panels (Office, Webhooks, Audit Trail, etc.) until a future translation pass.

The `ensure_ascii=False` flag was passed to `json.dumps` so Vietnamese diacritics (`ư`, `ơ`, `ấ`, `ệ`, etc.) are preserved as actual UTF-8 instead of `\uXXXX` escape sequences. This keeps `git diff` readable for any future translator and matches the existing `zh.json` / `ja.json` / `ko.json` precedent of using native script directly.

### `src/i18n/__tests__/locale-structure.test.ts` (new)

Five test cases pinning the Phase 5.4 contract:

1. Every locale in `src/i18n/config.ts:locales` has a `messages/<code>.json` file that loads as valid JSON with at least one top-level key.
2. Every non-default locale has the SAME top-level group keys as `en.json` — no missing groups, no extra groups. Catches the regression where adding a new namespace to the en source forgets to backfill it in vi/zh/ja/etc. (next-intl throws `MISSING_MESSAGE` at request time).
3. Every locale code in `locales` has a non-empty human-readable name in `localeNames`.
4. `vi` is registered AND `localeNames.vi === 'Tiếng Việt'` — pins the Phase 5.4 deliverable specifically.
5. `vi.common.save === 'Lưu'` — proves the file actually has Vietnamese translations, not a verbatim copy.

## Why partial translation, not full

`messages/en.json` is 2198 lines / 52 top-level groups. A full translation in one PR would be:
- Slow to review (Đào reading 2k lines of localized strings).
- High-risk to upstreamability (one over-eager translation that changes a key's *meaning* would break the en source's intent).
- Diluted: most groups (Office, Standup, GitHubSync, Webhooks) are not on Tyler's daily-driver path — translating them costs review time without daily ROI.

The chosen seven groups cover ~90% of Tyler's UI interactions per the daily-use observation in the roadmap brief. Subsequent surface-specific PRs (e.g. "translate the Memory Browser panel") can layer on top without changing the base contract.

## Upstreamability invariant

This PR does NOT modify `messages/en.json`. The English source strings stay byte-identical to the upstream branch. Adding a new locale file plus a config-tuple entry is the maximally-additive shape: an upstream rebase will not conflict with anything (assuming upstream doesn't add `vi` themselves).

If upstream later adds `vi` independently, the rebase will trigger a merge conflict on `config.ts` and `messages/vi.json` — both diff-friendly and easy to resolve manually. The structure-pin test will catch any divergence on either side.

## Gates run (Mai re-verified on post-PR-#40 base)

```
$ git rev-parse HEAD
f97ad0578abc7fac580204321b37bf5cf9feb0ab  # confirms post-PR-#40 base

$ npx vitest run src/i18n/__tests__/locale-structure.test.ts
✓ src/i18n/__tests__/locale-structure.test.ts (5 tests) 25ms
Test Files  1 passed (1)
Tests       5 passed (5)

$ npx tsc --noEmit
(clean)
```

The structure-pin test runs in under 30 ms (loads 11 JSON files into memory, compares top-level keys). It can stay in the regular vitest suite with no flakiness risk.

## Findings / caveats

### C1 — Mixed-locale UI is the intentional shape

A Vietnamese user clicking through the UI today will see Vietnamese on the high-traffic surfaces and English on lower-traffic ones (Office, Standup, etc.). This is by design — partial translation is better than blocking the entire feature on a 2k-line translation pass. The structure-pin test ensures no namespace is broken; only leaf strings are missing translations, and next-intl gracefully falls through to the source string for those.

### C2 — Translation quality is "Tyler-friendly", not "official"

The translations chosen target Tyler's vocabulary as a Vietnamese-Australian non-developer Etsy seller. They are not formal-register Vietnamese (vd: "Nhân viên" cho Agents thay vì "Đặc vụ" / "Tác nhân"). A future locale-quality pass with a native-speaker reviewer can refine register; this PR ships the translations Tyler will actually want to read.

### C3 — Right-to-left (RTL) handling unchanged

Adding `vi` (LTR script) does not affect the existing `ar.json` RTL handling. The structure-pin test is locale-agnostic; it does not assert on writing direction.

### C4 — No language switcher UI change

The existing `tests/i18n-language-switcher.spec.ts` Playwright spec was NOT modified. It already iterates over `locales` from config so the new `vi` entry is picked up automatically when Playwright runs. No additional UI-test wiring required for this PR.

## What this PR does not do

- Does not modify `messages/en.json` — upstreamability invariant.
- Does not translate every group — see "Why partial translation, not full".
- Does not add a new language switcher widget — existing widget reads from `localeNames`.
- Does not change RTL handling.
- Does not add component-level rendering tests for Vietnamese strings (no precedent for `*.test.tsx` in `src/`; existing Playwright `i18n-language-switcher.spec.ts` already exercises locale switching end-to-end).

## Risk and rollback

- Risk: very low. New JSON file + 2-line config edit + 1 test file. No production behavior change for users on `en` (the default).
- Rollback: revert this PR's diff. `vi` returns to "not supported"; `localeNames` returns to 10 entries. No data migration.

## Refs

- Đào msg 1701 (2026-04-27T13:10Z) — Phase 5.4 assignment + upstreamability instruction, ETA 23:45:00+10:00.
- PR #40 — Phase 5.3 telegram-topic-aware logs, merged at `f97ad05`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.4 — task definition.
- `src/i18n/config.ts` — locale tuple + names (this PR adds vi).
- `messages/vi.json` (new) — Vietnamese translation, structural copy of en.json with 7 high-impact groups translated.
- `src/i18n/__tests__/locale-structure.test.ts` (new) — 5 cases pinning structural invariants + Vietnamese deliverable.
- `tests/i18n-language-switcher.spec.ts` — existing Playwright spec, no change needed.
