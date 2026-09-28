/**
 * Phase 7R.3.11.8B.23 — Diagnostic Locate Preferred Center Placement V5.10
 * (pure contract).
 *
 * V5.9 guarantees the target really REACHES the viewport. V5.10 answers the
 * remaining UX question: WHERE should it end up?
 *
 *   "目标已经可见" ≠ "目标已经处于合适的阅读位置"
 *
 * Policy:
 *   - a normal target should end up vertically CENTERED in the editor scroll
 *     viewport (within a tolerance so an almost-centred target never jitters);
 *   - Table/Code use the complete PRIMARY + SECONDARY compound bounds (never a
 *     single caption slot / block top);
 *   - a target taller than 80% of the viewport uses LARGE_BLOCK_PRIMARY_BIASED
 *     (the primary cue / block top sits at ≈38% of the viewport height);
 *   - a scroll limited by the real document start/end is CLAMPED_DOCUMENT_START
 *     / CLAMPED_DOCUMENT_END and is a LEGAL result — never a "not centred"
 *     failure.
 *
 * The vertical authority is the REAL editor scroll viewport. The Drawer only
 * participates in horizontal visibility / occlusion.
 *
 * No DOM access, no host state.
 */

export type LocatePlacementMode =
  | 'CENTER'
  | 'LARGE_BLOCK_PRIMARY_BIASED'
  | 'CLAMPED_DOCUMENT_START'
  | 'CLAMPED_DOCUMENT_END'

/** §8 — skip a recenter when the target is already this close to the center. */
export const CENTER_TOLERANCE_MIN_PX = 48
export const CENTER_TOLERANCE_VIEWPORT_RATIO = 0.10
export const CENTER_TOLERANCE_MAX_RATIO = 0.12

/** §13 — large-block policy. */
export const LARGE_BLOCK_THRESHOLD_RATIO = 0.80
export const LARGE_BLOCK_PRIMARY_Y_RATIO = 0.38

/** §20 — the numeric tolerance of the FINAL achieved placement (2~4px). */
export const FINAL_PLACEMENT_NUMERIC_TOLERANCE_PX = 4

/** §23 — at most ONE final placement correction (reflow only). */
export const MAX_FINAL_PLACEMENT_CORRECTION = 1

export interface PlacementRect {
  top: number
  bottom: number
  height: number
}

/** §8 — the skip tolerance (48px ~ viewportHeight * 0.10, capped at 0.12). */
export function centerTolerancePx(viewportHeight: number): number {
  const scaled = viewportHeight * CENTER_TOLERANCE_VIEWPORT_RATIO
  const capped = viewportHeight * CENTER_TOLERANCE_MAX_RATIO
  return Math.min(capped, Math.max(CENTER_TOLERANCE_MIN_PX, scaled))
}

/** §20 — the numeric tolerance of the achieved placement. */
export function placementNumericTolerancePx(devicePixelRatio = 1): number {
  return Math.max(FINAL_PLACEMENT_NUMERIC_TOLERANCE_PX, Math.ceil(devicePixelRatio) * 2)
}

export function isWithinCenterTolerance(centerError: number, tolerance: number): boolean {
  return Math.abs(centerError) <= tolerance
}

export interface PlacementInput {
  /** The REAL editor scroll viewport (never the Drawer-clipped rect). */
  viewportTop: number
  viewportHeight: number
  maxScrollTop: number
  currentScrollTop: number
  /**
   * §12 — CENTER authority bounds: the compound union for Table/Code, the
   * semantic target otherwise.
   */
  targetTop: number
  targetBottom: number
  /**
   * §13 — LARGE_BLOCK authority: the primary cue / block top.
   */
  primaryTop: number
  /**
   * §12 — true when the compound bounds were built from Primary + Secondary
   * (Table/Code). A false value with a caption-only rect is a violation.
   */
  compoundBoundsUsed: boolean
  /** §21 — fresh geometry only: a stale measurement is a violation. */
  geometryFresh: boolean
}

export interface PlacementDecision {
  placementMode: LocatePlacementMode
  desiredScrollTop: number
  clampedScrollTop: number
  clampedAtStart: boolean
  clampedAtEnd: boolean
  compoundHeight: number
  largeBlock: boolean
  viewportCenterY: number
  targetCenterBefore: number
  targetCenterAfter: number
  centerErrorBefore: number
  centerErrorAfter: number
  primaryPreferredViewportY: number | null
  primaryActualViewportYAfter: number | null
  alreadyWithinTolerance: boolean
  centerTolerance: number
  reason: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

/**
 * §6/§9/§10/§12/§13/§14 — the single preferred-placement authority.
 *
 * Boundary clamp (document start/end) takes precedence over the large-block
 * policy (§14), and both are legal results.
 */
export function computePreferredPlacement(input: PlacementInput): PlacementDecision {
  const viewportCenterY = input.viewportTop + input.viewportHeight / 2
  const compoundHeight = Math.max(0, input.targetBottom - input.targetTop)
  const targetCenterBefore = input.targetTop + compoundHeight / 2
  const centerErrorBefore = targetCenterBefore - viewportCenterY
  const tolerance = centerTolerancePx(input.viewportHeight)
  const alreadyWithinTolerance = Math.abs(centerErrorBefore) <= tolerance
  const largeBlock = compoundHeight >= input.viewportHeight * LARGE_BLOCK_THRESHOLD_RATIO

  let delta: number
  let primaryPreferredViewportY: number | null = null
  if (largeBlock) {
    primaryPreferredViewportY = input.viewportTop + input.viewportHeight * LARGE_BLOCK_PRIMARY_Y_RATIO
    delta = input.primaryTop - primaryPreferredViewportY
  } else {
    delta = centerErrorBefore
  }

  const desiredScrollTop = input.currentScrollTop + delta
  const clampedAtStart = desiredScrollTop < 0
  const clampedAtEnd = desiredScrollTop > input.maxScrollTop
  const clampedScrollTop = clamp(desiredScrollTop, 0, input.maxScrollTop)

  // §14 — boundary clamp authority wins over the large-block policy.
  let placementMode: LocatePlacementMode
  if (clampedAtStart) placementMode = 'CLAMPED_DOCUMENT_START'
  else if (clampedAtEnd) placementMode = 'CLAMPED_DOCUMENT_END'
  else placementMode = largeBlock ? 'LARGE_BLOCK_PRIMARY_BIASED' : 'CENTER'

  const appliedDelta = clampedScrollTop - input.currentScrollTop
  const centerErrorAfter = centerErrorBefore - appliedDelta
  const targetCenterAfter = targetCenterBefore - appliedDelta
  const primaryActualViewportYAfter = primaryPreferredViewportY == null ? null : input.primaryTop - appliedDelta

  const reason = !input.geometryFresh
    ? 'STALE_GEOMETRY'
    : clampedAtStart
      ? 'CLAMPED_DOCUMENT_START'
      : clampedAtEnd
        ? 'CLAMPED_DOCUMENT_END'
        : alreadyWithinTolerance
          ? 'ALREADY_WITHIN_CENTER_TOLERANCE'
          : largeBlock
            ? 'LARGE_BLOCK_PRIMARY_BIASED'
            : 'VISIBLE_BUT_OFFCENTER'

  return {
    placementMode,
    desiredScrollTop,
    clampedScrollTop,
    clampedAtStart,
    clampedAtEnd,
    compoundHeight,
    largeBlock,
    viewportCenterY,
    targetCenterBefore,
    targetCenterAfter,
    centerErrorBefore,
    centerErrorAfter,
    primaryPreferredViewportY,
    primaryActualViewportYAfter,
    alreadyWithinTolerance,
    centerTolerance: tolerance,
    reason,
  }
}

export interface FinalPlacementVerifyInput {
  placementMode: LocatePlacementMode
  /** Actual center error measured with FRESH geometry after the settle. */
  centerErrorAfter: number
  /** Actual scrollTop after the settle. */
  actualScrollTop: number
  maxScrollTop: number
  primaryPreferredViewportY: number | null
  primaryActualViewportY: number | null
  tolerancePx?: number
}

export interface FinalPlacementVerifyResult {
  ok: boolean
  reason: string
}

/**
 * §19/§37 — verify the ACHIEVED placement with fresh geometry.
 * Boundary modes are always legal; CENTER / LARGE_BLOCK must meet the numeric
 * tolerance.
 */
export function verifyFinalPlacement(input: FinalPlacementVerifyInput): FinalPlacementVerifyResult {
  const tol = input.tolerancePx ?? FINAL_PLACEMENT_NUMERIC_TOLERANCE_PX
  if (input.placementMode === 'CLAMPED_DOCUMENT_START') {
    return input.actualScrollTop <= tol
      ? { ok: true, reason: 'CLAMPED_DOCUMENT_START' }
      : { ok: false, reason: 'CLAMPED_DOCUMENT_START_SCROLL_TOP_MISMATCH' }
  }
  if (input.placementMode === 'CLAMPED_DOCUMENT_END') {
    return Math.abs(input.actualScrollTop - input.maxScrollTop) <= tol
      ? { ok: true, reason: 'CLAMPED_DOCUMENT_END' }
      : { ok: false, reason: 'CLAMPED_DOCUMENT_END_SCROLL_TOP_MISMATCH' }
  }
  if (input.placementMode === 'LARGE_BLOCK_PRIMARY_BIASED') {
    if (input.primaryPreferredViewportY == null || input.primaryActualViewportY == null) {
      return { ok: false, reason: 'LARGE_BLOCK_PRIMARY_UNMEASURABLE' }
    }
    return Math.abs(input.primaryActualViewportY - input.primaryPreferredViewportY) <= tol
      ? { ok: true, reason: 'LARGE_BLOCK_PRIMARY_BIASED' }
      : { ok: false, reason: 'LARGE_BLOCK_PRIMARY_PLACEMENT_ERROR' }
  }
  return Math.abs(input.centerErrorAfter) <= tol
    ? { ok: true, reason: 'CENTERED_WITHIN_TOLERANCE' }
    : { ok: false, reason: 'CENTER_ERROR_GT_TOLERANCE' }
}

/** V5.10 — the placement audit event name. */
export const LOCATE_PLACEMENT_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-LOCATE-PLACEMENT-AUDIT'

/** §30/§44 — the hard counters (every one must stay 0). */
export const LOCATE_PLACEMENT_V510_GATE_KEYS = [
  'locateNonBoundaryCenterErrorGtTolerance',
  'visibleOffcenterTargetSkippedScroll',
  'centeredTargetUnnecessaryScroll',
  'documentStartFalseCenterFailure',
  'documentEndFalseCenterFailure',
  'locateCenteringOverscroll',
  'largeBlockPrimaryPlacementError',
  'compoundTargetCenterUsesPartialRect',
  'placementUsesStaleGeometry',
  'placementCommitBeforeSettle',
  'finalPlacementCorrectionExceeded',
  'placementRegressionBreaksV59Arrival',
  'placementRegressionBreaksV57Topology',
  'placementRegressionBreaksV56Dismiss',
  'postCommitUserScrollRecenter',
  'postDismissRecenter',
] as const

export type LocatePlacementV510GateKey = typeof LOCATE_PLACEMENT_V510_GATE_KEYS[number]

export function createLocatePlacementV510GateCounters(): Record<LocatePlacementV510GateKey, number> {
  const out = {} as Record<LocatePlacementV510GateKey, number>
  for (const key of LOCATE_PLACEMENT_V510_GATE_KEYS) out[key] = 0
  return out
}
