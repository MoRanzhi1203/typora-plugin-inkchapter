/**
 * V1 — Heading Diagnostic Active Persistence (pure contract).
 *
 * THE DEFECT (proved by the real runtime):
 *   a heading diagnostic click completed ACTIVATE / SWITCH, Locate, the initial
 *   highlight and the initial Active Fill. Then a `layoutEpoch 37 → 38` reconcile
 *   rebuilt the passive markers ONLY: the ACTIVE emphasis was never re-projected,
 *   and because `passiveFillSuppressed` was derived from the IDENTITY
 *   (`headingActiveMarkerIdentity === identity`) rather than from a REAL active
 *   fill, the target ended with `activeMarkerPresent=true`,
 *   `activeFragmentRects=[]`, `fillFragmentCount=0`,
 *   `passiveFillSuppressed=true` — a visual vacuum that still audited PASS.
 *
 *   ROOT_H1 = ACTIVE_FILL_IS_A_CLICK_TIME_SIDE_EFFECT_NOT_A_STATE_DERIVED_PROJECTION
 *   ROOT_H2 = LAYOUT_EPOCH_REBUILD_DROPS_THE_ACTIVE_VISUAL
 *   ROOT_H3 = PASSIVE_SUPPRESSION_IS_ALLOWED_WITH_ZERO_ACTIVE_FILL
 *   ROOT_H4 = MARKER_AUDIT_PASSES_ON_A_BOOLEAN_WITH_ZERO_FRAGMENTS
 *   ROOT_H5 = POST_SETTLE_CLOSURE_NEVER_VERIFIES_THE_POST_RECONCILE_STATE
 *   ROOT_H6 = diagnosticTargetIndex_AND_transactionLocalTargetIndex_ARE_CONFLATED
 *   ROOT_H7 = ACTIVE_TARGET_READS_ARE_NOT_SCOPED_TO_ONE_DIAGNOSTIC
 *   ROOT_H8 = DRAWER_ROW_AND_BODY_HEADING_DO_NOT_SHARE_ONE_CANONICAL_TARGET_KEY
 *
 * Pure: no DOM, no host state.
 */

// ── The three new audits (§34/§35/§30) ────────────────────

export const HEADING_ACTIVE_PERSISTENCE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-ACTIVE-PERSISTENCE-AUDIT'
export const TARGET_INDEX_AUTHORITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-TARGET-INDEX-AUTHORITY-AUDIT'
export const HEADING_POST_RECONCILE_CLOSURE_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE'
/** §37 — the HEADING_LEVEL_GAP mirror of the cross-diagnostic active scope guard. */
export const HEADING_LEVEL_GAP_SCOPE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-LEVEL-GAP-SCOPE-AUDIT'

// ── §7/§8/§9 — the canonical target key namespaces ────────

/**
 * §8 — the canonical target key ALWAYS encodes the DIAGNOSTIC target index
 * (the index of the target inside `diagnostic.location.targets`). A
 * transaction-local index must never appear here.
 */
export function buildCanonicalDiagnosticTargetKey(input: {
  documentKey: string
  diagnosticId: string
  diagnosticTargetIndex: number
  stableHeadingIdentity: string
}): string {
  return [
    input.documentKey,
    input.diagnosticId,
    String(Math.max(0, Math.floor(input.diagnosticTargetIndex))),
    input.stableHeadingIdentity,
  ].join('::')
}

/** §9 — the Drawer row key: same namespace as the target key (never diagnosticId alone). */
export function buildCanonicalDrawerRowKey(input: {
  diagnosticId: string
  diagnosticTargetIndex: number
  stableHeadingIdentity: string
}): string {
  return [
    input.diagnosticId,
    String(Math.max(0, Math.floor(input.diagnosticTargetIndex))),
    input.stableHeadingIdentity,
  ].join('::')
}

/** §35 — the index a canonical key encodes (`...::<diagnosticId>::<index>::<identity>`). */
export function parseCanonicalTargetKeyIndex(key: string | null | undefined): number | null {
  if (key == null || key === '') return null
  const parts = key.split('::')
  if (parts.length < 3) return null
  const raw = parts[parts.length - 2]
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * §43/§65 — the canonical index of a click MUST survive entering a NARROWED
 * transaction. `transactionLocalTargetIndex` is legal (often 0) but it may NEVER
 * overwrite the canonical diagnostic index.
 */
export function resolveCanonicalTargetIndexAuthority(input: {
  diagnosticTargetIndex: number
  transactionLocalTargetIndex: number | null
  transactionTargetCount: number | null
  /**
   * The index a caller is ABOUT to encode as canonical. When it equals the
   * transaction-local index while the real diagnostic index differs, the local
   * index has aliased the canonical one (the defect).
   */
  reportedCanonicalIndex?: number | null
}): {
  canonicalDiagnosticTargetIndex: number
  transactionLocalTargetIndex: number | null
  aliased: boolean
  reason: string
} {
  const canonical = Math.max(0, Math.floor(input.diagnosticTargetIndex))
  const local = input.transactionLocalTargetIndex == null
    ? null
    : Math.max(0, Math.floor(input.transactionLocalTargetIndex))
  const reported = input.reportedCanonicalIndex == null
    ? null
    : Math.max(0, Math.floor(input.reportedCanonicalIndex))
  const aliased = reported != null && local != null && reported === local && reported !== canonical
  return {
    canonicalDiagnosticTargetIndex: canonical,
    transactionLocalTargetIndex: local,
    aliased,
    reason: aliased ? 'TRANSACTION_LOCAL_INDEX_ALIASES_DIAGNOSTIC_INDEX' : 'TARGET_INDEX_NAMESPACES_SEPARATED',
  }
}

// ── §6/§23/§28 — the state-derived active visual facts ────

export interface HeadingActiveVisualFacts {
  /** Fragments really painted by the ACTIVE emphasis for this heading. */
  fragmentCount: number
  fragmentRects: ReadonlyArray<{ left: number; top: number; width: number; height: number }>
  layoutEpoch: number
  geometryGeneration: number
  diagnosticId: string | null
  targetKey: string | null
  // ── V2 §5 — the CANONICAL TARGET AUTHORITY. Facts keyed only by heading
  // identity lose the multi-target index, so a wrong-target Active could never be
  // detected. These fields make the facts self-identifying.
  diagnosticTargetIndex: number | null
  transactionLocalTargetIndex: number | null
  /** the RAW stable identity of the target the facts were painted for. */
  stableHeadingIdentity: string
  /** the marker dedupe identity (`id:H1:idx:6`). */
  headingIdentity: string
  /** the interaction version the facts were committed under (§53 stale guard). */
  interactionVersion: number
}

/**
 * §21/§28 — the ONLY condition that permits suppressing the passive fill AND the
 * only source of truth for `activeMarkerPresent`.
 */
export function evaluateActiveVisualReadiness(input: {
  facts: HeadingActiveVisualFacts | null
  wrapperConnected: boolean
  currentLayoutEpoch: number
  currentGeometryGeneration: number
}): { ready: boolean; fragmentCount: number; reason: string } {
  const facts = input.facts
  if (!facts) return { ready: false, fragmentCount: 0, reason: 'NO_ACTIVE_VISUAL_FACTS' }
  if (!input.wrapperConnected) return { ready: false, fragmentCount: 0, reason: 'ACTIVE_WRAPPER_DISCONNECTED' }
  if (facts.fragmentCount < 1) return { ready: false, fragmentCount: 0, reason: 'ACTIVE_FRAGMENT_COUNT_ZERO' }
  if (facts.layoutEpoch !== input.currentLayoutEpoch) {
    return { ready: false, fragmentCount: facts.fragmentCount, reason: 'ACTIVE_VISUAL_LAYOUT_EPOCH_STALE' }
  }
  if (facts.geometryGeneration !== input.currentGeometryGeneration) {
    return { ready: false, fragmentCount: facts.fragmentCount, reason: 'ACTIVE_VISUAL_GEOMETRY_GENERATION_STALE' }
  }
  return { ready: true, fragmentCount: facts.fragmentCount, reason: 'ACTIVE_VISUAL_READY' }
}

// ── §24/§25/§26/§37 — the cross-diagnostic scope ──────────

export interface ActiveTargetScope {
  /** The ACTIVE interaction belongs to the diagnostic being projected. */
  belongsToDiagnostic: boolean
  activeTargetKey: string | null
  activeHeadingIdentity: string | null
  activeDiagnosticTargetIndex: number | null
}

/**
 * §24 — a diagnostic's visual audit may only see its OWN active target. When the
 * ACTIVE interaction belongs to another diagnostic the scoped target is null
 * (the legacy code read the GLOBAL `headingActiveMarkerIdentity`, so a H3 gap
 * target leaked into the strict multi-H1 audit).
 */
export function activeTargetScopeForDiagnostic(input: {
  phase: 'IDLE' | 'ACTIVE'
  activeDiagnosticId: string | null
  activeTargetKey: string | null
  activeHeadingIdentity: string | null
  activeDiagnosticTargetIndex: number | null
  diagnosticId: string
}): ActiveTargetScope {
  const belongs = input.phase === 'ACTIVE' && input.activeDiagnosticId === input.diagnosticId
  if (!belongs) {
    return {
      belongsToDiagnostic: false,
      activeTargetKey: null,
      activeHeadingIdentity: null,
      activeDiagnosticTargetIndex: null,
    }
  }
  return {
    belongsToDiagnostic: true,
    activeTargetKey: input.activeTargetKey,
    activeHeadingIdentity: input.activeHeadingIdentity,
    activeDiagnosticTargetIndex: input.activeDiagnosticTargetIndex,
  }
}

// ── §27/§62 — the audit success conditions ────────────────

export interface HeadingMarkerAuditDecisionInput {
  /** Does an ACTIVE interaction own this heading right now? */
  activeOwned: boolean
  activeMarkerPresent: boolean
  activeFragmentCount: number
  activeFillCount: number
  activeFragmentMeasurable: boolean
  activeFragmentVisible: boolean
  activeFragmentHeadingIdentityMatches: boolean
  activeFragmentLayoutEpochCurrent: boolean
  activeFragmentGeometryGenerationCurrent: boolean
  passiveFillSuppressed: boolean
}

/**
 * §27/§62 — `activeMarkerPresent=true` with `fillFragmentCount=0` MUST FAIL. The
 * boolean is never a success condition on its own.
 */
export function evaluateHeadingMarkerAuditDecision(input: HeadingMarkerAuditDecisionInput): {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
  /** §28 — the REAL value of the boolean (never a logical flag). */
  effectiveActiveMarkerPresent: boolean
} {
  const failed: string[] = []
  const effectiveActiveMarkerPresent = input.activeMarkerPresent
    && input.activeFragmentCount >= 1
    && input.activeFillCount >= 1
  if (!input.activeOwned) {
    // A passive heading has no active obligation.
    return {
      decision: input.passiveFillSuppressed ? 'FAIL' : 'PASS',
      reason: input.passiveFillSuppressed ? 'PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_OWNER' : 'PASSIVE_HEADING_OK',
      failedChecks: input.passiveFillSuppressed ? ['PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_OWNER'] : [],
      effectiveActiveMarkerPresent: false,
    }
  }
  if (!input.activeMarkerPresent) failed.push('ACTIVE_OWNER_WITHOUT_ACTIVE_MARKER')
  if (input.activeFragmentCount < 1) failed.push('ACTIVE_HEADING_WITH_ZERO_FRAGMENT')
  if (input.activeFillCount < 1) failed.push('ACTIVE_HEADING_WITH_ZERO_FILL')
  if (input.activeMarkerPresent && input.activeFillCount < 1) failed.push('MARKER_BOOLEAN_WITHOUT_FRAGMENT')
  if (!input.activeFragmentMeasurable) failed.push('ACTIVE_FRAGMENT_NOT_MEASURABLE')
  if (!input.activeFragmentVisible) failed.push('ACTIVE_FRAGMENT_NOT_VISIBLE')
  if (!input.activeFragmentHeadingIdentityMatches) failed.push('ACTIVE_FRAGMENT_WRONG_HEADING')
  if (!input.activeFragmentLayoutEpochCurrent) failed.push('ACTIVE_VISUAL_LOST_AFTER_LAYOUT_EPOCH')
  if (!input.activeFragmentGeometryGenerationCurrent) failed.push('ACTIVE_VISUAL_LOST_AFTER_GEOMETRY_GENERATION')
  if (input.passiveFillSuppressed && input.activeFillCount < 1) failed.push('PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_FILL')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'ACTIVE_HEADING_VISUAL_CLOSED' : failed.join(','),
    failedChecks: failed,
    effectiveActiveMarkerPresent,
  }
}

/**
 * §29 — the heading coverage mask must be derived from the REAL active fragment
 * rects, never from the expected policy alone.
 */
export function evaluateHeadingActiveCoverageDecision(input: {
  coveragePolicy: 'NONE' | 'NUMBER_ONLY' | 'TITLE_ONLY' | 'FULL_VISIBLE_HEADING'
  activeFragmentCount: number
}): { mask: 'NONE' | 'NUMBER_ONLY' | 'TITLE_ONLY' | 'FULL_VISIBLE_HEADING'; decision: 'PASS' | 'FAIL'; reason: string } {
  if (input.activeFragmentCount < 1) {
    return { mask: 'NONE', decision: 'FAIL', reason: 'ACTIVE_RECT_EMPTY_COVERAGE_NONE' }
  }
  return { mask: input.coveragePolicy, decision: 'PASS', reason: 'ACTIVE_COVERAGE_FROM_REAL_RECTS' }
}

// ── §38/§53/§62 — the hard gates ──────────────────────────

export const HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS = [
  // active persistence (§38)
  'activeHeadingWithZeroFragment',
  'activeHeadingWithZeroFill',
  'activeHeadingMarkerBooleanWithoutFragment',
  'activeHeadingVisualLostAfterLayoutEpoch',
  'activeHeadingVisualLostAfterGeometryGeneration',
  'activeHeadingPassiveSuppressedWithoutActiveFill',
  'activeHeadingReconcileSkipped',
  'headingActiveVisualFalsePass',
  'drawerActiveRowWithoutHeadingActiveVisual',
  'headingActiveVisualWithoutDrawerActiveRow',
  // target index authority (§36)
  'diagnosticTargetIndexTransactionLocalIndexAlias',
  'multiTargetHeadingActiveTargetKeyMismatch',
  'multiTargetHeadingWrongSubtargetActive',
  'drawerRowCanonicalTargetIndexMismatch',
  'headingVisualCanonicalTargetIndexMismatch',
  // cross-diagnostic scope (§37)
  'crossDiagnosticActiveTargetLeak',
  'strictMultiH1AuditForeignActiveTarget',
  'headingLevelGapAuditForeignActiveTarget',
  // stale projection (§53)
  'staleHeadingVisualCallbackApplied',
  'staleHeadingVisualCallbackClearedNewActive',
  'staleHeadingGeometryCommitted',
  // §50/§62 extras
  'idleWithPassiveFillSuppressed',
  'headingAuditPassWithZeroActiveFill',
] as const

export type HeadingActivePersistenceV1GateKey = typeof HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS[number]

export const HEADING_ACTIVE_PERSISTENCE_V1_GATE_LABELS: Readonly<Record<HeadingActivePersistenceV1GateKey, string>> = {
  activeHeadingWithZeroFragment: 'ACTIVE_HEADING_WITH_ZERO_FRAGMENT_COUNT',
  activeHeadingWithZeroFill: 'ACTIVE_HEADING_WITH_ZERO_FILL_COUNT',
  activeHeadingMarkerBooleanWithoutFragment: 'ACTIVE_HEADING_MARKER_BOOLEAN_WITHOUT_FRAGMENT_COUNT',
  activeHeadingVisualLostAfterLayoutEpoch: 'ACTIVE_HEADING_VISUAL_LOST_AFTER_LAYOUT_EPOCH_COUNT',
  activeHeadingVisualLostAfterGeometryGeneration: 'ACTIVE_HEADING_VISUAL_LOST_AFTER_GEOMETRY_GENERATION_COUNT',
  activeHeadingPassiveSuppressedWithoutActiveFill: 'ACTIVE_HEADING_PASSIVE_SUPPRESSED_WITHOUT_ACTIVE_FILL_COUNT',
  activeHeadingReconcileSkipped: 'ACTIVE_HEADING_RECONCILE_SKIPPED_COUNT',
  headingActiveVisualFalsePass: 'HEADING_ACTIVE_VISUAL_FALSE_PASS_COUNT',
  drawerActiveRowWithoutHeadingActiveVisual: 'DRAWER_ACTIVE_ROW_WITHOUT_HEADING_ACTIVE_VISUAL_COUNT',
  headingActiveVisualWithoutDrawerActiveRow: 'HEADING_ACTIVE_VISUAL_WITHOUT_DRAWER_ACTIVE_ROW_COUNT',
  diagnosticTargetIndexTransactionLocalIndexAlias: 'DIAGNOSTIC_TARGET_INDEX_TRANSACTION_LOCAL_INDEX_ALIAS_COUNT',
  multiTargetHeadingActiveTargetKeyMismatch: 'MULTI_TARGET_HEADING_ACTIVE_TARGETKEY_MISMATCH_COUNT',
  multiTargetHeadingWrongSubtargetActive: 'MULTI_TARGET_HEADING_WRONG_SUBTARGET_ACTIVE_COUNT',
  drawerRowCanonicalTargetIndexMismatch: 'DRAWER_ROW_CANONICAL_TARGET_INDEX_MISMATCH_COUNT',
  headingVisualCanonicalTargetIndexMismatch: 'HEADING_VISUAL_CANONICAL_TARGET_INDEX_MISMATCH_COUNT',
  crossDiagnosticActiveTargetLeak: 'CROSS_DIAGNOSTIC_ACTIVE_TARGET_LEAK_COUNT',
  strictMultiH1AuditForeignActiveTarget: 'STRICT_MULTI_H1_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT',
  headingLevelGapAuditForeignActiveTarget: 'HEADING_LEVEL_GAP_AUDIT_FOREIGN_ACTIVE_TARGET_COUNT',
  staleHeadingVisualCallbackApplied: 'STALE_HEADING_VISUAL_CALLBACK_APPLIED_COUNT',
  staleHeadingVisualCallbackClearedNewActive: 'STALE_HEADING_VISUAL_CALLBACK_CLEARED_NEW_ACTIVE_COUNT',
  staleHeadingGeometryCommitted: 'STALE_HEADING_GEOMETRY_COMMITTED_COUNT',
  idleWithPassiveFillSuppressed: 'IDLE_WITH_PASSIVE_FILL_SUPPRESSED_COUNT',
  headingAuditPassWithZeroActiveFill: 'HEADING_AUDIT_PASS_WITH_ZERO_ACTIVE_FILL_COUNT',
}

export type HeadingActivePersistenceV1Counters = Record<HeadingActivePersistenceV1GateKey, number>

export function createHeadingActivePersistenceV1Counters(): HeadingActivePersistenceV1Counters {
  return HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingActivePersistenceV1Counters)
}

export function formatHeadingActivePersistenceV1GateReport(
  counters: Readonly<HeadingActivePersistenceV1Counters>,
): string[] {
  return HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS.map(k => `${HEADING_ACTIVE_PERSISTENCE_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateHeadingActivePersistenceV1Gates(
  counters: Readonly<HeadingActivePersistenceV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingActivePersistenceV1GateKey[] } {
  const failedChecks = HEADING_ACTIVE_PERSISTENCE_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §39/§61 — the positive coverage ──────────────────────

export const HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS = [
  'activeHeadingInitialActivateRuntime',
  'activeHeadingSwitchRuntime',
  'activeHeadingRebuiltAfterLayoutEpoch',
  'activeHeadingRebuiltAfterGeometryGeneration',
  'multiTargetHeadingDistinctSubtargetActivation',
  'headingSameTargetDeactivateRuntime',
] as const

export type HeadingActivePersistenceV1CoverageKey = typeof HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS[number]

export const HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_LABELS: Readonly<Record<HeadingActivePersistenceV1CoverageKey, string>> = {
  activeHeadingInitialActivateRuntime: 'ACTIVE_HEADING_INITIAL_ACTIVATE_RUNTIME_COUNT',
  activeHeadingSwitchRuntime: 'ACTIVE_HEADING_SWITCH_RUNTIME_COUNT',
  activeHeadingRebuiltAfterLayoutEpoch: 'ACTIVE_HEADING_REBUILT_AFTER_LAYOUT_EPOCH_COUNT',
  activeHeadingRebuiltAfterGeometryGeneration: 'ACTIVE_HEADING_REBUILT_AFTER_GEOMETRY_GENERATION_COUNT',
  multiTargetHeadingDistinctSubtargetActivation: 'MULTI_TARGET_HEADING_DISTINCT_SUBTARGET_ACTIVATION_COUNT',
  headingSameTargetDeactivateRuntime: 'HEADING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT',
}

export const HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_MINIMUMS: Readonly<Record<HeadingActivePersistenceV1CoverageKey, number>> = {
  activeHeadingInitialActivateRuntime: 1,
  activeHeadingSwitchRuntime: 1,
  activeHeadingRebuiltAfterLayoutEpoch: 1,
  activeHeadingRebuiltAfterGeometryGeneration: 1,
  multiTargetHeadingDistinctSubtargetActivation: 2,
  headingSameTargetDeactivateRuntime: 1,
}

export type HeadingActivePersistenceV1CoverageCounters = Record<HeadingActivePersistenceV1CoverageKey, number>

export function createHeadingActivePersistenceV1CoverageCounters(): HeadingActivePersistenceV1CoverageCounters {
  return HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingActivePersistenceV1CoverageCounters)
}

export function formatHeadingActivePersistenceV1CoverageReport(
  counters: Readonly<HeadingActivePersistenceV1CoverageCounters>,
): string[] {
  return HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS.map(k => `${HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateHeadingActivePersistenceV1Coverage(
  counters: Readonly<HeadingActivePersistenceV1CoverageCounters>,
  minimums: Readonly<Record<HeadingActivePersistenceV1CoverageKey, number>> = HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: HeadingActivePersistenceV1CoverageKey[] } {
  const unmet = HEADING_ACTIVE_PERSISTENCE_V1_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}

// ── §30/§32/§33 — the post-reconcile closure ─────────────

export interface HeadingPostReconcileClosureInput {
  phase: 'IDLE' | 'ACTIVE'
  activeTargetIsHeading: boolean
  selectedActiveRowCount: number
  activeTargetCount: number
  activeHeadingFragmentCount: number
  activeFillCount: number
  activeLeasePresent: boolean
  activeTargetKeyMatchesState: boolean
  activeHeadingIdentityMatchesTargetKey: boolean
  activeFragmentLayoutEpochCurrent: boolean
  activeFragmentGeometryGenerationCurrent: boolean
  drawerActiveRowCount: number
  /**
   * §33 — whether the Drawer REALLY rendered diagnostic rows. The Drawer/Heading
   * agreement can only be judged when the Drawer exists; a closed Drawer is not a
   * "heading visual without a Drawer row" defect.
   */
  drawerRowsRendered?: boolean
}

/**
 * §32/§33 — after EVERY heading projection commit the closure must hold again.
 * A clean click-settle closure is NOT sufficient (§63).
 */
export function evaluateHeadingPostReconcileClosure(input: HeadingPostReconcileClosureInput): {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
} {
  if (input.phase !== 'ACTIVE') {
    // true IDLE — nothing of the Active interaction may survive.
    const failed: string[] = []
    if (input.drawerActiveRowCount !== 0) failed.push('IDLE_WITH_DRAWER_ACTIVE_ROW')
    if (input.activeFillCount !== 0) failed.push('IDLE_WITH_ACTIVE_FILL')
    if (input.activeHeadingFragmentCount !== 0) failed.push('IDLE_WITH_ACTIVE_HEADING_FRAGMENT')
    if (input.activeLeasePresent) failed.push('IDLE_WITH_ACTIVE_LEASE')
    return {
      decision: failed.length === 0 ? 'PASS' : 'FAIL',
      reason: failed.length === 0 ? 'IDLE_CLOSURE_OK' : failed.join(','),
      failedChecks: failed,
    }
  }
  if (!input.activeTargetIsHeading) {
    // a NON-heading active target (code / table / figure …) legitimately holds a
    // lease and a Drawer row; it may only never claim a HEADING active fill.
    return {
      decision: input.activeHeadingFragmentCount === 0 && input.activeFillCount === 0 ? 'PASS' : 'FAIL',
      reason: input.activeHeadingFragmentCount === 0 ? 'NON_HEADING_ACTIVE_TARGET' : 'NON_HEADING_ACTIVE_WITH_HEADING_FILL',
      failedChecks: input.activeHeadingFragmentCount === 0 ? [] : ['NON_HEADING_ACTIVE_WITH_HEADING_FILL'],
    }
  }
  const failed: string[] = []
  // §33 — the Drawer agreement is only meaningful when the Drawer really rendered.
  const drawerRendered = input.drawerRowsRendered !== false
  if (drawerRendered && input.selectedActiveRowCount !== 1) failed.push('SELECTED_ACTIVE_ROW_COUNT_NOT_ONE')
  if (drawerRendered && input.drawerActiveRowCount !== 1) failed.push('DRAWER_ACTIVE_ROW_COUNT_NOT_ONE')
  if (input.activeTargetCount !== 1) failed.push('ACTIVE_TARGET_COUNT_NOT_ONE')
  if (input.activeHeadingFragmentCount < 1) failed.push('ACTIVE_HEADING_FRAGMENT_COUNT_ZERO')
  if (input.activeFillCount < 1) failed.push('ACTIVE_FILL_COUNT_ZERO')
  if (!input.activeLeasePresent) failed.push('ACTIVE_LEASE_MISSING')
  if (!input.activeTargetKeyMatchesState) failed.push('ACTIVE_TARGETKEY_MISMATCH')
  if (!input.activeHeadingIdentityMatchesTargetKey) failed.push('ACTIVE_HEADING_IDENTITY_MISMATCH')
  if (!input.activeFragmentLayoutEpochCurrent) failed.push('ACTIVE_FRAGMENT_LAYOUT_EPOCH_STALE')
  if (!input.activeFragmentGeometryGenerationCurrent) failed.push('ACTIVE_FRAGMENT_GEOMETRY_GENERATION_STALE')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'POST_RECONCILE_CLOSURE_OK' : failed.join(','),
    failedChecks: failed,
  }
}
