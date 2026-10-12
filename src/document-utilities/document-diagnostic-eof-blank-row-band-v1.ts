/**
 * TRAE §P0 — the EOF EXCESS background authority (pure contract).
 *
 * ROOT_CAUSE: the document-end excess region used a SYNTHESISED band rect
 * (`computeSyntheticEofGeometry`), whose height came from
 * `extraTrailingBlankLineCount × guessedLineHeight` (the `boundedTail` guess).
 * A guessed height can span a whole code block / heading / caption, so the
 * yellow background covered real content (the real-Runtime screenshot).
 *
 * THE AUTHORITY IS NOW:
 *   件   last non-empty content block  = semantic FRONT boundary (document order)
 *   rows the REAL trailing blank DOM rows (never a count × height guess)
 *   EOF  the document EOF              = END boundary
 *
 * Rules:
 *   1. the rect set comes from the REAL trailing blank row rects,
 *   2. rows strictly after the last non-empty block are the tail,
 *   3. the first `requiredTrailingBlankLineCount` rows are the LEGAL allowance
 *      and are NOT part of the painted excess region,
 *   4. adjacent rows are merged (vertical gap <= mergeGapPx); single rows paint
 *      independently,
 *   5. ANY group overlapping a non-empty content block REJECTS the whole plan,
 *   6. no synthesised height may EVER produce the band.
 *
 * Pure: no DOM, no host state.
 */

export interface EofBandRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EofExcessBandBox extends EofBandRect {
  width: number
  height: number
}

export type EofExcessBandDecision =
  | 'OK'
  | 'NO_LAST_MEANINGFUL'
  | 'NO_EXCESS_ROWS'
  | 'OVERLAPS_CONTENT'
  | 'DEGENERATE'

export interface EofExcessBandResult {
  decision: EofExcessBandDecision
  /** The painted region — ONLY non-null when `decision === 'OK'`. */
  band: EofExcessBandBox | null
  /** Real trailing blank rows used (excess only, after the legal allowance). */
  rowCount: number
  /** Merged row groups (adjacent rows collapse, single rows stay independent). */
  mergedGroupCount: number
}

/** Adjacent blank rows whose vertical gap is <= this are merged. */
export const EOF_EXCESS_BAND_MERGE_GAP_PX = 1

/** §6 — do these two rects overlap with a strictly positive area? */
function overlaps(a: EofBandRect, b: EofBandRect): boolean {
  const top = Math.max(a.top, b.top)
  const bottom = Math.min(a.bottom, b.bottom)
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.right, b.right)
  return bottom - top > 0.5 && right - left > 0.5
}

/**
 * §P0 — build the EOF excess band STRICTLY from the REAL trailing blank rows.
 * Returns a null band (rejected) whenever a trustworthy region cannot be proven.
 */
export function buildEofExcessBandFromRealRows(input: {
  trailingBlankRects: ReadonlyArray<EofBandRect | null | undefined>
  meaningfulRects: ReadonlyArray<EofBandRect | null | undefined>
  lastMeaningfulRect: EofBandRect | null
  requiredTrailingBlankLineCount: number
  textColumnLeft: number | null
  contentRight: number | null
  mergeGapPx?: number
}): EofExcessBandResult {
  const last = input.lastMeaningfulRect
  if (last == null || !Number.isFinite(last.bottom)) {
    return { decision: 'NO_LAST_MEANINGFUL', band: null, rowCount: 0, mergedGroupCount: 0 }
  }
  const finite = (r: EofBandRect | null | undefined): r is EofBandRect =>
    r != null && Number.isFinite(r.left) && Number.isFinite(r.top)
    && Number.isFinite(r.right) && Number.isFinite(r.bottom)
  // §2/§3 — ONLY rows STRICTLY BELOW the last non-empty block are the EOF tail.
  const rows = input.trailingBlankRects
    .filter(finite)
    .filter(r => r.bottom > last.bottom + 0.5)
    .sort((a, b) => a.top - b.top)
  // §3 — the first `required` rows are the LEGAL allowance, not the excess region.
  const skip = Math.max(0, Math.floor(input.requiredTrailingBlankLineCount))
  const excess = rows.slice(skip)
  if (excess.length === 0) {
    return { decision: 'NO_EXCESS_ROWS', band: null, rowCount: 0, mergedGroupCount: 0 }
  }
  const left = input.textColumnLeft != null && Number.isFinite(input.textColumnLeft)
    ? input.textColumnLeft
    : last.left
  const right = input.contentRight != null && Number.isFinite(input.contentRight) && input.contentRight > left
    ? input.contentRight
    : Math.max(left + 1, last.right)
  // §4 — merge vertically adjacent rows; a single row stays its own group.
  const gapPx = input.mergeGapPx ?? EOF_EXCESS_BAND_MERGE_GAP_PX
  const groups: Array<{ top: number; bottom: number }> = []
  for (const r of excess) {
    const g = groups[groups.length - 1]
    if (g && r.top - g.bottom <= gapPx && r.top >= g.top) {
      g.bottom = Math.max(g.bottom, r.bottom)
    } else {
      groups.push({ top: r.top, bottom: r.bottom })
    }
  }
  // §5 HARD — a group overlapping ANY non-empty content block rejects the plan.
  const meaningful = input.meaningfulRects.filter(finite)
  for (const g of groups) {
    const groupRect: EofBandRect = { left, top: g.top, right, bottom: g.bottom }
    for (const m of meaningful) {
      if (overlaps(groupRect, m)) {
        return { decision: 'OVERLAPS_CONTENT', band: null, rowCount: excess.length, mergedGroupCount: groups.length }
      }
    }
  }
  const top = groups[0].top
  const bottom = groups[groups.length - 1].bottom
  // §6 — a degenerate (zero-height) region is never painted.
  if (!(bottom - top > 0.5) || !(right - left > 0.5)) {
    return { decision: 'DEGENERATE', band: null, rowCount: excess.length, mergedGroupCount: groups.length }
  }
  return {
    decision: 'OK',
    band: { left, top, right, bottom, width: right - left, height: bottom - top },
    rowCount: excess.length,
    mergedGroupCount: groups.length,
  }
}
