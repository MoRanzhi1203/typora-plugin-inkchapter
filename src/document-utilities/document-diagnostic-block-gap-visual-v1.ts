/**
 * Document Diagnostics Presentation Stability Closure V1 §2/§5/§6/§7/§8/§9/§10 —
 * the ONE `BLOCK_GAP_VISUAL_TARGET` authority for `EXCESSIVE_INTERNAL_BLANK_LINES`.
 *
 * The rule's SEMANTIC target is the `DocumentBlockGap`: two sibling content
 * blocks PLUS the blank run between them (`document-diagnostic-internal-blank-lines-v1`).
 * This module owns ONLY how that gap is PAINTED:
 *
 *   Detection Authority   = canonical Markdown source  (frozen, source-only)
 *   Scroll Anchor         = the NEXT block              (existing, unchanged)
 *   Visual Target         = BLOCK_GAP_VISUAL_TARGET     (this module)
 *
 * `Detection Authority !== Visual Geometry Authority` by construction: this
 * module NEVER decides "should it be reported" and NEVER reads a blank-line
 * count from DOM margins / pixel height / CSS spacing. It only answers
 * "where to paint".
 *
 * Pure — no DOM, no host state, no timers.
 */

/** §6 — the presentation target kind (NOT a new Markdown semantic target). */
export const BLOCK_GAP_VISUAL_TARGET = 'block-gap' as const

/** §10 — the overlay carrier class (rail + faint Warning gap background). */
export const BLOCK_GAP_VISUAL_CLASS = 'inkchapter-block-gap-visual'

/** §12 — the runtime audit event. */
export const BLOCK_GAP_VISUAL_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-VISUAL-AUDIT'

/** §31 — the Source→DOM binding audit event (previous + next, symmetric). */
export const BLOCK_GAP_BINDING_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-BINDING-AUDIT'

/** V2 §A — the canonical next-block binding audit event. */
export const BLOCK_GAP_CANONICAL_BINDING_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-CANONICAL-BINDING-AUDIT'

/** V3 §4 — the absolute occupancy safety audit event. */
export const BLOCK_GAP_OCCUPANCY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-OCCUPANCY-AUDIT'

/** V2 §B — the OneClick ↔ VisualClosure consistency audit event. */
export const BLOCK_GAP_VISUAL_CONSISTENCY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-VISUAL-CONSISTENCY-AUDIT'

/** V7 §3 — the IMAGE-ONLY boundary inventory audit event (degraded-binding forensic). */
export const BLOCK_GAP_IMAGE_ONLY_INVENTORY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-IMAGE-ONLY-INVENTORY-AUDIT'

/** §12 — the gap identity audit event (identity stability across 15→9→4→3). */
export const BLOCK_GAP_IDENTITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-IDENTITY-AUDIT'

/** TRAE §21 — the ONE canonical block-gap target audit event. */
export const BLOCK_GAP_TARGET_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-BLOCK-GAP-TARGET-AUDIT'

/** TRAE §9 — why a two-boundary gap could not be built (never a block fallback). */
export type BlockGapFailClosedReason =
  | 'PREVIOUS_BOUNDARY_MISSING'
  | 'NEXT_BOUNDARY_MISSING'
  | 'BOTH_BOUNDARIES_MISSING'

/** TRAE §9 — the exact fail-closed reason for a gap whose sides did not both bind. */
export const blockGapFailClosedReason = (
  previousBound: boolean,
  nextBound: boolean,
): BlockGapFailClosedReason | null => {
  if (previousBound && nextBound) return null
  if (!previousBound && !nextBound) return 'BOTH_BOUNDARIES_MISSING'
  return previousBound ? 'NEXT_BOUNDARY_MISSING' : 'PREVIOUS_BOUNDARY_MISSING'
}

// ── TRAE §22/§23/§24 — RENDERED blank-row FRAGMENT geometry ────────────────

/** §22 — the fragment FILL class (ONE per real rendered blank row). */
export const RENDERED_BLANK_ROW_FRAGMENT_CLASS = 'inkchapter-block-gap-fragment'

/** §22 — the fragment CONTAINER class (the ONE semantic active visual). */
export const RENDERED_BLANK_ROW_FRAGMENT_CONTAINER_CLASS = 'inkchapter-block-gap-fragments'

/**
 * 原设计要求 A — the per-row ROLE on a continuous blank-run fragment:
 *   `allowed` = the LEGAL allowance (passMaxBlankLines) — a faint neutral zone;
 *   `excess`  = the rows the Warning actually owns — the warning colour + rail.
 * The marker must show BOTH so a compliant allowance is never painted as a fault.
 */
export type RenderedBlankRowRole = 'allowed' | 'excess'

/** The role attribute carried by every rendered blank-row fragment. */
export const RENDERED_BLANK_ROW_ROLE_ATTR = 'data-ink-blank-role'

/**
 * 原设计要求 A — the non-intrusive COUNT chip painted on the group marker: the
 * true visible blank-row total plus how many are EXCESS. Never a Markdown edit.
 */
export const BLANK_RUN_COUNT_CHIP_CLASS = 'inkchapter-blank-run-count'

/** §24 — the minimum paintable fragment height; a row below it is skipped. */
export const RENDERED_BLANK_ROW_FRAGMENT_MIN_HEIGHT_PX = 2

/** §23 — one FILL_ONLY row fragment (document-local, relative to the container). */
export interface RenderedBlankRowFragment {
  left: number
  top: number
  width: number
  height: number
}

/** §23 — the container rect covering the rendered blank-row union. */
export interface RenderedBlankRowFragmentBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * §22/§23/§24 — turn the REAL rendered blank-row rects into N FILL_ONLY
 * fragments (NEVER one single `[prev.bottom, next.top]` band). The container
 * covers the row union; each fragment is aligned to ITS real row rect and uses
 * the document text column width (falling back to the row's own width). Rows
 * whose height is below the minimum are skipped — a fragment is never faked.
 */
export function computeRenderedBlankRowFragments(input: {
  rowRects: ReadonlyArray<BlockGapRectLike | null>
  contentColumns: { left: number; right: number } | null
}): { container: RenderedBlankRowFragmentBox | null; fragments: RenderedBlankRowFragment[] } {
  const rows = input.rowRects.filter((r): r is BlockGapRectLike => isUsableRect(r))
  if (rows.length === 0) return { container: null, fragments: [] }
  const top = Math.min(...rows.map(r => r.top))
  const bottom = Math.max(...rows.map(r => r.bottom))
  const rowLeft = Math.min(...rows.map(r => r.left))
  const rowRight = Math.max(...rows.map(r => r.right))
  const cols = input.contentColumns
  const left = cols && Number.isFinite(cols.left) ? cols.left : rowLeft
  const right = cols && Number.isFinite(cols.right) && cols.right > cols.left ? cols.right : rowRight
  if (!(right > left) || !(bottom > top)) return { container: null, fragments: [] }

  const fragments: RenderedBlankRowFragment[] = []
  for (const r of rows) {
    const height = r.bottom - r.top
    if (!(height >= RENDERED_BLANK_ROW_FRAGMENT_MIN_HEIGHT_PX)) continue
    fragments.push({
      left: left - left,
      top: r.top - top,
      width: right - left,
      height,
    })
  }
  return {
    container: { left, top, width: right - left, height: bottom - top },
    fragments,
  }
}

/** TRAE §11 — the horizontal authority of a painted gap band. */
export type BlockGapHorizontalAuthority = 'DOCUMENT_TEXT_COLUMN' | 'BOUNDARY_UNION'

/**
 * TRAE §11 — the gap band's horizontal extent: the DOCUMENT text/content column
 * when available, never the window / drawer / editor shell width.
 */
export function resolveBlockGapHorizontalExtent(input: {
  textColumnLeft: number | null
  contentLeft: number | null
  contentRight: number | null
  previousLeft: number | null
  previousRight: number | null
  nextLeft: number | null
  nextRight: number | null
}): { left: number; right: number; authority: BlockGapHorizontalAuthority } | null {
  const lefts = [input.previousLeft, input.nextLeft].filter((v): v is number => v != null && Number.isFinite(v))
  const rights = [input.previousRight, input.nextRight].filter((v): v is number => v != null && Number.isFinite(v))
  const unionLeft = lefts.length > 0 ? Math.min(...lefts) : null
  const unionRight = rights.length > 0 ? Math.max(...rights) : null
  const columnLeft = input.textColumnLeft ?? input.contentLeft
  const columnRight = input.contentRight
  if (columnLeft != null && columnRight != null && columnRight > columnLeft) {
    return { left: columnLeft, right: columnRight, authority: 'DOCUMENT_TEXT_COLUMN' }
  }
  if (unionLeft != null && unionRight != null && unionRight > unionLeft) {
    return { left: unionLeft, right: unionRight, authority: 'BOUNDARY_UNION' }
  }
  return null
}

/**
 * §7/§8 — the minimum paintable gap height. Below this the two block boxes are
 * effectively touching (no visual band to paint), so the gap visual is refused
 * rather than collapsed onto a block.
 */
export const BLOCK_GAP_MIN_VISIBLE_HEIGHT_PX = 2

/** §8 — a 1px guard band so the painted gap never touches a block's text box. */
export const BLOCK_GAP_CONTENT_GUARD_PX = 1

export interface BlockGapRectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * §7/§8 — the painted gap band. All values are in ONE coordinate space
 * (document-local); the caller converts viewport rects before calling.
 */
export interface BlockGapVisualGeometry {
  gapTop: number
  gapBottom: number
  gapHeight: number
  gapLeft: number
  gapRight: number
  gapWidth: number
  /**
   * §8 — proof the painted band does NOT intersect either content block box
   * (the two "must never paint the adjacent content" hard gates).
   */
  overlapsPreviousBlock: boolean
  overlapsNextBlock: boolean
  /** §7 — the band is strictly between the two block boxes (no inversion). */
  strictlyBetweenBlocks: boolean
  /** §9 — the guard insets actually applied (0 when neither block is known). */
  guardAppliedPx: number
}

export interface BlockGapVisualInput {
  /** The previous content block's live box (document-local). */
  previousBlockRect: BlockGapRectLike | null
  /** The next content block's live box (document-local). */
  nextBlockRect: BlockGapRectLike | null
  /**
   * §7 — the editor content column (left/right). When null the band falls back
   * to the union of the two block boxes (never to the whole viewport).
   */
  contentColumns?: { left: number; right: number } | null
}

function isUsableRect(r: BlockGapRectLike | null): r is BlockGapRectLike {
  if (!r) return false
  return Number.isFinite(r.left) && Number.isFinite(r.top)
    && Number.isFinite(r.right) && Number.isFinite(r.bottom)
    && r.right >= r.left && r.bottom >= r.top
}

function overlaps(aTop: number, aBottom: number, rect: BlockGapRectLike): boolean {
  // A zero-height band can never overlap; a positive band overlaps iff its
  // interval intersects the block's half-open vertical interval.
  if (aBottom <= aTop) return false
  return aTop < rect.bottom && aBottom > rect.top
}

/**
 * §7 — compute the paintable gap band from the two live block boxes.
 *
 * The band is `[previousBlockRect.bottom, nextBlockRect.top]` — the blank
 * region itself — never either block. Both blocks are required: without a
 * measurable previous OR next block there is no proven gap, so the caller must
 * fall back to the existing scroll-anchor visual rather than paint a guess.
 *
 * §9 — nothing here mutates layout: it is a pure rect computation.
 */
export function computeBlockGapVisualGeometry(input: BlockGapVisualInput): BlockGapVisualGeometry | null {
  const prev = isUsableRect(input.previousBlockRect) ? input.previousBlockRect : null
  const next = isUsableRect(input.nextBlockRect) ? input.nextBlockRect : null
  // §8 — both adjacent blocks are the definition of the gap. A missing side is
  // NOT a gap (never paint one block as if it were the gap).
  if (!prev || !next) return null

  const guard = BLOCK_GAP_CONTENT_GUARD_PX
  let gapTop = prev.bottom + guard
  let gapBottom = next.top - guard
  let strictlyBetweenBlocks = true
  if (gapBottom <= gapTop) {
    // The guard collapsed the band (blocks are visually adjacent). Fall back to
    // the raw boundary; if even that is empty there is nothing to paint.
    gapTop = prev.bottom
    gapBottom = next.top
    strictlyBetweenBlocks = gapBottom > gapTop
  }
  const gapHeight = gapBottom - gapTop
  if (!(gapHeight >= BLOCK_GAP_MIN_VISIBLE_HEIGHT_PX)) return null
  if (next.top < prev.bottom) {
    // Inverted / overlapping boxes: the live layout does not describe a gap.
    return null
  }

  const cols = input.contentColumns
  const gapLeft = cols && Number.isFinite(cols.left) ? cols.left : Math.min(prev.left, next.left)
  const gapRight = cols && Number.isFinite(cols.right) ? cols.right : Math.max(prev.right, next.right)
  if (!(gapRight > gapLeft)) return null

  return {
    gapTop,
    gapBottom,
    gapHeight,
    gapLeft,
    gapRight,
    gapWidth: gapRight - gapLeft,
    overlapsPreviousBlock: overlaps(gapTop, gapBottom, prev),
    overlapsNextBlock: overlaps(gapTop, gapBottom, next),
    strictlyBetweenBlocks,
    guardAppliedPx: guard,
  }
}

/**
 * §8 — the ONE gate predicate: a committed gap geometry is valid iff it is
 * strictly between the blocks AND touches neither block's vertical interval.
 */
export function isBlockGapGeometryValid(g: BlockGapVisualGeometry | null): boolean {
  if (!g) return false
  return g.strictlyBetweenBlocks
    && !g.overlapsPreviousBlock
    && !g.overlapsNextBlock
    && g.gapHeight >= BLOCK_GAP_MIN_VISIBLE_HEIGHT_PX
    && g.gapWidth > 0
}

/**
 * §12 — the gap's DOM-independent identity for the runtime audit. Built from
 * the two block identities only (never a blank-line count / line number /
 * pixel geometry), so 15→9→4→3 keeps ONE identity.
 */
export function blockGapVisualIdentity(previousBlockIdentity: string, nextBlockIdentity: string): string {
  return `block-gap-visual:${previousBlockIdentity}>>${nextBlockIdentity}`
}

// ── §12/§33 — the hard gates ────────────────────────────────────────────────

export interface BlockGapVisualV1Counters {
  domGeometryUsedForDetection: number
  visualBoundToPreviousBlock: number
  visualBoundToNextBlock: number
  visualCoversContentText: number
  visualAltersDocumentLayout: number
  staleGapVisual: number
  firstClickNotActivated: number
  duplicateVisual: number
  gapVisualMissing: number
  /** §35 — previous / next Source→DOM binding failed (both must be BOUND). */
  previousBindingMissing: number
  nextBindingMissing: number
  /** §10/§11 — an AMBIGUOUS text fallback was accepted (must never happen). */
  ambiguousTextFallbackAccepted: number
  /** V2 §A — the ordinal fallback won while a canonical binding was available. */
  ordinalFallbackUsedWhileCanonicalAvailable: number
  /** V2 §A — the bound next DOM identity differs from the canonical identity. */
  nextCanonicalIdentityMismatch: number
  /** V2 §A — a semantic match was accepted while physical binding was invalid. */
  falseBound: number
}

export function createBlockGapVisualV1Counters(): BlockGapVisualV1Counters {
  return {
    domGeometryUsedForDetection: 0,
    visualBoundToPreviousBlock: 0,
    visualBoundToNextBlock: 0,
    visualCoversContentText: 0,
    visualAltersDocumentLayout: 0,
    staleGapVisual: 0,
    firstClickNotActivated: 0,
    duplicateVisual: 0,
    gapVisualMissing: 0,
    previousBindingMissing: 0,
    nextBindingMissing: 0,
    ambiguousTextFallbackAccepted: 0,
    ordinalFallbackUsedWhileCanonicalAvailable: 0,
    nextCanonicalIdentityMismatch: 0,
    falseBound: 0,
  }
}

export const BLOCK_GAP_VISUAL_V1_GATE_LABELS: Record<keyof BlockGapVisualV1Counters, string> = {
  domGeometryUsedForDetection: 'INTERNAL_BLANK_LINE_DOM_GEOMETRY_USED_FOR_DETECTION_COUNT',
  visualBoundToPreviousBlock: 'INTERNAL_BLANK_LINE_VISUAL_BOUND_TO_PREVIOUS_BLOCK_COUNT',
  visualBoundToNextBlock: 'INTERNAL_BLANK_LINE_VISUAL_BOUND_TO_NEXT_BLOCK_COUNT',
  visualCoversContentText: 'INTERNAL_BLANK_LINE_VISUAL_COVERS_CONTENT_TEXT_COUNT',
  visualAltersDocumentLayout: 'INTERNAL_BLANK_LINE_VISUAL_ALTERS_DOCUMENT_LAYOUT_COUNT',
  staleGapVisual: 'INTERNAL_BLANK_LINE_STALE_GAP_VISUAL_COUNT',
  firstClickNotActivated: 'INTERNAL_BLANK_LINE_FIRST_CLICK_NOT_ACTIVATED_COUNT',
  duplicateVisual: 'INTERNAL_BLANK_LINE_DUPLICATE_VISUAL_COUNT',
  gapVisualMissing: 'INTERNAL_BLANK_LINE_GAP_VISUAL_MISSING_COUNT',
  previousBindingMissing: 'BLOCK_GAP_PREVIOUS_SOURCE_BLOCK_BINDING_MISSING_COUNT',
  nextBindingMissing: 'BLOCK_GAP_NEXT_SOURCE_BLOCK_BINDING_MISSING_COUNT',
  ambiguousTextFallbackAccepted: 'BLOCK_GAP_AMBIGUOUS_TEXT_FALLBACK_ACCEPTED_COUNT',
  ordinalFallbackUsedWhileCanonicalAvailable: 'BLOCK_GAP_ORDINAL_FALLBACK_USED_WHILE_CANONICAL_BINDING_AVAILABLE_COUNT',
  nextCanonicalIdentityMismatch: 'BLOCK_GAP_NEXT_BLOCK_CANONICAL_IDENTITY_MISMATCH_COUNT',
  falseBound: 'BLOCK_GAP_FALSE_BOUND_COUNT',
}

export const BLOCK_GAP_VISUAL_V1_GATE_KEYS = Object.keys(
  BLOCK_GAP_VISUAL_V1_GATE_LABELS,
) as (keyof BlockGapVisualV1Counters)[]

export function formatBlockGapVisualV1GateReport(counters: BlockGapVisualV1Counters): string[] {
  return BLOCK_GAP_VISUAL_V1_GATE_KEYS.map(k => `${BLOCK_GAP_VISUAL_V1_GATE_LABELS[k]}=${counters[k]}`)
}

export function evaluateBlockGapVisualV1Gates(
  counters: BlockGapVisualV1Counters,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failingKeys = BLOCK_GAP_VISUAL_V1_GATE_KEYS.filter(k => counters[k] !== 0)
  return {
    decision: failingKeys.length === 0 ? 'PASS' : 'FAIL',
    failing: failingKeys.map(k => BLOCK_GAP_VISUAL_V1_GATE_LABELS[k]),
  }
}

// ── §32 — positive coverage ─────────────────────────────────────────────────

export type BlockGapVisualV1CoverageKey =
  | 'gapVisualRuntime'
  | 'gapActiveRuntime'
  | 'gapShrinkRuntime'
  | 'gapDisappearRuntime'
  | 'gapReappearRuntime'

export type BlockGapVisualV1Coverage = Record<BlockGapVisualV1CoverageKey, number>

export function createBlockGapVisualV1Coverage(): BlockGapVisualV1Coverage {
  return {
    gapVisualRuntime: 0,
    gapActiveRuntime: 0,
    gapShrinkRuntime: 0,
    gapDisappearRuntime: 0,
    gapReappearRuntime: 0,
  }
}

export const BLOCK_GAP_VISUAL_V1_COVERAGE_LABELS: Record<BlockGapVisualV1CoverageKey, string> = {
  gapVisualRuntime: 'INTERNAL_BLANK_LINE_GAP_VISUAL_RUNTIME_COUNT',
  gapActiveRuntime: 'INTERNAL_BLANK_LINE_GAP_ACTIVE_RUNTIME_COUNT',
  gapShrinkRuntime: 'INTERNAL_BLANK_LINE_GAP_SHRINK_RUNTIME_COUNT',
  gapDisappearRuntime: 'INTERNAL_BLANK_LINE_GAP_DISAPPEAR_RUNTIME_COUNT',
  gapReappearRuntime: 'INTERNAL_BLANK_LINE_GAP_REAPPEAR_RUNTIME_COUNT',
}

export function formatBlockGapVisualV1CoverageReport(coverage: BlockGapVisualV1Coverage): string[] {
  return (Object.keys(BLOCK_GAP_VISUAL_V1_COVERAGE_LABELS) as BlockGapVisualV1CoverageKey[])
    .map(k => `${BLOCK_GAP_VISUAL_V1_COVERAGE_LABELS[k]}=${coverage[k]}`)
}

// ── TRAE §22 — the canonical locator closure gate family ────────────────────

/**
 * Every one of these MUST stay 0 for the internal blank-gap closure to pass.
 * They are the detectors for the defects this round removes: fence-text code
 * binding, one-sided gaps, zero-rect paint, EOF/placement leakage, wrong-block
 * fallback and unscoped visual closure.
 */
export const BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS = [
  'anchorTextCodeFenceBindCount',
  'previousBoundaryMissingCount',
  'nextBoundaryMissingCount',
  'gapRectWidthZeroCount',
  'gapRectHeightZeroCount',
  'zeroPaintedRectCount',
  'secondClickRequiredCount',
  'documentEndPlacementCount',
  'wrongPreviousBlockHighlightCount',
  'wrongNextBlockHighlightCount',
  'unscopedVisualFalsePassCount',
  'staleVisualCount',
  'drawerScrollDriftGt1pxCount',
  'drawerViewportAnchorChangedCount',
] as const

export type BlockGapCanonicalClosureGateKey = typeof BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS[number]

export const BLOCK_GAP_CANONICAL_CLOSURE_GATE_LABELS: Record<BlockGapCanonicalClosureGateKey, string> = {
  anchorTextCodeFenceBindCount: 'INTERNAL_BLANK_LINE_ANCHOR_TEXT_CODE_FENCE_BIND_COUNT',
  previousBoundaryMissingCount: 'INTERNAL_BLANK_LINE_PREVIOUS_BOUNDARY_MISSING_COUNT',
  nextBoundaryMissingCount: 'INTERNAL_BLANK_LINE_NEXT_BOUNDARY_MISSING_COUNT',
  gapRectWidthZeroCount: 'INTERNAL_BLANK_LINE_GAP_RECT_WIDTH_ZERO_COUNT',
  gapRectHeightZeroCount: 'INTERNAL_BLANK_LINE_GAP_RECT_HEIGHT_ZERO_COUNT',
  zeroPaintedRectCount: 'INTERNAL_BLANK_LINE_ZERO_PAINTED_RECT_COUNT',
  secondClickRequiredCount: 'INTERNAL_BLANK_LINE_SECOND_CLICK_REQUIRED_COUNT',
  documentEndPlacementCount: 'INTERNAL_BLANK_LINE_DOCUMENT_END_PLACEMENT_COUNT',
  wrongPreviousBlockHighlightCount: 'INTERNAL_BLANK_LINE_WRONG_PREVIOUS_BLOCK_HIGHLIGHT_COUNT',
  wrongNextBlockHighlightCount: 'INTERNAL_BLANK_LINE_WRONG_NEXT_BLOCK_HIGHLIGHT_COUNT',
  unscopedVisualFalsePassCount: 'INTERNAL_BLANK_LINE_UNSCOPED_VISUAL_FALSE_PASS_COUNT',
  staleVisualCount: 'INTERNAL_BLANK_LINE_STALE_VISUAL_COUNT',
  drawerScrollDriftGt1pxCount: 'INTERNAL_BLANK_LINE_CLICK_DRAWER_SCROLL_DRIFT_GT_1PX_COUNT',
  drawerViewportAnchorChangedCount: 'INTERNAL_BLANK_LINE_CLICK_DRAWER_VIEWPORT_ANCHOR_CHANGED_COUNT',
}

export function createBlockGapCanonicalClosureGates(): Record<BlockGapCanonicalClosureGateKey, number> {
  const out = {} as Record<BlockGapCanonicalClosureGateKey, number>
  for (const k of BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS) out[k] = 0
  return out
}

export function evaluateBlockGapCanonicalClosureGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failCount: failing.length,
    failing: failing.map(k => BLOCK_GAP_CANONICAL_CLOSURE_GATE_LABELS[k]),
  }
}

export function formatBlockGapCanonicalClosureGateReport(counters: Readonly<Record<string, number>>): string[] {
  return BLOCK_GAP_CANONICAL_CLOSURE_GATE_KEYS.map(k => `${BLOCK_GAP_CANONICAL_CLOSURE_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

/** §22 — the positive runtime coverage the internal blank-gap closure needs. */
export const BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS: Readonly<Record<string, number>> = {
  INTERNAL_BLANK_LINE_WARNING_RUNTIME_COUNT: 1,
  INTERNAL_BLANK_LINE_PREVIOUS_BOUNDARY_RESOLVED_COUNT: 1,
  INTERNAL_BLANK_LINE_NEXT_BOUNDARY_RESOLVED_COUNT: 1,
  INTERNAL_BLANK_LINE_PREVIOUS_CODE_CANONICAL_BIND_COUNT: 1,
  INTERNAL_BLANK_LINE_GAP_RECT_COUNT: 1,
  INTERNAL_BLANK_LINE_ACTIVE_FILL_COUNT: 1,
  INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_RUNTIME_COUNT: 1,
  INTERNAL_BLANK_LINE_SCROLL_TARGET_IS_GAP_COUNT: 1,
  INTERNAL_BLANK_LINE_SCOPED_VISUAL_CLOSURE_PASS_COUNT: 1,
  INTERNAL_BLANK_LINE_DYNAMIC_DISAPPEAR_RUNTIME_COUNT: 1,
  INTERNAL_BLANK_LINE_DYNAMIC_REAPPEAR_RUNTIME_COUNT: 1,
}

export function emptyBlockGapCanonicalClosureCoverage(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS)) out[k] = 0
  return out
}

export function evaluateBlockGapCanonicalClosureCoverage(
  counters: Readonly<Record<string, number>>,
): { satisfied: boolean; unmet: string[] } {
  const unmet = Object.entries(BLOCK_GAP_CANONICAL_CLOSURE_COVERAGE_REQUIREMENTS)
    .filter(([k, min]) => (counters[k] ?? 0) < min)
    .map(([k]) => k)
  return { satisfied: unmet.length === 0, unmet }
}
