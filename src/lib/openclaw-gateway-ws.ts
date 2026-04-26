/**
 * Native WebSocket client for the OpenClaw gateway — server-side (Node.js).
 *
 * Replaces shell-out via `runOpenClaw(['gateway', 'call', ...])` for the
 * dispatch paths that need the agent's full LLM response text. Built to
 * fix issue #608 in containerized Mission Control deployments where the
 * `openclaw` CLI binary is not on the MC image's PATH.
 *
 * Scope (per PR #3 design + Đào caveat): only the two dispatch paths in
 * `task-dispatch.ts` that require full text are migrated to this module.
 * Generic `callOpenClawGateway` callers (`channels/route.ts`, etc.)
 * continue using the legacy CLI wrapper for backward compatibility.
 *
 * Protocol mirrors the browser-side client in `src/lib/websocket.ts`:
 *   - v3 request/response frames `{type, id, method, params, result, error, ok}`
 *   - bearer-token auth via `Authorization` header (no device-auth — that's
 *     a browser-side security feature)
 *   - role `operator`, scopes `['operator.admin']`
 */

import WebSocket from 'ws'
import { config } from './config'
import { getDetectedGatewayToken } from './gateway-runtime'
import { logger } from './logger'

const PROTOCOL_VERSION = 3
const DEFAULT_TIMEOUT_MS = 30_000

interface ReqFrame {
  type: 'req'
  id: string
  method: string
  params: unknown
}

interface ResFrame {
  type: 'res'
  id: string
  ok: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}

interface AnyFrame {
  type?: string
  id?: string
  ok?: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}

export class GatewayCallError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GatewayCallError'
    this.code = code
  }
}

export class GatewayEmptyResponseError extends Error {
  constructor(message = 'Agent returned empty response') {
    super(message)
    this.name = 'GatewayEmptyResponseError'
  }
}

interface CallOpenClawGatewayWSOptions {
  timeoutMs?: number
  /** Override the gateway URL (mostly for tests). Defaults to config host/port. */
  url?: string
  /** Override the bearer token (mostly for tests). Defaults to getDetectedGatewayToken(). */
  token?: string
  /** Override the WebSocket constructor (mostly for tests). */
  webSocketCtor?: typeof WebSocket
}

function gatewayWsUrl(override?: string): string {
  if (override) return override
  return `ws://${config.gatewayHost}:${config.gatewayPort}/ws`
}

function nextRequestId(): string {
  return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Generic single-RPC call. Opens a fresh WS connection, sends `connect` then
 * the requested method, awaits the matching response, closes.
 *
 * Not optimised for high throughput — each call is a connection. The dispatch
 * paths that use this run at most a handful of times per task, so a fresh
 * connection per call is cleaner than maintaining a long-lived shared socket.
 */
export async function callOpenClawGatewayWS<T = unknown>(
  method: string,
  params: unknown,
  opts: CallOpenClawGatewayWSOptions = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = gatewayWsUrl(opts.url)
  const token = opts.token ?? getDetectedGatewayToken() ?? ''
  const Ctor = opts.webSocketCtor ?? WebSocket

  return new Promise<T>((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const ws = new Ctor(url, { headers })

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }

    const timeoutTimer = setTimeout(() => {
      settle(() => reject(new GatewayCallError(`gateway WS call timed out after ${timeoutMs}ms (${method})`, 'TIMEOUT')))
    }, timeoutMs)

    let connectId = ''
    let methodId = ''
    let connectAcknowledged = false

    ws.on('open', () => {
      connectId = nextRequestId()
      const connectFrame: ReqFrame = {
        type: 'req',
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: 'mission-control-server',
            displayName: 'Mission Control (server)',
            version: '0',
            platform: 'node',
            mode: 'service',
            instanceId: `mc-srv-${Date.now()}`,
          },
          role: 'operator',
          scopes: ['operator.admin'],
          auth: token ? { token } : undefined,
        },
      }
      try {
        ws.send(JSON.stringify(connectFrame))
      } catch (err) {
        clearTimeout(timeoutTimer)
        settle(() => reject(new GatewayCallError(`failed to send connect frame: ${(err as Error).message}`)))
      }
    })

    ws.on('message', (raw: Buffer | string) => {
      let frame: AnyFrame
      try {
        frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
      } catch {
        return // ignore malformed frames; pings/non-JSON noise
      }

      if (frame?.type === 'res' && frame.id === connectId) {
        if (!frame.ok) {
          clearTimeout(timeoutTimer)
          settle(() =>
            reject(
              new GatewayCallError(
                `gateway connect rejected: ${frame.error?.message ?? 'unknown'}`,
                frame.error?.code
              )
            )
          )
          return
        }
        connectAcknowledged = true
        methodId = nextRequestId()
        const methodFrame: ReqFrame = {
          type: 'req',
          id: methodId,
          method,
          params,
        }
        try {
          ws.send(JSON.stringify(methodFrame))
        } catch (err) {
          clearTimeout(timeoutTimer)
          settle(() => reject(new GatewayCallError(`failed to send ${method} frame: ${(err as Error).message}`)))
        }
        return
      }

      if (frame?.type === 'res' && frame.id === methodId) {
        clearTimeout(timeoutTimer)
        if (!frame.ok) {
          settle(() =>
            reject(new GatewayCallError(frame.error?.message ?? `gateway ${method} call failed`, frame.error?.code))
          )
          return
        }
        settle(() => resolve(frame.result as T))
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timeoutTimer)
      settle(() => reject(new GatewayCallError(`gateway WS error: ${err.message}`)))
    })

    ws.on('close', (code: number, reason: Buffer) => {
      if (settled) return
      clearTimeout(timeoutTimer)
      const reasonStr = reason?.toString('utf8') || ''
      const stage = connectAcknowledged ? `during ${method}` : 'before connect ack'
      settle(() =>
        reject(
          new GatewayCallError(
            `gateway WS closed unexpectedly ${stage} (code=${code}${reasonStr ? `, reason=${reasonStr}` : ''})`
          )
        )
      )
    })
  })
}

export interface AgentRunResult {
  text: string
  runId?: string
  sessionId?: string
}

interface AgentInvokeParams {
  agentId: string
  message: string
  idempotencyKey?: string
  model?: string
  /** Should always be true here so the agent.wait result includes payloads. */
  deliver: true
}

/**
 * Extracts the agent's response text from an agent-run result payload.
 *
 * The OpenClaw gateway may return the run result in a few shapes:
 *   - `result.payloads[0].text` (canonical when deliver:true)
 *   - `result.text` (some agent variants)
 *   - `result.choices[0].message.content` (OpenAI-compat normalised path)
 *
 * If none of these contain a non-empty string, the result is treated as a
 * lifecycle-only response and `GatewayEmptyResponseError` is thrown.
 */
function extractAgentText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const r = result as Record<string, unknown>

  if (Array.isArray(r.payloads) && r.payloads.length > 0) {
    const p0 = r.payloads[0] as Record<string, unknown> | undefined
    const payloadText = typeof p0?.text === 'string' ? p0.text : ''
    if (payloadText) return payloadText
  }

  if (typeof r.text === 'string' && r.text) return r.text

  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const c0 = r.choices[0] as Record<string, unknown> | undefined
    const message = c0?.message as Record<string, unknown> | undefined
    const content = typeof message?.content === 'string' ? message.content : ''
    if (content) return content
  }

  return ''
}

function extractRunMetadata(result: unknown): { runId?: string; sessionId?: string } {
  if (!result || typeof result !== 'object') return {}
  const r = result as Record<string, unknown>
  const runId = typeof r.runId === 'string' ? r.runId : undefined
  const meta = (r.meta as Record<string, unknown> | undefined) ?? {}
  const agentMeta = (meta?.agentMeta as Record<string, unknown> | undefined) ?? {}
  const sessionId = typeof agentMeta?.sessionId === 'string' ? agentMeta.sessionId : undefined
  return { runId, sessionId }
}

/**
 * High-level wrapper for the two task-dispatch paths that need the agent's
 * full LLM response text.
 *
 * Throws:
 *   - `GatewayCallError` on transport/timeout/auth failure
 *   - `GatewayEmptyResponseError` when the gateway returns lifecycle-only
 *     metadata (no payloads, no text). Caller decides retry/fail policy.
 */
export async function callGatewayAgentForText(
  agentId: string,
  message: string,
  opts: {
    timeoutMs?: number
    idempotencyKey?: string
    model?: string
    url?: string
    token?: string
    webSocketCtor?: typeof WebSocket
  } = {}
): Promise<AgentRunResult> {
  const params: AgentInvokeParams = {
    agentId,
    message,
    deliver: true,
  }
  if (opts.idempotencyKey) params.idempotencyKey = opts.idempotencyKey
  if (opts.model) params.model = opts.model

  const result = await callOpenClawGatewayWS<unknown>('agent', params, {
    timeoutMs: opts.timeoutMs,
    url: opts.url,
    token: opts.token,
    webSocketCtor: opts.webSocketCtor,
  })

  const text = extractAgentText(result)
  if (!text) {
    logger.warn(
      { agentId, resultKeys: result && typeof result === 'object' ? Object.keys(result) : null },
      'Gateway agent run returned no text (likely lifecycle-only response)'
    )
    throw new GatewayEmptyResponseError()
  }

  const { runId, sessionId } = extractRunMetadata(result)
  return { text, runId, sessionId }
}
