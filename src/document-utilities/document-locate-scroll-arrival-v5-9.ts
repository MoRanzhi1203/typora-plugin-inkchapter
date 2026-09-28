/**
 * Phase 7R.3.11.8B.22 — Diagnostic Locate Scroll Completion Authority V5.9
 * (pure contract).
 *
 * The V5.8 report was falsified by the real runtime:
 *
 *   offscreen target → ONE click
 *   → scrollSettled=true was recorded while the target was STILL outside the
 *     viewport (postScrollTargetRect.top=1056 vs visibleEditorRect.bottom=751)
 *   → the V5.8 visual pipeline started too early
 *   → visualPaintAttemptCount=3 / visualRetryCount=2
 *   → ONE_CLICK_VISUAL_FAILED:ZERO_PAINTED_RECT
 *   → a SECOND user click was required.
 *
 * Root cause: the settle detector (`2 stable rAF frames`) can fire BEFORE the
 * smooth scroll effect has reached the target, and `scrollSettled` never
 * required the target to have ENTERED the scroll viewport.
 *
 * V5.9 contract:
 *
 *   semantic target  ≠  stable scroll anchor  ≠  visual carrier
 *
 *   scrollSettled === true  ⇒  targetEnteredViewport === true
 *                           &&  targetVisibleAtSettle === true
 *                           &&  scrollEffectObserved === true
 *
 * and the V5.8 visual pipeline may only start once that invariant holds. While
 * an automatic scroll is required and the target is still offscreen,
 * `visualPaintAttemptCount` and `visualRetryCount` MUST stay 0.
 *
 * This module carries NO DOM access and NO host state.
 */

/** V5.9 — pure rect value (derived rects are always fully rebuilt). */
export interface ScrollRectSnapshot {
  x: number
  y: number
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * V5.9 §18 — RectSnapshot keeps PURE VALUE semantics. Every derived rect must
 * be rebuilt from its edges; `{ ...oldRect, top: newTop }` is forbidden because
 * it leaves width/height/x/y inconsistent.
 */
export function makeScrollRectSnapshot(input: {
  left: number
  top: number
  right: number
  bottom: number
}): ScrollRectSnapshot {
  const left = Number(input.left)
  const top = Number(input.top)
  const right = Math.max(left, Number(input.right))
  const bottom = Math.max(top, Number(input.bottom))
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

/** V5.9 §7 — the scroll ARRIVAL snapshot (never the visual verify). */
export interface ScrollArrivalSnapshot {
  targetRect: ScrollRectSnapshot | null
  viewportRect: ScrollRectSnapshot | null
  scrollTop: number
  targetConnected: boolean
  intersectionHeight: number
  visibleRatioY: number
  /** Target really intersects the editor scroll viewport (vertical). */
  enteredViewport: boolean
  /** SKIP_NO_LAYOUT — the runtime exposes no measurable layout at all. */
  layoutSignal: boolean
  reason: string
}

/** V5.9 §14/§15 — separated, bounded retry authorities. */
export const MAX_SCROLL_CORRECTION = 1
export const MAX_ARRIVAL_FRAMES = 8
export const MAX_POST_ARRIVAL_STABLE_FRAMES = 2
export const MAX_POST_ARRIVAL_FRAMES = 8
/** V5.8 visual retry stays untouched — but only runs after arrival. */
export const MAX_VISUAL_RETRY = 2

/** Geometry epsilon (px) for "no movement". */
export const SCROLL_MOVEMENT_EPSILON = 0.5

function verticalIntersection(a: ScrollRectSnapshot, b: ScrollRectSnapshot): number {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
}

/**
 * V5.9 §7.1 — measure whether the anchor really arrived.
 *
 * A target TALLER than the viewport must NOT be required to be fully visible:
 * a positive vertical intersection with the editor scroll viewport is the
 * arrival authority (the primary marker / top-edge sentinel then guarantees the
 * visible marker).
 */
export function measureScrollArrival(input: {
  targetRect: ScrollRectSnapshot | null
  viewportRect: ScrollRectSnapshot | null
  scrollTop: number
  targetConnected: boolean
}): ScrollArrivalSnapshot {
  const { targetRect, viewportRect, scrollTop, targetConnected } = input
  const targetMeasurable = targetRect != null && (targetRect.width > 0 || targetRect.height > 0)
  const viewportMeasurable = viewportRect != null && (viewportRect.width > 0 || viewportRect.height > 0)
  // V5.9 — a runtime that exposes NO layout at all (jsdom) cannot assert
  // arrival; it is explicitly SKIP_NO_LAYOUT and never a fabricated FAIL.
  const layoutSignal = targetMeasurable || viewportMeasurable
  if (!layoutSignal) {
    return {
      targetRect, viewportRect, scrollTop, targetConnected,
      intersectionHeight: 0, visibleRatioY: 0,
      enteredViewport: targetConnected,
      layoutSignal: false,
      reason: 'SKIP_NO_LAYOUT',
    }
  }
  if (!targetConnected || !targetRect || !viewportRect) {
    return {
      targetRect, viewportRect, scrollTop, targetConnected,
      intersectionHeight: 0, visibleRatioY: 0, enteredViewport: false,
      layoutSignal: true,
      reason: !targetConnected ? 'TARGET_NOT_CONNECTED' : 'TARGET_RECT_UNAVAILABLE',
    }
  }
  const intersectionHeight = verticalIntersection(targetRect, viewportRect)
  const visibleRatioY = targetRect.height > 0
    ? Math.min(1, intersectionHeight / targetRect.height)
    : (intersectionHeight > 0 ? 1 : 0)
  // The target must have a real measurable box AND intersect the viewport.
  const enteredViewport = (targetRect.width > 0 || targetRect.height > 0) && intersectionHeight > 0
  return {
    targetRect, viewportRect, scrollTop, targetConnected,
    intersectionHeight, visibleRatioY, enteredViewport,
    layoutSignal: true,
    reason: enteredViewport ? 'TARGET_ENTERED_VIEWPORT' : 'TARGET_OUTSIDE_VIEWPORT',
  }
}

/**
 * V5.9 §6.2 — deterministic desired scrollTop (no smooth-scroll guessing).
 * Centres the anchor in the scroll viewport, clamped to the real scroll range.
 */
export function computeDesiredScrollTop(input: {
  containerScrollTop: number
  containerClientHeight: number
  containerScrollHeight: number
  containerRect: ScrollRectSnapshot
  anchorRect: ScrollRectSnapshot
}): number {
  const current = Number.isFinite(input.containerScrollTop) ? input.containerScrollTop : 0
  const delta = (input.anchorRect.top + input.anchorRect.height / 2) - (input.containerRect.top + input.containerRect.height / 2)
  const maxScrollTop = Math.max(0, input.containerScrollHeight - input.containerClientHeight)
  const desired = current + delta
  return Math.max(0, Math.min(desired, maxScrollTop))
}

/** V5.9 §10.3 — did the scroll have an observable effect? */
export function hasScrollEffect(
  initial: ScrollArrivalSnapshot,
  next: ScrollArrivalSnapshot,
  epsilon: number = SCROLL_MOVEMENT_EPSILON,
): boolean {
  if (next.enteredViewport) return true
  if (Math.abs(next.scrollTop - initial.scrollTop) > epsilon) return true
  const a = initial.targetRect
  const b = next.targetRect
  if (a && b && (Math.abs(a.top - b.top) > epsilon || Math.abs(a.left - b.left) > epsilon)) return true
  return false
}

/** V5.9 §11 — two consecutive post-arrival frames with no movement. */
export function isArrivalStable(
  prev: ScrollArrivalSnapshot,
  next: ScrollArrivalSnapshot,
  epsilon: number = SCROLL_MOVEMENT_EPSILON,
): boolean {
  if (!next.enteredViewport) return false
  if (Math.abs(next.scrollTop - prev.scrollTop) > epsilon) return false
  const a = prev.targetRect
  const b = next.targetRect
  if (a && b && Math.abs(a.top - b.top) > epsilon) return false
  return true
}

/**
 * V5.9 §12 — the gate that protects the V5.8 visual pipeline.
 *
 *   canStartVisualPipeline =
 *     !automaticScrollRequired
 *     || (scrollEffectObserved && targetEnteredViewport
 *         && targetVisibleAtSettle && scrollSettled)
 */
export function canStartVisualPipeline(facts: {
  automaticScrollRequired: boolean
  scrollEffectObserved: boolean
  targetEnteredViewport: boolean
  targetVisibleAtSettle: boolean
  scrollSettled: boolean
}): boolean {
  if (!facts.automaticScrollRequired) return true
  return (
    facts.scrollEffectObserved === true &&
    facts.targetEnteredViewport === true &&
    facts.targetVisibleAtSettle === true &&
    facts.scrollSettled === true
  )
}

/** V5.9 §22 — the hard commit condition. */
export function canCommitScrollTransaction(facts: {
  automaticScrollRequired: boolean
  scrollEffectObserved: boolean
  targetEnteredViewport: boolean
  targetVisibleAtSettle: boolean
  scrollSettled: boolean
  visualPipelineStarted: boolean
  presentationBuiltAfterScroll: boolean
  primaryMarkerVisible: boolean
  postRecoveryVisualVisible: boolean
  postScrollRevalidateDecision: string
  diagnosticIdentityChanged: boolean
  anchorChanged: boolean
  occurrenceChanged: boolean
  drawerRecoverySettled: boolean
  postRecoveryRemeasured: boolean
  postRecoveryRepainted: boolean
}): boolean {
  const scrollGate = !facts.automaticScrollRequired || (
    facts.scrollEffectObserved &&
    facts.targetEnteredViewport &&
    facts.targetVisibleAtSettle &&
    facts.scrollSettled
  )
  const visualGate =
    facts.visualPipelineStarted &&
    facts.presentationBuiltAfterScroll &&
    facts.primaryMarkerVisible &&
    facts.postRecoveryVisualVisible
  const identityGate =
    facts.postScrollRevalidateDecision === 'PASS' &&
    !facts.diagnosticIdentityChanged &&
    !facts.anchorChanged &&
    !facts.occurrenceChanged
  return (
    scrollGate &&
    visualGate &&
    identityGate &&
    facts.drawerRecoverySettled &&
    facts.postRecoveryRemeasured &&
    facts.postRecoveryRepainted
  )
}

/** V5.9 — the scroll-arrival audit event name. */
export const LOCATE_SCROLL_ARRIVAL_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-SCROLL-ARRIVAL-AUDIT'

/** V5.9 §21 — the hard-gate counters (every one must stay 0). */
export const LOCATE_SCROLL_V59_GATE_KEYS = [
  'offscreenScrollSettledWhileTargetInvisible',
  'scrollSettleBeforeTargetEnteredViewport',
  'scrollSettleWithoutEffect',
  'visualPaintAttemptWhileTargetOffscreen',
  'visualRetryWhileTargetOffscreen',
  'offscreenFirstClickZeroPaintedRect',
  'offscreenFirstClickTerminalFailed',
  'offscreenFirstClickRequiresSecondClick',
  'visibleTargetUnnecessaryScrollWrite',
  'scrollContainerTargetMismatchCommit',
  'scrollAnchorIdentityChangeCommit',
  'postScrollStaleRectCommit',
  'tableOffscreenFirstClickMissing',
  'codeOffscreenFirstClickMissing',
  'headingOffscreenFirstClickMissing',
  'imageOcc0OffscreenFirstClickMissing',
  'imageOcc1OffscreenFirstClickMissing',
  'linkOffscreenFirstClickMissing',
  'acceptedTxWithoutTerminal',
  'danglingScrollRaf',
] as const

export type LocateScrollV59GateKey = typeof LOCATE_SCROLL_V59_GATE_KEYS[number]

export function createLocateScrollV59GateCounters(): Record<LocateScrollV59GateKey, number> {
  const out = {} as Record<LocateScrollV59GateKey, number>
  for (const key of LOCATE_SCROLL_V59_GATE_KEYS) out[key] = 0
  return out
}
