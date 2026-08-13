/**
 * R58.7 Post-TEXT_INPUT Selection Stability — pure observation lifecycle.
 *
 * This module owns ONLY the read-only forensic state machine. It never touches
 * Selection / DOM. The service owns DOM sampling (resolveSelectionTruth) and the
 * timer scheduling; this class owns state + counters + transition invariants so
 * the lifecycle is unit-testable (PL-1..PL-5) without any editor DOM.
 */

export type PostTextInputCancelReason =
  | 'SUPERSEDED_BY_NEW_ARM'
  | 'NEW_REAL_INTENT'
  | 'SCOPE_CHANGED'
  | 'EDITOR_UNBOUND'
  | 'UNLOAD'

export type PostTextInputAcceptance = 'ACCEPT' | 'FOREIGN_BLOCK' | 'NO_ACTIVE'

export interface PostTextInputObservationArmInput {
  inputIntentId: string
  intentEpoch: number
  inputType: string
  scopeId: string
  editorInstanceId: string
  compositionSessionId: string
  supersededExpectationId: string
  supersededExpectationEpoch: number
  selectionWriteCounterAtInput: number
  caretRestoreCounterAtInput: number
  caretRepairCounterAtInput: number
  rehydratePlanCounterAtInput: number
  rehydrateApplyCounterAtInput: number
  rehydrateDomWriteCounterAtInput: number
}

export interface PostTextInputObservationState {
  observationId: string
  generation: number
  inputIntentId: string
  intentEpoch: number
  inputType: string
  scopeId: string
  editorInstanceId: string
  compositionSessionId: string
  supersededExpectationId: string
  supersededExpectationEpoch: number
  selectionWriteCounterAtInput: number
  caretRestoreCounterAtInput: number
  caretRepairCounterAtInput: number
  rehydratePlanCounterAtInput: number
  rehydrateApplyCounterAtInput: number
  rehydrateDomWriteCounterAtInput: number
  armedAt: number
  committed: boolean
  commitAnchor: string
  completed: boolean
  pendingCallbackCount: number
}

/**
 * Pure, single-instance lifecycle for the post-TEXT_INPUT stability probe.
 * maxActiveObservation=1 is enforced by arm() cancelling any existing active observation.
 */
export class PostTextInputObservationLifecycle {
  private active: PostTextInputObservationState | null = null
  private generation = 0
  private seq = 0

  private _completeCount = 0
  private _foreignInputAcceptedCount = 0
  private _foreignInputBlockedCount = 0
  private _staleCallbackExecutedCount = 0
  private _staleCallbackDroppedCount = 0
  private _activeObservationPeak = 0

  get activeObservation(): PostTextInputObservationState | null {
    return this.active
  }

  get currentGeneration(): number {
    return this.generation
  }

  get activeObservationAfterComplete(): string {
    return this.active ? this.active.observationId : 'none'
  }

  get completeCount(): number {
    return this._completeCount
  }

  get foreignInputAcceptedCount(): number {
    return this._foreignInputAcceptedCount
  }

  get foreignInputBlockedCount(): number {
    return this._foreignInputBlockedCount
  }

  get staleCallbackExecutedCount(): number {
    return this._staleCallbackExecutedCount
  }

  get staleCallbackDroppedCount(): number {
    return this._staleCallbackDroppedCount
  }

  get activeObservationPeak(): number {
    return this._activeObservationPeak
  }

  /** Arm exactly one observation; cancels any previous active observation first. */
  arm(input: PostTextInputObservationArmInput): PostTextInputObservationState {
    if (this.active) {
      this.cancel('SUPERSEDED_BY_NEW_ARM')
    }
    this.generation++
    this._activeObservationPeak = Math.max(this._activeObservationPeak, 1)
    const obs: PostTextInputObservationState = {
      observationId: `ptsi-${++this.seq}`,
      generation: this.generation,
      ...input,
      armedAt: Date.now(),
      committed: false,
      commitAnchor: '',
      completed: false,
      pendingCallbackCount: 0,
    }
    this.active = obs
    return obs
  }

  cancel(_reason: PostTextInputCancelReason): void {
    if (!this.active) return
    this.active = null
  }

  /** Mark the active observation committed at a given anchor. Returns false if none/duplicate. */
  commit(anchor: string): boolean {
    const obs = this.active
    if (!obs || obs.committed) return false
    obs.committed = true
    obs.commitAnchor = anchor
    return true
  }

  /** Reserve one scheduled async callback (microtask/RAF/timeout). */
  scheduleCallback(obs: PostTextInputObservationState): void {
    if (this.active !== obs) return
    obs.pendingCallbackCount++
  }

  /** Release one async callback after it fires. */
  onCallbackFired(obs: PostTextInputObservationState): void {
    if (obs.pendingCallbackCount > 0) {
      obs.pendingCallbackCount--
    }
  }

  /** Terminally complete the active committed observation. Returns null if not committed. */
  complete(): PostTextInputObservationState | null {
    const obs = this.active
    if (!obs || !obs.committed || obs.completed) return null
    obs.completed = true
    this.active = null
    this._completeCount++
    return obs
  }

  /**
   * Callback gate: observationId/generation/scopeId/editorInstanceId must all match.
   * A stale callback never reads/writes editor.
   */
  isCurrent(
    obs: PostTextInputObservationState,
    generation: number,
    scopeId: string,
    editorInstanceId: string,
  ): boolean {
    return (
      this.active === obs &&
      obs.generation === generation &&
      obs.scopeId === scopeId &&
      obs.editorInstanceId === editorInstanceId
    )
  }

  /** Foreign input isolation: a T_INPUT_EVENT from a different composition session is ignored. */
  acceptInputEvent(eventCompositionSessionId: string): PostTextInputAcceptance {
    const obs = this.active
    if (!obs) return 'NO_ACTIVE'
    if (obs.compositionSessionId !== eventCompositionSessionId) {
      this._foreignInputBlockedCount++
      return 'FOREIGN_BLOCK'
    }
    return 'ACCEPT'
  }

  markStaleCallbackExecuted(): void {
    this._staleCallbackExecutedCount++
  }

  markStaleCallbackDropped(): void {
    this._staleCallbackDroppedCount++
  }
}
