/**
 * Phase 6.1 — audit-summary index check.
 *
 * `docs/audit/PHASE_AUDIT_SUMMARY.md` is the single entry point for
 * "what has been audited and verified about this fork." It must stay
 * in sync with the per-phase audit docs in `docs/audit/PHASE_*.md`:
 *
 *   - Every PHASE_*.md file should be linked from the summary.
 *   - The summary should not link to a phantom file (no broken link).
 *
 * This test enforces both directions, so a future PR that lands a new
 * phase audit doc but forgets to update the summary fails loudly here
 * before review.
 *
 * Out of scope:
 *   - The PR_NN_*.md files in the same directory (those predate the
 *     summary aggregator and have their own per-PR cross-links).
 *   - Roadmap / baseline / V0_SPEC files (not phase audits).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const AUDIT_DIR = join(__dirname, '..', '..', '..', 'docs', 'audit')
const SUMMARY_PATH = join(AUDIT_DIR, 'PHASE_AUDIT_SUMMARY.md')

const summary = readFileSync(SUMMARY_PATH, 'utf8')
const allFiles = readdirSync(AUDIT_DIR)

// Pattern: "PHASE_<num>_<num>_<NAME>.md" (e.g. PHASE_3_4_GATEWAY_NODES_CHANNELS_SMOKE.md).
const phaseAuditFiles = allFiles.filter((f) => /^PHASE_\d+_\d+_.+\.md$/.test(f))

describe('audit-summary index integrity (Phase 6.1)', () => {
  it('summary file exists', () => {
    expect(summary.length).toBeGreaterThan(0)
  })

  it('every PHASE_X_Y_*.md file is linked from PHASE_AUDIT_SUMMARY.md', () => {
    expect(phaseAuditFiles.length).toBeGreaterThan(0)
    const missing = phaseAuditFiles.filter((file) => !summary.includes(file))
    expect(
      missing,
      `summary is missing links to phase audit docs: ${missing.join(', ')}. ` +
      `Add a row referencing each one in docs/audit/PHASE_AUDIT_SUMMARY.md.`,
    ).toEqual([])
  })

  it('summary does NOT reference a phantom phase audit file', () => {
    // Find every PHASE_*_*.md token in the summary. Use a leading boundary
    // (start-of-string, whitespace, `[`, `(`, `/`) so that a reference like
    // `PR16_PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` is recognized as
    // a SINGLE filename and is not double-counted by sub-extracting
    // `PHASE_1_5_LEGACY_MIGRATION_VERIFICATION.md` from inside it.
    const refs = summary.match(/(?:^|[\s\[\(/])(PHASE_\d+_\d+_[A-Z0-9_]+\.md)/gm) ?? []
    const cleaned = refs.map((r) => r.replace(/^[\s\[\(/]+/, ''))
    const uniqueRefs = Array.from(new Set(cleaned))
    const phantoms = uniqueRefs.filter((r) => !allFiles.includes(r))
    expect(
      phantoms,
      `summary references phase audit files that do not exist: ${phantoms.join(', ')}.`,
    ).toEqual([])
  })

  it('summary mentions every Phase top-level section (Phase 1..6)', () => {
    for (const phaseNum of [1, 2, 3, 4, 5, 6]) {
      expect(
        summary,
        `summary is missing the Phase ${phaseNum} section header`,
      ).toMatch(new RegExp(`Phase ${phaseNum}`))
    }
  })

  it('summary references the operational invariants section', () => {
    expect(summary).toMatch(/Operational invariants/)
  })
})
