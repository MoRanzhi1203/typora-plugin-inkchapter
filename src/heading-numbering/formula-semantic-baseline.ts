/**
 * v2.5.7-R5.4.3.2 Semantic Baseline Hydration + Formula-only Refresh + New Formula Fast-path Restore
 *
 * Provides baseline state machine, audit markers, and fast-path restore for formula semantic
 * hydration in the inkchapter heading-numbering subsystem.
 *
 * @module formula-semantic-baseline
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

// ---------------------------------------------------------------------------
// Build markers
// ---------------------------------------------------------------------------

export const R5432_RUNTIME_MARKER = 'FORMULA-BASELINE-FASTPATH-RESTORE-V2.5.7-R5.4.3.2'
export const R5432_BUILD_MARKER = 'inkchapter-formula-baseline-fastpath-restore-v2.5.7-r5.4.3.2'

// ---------------------------------------------------------------------------
// Baseline state machine
// ---------------------------------------------------------------------------

export type BaselineState = 'NO_DOCUMENT' | 'NO_ROOT' | 'CONTEXT_NOT_READY' | 'HYDRATING' | 'READY' | 'STALE'

let currentBaselineState: BaselineState = 'NO_DOCUMENT'
let baselineDocumentKey: string | null = null
let baselineDocumentGeneration = 0
let baselineEditorRootToken = 0
let baselineFormulaRevision = 0
let baselineHeadingRevision = 0
let consecutiveDeferCount = 0

export function resetBaselineState(): void {
  currentBaselineState = 'NO_DOCUMENT'
  baselineDocumentKey = null
  baselineDocumentGeneration = 0
  baselineEditorRootToken = 0
  baselineFormulaRevision = 0
  baselineHeadingRevision = 0
  consecutiveDeferCount = 0
}

export function getBaselineState(): BaselineState { return currentBaselineState }
export function getBaselineDocumentKey(): string | null { return baselineDocumentKey }
export function getBaselineDocumentGeneration(): number { return baselineDocumentGeneration }
export function getBaselineFormulaRevision(): number { return baselineFormulaRevision }

// ---------------------------------------------------------------------------
// emitBaselineState
// ---------------------------------------------------------------------------

export function emitBaselineState(
  stateBefore: BaselineState,
  stateAfter: BaselineState,
  hydrationAttempted: boolean,
  hydrationSucceeded: boolean,
  dispatchAllowed: boolean,
): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SEMANTIC-BASELINE-STATE',
    stateBefore,
    stateAfter,
    hydrationAttempted,
    hydrationSucceeded,
    dispatchAllowed,
  })
}

// ---------------------------------------------------------------------------
// hydrateBaselineFromLiveSnapshot
// ---------------------------------------------------------------------------

export function hydrateBaselineFromLiveSnapshot(input: {
  documentKey: string
  documentGeneration: number
  editorRootToken: number
  sourceFormulaSnapshotAvailable: boolean
  sourceFormulaSnapshotRevision: number
  sourceFormulaCount: number
  sourceManagedFormulaCount: number
  sourceSemanticSignature: string
  sourceHeadingSnapshotAvailable: boolean
  sourceHeadingSnapshotRevision: number
}): 'HYDRATED' | 'STALE' | 'SKIP' {
  const stateBefore = currentBaselineState

  // Check if same document / generation / root
  if (
    baselineDocumentKey === input.documentKey &&
    baselineDocumentGeneration === input.documentGeneration &&
    baselineEditorRootToken === input.editorRootToken
  ) {
    emitRuntimeAudit(R5432_RUNTIME_MARKER, {
      marker: 'FORMULA-SEMANTIC-BASELINE-HYDRATION',
      ...input,
      decision: 'SKIP',
      reason: 'already_hydrated_same_snapshot',
    })
    return 'SKIP'
  }

  // Detect stale baseline
  if (
    baselineDocumentKey !== null &&
    baselineDocumentKey !== input.documentKey
  ) {
    currentBaselineState = 'STALE'
    emitBaselineState(stateBefore, 'STALE', true, false, false)
    emitRuntimeAudit(R5432_RUNTIME_MARKER, {
      marker: 'FORMULA-SEMANTIC-BASELINE-HYDRATION',
      ...input,
      decision: 'STALE',
      reason: 'document_key_mismatch',
    })
    return 'STALE'
  }

  // Hydrate
  baselineDocumentKey = input.documentKey
  baselineDocumentGeneration = input.documentGeneration
  baselineEditorRootToken = input.editorRootToken
  baselineFormulaRevision = input.sourceFormulaSnapshotRevision
  currentBaselineState = 'READY'
  consecutiveDeferCount = 0

  const stateAfter = currentBaselineState
  emitBaselineState(stateBefore, stateAfter, true, true, true)

  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SEMANTIC-BASELINE-HYDRATION',
    ...input,
    decision: 'HYDRATED',
    reason: null,
  })

  return 'HYDRATED'
}

// ---------------------------------------------------------------------------
// checkContextGate
// ---------------------------------------------------------------------------

export function checkContextGate(input: {
  documentKey: string | null
  documentGeneration: number
  editorRootAvailable: boolean
  editorRootConnected: boolean
  businessReady: boolean
  liveSnapshotAvailable: boolean
  liveSnapshotDocumentKey: string | null
  liveSnapshotGeneration: number
  liveSnapshotFormulaCount: number
}): { decision: 'ALLOW' | 'DEFER_BASELINE' | 'DROP_NO_DOCUMENT' | 'DROP_NO_ROOT' | 'DROP_STALE' | 'HYDRATING'; reason: string | null } {
  // No documentKey
  if (input.documentKey === null) {
    currentBaselineState = 'NO_DOCUMENT'
    return { decision: 'DROP_NO_DOCUMENT', reason: null }
  }

  // No editor root or disconnected
  if (!input.editorRootAvailable || !input.editorRootConnected) {
    currentBaselineState = 'NO_ROOT'
    return { decision: 'DROP_NO_ROOT', reason: null }
  }

  // Not business ready
  if (!input.businessReady) {
    currentBaselineState = 'CONTEXT_NOT_READY'
    return { decision: 'DEFER_BASELINE', reason: null }
  }

  // READY but doc/generation changed
  if (currentBaselineState === 'READY') {
    if (
      baselineDocumentKey !== input.documentKey ||
      baselineDocumentGeneration !== input.documentGeneration
    ) {
      currentBaselineState = 'STALE'
      return { decision: 'DROP_STALE', reason: null }
    }
    // Same doc – allow
    return { decision: 'ALLOW', reason: null }
  }

  // HYDRATING – check if snapshot is now available
  if (currentBaselineState === 'HYDRATING') {
    if (
      input.liveSnapshotAvailable &&
      input.liveSnapshotDocumentKey === input.documentKey &&
      input.liveSnapshotGeneration === input.documentGeneration
    ) {
      currentBaselineState = 'READY'
      consecutiveDeferCount = 0
      return { decision: 'ALLOW', reason: null }
    }
    return { decision: 'HYDRATING', reason: null }
  }

  // Not READY and live snapshot exists with same doc
  if (
    input.liveSnapshotAvailable &&
    input.liveSnapshotDocumentKey === input.documentKey
  ) {
    currentBaselineState = 'HYDRATING'
    return { decision: 'HYDRATING', reason: null }
  }

  // Deadlock detection
  consecutiveDeferCount++
  if (consecutiveDeferCount > 1 && input.liveSnapshotAvailable) {
    return { decision: 'DEFER_BASELINE', reason: 'BASELINE_HYDRATION_DEADLOCK' }
  }
  if (consecutiveDeferCount > 3) {
    return { decision: 'DEFER_BASELINE', reason: 'BASELINE_HYDRATION_DEADLOCK' }
  }

  return { decision: 'DEFER_BASELINE', reason: null }
}

// ---------------------------------------------------------------------------
// emitPrebaselineBuffer
// ---------------------------------------------------------------------------

export function emitPrebaselineBuffer(input: {
  mutationBatchId: string | null
  documentKey: string | null
  documentGeneration: number
  baselineReadyAtArrival: boolean
  authoritativePreviousFormulaSnapshotAvailable: boolean
  buffered: boolean
  replayed: boolean
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SEMANTIC-PREBASELINE-BUFFER',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// Formula-only refresh counter
// ---------------------------------------------------------------------------

let formulaOnlyRefreshCount = 0

export function getFormulaOnlyRefreshCount(): number { return formulaOnlyRefreshCount }

// ---------------------------------------------------------------------------
// emitFormulaOnlyRefresh
// ---------------------------------------------------------------------------

export function emitFormulaOnlyRefresh(input: {
  operationBatchId: string
  documentKey: string | null
  documentGeneration: number
  reason: string
  canonicalFormulaCountBefore: number
  canonicalFormulaCountAfter: number
  managedFormulaCountBefore: number
  managedFormulaCountAfter: number
  liveFormulaRevisionBefore: number
  liveFormulaRevisionAfter: number
  semanticSignatureBefore: string
  semanticSignatureAfter: string
  authorizationPlanRevisionBefore: number
  authorizationPlanRevisionAfter: number
  tableScanCount: number
  figureScanCount: number
  codeScanCount: number
  globalCaptionRefreshCount: number
}): void {
  formulaOnlyRefreshCount++
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-ONLY-SEMANTIC-REFRESH',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitEditingHostCanonicalResolve
// ---------------------------------------------------------------------------

export function emitEditingHostCanonicalResolve(input: {
  editingNodeToken: number
  editingNodeTag: string
  editingNodeClass: string
  connected: boolean
  ancestorDepth: number
  candidateHostToken: number | null
  candidateHostTag: string | null
  candidateHostClass: string | null
  candidateIsCanonicalFormulaHost: boolean
  currentCanonicalSetContainsHost: boolean
  currentCanonicalSetFormulaIndex: number | null
  stableFormulaIdentity: number | null
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-EDITING-HOST-CANONICAL-RESOLVE',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitNewHostAdoptionAuthority
// ---------------------------------------------------------------------------

export function emitNewHostAdoptionAuthority(input: {
  oldCanonicalFormulaCount: number
  currentCanonicalFormulaCount: number
  editingCandidateCount: number
  oldSetContainsEditingHost: boolean
  newConnectedCanonicalCandidateCount: number
  uniqueNewCandidate: boolean
  adoptedStableFormulaIdentity: number | null
  formulaIndex: number | null
  desiredTag: string | null
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-NEW-HOST-ADOPTION-AUTHORITY',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitPreCallPlanCatchup
// ---------------------------------------------------------------------------

export function emitPreCallPlanCatchup(input: {
  callOrdinal: number
  inputHash: string
  documentKey: string | null
  documentGeneration: number
  editingCandidatePresent: boolean
  editingHostResolveBefore: boolean
  planEntryBefore: boolean
  formulaCountBefore: number
  managedFormulaCountBefore: number
  catchupAttempted: boolean
  catchupCompleted: boolean
  editingHostResolveAfter: boolean
  planEntryAfter: boolean
  formulaCountAfter: number
  managedFormulaCountAfter: number
  stableFormulaIdentityAfter: number | null
  formulaIndexAfter: number | null
  desiredTagAfter: string | null
  sameCurrentCallReauthorized: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'MATHJAX-TEX2SVG-PRECALL-PLAN-CATCHUP',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitSameCallReauthorization
// ---------------------------------------------------------------------------

export function emitSameCallReauthorization(input: {
  callOrdinal: number
  authorityBefore: string
  authorityAfter: string
  stableFormulaIdentity: number | null
  formulaIndex: number | null
  desiredTag: string | null
  sourceAuthorityMatched: boolean
  managedEligible: boolean
  explicitTagControl: boolean
  authorized: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'MATHJAX-TEX2SVG-SAME-CALL-REAUTHORIZATION',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitSnapshotDiffOrderAuthority
// ---------------------------------------------------------------------------

export function emitSnapshotDiffOrderAuthority(input: {
  previousSnapshotToken: number
  nextSnapshotToken: number
  sameObjectReference: boolean
  previousSemanticSignature: string
  nextSemanticSignature: string
  diffComputedBeforeCommit: boolean
  commitAfterDiff: boolean
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SNAPSHOT-DIFF-ORDER-AUTHORITY',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitLiveRevisionRestoreAuthority
// ---------------------------------------------------------------------------

export function emitLiveRevisionRestoreAuthority(input: {
  reason: string
  previousFormulaCount: number
  currentFormulaCount: number
  previousLiveFormulaRevision: number
  nextLiveFormulaRevision: number
  semanticChanged: boolean
  decision: string
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-LIVE-REVISION-RESTORE-AUTHORITY',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitFormulaAddedSnapshotClosure
// ---------------------------------------------------------------------------

export function emitFormulaAddedSnapshotClosure(input: {
  operationBatchId: string
  previousFormulaCount: number
  currentFormulaCount: number
  addedStableFormulaIdentity: number | null
  oldPresent: boolean
  newPresent: boolean
  authorityKind: string
  formulaIndex: number | null
  desiredTag: string | null
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-ADDED-SNAPSHOT-CLOSURE',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitNewNaturalRenderClosure
// ---------------------------------------------------------------------------

export function emitNewNaturalRenderClosure(input: {
  liveFormulaRevision: number
  stableFormulaIdentity: number | null
  formulaIndex: number | null
  naturalTex2svgCallObserved: boolean
  preCallCatchupAttempted: boolean
  preCallCatchupCompleted: boolean
  sameCallAuthorized: boolean
  desiredTag: string | null
  injectionObserved: boolean
  fulfillmentObserved: boolean
  exactFulfillmentIdentity: boolean
  visibleTag: string | null
  expectedVisibleTag: string | null
  duplicateOutputCount: number
  pluginSourceWriteCount: number
  decision: string
  reason: string | null
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-NEW-NATURAL-RENDER-CLOSURE',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// emitBaselineFastpathRestoreFinal
// ---------------------------------------------------------------------------

export function emitBaselineFastpathRestoreFinal(input: {
  documentKey: string | null
  documentGeneration: number
  baselineHydrated: boolean
  baselineSourceFormulaRevision: number
  recoverableDeferBaselineCount: number
  formulaOnlyRefreshCount: number
  globalCaptionRefreshFromFormulaEventCount: number
  oldFormulaCount: number
  newFormulaCount: number
  oldManagedFormulaCount: number
  newManagedFormulaCount: number
  liveFormulaRevisionBefore: number
  liveFormulaRevisionAfter: number
  newStableFormulaIdentity: number | null
  newFormulaIndex: number | null
  newDesiredTag: string | null
  editingHostResolved: boolean
  newHostAdopted: boolean
  preCallCatchupAttempted: boolean
  preCallCatchupCompleted: boolean
  sameCurrentCallReauthorized: boolean
  newFormulaInjectionObserved: boolean
  newFormulaVisibleTagMatched: boolean
  formulaAddedSnapshotDiffObserved: boolean
  snapshotDiffOrderingPass: boolean
  existingFormulaAffectedDetected: boolean
  existingFormulaTargetedRefreshAuthority: string
  runtimeUndefinedTypeErrorCount: number
  invalidObjectTargetCount: number
  rendererFeedbackLoopCount: number
  periodicTimerCount: number
  sourceMutationDetected: boolean
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-BASELINE-FASTPATH-RESTORE-FINAL',
    ...input,
  })
}

// ---------------------------------------------------------------------------
// R5.4.3.4: Shared-scope Sequence Ledger + Sequence Projection Authority
// ---------------------------------------------------------------------------

export function emitSharedScopeSequenceLedger(input: {
  documentKey: string | null
  documentGeneration: number
  editorRootToken: number
  scopeKey: string
  scopeKind: string
  formulaCountInScope: number
  formulaStableIdentities: Array<number | 'AMBIGUOUS' | null>
  sequenceValues: number[]
  resetAppliedFlags: boolean[]
  monotonic: boolean
  duplicateSequenceCount: number
  decision: 'PASS' | 'FAIL'
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SHARED-SCOPE-SEQUENCE-LEDGER',
    ...input,
  })
}

export function emitSequenceProjectionAuthority(input: {
  documentKey: string | null
  documentGeneration: number
  reason: string
  formulaCount: number
  scopesWithSequence: number
  duplicateSequenceCount: number
  sharedLedgerUsed: boolean
  decision: 'PASS' | 'FAIL'
}): void {
  emitRuntimeAudit(R5432_RUNTIME_MARKER, {
    marker: 'FORMULA-SEQUENCE-PROJECTION-AUTHORITY',
    ...input,
  })
}