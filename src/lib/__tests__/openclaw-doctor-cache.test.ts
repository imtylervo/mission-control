import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DOCTOR_CACHE_TTL_MS,
  OpenClawNotReachableError,
  _resetDoctorCacheForTests,
  getCachedDoctorStatus,
  invalidateDoctorCache,
  setDoctorCache,
} from '@/lib/openclaw-doctor-cache'

const HEALTHY_OUTPUT = {
  stdout: 'No security warnings detected\nAll checks healthy',
  stderr: '',
  code: 0,
}

describe('openclaw-doctor-cache', () => {
  beforeEach(() => {
    _resetDoctorCacheForTests()
  })

  it('only spawns one runner invocation for N concurrent calls when cache is empty', async () => {
    let calls = 0
    const runner = async () => {
      calls += 1
      // Simulate subprocess latency so all 10 calls actually overlap.
      await new Promise(resolve => setTimeout(resolve, 25))
      return HEALTHY_OUTPUT
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        getCachedDoctorStatus({ runner, stateDir: '/tmp/openclaw' })
      )
    )

    expect(calls).toBe(1)
    expect(results).toHaveLength(10)
    expect(results.every(r => r.status.healthy)).toBe(true)
    // First-resolution batch is reported as not-cached (they all awaited the same fetch).
    expect(results.every(r => r.cached === false)).toBe(true)
  })

  it('returns cached result inside TTL window without re-running runner', async () => {
    let calls = 0
    let fakeNow = 1_000
    const runner = async () => {
      calls += 1
      return HEALTHY_OUTPUT
    }
    const now = () => fakeNow

    await getCachedDoctorStatus({ runner, now, ttlMs: 30_000, stateDir: '/tmp/openclaw' })
    fakeNow = 10_000 // 9s later — still within TTL
    const second = await getCachedDoctorStatus({
      runner,
      now,
      ttlMs: 30_000,
      stateDir: '/tmp/openclaw',
    })

    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
    expect(second.ageMs).toBe(9_000)
    expect(second.nextRefreshAfterMs).toBe(21_000)
  })

  it('refetches after TTL expires', async () => {
    let calls = 0
    let fakeNow = 1_000
    const runner = async () => {
      calls += 1
      return HEALTHY_OUTPUT
    }
    const now = () => fakeNow

    await getCachedDoctorStatus({ runner, now, ttlMs: 30_000, stateDir: '/tmp/openclaw' })
    fakeNow = 32_000 // 31s later — past TTL
    const second = await getCachedDoctorStatus({
      runner,
      now,
      ttlMs: 30_000,
      stateDir: '/tmp/openclaw',
    })

    expect(calls).toBe(2)
    expect(second.cached).toBe(false)
    expect(second.ageMs).toBeGreaterThanOrEqual(0)
    expect(second.nextRefreshAfterMs).toBeLessThanOrEqual(30_000)
  })

  it('invalidate forces the next call to refetch', async () => {
    let calls = 0
    const runner = async () => {
      calls += 1
      return HEALTHY_OUTPUT
    }

    await getCachedDoctorStatus({ runner, stateDir: '/tmp/openclaw' })
    invalidateDoctorCache()
    await getCachedDoctorStatus({ runner, stateDir: '/tmp/openclaw' })

    expect(calls).toBe(2)
  })

  it('does not cache when openclaw binary is missing — every call retries', async () => {
    let calls = 0
    const runner = async () => {
      calls += 1
      const err = new Error('spawn openclaw ENOENT') as Error & { code: string }
      err.code = 'ENOENT'
      throw err
    }

    await expect(
      getCachedDoctorStatus({ runner, stateDir: '/tmp/openclaw' })
    ).rejects.toBeInstanceOf(OpenClawNotReachableError)
    await expect(
      getCachedDoctorStatus({ runner, stateDir: '/tmp/openclaw' })
    ).rejects.toBeInstanceOf(OpenClawNotReachableError)

    expect(calls).toBe(2)
  })

  it('caches non-zero exit (warnings/errors) so banner stops re-spawning subprocesses', async () => {
    let calls = 0
    const runner = async () => {
      calls += 1
      const err = new Error('Command failed') as Error & {
        stdout: string
        stderr: string
        code: number
      }
      err.stdout = '- some.warning detected\nRun: openclaw doctor --fix'
      err.stderr = ''
      err.code = 1
      throw err
    }

    const first = await getCachedDoctorStatus({
      runner,
      stateDir: '/tmp/openclaw',
    })
    const second = await getCachedDoctorStatus({
      runner,
      stateDir: '/tmp/openclaw',
    })

    expect(calls).toBe(1)
    expect(first.status.healthy).toBe(false)
    expect(second.cached).toBe(true)
  })

  it('setDoctorCache populates cache (used by POST /doctor after fix)', async () => {
    let calls = 0
    const runner = async () => {
      calls += 1
      return HEALTHY_OUTPUT
    }

    setDoctorCache({
      level: 'healthy',
      category: 'general',
      healthy: true,
      summary: 'OpenClaw doctor reports a healthy configuration.',
      issues: [],
      canFix: false,
      raw: 'all good',
    })

    const result = await getCachedDoctorStatus({
      runner,
      stateDir: '/tmp/openclaw',
    })

    expect(calls).toBe(0)
    expect(result.cached).toBe(true)
    expect(result.status.healthy).toBe(true)
  })

  it('exposes a default TTL constant for callers', () => {
    expect(DEFAULT_DOCTOR_CACHE_TTL_MS).toBe(30_000)
  })
})
