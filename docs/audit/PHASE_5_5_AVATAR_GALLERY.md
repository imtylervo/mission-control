# Phase 5.5 — Bot avatar gallery

**Outcome:** added a curated gallery of 12 emoji personas operators can pick from per agent. Selection persists to `agent.config.avatar.persona` (single string id, no schema migration), is rendered on every agent card via the existing `AgentAvatar` component, and is editable from a new "Avatar" tab in the agent detail modal. 17 unit tests pin the gallery contract.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `f5590e0` (Phase 5.4 PR #41 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.5:

> Visual management of agent avatars/personas.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5.4 closed (Đào msg 1703, ETA 23:55:00+10:00).

The existing `AgentAvatar` component renders agent initials over a name-hashed background colour. That works deterministically but gives no way for Tyler to express which agent is which at a glance, especially when several agents share initials (e.g. "Mai" vs "Maicodex"). Phase 5.5 adds visual distinctiveness without adding a heavyweight image-upload pipeline.

## What changed

### `src/lib/avatar-gallery.ts` (new)

Pure helper module:

- `AVATAR_PERSONAS: readonly AvatarPersona[]` — curated list of 12 personas (id, label, emoji, hue). Order is meaningful; UI renders in this order. Add new entries at the end so existing agents' picks stay stable.
  - Top of the gallery: `mai` (🌸), `dao` (🍑) — Tyler-pinned for the two named team agents.
  - Then operational/role personas: `dev-lead` (👨‍💻), `dev-qa` (🧪), `biz-research` (🔍), `biz-content` (✍️), `biz-data` (📊).
  - Then generic: `tyler` (🦊), `robot` (🤖), `rocket` (🚀), `star` (⭐), `shield` (🛡️).
- `getPersonaById(id): AvatarPersona | null` — lookup; tolerant of null/undefined/non-string.
- `readPersonaFromAgentConfig(config): AvatarPersona | null` — reads `config.avatar.persona` (preferred shape) OR `config.avatar` as a string (legacy tolerance). Returns null when missing or unknown id.
- `buildAvatarConfigPatch(personaId): { avatar: { persona: string | null } }` — builds the config patch the parent screen merges before calling `PUT /api/agents`. Throws on unknown ids (refuses to write garbage).
- `deterministicPersonaForName(name): AvatarPersona` — never-null fallback when no explicit persona is configured. Stable hash so the same name always picks the same persona.

### `src/lib/__tests__/avatar-gallery.test.ts` (new)

17 cases organised by helper:

- **`AVATAR_PERSONAS`** (3): minimum size; per-entry shape (kebab-case id, unique, non-empty label/emoji, hue 0..359); Tyler-pinned `mai` + `dao` are first two.
- **`getPersonaById`** (3): known id; null/undefined/empty/unknown id; non-string id without throwing.
- **`readPersonaFromAgentConfig`** (4): preferred `{ avatar: { persona } }` shape; legacy `{ avatar: 'id' }` shape; missing/unknown returns null; unrelated `avatar.something_else` returns null without throwing.
- **`buildAvatarConfigPatch`** (3): known id; clearing patch when null; throws on unknown id.
- **`deterministicPersonaForName`** (4): always returns a real persona; deterministic across calls; case-insensitive; null/undefined/empty input doesn't throw.

### `src/components/ui/agent-avatar.tsx` (extended)

- Added optional `personaId?: string | null` prop.
- Added `'lg'` to the `size` union (12 × 12 + base text) so the picker preview can show a larger avatar.
- When `personaId` resolves to a real gallery entry, render the persona's emoji over its hue (`hsl(${persona.hue} 60% 35%)`); aria-label combines agent name and persona label.
- When `personaId` is null/unknown, fall back byte-identical to the previous initials-on-hashed-hue rendering. Existing call sites passing only `name` are unaffected.

### `src/components/ui/avatar-gallery-picker.tsx` (new)

Presentational picker. Renders a 6-column grid of clickable tiles (the 12 personas + a "Clear" tile that picks `null`). The currently-selected tile gets `ring-2 ring-primary ring-offset-2`. Each tile is a `<button type="button" aria-pressed={...}>` for keyboard + screen-reader access. The component itself does NOT call any API — the parent merges the chosen id into its agent config payload and persists via the existing `PUT /api/agents`.

### `src/components/panels/agent-squad-panel-phase3.tsx` (wired)

Three changes:

1. Each agent card's `<AgentAvatar>` now reads `agent.config.avatar.persona` via `readPersonaFromAgentConfig` and passes it as `personaId` so the cards reflect the chosen persona.
2. New "Avatar" tab in the detail modal (`activeTab` union extended; tabs array gains `{ id: 'avatar', label: 'Avatar', icon: 'V' }`).
3. The Avatar tab renders:
   - A larger preview avatar (size `'lg'`) with the agent name + persona label/`No persona — using initials fallback`.
   - The `AvatarGalleryPicker` wired to the agent's current config.
   - On change: builds patch via `buildAvatarConfigPatch`, merges into the existing config, `PUT /api/agents` to persist, updates local state, calls `onUpdate()` to refresh the panel list. Errors are logged via the panel's existing `log` instance.

## Storage shape (no schema migration)

The persona id lives at `agent.config.avatar.persona` — single string under the existing JSON-encoded `config` column. No new table, no new column, no migration. Tolerant reader also accepts `agent.config.avatar = 'id'` (legacy short form) so any pre-existing entries Tyler manually added that shape still render correctly.

## Gates run (Mai re-verified on post-PR-#41 base)

```
$ git rev-parse HEAD
f5590e0aa100a254c9ebec8982240e5b44b6fd06  # confirms post-PR-#41 base

$ npx vitest run src/lib/__tests__/avatar-gallery.test.ts
✓ src/lib/__tests__/avatar-gallery.test.ts (17 tests) 12ms
Test Files  1 passed (1)
Tests       17 passed (17)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Emoji rendering depends on the OS font stack

`🌸` / `🍑` / `🦊` / `🛡️` / etc. render as the operator's OS emoji font (Apple Color Emoji on macOS, Segoe UI Emoji on Windows, Noto Color Emoji on Linux). Subtle visual differences across OSes are expected and harmless. Avoiding custom SVG/PNG assets keeps the bundle size flat.

### C2 — Picker UI is presentational; persistence happens at parent

The picker component is intentionally pure-presentational. Save semantics, error toasts, optimistic updates, and audit-log emission live at the parent (the agent detail modal). This keeps the picker reusable from a future "create agent" wizard that doesn't yet have an agent record to PUT against.

### C3 — Persona ids stay stable across upstream rebases

The `id` field is a stable, kebab-case string. Adding a new persona later appends to the end of `AVATAR_PERSONAS` without reordering the existing entries; agents that picked an earlier id keep rendering correctly. If a future PR removes a persona, agents holding that id will fall through to the initials avatar via the `null` branch — no crash.

### C4 — Default render unchanged for agents without a persona

Every existing agent in production has `config.avatar` undefined; `readPersonaFromAgentConfig` returns `null`; `AgentAvatar` falls back to its previous initials-on-hashed-hue render. There is no visual regression for agents Tyler hasn't touched.

### C5 — `deterministicPersonaForName` is exported but NOT yet wired

The deterministic-fallback helper is exported and unit-tested, but the panel currently passes `null` when no explicit persona is configured (so the avatar falls back to initials). Wiring `deterministicPersonaForName` as the default would change every existing agent's appearance in one go; better to let Tyler opt in per agent. Helper is ready when a future "auto-pick personas for all agents" feature lands.

## What this PR does not do

- Does not add a custom-image upload path (out of scope; emoji set is sufficient for Tyler's daily-use scenario).
- Does not change the `agent.config` JSON schema or add a migration.
- Does not modify the existing `getInitials` / `hashString` / `getAvatarColors` helpers (kept for fallback).
- Does not auto-assign personas to existing agents — operator must opt in via the new tab.
- Does not add component-level RTL tests (no precedent in `src/`; helper coverage at 17 cases pins the consumer contract).

## Risk and rollback

- Risk: low. Pure helpers + presentational picker + opt-in tab. Existing agents render byte-identically until an operator picks a persona.
- Rollback: revert this PR's diff. Persona ids stored on agents become unread (renderer falls through to initials). No data lost; the JSON column stays valid.

## Refs

- Đào msg 1703 (2026-04-27T13:20Z) — Phase 5.5 assignment, ETA 23:55:00+10:00.
- PR #41 — Phase 5.4 Vietnamese locale, merged at `f5590e0`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.5 — task definition.
- `src/lib/avatar-gallery.ts` (new) — gallery + helpers.
- `src/lib/__tests__/avatar-gallery.test.ts` (new) — 17 unit cases.
- `src/components/ui/agent-avatar.tsx` (extended) — persona render branch.
- `src/components/ui/avatar-gallery-picker.tsx` (new) — picker.
- `src/components/panels/agent-squad-panel-phase3.tsx` (wired) — card display + Avatar tab + persistence.
