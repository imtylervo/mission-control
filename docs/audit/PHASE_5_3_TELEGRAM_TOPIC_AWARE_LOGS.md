# Phase 5.3 — Telegram topic-aware logs

**Outcome:** added a pure helper module (`src/lib/telegram-topic.ts`) that lets activity-log emitters and dashboard consumers exchange a stable, greppable, forward-compatible token for "this entry came from Telegram chat C topic T (message M)". 21 unit tests pin the format. **Privacy invariant honored**: the bundled sanitizer accepts a Telegram payload and outputs an IDs-only record — message body / sender / attachment URLs are dropped and never reach the log.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `2a4d510` (Phase 5.2 PR #39 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.3:

> Link sessions/actions back to Telegram group/topic where possible.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5.2 closed (Đào msg 1697, ETA 23:35:00+10:00). Đào's instruction included a privacy invariant: "no raw private log dumps."

Today the activity-log records (`db_helpers.logActivity(...)`) in routes like `sessions/[id]/control`, `agents/{id}/wake`, `tasks/...` capture the WHO and WHAT but not the WHERE-ON-TELEGRAM. So an operator scanning logs has no way to trace back to the Telegram message that triggered the action. This PR adds the building block, not a wired-in DB column.

## What changed

### `src/lib/telegram-topic.ts` (new)

Four exports, all pure (no DB / no I/O / no fetch):

1. **`buildTelegramTopicRef({ chatId, topicId, messageId? }): string`**
   Stable token format for storing in any TEXT column or JSON `detail` field:
   ```
   tg:-1003656139138:1       (chat + topic root)
   tg:-1003656139138:1:42    (chat + topic + anchor message)
   ```
   Forward-compatible: a future segment can be appended without breaking existing parsers (the parser treats unknown trailing segments as "ignore", documented + tested).

2. **`parseTelegramTopicRef(token): TelegramTopicRef | null`**
   Inverse of `build`. Returns `null` for malformed input (wrong prefix, fewer than 2 segments, non-integer chat or topic). Forward-compatible (extra segments after `messageId` are dropped, not rejected).

3. **`buildTelegramDeepLink(ref): string | null`**
   Builds `https://t.me/c/<NUMERIC_ID>/<TOPIC>[/<MSG>]` so the dashboard can render an "Open in Telegram" button per log row. Strips the `-100` supergroup prefix per Telegram URL convention. Returns `null` when the chat id is not a `-100*` supergroup (DM / regular-group ids cannot use this URL form).

4. **`sanitizeTelegramPayloadForLog(payload): { tg_ref, chatId, topicId, messageId? } | null`**
   Privacy-bearing surface. Accepts either snake-case (`chat_id` / `message_thread_id` / `message_id`) or camelCase (`chatId` / `topicId` / `messageId`) shapes. Allow-list extracts ID fields ONLY; everything else (`text`, `from`, `photo`, `caption`, …) is dropped. The output object is what callers should pass into `JSON.stringify(...)` for the `detail` column. Tests assert that strings like `"PRIVATE MESSAGE BODY DO NOT LEAK"` and sender usernames cannot be recovered from the sanitized output.

### `src/lib/__tests__/telegram-topic.test.ts` (new)

21 cases organized by helper:

- **`buildTelegramTopicRef`** (3): 3-segment / 4-segment / undefined messageId.
- **`parseTelegramTopicRef`** (8): both round-trips; missing prefix; non-integer chat/topic; too-few segments; trailing-garbage forward-compat; malformed messageId drops cleanly; non-string input rejection.
- **`buildTelegramDeepLink`** (5): supergroup root link / anchor-message link / non-supergroup positive id / non-`-100` prefix / non-integer.
- **`sanitizeTelegramPayloadForLog`** (5): snake-case shape with secrets — assert tg_ref correct AND none of the secrets present in JSON-stringified output; camelCase shape; missing-message-id case; null/missing/wrong-shape input rejection; string-typed numeric coercion.

## Why this PR is a "library + audit", not a wire-in PR

The roadmap line is "link sessions/actions back to Telegram group/topic where possible." There are two halves:

1. **Library half (this PR)** — provide the token format, the parser, the URL builder, and the privacy sanitizer. These have to land first so any wire-in is predictable.
2. **Wire-in half (deferred follow-ups, one per surface)** — extend the relevant route's `db_helpers.logActivity(...)` calls to read the inbound Telegram context (request headers / body / X-Telegram-* shim) and pass the sanitized output through to the log row. Each surface (`agents/message`, `sessions/control`, `tasks/POST`, `pipelines/run`) has its own input shape and request lifecycle and benefits from a focused review per route.

This is documented here so the deferral is intentional, not a "TODO" left behind. Đào's instruction said "where possible" — the library is the precondition; per-route wiring is a follow-up surface that lands one-by-one in subsequent PRs (or as a single batched follow-up if Đào prefers).

## Privacy invariant (Đào msg 1697)

The four privacy promises this PR makes:

- The token format **carries IDs only** — no message text, no sender name, no attachment URLs.
- The sanitizer is **allow-list, not deny-list**. New fields added to a future Telegram payload shape are dropped by default until the sanitizer is explicitly extended.
- The deep-link builder produces public-shape URLs but the supergroup itself remains private (Telegram enforces membership at click time). Even if a log row leaked, an unauthenticated reader cannot follow the link.
- Test #6 (`'strips message body, sender, attachments — keeps IDs and emits tg_ref'`) explicitly asserts none of the secret fields appear in `JSON.stringify(sanitized)`. A future refactor that broadens the sanitizer's output will break this test, surfacing the regression.

## Gates run (Mai re-verified on post-PR-#39 base)

```
$ git rev-parse HEAD
2a4d510da11b90d4e483cb1f331bdec55ab736c0  # confirms post-PR-#39 base

$ npx vitest run src/lib/__tests__/telegram-topic.test.ts
✓ src/lib/__tests__/telegram-topic.test.ts (21 tests) 5ms
Test Files  1 passed (1)
Tests       21 passed (21)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — DB schema unchanged

`activity_log.detail` is already a TEXT column that holds JSON. The token fits there with no migration. Wire-in PRs should add a top-level `tg_ref` field inside the existing `detail` JSON, not a new SQL column, to keep migrations zero.

### C2 — Topic 1 = General

Telegram supergroups numbering: topic id `1` is always "General" (the topic-less default thread). This is preserved by the format — no special-casing in `buildTelegramTopicRef`. The dashboard renderer is free to label `topic = 1` as "General" if desired.

### C3 — Public chats (positive chatId) are out of scope here

`buildTelegramDeepLink` returns `null` for non-`-100*` chat ids. Public-link form (`https://t.me/<username>/<msg>`) requires looking up a username, which requires a Telegram API call — out of scope for a pure helper module. If this becomes needed later, add a separate `buildPublicLink(username, msg)` helper that lives next to this one.

### C4 — Sanitizer is the contract surface

Wire-in PRs MUST route any Telegram-derived data through `sanitizeTelegramPayloadForLog` before hitting `db_helpers.logActivity`. A future code review (or umbrella source-discipline test à la PR #35) can pin this rule statically across the migrated routes.

## What this PR does not do

- Does not wire helpers into any route — see "Why library + audit, not wire-in".
- Does not modify `db_helpers.logActivity` signature.
- Does not add a SQL migration.
- Does not add UI rendering (dashboard "Open in Telegram" button is a follow-up).
- Does not introduce a new umbrella source-discipline test for the sanitizer (deferred until at least one route is wired in so the umbrella has something to assert).

## Risk and rollback

- Risk: very low. New file, pure functions, no consumers in production yet.
- Rollback: revert this PR's diff (two files: helper + test). Nothing else depends on the new exports.

## Refs

- Đào msg 1697 (2026-04-27T13:01Z) — Phase 5.3 assignment + privacy invariant, ETA 23:35:00+10:00.
- PR #39 — Phase 5.2 eval-summary helpers + panel, merged at `2a4d510`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.3 — task definition.
- `src/lib/telegram-topic.ts` — helpers (this PR).
- `src/lib/__tests__/telegram-topic.test.ts` — 21 unit tests (this PR).
