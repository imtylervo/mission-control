/**
 * Source-discipline test for PR #608 (Đào caveat msg 1078):
 *
 * "Don't ban every gateway call repo-wide; only forbid the specific
 *  anti-pattern in task-dispatch full-text paths — runOpenClaw with
 *  ['gateway', 'call', 'agent', ...]. Generic CLI use elsewhere is
 *  legitimate (doctor, status, sessions cleanup)."
 *
 * This test asserts:
 *   1. `src/lib/task-dispatch.ts` does NOT shell out to `openclaw gateway call agent`
 *   2. `src/lib/openclaw-gateway-ws.ts` exists and exports the wrapper API
 *   3. The legacy CLI wrapper `runOpenClaw` is still allowed elsewhere
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

describe('task-dispatch source discipline (#608)', () => {
  it('task-dispatch.ts must NOT shell out to "openclaw gateway call agent"', () => {
    const src = readFileSync(join(ROOT, 'task-dispatch.ts'), 'utf8')

    // Specifically forbid the dispatch / aegis pattern that PR #3 replaces.
    // Generic gateway calls (chat.send, etc.) are still allowed via
    // callOpenClawGateway (CLI subprocess wrapper) — we only ban the
    // full-text agent invocation pattern that loses the LLM response.
    const offending: string[] = []
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] ?? ''
      // Pattern 1: runOpenClaw([..., 'gateway', 'call', 'agent', ...])
      if (/runOpenClaw\s*\(\s*\[[^\]]*['"]gateway['"][^\]]*['"]call['"][^\]]*['"]agent['"]/.test(text)) {
        offending.push(`line ${i + 1}: ${text.trim()}`)
      }
      // Pattern 2: --expect-final flag (CLI-only convenience that we replaced)
      if (/['"]--expect-final['"]/.test(text)) {
        offending.push(`line ${i + 1} (--expect-final): ${text.trim()}`)
      }
    }

    expect(offending, 'task-dispatch.ts must not use the legacy CLI agent dispatch pattern').toEqual([])
  })

  it('openclaw-gateway-ws.ts exists and exports the wrapper API', () => {
    const src = readFileSync(join(ROOT, 'openclaw-gateway-ws.ts'), 'utf8')

    // Required exports for #608 fix
    expect(src).toMatch(/export async function callOpenClawGatewayWS</)
    expect(src).toMatch(/export async function callGatewayAgentForText\s*\(/)
    expect(src).toMatch(/export class GatewayCallError /)
    expect(src).toMatch(/export class GatewayEmptyResponseError /)

    // No CLI shell-out inside the WS module — exclude doc-comment lines that
    // reference the legacy pattern as historical context.
    const codeLines = src
      .split('\n')
      .filter(line => !/^\s*(?:\*|\/\/| \*)/.test(line))
      .join('\n')
    expect(codeLines).not.toMatch(/await\s+runOpenClaw\s*\(/)
    expect(codeLines).not.toMatch(/=\s*runOpenClaw\s*\(/)
    expect(codeLines).not.toMatch(/spawn\s*\(\s*['"]openclaw['"]/)
  })

  it('legacy `runOpenClaw` import is preserved for non-#608 commands (doctor/status/sessions)', () => {
    // Should still be importable from src/lib/command — we did not remove the wrapper.
    const cmdSrc = readFileSync(join(ROOT, 'command.ts'), 'utf8')
    expect(cmdSrc).toMatch(/export\s+function\s+runOpenClaw\s*\(/)
  })

  it('callOpenClawGateway (legacy CLI wrapper) is still available for fire-and-forget callers', () => {
    // Đào caveat: chat.send and other generic non-text-required RPCs should
    // continue using the CLI wrapper. We did NOT remove openclaw-gateway.ts.
    const src = readFileSync(join(ROOT, 'openclaw-gateway.ts'), 'utf8')
    expect(src).toMatch(/export async function callOpenClawGateway</)
  })
})
