/**
 * Source-discipline test for PR #11 / Phase 1.3b:
 *
 *   Migrate `runOpenClaw(['gateway', 'sessions_send', ...])` shell-out
 *   to native WS via `callOpenClawGatewayWS('sessions.send', ...)` in
 *   the three direct-CLI sessions_send callsites.
 *
 * Per Đào (Telegram msg 1326), the gateway WS method is `sessions.send`
 * (dot, not underscore — `sessions_send` is the CLI/tool name only).
 *
 * After migration, this test guards against:
 *   1. Re-introduction of the literal `'sessions_send'` string anywhere
 *      in the migrated route files (catches both runOpenClaw and any
 *      other future wrapper that might still shell out via the CLI tool
 *      name).
 *   2. Removal of the `callOpenClawGatewayWS` migration (positive
 *      assertion that the WS path is still wired).
 *   3. Any `runOpenClaw` call expression in the migrated files (these
 *      three routes do not use it for anything else; reintroduction
 *      would be a regression).
 *
 * Generic CLI use elsewhere is still legitimate (e.g. `doctor`,
 * `agents add`, `backup create`); this test scopes only the three
 * migrated routes, mirroring the narrow-scope discipline of the #608
 * test in `task-dispatch-source-discipline.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES_ROOT = join(__dirname, '..', '..', 'app', 'api')

const MIGRATED_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['agents/[id]/wake/route.ts', 'agents/[id]/wake'],
  ['agents/message/route.ts', 'agents/message'],
  ['tasks/[id]/broadcast/route.ts', 'tasks/[id]/broadcast'],
]

function stripCommentsAndJsdoc(src: string): string {
  return src
    .split('\n')
    .filter(line => !/^\s*(?:\*|\/\/| \*)/.test(line))
    .join('\n')
}

describe('sessions_send source discipline (PR #11 / Phase 1.3b)', () => {
  for (const [relPath, label] of MIGRATED_ROUTES) {
    it(`${label}/route.ts must call sessions.send via WS, not the legacy CLI`, () => {
      const src = readFileSync(join(ROUTES_ROOT, relPath), 'utf8')
      const code = stripCommentsAndJsdoc(src)

      expect(
        code,
        `${label}/route.ts must not contain the literal 'sessions_send' (CLI/tool name) — use 'sessions.send' (WS method) via callOpenClawGatewayWS instead`
      ).not.toMatch(/['"]sessions_send['"]/)

      expect(
        code,
        `${label}/route.ts must not invoke runOpenClaw — the sessions_send shell-out has been migrated to callOpenClawGatewayWS('sessions.send', ...)`
      ).not.toMatch(/runOpenClaw\s*\(/)

      expect(
        code,
        `${label}/route.ts must use callOpenClawGatewayWS for sessions.send`
      ).toMatch(/callOpenClawGatewayWS/)

      expect(
        code,
        `${label}/route.ts must call the 'sessions.send' WS method (dot form)`
      ).toMatch(/['"]sessions\.send['"]/)
    })
  }
})
