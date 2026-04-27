'use client'

import { getPersonaById } from '@/lib/avatar-gallery'

interface AgentAvatarProps {
  name?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  /**
   * Phase 5.5 — when set, the avatar renders the matching gallery
   * persona's emoji over the persona's hue. Falls back to the existing
   * initials-on-hashed-hue look when the id is unknown / null.
   */
  personaId?: string | null
}

function getInitials(name: string): string {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function getAvatarColors(name: string): { backgroundColor: string; color: string } {
  const hash = hashString((name ?? '').toLowerCase())
  const hue = hash % 360
  return {
    backgroundColor: `hsl(${hue} 70% 38%)`,
    color: 'hsl(0 0% 98%)',
  }
}

const sizeClasses: Record<NonNullable<AgentAvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-12 h-12 text-base',
}

export function AgentAvatar({ name, size = 'sm', className = '', personaId }: AgentAvatarProps) {
  const safeName = name ?? ''
  const persona = getPersonaById(personaId)

  if (persona) {
    return (
      <div
        className={`rounded-full flex items-center justify-center shrink-0 ${sizeClasses[size]} ${className}`}
        style={{ backgroundColor: `hsl(${persona.hue} 60% 35%)`, color: 'hsl(0 0% 98%)' }}
        title={safeName ? `${safeName} · ${persona.label}` : persona.label}
        aria-label={safeName ? `${safeName} avatar (${persona.label})` : persona.label}
      >
        <span aria-hidden>{persona.emoji}</span>
      </div>
    )
  }

  const initials = getInitials(safeName)
  const colors = getAvatarColors(safeName)
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${sizeClasses[size]} ${className}`}
      style={colors}
      title={safeName}
      aria-label={safeName || 'Agent'}
    >
      {initials}
    </div>
  )
}

