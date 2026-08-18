/**
 * FormulaOperationClosure — tracks an operation through its full lifecycle
 * from semantic commit through projection to visible verification.
 *
 * Build ID: inkchapter-formula-unified-state-machine-exhaustive-matrix-v2.5.7-r5.4.3.15
 * Runtime Marker: FORMULA-UNIFIED-STATE-MACHINE-V2.5.7-R5.4.3.15
 */

import {
  R54315_RUNTIME_MARKER,
  type FormulaOperationClosure,
  type FormulaOperationKind,
  type FormulaOperationTransaction,
  type FormulaProjectionTransaction,
  type FormulaDependencyFrontier,
} from './formula-state-store'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

// ── Internal State ──────────────────────────────────────────────────────

interface ClosureState {
  operationId: string
  operationKind: FormulaOperationKind
  targetStateRevision: number
  semanticCommitted: boolean
  affectedCount: number
  projectionRequestedCount: number
  projectionSettledCount: number
  projectionCommittedCount: number
  visibleVerifiedCount: number
  nativeManagedMismatchCount: number
  pendingProjectionCount: number
  failedProjectionCount: number
  allDesiredTagsVisible: boolean
}

let _closureState: ClosureState | null = null

// ── createOperationClosure ──────────────────────────────────────────────

/**
 * Create a new operation closure from a committed transaction.
 * The closure tracks the lifecycle of the operation through projection
 * and visible verification.
 */
export function createOperationClosure(
  transaction: FormulaOperationTransaction,
  projectionCount: number,
): FormulaOperationClosure {
  const affectedCount =
    transaction.affectedStableIdentities.length +
    (transaction.dependencyFrontier
      ? transaction.dependencyFrontier.affectedStableIdentities.length
      : 0)

  const closure: FormulaOperationClosure = {
    operationId: transaction.operationId,
    operationKind: transaction.operationKind,
    targetStateRevision: transaction.targetStateRevision,
    semanticCommitted: transaction.status === 'SEMANTIC_COMMITTED',
    affectedCount,
    projectionRequestedCount: projectionCount,
    projectionSettledCount: 0,
    projectionCommittedCount: 0,
    visibleVerifiedCount: 0,
    nativeManagedMismatchCount: 0,
    pendingProjectionCount: projectionCount,
    failedProjectionCount: 0,
    allDesiredTagsVisible: false,
    decision: 'PARTIAL',
    reason: 'CLOSURE_CREATED',
  }

  _closureState = {
    operationId: closure.operationId,
    operationKind: closure.operationKind,
    targetStateRevision: closure.targetStateRevision,
    semanticCommitted: closure.semanticCommitted,
    affectedCount: closure.affectedCount,
    projectionRequestedCount: closure.projectionRequestedCount,
    projectionSettledCount: 0,
    projectionCommittedCount: 0,
    visibleVerifiedCount: 0,
    nativeManagedMismatchCount: 0,
    pendingProjectionCount: projectionCount,
    failedProjectionCount: 0,
    allDesiredTagsVisible: false,
  }

  emitRuntimeAudit('FORMULA-OPERATION-CLOSURE', {
    operationId: closure.operationId,
    operationKind: closure.operationKind,
    targetStateRevision: closure.targetStateRevision,
    semanticCommitted: closure.semanticCommitted,
    affectedCount: closure.affectedCount,
    projectionRequestedCount: closure.projectionRequestedCount,
    projectionSettledCount: 0,
    projectionCommittedCount: 0,
    visibleVerifiedCount: 0,
    nativeManagedMismatchCount: 0,
    pendingProjectionCount: projectionCount,
    failedProjectionCount: 0,
    allDesiredTagsVisible: false,
    decision: 'PARTIAL',
    reason: 'CLOSURE_CREATED',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return closure
}

// ── markSemanticCommitted ────────────────────────────────────────────────

/**
 * Mark the closure's semantic commit as confirmed.
 */
export function markSemanticCommitted(): void {
  if (!_closureState) return
  _closureState.semanticCommitted = true

  emitRuntimeAudit('FORMULA-OPERATION-CLOSURE', {
    operationId: _closureState.operationId,
    operationKind: _closureState.operationKind,
    targetStateRevision: _closureState.targetStateRevision,
    semanticCommitted: true,
    affectedCount: _closureState.affectedCount,
    projectionRequestedCount: _closureState.projectionRequestedCount,
    projectionSettledCount: _closureState.projectionSettledCount,
    projectionCommittedCount: _closureState.projectionCommittedCount,
    visibleVerifiedCount: _closureState.visibleVerifiedCount,
    nativeManagedMismatchCount: _closureState.nativeManagedMismatchCount,
    pendingProjectionCount: _closureState.pendingProjectionCount,
    failedProjectionCount: _closureState.failedProjectionCount,
    allDesiredTagsVisible: _closureState.allDesiredTagsVisible,
    decision: 'PARTIAL',
    reason: 'SEMANTIC_COMMITTED_MARKED',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── recordProjectionRequested ────────────────────────────────────────────

/**
 * Record that a projection has been requested (dispatched).
 */
export function recordProjectionRequested(): void {
  if (!_closureState) return
  _closureState.projectionRequestedCount++
  _closureState.pendingProjectionCount++
}

// ── recordProjectionSettled ─────────────────────────────────────────────

/**
 * Record that a projection has been settled (fulfilled by provider).
 */
export function recordProjectionSettled(): void {
  if (!_closureState) return
  _closureState.projectionSettledCount++
  if (_closureState.pendingProjectionCount > 0) {
    _closureState.pendingProjectionCount--
  }
}

// ── recordProjectionCommitted ───────────────────────────────────────────

/**
 * Record that a projection has been committed (applied to DOM).
 */
export function recordProjectionCommitted(): void {
  if (!_closureState) return
  _closureState.projectionCommittedCount++
}

// ── recordVisibleVerified ────────────────────────────────────────────────

/**
 * Record that a projection has been visibly verified.
 */
export function recordVisibleVerified(): void {
  if (!_closureState) return
  _closureState.visibleVerifiedCount++
}

// ── setNativeManagedMismatchCount ────────────────────────────────────────

/**
 * Set the count of native managed mismatches.
 */
export function setNativeManagedMismatchCount(count: number): void {
  if (!_closureState) return
  _closureState.nativeManagedMismatchCount = count
}

// ── setAllDesiredTagsVisible ─────────────────────────────────────────────

/**
 * Set whether all desired tags are visible.
 */
export function setAllDesiredTagsVisible(visible: boolean): void {
  if (!_closureState) return
  _closureState.allDesiredTagsVisible = visible
}

// ── finalizeOperationClosure ─────────────────────────────────────────────

/**
 * Finalize the operation closure and determine PASS/FAIL/PARTIAL.
 *
 * PASS conditions:
 *   - semanticCommitted === true
 *   - projectionRequestedCount === projectionSettledCount === projectionCommittedCount === visibleVerifiedCount
 *   - pendingProjectionCount === 0
 *   - failedProjectionCount === 0
 *   - nativeManagedMismatchCount === 0
 *   - allDesiredTagsVisible === true
 */
export function finalizeOperationClosure(): FormulaOperationClosure {
  if (!_closureState) {
    const empty: FormulaOperationClosure = {
      operationId: 'no-closure',
      operationKind: 'NOOP',
      targetStateRevision: 0,
      semanticCommitted: false,
      affectedCount: 0,
      projectionRequestedCount: 0,
      projectionSettledCount: 0,
      projectionCommittedCount: 0,
      visibleVerifiedCount: 0,
      nativeManagedMismatchCount: 0,
      pendingProjectionCount: 0,
      failedProjectionCount: 0,
      allDesiredTagsVisible: false,
      decision: 'FAIL',
      reason: 'NO_CLOSURE_STATE',
    }
    return empty
  }

  const st = _closureState
  let decision: 'PASS' | 'FAIL' | 'PARTIAL'
  let reason: string | null

  const allProjectionCountsMatch =
    st.projectionRequestedCount === st.projectionSettledCount &&
    st.projectionSettledCount === st.projectionCommittedCount &&
    st.projectionCommittedCount === st.visibleVerifiedCount

  if (
    st.semanticCommitted &&
    allProjectionCountsMatch &&
    st.pendingProjectionCount === 0 &&
    st.failedProjectionCount === 0 &&
    st.nativeManagedMismatchCount === 0 &&
    st.allDesiredTagsVisible
  ) {
    decision = 'PASS'
    reason = null
  } else if (
    !st.semanticCommitted ||
    st.failedProjectionCount > 0
  ) {
    decision = 'FAIL'
    const reasons: string[] = []
    if (!st.semanticCommitted) reasons.push('SEMANTIC_NOT_COMMITTED')
    if (st.failedProjectionCount > 0) reasons.push('PROJECTION_FAILED')
    reason = reasons.join(';')
  } else {
    decision = 'PARTIAL'
    const reasons: string[] = []
    if (!allProjectionCountsMatch) reasons.push('PROJECTION_COUNTS_MISMATCH')
    if (st.pendingProjectionCount > 0) reasons.push('PENDING_PROJECTIONS')
    if (st.nativeManagedMismatchCount > 0) reasons.push('NATIVE_MANAGED_MISMATCH')
    if (!st.allDesiredTagsVisible) reasons.push('NOT_ALL_DESIRED_TAGS_VISIBLE')
    reason = reasons.join(';') || 'UNKNOWN_PARTIAL'
  }

  const closure: FormulaOperationClosure = {
    operationId: st.operationId,
    operationKind: st.operationKind,
    targetStateRevision: st.targetStateRevision,
    semanticCommitted: st.semanticCommitted,
    affectedCount: st.affectedCount,
    projectionRequestedCount: st.projectionRequestedCount,
    projectionSettledCount: st.projectionSettledCount,
    projectionCommittedCount: st.projectionCommittedCount,
    visibleVerifiedCount: st.visibleVerifiedCount,
    nativeManagedMismatchCount: st.nativeManagedMismatchCount,
    pendingProjectionCount: st.pendingProjectionCount,
    failedProjectionCount: st.failedProjectionCount,
    allDesiredTagsVisible: st.allDesiredTagsVisible,
    decision,
    reason,
  }

  emitRuntimeAudit('FORMULA-OPERATION-CLOSURE', {
    operationId: closure.operationId,
    operationKind: closure.operationKind,
    targetStateRevision: closure.targetStateRevision,
    semanticCommitted: closure.semanticCommitted,
    affectedCount: closure.affectedCount,
    projectionRequestedCount: closure.projectionRequestedCount,
    projectionSettledCount: closure.projectionSettledCount,
    projectionCommittedCount: closure.projectionCommittedCount,
    visibleVerifiedCount: closure.visibleVerifiedCount,
    nativeManagedMismatchCount: closure.nativeManagedMismatchCount,
    pendingProjectionCount: closure.pendingProjectionCount,
    failedProjectionCount: closure.failedProjectionCount,
    allDesiredTagsVisible: closure.allDesiredTagsVisible,
    decision: closure.decision,
    reason: closure.reason,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return closure
}

// ── resetOperationClosureState ──────────────────────────────────────────

/**
 * Reset the internal closure state (for testing).
 */
export function resetOperationClosureState(): void {
  _closureState = null
}

// ── re-export FormulaOperationClosure type ───────────────────────────────

export type { FormulaOperationClosure }