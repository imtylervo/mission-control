import { runOpenClaw } from './command'
import { config } from './config'
import {
  parseOpenClawDoctorOutput,
  type OpenClawDoctorStatus,
} from './openclaw-doctor'

export const DEFAULT_DOCTOR_CACHE_TTL_MS = 30_000
export const DOCTOR_PROBE_TIMEOUT_MS = 15_000

export class OpenClawNotReachableError extends Error {
  constructor(message = 'OpenClaw is not installed or not reachable') {
    super(message)
    this.name = 'OpenClawNotReachableError'
  }
}

export interface CachedDoctorResult {
  status: OpenClawDoctorStatus
  cached: boolean
  ageMs: number
  nextRefreshAfterMs: number
}

interface CacheEntry {
  status: OpenClawDoctorStatus
  fetchedAt: number
}

interface DoctorRunnerResult {
  stdout: string
  stderr: string
  code: number | null
}

type DoctorRunner = (
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<DoctorRunnerResult>

interface FetchOptions {
  ttlMs?: number
  now?: () => number
  runner?: DoctorRunner
  stateDir?: string
}

let entry: CacheEntry | null = null
let inflight: Promise<CacheEntry> | null = null

function isMissingOpenClaw(detail: string): boolean {
  return /enoent|not installed|not reachable|command not found/i.test(detail)
}

async function fetchFresh(opts: FetchOptions): Promise<CacheEntry> {
  const runner = opts.runner ?? runOpenClaw
  const stateDir = opts.stateDir ?? config.openclawStateDir
  const now = opts.now ?? Date.now

  try {
    const result = await runner(['doctor'], { timeoutMs: DOCTOR_PROBE_TIMEOUT_MS })
    const status = parseOpenClawDoctorOutput(
      `${result.stdout}\n${result.stderr}`,
      result.code ?? 0,
      { stateDir }
    )
    return { status, fetchedAt: now() }
  } catch (error) {
    const err = error as {
      stdout?: string
      stderr?: string
      message?: string
      code?: number | string | null
    }
    const detail = [err?.stdout, err?.stderr, err?.message]
      .filter(Boolean)
      .join('\n')
      .trim()

    if (isMissingOpenClaw(detail)) {
      throw new OpenClawNotReachableError()
    }

    const code = typeof err?.code === 'number' ? err.code : 1
    const status = parseOpenClawDoctorOutput(detail, code, { stateDir })
    return { status, fetchedAt: now() }
  }
}

export async function getCachedDoctorStatus(
  opts: FetchOptions = {}
): Promise<CachedDoctorResult> {
  const ttl = opts.ttlMs ?? DEFAULT_DOCTOR_CACHE_TTL_MS
  const now = opts.now ?? Date.now
  const t0 = now()

  if (entry && t0 - entry.fetchedAt < ttl) {
    return {
      status: entry.status,
      cached: true,
      ageMs: t0 - entry.fetchedAt,
      nextRefreshAfterMs: Math.max(0, ttl - (t0 - entry.fetchedAt)),
    }
  }

  if (!inflight) {
    inflight = (async () => {
      try {
        const fresh = await fetchFresh(opts)
        entry = fresh
        return fresh
      } finally {
        inflight = null
      }
    })()
  }

  const fresh = await inflight
  const t1 = now()
  return {
    status: fresh.status,
    cached: false,
    ageMs: t1 - fresh.fetchedAt,
    nextRefreshAfterMs: Math.max(0, ttl - (t1 - fresh.fetchedAt)),
  }
}

export function setDoctorCache(
  status: OpenClawDoctorStatus,
  fetchedAt: number = Date.now()
): void {
  entry = { status, fetchedAt }
}

export function invalidateDoctorCache(): void {
  entry = null
}

export function _resetDoctorCacheForTests(): void {
  entry = null
  inflight = null
}
