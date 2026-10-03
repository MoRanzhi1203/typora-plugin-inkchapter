/**
 * V5.13-R1 — Synthetic EOF Document-Space Visual Target (pure contract).
 *
 * ROOT_V513R1_1 = DOCUMENT_END_IS_SEMANTIC_LOCATION_BUT_HAS_NO_REAL_DOM_TARGET
 * ROOT_V513R1_2 = DOCUMENT_END_RESOLVER_RETURNS_SCROLL_ACTION_WITHOUT_VISUAL_TARGET
 * ROOT_V513R1_3 = VISUAL_PIPELINE_REQUIRES_CONNECTED_DOM_OR_RECT_BUT_DOCUMENT_END_PROVIDES_NULL
 * ROOT_V513R1_4 = DOCUMENT_END_LOCATION_CONTRACT_IS_MARKED_LOCATABLE_WITHOUT_A_PRESENTABLE_TARGET
 * ROOT_V513R1_5 = SCROLL_SUCCESS_IS_INCORRECTLY_TREATED_AS_ENOUGH_FOR_DOCUMENT_END_LOCATE
 * ROOT_V513R1_6 = NO_SYNTHETIC_DOCUMENT_SPACE_EOF_VISUAL_ANCHOR_EXISTS
 *
 * Three DIFFERENT concepts must never be conflated:
 *
 *   SemanticLocation   = document-end
 *   ScrollDestination  = document bottom (GO_BOTTOM)
 *   VisualTarget       = synthetic EOF marker geometry
 *
 * The `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` rule already owns the first two;
 * this module supplies the third. It is a PURE contract: no DOM, no queries.
 */

// ── Identity / audit ───────────────────────────────────────────────────────

export const DOCUMENT_END_VISUAL_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-DOCUMENT-END-VISUAL-AUDIT'
export const DOCUMENT_END_TRAILING_BLANK_RULE = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'
/** The synthetic visual target kind (never a real DOM node). */
export const DOCUMENT_END_VISUAL_TARGET_KIND = 'synthetic-eof'
export const DOCUMENT_END_SEMANTIC_ANCHOR_KIND = 'document-boundary'
export const DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY = 'document:end'
export const EOF_COORDINATE_SPACE = 'HOST_LOCAL_DOCUMENT_SPACE'

/** Where the synthetic vertical geometry came from (§6.3 — never silent). */
export const EOF_GEOMETRY_SOURCE_LAST_MEANINGFUL_BLOCK = 'LAST_MEANINGFUL_BLOCK'
export const EOF_GEOMETRY_SOURCE_EDITOR_END_BASELINE = 'EDITOR_DOCUMENT_END_BASELINE'
/**
 * V5.13-R5 §6 — the REAL trailing blank geometry sources. The zone is measured
 * from the DOM / editor tail, NEVER back-projected from the source blank count.
 */
export const EOF_GEOMETRY_SOURCE_ACTUAL_TRAILING_DOM_BLANK_ZONE = 'ACTUAL_TRAILING_DOM_BLANK_ZONE'
export const EOF_GEOMETRY_SOURCE_EDITOR_TAIL_SPACE = 'EDITOR_TAIL_SPACE'
export const EOF_GEOMETRY_SOURCE_COMPACT_SAFE_FALLBACK = 'COMPACT_SAFE_FALLBACK'
/** V5.13-R5 §11 — the ONLY legal blank-line-height sources (never a heading). */
export const EOF_BLANK_LINE_HEIGHT_SOURCE_ACTUAL_BLANK_NODE = 'ACTUAL_BLANK_NODE_GEOMETRY'
export const EOF_BLANK_LINE_HEIGHT_SOURCE_EDITOR_BASE = 'EDITOR_BASE_LINE_HEIGHT'
export const EOF_BLANK_LINE_HEIGHT_SOURCE_NONE = 'NONE'
export const EOF_PRESENTATION_HEIGHT_SOURCE_ACTUAL_TRAILING_BLANK_GEOMETRY = 'ACTUAL_TRAILING_BLANK_GEOMETRY'
/** V5.13-R5 §3/§35 — the FORBIDDEN height formula (kept only as a gate token). */
export const EOF_PRESENTATION_HEIGHT_SOURCE_EXTRA_COUNT_X_LINE_HEIGHT = 'EXTRA_COUNT_X_LINE_HEIGHT'
/** V5.13-R5 §8 — a collapsed DOM tail still yields a bounded, safe marker. */
export const EOF_COMPACT_SAFE_TAIL_MAX_LINES = 2

/** §6.1 — degenerate-guard only: a real zone is always taller than this. */
export const EOF_VISUAL_MIN_HEIGHT_PX = 28
/** §6.3 — inner gap between the required zone and the excessive zone. */
export const EOF_VISUAL_GAP_PX = 6
/** Fallback line height when the editor exposes no resolvable line-height. */
export const EOF_FALLBACK_LINE_HEIGHT_PX = 24
/** §6.2 — a degenerate narrow content column still yields a visible marker. */
export const EOF_MIN_CONTENT_WIDTH_PX = 24

// ── V5.13-R2/R4 §1/§2/§4/§5 — Required zone / Excessive zone / Presentation ─

/** §2.2 — the presentation right edge comes from the DOCUMENT CONTENT column. */
export const DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT = 'DOCUMENT_CONTENT'
/** §2.1/§4 — the legal trailing blank line(s) are NEVER painted. */
export const EOF_ONE_TRAILING_BLANK_ALLOWANCE_LINES = 1
/** V5.13-R4 §4 — the required (legal) trailing blank line count. */
export const EOF_REQUIRED_TRAILING_BLANK_LINE_COUNT = EOF_ONE_TRAILING_BLANK_ALLOWANCE_LINES
/** V5.13-R4 §5 — the presentation height authority is the EXCESSIVE blank zone. */
export const EOF_PRESENTATION_HEIGHT_SOURCE_EXCESSIVE_BLANK_ZONE = 'EXCESSIVE_BLANK_ZONE'
/** V5.13-R4 §6 — the band must fully cover the excessive zone. */
export const EOF_EXCESS_ZONE_COVERAGE_MIN = 0.98
export const EOF_EXCESS_ZONE_DRIFT_MAX_PX = 1
/** §5 — the band must really be inside the viewport after the page-end settle. */
export const EOF_VISIBLE_HEIGHT_RATIO_MIN = 0.90
export const EOF_VISIBLE_HEIGHT_RATIO_TARGET = 0.95
/** §3 — a panel that only paints OVER the band is expected, never a geometry clip. */
export const EOF_PANEL_OVERLAY_OCCLUSION_REASON = 'EXPECTED_PANEL_OVERLAY_OCCLUSION'
export const EOF_BOTTOM_ALIGNED_FALLBACK_REASON = 'BOTTOM_ALIGNED_FALLBACK'

/**
 * V5.13-R4 §4/§5/§6 — the presentation height IS the FULL excessive blank zone:
 * `extraTrailingBlankLineCount × lineHeight`. There is NO fixed 36/48px cap any
 * more (`presentationHeight = 36` / `Math.min(semanticHeight, 48)` are forbidden):
 * the warning fill must cover EVERY excessive trailing blank line.
 */
export function computeEofPresentationHeight(
  extraTrailingBlankLineCount: number,
  lineHeight: number | null = null,
): number {
  const count = Math.max(0, Math.floor(extraTrailingBlankLineCount))
  const lh = lineHeight != null && Number.isFinite(lineHeight) && lineHeight > 0
    ? lineHeight
    : EOF_FALLBACK_LINE_HEIGHT_PX
  // §4 — a fixed presentation height is FORBIDDEN; the excessive zone height is
  // the authority. The MIN only guards a degenerate (0-line) zone.
  return Math.max(EOF_VISUAL_MIN_HEIGHT_PX, count * lh)
}

// ── §14 — hard gates (all must stay 0) ─────────────────────────────────────

export const DOCUMENT_END_VISUAL_V513R1_GATE_KEYS = [
  'locatableWithoutVisualTarget',
  'targetRectNull',
  'fillCountZeroAfterLocate',
  'visualNotVisibleAfterScroll',
  'finalFailVisual',
  'staleLayoutEpoch',
  'missingRemeasureAfterScroll',
  'viewportSpaceMarker',
  'falseNativePaddingCoverage',
  'overlayPanelIntersection',
  'drawerRightEdgeAuthority',
  'verticalLine',
  'horizontalLine',
  'border',
  'outline',
  'keyline',
  'cornerArm',
  'editorShadow',
  'staleMarkerAfterDiagnosticRemoved',
] as const

export type DocumentEndVisualV513R1GateKey = typeof DOCUMENT_END_VISUAL_V513R1_GATE_KEYS[number]

export const DOCUMENT_END_VISUAL_V513R1_GATE_LABELS: Readonly<Record<DocumentEndVisualV513R1GateKey, string>> = {
  locatableWithoutVisualTarget: 'DOCUMENT_END_LOCATABLE_WITHOUT_VISUAL_TARGET_COUNT',
  targetRectNull: 'DOCUMENT_END_TARGET_RECT_NULL_COUNT',
  fillCountZeroAfterLocate: 'DOCUMENT_END_FILL_COUNT_ZERO_AFTER_LOCATE',
  visualNotVisibleAfterScroll: 'DOCUMENT_END_VISUAL_NOT_VISIBLE_AFTER_SCROLL_COUNT',
  finalFailVisual: 'DOCUMENT_END_FINAL_FAIL_VISUAL_COUNT',
  staleLayoutEpoch: 'DOCUMENT_END_STALE_LAYOUT_EPOCH_COUNT',
  missingRemeasureAfterScroll: 'DOCUMENT_END_MISSING_REMEASURE_AFTER_SCROLL_COUNT',
  viewportSpaceMarker: 'DOCUMENT_END_VIEWPORT_SPACE_MARKER_COUNT',
  falseNativePaddingCoverage: 'DOCUMENT_END_FALSE_NATIVE_PADDING_COVERAGE_COUNT',
  overlayPanelIntersection: 'DOCUMENT_END_OVERLAY_PANEL_INTERSECTION_COUNT',
  drawerRightEdgeAuthority: 'DOCUMENT_END_DRAWER_RIGHT_EDGE_AUTHORITY_COUNT',
  verticalLine: 'DOCUMENT_END_VERTICAL_LINE_COUNT',
  horizontalLine: 'DOCUMENT_END_HORIZONTAL_LINE_COUNT',
  border: 'DOCUMENT_END_BORDER_COUNT',
  outline: 'DOCUMENT_END_OUTLINE_COUNT',
  keyline: 'DOCUMENT_END_KEYLINE_COUNT',
  cornerArm: 'DOCUMENT_END_CORNER_ARM_COUNT',
  editorShadow: 'DOCUMENT_END_EDITOR_SHADOW_COUNT',
  staleMarkerAfterDiagnosticRemoved: 'DOCUMENT_END_STALE_MARKER_AFTER_DIAGNOSTIC_REMOVED_COUNT',
}

export type DocumentEndVisualV513R1Counters = Record<DocumentEndVisualV513R1GateKey, number>

export function createDocumentEndVisualV513R1Counters(): DocumentEndVisualV513R1Counters {
  return DOCUMENT_END_VISUAL_V513R1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentEndVisualV513R1Counters)
}

export function formatDocumentEndVisualV513R1GateReport(
  counters: Readonly<DocumentEndVisualV513R1Counters>,
): string[] {
  return DOCUMENT_END_VISUAL_V513R1_GATE_KEYS.map(
    k => `${DOCUMENT_END_VISUAL_V513R1_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateDocumentEndVisualV513R1Gates(
  counters: Readonly<DocumentEndVisualV513R1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentEndVisualV513R1GateKey[] } {
  const failedChecks = DOCUMENT_END_VISUAL_V513R1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §5.1 — semantic facts ──────────────────────────────────────────────────

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** A plain rect rebuilt from its edges (never `{...old, right}` — §7). */
export function makeRectLike(left: number, top: number, right: number, bottom: number): RectLike {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/** §5.1 — metadata reader for the excess traversal count. */
export function readExtraTrailingBlankLineCount(metadata: unknown): number {
  const meta = (metadata ?? {}) as Record<string, unknown>
  const raw = meta.extraTrailingBlankLineCount
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/** §5.1 — the rule's own threshold (0~1 extra blank lines are legal). */
export const DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS = 2

/**
 * §5.1 — is this diagnostic the `document-end` trailing-blank warning that needs
 * a synthetic visual target? Only the rule's OWN excess count decides: an
 * unrelated `document-end` rule (e.g. missing terminal newline) never gets a
 * blank-line marker.
 */
export function isDocumentEndTrailingBlankDiagnostic(input: {
  code: string
  locationKind: string | null
  extraTrailingBlankLineCount: number | null
}): boolean {
  if (input.code !== DOCUMENT_END_TRAILING_BLANK_RULE) return false
  if (input.locationKind !== 'document-end') return false
  return (input.extraTrailingBlankLineCount ?? 0) >= DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS
}

// ── §6 — synthetic EOF geometry ────────────────────────────────────────────

export interface SyntheticEofGeometryInput {
  /** V5.13-R5 §5 — a NON-empty document MUST resolve its last meaningful content. */
  documentIsNonEmpty: boolean
  /** Viewport rect of the LAST meaningful content block (null when unmeasurable). */
  lastMeaningfulRect: RectLike | null
  /**
   * V5.13-R5 §6/§8 — the REAL empty trailing block rects AFTER the last meaningful
   * block, in document order. This is the ONLY vertical authority for the zone.
   */
  trailingBlankRects: RectLike[]
  /** V5.13-R5 §10/§15 — every meaningful (non-empty) top-level block rect. */
  meaningfulRects: RectLike[]
  /**
   * V5.13-R3 §8 (frozen) — the real MARKDOWN CONTENT column: the ONLY horizontal
   * authority (left = text column, right = its right edge). Never a drawer edge.
   */
  contentBoundsRect: RectLike | null
  /** Viewport rect of the editor content column (vertical tail cap). */
  editorContentRect: RectLike | null
  /** V5.13-R5 §11 — the REAL trailing-blank line height (never a heading's). */
  blankLineHeight: number | null
  /** V5.13-R5 §11 — ACTUAL_BLANK_NODE_GEOMETRY / EDITOR_BASE_LINE_HEIGHT / NONE. */
  blankLineHeightSource: string
  extraTrailingBlankLineCount: number
  gapPx?: number
  /**
   * V5.13-R3 §8 — the DOCUMENT-LEVEL text column left (the stable prose column).
   * Never the page/write outer left, the last block, the semantic zone, a selected
   * block or an indented descendant.
   */
  textColumnLeft?: number | null
}

export interface SyntheticEofGeometry {
  /** §5 — the PAINTED presentation band (= the excessive trailing blank zone). */
  rect: RectLike | null
  /** §2.1 — same extent as the band (R2 continuity). */
  semanticZoneRect: RectLike | null
  /** V5.13-R4 §5 / R5 §9 — the REQUIRED (legal) blank zone; never the painted zone. */
  requiredBlankZoneRect: RectLike | null
  /** V5.13-R4 §5 / R5 §6 — the excessive trailing blank zone the band spans. */
  excessiveBlankZoneRect: RectLike | null
  /** V5.13-R5 §6 — the REAL trailing blank visual zone (DOM / editor tail). */
  actualTrailingBlankVisualRect: RectLike | null
  documentEndBottom: number
  lastMeaningfulRect: RectLike | null
  requiredTrailingBlankLineCount: number
  excessiveTrailingBlankLineCount: number
  /** V5.13-R5 §3 — always ACTUAL_TRAILING_BLANK_GEOMETRY (never EXTRA_COUNT_X_…). */
  presentationHeightSource: string
  presentationHeight: number
  geometrySource: string
  /** V5.13-R5 §11 — never a heading-derived line height. */
  blankLineHeightSource: string
  /** §2.2 — always DOCUMENT_CONTENT (never DRAWER / UNOBSCURED_VIEWPORT). */
  rightEdgeAuthority: string
  /** V5.13-R5 §10 — |band.top − lastMeaningfulRect.bottom| (viewport space). */
  presentationTopMinusLastMeaningfulBottom: number
  /** V5.13-R5 §15 — meaningful blocks the band intersects (must be 0). */
  meaningfulIntersectionCount: number
  meaningfulIntersectionArea: number
  /** V5.13-R4 — the band is NEVER moved off the zone → always false. */
  viewportClamped: boolean
  /** V5.13-R5 §5 — a NON-empty doc that cannot resolve its last content FAILS CLOSED. */
  failClosed: boolean
}

/**
 * V5.13-R5 §3/§6/§7/§9 — build the layered document-end geometry.
 *
 * Source Truth  : `extraTrailingBlankLineCount` (never a geometry input).
 * Visual Truth  : the REAL last meaningful content rect + the REAL trailing blank
 *                 DOM / editor tail space. The zone is NEVER back-projected as
 *                 `extraCount × guessedLineHeight`, and it can never reach back up
 *                 into meaningful content.
 */
export function computeSyntheticEofGeometry(input: SyntheticEofGeometryInput): SyntheticEofGeometry {
  const count = Math.max(0, Math.floor(input.extraTrailingBlankLineCount))
  const requiredLines = EOF_REQUIRED_TRAILING_BLANK_LINE_COUNT
  const lh = input.blankLineHeight != null && Number.isFinite(input.blankLineHeight) && input.blankLineHeight > 0
    ? input.blankLineHeight
    : EOF_FALLBACK_LINE_HEIGHT_PX
  const empty = (over: Partial<SyntheticEofGeometry>): SyntheticEofGeometry => ({
    rect: null, semanticZoneRect: null, requiredBlankZoneRect: null, excessiveBlankZoneRect: null,
    actualTrailingBlankVisualRect: null, documentEndBottom: 0,
    lastMeaningfulRect: input.lastMeaningfulRect,
    requiredTrailingBlankLineCount: requiredLines, excessiveTrailingBlankLineCount: count,
    presentationHeightSource: EOF_PRESENTATION_HEIGHT_SOURCE_ACTUAL_TRAILING_BLANK_GEOMETRY,
    presentationHeight: 0,
    geometrySource: EOF_GEOMETRY_SOURCE_COMPACT_SAFE_FALLBACK,
    blankLineHeightSource: input.blankLineHeightSource,
    rightEdgeAuthority: DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
    presentationTopMinusLastMeaningfulBottom: 0,
    meaningfulIntersectionCount: 0, meaningfulIntersectionArea: 0,
    viewportClamped: false, failClosed: false,
    ...over,
  })

  const last = input.lastMeaningfulRect
  // §5 — a missing baseline must NEVER become a huge synthetic zone.
  if (!last) return empty({ failClosed: input.documentIsNonEmpty })

  const content = input.contentBoundsRect ?? input.editorContentRect
  const left = input.textColumnLeft != null && Number.isFinite(input.textColumnLeft)
    ? input.textColumnLeft
    : (content ? content.left : last.left)
  const right = Math.max(left + EOF_MIN_CONTENT_WIDTH_PX, content ? content.right : last.right)
  const gap = input.gapPx ?? EOF_VISUAL_GAP_PX
  const blanks = input.trailingBlankRects.filter(r => Number.isFinite(r.top) && Number.isFinite(r.bottom))

  // §9 — the FIRST real trailing blank line is the legal one and is NOT the zone.
  const requiredTop = last.bottom
  const requiredBottom = blanks.length > 0
    ? Math.max(requiredTop + 1, blanks[0].bottom)
    : requiredTop + requiredLines * lh
  const requiredBlankZoneRect = makeRectLike(left, requiredTop, right, requiredBottom)

  // §6/§7/§8 — the excessive zone is MEASURED, never simulated.
  const tailCap = input.editorContentRect ? input.editorContentRect.bottom : null
  const boundedTail = (from: number): number => {
    const raw = from + EOF_COMPACT_SAFE_TAIL_MAX_LINES * lh
    return tailCap != null && Number.isFinite(tailCap) ? Math.min(raw, Math.max(tailCap, from)) : raw
  }
  let documentEndBottom: number
  let geometrySource: string
  if (blanks.length > 1) {
    documentEndBottom = blanks[blanks.length - 1].bottom
    geometrySource = EOF_GEOMETRY_SOURCE_ACTUAL_TRAILING_DOM_BLANK_ZONE
  } else if (blanks.length === 1) {
    documentEndBottom = boundedTail(requiredBottom)
    geometrySource = EOF_GEOMETRY_SOURCE_EDITOR_TAIL_SPACE
  } else {
    documentEndBottom = boundedTail(requiredBottom)
    geometrySource = EOF_GEOMETRY_SOURCE_COMPACT_SAFE_FALLBACK
  }

  // §10 HARD — the band top may never rise above the last meaningful bottom.
  const zoneTop = Math.max(requiredBottom + gap, last.bottom + gap)
  const zoneBottom = Math.max(zoneTop + EOF_VISUAL_MIN_HEIGHT_PX, documentEndBottom)
  const band = makeRectLike(left, zoneTop, right, zoneBottom)
  const actualTrailingBlankVisualRect = makeRectLike(
    left,
    blanks.length > 0 ? blanks[0].top : requiredTop,
    right,
    Math.max((blanks.length > 0 ? blanks[0].top : requiredTop) + 1, documentEndBottom),
  )

  // §10/§15 — the fill must NEVER intersect meaningful content.
  let meaningfulIntersectionCount = 0
  let meaningfulIntersectionArea = 0
  for (const m of input.meaningfulRects) {
    const top = Math.max(band.top, m.top)
    const bottom = Math.min(band.bottom, m.bottom)
    const l = Math.max(band.left, m.left)
    const r = Math.min(band.right, m.right)
    const h = bottom - top
    const w = r - l
    if (h > 0.5 && w > 0.5) {
      meaningfulIntersectionCount++
      meaningfulIntersectionArea += h * w
    }
  }

  return {
    rect: band,
    semanticZoneRect: band,
    requiredBlankZoneRect,
    excessiveBlankZoneRect: band,
    actualTrailingBlankVisualRect,
    documentEndBottom,
    lastMeaningfulRect: last,
    requiredTrailingBlankLineCount: requiredLines,
    excessiveTrailingBlankLineCount: count,
    presentationHeightSource: EOF_PRESENTATION_HEIGHT_SOURCE_ACTUAL_TRAILING_BLANK_GEOMETRY,
    presentationHeight: band.height,
    geometrySource,
    blankLineHeightSource: input.blankLineHeightSource,
    rightEdgeAuthority: DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
    presentationTopMinusLastMeaningfulBottom: band.top - last.bottom,
    meaningfulIntersectionCount,
    meaningfulIntersectionArea,
    viewportClamped: false,
    failClosed: false,
  }
}

/**
 * V5.13-R4 §6 — how much of the EXCESSIVE zone the painted band really covers.
 * 1.0 = the band spans the whole excessive zone.
 */
export function computeExcessZoneCoverage(
  presentationRect: RectLike | null,
  excessiveBlankZoneRect: RectLike | null,
): number {
  if (!presentationRect || !excessiveBlankZoneRect) return 0
  if (excessiveBlankZoneRect.height <= 0) return 0
  const overlapTop = Math.max(presentationRect.top, excessiveBlankZoneRect.top)
  const overlapBottom = Math.min(presentationRect.bottom, excessiveBlankZoneRect.bottom)
  const overlap = Math.max(0, overlapBottom - overlapTop)
  return Math.max(0, Math.min(1, overlap / excessiveBlankZoneRect.height))
}

/**
 * V5.13-R4 §6/§10 — how many excessive blank lines the painted band covers. A flat
 * integer so `N painted ≡ N excessive` is directly checkable.
 *
 * The painted carrier is pixel-rounded (`Math.round`), so the band can be < 1px
 * shorter than the zone. That rounding must NEVER be able to drop a whole line:
 * the same §6 drift tolerance is applied to the covered height.
 */
export function countPaintedExcessBlankLines(
  presentationRect: RectLike | null,
  excessiveBlankZoneRect: RectLike | null,
  lineHeight: number | null,
  driftTolerancePx: number = EOF_EXCESS_ZONE_DRIFT_MAX_PX,
): number {
  const lh = lineHeight != null && Number.isFinite(lineHeight) && lineHeight > 0
    ? lineHeight
    : EOF_FALLBACK_LINE_HEIGHT_PX
  if (!presentationRect || !excessiveBlankZoneRect) return 0
  const zone = excessiveBlankZoneRect
  if (zone.height <= 0) return 0
  const overlapTop = Math.max(presentationRect.top, zone.top)
  const overlapBottom = Math.min(presentationRect.bottom, zone.bottom)
  const coveredHeight = Math.max(0, overlapBottom - overlapTop)
  const zoneLines = Math.max(0, Math.round(zone.height / lh))
  const coveredLines = Math.floor((coveredHeight + Math.max(0, driftTolerancePx)) / lh + 1e-6)
  return Math.max(0, Math.min(zoneLines, coveredLines))
}

/** §5 — how much of the band's HEIGHT really sits inside the visible editor. */
export function presentationVisibleHeightRatio(
  presentationRect: RectLike | null,
  visibleEditorRect: RectLike | null,
): number {
  if (!presentationRect || !visibleEditorRect) return 0
  if (presentationRect.height <= 0) return 0
  const overlapTop = Math.max(presentationRect.top, visibleEditorRect.top)
  const overlapBottom = Math.min(presentationRect.bottom, visibleEditorRect.bottom)
  const visibleHeight = Math.max(0, overlapBottom - overlapTop)
  return Math.max(0, Math.min(1, visibleHeight / presentationRect.height))
}

/** §14 — the marker must not be the editor block itself (never a native padding wash). */
export function isFalseNativePaddingCoverage(input: {
  syntheticHeight: number
  editorContentHeight: number | null
  semanticBlankCount: number
  lineHeight: number | null
}): boolean {
  const editorH = input.editorContentHeight
  if (editorH == null || !Number.isFinite(editorH) || editorH <= 0) return false
  const lineHeight = input.lineHeight != null && input.lineHeight > 0 ? input.lineHeight : EOF_FALLBACK_LINE_HEIGHT_PX
  // V5.13-R4 — the semantic reference is the RAW excessive height (never clamped):
  // a full-coverage band legitimately equals the excessive zone, so it must not be
  // mistaken for a whole-editor "native padding wash".
  const semantic = Math.max(EOF_VISUAL_MIN_HEIGHT_PX, input.semanticBlankCount * lineHeight)
  // A "native padding wash" is a marker whose height is BOTH the whole editor
  // content column AND far larger than the semantic band.
  return input.syntheticHeight >= editorH - 1 && input.syntheticHeight > semantic + 1
}

/** §14 — the right edge must be the semantic content edge, never the Drawer. */
export function isDrawerRightEdgeAuthority(input: {
  syntheticRight: number | null
  drawerLeft: number | null
  semanticContentRight: number | null
}): boolean {
  const { syntheticRight, drawerLeft, semanticContentRight } = input
  if (syntheticRight == null || drawerLeft == null) return false
  if (semanticContentRight != null && Math.abs(syntheticRight - semanticContentRight) <= 1) return false
  return Math.abs(syntheticRight - drawerLeft) <= 1
}

// ── V5.13-R2 §9 — the refinement hard gates (all must stay 0) ───────────────

/** §9 — the R2 gates. V5.13-R4 §8 ABOLISHED `presentationHeightGt48px`: a fixed
 *  36/48px presentation bound must NEVER block full excessive-blank coverage. */
export const DOCUMENT_END_VISUAL_V513R2_GATE_KEYS = [
  'semanticRightFromDrawer',
  'presentationRightFromDrawer',
  'presentationVisibleHeightRatioLt090',
  'panelGeometryClip',
  'visualPaintsAboveDrawer',
  'genericClosureTargetNull',
  'genericClosureSeverityMismatch',
  'genericClosureVisualDecisionNa',
  'genericClosureCommitDecisionNa',
  'terminalNewlineFactNull',
  'sourceRevisionNull',
  'scrollSettledWithoutRemeasure',
  'staleLayoutEpochCommit',
  'secondClickRequired',
] as const

export type DocumentEndVisualV513R2GateKey = typeof DOCUMENT_END_VISUAL_V513R2_GATE_KEYS[number]

export const DOCUMENT_END_VISUAL_V513R2_GATE_LABELS: Readonly<Record<DocumentEndVisualV513R2GateKey, string>> = {
  semanticRightFromDrawer: 'DOCUMENT_END_SEMANTIC_RIGHT_FROM_DRAWER_COUNT',
  presentationRightFromDrawer: 'DOCUMENT_END_PRESENTATION_RIGHT_FROM_DRAWER_COUNT',
  presentationVisibleHeightRatioLt090: 'DOCUMENT_END_PRESENTATION_VISIBLE_HEIGHT_RATIO_LT_0_90_COUNT',
  panelGeometryClip: 'DOCUMENT_END_PANEL_GEOMETRY_CLIP_COUNT',
  visualPaintsAboveDrawer: 'DOCUMENT_END_VISUAL_PAINTS_ABOVE_DRAWER_COUNT',
  genericClosureTargetNull: 'DOCUMENT_END_GENERIC_CLOSURE_TARGET_NULL_COUNT',
  genericClosureSeverityMismatch: 'DOCUMENT_END_GENERIC_CLOSURE_SEVERITY_MISMATCH_COUNT',
  genericClosureVisualDecisionNa: 'DOCUMENT_END_GENERIC_CLOSURE_VISUAL_DECISION_NA_COUNT',
  genericClosureCommitDecisionNa: 'DOCUMENT_END_GENERIC_CLOSURE_COMMIT_DECISION_NA_COUNT',
  terminalNewlineFactNull: 'DOCUMENT_END_TERMINAL_NEWLINE_FACT_NULL_COUNT',
  sourceRevisionNull: 'DOCUMENT_END_SOURCE_REVISION_NULL_COUNT',
  scrollSettledWithoutRemeasure: 'DOCUMENT_END_SCROLL_SETTLED_WITHOUT_REMEASURE_COUNT',
  staleLayoutEpochCommit: 'DOCUMENT_END_STALE_LAYOUT_EPOCH_COMMIT_COUNT',
  secondClickRequired: 'DOCUMENT_END_SECOND_CLICK_REQUIRED_COUNT',
}

export type DocumentEndVisualV513R2Counters = Record<DocumentEndVisualV513R2GateKey, number>

export function createDocumentEndVisualV513R2Counters(): DocumentEndVisualV513R2Counters {
  return DOCUMENT_END_VISUAL_V513R2_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentEndVisualV513R2Counters)
}

export function formatDocumentEndVisualV513R2GateReport(
  counters: Readonly<DocumentEndVisualV513R2Counters>,
): string[] {
  return DOCUMENT_END_VISUAL_V513R2_GATE_KEYS.map(
    k => `${DOCUMENT_END_VISUAL_V513R2_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateDocumentEndVisualV513R2Gates(
  counters: Readonly<DocumentEndVisualV513R2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentEndVisualV513R2GateKey[] } {
  const failedChecks = DOCUMENT_END_VISUAL_V513R2_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── V5.13-R3 §3/§4/§5 — Document-Level Text Column Anchor ─────────────────

/** §10 — the EOF-specific marker kind (never applied to other diagnostics). */
export const EOF_MARKER_KIND_DOCUMENT_END_WARNING = 'document-end-warning'
/** §10 — the EOF band uses a LOWER-emphasis fill than a normal warning block. */
export const EOF_FILL_EMPHASIS_CLASS_LOW = 'LOW_EMPHASIS'
/** §9 — the left warning accent. */
export const EOF_ACCENT_WIDTH_PX = 4
export const EOF_ACCENT_MIN_WIDTH_PX = 3
export const EOF_ACCENT_MAX_WIDTH_PX = 4
/** §11 — a 4px left accent pairs with a flat left edge and a soft right edge. */
export const EOF_ACCENT_BORDER_RADIUS = '0 6px 6px 0'

export const DOCUMENT_TEXT_COLUMN_SOURCE = {
  EDITOR_TEXT_COLUMN: 'EDITOR_TEXT_COLUMN',
  TOP_LEVEL_PROSE: 'TOP_LEVEL_PROSE',
  STABLE_CACHED_PROSE: 'STABLE_CACHED_PROSE',
  CONTENT_LEFT_FALLBACK: 'CONTENT_LEFT_FALLBACK',
} as const
export type DocumentTextColumnSource = typeof DOCUMENT_TEXT_COLUMN_SOURCE[keyof typeof DOCUMENT_TEXT_COLUMN_SOURCE]

/** §3 — the document-level layout anchors (ONE authority, never per-block). */
export interface DocumentLayoutAnchors {
  documentContentLeft: number
  documentContentRight: number
  documentTextColumnLeft: number
  documentTextColumnSource: DocumentTextColumnSource
  layoutEpoch: number
  documentKey: string
}

/** §6 — only plain top-level prose/heading lines qualify as the text column. */
export const EOF_TEXT_COLUMN_PROSE_TAGS: readonly string[] = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']

export interface TextColumnCandidateInput {
  tagName: string
  isDirectChildOfContentRoot: boolean
  /** Inside li/ul/ol, blockquote, pre/code, table/td/th, nested block or overlay. */
  insideIndentedContainer: boolean
  left: number | null
  hasText: boolean
}

export function isTextColumnCandidate(input: TextColumnCandidateInput): boolean {
  if (input.insideIndentedContainer) return false
  if (!input.isDirectChildOfContentRoot) return false
  if (!input.hasText) return false
  if (input.left == null || !Number.isFinite(input.left)) return false
  return EOF_TEXT_COLUMN_PROSE_TAGS.includes(String(input.tagName).toUpperCase())
}

/**
 * §5 — pick the STABLE column left. Priority: editor text column → top-level prose
 * → cached prose (same document + layout width) → content-left fallback.
 * NEVER derived from the last block / semantic zone / a selected block / an
 * indented descendant.
 */
export function pickDocumentTextColumnLeft(input: {
  editorTextColumnLeft: number | null
  topLevelProseLefts: number[]
  cachedLeft: number | null
  contentLeft: number | null
}): { left: number | null; source: DocumentTextColumnSource } {
  const prose = input.topLevelProseLefts.filter(v => Number.isFinite(v))
  if (input.editorTextColumnLeft != null && Number.isFinite(input.editorTextColumnLeft)) {
    return { left: input.editorTextColumnLeft, source: DOCUMENT_TEXT_COLUMN_SOURCE.EDITOR_TEXT_COLUMN }
  }
  if (prose.length > 0) {
    // §4 — the STABLE column is the LEAST-indented prose line: a deeply indented
    // block later in the document can never drag the anchor.
    return { left: Math.min(...prose), source: DOCUMENT_TEXT_COLUMN_SOURCE.TOP_LEVEL_PROSE }
  }
  if (input.cachedLeft != null && Number.isFinite(input.cachedLeft)) {
    return { left: input.cachedLeft, source: DOCUMENT_TEXT_COLUMN_SOURCE.STABLE_CACHED_PROSE }
  }
  if (input.contentLeft != null && Number.isFinite(input.contentLeft)) {
    return { left: input.contentLeft, source: DOCUMENT_TEXT_COLUMN_SOURCE.CONTENT_LEFT_FALLBACK }
  }
  return { left: null, source: DOCUMENT_TEXT_COLUMN_SOURCE.CONTENT_LEFT_FALLBACK }
}

/** §21 — R3 hard gates (the R2 set stays 0 as well). */
export const DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS = [
  'leftAnchorAtPageEdge',
  'fromLastMeaningfulRect',
  'fromSemanticZoneLeft',
  'fromSelectedBlock',
  'fromIndentedDescendant',
  'textColumnLeftDriftGt1px',
  'accentWidthLt3px',
  'accentWidthGt4px',
  'topBorder',
  'rightBorder',
  'bottomBorder',
  'outline',
  'shadow',
  'nonWarningAccent',
  'nonEofVerticalLineRegression',
] as const

export type DocumentEndTextColumnV513R3GateKey = typeof DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS[number]

export const DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS: Readonly<Record<DocumentEndTextColumnV513R3GateKey, string>> = {
  leftAnchorAtPageEdge: 'DOCUMENT_END_LEFT_ANCHOR_AT_PAGE_EDGE_COUNT',
  fromLastMeaningfulRect: 'EOF_LEFT_ANCHOR_FROM_LAST_MEANINGFUL_RECT_COUNT',
  fromSemanticZoneLeft: 'EOF_LEFT_ANCHOR_FROM_SEMANTIC_ZONE_LEFT_COUNT',
  fromSelectedBlock: 'EOF_LEFT_ANCHOR_FROM_SELECTED_BLOCK_COUNT',
  fromIndentedDescendant: 'EOF_LEFT_ANCHOR_FROM_INDENTED_DESCENDANT_COUNT',
  textColumnLeftDriftGt1px: 'DOCUMENT_TEXT_COLUMN_LEFT_DRIFT_GT_1PX_COUNT',
  accentWidthLt3px: 'DOCUMENT_END_ACCENT_WIDTH_LT_3PX_COUNT',
  accentWidthGt4px: 'DOCUMENT_END_ACCENT_WIDTH_GT_4PX_COUNT',
  topBorder: 'DOCUMENT_END_TOP_BORDER_COUNT',
  rightBorder: 'DOCUMENT_END_RIGHT_BORDER_COUNT',
  bottomBorder: 'DOCUMENT_END_BOTTOM_BORDER_COUNT',
  outline: 'DOCUMENT_END_OUTLINE_COUNT',
  shadow: 'DOCUMENT_END_SHADOW_COUNT',
  nonWarningAccent: 'DOCUMENT_END_NON_WARNING_ACCENT_COUNT',
  nonEofVerticalLineRegression: 'NON_EOF_ACTIVE_LOCATE_VERTICAL_LINE_REGRESSION_COUNT',
}

export type DocumentEndTextColumnV513R3Counters = Record<DocumentEndTextColumnV513R3GateKey, number>

export function createDocumentEndTextColumnV513R3Counters(): DocumentEndTextColumnV513R3Counters {
  return DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentEndTextColumnV513R3Counters)
}

export function formatDocumentEndTextColumnV513R3GateReport(
  counters: Readonly<DocumentEndTextColumnV513R3Counters>,
): string[] {
  return DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS.map(
    k => `${DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateDocumentEndTextColumnV513R3Gates(
  counters: Readonly<DocumentEndTextColumnV513R3Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentEndTextColumnV513R3GateKey[] } {
  const failedChecks = DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §14 — |left(A) − left(B)| must stay within 1px across last-block shapes. */
export function isTextColumnDriftWithinTolerance(lefts: ReadonlyArray<number | null>, tolerancePx = 1): boolean {
  const values = lefts.filter((v): v is number => v != null && Number.isFinite(v))
  if (values.length < 2) return true
  return Math.max(...values) - Math.min(...values) <= tolerancePx
}

/**
 * §19 — the EOF band's LEFT accent is the PRESENTATION SURFACE's own left-edge
 * style, NOT a decorative/detached locator rail. The legacy FILL_ONLY gates must
 * therefore not treat it as a "border line".
 */
export function isSurfaceLeftAccentOnly(input: {
  leftWidth: number
  topWidth: number
  rightWidth: number
  bottomWidth: number
  leftStyle: string
}): boolean {
  const leftOk = String(input.leftStyle).toLowerCase() === 'solid'
    && input.leftWidth >= EOF_ACCENT_MIN_WIDTH_PX - 0.01
    && input.leftWidth <= EOF_ACCENT_MAX_WIDTH_PX + 0.01
  return leftOk
    && input.topWidth <= 0.01
    && input.rightWidth <= 0.01
    && input.bottomWidth <= 0.01
}

// ── V5.13-R4 §7/§8 — full excessive-blank coverage hard gates (all must be 0) ─

export const DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS = [
  'excessZoneCoverageLt098',
  'excessZoneTopDriftGt1px',
  'excessZoneBottomDriftGt1px',
  'extraBlankCountMismatch',
  'requiredBlankLinePainted',
  'excessBlankLineOmitted',
] as const

export type DocumentEndExcessCoverageV513R4GateKey = typeof DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS[number]

export const DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_LABELS: Readonly<Record<DocumentEndExcessCoverageV513R4GateKey, string>> = {
  excessZoneCoverageLt098: 'DOCUMENT_END_EXCESS_ZONE_COVERAGE_LT_098_COUNT',
  excessZoneTopDriftGt1px: 'DOCUMENT_END_EXCESS_ZONE_TOP_DRIFT_GT_1PX_COUNT',
  excessZoneBottomDriftGt1px: 'DOCUMENT_END_EXCESS_ZONE_BOTTOM_DRIFT_GT_1PX_COUNT',
  extraBlankCountMismatch: 'DOCUMENT_END_EXTRA_BLANK_COUNT_MISMATCH_COUNT',
  requiredBlankLinePainted: 'DOCUMENT_END_REQUIRED_BLANK_LINE_PAINTED_COUNT',
  excessBlankLineOmitted: 'DOCUMENT_END_EXCESS_BLANK_LINE_OMITTED_COUNT',
}

export type DocumentEndExcessCoverageV513R4Counters = Record<DocumentEndExcessCoverageV513R4GateKey, number>

export function createDocumentEndExcessCoverageV513R4Counters(): DocumentEndExcessCoverageV513R4Counters {
  return DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentEndExcessCoverageV513R4Counters)
}

export function formatDocumentEndExcessCoverageV513R4GateReport(
  counters: Readonly<DocumentEndExcessCoverageV513R4Counters>,
): string[] {
  return DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS.map(
    k => `${DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateDocumentEndExcessCoverageV513R4Gates(
  counters: Readonly<DocumentEndExcessCoverageV513R4Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentEndExcessCoverageV513R4GateKey[] } {
  const failedChecks = DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/**
 * V5.13-R4 §3/§8 — the full coverage verdict for ONE committed band.
 *
 * `requiredBlankPainted` = the painted band starts INSIDE the required (legal) zone.
 * `excessBlankLineOmitted` = the band misses a whole excessive line.
 */
export function evaluateEofExcessCoverage(input: {
  presentationRect: RectLike | null
  excessiveBlankZoneRect: RectLike | null
  requiredBlankZoneRect: RectLike | null
  excessiveTrailingBlankLineCount: number
  lineHeight: number | null
  driftTolerancePx?: number
}): {
  coverageRatio: number
  topDriftPx: number
  bottomDriftPx: number
  paintedExcessBlankLineCount: number
  requiredBlankPainted: boolean
  coverageOk: boolean
  topDriftOk: boolean
  bottomDriftOk: boolean
  countMismatch: boolean
  excessBlankLineOmitted: boolean
} {
  const tol = input.driftTolerancePx ?? EOF_EXCESS_ZONE_DRIFT_MAX_PX
  const band = input.presentationRect
  const zone = input.excessiveBlankZoneRect
  const coverageRatio = computeExcessZoneCoverage(band, zone)
  const topDriftPx = band && zone ? Math.abs(band.top - zone.top) : Number.POSITIVE_INFINITY
  const bottomDriftPx = band && zone ? Math.abs(band.bottom - zone.bottom) : Number.POSITIVE_INFINITY
  const paintedExcessBlankLineCount = countPaintedExcessBlankLines(band, zone, input.lineHeight)
  const required = input.requiredBlankZoneRect
  // §3 — the required (legal) line must NEVER be painted: the band may not start
  // above the required zone's bottom edge.
  const requiredBlankPainted = !!(band && required && band.top < required.bottom - tol)
  return {
    coverageRatio,
    topDriftPx,
    bottomDriftPx,
    paintedExcessBlankLineCount,
    requiredBlankPainted,
    coverageOk: coverageRatio >= EOF_EXCESS_ZONE_COVERAGE_MIN,
    topDriftOk: topDriftPx <= tol,
    bottomDriftOk: bottomDriftPx <= tol,
    countMismatch: paintedExcessBlankLineCount !== Math.max(0, Math.floor(input.excessiveTrailingBlankLineCount)),
    excessBlankLineOmitted: paintedExcessBlankLineCount < Math.max(0, Math.floor(input.excessiveTrailingBlankLineCount)),
  }
}

// ── V5.13-R5 §15/§28 — real-geometry + multi-H1 visual Authority gates ──────

/** §15 — every one must stay 0. */
export const DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS = [
  'lastMeaningfulRectNullOnNonempty',
  'fillIntersectsMeaningfulContent',
  'zoneTopBeforeLastMeaningfulBottom',
  'blankLineHeightFromHeading',
  'syntheticBackProjectionIntoContent',
  'presentationFromExtraCountXGuessedLineHeight',
  'meaningfulIntersectionAreaGt0',
  /** §31 cross gate — the EOF fill must never touch a heading marker target. */
  'fillIntersectsHeadingMarkerTarget',
] as const

export type DocumentEndRealGeometryV513R5GateKey = typeof DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS[number]

export const DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_LABELS: Readonly<Record<DocumentEndRealGeometryV513R5GateKey, string>> = {
  lastMeaningfulRectNullOnNonempty: 'DOCUMENT_END_LAST_MEANINGFUL_RECT_NULL_ON_NONEMPTY_COUNT',
  fillIntersectsMeaningfulContent: 'DOCUMENT_END_FILL_INTERSECTS_MEANINGFUL_CONTENT_COUNT',
  zoneTopBeforeLastMeaningfulBottom: 'DOCUMENT_END_ZONE_TOP_BEFORE_LAST_MEANINGFUL_BOTTOM_COUNT',
  blankLineHeightFromHeading: 'DOCUMENT_END_BLANK_LINE_HEIGHT_FROM_HEADING_COUNT',
  syntheticBackProjectionIntoContent: 'DOCUMENT_END_SYNTHETIC_BACK_PROJECTION_INTO_CONTENT_COUNT',
  presentationFromExtraCountXGuessedLineHeight: 'DOCUMENT_END_PRESENTATION_FROM_EXTRA_COUNT_X_GUESSED_LINE_HEIGHT_COUNT',
  meaningfulIntersectionAreaGt0: 'DOCUMENT_END_MEANINGFUL_INTERSECTION_AREA_GT_0_COUNT',
  fillIntersectsHeadingMarkerTarget: 'EOF_FILL_INTERSECTS_HEADING_MARKER_TARGET_COUNT',
}

export type DocumentEndRealGeometryV513R5Counters = Record<DocumentEndRealGeometryV513R5GateKey, number>

export function createDocumentEndRealGeometryV513R5Counters(): DocumentEndRealGeometryV513R5Counters {
  return DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocumentEndRealGeometryV513R5Counters)
}

export function formatDocumentEndRealGeometryV513R5GateReport(
  counters: Readonly<DocumentEndRealGeometryV513R5Counters>,
): string[] {
  return DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS.map(
    k => `${DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateDocumentEndRealGeometryV513R5Gates(
  counters: Readonly<DocumentEndRealGeometryV513R5Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocumentEndRealGeometryV513R5GateKey[] } {
  const failedChecks = DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §11 — the ONLY legal blank-line-height sources (a heading's is FORBIDDEN). */
export function isForbiddenBlankLineHeightSource(source: string): boolean {
  const s = String(source).toUpperCase()
  return s.includes('HEADING') || s.includes('H1_LINE') || s === 'LAST_MEANINGFUL_BLOCK_LINE_HEIGHT'
}

// ── V5.13-R5 §27/§28 — Strict Multi-H1 visual Authority audit + gates ───────

export const STRICT_MULTI_H1_VISUAL_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-STRICT-MULTI-H1-VISUAL-AUDIT'
export const STRICT_SINGLE_H1_MULTIPLE_H1_RULE_ID = 'STRICT_SINGLE_H1_MULTIPLE_H1'

export const STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS = [
  'expectedExtraTargetCountMismatch',
  'passiveMarkerCountMismatch',
  'validPrimaryH1Marked',
  'transactionTargetCountCollapse',
  'activeTargetNotInExcessSet',
  'activeMarkerCountGt1',
  'siblingPassiveMarkerLost',
  'passiveActiveFillStack',
] as const

export type StrictMultiH1VisualV513R5GateKey = typeof STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS[number]

export const STRICT_MULTI_H1_VISUAL_V513R5_GATE_LABELS: Readonly<Record<StrictMultiH1VisualV513R5GateKey, string>> = {
  expectedExtraTargetCountMismatch: 'STRICT_MULTI_H1_EXPECTED_EXTRA_TARGET_COUNT_MISMATCH',
  passiveMarkerCountMismatch: 'STRICT_MULTI_H1_PASSIVE_MARKER_COUNT_MISMATCH',
  validPrimaryH1Marked: 'STRICT_MULTI_H1_VALID_PRIMARY_H1_MARKED_COUNT',
  transactionTargetCountCollapse: 'STRICT_MULTI_H1_TRANSACTION_TARGET_COUNT_COLLAPSE',
  activeTargetNotInExcessSet: 'STRICT_MULTI_H1_ACTIVE_TARGET_NOT_IN_EXCESS_SET_COUNT',
  activeMarkerCountGt1: 'STRICT_MULTI_H1_ACTIVE_MARKER_COUNT_GT1',
  siblingPassiveMarkerLost: 'STRICT_MULTI_H1_SIBLING_PASSIVE_MARKER_LOST_COUNT',
  passiveActiveFillStack: 'STRICT_MULTI_H1_PASSIVE_ACTIVE_FILL_STACK_COUNT',
}

export type StrictMultiH1VisualV513R5Counters = Record<StrictMultiH1VisualV513R5GateKey, number>

export function createStrictMultiH1VisualV513R5Counters(): StrictMultiH1VisualV513R5Counters {
  return STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as StrictMultiH1VisualV513R5Counters)
}

export function formatStrictMultiH1VisualV513R5GateReport(
  counters: Readonly<StrictMultiH1VisualV513R5Counters>,
): string[] {
  return STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS.map(
    k => `${STRICT_MULTI_H1_VISUAL_V513R5_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateStrictMultiH1VisualV513R5Gates(
  counters: Readonly<StrictMultiH1VisualV513R5Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: StrictMultiH1VisualV513R5GateKey[] } {
  const failedChecks = STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/**
 * V5.13-R5 §18/§19 — the ONE aggregate diagnostic keeps its complete target group.
 * `h1Count` H1s ⇒ the FIRST is the legal primary, the remaining `h1Count - 1` are
 * the excess targets (frozen declared order).
 */
export function computeMultiH1ExpectedExcessCount(h1Count: number): number {
  const n = Number.isFinite(h1Count) ? Math.floor(h1Count) : 0
  return Math.max(0, n - 1)
}

/** V5.13-R5 §26 — ONE cardinality authority: the declared target group size. */
export function resolveDiagnosticTargetGroupSize(location: {
  kind?: string
  targets?: readonly unknown[]
} | null | undefined): number {
  if (!location) return 1
  if (location.kind === 'multi-target') return Array.isArray(location.targets) ? location.targets.length : 0
  // Target Group V1 §15 — a target-group's member count is its declared size.
  if (location.kind === 'target-group') return Array.isArray(location.targets) ? location.targets.length : 0
  return 1
}
