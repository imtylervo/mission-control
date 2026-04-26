/**
 * Tests for src/lib/openclaw-gateway-ws.ts (PR #608 fix).
 *
 * Uses an in-memory mock WebSocket constructor instead of a real `ws` server
 * so the suite stays hermetic and fast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GatewayCallError,
  GatewayEmptyResponseError,
  callGatewayAgentForText,
  callOpenClawGatewayWS,
} from '@/lib/openclaw-gateway-ws'

// ---------------------------------------------------------------------------
// Minimal mock WebSocket — supports the subset of the `ws` API we use:
//   - constructor(url, { headers })
//   - .on('open' | 'message' | 'error' | 'close', cb)
//   - .send(data)
//   - .close()
// ---------------------------------------------------------------------------

type Listener = (...args: any[]) => void

interface MockWebSocketLike {
  emit(event: string, ...args: any[]): void
}

interface MockWsBehaviour {
  /** Called when the client sends a frame. Return null to send no reply. */
  onSend?: (frame: any, ws: MockWebSocketLike) => any | any[] | null
  /** If set, fail the open event after delayMs to simulate connection error. */
  failOpen?: { delayMs: number; message: string }
  /** Track headers passed to the ctor (for auth assertions). */
  capturedHeaders?: { current?: Record<string, string> }
  /** Track URL passed to the ctor. */
  capturedUrl?: { current?: string }
}

function makeMockWebSocket(behaviour: MockWsBehaviour) {
  class MockWebSocket {
    private listeners = new Map<string, Listener[]>()

    constructor(url: string, opts?: { headers?: Record<string, string> }) {
      if (behaviour.capturedUrl) behaviour.capturedUrl.current = url
      if (behaviour.capturedHeaders) behaviour.capturedHeaders.current = opts?.headers
      // Trigger lifecycle events on the next microtask so the caller can
      // attach listeners first.
      queueMicrotask(() => {
        if (behaviour.failOpen) {
          setTimeout(() => this.emit('error', new Error(behaviour.failOpen!.message)), behaviour.failOpen.delayMs)
          return
        }
        this.emit('open')
      })
    }

    on(event: string, cb: Listener) {
      const list = this.listeners.get(event) ?? []
      list.push(cb)
      this.listeners.set(event, list)
    }

    emit(event: string, ...args: any[]) {
      const list = this.listeners.get(event) ?? []
      for (const cb of list) cb(...args)
    }

    send(data: string) {
      const frame = JSON.parse(data)
      const reply = behaviour.onSend?.(frame, this)
      if (reply == null) return
      const replies = Array.isArray(reply) ? reply : [reply]
      for (const r of replies) {
        // Deliver replies asynchronously to mimic real socket timing.
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify(r), 'utf8')))
      }
    }

    close() {
      // No-op for the happy path. Tests that need close-driven failure call
      // emit('close', ...) directly.
    }
  }
  return MockWebSocket as unknown as typeof import('ws').default
}

const FAKE_URL = 'ws://gateway.test:18789/ws'
const FAKE_TOKEN = 'tok-abc-123'

describe('callOpenClawGatewayWS — generic RPC', () => {
  it('completes a happy-path connect → method round-trip and returns result', async () => {
    const Mock = makeMockWebSocket({
      onSend(frame, ws) {
        if (frame.method === 'connect') {
          return { type: 'res', id: frame.id, ok: true, result: { sessionToken: 't' } }
        }
        if (frame.method === 'echo') {
          return { type: 'res', id: frame.id, ok: true, result: { echoed: frame.params } }
        }
        return null
      },
    })

    const result = await callOpenClawGatewayWS<{ echoed: { hello: string } }>(
      'echo',
      { hello: 'world' },
      { url: FAKE_URL, token: FAKE_TOKEN, webSocketCtor: Mock, timeoutMs: 1_000 }
    )

    expect(result).toEqual({ echoed: { hello: 'world' } })
  })

  it('attaches the bearer token as Authorization header when provided', async () => {
    const captured: { current?: Record<string, string> } = {}
    const Mock = makeMockWebSocket({
      capturedHeaders: captured,
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        return { type: 'res', id: frame.id, ok: true, result: { ack: true } }
      },
    })

    await callOpenClawGatewayWS('whatever', {}, {
      url: FAKE_URL,
      token: FAKE_TOKEN,
      webSocketCtor: Mock,
      timeoutMs: 500,
    })

    expect(captured.current?.Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
  })

  it('omits Authorization header when no token is configured', async () => {
    const captured: { current?: Record<string, string> } = {}
    const Mock = makeMockWebSocket({
      capturedHeaders: captured,
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        return { type: 'res', id: frame.id, ok: true, result: { ack: true } }
      },
    })

    await callOpenClawGatewayWS('whatever', {}, {
      url: FAKE_URL,
      token: '',
      webSocketCtor: Mock,
      timeoutMs: 500,
    })

    expect(captured.current?.Authorization).toBeUndefined()
  })

  it('propagates connect-frame rejection as GatewayCallError', async () => {
    const Mock = makeMockWebSocket({
      onSend(frame) {
        if (frame.method === 'connect') {
          return {
            type: 'res',
            id: frame.id,
            ok: false,
            error: { code: 'AUTH_FAILED', message: 'gateway connect rejected: bad token' },
          }
        }
        return null
      },
    })

    await expect(
      callOpenClawGatewayWS('echo', {}, {
        url: FAKE_URL,
        token: 'bogus',
        webSocketCtor: Mock,
        timeoutMs: 500,
      })
    ).rejects.toBeInstanceOf(GatewayCallError)
  })

  it('rejects with GatewayCallError on transport timeout', async () => {
    const Mock = makeMockWebSocket({
      onSend() {
        // Never respond → caller hits its timeout.
        return null
      },
    })

    await expect(
      callOpenClawGatewayWS('hang', {}, {
        url: FAKE_URL,
        token: FAKE_TOKEN,
        webSocketCtor: Mock,
        timeoutMs: 50,
      })
    ).rejects.toMatchObject({
      name: 'GatewayCallError',
      code: 'TIMEOUT',
    })
  })
})

describe('callGatewayAgentForText — high-level wrapper', () => {
  it('returns text + runId + sessionId from payloads[0].text shape', async () => {
    const Mock = makeMockWebSocket({
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        if (frame.method === 'agent') {
          return {
            type: 'res',
            id: frame.id,
            ok: true,
            result: {
              runId: 'run-1',
              payloads: [{ text: 'hello from agent' }],
              meta: { agentMeta: { sessionId: 'sess-99' } },
            },
          }
        }
        return null
      },
    })

    const out = await callGatewayAgentForText('agent-x', 'hi', {
      url: FAKE_URL,
      token: FAKE_TOKEN,
      webSocketCtor: Mock,
      timeoutMs: 1_000,
      idempotencyKey: 'idem-1',
    })

    expect(out.text).toBe('hello from agent')
    expect(out.runId).toBe('run-1')
    expect(out.sessionId).toBe('sess-99')
  })

  it('falls back to result.text when payloads is absent', async () => {
    const Mock = makeMockWebSocket({
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        return {
          type: 'res',
          id: frame.id,
          ok: true,
          result: { text: 'plain text fallback' },
        }
      },
    })

    const out = await callGatewayAgentForText('agent-y', 'hi', {
      url: FAKE_URL,
      token: FAKE_TOKEN,
      webSocketCtor: Mock,
    })

    expect(out.text).toBe('plain text fallback')
  })

  it('throws GatewayEmptyResponseError when result is lifecycle-only metadata', async () => {
    const Mock = makeMockWebSocket({
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        return {
          type: 'res',
          id: frame.id,
          ok: true,
          result: {
            runId: 'run-2',
            status: 'ok',
            startedAt: 1,
            endedAt: 2,
            // NOTE: no payloads, no text, no choices — exactly the #608 Bug 2 shape.
          },
        }
      },
    })

    await expect(
      callGatewayAgentForText('agent-z', 'hi', {
        url: FAKE_URL,
        token: FAKE_TOKEN,
        webSocketCtor: Mock,
      })
    ).rejects.toBeInstanceOf(GatewayEmptyResponseError)
  })

  it('sends deliver:true on the agent invoke frame (so payloads are populated)', async () => {
    let invokeParams: any = null
    const Mock = makeMockWebSocket({
      onSend(frame) {
        if (frame.method === 'connect') return { type: 'res', id: frame.id, ok: true, result: {} }
        if (frame.method === 'agent') {
          invokeParams = frame.params
          return {
            type: 'res',
            id: frame.id,
            ok: true,
            result: { payloads: [{ text: 'ok' }] },
          }
        }
        return null
      },
    })

    await callGatewayAgentForText('agent-a', 'hello', {
      url: FAKE_URL,
      token: FAKE_TOKEN,
      webSocketCtor: Mock,
      idempotencyKey: 'k',
      model: 'sonnet-4-6',
    })

    expect(invokeParams).toMatchObject({
      agentId: 'agent-a',
      message: 'hello',
      deliver: true,
      idempotencyKey: 'k',
      model: 'sonnet-4-6',
    })
  })
})
