/**
 * Injection Guard — prompt injection and command injection detection for Mission Control.
 *
 * Scans user input destined for AI agents, shell commands, or rendered UI.
 * Provides both a detection function and a Zod refinement for validation schemas.
 *
 * Three protection layers:
 * 1. Prompt injection — catches attempts to override system instructions
 * 2. Command injection — catches shell metacharacters and escape sequences
 * 3. Exfiltration — catches attempts to send data to external endpoints
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InjectionSeverity = 'info' | 'warning' | 'critical'
export type InjectionCategory = 'prompt' | 'command' | 'exfiltration' | 'encoding'

export interface InjectionMatch {
  category: InjectionCategory
  severity: InjectionSeverity
  rule: string
  description: string
  matched: string
}

export interface InjectionReport {
  safe: boolean
  matches: InjectionMatch[]
}

export interface GuardOptions {
  /** Only flag critical-severity matches as unsafe (default: false — warn + critical both trigger) */
  criticalOnly?: boolean
  /** Maximum input length to scan (default: 50_000 chars) */
  maxLength?: number
  /** Scan context: 'prompt' applies all rules; 'display' skips command injection; 'shell' focuses on command rules */
  context?: 'prompt' | 'display' | 'shell'
}

// ---------------------------------------------------------------------------
// Constants (PR #4 — Phase 2 #576 hardening, Layer 1)
// ---------------------------------------------------------------------------

/** Maximum input length scanned. Existing behavior, unchanged. */
export const MAX_LENGTH = 50_000

/** Maximum total candidates (raw + normalized + decoded) per scan. */
export const MAX_CANDIDATES = 8

/** Maximum recursion depth for decode passes. */
export const MAX_DEPTH = 2

/** Upper bound on a single base64 chunk we will attempt to decode. */
export const MAX_B64_CHUNK = 1024

/** Lower bound — base64 chunks shorter than this are ignored as noise. */
export const MIN_B64_CHUNK = 16

/** ROT13 decoder requires at least this many ASCII letters before activating. */
export const ROT13_MIN_LETTERS = 8

// ---------------------------------------------------------------------------
// Normalization helpers (PR #4 commit 1)
//
// Deterministic transform applied to user input before regex scanning.
// Pure functions, no I/O, no logging.
// ---------------------------------------------------------------------------

/** Strip null bytes and C0/C1 control characters except \t \n \r. */
export function stripControlChars(input: string): string {
  // C0 (U+0000–U+001F) minus tab/LF/CR + DEL (U+007F) + C1 (U+0080–U+009F)
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g, '')
}

/** Strip zero-width / format characters: ZWSP, ZWNJ, ZWJ, WJ, BOM. */
export function stripZeroWidth(input: string): string {
  return input.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
}

/**
 * Conservative confusables fold. Small curated map of the most commonly
 * abused Cyrillic, Greek, and long-s substitutions. Intentionally small
 * to avoid pulling Unicode TR39 and to bound false-positive risk.
 *
 * Only folds *visible* look-alikes that share the same canonical glyph
 * shape — does NOT fold semantically distinct letters even if visually similar.
 */
const CONFUSABLES_MAP: Record<string, string> = {
  // Cyrillic lowercase → Latin
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p',
  'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i',
  'ј': 'j', 'ѕ': 's',
  // Cyrillic uppercase → Latin
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P',
  'С': 'C', 'Х': 'X', 'І': 'I', 'Ј': 'J',
  'Ѕ': 'S', 'В': 'B', 'Н': 'H', 'К': 'K',
  'М': 'M', 'Т': 'T',
  // Greek lowercase → Latin
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v',
  'υ': 'u', 'χ': 'x',
  // Greek uppercase → Latin
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z',
  'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T',
  'Υ': 'Y', 'Χ': 'X',
  // Mathematical / fullwidth duplicates not covered cleanly by NFKC
  'ſ': 's', // long-s
}

/** Apply confusables map character-by-character. */
export function applyConfusablesFold(input: string): string {
  let out = ''
  for (const ch of input) {
    out += CONFUSABLES_MAP[ch] ?? ch
  }
  return out
}

// ---------------------------------------------------------------------------
// Decode strategies (PR #4 commit 2a — base64)
//
// Pure helpers. Bounded, fail-soft. Each returns an array of decoded
// candidates derived from substrings of the input. Wiring into
// scanForInjection happens in commit 3.
// ---------------------------------------------------------------------------

/**
 * Reserved slot count for raw + normalize candidates. The caller in commit 3
 * will scan raw + normalize() output as 2 always-on candidates; decoders may
 * emit at most MAX_CANDIDATES - DECODE_RESERVED additional ones so the total
 * candidate budget is preserved.
 */
const DECODE_RESERVED = 2

/** Maximum decoded candidates a single decoder may emit. */
export const DECODE_EMIT_CAP = MAX_CANDIDATES - DECODE_RESERVED // 6

/**
 * Validate that a decoded base64 chunk is plausibly *text*, not random binary
 * that happens to be printable.
 *
 * Returns true when:
 *   - decoded length >= 4
 *   - >= 95% of bytes are printable ASCII or newline/tab
 *   - round-trip: re-encoding the decoded bytes yields the original chunk
 *     (modulo missing trailing '=' padding)
 *
 * The round-trip is the strict gate that rejects permissive Buffer.from
 * pseudo-base64 strings (Đào caveat msg 1206 item 1): without it, a benign
 * URL slug can decode to garbage but appear printable.
 */
function isPlausibleBase64Text(chunk: string, decoded: string): boolean {
  if (decoded.length < 4) return false
  let nonPrintable = 0
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i)
    const printable =
      (c >= 0x20 && c <= 0x7E) || c === 0x09 || c === 0x0A || c === 0x0D
    if (!printable) nonPrintable++
  }
  if (nonPrintable / decoded.length > 0.05) return false

  // Round-trip check: re-encode the decoded bytes and compare against the
  // original chunk. The original may differ in trailing '=' padding count,
  // so we strip trailing '=' on both sides before comparing.
  const reEncoded = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '')
  const original = chunk.replace(/=+$/, '')
  return reEncoded === original
}

/**
 * Find every base64-shaped substring of length [MIN_B64_CHUNK, MAX_B64_CHUNK]
 * in `input`, decode each, and return the plausibly-textual decoded
 * candidates. Bounded by DECODE_EMIT_CAP.
 *
 * Pure, fail-soft: any throw or invalid result is silently dropped. The
 * function never throws and returns an empty array if no candidates pass.
 */
export function decodeBase64Chunks(input: string): string[] {
  if (!input || typeof input !== 'string') return []
  const out: string[] = []
  const seen = new Set<string>()
  // Match base64-shaped runs. The {4,1024} bound is the alphabet portion
  // only; the total chunk length (alphabet + optional '=' padding) is
  // gated separately by MIN_B64_CHUNK / MAX_B64_CHUNK so that a legitimate
  // 16-char encoded form like 'aGVsbG8td29ybGQ=' (15 alphabet + 1 pad)
  // is still accepted.
  const re = /[A-Za-z0-9+/]{4,1024}={0,2}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (out.length >= DECODE_EMIT_CAP) break
    const chunk = m[0]
    if (chunk.length < MIN_B64_CHUNK || chunk.length > MAX_B64_CHUNK) continue
    let decoded: string
    try {
      decoded = Buffer.from(chunk, 'base64').toString('utf8')
    } catch {
      continue
    }
    if (!isPlausibleBase64Text(chunk, decoded)) continue
    if (seen.has(decoded)) continue
    seen.add(decoded)
    out.push(decoded)
  }
  return out
}

/**
 * Apply ROT13 to ASCII letters in a string. Non-letters and non-ASCII
 * characters pass through unchanged. Pure utility used by decodeRot13.
 */
function applyRot13(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    if (c >= 0x41 && c <= 0x5A) {
      // 'A'..'Z'
      out += String.fromCharCode(((c - 0x41 + 13) % 26) + 0x41)
    } else if (c >= 0x61 && c <= 0x7A) {
      // 'a'..'z'
      out += String.fromCharCode(((c - 0x61 + 13) % 26) + 0x61)
    } else {
      out += input[i]
    }
  }
  return out
}

/**
 * Bigram patterns used as activation evidence for the ROT13 decoder.
 * If post-ROT13 input contains any of these whole-word matches, we treat
 * the input as plausibly ROT13-encoded English and emit the decoded form.
 *
 * Conservative on purpose — random English text rotated to ROT13 will not
 * accidentally surface these unless the original WAS plaintext English with
 * one of these words. False positives on legitimate English content are
 * acceptable: they decode the user's text into gibberish, which the
 * existing rule patterns will not match.
 */
const ROT13_TRIGGER_BIGRAMS = /\b(?:the|into|please|ignore)\b/i

/**
 * Decode a ROT13-rotated string. Whole-string transform.
 *
 * Activation gate (conservative):
 *   1. input must contain >= ROT13_MIN_LETTERS ASCII letters
 *   2. post-ROT13 output must contain at least one trigger bigram
 *      (`the`, `into`, `please`, `ignore`)
 *
 * Returns `[rotated]` only when both gates pass; otherwise `[]`. This
 * avoids generating noise candidates from random English prose, where
 * post-ROT13 text is gibberish and matches no bigram.
 *
 * Pure, never throws.
 */
export function decodeRot13(input: string): string[] {
  if (!input || typeof input !== 'string') return []
  let letterCount = 0
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) letterCount++
    if (letterCount >= ROT13_MIN_LETTERS) break
  }
  if (letterCount < ROT13_MIN_LETTERS) return []
  const rotated = applyRot13(input)
  if (!ROT13_TRIGGER_BIGRAMS.test(rotated)) return []
  return [rotated]
}

/**
 * Hardcoded small map of common named HTML entities. Intentionally limited
 * to the ~25 most commonly seen ones — we do NOT pull a full HTML parser
 * or dependency. Unknown entities are left untouched in the output.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0', // U+00A0 NO-BREAK SPACE — not an ASCII space
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
}

/**
 * Decode a numeric HTML entity (decimal `&#N;` or hex `&#xN;`) to its
 * single Unicode character. Returns null when the codepoint is out of
 * range, is a surrogate, or is otherwise invalid.
 */
function decodeNumericEntity(spec: string): string | null {
  let cp: number
  if (spec[0] === 'x' || spec[0] === 'X') {
    cp = parseInt(spec.slice(1), 16)
  } else {
    cp = parseInt(spec, 10)
  }
  if (!Number.isFinite(cp)) return null
  if (cp < 0 || cp > 0x10FFFF) return null
  // Surrogate range is invalid for a standalone code point.
  if (cp >= 0xD800 && cp <= 0xDFFF) return null
  try {
    return String.fromCodePoint(cp)
  } catch {
    return null
  }
}

/**
 * Decode a string containing common HTML entities. Single-shot whole-string
 * transform like decodePercent. Recognised forms:
 *   - named: &amp; &lt; &gt; &quot; &apos; &nbsp; ... (see NAMED_HTML_ENTITIES)
 *   - numeric decimal: &#NNN;
 *   - numeric hex: &#xNN;
 *
 * Returns `[decoded]` when the input contained at least one entity AND the
 * decoded form differs from the input; otherwise `[]`. Unknown named
 * entities (`&unknown;`) are left untouched in the output.
 *
 * Pure, fail-soft: never throws. No HTML-parser dependency.
 */
export function decodeHtmlEntities(input: string): string[] {
  if (!input || typeof input !== 'string') return []
  if (!/&[A-Za-z#0-9]+;/.test(input)) return []
  const decoded = input.replace(/&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (full, body: string) => {
    if (body.startsWith('#')) {
      const ch = decodeNumericEntity(body.slice(1))
      return ch === null ? full : ch
    }
    const named = NAMED_HTML_ENTITIES[body]
    return named === undefined ? full : named
  })
  if (decoded === input) return []
  return [decoded]
}

/**
 * Decode a percent-encoded string with `decodeURIComponent`. Single-shot,
 * whole-string transform (not chunked like base64).
 *
 * Returns `[decoded]` if:
 *   - input contains at least one `%[0-9A-Fa-f]{2}` triple
 *   - `decodeURIComponent` succeeds without throwing
 *   - the decoded form actually differs from the input
 *
 * Returns `[]` (silently) on any of:
 *   - input has no `%XX` triples
 *   - any malformed escape (e.g. `%ZZ`, lone `%`) causes `decodeURIComponent`
 *     to throw — caught, dropped
 *   - decoded output is identical to input (no transformation occurred)
 *
 * Pure, fail-soft. Never throws.
 */
export function decodePercent(input: string): string[] {
  if (!input || typeof input !== 'string') return []
  if (!/%[0-9A-Fa-f]{2}/.test(input)) return []
  let decoded: string
  try {
    decoded = decodeURIComponent(input)
  } catch {
    return []
  }
  if (decoded === input) return []
  return [decoded]
}

/**
 * Normalize an input string for safer regex scanning.
 *
 * Order is deterministic and tested:
 *   1. strip null + control chars
 *   2. strip zero-width / format chars
 *   3. NFKC Unicode normalization (folds fullwidth and compatibility forms)
 *   4. confusables fold (Cyrillic/Greek look-alikes → Latin)
 *
 * This is a PURE function. It does not log, throw, or mutate input.
 * Empty / non-string input returns ''.
 *
 * Comments-as-obfuscation (HTML/JS comment splitting) is intentionally NOT
 * handled here. See docs/audit/PR4_INJECTION_GUARD_DESIGN.md §5.7 — that
 * surface needs a real parser and is deferred to a future Layer 2 PR.
 */
export function normalize(input: string): string {
  if (!input || typeof input !== 'string') return ''
  let s = stripControlChars(input)
  s = stripZeroWidth(s)
  s = s.normalize('NFKC')
  s = applyConfusablesFold(s)
  return s
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface InjectionRule {
  rule: string
  category: InjectionCategory
  severity: InjectionSeverity
  pattern: RegExp
  description: string
  /** Which contexts this rule applies to */
  contexts: Array<'prompt' | 'display' | 'shell'>
}

const RULES: InjectionRule[] = [
  // ── Prompt injection: system override ────────────────────────
  {
    rule: 'prompt-override',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|your|system)\s+(?:instructions?|rules?|guidelines?|prompts?|directives?|constraints?)/i,
    description: 'Attempts to override system instructions',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-new-identity',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?(?:(?:un)?restricted|evil|jailbr(?:o|ea)ken|different|new))\b/i,
    description: 'Attempts to assign a new identity or unrestricted role',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-safety-bypass',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:bypass|disable|turn\s+off|deactivate|circumvent)\s+(?:all\s+)?(?:safety|security|content|moderation|ethic(?:al|s)?)\s*(?:filters?|checks?|guard(?:rail)?s?|rules?|measures?|restrictions?)?\b/i,
    description: 'Attempts to bypass safety measures',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-hidden-instruction',
    category: 'prompt',
    severity: 'critical',
    pattern: /\[(?:SYSTEM|INST|HIDDEN|ADMIN|IMPORTANT)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]\s*.{10,}/i,
    description: 'Hidden system-style instruction markers',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-delimiter-escape',
    category: 'prompt',
    severity: 'warning',
    pattern: /(?:<\/?(?:system|user|assistant|human|ai|instruction|context)>|```\s*system\b|\|>\s*(?:system|admin)\b)/i,
    description: 'Prompt delimiter injection (XML-style role tags or code block system markers)',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-repeat-leak',
    category: 'prompt',
    severity: 'warning',
    pattern: /\b(?:repeat|recite|echo|output|print|reveal|show|display)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?|initial\s+(?:message|prompt))\b/i,
    description: 'Attempts to extract system prompt',
    contexts: ['prompt'],
  },

  // ── Command injection ───────────────────────────────────────
  {
    rule: 'cmd-shell-metachar',
    category: 'command',
    severity: 'critical',
    pattern: /(?:[;&|`$]\s*(?:rm\b|wget\b|curl\b|nc\b|ncat\b|bash\b|sh\b|python\b|perl\b|ruby\b|php\b|node\b))|(?:\$\(.*(?:rm|wget|curl|nc|bash|sh))/i,
    description: 'Shell metacharacters followed by dangerous commands',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-path-traversal',
    category: 'command',
    severity: 'critical',
    pattern: /(?:\.\.\/){2,}|\.\.\\(?:\.\.\\){1,}/,
    description: 'Path traversal sequences',
    contexts: ['prompt', 'shell', 'display'],
  },
  {
    rule: 'cmd-pipe-download',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:curl|wget)\s+[^\n]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node)\b/i,
    description: 'Download-and-run pattern (piped curl/wget to interpreter)',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-reverse-shell',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:\/dev\/tcp\/|mkfifo|nc\s+-[elp]|ncat\s.*-[elp]|bash\s+-i\s+>&?\s*\/dev\/|python.*socket.*connect)\b/i,
    description: 'Reverse shell patterns',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-env-access',
    category: 'command',
    severity: 'warning',
    pattern: /\b(?:printenv|env\b.*(?:AUTH_PASS|API_KEY|SECRET|TOKEN)|cat\s+(?:\/proc\/self\/environ|\.env\b|\/etc\/(?:shadow|passwd)))/i,
    description: 'Attempts to access environment variables or sensitive system files',
    contexts: ['prompt', 'shell'],
  },

  // ── SSRF ─────────────────────────────────────────────────────
  {
    rule: 'cmd-ssrf',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:curl|wget|fetch|http\.get|requests\.get|axios)\b[^\n]*(?:169\.254\.169\.254|metadata\.google|100\.100\.100\.200|localhost:\d|127\.0\.0\.1:\d|0\.0\.0\.0:\d|\[::1\]:\d)/i,
    description: 'SSRF targeting internal/metadata endpoints',
    contexts: ['prompt', 'shell'],
  },

  // ── Template injection ──────────────────────────────────────
  {
    rule: 'cmd-template-injection',
    category: 'command',
    severity: 'warning',
    pattern: /\{\{.*(?:config|settings|env|self|request|__class__|__globals__|__builtins__).*\}\}|<%.*(?:Runtime|Process|exec|system|eval).*%>|\$\{.*(?:Runtime|exec|java\.lang).*\}/i,
    description: 'Template injection patterns (Jinja2, EJS, JSP)',
    contexts: ['prompt', 'shell', 'display'],
  },

  // ── SQL injection ───────────────────────────────────────────
  {
    rule: 'cmd-sql-injection',
    category: 'command',
    severity: 'critical',
    pattern: /(?:\bUNION\s+(?:ALL\s+)?SELECT\b|\b;\s*DROP\s+TABLE\b|'\s*OR\s+['"]?1['"]?\s*=\s*['"]?1|'\s*;\s*(?:DELETE|INSERT|UPDATE|ALTER)\s)/i,
    description: 'SQL injection patterns',
    contexts: ['prompt', 'shell'],
  },

  // ── Exfiltration ────────────────────────────────────────────
  {
    rule: 'exfil-send-data',
    category: 'exfiltration',
    severity: 'critical',
    pattern: /\b(?:send|post|upload|transmit|exfiltrate|forward)\s+(?:all\s+)?(?:the\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?|credentials?|passwords?|env(?:ironment)?)\s+(?:to|via|using|through)\b/i,
    description: 'Instructions to exfiltrate data',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'exfil-webhook',
    category: 'exfiltration',
    severity: 'warning',
    pattern: /\b(?:webhook|callback|postback)\s*[:=]\s*https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
    description: 'External webhook URL that could be used for data exfiltration',
    contexts: ['prompt', 'shell'],
  },

  // ── Encoding / obfuscation ──────────────────────────────────
  {
    rule: 'enc-base64-run',
    category: 'encoding',
    severity: 'warning',
    pattern: /(?:base64\s+-d|atob\s*\(|Buffer\.from\s*\([^)]+,\s*['"]base64['"])/i,
    description: 'Base64 decode that may hide malicious content',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'enc-heavy-hex',
    category: 'encoding',
    severity: 'info',
    pattern: /(?:\\x[0-9a-f]{2}){8,}|(?:\\u[0-9a-f]{4}){6,}/i,
    description: 'Heavy hex/unicode escape sequences that may hide malicious content',
    contexts: ['prompt', 'shell', 'display'],
  },
]

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * Scan a string for prompt injection, command injection, and exfiltration patterns.
 *
 * Returns a report with `safe: true` if no actionable matches were found.
 */
export function scanForInjection(input: string, options: GuardOptions = {}): InjectionReport {
  const { criticalOnly = false, maxLength = 50_000, context = 'prompt' } = options

  if (!input || typeof input !== 'string') {
    return { safe: true, matches: [] }
  }

  // Truncate overly long input to prevent ReDoS
  const text = input.length > maxLength ? input.slice(0, maxLength) : input
  const matches: InjectionMatch[] = []

  for (const rule of RULES) {
    if (!rule.contexts.includes(context)) continue

    const match = rule.pattern.exec(text)
    if (match) {
      matches.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        description: rule.description,
        matched: match[0].slice(0, 80),
      })
    }
  }

  const unsafe = matches.some(
    m => m.severity === 'critical' || (!criticalOnly && m.severity === 'warning')
  )

  return { safe: !unsafe, matches }
}

// ---------------------------------------------------------------------------
// Zod refinement helpers
// ---------------------------------------------------------------------------

/** Zod `.refine()` that rejects strings containing prompt/command injection */
export function noInjection(context: GuardOptions['context'] = 'prompt') {
  return (val: string) => {
    const report = scanForInjection(val, { context })
    return report.safe
  }
}

/** Zod `.superRefine()` with detailed error messages per injection match */
export function injectionRefinement(context: GuardOptions['context'] = 'prompt') {
  return (val: string, ctx: z.RefinementCtx) => {
    const report = scanForInjection(val, { context })
    if (!report.safe) {
      for (const m of report.matches) {
        if (m.severity === 'critical' || m.severity === 'warning') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Injection detected [${m.rule}]: ${m.description}`,
          })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/** Strip shell metacharacters from a string before passing to command args */
export function sanitizeForShell(input: string): string {
  // Remove null bytes and common shell metacharacters
  return input
    .replace(/\0/g, '')
    .replace(/[;&|`$(){}[\]<>!\\]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
}

/** Strip prompt-delimiter-style tags from user input */
export function sanitizeForPrompt(input: string): string {
  return input
    .replace(/<\/?(?:system|user|assistant|human|ai|instruction|context)>/gi, '')
    .replace(/\[(?:SYSTEM|INST|HIDDEN|ADMIN)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]/gi, '')
}

/** Scan for injection and log security event if unsafe */
export function scanAndLogInjection(text: string, options?: GuardOptions, context?: { agentName?: string; source?: string; workspaceId?: number }): InjectionReport {
  const report = scanForInjection(text, options)
  if (!report.safe) {
    try {
      const { logSecurityEvent } = require('./security-events')
      logSecurityEvent({ event_type: 'injection_attempt', severity: report.matches.some(m => m.severity === 'critical') ? 'critical' : 'warning', source: context?.source || 'injection-guard', agent_name: context?.agentName, detail: JSON.stringify({ matches: report.matches.map(m => ({ rule: m.rule, category: m.category, severity: m.severity })) }), workspace_id: context?.workspaceId || 1, tenant_id: 1 })
    } catch {}
  }
  return report
}

/** Sanitize content for safe HTML rendering (escapes HTML entities) */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
