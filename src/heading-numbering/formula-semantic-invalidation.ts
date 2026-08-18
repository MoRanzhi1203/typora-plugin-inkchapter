/**
 * v2.5.7-R5.4.3: Event-Driven Formula Semantic Invalidation.
 *
 * Replaces timer-based refresh with pure event-driven architecture:
 *   MutationObserver → FORMULA-SEMANTIC-EVENT-DISPATCH
 *   → operation batch coalescing (queueMicrotask)
 *   → FORMULA-SEMANTIC-OPERATION-BATCH
 *   → dependency range
 *   → FORMULA-DEPENDENCY-DIFF / FORMULA-EVENT-AFFECTED-SET
 *   → targeted refresh
 *   → FORMULA-EVENT-DRIVEN-ACCOUNTING
 *
 * No setInterval, no recursive setTimeout, no periodic full scan.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { type MutationClassification } from './formula-live-revision'

export const R543_RUNTIME_MARKER = 'FORMULA-EVENT-DRIVEN-HEADING-INVALIDATION-V2.5.7-R5.4.3'
export const R543_BUILD_MARKER = 'inkchapter-formula-event-driven-heading-invalidation-v2.5.7-r5.4.3'

export const R5431_RUNTIME_MARKER = 'FORMULA-EVENT-RUNTIME-SAFETY-V2.5.7-R5.4.3.1'
export const R5431_BUILD_MARKER = 'inkchapter-formula-event-runtime-safety-v2.5.7-r5.4.3.1'

export const R5432_RUNTIME_MARKER = 'FORMULA-BASELINE-FASTPATH-RESTORE-V2.5.7-R5.4.3.2'
export const R5432_BUILD_MARKER = 'inkchapter-formula-baseline-fastpath-restore-v2.5.7-r5.4.3.2'

export const R5433_RUNTIME_MARKER = 'FORMULA-RUNTIME-LIVE-REFRESH-V2.5.7-R5.4.3.3'
export const R5433_BUILD_MARKER = 'inkchapter-formula-runtime-live-refresh-v2.5.7-r5.4.3.3'

export const R5434_RUNTIME_MARKER = 'FORMULA-SHARED-SCOPE-SEQUENCE-DIFF-BRIDGE-V2.5.7-R5.4.3.4'
export const R5434_BUILD_MARKER = 'inkchapter-formula-shared-scope-sequence-diff-bridge-v2.5.7-r5.4.3.4'

export const R5435_RUNTIME_MARKER = 'FORMULA-RUNTIME-EVIDENCE-RENDER-CLOSURE-V2.5.7-R5.4.3.5'
export const R5435_BUILD_MARKER = 'inkchapter-formula-runtime-evidence-render-closure-v2.5.7-r5.4.3.5'

export const R5437_RUNTIME_MARKER = 'FORMULA-PERSISTENT-RENDERER-PROJECTION-V2.5.7-R5.4.3.7'
export const R5437_BUILD_MARKER = 'inkchapter-formula-persistent-renderer-projection-v2.5.7-r5.4.3.7'

export const R5438_RUNTIME_MARKER = 'FORMULA-STRUCTURAL-SLOT-EDIT-SESSION-PROJECTION-V2.5.7-R5.4.3.8'
export const R5438_BUILD_MARKER = 'inkchapter-formula-structural-slot-edit-session-projection-v2.5.7-r5.4.3.8'

// ── Semantic Event Types ──────────────────────────────────────────────

export type FormulaSemanticEventKind =
  | 'FORMULA_ADDED'
  | 'FORMULA_REMOVED'
  | 'FORMULA_MOVED'
  | 'FORMULA_SOURCE_CHANGED'
  | 'HEADING_ADDED'
  | 'HEADING_REMOVED'
  | 'HEADING_MOVED'
  | 'HEADING_TEXT_CHANGED'
  | 'HEADING_LEVEL_CHANGED'
  | 'HEADING_NUMBERING_STATE_CHANGED'
  | 'FORMULA_NUMBERING_SETTING_CHANGED'

export interface FormulaSemanticEvent {
  eventKind: FormulaSemanticEventKind
  stableFormulaIdentity?: number | 'AMBIGUOUS' | null
  headingStableIdentity?: string | null
  documentOrder?: number | null
  classification: MutationClassification
}

// ── Operation Batch ───────────────────────────────────────────────────

export interface SemanticOperationBatch {
  batchId: string
  events: FormulaSemanticEvent[]
  mutationBatchId: string | null
  coalesced: boolean
  rafFinalized: boolean
  createdAtMs: number
}

let batchSeq = 0
let currentBatch: SemanticOperationBatch | null = null
let pendingBatchFlush: (() => void) | null = null

// ── Event Counters (for idle quiescence) ──────────────────────────────

let totalSemanticEventCount = 0
let totalFormulaEventCount = 0
let totalHeadingEventCount = 0
let totalAffectedSetBuildCount = 0
let totalRefreshRequestCount = 0
let totalPeriodicTimerCount = 0
let totalRendererFeedbackLoopCount = 0

export function resetEventCounters(): void {
  totalSemanticEventCount = 0
  totalFormulaEventCount = 0
  totalHeadingEventCount = 0
  totalAffectedSetBuildCount = 0
  totalRefreshRequestCount = 0
  totalPeriodicTimerCount = 0
  totalRendererFeedbackLoopCount = 0
}

export function getEventCounters(): {
  semanticEventCount: number
  formulaEventCount: number
  headingEventCount: number
  affectedSetBuildCount: number
  refreshRequestCount: number
  periodicTimerCount: number
  rendererFeedbackLoopCount: number
} {
  return {
    semanticEventCount: totalSemanticEventCount,
    formulaEventCount: totalFormulaEventCount,
    headingEventCount: totalHeadingEventCount,
    affectedSetBuildCount: totalAffectedSetBuildCount,
    refreshRequestCount: totalRefreshRequestCount,
    periodicTimerCount: totalPeriodicTimerCount,
    rendererFeedbackLoopCount: totalRendererFeedbackLoopCount,
  }
}

export function incrementPeriodicTimerCount(): void {
  totalPeriodicTimerCount++
}

export function incrementRefreshRequestCount(): void {
  totalRefreshRequestCount++
}

export function incrementAffectedSetBuildCount(): void {
  totalAffectedSetBuildCount++
}

// ── Event Dispatcher ──────────────────────────────────────────────────

/**
 * The SINGLE entry point for a semantic event. Coalesces rapid mutations
 * into one operation batch via queueMicrotask. Never uses setTimeout.
 * Returns true when the event was accepted (non-renderer-internal).
 */
export function dispatchSemanticEvent(
  event: FormulaSemanticEvent,
  mutationBatchId: string | null,
  onFlush: (batch: SemanticOperationBatch) => void,
): boolean {
  // Renderer-internal mutations NEVER produce semantic events.
  if (event.classification === 'TYPOORA_RENDERER_INTERNAL_ONLY' || event.classification === 'INKCHAPTER_DECORATION_ONLY') {
    return false
  }

  if (!currentBatch) {
    batchSeq++
    currentBatch = {
      batchId: `op-batch-${batchSeq}`,
      events: [],
      mutationBatchId,
      coalesced: false,
      rafFinalized: false,
      createdAtMs: Date.now(),
    }
  }
  currentBatch.events.push(event)
  currentBatch.coalesced = true

  // Count event types.
  totalSemanticEventCount++
  const isFormula = event.eventKind.startsWith('FORMULA_')
  const isHeading = event.eventKind.startsWith('HEADING_')
  if (isFormula) totalFormulaEventCount++
  if (isHeading) totalHeadingEventCount++

  // Schedule coalesced flush via queueMicrotask (never setTimeout).
  if (!pendingBatchFlush) {
    pendingBatchFlush = () => {
      const batch = currentBatch
      currentBatch = null
      pendingBatchFlush = null
      if (batch && batch.events.length > 0) {
        onFlush(batch)
      }
    }
    queueMicrotask(pendingBatchFlush)
  }

  return true
}

/** Force-flush the current batch (called at document-switch / shutdown). */
export function flushCurrentBatch(onFlush: (batch: SemanticOperationBatch) => void): void {
  if (currentBatch && currentBatch.events.length > 0) {
    const batch = currentBatch
    currentBatch = null
    pendingBatchFlush = null
    onFlush(batch)
  }
}

// ── Event Dispatch Marker ─────────────────────────────────────────────

export function emitEventDispatch(batch: SemanticOperationBatch): void {
  const formulaEvents = batch.events.filter((e) => e.eventKind.startsWith('FORMULA_'))
  const headingEvents = batch.events.filter((e) => e.eventKind.startsWith('HEADING_'))
  emitRuntimeAudit('FORMULA-SEMANTIC-EVENT-DISPATCH', {
    eventBatchId: batch.batchId,
    documentKey: null,
    sourceMutationBatchId: batch.mutationBatchId,
    eventCount: batch.events.length,
    formulaAddedCount: formulaEvents.filter((e) => e.eventKind === 'FORMULA_ADDED').length,
    formulaRemovedCount: formulaEvents.filter((e) => e.eventKind === 'FORMULA_REMOVED').length,
    formulaMovedCount: formulaEvents.filter((e) => e.eventKind === 'FORMULA_MOVED').length,
    formulaSourceChangedCount: formulaEvents.filter((e) => e.eventKind === 'FORMULA_SOURCE_CHANGED').length,
    headingAddedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_ADDED').length,
    headingRemovedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_REMOVED').length,
    headingMovedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_MOVED').length,
    headingTextChangedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_TEXT_CHANGED').length,
    headingLevelChangedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_LEVEL_CHANGED').length,
    headingNumberingStateChangedCount: headingEvents.filter((e) => e.eventKind === 'HEADING_NUMBERING_STATE_CHANGED').length,
    formulaSettingChangedCount: formulaEvents.filter((e) => e.eventKind === 'FORMULA_NUMBERING_SETTING_CHANGED').length,
    rendererInternalOnly: formulaEvents.length === 0 && headingEvents.length === 0,
    decision: 'DISPATCHED',
    reason: null,
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

export function emitOperationBatch(input: {
  batchId: string
  mutationBatchCount: number
  microtaskCoalesced: boolean
  rafFinalizationUsed: boolean
  semanticChanged: boolean
}): void {
  emitRuntimeAudit('FORMULA-SEMANTIC-OPERATION-BATCH', {
    operationBatchId: input.batchId,
    mutationBatchCount: input.mutationBatchCount,
    microtaskCoalesced: input.microtaskCoalesced,
    rafFinalizationUsed: input.rafFinalizationUsed,
    semanticSnapshotBefore: null,
    semanticSnapshotAfter: null,
    semanticChanged: input.semanticChanged,
    decision: input.semanticChanged ? 'PROCESSED' : 'NO_OP',
    reason: input.semanticChanged ? null : 'NO_SEMANTIC_CHANGE',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

// ── Event-Driven Snapshot Marker ──────────────────────────────────────

export function emitEventDrivenSnapshot(input: {
  operationBatchId: string
  documentKey: string
  formulaCount: number
  headingCount: number
  structureRevision: number
  semanticSignature: string
}): void {
  emitRuntimeAudit('FORMULA-EVENT-DRIVEN-SNAPSHOT', {
    operationBatchId: input.operationBatchId,
    documentKey: input.documentKey,
    formulaCount: input.formulaCount,
    headingCount: input.headingCount,
    structureRevision: input.structureRevision,
    semanticSignature: input.semanticSignature,
    decision: 'RECORDED',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

// ── Accounting ─────────────────────────────────────────────────────────

export interface EventDrivenAccountingInput {
  operationBatchId: string
  affectedCount: number
  completedCount: number
  pendingCount: number
  blockedCount: number
  failedCount: number
  safeSkippedCount: number
  unresolvedCount: number
}

export function emitEventDrivenAccounting(input: EventDrivenAccountingInput): void {
  const decision = input.unresolvedCount === 0 ? 'PASS' : 'INCOMPLETE'
  emitRuntimeAudit('FORMULA-EVENT-DRIVEN-ACCOUNTING', {
    operationBatchId: input.operationBatchId,
    affectedCount: input.affectedCount,
    completedCount: input.completedCount,
    pendingCount: input.pendingCount,
    blockedCount: input.blockedCount,
    failedCount: input.failedCount,
    safeSkippedCount: input.safeSkippedCount,
    unresolvedCount: input.unresolvedCount,
    decision,
    reason: decision === 'PASS' ? null : 'UNRESOLVED_AFFECTED_FORMULAS',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

// ── Quiescence ─────────────────────────────────────────────────────────

export function emitEventDrivenQuiescence(input: {
  observationWindowMs: number
  semanticEventCount: number
  formulaScanCount: number
  affectedSetBuildCount: number
  refreshRequestCount: number
  periodicTimerCount: number
}): void {
  const idle = input.semanticEventCount === 0 && input.affectedSetBuildCount === 0 && input.refreshRequestCount === 0 && input.periodicTimerCount === 0
  emitRuntimeAudit('FORMULA-EVENT-DRIVEN-QUIESCENCE', {
    observationWindowMs: input.observationWindowMs,
    semanticEventCount: input.semanticEventCount,
    formulaScanCount: input.formulaScanCount,
    affectedSetBuildCount: input.affectedSetBuildCount,
    refreshRequestCount: input.refreshRequestCount,
    periodicTimerCount: input.periodicTimerCount,
    decision: idle ? 'PASS' : 'BUSY',
    reason: idle ? null : 'ONGOING_ACTIVITY',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}

// ── Final Marker ──────────────────────────────────────────────────────

export interface EventDrivenFinalInput {
  documentKey: string
  semanticOperationBatchCount: number
  formulaEventCount: number
  headingEventCount: number
  dependencyRangeBuildCount: number
  affectedFormulaTotal: number
  newFormulaFastPathPassCount: number
  targetedExistingRefreshRequestCount: number
  targetedExistingRefreshPassCount: number
  headingChangeAffectedFormulaCount: number
  headingChangeRefreshPassCount: number
  unaffectedFormulaRefreshCount: number
  rendererFeedbackLoopCount: number
  periodicTimerCount: number
  idleSemanticEventCount: number
  idleRefreshRequestCount: number
  allDesiredTagsVisible: boolean
  duplicateOutputCount: number
  sourceMutationDetected: boolean
}

export function emitEventDrivenFinal(input: EventDrivenFinalInput): void {
  const decision = input.allDesiredTagsVisible
    && input.duplicateOutputCount === 0
    && !input.sourceMutationDetected
    && input.rendererFeedbackLoopCount === 0
    && input.periodicTimerCount === 0
    && input.idleSemanticEventCount === 0
    && input.idleRefreshRequestCount === 0
    ? 'PASS'
    : 'PARTIAL'
  emitRuntimeAudit('FORMULA-EVENT-DRIVEN-FINAL', {
    documentKey: input.documentKey,
    semanticOperationBatchCount: input.semanticOperationBatchCount,
    formulaEventCount: input.formulaEventCount,
    headingEventCount: input.headingEventCount,
    dependencyRangeBuildCount: input.dependencyRangeBuildCount,
    affectedFormulaTotal: input.affectedFormulaTotal,
    newFormulaFastPathPassCount: input.newFormulaFastPathPassCount,
    targetedExistingRefreshRequestCount: input.targetedExistingRefreshRequestCount,
    targetedExistingRefreshPassCount: input.targetedExistingRefreshPassCount,
    headingChangeAffectedFormulaCount: input.headingChangeAffectedFormulaCount,
    headingChangeRefreshPassCount: input.headingChangeRefreshPassCount,
    unaffectedFormulaRefreshCount: input.unaffectedFormulaRefreshCount,
    rendererFeedbackLoopCount: input.rendererFeedbackLoopCount,
    periodicTimerCount: input.periodicTimerCount,
    idleSemanticEventCount: input.idleSemanticEventCount,
    idleRefreshRequestCount: input.idleRefreshRequestCount,
    allDesiredTagsVisible: input.allDesiredTagsVisible,
    duplicateOutputCount: input.duplicateOutputCount,
    sourceMutationDetected: input.sourceMutationDetected,
    decision,
    reason: decision === 'PASS' ? null : 'EVENT_DRIVEN_CLOSURE_INCOMPLETE',
    runtimeMarker: R543_RUNTIME_MARKER,
  })
}