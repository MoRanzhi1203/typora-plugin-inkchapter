/**
 * V5.14-R9 / Active State Machine V2.1 — RECOVERABLE VISUAL COLLISION +
 * ATOMIC ROLLBACK + LEASE CLOSURE.
 *
 * ROOT_A = `FRAME_PAINTS_ABOVE_NAVIGATOR` (a VISUAL layering fact) was escalated
 *   into an interaction / locate TERMINAL failure.
 * ROOT_B = a visual presentation failure could destroy an already-successful
 *   interaction ACTIVE.
 * ROOT_C = `LOCATE_FAILED -> HARD_RESET` only rewrote the State Authority and
 *   never rolled back Fill / Marker / Lease atomically.
 * ROOT_D = the Active Visual Lease lifecycle was a SIDE resource, not part of the
 *   rollback transaction (`IDLE + activeLeasePresent=true`).
 * ROOT_E = the Active Fill DOM was not constrained by the rollback closure
 *   (`IDLE + activeFillCount>0`).
 * ROOT_F = the production code still allowed that illegal state to land.
 *
 * The ONE rule this module encodes:
 *   a VISUAL outcome NEVER determines the INTERACTION outcome on its own.
 *
 * Pure contract: no DOM, no host state.
 */

// ── §3 — the two outcomes are INDEPENDENT ──────────────────────────────────

export type DiagnosticLocateOutcome = 'RESOLVED' | 'UNRESOLVABLE' | 'STALE' | 'ABORTED'

export type DiagnosticVisualOutcome =
  | 'PRESENTED'
  | 'RECOVERABLE_COLLISION'
  | 'UNRECOVERABLE_PRESENTATION_FAILURE'

export type DiagnosticVisualTransactionStatus = 'RESOLVING' | 'PRESENTED' | 'RECOVERING' | 'ROLLED_BACK' | 'RETIRED'

export type DiagnosticVisualRecoveryStrategy =
  | 'NONE'
  | 'PANEL_ABOVE_OVERLAY'
  | 'CLIP_TO_SAFE_REGION'
  | 'INSET_SAFE_GEOMETRY'

export interface DiagnosticLocateResult {
  locate: DiagnosticLocateOutcome
  visual: DiagnosticVisualOutcome
  reason: string
}

export interface VisualFailureClassificationInput {
  /** the presentation-gate reason (e.g. FRAME_PAINTS_ABOVE_PANEL_SURFACE). */
  gateReason: string
  /** the locate really found the target. */
  targetResolved: boolean
  /** the scroll really committed / the target really entered the viewport. */
  targetEnteredViewport: boolean
  /** a real fill was generated. */
  fillCommitted: boolean
  /** the coverage of the target is valid (ratio ~ 1). */
  coverageValid: boolean
  /** the frame overlaps a util panel surface AND paints above it. */
  panelLayeringCollision: boolean
  /** the scroll is clamped at the document end (no further scrolling possible). */
  documentEndClamped: boolean
}

export interface VisualFailureClassification {
  locate: DiagnosticLocateOutcome
  visual: DiagnosticVisualOutcome
  /** §4.3/§5 — 方案 A: keep the ACTIVE interaction (visual DEGRADED). */
  keepActive: boolean
  /** §9 — a rollback is required (atomic teardown). */
  rollbackRequired: boolean
  strategy: DiagnosticVisualRecoveryStrategy
  reason: string
}

/** The layering-collision reason family (RECOVERABLE by construction). */
export function isPanelLayeringCollisionReason(reason: string): boolean {
  const r = String(reason ?? '')
  return r === 'FRAME_PAINTS_ABOVE_PANEL_SURFACE'
    || r.startsWith('FRAME_PAINTS_ABOVE_')
    || r.includes('PAINTS_ABOVE_NAVIGATOR')
    || r.includes('PAINTS_ABOVE_PANEL')
    || r === 'NAVIGATOR_DRAWER_SAFE_REGION_CONFLICT'
    || r === 'FRAME_INTERSECTS_TOOLBAR'
}

/**
 * §3/§4 — classify a presentation failure. This is the ONE place the decision
 * "visual problem vs interaction problem" is taken.
 */
export function classifyDiagnosticVisualFailure(input: VisualFailureClassificationInput): VisualFailureClassification {
  // §4.1 — a locate that did not resolve is an INTERACTION failure.
  const locateResolved = input.targetResolved && input.targetEnteredViewport
  if (!locateResolved) {
    return {
      locate: input.targetResolved ? 'ABORTED' : 'UNRESOLVABLE',
      visual: 'UNRECOVERABLE_PRESENTATION_FAILURE',
      keepActive: false,
      rollbackRequired: true,
      strategy: 'NONE',
      reason: 'LOCATE_DID_NOT_RESOLVE',
    }
  }
  // §4.2 — resolved + presented (no layering collision).
  if (!input.panelLayeringCollision && !isPanelLayeringCollisionReason(input.gateReason)) {
    return {
      locate: 'RESOLVED',
      visual: 'PRESENTED',
      keepActive: true,
      rollbackRequired: false,
      strategy: 'NONE',
      reason: 'PRESENTED',
    }
  }
  // §4.3 — resolved + a recoverable panel layering collision. The target IS found
  // and the fill IS generated: this is a LAYOUT conflict, never a locate failure.
  if (isPanelLayeringCollisionReason(input.gateReason) || input.panelLayeringCollision) {
    const strategy: DiagnosticVisualRecoveryStrategy = input.documentEndClamped
      ? 'INSET_SAFE_GEOMETRY'
      : 'PANEL_ABOVE_OVERLAY'
    return {
      locate: 'RESOLVED',
      visual: 'RECOVERABLE_COLLISION',
      // §5 — 方案 A is the product decision: the navigator overlay overlap must
      // NEVER cancel a successful interaction (the user's goal is already met).
      keepActive: true,
      rollbackRequired: false,
      strategy,
      reason: 'RECOVERABLE_PANEL_LAYERING_COLLISION',
    }
  }
  // §4.5 方案 B — an unrecoverable presentation failure (no fill, invalid
  // coverage) is rolled back ATOMICALLY, never half-rolled back.
  return {
    locate: 'RESOLVED',
    visual: 'UNRECOVERABLE_PRESENTATION_FAILURE',
    keepActive: false,
    rollbackRequired: true,
    strategy: 'NONE',
    reason: 'UNRECOVERABLE_PRESENTATION_FAILURE',
  }
}

// ── §14 — the visual transaction (State / Visual / Lease from ONE source) ──

export interface DiagnosticVisualTransaction {
  interactionVersion: number
  diagnosticId: string
  targetKey: string
  transactionId: number
  leaseToken: string | null
  status: DiagnosticVisualTransactionStatus
}

export function createVisualTransaction(input: {
  interactionVersion: number
  diagnosticId: string
  targetKey: string
  transactionId: number
  leaseToken?: string | null
}): DiagnosticVisualTransaction {
  return {
    interactionVersion: input.interactionVersion,
    diagnosticId: input.diagnosticId,
    targetKey: input.targetKey,
    transactionId: input.transactionId,
    leaseToken: input.leaseToken ?? null,
    status: 'RESOLVING',
  }
}

// ── §16/§17 — the V2.1 hard gates ─────────────────────────────────────────

export const VISUAL_TRANSACTION_V21_GATE_KEYS = [
  'idleWithActiveFill',
  'idleWithActiveLease',
  'idleWithActiveMarker',
  'idleWithActiveTransaction',
  'visualFailurePartialRollback',
  'recoverableNavigatorCollisionEscalatedToInteractionFailure',
  'navigatorCollisionRecoveryFailure',
  'navigatorCollisionWithStateDomDivergence',
  'unrecoveredFramePaintsAboveNavigator',
  'atomicTeardownIncomplete',
  'rollbackWithFillSurvival',
  'rollbackWithLeaseSurvival',
  'postSettleStateDomDivergence',
] as const

export type VisualTransactionV21GateKey = typeof VISUAL_TRANSACTION_V21_GATE_KEYS[number]

export const VISUAL_TRANSACTION_V21_GATE_LABELS: Readonly<Record<VisualTransactionV21GateKey, string>> = {
  idleWithActiveFill: 'IDLE_WITH_ACTIVE_FILL_COUNT',
  idleWithActiveLease: 'IDLE_WITH_ACTIVE_LEASE_COUNT',
  idleWithActiveMarker: 'IDLE_WITH_ACTIVE_MARKER_COUNT',
  idleWithActiveTransaction: 'IDLE_WITH_ACTIVE_TRANSACTION_COUNT',
  visualFailurePartialRollback: 'VISUAL_FAILURE_PARTIAL_ROLLBACK_COUNT',
  recoverableNavigatorCollisionEscalatedToInteractionFailure:
    'RECOVERABLE_NAVIGATOR_COLLISION_ESCALATED_TO_INTERACTION_FAILURE_COUNT',
  navigatorCollisionRecoveryFailure: 'NAVIGATOR_COLLISION_RECOVERY_FAILURE_COUNT',
  navigatorCollisionWithStateDomDivergence: 'NAVIGATOR_COLLISION_WITH_STATE_DOM_DIVERGENCE_COUNT',
  unrecoveredFramePaintsAboveNavigator: 'UNRECOVERED_FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT',
  atomicTeardownIncomplete: 'ATOMIC_TEARDOWN_INCOMPLETE_COUNT',
  rollbackWithFillSurvival: 'ROLLBACK_WITH_FILL_SURVIVAL_COUNT',
  rollbackWithLeaseSurvival: 'ROLLBACK_WITH_LEASE_SURVIVAL_COUNT',
  postSettleStateDomDivergence: 'POST_SETTLE_STATE_DOM_DIVERGENCE_COUNT',
}

export type VisualTransactionV21Counters = Record<VisualTransactionV21GateKey, number>

export function createVisualTransactionV21Counters(): VisualTransactionV21Counters {
  return VISUAL_TRANSACTION_V21_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as VisualTransactionV21Counters)
}

export function formatVisualTransactionV21GateReport(
  counters: Readonly<VisualTransactionV21Counters>,
): string[] {
  return VISUAL_TRANSACTION_V21_GATE_KEYS.map(key => `${VISUAL_TRANSACTION_V21_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateVisualTransactionV21Gates(
  counters: Readonly<VisualTransactionV21Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: VisualTransactionV21GateKey[] } {
  const failedChecks = VISUAL_TRANSACTION_V21_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §17 — the navigator collision is DETECTED (>=1 is expected); UNRECOVERED must be 0. */
export interface VisualTransactionV21CoverageCounters {
  framePaintsAboveNavigatorDetected: number
  recoverableCollisionRecovered: number
  recoverableCollisionKeptActiveDegraded: number
  navigatorCollisionRuntimeObserved: number
}

export function createVisualTransactionV21CoverageCounters(): VisualTransactionV21CoverageCounters {
  return {
    framePaintsAboveNavigatorDetected: 0,
    recoverableCollisionRecovered: 0,
    recoverableCollisionKeptActiveDegraded: 0,
    navigatorCollisionRuntimeObserved: 0,
  }
}

export function formatVisualTransactionV21CoverageReport(
  counters: Readonly<VisualTransactionV21CoverageCounters>,
): string[] {
  return [
    `FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT=${counters.framePaintsAboveNavigatorDetected}`,
    `RECOVERABLE_COLLISION_RECOVERED_COUNT=${counters.recoverableCollisionRecovered}`,
    `RECOVERABLE_COLLISION_KEPT_ACTIVE_DEGRADED_COUNT=${counters.recoverableCollisionKeptActiveDegraded}`,
    `NAVIGATOR_COLLISION_RUNTIME_OBSERVED_COUNT=${counters.navigatorCollisionRuntimeObserved}`,
  ]
}

/**
 * §9/§10 — the ATOMIC teardown completeness verdict. A rollback that leaves any
 * of State / Fill / Lease / Marker / Transaction behind is INCOMPLETE.
 */
export interface AtomicTeardownFacts {
  statePhase: 'IDLE' | 'ACTIVE'
  activeFillCount: number
  activeLeasePresent: boolean
  activeMarkerCount: number
  activeTransactionPresent: boolean
}

export interface AtomicTeardownVerdict {
  complete: boolean
  missing: string[]
}

export function evaluateAtomicTeardown(facts: AtomicTeardownFacts): AtomicTeardownVerdict {
  const missing: string[] = []
  if (facts.statePhase !== 'IDLE') missing.push('STATE_NOT_IDLE')
  if (facts.activeFillCount !== 0) missing.push('FILL_SURVIVED')
  if (facts.activeLeasePresent) missing.push('LEASE_SURVIVED')
  if (facts.activeMarkerCount !== 0) missing.push('MARKER_SURVIVED')
  if (facts.activeTransactionPresent) missing.push('TRANSACTION_SURVIVED')
  return { complete: missing.length === 0, missing }
}

// ── §13/§15 — the V2.1 audit events ───────────────────────────────────────

export const DOCUMENT_DIAGNOSTIC_VISUAL_OUTCOME_V2_1 = 'DOCUMENT-DIAGNOSTIC-VISUAL-OUTCOME-V2.1'
export const DOCUMENT_DIAGNOSTIC_ATOMIC_TEARDOWN_V2_1 = 'DOCUMENT-DIAGNOSTIC-ATOMIC-TEARDOWN-V2.1'
export const DOCUMENT_DIAGNOSTIC_VISUAL_RECOVERY_V2_1 = 'DOCUMENT-DIAGNOSTIC-VISUAL-RECOVERY-V2.1'
export const DOCUMENT_DIAGNOSTIC_ILLEGAL_IDLE_REPAIR_V2_1 = 'DOCUMENT-DIAGNOSTIC-ILLEGAL-IDLE-REPAIR-V2.1'
