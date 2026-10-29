/**
 * Navigator one-gesture one-intent state machine.
 *
 * Problem being solved (WC-R2): while Typora's NATIVE word-count panel is open
 * the navigator sits in its avoidance position. The SAME press that hits a
 * navigator button also makes Typora close the panel and restore the caret
 * scroll position. Replaying the scroll from the panel-close callback (one
 * rAF) raced with that restore, so the scroll was silently discarded.
 *
 * Fix: the press only RECORDS an intent. The single execution happens at the
 * END of the physical gesture (document click, or a pointerup fallback) — i.e.
 * after Typora's own click/caret-restore handling has finished. At most one
 * logical navigation intent exists per gesture, no matter how many of
 * pointerdown / mousedown / click / pointerup fire.
 *
 * States:
 *   IDLE -> PRESSED -> ADMITTED -> APPLIED -> (complete -> IDLE)
 *                  \-> CANCELLED (pointercancel / Esc / document switch / root swap / dispose)
 *
 * - PRESSED   : press captured while the native panel was open (deferred).
 * - ADMITTED  : the panel closed; the intent is ready but MUST NOT run yet.
 * - APPLIED   : the single scroll action was handed to the scroll authority.
 * - CANCELLED : the gesture can never execute.
 *
 * The machine is pure (no DOM, no timers): the host owns event wiring, the
 * scroll call and identity freshness checks.
 */

export type NavigatorNavigationAction = 'GO_TOP' | 'GO_BOTTOM'

export type NavigatorGesturePhase = 'IDLE' | 'PRESSED' | 'ADMITTED' | 'APPLIED' | 'CANCELLED'

export type NavigatorGestureCancelReason =
  | 'POINTER_CANCEL'
  | 'ESCAPE'
  | 'DOCUMENT_SWITCH'
  | 'EDITOR_ROOT_REPLACED'
  | 'DISPOSE'
  | 'SUPERSEDED'
  | 'STALE_INTENT'

/** Where the single execution was triggered from (audit only). */
export type NavigatorGestureExecutionSource = 'PRESS' | 'CLICK' | 'KEYBOARD' | 'POINTERUP_FALLBACK'

export interface NavigatorGesture {
  /** Strictly monotonic per host instance (audit identity). */
  id: number
  action: NavigatorNavigationAction
  phase: NavigatorGesturePhase
  /** Document identity captured at press time; execution must match it. */
  documentKey: string | null
  /** Editor scroll container captured at press time (identity freshness). */
  container: HTMLElement | null
  /** True when the native panel was open at press time (intent deferred). */
  panelOpenAtPress: boolean
  startedAt: number
  cancelReason?: NavigatorGestureCancelReason
}

/**
 * Input-intent freshness bound. A press meant to take effect as the panel
 * closes must not be replayed much later; this is NOT a layout-stability wait.
 */
export const NAV_GESTURE_INTENT_TTL_MS = 1500

export class NavigatorIntentMachine {
  private gesture: NavigatorGesture | null = null
  private seq = 0

  /** Current gesture snapshot (copy) or null. */
  get current(): NavigatorGesture | null {
    return this.gesture ? { ...this.gesture } : null
  }

  /**
   * Record a new press. Only ONE logical intent may exist: an unfinished
   * previous gesture is superseded (never merged).
   */
  begin(input: {
    action: NavigatorNavigationAction
    documentKey: string | null
    container: HTMLElement | null
    panelOpen: boolean
    now: number
  }): NavigatorGesture {
    if (this.gesture && (this.gesture.phase === 'PRESSED' || this.gesture.phase === 'ADMITTED')) {
      this.cancel('SUPERSEDED')
    }
    const gesture: NavigatorGesture = {
      id: ++this.seq,
      action: input.action,
      phase: input.panelOpen ? 'PRESSED' : 'ADMITTED',
      documentKey: input.documentKey,
      container: input.container,
      panelOpenAtPress: input.panelOpen,
      startedAt: input.now,
    }
    this.gesture = gesture
    return { ...gesture }
  }

  /**
   * The native panel closed. A deferred press becomes ADMITTED — it is ready
   * but still waits for the physical gesture to end. Returns true when a
   * deferred intent was admitted (for audit), false otherwise.
   */
  onPanelClosed(): boolean {
    const g = this.gesture
    if (!g || g.phase !== 'PRESSED') return false
    g.phase = 'ADMITTED'
    return true
  }

  /**
   * Take the single pending intent for execution at gesture end.
   *
   * Returns null when there is nothing to run: no gesture, already applied,
   * cancelled, expired (TTL) or bound to another document. Expired or
   * cross-document intents are CANCELLED, never silently retargeted.
   */
  take(input: { now: number; documentKey: string | null }): NavigatorGesture | null {
    const g = this.gesture
    if (!g) return null
    if (g.phase !== 'PRESSED' && g.phase !== 'ADMITTED') return null
    if (input.now - g.startedAt > NAV_GESTURE_INTENT_TTL_MS || g.documentKey !== input.documentKey) {
      this.cancel('STALE_INTENT')
      return null
    }
    g.phase = 'APPLIED'
    return { ...g }
  }

  /** Mark the applied gesture verified and release it (gesture is over). */
  complete(): void {
    if (!this.gesture) return
    this.gesture = null
  }

  /** Cancel the current gesture (idempotent). */
  cancel(reason: NavigatorGestureCancelReason): NavigatorGesture | null {
    const g = this.gesture
    if (!g) return null
    if (g.phase === 'APPLIED' || g.phase === 'CANCELLED') {
      this.gesture = null
      return null
    }
    g.phase = 'CANCELLED'
    g.cancelReason = reason
    const snapshot = { ...g }
    this.gesture = null
    return snapshot
  }

  /** Drop everything (document switch / dispose). */
  reset(): void {
    this.gesture = null
  }
}
