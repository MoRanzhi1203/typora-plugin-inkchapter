/**
 * Caption Deferred Retry State Machine (Phase 7R.3.9)
 *
 * Stops the unbounded `caption-deferred-candidate` hot loop:
 *
 *   COMPLETE                                  → IDLE
 *   first transient X (stateToken X, failure Y)
 *     → KEEP_PREVIOUS_COMPLETE_SET
 *     → FOLLOW_UP_ALLOWED (ONE coalesced follow-up)
 *   follow-up COMPLETE                        → IDLE
 *   follow-up same X + same Y                 → PARKED
 *
 * PARKED never self-wakes. Only a REAL authority change
 * (documentKey / editorStructureEpoch / heading semantic fingerprint /
 * canonical heading frame fingerprint / canonical target fingerprint /
 * settings semantic signature) releases the parked state.
 *
 * A hot-loop fuse forces PARK when the same stateToken + failureSignature
 * runs a full reconcile more than 2 consecutive times.
 *
 * Pure state logic — no timers, no wall-clock, no retry counters in the token.
 */

import { fastHash } from './numbering-fast-path'

/** Deterministic authorities that can genuinely change the Caption result. */
export interface CaptionReconcileStateTokenInput {
  documentKey: string | null
  editorStructureEpoch: number
  headingSemanticFingerprint: string
  canonicalHeadingFrameFingerprint: string
  canonicalTargetFingerprint: string
  settingsSemanticSignature: string
}

/** One deterministic state token. NO timestamp / retry counter / no-op generation. */
export function buildCaptionReconcileStateToken(input: CaptionReconcileStateTokenInput): string {
  return fastHash(
    `${input.documentKey ?? ''}|${input.editorStructureEpoch}|` +
    `${input.headingSemanticFingerprint}|${input.canonicalHeadingFrameFingerprint}|` +
    `${input.canonicalTargetFingerprint}|${input.settingsSemanticSignature}`,
  )
}

/** Canonical target fingerprint from the ordered target types (document-aware). */
export function buildCaptionTargetFingerprint(targetTypes: readonly string[]): string {
  return fastHash(targetTypes.join(','))
}

/** Transient failure signature: stateToken + unresolved shape. */
export function buildCaptionFailureSignature(
  stateToken: string,
  unresolvedTargetCount: number,
  unresolvedReasonFingerprint: string,
  unresolvedIdentityFingerprint: string,
): string {
  return fastHash(`${stateToken}|${unresolvedTargetCount}|${unresolvedReasonFingerprint}|${unresolvedIdentityFingerprint}`)
}

export type CaptionDeferredRetryState =
  | { state: 'IDLE' }
  | { state: 'FOLLOW_UP_ALLOWED'; stateToken: string; failureSignature: string }
  | { state: 'PARKED'; stateToken: string; failureSignature: string }

export type CaptionDeferredRetryDecision =
  | 'COMPLETE_TO_IDLE'
  | 'ALLOW_ONE_FOLLOW_UP'
  | 'PARK'
  | 'IGNORE_PARKED_SAME_STATE'
  | 'HOT_LOOP_FUSE_PARK'

export interface CaptionDeferredRetryGateCounters {
  deferredTimerPollingCount: number
  parkedStateSelfWakeCount: number
  hotLoopGuardTriggeredCount: number
  maxFollowUpPerUnchangedStateToken: number
  followUpCount: number
  parkedCount: number
}

const ZERO_GATES: CaptionDeferredRetryGateCounters = {
  deferredTimerPollingCount: 0,
  parkedStateSelfWakeCount: 0,
  hotLoopGuardTriggeredCount: 0,
  maxFollowUpPerUnchangedStateToken: 1,
  followUpCount: 0,
  parkedCount: 0,
}

export class CaptionDeferredRetryController {
  private state: CaptionDeferredRetryState = { state: 'IDLE' }
  private gates: CaptionDeferredRetryGateCounters = { ...ZERO_GATES }
  /** Hot-loop fuse: consecutive full reconciles for one token+failureSignature. */
  private consecutiveFullReconciles = 0
  private lastSeenToken: string | null = null
  private lastSeenFailureSignature: string | null = null

  getState(): CaptionDeferredRetryState {
    return this.state
  }

  getGateCounters(): CaptionDeferredRetryGateCounters {
    return { ...this.gates }
  }

  /**
   * Record that a full reconcile ran for the given token+failureSignature.
   * The fuse force-parks after >2 consecutive identical full reconciles.
   */
  recordFullReconcile(token: string, failureSignature: string | null): void {
    if (token === this.lastSeenToken && failureSignature !== null && failureSignature === this.lastSeenFailureSignature) {
      this.consecutiveFullReconciles++
    } else {
      this.consecutiveFullReconciles = 1
      this.lastSeenToken = token
      this.lastSeenFailureSignature = failureSignature
    }
  }

  /** Complete candidate → IDLE, reset per-token follow-up budget. */
  markComplete(): void {
    this.state = { state: 'IDLE' }
    this.consecutiveFullReconciles = 0
  }

  /** Document switch: clear parked/follow-up state; never leak across docs. */
  resetForDocument(): void {
    this.state = { state: 'IDLE' }
    this.consecutiveFullReconciles = 0
    this.lastSeenToken = null
    this.lastSeenFailureSignature = null
  }

  /**
   * Decide the retry action for a deferred (incomplete) candidate.
   * Called exactly once per deferred candidate pass.
   */
  decide(token: string, failureSignature: string): CaptionDeferredRetryDecision {
    // Hot-loop fuse: independent of the normal state machine.
    if (this.consecutiveFullReconciles > 2 && this.lastSeenToken === token && this.lastSeenFailureSignature === failureSignature) {
      this.gates.hotLoopGuardTriggeredCount++
      this.state = { state: 'PARKED', stateToken: token, failureSignature }
      this.gates.parkedCount++
      return 'HOT_LOOP_FUSE_PARK'
    }

    switch (this.state.state) {
      case 'IDLE':
        // First transient failure for this state: allow ONE follow-up.
        this.state = { state: 'FOLLOW_UP_ALLOWED', stateToken: token, failureSignature }
        this.gates.followUpCount++
        return 'ALLOW_ONE_FOLLOW_UP'

      case 'FOLLOW_UP_ALLOWED':
        if (this.state.stateToken === token && this.state.failureSignature === failureSignature) {
          // Follow-up returned the same transient state → park, no third attempt.
          this.state = { state: 'PARKED', stateToken: token, failureSignature }
          this.gates.parkedCount++
          return 'PARK'
        }
        // Authority changed between passes → treat as a fresh transient cycle.
        this.state = { state: 'FOLLOW_UP_ALLOWED', stateToken: token, failureSignature }
        this.gates.followUpCount++
        return 'ALLOW_ONE_FOLLOW_UP'

      case 'PARKED':
        if (this.state.stateToken === token && this.state.failureSignature === failureSignature) {
          // Same parked state: must NOT self-wake.
          this.gates.parkedStateSelfWakeCount++
          return 'IGNORE_PARKED_SAME_STATE'
        }
        // Real authority change → release the park.
        this.state = { state: 'FOLLOW_UP_ALLOWED', stateToken: token, failureSignature }
        this.gates.followUpCount++
        return 'ALLOW_ONE_FOLLOW_UP'
    }
  }
}

/** Escape hatch for diagnostics — mark timer-based polling if ever reintroduced. */
export function recordCaptionDeferTimerPolling(counters: Pick<CaptionDeferredRetryGateCounters, 'deferredTimerPollingCount'>): void {
  counters.deferredTimerPollingCount++
}
