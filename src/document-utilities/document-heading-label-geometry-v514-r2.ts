/**
 * V5.14-R2 (P5-R2) — Heading LABEL geometry authority.
 *
 * ROOT_P5_R2: the墨章 heading number is rendered as an ATTRIBUTE-driven `::before`
 * on the heading element (`data-inkchapter-heading-number`), i.e. a **PREFIX**
 * gutter that sits LEFT of the first text line. `headingNumberRect()` returns
 * `{left: headingBox.left, right: firstTextFragment.left}` on that FIRST line band.
 *
 * The previous authority took `contentRight = Math.max(number.right, text.right)`,
 * which mixes a PREFIX gutter (first line) with the LAST text fragment — two
 * different line bands / authorities — so it is NOT a valid label right edge.
 * Evidence: numberRect.right ≈ 354.99, textRect.right ≈ 142.49, chipLeft ≈ 150.49
 * (= textRight + 8) while contentRight ≈ 354.99 → contradictory.
 *
 * This module makes the placement EXPLICIT and derives the chip anchor from it:
 *   PREFIX / ABSENT / INVALID → anchor on the TEXT label right (+ gap);
 *                               the number participates only in validation.
 *   SUFFIX                    → anchor on max(lastText.right, number.right) (+ gap).
 *   DETACHED                  → must NOT silently move the anchor (caller gates it).
 *
 * Pure contract: no DOM, no host state.
 */
export type HeadingNumberPlacement = 'PREFIX' | 'SUFFIX' | 'DETACHED' | 'ABSENT' | 'INVALID'

export interface HeadingLabelRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface HeadingLabelGeometrySnapshot {
  documentKey: string
  stableHeadingIdentity: string
  layoutEpoch: number

  textRects: readonly HeadingLabelRect[]
  lastTextRect: HeadingLabelRect
  /** V5.14-R2 — the DEFAULT reason-chip gap (px). */
  chipGapPx: number

  numberRect: HeadingLabelRect | null
  numberPlacement: HeadingNumberPlacement

  visualLabelRight: number
  reasonChipAnchorX: number

  numberRectIncluded: boolean
  numberRectParticipatesInAnchor: boolean
}

export const HEADING_NUMBER_PREFIX_GAP_TOLERANCE_PX = 4

/**
 * §P5-R2 — the canonical horizontal gap between the heading LABEL right edge and
 * the reason chip. One constant so the placement, the painted chip and the audit
 * can never disagree about the gap.
 */
export const HEADING_LABEL_CHIP_GAP_PX = 8

/**
 * §P5-R2 — two rects share a line band only when they overlap VERTICALLY by at least
 * this fraction of the smaller rect's height. A bare `overlap > 0` test is unsafe:
 * the real runtime probe showed a number whose band overlapped the label by only
 * 0.8px, which would flip a far-right number into SUFFIX and drag the chip ~213px.
 */
export const HEADING_NUMBER_SAME_BAND_MIN_OVERLAP_RATIO = 0.5

function verticalOverlap(a: HeadingLabelRect, b: HeadingLabelRect): number {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
}

function sharesLineBand(a: HeadingLabelRect, b: HeadingLabelRect): boolean {
  const minH = Math.min(a.height, b.height)
  if (!(minH > 0)) return false
  return verticalOverlap(a, b) >= minH * HEADING_NUMBER_SAME_BAND_MIN_OVERLAP_RATIO
}

/** The right-most TEXT fragment — the only unambiguous "label end" anchor. */
export function rightMostTextRect(
  textRects: readonly HeadingLabelRect[],
): HeadingLabelRect | null {
  let out: HeadingLabelRect | null = null
  for (const r of textRects) {
    if (!(r.width > 0 && r.height > 0)) continue
    if (!out || r.right > out.right) out = r
  }
  return out
}

const SAME_LINE_EPSILON_PX = 1

/**
 * §P5-R2 — the fragment on the LAST VISIBLE LINE (greatest bottom; right-most on a
 * tie). The reason chip sits beside that line, so the anchor must be its right edge —
 * NOT the widest line's (which can sit on an earlier line and would let the chip
 * overlap the final line).
 */
export function lastVisibleLineTextRect(
  textRects: readonly HeadingLabelRect[],
): HeadingLabelRect | null {
  let out: HeadingLabelRect | null = null
  for (const r of textRects) {
    if (!(r.width > 0 && r.height > 0)) continue
    if (!out) { out = r; continue }
    if (r.bottom > out.bottom + SAME_LINE_EPSILON_PX) { out = r; continue }
    if (Math.abs(r.bottom - out.bottom) <= SAME_LINE_EPSILON_PX && r.right > out.right) out = r
  }
  return out
}

/** §P5-R2 — the fragment on the FIRST VISIBLE LINE (the墨章 prefix gutter's line). */
export function firstVisibleLineTextRect(
  textRects: readonly HeadingLabelRect[],
): HeadingLabelRect | null {
  let out: HeadingLabelRect | null = null
  for (const r of textRects) {
    if (!(r.width > 0 && r.height > 0)) continue
    if (!out) { out = r; continue }
    if (r.top < out.top - SAME_LINE_EPSILON_PX) { out = r; continue }
    if (Math.abs(r.top - out.top) <= SAME_LINE_EPSILON_PX && r.left < out.left) out = r
  }
  return out
}

/**
 * §P5-R2 — classify the number rect against the heading label's text rects.
 * A PREFIX is the ONLY shape the墨章 `::before` can produce: same line band as the
 * FIRST text fragment and ending at/left of that fragment's left edge.
 */
export function classifyHeadingNumberPlacement(
  numberRect: HeadingLabelRect | null,
  textRects: readonly HeadingLabelRect[],
): HeadingNumberPlacement {
  if (!numberRect) return 'ABSENT'
  if (!(numberRect.width > 0 && numberRect.height > 0)) return 'INVALID'
  const measurable = textRects.filter(r => r.width > 0 && r.height > 0)
  if (measurable.length === 0) return 'INVALID'
  const first = firstVisibleLineTextRect(measurable)!
  const last = lastVisibleLineTextRect(measurable)!
  if (sharesLineBand(numberRect, first)
    && numberRect.right <= first.left + HEADING_NUMBER_PREFIX_GAP_TOLERANCE_PX) {
    return 'PREFIX'
  }
  if (sharesLineBand(numberRect, last)
    && numberRect.left >= last.right - HEADING_NUMBER_PREFIX_GAP_TOLERANCE_PX) {
    return 'SUFFIX'
  }
  return 'DETACHED'
}

/**
 * §P5-R2 — the ONE anchor rule. `gapPx` is exported so the host and the audit
 * always report the same number.
 */
export function resolveHeadingLabelAnchor(input: {
  numberRect: HeadingLabelRect | null
  textRects: readonly HeadingLabelRect[]
  gapPx: number
}): {
  placement: HeadingNumberPlacement
  lastTextRect: HeadingLabelRect | null
  visualLabelRight: number
  reasonChipAnchorX: number
  numberRectParticipatesInAnchor: boolean
} {
  const placement = classifyHeadingNumberPlacement(input.numberRect, input.textRects)
  const last = lastVisibleLineTextRect(input.textRects)
  if (!last) {
    return {
      placement: 'INVALID',
      lastTextRect: null,
      visualLabelRight: 0,
      reasonChipAnchorX: 0,
      numberRectParticipatesInAnchor: false,
    }
  }
  if (placement === 'SUFFIX' && input.numberRect) {
    const visualLabelRight = Math.max(last.right, input.numberRect.right)
    return {
      placement,
      lastTextRect: last,
      visualLabelRight,
      reasonChipAnchorX: visualLabelRight + input.gapPx,
      numberRectParticipatesInAnchor: true,
    }
  }
  // PREFIX / ABSENT / DETACHED / INVALID — the chip follows the TEXT label; a
  // PREFIX number must never push it to the far right, and a DETACHED number must
  // never silently become the anchor (the host gates that case).
  return {
    placement,
    lastTextRect: last,
    visualLabelRight: last.right,
    reasonChipAnchorX: last.right + input.gapPx,
    numberRectParticipatesInAnchor: false,
  }
}

export function buildHeadingLabelGeometrySnapshot(input: {
  documentKey: string
  stableHeadingIdentity: string
  layoutEpoch: number
  textRects: readonly HeadingLabelRect[]
  numberRect: HeadingLabelRect | null
  gapPx: number
}): HeadingLabelGeometrySnapshot | null {
  const anchor = resolveHeadingLabelAnchor({
    numberRect: input.numberRect,
    textRects: input.textRects,
    gapPx: input.gapPx,
  })
  if (!anchor.lastTextRect) return null
  return {
    documentKey: input.documentKey,
    stableHeadingIdentity: input.stableHeadingIdentity,
    layoutEpoch: input.layoutEpoch,
    textRects: input.textRects,
    lastTextRect: anchor.lastTextRect,
    chipGapPx: input.gapPx,
    numberRect: input.numberRect,
    numberPlacement: anchor.placement,
    visualLabelRight: anchor.visualLabelRight,
    reasonChipAnchorX: anchor.reasonChipAnchorX,
    numberRectIncluded: input.numberRect != null,
    numberRectParticipatesInAnchor: anchor.numberRectParticipatesInAnchor,
  }
}

// ── P5-R2 §14 — the Heading label-geometry hard gates (all must be 0) ──────

export const HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS = [
  'numberRectSemanticMismatch',
  'reasonChipAnchorAuthorityMismatch',
  'reasonChipAnchorNotFromSettledGeometry',
  'numberRectDetachedUsedAsAnchor',
  'numberRectSuffixIgnored',
  'numberRectPrefixPushedChip',
  'numberRectFlipStaleChipSurvived',
  'numberRectFlipRebuildGtOne',
] as const

export type HeadingLabelGeometryV514R2GateKey = typeof HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS[number]

export const HEADING_LABEL_GEOMETRY_V514R2_GATE_LABELS: Readonly<Record<HeadingLabelGeometryV514R2GateKey, string>> = {
  numberRectSemanticMismatch: 'HEADING_NUMBER_RECT_SEMANTIC_MISMATCH_COUNT',
  reasonChipAnchorAuthorityMismatch: 'HEADING_REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH_COUNT',
  reasonChipAnchorNotFromSettledGeometry: 'HEADING_REASON_CHIP_ANCHOR_NOT_FROM_SETTLED_GEOMETRY_COUNT',
  numberRectDetachedUsedAsAnchor: 'HEADING_NUMBER_RECT_DETACHED_USED_AS_ANCHOR_COUNT',
  numberRectSuffixIgnored: 'HEADING_NUMBER_RECT_SUFFIX_IGNORED_COUNT',
  numberRectPrefixPushedChip: 'HEADING_NUMBER_RECT_PREFIX_PUSHED_CHIP_COUNT',
  numberRectFlipStaleChipSurvived: 'HEADING_NUMBER_RECT_FLIP_STALE_CHIP_SURVIVED_COUNT',
  numberRectFlipRebuildGtOne: 'HEADING_NUMBER_RECT_FLIP_REBUILD_GT_ONE_COUNT',
}

export type HeadingLabelGeometryV514R2Counters = Record<HeadingLabelGeometryV514R2GateKey, number>

export function createHeadingLabelGeometryV514R2Counters(): HeadingLabelGeometryV514R2Counters {
  return HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingLabelGeometryV514R2Counters)
}

export function formatHeadingLabelGeometryV514R2GateReport(
  counters: Readonly<HeadingLabelGeometryV514R2Counters>,
): string[] {
  return HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS.map(
    k => `${HEADING_LABEL_GEOMETRY_V514R2_GATE_LABELS[k]}=${counters[k] ?? 0}`,
  )
}

export function evaluateHeadingLabelGeometryV514R2Gates(
  counters: Readonly<HeadingLabelGeometryV514R2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingLabelGeometryV514R2GateKey[] } {
  const failedChecks = HEADING_LABEL_GEOMETRY_V514R2_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §P5-R2 — how ONE painted chip must be judged against the label authority. */
export function evaluateHeadingChipAnchorAuthority(input: {
  snapshot: HeadingLabelGeometrySnapshot
  actualChipLeft: number | null
  actualChipGapPx: number | null
  paintLayoutEpoch: number
}): {
  anchorAuthorityOk: boolean
  anchorFromSettledGeometry: boolean
  detachedUsedAsAnchor: boolean
  suffixIgnored: boolean
  prefixPushedChip: boolean
} {
  const { snapshot } = input
  if (input.actualChipLeft == null) {
    return {
      anchorAuthorityOk: true,
      anchorFromSettledGeometry: true,
      detachedUsedAsAnchor: false,
      suffixIgnored: false,
      prefixPushedChip: false,
    }
  }
  const expectedLeft = Math.round(snapshot.reasonChipAnchorX)
  const actualLeft = Math.round(input.actualChipLeft)
  // the reference is the LABEL right edge; the gap must match within 1px
  const actualGap = snapshot.visualLabelRight === 0
    ? null
    : input.actualChipGapPx
  const anchorAuthorityOk = Math.abs(actualLeft - expectedLeft) <= 1
    && (actualGap == null || Math.abs(actualGap - snapshot.chipGapPx) <= 1)
  return {
    anchorAuthorityOk,
    anchorFromSettledGeometry: input.paintLayoutEpoch === snapshot.layoutEpoch,
    // a DETACHED number must never have become the anchor
    detachedUsedAsAnchor: snapshot.numberPlacement === 'DETACHED'
      && snapshot.numberRectParticipatesInAnchor,
    // a SUFFIX number must be part of the anchor
    suffixIgnored: snapshot.numberPlacement === 'SUFFIX' && !snapshot.numberRectParticipatesInAnchor,
    // a PREFIX number must never push the chip beyond the text label
    prefixPushedChip: snapshot.numberPlacement === 'PREFIX'
      && actualLeft > Math.round(snapshot.lastTextRect.right) + snapshot.chipGapPx + 1,
  }
}

// ── P5-R2 §9 — the Heading label-geometry runtime audit ────────────────────

export const HEADING_LABEL_GEOMETRY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-LABEL-GEOMETRY-AUDIT'
