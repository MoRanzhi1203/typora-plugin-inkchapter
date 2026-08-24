/**
 * Caption Heading Authority Gate (Phase 7R.3.9R)
 *
 * Closes CAPTION_RECONCILE_STARTS_BEFORE_CANONICAL_HEADING_AUTHORITY_IS_READY:
 * before the committed CanonicalHeadingFrame exists for the ACTIVE document,
 * Caption must NOT run the expensive pipeline (collectTargets / CODE candidate
 * scan / resolver batch / plan build / retry machine / PARK / hot-loop fuse /
 * projection writes). It records ONE coalesced pending intent instead, and the
 * CanonicalHeadingFrame COMMIT is the single release authority → exactly ONE
 * current-state reconcile.
 *
 * Readiness definition (source of truth = committed frame object, never
 * snapshotRevision >= 0 alone):
 *   READY  ⇔  frame exists  ∧  frame.documentKey === activeDocumentKey
 * A committed frame with entries.length === 0 (valid empty document) is READY.
 *
 * Pure state + counters; the DOM/audit wiring lives in caption-service.
 */

export type CaptionHeadingAuthorityState =
  | { state: 'NO_DOCUMENT' }
  | { state: 'WAITING_FOR_DOCUMENT_CONTEXT' }
  | { state: 'WAITING_FOR_HEADING_AUTHORITY'; documentKey: string }
  | { state: 'READY'; documentKey: string; semanticRevision: number; frameGeneration: number; frameFingerprint: string }

export interface PendingCaptionRefreshIntent {
  documentKey: string
  reasons: Set<string>
  invalidationMask: number
}

export type CaptionAuthorityGateDecision =
  | 'NO_DOCUMENT'
  | 'WAIT'
  | 'READY'
  | 'RELEASED_ONE_RECONCILE'
  | 'RELEASE_IGNORED_WRONG_DOCUMENT'

export interface CaptionAuthorityGateCounters {
  preAuthReconcileRequestCount: number
  preAuthFullScanCount: number
  preAuthTargetDiscoveryCount: number
  preAuthPlanBuildCount: number
  preAuthRetryBudgetConsumeCount: number
  preAuthParkCount: number
  preAuthHotLoopGuardTriggerCount: number
  preAuthCanonicalHostSetTransientTargetCount: number
  authorityWaitTriggerCount: number
  authorityReadyReleaseCount: number
  authorityReadyReleaseReconcileCount: number
}

const ZERO_COUNTERS: CaptionAuthorityGateCounters = {
  preAuthReconcileRequestCount: 0,
  preAuthFullScanCount: 0,
  preAuthTargetDiscoveryCount: 0,
  preAuthPlanBuildCount: 0,
  preAuthRetryBudgetConsumeCount: 0,
  preAuthParkCount: 0,
  preAuthHotLoopGuardTriggerCount: 0,
  preAuthCanonicalHostSetTransientTargetCount: 0,
  authorityWaitTriggerCount: 0,
  authorityReadyReleaseCount: 0,
  authorityReadyReleaseReconcileCount: 0,
}

/** Pure readiness resolution: committed frame + matching document identity. */
export function resolveCaptionHeadingAuthority(
  documentKey: string | null,
  frame: { documentKey: string } | null,
): CaptionHeadingAuthorityState {
  if (!documentKey) return { state: 'NO_DOCUMENT' }
  if (frame && frame.documentKey === documentKey) {
    const f = frame as { documentKey: string; semanticRevision?: number; frameGeneration?: number; frameFingerprint?: string }
    return {
      state: 'READY',
      documentKey,
      semanticRevision: f.semanticRevision ?? -1,
      frameGeneration: f.frameGeneration ?? -1,
      frameFingerprint: f.frameFingerprint ?? '',
    }
  }
  return { state: 'WAITING_FOR_HEADING_AUTHORITY', documentKey }
}

export class CaptionHeadingAuthorityGate {
  private state: CaptionHeadingAuthorityState = { state: 'NO_DOCUMENT' }
  private pendingIntent: PendingCaptionRefreshIntent | null = null
  private counters: CaptionAuthorityGateCounters = { ...ZERO_COUNTERS }

  getState(): CaptionHeadingAuthorityState {
    return this.state
  }

  getPendingIntent(): PendingCaptionRefreshIntent | null {
    return this.pendingIntent
  }

  getCounters(): CaptionAuthorityGateCounters {
    return { ...this.counters }
  }

  /**
   * Decide whether a reconcile request may proceed. Called at the earliest safe
   * point (before collectTargets / resolver / retry). Non-READY states record a
   * coalesced pending intent and return WAIT — the expensive pipeline never runs.
   */
  decide(
    documentKey: string | null,
    frame: { documentKey: string } | null,
    reason: string,
    invalidationMask: number,
  ): { decision: CaptionAuthorityGateDecision; state: CaptionHeadingAuthorityState; intent: PendingCaptionRefreshIntent | null } {
    const readiness = resolveCaptionHeadingAuthority(documentKey, frame)
    if (readiness.state === 'READY') {
      const wasReady = this.state.state === 'READY'
      this.state = readiness
      if (!wasReady) {
        // First transition into READY: consume the coalesced pending intent and
        // release EXACTLY ONE reconcile (the initial projection).
        this.counters.authorityReadyReleaseCount++
        if (this.pendingIntent && this.pendingIntent.documentKey === documentKey) {
          const intent = this.pendingIntent
          this.pendingIntent = null
          this.counters.authorityReadyReleaseReconcileCount++
          return { decision: 'RELEASED_ONE_RECONCILE', state: readiness, intent }
        }
      }
      return { decision: 'READY', state: readiness, intent: null }
    }
    if (readiness.state === 'NO_DOCUMENT') {
      this.state = readiness
      return { decision: 'NO_DOCUMENT', state: readiness, intent: null }
    }
    // WAITING_FOR_HEADING_AUTHORITY (or WAITING_FOR_DOCUMENT_CONTEXT): record ONE
    // coalesced intent — never replay every trigger after authority is ready.
    const waitingKey = readiness.state === 'WAITING_FOR_HEADING_AUTHORITY' || readiness.state === 'WAITING_FOR_DOCUMENT_CONTEXT'
      ? 'documentKey' in readiness ? readiness.documentKey : ''
      : ''
    this.recordPending(waitingKey, reason, invalidationMask)
    // Every pre-authority request is prevented expensive work: the full scan,
    // target discovery, plan build, retry budget, PARK and hot-loop fuse must
    // never run before the heading authority exists. Record them all here so a
    // healthy session can prove they stayed 0.
    this.counters.preAuthReconcileRequestCount++
    this.counters.preAuthFullScanCount++
    this.counters.preAuthTargetDiscoveryCount++
    this.counters.preAuthPlanBuildCount++
    this.counters.preAuthRetryBudgetConsumeCount++
    this.counters.preAuthParkCount++
    this.counters.preAuthHotLoopGuardTriggerCount++
    this.counters.preAuthCanonicalHostSetTransientTargetCount++
    this.state = readiness
    return { decision: 'WAIT', state: readiness, intent: null }
  }

  /** Merge a pending refresh intent (latest state wins; reasons unioned). */
  recordPending(documentKey: string, reason: string, invalidationMask: number): void {
    if (!this.pendingIntent || this.pendingIntent.documentKey !== documentKey) {
      this.pendingIntent = {
        documentKey,
        reasons: new Set([reason]),
        invalidationMask,
      }
      this.counters.authorityWaitTriggerCount++
      return
    }
    this.pendingIntent.reasons.add(reason)
    this.pendingIntent.invalidationMask |= invalidationMask
  }

  /**
   * Called when a CanonicalHeadingFrame commits (or via emitCurrent catch-up).
   * The matching-document commit is the SINGLE release authority: it moves the
   * gate to READY and returns the ONE coalesced pending intent to reconcile.
   */
  onFrameCommitted(
    frame: { documentKey: string; semanticRevision?: number; frameGeneration?: number; frameFingerprint?: string } | null,
    activeDocumentKey: string | null,
  ): { decision: CaptionAuthorityGateDecision; intent: PendingCaptionRefreshIntent | null } {
    if (!activeDocumentKey) {
      this.state = { state: 'NO_DOCUMENT' }
      return { decision: 'NO_DOCUMENT', intent: null }
    }
    if (!frame || frame.documentKey !== activeDocumentKey) {
      // A frame for another document (or none) must not release this document.
      return { decision: 'RELEASE_IGNORED_WRONG_DOCUMENT', intent: null }
    }
    const ready: CaptionHeadingAuthorityState = {
      state: 'READY',
      documentKey: frame.documentKey,
      semanticRevision: frame.semanticRevision ?? -1,
      frameGeneration: frame.frameGeneration ?? -1,
      frameFingerprint: frame.frameFingerprint ?? '',
    }
    this.state = ready
    this.counters.authorityReadyReleaseCount++
    if (this.pendingIntent && this.pendingIntent.documentKey === frame.documentKey) {
      const intent = this.pendingIntent
      this.pendingIntent = null
      this.counters.authorityReadyReleaseReconcileCount++
      return { decision: 'RELEASED_ONE_RECONCILE', intent }
    }
    return { decision: 'READY', intent: null }
  }

  /** Document switch A→B: clear A intent, A gate state; start WAITING for B. */
  resetForDocumentSwitch(documentKey: string | null): void {
    this.pendingIntent = null
    this.state = documentKey
      ? { state: 'WAITING_FOR_HEADING_AUTHORITY', documentKey }
      : { state: 'NO_DOCUMENT' }
  }

  /** No active document at all. */
  resetForNoDocument(): void {
    this.pendingIntent = null
    this.state = { state: 'NO_DOCUMENT' }
  }
}
