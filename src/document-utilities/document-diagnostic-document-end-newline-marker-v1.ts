/**
 * TRAE — Document-End semantic target + geometry policy (pure contract).
 *
 * ROOT_CAUSE (round 1): `DOCUMENT_TERMINAL_NEWLINE_MISSING` is a `document-end`
 * diagnostic with NO DOM target, so it used to fall through to the "boundary
 * only" branch (GO_BOTTOM + SCROLL_ACTION) → no presentation rect → FAIL_VISUAL.
 *
 * ROOT_CAUSE (round 2 — GEOMETRY AUTHORITY): the marker's Y was taken from
 * `lastCanonicalBlock.bottom + small gap`. A code fence's border box does NOT
 * include its theme margin (`.md-fences { margin-bottom: 15px }`, measured live),
 * and the terminal editing line starts BELOW that margin — so the chip painted
 * ~one line too high.
 *
 * The Y authority is now the REAL Typora terminal editing line:
 *
 *   terminal editable host found AFTER the last canonical block
 *     → geometrySource = TERMINAL_EDITABLE_HOST   (markerTop = host.top)
 *   otherwise
 *     → geometrySource = FALLBACK_LAST_CANONICAL_BLOCK
 *       markerTop = lastCanonicalBlock.bottom + MEASURED collapsed margin
 *
 * NO `lastBlockRect.bottom + fixed px`, NO `+ 20/22/24` magic offset, NO CSS
 * magic number is used anywhere. The last canonical block stays a STRUCTURAL
 * reference only; it is never again the final Y authority.
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
 * `document-end` diagnostic needs, or null when it owns no document-end visual.
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
export const EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY = 'DOCUMENT_CONTENT'
export const EOF_NEWLINE_MARKER_ARIA_LABEL = '文档末尾缺少换行符'

// ── The Y geometry authority (round 2) ─────────────────────────────────────

/** The REAL Typora terminal editing line (a live editable host was resolved). */
export const DOCUMENT_END_GEOMETRY_SOURCE_TERMINAL_HOST = 'TERMINAL_EDITABLE_HOST'
/**
 * No live terminal host exists (Typora renders none for a document whose source
 * ends immediately after a block): the line is derived from the last canonical
 * block plus the MEASURED editor spacing (never a magic constant).
 */
export const DOCUMENT_END_GEOMETRY_SOURCE_FALLBACK = 'FALLBACK_LAST_CANONICAL_BLOCK'
/** Runtime gate: |markerTop − terminalLineTop| must stay within this. */
export const DOCUMENT_END_MARKER_MAX_VERTICAL_DRIFT_PX = 2

/** §8.2 — compact: a chip, never a full-width band. */
export const EOF_NEWLINE_MARKER_MAX_WIDTH_PX = 44
export const EOF_NEWLINE_MARKER_MIN_HEIGHT_PX = 12
export const EOF_NEWLINE_MARKER_MAX_HEIGHT_PX = 20
export const EOF_NEWLINE_MARKER_HEIGHT_RATIO = 0.75
/** Chip-height fallback ONLY (never a position offset) when no line is measurable. */
export const EOF_NEWLINE_MARKER_FALLBACK_LINE_HEIGHT_PX = 18

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
  /** The LAST CANONICAL CONTENT BLOCK — a STRUCTURAL reference only. */
  lastCanonicalBlockRect: RectLikeV1 | null
  /**
   * The REAL Typora terminal editable host that exists AFTER the last canonical
   * block (a trailing/empty editor block). Null when Typora renders none — the
   * fallback then uses measured editor metrics.
   */
  terminalHostRect: RectLikeV1 | null
  terminalHostConnected: boolean
  /**
   * MEASURED collapsed margin between the last canonical block and the terminal
   * editing line (max(block.marginBottom, paragraph.marginTop) computed live).
   * Used ONLY when no terminal host exists.
   */
  terminalLineGapPx: number | null
  /** The MARKDOWN CONTENT column (horizontal authority). */
  contentBoundsRect: RectLikeV1 | null
  /** The real editor line height (never a heading's). */
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
  /** TRAE §geometry — the audits the runtime gate is built from. */
  terminalHostConnected: boolean
  lastCanonicalBlockBottom: number
  terminalLineTop: number
  markerTop: number
  markerVerticalDriftPx: number
  markerAfterLastCanonicalBlock: boolean
  fallbackUsed: boolean
  lastCanonicalBlockRect: RectLikeV1 | null
  /** Meaningful blocks (other than the anchor) the chip intersects — must be 0. */
  meaningfulIntersectionCount: number
  meaningfulIntersectionArea: number
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
 * §8.2/§8.3 — build the compact document-end newline marker ON the terminal
 * editing line.
 *
 * The marker never paints the block body, never changes the block height, never
 * mutates the document, and its TOP is the terminal editing line top (so it can
 * never drift from the real EOF insertion line).
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
    geometrySource: DOCUMENT_END_GEOMETRY_SOURCE_FALLBACK,
    rightEdgeAuthority: EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY,
    terminalHostConnected: input.terminalHostConnected,
    lastCanonicalBlockBottom: input.lastCanonicalBlockRect ? input.lastCanonicalBlockRect.bottom : 0,
    terminalLineTop: 0,
    markerTop: 0,
    markerVerticalDriftPx: 0,
    markerAfterLastCanonicalBlock: false,
    fallbackUsed: true,
    lastCanonicalBlockRect: input.lastCanonicalBlockRect,
    meaningfulIntersectionCount: 0,
    meaningfulIntersectionArea: 0,
    failClosed,
    reason,
  })
  const anchor = input.lastCanonicalBlockRect
  // §5 — a non-empty document that cannot resolve its last canonical content
  // fails CLOSED (never a silent "resolved by scrolling").
  if (!anchor) return empty(input.documentIsNonEmpty, 'NO_LAST_CANONICAL_BLOCK')
  const column = input.contentBoundsRect
  if (!column || !(column.width > 0)) return empty(false, 'NO_CONTENT_COLUMN')

  // ── THE Y AUTHORITY ──────────────────────────────────────────────────────
  // 1. a REAL terminal editable host after the last canonical block wins;
  // 2. otherwise the terminal line is `lastBlock.bottom + MEASURED gap`.
  const host = input.terminalHostRect
  const hostUsable = host != null && Number.isFinite(host.top) && host.top >= anchor.bottom - 1
  const measuredGap = input.terminalLineGapPx != null && Number.isFinite(input.terminalLineGapPx)
    ? Math.max(0, input.terminalLineGapPx)
    : 0
  const terminalLineTop = hostUsable ? host!.top : anchor.bottom + measuredGap
  const geometrySource = hostUsable
    ? DOCUMENT_END_GEOMETRY_SOURCE_TERMINAL_HOST
    : DOCUMENT_END_GEOMETRY_SOURCE_FALLBACK

  const width = Math.min(EOF_NEWLINE_MARKER_MAX_WIDTH_PX, column.width)
  const left = input.textColumnLeft != null && Number.isFinite(input.textColumnLeft)
    ? input.textColumnLeft
    : column.left
  // The chip TOP IS the terminal line top: the drift gate is therefore a REAL
  // check (it can only be non-zero if a future change moves the chip off-line).
  const markerTop = terminalLineTop
  const rect: RectLikeV1 = {
    left,
    top: markerTop,
    right: left + width,
    bottom: markerTop + height,
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
  const drift = Math.abs(markerTop - terminalLineTop)
  return {
    rect,
    presentationHeight: height,
    geometrySource,
    rightEdgeAuthority: EOF_NEWLINE_MARKER_RIGHT_EDGE_AUTHORITY,
    terminalHostConnected: hostUsable ? input.terminalHostConnected : false,
    lastCanonicalBlockBottom: anchor.bottom,
    terminalLineTop,
    markerTop,
    markerVerticalDriftPx: drift,
    markerAfterLastCanonicalBlock: markerTop >= anchor.bottom - 0.5,
    fallbackUsed: !hostUsable,
    lastCanonicalBlockRect: anchor,
    meaningfulIntersectionCount: count,
    meaningfulIntersectionArea: area,
    failClosed: false,
    reason: hostUsable
      ? 'EOF_NEWLINE_MARKER_ON_TERMINAL_EDITABLE_HOST'
      : 'EOF_NEWLINE_MARKER_ON_MEASURED_TERMINAL_LINE',
  }
}

// ── Gates ──────────────────────────────────────────────────────────────────

/** Every one of these must stay 0 for a document-end visual PASS. */
export const DOCUMENT_END_NEWLINE_GATE_KEYS = [
  // ── geometry authority (round 2) ──
  'terminalLineBeforeLastCanonicalBlockBottom',
  'markerTopBeforeTerminalLine',
  'markerVerticalDriftGt2px',
  'terminalHostIsOverlayOrCaption',
  'terminalHostInsideCodeMirror',
  'terminalHostIsLastCanonicalBlock',
  'terminalHostNotEditable',
  'fallbackWithoutMeasuredLineMetric',
  // ── the round-1 closure gates (unchanged) ──
  'semanticIdentityRewrittenToBlock',
  'presentationAnchorNull',
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
  /** A real Typora terminal host must be observed at least once in the session. */
  DOCUMENT_END_TERMINAL_HOST_FOUND_RUNTIME_COUNT: 1,
  /** Informational: how often the measured-metrics fallback was used. */
  DOCUMENT_END_FALLBACK_GEOMETRY_RUNTIME_COUNT: 0,
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
