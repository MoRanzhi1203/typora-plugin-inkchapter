/**
 * M1-LAYOUT — blank-line marker positioning authority (PURE, regression).
 *
 * Real Typora 1.6.7 geometry this file locks (measured 2026-11-12):
 *   #write.left = 390   document text column left = 420   caret x ≈ 431
 * The old chip (`left:10px` inside the carrier at the text column) covered that
 * caret. The rail must move ~18px into the editor gutter, and the chip must be
 * placed by a REAL caret-rect collision check — never by a fixed left value.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveBlankMarkerGutter,
  resolveBlankMarkerChipPlacement,
  markerIntersectsCaret,
  BLANK_MARKER_GUTTER_PREFERRED_PX,
} from './document-diagnostic-blank-marker-layout-v1'

const EDITOR_LEFT = 390
const TEXT_COLUMN_LEFT = 420

function caretAt(x: number, y: number, h = 22) {
  return { left: x, top: y, right: x + 1, bottom: y + h }
}

describe('M1-LAYOUT §3.1 — rail sits 16–20px left of the text column', () => {
  it('moves the rail into the editor gutter by the preferred 18px', () => {
    const r = resolveBlankMarkerGutter({ textColumnLeft: TEXT_COLUMN_LEFT, editorLeft: EDITOR_LEFT })
    expect(r.gutterPx).toBe(BLANK_MARKER_GUTTER_PREFERRED_PX)
    expect(r.gutterPx).toBeGreaterThanOrEqual(16)
    expect(r.gutterPx).toBeLessThanOrEqual(20)
    expect(r.clamped).toBe(false)
  })

  it('§3.7 — a narrow editor shrinks the distance instead of entering the sidebar', () => {
    // Only 10px available between the sidebar and the text column.
    const r = resolveBlankMarkerGutter({ textColumnLeft: EDITOR_LEFT + 10, editorLeft: EDITOR_LEFT })
    expect(r.gutterPx).toBeLessThan(BLANK_MARKER_GUTTER_PREFERRED_PX)
    expect(r.gutterPx).toBeGreaterThanOrEqual(0)
    expect(r.clamped).toBe(true)
    // The rail can never be placed LEFT of the editor shell.
    expect(TEXT_COLUMN_LEFT - r.gutterPx).toBeGreaterThanOrEqual(EDITOR_LEFT)
  })

  it('§3.7 — zero available space yields no shift (rail stays at the text column)', () => {
    const r = resolveBlankMarkerGutter({ textColumnLeft: EDITOR_LEFT, editorLeft: EDITOR_LEFT })
    expect(r.gutterPx).toBe(0)
    expect(r.clamped).toBe(true)
  })

  it('unknown geometry never guesses a negative shift', () => {
    expect(resolveBlankMarkerGutter({ textColumnLeft: null, editorLeft: EDITOR_LEFT }).gutterPx).toBe(0)
    expect(resolveBlankMarkerGutter({ textColumnLeft: TEXT_COLUMN_LEFT, editorLeft: null }).gutterPx).toBe(0)
    expect(resolveBlankMarkerGutter({ textColumnLeft: Number.NaN, editorLeft: EDITOR_LEFT }).gutterPx).toBe(0)
  })
})

describe('M1-LAYOUT §3.3/§3.7 — the chip never covers the caret', () => {
  const base = {
    containerLeft: TEXT_COLUMN_LEFT,
    containerTop: 180,
    containerHeight: 152,
    gutterPx: 18,
    editorLeft: EDITOR_LEFT,
    chipWidth: 64,
    chipHeight: 20,
    rowTops: [180, 218, 256, 295],
  }

  it('a wide editor margin right-aligns the chip to the rail (fully left of the caret)', () => {
    // Plenty of room: the rail keeps its preferred 18px, and the chip fits to its
    // LEFT inside the margin (editor shell starts 120px left of the text column).
    const p = resolveBlankMarkerChipPlacement({
      ...base,
      gutterPx: 18,
      editorLeft: TEXT_COLUMN_LEFT - 120,
      caretRect: caretAt(TEXT_COLUMN_LEFT + 11, 182),
    })
    expect(p.placement).toBe('LEFT_GUTTER')
    // chip right edge stays LEFT of the text column (caret lives there)
    expect(p.left + base.chipWidth).toBeLessThanOrEqual(0)
    expect(p.collidesWithCaret).toBe(false)
  })

  it('a narrow gutter re-places the chip onto a row that does NOT hold the caret', () => {
    const p = resolveBlankMarkerChipPlacement({ ...base, caretRect: caretAt(431, 182) })
    expect(p.placement).toBe('ADJACENT_FREE_ROW')
    expect(p.collidesWithCaret).toBe(false)
    // the chosen row band must not contain the caret band [182,204]
    const top = base.containerTop + p.top
    expect(top + base.chipHeight <= 182 || top >= 204).toBe(true)
  })

  it('the caret on the LAST row moves the chip to the first row (never a fixed side)', () => {
    const p = resolveBlankMarkerChipPlacement({ ...base, caretRect: caretAt(431, 297) })
    expect(p.collidesWithCaret).toBe(false)
    const top = base.containerTop + p.top
    expect(top + base.chipHeight <= 297).toBe(true)
  })

  it('no caret (selection outside the document) keeps the default top placement', () => {
    const p = resolveBlankMarkerChipPlacement({ ...base, caretRect: null })
    expect(p.placement).toBe('ADJACENT_FREE_ROW')
    expect(p.collidesWithCaret).toBe(false)
    expect(p.top).toBe(4)
  })

  it('§3.7 — every row carries the caret → the chip leaves the band (never on the caret)', () => {
    // Real EOF case: ONE excess row (218..244) and the caret is inside it. The label
    // must be pinned just BELOW the band instead of covering the caret.
    const p = resolveBlankMarkerChipPlacement({
      containerLeft: TEXT_COLUMN_LEFT,
      containerTop: 218,
      containerHeight: 26,
      gutterPx: 18,
      editorLeft: EDITOR_LEFT,
      chipWidth: 64,
      chipHeight: 20,
      rowTops: [218],
      caretRect: caretAt(TEXT_COLUMN_LEFT + 11, 220),
    })
    expect(p.placement).not.toBe('LEFT_GUTTER')
    expect(p.collidesWithCaret).toBe(false)
    expect(p.caretUnavoidable).toBe(false)
    // painted strictly BELOW the diagnosed band (association kept, caret clear)
    expect(218 + p.top).toBeGreaterThanOrEqual(218 + 26)
  })

  it('§3.7 — every row busy is reported (never silently hidden)', () => {
    const p = resolveBlankMarkerChipPlacement({
      ...base,
      containerHeight: 22,
      rowTops: [180],
      caretRect: { left: 425, top: 170, right: 700, bottom: 240 },
    })
    expect(p.placement).toBe('BOTTOM_ROW')
    expect(p.caretUnavoidable).toBe(true)
    // it is still PAINTED — hiding the marker is forbidden
    expect(Number.isFinite(p.left)).toBe(true)
    expect(Number.isFinite(p.top)).toBe(true)
  })
})

describe('M1-LAYOUT §3.10 — the ONE collision predicate', () => {
  it('detects a real overlap', () => {
    expect(markerIntersectsCaret(
      { left: 405, top: 180, right: 470, bottom: 200 },
      caretAt(431, 182),
    )).toBe(true)
  })

  it('rejects a non-overlapping marker (gutter placement)', () => {
    expect(markerIntersectsCaret(
      { left: 320, top: 180, right: 384, bottom: 200 },
      caretAt(431, 182),
    )).toBe(false)
  })

  it('no caret / no marker rect is never a collision', () => {
    expect(markerIntersectsCaret(null, caretAt(431, 182))).toBe(false)
    expect(markerIntersectsCaret({ left: 0, top: 0, right: 10, bottom: 10 }, null)).toBe(false)
  })

  it('a zero-height caret rect (no real caret) is ignored', () => {
    expect(markerIntersectsCaret(
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 10, top: 10, right: 10, bottom: 10 },
    )).toBe(false)
  })
})
