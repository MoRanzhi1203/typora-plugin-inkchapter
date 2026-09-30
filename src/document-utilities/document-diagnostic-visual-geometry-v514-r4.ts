/**
 * V5.14-R4 — Document Diagnostic VISUAL GEOMETRY authority (reflow invalidated).
 *
 * ROOT_R4_1 = the diagnostic visual geometry lifetime was tied to the diagnostic
 *   IDENTITY / content fingerprint, NOT to the live layout position. A heading
 *   moved by an upstream reflow (an inserted blank line / paragraph / a wrapped
 *   upstream paragraph) kept its OLD `passive` / `active` / `reasonChip` rects.
 * ROOT_R4_2 = an upstream reflow can move a target while diagnosticId /
 *   stableIdentity / sourceRevision / contentFingerprint stay UNCHANGED, so the
 *   existing "fingerprint changed → rebuild" invalidation never fired.
 * ROOT_R4_3 = fill / active fragment / reason chip / passive marker could be
 *   committed from DIFFERENT geometry generations (the ACTIVE pass re-measured
 *   its fragments but ADOPTED the passive record's `chipLocal`).
 * ROOT_R4_4 = the drift audit hardcoded `markerTargetDriftPx: 0` (and
 *   `layoutEpochCurrent: true`), so a 40.8px visible separation was still PASS.
 * ROOT_R4_5 = the active locate re-measured the active fragment while reusing a
 *   stale passive/chip snapshot.
 * ROOT_R4_6 = the passive visual closure proved SET MEMBERSHIP only, never live
 *   geometry alignment.
 * ROOT_R4_7 = document-space overlay nodes survived a reflow with no target-rect
 *   invalidation.
 * ROOT_R4_8 = the selected target could stack a passive fill and an active fill
 *   painted from different generations instead of ONE atomic presentation.
 *
 * The invariant this module encodes:
 *
 *   semantic target (documentKey + diagnosticId + targetIndex + stableIdentity)
 *   is INDEPENDENT of
 *   geometry snapshot (visualTargetKey + layoutEpoch + geometryGeneration + rects)
 *
 * Pure contract: no DOM, no host state.
 */

export type DiagnosticCoordinateSpace = 'VIEWPORT' | 'EDITOR_LOCAL' | 'DOCUMENT_LOCAL' | 'OVERLAY_HOST_LOCAL'

/** §13 — every rect carries all six fields; width/height are ALWAYS derived. */
export interface GeometryRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** §5.1 — the immutable geometry snapshot of ONE visual target. */
export interface DiagnosticVisualGeometrySnapshot {
  visualTargetKey: string
  documentKey: string
  stableHeadingIdentity: string
  diagnosticId: string | null
  targetIndex: number
  severity: 'error' | 'warning' | 'info'
  /** §13 — ONE coordinate space per snapshot (heading visuals are DOCUMENT_LOCAL). */
  coordinateSpace: DiagnosticCoordinateSpace
  layoutEpoch: number
  geometryGeneration: number
  measuredAt: number

  anchorRect: GeometryRect | null
  textRects: GeometryRect[]
  fillRects: GeometryRect[]
  numberRect: GeometryRect | null
  reasonChipRect: GeometryRect | null

  targetFingerprint: string
  targetConnected: boolean
}

/** §13 — the ONLY rect factory: edges in, all six fields derived. */
export function normalizeGeometryRect(input: {
  left: number
  top: number
  right: number
  bottom: number
}): GeometryRect {
  const left = Number(input.left)
  const top = Number(input.top)
  const right = Math.max(left, Number(input.right))
  const bottom = Math.max(top, Number(input.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export interface GeometryDrift {
  leftDrift: number
  topDrift: number
  widthDrift: number
  heightDrift: number
  maxDrift: number
  stale: boolean
}

export const GEOMETRY_DRIFT_TOLERANCE_PX_V514R4 = 1
export const REASON_CHIP_ANCHOR_TOLERANCE_PX_V514R4 = 2

/**
 * §9 — live rect drift. `stale` is true when ANY edge/size moved beyond the
 * tolerance. Finding drift is NOT a failure; PAINTING stale geometry is.
 */
export function measureGeometryDrift(
  stored: GeometryRect | null,
  live: GeometryRect | null,
  tolerancePx: number = GEOMETRY_DRIFT_TOLERANCE_PX_V514R4,
): GeometryDrift {
  if (!stored || !live) {
    return { leftDrift: 0, topDrift: 0, widthDrift: 0, heightDrift: 0, maxDrift: 0, stale: false }
  }
  const leftDrift = Math.abs(live.left - stored.left)
  const topDrift = Math.abs(live.top - stored.top)
  const widthDrift = Math.abs(live.width - stored.width)
  const heightDrift = Math.abs(live.height - stored.height)
  const maxDrift = Math.max(leftDrift, topDrift, widthDrift, heightDrift)
  return { leftDrift, topDrift, widthDrift, heightDrift, maxDrift, stale: maxDrift > tolerancePx }
}

/**
 * §5.2/§20 — every visual component of the SAME target must carry the same
 * layoutEpoch AND the same geometryGeneration.
 */
export function evaluateVisualGeometryGenerationConsistency(input: {
  passiveLayoutEpoch: number | null
  activeLayoutEpoch: number | null
  chipLayoutEpoch: number | null
  passiveGeometryGeneration: number | null
  activeGeometryGeneration: number | null
  chipGeometryGeneration: number | null
}): {
  epochMismatch: boolean
  generationMismatch: boolean
  mixedLayoutEpoch: boolean
  mixedGeometryGeneration: boolean
} {
  const epochs = [input.passiveLayoutEpoch, input.activeLayoutEpoch, input.chipLayoutEpoch]
    .filter((v): v is number => v != null)
  const generations = [input.passiveGeometryGeneration, input.activeGeometryGeneration, input.chipGeometryGeneration]
    .filter((v): v is number => v != null)
  const epochMismatch = epochs.length > 1 && new Set(epochs).size > 1
  const generationMismatch = generations.length > 1 && new Set(generations).size > 1
  return {
    epochMismatch,
    generationMismatch,
    mixedLayoutEpoch: epochMismatch,
    mixedGeometryGeneration: generationMismatch,
  }
}

/** §10/§20 — reason chip horizontal anchor + vertical centring against the SAME snapshot. */
export function evaluateReasonChipGeometry(input: {
  chipRect: GeometryRect | null
  textRects: readonly GeometryRect[]
  visualLabelRight: number | null
  configuredGapPx: number
  anchorTolerancePx?: number
  /**
   * Only the `RIGHT_OF_LAST_LINE` placement is horizontally anchored beside the
   * text. A `BELOW_LAST_LINE` chip is legitimately allowed to sit under the line,
   * so the beside-the-text drift checks do not apply to it.
   */
  chipPlacement?: 'RIGHT_OF_LAST_LINE' | 'BELOW_LAST_LINE' | null
}): {
  horizontalGapPx: number | null
  anchorDriftPx: number | null
  verticalDriftPx: number | null
  anchorOk: boolean
  verticalOk: boolean
  gapOk: boolean
} {
  const chip = input.chipRect
  if (!chip || input.textRects.length === 0) {
    return { horizontalGapPx: null, anchorDriftPx: null, verticalDriftPx: null, anchorOk: true, verticalOk: true, gapOk: true }
  }
  const besideLastLine = input.chipPlacement == null || input.chipPlacement === 'RIGHT_OF_LAST_LINE'
  if (!besideLastLine) {
    return { horizontalGapPx: null, anchorDriftPx: null, verticalDriftPx: null, anchorOk: true, verticalOk: true, gapOk: true }
  }
  const tolerance = input.anchorTolerancePx ?? REASON_CHIP_ANCHOR_TOLERANCE_PX_V514R4
  const anchorLine = input.textRects[input.textRects.length - 1]
  const labelRight = input.visualLabelRight ?? anchorLine.right
  const horizontalGapPx = chip.left - labelRight
  const anchorDriftPx = Math.abs(horizontalGapPx - input.configuredGapPx)
  const verticalDriftPx = Math.abs((chip.top + chip.height / 2) - (anchorLine.top + anchorLine.height / 2))
  return {
    horizontalGapPx,
    anchorDriftPx,
    verticalDriftPx,
    anchorOk: anchorDriftPx <= tolerance,
    verticalOk: verticalDriftPx <= tolerance,
    gapOk: horizontalGapPx >= 4 && horizontalGapPx <= 12,
  }
}

/** §7 — which editor mutations can move a diagnostic target. */
export type ReflowMutationKind =
  | 'EDITOR_CHILD_LIST'
  | 'EDITOR_CHARACTER_DATA'
  | 'PLUGIN_GEOMETRY_PROJECTION'
  | 'EXTERNAL_RESIZE'

export function isLayoutAffectingReflowKind(kind: ReflowMutationKind): boolean {
  return kind === 'EDITOR_CHILD_LIST'
    || kind === 'EDITOR_CHARACTER_DATA'
    || kind === 'PLUGIN_GEOMETRY_PROJECTION'
    || kind === 'EXTERNAL_RESIZE'
}

/** §8 — scroll is NOT a reflow trigger (document-space markers scroll naturally). */
export function geometryInvalidationReasonForEvent(event: string): string | null {
  switch (event) {
    case 'scroll': return null
    case 'pointermove': return null
    case 'mousemove': return null
    default: return event
  }
}

/**
 * §9/§12 — decide whether the stored geometry must be discarded and rebuilt.
 * A false `layoutEpochCurrent` must never be able to keep stale geometry.
 */
export function shouldRebuildDiagnosticVisual(input: {
  layoutEpochChanged: boolean
  geometryGenerationChanged: boolean
  targetConnected: boolean
  liveDriftPx: number
  contentFingerprintChanged: boolean
}): { rebuild: boolean; reason: string } {
  if (!input.targetConnected) return { rebuild: true, reason: 'TARGET_DISCONNECTED' }
  if (input.layoutEpochChanged) return { rebuild: true, reason: 'LAYOUT_EPOCH_CHANGED' }
  if (input.geometryGenerationChanged) return { rebuild: true, reason: 'GEOMETRY_GENERATION_CHANGED' }
  if (input.contentFingerprintChanged) return { rebuild: true, reason: 'CONTENT_FINGERPRINT_CHANGED' }
  if (input.liveDriftPx > GEOMETRY_DRIFT_TOLERANCE_PX_V514R4) return { rebuild: true, reason: 'LIVE_RECT_DRIFT_GT_1PX' }
  return { rebuild: false, reason: 'GEOMETRY_CURRENT' }
}

/** §5.2 — build the ONE immutable snapshot for a visual target. */
export function buildDiagnosticVisualGeometrySnapshot(input: {
  visualTargetKey: string
  documentKey: string
  stableHeadingIdentity: string
  diagnosticId: string | null
  targetIndex: number
  severity: 'error' | 'warning' | 'info'
  layoutEpoch: number
  geometryGeneration: number
  measuredAt: number
  anchorRect: GeometryRect | null
  textRects: readonly GeometryRect[]
  fillRects: readonly GeometryRect[]
  numberRect: GeometryRect | null
  reasonChipRect: GeometryRect | null
  targetFingerprint: string
  targetConnected: boolean
}): DiagnosticVisualGeometrySnapshot {
  return {
    visualTargetKey: input.visualTargetKey,
    documentKey: input.documentKey,
    stableHeadingIdentity: input.stableHeadingIdentity,
    diagnosticId: input.diagnosticId,
    targetIndex: input.targetIndex,
    severity: input.severity,
    coordinateSpace: 'DOCUMENT_LOCAL',
    layoutEpoch: input.layoutEpoch,
    geometryGeneration: input.geometryGeneration,
    measuredAt: input.measuredAt,
    anchorRect: input.anchorRect,
    textRects: [...input.textRects],
    fillRects: [...input.fillRects],
    numberRect: input.numberRect,
    reasonChipRect: input.reasonChipRect,
    targetFingerprint: input.targetFingerprint,
    targetConnected: input.targetConnected,
  }
}

/**
 * §11 — the SELECTED target must present ONE atomic surface: while it is active
 * its passive fill is not painted (the marker record / chip / semantic key stay).
 */
export function passiveFillPresentationForActiveTarget(input: {
  isActiveHeading: boolean
  passiveMarkerExists: boolean
}): { paintPassiveFill: boolean; suppressReason: string | null } {
  if (!input.isActiveHeading) return { paintPassiveFill: true, suppressReason: null }
  if (!input.passiveMarkerExists) return { paintPassiveFill: false, suppressReason: 'NO_PASSIVE_MARKER' }
  return { paintPassiveFill: false, suppressReason: 'ACTIVE_PRESENTATION_REPLACES_PASSIVE_FILL' }
}

// ── §15 — the V5.14-R4 visual-reflow hard gates (all must be 0) ──────────────

export const VISUAL_REFLOW_V514R4_GATE_KEYS = [
  'layoutAffectingMutationWithoutGeometryInvalidation',
  'staleVisualGeometryPaint',
  'passiveTargetRectStale',
  'passiveTargetDriftGt1px',
  'activeTargetDriftGt1px',
  'reasonChipVerticalDriftGt2px',
  'reasonChipAnchorDriftGt2px',
  'activePassiveGeometryEpochMismatch',
  'activePassiveGeometryGenerationMismatch',
  'activePassiveTargetRectMismatch',
  'visualComponentMixedLayoutEpoch',
  'visualComponentMixedGeometryGeneration',
  'targetMovedWithoutVisualRebuild',
  'stalePassiveMarkerAfterReflow',
  'staleActiveMarkerAfterReflow',
  'staleReasonChipAfterReflow',
  'passiveFragmentRectStaleAfterTextEdit',
  'activeFragmentRectStaleAfterTextEdit',
  'reasonChipAnchorStaleAfterTextEdit',
  'headingActivePassiveFillStack',
  'scrollGeometryRebuild',
] as const

export type VisualReflowV514R4GateKey = typeof VISUAL_REFLOW_V514R4_GATE_KEYS[number]

export const VISUAL_REFLOW_V514R4_GATE_LABELS: Readonly<Record<VisualReflowV514R4GateKey, string>> = {
  layoutAffectingMutationWithoutGeometryInvalidation: 'LAYOUT_AFFECTING_MUTATION_WITHOUT_GEOMETRY_INVALIDATION_COUNT',
  staleVisualGeometryPaint: 'STALE_VISUAL_GEOMETRY_PAINT_COUNT',
  passiveTargetRectStale: 'PASSIVE_TARGET_RECT_STALE_COUNT',
  passiveTargetDriftGt1px: 'PASSIVE_TARGET_DRIFT_GT_1PX_COUNT',
  activeTargetDriftGt1px: 'ACTIVE_TARGET_DRIFT_GT_1PX_COUNT',
  reasonChipVerticalDriftGt2px: 'REASON_CHIP_VERTICAL_DRIFT_GT_2PX_COUNT',
  reasonChipAnchorDriftGt2px: 'REASON_CHIP_ANCHOR_DRIFT_GT_2PX_COUNT',
  activePassiveGeometryEpochMismatch: 'ACTIVE_PASSIVE_GEOMETRY_EPOCH_MISMATCH_COUNT',
  activePassiveGeometryGenerationMismatch: 'ACTIVE_PASSIVE_GEOMETRY_GENERATION_MISMATCH_COUNT',
  activePassiveTargetRectMismatch: 'ACTIVE_PASSIVE_TARGET_RECT_MISMATCH_COUNT',
  visualComponentMixedLayoutEpoch: 'VISUAL_COMPONENT_MIXED_LAYOUT_EPOCH_COUNT',
  visualComponentMixedGeometryGeneration: 'VISUAL_COMPONENT_MIXED_GEOMETRY_GENERATION_COUNT',
  targetMovedWithoutVisualRebuild: 'TARGET_MOVED_WITHOUT_VISUAL_REBUILD_COUNT',
  stalePassiveMarkerAfterReflow: 'STALE_PASSIVE_MARKER_AFTER_REFLOW_COUNT',
  staleActiveMarkerAfterReflow: 'STALE_ACTIVE_MARKER_AFTER_REFLOW_COUNT',
  staleReasonChipAfterReflow: 'STALE_REASON_CHIP_AFTER_REFLOW_COUNT',
  passiveFragmentRectStaleAfterTextEdit: 'PASSIVE_FRAGMENT_RECT_STALE_AFTER_TEXT_EDIT_COUNT',
  activeFragmentRectStaleAfterTextEdit: 'ACTIVE_FRAGMENT_RECT_STALE_AFTER_TEXT_EDIT_COUNT',
  reasonChipAnchorStaleAfterTextEdit: 'REASON_CHIP_ANCHOR_STALE_AFTER_TEXT_EDIT_COUNT',
  headingActivePassiveFillStack: 'HEADING_ACTIVE_PASSIVE_FILL_STACK_COUNT',
  scrollGeometryRebuild: 'SCROLL_GEOMETRY_REBUILD_COUNT',
}

export type VisualReflowV514R4Counters = Record<VisualReflowV514R4GateKey, number>

export function createVisualReflowV514R4Counters(): VisualReflowV514R4Counters {
  return VISUAL_REFLOW_V514R4_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as VisualReflowV514R4Counters)
}

export function formatVisualReflowV514R4GateReport(
  counters: Readonly<VisualReflowV514R4Counters>,
): string[] {
  return VISUAL_REFLOW_V514R4_GATE_KEYS.map(key => `${VISUAL_REFLOW_V514R4_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateVisualReflowV514R4Gates(
  counters: Readonly<VisualReflowV514R4Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: VisualReflowV514R4GateKey[] } {
  const failedChecks = VISUAL_REFLOW_V514R4_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §6/§16 — the ONE visual-reflow runtime audit. */
export const DOCUMENT_DIAGNOSTIC_VISUAL_REFLOW_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-VISUAL-REFLOW-AUDIT'
