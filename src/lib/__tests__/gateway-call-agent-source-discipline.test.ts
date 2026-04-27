/**
 * Source-discipline test for PR #12 / Phase 1.3c:
 *
 *   Migrate `runOpenClaw(['gateway', 'call', 'agent[.wait]', ...])`
 *   shell-out to native WS via `callOpenClawGatewayWS('agent', ...)`
 *   and `callOpenClawGatewayWS('agent.wait', ...)` in the two
 *   non-task-dispatch routes that still used the CLI agent invocation
 *   pattern after PR #3 / #608.
 *
 * Per Đào (Telegram msg 1331):
 *   - `'agent.wait'` is a valid WS gateway method (dot form, not
 *     underscore).
 *   - `agent` method params use `timeout` (not `timeoutMs`) for the
 *     gateway-side run timeout; `idempotencyKey` is required.
 *   - `agent.wait` method params use `{ runId: string,
 *     timeoutMs?: number }`.
 *
 * After migration this test guards against:
 *   1. Re-introduction of the literal `['gateway', 'call', 'agent', ...]`
 *      multi-line array pattern (file-level `.includes` heuristic on
 *      stripped source — mirrors PR #11's pattern).
 *   2. Removal of the WS migration (positive `callOpenClawGatewayWS`
 *      assertion).
 *   3. For chat/messages, removal of the `agent.wait` companion call.
 *
 * Out of scope:
 *   - `task-dispatch.ts` (PR #3 already migrated; covered by
 *     `task-dispatch-source-discipline.test.ts`)
 *   - `callOpenClawGateway('chat.send', ...)` legacy wrapper in
 *     chat/messages — that's PR 1.3d's concern
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES_ROOT = join(__dirname, '..', '..', 'app', 'api')

function stripCommentsAndJsdoc(src: string): string {
  return src
    .split('\n')
    .filter(line => !/^\s*(?:\*|\/\/| \*)/.test(line))
    .join('\n')
}

function fileContainsLegacyAgentCliPattern(code: string): boolean {
  // Multi-line resilient: the original CLI pattern was
  //   runOpenClaw(
  //     [
  //       'gateway',
  //       'call',
  //       'agent', // or 'agent.wait',
  //       ...
  //     ],
  //     { timeoutMs: ... }
  //   )
  // Detect by checking that the file simultaneously contains all three
  // quoted literals 'gateway', 'call', and either 'agent' or 'agent.wait'
  // AND a runOpenClaw( call expression. This is specific enough since the
  // non-test code shouldn't have all three literals together for any other
  // reason.
  if (!/runOpenClaw\s*\(/.test(code)) return false
  const hasGateway = /['"]gateway['"]\s*,/.test(code)
  const hasCall = /['"]call['"]\s*,/.test(code)
  const hasAgentLiteral = /['"]agent['"]\s*,/.test(code) || /['"]agent\.wait['"]\s*,/.test(code)
  return hasGateway && hasCall && hasAgentLiteral
}

describe('gateway call agent source discipline (PR #12 / Phase 1.3c)', () => {
  it('notifications/deliver/route.ts must call agent via WS, not the legacy CLI', () => {
    const src = readFileSync(join(ROUTES_ROOT, 'notifications/deliver/route.ts'), 'utf8')
    const code = stripCommentsAndJsdoc(src)

    expect(
      fileContainsLegacyAgentCliPattern(code),
      'notifications/deliver/route.ts must not contain runOpenClaw([..., \'gateway\', \'call\', \'agent\', ...]) — use callOpenClawGatewayWS(\'agent\', ...) instead'
    ).toBe(false)

    expect(
      code,
      'notifications/deliver/route.ts must use callOpenClawGatewayWS for agent invocation'
    ).toMatch(/callOpenClawGatewayWS/)

    expect(
      code,
      'notifications/deliver/route.ts must call the \'agent\' WS method'
    ).toMatch(/['"]agent['"]/)
  })

  it('chat/messages/route.ts must call agent + agent.wait via WS, not the legacy CLI', () => {
    const src = readFileSync(join(ROUTES_ROOT, 'chat/messages/route.ts'), 'utf8')
    const code = stripCommentsAndJsdoc(src)

    expect(
      fileContainsLegacyAgentCliPattern(code),
      'chat/messages/route.ts must not contain runOpenClaw([..., \'gateway\', \'call\', \'agent[.wait]\', ...]) — use callOpenClawGatewayWS(\'agent\', ...) and callOpenClawGatewayWS(\'agent.wait\', ...) instead'
    ).toBe(false)

    expect(
      code,
      'chat/messages/route.ts must use callOpenClawGatewayWS for agent + agent.wait invocations'
    ).toMatch(/callOpenClawGatewayWS/)

    expect(
      code,
      'chat/messages/route.ts must call the \'agent.wait\' WS companion method (dot form)'
    ).toMatch(/['"]agent\.wait['"]/)
  })
})
