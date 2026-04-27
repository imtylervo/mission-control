/**
 * Phase 5.5 — bot avatar gallery.
 *
 * Existing AgentAvatar component renders initials over a name-hashed
 * background colour. That works for a deterministic look but does not
 * give Tyler any way to express which agent is which at a glance,
 * especially when several agents share initials (e.g. Mai vs Maicodex).
 *
 * This module ships a small curated gallery of persona emojis Tyler can
 * pick from per agent. Storage shape is intentionally minimal — a
 * single string id under `agent.config.avatar.persona`, fits in the
 * existing JSON config column with no schema migration.
 *
 * Helpers are pure (no DOM / no I/O) so they're testable without
 * fixtures and reusable by SSR + client components.
 */

export interface AvatarPersona {
  id: string         // stable, kebab-case; safe for storage in agent.config.avatar.persona
  label: string      // human-readable, picker uses this for tooltip / aria-label
  emoji: string      // rendered glyph; chosen for cross-platform compatibility
  hue: number        // 0..359 — background hue when persona is selected
}

/**
 * Curated gallery — covers ~12 lightweight agent stereotypes Tyler
 * actually uses. Order is meaningful (UI renders in this order). Add
 * new entries at the end so existing agents' picks stay stable.
 */
export const AVATAR_PERSONAS: readonly AvatarPersona[] = [
  { id: 'mai',          label: 'Mai (apricot blossom)',  emoji: '🌸', hue: 340 },
  { id: 'dao',          label: 'Đào (peach)',            emoji: '🍑', hue: 18 },
  { id: 'dev-lead',     label: 'Dev Lead',               emoji: '👨‍💻', hue: 220 },
  { id: 'dev-qa',       label: 'QA',                     emoji: '🧪', hue: 160 },
  { id: 'biz-research', label: 'Business research',      emoji: '🔍', hue: 270 },
  { id: 'biz-content',  label: 'Content writer',         emoji: '✍️', hue: 30 },
  { id: 'biz-data',     label: 'Data analyst',           emoji: '📊', hue: 200 },
  { id: 'tyler',        label: 'Tyler (operator)',       emoji: '🦊', hue: 25 },
  { id: 'robot',        label: 'Generic bot',            emoji: '🤖', hue: 200 },
  { id: 'rocket',       label: 'Launcher',               emoji: '🚀', hue: 0 },
  { id: 'star',         label: 'Highlight',              emoji: '⭐', hue: 50 },
  { id: 'shield',       label: 'Security/auditor',       emoji: '🛡️', hue: 130 },
] as const

const PERSONA_BY_ID: Record<string, AvatarPersona> = Object.fromEntries(
  AVATAR_PERSONAS.map((p) => [p.id, p]),
)

/** Lookup; returns null when the id is unknown / blank. */
export function getPersonaById(id: string | null | undefined): AvatarPersona | null {
  if (typeof id !== 'string' || id.length === 0) return null
  return PERSONA_BY_ID[id] ?? null
}

/**
 * Read the persona id from an agent's config. Returns null when
 * config.avatar.persona is missing or not a known id. Tolerant of
 * different config shapes (the agents API stores config as JSON; some
 * older shapes may have `avatar` as a string instead of an object).
 */
export function readPersonaFromAgentConfig(config: unknown): AvatarPersona | null {
  if (!config || typeof config !== 'object') return null
  const c = config as Record<string, unknown>

  // Preferred shape: { avatar: { persona: 'id' } }
  const avatarObj = c.avatar
  if (avatarObj && typeof avatarObj === 'object') {
    const id = (avatarObj as Record<string, unknown>).persona
    if (typeof id === 'string') return getPersonaById(id)
  }

  // Tolerant shape: { avatar: 'id' } (some legacy entries may use the
  // shorter form; we still accept a known id here).
  if (typeof avatarObj === 'string') return getPersonaById(avatarObj)

  return null
}

/**
 * Build a config patch for assigning a persona to an agent. Caller
 * merges this into its existing `config` payload before calling
 * `PUT /api/agents`. Setting `personaId` to `null` returns a patch that
 * clears the avatar.
 */
export function buildAvatarConfigPatch(personaId: string | null): {
  avatar: { persona: string | null }
} {
  if (personaId === null) {
    return { avatar: { persona: null } }
  }
  // Validate id; refuse to write an unknown one.
  if (!getPersonaById(personaId)) {
    throw new Error(`Unknown avatar persona id: ${personaId}`)
  }
  return { avatar: { persona: personaId } }
}

/**
 * Deterministic fallback persona for an agent name when no explicit
 * persona is configured. Uses a stable hash so the same agent name
 * always picks the same persona across sessions / browsers / SSR.
 *
 * Returns one of the gallery entries — never null — because there is
 * always SOMETHING to render.
 */
export function deterministicPersonaForName(name: string | null | undefined): AvatarPersona {
  const safe = (name ?? '').trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < safe.length; i += 1) {
    hash = (hash * 31 + safe.charCodeAt(i)) >>> 0
  }
  const idx = hash % AVATAR_PERSONAS.length
  return AVATAR_PERSONAS[idx]
}
