import { getDatabase } from './db'
import { verifyPassword } from './password'

const INSECURE_DEFAULTS = ['admin', 'password', 'change-me-on-first-login', 'changeme', 'testpass123']

export type AdminCredentialStatus =
  | { source: 'db'; status: 'pass'; detail: string }
  | { source: 'db'; status: 'fail'; detail: string }
  | { source: 'env'; status: 'pass' | 'fail' | 'warn'; detail: string }
  | { source: 'none'; status: 'fail'; detail: string }

interface AdminRow {
  password_hash?: string | null
}

export function getAdminPasswordHash(): string | null {
  try {
    const db = getDatabase()
    const row = db
      .prepare("SELECT password_hash FROM users WHERE role = 'admin' LIMIT 1")
      .get() as AdminRow | undefined
    const hash = (row?.password_hash || '').trim()
    return hash || null
  } catch {
    return null
  }
}

function isInsecureHash(hash: string): boolean {
  for (const candidate of INSECURE_DEFAULTS) {
    try {
      if (verifyPassword(candidate, hash)) return true
    } catch {
      // ignore malformed-hash errors and continue
    }
  }
  return false
}

export function checkAdminCredential(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): AdminCredentialStatus {
  const dbHash = getAdminPasswordHash()
  if (dbHash) {
    if (isInsecureHash(dbHash)) {
      return {
        source: 'db',
        status: 'fail',
        detail: 'Admin password in database matches a known insecure default — reset it from the dashboard or via DELETE /api/auth/users.',
      }
    }
    return {
      source: 'db',
      status: 'pass',
      detail: 'Admin password is set in the database and does not match a known insecure default.',
    }
  }

  const authPass = (env.AUTH_PASS || '').trim()
  if (!authPass) {
    return {
      source: 'none',
      status: 'fail',
      detail: 'No admin user has been seeded yet and AUTH_PASS is not set. Set AUTH_PASS in .env so the first-run seed can create the admin user.',
    }
  }
  if (INSECURE_DEFAULTS.includes(authPass)) {
    return {
      source: 'env',
      status: 'fail',
      detail: 'AUTH_PASS is set to a known insecure default. Change it to a unique password before first run seeds the admin user.',
    }
  }
  if (authPass.length < 12) {
    return {
      source: 'env',
      status: 'warn',
      detail: `AUTH_PASS is only ${authPass.length} characters. Use at least 12 characters for the first-run admin seed.`,
    }
  }
  return {
    source: 'env',
    status: 'pass',
    detail: 'AUTH_PASS is set and will seed the admin user on first run.',
  }
}
