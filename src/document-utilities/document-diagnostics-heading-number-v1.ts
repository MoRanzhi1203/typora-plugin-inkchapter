/**
 * R09 — Heading-number diagnostics producer (central detection panel).
 *
 * R08 computed six numbering conflict rules inside its own checker. R09 makes
 * them FIRST-CLASS diagnostics: this module converts one R08 persistence plan
 * into heading-scoped diagnostic facts that the central producer
 * (`computeDocumentDiagnostics`) pushes into the same snapshot as every other
 * rule — same registry, same line mapping, same fix pipeline.
 *
 * Dedupe contract (§4.4): a heading NEVER reports two numbering defects with
 * the same root cause. The most specific one wins:
 *   double > mismatch > missing > order > format > ownership > manual prefix.
 *
 * Pure contract: no DOM, no host state.
 */

import {
  planHeadingNumberPersistence,
  type HeadingNumberPersistenceFacts,
} from '../heading-numbering/heading-number-persistence'
import {
  NUMBERING_CONFLICT_CODES,
  checkNumberingConflicts,
  type NumberingConflictFix,
} from '../heading-numbering/heading-number-conflict-check'

export type { HeadingNumberPersistenceFacts }

export const HEADING_NUMBER_DIAGNOSTIC_CODES = {
  double: NUMBERING_CONFLICT_CODES.doubleNumberPrefix,
  mismatch: NUMBERING_CONFLICT_CODES.numberMismatch,
  missing: NUMBERING_CONFLICT_CODES.numberMissing,
  order: NUMBERING_CONFLICT_CODES.numberOrderAnomaly,
  format: NUMBERING_CONFLICT_CODES.numberFormatInconsistent,
  ownership: NUMBERING_CONFLICT_CODES.numberOwnershipConflict,
  manual: NUMBERING_CONFLICT_CODES.manualNumberPrefix,
  autoConflict: NUMBERING_CONFLICT_CODES.autoNumberConflict,
} as const

export interface HeadingNumberDiagnosticHeading {
  level: number
  text: string
  stableIdentity?: string
}

export interface HeadingNumberDiagnosticFact {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  /** 1-based line of the heading in the Markdown source. */
  line: number
  /** Index into the caller's heading list; -1 when it could not be mapped. */
  headingIndex: number
  fix: NumberingConflictFix
  /** The exact current heading line. */
  beforeLine: string
  /** The adopt-plan target for this line ('' = no safe automatic rewrite). */
  afterLine: string
  headingLevel: number
  expectedLabel: string
  detectedNumber: string
}

const PRIORITY: Readonly<Record<string, number>> = {
  [NUMBERING_CONFLICT_CODES.doubleNumberPrefix]: 100,
  [NUMBERING_CONFLICT_CODES.numberMismatch]: 90,
  [NUMBERING_CONFLICT_CODES.numberMissing]: 80,
  [NUMBERING_CONFLICT_CODES.numberOrderAnomaly]: 70,
  [NUMBERING_CONFLICT_CODES.numberFormatInconsistent]: 60,
  [NUMBERING_CONFLICT_CODES.numberOwnershipConflict]: 50,
  [NUMBERING_CONFLICT_CODES.manualNumberPrefix]: 40,
  [NUMBERING_CONFLICT_CODES.autoNumberConflict]: 30,
}

const SEVERITY: Readonly<Record<string, 'error' | 'warning'>> = {
  [NUMBERING_CONFLICT_CODES.doubleNumberPrefix]: 'error',
  [NUMBERING_CONFLICT_CODES.numberMismatch]: 'error',
  [NUMBERING_CONFLICT_CODES.numberMissing]: 'warning',
  [NUMBERING_CONFLICT_CODES.numberOrderAnomaly]: 'error',
  [NUMBERING_CONFLICT_CODES.numberFormatInconsistent]: 'warning',
  [NUMBERING_CONFLICT_CODES.numberOwnershipConflict]: 'warning',
  [NUMBERING_CONFLICT_CODES.manualNumberPrefix]: 'warning',
  [NUMBERING_CONFLICT_CODES.autoNumberConflict]: 'error',
}

export function computeHeadingNumberDiagnosticFacts(input: {
  markdown: string
  headings: readonly HeadingNumberDiagnosticHeading[]
  facts: HeadingNumberPersistenceFacts
}): HeadingNumberDiagnosticFact[] {
  const { markdown, headings, facts } = input
  if (!facts?.settings) return []

  const plan = planHeadingNumberPersistence(markdown, facts.settings, {
    mode: facts.storageMode,
    policy: facts.policy,
    ownership: facts.ownership,
    overrideEntries: facts.overrideEntries,
    counterPolicy: facts.counterPolicy,
  })
  const report = checkNumberingConflicts(plan, {
    numberingEnabled: facts.enabled,
    storageMode: facts.storageMode,
    policy: facts.policy,
  })

  // The adopt-plan is the FIX target for every reported heading. Build it only
  // when there is at least one issue — a clean document (the common case) pays
  // for ONE plan, never two, on every diagnostics recompute.
  const adoptPlan = report.issues.length > 0
    ? planHeadingNumberPersistence(markdown, facts.settings, {
        mode: 'source',
        policy: 'adopt',
        ownership: facts.ownership,
        overrideEntries: facts.overrideEntries,
        counterPolicy: facts.counterPolicy,
      })
    : null
  const adoptByIdentity = new Map((adoptPlan?.headings ?? []).map(h => [h.identity, h]))

  const byHeading = new Map<string, HeadingNumberDiagnosticFact>()
  for (const issue of report.issues) {
    // The render-layer double display is only a real defect when projection
    // dedupe is OFF; otherwise the dedupe layer already prevents it.
    if (issue.code === NUMBERING_CONFLICT_CODES.autoNumberConflict && facts.dedupeProjectedNumbers) continue

    const planned = plan.headings.find(h => h.identity === issue.identity)
    if (!planned) continue
    const headingIndex = resolveHeadingIndex(planned.line, planned.level, headings)
    const adopt = adoptByIdentity.get(issue.identity)
    const afterLine = adopt && adopt.after !== adopt.before ? adopt.after : ''
    const fact: HeadingNumberDiagnosticFact = {
      code: issue.code,
      severity: SEVERITY[issue.code] ?? 'warning',
      message: issue.message,
      line: planned.line,
      headingIndex,
      fix: issue.fix,
      beforeLine: planned.before,
      afterLine,
      headingLevel: planned.level,
      expectedLabel: planned.label,
      detectedNumber: planned.detected?.numberText ?? '',
    }
    const key = `${planned.line}|${planned.identity}`
    const existing = byHeading.get(key)
    if (existing == null || (PRIORITY[fact.code] ?? 0) > (PRIORITY[existing.code] ?? 0)) {
      byHeading.set(key, fact)
    }
  }

  return [...byHeading.values()].sort((a, b) => a.line - b.line)
}

function resolveHeadingIndex(
  line: number,
  level: number,
  headings: readonly HeadingNumberDiagnosticHeading[],
): number {
  // Canonical + source heading lists are both document order; the plan only
  // contains ATX headings, so a direct index match is preferred and a
  // level+line fallback keeps the mapping correct for mixed inputs.
  if (headings.length > 0) {
    const candidate = headings[line - 1]
    if (candidate && candidate.level === level) return line - 1
  }
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].level === level) return i
  }
  return -1
}
