/**
 * TRAE §P0/§P2 — the EOF blank-region band authority + hard-gate family.
 */
import { describe, it, expect } from 'vitest'
import {
  buildEofExcessBandFromRealRows,
  EOF_EXCESS_BAND_MERGE_GAP_PX,
} from './document-diagnostic-eof-blank-row-band-v1'
import {
  EOF_BLANK_REGION_GATE_KEYS,
  EOF_BLANK_REGION_GATE_LABELS,
  createEofBlankRegionGateCounters,
  evaluateEofBlankRegionGates,
  formatEofBlankRegionGateReport,
} from './document-diagnostic-eof-blank-region-gate-v1'

const row = (top: number, bottom: number, left = 60, right = 700) => ({ left, top, right, bottom })
const last = row(1000, 1024)

describe('TRAE §P0 — buildEofExcessBandFromRealRows', () => {
  it('the band IS the union of the REAL excess rows (first legal blank skipped)', () => {
    // 5 trailing blank rows (24px each) → 1 legal + 4 excess.
    const blanks = [row(1024, 1048), row(1048, 1072), row(1072, 1096), row(1096, 1120), row(1120, 1144)]
    const r = buildEofExcessBandFromRealRows({
      trailingBlankRects: blanks, meaningfulRects: [last], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 1, textColumnLeft: 60, contentRight: 850,
    })
    expect(r.decision).toBe('OK')
    expect(r.band).not.toBeNull()
    // top = the SECOND blank row (the first is the legal allowance).
    expect(r.band!.top).toBe(1048)
    expect(r.band!.bottom).toBe(1144)
    expect(r.band!.left).toBe(60)
    expect(r.band!.right).toBe(850)
    expect(r.rowCount).toBe(4)
    expect(r.mergedGroupCount).toBe(1) // adjacent rows merge
  })

  it('a synthesised height is NEVER used: the bottom is a REAL row bottom', () => {
    const blanks = [row(1024, 1048), row(1048, 1072)]
    const two = buildEofExcessBandFromRealRows({
      trailingBlankRects: blanks, meaningfulRects: [last], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 1, textColumnLeft: 60, contentRight: 850,
    })
    const three = buildEofExcessBandFromRealRows({
      trailingBlankRects: [...blanks, row(1072, 1096)], meaningfulRects: [last], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 1, textColumnLeft: 60, contentRight: 850,
    })
    // adding a REAL row grows the band by exactly that row (24), never a guess.
    expect(three.band!.bottom - two.band!.bottom).toBe(24)
  })

  it('§6 HARD — any overlap with a non-empty block REJECTS the plan (no band)', () => {
    const contentInsideTail = row(1056, 1080) // a code-block / caption rect inside the tail
    const blanks = [row(1024, 1048), row(1048, 1072), row(1072, 1096)]
    const r = buildEofExcessBandFromRealRows({
      trailingBlankRects: blanks, meaningfulRects: [last, contentInsideTail], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 1, textColumnLeft: 60, contentRight: 850,
    })
    expect(r.decision).toBe('OVERLAPS_CONTENT')
    expect(r.band).toBeNull()
  })

  it('non-adjacent rows stay independent (no cross-empty-space union)', () => {
    // a 100px "void" between two blank rows (gap > mergeGapPx) keeps them distinct.
    expect(EOF_EXCESS_BAND_MERGE_GAP_PX).toBe(1)
    const blanks = [row(1024, 1048), row(1148, 1172)]
    const r = buildEofExcessBandFromRealRows({
      trailingBlankRects: blanks, meaningfulRects: [last], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 0, textColumnLeft: 60, contentRight: 850,
    })
    expect(r.decision).toBe('OK')
    expect(r.mergedGroupCount).toBe(2)
  })

  it('fail-closed when the anchor / rows are unavailable', () => {
    expect(buildEofExcessBandFromRealRows({
      trailingBlankRects: [], meaningfulRects: [], lastMeaningfulRect: null,
      requiredTrailingBlankLineCount: 1, textColumnLeft: null, contentRight: null,
    }).decision).toBe('NO_LAST_MEANINGFUL')
    expect(buildEofExcessBandFromRealRows({
      trailingBlankRects: [row(1024, 1048)], meaningfulRects: [last], lastMeaningfulRect: last,
      requiredTrailingBlankLineCount: 1, textColumnLeft: 60, contentRight: 850,
    }).decision).toBe('NO_EXCESS_ROWS')
  })
})

describe('TRAE §P2 — the EOF blank-region hard gates', () => {
  it('declares the 7 geometry gates + the 7 §7 semantic gates and starts PASS', () => {
    expect(EOF_BLANK_REGION_GATE_KEYS).toHaveLength(14)
    expect(Object.keys(EOF_BLANK_REGION_GATE_LABELS)).toHaveLength(14)
    const c = createEofBlankRegionGateCounters()
    expect(evaluateEofBlankRegionGates(c).decision).toBe('PASS')
    expect(evaluateEofBlankRegionGates(c).failing).toEqual([])
    const report = formatEofBlankRegionGateReport(c)
    for (const label of [
      'EOF_NONEMPTY_BLOCK_OVERLAP_COUNT=0',
      'EOF_PARENT_BACKGROUND_OVERLAP_COUNT=0',
      'EOF_BLANK_ROW_GEOMETRY_VALID=true',
      'EOF_LAYOUT_EPOCH_CURRENT=true',
      'EOF_FRAGMENT_OWNER_COUNT_MATCH=true',
      'EOF_ACTUAL_COVERAGE_VALID=true',
      'EOF_STALE_COMMIT_COUNT=0',
      // TRAE EOF-ENTER-BLANK §7 — the semantic-closure gates.
      'EOF_VISIBLE_COUNT_SOURCE_COUNT_CONFLATION=0',
      'EOF_STALE_DRAWER_COUNT=0',
      'EOF_DUPLICATE_PAINT_OWNER=0',
      'EOF_OLD_GENERATION_REPAINT=0',
      'EOF_PAINT_OVER_NONEMPTY_BLOCK=0',
      'EOF_MISSING_MARKER_UNLOCATABLE=0',
      'EOF_ENTER_EVENT_DOUBLE_EXECUTION=0',
    ]) expect(report).toContain(label)
  })

  it('§7 — each new semantic gate is 0 (counter) and flips the decision on violation', () => {
    const c = createEofBlankRegionGateCounters()
    expect(c.eofVisibleSourceConflation).toBe(0)
    expect(c.eofStaleDrawerCount).toBe(0)
    expect(c.eofDuplicatePaintOwner).toBe(0)
    expect(c.eofOldGenerationRepaint).toBe(0)
    expect(c.eofPaintOverNonemptyBlock).toBe(0)
    expect(c.eofMissingMarkerUnlocatable).toBe(0)
    expect(c.eofEnterEventDoubleExecution).toBe(0)
    const v = { ...c, eofVisibleSourceConflation: 1 }
    expect(evaluateEofBlankRegionGates(v).decision).toBe('FAIL')
    expect(evaluateEofBlankRegionGates(v).failing).toContain('EOF_VISIBLE_COUNT_SOURCE_COUNT_CONFLATION')
  })

  it('a count > 0 OR a boolean false is a FAIL with the exact label', () => {
    const c = createEofBlankRegionGateCounters()
    c.eofNonemptyBlockOverlap = 1
    expect(evaluateEofBlankRegionGates(c).decision).toBe('FAIL')
    expect(evaluateEofBlankRegionGates(c).failing).toContain('EOF_NONEMPTY_BLOCK_OVERLAP_COUNT')
    const c2 = { ...createEofBlankRegionGateCounters(), eofLayoutEpochCurrent: false }
    expect(evaluateEofBlankRegionGates(c2).failing).toEqual(['EOF_LAYOUT_EPOCH_CURRENT'])
    const c3 = { ...createEofBlankRegionGateCounters(), eofStaleCommit: 2 }
    expect(evaluateEofBlankRegionGates(c3).decision).toBe('FAIL')
  })
})
