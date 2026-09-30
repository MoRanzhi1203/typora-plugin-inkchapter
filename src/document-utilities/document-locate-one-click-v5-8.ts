/**
 * Phase 7R.3.11.8B.21 — Diagnostic Locate Single-Click Offscreen Atomic
 * Transaction V5.8 (pure contract).
 *
 * The interactive defect this module closes:
 *
 *   target OFFSCREEN → first click only scrolls, no visual
 *   → a SECOND user click is required before the locate visual appears.
 *
 * The contract:
 *
 *   ONE USER CLICK = ONE COMPLETE LOCATE TRANSACTION
 *
 * `SCROLL_STABLE_FRAMES` is a MID state that can only advance the state
 * machine into POST_SCROLL_REVALIDATING — it must never be a terminal
 * (commit) state, and it must never skip the post-scroll fresh measurement,
 * the visual paint (with actual-painted-DOM verification), the Drawer
 * recovery settle and the final remeasure/repaint/verify.
 *
 * This module carries NO DOM access and NO host state: it is the shared,
 * independently testable decision surface the overlay host consumes.
 */

/** V5.8 — locate transaction state machine (recommended by the V5.8 spec). */
export type LocateTransactionState =
  | 'RESOLVING'
  | 'SCROLLING'
  | 'LOCKING_SCROLL_ANCHOR'
  | 'PRE_SCROLL_MEASURE'
  | 'SKIP_SCROLL'
  | 'REQUESTING_SCROLL'
  | 'WAITING_SCROLL_EFFECT'
  | 'WAITING_TARGET_ARRIVAL'
  | 'WAITING_POST_ARRIVAL_SETTLE'
  | 'WAITING_SCROLL_SETTLE'
  | 'POST_SCROLL_REVALIDATING'
  | 'MEASURING'
  | 'PRESENTING'
  | 'VERIFYING_PAINT'
  | 'RESTORING_LAYOUT'
  | 'RECOVERING_VISUAL'
  | 'WAITING_FINAL_LAYOUT_SETTLE'
  | 'FINAL_REMEASURING'
  | 'FINAL_REPAINTING'
  | 'FINAL_VERIFYING'
  // ── V5.12-R3 §8 — Drawer restore finalization ────────────────────────────
  | 'BUILDING_PROVISIONAL_PRESENTATION'
  | 'ACQUIRING_DRAWER_RECOVERY'
  | 'WAITING_RECOVERY_LAYOUT_SETTLE'
  | 'REMEASURING_AFTER_RECOVERY'
  | 'RESTORING_REQUESTED_DRAWER'
  | 'WAITING_DRAWER_RESTORE_SETTLE'
  | 'REMEASURING_AFTER_DRAWER_RESTORE'
  | 'REBUILDING_FINAL_PRESENTATION'
  | 'COMMITTED'
  | 'FAILED'
  | 'CANCELLED'

/** The only state a scroll-stable event may advance to. */
export const POST_SCROLL_NEXT_STATE: LocateTransactionState = 'POST_SCROLL_REVALIDATING'

/** States that are NOT allowed to follow a scroll-stable event directly. */
export const SCROLL_STABLE_TERMINAL_STATES: readonly LocateTransactionState[] = ['COMMITTED', 'FAILED', 'CANCELLED']

/** V5.8 — bounded INTERNAL rAF visual retry (never a second user click). */
export const LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY = 2

/** V5.8 — the one-click audit event name. */
export const LOCATE_ONE_CLICK_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-ONE-CLICK-LOCATE-AUDIT'

/**
 * V5.8 — the 21 hard-gate counters. Every one must stay 0.
 */
export const LOCATE_ONE_CLICK_GATE_KEYS = [
  'offscreenLocateRequiresSecondClick',
  'scrollStableTerminalWithoutVisual',
  'postScrollRemeasureMissing',
  'postScrollFreshTargetMissing',
  'postScrollFreshHostMissing',
  'postScrollStaleRectCommit',
  'postScrollDiagnosticIdentityChange',
  'postScrollOccurrenceChange',
  'postScrollAnchorChange',
  'postScrollVisualNotVisibleCommit',
  'postScrollZeroRectCommit',
  'postScrollFragmentDropCommit',
  'commitBeforeDrawerRecoverySettled',
  'postRecoveryRepaintMissing',
  'postRecoveryVisualNotVisible',
  'tableOffscreenFirstClickVisualMissing',
  'codeOffscreenFirstClickVisualMissing',
  'imageOcc0SecondClickRequired',
  'imageOcc1SecondClickRequired',
  'linkOffscreenSecondClickRequired',
  'headingOffscreenSecondClickRequired',
] as const

export type LocateOneClickGateKey = typeof LOCATE_ONE_CLICK_GATE_KEYS[number]

/** V5.8 — zeroed gate counter record (single authority for the key set). */
export function createLocateOneClickGateCounters(): Record<LocateOneClickGateKey, number> {
  const out = {} as Record<LocateOneClickGateKey, number>
  for (const key of LOCATE_ONE_CLICK_GATE_KEYS) out[key] = 0
  return out
}

/** V5.8 — visual verification input (actual PAINTED DOM, never expected). */
export interface OneClickVisualVerifyInput {
  /** Real layout? jsdom/headless is SKIP_HEADLESS (never a FAIL). */
  hasRealLayout: boolean
  targetConnected: boolean
  /** Actual painted carrier rect (frame element / inline mark). */
  paintedWidth: number
  paintedHeight: number
  /** Painted ∩ unobscured visible editor (px²). */
  paintedIntersectionWithVisibleEditor: number
  primaryMarkerVisible: boolean
  /** Table/Code compound: the secondary context must be visible. null = n/a. */
  secondaryContextVisible: boolean | null
  /** Inline: expected vs rendered fragment count. null = n/a. */
  expectedFragmentCount: number | null
  renderedFragmentCount: number | null
  /** Actual painted rect is stale (pre-scroll geometry survived). */
  staleRect?: boolean
}

export interface OneClickVisualVerifyResult {
  ok: boolean
  reason: string
}

/**
 * V5.8 — verify the ACTUAL painted DOM.
 *
 * A `classApplied=true` style check is explicitly NOT sufficient: the painted
 * carrier rect must be non-zero, must intersect the visible (unobscured)
 * editor, the primary marker must be visible, a compound target's secondary
 * context must be visible and an inline target must not drop fragments.
 */
export function verifyOneClickLocateVisual(input: OneClickVisualVerifyInput): OneClickVisualVerifyResult {
  if (!input.targetConnected) return { ok: false, reason: 'TARGET_NOT_CONNECTED' }
  if (input.staleRect === true) return { ok: false, reason: 'STALE_PRE_SCROLL_RECT' }
  // Headless (jsdom) has no real layout: the visual cannot be measured, so the
  // verify is explicitly SKIP_HEADLESS and never a fabricated FAIL/PASS.
  if (!input.hasRealLayout) return { ok: true, reason: 'SKIP_HEADLESS' }
  if (!(input.paintedWidth > 0) || !(input.paintedHeight > 0)) {
    return { ok: false, reason: 'ZERO_PAINTED_RECT' }
  }
  if (!(input.paintedIntersectionWithVisibleEditor > 0)) {
    return { ok: false, reason: 'PAINTED_OUTSIDE_VISIBLE_EDITOR' }
  }
  if (!input.primaryMarkerVisible) return { ok: false, reason: 'PRIMARY_MARKER_NOT_VISIBLE' }
  if (input.secondaryContextVisible === false) {
    return { ok: false, reason: 'SECONDARY_CONTEXT_NOT_VISIBLE' }
  }
  if (
    input.expectedFragmentCount != null &&
    input.renderedFragmentCount != null &&
    input.expectedFragmentCount > 0 &&
    input.renderedFragmentCount !== input.expectedFragmentCount
  ) {
    return { ok: false, reason: 'INLINE_FRAGMENT_DROP' }
  }
  return { ok: true, reason: 'VISUAL_VISIBLE' }
}

export type OneClickRetryDecision = 'COMMIT' | 'RETRY' | 'FAILED'

/**
 * V5.8 — bounded INTERNAL retry. `retryCount` already performed; a failing
 * visual is retried at most `maxRetry` times inside the SAME transaction
 * (`userClickCount` stays 1). Exhausted retries are a terminal FAILED — never
 * a fake PASS and never a wait for a second user click.
 */
export function resolveOneClickRetryDecision(
  visualOk: boolean,
  retryCount: number,
  maxRetry: number = LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY,
): OneClickRetryDecision {
  if (visualOk) return 'COMMIT'
  return retryCount < maxRetry ? 'RETRY' : 'FAILED'
}

/**
 * V5.8 — pre-scroll geometry is transient: whenever an automatic scroll was
 * required the pre-scroll rects are invalidated and MUST be re-measured.
 */
export function shouldInvalidatePreScrollGeometry(automaticScrollRequired: boolean): boolean {
  return automaticScrollRequired === true
}

/** V5.8 — a scroll-stable event must never be a terminal state. */
export function isScrollStableTerminalState(state: LocateTransactionState): boolean {
  return SCROLL_STABLE_TERMINAL_STATES.includes(state)
}

/** V5.8 — the only legal successor of a scroll-stable event. */
export function nextStateAfterScrollStable(): LocateTransactionState {
  return POST_SCROLL_NEXT_STATE
}
