import { describe, it, expect } from 'vitest'
import {
  HEADING_REASON_CHIP_MIN_GAP_PX_V2,
  HEADING_REASON_CHIP_STABILITY_V2_AUDIT_EVENT,
  HEADING_REASON_CHIP_STABILITY_V2_GATE_KEYS,
  HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS,
  computeHeadingReasonChipPlacement,
  computeHeadingVisualDirtyTargets,
  countForeignVisualFacts,
  createHeadingReasonChipStabilityV2Counters,
  evaluateHeadingReasonChipStability,
  evaluateHeadingReasonChipStabilityV2Gates,
  formatHeadingReasonChipStabilityV2GateReport,
  partitionVisualFactsByDocumentKey,
  type HeadingReasonChipStabilityFact,
} from './document-diagnostic-heading-reason-chip-stability-v2'

const line = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

// ── §4 / §15.1 — single canonical placement ────────────────────────────────

describe('Heading Reason Chip Stable Anchor V2 §4 — canonical placement', () => {
  it('places the chip beside the last line, vertically centred, gap = 8', () => {
    const p = computeHeadingReasonChipPlacement({
      lastTextRect: line(30, 766.625, 110, 793.825),
      headingRect: line(30, 766.625, 800, 793.825),
      chipWidth: 96,
      chipHeight: 20,
      editorSafeRect: line(0, 0, 1000, 900),
      preferredGapPx: 8,
    })
    expect(p.placementMode).toBe('INLINE_RIGHT')
    expect(p.left).toBe(118)
    expect(p.gapPx).toBe(8)
    expect(p.top).toBe(766.625 + (793.825 - 766.625 - 20) / 2)
    expect(p.horizontalClampApplied).toBe(false)
  })

  it('clamps horizontally near the right edge but never drops to the next line', () => {
    const p = computeHeadingReasonChipPlacement({
      lastTextRect: line(30, 100, 400, 124),
      headingRect: line(30, 100, 800, 124),
      chipWidth: 200,
      chipHeight: 20,
      editorSafeRect: line(0, 0, 500, 900),
      preferredGapPx: 8,
    })
    expect(p.placementMode).toBe('INLINE_RIGHT')
    // structural floor wins when the chip is wider than the remaining space: the chip
    // stays at `textRight + 4` instead of collapsing (never a next-line fallback).
    expect(p.left).toBe(404)
    expect(p.left).toBeGreaterThanOrEqual(400 + HEADING_REASON_CHIP_MIN_GAP_PX_V2)
    expect(p.horizontalClampApplied).toBe(true)
    expect(p.top).toBeLessThan(124)
  })

  it('a degenerate / unmeasured safe rect can NEVER collapse the chip to left = 0', () => {
    const p = computeHeadingReasonChipPlacement({
      lastTextRect: line(30, 766.625, 110, 793.825),
      headingRect: null,
      chipWidth: 96,
      chipHeight: 20,
      // the old bug: `editorRight` degenerated to `chipWidth` (== 96)
      editorSafeRect: line(0, 0, 96, 900),
      preferredGapPx: 8,
    })
    expect(p.left).toBe(114) // 110 + min gap 4
    expect(p.left).toBeGreaterThan(0)
    expect(p.top).toBeLessThan(793.825) // never below the text line
  })

  it('a long chip beside a short heading stays on the same line for every level', () => {
    for (const right of [40, 60, 90, 110, 140, 170]) {
      const p = computeHeadingReasonChipPlacement({
        lastTextRect: line(30, 200, right, 224),
        headingRect: null,
        chipWidth: 168,
        chipHeight: 20,
        editorSafeRect: line(0, 0, 900, 900),
        preferredGapPx: 8,
      })
      expect(p.placementMode).toBe('INLINE_RIGHT')
      expect(p.top).toBeLessThan(224)
      expect(p.left).toBeGreaterThanOrEqual(right + HEADING_REASON_CHIP_MIN_GAP_PX_V2)
    }
  })
})

// ── §7 / §15.2 — dirty set ─────────────────────────────────────────────────

describe('Heading Reason Chip Stable Anchor V2 §7 — dirty target reconcile', () => {
  const headingA = 'doc::D1::0::id:H3:idx:2'
  const headingB = 'doc::D2::0::id:H4:idx:6'
  const table = 'doc::TABLE_MISSING_NAME::0::block:table:0'

  it('heading → heading dirties at most the old + new target', () => {
    const dirty = computeHeadingVisualDirtyTargets({
      previousActiveKey: headingA, nextActiveKey: headingB,
      previousActiveIsHeading: true, nextActiveIsHeading: true,
    })
    expect(dirty.map(d => d.targetKey).sort()).toEqual([headingA, headingB].sort())
    expect(dirty).toHaveLength(2)
  })

  it('heading → table dirties only the old heading', () => {
    const dirty = computeHeadingVisualDirtyTargets({
      previousActiveKey: headingA, nextActiveKey: table,
      previousActiveIsHeading: true, nextActiveIsHeading: false,
    })
    expect(dirty).toEqual([{ targetKey: headingA, reason: 'ACTIVE_EXIT' }])
  })

  it('table → heading dirties only the new heading', () => {
    const dirty = computeHeadingVisualDirtyTargets({
      previousActiveKey: table, nextActiveKey: headingB,
      previousActiveIsHeading: false, nextActiveIsHeading: true,
    })
    expect(dirty).toEqual([{ targetKey: headingB, reason: 'ACTIVE_ENTER' }])
  })

  it('table → table dirties NO heading', () => {
    expect(computeHeadingVisualDirtyTargets({
      previousActiveKey: table, nextActiveKey: 'doc::CODE_MISSING_NAME::0::block:code:1',
      previousActiveIsHeading: false, nextActiveIsHeading: false,
    })).toEqual([])
  })

  it('same-target deactivate dirties exactly one heading', () => {
    const dirty = computeHeadingVisualDirtyTargets({
      previousActiveKey: headingA, nextActiveKey: headingA,
      previousActiveIsHeading: true, nextActiveIsHeading: true,
      sameTargetDeactivated: true,
    })
    expect(dirty).toEqual([{ targetKey: headingA, reason: 'ACTIVE_EXIT' }])
  })
})

// ── §9 / §15.3 — cross-document isolation ──────────────────────────────────

describe('Heading Reason Chip Stable Anchor V2 §9 — cross-document isolation', () => {
  it('partitions visual facts by documentKey and counts foreign facts', () => {
    const facts = [
      { documentKey: 'runtime/smoke/A.md', value: 'a1' },
      { documentKey: 'scratch/doc.md', value: 'foreign-1' },
      { documentKey: 'runtime/smoke/A.md', value: 'a2' },
      { documentKey: 'runtime/smoke/B.md', value: 'foreign-2' },
    ]
    const { current, foreign } = partitionVisualFactsByDocumentKey(facts, 'runtime/smoke/A.md')
    expect(current).toEqual(['a1', 'a2'])
    expect(foreign).toEqual(['foreign-1', 'foreign-2'])
    expect(countForeignVisualFacts(facts, 'runtime/smoke/A.md')).toBe(2)
    // with NO current document every keyed fact is foreign (nothing is "current")
    expect(countForeignVisualFacts(facts, null)).toBe(4)
  })
})

// ── §10/§11 / §15.4 — stability audit (false-PASS fix) ─────────────────────

function baseFact(overrides: Partial<HeadingReasonChipStabilityFact> = {}): HeadingReasonChipStabilityFact {
  return {
    documentKey: 'runtime/smoke/A.md',
    currentDocumentKey: 'runtime/smoke/A.md',
    diagnosticId: 'HEADING_LEVEL_GAP',
    stableHeadingIdentity: 'id:H4:idx:6',
    activeDiagnosticId: null,
    isDirtyTarget: true,
    contentFingerprintBefore: 'fp',
    contentFingerprintAfter: 'fp',
    contentChanged: false,
    targetRectBefore: line(30, 766.6, 800, 793.8),
    targetRectAfter: line(30, 766.6, 800, 793.8),
    targetMoved: false,
    textRectBefore: null,
    textRectAfter: line(30, 766.625, 110, 793.825),
    reasonChipRectBefore: null,
    reasonChipRectAfter: line(118, 770.2, 214, 790.2),
    expectedChipLeft: 118,
    expectedChipTop: 770.2,
    actualChipLeft: 118,
    actualChipTop: 770.2,
    anchorDriftPx: 0,
    verticalCenterDriftPx: 0,
    placementMode: 'INLINE_RIGHT',
    horizontalClampApplied: false,
    rebuildRequested: true,
    rebuildPerformed: true,
    rebuildReason: 'LAYOUT_EPOCH:PLUGIN_DOM_MUTATION',
    ...overrides,
  }
}

describe('Heading Reason Chip Stable Anchor V2 §10 — post-reflow closure', () => {
  it('a correctly placed chip PASSes', () => {
    const verdict = evaluateHeadingReasonChipStability(baseFact())
    expect(verdict.decision).toBe('PASS')
    expect(verdict.failedChecks).toEqual([])
  })

  it('expectedLeft=118 / actualLeft=0 is a FAIL (the exact false-PASS defect)', () => {
    const verdict = evaluateHeadingReasonChipStability(baseFact({
      reasonChipRectAfter: line(0, 797.8, 96, 817.8),
      actualChipLeft: 0,
      actualChipTop: 797.8,
      anchorDriftPx: 118,
      verticalCenterDriftPx: 27,
    }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('REASON_CHIP_LEFT_ZERO_FALLBACK')
    expect(verdict.failedChecks).toContain('REASON_CHIP_VERTICAL_FALLBACK')
    expect(verdict.failedChecks).toContain('REASON_CHIP_ANCHOR_AUTHORITY_MISMATCH')
  })

  it('a chip on the next line is a FAIL even without left=0', () => {
    const verdict = evaluateHeadingReasonChipStability(baseFact({
      reasonChipRectAfter: line(30, 797.8, 126, 817.8),
      actualChipLeft: 30,
      actualChipTop: 797.8,
      verticalCenterDriftPx: 27,
    }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('REASON_CHIP_VERTICAL_FALLBACK')
  })

  it('a non-dirty heading whose chip moved is a FAIL', () => {
    const verdict = evaluateHeadingReasonChipStability(baseFact({
      isDirtyTarget: false,
      reasonChipRectBefore: line(118, 770.2, 214, 790.2),
      reasonChipRectAfter: line(150, 770.2, 246, 790.2),
      actualChipLeft: 150,
      anchorDriftPx: 32,
    }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('NON_DIRTY_HEADING_CHIP_POSITION_CHANGED')
    expect(verdict.failedChecks).toContain('CHIP_POSITION_CHANGED_WITHOUT_CONTENT_CHANGE')
  })

  it('a chip from another document is a FAIL', () => {
    const verdict = evaluateHeadingReasonChipStability(baseFact({ documentKey: 'scratch/doc.md' }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('CROSS_DOCUMENT_REASON_CHIP')
  })
})

describe('Heading Reason Chip Stable Anchor V2 §11 — hard gates', () => {
  it('declares 15 gates, 0 on a clean surface, FAIL on any violation', () => {
    const clean = createHeadingReasonChipStabilityV2Counters()
    expect(HEADING_REASON_CHIP_STABILITY_V2_GATE_KEYS).toHaveLength(15)
    expect(formatHeadingReasonChipStabilityV2GateReport(clean)).toHaveLength(15)
    expect(evaluateHeadingReasonChipStabilityV2Gates(clean).decision).toBe('PASS')
    expect(HEADING_REASON_CHIP_STABILITY_V2_GATE_LABELS.reasonChipLeftZeroFallback)
      .toBe('HEADING_REASON_CHIP_LEFT_ZERO_FALLBACK_COUNT')
    const dirty = createHeadingReasonChipStabilityV2Counters()
    dirty.visualReflowPassWithReasonChipAnchorMismatch = 1
    expect(evaluateHeadingReasonChipStabilityV2Gates(dirty).decision).toBe('FAIL')
  })

  it('exposes the stability audit event name', () => {
    expect(HEADING_REASON_CHIP_STABILITY_V2_AUDIT_EVENT)
      .toBe('DOCUMENT-DIAGNOSTIC-HEADING-REASON-CHIP-STABILITY-AUDIT')
  })
})
