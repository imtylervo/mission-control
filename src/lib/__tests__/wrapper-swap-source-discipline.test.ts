/**
 * Source-discipline test for PR #13 / Phase 1.3d:
 *
 *   Migrate the generic `callOpenClawGateway(method, params, timeoutMs)`
 *   wrapper (which itself shells out via `runOpenClaw(['gateway',
 *   'call', method, ...])`) to native WS via
 *   `callOpenClawGatewayWS(method, params, { timeoutMs })`.
 *
 * Per Đào's gateway-source confirmation (msg 1336):
 *   - 14 of 17 callsites are migrated in this PR (Group A — already-dot
 *     methods + Group B — confirmed underscore→dot renames).
 *   - 3 callsites are INTENTIONALLY retained on the legacy wrapper:
 *       * `src/app/api/spawn/route.ts` (×2 sessions_spawn) — WS
 *         `sessions.create` lacks runTimeoutSeconds / tools profile /
 *         runtime / cleanup parity with the CLI tool, defer until
 *         either the WS schema is extended or a parity shim is designed.
 *       * `src/app/api/sessions/transcript/gateway/route.ts` (×1
 *         chat.history) — the WS protocol does not export chat.history
 *         as of this commit, defer until a verified read path exists.
 *
 * Renames performed (CLI tool name → WS method, with param key change):
 *   - sessions_kill → sessions.abort, params { key, runId? }
 *   - session_delete → sessions.delete, params { key, deleteTranscript?,
 *     emitLifecycleHooks? }
 *   - session_setThinking / session_setVerbose / session_setReasoning /
 *     session_setLabel → sessions.patch, params { key, thinkingLevel? |
 *     verboseLevel? | reasoningLevel? | label? }
 *   - sessions_send (the wrapper-variant in sessions/[id]/control/
 *     route.ts) → sessions.send, params { key, message, timeoutMs? }
 *
 * Methods kept unchanged because the param shape stays the same
 * (Đào confirmed `chat.send` keeps `sessionKey`, NOT `key`):
 *   - chat.send (chat/messages/route.ts:493 + task-dispatch.ts:669)
 *   - node.list, device.pair.list (nodes/route.ts)
 *   - device.pair.approve / reject / device.token.rotate / revoke
 *     (nodes/route.ts spec.method dispatch)
 *   - channels.status (channels/route.ts × 2)
 *   - web.login.start, web.login.wait, channels.logout
 *
 * After migration this test guards against:
 *   1. Re-introduction of `callOpenClawGateway` in the migrated files.
 *   2. Removal of the migration (positive `callOpenClawGatewayWS`
 *      assertion).
 *   3. Accidental removal of the intentional legacy retention in the
 *      two deferred files (positive `callOpenClawGateway` assertion +
 *      a guarding marker comment so a future cleanup PR doesn't
 *      mechanically strip it).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..')

function stripCommentsAndJsdoc(src: string): string {
  return src
    .split('\n')
    .filter(line => !/^\s*(?:\*|\/\/| \*)/.test(line))
    .join('\n')
}

const MIGRATED_FILES: ReadonlyArray<readonly [string, string]> = [
  ['app/api/nodes/route.ts', 'nodes'],
  ['app/api/channels/route.ts', 'channels'],
  ['app/api/sessions/route.ts', 'sessions'],
  ['app/api/sessions/[id]/control/route.ts', 'sessions/[id]/control'],
  ['app/api/chat/messages/route.ts', 'chat/messages'],
  // PR #21 / Phase 1.4: chat.history is now exposed on the gateway WS
  // protocol (OpenClaw 2026.4.24 SDK,
  // plugin-sdk/src/gateway/protocol/schema/logs-chat.d.ts:15-18), so the
  // transcript route was migrated off the legacy CLI wrapper. Disk-side
  // fallback inside the route is unchanged.
  ['app/api/sessions/transcript/gateway/route.ts', 'sessions/transcript/gateway'],
  ['lib/task-dispatch.ts', 'lib/task-dispatch'],
]

const DEFERRED_FILES: ReadonlyArray<readonly [string, string, string]> = [
  // [path, label, marker substring that must be present in retention comment]
  ['app/api/spawn/route.ts', 'spawn', 'INTENTIONALLY retained on the legacy'],
]

describe('callOpenClawGateway wrapper-swap source discipline (PR #13 / Phase 1.3d)', () => {
  describe('migrated files must not call callOpenClawGateway', () => {
    for (const [relPath, label] of MIGRATED_FILES) {
      it(`${label} (${relPath}) uses callOpenClawGatewayWS, not the legacy callOpenClawGateway`, () => {
        const src = readFileSync(join(SRC_ROOT, relPath), 'utf8')
        const code = stripCommentsAndJsdoc(src)

        expect(
          code,
          `${label} must not invoke callOpenClawGateway — Phase 1.3d migrated this file to callOpenClawGatewayWS`
        ).not.toMatch(/callOpenClawGateway\s*[(<]/)

        expect(
          code,
          `${label} must use callOpenClawGatewayWS for at least one gateway call`
        ).toMatch(/callOpenClawGatewayWS\s*[(<]/)
      })
    }
  })

  describe('deferred files retain the legacy wrapper INTENTIONALLY (with a marker comment)', () => {
    for (const [relPath, label, marker] of DEFERRED_FILES) {
      it(`${label} (${relPath}) keeps callOpenClawGateway with the deferral-marker comment`, () => {
        const src = readFileSync(join(SRC_ROOT, relPath), 'utf8')

        // Positive: the legacy wrapper call still exists.
        expect(
          src,
          `${label} must still call callOpenClawGateway — its WS migration is intentionally deferred`
        ).toMatch(/callOpenClawGateway\s*[(<]/)

        // Positive: the marker comment is present so a future cleanup
        // pass doesn't strip the call without reading the deferral
        // rationale.
        expect(
          src,
          `${label} must contain the deferral-marker substring "${marker}" so the retention is auditable`
        ).toContain(marker)
      })
    }
  })

  describe('legacy wrapper module is still present (until the deferred files migrate too)', () => {
    it('src/lib/openclaw-gateway.ts still exports callOpenClawGateway', () => {
      const src = readFileSync(join(SRC_ROOT, 'lib', 'openclaw-gateway.ts'), 'utf8')
      expect(src).toMatch(/export\s+async\s+function\s+callOpenClawGateway\s*</)
    })
  })
})
