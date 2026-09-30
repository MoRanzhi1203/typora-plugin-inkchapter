/**
 * V2 — Canonical Active Heading Target Authority (pure contract).
 *
 * THE DEFECT (proved by the real Typora runtime, session sess-1790783840536):
 *
 *   state:          diagnosticTargetIndex = 1
 *                   targetKey              = scratch/doc.md::...::1::H1:idx:6
 *   reconcile:      activeOwnerBefore     = id:H1:idx:6
 *                   activeOwnerAfter      = id:H1:idx:1     ← WRONG TARGET
 *                   HEADING-ACTIVE-PERSISTENCE-AUDIT decision = PASS
 *                   HEADING-POST-RECONCILE-CLOSURE  decision = FAIL
 *                                                   reason   = ACTIVE_HEADING_IDENTITY_MISMATCH
 *
 *   ROOT_V2_1 = the ACTIVE re-projection resolved only `diagnosticId` through the
 *               GENERIC marker resolver, which returns the diagnostic's DEFAULT
 *               (first) target — so a multi-target 2/2 fell back to 1/2.
 *   ROOT_V2_2 = the persistence audit verified "an Active fill exists", never
 *               "which canonical target it belongs to" (existence-only PASS).
 *   ROOT_V2_3 = the visual layer could still WRITE the interaction state
 *               (`ensureActiveDiagnosticStateFor`), i.e. State -> Visual -> State.
 *   ROOT_V2_4 = the same-target DEACTIVATE closure ran BEFORE the teardown
 *               commit, so it observed a still-alive Active row / fill / lease.
 *   ROOT_V2_5 = historical selection mirrors could still act as Active authority.
 *   ROOT_V2_6 = the Strict Multi-H1 audit derived its decision from CUMULATIVE
 *               counters instead of the CURRENT snapshot.
 *   ROOT_V2_7 = a jsdom PASS was reported as a real-Typora PASS.
 *
 * Pure: no DOM mutation, no host state, no side effects.
 */

// ── §22 — the one-way authority audit ─────────────────────

export const ACTIVE_TARGET_AUTHORITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-ACTIVE-TARGET-AUTHORITY-AUDIT'

// ── §2/§3 — the canonical active heading target ───────────

export interface CanonicalActiveHeadingTarget {
  documentKey: string
  diagnosticId: string
  diagnosticTargetIndex: number
  transactionLocalTargetIndex: number | null
  targetKey: string
  /** the RAW stable identity of the exact target (`H1:idx:6`). */
  stableHeadingIdentity: string
  /** the marker dedupe identity derived from it (`id:H1:idx:6`). */
  headingIdentity: string
  element: HTMLElement
}

export interface CanonicalActiveTargetStateInput {
  phase: 'IDLE' | 'ACTIVE'
  diagnosticId: string | null
  targetKey: string | null
  diagnosticTargetIndex: number | null
  transactionLocalTargetIndex: number | null
}

export interface CanonicalActiveTargetDiagnosticInput {
  id: string
  severity: string
  stableIdentity?: string | null
  /** false when `location.kind === 'multi-target'`. */
  isMultiTarget: boolean
}

export interface CanonicalActiveTargetProjectionInput {
  diagnosticId: string
  targetIndex: number
  stableIdentity: string
}

export type CanonicalActiveTargetResolveFailure =
  | 'PHASE_NOT_ACTIVE'
  | 'NO_DIAGNOSTIC'
  | 'TARGET_INDEX_NULL'
  | 'TARGET_KEY_MISSING'
  | 'TARGET_KEY_NAMESPACE_MISMATCH'
  | 'TARGET_KEY_INDEX_MISMATCH'
  | 'TARGET_INDEX_OUT_OF_RANGE'
  | 'PROJECTION_NOT_FOUND'
  | 'DUPLICATE_IDENTITY_AMBIGUITY'
  | 'TARGET_KEY_IDENTITY_MISMATCH'
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_DISCONNECTED'

export type CanonicalActiveTargetResolution =
  | { ok: true; reason: 'CANONICAL_ACTIVE_TARGET_EXACT'; target: CanonicalActiveHeadingTarget }
  | {
    ok: false
    reason: CanonicalActiveTargetResolveFailure
    diagnosticId: string | null
    diagnosticTargetIndex: number | null
    /** the marker identity the state IMPLIES (`id:H1:idx:6`) when derivable. */
    expectedHeadingIdentity: string | null
  }

/** `...::<documentKey>::<diagnosticId>::<index>::<stableIdentity>` → the index. */
export function parseCanonicalTargetKeyIndexV2(key: string | null | undefined): number | null {
  if (key == null || key === '') return null
  const parts = key.split('::')
  if (parts.length < 4) return null
  const n = Number.parseInt(parts[parts.length - 2], 10)
  return Number.isFinite(n) ? n : null
}

/** the RAW stable identity encoded in a canonical target key. */
export function parseCanonicalTargetKeyIdentityV2(key: string | null | undefined): string | null {
  if (key == null || key === '') return null
  const parts = key.split('::')
  if (parts.length < 4) return null
  const identity = parts[parts.length - 1]
  return identity === '' ? null : identity
}

/** the marker dedupe identity for a raw stable identity (`H1:idx:6` → `id:H1:idx:6`). */
export function markerIdentityOfStableIdentity(stableIdentity: string | null | undefined): string | null {
  if (stableIdentity == null || stableIdentity === '') return null
  return `id:${stableIdentity}`
}

/**
 * §3 — resolve the EXACT Active heading target from the interaction state.
 *
 * FAIL CLOSED: a multi-target state that cannot be resolved to its OWN target
 * NEVER falls back to `targets[0]`.
 */
export function resolveCanonicalActiveHeadingTarget(input: {
  state: CanonicalActiveTargetStateInput
  documentKey: string
  diagnostic: CanonicalActiveTargetDiagnosticInput | null
  projections: ReadonlyArray<CanonicalActiveTargetProjectionInput>
  resolveHeadingElement(stableIdentity: string): HTMLElement | null
}): CanonicalActiveTargetResolution {
  const { state, documentKey, diagnostic, projections, resolveHeadingElement } = input
  const fail = (
    reason: CanonicalActiveTargetResolveFailure,
    expectedHeadingIdentity: string | null = null,
  ): CanonicalActiveTargetResolution => ({
    ok: false,
    reason,
    diagnosticId: state.diagnosticId,
    diagnosticTargetIndex: state.diagnosticTargetIndex,
    expectedHeadingIdentity,
  })

  if (state.phase !== 'ACTIVE') return fail('PHASE_NOT_ACTIVE')
  if (state.diagnosticId == null || state.diagnosticId === '') return fail('NO_DIAGNOSTIC')
  if (diagnostic == null) return fail('NO_DIAGNOSTIC')
  if (state.diagnosticTargetIndex == null) return fail('TARGET_INDEX_NULL')
  if (state.targetKey == null || state.targetKey === '') return fail('TARGET_KEY_MISSING')

  const index = Math.max(0, Math.floor(state.diagnosticTargetIndex))
  // the key MUST belong to this document + diagnostic.
  const prefix = `${documentKey}::${state.diagnosticId}::`
  if (!state.targetKey.startsWith(prefix)) return fail('TARGET_KEY_NAMESPACE_MISMATCH')
  const encodedIndex = parseCanonicalTargetKeyIndexV2(state.targetKey)
  if (encodedIndex == null || encodedIndex !== index) return fail('TARGET_KEY_INDEX_MISMATCH')

  // the exact target: the projection of THIS diagnostic at THIS index.
  let own = projections.filter(p => p.diagnosticId === state.diagnosticId && p.targetIndex === index)
  if (own.length === 0 && !diagnostic.isMultiTarget && index === 0) {
    // single-target compatibility: the diagnostic IS its own only target.
    const stable = typeof diagnostic.stableIdentity === 'string' ? diagnostic.stableIdentity : ''
    if (stable !== '') own = [{ diagnosticId: state.diagnosticId, targetIndex: 0, stableIdentity: stable }]
  }
  if (own.length === 0) return fail('TARGET_INDEX_OUT_OF_RANGE')
  const distinct = new Set(own.map(p => p.stableIdentity).filter(s => s !== ''))
  if (distinct.size > 1) return fail('DUPLICATE_IDENTITY_AMBIGUITY')
  const stableHeadingIdentity = [...distinct][0] ?? ''
  if (stableHeadingIdentity === '') return fail('PROJECTION_NOT_FOUND')
  const headingIdentity = markerIdentityOfStableIdentity(stableHeadingIdentity)!
  const keyIdentity = parseCanonicalTargetKeyIdentityV2(state.targetKey)
  if (keyIdentity == null || keyIdentity !== stableHeadingIdentity) {
    return fail('TARGET_KEY_IDENTITY_MISMATCH', headingIdentity)
  }
  const element = resolveHeadingElement(stableHeadingIdentity)
  if (!element) return fail('ELEMENT_NOT_FOUND', headingIdentity)
  if (!element.isConnected) return fail('ELEMENT_DISCONNECTED', headingIdentity)

  return {
    ok: true,
    reason: 'CANONICAL_ACTIVE_TARGET_EXACT',
    target: {
      documentKey,
      diagnosticId: state.diagnosticId,
      diagnosticTargetIndex: index,
      transactionLocalTargetIndex: state.transactionLocalTargetIndex,
      targetKey: state.targetKey,
      stableHeadingIdentity,
      headingIdentity,
      element,
    },
  }
}

// ── §6/§7 — the identity closure ──────────────────────────

export interface ActiveTargetAuthorityFacts {
  phase: 'IDLE' | 'ACTIVE'
  activeTargetIsHeading: boolean

  stateDiagnosticId: string | null
  stateDiagnosticTargetIndex: number | null
  stateTargetKey: string | null
  /** the marker identity the state's targetKey ENCODES (`id:H1:idx:6`). */
  stateHeadingIdentity: string | null

  visualDiagnosticId: string | null
  visualDiagnosticTargetIndex: number | null
  visualTargetKey: string | null
  visualHeadingIdentity: string | null

  drawerTargetKey: string | null
  leaseTargetKey: string | null

  fragmentCount: number
  fillCount: number
  activeLeasePresent: boolean
  activeTargetCount: number
  selectedActiveRowCount: number
  drawerActiveRowCount: number
  drawerRowsRendered: boolean

  layoutEpochCurrent: boolean
  geometryGenerationCurrent: boolean
}

export interface ActiveTargetAuthorityMatches {
  diagnosticIdMatch: boolean
  diagnosticTargetIndexMatch: boolean
  targetKeyMatch: boolean
  stableHeadingIdentityMatch: boolean
  drawerAuthorityMatch: boolean
  leaseAuthorityMatch: boolean
}

/**
 * §6 — existence is NOT acceptance: the ACTIVE visual must belong to the
 * CANONICAL target the state committed.
 */
export function evaluateActiveTargetAuthority(
  facts: ActiveTargetAuthorityFacts,
): {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
  matches: ActiveTargetAuthorityMatches
  /** §3.3 — the visual is on a DIFFERENT heading than the canonical target. */
  visualOnForeignHeading: boolean
} {
  const matches: ActiveTargetAuthorityMatches = {
    diagnosticIdMatch: facts.visualDiagnosticId != null && facts.visualDiagnosticId === facts.stateDiagnosticId,
    diagnosticTargetIndexMatch: facts.visualDiagnosticTargetIndex != null
      && facts.visualDiagnosticTargetIndex === facts.stateDiagnosticTargetIndex,
    targetKeyMatch: facts.visualTargetKey != null && facts.visualTargetKey === facts.stateTargetKey,
    stableHeadingIdentityMatch: facts.visualHeadingIdentity != null
      && (facts.visualHeadingIdentity === facts.stateHeadingIdentity
        || facts.visualHeadingIdentity === facts.stateHeadingIdentity?.replace(/^id:/, '')),
    drawerAuthorityMatch: !facts.drawerRowsRendered
      || (facts.drawerTargetKey != null && facts.drawerTargetKey === facts.stateTargetKey),
    // §6 — a lease can only be judged when one EXISTS; the "ACTIVE heading without
    // a lease" case is the V1 closure's `ACTIVE_LEASE_MISSING` check. What V2 adds
    // is a lease that exists but belongs to a DIFFERENT target.
    leaseAuthorityMatch: !facts.activeLeasePresent
      || (facts.leaseTargetKey != null && facts.leaseTargetKey === facts.stateTargetKey),
  }
  const visualOnForeignHeading = facts.visualHeadingIdentity != null
    && facts.stateHeadingIdentity != null
    && !matches.stableHeadingIdentityMatch

  if (facts.phase !== 'ACTIVE') {
    return {
      decision: 'PASS', reason: 'NOT_ACTIVE', failedChecks: [], matches, visualOnForeignHeading,
    }
  }
  if (!facts.activeTargetIsHeading) {
    return {
      decision: facts.fragmentCount === 0 && facts.fillCount === 0 ? 'PASS' : 'FAIL',
      reason: facts.fragmentCount === 0 ? 'NON_HEADING_ACTIVE_TARGET' : 'NON_HEADING_ACTIVE_WITH_HEADING_FILL',
      failedChecks: facts.fragmentCount === 0 ? [] : ['NON_HEADING_ACTIVE_WITH_HEADING_FILL'],
      matches,
      visualOnForeignHeading,
    }
  }
  const failed: string[] = []
  if (facts.fragmentCount < 1) failed.push('ACTIVE_HEADING_FRAGMENT_COUNT_ZERO')
  if (facts.fillCount < 1) failed.push('ACTIVE_FILL_COUNT_ZERO')
  if (!matches.targetKeyMatch) failed.push('ACTIVE_STATE_VISUAL_TARGET_KEY_MISMATCH')
  if (!matches.diagnosticTargetIndexMatch) failed.push('ACTIVE_STATE_VISUAL_DIAGNOSTIC_TARGET_INDEX_MISMATCH')
  if (!matches.stableHeadingIdentityMatch) failed.push('ACTIVE_STATE_VISUAL_HEADING_IDENTITY_MISMATCH')
  if (!matches.diagnosticIdMatch) failed.push('ACTIVE_STATE_VISUAL_DIAGNOSTIC_ID_MISMATCH')
  if (!matches.drawerAuthorityMatch) failed.push('ACTIVE_DRAWER_TARGET_KEY_MISMATCH')
  if (!matches.leaseAuthorityMatch) failed.push('ACTIVE_LEASE_TARGET_KEY_MISMATCH')
  if (!facts.layoutEpochCurrent) failed.push('ACTIVE_FRAGMENT_LAYOUT_EPOCH_STALE')
  if (!facts.geometryGenerationCurrent) failed.push('ACTIVE_FRAGMENT_GEOMETRY_GENERATION_STALE')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'ACTIVE_CANONICAL_TARGET_IDENTITY_OK' : failed.join(','),
    failedChecks: failed,
    matches,
    visualOnForeignHeading,
  }
}

// ── §10 — the Strict Multi-H1 CURRENT snapshot decision ────

export interface StrictMultiH1CurrentSnapshotInput {
  expectedExcessTargetCount: number
  diagnosticTargetCount: number
  visualTargetCount: number
  locateTargetCount: number | null
  auditTargetCount: number
  passiveMarkerCount: number
  siblingPassiveLostCount: number
  /** CURRENT-frame facts only — never a cumulative counter. */
  activeTargetNotInExcessSet: boolean
  passiveActiveFillStackCount: number
  activeMarkerCountGt1: number
}

/**
 * §10.1 — the decision is computed from THIS snapshot only. Historical totals
 * live in `coverageCounters` and must never contaminate the current decision.
 */
export function evaluateStrictMultiH1CurrentSnapshot(
  input: StrictMultiH1CurrentSnapshotInput,
): {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
  currentExpectedCountMismatch: 0 | 1
  currentPassiveCountMismatch: 0 | 1
} {
  const countsAgree = input.expectedExcessTargetCount === input.diagnosticTargetCount
    && input.expectedExcessTargetCount === input.visualTargetCount
    && input.expectedExcessTargetCount === input.auditTargetCount
    && (input.locateTargetCount == null || input.locateTargetCount === input.expectedExcessTargetCount)
  const currentExpectedCountMismatch: 0 | 1 = countsAgree ? 0 : 1
  const currentPassiveCountMismatch: 0 | 1 =
    input.passiveMarkerCount === input.expectedExcessTargetCount ? 0 : 1
  const failed: string[] = []
  if (currentExpectedCountMismatch === 1) failed.push('STRICT_MULTI_H1_CURRENT_EXPECTED_COUNT_MISMATCH')
  if (currentPassiveCountMismatch === 1) failed.push('STRICT_MULTI_H1_CURRENT_PASSIVE_COUNT_MISMATCH')
  if (input.siblingPassiveLostCount > 0) failed.push('STRICT_MULTI_H1_SIBLING_PASSIVE_LOST')
  if (input.activeTargetNotInExcessSet) failed.push('STRICT_MULTI_H1_ACTIVE_TARGET_NOT_IN_EXCESS_SET')
  if (input.passiveActiveFillStackCount > 0) failed.push('STRICT_MULTI_H1_PASSIVE_ACTIVE_FILL_STACK')
  if (input.activeMarkerCountGt1 > 0) failed.push('STRICT_MULTI_H1_ACTIVE_MARKER_COUNT_GT1')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'STRICT_MULTI_H1_CURRENT_SNAPSHOT_OK' : failed.join(','),
    failedChecks: failed,
    currentExpectedCountMismatch,
    currentPassiveCountMismatch,
  }
}

// ── §11 — the FATAL gates (all must be 0) ─────────────────

export const HEADING_MULTI_TARGET_V2_GATE_KEYS = [
  // canonical resolution (§3)
  'canonicalActiveTargetResolveFailed',
  'multiTargetActiveReprojectFellBackToFirstTarget',
  'multiTargetActiveTargetChangedWithoutUserIntent',
  // identity closure (§6)
  'activeStateVisualTargetKeyMismatch',
  'activeStateVisualDiagnosticTargetIndexMismatch',
  'activeStateVisualHeadingIdentityMismatch',
  'activeDrawerTargetKeyMismatch',
  'activeLeaseTargetKeyMismatch',
  'headingActivePersistenceFalsePass',
  'postReconcileIdentityFalsePass',
  // one-way authority (§8)
  'visualProjectionWroteInteractionState',
  'visualProjectionAttemptedWithoutActiveState',
  // deactivate teardown (§ROOT_V2_4)
  'deactivateClosureBeforeTeardownCommit',
  'idleWithSelectedActiveRow',
  'idleWithActiveFill',
  'idleWithActiveHeadingFragment',
  'idleWithActiveLease',
  // strict multi-H1 current snapshot (§10)
  'strictMultiH1CurrentExpectedCountMismatch',
  'strictMultiH1CurrentPassiveCountMismatch',
  'strictMultiH1StaleCounterContamination',
] as const

export type HeadingMultiTargetV2GateKey = typeof HEADING_MULTI_TARGET_V2_GATE_KEYS[number]

export const HEADING_MULTI_TARGET_V2_GATE_LABELS: Readonly<Record<HeadingMultiTargetV2GateKey, string>> = {
  canonicalActiveTargetResolveFailed: 'CANONICAL_ACTIVE_TARGET_RESOLVE_FAILED_COUNT',
  multiTargetActiveReprojectFellBackToFirstTarget: 'MULTI_TARGET_ACTIVE_REPROJECT_FELL_BACK_TO_FIRST_TARGET_COUNT',
  multiTargetActiveTargetChangedWithoutUserIntent: 'MULTI_TARGET_ACTIVE_TARGET_CHANGED_WITHOUT_USER_INTENT_COUNT',
  activeStateVisualTargetKeyMismatch: 'ACTIVE_STATE_VISUAL_TARGET_KEY_MISMATCH_COUNT',
  activeStateVisualDiagnosticTargetIndexMismatch: 'ACTIVE_STATE_VISUAL_DIAGNOSTIC_TARGET_INDEX_MISMATCH_COUNT',
  activeStateVisualHeadingIdentityMismatch: 'ACTIVE_STATE_VISUAL_HEADING_IDENTITY_MISMATCH_COUNT',
  activeDrawerTargetKeyMismatch: 'ACTIVE_DRAWER_TARGET_KEY_MISMATCH_COUNT',
  activeLeaseTargetKeyMismatch: 'ACTIVE_LEASE_TARGET_KEY_MISMATCH_COUNT',
  headingActivePersistenceFalsePass: 'HEADING_ACTIVE_PERSISTENCE_FALSE_PASS_COUNT',
  postReconcileIdentityFalsePass: 'POST_RECONCILE_IDENTITY_FALSE_PASS_COUNT',
  visualProjectionWroteInteractionState: 'VISUAL_PROJECTION_WROTE_INTERACTION_STATE_COUNT',
  visualProjectionAttemptedWithoutActiveState: 'VISUAL_PROJECTION_ATTEMPTED_WITHOUT_ACTIVE_STATE_COUNT',
  deactivateClosureBeforeTeardownCommit: 'DEACTIVATE_CLOSURE_BEFORE_TEARDOWN_COMMIT_COUNT',
  idleWithSelectedActiveRow: 'IDLE_WITH_SELECTED_ACTIVE_ROW_COUNT',
  idleWithActiveFill: 'IDLE_WITH_ACTIVE_FILL_COUNT',
  idleWithActiveHeadingFragment: 'IDLE_WITH_ACTIVE_HEADING_FRAGMENT_COUNT',
  idleWithActiveLease: 'IDLE_WITH_ACTIVE_LEASE_COUNT',
  strictMultiH1CurrentExpectedCountMismatch: 'STRICT_MULTI_H1_CURRENT_EXPECTED_COUNT_MISMATCH_COUNT',
  strictMultiH1CurrentPassiveCountMismatch: 'STRICT_MULTI_H1_CURRENT_PASSIVE_COUNT_MISMATCH_COUNT',
  strictMultiH1StaleCounterContamination: 'STRICT_MULTI_H1_STALE_COUNTER_CONTAMINATION_COUNT',
}

export type HeadingMultiTargetV2Counters = Record<HeadingMultiTargetV2GateKey, number>

export function createHeadingMultiTargetV2Counters(): HeadingMultiTargetV2Counters {
  return HEADING_MULTI_TARGET_V2_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingMultiTargetV2Counters)
}

export function formatHeadingMultiTargetV2GateReport(
  counters: Readonly<HeadingMultiTargetV2Counters>,
): string[] {
  return HEADING_MULTI_TARGET_V2_GATE_KEYS.map(k => `${HEADING_MULTI_TARGET_V2_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateHeadingMultiTargetV2Gates(
  counters: Readonly<HeadingMultiTargetV2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingMultiTargetV2GateKey[] } {
  const failedChecks = HEADING_MULTI_TARGET_V2_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §12 — the positive coverage (scenario proof only) ─────

export const HEADING_MULTI_TARGET_V2_COVERAGE_KEYS = [
  'multiTargetFirstSubtargetActivationCount',
  'multiTargetSecondSubtargetActivationCount',
  'multiTargetSecondSubtargetRebuiltAfterLayoutCount',
  'multiTargetSecondSubtargetRebuiltAfterGeometryCount',
  'multiTargetSwitch1To2Count',
  'multiTargetSwitch2To1Count',
  'crossDiagnosticHeadingSwitchCount',
  'sameTargetDeactivateAfterMultiTargetCount',
  'canonicalActiveTargetExactResolutionCount',
] as const

export type HeadingMultiTargetV2CoverageKey = typeof HEADING_MULTI_TARGET_V2_COVERAGE_KEYS[number]

export const HEADING_MULTI_TARGET_V2_COVERAGE_LABELS: Readonly<Record<HeadingMultiTargetV2CoverageKey, string>> = {
  multiTargetFirstSubtargetActivationCount: 'MULTI_TARGET_FIRST_SUBTARGET_ACTIVATION_COUNT',
  multiTargetSecondSubtargetActivationCount: 'MULTI_TARGET_SECOND_SUBTARGET_ACTIVATION_COUNT',
  multiTargetSecondSubtargetRebuiltAfterLayoutCount: 'MULTI_TARGET_SECOND_SUBTARGET_REBUILT_AFTER_LAYOUT_COUNT',
  multiTargetSecondSubtargetRebuiltAfterGeometryCount: 'MULTI_TARGET_SECOND_SUBTARGET_REBUILT_AFTER_GEOMETRY_COUNT',
  multiTargetSwitch1To2Count: 'MULTI_TARGET_SWITCH_1_TO_2_COUNT',
  multiTargetSwitch2To1Count: 'MULTI_TARGET_SWITCH_2_TO_1_COUNT',
  crossDiagnosticHeadingSwitchCount: 'CROSS_DIAGNOSTIC_HEADING_SWITCH_COUNT',
  sameTargetDeactivateAfterMultiTargetCount: 'SAME_TARGET_DEACTIVATE_AFTER_MULTI_TARGET_COUNT',
  canonicalActiveTargetExactResolutionCount: 'CANONICAL_ACTIVE_TARGET_EXACT_RESOLUTION_COUNT',
}

export const HEADING_MULTI_TARGET_V2_COVERAGE_MINIMUMS: Readonly<Record<HeadingMultiTargetV2CoverageKey, number>> = {
  multiTargetFirstSubtargetActivationCount: 1,
  multiTargetSecondSubtargetActivationCount: 1,
  multiTargetSecondSubtargetRebuiltAfterLayoutCount: 1,
  multiTargetSecondSubtargetRebuiltAfterGeometryCount: 1,
  multiTargetSwitch1To2Count: 1,
  multiTargetSwitch2To1Count: 1,
  crossDiagnosticHeadingSwitchCount: 1,
  sameTargetDeactivateAfterMultiTargetCount: 1,
  canonicalActiveTargetExactResolutionCount: 1,
}

export type HeadingMultiTargetV2CoverageCounters = Record<HeadingMultiTargetV2CoverageKey, number>

export function createHeadingMultiTargetV2CoverageCounters(): HeadingMultiTargetV2CoverageCounters {
  return HEADING_MULTI_TARGET_V2_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingMultiTargetV2CoverageCounters)
}

export function formatHeadingMultiTargetV2CoverageReport(
  counters: Readonly<HeadingMultiTargetV2CoverageCounters>,
): string[] {
  return HEADING_MULTI_TARGET_V2_COVERAGE_KEYS.map(k => `${HEADING_MULTI_TARGET_V2_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateHeadingMultiTargetV2Coverage(
  counters: Readonly<HeadingMultiTargetV2CoverageCounters>,
  minimums: Readonly<Record<HeadingMultiTargetV2CoverageKey, number>> = HEADING_MULTI_TARGET_V2_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: HeadingMultiTargetV2CoverageKey[] } {
  const unmet = HEADING_MULTI_TARGET_V2_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}
