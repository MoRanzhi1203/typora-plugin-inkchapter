/**
 * V5.12-R8 §5/§14/§15 — Figure Diagnostic Target / Existence Authority (pure).
 *
 * Two figure rules consume the SAME Figure Source Occurrence but DIFFERENT
 * ranges:
 *
 *   FIGURE_MISSING_NAME        → FIGURE_FULL_TOKEN  (`![alt](dest)`)
 *   FIGURE_LOCAL_IMAGE_MISSING → FIGURE_DESTINATION (`dest`)
 *
 * They are independent Warnings and must never be collapsed by dedupe.
 * This module owns the fixed semantics, the hard gates and the runtime audit
 * contract for both.
 */

export const FIGURE_TARGET_AUTHORITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-FIGURE-TARGET-AUTHORITY-AUDIT'

/** V5.12-R8 §5 — fixed range role per rule. */
export const FIGURE_MISSING_NAME_RANGE_ROLE = 'figure-full-token' as const
export const FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE = 'figure-destination' as const

export type FigureRangeRole = typeof FIGURE_MISSING_NAME_RANGE_ROLE | typeof FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE

/** Resolve the FIXED range role for a rule code (null for non-figure rules). */
export function figureRangeRoleForRule(code: string): FigureRangeRole | null {
  if (code === 'FIGURE_MISSING_NAME') return FIGURE_MISSING_NAME_RANGE_ROLE
  if (code === 'FIGURE_LOCAL_IMAGE_MISSING') return FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE
  return null
}

// ── Hard gates (§14) ─────────────────────────────────────

export const FIGURE_TARGET_V512R8_GATE_KEYS = [
  'missingNameWithoutLocateTarget',
  'missingNameFullTokenRangeNull',
  'missingNameExactTokenAvailableButNotUsed',
  'missingNamePartialDestinationOnlyMark',
  'missingNameClickWithoutVisual',
  'missingNameBlockFallbackWhileTokenAvailable',
  'localImageMissingExpectedButAbsent',
  'localImageMissingNonWarningSeverity',
  'localImageMissingDestinationRangeNull',
  'localImageMissingClickWithoutVisual',
  'localImageMissingFullTokenMarkInsteadOfPath',
  'remoteImageFalseLocalMissing',
  'dataUrlFalseLocalMissing',
  'distinctRulesCollapsedByDedupe',
] as const

export type FigureTargetV512R8GateKey = typeof FIGURE_TARGET_V512R8_GATE_KEYS[number]

/**
 * The gates that are evaluated PER CLICK (accumulated), as opposed to the
 * SNAPSHOT-scoped gates (assigned from the current document state).
 */
export const FIGURE_TARGET_V512R8_PER_CLICK_GATE_KEYS: ReadonlySet<FigureTargetV512R8GateKey> = new Set([
  'missingNameClickWithoutVisual',
  'missingNameExactTokenAvailableButNotUsed',
  'missingNameBlockFallbackWhileTokenAvailable',
  'localImageMissingClickWithoutVisual',
  'localImageMissingFullTokenMarkInsteadOfPath',
  'missingNamePartialDestinationOnlyMark',
])

export const FIGURE_TARGET_V512R8_GATE_LABELS: Readonly<Record<FigureTargetV512R8GateKey, string>> = {
  missingNameWithoutLocateTarget: 'FIGURE_MISSING_NAME_WITHOUT_LOCATE_TARGET_COUNT',
  missingNameFullTokenRangeNull: 'FIGURE_MISSING_NAME_FULL_TOKEN_RANGE_NULL_COUNT',
  missingNameExactTokenAvailableButNotUsed: 'FIGURE_MISSING_NAME_EXACT_TOKEN_AVAILABLE_BUT_NOT_USED_COUNT',
  missingNamePartialDestinationOnlyMark: 'FIGURE_MISSING_NAME_PARTIAL_DESTINATION_ONLY_MARK_COUNT',
  missingNameClickWithoutVisual: 'FIGURE_MISSING_NAME_CLICK_WITHOUT_VISUAL_COUNT',
  missingNameBlockFallbackWhileTokenAvailable: 'FIGURE_MISSING_NAME_BLOCK_FALLBACK_WHILE_TOKEN_AVAILABLE_COUNT',
  localImageMissingExpectedButAbsent: 'LOCAL_IMAGE_MISSING_EXPECTED_BUT_ABSENT_COUNT',
  localImageMissingNonWarningSeverity: 'LOCAL_IMAGE_MISSING_NON_WARNING_SEVERITY_COUNT',
  localImageMissingDestinationRangeNull: 'LOCAL_IMAGE_MISSING_DESTINATION_RANGE_NULL_COUNT',
  localImageMissingClickWithoutVisual: 'LOCAL_IMAGE_MISSING_CLICK_WITHOUT_VISUAL_COUNT',
  localImageMissingFullTokenMarkInsteadOfPath: 'LOCAL_IMAGE_MISSING_FULL_TOKEN_MARK_INSTEAD_OF_PATH_COUNT',
  remoteImageFalseLocalMissing: 'REMOTE_IMAGE_FALSE_LOCAL_MISSING_COUNT',
  dataUrlFalseLocalMissing: 'DATA_URL_FALSE_LOCAL_MISSING_COUNT',
  distinctRulesCollapsedByDedupe: 'FIGURE_DISTINCT_RULES_COLLAPSED_BY_DEDUPE_COUNT',
}

export type FigureTargetV512R8Counters = Record<FigureTargetV512R8GateKey, number>

export function createFigureTargetV512R8Counters(): FigureTargetV512R8Counters {
  return FIGURE_TARGET_V512R8_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FigureTargetV512R8Counters)
}

export function evaluateFigureTargetV512R8Gates(
  counters: Readonly<FigureTargetV512R8Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: FigureTargetV512R8GateKey[] } {
  const failedChecks = FIGURE_TARGET_V512R8_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

export function formatFigureTargetV512R8GateReport(
  counters: Readonly<FigureTargetV512R8Counters>,
): string[] {
  return FIGURE_TARGET_V512R8_GATE_KEYS.map(k => `${FIGURE_TARGET_V512R8_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

// ── Per-locate facts (§15) ───────────────────────────────

export interface FigureTargetAuthorityFacts {
  ruleCode: string
  occurrenceIndex: number | null
  sourceRangeIdentity: string | null
  rawToken: string | null
  rawDestination: string | null
  canonicalDestination: string | null
  expectedRangeRole: FigureRangeRole | null
  resolvedRangeRole: FigureRangeRole | null
  expectedSourceStart: number | null
  expectedSourceEnd: number | null
  resolvedSourceStart: number | null
  resolvedSourceEnd: number | null
  rangeClientRectCount: number
  visualFragmentCount: number
  documentLocalRectCount: number
  /** severity rendered by the Drawer for this diagnostic. */
  severity: string | null
  localFileExists: boolean | null
  resourceClass: string | null
  /** The exact source token really exists as DOM text (whole-token range possible). */
  exactTokenAvailable: boolean
  /** The exact source token range was used for the visual (L1). */
  exactTokenUsed: boolean
  /** The owning-block context (L3) was the carrier. */
  usedBlockFallback: boolean
  decision: 'PASS' | 'FAIL'
  reason: string
}

/**
 * V5.12-R8 §8/§12/§14 — the PER-CLICK decision authority.
 *
 * PASS requires: the fixed range role was resolved to the SAME range, and a
 * real visual fragment was painted. When the exact token IS available in the
 * DOM, the owning-block fallback is a hard failure (never a paragraph stand-in).
 */
export function evaluateFigureTargetAuthority(facts: FigureTargetAuthorityFacts): {
  decision: 'PASS' | 'FAIL'
  reason: string
} {
  const expected = figureRangeRoleForRule(facts.ruleCode)
  if (expected == null) return { decision: 'PASS', reason: 'NOT_A_FIGURE_TARGET_RULE' }
  if (facts.expectedRangeRole !== expected) {
    return { decision: 'FAIL', reason: 'EXPECTED_RANGE_ROLE_MISMATCH' }
  }
  if (facts.resolvedRangeRole !== expected) {
    return { decision: 'FAIL', reason: 'RESOLVED_RANGE_ROLE_MISMATCH' }
  }
  if (facts.resolvedSourceStart == null || facts.resolvedSourceEnd == null) {
    return { decision: 'FAIL', reason: 'RESOLVED_SOURCE_RANGE_NULL' }
  }
  if (facts.expectedSourceStart != null && facts.expectedSourceStart !== facts.resolvedSourceStart) {
    return { decision: 'FAIL', reason: 'SOURCE_RANGE_START_MISMATCH' }
  }
  if (facts.expectedSourceEnd != null && facts.expectedSourceEnd !== facts.resolvedSourceEnd) {
    return { decision: 'FAIL', reason: 'SOURCE_RANGE_END_MISMATCH' }
  }
  if (facts.visualFragmentCount <= 0) {
    return { decision: 'FAIL', reason: 'CLICK_WITHOUT_VISUAL' }
  }
  if (expected === FIGURE_MISSING_NAME_RANGE_ROLE) {
    if (facts.exactTokenAvailable && facts.exactTokenUsed !== true) {
      return { decision: 'FAIL', reason: 'EXACT_TOKEN_AVAILABLE_BUT_NOT_USED' }
    }
    if (facts.exactTokenAvailable && facts.usedBlockFallback) {
      return { decision: 'FAIL', reason: 'BLOCK_FALLBACK_WHILE_TOKEN_AVAILABLE' }
    }
  }
  if (expected === FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE && facts.localFileExists === false) {
    if (facts.expectedRangeRole !== FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE) {
      return { decision: 'FAIL', reason: 'LOCAL_MISSING_FULL_TOKEN_MARK' }
    }
  }
  return { decision: 'PASS', reason: 'FIGURE_TARGET_AUTHORITY_OK' }
}

// ── Snapshot-level gates (§14) ───────────────────────────

/** Minimal view of one published diagnostic for the snapshot-level gates. */
export interface FigureSnapshotDiagnosticView {
  code: string
  severity: string
  resourceKind: string | null
  resourceClass: string | null
  altText: string | null
  canonicalDestination: string | null
  occurrenceIndex: number | null
  localFileExists: boolean | null
  rangeRole: string | null
  /** The location really is a locatable source range. */
  locatableSourceRange: boolean
  sourceStart: number | null
  sourceEnd: number | null
  destinationStart: number | null
  destinationEnd: number | null
}

/**
 * Evaluate the SNAPSHOT-scoped figure gates. Every returned count must be 0.
 *
 *  - a missing-NAME warning must always carry a locatable full-token range;
 *  - a local-missing warning must always be `warning` with a destination range
 *    and must never be produced for a remote / data URL;
 *  - a figure that is BOTH unnamed and locally absent must keep BOTH warnings
 *    (never collapsed by dedupe).
 */
export function evaluateFigureTargetSnapshotGates(
  diags: readonly FigureSnapshotDiagnosticView[],
): Partial<Record<FigureTargetV512R8GateKey, number>> {
  const counts: Partial<Record<FigureTargetV512R8GateKey, number>> = {}
  const bump = (k: FigureTargetV512R8GateKey): void => { counts[k] = (counts[k] ?? 0) + 1 }
  const groups = new Map<string, { missingName: boolean; localMissing: boolean; expectBoth: boolean }>()
  const groupOf = (key: string) => {
    const g = groups.get(key) ?? { missingName: false, localMissing: false, expectBoth: false }
    groups.set(key, g)
    return g
  }
  for (const d of diags) {
    const unnamed = (d.altText ?? '').trim() === ''
    if (d.code === 'FIGURE_MISSING_NAME') {
      if (!d.locatableSourceRange || d.sourceStart == null || d.sourceEnd == null) bump('missingNameWithoutLocateTarget')
      if (d.rangeRole !== FIGURE_MISSING_NAME_RANGE_ROLE) bump('missingNameFullTokenRangeNull')
      const g = groupOf(`${d.canonicalDestination ?? ''}\u0000${d.occurrenceIndex ?? 0}`)
      g.missingName = true
      // BOTH warnings are required only for an UNNAMED figure whose local file
      // is really absent (the exact `![](missing.png)` case).
      if (unnamed && d.localFileExists === false) g.expectBoth = true
      continue
    }
    if (d.code === 'FIGURE_LOCAL_IMAGE_MISSING') {
      if (d.severity !== 'warning') bump('localImageMissingNonWarningSeverity')
      if (d.destinationStart == null || d.destinationEnd == null) bump('localImageMissingDestinationRangeNull')
      if (d.rangeRole !== FIGURE_LOCAL_IMAGE_MISSING_RANGE_ROLE) bump('localImageMissingFullTokenMarkInsteadOfPath')
      if (d.resourceClass === 'remote') bump('remoteImageFalseLocalMissing')
      if (d.resourceClass === 'data') bump('dataUrlFalseLocalMissing')
      const g = groupOf(`${d.canonicalDestination ?? ''}\u0000${d.occurrenceIndex ?? 0}`)
      g.localMissing = true
      if (unnamed && d.localFileExists === false) g.expectBoth = true
    }
  }
  for (const g of groups.values()) {
    if (!g.expectBoth) continue
    if (!g.missingName || !g.localMissing) {
      bump('distinctRulesCollapsedByDedupe')
      if (!g.localMissing) bump('localImageMissingExpectedButAbsent')
    }
  }
  return counts
}
