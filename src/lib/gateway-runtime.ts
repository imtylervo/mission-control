import fs from 'node:fs'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

interface OpenClawGatewayConfig {
  gateway?: {
    auth?: {
      mode?: 'token' | 'password'
      token?: string
      password?: string
    }
    port?: number
    controlUi?: {
      allowedOrigins?: string[]
    }
  }
}

function readOpenClawConfig(): OpenClawGatewayConfig | null {
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(raw) as OpenClawGatewayConfig
  } catch {
    return null
  }
}

/**
 * PR #24 / Phase 2.2 diagnostic surface — return ONLY the allowed-origins
 * list from `~/.openclaw/openclaw.json#gateway.controlUi.allowedOrigins`,
 * without any other config (token, port, password). The caller is the
 * `/api/diagnostics/gateway-origin` route which compares this list to the
 * browser's actual origin and reports booleans (has_localhost, has_127,
 * mismatch) — never the raw values, since the allowlist may include
 * private hostnames operators consider sensitive.
 *
 * Returns `null` when the config file is missing or unreadable. Returns
 * an empty array when the field is present but empty.
 */
export function getGatewayAllowedOrigins(): string[] | null {
  const cfg = readOpenClawConfig()
  if (!cfg) return null
  const list = cfg.gateway?.controlUi?.allowedOrigins
  if (!Array.isArray(list)) return null
  return list.slice()
}

export function registerMcAsDashboard(mcUrl: string): { registered: boolean; alreadySet: boolean } {
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) {
    return { registered: false, alreadySet: false }
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, any>

    // Ensure nested structure
    if (!parsed.gateway) parsed.gateway = {}
    if (!parsed.gateway.controlUi) parsed.gateway.controlUi = {}

    const origin = new URL(mcUrl).origin
    const origins: string[] = parsed.gateway.controlUi.allowedOrigins || []
    const alreadyInOrigins = origins.includes(origin)

    if (alreadyInOrigins) {
      return { registered: false, alreadySet: true }
    }

    // Add MC origin to allowedOrigins only — do NOT touch dangerouslyDisableDeviceAuth.
    // MC authenticates via gateway token, but forcing device auth off is a security
    // downgrade that the operator should control, not Mission Control.
    origins.push(origin)
    parsed.gateway.controlUi.allowedOrigins = origins

    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n')
    logger.info({ origin }, 'Registered MC origin in gateway config')
    return { registered: true, alreadySet: false }
  } catch (err: any) {
    // Read-only filesystem (e.g. Docker read_only: true, or intentional mount) —
    // treat as a non-fatal skip rather than an error.
    if (err?.code === 'EROFS' || err?.code === 'EACCES' || err?.code === 'EPERM') {
      logger.warn(
        { err, configPath },
        'Gateway config is read-only — skipping MC origin registration. ' +
        'To enable auto-registration, mount openclaw.json with write access or ' +
        'add the MC origin to gateway.controlUi.allowedOrigins manually.',
      )
      return { registered: false, alreadySet: false }
    }
    logger.error({ err }, 'Failed to register MC in gateway config')
    return { registered: false, alreadySet: false }
  }
}

/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: OPENCLAW_GATEWAY_TOKEN, GATEWAY_TOKEN, OPENCLAW_GATEWAY_PASSWORD, GATEWAY_PASSWORD.
 * From config: uses gateway.auth.token when mode is "token", gateway.auth.password when mode is "password".
 */
export function getDetectedGatewayToken(): string {
  const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken
  
  const envPassword = (process.env.OPENCLAW_GATEWAY_PASSWORD || process.env.GATEWAY_PASSWORD || '').trim()
  if (envPassword) return envPassword

  const parsed = readOpenClawConfig()
  const auth = parsed?.gateway?.auth
  const mode = auth?.mode === 'password' ? 'password' : 'token'
  const credential =
    mode === 'password'
      ? String(auth?.password ?? '').trim()
      : String(auth?.token ?? '').trim()
  if (credential) {
    logger.debug('Gateway token loaded from openclaw.json (set OPENCLAW_GATEWAY_TOKEN env var to override)')
  }
  return credential
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.OPENCLAW_GATEWAY_PORT || process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort

  const parsed = readOpenClawConfig()
  const cfgPort = Number(parsed?.gateway?.port || 0)
  if (Number.isFinite(cfgPort) && cfgPort > 0) {
    logger.debug({ port: cfgPort }, 'Gateway port loaded from openclaw.json (set OPENCLAW_GATEWAY_PORT env var to override)')
    return cfgPort
  }
  return null
}
