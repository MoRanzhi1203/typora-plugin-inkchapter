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
