/**
 * Heading Auto-Number Conflict Diagnostics V1.2 — Evidence-State Final Closure.
 *
 * This module is the ONE authority for:
 *
 *   per-heading EVIDENCE STATE
 *     → transition CLASSIFIER
 *       → transitionReason
 *         → COVERAGE COUNTER (+ failure gates)
 *
 * No downstream layer may re-derive the reason: the classifier runs ONCE and
 * every consumer (audit / coverage / gate) reads its `transitionReason`
 * (`DUPLICATE_HEADING_CONFLICT_TRANSITION_CLASSIFIER_COUNT=0`).
 *
 * It contains NO producer and NO parser.
 */

/** §9 — the FIXED transition-reason vocabulary (priority is the switch order). */
export type HeadingAutoNumberConflictTransitionReason =
  | 'AUTO_NUMBER_ENABLED'
  | 'AUTO_NUMBER_DISABLED'
  | 'H1_NUMBERING_ENABLED'
  | 'H1_NUMBERING_DISABLED'
  | 'SOURCE_PREFIX_ADDED'
  | 'SOURCE_PREFIX_REMOVED'
  | 'SOURCE_PREFIX_CHANGED'
  | 'NUMBER_STYLE_CHANGED'
  | 'HEADING_REMOVED'
  | 'CONFLICT_STATE_INCOHERENT'
  | 'NO_CHANGE'

/** §3/§4 — the ONE per-heading evidence state (keyed by headingStableIdentity). */
export interface HeadingAutoNumberConflictEvidenceState {
  documentKey: string
  headingStableIdentity: string
  headingLevel: number

  sourceText: string

  manualPrefixStatus: 'confirmed' | 'ambiguous' | 'none'
  manualPrefixKind: string | null
  manualPrefixRaw: string | null

  globalAutoNumberingEnabled: boolean
  autoNumberingEffectiveForHeading: boolean
  h1NumberingEnabled: boolean

  /** §13 — any observable numbering-style / renumber signal (the painted prefix). */
  numberingStyleKey: string
  generatedVisiblePrefix: string | null

  conflict: boolean
  diagnosticId: string | null
}

/**
 * §9/§10/§11/§12/§13/§14 — the ONE transition classifier.
 *
 * Priority (fixed):
 *   1 global auto-numbering enable change
 *   2 per-heading effective-numbering change
 *   3 source manual-prefix change
 *   4 numbering-style change
 *   5 heading removed / structural change
 *   6 unexplained conflict-state change  ← TRUE fallback only
 *   7 NO_CHANGE
 *
 * `after === null` means the heading LEFT the canonical heading set (§5), which
 * is the ONLY case allowed to report HEADING_REMOVED. A heading that merely
 * stopped conflicting keeps its state (conflict=false), so a config change can
 * never masquerade as a source change.
 */
export function classifyHeadingAutoNumberConflictTransition(
  before: HeadingAutoNumberConflictEvidenceState,
  after: HeadingAutoNumberConflictEvidenceState | null,
): HeadingAutoNumberConflictTransitionReason {
  // 5 — structural: the heading itself is gone.
  if (after == null) return 'HEADING_REMOVED'

  // 1 — global master switch.
  if (before.globalAutoNumberingEnabled !== after.globalAutoNumberingEnabled) {
    return after.globalAutoNumberingEnabled ? 'AUTO_NUMBER_ENABLED' : 'AUTO_NUMBER_DISABLED'
  }
  // 2 — per-heading effective numbering (strict/loose H1 · level · maxDepth ·
  // override). §11/§17 scope the `H1_NUMBERING_*` reason to the H1 heading: the
  // coverage mapping routes it to `h1Toggle`, so a level≠1 effectiveness change
  // must NEVER be named H1_* (it would pollute h1Toggle AND mask the real source
  // transition below). A level≠1 effectiveness move therefore falls through to
  // the source/style/conflict checks.
  if (before.autoNumberingEffectiveForHeading !== after.autoNumberingEffectiveForHeading
    && after.headingLevel === 1) {
    return after.autoNumberingEffectiveForHeading ? 'H1_NUMBERING_ENABLED' : 'H1_NUMBERING_DISABLED'
  }
  // 3 — source manual prefix.
  if (before.manualPrefixStatus !== after.manualPrefixStatus) {
    return after.manualPrefixStatus === 'confirmed' ? 'SOURCE_PREFIX_ADDED' : 'SOURCE_PREFIX_REMOVED'
  }
  if (before.manualPrefixStatus === 'confirmed'
    && (before.manualPrefixRaw ?? '') !== (after.manualPrefixRaw ?? '')) {
    return 'SOURCE_PREFIX_CHANGED'
  }
  // 4 — numbering style / renumber (the painted prefix moved).
  if (before.numberingStyleKey !== after.numberingStyleKey) return 'NUMBER_STYLE_CHANGED'
  // 6 — TRUE fallback (§14): EXPLICITLY requires the per-heading effectiveness
  // verdict to be UNCHANGED. A level≠1 effectiveness move is a real explanation
  // for a conflict change even though §11 does not NAME it H1_*; it must never be
  // reported as incoherent.
  if (before.conflict !== after.conflict
    && before.autoNumberingEffectiveForHeading === after.autoNumberingEffectiveForHeading) {
    return 'CONFLICT_STATE_INCOHERENT'
  }
  return 'NO_CHANGE'
}

/** §17 — coverage is a PURE function of the classifier's reason. */
export type HeadingAutoNumberConflictCoverageKeyV12 =
  | 'decimal'
  | 'hierarchical'
  | 'chinese'
  | 'roman'
  | 'chapterStyle'
  | 'crossStyle'
  | 'dynamicSource'
  | 'dynamicConfig'
  | 'h1Toggle'
  | 'styleSwitch'
  | 'firstClickActive'
  | 'drawerViewportStable'
  | 'suppressionSameHeading'
  | 'nonConflictManualWarning'

export function coverageKeyForTransitionReason(
  reason: HeadingAutoNumberConflictTransitionReason,
): 'dynamicConfig' | 'h1Toggle' | 'dynamicSource' | 'styleSwitch' | null {
  switch (reason) {
    case 'AUTO_NUMBER_ENABLED':
    case 'AUTO_NUMBER_DISABLED':
      return 'dynamicConfig'
    case 'H1_NUMBERING_ENABLED':
    case 'H1_NUMBERING_DISABLED':
      return 'h1Toggle'
    case 'SOURCE_PREFIX_ADDED':
    case 'SOURCE_PREFIX_REMOVED':
    case 'SOURCE_PREFIX_CHANGED':
      return 'dynamicSource'
    case 'NUMBER_STYLE_CHANGED':
      return 'styleSwitch'
    default:
      return null
  }
}

/** §15 — the per-transition verdict (failures only ever come from the reason). */
export interface HeadingAutoNumberConflictTransitionVerdict {
  decision: 'PASS' | 'FAIL'
  transitionReason: HeadingAutoNumberConflictTransitionReason
  coverageKey: 'dynamicConfig' | 'h1Toggle' | 'dynamicSource' | 'styleSwitch' | null
  failedChecks: string[]
}

/**
 * §13/§14/§15 — classify AND vet ONE heading transition.
 *
 * The style-switch gate is ONLY raised when the classifier itself said
 * NUMBER_STYLE_CHANGED and the conflict actually disappeared — never as a
 * generic bucket for an incoherent state.
 */
export function evaluateHeadingAutoNumberConflictTransition(input: {
  before: HeadingAutoNumberConflictEvidenceState
  after: HeadingAutoNumberConflictEvidenceState | null
}): HeadingAutoNumberConflictTransitionVerdict {
  const reason = classifyHeadingAutoNumberConflictTransition(input.before, input.after)
  const failedChecks: string[] = []
  const { before, after } = input
  if (reason === 'CONFLICT_STATE_INCOHERENT') failedChecks.push('CONFLICT_STATE_INCOHERENT')
  if (reason === 'NUMBER_STYLE_CHANGED') {
    if (before.conflict && after != null && !after.conflict) failedChecks.push('STYLE_SWITCH_LOST_CONFLICT')
    if (after != null && before.diagnosticId != null && after.diagnosticId != null
      && before.diagnosticId !== after.diagnosticId) {
      failedChecks.push('ID_CHANGED_ON_STYLE_SWITCH')
    }
  }
  if (after != null && after.headingStableIdentity !== before.headingStableIdentity) {
    failedChecks.push('STATE_KEY_UNSTABLE')
  }
  if (reason !== 'NO_CHANGE' && reason !== 'HEADING_REMOVED' && !input.before.headingStableIdentity) {
    failedChecks.push('STATE_KEY_MISSING')
  }
  return {
    decision: failedChecks.length === 0 ? 'PASS' : 'FAIL',
    transitionReason: reason,
    coverageKey: coverageKeyForTransitionReason(reason),
    failedChecks,
  }
}

/** §44 — the per-conflicting-heading audit record (unchanged contract). */
export const HEADING_AUTO_NUMBER_CONFLICT_AUDIT_EVENT = 'HEADING-AUTO-NUMBER-CONFLICT-AUDIT'

/** §45 — the dynamic (evidence-state) transition audit. */
export const HEADING_AUTO_NUMBER_CONFLICT_DYNAMIC_AUDIT_EVENT = 'HEADING-AUTO-NUMBER-CONFLICT-DYNAMIC-AUDIT'

/** §44 — the REAL facts of ONE heading's conflict verdict. */
export interface HeadingAutoNumberConflictFacts {
  documentKey: string | null
  diagnosticId: string
  headingStableIdentity: string
  headingLevel: string | null

  autoNumberingGlobalEnabled: boolean
  autoNumberingEffectiveForHeading: boolean
  h1NumberingEnabled: boolean

  canonicalSourceText: string
  manualPrefixStatus: 'confirmed' | 'ambiguous' | 'none'
  manualPrefixKind: string | null
  manualPrefixRaw: string | null

  generatedVisiblePrefix: string | null
  sourceEvidenceUsesGeneratedPrefix: boolean

  severity: string
}

export interface HeadingAutoNumberConflictDecision {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
}

/** §2/§5/§13/§15/§19 — the ONE per-conflicting-heading decision. */
export function evaluateHeadingAutoNumberConflictFacts(
  facts: HeadingAutoNumberConflictFacts,
): HeadingAutoNumberConflictDecision {
  const failed: string[] = []
  if (facts.severity !== 'error') failed.push('WRONG_SEVERITY')
  if (!facts.autoNumberingEffectiveForHeading) failed.push('CONFLICT_WITHOUT_EFFECTIVE_AUTO_NUMBER')
  if (facts.manualPrefixStatus !== 'confirmed') failed.push('CONFLICT_WITHOUT_CONFIRMED_MANUAL_PREFIX')
  if (facts.sourceEvidenceUsesGeneratedPrefix) failed.push('SOURCE_EVIDENCE_USES_GENERATED_PREFIX')
  const generated = String(facts.generatedVisiblePrefix ?? '').trim()
  const source = String(facts.canonicalSourceText ?? '').trim()
  if (facts.manualPrefixStatus === 'confirmed') {
    const raw = String(facts.manualPrefixRaw ?? '').trim()
    if (raw !== '' && !source.includes(raw)) failed.push('MANUAL_PREFIX_NOT_IN_SOURCE_TEXT')
    if (raw !== '' && generated !== '' && generated === raw) failed.push('GENERATED_PREFIX_MISTAKEN_FOR_MANUAL')
  }
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'AUTO_NUMBER_CONFLICT_COVERAGE_CLOSED' : failed.join(','),
    failedChecks: failed,
  }
}

// ── §43 — the hard gates ────────────────────────────────────────────────────

export const HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS = [
  // V1.2 evidence-state gates
  'dynamicStateDroppedNonConflictHeading',
  'initialBaselineCountedAsDynamicTransition',
  'dynamicStateCrossDocumentLeak',
  'duplicateHeadingConflictTransitionClassifier',
  'headingAutoNumberConflictStateIncoherent',
  'headingAutoNumberConflictDisappearedOnStyleSwitch',
  'configTransitionCountedAsSourceTransition',
  'dynamicCoverageTransactionDuplicate',
  'crossSessionCoverageMerge',
  'reportOnlyCapturedBeforeDiagnosticsCommit',
  'reportOnlyWrongRuntimeSession',
  'reportOnlyStaleDiagnosticsRevision',
  // V1 rule gates
  'headingAutoNumberConflictWrongSeverity',
  'duplicateHeadingAutoNumberEffectivePolicy',
  'duplicateHeadingManualNumberPrefixAuthority',
  'autoGeneratedHeadingNumberReportedAsManual',
  'headingNumberContentFalsePositive',
  'headingAutoNumberConflictIgnoredEffectiveLevelPolicy',
  'headingAutoNumberConflictDuplicateDiagnostic',
  'autoNumberConflictAndManualPrefixDuplicateReport',
  'headingAutoNumberConflictUnstableIdentity',
  'headingAutoNumberConflictIdChangedOnStyleSwitch',
  'headingAutoNumberConflictStaleAfterSourceEdit',
  'headingAutoNumberConflictStaleAfterNumberingDisabled',
  'headingAutoNumberConflictMissingAfterNumberingEnabled',
  'headingAutoNumberConflictDisappearedOnStyleSwitchLegacy',
  'headingAutoNumberConflictFirstClickNotActivated',
  'headingAutoNumberConflictDrawerScrollDriftGt1px',
  'headingAutoNumberConflictWrongFilter',
  'headingAutoNumberConflictToolbarErrorCountMismatch',
  'autoNumberPrefixEnteredSemanticIdentity',
  'targetGroupRegression',
  'drawerViewportRegression',
  'toolbarSeveritySummaryRegression',
  'unrequestedHeadingNumberingBehaviorChange',
  'unrequestedHeadingNumberingStyleChange',
  'unrequestedDiagnosticColorChange',
  'unrelatedProductionFileChange',
  'headingAutoNumberConflictRepeatedClickNotDeactivated',
  'headingAutoNumberConflictDrawerViewportAnchorChanged',
  'configChangeWithoutDiagnosticsRecompute',
  'sourceChangeWithoutDiagnosticsRecompute',
  'unrequestedParserChange',
  'unrequestedProducerChange',
  'runtimeMatrixOverclaimedPass',
  'staticPassReportedAsRuntimePass',
  'zeroFailureCounterWithZeroPositiveCoveragePass',
  'directSettingsJsonMutationUsedAsRuntimePassEvidence',
  'runtimeFixtureNotRestored',
  'runtimeSettingsNotRestored',
] as const

export type HeadingAutoNumberConflictGateKey = typeof HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS[number]

export const HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS: Readonly<Record<HeadingAutoNumberConflictGateKey, string>> = {
  dynamicStateDroppedNonConflictHeading: 'DYNAMIC_STATE_DROPPED_NON_CONFLICT_HEADING_COUNT',
  initialBaselineCountedAsDynamicTransition: 'INITIAL_BASELINE_COUNTED_AS_DYNAMIC_TRANSITION_COUNT',
  dynamicStateCrossDocumentLeak: 'DYNAMIC_STATE_CROSS_DOCUMENT_LEAK_COUNT',
  duplicateHeadingConflictTransitionClassifier: 'DUPLICATE_HEADING_CONFLICT_TRANSITION_CLASSIFIER_COUNT',
  headingAutoNumberConflictStateIncoherent: 'HEADING_AUTO_NUMBER_CONFLICT_STATE_INCOHERENT_COUNT',
  headingAutoNumberConflictDisappearedOnStyleSwitch: 'HEADING_AUTO_NUMBER_CONFLICT_DISAPPEARED_ON_STYLE_SWITCH_COUNT',
  configTransitionCountedAsSourceTransition: 'CONFIG_TRANSITION_COUNTED_AS_SOURCE_TRANSITION_COUNT',
  dynamicCoverageTransactionDuplicate: 'DYNAMIC_COVERAGE_TRANSACTION_DUPLICATE_COUNT',
  crossSessionCoverageMerge: 'CROSS_SESSION_COVERAGE_MERGE_COUNT',
  reportOnlyCapturedBeforeDiagnosticsCommit: 'REPORT_ONLY_CAPTURED_BEFORE_DIAGNOSTICS_COMMIT_COUNT',
  reportOnlyWrongRuntimeSession: 'REPORT_ONLY_WRONG_RUNTIME_SESSION_COUNT',
  reportOnlyStaleDiagnosticsRevision: 'REPORT_ONLY_STALE_DIAGNOSTICS_REVISION_COUNT',
  headingAutoNumberConflictWrongSeverity: 'HEADING_AUTO_NUMBER_CONFLICT_WRONG_SEVERITY_COUNT',
  duplicateHeadingAutoNumberEffectivePolicy: 'DUPLICATE_HEADING_AUTO_NUMBER_EFFECTIVE_POLICY_COUNT',
  duplicateHeadingManualNumberPrefixAuthority: 'DUPLICATE_HEADING_MANUAL_NUMBER_PREFIX_AUTHORITY_COUNT',
  autoGeneratedHeadingNumberReportedAsManual: 'AUTO_GENERATED_HEADING_NUMBER_REPORTED_AS_MANUAL_COUNT',
  headingNumberContentFalsePositive: 'HEADING_NUMBER_CONTENT_FALSE_POSITIVE_COUNT',
  headingAutoNumberConflictIgnoredEffectiveLevelPolicy: 'HEADING_AUTO_NUMBER_CONFLICT_IGNORED_EFFECTIVE_LEVEL_POLICY_COUNT',
  headingAutoNumberConflictDuplicateDiagnostic: 'HEADING_AUTO_NUMBER_CONFLICT_DUPLICATE_DIAGNOSTIC_COUNT',
  autoNumberConflictAndManualPrefixDuplicateReport: 'AUTO_NUMBER_CONFLICT_AND_MANUAL_PREFIX_DUPLICATE_REPORT_COUNT',
  headingAutoNumberConflictUnstableIdentity: 'HEADING_AUTO_NUMBER_CONFLICT_UNSTABLE_IDENTITY_COUNT',
  headingAutoNumberConflictIdChangedOnStyleSwitch: 'HEADING_AUTO_NUMBER_CONFLICT_ID_CHANGED_ON_STYLE_SWITCH_COUNT',
  headingAutoNumberConflictStaleAfterSourceEdit: 'HEADING_AUTO_NUMBER_CONFLICT_STALE_AFTER_SOURCE_EDIT_COUNT',
  headingAutoNumberConflictStaleAfterNumberingDisabled: 'HEADING_AUTO_NUMBER_CONFLICT_STALE_AFTER_NUMBERING_DISABLED_COUNT',
  headingAutoNumberConflictMissingAfterNumberingEnabled: 'HEADING_AUTO_NUMBER_CONFLICT_MISSING_AFTER_NUMBERING_ENABLED_COUNT',
  headingAutoNumberConflictDisappearedOnStyleSwitchLegacy: 'HEADING_AUTO_NUMBER_CONFLICT_DISAPPEARED_ON_STYLE_SWITCH_LEGACY_COUNT',
  headingAutoNumberConflictFirstClickNotActivated: 'HEADING_AUTO_NUMBER_CONFLICT_FIRST_CLICK_NOT_ACTIVATED_COUNT',
  headingAutoNumberConflictDrawerScrollDriftGt1px: 'HEADING_AUTO_NUMBER_CONFLICT_DRAWER_SCROLL_DRIFT_GT_1PX_COUNT',
  headingAutoNumberConflictWrongFilter: 'HEADING_AUTO_NUMBER_CONFLICT_WRONG_FILTER_COUNT',
  headingAutoNumberConflictToolbarErrorCountMismatch: 'HEADING_AUTO_NUMBER_CONFLICT_TOOLBAR_ERROR_COUNT_MISMATCH',
  autoNumberPrefixEnteredSemanticIdentity: 'AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY_COUNT',
  targetGroupRegression: 'TARGET_GROUP_REGRESSION_COUNT',
  drawerViewportRegression: 'DRAWER_VIEWPORT_REGRESSION_COUNT',
  toolbarSeveritySummaryRegression: 'TOOLBAR_SEVERITY_SUMMARY_REGRESSION_COUNT',
  unrequestedHeadingNumberingBehaviorChange: 'UNREQUESTED_HEADING_NUMBERING_BEHAVIOR_CHANGE_COUNT',
  unrequestedHeadingNumberingStyleChange: 'UNREQUESTED_HEADING_NUMBERING_STYLE_CHANGE_COUNT',
  unrequestedDiagnosticColorChange: 'UNREQUESTED_DIAGNOSTIC_COLOR_CHANGE_COUNT',
  unrelatedProductionFileChange: 'UNRELATED_PRODUCTION_FILE_CHANGE_COUNT',
  headingAutoNumberConflictRepeatedClickNotDeactivated: 'HEADING_AUTO_NUMBER_CONFLICT_REPEATED_CLICK_NOT_DEACTIVATED_COUNT',
  headingAutoNumberConflictDrawerViewportAnchorChanged: 'HEADING_AUTO_NUMBER_CONFLICT_DRAWER_VIEWPORT_ANCHOR_CHANGED_COUNT',
  configChangeWithoutDiagnosticsRecompute: 'CONFIG_CHANGE_WITHOUT_DIAGNOSTICS_RECOMPUTE_COUNT',
  sourceChangeWithoutDiagnosticsRecompute: 'SOURCE_CHANGE_WITHOUT_DIAGNOSTICS_RECOMPUTE_COUNT',
  unrequestedParserChange: 'UNREQUESTED_PARSER_CHANGE_COUNT',
  unrequestedProducerChange: 'UNREQUESTED_PRODUCER_CHANGE_COUNT',
  runtimeMatrixOverclaimedPass: 'RUNTIME_MATRIX_OVERCLAIMED_PASS_COUNT',
  staticPassReportedAsRuntimePass: 'STATIC_PASS_REPORTED_AS_RUNTIME_PASS_COUNT',
  zeroFailureCounterWithZeroPositiveCoveragePass: 'ZERO_FAILURE_COUNTER_WITH_ZERO_POSITIVE_COVERAGE_PASS_COUNT',
  directSettingsJsonMutationUsedAsRuntimePassEvidence: 'DIRECT_SETTINGS_JSON_MUTATION_USED_AS_RUNTIME_PASS_EVIDENCE_COUNT',
  runtimeFixtureNotRestored: 'RUNTIME_FIXTURE_NOT_RESTORED_COUNT',
  runtimeSettingsNotRestored: 'RUNTIME_SETTINGS_NOT_RESTORED_COUNT',
}

export type HeadingAutoNumberConflictCounters = Record<HeadingAutoNumberConflictGateKey, number>

export function createHeadingAutoNumberConflictCounters(): HeadingAutoNumberConflictCounters {
  return HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingAutoNumberConflictCounters)
}

export function formatHeadingAutoNumberConflictGateReport(
  counters: Readonly<HeadingAutoNumberConflictCounters>,
): string[] {
  return HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS.map(key =>
    `${HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateHeadingAutoNumberConflictGates(
  counters: Readonly<HeadingAutoNumberConflictCounters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingAutoNumberConflictGateKey[] } {
  const failedChecks = HEADING_AUTO_NUMBER_CONFLICT_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/**
 * §15/§18 — fold ONE transition verdict into the gate counters.
 * The reason is authoritative: a config reason can never reach a source gate.
 */
export function applyHeadingAutoNumberConflictFailure(
  counters: HeadingAutoNumberConflictCounters,
  failedChecks: readonly string[],
  transitionReason?: HeadingAutoNumberConflictTransitionReason,
): void {
  for (const check of failedChecks) {
    switch (check) {
      case 'CONFLICT_STATE_INCOHERENT':
        counters.headingAutoNumberConflictStateIncoherent++
        break
      case 'STYLE_SWITCH_LOST_CONFLICT':
        counters.headingAutoNumberConflictDisappearedOnStyleSwitch++
        break
      case 'ID_CHANGED_ON_STYLE_SWITCH':
        counters.headingAutoNumberConflictIdChangedOnStyleSwitch++
        break
      case 'STATE_KEY_UNSTABLE':
        counters.headingAutoNumberConflictUnstableIdentity++
        break
      case 'WRONG_SEVERITY':
        counters.headingAutoNumberConflictWrongSeverity++
        break
      case 'CONFLICT_WITHOUT_EFFECTIVE_AUTO_NUMBER':
        counters.headingAutoNumberConflictIgnoredEffectiveLevelPolicy++
        break
      case 'CONFLICT_WITHOUT_CONFIRMED_MANUAL_PREFIX':
      case 'MANUAL_PREFIX_NOT_IN_SOURCE_TEXT':
        counters.headingNumberContentFalsePositive++
        break
      case 'SOURCE_EVIDENCE_USES_GENERATED_PREFIX':
      case 'GENERATED_PREFIX_MISTAKEN_FOR_MANUAL':
        counters.autoGeneratedHeadingNumberReportedAsManual++
        break
      case 'STALE_CONFLICT_DIAGNOSTIC':
        counters.headingAutoNumberConflictStaleAfterSourceEdit++
        break
      case 'STALE_CONFLICT_FILL':
        counters.headingAutoNumberConflictStaleAfterNumberingDisabled++
        break
      default:
        break
    }
  }
  // §18 — belt & braces: a CONFIG reason can never be counted as a SOURCE reason.
  if (transitionReason === 'AUTO_NUMBER_ENABLED' || transitionReason === 'AUTO_NUMBER_DISABLED'
    || transitionReason === 'H1_NUMBERING_ENABLED' || transitionReason === 'H1_NUMBERING_DISABLED') {
    if (failedChecks.some(c => c === 'SOURCE_PREFIX_ADDED' || c === 'SOURCE_PREFIX_REMOVED' || c === 'SOURCE_PREFIX_CHANGED')) {
      counters.configTransitionCountedAsSourceTransition++
    }
  }
}

// ── §37 — the positive coverage ─────────────────────────────────────────────

export const HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS = [
  'decimal',
  'hierarchical',
  'chinese',
  'roman',
  'chapterStyle',
  'crossStyle',
  'dynamicSource',
  'dynamicConfig',
  'h1Toggle',
  'styleSwitch',
  'firstClickActive',
  'drawerViewportStable',
  'suppressionSameHeading',
  'nonConflictManualWarning',
] as const

export type HeadingAutoNumberConflictCoverageKey = typeof HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS[number]

export const HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS: Readonly<Record<HeadingAutoNumberConflictCoverageKey, string>> = {
  decimal: 'HEADING_AUTO_NUMBER_CONFLICT_DECIMAL_RUNTIME_COUNT',
  hierarchical: 'HEADING_AUTO_NUMBER_CONFLICT_HIERARCHICAL_RUNTIME_COUNT',
  chinese: 'HEADING_AUTO_NUMBER_CONFLICT_CHINESE_RUNTIME_COUNT',
  roman: 'HEADING_AUTO_NUMBER_CONFLICT_ROMAN_RUNTIME_COUNT',
  chapterStyle: 'HEADING_AUTO_NUMBER_CONFLICT_CHAPTER_STYLE_RUNTIME_COUNT',
  crossStyle: 'HEADING_AUTO_NUMBER_CONFLICT_CROSS_STYLE_RUNTIME_COUNT',
  dynamicSource: 'HEADING_AUTO_NUMBER_CONFLICT_DYNAMIC_SOURCE_RUNTIME_COUNT',
  dynamicConfig: 'HEADING_AUTO_NUMBER_CONFLICT_DYNAMIC_CONFIG_RUNTIME_COUNT',
  h1Toggle: 'HEADING_AUTO_NUMBER_CONFLICT_H1_TOGGLE_RUNTIME_COUNT',
  styleSwitch: 'HEADING_AUTO_NUMBER_CONFLICT_STYLE_SWITCH_RUNTIME_COUNT',
  firstClickActive: 'HEADING_AUTO_NUMBER_CONFLICT_FIRST_CLICK_ACTIVE_RUNTIME_COUNT',
  drawerViewportStable: 'HEADING_AUTO_NUMBER_CONFLICT_DRAWER_VIEWPORT_STABLE_RUNTIME_COUNT',
  suppressionSameHeading: 'SUPPRESSION_SAME_HEADING_RUNTIME_COUNT',
  nonConflictManualWarning: 'NON_CONFLICT_MANUAL_WARNING_RUNTIME_COUNT',
}

/** §37 — the minimum each positive-coverage counter must reach. */
export const HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_MINIMUMS: Readonly<Record<HeadingAutoNumberConflictCoverageKey, number>> = {
  decimal: 1,
  hierarchical: 1,
  chinese: 1,
  roman: 1,
  chapterStyle: 1,
  crossStyle: 2,
  dynamicSource: 1,
  dynamicConfig: 1,
  h1Toggle: 1,
  styleSwitch: 1,
  firstClickActive: 1,
  drawerViewportStable: 1,
  suppressionSameHeading: 1,
  nonConflictManualWarning: 1,
}

export type HeadingAutoNumberConflictCoverage = Record<HeadingAutoNumberConflictCoverageKey, number>

export function createHeadingAutoNumberConflictCoverage(): HeadingAutoNumberConflictCoverage {
  return HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingAutoNumberConflictCoverage)
}

/** §47 — note ONE real runtime conflict observation (kind/severity coverage). */
export function noteHeadingAutoNumberConflictCoverage(
  coverage: HeadingAutoNumberConflictCoverage,
  input: { manualPrefixKind: string | null; crossStyle: boolean },
): void {
  switch (input.manualPrefixKind) {
    case 'decimal':
      coverage.decimal++
      break
    case 'decimal-hierarchical':
      coverage.hierarchical++
      break
    case 'chinese':
      coverage.chinese++
      break
    case 'roman':
      coverage.roman++
      break
    case 'chapter-style':
      coverage.chapterStyle++
      break
    default:
      break
  }
  if (input.crossStyle) coverage.crossStyle++
}

/** §17/§18 — bump the coverage bucket OF THE CLASSIFIER'S REASON (no re-derivation). */
export function noteHeadingAutoNumberConflictCoverageForReason(
  coverage: HeadingAutoNumberConflictCoverage,
  reason: HeadingAutoNumberConflictTransitionReason,
): boolean {
  const key = coverageKeyForTransitionReason(reason)
  if (key == null) return false
  coverage[key]++
  return true
}

export function formatHeadingAutoNumberConflictCoverageReport(
  coverage: Readonly<HeadingAutoNumberConflictCoverage>,
): string[] {
  return HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS.map(key =>
    `${HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS[key]}=${coverage[key] ?? 0}/${HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_MINIMUMS[key]}`)
}

export function evaluateHeadingAutoNumberConflictCoverage(
  coverage: Readonly<HeadingAutoNumberConflictCoverage>,
): { decision: 'PASS' | 'FAIL'; unmet: HeadingAutoNumberConflictCoverageKey[] } {
  const unmet = HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_KEYS.filter(key =>
    (coverage[key] ?? 0) < HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_MINIMUMS[key])
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}

/**
 * §38 — the DUAL pass condition. A zero failure counter is NOT a pass on its
 * own: the corresponding POSITIVE runtime coverage must also be met.
 */
export interface HeadingAutoNumberConflictDualPass {
  decision: 'PASS' | 'FAIL'
  gatesOk: boolean
  coverageOk: boolean
  failedChecks: readonly string[]
  unmet: readonly HeadingAutoNumberConflictCoverageKey[]
}

export function evaluateHeadingAutoNumberConflictDualPass(
  counters: Readonly<HeadingAutoNumberConflictCounters>,
  coverage: Readonly<HeadingAutoNumberConflictCoverage>,
): HeadingAutoNumberConflictDualPass {
  const gates = evaluateHeadingAutoNumberConflictGates(counters)
  const cov = evaluateHeadingAutoNumberConflictCoverage(coverage)
  const gatesOk = gates.decision === 'PASS'
  const coverageOk = cov.decision === 'PASS'
  const failedChecks = [
    ...gates.failedChecks.map(k => HEADING_AUTO_NUMBER_CONFLICT_GATE_LABELS[k]),
    ...cov.unmet.map(k => `MISSING_POSITIVE_COVERAGE:${HEADING_AUTO_NUMBER_CONFLICT_COVERAGE_LABELS[k]}`),
  ]
  if (!gatesOk && !coverageOk) failedChecks.push('ZERO_FAILURE_COUNTER_WITH_ZERO_POSITIVE_COVERAGE_PASS')
  return {
    decision: gatesOk && coverageOk ? 'PASS' : 'FAIL',
    gatesOk,
    coverageOk,
    failedChecks,
    unmet: cov.unmet,
  }
}

// ── §19/§20 — the transaction-deduped, session-aware coverage report ────────

/**
 * §19 — ONE transaction = one coverage bump. The dedup key prevents a single
 * Auto-ON→OFF (which touches 17 headings) from being counted 17 times.
 */
export function headingAutoNumberConflictTransactionKey(input: {
  runtimeSessionId: string
  diagnosticsRevision: number
  transitionReason: HeadingAutoNumberConflictTransitionReason
  settingsRevision: number
  sourceRevision: number
}): string {
  return [input.runtimeSessionId, input.diagnosticsRevision, input.transitionReason,
    input.settingsRevision, input.sourceRevision].join('|')
}

/** §20 — the session-aware report envelope (never merged across sessions). */
export interface HeadingAutoNumberConflictReportEnvelope {
  runtimeSessionId: string
  reportSequence: number
  settingsRevision: number
  sourceRevision: number
  diagnosticsRevision: number
  baselineEstablished: boolean
  capturePhase: 'POST_COMMIT'
}
