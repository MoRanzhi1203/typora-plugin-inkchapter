/**
 * TRAE — Document-End semantic target + geometry policy (pure contract).
 *
 * ROOT_CAUSE: `DOCUMENT_TERMINAL_NEWLINE_MISSING` is a `document-end` diagnostic
 * with NO DOM target. Only `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` was wired
 * into the synthetic document-end visual path, so the missing-newline warning
 * fell through to the "boundary only" branch (GO_BOTTOM + SCROLL_ACTION) with
 * `highlightTargets = []` → no presentation rect → `FAIL_VISUAL` → the active
 * owner was rolled back. Detection and the click state machine were both fine.
 *
 * Three concepts stay separated (never conflated):
 *
 *   SemanticIdentity  = document:end          (never a block:N identity)
 *   ScrollDestination = GO_BOTTOM             (a step, NOT the locate result)
 *   PresentationAnchor= last canonical content block (a GEOMETRY HOST only)
 *
 * The last canonical block is resolved by the EXISTING canonical content
 * enumeration (top-level content children, plugin accessory nodes and empty
 * blocks skipped). It is NEVER `editor.lastElementChild`, never a
 * `querySelector('pre:last…')` guess — a CodeMirror-internal `pre` is a nested
 * child and can therefore never become the anchor.
 *
 * Pure: no DOM, no queries.
 */

// ── Identity ───────────────────────────────────────────────────────────────

/** The missing-terminal-newline `document-end` warning. */
export const DOCUMENT_END_NEWLINE_MISSING_RULE = 'DOCUMENT_TERMINAL_NEWLINE_MISSING'
/** The excessive-trailing-blank `document-end` warning (frozen behaviour). */
export const DOCUMENT_END_TRAILING_BLANK_RULE_NAME = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'

/** The two `document-end` visual rules that share ONE lifecycle. */
export type DocumentEndVisualRule = 'TRAILING_BLANK_EXCESS' | 'TERMINAL_NEWLINE_MISSING'

/** The rule's own excess threshold (0~1 extra blank lines are legal). */
export const DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS = 2

/**
 * The ONE `DocumentEndTargetResolver` entry. Returns the visual rule a
 * `document-end` diagnostic needs, or null when it owns no document-end visual
 * (an unrelated document-end rule keeps its legacy behaviour).
 */
export function resolveDocumentEndVisualRule(input: {
  code: string
  locationKind: string | null
  extraTrailingBlankLineCount: number | null
}): DocumentEndVisualRule | null {
  if (input.locationKind !== 'document-end') return null
  if (input.code === DOCUMENT_END_TRAILING_BLANK_RULE_NAME) {
    return (input.extraTrailingBlankLineCount ?? 0) >= DOCUMENT_END_TRAILING_BLANK_MIN_EXCESS
      ? 'TRAILING_BLANK_EXCESS'
      : null
  }
  if (input.code === DOCUMENT_END_NEWLINE_MISSING_RULE) return 'TERMINAL_NEWLINE_MISSING'
  return null
}

// ── The compact EOF newline marker (§8.2/§8.3) ─────────────────────────────

/** The marker kind stamped on the carrier (`data-ink-marker-kind`). */
export const EOF_NEWLINE_MARKER_KIND = 'document-end-newline-missing'
/** Machine-readable rule identity on the same carrier. */
export const EOF_NEWLINE_MARKER_RULE_ATTR = 'document-end-newline-missing'
export const EOF_NEWLINE_MARKER_GEOMETRY_SOURCE = 'LAST_CANONICAL_BLOCK_EOF_EDGE'
export const EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY = 'DOCUMENT_CONTENT'
export const EOF_NEWLINE_MARKER_ARIA_LABEL = '文档末尾缺少换行符'

/** §8.2 — compact: a chip, never a full-width band. */
export const EOF_NEWLINE_MARKER_MAX_WIDTH_PX = 44
export const EOF_NEWLINE_MARKER_MIN_HEIGHT_PX = 12
export const EOF_NEWLINE_MARKER_MAX_HEIGHT_PX = 20
export const EOF_NEWLINE_MARKER_HEIGHT_RATIO = 0.75
export const EOF_NEWLINE_MARKER_FALLBACK_LINE_HEIGHT_PX = 18
/** §8.3 — the marker sits on the EOF side of the last canonical block. */
export const EOF_NEWLINE_MARKER_GAP_PX = 2
/** §8.3 — the marker never leaves the visible editor content area. */
export const EOF_NEWLINE_MARKER_EDGE_MARGIN_PX = 2

export interface RectLikeV1 {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface DocumentEndNewlineMarkerInput {
  /** V5.13-R5 §5 — a NON-empty document MUST resolve its last canonical content. */
  documentIsNonEmpty: boolean
  /** The LAST CANONICAL CONTENT BLOCK rect (the presentation anchor / geometry host). */
  lastCanonicalBlockRect: RectLikeV1 | null
  /** The MARKDOWN CONTENT column (horizontal authority). */
  contentBoundsRect: RectLikeV1 | null
  /** The visible editor content rect (vertical clamp). */
  editorContentRect: RectLikeV1 | null
  /** The real line height for the compact marker (never a heading's). */
  lineHeight: number | null
  /** The document-level text column left (stable prose column). */
  textColumnLeft?: number | null
  /** Every other meaningful (non-empty) top-level block rect. */
  otherMeaningfulRects?: RectLikeV1[]
}

export interface DocumentEndNewlineMarkerGeometry {
  /** The PAINTED presentation chip (null = fail closed, never a silent scroll). */
  rect: RectLikeV1 | null
  presentationHeight: number
  geometrySource: string
  rightEdgeAuthority: string
  /** §8.3 — true when the chip had to be bounded inside the visible editor. */
  clampedInsideEditor: boolean
  /** Meaningful blocks (other than the anchor) the chip intersects — must be 0. */
  meaningfulIntersectionCount: number
  meaningfulIntersectionArea: number
  lastCanonicalBlockRect: RectLikeV1 | null
  /** A non-empty document with no resolvable anchor FAILS CLOSED. */
  failClosed: boolean
  reason: string
}

function rectsIntersectV1(a: RectLikeV1, b: RectLikeV1): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

function intersectionAreaV1(a: RectLikeV1, b: RectLikeV1): number {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return w * h
}

function clampV1(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/**
 * §8.2/§8.3 — build the compact document-end newline marker.
 *
 * The marker is a SMALL soft-fill chip on the EOF side of the last canonical
 * block: it never paints the block body, never changes the block height, never
 * mutates the document, and never leaves the visible editor content area.
 */
export function computeDocumentEndNewlineMarkerGeometry(
  input: DocumentEndNewlineMarkerInput,
): DocumentEndNewlineMarkerGeometry {
  const lh = input.lineHeight != null && Number.isFinite(input.lineHeight) && input.lineHeight > 0
    ? input.lineHeight
    : EOF_NEWLINE_MARKER_FALLBACK_LINE_HEIGHT_PX
  const height = clampV1(
    Math.round(lh * EOF_NEWLINE_MARKER_HEIGHT_RATIO),
    EOF_NEWLINE_MARKER_MIN_HEIGHT_PX,
    EOF_NEWLINE_MARKER_MAX_HEIGHT_PX,
  )
  const empty = (failClosed: boolean, reason: string): DocumentEndNewlineMarkerGeometry => ({
    rect: null,
    presentationHeight: 0,
    geometrySource: EOF_NEWLINE_MARKER_GEOMETRY_SOURCE,
    rightEdgeAuthority: EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY,
    clampedInsideEditor: false,
    meaningfulIntersectionCount: 0,
    meaningfulIntersectionArea: 0,
    lastCanonicalBlockRect: input.lastCanonicalBlockRect,
    failClosed,
    reason,
  })
  const anchor = input.lastCanonicalBlockRect
  // §5 — a non-empty document that cannot resolve its last canonical content
  // fails CLOSED (never a silent "resolved by scrolling").
  if (!anchor) return empty(input.documentIsNonEmpty, 'NO_LAST_CANONICAL_BLOCK')
  const column = input.contentBoundsRect ?? input.editorContentRect
  if (!column || !(column.width > 0)) return empty(false, 'NO_CONTENT_COLUMN')
  const width = Math.min(EOF_NEWLINE_MARKER_MAX_WIDTH_PX, column.width)
  const left = input.textColumnLeft != null && Number.isFinite(input.textColumnLeft)
    ? input.textColumnLeft
    : column.left
  // §8.3 — prefer the EOF side (immediately after the block), then bound it
  // inside the visible editor so the marker can never be painted offscreen.
  const desiredTop = anchor.bottom + EOF_NEWLINE_MARKER_GAP_PX
  let top = desiredTop
  let clamped = false
  if (input.editorContentRect) {
    const maxTop = input.editorContentRect.bottom - height - EOF_NEWLINE_MARKER_EDGE_MARGIN_PX
    if (top > maxTop) {
      // Fall back to the block's own bottom EDGE (never the block body centre):
      // the chip reads as "at/after the last line", not as a block error.
      top = Math.max(anchor.bottom - height, maxTop)
      clamped = true
    }
  }
  const rect: RectLikeV1 = {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
  let count = 0
  let area = 0
  for (const other of input.otherMeaningfulRects ?? []) {
    if (!rectsIntersectV1(rect, other)) continue
    count++
    area += intersectionAreaV1(rect, other)
  }
  return {
    rect,
    presentationHeight: height,
    geometrySource: EOF_NEWLINE_MARKER_GEOMETRY_SOURCE,
    rightEdgeAuthority: EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY,
    clampedInsideEditor: clamped,
    meaningfulIntersectionCount: count,
    meaningfulIntersectionArea: area,
    lastCanonicalBlockRect: anchor,
    failClosed: false,
    reason: 'EOF_NEWLINE_MARKER_PRESENTATION_TARGET',
  }
}

// ── Gates ──────────────────────────────────────────────────────────────────

/** Every one of these must stay 0 for a document-end visual PASS. */
export const DOCUMENT_END_NEWLINE_GATE_KEYS = [
  'semanticIdentityRewrittenToBlock',
  'presentationAnchorNull',
  'presentationAnchorDisconnected',
  'presentationRectNull',
  'presentationRectWidthZero',
  'presentationRectHeightZero',
  'markerLeftCodeMirrorInternalTarget',
  'markerCoveredByCodeMirrorInternal',
  'markerIntersectsMeaningfulContent',
  'scrollOnlyPassedAsLocate',
  'firstClickLocateRollback',
  'firstClickVisualNotVisible',
  'secondClickRequired',
  'staleVisualAfterDiagnosticRemoved',
  'severityDriftWarningToInfo',
  'unscopedVisualFalsePass',
  'diagnosticTargetKeyMismatch',
] as const

export type DocumentEndNewlineGateKey = typeof DOCUMENT_END_NEWLINE_GATE_KEYS[number]

export function createDocumentEndNewlineGateCounters(): Record<DocumentEndNewlineGateKey, number> {
  const out = {} as Record<DocumentEndNewlineGateKey, number>
  for (const key of DOCUMENT_END_NEWLINE_GATE_KEYS) out[key] = 0
  return out
}

export function evaluateDocumentEndNewlineGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = DOCUMENT_END_NEWLINE_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failCount: failing.length, failing }
}

/** Runtime positive-coverage requirements (evidence, never a fabricated PASS). */
export const DOCUMENT_END_NEWLINE_POSITIVE_COVERAGE_REQUIREMENTS: Readonly<Record<string, number>> = {
  DOCUMENT_END_DIAGNOSTIC_RUNTIME_COUNT: 1,
  DOCUMENT_END_SCROLL_TO_BOTTOM_RUNTIME_COUNT: 1,
  DOCUMENT_END_PRESENTATION_ANCHOR_RUNTIME_COUNT: 1,
  DOCUMENT_END_ACTIVE_VISUAL_RUNTIME_COUNT: 1,
  DOCUMENT_END_ONE_CLICK_COMMIT_RUNTIME_COUNT: 1,
  DOCUMENT_END_DIAGNOSTIC_REMOVED_RUNTIME_COUNT: 1,
  DOCUMENT_END_DIAGNOSTIC_REINTRODUCED_RUNTIME_COUNT: 1,
}

export function emptyDocumentEndNewlineCoverageCounters(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(DOCUMENT_END_NEWLINE_POSITIVE_COVERAGE_REQUIREMENTS)) out[key] = 0
  return out
}

export function evaluateDocumentEndNewlinePositiveCoverage(
  counters: Readonly<Record<string, number>>,
): { satisfied: boolean; unmet: string[] } {
  const unmet = Object.entries(DOCUMENT_END_NEWLINE_POSITIVE_COVERAGE_REQUIREMENTS)
    .filter(([key, min]) => (counters[key] ?? 0) < min)
    .map(([key]) => key)
  return { satisfied: unmet.length === 0, unmet }
}
