/**
 * v2.5.7-R5.4.3.1: Event Runtime Safety + Formula/Heading Domain Isolation.
 *
 * Provides:
 *   FORMULA-SEMANTIC-DISPATCH-CONTEXT-GATE
 *   FORMULA-SEMANTIC-BASELINE-AUTHORITY
 *   FORMULA-SEMANTIC-DOMAIN-SNAPSHOT
 *   FORMULA-EVENT-DOMAIN-ISOLATION-AUTHORITY
 *   FORMULA-SEMANTIC-EVENT-AUTHORITY
 *   FORMULA-SEMANTIC-OPERATION-LIFECYCLE
 *   FORMULA-EVENT-PIPELINE-ERROR
 *   FORMULA-EVENT-RUNTIME-SAFETY-FINAL
 *
 * No setInterval, no recursive setTimeout, no periodic full scan.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export const R5431_RUNTIME_MARKER = 'FORMULA-EVENT-RUNTIME-SAFETY-V2.5.7-R5.4.3.1'
export const R5431_BUILD_MARKER = 'inkchapter-formula-event-runtime-safety-v2.5.7-r5.4.3.1'

// ── Safety Counters ─────────────────────────────────────────────────────

let totalSemanticDispatchContextGatePassCount = 0
let totalSemanticDispatchWithNullDocumentKeyCount = 0
let totalBaselineEstablishCount = 0
let totalBaselineFalseAddedEventCount = 0
let totalBaselineFalseHeadingAddedCount = 0
let totalDomainSnapshotCount = 0
let totalCrossDomainCount = 0
let totalGlobalCaptionRefreshFromFormulaEventCount = 0
let totalTableScanFromFormulaEventCount = 0
let totalFigureScanFromFormulaEventCount = 0
let totalCodeScanFromFormulaEventCount = 0
let totalInvalidObjectTargetCount = 0
let totalHeadingElementMisclassifiedAsObjectCount = 0
let totalObjectWithNullTypeCount = 0
let totalObjectWithInvalidTypeCount = 0
let totalMutationShapeGuessEventCount = 0
let totalFormulaSemanticEventCount = 0
let totalHeadingSemanticEventCount = 0
let totalEventPipelineErrorCount = 0
let totalRuntimeTypeErrorCount = 0
let totalExistingSourceRegressionCount = 0
let totalPeriodicTimerCount = 0
let totalStaleBatchDropCount = 0
let totalRecoverableDeferBaselineCount = 0
let totalFormulaOnlyRefreshCount = 0
let totalPrebaselineBufferCount = 0
let totalPrebaselineReplayCount = 0
let totalEditingHostResolveCount = 0
let totalNewHostAdoptionCount = 0
let totalPreCallCatchupAttemptedCount = 0
let totalPreCallCatchupCompletedCount = 0
let totalSameCallReauthorizationCount = 0
let totalFormulaAddedSnapshotDiffCount = 0
let totalSnapshotDiffOrderPassCount = 0
let totalExistingFormulaAffectedCount = 0

export function resetSafetyCounters(): void {
  totalSemanticDispatchContextGatePassCount = 0
  totalSemanticDispatchWithNullDocumentKeyCount = 0
  totalBaselineEstablishCount = 0
  totalBaselineFalseAddedEventCount = 0
  totalBaselineFalseHeadingAddedCount = 0
  totalDomainSnapshotCount = 0
  totalCrossDomainCount = 0
  totalGlobalCaptionRefreshFromFormulaEventCount = 0
  totalTableScanFromFormulaEventCount = 0
  totalFigureScanFromFormulaEventCount = 0
  totalCodeScanFromFormulaEventCount = 0
  totalInvalidObjectTargetCount = 0
  totalHeadingElementMisclassifiedAsObjectCount = 0
  totalObjectWithNullTypeCount = 0
  totalObjectWithInvalidTypeCount = 0
  totalMutationShapeGuessEventCount = 0
  totalFormulaSemanticEventCount = 0
  totalHeadingSemanticEventCount = 0
  totalEventPipelineErrorCount = 0
  totalRuntimeTypeErrorCount = 0
  totalExistingSourceRegressionCount = 0
  totalPeriodicTimerCount = 0
  totalStaleBatchDropCount = 0
  totalRecoverableDeferBaselineCount = 0
  totalFormulaOnlyRefreshCount = 0
  totalPrebaselineBufferCount = 0
  totalPrebaselineReplayCount = 0
  totalEditingHostResolveCount = 0
  totalNewHostAdoptionCount = 0
  totalPreCallCatchupAttemptedCount = 0
  totalPreCallCatchupCompletedCount = 0
  totalSameCallReauthorizationCount = 0
  totalFormulaAddedSnapshotDiffCount = 0
  totalSnapshotDiffOrderPassCount = 0
  totalExistingFormulaAffectedCount = 0
}

export function getSafetyCounters(): {
  semanticDispatchContextGatePassCount: number
  semanticDispatchWithNullDocumentKeyCount: number
  baselineEstablishCount: number
  baselineFalseAddedEventCount: number
  baselineFalseHeadingAddedCount: number
  domainSnapshotCount: number
  crossDomainCount: number
  globalCaptionRefreshFromFormulaEventCount: number
  tableScanFromFormulaEventCount: number
  figureScanFromFormulaEventCount: number
  codeScanFromFormulaEventCount: number
  invalidObjectTargetCount: number
  headingElementMisclassifiedAsObjectCount: number
  objectWithNullTypeCount: number
  objectWithInvalidTypeCount: number
  mutationShapeGuessEventCount: number
  formulaSemanticEventCount: number
  headingSemanticEventCount: number
  eventPipelineErrorCount: number
  runtimeTypeErrorCount: number
  existingSourceRegressionCount: number
  periodicTimerCount: number
  staleBatchDropCount: number
  recoverableDeferBaselineCount: number
  formulaOnlyRefreshCount: number
  prebaselineBufferCount: number
  prebaselineReplayCount: number
  editingHostResolveCount: number
  newHostAdoptionCount: number
  preCallCatchupAttemptedCount: number
  preCallCatchupCompletedCount: number
  sameCallReauthorizationCount: number
  formulaAddedSnapshotDiffCount: number
  snapshotDiffOrderPassCount: number
  existingFormulaAffectedCount: number
} {
  return {
    semanticDispatchContextGatePassCount: totalSemanticDispatchContextGatePassCount,
    semanticDispatchWithNullDocumentKeyCount: totalSemanticDispatchWithNullDocumentKeyCount,
    baselineEstablishCount: totalBaselineEstablishCount,
    baselineFalseAddedEventCount: totalBaselineFalseAddedEventCount,
    baselineFalseHeadingAddedCount: totalBaselineFalseHeadingAddedCount,
    domainSnapshotCount: totalDomainSnapshotCount,
    crossDomainCount: totalCrossDomainCount,
    globalCaptionRefreshFromFormulaEventCount: totalGlobalCaptionRefreshFromFormulaEventCount,
    tableScanFromFormulaEventCount: totalTableScanFromFormulaEventCount,
    figureScanFromFormulaEventCount: totalFigureScanFromFormulaEventCount,
    codeScanFromFormulaEventCount: totalCodeScanFromFormulaEventCount,
    invalidObjectTargetCount: totalInvalidObjectTargetCount,
    headingElementMisclassifiedAsObjectCount: totalHeadingElementMisclassifiedAsObjectCount,
    objectWithNullTypeCount: totalObjectWithNullTypeCount,
    objectWithInvalidTypeCount: totalObjectWithInvalidTypeCount,
    mutationShapeGuessEventCount: totalMutationShapeGuessEventCount,
    formulaSemanticEventCount: totalFormulaSemanticEventCount,
    headingSemanticEventCount: totalHeadingSemanticEventCount,
    eventPipelineErrorCount: totalEventPipelineErrorCount,
    runtimeTypeErrorCount: totalRuntimeTypeErrorCount,
    existingSourceRegressionCount: totalExistingSourceRegressionCount,
    periodicTimerCount: totalPeriodicTimerCount,
    staleBatchDropCount: totalStaleBatchDropCount,
    recoverableDeferBaselineCount: totalRecoverableDeferBaselineCount,
    formulaOnlyRefreshCount: totalFormulaOnlyRefreshCount,
    prebaselineBufferCount: totalPrebaselineBufferCount,
    prebaselineReplayCount: totalPrebaselineReplayCount,
    editingHostResolveCount: totalEditingHostResolveCount,
    newHostAdoptionCount: totalNewHostAdoptionCount,
    preCallCatchupAttemptedCount: totalPreCallCatchupAttemptedCount,
    preCallCatchupCompletedCount: totalPreCallCatchupCompletedCount,
    sameCallReauthorizationCount: totalSameCallReauthorizationCount,
    formulaAddedSnapshotDiffCount: totalFormulaAddedSnapshotDiffCount,
    snapshotDiffOrderPassCount: totalSnapshotDiffOrderPassCount,
    existingFormulaAffectedCount: totalExistingFormulaAffectedCount,
  }
}

export function incrementGlobalCaptionRefreshFromFormulaEvent(): void { totalGlobalCaptionRefreshFromFormulaEventCount++ }
export function incrementTableScanFromFormulaEvent(): void { totalTableScanFromFormulaEventCount++ }
export function incrementFigureScanFromFormulaEvent(): void { totalFigureScanFromFormulaEventCount++ }
export function incrementCodeScanFromFormulaEvent(): void { totalCodeScanFromFormulaEventCount++ }
export function incrementInvalidObjectTargetCount(): void { totalInvalidObjectTargetCount++ }
export function incrementHeadingMisclassifiedAsObject(): void { totalHeadingElementMisclassifiedAsObjectCount++ }
export function incrementObjectWithNullType(): void { totalObjectWithNullTypeCount++ }
export function incrementObjectWithInvalidType(): void { totalObjectWithInvalidTypeCount++ }
export function incrementMutationShapeGuessEvent(): void { totalMutationShapeGuessEventCount++ }
export function incrementRuntimeTypeError(): void { totalRuntimeTypeErrorCount++ }
export function incrementEventPipelineError(): void { totalEventPipelineErrorCount++ }
export function incrementExistingSourceRegression(): void { totalExistingSourceRegressionCount++ }
export function incrementPeriodicTimer(): void { totalPeriodicTimerCount++ }
export function incrementStaleBatchDrop(): void { totalStaleBatchDropCount++ }
export function incrementFormulaSemanticEvent(): void { totalFormulaSemanticEventCount++ }
export function incrementHeadingSemanticEvent(): void { totalHeadingSemanticEventCount++ }
export function incrementRecoverableDeferBaseline(): void { totalRecoverableDeferBaselineCount++ }
export function incrementFormulaOnlyRefreshCount(): void { totalFormulaOnlyRefreshCount++ }
export function incrementPrebaselineBuffer(): void { totalPrebaselineBufferCount++ }
export function incrementPrebaselineReplay(): void { totalPrebaselineReplayCount++ }
export function incrementEditingHostResolve(): void { totalEditingHostResolveCount++ }
export function incrementNewHostAdoption(): void { totalNewHostAdoptionCount++ }
export function incrementPreCallCatchupAttempted(): void { totalPreCallCatchupAttemptedCount++ }
export function incrementPreCallCatchupCompleted(): void { totalPreCallCatchupCompletedCount++ }
export function incrementSameCallReauthorization(): void { totalSameCallReauthorizationCount++ }
export function incrementFormulaAddedSnapshotDiff(): void { totalFormulaAddedSnapshotDiffCount++ }
export function incrementSnapshotDiffOrderPass(): void { totalSnapshotDiffOrderPassCount++ }
export function incrementExistingFormulaAffected(): void { totalExistingFormulaAffectedCount++ }

// ── Document Context Dispatch Gate ──────────────────────────────────────

export interface DispatchContextGateInput {
  sourceMutationBatchId: string | null
  workspaceActivePath: string | null
  documentKey: string | null
  documentGeneration: number
  editorRootAvailable: boolean
  editorRootConnected: boolean
  businessReady: boolean
  baselineSnapshotAvailable: boolean
  baselineSnapshotDocumentKey: string | null
  baselineSnapshotGeneration: number
}

export type DispatchContextGateDecision =
  | 'ALLOW'
  | 'DEFER_BASELINE'
  | 'DROP_STALE_DOCUMENT'
  | 'DROP_NO_DOCUMENT'
  | 'DROP_NO_EDITOR_ROOT'

export function checkDispatchContextGate(input: DispatchContextGateInput): { decision: DispatchContextGateDecision; reason: string | null } {
  if (!input.documentKey || !input.workspaceActivePath) {
    totalSemanticDispatchWithNullDocumentKeyCount++
    emitContextGateMarker(input, 'DROP_NO_DOCUMENT', 'documentKey_or_workspaceActivePath_null')
    return { decision: 'DROP_NO_DOCUMENT', reason: 'documentKey_or_workspaceActivePath_null' }
  }
  if (!input.editorRootAvailable) {
    emitContextGateMarker(input, 'DROP_NO_EDITOR_ROOT', 'editorRoot_not_available')
    return { decision: 'DROP_NO_EDITOR_ROOT', reason: 'editorRoot_not_available' }
  }
  if (!input.editorRootConnected) {
    emitContextGateMarker(input, 'DROP_NO_EDITOR_ROOT', 'editorRoot_disconnected')
    return { decision: 'DROP_NO_EDITOR_ROOT', reason: 'editorRoot_disconnected' }
  }
  if (input.documentGeneration <= 0) {
    emitContextGateMarker(input, 'DROP_NO_DOCUMENT', 'documentGeneration_not_ready')
    return { decision: 'DROP_NO_DOCUMENT', reason: 'documentGeneration_not_ready' }
  }
  if (!input.businessReady) {
    emitContextGateMarker(input, 'DEFER_BASELINE', 'businessReady_false')
    return { decision: 'DEFER_BASELINE', reason: 'businessReady_false' }
  }
  if (!input.baselineSnapshotAvailable) {
    emitContextGateMarker(input, 'DEFER_BASELINE', 'baseline_snapshot_not_available')
    return { decision: 'DEFER_BASELINE', reason: 'baseline_snapshot_not_available' }
  }
  if (input.baselineSnapshotDocumentKey !== input.documentKey) {
    totalSemanticDispatchWithNullDocumentKeyCount++
    emitContextGateMarker(input, 'DROP_STALE_DOCUMENT', 'baseline_documentKey_mismatch')
    return { decision: 'DROP_STALE_DOCUMENT', reason: 'baseline_documentKey_mismatch' }
  }
  if (input.baselineSnapshotGeneration !== input.documentGeneration) {
    emitContextGateMarker(input, 'DROP_STALE_DOCUMENT', 'baseline_generation_mismatch')
    return { decision: 'DROP_STALE_DOCUMENT', reason: 'baseline_generation_mismatch' }
  }
  totalSemanticDispatchContextGatePassCount++
  emitContextGateMarker(input, 'ALLOW', null)
  return { decision: 'ALLOW', reason: null }
}

function emitContextGateMarker(input: DispatchContextGateInput, decision: DispatchContextGateDecision, reason: string | null): void {
  emitRuntimeAudit('FORMULA-SEMANTIC-DISPATCH-CONTEXT-GATE', {
    sourceMutationBatchId: input.sourceMutationBatchId,
    workspaceActivePath: input.workspaceActivePath,
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    editorRootAvailable: input.editorRootAvailable,
    editorRootConnected: input.editorRootConnected,
    businessReady: input.businessReady,
    baselineSnapshotAvailable: input.baselineSnapshotAvailable,
    baselineSnapshotDocumentKey: input.baselineSnapshotDocumentKey,
    baselineSnapshotGeneration: input.baselineSnapshotGeneration,
    sameDocument: input.baselineSnapshotDocumentKey === input.documentKey,
    sameGeneration: input.baselineSnapshotGeneration === input.documentGeneration,
    decision,
    reason,
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

// ── Baseline Semantic Snapshot Authority ────────────────────────────────

export interface BaselineAuthorityInput {
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  formulaCount: number
  headingCount: number
  semanticSignature: string
  baselineRevision: number
}

export function emitBaselineAuthority(input: BaselineAuthorityInput): void {
  totalBaselineEstablishCount++
  emitRuntimeAudit('FORMULA-SEMANTIC-BASELINE-AUTHORITY', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    editorRootToken: input.editorRootToken,
    formulaCount: input.formulaCount,
    headingCount: input.headingCount,
    semanticSignature: input.semanticSignature,
    baselineRevision: input.baselineRevision,
    decision: 'BASELINE_ESTABLISHED',
    reason: null,
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

export function recordBaselineFalseAddedEvent(): void {
  totalBaselineFalseAddedEventCount++
}

export function recordBaselineFalseHeadingAdded(): void {
  totalBaselineFalseHeadingAddedCount++
}

// ── Formula/Heading Domain Snapshot ─────────────────────────────────────

export interface DomainSnapshotInput {
  documentKey: string
  documentGeneration: number
  formulaCandidateCount: number
  formulaAcceptedCount: number
  formulaRejectedNonFormulaCount: number
  headingCandidateCount: number
  headingAcceptedCount: number
  headingRejectedNonHeadingCount: number
  crossDomainCount: number
}

export function emitDomainSnapshot(input: DomainSnapshotInput): void {
  totalDomainSnapshotCount++
  totalCrossDomainCount += input.crossDomainCount
  emitRuntimeAudit('FORMULA-SEMANTIC-DOMAIN-SNAPSHOT', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    formulaCandidateCount: input.formulaCandidateCount,
    formulaAcceptedCount: input.formulaAcceptedCount,
    formulaRejectedNonFormulaCount: input.formulaRejectedNonFormulaCount,
    headingCandidateCount: input.headingCandidateCount,
    headingAcceptedCount: input.headingAcceptedCount,
    headingRejectedNonHeadingCount: input.headingRejectedNonHeadingCount,
    crossDomainCount: input.crossDomainCount,
    decision: input.crossDomainCount === 0 ? 'PASS' : 'FAIL',
    reason: input.crossDomainCount === 0 ? null : 'CROSS_DOMAIN_DETECTED',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

// ── Event Domain Isolation Authority ────────────────────────────────────

export interface DomainIsolationAuthorityInput {
  operationBatchId: string
  formulaHeadingPipelineInvoked: boolean
  globalCaptionRefreshInvoked: boolean
  tableScanInvoked: boolean
  figureScanInvoked: boolean
  codeScanInvoked: boolean
  formulaScanInvoked: boolean
  headingScanInvoked: boolean
}

export function emitDomainIsolationAuthority(input: DomainIsolationAuthorityInput): void {
  const decision = input.formulaHeadingPipelineInvoked
    && !input.globalCaptionRefreshInvoked
    && !input.tableScanInvoked
    && !input.figureScanInvoked
    && !input.codeScanInvoked
    ? 'PASS' : 'FAIL'
  emitRuntimeAudit('FORMULA-EVENT-DOMAIN-ISOLATION-AUTHORITY', {
    operationBatchId: input.operationBatchId,
    formulaHeadingPipelineInvoked: input.formulaHeadingPipelineInvoked,
    globalCaptionRefreshInvoked: input.globalCaptionRefreshInvoked,
    tableScanInvoked: input.tableScanInvoked,
    figureScanInvoked: input.figureScanInvoked,
    codeScanInvoked: input.codeScanInvoked,
    formulaScanInvoked: input.formulaScanInvoked,
    headingScanInvoked: input.headingScanInvoked,
    decision,
    reason: decision === 'PASS' ? null : 'DOMAIN_CROSS_CONTAMINATION',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
  if (input.globalCaptionRefreshInvoked) totalGlobalCaptionRefreshFromFormulaEventCount++
  if (input.tableScanInvoked) totalTableScanFromFormulaEventCount++
  if (input.figureScanInvoked) totalFigureScanFromFormulaEventCount++
  if (input.codeScanInvoked) totalCodeScanFromFormulaEventCount++
}

// ── Document Block Stream Domain Verify ─────────────────────────────────

export interface BlockStreamDomainVerifyInput {
  documentKey: string
  documentGeneration: number
  eventCount: number
  headingEventCount: number
  objectEventCount: number
  headingElementMisclassifiedAsObjectCount: number
  objectWithNullTypeCount: number
  objectWithInvalidTypeCount: number
}

export function emitBlockStreamDomainVerify(input: BlockStreamDomainVerifyInput): void {
  totalHeadingElementMisclassifiedAsObjectCount += input.headingElementMisclassifiedAsObjectCount
  totalObjectWithNullTypeCount += input.objectWithNullTypeCount
  totalObjectWithInvalidTypeCount += input.objectWithInvalidTypeCount
  const pass = input.headingElementMisclassifiedAsObjectCount === 0
    && input.objectWithNullTypeCount === 0
    && input.objectWithInvalidTypeCount === 0
  emitRuntimeAudit('DOCUMENT-BLOCK-STREAM-DOMAIN-VERIFY', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    eventCount: input.eventCount,
    headingEventCount: input.headingEventCount,
    objectEventCount: input.objectEventCount,
    headingElementMisclassifiedAsObjectCount: input.headingElementMisclassifiedAsObjectCount,
    objectWithNullTypeCount: input.objectWithNullTypeCount,
    objectWithInvalidTypeCount: input.objectWithInvalidTypeCount,
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass ? null : 'DOMAIN_VIOLATION',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

// ── Semantic Event Authority ────────────────────────────────────────────

export type SemanticEventAuthorityKind =
  | 'SNAPSHOT_IDENTITY_DIFF'
  | 'SNAPSHOT_CONTENT_REVISION_DIFF'
  | 'SNAPSHOT_HEADING_SEMANTIC_DIFF'
  | 'SETTING_CHANGE_AUTHORITY'
  | 'MUTATION_SHAPE_GUESS'

export interface SemanticEventAuthorityInput {
  operationBatchId: string
  eventKind: string
  stableIdentity: string | number | null
  presentBefore: boolean
  presentAfter: boolean
  oldDocumentOrder: number | null
  newDocumentOrder: number | null
  oldSourceHash: string | null
  newSourceHash: string | null
  oldHeadingLevel: string | null
  newHeadingLevel: string | null
  oldSemanticRole: string | null
  newSemanticRole: string | null
  authorityKind: SemanticEventAuthorityKind
}

export function emitSemanticEventAuthority(input: SemanticEventAuthorityInput): void {
  if (input.authorityKind === 'MUTATION_SHAPE_GUESS') {
    totalMutationShapeGuessEventCount++
  }
  const decision = input.authorityKind === 'MUTATION_SHAPE_GUESS' ? 'FAIL' : 'PASS'
  emitRuntimeAudit('FORMULA-SEMANTIC-EVENT-AUTHORITY', {
    operationBatchId: input.operationBatchId,
    eventKind: input.eventKind,
    stableIdentity: input.stableIdentity,
    presentBefore: input.presentBefore,
    presentAfter: input.presentAfter,
    oldDocumentOrder: input.oldDocumentOrder,
    newDocumentOrder: input.newDocumentOrder,
    oldSourceHash: input.oldSourceHash,
    newSourceHash: input.newSourceHash,
    oldHeadingLevel: input.oldHeadingLevel,
    newHeadingLevel: input.newHeadingLevel,
    oldSemanticRole: input.oldSemanticRole,
    newSemanticRole: input.newSemanticRole,
    authorityKind: input.authorityKind,
    decision,
    reason: decision === 'PASS' ? null : 'MUTATION_SHAPE_GUESS_NOT_ALLOWED',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

// ── Operation Batch Lifecycle ───────────────────────────────────────────

export interface OperationLifecycleInput {
  operationBatchId: string
  createdDocumentKey: string | null
  currentDocumentKey: string | null
  createdGeneration: number
  currentGeneration: number
  createdEditorRootToken: number
  currentEditorRootToken: number
  baselineRevisionAtCreate: number
  baselineRevisionAtFinalize: number
}

export type OperationLifecycleDecision = 'FINALIZE' | 'DROP_STALE_BATCH'

export function checkOperationLifecycle(input: OperationLifecycleInput): OperationLifecycleDecision {
  const sameDocument = input.createdDocumentKey === input.currentDocumentKey
  const sameGeneration = input.createdGeneration === input.currentGeneration
  const sameRoot = input.createdEditorRootToken === input.currentEditorRootToken
  const decision = sameDocument && sameGeneration && sameRoot ? 'FINALIZE' : 'DROP_STALE_BATCH'
  if (decision === 'DROP_STALE_BATCH') {
    totalStaleBatchDropCount++
  }
  emitRuntimeAudit('FORMULA-SEMANTIC-OPERATION-LIFECYCLE', {
    operationBatchId: input.operationBatchId,
    createdDocumentKey: input.createdDocumentKey,
    currentDocumentKey: input.currentDocumentKey,
    createdGeneration: input.createdGeneration,
    currentGeneration: input.currentGeneration,
    createdEditorRootToken: input.createdEditorRootToken,
    currentEditorRootToken: input.currentEditorRootToken,
    baselineRevisionAtCreate: input.baselineRevisionAtCreate,
    baselineRevisionAtFinalize: input.baselineRevisionAtFinalize,
    sameDocument,
    sameGeneration,
    sameRoot,
    decision,
    reason: decision === 'FINALIZE' ? null : 'STALE_DOCUMENT_CONTEXT',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
  return decision
}

// ── Event Pipeline Error Barrier ────────────────────────────────────────

export interface EventPipelineErrorInput {
  operationBatchId: string
  phase: string
  errorName: string
  errorMessage: string
  documentKey: string | null
  documentGeneration: number
  semanticEventCount: number
  affectedFormulaCount: number
}

export function emitEventPipelineError(input: EventPipelineErrorInput): void {
  totalEventPipelineErrorCount++
  emitRuntimeAudit('FORMULA-EVENT-PIPELINE-ERROR', {
    operationBatchId: input.operationBatchId,
    phase: input.phase,
    errorName: input.errorName,
    errorMessage: input.errorMessage,
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    semanticEventCount: input.semanticEventCount,
    affectedFormulaCount: input.affectedFormulaCount,
    decision: 'ABORT_BATCH',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}

// ── Final Safety Marker ─────────────────────────────────────────────────

export interface EventRuntimeSafetyFinalInput {
  documentKey: string | null
  documentGeneration: number
  semanticDispatchContextGatePassCount: number
  semanticDispatchWithNullDocumentKeyCount: number
  baselineEstablishCount: number
  baselineFalseAddedEventCount: number
  domainSnapshotCount: number
  crossDomainCount: number
  globalCaptionRefreshFromFormulaEventCount: number
  tableScanFromFormulaEventCount: number
  figureScanFromFormulaEventCount: number
  codeScanFromFormulaEventCount: number
  invalidObjectTargetCount: number
  headingElementMisclassifiedAsObjectCount: number
  objectWithNullTypeCount: number
  objectWithInvalidTypeCount: number
  mutationShapeGuessEventCount: number
  formulaSemanticEventCount: number
  headingSemanticEventCount: number
  eventPipelineErrorCount: number
  runtimeTypeErrorCount: number
  existingSourceRegressionCount: number
  periodicTimerCount: number
  targetedRefreshAuthority: string
}

export function emitEventRuntimeSafetyFinal(input: EventRuntimeSafetyFinalInput): void {
  const safetyPass = input.semanticDispatchWithNullDocumentKeyCount === 0
    && input.baselineFalseAddedEventCount === 0
    && input.crossDomainCount === 0
    && input.globalCaptionRefreshFromFormulaEventCount === 0
    && input.tableScanFromFormulaEventCount === 0
    && input.figureScanFromFormulaEventCount === 0
    && input.codeScanFromFormulaEventCount === 0
    && input.invalidObjectTargetCount === 0
    && input.headingElementMisclassifiedAsObjectCount === 0
    && input.objectWithNullTypeCount === 0
    && input.objectWithInvalidTypeCount === 0
    && input.mutationShapeGuessEventCount === 0
    && input.eventPipelineErrorCount === 0
    && input.runtimeTypeErrorCount === 0
    && input.existingSourceRegressionCount === 0
    && input.periodicTimerCount === 0
  const decision = safetyPass ? 'PASS' : 'FAIL'
  emitRuntimeAudit('FORMULA-EVENT-RUNTIME-SAFETY-FINAL', {
    documentKey: input.documentKey,
    documentGeneration: input.documentGeneration,
    semanticDispatchContextGatePassCount: input.semanticDispatchContextGatePassCount,
    semanticDispatchWithNullDocumentKeyCount: input.semanticDispatchWithNullDocumentKeyCount,
    baselineEstablishCount: input.baselineEstablishCount,
    baselineFalseAddedEventCount: input.baselineFalseAddedEventCount,
    domainSnapshotCount: input.domainSnapshotCount,
    crossDomainCount: input.crossDomainCount,
    globalCaptionRefreshFromFormulaEventCount: input.globalCaptionRefreshFromFormulaEventCount,
    tableScanFromFormulaEventCount: input.tableScanFromFormulaEventCount,
    figureScanFromFormulaEventCount: input.figureScanFromFormulaEventCount,
    codeScanFromFormulaEventCount: input.codeScanFromFormulaEventCount,
    invalidObjectTargetCount: input.invalidObjectTargetCount,
    headingElementMisclassifiedAsObjectCount: input.headingElementMisclassifiedAsObjectCount,
    objectWithNullTypeCount: input.objectWithNullTypeCount,
    objectWithInvalidTypeCount: input.objectWithInvalidTypeCount,
    mutationShapeGuessEventCount: input.mutationShapeGuessEventCount,
    formulaSemanticEventCount: input.formulaSemanticEventCount,
    headingSemanticEventCount: input.headingSemanticEventCount,
    eventPipelineErrorCount: input.eventPipelineErrorCount,
    runtimeTypeErrorCount: input.runtimeTypeErrorCount,
    existingSourceRegressionCount: input.existingSourceRegressionCount,
    periodicTimerCount: input.periodicTimerCount,
    targetedRefreshAuthority: input.targetedRefreshAuthority,
    decision,
    reason: decision === 'PASS' ? null : 'SAFETY_GATE_NOT_PASSED',
    runtimeMarker: R5431_RUNTIME_MARKER,
  })
}