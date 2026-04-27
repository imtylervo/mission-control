import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('registerMcAsDashboard', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let configPath = ''

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-gateway-runtime-'))
    configPath = path.join(tempDir, 'openclaw.json')
    process.env = { ...originalEnv }

    const { config } = await import('@/lib/config')
    config.openclawConfigPath = configPath
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('adds the Mission Control origin without disabling device auth', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: {
        controlUi: {
          allowedOrigins: ['https://existing.example.com'],
          dangerouslyDisableDeviceAuth: false,
        },
      },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://mc.example.com/dashboard')

    expect(result).toEqual({ registered: true, alreadySet: false })

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'https://existing.example.com',
      'https://mc.example.com',
    ])
    expect(updated.gateway.controlUi.dangerouslyDisableDeviceAuth).toBe(false)
  })

  it('does not rewrite config when the origin is already present', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: {
        controlUi: {
          allowedOrigins: ['https://mc.example.com'],
          dangerouslyDisableDeviceAuth: false,
        },
      },
    }, null, 2) + '\n', 'utf-8')

    const before = readFileSync(configPath, 'utf-8')
    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://mc.example.com/sessions')
    const after = readFileSync(configPath, 'utf-8')

    expect(result).toEqual({ registered: false, alreadySet: true })
    expect(after).toBe(before)
  })

  /*
   * Phase 2.2 / PR #25 — dual-origin registration.
   *
   * When MC is reached at one local form (e.g. http://localhost:3000) the
   * other form (http://127.0.0.1:3000) is treated as a different origin by
   * browsers and the gateway's exact-string allowlist match. So MC's
   * auto-registration must cover BOTH forms, idempotently, on the same
   * protocol + port. Tests below pin the contract.
   */

  it('registers BOTH localhost and 127.0.0.1 forms when only localhost is requested', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: [] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://localhost:3000')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
  })

  it('registers BOTH forms when only 127.0.0.1 is requested (symmetric)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: [] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://127.0.0.1:3000')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ])
  })

  it('only adds the missing peer when one local form is already present (idempotence)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: ['http://localhost:3000'] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://localhost:3000')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
  })

  it('does not rewrite when BOTH local forms are already present (full idempotence)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: {
        controlUi: {
          allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        },
      },
    }, null, 2) + '\n', 'utf-8')

    const before = readFileSync(configPath, 'utf-8')
    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://localhost:3000')
    const after = readFileSync(configPath, 'utf-8')

    expect(result).toEqual({ registered: false, alreadySet: true })
    expect(after).toBe(before)
  })

  it('preserves protocol and port when deriving the peer (https + non-default port)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: [] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://localhost:8443/dashboard')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'https://localhost:8443',
      'https://127.0.0.1:8443',
    ])
  })

  it('does NOT swap when port differs (peer is per-port, not host-only)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: ['http://localhost:3001'] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://localhost:3000')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'http://localhost:3001',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
  })

  it('does NOT broaden beyond localhost ↔ 127.0.0.1 (foreign hostnames have no peer, host.docker.internal deferred)', async () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { controlUi: { allowedOrigins: [] } },
    }, null, 2) + '\n', 'utf-8')

    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('http://host.docker.internal:3000')

    expect(result).toEqual({ registered: true, alreadySet: false })
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'))
    // Only the requested origin lands; no synthesised localhost or 127 peer.
    expect(updated.gateway.controlUi.allowedOrigins).toEqual([
      'http://host.docker.internal:3000',
    ])
  })
})
