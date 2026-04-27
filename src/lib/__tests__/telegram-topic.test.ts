import { describe, expect, it } from 'vitest'
import {
  buildTelegramTopicRef,
  parseTelegramTopicRef,
  buildTelegramDeepLink,
  sanitizeTelegramPayloadForLog,
  extractTelegramContextFromHeaders,
} from '@/lib/telegram-topic'

const TYLER_AI_TEAM = -1003656139138
const TOPIC_HQ = 1

describe('buildTelegramTopicRef', () => {
  it('builds a 3-segment token without messageId', () => {
    expect(buildTelegramTopicRef({ chatId: TYLER_AI_TEAM, topicId: TOPIC_HQ }))
      .toBe(`tg:${TYLER_AI_TEAM}:${TOPIC_HQ}`)
  })

  it('builds a 4-segment token with messageId', () => {
    expect(buildTelegramTopicRef({ chatId: TYLER_AI_TEAM, topicId: TOPIC_HQ, messageId: 42 }))
      .toBe(`tg:${TYLER_AI_TEAM}:${TOPIC_HQ}:42`)
  })

  it('treats explicit null/undefined messageId as omitted', () => {
    expect(buildTelegramTopicRef({ chatId: TYLER_AI_TEAM, topicId: TOPIC_HQ, messageId: undefined }))
      .toBe(`tg:${TYLER_AI_TEAM}:${TOPIC_HQ}`)
  })
})

describe('parseTelegramTopicRef', () => {
  it('parses a 3-segment token', () => {
    expect(parseTelegramTopicRef(`tg:${TYLER_AI_TEAM}:${TOPIC_HQ}`))
      .toEqual({ chatId: TYLER_AI_TEAM, topicId: TOPIC_HQ })
  })

  it('parses a 4-segment token with messageId', () => {
    expect(parseTelegramTopicRef(`tg:${TYLER_AI_TEAM}:${TOPIC_HQ}:42`))
      .toEqual({ chatId: TYLER_AI_TEAM, topicId: TOPIC_HQ, messageId: 42 })
  })

  it('returns null for missing prefix', () => {
    expect(parseTelegramTopicRef('-1003656139138:1:42')).toBeNull()
    expect(parseTelegramTopicRef('not-a-ref')).toBeNull()
  })

  it('returns null when chat or topic is non-integer', () => {
    expect(parseTelegramTopicRef('tg:abc:1')).toBeNull()
    expect(parseTelegramTopicRef('tg:-1003656139138:cd')).toBeNull()
    expect(parseTelegramTopicRef('tg:1.5:1')).toBeNull()
  })

  it('returns null when fewer than 2 segments after prefix', () => {
    expect(parseTelegramTopicRef('tg:')).toBeNull()
    expect(parseTelegramTopicRef('tg:-1003656139138')).toBeNull()
  })

  it('ignores trailing garbage after messageId (forward-compat)', () => {
    expect(parseTelegramTopicRef('tg:-1003656139138:1:42:future-segment'))
      .toEqual({ chatId: -1003656139138, topicId: 1, messageId: 42 })
  })

  it('drops a malformed messageId but keeps chat+topic', () => {
    expect(parseTelegramTopicRef('tg:-1003656139138:1:not-a-msg'))
      .toEqual({ chatId: -1003656139138, topicId: 1 })
  })

  it('rejects non-string input', () => {
    expect(parseTelegramTopicRef(null as any)).toBeNull()
    expect(parseTelegramTopicRef(42 as any)).toBeNull()
  })
})

describe('buildTelegramDeepLink', () => {
  it('builds a topic-root link for a supergroup chatId', () => {
    expect(buildTelegramDeepLink({ chatId: -1003656139138, topicId: 1 }))
      .toBe('https://t.me/c/3656139138/1')
  })

  it('builds an anchor-message link when messageId is provided', () => {
    expect(buildTelegramDeepLink({ chatId: -1003656139138, topicId: 546, messageId: 42 }))
      .toBe('https://t.me/c/3656139138/546/42')
  })

  it('returns null for a non-supergroup chatId (positive number = DM/group)', () => {
    expect(buildTelegramDeepLink({ chatId: 330693121, topicId: 1 })).toBeNull()
  })

  it('returns null for a chatId without -100 prefix', () => {
    expect(buildTelegramDeepLink({ chatId: -100, topicId: 1 })).toBeNull()
    expect(buildTelegramDeepLink({ chatId: -123456, topicId: 1 })).toBeNull()
  })

  it('returns null for a non-integer chatId', () => {
    expect(buildTelegramDeepLink({ chatId: 1.5 as any, topicId: 1 })).toBeNull()
  })
})

describe('sanitizeTelegramPayloadForLog', () => {
  it('strips message body, sender, attachments — keeps IDs and emits tg_ref', () => {
    const payload = {
      chat_id: -1003656139138,
      message_thread_id: 1,
      message_id: 42,
      text: 'PRIVATE MESSAGE BODY DO NOT LEAK',
      from: { id: 330693121, username: 'tylervo', first_name: 'Tyler' },
      photo: 'https://t.me/photo/abc',
      caption: 'caption with secrets',
    }
    const sanitized = sanitizeTelegramPayloadForLog(payload)
    expect(sanitized).toEqual({
      tg_ref: 'tg:-1003656139138:1:42',
      chatId: -1003656139138,
      topicId: 1,
      messageId: 42,
    })
    // Confirm none of the secret fields leaked.
    const json = JSON.stringify(sanitized)
    expect(json).not.toContain('PRIVATE')
    expect(json).not.toContain('tylervo')
    expect(json).not.toContain('caption')
    expect(json).not.toContain('photo')
  })

  it('accepts the {chatId, topicId, messageId} shape too', () => {
    const sanitized = sanitizeTelegramPayloadForLog({
      chatId: -1003656139138,
      topicId: 1,
      messageId: 42,
      text: 'leak this if buggy',
    })
    expect(sanitized?.tg_ref).toBe('tg:-1003656139138:1:42')
    expect(JSON.stringify(sanitized)).not.toContain('leak this')
  })

  it('omits messageId when source has no message_id', () => {
    const sanitized = sanitizeTelegramPayloadForLog({
      chat_id: -1003656139138,
      message_thread_id: 1,
    })
    expect(sanitized).toEqual({
      tg_ref: 'tg:-1003656139138:1',
      chatId: -1003656139138,
      topicId: 1,
    })
    expect((sanitized as any).messageId).toBeUndefined()
  })

  it('returns null when chat or topic is missing/invalid', () => {
    expect(sanitizeTelegramPayloadForLog({ chat_id: 'abc', message_thread_id: 1 })).toBeNull()
    expect(sanitizeTelegramPayloadForLog({ chat_id: -1003656139138 })).toBeNull()
    expect(sanitizeTelegramPayloadForLog({})).toBeNull()
    expect(sanitizeTelegramPayloadForLog(null)).toBeNull()
    expect(sanitizeTelegramPayloadForLog('a string' as any)).toBeNull()
  })

  it('coerces string-typed numeric ids into numbers', () => {
    const sanitized = sanitizeTelegramPayloadForLog({
      chat_id: '-1003656139138',
      message_thread_id: '1',
      message_id: '42',
    })
    expect(sanitized).toEqual({
      tg_ref: 'tg:-1003656139138:1:42',
      chatId: -1003656139138,
      topicId: 1,
      messageId: 42,
    })
  })
})

describe('extractTelegramContextFromHeaders', () => {
  function mkHeaders(map: Record<string, string>) {
    return {
      get(name: string) {
        const lower = name.toLowerCase()
        for (const [k, v] of Object.entries(map)) {
          if (k.toLowerCase() === lower) return v
        }
        return null
      },
    }
  }

  it('extracts full context when all 3 headers are present', () => {
    const ctx = extractTelegramContextFromHeaders(
      mkHeaders({
        'X-Telegram-Chat-Id': '-1003656139138',
        'X-Telegram-Topic-Id': '1',
        'X-Telegram-Message-Id': '42',
      }),
    )
    expect(ctx).toEqual({
      tg_ref: 'tg:-1003656139138:1:42',
      chatId: -1003656139138,
      topicId: 1,
      messageId: 42,
    })
  })

  it('returns context without messageId when message-id header is missing', () => {
    const ctx = extractTelegramContextFromHeaders(
      mkHeaders({
        'X-Telegram-Chat-Id': '-1003656139138',
        'X-Telegram-Topic-Id': '1',
      }),
    )
    expect(ctx).toEqual({
      tg_ref: 'tg:-1003656139138:1',
      chatId: -1003656139138,
      topicId: 1,
    })
  })

  it('returns null when chat-id header is absent', () => {
    expect(
      extractTelegramContextFromHeaders(mkHeaders({ 'X-Telegram-Topic-Id': '1' })),
    ).toBeNull()
  })

  it('returns null when topic-id header is absent', () => {
    expect(
      extractTelegramContextFromHeaders(mkHeaders({ 'X-Telegram-Chat-Id': '-1003656139138' })),
    ).toBeNull()
  })

  it('returns null for malformed numeric headers', () => {
    expect(
      extractTelegramContextFromHeaders(
        mkHeaders({
          'X-Telegram-Chat-Id': 'abc',
          'X-Telegram-Topic-Id': '1',
        }),
      ),
    ).toBeNull()
  })
})
