import { describe, expect, it } from 'vitest'
import {
  BLOCK_GAP_CONTENT_GUARD_PX,
  BLOCK_GAP_MIN_VISIBLE_HEIGHT_PX,
  BLOCK_GAP_VISUAL_TARGET,
  blockGapVisualIdentity,
  computeBlockGapVisualGeometry,
  createBlockGapVisualV1Counters,
  createBlockGapVisualV1Coverage,
  evaluateBlockGapVisualV1Gates,
  formatBlockGapVisualV1CoverageReport,
  formatBlockGapVisualV1GateReport,
  isBlockGapGeometryValid,
} from './document-diagnostic-block-gap-visual-v1'
import {
  collectDocumentBlockGaps,
  internalBlankGapIdentity,
} from './document-diagnostic-internal-blank-lines-v1'

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
})

describe('Block Gap Visual V1 — BLOCK_GAP_VISUAL_TARGET geometry', () => {
  it('GAP-VIS-1: the band is strictly BETWEEN the two blocks (never on either)', () => {
    const g = computeBlockGapVisualGeometry({
      previousBlockRect: rect(100, 100, 700, 140),
      nextBlockRect: rect(100, 260, 700, 300),
      contentColumns: { left: 100, right: 700 },
    })
    expect(g).not.toBeNull()
    expect(g!.gapTop).toBeGreaterThanOrEqual(140)
    expect(g!.gapBottom).toBeLessThanOrEqual(260)
    expect(g!.gapTop).toBe(140 + BLOCK_GAP_CONTENT_GUARD_PX)
    expect(g!.gapBottom).toBe(260 - BLOCK_GAP_CONTENT_GUARD_PX)
    expect(g!.overlapsPreviousBlock).toBe(false)
    expect(g!.overlapsNextBlock).toBe(false)
    expect(g!.strictlyBetweenBlocks).toBe(true)
    expect(isBlockGapGeometryValid(g)).toBe(true)
  })

  it('GAP-VIS-2: a missing previous OR next block is NOT a gap (never paint a block)', () => {
    expect(computeBlockGapVisualGeometry({
      previousBlockRect: null,
      nextBlockRect: rect(100, 260, 700, 300),
      contentColumns: null,
    })).toBeNull()
    expect(computeBlockGapVisualGeometry({
      previousBlockRect: rect(100, 100, 700, 140),
      nextBlockRect: null,
      contentColumns: null,
    })).toBeNull()
  })

  it('GAP-VIS-3: an empty / inverted gap is refused (never a zero-height collapse onto a block)', () => {
    expect(computeBlockGapVisualGeometry({
      previousBlockRect: rect(100, 100, 700, 140),
      nextBlockRect: rect(100, 140, 700, 180),
      contentColumns: null,
    })).toBeNull()
    expect(computeBlockGapVisualGeometry({
      previousBlockRect: rect(100, 200, 700, 240),
      nextBlockRect: rect(100, 100, 700, 140),
      contentColumns: null,
    })).toBeNull()
  })

  it('GAP-VIS-4: the band spans the content column, not the viewport', () => {
    const g = computeBlockGapVisualGeometry({
      previousBlockRect: rect(100, 100, 700, 140),
      nextBlockRect: rect(100, 260, 700, 300),
      contentColumns: { left: 120, right: 680 },
    })!
    expect(g.gapLeft).toBe(120)
    expect(g.gapRight).toBe(680)
    expect(g.gapWidth).toBe(560)
  })

  it('GAP-VIS-5: the guard collapses gracefully but the band never inverts', () => {
    // 4px gap: guard (1px each side) leaves a 2px paintable band.
    const g = computeBlockGapVisualGeometry({
      previousBlockRect: rect(0, 0, 100, 100),
      nextBlockRect: rect(0, 104, 100, 140),
      contentColumns: null,
    })
    expect(g).not.toBeNull()
    expect(g!.gapHeight).toBeGreaterThanOrEqual(BLOCK_GAP_MIN_VISIBLE_HEIGHT_PX)
    expect(g!.overlapsPreviousBlock).toBe(false)
    expect(g!.overlapsNextBlock).toBe(false)
  })

  it('GAP-VIS-6: the identity is built from the two block identities only', () => {
    const a = blockGapVisualIdentity('paragraph:A#0', 'heading:B#0')
    const b = blockGapVisualIdentity('paragraph:A#0', 'heading:B#0')
    expect(a).toBe(b)
    expect(a).not.toBe(blockGapVisualIdentity('paragraph:A#0', 'heading:B#1'))
    expect(BLOCK_GAP_VISUAL_TARGET).toBe('block-gap')
  })

  it('GAP-META-1: the producer exposes previousBlockAnchorText for BOTH sides', () => {
    const gaps = collectDocumentBlockGaps('A段落\n\n\n\nB段落\n')
    expect(gaps.length).toBe(1)
    expect(gaps[0].previousBlockAnchorText).toBe('A段落')
    expect(gaps[0].nextBlockAnchorText).toBe('B段落')
    expect(gaps[0].actualBlankLines).toBe(3)
  })

  it('GAP-META-2: the stable identity ignores the blank-line count (15→9→3)', () => {
    const three = collectDocumentBlockGaps('A\n\n\nB\n')
    const nine = collectDocumentBlockGaps('A\n\n\n\n\n\n\n\n\nB\n')
    expect(internalBlankGapIdentity(three[0])).toBe(internalBlankGapIdentity(nine[0]))
  })
})

describe('Block Gap Visual V1 — gates + coverage', () => {
  it('GAP-GATE-1: a clean counter set is PASS; any non-zero is FAIL', () => {
    const counters = createBlockGapVisualV1Counters()
    expect(evaluateBlockGapVisualV1Gates(counters).decision).toBe('PASS')
    counters.visualBoundToNextBlock = 1
    expect(evaluateBlockGapVisualV1Gates(counters).decision).toBe('FAIL')
    expect(evaluateBlockGapVisualV1Gates(counters).failing)
      .toContain('INTERNAL_BLANK_LINE_VISUAL_BOUND_TO_NEXT_BLOCK_COUNT')
  })

  it('GAP-GATE-2: the report carries every required hard-gate label', () => {
    const report = formatBlockGapVisualV1GateReport(createBlockGapVisualV1Counters())
    for (const label of [
      'INTERNAL_BLANK_LINE_DOM_GEOMETRY_USED_FOR_DETECTION_COUNT',
      'INTERNAL_BLANK_LINE_VISUAL_BOUND_TO_PREVIOUS_BLOCK_COUNT',
      'INTERNAL_BLANK_LINE_VISUAL_BOUND_TO_NEXT_BLOCK_COUNT',
      'INTERNAL_BLANK_LINE_VISUAL_COVERS_CONTENT_TEXT_COUNT',
      'INTERNAL_BLANK_LINE_VISUAL_ALTERS_DOCUMENT_LAYOUT_COUNT',
      'INTERNAL_BLANK_LINE_STALE_GAP_VISUAL_COUNT',
      'INTERNAL_BLANK_LINE_FIRST_CLICK_NOT_ACTIVATED_COUNT',
      'INTERNAL_BLANK_LINE_DUPLICATE_VISUAL_COUNT',
      'INTERNAL_BLANK_LINE_GAP_VISUAL_MISSING_COUNT',
    ]) {
      expect(report).toContain(`${label}=0`)
    }
  })

  it('GAP-GATE-3: the coverage report carries every required positive counter', () => {
    const report = formatBlockGapVisualV1CoverageReport(createBlockGapVisualV1Coverage())
    expect(report).toContain('INTERNAL_BLANK_LINE_GAP_VISUAL_RUNTIME_COUNT=0')
    expect(report).toContain('INTERNAL_BLANK_LINE_GAP_ACTIVE_RUNTIME_COUNT=0')
    expect(report).toContain('INTERNAL_BLANK_LINE_GAP_SHRINK_RUNTIME_COUNT=0')
    expect(report).toContain('INTERNAL_BLANK_LINE_GAP_DISAPPEAR_RUNTIME_COUNT=0')
    expect(report).toContain('INTERNAL_BLANK_LINE_GAP_REAPPEAR_RUNTIME_COUNT=0')
  })
})
