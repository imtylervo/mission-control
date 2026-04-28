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

// scrypt-hash format from src/lib/password.ts: `<salt-hex>:<hash-hex>` where
// hash-hex is 64 chars (KEY_LENGTH=32 bytes). Anything missing either half or
// not parsing as hex is treated as malformed — admin can't actually log in
// against such a row, so the credential check must surface that explicitly
// instead of reporting "strong" because nothing in the insecure list happens
// to verify against it.
function isMalformedHash(stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return true
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(hash)) return true
  // 32-byte scrypt key serialised as hex => 64 chars exactly
  if (hash.length !== 64) return true
  return false
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
    if (isMalformedHash(dbHash)) {
      return {
        source: 'db',
        status: 'fail',
        detail: 'Admin password hash in database is malformed (expected scrypt format `<salt-hex>:<32-byte-hash-hex>`). The admin cannot log in — reset the password to repair the row.',
      }
    }
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
