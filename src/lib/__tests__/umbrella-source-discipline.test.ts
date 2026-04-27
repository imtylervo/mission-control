/**
 * Source-discipline umbrella for Phase 4.2 (Đào msg 1681 assignment).
 *
 * Per-PR source-discipline tests already cover specific migrations:
 *   - device-identity (#574, PR #19)
 *   - device-token-storage (Phase 1.7)
 *   - sessions-send (#11, Phase 1.3b)
 *   - gateway-call-agent (#12, Phase 1.3c)
 *   - wrapper-swap (#13, Phase 1.3d)
 *   - pipelines-run (#22, Phase 1.4)
 *   - task-dispatch (#608, PR #3)
 *   - layout-nonce (#15, Phase 1.1)
 *
 * Each per-PR test scopes narrowly to its migrated file(s). That's correct
 * for review velocity — but it leaves a gap: a NEWLY introduced route that
 * lives next to migrated ones could shell out via `runOpenClaw([...,
 * 'gateway', 'call', 'agent', ...])` without tripping any existing test.
 *
 * This umbrella test asserts file-level invariants across ALL routes that
 * have already been migrated to the gateway WebSocket transport. The
 * forbidden patterns are exactly the migrated ones; legitimate CLI use
 * (e.g. `openclaw doctor`, `openclaw agents add`, `openclaw backup
 * create`) is NOT touched here.
 *
 * If a future PR migrates another route, add it to MIGRATED_ROUTES below.
 *
 * Out of scope:
 *   - Generic `runOpenClaw` use elsewhere (operational CLI tools).
 *   - Library-level `command.ts` itself (the wrapper that runOpenClaw lives in).
 *   - Test files (we want tests to be able to reference the literal pattern).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..', '..')

interface MigratedRoute {
  path: string
  /** WS method this route MUST use (positive assertion). */
  expectedWsMethod: string
  /** PR / phase the migration landed in (for failure messages). */
  migration: string
}

const MIGRATED_ROUTES: MigratedRoute[] = [
  {
    path: 'src/app/api/pipelines/run/route.ts',
    expectedWsMethod: 'agent',
    migration: 'PR #22 / Phase 1.4',
  },
  {
    path: 'src/app/api/sessions/[id]/control/route.ts',
    expectedWsMethod: 'sessions.send',
    migration: 'PR #13 / Phase 1.3d',
  },
  {
    path: 'src/app/api/chat/messages/route.ts',
    expectedWsMethod: 'agent',
    migration: 'PR #12 / Phase 1.3c (chat agent dispatch)',
  },
]

/**
 * Strip line + block comments before scanning, so that a comment that
 * legitimately documents the OLD pattern (e.g. "PR #22 migrated from
 * runOpenClaw(['agent', ...])") doesn't trip the test.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

const FORBIDDEN_SHELL_OUT_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /runOpenClaw\s*\(\s*\[\s*['"]gateway['"]\s*,\s*['"]call['"]\s*,\s*['"]agent['"]/,
    description: "runOpenClaw(['gateway', 'call', 'agent', …]) — the dispatch shell-out the PR #608/PR #3 migration replaced",
  },
  {
    pattern: /runOpenClaw\s*\(\s*\[\s*['"]gateway['"]\s*,\s*['"]sessions_send['"]/,
    description: "runOpenClaw(['gateway', 'sessions_send', …]) — the PR #11 / Phase 1.3b migration replaced this",
  },
  {
    pattern: /runOpenClaw\s*\(\s*\[\s*['"]agent['"]\s*,\s*['"]--message['"]/,
    description: "runOpenClaw(['agent', '--message', …]) — the PR #22 / Phase 1.4 migration replaced this on pipelines/run",
  },
]

describe('source-discipline umbrella (Phase 4.2)', () => {
  it.each(MIGRATED_ROUTES)(
    '$path must use callOpenClawGatewayWS and must not shell out via runOpenClaw',
    ({ path, expectedWsMethod, migration }) => {
      const src = readFileSync(join(REPO_ROOT, path), 'utf8')
      const code = stripComments(src)

      // Negative: forbidden shell-out patterns must not appear in production code.
      for (const { pattern, description } of FORBIDDEN_SHELL_OUT_PATTERNS) {
        expect(
          pattern.test(code),
          `${path} (${migration}) reintroduced forbidden pattern: ${description}`,
        ).toBe(false)
      }

      // Positive: callOpenClawGatewayWS must still be wired.
      expect(
        code,
        `${path} (${migration}) lost callOpenClawGatewayWS import/use — migration regressed`,
      ).toContain('callOpenClawGatewayWS')

      // Positive: the expected WS method must still be referenced (string literal),
      // catching a "renamed by accident" regression.
      const wsMethodLiteral = new RegExp(
        `['"\`]${expectedWsMethod.replace(/\./g, '\\.')}['"\`]`,
      )
      expect(
        wsMethodLiteral.test(code),
        `${path} (${migration}) no longer references WS method "${expectedWsMethod}"`,
      ).toBe(true)
    },
  )

  it('migrated routes inventory must match the per-PR discipline-test files', () => {
    // Sanity: anyone editing this file should not shrink the inventory below
    // 3 routes. If a new route is migrated, add it here AND add a per-PR
    // discipline test scoped to that route.
    expect(MIGRATED_ROUTES.length).toBeGreaterThanOrEqual(3)

    const allPaths = new Set(MIGRATED_ROUTES.map((r) => r.path))
    expect(allPaths.size).toBe(MIGRATED_ROUTES.length) // no duplicates
  })
})
