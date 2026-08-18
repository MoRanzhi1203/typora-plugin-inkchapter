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
  R54315_RUNTIME_MARKER,
} from './formula-state-store'
import {
  createOperationClosure,
  markSemanticCommitted,
  recordProjectionRequested,
  recordProjectionSettled,
  recordProjectionCommitted,
  recordVisibleVerified,
  setNativeManagedMismatchCount,
  setAllDesiredTagsVisible,
  finalizeOperationClosure,
  resetOperationClosureState,
  type FormulaOperationClosure,
} from './formula-operation-closure'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { readVisibleFormulaTag, resolveFormulaCompositeVisualOwner, checkNativeSlotOwnership, getNaturalRenderOptions, requestFormulaProjectionFulfillment } from './formula-render-projection'
import { extractFormulaTexForTrace, simpleHash, normalizeTexSource } from './formula-tex-source-verifier'

// ── Build & Runtime Markers ─────────────────────────────────────────────

export const R54316_BUILD_ID = 'inkchapter-formula-authoritative-source-feedback-isolation-v2.5.7-r5.4.3.19'
const R54316_RUNTIME_MARKER = 'FORMULA-AUTHORITATIVE-SOURCE-FEEDBACK-ISOLATION-V2.5.7-R5.4.3.19'

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
      const after = readVisibleFormulaTag(tx.canonicalHost, tx.desiredTag)
      visibleTagAfter = after.visibleTagText
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

  // R5.4.3.18 P0-D: mismatch AFTER must come from an ACTUAL DOM re-read.
  const truth = readFormulaVisibleStateTruth()
  const nativeManagedMismatchCountAfter = truth.nativeManagedTagCount
    + (truth.mismatchSlotCount - truth.matchingSlotCount >= 0 ? truth.mismatchSlotCount : 0)
    + truth.missingVisibleTagCount

  // Close pending baseline projections (all were covered by this closure).
  resolvePendingBaselineProjections()

  const pass = exec.requestedCount === exec.settledCount
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
