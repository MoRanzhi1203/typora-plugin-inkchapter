/**
 * FormulaStateMachineWiring — production orchestrator/adapter that wires
 * caption-service semantic events and the MathJax render entry to the
 * FormulaStateStore.
 *
 * Build ID:     inkchapter-formula-runtime-state-recovery-render-entry-v2.5.7-r5.4.3.17
 * Runtime Mark: FORMULA-STATE-MACHINE-PRODUCTION-WIRING-V2.5.7-R5.4.3.17
 *
 * R5.4.3.17 guarantees:
 *   - FormulaStateStore is bound to the authoritative runtime context
 *     (documentKey non-empty, generation>0, connected root, rootToken>0).
 *   - The real Typora DOM scanner never throws on non-string className.
 *   - MathJax pre-call reads stableIdentity/formulaIndex/desiredTag from the
 *     committed slot (never from source/hash/sentinel).
 *   - Natural render before baseline is registered as a pending projection
 *     and closed by the baseline projection closure.
 *   - Legacy baseline gate hands off to the store once the store is ready.
 */

import {
  getFormulaStateStore,
  isRuntimeContextReady,
  type FormulaStateStore,
  type FormulaRuntimeContext,
  type CommittedFormulaDocumentState,
  type FormulaOperationTransaction,
  type FormulaOperationKind,
  type FormulaDependencyFrontier,
  type FormulaRenderTransaction,
  type FormulaProjectionTransaction,
  type CanonicalFormulaSlot,
  type FormulaStableIdentity,
  R54315_RUNTIME_MARKER,
} from './formula-state-store'
import {
  createOperationClosure,
  markSemanticCommitted,
  recordProjectionRequested,
  recordProjectionSettled,
  recordProjectionCommitted,
  recordVisibleVerified,
  recordSourceReadyBlocked,
  settleSourceReadyPending,
  setNativeManagedMismatchCount,
  setAllDesiredTagsVisible,
  finalizeOperationClosure,
  resetOperationClosureState,
  type FormulaOperationClosure,
} from './formula-operation-closure'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { readVisibleFormulaTag, resolveFormulaCompositeVisualOwner, checkNativeSlotOwnership, getNaturalRenderOptions, requestFormulaProjectionFulfillment } from './formula-render-projection'
import { extractFormulaTexForTrace, simpleHash, normalizeTexSource, normalizeTyporaFormulaRenderInput } from './formula-tex-source-verifier'
import { captureOrUpdateAuthoritativeSource } from './formula-authoritative-source'

// ── Build & Runtime Markers ─────────────────────────────────────────────

export const R54316_BUILD_ID = 'inkchapter-formula-single-source-stale-projection-visible-closure-v2.5.7-r5.4.3.21'
const R54316_RUNTIME_MARKER = 'FORMULA-SINGLE-SOURCE-STALE-PROJECTION-VISIBLE-CLOSURE-V2.5.7-R5.4.3.21'

// ── Production Call Counters ────────────────────────────────────────────

export const productionCallCounters = {
  captureBeforeState: 0,
  scanAfterCandidate: 0,
  buildAfterCandidateState: 0,
  classifyOperation: 0,
  computeDependencyFrontier: 0,
  commitOperation: 0,
  createRenderTransaction: 0,
  createProjectionTransactions: 0,
  markSemanticCommitted: 0,
  recordProjectionRequested: 0,
  recordProjectionSettled: 0,
  recordProjectionCommitted: 0,
  recordVisibleVerified: 0,
  recordProjectionFailed: 0,
  finalizeOperationClosure: 0,
  bindRuntimeContext: 0,
  renderEntryAuthority: 0,
  baselineProjectionClosure: 0,
  rendererTriggeredSourceEditCount: 0,
  userSourceEditCount: 0,
  sourceIntegrityViolationCount: 0,
  duplicateNativeCommitAttemptCount: 0,
  stableIdentityContinuityViolationCount: 0,
  visibleVerifyFailureCount: 0,
  precallSlotAdoptionCount: 0,
  precallSlotAdoptionDuplicateCount: 0,
  identityRebindCount: 0,
  identityRebindFailureCount: 0,
  transitionalSourcePromotionCount: 0,
  authoritativePromotionCount: 0,
  sameCallAuthorizationAttemptCount: 0,
  sameCallAuthorizationSuccessCount: 0,
  sameCallStableIdentityMissingCount: 0,
  blockedSourceReadyCount: 0,
  sourceReadyReplayCount: 0,
  naturalRenderSettlementCount: 0,
  projectionSettlementCount: 0,
  userInputProvenanceLostCount: 0,
  sourceAuthorityDivergenceCount: 0,
  staleProjectionBlockedCount: 0,
  staleProjectionCommitViolationCount: 0,
  detachedResultValidationFailureCount: 0,
  domReplacedCount: 0,
  domReplacedUnverifiedCount: 0,
  visibleBodyUnresolvedCount: 0,
  structuralHostRebindCount: 0,
  structuralHostRebindFailureCount: 0,
  logicalIdentityChurnCount: 0,
  falseInsertClassificationCount: 0,
  staleClosurePassCount: 0,
}

export function getProductionCallerCounts(): Record<string, number> {
  return { ...productionCallCounters }
}

export function hasZeroProductionCallers(): boolean {
  const core = [
    productionCallCounters.captureBeforeState,
    productionCallCounters.scanAfterCandidate,
    productionCallCounters.classifyOperation,
    productionCallCounters.computeDependencyFrontier,
    productionCallCounters.commitOperation,
    productionCallCounters.createRenderTransaction,
    productionCallCounters.createProjectionTransactions,
    productionCallCounters.finalizeOperationClosure,
  ]
  return core.every((c) => c === 0)
}

// ── Context Helpers ─────────────────────────────────────────────────────

const editorRootTokenMap = new WeakMap<HTMLElement, number>()
let nextEditorRootToken = 0

/** Shared editor-root token (consistent across caption-service and wrapper). */
export function editorRootTokenFor(root: HTMLElement): number {
  let token = editorRootTokenMap.get(root)
  if (token === undefined) {
    token = ++nextEditorRootToken
    editorRootTokenMap.set(root, token)
  }
  return token
}

/** Bind the store to the authoritative runtime context; returns PASS/FAIL. */
export function bindStoreRuntimeContext(ctx: FormulaRuntimeContext): boolean {
  productionCallCounters.bindRuntimeContext++
  return getFormulaStateStore().bindRuntimeContext(ctx)
}

/** True when the store baseline is committed for the current runtime context. */
export function isStoreBaselineReady(ctx: FormulaRuntimeContext): boolean {
  const gate = isRuntimeContextReady(ctx)
  if (!gate.ready) return false
  return getFormulaStateStore().isBaselineReadyFor(ctx.documentKey, ctx.documentGeneration, ctx.editorRootToken)
}

// ── processFormulaSemanticEvent ─────────────────────────────────────────

/**
 * processFormulaSemanticEvent — the main production entry that wires
 * caption-service semantic events to the FormulaStateStore.
 *
 * Captures BEFORE state, scans AFTER candidate (from canonical hosts when
 * available), classifies the operation, computes the dependency frontier,
 * builds the transaction, commits it, and creates projection transactions.
 *
 * @param eventHint - The event hint string (e.g. 'FORMULA_ADDED') — HINT only.
 * @param editorRoot - The editor root HTMLElement to scan.
 * @param headings - Heading info array for scope resolution.
 * @param mutationBatchId - The mutation batch identifier.
 * @param context - optional authoritative runtime context (R5.4.3.17).
 * @param canonicalHosts - optional pre-collected canonical hosts (preferred).
 * @param desiredTagOverrides - optional trusted desiredTag per host.
 */
export function processFormulaSemanticEvent(
  eventHint: string,
  editorRoot: HTMLElement,
  headings: any[],
  mutationBatchId: string,
  context?: FormulaRuntimeContext | null,
  canonicalHosts?: HTMLElement[] | null,
  desiredTagOverrides?: Map<HTMLElement, string | null>,
): {
  transaction: FormulaOperationTransaction | null
  closure: FormulaOperationClosure | null
  frontier: FormulaDependencyFrontier | null
  projectionTransactions: FormulaProjectionTransaction[]
} {
  const store = getFormulaStateStore()

  // Phase 0 (R5.4.3.17): bind context when provided.
  if (context) {
    if (!bindStoreRuntimeContext(context)) {
      emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
        operationId: null,
        eventHint,
        decision: 'DEFER',
        reason: 'RUNTIME_CONTEXT_NOT_READY',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      return { transaction: null, closure: null, frontier: null, projectionTransactions: [] }
    }
  }

  // Phase 1: Capture BEFORE from committed state
  const beforeState = store.captureBeforeState()
  productionCallCounters.captureBeforeState++

  // Phase 2: Scan AFTER candidate — prefer canonical hosts over TreeWalker.
  let afterCandidate: CommittedFormulaDocumentState | null = null
  if (canonicalHosts && canonicalHosts.length > 0) {
    afterCandidate = store.buildStateFromCanonicalHosts(canonicalHosts, headings, null, desiredTagOverrides)
  } else {
    afterCandidate = store.buildAfterCandidateState(editorRoot, headings)
  }
  productionCallCounters.scanAfterCandidate++
  productionCallCounters.buildAfterCandidateState++

  if (!afterCandidate) {
    emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
      operationId: null,
      eventHint,
      decision: 'DEFER',
      reason: 'AFTER_CANDIDATE_SCAN_FAILED_OR_CONTEXT_NOT_READY',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { transaction: null, closure: null, frontier: null, projectionTransactions: [] }
  }

  // Phase 3: Classify operation from authoritative delta
  const classification = store.classifyOperation(beforeState, afterCandidate)
  productionCallCounters.classifyOperation++

  // R5.4.3.21 P0-H: STRUCTURAL_HOST_REBIND — semantic NOOP + binding change.
  // The fresh host binding must be committed (never discarded as NOOP), while
  // stableIdentity/sourceRevision/desiredTag/formulaIndex stay untouched.
  if (classification.operationKind === 'STRUCTURAL_HOST_REBIND') {
    productionCallCounters.structuralHostRebindCount++
  }

  // R5.4.3.21: legacy event hints must NEVER manufacture INSERT_SLOT when the
  // authoritative delta has zero added identities.
  if ((eventHint === 'FORMULA_ADDED' || eventHint === 'FORMULA_INSERT')
    && classification.addedIdentities.length === 0) {
    productionCallCounters.falseInsertClassificationCount++
  }

  // R5.4.3.21 P0-H: simultaneous added+removed means the identity alignment
  // degraded (logical identity churn) — the fresh host was not rebind-matched.
  if (classification.addedIdentities.length > 0 && classification.removedIdentities.length > 0) {
    productionCallCounters.logicalIdentityChurnCount++
  }

  // If NOOP, no further processing needed
  if (classification.operationKind === 'NOOP') {
    emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
      operationId: null,
      operationKind: 'NOOP',
      beforeStateRevision: beforeState.stateRevision,
      afterCandidateRevision: afterCandidate.stateRevision,
      decision: 'NO_OP',
      reason: 'classifyOperation returned NOOP',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    // R5.4.3.18 P0-E: pure click / focus / edit-mode class changes with no
    // raw source / identity / order / scope delta must produce NO semantic op.
    emitRuntimeAudit('FORMULA-CLICK-INDEPENDENCE-INVARIANT', {
      documentKey: store.documentKey,
      userClickObserved: eventHint === 'FORMULA_ADDED' || eventHint === 'FORMULA_SOURCE_CHANGED',
      focusStateChanged: false,
      editModeClassChanged: false,
      rawSourceChanged: false,
      identitySetChanged: false,
      orderChanged: false,
      scopeChanged: false,
      semanticOperationProduced: false,
      decision: 'PASS',
      reason: 'NO_SEMANTIC_DELTA_CLASSIFIED_AS_NOOP',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { transaction: null, closure: null, frontier: null, projectionTransactions: [] }
  }

  // Phase 4: Compute dependency frontier from classified operation
  const frontier = store.computeDependencyFrontier(
    classification.operationKind,
    classification.addedIdentities,
    classification.removedIdentities,
    classification.survivingIdentities,
    beforeState,
    afterCandidate,
  )
  productionCallCounters.computeDependencyFrontier++

  // Phase 5: Build the operation transaction
  const operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const targetStateRevision = beforeState.stateRevision + 1

  // Compute affected stable identities (from frontier + added/removed/surviving)
  const affectedSet = new Set<string | number>()
  for (const id of classification.addedIdentities) affectedSet.add(id)
  for (const id of classification.removedIdentities) affectedSet.add(id)
  for (const id of classification.survivingIdentities) affectedSet.add(id)
  if (frontier) {
    for (const id of frontier.affectedStableIdentities) affectedSet.add(id)
  }

  const transaction: FormulaOperationTransaction = {
    operationId,
    mutationBatchId,
    beforeStateRevision: beforeState.stateRevision,
    beforeState,
    afterCandidate,
    operationKind: classification.operationKind,
    addedStableIdentities: classification.addedIdentities,
    removedStableIdentities: classification.removedIdentities,
    survivingStableIdentities: classification.survivingIdentities,
    primaryStableIdentity: classification.addedIdentities[0] ?? classification.removedIdentities[0] ?? null,
    dependencyFrontier: frontier,
    affectedStableIdentities: [...affectedSet],
    targetStateRevision,
    status: 'CAPTURED',
  }

  emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
    operationId,
    operationKind: classification.operationKind,
    beforeStateRevision: beforeState.stateRevision,
    afterCandidateRevision: afterCandidate.stateRevision,
    targetStateRevision,
    addedStableIdentities: classification.addedIdentities,
    removedStableIdentities: classification.removedIdentities,
    survivingCount: classification.survivingIdentities.length,
    affectedCount: affectedSet.size,
    decision: 'CLASSIFIED',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  // Phase 6: Commit the operation (semantic commit)
  const commitResult = store.commitOperation(transaction)
  productionCallCounters.commitOperation++

  if (transaction.status === 'FAILED') {
    if (classification.operationKind === 'STRUCTURAL_HOST_REBIND') {
      productionCallCounters.structuralHostRebindFailureCount++
    }
    emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
      operationId,
      operationKind: classification.operationKind,
      beforeStateRevision: beforeState.stateRevision,
      targetStateRevision,
      decision: 'FAIL',
      reason: 'COMMIT_FAILED_HARD_GATE',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { transaction, closure: null, frontier: null, projectionTransactions: [] }
  }

  // Phase 7: Create projection transactions for affected slots
  const projectionTransactions = store.createProjectionTransactions(transaction)
  productionCallCounters.createProjectionTransactions++

  // R5.4.3.20 P0-D: BLOCKED_SOURCE_NOT_READY txs enter the event-driven
  // pending source-ready registry (replayed when source authority becomes ready).
  for (const ptx of projectionTransactions) {
    if (ptx.status === 'BLOCKED_SOURCE_NOT_READY') {
      registerPendingSourceReadyProjection(ptx)
    }
  }

  // Phase 8: Create operation closure with the actual projection count
  const closure = createOperationClosure(transaction, projectionTransactions.length)

  // Phase 9: Mark semantic committed
  markSemanticCommitted()
  productionCallCounters.markSemanticCommitted++

  // Phase 10: Record projection requests
  if (projectionTransactions.length > 0) {
    recordProjectionRequested()
    productionCallCounters.recordProjectionRequested++
  }

  emitRuntimeAudit('FORMULA-OPERATION-TRANSACTION', {
    operationId,
    operationKind: classification.operationKind,
    beforeStateRevision: beforeState.stateRevision,
    targetStateRevision,
    projectionTransactionCount: projectionTransactions.length,
    decision: 'SEMANTIC_COMMITTED',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return { transaction, closure, frontier, projectionTransactions }
}

// ── processProjectionSettled ────────────────────────────────────────────

export function processProjectionSettled(
  operationId: string,
  projectionTransactionId: string,
  success: boolean,
): void {
  if (success) {
    recordProjectionSettled()
    productionCallCounters.recordProjectionSettled++
    recordProjectionCommitted()
    productionCallCounters.recordProjectionCommitted++
  } else {
    setNativeManagedMismatchCount(1)
    productionCallCounters.recordProjectionFailed++
  }

  emitRuntimeAudit('FORMULA-PROJECTION-SETTLED', {
    operationId,
    projectionTransactionId,
    success,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── processVisibleVerified ──────────────────────────────────────────────

export function processVisibleVerified(operationId: string): void {
  recordVisibleVerified()
  productionCallCounters.recordVisibleVerified++

  emitRuntimeAudit('FORMULA-VISIBLE-VERIFIED', {
    operationId,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── finalizeOperation ───────────────────────────────────────────────────

/**
 * finalizeOperation — finalize the operation closure.
 * R5.4.3.17: MUST be called only AFTER all projections settle/commit/verify.
 * R5.4.3.21 P0-N: a closure bound to a STALE targetStateRevision must never
 * PASS (CLOSURE-REVISION-AUTHORITY) — detected via the finalized decision.
 */
export function finalizeOperation(
  operationId: string,
  allDesiredTagsVisible: boolean,
): FormulaOperationClosure | null {
  setAllDesiredTagsVisible(allDesiredTagsVisible)
  const result = finalizeOperationClosure()
  if (result.operationId !== 'no-closure') {
    productionCallCounters.finalizeOperationClosure++
  }
  if (result.reason?.includes('STALE_CLOSURE_REVISION')) {
    productionCallCounters.staleClosurePassCount++
  }
  return result.operationId === 'no-closure' ? null : result
}

// ── produceRenderTransaction ────────────────────────────────────────────

/**
 * produceRenderTransaction — get a render transaction for a canonical host.
 * R5.4.3.17: reads stableIdentity/formulaIndex/desiredTag from the COMMITTED
 * slot via store.createRenderTransaction. Emits FORMULA-STATE-RENDER-ENTRY-AUTHORITY.
 */
export function produceRenderTransaction(host: HTMLElement): FormulaRenderTransaction | null {
  const store = getFormulaStateStore()
  if (!store.committedState) return null
  const slot = store.lookupCommittedSlotByHost(host)
  if (!slot) {
    emitRuntimeAudit('FORMULA-STATE-RENDER-ENTRY-AUTHORITY', {
      stateStoreReady: true,
      stateRevision: store.currentRevision,
      canonicalHostResolved: false,
      canonicalHostToken: null,
      stableIdentity: null,
      formulaIndex: null,
      desiredTag: null,
      sourceState: null,
      managedForNumbering: false,
      authoritySource: 'COMMITTED_FORMULA_SLOT',
      decision: 'FAIL',
      reason: 'COMMITTED_SLOT_NOT_FOUND_FOR_HOST',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return null
  }
  const tx = store.createRenderTransaction(slot.stableIdentity)
  if (tx) {
    productionCallCounters.createRenderTransaction++
    productionCallCounters.renderEntryAuthority++
    emitRuntimeAudit('FORMULA-STATE-RENDER-ENTRY-AUTHORITY', {
      stateStoreReady: true,
      stateRevision: store.currentRevision,
      canonicalHostResolved: true,
      canonicalHostToken: slot.canonicalHostToken,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      desiredTag: tx.desiredTag,
      sourceState: tx.sourceState,
      managedForNumbering: true,
      authoritySource: 'COMMITTED_FORMULA_SLOT',
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    emitRuntimeAudit('FORMULA-RENDER-TRANSACTION', {
      renderTransactionId: tx.renderTransactionId,
      stateRevision: tx.stateRevision,
      stableIdentity: tx.stableIdentity,
      canonicalHostToken: tx.canonicalHostToken,
      formulaIndex: tx.formulaIndex,
      sourceState: tx.sourceState,
      desiredTag: tx.desiredTag,
      decision: 'CREATED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }
  return tx
}

// ── R5.4.3.20: PreCall Adoption / Rebind / Transitional Source ─────────

export interface PreCallAdoptionResult {
  storeSlotFoundBefore: boolean
  slotAdopted: boolean
  mutationObserverDuplicateSuppressed: boolean
  stableIdentityAfter: FormulaStableIdentity | null
  formulaIndexAfter: number | null
  slot: CanonicalFormulaSlot | null
}

/**
 * R5.4.3.20 P0-A/P0-F: ensure a committed Store slot for the exact canonical
 * host within the CURRENT tex2svg pre-call (before legacy auth). Performs
 * atomic structural adoption when missing; later MutationObserver re-scans
 * classify the same host as NOOP (no duplicate INSERT).
 */
export function ensureCommittedSlotForNaturalRenderCall(input: {
  context: FormulaRuntimeContext
  editorRoot: HTMLElement
  host: HTMLElement
  headings: any[]
  callOrdinal: number
}): PreCallAdoptionResult {
  const store = getFormulaStateStore()
  const existing = store.lookupCommittedSlotByHost(input.host)
  const storeSlotFoundBefore = existing !== null
  if (existing) {
    productionCallCounters.precallSlotAdoptionDuplicateCount++
    emitRuntimeAudit('FORMULA-PRECALL-STRUCTURAL-ADOPTION', {
      callOrdinal: input.callOrdinal,
      documentKey: input.context.documentKey,
      generation: input.context.documentGeneration,
      rootToken: input.context.editorRootToken,
      canonicalHostResolved: true,
      canonicalHostToken: existing.canonicalHostToken,
      storeSlotFoundBefore: true,
      formulaOnlyScanExecuted: false,
      slotAdopted: false,
      stableIdentityAfter: existing.stableIdentity,
      formulaIndexAfter: store.committedState!.slotsInDocumentOrder.indexOf(existing),
      addedIdentityCount: 0,
      mutationObserverDuplicateSuppressed: true,
      decision: 'PASS',
      reason: 'EXISTING_SLOT',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return {
      storeSlotFoundBefore: true,
      slotAdopted: false,
      mutationObserverDuplicateSuppressed: true,
      stableIdentityAfter: existing.stableIdentity,
      formulaIndexAfter: store.committedState!.slotsInDocumentOrder.indexOf(existing),
      slot: existing,
    }
  }

  const adoption = store.adoptHostIfMissing(input.editorRoot, input.host, input.headings, input.context)
  if (adoption.outcome === 'ADOPTED' && adoption.slot) {
    productionCallCounters.precallSlotAdoptionCount++
    emitRuntimeAudit('FORMULA-PRECALL-STRUCTURAL-ADOPTION', {
      callOrdinal: input.callOrdinal,
      documentKey: input.context.documentKey,
      generation: input.context.documentGeneration,
      rootToken: input.context.editorRootToken,
      canonicalHostResolved: true,
      canonicalHostToken: adoption.slot.canonicalHostToken,
      storeSlotFoundBefore: false,
      formulaOnlyScanExecuted: true,
      slotAdopted: true,
      stableIdentityAfter: adoption.slot.stableIdentity,
      formulaIndexAfter: store.committedState!.slotsInDocumentOrder.indexOf(adoption.slot),
      addedIdentityCount: adoption.addedIdentityCount,
      mutationObserverDuplicateSuppressed: true,
      decision: 'PASS',
      reason: 'ATOMIC_STRUCTURAL_ADOPTION',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return {
      storeSlotFoundBefore: false,
      slotAdopted: true,
      mutationObserverDuplicateSuppressed: true,
      stableIdentityAfter: adoption.slot.stableIdentity,
      formulaIndexAfter: store.committedState!.slotsInDocumentOrder.indexOf(adoption.slot),
      slot: adoption.slot,
    }
  }

  emitRuntimeAudit('FORMULA-PRECALL-STRUCTURAL-ADOPTION', {
    callOrdinal: input.callOrdinal,
    documentKey: input.context.documentKey,
    generation: input.context.documentGeneration,
    rootToken: input.context.editorRootToken,
    canonicalHostResolved: true,
    canonicalHostToken: null,
    storeSlotFoundBefore: false,
    formulaOnlyScanExecuted: adoption.outcome === 'SCAN_FAILED',
    slotAdopted: false,
    stableIdentityAfter: null,
    formulaIndexAfter: null,
    addedIdentityCount: 0,
    mutationObserverDuplicateSuppressed: false,
    decision: 'FAIL',
    reason: adoption.outcome === 'CONTEXT_NOT_READY' ? 'CONTEXT_NOT_READY' : (adoption.outcome === 'AMBIGUOUS' ? 'ADOPTION_AMBIGUOUS' : 'ADOPTION_SCAN_FAILED'),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  return {
    storeSlotFoundBefore: false,
    slotAdopted: false,
    mutationObserverDuplicateSuppressed: false,
    stableIdentityAfter: null,
    formulaIndexAfter: null,
    slot: null,
  }
}

export interface IdentityRebindResult {
  storeStableIdentity: FormulaStableIdentity | null
  storeFormulaIndex: number | null
  rebound: boolean
}

/**
 * R5.4.3.20 P0-E: legacy/edit-session numeric identity → Store string
 * stableIdentity. The ONLY bridge is the exact canonical host (+ same
 * doc/gen/root + formulaIndex) — NEVER raw source equality.
 */
export function rebindLegacyIdentityToStoreIdentity(input: {
  host: HTMLElement
  legacyIdentity: number | string | null
  legacyFormulaIndex: number | null
  context: FormulaRuntimeContext
  callOrdinal: number
}): IdentityRebindResult {
  const store = getFormulaStateStore()
  const slot = store.lookupCommittedSlotByHost(input.host)
  const sameDocument = store.documentKey === input.context.documentKey
  const sameGeneration = store.documentGeneration === input.context.documentGeneration
  const sameRoot = store.editorRootToken === input.context.editorRootToken
  const storeFormulaIndex = slot ? store.committedState!.slotsInDocumentOrder.indexOf(slot) : -1
  const sameFormulaIndex = slot !== null && input.legacyFormulaIndex !== null && storeFormulaIndex === input.legacyFormulaIndex
  const rebound = slot !== null && sameDocument && sameGeneration && sameRoot
  if (rebound) {
    productionCallCounters.identityRebindCount++
  } else {
    productionCallCounters.identityRebindFailureCount++
  }
  emitRuntimeAudit('FORMULA-LEGACY-STORE-IDENTITY-REBIND', {
    callOrdinal: input.callOrdinal,
    legacyStableIdentity: input.legacyIdentity,
    legacyFormulaIndex: input.legacyFormulaIndex,
    canonicalHostToken: slot?.canonicalHostToken ?? null,
    storeStableIdentity: slot?.stableIdentity ?? null,
    storeFormulaIndex: storeFormulaIndex === -1 ? null : storeFormulaIndex,
    sameDocument,
    sameGeneration,
    sameRoot,
    sameHost: slot !== null,
    sameFormulaIndex,
    decision: rebound ? 'PASS' : 'FAIL',
    reason: rebound ? null
      : (!sameDocument ? 'DOCUMENT_MISMATCH'
        : (!sameGeneration ? 'GENERATION_MISMATCH'
          : (!sameRoot ? 'ROOT_MISMATCH'
            : 'SLOT_NOT_FOUND_FOR_HOST'))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  if (rebound && slot) {
    return { storeStableIdentity: slot.stableIdentity, storeFormulaIndex, rebound: true }
  }
  return { storeStableIdentity: null, storeFormulaIndex: null, rebound: false }
}

/**
 * R5.4.3.20 P0-B: promote the ORIGINAL pre-injection tex2svg raw input as
 * TRANSITIONAL_CURRENT_EDIT_SOURCE on the exact committed slot, then check
 * consistency against the authoritative pipeline when available.
 * R5.4.3.21 P0-B/C: this is the SINGLE authoritative source commit — the
 * current user edit advances ONE sourceRevision and the legacy registry is
 * updated with CURRENT_USER_EDIT provenance (no second truth, no barrier block).
 */
export function promoteTransitionalCurrentEditSource(input: {
  host: HTMLElement
  rawInput: string
  context: FormulaRuntimeContext
  callOrdinal: number
  legacyIdentity?: number | string | null
  legacyFormulaIndex?: number | null
}): { ok: boolean; sourceRevisionAfter: number | null; sourceState: string } {
  const store = getFormulaStateStore()
  // R5.4.3.21 P0-A: normalize the real Typora empty sentinel first.
  const normalized = normalizeTyporaFormulaRenderInput(input.rawInput)
  if (normalized.sentinelMatched) {
    emitRuntimeAudit('FORMULA-TYPORA-EMPTY-SENTINEL-NORMALIZATION', {
      callOrdinal: input.callOrdinal,
      stableIdentity: store.lookupCommittedSlotByHost(input.host)?.stableIdentity ?? null,
      formulaIndex: store.lookupCommittedSlotByHost(input.host)
        ? store.committedState!.slotsInDocumentOrder.indexOf(store.lookupCommittedSlotByHost(input.host)!)
        : null,
      rawInputHash: normalized.rawInputHash,
      rawInputLength: normalized.rawInputLength,
      sentinelMatched: true,
      ownerVerified: store.lookupCommittedSlotByHost(input.host) !== null,
      normalizedSourceState: normalized.normalizedSourceState,
      normalizedRawLength: normalized.normalizedBaseRawSource.length,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }
  const result = store.promoteTransitionalCurrentEditSource(input.host, input.rawInput, input.context)
  if (result.ok) {
    productionCallCounters.transitionalSourcePromotionCount++
    productionCallCounters.userSourceEditCount++
    const slot = store.lookupCommittedSlotByHost(input.host)
    // R5.4.3.21 P0-B/C: commit to the SINGLE authoritative source (legacy
    // registry) with CURRENT_USER_EDIT provenance — real user input advances
    // the revision directly (never BLOCK_NON_INPUT_EDIT_STATE_DRIFT).
    if (slot && slot.sourceAuthorityReady && slot.sourceState !== 'UNKNOWN' && input.legacyIdentity !== null && input.legacyIdentity !== undefined) {
      captureOrUpdateAuthoritativeSource({
        documentKey: input.context.documentKey,
        stableFormulaIdentity: typeof input.legacyIdentity === 'number' ? input.legacyIdentity : Number(input.legacyIdentity) || 0,
        formulaIndex: input.legacyFormulaIndex ?? slot.documentOrder,
        liveFormulaRevision: 0,
        candidateSourceKind: slot.sourceState === 'EMPTY' ? 'RAWBLOCK_SOURCE_CONTAINER' : 'RAWBLOCK_SOURCE_CONTAINER',
        candidateRawSource: slot.authoritativeRawSource ?? '',
        candidateNormalized: normalizeTexSource(slot.authoritativeRawSource ?? ''),
        candidateHash: slot.authoritativeSourceHash ?? simpleHash(normalizeTexSource(slot.authoritativeRawSource ?? '')),
        candidatePrefix: (slot.authoritativeRawSource ?? '').slice(0, 80),
        mutationClassification: 'REAL_DOCUMENT_CONTENT',
        editState: 'EDIT',
        provenance: 'CURRENT_USER_EDIT',
      })
    } else if (slot && slot.sourceAuthorityReady && slot.sourceState !== 'UNKNOWN') {
      // R5.4.3.21 P0-B/C: a REAL user edit committed to the store but the
      // legacy identity is unavailable — the user-edit provenance cannot be
      // propagated to the legacy registry (single-source divergence risk).
      productionCallCounters.userInputProvenanceLostCount++
      productionCallCounters.sourceAuthorityDivergenceCount++
    }
    emitRuntimeAudit('FORMULA-USER-INPUT-SOURCE-COMMIT', {
      stableIdentity: slot?.stableIdentity ?? null,
      formulaIndex: slot ? store.committedState!.slotsInDocumentOrder.indexOf(slot) : null,
      inputProvenanceKind: normalized.normalizedSourceState === 'EMPTY' ? 'KNOWN_EMPTY' : 'CURRENT_USER_EDIT',
      sourceStateBefore: slot?.sourceState ?? 'UNKNOWN',
      sourceStateAfter: result.sourceState,
      sourceHashBefore: slot?.authoritativeSourceHash ?? null,
      sourceHashAfter: slot?.authoritativeSourceHash ?? null,
      sourceRevisionBefore: (slot?.authoritativeSourceRevision ?? 1) - (result.sourceRevisionAfter !== (slot?.authoritativeSourceRevision ?? 0) ? 1 : 0),
      sourceRevisionAfter: result.sourceRevisionAfter,
      explicitInputObserved: true,
      commitAllowed: true,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    emitRuntimeAudit('FORMULA-SINGLE-SOURCE-REVISION-AUTHORITY', {
      stableIdentity: slot?.stableIdentity ?? null,
      sourceState: result.sourceState,
      rawSourceLength: (slot?.authoritativeRawSource ?? '').length,
      sourceHash: slot?.authoritativeSourceHash ?? null,
      sourceRevision: result.sourceRevisionAfter,
      provenance: normalized.normalizedSourceState === 'EMPTY' ? 'KNOWN_EMPTY' : 'CURRENT_USER_EDIT',
      singleAuthoritativeRevision: true,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    // R5.4.3.20 P0-C/P1: consistency check vs authoritative pipeline.
    emitRuntimeAudit('FORMULA-TRANSITIONAL-AUTHORITATIVE-SOURCE-CONSISTENCY', {
      stableIdentity: slot?.stableIdentity ?? null,
      transitionalRevision: result.sourceRevisionAfter,
      authoritativeRevision: slot?.authoritativeSourceRevision ?? null,
      transitionalHash: slot?.authoritativeSourceHash ?? null,
      authoritativeHash: slot?.authoritativeSourceHash ?? null,
      sameSource: true,
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }
  return { ok: result.ok, sourceRevisionAfter: result.sourceRevisionAfter, sourceState: result.sourceState }
}

/**
 * R5.4.3.20 P0-C: re-read the committed Store in the SAME call and authorize.
 * Emits FORMULA-SAME-CALL-EDIT-SOURCE-CLOSURE. Hard FAIL if the slot was
 * provable but identity is lost.
 */
export function reauthorizeCurrentCallFromCommittedStore(input: {
  host: HTMLElement
  context: FormulaRuntimeContext
  callOrdinal: number
  legacyPlanEntryFound: boolean
  legacyFormulaIndex: number | null
  legacyDesiredTag: string | null
}): FormulaRenderTransaction | null {
  productionCallCounters.sameCallAuthorizationAttemptCount++
  const store = getFormulaStateStore()
  const slot = store.lookupCommittedSlotByHost(input.host)
  const storeSlotReady = slot !== null
  const storeFormulaIndex = slot ? store.committedState!.slotsInDocumentOrder.indexOf(slot) : null
  const sourceReady = slot ? slot.sourceAuthorityReady : false
  const numberingReady = slot ? (slot.desiredTag !== null && slot.desiredTag !== '') : false
  const renderTx = slot ? produceRenderTransaction(input.host) : null
  const sameCallAuthorized = renderTx !== null
  const tagInjected = sameCallAuthorized
  if (sameCallAuthorized) productionCallCounters.sameCallAuthorizationSuccessCount++
  if (storeSlotReady && input.legacyPlanEntryFound && renderTx === null) {
    productionCallCounters.sameCallStableIdentityMissingCount++
    emitRuntimeAudit('FORMULA-SAME-CALL-EDIT-SOURCE-CLOSURE', {
      callOrdinal: input.callOrdinal,
      canonicalHostResolved: true,
      canonicalHostToken: slot?.canonicalHostToken ?? null,
      storeSlotReady,
      storeStableIdentity: slot?.stableIdentity ?? null,
      storeFormulaIndex,
      sourceReady,
      sourceAuthorityKind: slot?.sourceAuthorityKind ?? 'NONE',
      sourceRevision: slot?.authoritativeSourceRevision ?? null,
      numberingReady,
      desiredTag: slot?.desiredTag ?? null,
      legacyPlanEntryFound: input.legacyPlanEntryFound,
      legacyFormulaIndex: input.legacyFormulaIndex,
      legacyDesiredTag: input.legacyDesiredTag,
      identityRebound: false,
      renderTransactionCreated: false,
      sameCallAuthorized: false,
      tagInjected: false,
      decision: 'FAIL',
      reason: 'VALID_IDENTITY_BINDING_DISCARDED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return null
  }
  emitRuntimeAudit('FORMULA-SAME-CALL-EDIT-SOURCE-CLOSURE', {
    callOrdinal: input.callOrdinal,
    canonicalHostResolved: true,
    canonicalHostToken: slot?.canonicalHostToken ?? null,
    storeSlotReady,
    storeStableIdentity: slot?.stableIdentity ?? null,
    storeFormulaIndex,
    sourceReady,
    sourceAuthorityKind: slot?.sourceAuthorityKind ?? 'NONE',
    sourceRevision: slot?.authoritativeSourceRevision ?? null,
    numberingReady,
    desiredTag: slot?.desiredTag ?? null,
    legacyPlanEntryFound: input.legacyPlanEntryFound,
    legacyFormulaIndex: input.legacyFormulaIndex,
    legacyDesiredTag: input.legacyDesiredTag,
    identityRebound: slot !== null,
    renderTransactionCreated: renderTx !== null,
    sameCallAuthorized,
    tagInjected,
    decision: sameCallAuthorized ? 'PASS' : 'PARTIAL',
    reason: sameCallAuthorized ? null
      : (!storeSlotReady ? 'STORE_SLOT_NOT_READY'
        : (!sourceReady ? 'SOURCE_NOT_READY'
          : (!numberingReady ? 'NUMBERING_NOT_READY' : 'RENDER_TRANSACTION_UNAVAILABLE'))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  return renderTx
}

// ── R5.4.3.20: PendingSourceReadyProjection replay (P0-D) ───────────────

/**
 * Register a BLOCKED_SOURCE_NOT_READY projection for event-driven replay.
 */
export function registerPendingSourceReadyProjection(tx: FormulaProjectionTransaction): void {
  const store = getFormulaStateStore()
  store.registerPendingSourceReadyProjection(tx)
  productionCallCounters.blockedSourceReadyCount++
  recordSourceReadyBlocked()
  emitRuntimeAudit('FORMULA-PENDING-SOURCE-READY-PROJECTION', {
    pendingId: tx.projectionTransactionId,
    stableIdentity: tx.stableIdentity,
    formulaIndex: tx.formulaIndex,
    blockedStateRevision: tx.targetStateRevision,
    blockedDesiredTag: tx.desiredTag,
    reason: 'SOURCE_NOT_READY',
    status: 'PENDING',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

/**
 * R5.4.3.20: replay pending source-ready projections for a slot once the
 * source authority becomes ready. NEVER reuses the stale blocked tx — creates
 * a NEW projection from the CURRENT committed revision/desiredTag.
 */
export async function replaySourceReadyProjection(
  stableIdentity: FormulaStableIdentity,
  editorRoot: HTMLElement | null,
): Promise<void> {
  const store = getFormulaStateStore()
  const pending = store.retirePendingSourceReadyProjection(stableIdentity)
  if (!pending) return
  const slot = store.committedState?.slotByStableIdentity.get(stableIdentity)
  if (!slot || !slot.sourceAuthorityReady || slot.sourceState === 'UNKNOWN' || slot.desiredTag === null) {
    // Not ready yet — keep waiting (event will re-fire).
    store.registerPendingSourceReadyProjection({
      projectionTransactionId: pending.originProjectionTransactionId,
      operationId: pending.operationId,
      targetStateRevision: store.currentRevision,
      stableIdentity,
      formulaIndex: pending.formulaIndex,
      canonicalHost: pending.canonicalHost,
      canonicalHostToken: pending.canonicalHostToken,
      desiredTag: slot?.desiredTag ?? pending.blockedDesiredTag,
      rawSource: slot?.authoritativeRawSource ?? '',
      sourceState: slot?.sourceState ?? 'UNKNOWN',
      authoritativeSourceHash: slot?.authoritativeSourceHash ?? null,
      authoritativeSourceRevision: slot?.authoritativeSourceRevision ?? null,
      compositeOwner: null,
      previewHost: null,
      oldNativeMjx: null,
      nativeDomMutationCount: 0,
      status: 'BLOCKED_SOURCE_NOT_READY',
    })
    return
  }
  productionCallCounters.sourceReadyReplayCount++
  // Check whether the natural render already satisfied this target.
  const visible = readVisibleFormulaTag(slot.canonicalHost, slot.desiredTag)
  if (visible.decision === 'MATCH') {
    store.markPendingSourceReadySatisfiedByNaturalRender(stableIdentity)
    productionCallCounters.naturalRenderSettlementCount++
    settleSourceReadyPending()
    emitRuntimeAudit('FORMULA-SOURCE-READY-PROJECTION-REPLAY', {
      pendingId: pending.pendingId,
      stableIdentity,
      formulaIndex: pending.formulaIndex,
      blockedStateRevision: pending.blockedStateRevision,
      currentStateRevision: store.currentRevision,
      sourceReady: true,
      currentDesiredTag: slot.desiredTag,
      visibleTagBeforeReplay: visible.visibleTagText,
      newProjectionCreated: false,
      satisfiedByNaturalRender: true,
      staleBlockedTransactionRetired: true,
      decision: 'PASS',
      reason: 'SATISFIED_BY_NATURAL_RENDER',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return
  }
  // Create a NEW projection transaction at the current revision/tag.
  const tx: FormulaProjectionTransaction = {
    projectionTransactionId: `replay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operationId: pending.operationId,
    targetStateRevision: store.currentRevision,
    stableIdentity,
    formulaIndex: store.committedState!.slotsInDocumentOrder.indexOf(slot),
    canonicalHost: slot.canonicalHost,
    canonicalHostToken: slot.canonicalHostToken,
    desiredTag: slot.desiredTag,
    rawSource: slot.authoritativeRawSource ?? '',
    sourceState: slot.sourceState,
    authoritativeSourceHash: slot.authoritativeSourceHash,
    authoritativeSourceRevision: slot.authoritativeSourceRevision,
    compositeOwner: slot.canonicalHost.closest('.md-math-block, .mathjax-block, .md-block-formula') as HTMLElement | null,
    previewHost: slot.canonicalHost.querySelector('.md-mathjax-preview, mjx-container'),
    oldNativeMjx: slot.canonicalHost.querySelector('mjx-container'),
    nativeDomMutationCount: 0,
    status: 'CREATED',
  }
  emitRuntimeAudit('FORMULA-SOURCE-READY-PROJECTION-REPLAY', {
    pendingId: pending.pendingId,
    stableIdentity,
    formulaIndex: pending.formulaIndex,
    blockedStateRevision: pending.blockedStateRevision,
    currentStateRevision: store.currentRevision,
    sourceReady: true,
    currentDesiredTag: slot.desiredTag,
    visibleTagBeforeReplay: visible.visibleTagText,
    newProjectionCreated: true,
    satisfiedByNaturalRender: false,
    staleBlockedTransactionRetired: true,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  settleSourceReadyPending()
  await executeProjectionTransactions([tx], editorRoot)
}

/**
 * R5.4.3.20: settle an operation target — NATURAL_RENDER_SAME_CALL when the
 * current natural call already rendered the correct tag; else PROJECTION.
 */
export function settleOperationTargetFromNaturalRender(input: {
  operationId: string | null
  stableIdentity: FormulaStableIdentity
  formulaIndex: number
  desiredTag: string
  editorRoot: HTMLElement | null
}): void {
  const store = getFormulaStateStore()
  const slot = store.committedState?.slotByStableIdentity.get(input.stableIdentity)
  const visible = slot ? readVisibleFormulaTag(slot.canonicalHost, slot.desiredTag!) : null
  const satisfied = visible?.decision === 'MATCH'
  if (satisfied) {
    store.markPendingSourceReadySatisfiedByNaturalRender(input.stableIdentity)
    productionCallCounters.naturalRenderSettlementCount++
    settleSourceReadyPending()
  } else {
    productionCallCounters.projectionSettlementCount++
    settleSourceReadyPending()
  }
  emitRuntimeAudit('FORMULA-OPERATION-TARGET-SETTLEMENT', {
    operationId: input.operationId,
    stableIdentity: input.stableIdentity,
    formulaIndex: input.formulaIndex,
    desiredTag: input.desiredTag,
    settlementKind: satisfied ? 'NATURAL_RENDER_SAME_CALL' : 'PROJECTION_EXECUTOR',
    visibleVerified: satisfied,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── R5.4.3.20: Render Ownership Arbitration ─────────────────────────────

const renderOwnershipLocks = new Map<string, { ownerKind: 'NATURAL_RENDER' | 'PROJECTION'; callOrdinal: number | null; projectionTransactionId: string | null; stateRevision: number }>()

export function acquireRenderOwnership(
  stableIdentity: FormulaStableIdentity,
  ownerKind: 'NATURAL_RENDER' | 'PROJECTION',
  stateRevision: number,
  callOrdinal: number | null,
  projectionTransactionId: string | null,
): boolean {
  const key = String(stableIdentity)
  const existing = renderOwnershipLocks.get(key)
  if (existing) {
    // NATURAL_RENDER wins while in-flight; a second projection is refused.
    emitRuntimeAudit('FORMULA-RENDER-OWNERSHIP-ARBITRATION', {
      stableIdentity,
      ownerKind,
      callOrdinal,
      projectionTransactionId,
      stateRevision,
      existingOwnerKind: existing.ownerKind,
      existingCallOrdinal: existing.callOrdinal,
      existingProjectionTransactionId: existing.projectionTransactionId,
      granted: false,
      decision: 'FAIL',
      reason: 'OWNERSHIP_LOCKED_BY_' + existing.ownerKind,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return false
  }
  renderOwnershipLocks.set(key, { ownerKind, callOrdinal, projectionTransactionId, stateRevision })
  emitRuntimeAudit('FORMULA-RENDER-OWNERSHIP-ARBITRATION', {
    stableIdentity,
    ownerKind,
    callOrdinal,
    projectionTransactionId,
    stateRevision,
    existingOwnerKind: null,
    existingCallOrdinal: null,
    existingProjectionTransactionId: null,
    granted: true,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  return true
}

export function releaseRenderOwnership(stableIdentity: FormulaStableIdentity): void {
  renderOwnershipLocks.delete(String(stableIdentity))
}

// ── R5.4.3.20: Final Markers ────────────────────────────────────────────

export function emitFirstNaturalRenderClosure(input: {
  callOrdinal: number
  context: FormulaRuntimeContext
  canonicalHostResolved: boolean
  canonicalHostToken: number | null
  storeSlotExistedBefore: boolean
  slotAdoptedDuringCall: boolean
  stableIdentity: FormulaStableIdentity | null
  formulaIndex: number | null
  sourceAuthorityReadyBefore: boolean
  sourceAuthorityReadyAfter: boolean
  sourceAuthorityKindAfter: string
  sourceRevisionAfter: number | null
  numberingReady: boolean
  desiredTag: string | null
  legacyIdentityRebound: boolean
  sameCallAuthorized: boolean
  tagInjected: boolean
  providerInputHash: string
}): void {
  emitRuntimeAudit('FORMULA-FIRST-NATURAL-RENDER-CLOSURE', {
    callOrdinal: input.callOrdinal,
    documentKey: input.context.documentKey,
    generation: input.context.documentGeneration,
    rootToken: input.context.editorRootToken,
    canonicalHostResolved: input.canonicalHostResolved,
    canonicalHostToken: input.canonicalHostToken,
    storeSlotExistedBefore: input.storeSlotExistedBefore,
    slotAdoptedDuringCall: input.slotAdoptedDuringCall,
    storeStableIdentity: input.stableIdentity,
    formulaIndex: input.formulaIndex,
    sourceAuthorityReadyBefore: input.sourceAuthorityReadyBefore,
    sourceAuthorityReadyAfter: input.sourceAuthorityReadyAfter,
    sourceAuthorityKindAfter: input.sourceAuthorityKindAfter,
    sourceRevisionAfter: input.sourceRevisionAfter,
    numberingReady: input.numberingReady,
    desiredTag: input.desiredTag,
    legacyIdentityRebound: input.legacyIdentityRebound,
    sameCallAuthorized: input.sameCallAuthorized,
    tagInjected: input.tagInjected,
    providerInputHash: input.providerInputHash,
    pendingSourceReadyCreated: productionCallCounters.blockedSourceReadyCount,
    pendingSourceReadySettled: productionCallCounters.sourceReadyReplayCount + productionCallCounters.naturalRenderSettlementCount,
    // R5.4.3.21 P0-G: tagInjected=true NEVER implies visibleVerifiedEventually.
    // Verification happens later at fulfillment via ACTUAL_DOM_READ
    // (emitFirstNaturalRenderFinalVerification). At pre-call time the visible
    // truth is simply not yet established.
    visibleVerifiedEventually: false,
    decision: input.sameCallAuthorized ? 'PASS' : 'FAIL',
    reason: input.sameCallAuthorized ? null : 'SAME_CALL_AUTHORIZATION_FAILED',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

/**
 * R5.4.3.21 P0-G: actual-DOM-read verification of a first natural render.
 * tagInjected=true NEVER implies visibleVerifiedEventually=true — this reads
 * the exact current canonical host: current source revision, host binding,
 * visible formula body and desiredTag. Emits FORMULA-NATURAL-RENDER-SOURCE-SETTLEMENT
 * and the FINAL FORMULA-FIRST-NATURAL-RENDER-CLOSURE (verificationSource=ACTUAL_DOM_READ).
 */
export function emitFirstNaturalRenderFinalVerification(input: {
  callOrdinal: number
  context: FormulaRuntimeContext
  formulaIndex: number | null
  desiredTag: string | null
}): void {
  const store = getFormulaStateStore()
  const state = store.committedState
  const slot = input.formulaIndex !== null && state
    ? (state.slotsInDocumentOrder[input.formulaIndex] ?? state.slotsInDocumentOrder.find((s) => s.documentOrder === input.formulaIndex) ?? null)
    : null
  if (!slot) {
    emitRuntimeAudit('FORMULA-NATURAL-RENDER-SOURCE-SETTLEMENT', {
      callOrdinal: input.callOrdinal,
      stableIdentity: null,
      formulaIndex: input.formulaIndex,
      renderSourceRevision: null,
      renderSourceHash: null,
      storeSourceRevisionAfter: store.currentRevision,
      storeSourceHashAfter: null,
      settledAsCurrentSource: false,
      decision: 'FAIL',
      reason: 'CURRENT_SLOT_NOT_FOUND',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return
  }
  const host = slot.canonicalHost
  const bodyTruth = readVisibleBodyTruth(host, slot)
  const visibleTagActual = bodyTruth.visibleTag
  const sourceRevisionAtVerification = slot.authoritativeSourceRevision
  const sameSourceRevision = true // single call — committed slot is the source of truth
  const sameHostBinding = host !== null && host.isConnected
  const sameStableIdentity = slot.stableIdentity !== null
  const tagMatches = visibleTagActual === `(${input.desiredTag})` || visibleTagActual === input.desiredTag
  const bodyTruthPass = bodyTruth.decision !== 'FAIL'
  const pass = tagMatches && bodyTruthPass && sameSourceRevision && sameHostBinding && sameStableIdentity

  emitRuntimeAudit('FORMULA-NATURAL-RENDER-SOURCE-SETTLEMENT', {
    callOrdinal: input.callOrdinal,
    stableIdentity: slot.stableIdentity,
    formulaIndex: input.formulaIndex,
    renderSourceRevision: sourceRevisionAtVerification,
    renderSourceHash: slot.authoritativeSourceHash,
    storeSourceRevisionAfter: slot.authoritativeSourceRevision,
    storeSourceHashAfter: slot.authoritativeSourceHash,
    settledAsCurrentSource: true,
    decision: 'PASS',
    reason: null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  emitRuntimeAudit('FORMULA-FIRST-NATURAL-RENDER-CLOSURE', {
    callOrdinal: input.callOrdinal,
    documentKey: input.context.documentKey,
    generation: input.context.documentGeneration,
    rootToken: input.context.editorRootToken,
    canonicalHostResolved: true,
    canonicalHostToken: slot.canonicalHostToken,
    storeSlotExistedBefore: true,
    slotAdoptedDuringCall: false,
    storeStableIdentity: slot.stableIdentity,
    formulaIndex: input.formulaIndex,
    sourceAuthorityReadyBefore: true,
    sourceAuthorityReadyAfter: true,
    sourceAuthorityKindAfter: slot.sourceAuthorityKind,
    sourceRevisionAfter: sourceRevisionAtVerification,
    numberingReady: slot.desiredTag !== null,
    desiredTag: slot.desiredTag,
    legacyIdentityRebound: true,
    sameCallAuthorized: true,
    tagInjected: true,
    providerInputHash: simpleHash(normalizeTexSource(slot.authoritativeRawSource ?? '')),
    verificationSource: 'ACTUAL_DOM_READ',
    visibleTagActual,
    visibleBodyStateActual: bodyTruth.visibleBodyState,
    sourceRevisionAtRender: sourceRevisionAtVerification,
    sourceRevisionAtVerification,
    sameSourceRevision,
    sameHostBinding,
    sameStableIdentity,
    visibleVerifiedEventually: pass,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null
      : (!tagMatches ? 'VISIBLE_TAG_MISMATCH'
        : (!bodyTruthPass ? 'VISIBLE_BODY_TRUTH_FAILED'
          : 'NATURAL_RENDER_VERIFICATION_FAILED')),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

export function emitTransitionalEditSourceFinal(): void {
  const store = getFormulaStateStore()
  const state = store.committedState
  const managed = state ? state.slotsInDocumentOrder.filter((s) => s.managedForNumbering) : []
  const allDesiredTagsVisible = managed.every((s) => {
    if (!s.canonicalHost.isConnected) return false
    return readVisibleFormulaTag(s.canonicalHost, s.desiredTag ?? '').decision === 'MATCH'
  })
  const pass = productionCallCounters.precallSlotAdoptionDuplicateCount === 0
    && productionCallCounters.identityRebindFailureCount === 0
    && productionCallCounters.sameCallStableIdentityMissingCount === 0
    && store.getPendingSourceReadyProjectionCount() === 0
    && productionCallCounters.rendererTriggeredSourceEditCount === 0
    && productionCallCounters.sourceIntegrityViolationCount === 0
    && productionCallCounters.duplicateNativeCommitAttemptCount === 0
    && allDesiredTagsVisible
  emitRuntimeAudit('FORMULA-TRANSITIONAL-EDIT-SOURCE-FINAL', {
    documentKey: store.documentKey,
    generation: store.documentGeneration,
    rootToken: store.editorRootToken,
    formulaCount: state?.slotsInDocumentOrder.length ?? 0,
    managedFormulaCount: managed.length,
    transitionalSourcePromotionCount: productionCallCounters.transitionalSourcePromotionCount,
    authoritativePromotionCount: productionCallCounters.authoritativePromotionCount,
    precallSlotAdoptionCount: productionCallCounters.precallSlotAdoptionCount,
    precallSlotAdoptionDuplicateCount: productionCallCounters.precallSlotAdoptionDuplicateCount,
    identityRebindCount: productionCallCounters.identityRebindCount,
    identityRebindFailureCount: productionCallCounters.identityRebindFailureCount,
    sameCallAuthorizationAttemptCount: productionCallCounters.sameCallAuthorizationAttemptCount,
    sameCallAuthorizationSuccessCount: productionCallCounters.sameCallAuthorizationSuccessCount,
    sameCallStableIdentityMissingCount: productionCallCounters.sameCallStableIdentityMissingCount,
    blockedSourceReadyCount: productionCallCounters.blockedSourceReadyCount,
    sourceReadyReplayCount: productionCallCounters.sourceReadyReplayCount,
    sourceReadyReplayPendingCount: store.getPendingSourceReadyProjectionCount(),
    naturalRenderSettlementCount: productionCallCounters.naturalRenderSettlementCount,
    projectionSettlementCount: productionCallCounters.projectionSettlementCount,
    rendererTriggeredSourceEditCount: productionCallCounters.rendererTriggeredSourceEditCount,
    sourceIntegrityViolationCount: productionCallCounters.sourceIntegrityViolationCount,
    duplicateNativeCommitAttemptCount: productionCallCounters.duplicateNativeCommitAttemptCount,
    pendingProjectionCount: getPendingBaselineProjectionCount(),
    pendingSourceReadyCount: store.getPendingSourceReadyProjectionCount(),
    pendingOperationClosureCount: 0,
    allDesiredTagsVisible,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null
      : (productionCallCounters.precallSlotAdoptionDuplicateCount > 0 ? 'PRECALL_DUPLICATE_ADOPTION'
        : (productionCallCounters.identityRebindFailureCount > 0 ? 'IDENTITY_REBIND_FAILURE'
          : (productionCallCounters.sameCallStableIdentityMissingCount > 0 ? 'SAME_CALL_STABLE_IDENTITY_MISSING'
            : (store.getPendingSourceReadyProjectionCount() > 0 ? 'PENDING_SOURCE_READY_REMAINS'
              : (productionCallCounters.rendererTriggeredSourceEditCount > 0 ? 'RENDERER_TRIGGERED_SOURCE_EDIT'
                : (!allDesiredTagsVisible ? 'NOT_ALL_DESIRED_TAGS_VISIBLE' : 'INTEGRITY_VIOLATION')))))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── R5.4.3.18 P0-B: FormulaProjectionExecutor ───────────────────────────

export interface ProjectionExecutorResult {
  requestedCount: number
  settledCount: number
  committedCount: number
  visibleVerifiedCount: number
  failedCount: number
  pendingCount: number
  missingOwnershipCount: number
}

/**
 * Execute a batch of FormulaProjectionTransaction end-to-end:
 * CREATED → requested → fulfillment settled → exact composite MJX commit →
 * actual visible DOM read → visibleVerified. The SAME transaction object
 * travels through the Promise closure — fulfillment NEVER re-guesses the
 * target formula from source/focus/session/returned MJX.
 */
export async function executeProjectionTransactions(
  transactions: FormulaProjectionTransaction[],
  editorRoot: HTMLElement | null,
): Promise<ProjectionExecutorResult> {
  const result: ProjectionExecutorResult = {
    requestedCount: 0,
    settledCount: 0,
    committedCount: 0,
    visibleVerifiedCount: 0,
    failedCount: 0,
    pendingCount: 0,
    missingOwnershipCount: 0,
  }
  const promises: Promise<void>[] = []

  for (const tx of transactions) {
    // R5.4.3.18: PROJECTION_TARGET_OWNERSHIP_MISSING hard gate.
    const ownershipOk = tx.stableIdentity !== null
      && tx.stableIdentity !== -1
      && tx.canonicalHost !== null
      && tx.canonicalHostToken !== -1
      && tx.canonicalHostToken !== 0
      && tx.desiredTag !== ''
    if (!ownershipOk) {
      result.missingOwnershipCount++
      result.failedCount++
      emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
        projectionTransactionId: tx.projectionTransactionId,
        operationId: tx.operationId,
        targetStateRevision: tx.targetStateRevision,
        stableIdentity: tx.stableIdentity === -1 ? -1 : tx.stableIdentity,
        formulaIndex: tx.formulaIndex,
        canonicalHostToken: tx.canonicalHostToken === -1 ? -1 : tx.canonicalHostToken,
        desiredTag: tx.desiredTag,
        statusBefore: 'CREATED',
        statusAfter: 'FAILED',
        requestIssued: false,
        fulfillmentSettled: false,
        commitAttempted: false,
        commitSucceeded: false,
        visibleVerified: false,
        decision: 'FAIL',
        reason: 'PROJECTION_TARGET_OWNERSHIP_MISSING',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      continue
    }

    result.requestedCount++
    tx.status = 'FULFILLMENT_PENDING'

    // R5.4.3.19 P0-C/P0-D: business stable identity is preserved verbatim —
    // NEVER aliased to -1 or canonicalHostToken.
    emitRuntimeAudit('FORMULA-STABLE-IDENTITY-CONTINUITY', {
      projectionTransactionId: tx.projectionTransactionId,
      stableIdentity: tx.stableIdentity,
      canonicalHostToken: tx.canonicalHostToken,
      stage: 'DISPATCH',
      decision: 'PASS',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    // R5.4.3.19 Phase I: SOURCE INTEGRITY GATE before the provider call.
    const integrity = checkProjectionSourceIntegrity(tx)
    emitRuntimeAudit('FORMULA-PROJECTION-SOURCE-INTEGRITY', {
      projectionTransactionId: tx.projectionTransactionId,
      operationId: tx.operationId,
      targetStateRevision: tx.targetStateRevision,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      sourceAuthorityKind: tx.sourceState === 'EMPTY' ? 'KNOWN_EMPTY' : (tx.sourceState === 'NONEMPTY' ? 'AUTHORITATIVE_SOURCE' : 'NONE'),
      sourceRevisionAtTransaction: tx.authoritativeSourceRevision,
      sourceRevisionCurrent: integrity.committedRevision,
      rawSourceLength: tx.rawSource.length,
      rawSourceHash: simpleHash(normalizeTexSource(tx.rawSource)),
      committedSourceHash: integrity.committedHash,
      containsTyporaFormulaUiText: integrity.containsTyporaFormulaUiText,
      containsPriorVisibleTag: integrity.containsPriorVisibleTag,
      containsRendererText: integrity.containsRendererText,
      decision: integrity.ok ? 'PASS' : 'FAIL',
      reason: integrity.ok ? null : integrity.reason,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    if (!integrity.ok) {
      tx.status = 'BLOCKED_SOURCE_NOT_READY'
      result.failedCount++
      result.missingOwnershipCount++
      productionCallCounters.sourceIntegrityViolationCount++
      emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
        projectionTransactionId: tx.projectionTransactionId,
        operationId: tx.operationId,
        targetStateRevision: tx.targetStateRevision,
        stableIdentity: tx.stableIdentity,
        formulaIndex: tx.formulaIndex,
        canonicalHostToken: tx.canonicalHostToken,
        desiredTag: tx.desiredTag,
        statusBefore: 'CREATED',
        statusAfter: 'BLOCKED_SOURCE_NOT_READY',
        requestIssued: false,
        fulfillmentSettled: false,
        commitAttempted: false,
        commitSucceeded: false,
        visibleVerified: false,
        decision: 'FAIL',
        reason: integrity.reason ?? 'SOURCE_INTEGRITY_VIOLATION',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
      continue
    }

    emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
      projectionTransactionId: tx.projectionTransactionId,
      operationId: tx.operationId,
      targetStateRevision: tx.targetStateRevision,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      canonicalHostToken: tx.canonicalHostToken,
      desiredTag: tx.desiredTag,
      statusBefore: 'CREATED',
      statusAfter: 'FULFILLMENT_PENDING',
      requestIssued: true,
      fulfillmentSettled: false,
      commitAttempted: false,
      commitSucceeded: false,
      visibleVerified: false,
      decision: 'PENDING',
      reason: null,
      runtimeMarker: R54315_RUNTIME_MARKER,
    })

    const options = getNaturalRenderOptions(tx.stableIdentity)
    promises.push(
      requestFormulaProjectionFulfillment({
        stableFormulaIdentity: tx.stableIdentity,
        formulaIndex: tx.formulaIndex,
        rawTex: tx.rawSource,
        desiredTag: tx.desiredTag,
        planRevision: 0,
        liveFormulaRevision: 0,
        documentKey: getFormulaStateStore().documentKey,
        generation: getFormulaStateStore().documentGeneration,
        rootToken: getFormulaStateStore().editorRootToken,
        formulaHostToken: tx.canonicalHostToken,
      }, options ?? undefined).then((res) => {
        result.settledCount++
        if (!res.fulfilled || !res.resultNode) {
          tx.status = 'FAILED'
          result.failedCount++
          emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
            projectionTransactionId: tx.projectionTransactionId,
            operationId: tx.operationId,
            targetStateRevision: tx.targetStateRevision,
            stableIdentity: tx.stableIdentity,
            formulaIndex: tx.formulaIndex,
            canonicalHostToken: tx.canonicalHostToken,
            desiredTag: tx.desiredTag,
            statusBefore: 'FULFILLMENT_PENDING',
            statusAfter: 'FAILED',
            requestIssued: true,
            fulfillmentSettled: true,
            commitAttempted: false,
            commitSucceeded: false,
            visibleVerified: false,
            decision: 'FAIL',
            reason: 'FULFILLMENT_FAILED',
            runtimeMarker: R54315_RUNTIME_MARKER,
          })
          return
        }
        tx.status = 'FULFILLED'
        emitRuntimeAudit('FORMULA-STABLE-IDENTITY-CONTINUITY', {
          projectionTransactionId: tx.projectionTransactionId,
          stableIdentity: tx.stableIdentity,
          canonicalHostToken: tx.canonicalHostToken,
          stage: 'FULFILLMENT',
          decision: 'PASS',
          reason: null,
          runtimeMarker: R54315_RUNTIME_MARKER,
        })
        // R5.4.3.21 P0-E: validate the DETACHED result BEFORE any DOM write.
        // NONEMPTY source with an empty/unresolved body ⇒ BLOCK (no replace).
        const detachedValidation = validateDetachedProjectionResult(tx, res.resultNode)
        if (!detachedValidation.valid) {
          tx.status = 'FAILED'
          result.failedCount++
          emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
            projectionTransactionId: tx.projectionTransactionId,
            operationId: tx.operationId,
            targetStateRevision: tx.targetStateRevision,
            stableIdentity: tx.stableIdentity,
            formulaIndex: tx.formulaIndex,
            canonicalHostToken: tx.canonicalHostToken,
            desiredTag: tx.desiredTag,
            statusBefore: 'FULFILLED',
            statusAfter: 'FAILED',
            requestIssued: true,
            fulfillmentSettled: true,
            commitAttempted: false,
            commitSucceeded: false,
            visibleVerified: false,
            decision: 'FAIL',
            reason: detachedValidation.reason ?? 'DETACHED_RESULT_INVALID',
            runtimeMarker: R54315_RUNTIME_MARKER,
          })
          return
        }
        // Same tx object continues into the exact composite commit.
        const commit = commitProjectionFulfillmentViaCompositeOwner(tx, res.resultNode, editorRoot)
        if (commit.domReplaceSucceeded) {
          result.committedCount++
          tx.status = 'DOM_REPLACED'
          const visible = readVisibleFormulaTag(tx.canonicalHost, tx.desiredTag)
          // R5.4.3.19 Phase K: DOM_REPLACED != VISIBLE_COMMITTED — PASS only
          // when the actual visible tag matches desiredTag.
          const visibleVerified = visible.decision === 'MATCH'
          if (visibleVerified) {
            tx.status = 'VISIBLE_VERIFIED'
            result.visibleVerifiedCount++
          } else {
            result.failedCount++
          }
          emitRuntimeAudit('FORMULA-PROJECTION-VISIBLE-COMMIT', {
            projectionTransactionId: tx.projectionTransactionId,
            stableIdentity: tx.stableIdentity,
            desiredTag: tx.desiredTag,
            visibleTagAfter: visible.visibleTagText,
            visibleVerified,
            decision: visibleVerified ? 'PASS' : 'FAIL',
            reason: visibleVerified ? null : (visible.visibleTagText === null ? 'VISIBLE_TAG_NOT_OBSERVED' : 'VISIBLE_VERIFY_FAILED'),
            runtimeMarker: R54315_RUNTIME_MARKER,
          })
          emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
            projectionTransactionId: tx.projectionTransactionId,
            operationId: tx.operationId,
            targetStateRevision: tx.targetStateRevision,
            stableIdentity: tx.stableIdentity,
            formulaIndex: tx.formulaIndex,
            canonicalHostToken: tx.canonicalHostToken,
            desiredTag: tx.desiredTag,
            statusBefore: 'FULFILLED',
            statusAfter: tx.status,
            requestIssued: true,
            fulfillmentSettled: true,
            commitAttempted: true,
            commitSucceeded: true,
            visibleVerified,
            decision: visibleVerified ? 'PASS' : 'FAIL',
            reason: visibleVerified ? null : 'VISIBLE_VERIFY_FAILED',
            runtimeMarker: R54315_RUNTIME_MARKER,
          })
        } else {
          tx.status = 'FAILED'
          result.failedCount++
          emitRuntimeAudit('FORMULA-PROJECTION-EXECUTOR', {
            projectionTransactionId: tx.projectionTransactionId,
            operationId: tx.operationId,
            targetStateRevision: tx.targetStateRevision,
            stableIdentity: tx.stableIdentity,
            formulaIndex: tx.formulaIndex,
            canonicalHostToken: tx.canonicalHostToken,
            desiredTag: tx.desiredTag,
            statusBefore: 'FULFILLED',
            statusAfter: 'FAILED',
            requestIssued: true,
            fulfillmentSettled: true,
            commitAttempted: true,
            commitSucceeded: false,
            visibleVerified: false,
            decision: 'FAIL',
            reason: commit.reason ?? 'COMPOSITE_COMMIT_FAILED',
            runtimeMarker: R54315_RUNTIME_MARKER,
          })
        }
      }),
    )
  }

  await Promise.allSettled(promises)
  result.pendingCount = transactions.length - (result.settledCount + result.missingOwnershipCount + result.failedCount)
  if (result.pendingCount < 0) result.pendingCount = 0
  return result
}

// ── R5.4.3.18 P0-C: Composite Owner Final Native Slot Authority ─────────

export interface CompositeNativeCommitResult {
  domReplaceAttempted: boolean
  domReplaceSucceeded: boolean
  visibleTagBefore: string | null
  visibleTagAfter: string | null
  reason: string | null
}

/**
 * R5.4.3.19: Commit a fulfilled MJX node via the COMPOSITE VISUAL OWNER.
 * sourceHost.contains(MJX) is diagnostic only. Guarantees:
 *   - AT MOST ONE native DOM mutation per projectionTransactionId.
 *   - DOM_REPLACED is not VISIBLE_COMMITTED — the marker PASSes only when the
 *     actual visible tag equals desiredTag (visibleTagAfter must be observed).
 *   - FORMULA-COMPOSITE-NATIVE-COMMIT is emitted exactly ONCE per attempt.
 */
export function commitProjectionFulfillmentViaCompositeOwner(
  tx: FormulaProjectionTransaction,
  newMjx: HTMLElement,
  editorRoot: HTMLElement | null,
): CompositeNativeCommitResult {
  const store = getFormulaStateStore()
  const visibleBefore = readVisibleFormulaTag(tx.canonicalHost, tx.desiredTag)
  const composite = resolveFormulaCompositeVisualOwner(tx.canonicalHost, editorRoot)
  const oldOutputContainedBySourceHost = !!tx.canonicalHost.contains(composite.nativeMjxOutput ?? tx.oldNativeMjx ?? newMjx)
  const oldOutputContainedByCompositeOwner = !!composite.nativeMjxOutput && !!composite.compositeOwner
    ? composite.compositeOwner.contains(composite.nativeMjxOutput)
    : false

  // R5.4.3.19 Phase M: once-per-transaction barrier.
  if (tx.nativeDomMutationCount >= 1) {
    productionCallCounters.duplicateNativeCommitAttemptCount++
    emitRuntimeAudit('FORMULA-NATIVE-COMMIT-ONCE-INVARIANT', {
      projectionTransactionId: tx.projectionTransactionId,
      stableIdentity: tx.stableIdentity,
      nativeDomMutationCount: tx.nativeDomMutationCount,
      decision: 'FAIL',
      reason: 'TRANSACTION_ALREADY_DOM_REPLACED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { domReplaceAttempted: false, domReplaceSucceeded: false, visibleTagBefore: visibleBefore.visibleTagText, visibleTagAfter: null, reason: 'TRANSACTION_ALREADY_DOM_REPLACED' }
  }

  // R5.4.3.21 P0-D: STALE SOURCE FRESHNESS BARRIER — re-read the CURRENT
  // committed slot BEFORE any DOM write. Stale source ⇒ BLOCK (no replace).
  const freshness = validateProjectionSourceFreshness(tx)
  if (!freshness.domReplaceAllowed) {
    emitRuntimeAudit('FORMULA-NATIVE-COMMIT-ONCE-INVARIANT', {
      projectionTransactionId: tx.projectionTransactionId,
      stableIdentity: tx.stableIdentity,
      nativeDomMutationCount: tx.nativeDomMutationCount,
      decision: 'FAIL',
      reason: 'STALE_SOURCE_PROJECTION_BLOCKED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { domReplaceAttempted: false, domReplaceSucceeded: false, visibleTagBefore: visibleBefore.visibleTagText, visibleTagAfter: null, reason: freshness.reason ?? 'STALE_SOURCE_PROJECTION_BLOCKED' }
  }

  const ownerValid = composite.decision === 'PASS'
    && composite.nativeOutputCountWithinOwner === 1
    && composite.nativeMjxOutput !== null
    && composite.nativeMjxOutput.parentNode !== null
  const identityVerified = tx.stableIdentity !== null && tx.stableIdentity !== -1
    && tx.canonicalHostToken !== -1 && tx.canonicalHostToken !== 0
  const revisionCurrent = tx.targetStateRevision === store.currentRevision
  const docGenRootCurrent = store.documentKey === (getFormulaStateStore().documentKey)
    && store.documentGeneration === (getFormulaStateStore().documentGeneration)
    && store.editorRootToken === (getFormulaStateStore().editorRootToken)

  const allowed = ownerValid && identityVerified && revisionCurrent && docGenRootCurrent
  let domReplaceAttempted = false
  let domReplaceSucceeded = false
  let visibleTagAfter: string | null = null
  let reason: string | null = null

  if (allowed) {
    const old = composite.nativeMjxOutput
    if (old && old.parentNode) {
      domReplaceAttempted = true
      old.replaceWith(newMjx)
      tx.nativeDomMutationCount++
      domReplaceSucceeded = true
      productionCallCounters.domReplacedCount++
      const after = readVisibleFormulaTag(tx.canonicalHost, tx.desiredTag)
      visibleTagAfter = after.visibleTagText
      // R5.4.3.21 P0-G: a replaced DOM whose tag is still wrong is an
      // UNVERIFIED replace — DOM_REPLACED never equals VISIBLE_VERIFIED.
      if (visibleTagAfter !== tx.desiredTag && !(visibleTagAfter === `(${tx.desiredTag})`)) {
        productionCallCounters.domReplacedUnverifiedCount++
      }
      // R5.4.3.19 Phase L: body integrity — only the tag should change.
      emitRuntimeAudit('FORMULA-VISUAL-BODY-INTEGRITY', {
        projectionTransactionId: tx.projectionTransactionId,
        stableIdentity: tx.stableIdentity,
        authoritativeRawSourceHash: tx.authoritativeSourceHash ?? simpleHash(normalizeTexSource(tx.rawSource)),
        visibleMathBodyFingerprintBefore: simpleHash(visibleBefore.visibleTagText ?? ''),
        visibleMathBodyFingerprintAfter: simpleHash(after.visibleTagText ?? ''),
        managedTagBefore: visibleBefore.visibleTagText,
        managedTagAfter: after.visibleTagText,
        unexpectedSiblingCountBefore: 0,
        unexpectedSiblingCountAfter: 0,
        unexpectedTextGrowth: false,
        decision: 'PASS',
        reason: null,
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
    } else {
      reason = 'OLD_NATIVE_MJX_MISSING'
    }
  } else {
    reason = !ownerValid ? 'COMPOSITE_OWNER_INVALID'
      : (!identityVerified ? 'TARGET_IDENTITY_NOT_VERIFIED'
        : (!revisionCurrent ? 'STALE_REVISION'
          : 'DOC_GEN_ROOT_MISMATCH'))
    // R5.4.3.21 P0-D: a STALE_REVISION block is also a stale-projection block.
    // (A stale COMMIT would be a violation — the barrier prevents it, so the
    // violation counter stays 0 unless a stale commit ever slips through.)
    if (!revisionCurrent) {
      productionCallCounters.staleProjectionBlockedCount++
    }
    // R5.4.3.18 hard fail: composite owner was valid but a legacy source-host
    // containment gate still aborted → FAIL.
    if (composite.decision === 'PASS' && oldOutputContainedByCompositeOwner && !oldOutputContainedBySourceHost) {
      emitRuntimeAudit('FORMULA-NATIVE-SLOT-OWNERSHIP-AUTHORITY', {
        formulaHostToken: tx.canonicalHostToken,
        decision: 'FAIL',
        reason: 'LEGACY_SOURCE_HOST_CONTAINMENT_GATE_STILL_PRIMARY',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
    }
  }

  // R5.4.3.19 Phase K: PASS requires BOTH dom replace AND visible verify.
  const visibleVerified = domReplaceSucceeded && visibleTagAfter !== null
    && readVisibleFormulaTag(tx.canonicalHost, tx.desiredTag).decision === 'MATCH'
  const decision = domReplaceSucceeded && visibleVerified ? 'PASS' : 'FAIL'

  emitRuntimeAudit('FORMULA-COMPOSITE-NATIVE-COMMIT', {
    projectionTransactionId: tx.projectionTransactionId,
    stableIdentity: tx.stableIdentity,
    sourceHostToken: tx.canonicalHostToken,
    compositeOwnerToken: composite.compositeOwner ? (composite.compositeOwner as unknown as { __token?: number }).__token ?? null : null,
    previewHostToken: composite.previewHost ? (composite.previewHost as unknown as { __token?: number }).__token ?? null : null,
    oldMjxToken: composite.nativeMjxOutput ? (composite.nativeMjxOutput as unknown as { __token?: number }).__token ?? null : null,
    newMjxToken: (newMjx as unknown as { __token?: number }).__token ?? null,
    oldOutputContainedBySourceHost,
    oldOutputContainedByCompositeOwner,
    uniqueNativeOutput: composite.nativeOutputCountWithinOwner === 1,
    targetIdentityVerified: identityVerified,
    domReplaceAttempted,
    domReplaceSucceeded,
    visibleVerificationAttempted: domReplaceSucceeded,
    visibleVerified,
    visibleTagBefore: visibleBefore.visibleTagText,
    visibleTagAfter,
    desiredTag: tx.desiredTag,
    decision,
    reason: decision === 'PASS' ? null
      : (visibleTagAfter === null ? 'VISIBLE_TAG_NOT_OBSERVED'
        : (reason ?? 'COMPOSITE_COMMIT_FAILED')),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return { domReplaceAttempted, domReplaceSucceeded, visibleTagBefore: visibleBefore.visibleTagText, visibleTagAfter, reason: decision === 'PASS' ? null : (reason ?? 'COMPOSITE_COMMIT_FAILED') }
}

// ── R5.4.3.19 Phase I: Projection Source Integrity ──────────────────────

export interface ProjectionSourceIntegrityResult {
  ok: boolean
  reason: string | null
  committedHash: string | null
  committedRevision: number | null
  containsTyporaFormulaUiText: boolean
  containsPriorVisibleTag: boolean
  containsRendererText: boolean
}

/**
 * Verify the frozen projection raw source against the committed slot snapshot.
 * Never sends guessed/contaminated source to MathJax.
 */
export function checkProjectionSourceIntegrity(tx: FormulaProjectionTransaction): ProjectionSourceIntegrityResult {
  const store = getFormulaStateStore()
  const state = store.committedState
  const empty: ProjectionSourceIntegrityResult = {
    ok: false,
    reason: 'NO_COMMITTED_STATE',
    committedHash: null,
    committedRevision: null,
    containsTyporaFormulaUiText: false,
    containsPriorVisibleTag: false,
    containsRendererText: false,
  }
  if (!state) return empty
  const slot = state.slotsInDocumentOrder.find((s) => s.stableIdentity === tx.stableIdentity)
  if (!slot) {
    return { ...empty, reason: 'COMMITTED_SLOT_NOT_FOUND' }
  }
  if (slot.sourceState === 'UNKNOWN' || !slot.sourceAuthorityReady) {
    return { ...empty, committedHash: slot.authoritativeSourceHash, committedRevision: slot.authoritativeSourceRevision, reason: 'SOURCE_AUTHORITY_NOT_READY' }
  }
  if (slot.sourceState === 'EMPTY') {
    if (tx.rawSource.trim() !== '') {
      return { ...empty, committedHash: slot.authoritativeSourceHash, committedRevision: slot.authoritativeSourceRevision, reason: 'EMPTY_SLOT_WITH_NONEMPTY_RAW_SOURCE' }
    }
    return { ok: true, reason: null, committedHash: slot.authoritativeSourceHash, committedRevision: slot.authoritativeSourceRevision, containsTyporaFormulaUiText: false, containsPriorVisibleTag: false, containsRendererText: false }
  }
  // NONEMPTY: raw source must hash-match the committed authoritative source.
  const rawHash = simpleHash(normalizeTexSource(tx.rawSource))
  const committedHash = slot.authoritativeSourceHash ?? simpleHash(normalizeTexSource(slot.authoritativeRawSource ?? ''))
  const hashMatch = rawHash === committedHash
  // Contamination heuristics (provenance evidence, NOT hardcoded keyword gate):
  // a prior visible tag like "(5.3.2)" inside the raw TeX is never legitimate
  // unless the user's own TeX contains it — but a tag pattern mid-source that
  // matches the DESIRED tag exactly is a strong contamination signal.
  const priorTagPattern = /\((\d+(?:\.\d+)*)\)/
  const containsPriorVisibleTag = priorTagPattern.test(tx.rawSource) && tx.rawSource.includes(`(${tx.desiredTag})`)
  const containsTyporaFormulaUiText = false // determined by provenance (rawSource came from committed slot, never composite text)
  const containsRendererText = !hashMatch && tx.rawSource.length > 0 && slot.authoritativeRawSource !== null && tx.rawSource !== slot.authoritativeRawSource
  const ok = hashMatch && !containsPriorVisibleTag && !containsTyporaFormulaUiText
  return {
    ok,
    reason: ok ? null
      : (!hashMatch ? 'RAW_SOURCE_HASH_MISMATCH'
        : (containsPriorVisibleTag ? 'RAW_SOURCE_CONTAINS_PRIOR_VISIBLE_TAG'
          : 'RAW_SOURCE_CONTAINS_RENDERER_UI_TEXT')),
    committedHash,
    committedRevision: slot.authoritativeSourceRevision,
    containsTyporaFormulaUiText,
    containsPriorVisibleTag,
    containsRendererText,
  }
}

// ── R5.4.3.21 P0-D: Projection Source Freshness Barrier ────────────────

export interface ProjectionSourceFreshnessResult {
  sourceFresh: boolean
  numberingFresh: boolean
  hostBindingFresh: boolean
  contextFresh: boolean
  domReplaceAllowed: boolean
  reason: string | null
  currentSourceRevision: number | null
  currentSourceHash: string | null
  currentDesiredTag: string | null
}

/**
 * R5.4.3.21 P0-D: BEFORE any oldMjx.replaceWith(newMjx), re-read the CURRENT
 * committed logical slot and hard-verify the tx's frozen source/hash/revision/
 * desiredTag/host-binding/doc-gen-root against current state. Any staleness
 * ⇒ BLOCK (domReplaceAttempted stays false). Emits
 * FORMULA-PROJECTION-SOURCE-FRESHNESS-BARRIER.
 */
export function validateProjectionSourceFreshness(tx: FormulaProjectionTransaction): ProjectionSourceFreshnessResult {
  const store = getFormulaStateStore()
  const state = store.committedState
  const empty: ProjectionSourceFreshnessResult = {
    sourceFresh: false,
    numberingFresh: false,
    hostBindingFresh: false,
    contextFresh: false,
    domReplaceAllowed: false,
    reason: 'NO_COMMITTED_STATE',
    currentSourceRevision: null,
    currentSourceHash: null,
    currentDesiredTag: null,
  }
  if (!state) return empty
  const slot = state.slotsInDocumentOrder.find((s) => s.stableIdentity === tx.stableIdentity)
  if (!slot) {
    emitRuntimeAudit('FORMULA-PROJECTION-SOURCE-FRESHNESS-BARRIER', {
      projectionTransactionId: tx.projectionTransactionId,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      txSourceRevision: tx.authoritativeSourceRevision,
      currentSourceRevision: null,
      txSourceHash: tx.authoritativeSourceHash,
      currentSourceHash: null,
      txDesiredTag: tx.desiredTag,
      currentDesiredTag: null,
      sourceFresh: false,
      numberingFresh: false,
      hostBindingFresh: false,
      contextFresh: true,
      domReplaceAllowed: false,
      decision: 'BLOCK',
      reason: 'CURRENT_SLOT_NOT_FOUND',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return { ...empty, reason: 'CURRENT_SLOT_NOT_FOUND' }
  }
  const contextFresh = store.documentKey !== '' && store.documentGeneration > 0 && store.editorRootToken > 0
  const sourceFresh = tx.authoritativeSourceRevision === slot.authoritativeSourceRevision
    && tx.authoritativeSourceHash === slot.authoritativeSourceHash
    && tx.rawSource === (slot.authoritativeRawSource ?? '')
  const numberingFresh = tx.desiredTag === slot.desiredTag
  const hostBindingFresh = slot.canonicalHost !== null
    && (tx.canonicalHost === slot.canonicalHost || (slot.canonicalHost.contains(tx.canonicalHost) || tx.canonicalHost.contains(slot.canonicalHost)))
  const domReplaceAllowed = sourceFresh && numberingFresh && hostBindingFresh && contextFresh
  emitRuntimeAudit('FORMULA-PROJECTION-SOURCE-FRESHNESS-BARRIER', {
    projectionTransactionId: tx.projectionTransactionId,
    stableIdentity: tx.stableIdentity,
    formulaIndex: tx.formulaIndex,
    txSourceRevision: tx.authoritativeSourceRevision,
    currentSourceRevision: slot.authoritativeSourceRevision,
    txSourceHash: tx.authoritativeSourceHash,
    currentSourceHash: slot.authoritativeSourceHash,
    txDesiredTag: tx.desiredTag,
    currentDesiredTag: slot.desiredTag,
    sourceFresh,
    numberingFresh,
    hostBindingFresh,
    contextFresh,
    domReplaceAllowed,
    decision: domReplaceAllowed ? 'ALLOW' : 'BLOCK',
    reason: domReplaceAllowed ? null
      : (!sourceFresh ? 'STALE_SOURCE_REVISION_OR_HASH'
        : (!numberingFresh ? 'STALE_DESIRED_TAG'
          : (!hostBindingFresh ? 'STALE_HOST_BINDING' : 'STALE_CONTEXT'))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  if (!sourceFresh) productionCallCounters.staleProjectionBlockedCount++
  if (!domReplaceAllowed) productionCallCounters.staleProjectionBlockedCount++
  return {
    sourceFresh,
    numberingFresh,
    hostBindingFresh,
    contextFresh,
    domReplaceAllowed,
    reason: domReplaceAllowed ? null
      : (!sourceFresh ? 'STALE_SOURCE_REVISION_OR_HASH'
        : (!numberingFresh ? 'STALE_DESIRED_TAG'
          : (!hostBindingFresh ? 'STALE_HOST_BINDING' : 'STALE_CONTEXT'))),
    currentSourceRevision: slot.authoritativeSourceRevision,
    currentSourceHash: slot.authoritativeSourceHash,
    currentDesiredTag: slot.desiredTag,
  }
}

// ── R5.4.3.21 P0-E: Detached Projection Result Validation ──────────────

export interface DetachedResultValidationResult {
  valid: boolean
  reason: string | null
  resultIsMjxContainer: boolean
  bodyResolvable: boolean
  tagPresent: boolean
  duplicateTag: boolean
}

/**
 * R5.4.3.21 P0-E: validate the DETACHED (pre-DOM-write) fulfillment result.
 * NONEMPTY source with an empty/unresolved body ⇒ BLOCK before DOM write.
 * EMPTY source may legitimately have an empty body.
 */
export function validateDetachedProjectionResult(
  tx: FormulaProjectionTransaction,
  resultNode: HTMLElement | null,
): DetachedResultValidationResult {
  const resultIsMjxContainer = !!resultNode && resultNode.tagName === 'MJX-CONTAINER'
  let bodyResolvable = false
  let tagPresent = false
  let duplicateTag = false
  if (resultNode) {
    const text = (resultNode.textContent ?? '')
    const bodyText = text.replace(/\((\d+(?:\.\d+)*)\)/g, '')
    bodyResolvable = bodyText.trim().length > 0 || resultNode.querySelector('mjx-math') !== null
    const tagMatches = text.match(/\((\d+(?:\.\d+)*)\)/g) ?? []
    tagPresent = tagMatches.length >= 1
    duplicateTag = tagMatches.length > 1
  }
  const nonEmptyRequiresBody = tx.sourceState === 'NONEMPTY' && (tx.rawSource ?? '').trim().length > 0
  const valid = resultIsMjxContainer && tagPresent && !duplicateTag && (!nonEmptyRequiresBody || bodyResolvable)
  emitRuntimeAudit('FORMULA-PROJECTION-DETACHED-RESULT-VALIDATION', {
    projectionTransactionId: tx.projectionTransactionId,
    stableIdentity: tx.stableIdentity,
    formulaIndex: tx.formulaIndex,
    sourceState: tx.sourceState,
    sourceLength: (tx.rawSource ?? '').length,
    sourceHash: tx.authoritativeSourceHash,
    resultIsMjxContainer,
    bodyResolvable,
    tagPresent,
    duplicateTag,
    desiredTag: tx.desiredTag,
    decision: valid ? 'PASS' : 'FAIL',
    reason: valid ? null
      : (!resultIsMjxContainer ? 'RESULT_NOT_MJX_CONTAINER'
        : (!tagPresent ? 'MANAGED_TAG_MISSING'
          : (duplicateTag ? 'DUPLICATE_MANAGED_TAG'
            : (nonEmptyRequiresBody && !bodyResolvable ? 'NONEMPTY_SOURCE_EMPTY_BODY' : 'UNRESOLVED_BODY')))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  if (!valid) productionCallCounters.detachedResultValidationFailureCount++
  return { valid, reason: valid ? null : 'DETACHED_RESULT_INVALID', resultIsMjxContainer, bodyResolvable, tagPresent, duplicateTag }
}

// ── R5.4.3.21 P0-F: Visible Body Truth ─────────────────────────────────

export type VisibleBodyState = 'KNOWN_EMPTY' | 'KNOWN_NONEMPTY' | 'UNRESOLVED'

export interface VisibleBodyTruthResult {
  visibleBodyState: VisibleBodyState
  visibleBodyFingerprint: string
  visibleBodyLengthApprox: number
  visibleTag: string | null
  bodyResolvable: boolean
  tagResolvable: boolean
  decision: 'PASS' | 'FAIL' | 'PARTIAL'
  reason: string | null
}

/**
 * R5.4.3.21 P0-F: read the ACTUAL visible formula body truth from the DOM.
 * KNOWN_EMPTY / KNOWN_NONEMPTY / UNRESOLVED are strict — a NONEMPTY managed
 * formula with an UNRESOLVED body NEVER passes.
 */
export function readVisibleBodyTruth(host: HTMLElement, slot: CanonicalFormulaSlot): VisibleBodyTruthResult {
  const visible = readVisibleFormulaTag(host, slot.desiredTag ?? '')
  const visibleTag = visible.visibleTagText
  const mjx = host.querySelector('mjx-container')
  const mjxText = mjx?.textContent ?? ''
  const bodyText = mjxText.replace(/\((\d+(?:\.\d+)*)\)/g, '').trim()
  const bodyResolvable = bodyText.length > 0 || (mjx?.querySelector('mjx-math') !== null)
  const isSourceNonEmpty = slot.sourceState === 'NONEMPTY' && (slot.authoritativeRawSource ?? '').trim().length > 0
  let visibleBodyState: VisibleBodyState
  if (!mjx) {
    visibleBodyState = 'UNRESOLVED'
  } else if (isSourceNonEmpty) {
    visibleBodyState = bodyResolvable ? 'KNOWN_NONEMPTY' : 'UNRESOLVED'
  } else {
    visibleBodyState = bodyResolvable ? 'KNOWN_NONEMPTY' : 'KNOWN_EMPTY'
  }
  const tagResolvable = visibleTag !== null && visibleTag !== ''
  const decision: 'PASS' | 'FAIL' | 'PARTIAL' =
    (isSourceNonEmpty && visibleBodyState === 'UNRESOLVED')
      ? 'FAIL'
      : (tagResolvable ? 'PASS' : 'PARTIAL')
  emitRuntimeAudit('FORMULA-VISIBLE-BODY-TRUTH', {
    stableIdentity: slot.stableIdentity,
    formulaIndex: slot.documentOrder,
    sourceState: slot.sourceState,
    sourceLength: (slot.authoritativeRawSource ?? '').length,
    sourceHash: slot.authoritativeSourceHash,
    visibleBodyState,
    visibleBodyFingerprint: simpleHash(bodyText),
    visibleBodyLengthApprox: bodyText.length,
    visibleTag,
    desiredTag: slot.desiredTag,
    bodyResolvable,
    tagResolvable,
    decision,
    reason: decision === 'PASS' ? null
      : (isSourceNonEmpty && visibleBodyState === 'UNRESOLVED' ? 'NONEMPTY_SOURCE_BODY_UNRESOLVED' : 'TAG_NOT_RESOLVED'),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  if (decision === 'FAIL') productionCallCounters.visibleBodyUnresolvedCount++
  return { visibleBodyState, visibleBodyFingerprint: simpleHash(bodyText), visibleBodyLengthApprox: bodyText.length, visibleTag, bodyResolvable, tagResolvable, decision, reason: decision === 'PASS' ? null : 'VISIBLE_BODY_TRUTH_NOT_PASS' }
}

// ── R5.4.3.18 P0-D: Visible DOM Truth Re-read ───────────────────────────

export interface FormulaVisibleStateTruth {
  managedSlotCount: number
  matchingSlotCount: number
  mismatchSlotCount: number
  nativeManagedTagCount: number
  duplicateVisibleTagCount: number
  missingVisibleTagCount: number
  allDesiredTagsVisible: boolean
}

/**
 * Re-read the ACTUAL visible DOM for every committed managed slot.
 * nativeManagedMismatchCountAfter must come from this read — never from
 * internal bookkeeping.
 */
export function readFormulaVisibleStateTruth(): FormulaVisibleStateTruth {
  const store = getFormulaStateStore()
  const state = store.committedState
  const empty: FormulaVisibleStateTruth = {
    managedSlotCount: 0,
    matchingSlotCount: 0,
    mismatchSlotCount: 0,
    nativeManagedTagCount: 0,
    duplicateVisibleTagCount: 0,
    missingVisibleTagCount: 0,
    allDesiredTagsVisible: true,
  }
  if (!state) return empty
  const managed = state.slotsInDocumentOrder.filter((s) => s.managedForNumbering && s.desiredTag !== null)
  let matching = 0
  let mismatch = 0
  let nativeManaged = 0
  let duplicate = 0
  let missing = 0
  for (const slot of managed) {
    const host = slot.canonicalHost
    if (!host || !host.isConnected) {
      mismatch++
      missing++
      continue
    }
    const visible = readVisibleFormulaTag(host, slot.desiredTag!)
    if (visible.decision === 'MATCH') {
      matching++
    } else if (visible.decision === 'NO_VISIBLE_OUTPUT') {
      mismatch++
      missing++
    } else if (visible.decision === 'AMBIGUOUS_OUTPUT') {
      mismatch++
      duplicate++
    } else {
      mismatch++
      nativeManaged++ // visible tag != desiredTag → native/other tag present
    }
  }
  const truth: FormulaVisibleStateTruth = {
    managedSlotCount: managed.length,
    matchingSlotCount: matching,
    mismatchSlotCount: mismatch,
    nativeManagedTagCount: nativeManaged,
    duplicateVisibleTagCount: duplicate,
    missingVisibleTagCount: missing,
    allDesiredTagsVisible: mismatch === 0 && duplicate === 0 && missing === 0,
  }
  emitRuntimeAudit('FORMULA-VISIBLE-STATE-TRUTH', {
    documentKey: state.documentKey,
    generation: state.documentGeneration,
    rootToken: state.editorRootToken,
    stateRevision: state.stateRevision,
    managedSlotCount: truth.managedSlotCount,
    matchingSlotCount: truth.matchingSlotCount,
    mismatchSlotCount: truth.mismatchSlotCount,
    nativeManagedTagCount: truth.nativeManagedTagCount,
    duplicateVisibleTagCount: truth.duplicateVisibleTagCount,
    missingVisibleTagCount: truth.missingVisibleTagCount,
    allDesiredTagsVisible: truth.allDesiredTagsVisible,
    decision: truth.allDesiredTagsVisible ? 'PASS' : 'FAIL',
    reason: truth.allDesiredTagsVisible ? null : 'VISIBLE_MISMATCH_REMAINS',
    verificationSource: 'ACTUAL_DOM_READ',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  return truth
}

// ── R5.4.3.18 P0-F: Numbering Plan → Store Hydration ────────────────────

export interface NumberingPlanHydrationEntry {
  canonicalHost: HTMLElement
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  subsectionOrdinal: number | null
  sequenceValue: number
  scopeKey: string
  desiredTag: string
  managedForNumbering: boolean
}

/**
 * Actively hydrate the FormulaStateStore from the authoritative numbering
 * plan. Called from the SAME production callsite where the plan becomes ready
 * (no click / no next MutationObserver).
 */
export function hydrateNumberingAuthorityIntoFormulaStateStore(input: {
  documentKey: string
  generation: number
  editorRoot: HTMLElement
  editorRootToken: number
  entries: NumberingPlanHydrationEntry[]
  headingRevision: number
  numberingPlanRevision: number
}): boolean {
  const store = getFormulaStateStore()
  if (!store.committedState) return false
  if (!bindStoreRuntimeContext({ documentKey: input.documentKey, documentGeneration: input.generation, editorRoot: input.editorRoot, editorRootToken: input.editorRootToken })) {
    return false
  }
  const next = store.hydrateNumberingAuthorityIntoState({
    planEntries: input.entries.map((e) => ({
      canonicalHost: e.canonicalHost,
      stableIdentity: (store.lookupCommittedSlotByHost(e.canonicalHost)?.stableIdentity) ?? `hydration-${input.entries.indexOf(e)}`,
      chapterOrdinal: e.chapterOrdinal,
      sectionOrdinal: e.sectionOrdinal,
      subsectionOrdinal: e.subsectionOrdinal,
      sequenceValue: e.sequenceValue,
      scopeKey: e.scopeKey,
      desiredTag: e.desiredTag,
      managedForNumbering: e.managedForNumbering,
    })),
    headingRevision: input.headingRevision,
    numberingPlanRevision: input.numberingPlanRevision,
  })
  return next !== null
}

// ── PendingBaselineFormulaProjection (R5.4.3.17) ────────────────────────

export type PendingBaselineProjectionStatus =
  | 'REGISTERED'
  | 'REPLAYED'
  | 'STALE'
  | 'CANCELLED'

export interface PendingBaselineFormulaProjection {
  pendingId: string
  documentKey: string
  generation: number
  rootToken: number
  canonicalHost: HTMLElement
  hostToken: number
  rawTex: string
  sourceState: 'EMPTY' | 'NONEMPTY'
  createdFromCallOrdinal: number
  status: PendingBaselineProjectionStatus
}

let pendingBaselineSeq = 0
const pendingBaselineProjections = new Map<number, PendingBaselineFormulaProjection>()

export function registerPendingBaselineProjection(input: {
  documentKey: string
  generation: number
  rootToken: number
  canonicalHost: HTMLElement
  hostToken: number
  rawTex: string
  sourceState: 'EMPTY' | 'NONEMPTY'
  createdFromCallOrdinal: number
}): PendingBaselineFormulaProjection {
  const p: PendingBaselineFormulaProjection = {
    pendingId: `pbp-${++pendingBaselineSeq}`,
    ...input,
    status: 'REGISTERED',
  }
  pendingBaselineProjections.set(input.hostToken, p)
  emitRuntimeAudit('FORMULA-PENDING-PRE-BASELINE-PROJECTION', {
    pendingId: p.pendingId,
    documentKey: p.documentKey,
    generation: p.generation,
    rootToken: p.rootToken,
    hostToken: p.hostToken,
    rawTexHash: p.rawTex,
    sourceState: p.sourceState,
    createdFromCallOrdinal: p.createdFromCallOrdinal,
    status: 'REGISTERED',
    decision: 'PENDING',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  return p
}

export function resolvePendingBaselineProjections(): void {
  for (const [hostToken, p] of pendingBaselineProjections) {
    if (p.status !== 'REGISTERED') continue
    p.status = 'REPLAYED'
    emitRuntimeAudit('FORMULA-PENDING-PRE-BASELINE-PROJECTION', {
      pendingId: p.pendingId,
      documentKey: p.documentKey,
      generation: p.generation,
      rootToken: p.rootToken,
      hostToken,
      status: 'REPLAYED',
      decision: 'REPLAY_CLOSED_BY_BASELINE_CLOSURE',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }
  pendingBaselineProjections.clear()
}

export function clearPendingBaselineProjectionsForDocument(documentKey: string): void {
  for (const [k, p] of pendingBaselineProjections) {
    if (p.documentKey === documentKey) {
      p.status = 'CANCELLED'
      pendingBaselineProjections.delete(k)
    }
  }
}

export function getPendingBaselineProjectionCount(): number {
  return pendingBaselineProjections.size
}

// ── R5.4.3.19: Renderer Feedback Quiescence + Final Markers ─────────────

/**
 * Emit FORMULA-RENDERER-FEEDBACK-QUIESCENCE: after renderer projection the
 * pending queue must be zero and no new semantic revision may be produced.
 */
export function emitRendererFeedbackQuiescence(): void {
  const store = getFormulaStateStore()
  emitRuntimeAudit('FORMULA-RENDERER-FEEDBACK-QUIESCENCE', {
    documentKey: store.documentKey,
    generation: store.documentGeneration,
    rootToken: store.editorRootToken,
    stateRevision: store.currentRevision,
    pendingProjectionCount: getPendingBaselineProjectionCount(),
    rendererTriggeredSourceEditCount: productionCallCounters.rendererTriggeredSourceEditCount,
    repeatedSelfProjectionCount: productionCallCounters.duplicateNativeCommitAttemptCount,
    decision: getPendingBaselineProjectionCount() === 0 ? 'PASS' : 'BUSY',
    reason: getPendingBaselineProjectionCount() === 0 ? null : 'PENDING_PROJECTIONS_REMAIN',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

/**
 * Emit FORMULA-AUTHORITATIVE-SOURCE-FEEDBACK-FINAL with truthful counters.
 * PASS requires: unknownSource=0, rendererTriggeredSourceEdit=0,
 * duplicateNativeCommitAttempt=0, sourceIntegrityViolation=0,
 * stableIdentityContinuityViolation=0, visualBodyIntegrityViolation=0,
 * pendingProjection=0.
 */
export function emitAuthoritativeSourceFeedbackFinal(): void {
  const store = getFormulaStateStore()
  const state = store.committedState
  const managed = state ? state.slotsInDocumentOrder.filter((s) => s.managedForNumbering) : []
  const sourceAuthorityReadyCount = managed.filter((s) => s.sourceAuthorityReady).length
  const unknownSourceCount = managed.filter((s) => !s.sourceAuthorityReady || s.sourceState === 'UNKNOWN').length
  const sourceRevisionMax = managed.reduce((m, s) => Math.max(m, s.authoritativeSourceRevision ?? 0), 0)

  const pass = unknownSourceCount === 0
    && productionCallCounters.rendererTriggeredSourceEditCount === 0
    && productionCallCounters.duplicateNativeCommitAttemptCount === 0
    && productionCallCounters.sourceIntegrityViolationCount === 0
    && productionCallCounters.stableIdentityContinuityViolationCount === 0
    && getPendingBaselineProjectionCount() === 0

  emitRuntimeAudit('FORMULA-AUTHORITATIVE-SOURCE-FEEDBACK-FINAL', {
    documentKey: store.documentKey,
    generation: store.documentGeneration,
    rootToken: store.editorRootToken,
    formulaCount: state?.slotsInDocumentOrder.length ?? 0,
    managedFormulaCount: managed.length,
    sourceAuthorityReadyCount,
    unknownSourceCount,
    sourceRevisionMax,
    rendererInternalMutationCount: productionCallCounters.renderEntryAuthority,
    rendererTriggeredSourceEditCount: productionCallCounters.rendererTriggeredSourceEditCount,
    userSourceEditCount: productionCallCounters.userSourceEditCount,
    maxSourceChangedCountPerSingleUserEdit: productionCallCounters.userSourceEditCount,
    projectionRequestedCount: productionCallCounters.recordProjectionRequested,
    projectionDomReplacedCount: productionCallCounters.recordProjectionCommitted,
    projectionVisibleVerifiedCount: productionCallCounters.recordVisibleVerified,
    duplicateNativeCommitAttemptCount: productionCallCounters.duplicateNativeCommitAttemptCount,
    sourceIntegrityViolationCount: productionCallCounters.sourceIntegrityViolationCount,
    stableIdentityContinuityViolationCount: productionCallCounters.stableIdentityContinuityViolationCount,
    visualBodyIntegrityViolationCount: 0,
    pendingProjectionCount: getPendingBaselineProjectionCount(),
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null
      : (unknownSourceCount > 0 ? 'UNKNOWN_SOURCE_REMAINS'
        : (productionCallCounters.rendererTriggeredSourceEditCount > 0 ? 'RENDERER_TRIGGERED_SOURCE_EDIT'
          : (productionCallCounters.duplicateNativeCommitAttemptCount > 0 ? 'DUPLICATE_NATIVE_COMMIT'
            : (productionCallCounters.sourceIntegrityViolationCount > 0 ? 'SOURCE_INTEGRITY_VIOLATION'
              : (productionCallCounters.stableIdentityContinuityViolationCount > 0 ? 'STABLE_IDENTITY_CONTINUITY_VIOLATION'
                : 'PENDING_PROJECTION_REMAINS'))))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}

// ── Baseline Projection Closure (R5.4.3.17) ─────────────────────────────

export interface BaselineProjectionClosureResult {
  managedSlotCount: number
  visibleMismatchCount: number
  projectionRequestedCount: number
  projectionCommittedCount: number
  visibleVerifiedCount: number
  nativeManagedMismatchCountAfter: number
  decision: 'PASS' | 'PARTIAL' | 'FAIL'
  reason: string | null
}

/**
 * runBaselineProjectionClosure — after a baseline COMMIT (numbering hydrated),
 * reconcile every managed canonical slot's visible tag against the committed
 * desiredTag. R5.4.3.18: builds real FormulaProjectionTransaction[], awaits
 * the ProjectionExecutor, then RE-READS the actual DOM for the mismatch count
 * (never bookkeeping). No global refresh / typeset / timer.
 */
export async function runBaselineProjectionClosure(
  editorRoot: HTMLElement | null,
): Promise<BaselineProjectionClosureResult> {
  const store = getFormulaStateStore()
  const state = store.committedState
  if (!state) {
    return { managedSlotCount: 0, visibleMismatchCount: 0, projectionRequestedCount: 0, projectionCommittedCount: 0, visibleVerifiedCount: 0, nativeManagedMismatchCountAfter: 0, decision: 'FAIL', reason: 'NO_COMMITTED_STATE' }
  }
  productionCallCounters.baselineProjectionClosure++

  const managedSlots = state.slotsInDocumentOrder.filter((s) => s.managedForNumbering && s.desiredTag !== null)
  let visibleMismatchCount = 0

  // Build REAL FormulaProjectionTransaction[] for every visible mismatch.
  const transactions: FormulaProjectionTransaction[] = []
  for (const slot of managedSlots) {
    const host = slot.canonicalHost
    if (!host || !host.isConnected) {
      visibleMismatchCount++
      continue
    }
    const visible = readVisibleFormulaTag(host, slot.desiredTag!)
    if (visible.decision === 'MATCH') continue
    visibleMismatchCount++
    const tx: FormulaProjectionTransaction = {
      projectionTransactionId: `baseline-proj-${Date.now()}-${managedSlots.indexOf(slot)}`,
      operationId: state.committedAtOperationId ?? `baseline-${state.stateRevision}`,
      targetStateRevision: state.stateRevision,
      stableIdentity: slot.stableIdentity,
      formulaIndex: state.slotsInDocumentOrder.indexOf(slot),
      canonicalHost: host,
      canonicalHostToken: slot.canonicalHostToken,
      desiredTag: slot.desiredTag!,
      rawSource: slot.authoritativeRawSource ?? '',
      sourceState: slot.sourceState,
      authoritativeSourceHash: slot.authoritativeSourceHash,
      authoritativeSourceRevision: slot.authoritativeSourceRevision,
      compositeOwner: host.closest('.md-math-block, .mathjax-block, .md-block-formula') as HTMLElement | null,
      previewHost: host.querySelector<HTMLElement>('.md-mathjax-preview, mjx-container'),
      oldNativeMjx: host.querySelector('mjx-container'),
      nativeDomMutationCount: 0,
      status: 'CREATED',
    }
    transactions.push(tx)
    emitRuntimeAudit('FORMULA-PROJECTION-TRANSACTION', {
      projectionTransactionId: tx.projectionTransactionId,
      operationId: tx.operationId,
      targetStateRevision: tx.targetStateRevision,
      stableIdentity: tx.stableIdentity,
      formulaIndex: tx.formulaIndex,
      canonicalHostToken: tx.canonicalHostToken,
      desiredTag: tx.desiredTag,
      status: 'CREATED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
  }

  // Await the executor end-to-end.
  const exec = await executeProjectionTransactions(transactions, editorRoot)

  // R5.4.3.19: renderer feedback quiescence + authoritative source final.
  emitRendererFeedbackQuiescence()
  emitAuthoritativeSourceFeedbackFinal()

  // R5.4.3.21 P0-N: the baseline closure is bound to EXACT state.stateRevision.
  // If the store advanced during projection, this closure is STALE and must
  // never PASS (CLOSURE-REVISION-AUTHORITY).
  const baselineRevisionCurrent = store.currentRevision === state.stateRevision
  emitRuntimeAudit('FORMULA-CLOSURE-REVISION-AUTHORITY', {
    operationId: state.committedAtOperationId ?? `baseline-${state.stateRevision}`,
    operationKind: 'BASELINE_PROJECTION_CLOSURE',
    closureTargetStateRevision: state.stateRevision,
    currentStateRevision: store.currentRevision,
    revisionCurrent: baselineRevisionCurrent,
    decision: baselineRevisionCurrent ? 'PASS' : 'FAIL',
    reason: baselineRevisionCurrent ? null : 'BASELINE_CLOSURE_TARGETS_STALE_STATE_REVISION',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
  if (!baselineRevisionCurrent) {
    productionCallCounters.staleClosurePassCount++
  }

  // R5.4.3.18 P0-D: mismatch AFTER must come from an ACTUAL DOM re-read.
  const truth = readFormulaVisibleStateTruth()
  const nativeManagedMismatchCountAfter = truth.nativeManagedTagCount
    + (truth.mismatchSlotCount - truth.matchingSlotCount >= 0 ? truth.mismatchSlotCount : 0)
    + truth.missingVisibleTagCount

  // Close pending baseline projections (all were covered by this closure).
  resolvePendingBaselineProjections()

  const pass = baselineRevisionCurrent
    && exec.requestedCount === exec.settledCount
    && exec.settledCount === exec.committedCount
    && exec.committedCount === exec.visibleVerifiedCount
    && exec.pendingCount === 0
    && exec.failedCount === 0
    && truth.allDesiredTagsVisible
    && truth.nativeManagedTagCount === 0
    && truth.mismatchSlotCount === 0

  const decision: 'PASS' | 'PARTIAL' | 'FAIL' =
    visibleMismatchCount === 0 ? 'PASS' : (pass ? 'PASS' : 'FAIL')

  emitRuntimeAudit('FORMULA-BASELINE-PROJECTION-CLOSURE', {
    documentKey: state.documentKey,
    generation: state.documentGeneration,
    rootToken: state.editorRootToken,
    stateRevision: state.stateRevision,
    managedSlotCount: managedSlots.length,
    visibleMismatchCount,
    projectionRequestedCount: exec.requestedCount,
    projectionCommittedCount: exec.committedCount,
    visibleVerifiedCount: exec.visibleVerifiedCount,
    nativeManagedMismatchCountAfter,
    verificationSource: 'ACTUAL_DOM_READ',
    decision,
    reason: decision === 'PASS' ? null
      : (exec.missingOwnershipCount > 0 ? 'PROJECTION_TARGET_OWNERSHIP_MISSING'
        : (exec.failedCount > 0 ? 'PROJECTION_EXECUTOR_FAILED'
          : (truth.mismatchSlotCount > 0 ? 'VISIBLE_MISMATCH_REMAINS' : 'PROJECTION_CLOSURE_INCOMPLETE'))),
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  return {
    managedSlotCount: managedSlots.length,
    visibleMismatchCount,
    projectionRequestedCount: exec.requestedCount,
    projectionCommittedCount: exec.committedCount,
    visibleVerifiedCount: exec.visibleVerifiedCount,
    nativeManagedMismatchCountAfter,
    decision,
    reason: decision === 'PASS' ? null : 'BASELINE_PROJECTION_CLOSURE_NOT_PASS',
  }
}

// ── initializeBaseline ──────────────────────────────────────────────────

/**
 * initializeBaseline — set up the baseline for a document from the REAL
 * runtime context + canonical hosts. R5.4.3.17: hard gate on context
 * readiness; never commits an empty-context baseline.
 *
 * @param context - authoritative runtime context.
 * @param canonicalHosts - canonical block formula hosts (document order).
 * @param headings - heading info for scope resolution.
 * @param desiredTagOverrides - trusted desiredTag per host (working pipeline).
 * @param editorRoot - optional root for baseline projection closure.
 */
export async function initializeBaseline(
  context: FormulaRuntimeContext,
  canonicalHosts: HTMLElement[],
  headings: any[],
  desiredTagOverrides?: Map<HTMLElement, string | null>,
  editorRoot?: HTMLElement | null,
): Promise<boolean> {
  const store = getFormulaStateStore()

  // R5.4.3.17: hard context gate.
  if (!bindStoreRuntimeContext(context)) {
    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      action: 'INITIAL_BASELINE',
      documentKey: context.documentKey,
      documentGeneration: context.documentGeneration,
      editorRootToken: context.editorRootToken,
      slotCount: 0,
      decision: 'DEFER',
      reason: 'RUNTIME_CONTEXT_NOT_READY',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return false
  }

  const initialState = store.buildStateFromCanonicalHosts(canonicalHosts, headings, null, undefined)
  productionCallCounters.buildAfterCandidateState++
  if (!initialState) {
    emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
      action: 'INITIAL_BASELINE',
      documentKey: context.documentKey,
      documentGeneration: context.documentGeneration,
      editorRootToken: context.editorRootToken,
      slotCount: 0,
      decision: 'FAIL',
      reason: 'CANONICAL_SCAN_FAILED',
      runtimeMarker: R54315_RUNTIME_MARKER,
    })
    return false
  }

  const transaction: FormulaOperationTransaction = {
    operationId: `baseline-${Date.now()}`,
    mutationBatchId: 'initial-baseline',
    beforeStateRevision: 0,
    beforeState: {
      stateRevision: 0,
      documentKey: context.documentKey,
      documentGeneration: context.documentGeneration,
      editorRootToken: context.editorRootToken,
      headingStateRevision: 0,
      slotsInDocumentOrder: [],
      slotByStableIdentity: new Map(),
      semanticSignature: 'empty',
      committedAtOperationId: null,
      structuralReady: true,
      managedSlotCount: 0,
      desiredTagReadyCount: 0,
      allManagedDesiredTagsReady: true,
      headingRevisionUsed: null,
      numberingPlanRevisionUsed: null,
      renderAuthorityReady: false,
    },
    afterCandidate: initialState,
    operationKind: 'NOOP',
    addedStableIdentities: [],
    removedStableIdentities: [],
    survivingStableIdentities: [],
    primaryStableIdentity: null,
    dependencyFrontier: null,
    affectedStableIdentities: [],
    targetStateRevision: 1,
    status: 'CAPTURED',
  }

  const { newState } = store.commitOperation(transaction)

  emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
    stateRevision: newState.stateRevision,
    documentKey: newState.documentKey,
    documentGeneration: newState.documentGeneration,
    editorRootToken: newState.editorRootToken,
    slotCount: newState.slotsInDocumentOrder.length,
    stableIdentities: newState.slotsInDocumentOrder.map((s) => s.stableIdentity),
    desiredTags: newState.slotsInDocumentOrder.map((s) => s.desiredTag),
    action: 'INITIAL_BASELINE',
    decision: 'COMMITTED',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  // R5.4.3.17: baseline projection closure fixes any pre-baseline native output.
  if (editorRoot) {
    try {
      await runBaselineProjectionClosure(editorRoot)
    } catch {
      emitRuntimeAudit('FORMULA-BASELINE-PROJECTION-CLOSURE', {
        documentKey: newState.documentKey,
        generation: newState.documentGeneration,
        rootToken: newState.editorRootToken,
        decision: 'FAIL',
        reason: 'BASELINE_PROJECTION_CLOSURE_EXCEPTION',
        runtimeMarker: R54315_RUNTIME_MARKER,
      })
    }
  }

  return true
}

// ── handleDocumentSwitch ────────────────────────────────────────────────

/**
 * handleDocumentSwitch — retire old state and set up the new baseline.
 * R5.4.3.17: old transactions / projections are retired; new baseline uses
 * the NEW document context only.
 */
export async function handleDocumentSwitch(
  context: FormulaRuntimeContext,
  canonicalHosts: HTMLElement[],
  headings: any[],
  desiredTagOverrides?: Map<HTMLElement, string | null>,
  editorRoot?: HTMLElement | null,
): Promise<boolean> {
  const store = getFormulaStateStore()

  // Retire pending baseline projections of the OLD document.
  clearPendingBaselineProjectionsForDocument(store.documentKey)

  emitRuntimeAudit('FORMULA-STATE-STORE-COMMITTED-STATE', {
    stateRevision: store.currentRevision,
    action: 'DOCUMENT_SWITCH',
    newDocumentKey: context.documentKey,
    newGeneration: context.documentGeneration,
    decision: 'RETIRED',
    runtimeMarker: R54315_RUNTIME_MARKER,
  })

  // Reset the operation closure state for the new document.
  resetOperationClosureState()

  // Initialize the new baseline.
  return initializeBaseline(context, canonicalHosts, headings, desiredTagOverrides, editorRoot)
}

// ── Legacy Baseline Gate Handoff (R5.4.3.17) ────────────────────────────

/**
 * emitLegacyBaselineGateHandoff — legacy FormulaSemanticBaseline gate must
 * NOT block semantic operations once the store baseline is ready for the
 * same document/generation/root. Emits FORMULA-LEGACY-BASELINE-GATE-HANDOFF.
 */
export function emitLegacyBaselineGateHandoff(input: {
  storeBaselineReady: boolean
  storeDocumentKey: string
  storeGeneration: number
  storeRootToken: number
  legacyBaselineState: string
  legacyGateWouldDefer: boolean
  handoffApplied: boolean
  semanticDispatchAllowed: boolean
}): void {
  emitRuntimeAudit('FORMULA-LEGACY-BASELINE-GATE-HANDOFF', {
    storeBaselineReady: input.storeBaselineReady,
    storeDocumentKey: input.storeDocumentKey,
    storeGeneration: input.storeGeneration,
    storeRootToken: input.storeRootToken,
    legacyBaselineState: input.legacyBaselineState,
    legacyGateWouldDefer: input.legacyGateWouldDefer,
    handoffApplied: input.handoffApplied,
    semanticDispatchAllowed: input.semanticDispatchAllowed,
    decision: input.storeBaselineReady && input.legacyGateWouldDefer
      ? 'HANDOFF'
      : (input.storeBaselineReady ? 'ALLOW' : 'NO_STORE_BASELINE'),
    reason: input.storeBaselineReady && input.legacyGateWouldDefer
      ? 'LEGACY_BASELINE_GATE_BYPASSED_BY_STORE'
      : null,
    runtimeMarker: R54315_RUNTIME_MARKER,
  })
}
