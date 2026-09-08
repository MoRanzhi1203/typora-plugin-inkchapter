/**
 * V3 — Active Document Readiness Barrier (pure).
 *
 * A diagnostics result is only FINAL when the document has crossed the full
 * readiness barrier:
 *
 *   INACTIVE → WAITING_IDENTITY → WAITING_EDITOR → WAITING_SOURCE
 *   → WAITING_CANONICAL → READY    (STALE on identity/epoch drift)
 *
 * FINAL commit additionally requires readiness === READY; a pre-ready FINAL
 * attempt is discarded (DISCARD_PRE_READY_FINAL_COMMIT). Every other stale
 * combination is discarded as DISCARD_STALE_DIAGNOSTICS_RESULT.
 */

export type ActiveDocumentReadinessState =
  | 'INACTIVE'
  | 'WAITING_IDENTITY'
  | 'WAITING_EDITOR'
  | 'WAITING_SOURCE'
  | 'WAITING_CANONICAL'
  | 'READY'
  | 'STALE'

export interface ReadinessFacts {
  presenceActive: boolean
  identityMatch: boolean
  editorRootConnected: boolean
  sourceAvailable: boolean
  canonicalReady: boolean
  stale: boolean
}

/** Pure readiness computation for the CURRENT active document. */
export function computeActiveDocumentReadiness(f: ReadinessFacts): ActiveDocumentReadinessState {
  if (f.stale) return 'STALE'
  if (!f.presenceActive) return 'INACTIVE'
  if (!f.identityMatch) return 'WAITING_IDENTITY'
  if (!f.editorRootConnected) return 'WAITING_EDITOR'
  if (!f.sourceAvailable) return 'WAITING_SOURCE'
  if (!f.canonicalReady) return 'WAITING_CANONICAL'
  return 'READY'
}

export type DiagnosticsCommitDecision =
  | 'COMMIT'
  | 'DISCARD_STALE_DIAGNOSTICS_RESULT'
  | 'DISCARD_PRE_READY_FINAL_COMMIT'
  | 'DISCARD_PRESENCE_INACTIVE'

export interface DiagnosticsCommitGateInput {
  snapshotDocumentKey: string | null
  currentDocumentKey: string | null
  snapshotEpoch: number
  currentEpoch: number
  presenceActive: boolean
  readiness: ActiveDocumentReadinessState
  /** When true the caller claims this is a FINAL commit (requires READY). */
  finalRequired?: boolean
}

/** V3 commit gate — docKey + epoch + ACTIVE always; FINAL additionally READY. */
export function evaluateDiagnosticsCommitGate(i: DiagnosticsCommitGateInput): {
  commit: boolean
  decision: DiagnosticsCommitDecision
  reason: string
} {
  if (!i.presenceActive) {
    return { commit: false, decision: 'DISCARD_PRESENCE_INACTIVE', reason: 'PRESENCE_NOT_ACTIVE' }
  }
  if (i.snapshotDocumentKey !== i.currentDocumentKey) {
    return { commit: false, decision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'DOCUMENT_IDENTITY_MISMATCH' }
  }
  if (i.snapshotEpoch !== i.currentEpoch) {
    return { commit: false, decision: 'DISCARD_STALE_DIAGNOSTICS_RESULT', reason: 'DOCUMENT_EPOCH_MISMATCH' }
  }
  if (i.finalRequired && i.readiness !== 'READY') {
    return { commit: false, decision: 'DISCARD_PRE_READY_FINAL_COMMIT', reason: 'READINESS_NOT_READY' }
  }
  return { commit: true, decision: 'COMMIT', reason: 'COMMIT_ALLOWED' }
}
