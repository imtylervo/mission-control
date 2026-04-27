'use client'

import { AVATAR_PERSONAS, type AvatarPersona } from '@/lib/avatar-gallery'

interface AvatarGalleryPickerProps {
  /** Current selected persona id (null when no persona is set). */
  value: string | null
  /** Called when the user picks a persona; passes its id, or null for "clear". */
  onChange: (personaId: string | null) => void
  className?: string
}

/**
 * Phase 5.5 — visual picker for the bot avatar gallery.
 *
 * Renders the curated `AVATAR_PERSONAS` list as a grid of clickable
 * tiles. The currently-selected persona is highlighted; a "Clear"
 * tile lets the operator unset the persona and fall back to the
 * deterministic initials-on-hue avatar.
 *
 * The component is presentational — it does NOT call any API on its
 * own. The parent screen is expected to merge the chosen id into its
 * agent.config payload via `buildAvatarConfigPatch(...)` and persist
 * via the existing PUT /api/agents endpoint.
 */
export function AvatarGalleryPicker({ value, onChange, className = '' }: AvatarGalleryPickerProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="text-xs text-muted-foreground">Avatar persona</div>
      <div className="grid grid-cols-6 gap-2">
        <PersonaTile
          isSelected={value === null}
          onClick={() => onChange(null)}
          ariaLabel="No persona — use initials"
          tooltip="Clear (use initials)"
        >
          <span className="text-muted-foreground/60 text-xs">—</span>
        </PersonaTile>
        {AVATAR_PERSONAS.map((p) => (
          <PersonaTile
            key={p.id}
            isSelected={value === p.id}
            onClick={() => onChange(p.id)}
            ariaLabel={p.label}
            tooltip={p.label}
            backgroundColor={`hsl(${p.hue} 60% 35%)`}
          >
            <span aria-hidden>{p.emoji}</span>
          </PersonaTile>
        ))}
      </div>
    </div>
  )
}

interface PersonaTileProps {
  isSelected: boolean
  onClick: () => void
  ariaLabel: string
  tooltip: string
  backgroundColor?: string
  children: React.ReactNode
}

function PersonaTile({
  isSelected,
  onClick,
  ariaLabel,
  tooltip,
  backgroundColor,
  children,
}: PersonaTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      title={tooltip}
      className={`w-10 h-10 rounded-full flex items-center justify-center text-base transition-all ${
        isSelected
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
          : 'hover:ring-1 hover:ring-border'
      }`}
      style={backgroundColor ? { backgroundColor, color: 'hsl(0 0% 98%)' } : undefined}
    >
      {children}
    </button>
  )
}

/** Re-export so importers can read the persona shape for typing. */
export type { AvatarPersona }
