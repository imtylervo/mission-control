# Phase 3.2 — Sessions / chat panel smoke + fixes

**Outcome:** source/API smoke for the Sessions / chat panel against the post-PR-#29 base. The four roadmap-required surfaces (session list, transcript fetch, send message, abort/control) all PASS by source review plus the existing sessions API test suite. No code change required in this audit.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `f2e2b2f` (Phase 3.1 PR #29 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.2:

> Verify session list, transcript fetch, send message, abort/control where applicable.

Đào (LEAD) assigned this scope to Mai (CODER) after Phase 3.1 closed (Đào msg 1669, ETA 22:10:00+10:00). PR #30 keeps the v6 role split clean: Mai implements + audits, Đào reviews.

## Panel routing

Per `src/app/[[...panel]]/page.tsx`, the URL panel `sessions` normalizes to the `chat` panel internally. The two relevant component trees are:

- `src/components/panels/chat-page-panel.tsx` — page wrapper for the chat surface.
- `src/components/chat/chat-workspace.tsx` — main interactive workspace that fetches conversations, sessions, messages, transcripts, and prefs.
- `src/components/chat/chat-input.tsx` — message input with send + abort handlers (handlers wired by parent).
- `src/components/chat/chat-panel.tsx` — chat panel container.

Session-detail surfaces also use:

- `src/components/panels/session-details-panel.tsx`
- `src/components/panels/agent-history-panel.tsx` (uses `GET /api/sessions` for listing).
- `src/components/panels/agent-comms-panel.tsx` (uses `GET /api/sessions/transcript/aggregate`).

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Session list | PASS | `GET /api/sessions` (`src/app/api/sessions/route.ts`) is `viewer`-gated and returns `{ sessions: [...] }` merged from gateway sessions (`getAllGatewaySessions()`) + local Claude / Codex / Hermes / OpenCode session scans. Deduped + sorted before return. Failure mode is graceful: returns `{ sessions: [] }` rather than 5xx. Consumed by `agent-history-panel.tsx fetchSessions()`. |
| Transcript fetch | PASS | Two endpoints used by `chat-workspace.tsx` depending on session origin: `GET /api/sessions/transcript/gateway?key=...&limit=50` for gateway-side sessions and `GET /api/sessions/transcript?kind=...&id=...&limit=40` for local sessions. Local route reads from OpenCode SQLite (and other adapters) read-only. Aggregate path `GET /api/sessions/transcript/aggregate?limit=200` is used by `agent-comms-panel.tsx`. All viewer-gated. |
| Send message | PASS | `chat-workspace.tsx` performs `POST /api/chat/messages` (chat-message persistence) and `POST /api/sessions/continue` (resume / dispatch a session) for sending. `chat-input.tsx` exposes `onSend(content, attachments?)` which the parent wires to those endpoints. The agent-side wake/send path remains `POST /api/agents/message` (verified in PR #29). |
| Abort / control | PASS | `POST /api/sessions/[id]/control` is `operator`-gated and accepts action ∈ `{monitor, pause, terminate}`. `terminate` calls gateway WS method `sessions.abort` (per Đào msg 1336 / PR #13 1.3d migration). `monitor` and `pause` use `sessions.send` with `{type: 'control', action: ...}` payload. Session ID is regex-validated (`^[a-zA-Z0-9_-]+$`) before use, mutation rate-limited, activity logged. `chat-input.tsx` exposes `onAbort` and renders the abort button only while `isGenerating`. |

## Gates run (Mai re-verified on post-PR-#29 base)

```
$ git rev-parse HEAD
f2e2b2faaf6eb2ebacfce197c2e96069ca2f1baf  # confirms post-PR-#29 base

$ npx vitest run src/app/api/sessions/__tests__/
✓ src/app/api/sessions/__tests__/continue-route-opencode.test.ts (2 tests)
✓ src/app/api/sessions/__tests__/transcript-opencode.test.ts (3 tests)
Test Files: 2 passed | Tests: 5 passed (5)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Browser smoke deferred

This audit is source/API backed. A live-browser pass that actually opens the chat panel, picks a session, fetches transcript, sends a message, and clicks abort is more naturally covered in the broader Phase 5.x manual smoke pass than as part of every read-only Phase 3.x audit.

### C2 — Session-list resilience

`GET /api/sessions` deliberately falls back to `{ sessions: [] }` on any internal error (e.g., a corrupt local SQLite scan path), with the error logged via `logger.error`. This is correct UX (the panel shows "no sessions" rather than crashing) but means a partial outage of one local-session source can hide data from the other sources without a banner. Out of scope for Phase 3.2 — the roadmap item asks for verification, not redesign. Captured here so a future operator-visibility task can pick it up.

### C3 — Send paths span multiple endpoints

The chat surface sends through three different endpoints depending on context:
- `POST /api/chat/messages` for chat-message persistence (workspace history).
- `POST /api/sessions/continue` for resuming an existing local session.
- `POST /api/agents/message` for waking / sending to an agent (used by the Phase 3 agent panel, not the chat workspace directly, but adjacent in user flow).

This is intentional given the different consumers, but means a future "send" smoke needs to exercise all three. Documented for the smoke planner.

### C4 — Destructive `terminate` action exists; not exercised here

`POST /api/sessions/[id]/control` with `action: terminate` calls `sessions.abort` against the gateway. This audit deliberately does NOT fire that against any real session — it would disturb live work. Verified by source review only.

## What this PR does not do

- No `src/` changes — audit doc only.
- No new tests added; the existing `sessions/__tests__` suite is sufficient for the roadmap-defined checklist.
- Does not browse-smoke the panel — see C1.
- Does not exercise destructive `terminate` against any real session — see C4.
- Does not change rate limits, auth gates, or transport choices.

## Risk and rollback

- Risk: none beyond documentation.
- Rollback: revert this PR's diff (single audit doc).

## Refs

- Đào msg 1669 (2026-04-27T11:42Z) — Phase 3.2 assignment to Mai with ETA 22:10.
- Tyler msg 1666 — v6 watchdog approval that established the lead/coder split this PR follows.
- PR #29 — Phase 3.1 audit, merged at `f2e2b2f`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.2 — task definition.
- `src/app/[[...panel]]/page.tsx`
- `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/control/route.ts`
- `src/app/api/sessions/transcript/route.ts`, `src/app/api/sessions/transcript/gateway/route.ts`, `src/app/api/sessions/transcript/aggregate/route.ts`
- `src/app/api/sessions/continue/route.ts`
- `src/app/api/chat/messages/route.ts`, `src/app/api/chat/conversations/route.ts`, `src/app/api/chat/session-prefs/route.ts`
- `src/components/panels/chat-page-panel.tsx`, `src/components/panels/agent-history-panel.tsx`, `src/components/panels/agent-comms-panel.tsx`, `src/components/panels/session-details-panel.tsx`
- `src/components/chat/chat-workspace.tsx`, `src/components/chat/chat-input.tsx`, `src/components/chat/chat-panel.tsx`
