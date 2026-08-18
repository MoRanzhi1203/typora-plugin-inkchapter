import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export type EmptyReservationStatus = 'RESERVED' | 'BOUND_TO_PRECALL' | 'FULFILLED' | 'REPLAY_PENDING' | 'REPLAYED' | 'CANCELLED' | 'STALE'

export interface EmptyFormulaRenderReservation {
  reservationId: string
  operationBatchId: string | null
  frontierId: string | null
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  formulaHost: HTMLElement | null
  formulaHostToken: number
  stableFormulaIdentity: number
  formulaIndex: number
  scopeKey: string | null
  sequenceValue: number | null
  planRevision: number
  liveFormulaRevision: number
  desiredTag: string
  sourceState: 'EMPTY'
  status: EmptyReservationStatus
}

export type PendingEmptyProjectionStatus = 'WAIT_STRUCTURAL_SLOT' | 'WAIT_PLAN' | 'READY_TO_REPLAY' | 'REPLAYING' | 'FULFILLED' | 'STALE' | 'CANCELLED'

export interface PendingEmptyProjection {
  pendingId: string
  documentKey: string
  generation: number
  rootToken: number
  formulaHost: HTMLElement | null
  formulaHostToken: number | null
  operationBatchId: string | null
  stableFormulaIdentity: number | null
  rendererNode: Node | null
  rendererNodeToken: number | null
  status: PendingEmptyProjectionStatus
}

let reservationSeq = 0
const reservations = new Map<number, EmptyFormulaRenderReservation>()

export function createEmptyRenderReservation(input: {
  operationBatchId: string | null
  frontierId: string | null
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  formulaHost: HTMLElement | null
  formulaHostToken: number
  stableFormulaIdentity: number
  formulaIndex: number
  scopeKey: string | null
  sequenceValue: number | null
  planRevision: number
  liveFormulaRevision: number
  desiredTag: string
}): EmptyFormulaRenderReservation {
  const res: EmptyFormulaRenderReservation = {
    reservationId: `er-${++reservationSeq}`,
    operationBatchId: input.operationBatchId,
    frontierId: input.frontierId,
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    editorRootToken: input.editorRootToken,
    formulaHost: input.formulaHost,
    formulaHostToken: input.formulaHostToken,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    scopeKey: input.scopeKey,
    sequenceValue: input.sequenceValue,
    planRevision: input.planRevision,
    liveFormulaRevision: input.liveFormulaRevision,
    desiredTag: input.desiredTag,
    sourceState: 'EMPTY',
    status: 'RESERVED',
  }
  reservations.set(input.stableFormulaIdentity, res)
  emitRuntimeAudit('FORMULA-EMPTY-STRUCTURAL-RENDER-RESERVATION', {
    reservationId: res.reservationId,
    operationBatchId: res.operationBatchId,
    frontierId: res.frontierId,
    documentKey: res.documentKey,
    generation: res.documentGeneration,
    rootToken: res.editorRootToken,
    formulaHostToken: res.formulaHostToken,
    stableFormulaIdentity: res.stableFormulaIdentity,
    formulaIndex: res.formulaIndex,
    scopeKey: res.scopeKey,
    sequenceValue: res.sequenceValue,
    desiredTag: res.desiredTag,
    sourceState: 'EMPTY',
    reservationCreated: true,
    status: res.status,
    decision: 'RESERVED',
    reason: null,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
  return res
}

export function consumeReservation(input: {
  stableFormulaIdentity: number
  callOrdinal: number
  documentKey: string
  generation: number
}): { reservation: EmptyFormulaRenderReservation | null; alreadyConsumed: boolean; consumeSucceeded: boolean } {
  const res = reservations.get(input.stableFormulaIdentity)
  if (!res) return { reservation: null, alreadyConsumed: false, consumeSucceeded: false }
  if (res.status !== 'RESERVED') {
    emitRuntimeAudit('FORMULA-EMPTY-RESERVATION-CONSUMPTION', {
      reservationId: res.reservationId,
      callOrdinal: input.callOrdinal,
      consumeAttempt: true,
      alreadyConsumed: true,
      consumeSucceeded: false,
      decision: 'BLOCK',
      reason: `RESERVATION_ALREADY_${res.status}`,
      runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
    })
    return { reservation: res, alreadyConsumed: true, consumeSucceeded: false }
  }
  if (res.documentKey !== input.documentKey || res.documentGeneration !== input.generation) {
    res.status = 'STALE'
    emitRuntimeAudit('FORMULA-EMPTY-RESERVATION-CONSUMPTION', {
      reservationId: res.reservationId,
      callOrdinal: input.callOrdinal,
      consumeAttempt: true,
      alreadyConsumed: false,
      consumeSucceeded: false,
      decision: 'STALE',
      reason: 'DOCUMENT_OR_GENERATION_MISMATCH',
      runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
    })
    return { reservation: res, alreadyConsumed: false, consumeSucceeded: false }
  }
  res.status = 'BOUND_TO_PRECALL'
  emitRuntimeAudit('FORMULA-EMPTY-RESERVATION-CONSUMPTION', {
    reservationId: res.reservationId,
    callOrdinal: input.callOrdinal,
    consumeAttempt: true,
    alreadyConsumed: false,
    consumeSucceeded: true,
    decision: 'BOUND',
    reason: null,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
  return { reservation: res, alreadyConsumed: false, consumeSucceeded: true }
}

export function getReservation(stableFormulaIdentity: number): EmptyFormulaRenderReservation | null {
  return reservations.get(stableFormulaIdentity) ?? null
}

export function markReservationFulfilled(stableFormulaIdentity: number): void {
  const res = reservations.get(stableFormulaIdentity)
  if (res) res.status = 'FULFILLED'
}

export function clearReservationsForDocument(documentKey: string): void {
  for (const [k, v] of reservations) {
    if (v.documentKey === documentKey) {
      v.status = 'CANCELLED'
      reservations.delete(k)
    }
  }
}

let pendingSeq = 0
const pendingProjections = new Map<number, PendingEmptyProjection>()

export function createPendingEmptyProjection(input: {
  documentKey: string
  generation: number
  rootToken: number
  formulaHost: HTMLElement | null
  formulaHostToken: number | null
  operationBatchId: string | null
  stableFormulaIdentity: number | null
  rendererNode: Node | null
  rendererNodeToken: number | null
}): PendingEmptyProjection {
  const p: PendingEmptyProjection = {
    pendingId: `ep-${++pendingSeq}`,
    documentKey: input.documentKey,
    generation: input.generation,
    rootToken: input.rootToken,
    formulaHost: input.formulaHost,
    formulaHostToken: input.formulaHostToken,
    operationBatchId: input.operationBatchId,
    stableFormulaIdentity: input.stableFormulaIdentity,
    rendererNode: input.rendererNode,
    rendererNodeToken: input.rendererNodeToken,
    status: 'WAIT_STRUCTURAL_SLOT',
  }
  if (input.formulaHostToken !== null) pendingProjections.set(input.formulaHostToken, p)
  emitRuntimeAudit('FORMULA-EMPTY-PROJECTION-PENDING', {
    pendingId: p.pendingId,
    operationBatchId: p.operationBatchId,
    formulaHostToken: p.formulaHostToken,
    stableFormulaIdentity: p.stableFormulaIdentity,
    rendererNodeToken: p.rendererNodeToken,
    status: p.status,
    decision: 'PENDING',
    reason: null,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
  return p
}

export function resolvePendingEmptyProjection(input: {
  formulaHostToken: number
  stableFormulaIdentity: number
  formulaIndex: number
  desiredTag: string
  documentKey: string
  generation: number
}): 'REPLAY' | 'NONE' | 'STALE' {
  const p = pendingProjections.get(input.formulaHostToken)
  if (!p) return 'NONE'
  if (p.documentKey !== input.documentKey || p.generation !== input.generation) {
    p.status = 'STALE'
    pendingProjections.delete(input.formulaHostToken)
    return 'STALE'
  }
  p.stableFormulaIdentity = input.stableFormulaIdentity
  p.status = 'READY_TO_REPLAY'
  emitRuntimeAudit('FORMULA-EMPTY-PROJECTION-REPLAY', {
    pendingId: p.pendingId,
    formulaHostToken: input.formulaHostToken,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    status: 'READY_TO_REPLAY',
    decision: 'REPLAY',
    reason: null,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
  pendingProjections.delete(input.formulaHostToken)
  return 'REPLAY'
}

export function emitZeroSourceTransactionAuthority(input: {
  callOrdinal: number
  reservationId: string | null
  stableFormulaIdentity: number | null
  formulaIndex: number | null
  desiredTag: string | null
  authoritySource: 'RESERVATION' | 'HOST_TRANSACTION' | 'EDIT_SESSION_REBIND' | 'PENDING_PROJECTION' | 'FAIL'
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-ZERO-SOURCE-TRANSACTION-AUTHORITY', {
    callOrdinal: input.callOrdinal,
    reservationId: input.reservationId,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    authoritySource: input.authoritySource,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
}

export function emitZeroSourceSameCallReauthorization(input: {
  callOrdinal: number
  reservationId: string | null
  stableFormulaIdentityBefore: number | null
  stableFormulaIdentityAfter: number | null
  planRevisionBefore: number | null
  planRevisionAfter: number | null
  formulaIndex: number | null
  desiredTag: string | null
  rebindByStableIdentity: boolean
  sourceMatchUsed: boolean
  reauthorizationSucceeded: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-ZERO-SOURCE-SAME-CALL-REAUTHORIZATION', {
    callOrdinal: input.callOrdinal,
    reservationId: input.reservationId,
    stableFormulaIdentityBefore: input.stableFormulaIdentityBefore,
    stableFormulaIdentityAfter: input.stableFormulaIdentityAfter,
    planRevisionBefore: input.planRevisionBefore,
    planRevisionAfter: input.planRevisionAfter,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    rebindByStableIdentity: input.rebindByStableIdentity,
    sourceMatchUsed: input.sourceMatchUsed,
    reauthorizationSucceeded: input.reauthorizationSucceeded,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
}

export function emitAuthorizationDesiredTagInvariant(input: {
  callOrdinal: number
  authorityKind: string
  stableFormulaIdentity: number | null
  formulaIndex: number | null
  planEntryFound: boolean
  desiredTag: string | null
  managedEligible: boolean
  authorized: boolean
  invariantSatisfied: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-AUTHORIZATION-DESIRED-TAG-INVARIANT', {
    callOrdinal: input.callOrdinal,
    authorityKind: input.authorityKind,
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    planEntryFound: input.planEntryFound,
    desiredTag: input.desiredTag,
    managedEligible: input.managedEligible,
    authorized: input.authorized,
    invariantSatisfied: input.invariantSatisfied,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
}

export function emitManagedVisualFormatInvariant(input: {
  stableFormulaIdentity: number
  formulaIndex: number
  sourceState: string
  desiredTag: string | null
  visibleTag: string | null
  visibleTagKind: 'INKCHAPTER' | 'TYPOORA_NATIVE' | 'MISSING' | 'AMBIGUOUS'
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-MANAGED-VISUAL-FORMAT-INVARIANT', {
    stableFormulaIdentity: input.stableFormulaIdentity,
    formulaIndex: input.formulaIndex,
    sourceState: input.sourceState,
    desiredTag: input.desiredTag,
    visibleTag: input.visibleTag,
    visibleTagKind: input.visibleTagKind,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-DEPENDENCY-FRONTIER-CASCADE-V2.5.7-R5.4.3.12',
  })
}

export function isZeroSource(inputTex: string): boolean {
  const t = inputTex.trim()
  return t === '' || t === '<Empty \\space Math \\space Block>' || t === '\\space' || /^\\space(\s|$)/.test(t)
}

export function resetEmptyReservationState(): void {
  reservations.clear()
  pendingProjections.clear()
  reservationSeq = 0
  pendingSeq = 0
}

export const R54313_RUNTIME_MARKER = 'FORMULA-EMPTY-SLOT-ZERO-SOURCE-REPLAY-V2.5.7-R5.4.3.13'
export const R54313_BUILD_MARKER = 'inkchapter-formula-empty-slot-zero-source-replay-v2.5.7-r5.4.3.13'

// ── Affected Formula Projection Target ──────────────────────────────────────

export interface AffectedFormulaProjectionTarget {
  projectionTargetId: string
  operationTransactionId: string | null
  frontierId: string | null
  projectionBatchId: string | null
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  stableFormulaIdentity: number
  formulaIndex: number
  canonicalFormulaHost: HTMLElement | null
  canonicalFormulaHostToken: number
  oldDesiredTag: string | null
  desiredTag: string
  authoritativeRawTex: string
  rawTexHash: string
  planRevision: number
  liveFormulaRevision: number
  compositeOwner: HTMLElement | null
  previewHost: HTMLElement | null
  oldNativeMjx: HTMLElement | null
}

let targetSeq = 0

export function createProjectionTarget(input: Omit<AffectedFormulaProjectionTarget, 'projectionTargetId'>): AffectedFormulaProjectionTarget {
  const target: AffectedFormulaProjectionTarget = {
    ...input,
    projectionTargetId: `pt-${++targetSeq}`,
  }
  return target
}

export function emitProjectionTargetOwnership(target: AffectedFormulaProjectionTarget): void {
  emitRuntimeAudit('FORMULA-PROJECTION-TARGET-OWNERSHIP', {
    projectionTargetId: target.projectionTargetId,
    operationTransactionId: target.operationTransactionId,
    frontierId: target.frontierId,
    projectionBatchId: target.projectionBatchId,
    stableFormulaIdentity: target.stableFormulaIdentity,
    formulaIndex: target.formulaIndex,
    formulaHostToken: target.canonicalFormulaHostToken,
    oldDesiredTag: target.oldDesiredTag,
    desiredTag: target.desiredTag,
    planRevision: target.planRevision,
    liveFormulaRevision: target.liveFormulaRevision,
    targetCreated: true,
    decision: 'CREATED',
    reason: null,
    runtimeMarker: 'FORMULA-EMPTY-SLOT-ZERO-SOURCE-REPLAY-V2.5.7-R5.4.3.13',
  })
}

export function emitProjectionTargetAsyncContinuity(input: {
  projectionTargetId: string
  stableIdentityAtDispatch: number | null
  stableIdentityAtFulfillment: number | null
  stableIdentityAtCommit: number | null
  formulaIndexAtDispatch: number | null
  formulaIndexAtFulfillment: number | null
  formulaIndexAtCommit: number | null
  hostTokenAtDispatch: number | null
  hostTokenAtCommit: number | null
  identityPreserved: boolean
  hostPreserved: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-PROJECTION-TARGET-ASYNC-CONTINUITY', {
    projectionTargetId: input.projectionTargetId,
    stableIdentityAtDispatch: input.stableIdentityAtDispatch,
    stableIdentityAtFulfillment: input.stableIdentityAtFulfillment,
    stableIdentityAtCommit: input.stableIdentityAtCommit,
    formulaIndexAtDispatch: input.formulaIndexAtDispatch,
    formulaIndexAtFulfillment: input.formulaIndexAtFulfillment,
    formulaIndexAtCommit: input.formulaIndexAtCommit,
    hostTokenAtDispatch: input.hostTokenAtDispatch,
    hostTokenAtCommit: input.hostTokenAtCommit,
    identityPreserved: input.identityPreserved,
    hostPreserved: input.hostPreserved,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-EMPTY-SLOT-ZERO-SOURCE-REPLAY-V2.5.7-R5.4.3.13',
  })
}

export function emitNewOwnerConsistencyInvariant(input: {
  insertedStableIdentity: number | null
  reservationStableIdentity: number | null
  zeroSourceStableIdentity: number | null
  currentEditingStableIdentity: number | null
  resolvedCallOwnerStableIdentity: number | null
  allCausallyConsistent: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit('FORMULA-NEW-OWNER-CONSISTENCY-INVARIANT', {
    insertedStableIdentity: input.insertedStableIdentity,
    reservationStableIdentity: input.reservationStableIdentity,
    zeroSourceStableIdentity: input.zeroSourceStableIdentity,
    currentEditingStableIdentity: input.currentEditingStableIdentity,
    resolvedCallOwnerStableIdentity: input.resolvedCallOwnerStableIdentity,
    allCausallyConsistent: input.allCausallyConsistent,
    decision: input.decision,
    reason: input.reason,
    runtimeMarker: 'FORMULA-EMPTY-SLOT-ZERO-SOURCE-REPLAY-V2.5.7-R5.4.3.13',
  })
}

export function resetProjectionTargetState(): void {
  targetSeq = 0
}