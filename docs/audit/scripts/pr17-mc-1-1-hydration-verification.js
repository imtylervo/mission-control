#!/usr/bin/env node
/**
 * Phase 1.1 — Hydration nonce mismatch follow-up: dashboard route verification
 * harness (Mai, 2026-04-27).
 *
 * PR #15 applied Option A (`suppressHydrationWarning` on the inline bootstrap
 * <script> in src/app/layout.tsx) and verified the CSP/nonce pairing on
 * /login, /setup, /docs by curl. The unchecked test-plan item from PR #15 is
 * "Tyler / Đào re-check the dashboard manually after merge" — this harness
 * automates that check via Chromium + Playwright addInitScript pre-page
 * wrapper, mirroring the PR #16 instrumentation pattern.
 *
 * The wrapper records every console.error / console.warn and counts events
 * that match the React hydration-mismatch banner. NO secret material is
 * logged. Output is shapes/booleans/error names/truncated messages only.
 *
 * USAGE
 *   node docs/audit/scripts/pr17-mc-1-1-hydration-verification.js
 *
 * AUTH (one of the three; tried in order):
 *   1. MC_STORAGE_STATE_FILE — Playwright storage-state JSON from a prior
 *      authenticated session (no password needed). Recommended for re-runs.
 *   2. MC_ADMIN_PASS — admin password as an environment variable.
 *      WARNING: env vars can leak via /proc/<pid>/environ to other local
 *      processes; prefer option 1 or 3 unless the box is single-user.
 *   3. MC_ADMIN_PASS_FILE — file path containing the admin password
 *      (default fallback: /tmp/mc-admin-pass.rotated, matches PR #16).
 *
 * If none of the three is available the script exits with a clear error
 * and does NOT attempt login (so it never silently logs an empty-password
 * 401 that an analyst could mistake for a real auth failure).
 *
 * The dev server must already be running on http://127.0.0.1:3000 — the
 * harness does not spawn it. Output is a single JSON document on stdout.
 */
const { chromium } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const ORIGIN = process.env.MC_ORIGIN || 'http://127.0.0.1:3000'
const USER = process.env.MC_ADMIN_USER || 'admin'

function loadAdminPass() {
  const stateFile = process.env.MC_STORAGE_STATE_FILE
  if (stateFile) {
    if (!fs.existsSync(stateFile)) {
      throw new Error(`MC_STORAGE_STATE_FILE points to missing path: ${stateFile}`)
    }
    return { mode: 'storage_state', path: stateFile }
  }

  if (process.env.MC_ADMIN_PASS) {
    return { mode: 'env', password: process.env.MC_ADMIN_PASS }
  }

  const passFile = process.env.MC_ADMIN_PASS_FILE || '/tmp/mc-admin-pass.rotated'
  if (fs.existsSync(passFile)) {
    return { mode: 'file', path: passFile, password: fs.readFileSync(passFile, 'utf8').trim() }
  }

  throw new Error(
    'Admin credential unavailable. Set one of:\n' +
      '  MC_STORAGE_STATE_FILE=/path/to/playwright-storage.json   (preferred)\n' +
      '  MC_ADMIN_PASS=...                                         (env var)\n' +
      '  MC_ADMIN_PASS_FILE=/path/to/passfile                      (file)\n' +
      'Default fallback file /tmp/mc-admin-pass.rotated also missing.'
  )
}

async function installHydrationWrapper(context) {
  await context.addInitScript(() => {
    window.__mc_hydration_log = []
    const safeArg = (a) => {
      if (a instanceof Error) return { __err: true, name: a.name, message: String(a.message).slice(0, 500) }
      if (typeof a === 'object' && a !== null) {
        try { return JSON.parse(JSON.stringify(a)) } catch { return String(a).slice(0, 500) }
      }
      return String(a).slice(0, 500)
    }
    const isHydrationMismatch = (msg) => {
      const text = typeof msg === 'string' ? msg : ''
      return (
        text.includes('hydrated') ||
        text.includes('did not match') ||
        text.includes('Hydration failed') ||
        text.includes("server rendered HTML didn't match")
      )
    }
    const ow = console.warn.bind(console)
    const oe = console.error.bind(console)
    console.warn = function (...args) {
      const safe = args.map(safeArg)
      const first = typeof args[0] === 'string' ? args[0] : ''
      window.__mc_hydration_log.push({ lvl: 'warn', isHydration: isHydrationMismatch(first), msg: safe })
      return ow(...args)
    }
    console.error = function (...args) {
      const safe = args.map(safeArg)
      const first = typeof args[0] === 'string' ? args[0] : ''
      window.__mc_hydration_log.push({ lvl: 'error', isHydration: isHydrationMismatch(first), msg: safe })
      return oe(...args)
    }
  })
}

async function loginIfNeeded(page, creds) {
  if (creds.mode === 'storage_state') return  // already authenticated via storage state

  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="Enter username"]', USER)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button:has-text("Sign in")')
  await page.waitForURL(`${ORIGIN}/`, { timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(1500)
}

async function captureDashboard(page) {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // Force a soft reload to also exercise HMR / re-hydrate paths where the
  // PR #15 issue body said the divergence is most likely.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const log = await page.evaluate(() => window.__mc_hydration_log || [])
  return log
}

async function main() {
  const creds = loadAdminPass()
  const browser = await chromium.launch({ headless: true })
  const contextOptions = { ignoreHTTPSErrors: true }
  if (creds.mode === 'storage_state') contextOptions.storageState = creds.path
  const context = await browser.newContext(contextOptions)

  // Mission Control's /api/events is an SSE long-poll that NEVER closes.
  // page.goto with waitUntil:'networkidle' would time out waiting for it.
  // Block the SSE route at the context level — hydration check only needs
  // the initial HTML + JS bundles, not the live event stream.
  await context.route('**/api/events**', (route) => route.abort())

  await installHydrationWrapper(context)

  const page = await context.newPage()
  await loginIfNeeded(page, creds)
  const log = await captureDashboard(page)
  const cspHeader = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null
  )
  const scriptNonces = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[nonce]')).map((s) => ({
      tag: 'script',
      nonceLen: (s.getAttribute('nonce') || '').length,
      hasContent: !!s.textContent && s.textContent.length > 0,
    }))
  )

  const hydrationEvents = log.filter((e) => e.isHydration)

  const summary = {
    origin: ORIGIN,
    auth_mode: creds.mode,
    engine: 'chromium-headless',
    total_console_events: log.length,
    hydration_event_count: hydrationEvents.length,
    hydration_event_samples: hydrationEvents.slice(0, 5).map((e) => ({
      lvl: e.lvl,
      first_arg: typeof e.msg[0] === 'string' ? e.msg[0].slice(0, 300) : null,
    })),
    csp_meta_present: !!cspHeader,
    script_tags_with_nonce: scriptNonces.length,
    script_nonces_sample: scriptNonces.slice(0, 6),
    verdict: hydrationEvents.length === 0 ? 'NO_HYDRATION_WARNING' : 'WARNING_RECURS',
  }

  await browser.close()
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')

  if (summary.verdict === 'WARNING_RECURS') {
    process.exit(2)  // distinct from script-error so cron/CI can branch
  }
}

main().catch((err) => {
  // Print a structured error so the audit log can capture it without secret leak.
  process.stderr.write(JSON.stringify({ error: { name: err.name, message: String(err.message).slice(0, 500) } }, null, 2) + '\n')
  process.exit(1)
})
