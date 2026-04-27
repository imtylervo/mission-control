/**
 * Helpers for agent card display — extracted for testability.
 */

/** Read the primary model ID string from agent.config; null when missing/non-string. */
function readPrimaryModelId(config: any): string | null {
  const raw = config?.model?.primary
  const primary = typeof raw === 'string' ? raw : raw?.primary
  return typeof primary === 'string' && primary.length > 0 ? primary : null
}

/** Strip provider prefix from model ID: "anthropic/claude-opus-4-5" → "claude-opus-4-5" */
export function formatModelName(config: any): string | null {
  const primary = readPrimaryModelId(config)
  if (!primary) return null
  const parts = primary.split('/')
  return parts[parts.length - 1]
}

/**
 * Phase 5.1 — extract the provider prefix (first segment) from the model ID.
 * Returns null when the ID has no '/' (i.e. no explicit provider).
 *
 *   "anthropic/claude-opus-4-5"  → "anthropic"
 *   "9router/cx/gpt-5.5"         → "9router"
 *   "gpt-4o"                     → null
 */
export function formatProviderName(config: any): string | null {
  const primary = readPrimaryModelId(config)
  if (!primary) return null
  const slashIdx = primary.indexOf('/')
  if (slashIdx === -1) return null
  return primary.slice(0, slashIdx)
}

/**
 * Phase 5.1 — extract the route segment(s) between the provider prefix
 * and the model name, for nested IDs like "9router/cx/gpt-5.5". Returns
 * null when there is no intermediate segment (i.e. fewer than 3 parts).
 *
 *   "9router/cx/gpt-5.5"          → "cx"
 *   "9router/cx/proxy/gpt-5.5"    → "cx/proxy"
 *   "anthropic/claude-opus-4-5"   → null
 *   "gpt-4o"                      → null
 */
export function formatProviderRoute(config: any): string | null {
  const primary = readPrimaryModelId(config)
  if (!primary) return null
  const parts = primary.split('/')
  if (parts.length < 3) return null
  return parts.slice(1, -1).join('/')
}

/**
 * Phase 5.1 — full provider/model display string. Returns the raw primary
 * model ID unchanged so the UI can show the complete routing chain
 * (e.g. "9router/cx/gpt-5.5") in tooltips or detail views without losing
 * any segment.
 */
export function formatFullProviderModel(config: any): string | null {
  return readPrimaryModelId(config)
}

/**
 * Phase 5.6 — provider tier classification.
 *
 * Surfaces whether an agent's configured model will cost money to run.
 * The dashboard renders this as a small badge next to the model name so
 * Tyler can spot a paid agent before triggering a wake/dispatch.
 *
 *   'free'    — runs locally on the host with no metered API cost
 *               (Ollama, llama.cpp local, lm-studio).
 *   'paid'    — known metered cloud provider (Anthropic, OpenAI,
 *               Cohere, Google Gemini paid SKUs, AWS Bedrock).
 *   'unknown' — no provider prefix on the model ID, or a router-style
 *               prefix that hides the eventual provider (e.g.
 *               '9router/cx/gpt-5.5' could route to free OR paid;
 *               operator decides via the router config). Default to
 *               'unknown' rather than guess and falsely reassure.
 *
 * Classification reads the FIRST segment of the model ID
 * (`formatProviderName`). Lowercase comparison; trailing variants
 * collapse to the same provider (e.g. 'anthropic-stage' → still paid).
 */
export type ProviderTier = 'free' | 'paid' | 'unknown'

const FREE_PROVIDERS: readonly string[] = [
  'ollama',
  'llamacpp',
  'llama-cpp',
  'lmstudio',
  'lm-studio',
  'local',
] as const

const PAID_PROVIDERS: readonly string[] = [
  'anthropic',
  'openai',
  'azure-openai',
  'azureopenai',
  'cohere',
  'google',
  'gemini',
  'mistral',
  'bedrock',
  'aws-bedrock',
  'groq',
  'deepseek',
  'xai',
  'perplexity',
] as const

export function classifyProviderTier(config: any): ProviderTier {
  const provider = formatProviderName(config)
  if (!provider) return 'unknown'
  const normalized = provider.toLowerCase()
  if (FREE_PROVIDERS.some((p) => normalized === p || normalized.startsWith(`${p}-`))) {
    return 'free'
  }
  if (PAID_PROVIDERS.some((p) => normalized === p || normalized.startsWith(`${p}-`))) {
    return 'paid'
  }
  return 'unknown'
}

/**
 * Phase 5.6 — short human-readable label for the badge UI. Kept in
 * sync with `classifyProviderTier`. Tooltip-friendly (no emoji), the
 * UI layer adds tone color.
 */
export function tierLabel(tier: ProviderTier): string {
  switch (tier) {
    case 'free': return 'Local / free'
    case 'paid': return 'Paid API'
    case 'unknown': return 'Unknown — check router config'
  }
}

export interface TaskStats {
  total: number
  assigned: number
  in_progress: number
  quality_review: number
  done: number
  completed: number
}

export interface TaskStatPart {
  label: string
  count: number
  color?: string
}

/** Build inline task stat parts from agent taskStats, omitting zero counts. */
export function buildTaskStatParts(stats: TaskStats | undefined | null): TaskStatPart[] | null {
  if (!stats) return null
  const parts: TaskStatPart[] = []
  if (stats.assigned) parts.push({ label: 'assigned', count: stats.assigned })
  if (stats.in_progress) parts.push({ label: 'active', count: stats.in_progress, color: 'text-amber-300' })
  if (stats.quality_review) parts.push({ label: 'review', count: stats.quality_review, color: 'text-violet-300' })
  if (stats.done) parts.push({ label: 'done', count: stats.done, color: 'text-emerald-300' })
  return parts.length > 0 ? parts : null
}

/** Extract WebSocket host from connection URL for tooltip display. */
export function extractWsHost(url: string | undefined): string {
  if (!url) return '—'
  try {
    return new URL(url.replace(/^ws/, 'http')).host
  } catch {
    return '—'
  }
}
