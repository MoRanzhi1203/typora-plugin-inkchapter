/**
 * V5.1 — Drawer Recovery / Reopen / Occlusion / Layering / Name-Slot state
 * semantics, extracted as PURE functions so the targeted suite tests the exact
 * predicates the host uses (no unit-vs-runtime drift).
 *
 * Frozen domain: this module NEVER re-locates, never queries the Markdown
 * source, never decides diagnostics. It only classifies states/geometry that
 * were ALREADY measured by the overlay host.
 */

export interface SimpleRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type DrawerPresentationMode = 'closed' | 'open' | 'docked' | 'compact-docked' | 'locate-collapse'

export type ProblemsControlAction = 'REOPEN' | 'CLOSE' | 'OPEN'

/**
 * §9 — Problems Control must carry EXPLICIT intent. A click while in
 * LOCATE_COLLAPSE is REOPEN (never interpreted as CLOSE because the internal
 * presentation already thinks "open").
 */
export function resolveProblemsControlAction(
  presentation: DrawerPresentationMode,
  requestedOpen: boolean,
): ProblemsControlAction {
  if (presentation === 'locate-collapse') return 'REOPEN'
  if (requestedOpen) return 'CLOSE'
  return 'OPEN'
}

/**
 * §5 — user intent (requestedOpen) is SEPARATE from the transient
 * presentation. LOCATE_COLLAPSE never flips requestedOpen.
 *
 * V5.12-R3 §9 — `locateCompactActive` is the MEDIUM-viewport transient (and the
 * post-restore fallback when OPEN would occlude the target). Both
 * locate-collapse and locate-compact are TRANSIENT: neither may survive the
 * terminal COMMIT while `requestedOpen === true`.
 */
export function deriveDrawerPresentation(
  requestedOpen: boolean,
  locateCollapseActive: boolean,
  locateCompactActive = false,
): DrawerPresentationMode {
  if (!requestedOpen) return 'closed'
  if (locateCollapseActive) return 'locate-collapse'
  if (locateCompactActive) return 'compact-docked'
  return 'open'
}

/** True when the two rects share real horizontal AND vertical space (> eps). */
export function rectsIntersect(a: SimpleRect | null, b: SimpleRect | null, eps = 0.5): boolean {
  if (!a || !b) return false
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return a.left < b.right - eps && a.right > b.left + eps && a.top < b.bottom - eps && a.bottom > b.top + eps
}

export function intersectionArea(a: SimpleRect | null, b: SimpleRect | null): number {
  if (!a || !b) return 0
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return w * h
}

/**
 * §4/§12 — occlusion needs a RENDERED non-zero drawer. A zero-width /
 * zero-rect / hidden drawer can NEVER occlude the target.
 */
export function computeDrawerOcclusionFacts(
  drawerRect: SimpleRect | null,
  frameRect: SimpleRect | null,
): { drawerIntersectsFrame: boolean; drawerIntersectionArea: number; drawerOccludesTarget: boolean } {
  if (!drawerRect || drawerRect.width <= 0 || drawerRect.height <= 0 || !frameRect) {
    return { drawerIntersectsFrame: false, drawerIntersectionArea: 0, drawerOccludesTarget: false }
  }
  const intersects = rectsIntersect(drawerRect, frameRect)
  const area = intersectionArea(drawerRect, frameRect)
  const occludes = intersects && frameRect.right > drawerRect.left + 0.5 && area > 0
  return { drawerIntersectsFrame: intersects, drawerIntersectionArea: area, drawerOccludesTarget: occludes }
}

/**
 * §12 — FRAME_PAINTS_ABOVE_* may only be true when the panel is RENDERED,
 * has a non-zero rect, AND the frame really intersects it. A hidden navigator,
 * a 0×0 drawer and a non-intersecting toolbar are all NOT_APPLICABLE.
 */
export function evaluatePanelPaintRelation(
  frameRect: SimpleRect | null,
  panelRect: SimpleRect | null,
  panelPaintsAfterFrame: boolean,
): boolean {
  if (!frameRect || !panelRect) return false
  if (panelRect.width <= 0 || panelRect.height <= 0) return false
  if (!rectsIntersect(frameRect, panelRect)) return false
  return panelPaintsAfterFrame
}

export interface NameSlotResolution {
  expected: boolean
  decision: 'resolved' | 'fallback'
  primaryRect: SimpleRect | null
  areaRatio: number | null
}

function sameRect(a: SimpleRect | null, b: SimpleRect | null): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5
  )
}

/**
 * §15 — NAME-SLOT honesty. expectedNameSlotPresent=true REQUIRES a real small
 * primary slot whose rect differs from the object body AND whose area is
 * < 35% of the context object. Anything else is an explicit FALLBACK — never a
 * whole Code/Table body masquerading as a name slot.
 */
export function resolveNameSlotPresentation(
  slotRect: SimpleRect | null,
  contextRect: SimpleRect | null,
): NameSlotResolution {
  if (!slotRect || slotRect.width <= 0 || slotRect.height <= 0 || !contextRect || contextRect.width <= 0 || contextRect.height <= 0) {
    return { expected: false, decision: 'fallback', primaryRect: null, areaRatio: null }
  }
  const contextArea = contextRect.width * contextRect.height
  const slotArea = slotRect.width * slotRect.height
  const areaRatio = contextArea > 0 ? slotArea / contextArea : 1
  if (sameRect(slotRect, contextRect) || areaRatio >= 0.35) {
    return { expected: false, decision: 'fallback', primaryRect: slotRect, areaRatio }
  }
  return { expected: true, decision: 'resolved', primaryRect: slotRect, areaRatio }
}

/** §6 — recovery lease snapshot shape (transaction-scoped). */
export interface LocateDrawerRecoveryLease {
  transactionId: number
  requestedOpenBeforeLocate: boolean
  presentationBeforeLocate: DrawerPresentationMode
  selectedDiagnosticBeforeLocate: string | null
  released: boolean
}

/** §11 — layout recovery is bounded to ONE attempt per locate transaction. */
export const MAX_LAYOUT_RECOVERY_RETRY_PER_TX = 1

/** §11 — a transaction-local retry counter decides the gate. A NEW transaction
 *  resets the counter to 0, so the gate re-opens for an independent click. */
export function canPerformLayoutRecovery(txVisualRetryCount: number): boolean {
  return txVisualRetryCount < MAX_LAYOUT_RECOVERY_RETRY_PER_TX
}
