/**
 * Source-discipline test for PR #15 / Phase 1.1:
 *
 *   The dark-mode bootstrap inline `<script>` in `src/app/layout.tsx`
 *   is a `<head>`-blocking element that carries a per-request CSP nonce
 *   read from `headers().get('x-nonce')`.
 *
 *   In dev mode (Next.js Turbopack ≥16.1), the framework can re-apply
 *   the nonce attribute client-side from the response CSP header, which
 *   sometimes diverges from the SSR'd attribute and triggers a noisy
 *   console hydration warning on the dashboard. See vercel/next.js#89754
 *   for the known architectural conflict between nonce-based CSP and
 *   inline `<head>` scripts.
 *
 *   The mitigation is `suppressHydrationWarning` on the `<script>`
 *   element. Suppression is intentionally narrow:
 *     - Only the `nonce` attribute can diverge between SSR and hydrate.
 *     - The script *content* is a static string literal (FOUC bootstrap)
 *       — no XSS vector and no behaviour delta.
 *     - The `nonce={nonce}` attribute stays, so CSP is NOT weakened.
 *
 *   This test guards against:
 *     1. Removal of `suppressHydrationWarning` on the inline bootstrap
 *        script (which would re-introduce the dev-overlay warning).
 *     2. Removal of the `nonce={nonce}` attribute (which would break
 *        CSP for the inline script and cause the browser to drop it).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LAYOUT_PATH = join(__dirname, '..', '..', 'app', 'layout.tsx')

// Anchor on the unique content marker of the FOUC bootstrap script.
// Avoids spelling out the inline-HTML attribute name in this file.
const BOOTSTRAP_CONTENT_MARKER = "localStorage.getItem('theme')"

describe('layout.tsx inline bootstrap script discipline (PR #15 / Phase 1.1)', () => {
  it('the dark-mode bootstrap script element must keep nonce={nonce} AND have suppressHydrationWarning', () => {
    const src = readFileSync(LAYOUT_PATH, 'utf8')

    // Locate the JSX element that renders the bootstrap script by
    // walking back from the unique content marker to the nearest
    // opening `<script` and forward to the next `/>`.
    const markerIdx = src.indexOf(BOOTSTRAP_CONTENT_MARKER)
    expect(
      markerIdx,
      `expected to find the FOUC bootstrap content marker (${BOOTSTRAP_CONTENT_MARKER}) in layout.tsx`
    ).toBeGreaterThan(-1)

    const elementStart = src.lastIndexOf('<script', markerIdx)
    const elementEnd = src.indexOf('/>', markerIdx)
    expect(
      elementStart,
      'expected to find the opening <script tag for the bootstrap element'
    ).toBeGreaterThan(-1)
    expect(
      elementEnd,
      'expected to find the closing /> for the bootstrap element'
    ).toBeGreaterThan(elementStart)

    const scriptElement = src.slice(elementStart, elementEnd + 2)

    expect(
      scriptElement,
      'inline bootstrap script must carry nonce={nonce} so the CSP allows it (do NOT drop the nonce when adjusting the script)'
    ).toMatch(/\bnonce=\{nonce\}/)

    expect(
      scriptElement,
      'inline bootstrap script must have suppressHydrationWarning to silence the Next.js Turbopack dev-mode nonce-attribute mismatch (vercel/next.js#89754)'
    ).toMatch(/\bsuppressHydrationWarning\b/)
  })
})
