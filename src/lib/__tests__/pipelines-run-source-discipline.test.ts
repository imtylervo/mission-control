/**
 * Source-discipline check for PR #22 (Phase 1.4 deferred leftover #3).
 *
 * `src/app/api/pipelines/run/route.ts:spawnStep` was the last route in the
 * Mission Control fork still calling `runOpenClaw(['agent', '--message', …])`.
 * PR #22 migrated that callsite to the gateway WS `agent` method via
 * `callOpenClawGatewayWS('agent', …)`, which removes the last
 * `openclaw`-CLI-binary dependency on this route (and therefore the
 * `ENOENT` failure mode in containerised MC for this code path).
 *
 * This test asserts the migration is intact statically: the route must
 * NOT reference `runOpenClaw` for an `agent` invocation, and the WS
 * helper must be present.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE_PATH = join(__dirname, '..', '..', 'app', 'api', 'pipelines', 'run', 'route.ts')

describe('pipelines/run source discipline (PR #22 / Phase 1.4)', () => {
  it("must not call runOpenClaw(['agent', …]) — the gateway WS path replaces it", () => {
    const src = readFileSync(ROUTE_PATH, 'utf8')

    // No `runOpenClaw(...)` invocation in production code.
    // Comments/docstrings may legitimately reference the historical name to
    // explain the migration; we strip those before scanning.
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(?:\*|\/\/| \*)/.test(line))
      .join('\n')

    expect(
      code,
      "pipelines/run/route.ts must not invoke runOpenClaw — PR #22 migrated this to callOpenClawGatewayWS('agent', …)"
    ).not.toMatch(/\brunOpenClaw\s*\(/)

    // The dynamic import that was previously used to load the helper must
    // also be gone, so a future cleanup pass cannot accidentally re-introduce
    // the CLI dependency by simply uncommenting an existing line.
    expect(
      code,
      "pipelines/run/route.ts must not import runOpenClaw from @/lib/command"
    ).not.toMatch(/from\s+['"]@\/lib\/command['"]/)
  })

  it("must call callOpenClawGatewayWS('agent', …) for the spawn step", () => {
    const src = readFileSync(ROUTE_PATH, 'utf8')

    expect(
      src,
      'pipelines/run/route.ts must use the gateway WS agent method for the spawn step'
    ).toMatch(/callOpenClawGatewayWS\s*<[^>]*>\s*\(\s*['"]agent['"]/)
  })

  it('must pass a deterministic idempotencyKey scoped to (runId, stepIdx)', () => {
    const src = readFileSync(ROUTE_PATH, 'utf8')

    // The key shape is `pipeline-${runId}-step-${stepIdx}` so that retrying a
    // failed step does not enqueue a duplicate gateway run.
    expect(
      src,
      'pipelines/run/route.ts must build a deterministic idempotencyKey'
    ).toMatch(/idempotencyKey\s*:\s*`pipeline-\$\{runId\}-step-\$\{stepIdx\}`/)
  })

  it('must preserve the gateway-side timeout via params.timeout (in seconds)', () => {
    const src = readFileSync(ROUTE_PATH, 'utf8')

    // The CLI used `--timeout SEC`; the WS schema's AgentParams.timeout
    // field is also seconds. Migration must continue to honour the
    // template's per-step timeout, not silently drop it onto the host
    // 15-second wait limit.
    expect(
      src,
      'pipelines/run/route.ts must forward template.timeout_seconds to the WS agent params.timeout'
    ).toMatch(/timeout\s*:\s*template\.timeout_seconds/)
  })

  it('must keep the host-side wait limit at 15000 ms', () => {
    const src = readFileSync(ROUTE_PATH, 'utf8')

    // The host's `await` budget must match the previous behaviour so the
    // pipeline run loop's progress timing does not change.
    expect(
      src,
      'pipelines/run/route.ts must pass timeoutMs: 15000 to callOpenClawGatewayWS'
    ).toMatch(/callOpenClawGatewayWS[\s\S]{0,300}timeoutMs\s*:\s*15000/)
  })
})
