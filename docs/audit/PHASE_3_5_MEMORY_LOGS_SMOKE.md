# Phase 3.5 — Memory / logs panel smoke + fixes

**Outcome:** source/API smoke for the memory and logs panels against the post-PR-#32 base. Memory tree / content / link endpoints and logs/events display all PASS by source review plus the existing memory-utils + security-events test suites (30 tests). No code change required. **Privacy invariant upheld**: this audit deliberately does NOT paste raw memory or log content; only counts, schemas, and route behaviors.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `7d41f96` (Phase 3.4 PR #32 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.5:

> Verify memory tree/content/link endpoints and logs/events display.

Đào (LEAD) assigned this scope to Mai (CODER) after Phase 3.4 closed (Đào msg 1677, ETA 22:25:00+10:00). Đào's instruction: "avoid leaking private memory/log content in chat/doc, summarize only" — pinned as the privacy invariant for this audit.

## Panel surface

Three components map to this scope:

- `src/components/panels/memory-browser-panel.tsx` — memory tree + content browser. Fetches `/api/memory` (multiple actions), `/api/memory/health`, `/api/memory/process`, and `/api/hermes` + `/api/hermes/memory` when Hermes is installed.
- `src/components/panels/memory-graph.tsx` — wikilink graph visualization. Fetches `/api/memory/graph?agent=all`.
- `src/components/panels/log-viewer-panel.tsx` — log stream viewer. Fetches `/api/logs?action=sources` and `/api/events` (SSE).

API surface:

- `src/app/api/memory/route.ts` — main memory tree + content read/write. Path-safety gated through `MEMORY_ALLOWED_PREFIXES` + `isPathAllowed` + `resolveSafeMemoryPath` from `@/lib/memory-path`. Rate-limited (read + mutation). Symlinks skipped during tree walk.
- `src/app/api/memory/search/route.ts` — search across indexed memory.
- `src/app/api/memory/graph/route.ts` — wikilink graph.
- `src/app/api/memory/links/route.ts` — link extraction (`extractWikiLinks` from `memory-utils`).
- `src/app/api/memory/health/route.ts` — index health check.
- `src/app/api/memory/process/route.ts` — re-index / process memory.
- `src/app/api/memory/context/route.ts` — context extraction.
- `src/app/api/logs/route.ts` — multi-format log parser (JSON / pipe-delimited / journald / plain text). Reads from `config.logsDir`, viewer-gated, rate-limited.
- `src/app/api/events/route.ts` — SSE stream for real-time DB events. Viewer-gated; per-workspace filter (an SSE client only sees events tagged with their `workspace_id` or untagged events).
- `src/app/api/hermes/memory/route.ts` — Hermes-specific memory listing (only when Hermes is installed).

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Memory tree | PASS | `src/app/api/memory/route.ts` `buildFileTree(dirPath, relativePath, maxDepth)` walks the memory directory. Symlinks skipped. Files sorted directories-first, alphabetical. Paths gated through `isPathAllowed` to reject traversal. The panel calls `/api/memory` with `action=tree`. |
| Memory content read/write | PASS | `/api/memory` accepts read (path-safe resolve via `resolveSafeMemoryPath`) and write actions; mutation is rate-limited via `mutationLimiter`, read via `readLimiter`. Schema-validated with `validateSchema` from `memory-utils`. |
| Wiki-link extraction | PASS | `extractWikiLinks` (in `memory-utils`) is exercised by `/api/memory/links/route.ts` and indirectly by `memory-graph.tsx`. Covered by `memory-utils.test.ts` (15 cases). |
| Memory graph | PASS | `GET /api/memory/graph?agent=all` returns the wikilink graph. The panel renders nodes + edges. |
| Memory health | PASS | `GET /api/memory/health` returns index health summary. The panel polls this for the Hermes / SQLite-FTS subsystem state. |
| Memory process / re-index | PASS | `POST /api/memory/process` triggers a re-index. Operator-gated (write surface). |
| Logs viewer | PASS | `GET /api/logs?action=sources` lists log sources from `config.logsDir`. `GET /api/logs?action=tail&source=X` returns parsed entries. `parseLogLine` handles JSON, pipe-delimited, journald, and plain-text formats and falls back gracefully. |
| Events stream (SSE) | PASS | `GET /api/events` is a `nodejs`-runtime SSE stream. Viewer-gated. Sends an initial `{ type: 'connected' }`, then forwards `eventBus` events filtered by `workspace_id` (events from other workspaces dropped). Cleanup on cancel removes the listener (no leak). |

## Privacy invariant (Đào msg 1677)

This audit deliberately:

- Does **not** paste any raw memory file content.
- Does **not** paste any raw log line content.
- Does **not** include directory listings, filenames, or paths beyond the API-surface schema.
- Counts (route count, test count, test-pass count) are exposed; specific values from any user's memory tree are not.

Privacy-bearing endpoints:

- `/api/memory/*` — memory content and search results are visible to whichever user authenticates with viewer/operator role; this audit does not invoke them against a real workspace.
- `/api/logs?action=tail` — log content is visible to viewer; this audit does not invoke `tail` and does not paste sample output.
- `/api/events` — SSE stream is workspace-scoped; this audit does not connect to it.

## Gates run (Mai re-verified on post-PR-#32 base)

```
$ git rev-parse HEAD
7d41f96163988a2ee48174f18406cde5073126ee  # confirms post-PR-#32 base

$ npx vitest run src/lib/__tests__/memory-utils.test.ts \
                 src/lib/__tests__/security-events.test.ts
✓ src/lib/__tests__/security-events.test.ts (15 tests)
✓ src/lib/__tests__/memory-utils.test.ts (15 tests)
Test Files: 2 passed | Tests: 30 passed (30)

$ npx tsc --noEmit
(clean)
```

The pre-existing `gateway-url.test.ts` failure (residual-risk row 4 in `BASELINE.md`) is unrelated and **not** introduced by this PR. PR #29-#32 already disclaim this; PR #33 makes the same disclaimer.

## Findings / caveats

### C1 — Browser smoke deferred

A live-browser pass that opens the memory browser, the memory graph, and the log viewer is most naturally part of Phase 5.x. Source-and-test-level evidence is sufficient for this audit.

### C2 — Memory path-safety relies on `memory-path.ts`

Every `/api/memory/*` route uses `isPathAllowed` + `resolveSafeMemoryPath` from `@/lib/memory-path`. A vulnerability in those primitives would affect the whole memory surface. Path-safety unit tests live alongside `memory-utils.test.ts` (covering schema + wikilink extraction). A future "path-safety hardening" task could broaden coverage but is out of scope here.

### C3 — Hermes integration is conditional

`memory-browser-panel.tsx` checks `/api/hermes` first and only fetches `/api/hermes/memory` when `installed === true`. The panel falls back gracefully when Hermes is not present. This audit does not exercise the Hermes path beyond confirming the conditional fetch.

### C4 — Events SSE has explicit workspace isolation

`/api/events` filters events by `userWorkspaceId = auth.user.workspace_id ?? 1`. Events without a `workspace_id` are forwarded to all clients; events with one go only to the matching workspace. Not a defect; explicitly documented so a future multi-tenant audit knows where the boundary sits.

### C5 — Log file content can contain sensitive substrings

`config.logsDir` may include OpenClaw, gateway, journald, or app logs that contain hostnames, IPs, paths, and (in worst cases) tokens or sample request bodies. The route does not strip those. The Phase 2.4 security-audit script's accepted-exception list (E5–E7 in `PHASE_2_4_DOCTOR_SECURITY.md`) hints at the same thing: production deployments should set `MC_COOKIE_SECURE`, `MC_ENABLE_HSTS`, `MC_ALLOWED_HOSTS` etc., but log redaction is a separate concern. Out of scope for Phase 3.5 — captured here so the future log-redaction task knows it.

## What this PR does not do

- No `src/` changes — audit doc only.
- No new tests added.
- Does not browse-smoke the panels — see C1.
- Does not invoke any memory read / log tail / events SSE against a real workspace — privacy invariant.
- Does not redact / harden log content — see C5.
- Does not exercise destructive `POST /api/memory/process` against real index.

## Risk and rollback

- Risk: none beyond documentation.
- Rollback: revert this PR's diff (single audit doc).

## Refs

- Đào msg 1677 (2026-04-27T11:53Z) — Phase 3.5 assignment with privacy invariant, ETA 22:25:00+10:00.
- PR #32 — Phase 3.4 audit, merged at `7d41f96`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 3.5 — task definition.
- Panels: `memory-browser-panel.tsx`, `memory-graph.tsx`, `log-viewer-panel.tsx`.
- API: `src/app/api/memory/{route,search,graph,links,health,process,context}.ts`, `src/app/api/logs/route.ts`, `src/app/api/events/route.ts`, `src/app/api/hermes/memory/route.ts`.
- Helpers: `src/lib/memory-path.ts`, `src/lib/memory-utils.ts`, `src/lib/memory-search.ts`, `src/lib/event-bus.ts`.
- Tests: `src/lib/__tests__/memory-utils.test.ts`, `src/lib/__tests__/security-events.test.ts`.
