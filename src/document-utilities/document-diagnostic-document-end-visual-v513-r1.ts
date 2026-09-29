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

/** §6.1 — the marker is compact: never hundreds of pixels for 20 blank lines. */
export const EOF_VISUAL_MIN_HEIGHT_PX = 28
export const EOF_VISUAL_MAX_HEIGHT_PX = 48
/** §6.3 — inner gap after the last meaningful content block. */
export const EOF_VISUAL_GAP_PX = 6
/** Fallback line height when the editor exposes no resolvable line-height. */
export const EOF_FALLBACK_LINE_HEIGHT_PX = 24
/** §6.2 — a degenerate narrow content column still yields a visible marker. */
export const EOF_MIN_CONTENT_WIDTH_PX = 24

// ── V5.13-R2 §1/§2 — Semantic Zone / Presentation Band split ───────────────

/** §2.2 — the presentation right edge comes from the DOCUMENT CONTENT column. */
export const DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT = 'DOCUMENT_CONTENT'
/** §2.1 — the legal first trailing blank line is NEVER painted. */
export const EOF_ONE_TRAILING_BLANK_ALLOWANCE_LINES = 1
/** §1.1 — compact presentation mapping (NOT linear in the blank count). */
export const EOF_PRESENTATION_BASE_HEIGHT_PX = 30
export const EOF_PRESENTATION_STEP_PX = 3
export const EOF_PRESENTATION_MAX_STEP_LINES = 4
export const EOF_PRESENTATION_MIN_HEIGHT_PX = 28
export const EOF_PRESENTATION_MAX_HEIGHT_PX = 44
/** §1.1 — the hard presentation bound (never a big card). */
export const EOF_PRESENTATION_HARD_MAX_HEIGHT_PX = 48
/** §5 — the band must really be inside the viewport after the page-end settle. */
export const EOF_VISIBLE_HEIGHT_RATIO_MIN = 0.90
export const EOF_VISIBLE_HEIGHT_RATIO_TARGET = 0.95
/** §3 — a panel that only paints OVER the band is expected, never a geometry clip. */
export const EOF_PANEL_OVERLAY_OCCLUSION_REASON = 'EXPECTED_PANEL_OVERLAY_OCCLUSION'
export const EOF_BOTTOM_ALIGNED_FALLBACK_REASON = 'BOTTOM_ALIGNED_FALLBACK'

/** §1.1 — compact height: base + a few small steps, hard-bounded at 48px. */
export function computeEofPresentationHeight(extraTrailingBlankLineCount: number): number {
  const count = Math.max(1, Math.floor(extraTrailingBlankLineCount))
  const steps = Math.min(count - 1, EOF_PRESENTATION_MAX_STEP_LINES)
  const raw = EOF_PRESENTATION_BASE_HEIGHT_PX + steps * EOF_PRESENTATION_STEP_PX
  return Math.min(
    EOF_PRESENTATION_HARD_MAX_HEIGHT_PX,
    Math.min(EOF_PRESENTATION_MAX_HEIGHT_PX, Math.max(EOF_PRESENTATION_MIN_HEIGHT_PX, raw)),
  )
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

/** §6.1 — clamp the raw semantic height into the compact 24..72 band. */
export function clampEofVisualHeight(rawHeight: number): number {
  if (!Number.isFinite(rawHeight) || rawHeight <= 0) return EOF_VISUAL_MIN_HEIGHT_PX
  return Math.min(EOF_VISUAL_MAX_HEIGHT_PX, Math.max(EOF_VISUAL_MIN_HEIGHT_PX, rawHeight))
}

export interface SyntheticEofGeometryInput {
  /** Viewport rect of the LAST meaningful content block (null when unmeasurable). */
  lastMeaningfulRect: RectLike | null
  /** Viewport rect of the visible semantic CONTENT bounds (never drawer/viewport). */
  contentBoundsRect: RectLike | null
  /** Viewport rect of the editor content column (fallback horizontal authority). */
  editorContentRect: RectLike | null
  /** Resolved editor line height (null → fallback). */
  lineHeight: number | null
  extraTrailingBlankLineCount: number
  gapPx?: number
  /** §5 — the visible editor rect used for the bottom-aligned fallback. */
  viewportClampRect?: RectLike | null
  /**
   * V5.13-R3 §8 — the DOCUMENT-LEVEL text column left (the stable prose column).
   * Never the page/write outer left, the last block, the semantic zone, a selected
   * block or an indented descendant.
   */
  textColumnLeft?: number | null
}

export interface SyntheticEofGeometry {
  /** §2.2 — the PAINTED presentation band (viewport space; may be viewport-clamped). */
  rect: RectLike | null
  /** §2.1 — the semantic excessive-blank zone (never drawer-clipped). */
  semanticZoneRect: RectLike | null
  presentationHeight: number
  geometrySource: string
  /** §2.2 — always DOCUMENT_CONTENT (never DRAWER / UNOBSCURED_VIEWPORT). */
  rightEdgeAuthority: string
  lastMeaningfulRect: RectLike | null
  /** true when the raw semantic height had to be clamped into the band. */
  heightClamped: boolean
  /** true when the band was moved so it fully enters the viewport (§5 fallback). */
  viewportClamped: boolean
}

/**
 * §2/§6 — build the layered document-end geometry.
 *
 * SemanticZone   = from AFTER the legal 1st trailing blank line to EOF, at the
 *                  real DOCUMENT CONTENT width (never drawer.left / unobscured).
 * PresentationBand = a compact fill band at the top of the semantic zone; its
 *                  height is compact-mapped (28~48px), NEVER linear in the
 *                  blank count.
 */
export function computeSyntheticEofGeometry(input: SyntheticEofGeometryInput): SyntheticEofGeometry {
  const count = Math.max(0, Math.floor(input.extraTrailingBlankLineCount))
  const lineHeight = input.lineHeight != null && Number.isFinite(input.lineHeight) && input.lineHeight > 0
    ? input.lineHeight
    : EOF_FALLBACK_LINE_HEIGHT_PX
  const presentationHeight = computeEofPresentationHeight(count)
  const rawSemanticHeight = count * lineHeight
  const heightClamped = rawSemanticHeight > EOF_PRESENTATION_HARD_MAX_HEIGHT_PX

  const last = input.lastMeaningfulRect
  const content = input.contentBoundsRect ?? input.editorContentRect
  if (!content) {
    return {
      rect: null, semanticZoneRect: null, presentationHeight,
      geometrySource: EOF_GEOMETRY_SOURCE_EDITOR_END_BASELINE,
      rightEdgeAuthority: DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
      lastMeaningfulRect: last, heightClamped, viewportClamped: false,
    }
  }
  const gap = input.gapPx ?? EOF_VISUAL_GAP_PX
  const geometrySource = last ? EOF_GEOMETRY_SOURCE_LAST_MEANINGFUL_BLOCK : EOF_GEOMETRY_SOURCE_EDITOR_END_BASELINE
  // §2.1 — the legal 1st trailing blank line is skipped: the semantic zone starts
  // at the 2nd trailing blank line (never at the last content itself).
  const legalAllowance = lineHeight * EOF_ONE_TRAILING_BLANK_ALLOWANCE_LINES
  const semanticTop = last
    ? last.bottom + legalAllowance + gap
    : content.bottom - presentationHeight
  // §8 — the LEFT edge is the document text column; the RIGHT edge stays the
  // document CONTENT edge (V5.13-R2 authority).
  const left = input.textColumnLeft != null && Number.isFinite(input.textColumnLeft)
    ? input.textColumnLeft
    : content.left
  const right = Math.max(left + EOF_MIN_CONTENT_WIDTH_PX, content.right)
  const semanticZoneRect = makeRectLike(left, semanticTop, right, semanticTop + Math.max(rawSemanticHeight, presentationHeight))
  let band = makeRectLike(left, semanticTop, right, semanticTop + presentationHeight)
  // §5 — the band must really enter the viewport; a bottom-aligned clamp is an
  // explicit, audited fallback (never a silent partial PASS).
  let viewportClamped = false
  const clamp = input.viewportClampRect
  if (clamp && clamp.height >= presentationHeight) {
    const maxTop = clamp.bottom - presentationHeight
    const minTop = clamp.top
    const target = Math.min(Math.max(band.top, minTop), maxTop)
    if (Math.abs(target - band.top) > 0.5) {
      viewportClamped = true
      band = makeRectLike(left, target, right, target + presentationHeight)
    }
  }
  return {
    rect: band,
    semanticZoneRect,
    presentationHeight,
    geometrySource,
    rightEdgeAuthority: DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
    lastMeaningfulRect: last,
    heightClamped,
    viewportClamped,
  }
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
  const semantic = clampEofVisualHeight(input.semanticBlankCount * lineHeight)
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

export const DOCUMENT_END_VISUAL_V513R2_GATE_KEYS = [
  'semanticRightFromDrawer',
  'presentationRightFromDrawer',
  'presentationHeightGt48px',
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
  presentationHeightGt48px: 'DOCUMENT_END_PRESENTATION_HEIGHT_GT_48PX_COUNT',
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
