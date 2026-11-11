/**
 * Blank-line diagnostic marker LAYOUT (M1-LAYOUT) — PURE.
 *
 * THE PROBLEM (real Typora 1.6.7 GUI, 2026-11-12): the left rail and the count
 * chip were anchored at the DOCUMENT TEXT COLUMN's left edge, so the chip
 * `left:10px` sat exactly on the caret of an empty paragraph (write.left=390,
 * text column left=420, caret x=431) and hid it.
 *
 * THE CONTRACT (this module):
 *   - the rail lives in the EDITOR'S LEFT GUTTER, `gutterPx` left of the text
 *     column (preferred 18px), clamped so it never leaves the editor shell
 *     (never enters the file-tree sidebar);
 *   - the chip is right-aligned to the rail when the gutter is wide enough,
 *     otherwise it is re-placed onto a rendered blank row that does NOT carry
 *     the caret;
 *   - the collision check is a REAL rect intersection between the marker and the
 *     caret, never a guess.
 *
 * It changes NO document padding / width / line-height and creates no
 * Markdown node. Pure: no DOM, no host state.
 */

/** §3 — the preferred distance the rail sits left of the text column. */
export const BLANK_MARKER_GUTTER_PREFERRED_PX = 18

/** §3 — the rail stays a 2px line. */
export const BLANK_MARKER_RAIL_WIDTH_PX = 2

/** §3.7 — keep a real gap from the editor shell edge (never touch the sidebar). */
export const BLANK_MARKER_EDITOR_EDGE_GAP_PX = 2

/** §3.2 — compact chip metrics (kept in sync with style.scss). */
export const BLANK_MARKER_CHIP_HEIGHT_PX = 20
export const BLANK_MARKER_CHIP_TOP_INSET_PX = 4
export const BLANK_MARKER_CHIP_RAIL_GAP_PX = 2

export interface BlankMarkerGutterResult {
  /** The actual left shift applied to the rail (0 when no gutter is available). */
  gutterPx: number
  /** True when the preferred distance had to be reduced (narrow window). */
  clamped: boolean
}

/**
 * §3.7 — resolve the left gutter from LIVE geometry. The rail may move left only
 * as far as the editor shell allows; a narrow window shrinks the distance instead
 * of pushing the marker into the sidebar.
 */
export function resolveBlankMarkerGutter(input: {
  textColumnLeft: number | null
  editorLeft: number | null
  preferredPx?: number
}): BlankMarkerGutterResult {
  const preferred = Math.max(0, input.preferredPx ?? BLANK_MARKER_GUTTER_PREFERRED_PX)
  const column = input.textColumnLeft
  const editor = input.editorLeft
  if (column == null || editor == null || !Number.isFinite(column) || !Number.isFinite(editor)) {
    return { gutterPx: 0, clamped: true }
  }
  const available = column - editor - BLANK_MARKER_RAIL_WIDTH_PX - BLANK_MARKER_EDITOR_EDGE_GAP_PX
  if (!(available > 0)) return { gutterPx: 0, clamped: preferred > 0 }
  const applied = Math.floor(Math.min(preferred, available))
  return { gutterPx: applied, clamped: applied < preferred }
}

export interface MarkerCaretRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface BlankMarkerChipPlacement {
  /** Chip left, relative to the marker CARRIER (may be negative). */
  left: number
  /** Chip top, relative to the marker CARRIER. */
  top: number
  placement: 'LEFT_GUTTER' | 'ADJACENT_FREE_ROW' | 'BOTTOM_ROW'
  /** Real rect-intersection verdict against the caret at placement time. */
  collidesWithCaret: boolean
  /** True when no caret-free row could be found (documented, never silent). */
  caretUnavoidable: boolean
}

function intersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: MarkerCaretRect,
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * §3.3/§3.7 — place the count chip so it never covers the caret.
 *
 * 1. `LEFT_GUTTER` — right-aligned to the rail, fully left of the text column.
 *    This is always caret-free (the caret lives inside the text column).
 * 2. `ADJACENT_FREE_ROW` — the gutter is too narrow, so the chip starts just
 *    right of the rail but is moved VERTICALLY onto a blank row whose band does
 *    not contain the caret.
 * 3. `BOTTOM_ROW` — every candidate row carries the caret; the chip is pinned
 *    just BELOW the carrier (never on top of the caret). The verdict is always
 *    the REAL rect intersection of the FINAL chip box.
 */
export function resolveBlankMarkerChipPlacement(input: {
  /** Carrier left in viewport space (= document text column left). */
  containerLeft: number
  /** Carrier top in viewport space. */
  containerTop: number
  /** Carrier height in viewport space. */
  containerHeight: number
  gutterPx: number
  editorLeft: number
  chipWidth: number
  chipHeight?: number
  /** Rendered blank-row top edges (viewport) — the vertical candidates. */
  rowTops?: ReadonlyArray<number>
  caretRect?: MarkerCaretRect | null
}): BlankMarkerChipPlacement {
  const chipH = Math.max(1, input.chipHeight ?? BLANK_MARKER_CHIP_HEIGHT_PX)
  const chipW = Math.max(1, input.chipWidth)
  const topInset = BLANK_MARKER_CHIP_TOP_INSET_PX
  const railLeft = input.containerLeft - input.gutterPx
  const caret = input.caretRect ?? null

  const build = (
    leftVp: number,
    topVp: number,
    placement: BlankMarkerChipPlacement['placement'],
  ): BlankMarkerChipPlacement => {
    const rect = { left: leftVp, top: topVp, right: leftVp + chipW, bottom: topVp + chipH }
    return {
      left: Math.round(leftVp - input.containerLeft),
      top: Math.round(topVp - input.containerTop),
      placement,
      collidesWithCaret: caret != null && intersects(rect, caret),
      caretUnavoidable: false,
    }
  }

  // 1 — LEFT_GUTTER: the chip's right edge stops before the rail's left edge.
  const gutterLeft = railLeft - BLANK_MARKER_CHIP_RAIL_GAP_PX - chipW
  if (gutterLeft >= input.editorLeft + BLANK_MARKER_EDITOR_EDGE_GAP_PX) {
    return build(gutterLeft, input.containerTop + topInset, 'LEFT_GUTTER')
  }

  // 2 — ADJACENT: start just right of the rail, on a caret-free row.
  const adjacentLeft = railLeft + BLANK_MARKER_RAIL_WIDTH_PX + BLANK_MARKER_CHIP_RAIL_GAP_PX
  const candidates: number[] = []
  for (const rowTop of input.rowTops ?? []) {
    if (Number.isFinite(rowTop)) candidates.push(rowTop + topInset)
  }
  // §3.3 — the region's FIRST row is only a candidate when it was measured; it is
  // never synthesised from a container base that may differ from the painted box.
  if (candidates.length === 0) candidates.push(input.containerTop + topInset)
  // The last resort is OUTSIDE the carrier: a chip that sits on the caret is a
  // real user-visible defect, so "all rows are occupied" must move the label out.
  const belowTop = input.containerTop + input.containerHeight + BLANK_MARKER_CHIP_RAIL_GAP_PX
  if (Number.isFinite(belowTop)) candidates.push(belowTop)

  if (caret == null) return build(adjacentLeft, candidates[0], 'ADJACENT_FREE_ROW')
  for (const top of candidates) {
    const rect = { left: adjacentLeft, top, right: adjacentLeft + chipW, bottom: top + chipH }
    if (!intersects(rect, caret)) return build(adjacentLeft, top, 'ADJACENT_FREE_ROW')
  }

  // 3 — BOTTOM_ROW fallback: report the collision honestly (it is only a collision
  // when the caret really extends past the band, e.g. a selection over the gap).
  const fallback = build(adjacentLeft, belowTop, 'BOTTOM_ROW')
  return { ...fallback, caretUnavoidable: caret != null && fallback.collidesWithCaret }
}

/**
 * §3.10 / §7.16 — the ONE collision predicate used by the runtime check AND the
 * tests. A marker never covers the caret when either rect is unknown-for-caret
 * (no caret) or the rects do not intersect.
 */
export function markerIntersectsCaret(
  markerRect: { left: number; top: number; right: number; bottom: number } | null,
  caretRect: MarkerCaretRect | null,
): boolean {
  if (markerRect == null || caretRect == null) return false
  if (!(caretRect.right > caretRect.left)) return false
  if (!(caretRect.bottom > caretRect.top)) return false
  return intersects(markerRect, caretRect)
}
