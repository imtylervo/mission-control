/**
 * Phase 5.3 — Telegram topic-aware log helpers.
 *
 * The Tyler AI Team Telegram supergroup organizes work by topic
 * (Mission Control, DEV, Income Lab, Ops/Logs). Many actions an agent
 * takes (start a task, wake an agent, post a status) originate from a
 * specific message in a specific topic. Today the activity-log records
 * generally don't capture WHERE the request came from on Telegram, so an
 * operator scanning logs cannot trace back to the chat context.
 *
 * This module provides PURE helpers (no I/O) for:
 *
 *   1. Building a stable topic-reference token to embed in activity-log
 *      `detail` fields. Format: "tg:CHAT:TOPIC[:MSG]" — short, greppable,
 *      forward-compatible.
 *   2. Parsing the same token back into structured fields.
 *   3. Building the public/private deep-link URL the dashboard can use
 *      to "Open in Telegram".
 *   4. Sanitizing a Telegram payload for log storage — keeping IDs only,
 *      stripping message body, sender name, attachment URLs.
 *
 * No DB migration is introduced here. The token is a string that fits
 * inside any existing TEXT column (activity_log.detail, audit, etc.).
 *
 * Privacy invariant (per Đào msg 1697): NO raw private log dumps. The
 * sanitizer is the contract surface; consumers must run the sanitizer
 * before persisting any portion of a Telegram payload to the
 * activity-log columns.
 */

export interface TelegramTopicRef {
  chatId: number      // negative supergroup id, e.g. -1003656139138
  topicId: number     // 1 = General; >= 2 = real topic
  messageId?: number  // optional anchor message inside the topic
}

/**
 * Build a stable token to embed in audit-log detail fields. The token is
 * forward-compatible: a future entry that adds e.g. an action-id segment
 * keeps the leading "tg:CHAT:TOPIC" prefix unchanged so existing parsers
 * keep working.
 *
 *   buildTelegramTopicRef({ chatId: -1003656139138, topicId: 1 })
 *     → "tg:-1003656139138:1"
 *   buildTelegramTopicRef({ chatId: -1003656139138, topicId: 1, messageId: 42 })
 *     → "tg:-1003656139138:1:42"
 *
 * The chatId may be negative; that is fine inside the colon-delimited
 * token. Caller is responsible for validating that the chatId / topicId
 * are real numbers — `buildTelegramTopicRef` does not range-check.
 */
export function buildTelegramTopicRef(ref: TelegramTopicRef): string {
  const head = `tg:${ref.chatId}:${ref.topicId}`
  return ref.messageId !== undefined && ref.messageId !== null
    ? `${head}:${ref.messageId}`
    : head
}

/**
 * Parse a "tg:CHAT:TOPIC[:MSG]" token back into its fields. Returns null
 * for any malformed input (wrong prefix, missing topic, non-numeric
 * pieces). Forward-compatible: extra trailing segments after MSG are
 * ignored, not rejected.
 *
 *   parseTelegramTopicRef("tg:-1003656139138:1:42")
 *     → { chatId: -1003656139138, topicId: 1, messageId: 42 }
 *   parseTelegramTopicRef("tg:-1003656139138:1")
 *     → { chatId: -1003656139138, topicId: 1 }
 *   parseTelegramTopicRef("not-a-ref") → null
 */
export function parseTelegramTopicRef(ref: string): TelegramTopicRef | null {
  if (typeof ref !== 'string') return null
  if (!ref.startsWith('tg:')) return null
  const parts = ref.slice(3).split(':')
  if (parts.length < 2) return null

  const chatId = Number(parts[0])
  const topicId = Number(parts[1])
  if (!Number.isFinite(chatId) || !Number.isFinite(topicId)) return null
  if (!Number.isInteger(chatId) || !Number.isInteger(topicId)) return null

  if (parts.length === 2) {
    return { chatId, topicId }
  }

  const messageId = Number(parts[2])
  if (!Number.isFinite(messageId) || !Number.isInteger(messageId)) {
    return { chatId, topicId }  // ignore garbage trailing segments
  }
  return { chatId, topicId, messageId }
}

/**
 * Build a deep link the dashboard can render as an "Open in Telegram"
 * button. Telegram private supergroup links are of the form:
 *
 *   https://t.me/c/<NUMERIC_ID>/<TOPIC_ID>           — topic root
 *   https://t.me/c/<NUMERIC_ID>/<TOPIC_ID>/<MSG_ID>  — anchor message
 *
 * The numeric id used in the URL is the supergroup id WITHOUT the
 * leading "-100" prefix (Telegram URL convention). For example chatId
 * `-1003656139138` becomes `3656139138` in the URL.
 *
 * Returns null when the chatId does not match the supergroup convention
 * (Telegram bot API only ever issues `-100*` chat ids for supergroups).
 */
export function buildTelegramDeepLink(ref: TelegramTopicRef): string | null {
  // Supergroup chat ids are negative and start with -100 followed by the
  // public numeric id. Drop the prefix for the t.me URL.
  if (!Number.isInteger(ref.chatId) || ref.chatId >= 0) return null
  const asString = String(ref.chatId)
  if (!asString.startsWith('-100')) return null
  const numericId = asString.slice(4)
  if (!numericId) return null

  const tail = ref.messageId !== undefined && ref.messageId !== null
    ? `/${ref.topicId}/${ref.messageId}`
    : `/${ref.topicId}`
  return `https://t.me/c/${numericId}${tail}`
}

/**
 * Sanitize an inbound Telegram payload for activity-log storage. Keeps
 * IDs (chat / topic / message), drops everything else (message body,
 * attachments, sender display name, file URLs, etc.). Returns a plain
 * record suitable for JSON-stringifying into a `detail` column.
 *
 * The redaction is allow-list based on purpose: anything we don't
 * explicitly recognize is dropped.
 */
export function sanitizeTelegramPayloadForLog(
  payload: unknown,
): { tg_ref: string; chatId: number; topicId: number; messageId?: number } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  // Accept several common shapes:
  //   { chat_id, message_thread_id, message_id }
  //   { chatId, topicId, messageId }
  const chatId =
    typeof p.chatId === 'number'
      ? p.chatId
      : typeof p.chat_id === 'number'
        ? p.chat_id
        : typeof p.chat_id === 'string'
          ? Number(p.chat_id)
          : NaN
  const topicId =
    typeof p.topicId === 'number'
      ? p.topicId
      : typeof p.message_thread_id === 'number'
        ? p.message_thread_id
        : typeof p.message_thread_id === 'string'
          ? Number(p.message_thread_id)
          : NaN
  const messageId =
    typeof p.messageId === 'number'
      ? p.messageId
      : typeof p.message_id === 'number'
        ? p.message_id
        : typeof p.message_id === 'string'
          ? Number(p.message_id)
          : undefined

  if (!Number.isInteger(chatId) || !Number.isInteger(topicId)) return null

  const msgClean = Number.isInteger(messageId) ? (messageId as number) : undefined

  const refStr = buildTelegramTopicRef({
    chatId,
    topicId,
    messageId: msgClean,
  })

  const out: { tg_ref: string; chatId: number; topicId: number; messageId?: number } = {
    tg_ref: refStr,
    chatId,
    topicId,
  }
  if (msgClean !== undefined) out.messageId = msgClean
  return out
}

/**
 * Phase 5.3 wire-in helper — read the Telegram context for a given
 * inbound HTTP request from `X-Telegram-Chat-Id`, `X-Telegram-Topic-Id`,
 * `X-Telegram-Message-Id` headers and return the sanitized record (or
 * `null` if the headers are absent / malformed).
 *
 * The header form is the contract surface for activity-log wire-ins:
 * Mission Control's Telegram bot bridge sends those headers when it
 * forwards an action originating from the chat. Other clients (CLI,
 * dashboard) that don't carry Telegram context just don't send the
 * headers, and `null` is the graceful fallback — no extra `tg_ref` is
 * stamped on the log row.
 *
 * Headers are case-insensitive per HTTP spec; the helper accepts the
 * standard `request.headers.get(name)` accessor used by Next.js
 * `NextRequest` and `Request`.
 */
export function extractTelegramContextFromHeaders(headers: {
  get(name: string): string | null
}): { tg_ref: string; chatId: number; topicId: number; messageId?: number } | null {
  const chatRaw = headers.get('x-telegram-chat-id')
  const topicRaw = headers.get('x-telegram-topic-id')
  const msgRaw = headers.get('x-telegram-message-id')

  if (!chatRaw || !topicRaw) return null

  return sanitizeTelegramPayloadForLog({
    chat_id: chatRaw,
    message_thread_id: topicRaw,
    message_id: msgRaw ?? undefined,
  })
}
