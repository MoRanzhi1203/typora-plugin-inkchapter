// @vitest-environment jsdom
/**
 * V5.13-R1 — Synthetic EOF Document-Space Visual Target.
 *
 * THE DEFECT: `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` is a `document-end`
 * diagnostic. GO_BOTTOM succeeded, but the target had `targetKind=null /
 * targetRect=null` → `fillCount=0` → `FAIL_VISUAL`: the user saw NO marker.
 *
 *   SemanticLocation(document-end) ≠ ScrollDestination(GO_BOTTOM) ≠ VisualTarget
 *
 *   TEST-END-1   the trailing-blank rule is unchanged
 *   TEST-END-2   document-end yields a synthetic target (rect != null, h >= 24)
 *   TEST-END-3   no real DOM node is required
 *   TEST-END-4   the marker is fill-only (no line / border / outline / shadow)
 *   TEST-END-5   the last content block is NEVER polluted
 *   TEST-END-6   Typora native bottom padding is never the semantic region
 *   TEST-END-7   post-scroll geometry is used (no stale pre-scroll rect)
 *   TEST-END-8   Drawer stays requested-open through the commit
 *   TEST-END-9   removing the blank lines removes the marker
 *   TEST-END-10/11/12  the EOF rule matrix (1 extra / 0 extra / CRLF)
 *   TEST-END-13  an extreme blank count is height-clamped
 *   TEST-END-14  a post-commit scroll never repaints
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { computeDocumentDiagnostics, computeEofNewlinePolicy } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import {
  DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT,
  DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY,
  DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS,
  DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS,
  DOCUMENT_END_VISUAL_AUDIT_EVENT,
  DOCUMENT_END_VISUAL_TARGET_KIND,
  DOCUMENT_END_VISUAL_V513R1_GATE_KEYS,
  DOCUMENT_END_VISUAL_V513R1_GATE_LABELS,
  DOCUMENT_END_VISUAL_V513R2_GATE_KEYS,
  DOCUMENT_END_VISUAL_V513R2_GATE_LABELS,
  DOCUMENT_TEXT_COLUMN_SOURCE,
  EOF_ACCENT_WIDTH_PX,
  EOF_FILL_EMPHASIS_CLASS_LOW,
  EOF_GEOMETRY_SOURCE_LAST_MEANINGFUL_BLOCK,
  EOF_MARKER_KIND_DOCUMENT_END_WARNING,
  EOF_PRESENTATION_HEIGHT_SOURCE_EXCESSIVE_BLANK_ZONE,
  EOF_REQUIRED_TRAILING_BLANK_LINE_COUNT,
  EOF_VISIBLE_HEIGHT_RATIO_MIN,
  EOF_VISUAL_MIN_HEIGHT_PX,
  DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS,
  DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_LABELS,
  DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS,
  DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_LABELS,
  STRICT_MULTI_H1_VISUAL_AUDIT_EVENT,
  STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS,
  STRICT_MULTI_H1_VISUAL_V513R5_GATE_LABELS,
  createStrictMultiH1VisualV513R5Counters,
  evaluateStrictMultiH1VisualV513R5Gates,
  formatStrictMultiH1VisualV513R5GateReport,
  computeEofPresentationHeight,
  computeExcessZoneCoverage,
  computeSyntheticEofGeometry,
  countPaintedExcessBlankLines,
  createDocumentEndExcessCoverageV513R4Counters,
  createDocumentEndRealGeometryV513R5Counters,
  createDocumentEndTextColumnV513R3Counters,
  createDocumentEndVisualV513R1Counters,
  createDocumentEndVisualV513R2Counters,
  evaluateDocumentEndExcessCoverageV513R4Gates,
  evaluateDocumentEndRealGeometryV513R5Gates,
  evaluateDocumentEndTextColumnV513R3Gates,
  evaluateDocumentEndVisualV513R1Gates,
  evaluateDocumentEndVisualV513R2Gates,
  evaluateEofExcessCoverage,
  formatDocumentEndExcessCoverageV513R4GateReport,
  formatDocumentEndRealGeometryV513R5GateReport,
  isForbiddenBlankLineHeightSource,
  formatDocumentEndTextColumnV513R3GateReport,
  formatDocumentEndVisualV513R1GateReport,
  formatDocumentEndVisualV513R2GateReport,
  isDocumentEndTrailingBlankDiagnostic,
  isDrawerRightEdgeAuthority,
  isFalseNativePaddingCoverage,
  isSurfaceLeftAccentOnly,
  isTextColumnCandidate,
  isTextColumnDriftWithinTolerance,
  pickDocumentTextColumnLeft,
  presentationVisibleHeightRatio,
  readExtraTrailingBlankLineCount,
} from './document-diagnostic-document-end-visual-v513-r1'
import { LOCATE_DOCUMENT_LAYER_CLASS } from './document-locate-document-space-v5-11'
import { VISUAL_CLOSURE_AUDIT_EVENT } from './document-diagnostic-visual-closure-v512-r2'

// ── rAF harness ────────────────────────────────────────────────────────────
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { rafTasks.delete(id) }
}

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudits(spy: InfoSpy, event: string): Array<Record<string, string>> {
  return spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes(event))
    .map(line => {
      const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
      const out: Record<string, string> = {}
      for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
      return out
    })
}

// ── the EOF rule is unchanged (TEST-END-1 / 10 / 11 / 12) ──────────────────

function inputOf(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
  }
}

describe('TEST-END-1/10/11/12 — the trailing-blank detection rule is NOT regressed', () => {
  it('TEST-END-1: 6 terminal newlines → extra=5 → DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE (warning / document-end)', () => {
    const markdown = 'content\n\n\n\n\n\n'
    const policy = computeEofNewlinePolicy(markdown)
    expect(policy.terminalNewlineCount).toBe(6)
    expect(policy.extraTrailingBlankLineCount).toBe(5)
    expect(policy.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
    const diag = computeDocumentDiagnostics(inputOf(markdown)).diagnostics
      .find(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')
    expect(diag).toBeTruthy()
    expect(diag!.severity).toBe('warning')
    expect(diag!.location).toEqual({ kind: 'document-end' })
    expect(readExtraTrailingBlankLineCount(diag!.metadata)).toBe(5)
    expect(isDocumentEndTrailingBlankDiagnostic({
      code: diag!.code, locationKind: 'document-end', extraTrailingBlankLineCount: 5,
    })).toBe(true)
  })

  it('TEST-END-10: exactly 1 trailing blank line → no diagnostic and no marker predicate', () => {
    const policy = computeEofNewlinePolicy('a\n\n')
    expect(policy.verdict).toBe('PASS')
    expect(policy.extraTrailingBlankLineCount).toBe(1)
    expect(computeDocumentDiagnostics(inputOf('a\n\n')).diagnostics
      .some(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    expect(isDocumentEndTrailingBlankDiagnostic({ code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', locationKind: 'document-end', extraTrailingBlankLineCount: 1 })).toBe(false)
  })

  it('TEST-END-11: 0 extra blank lines → the MISSING_TERMINAL_NEWLINE rule is untouched', () => {
    expect(computeEofNewlinePolicy('a').verdict).toBe('MISSING_TERMINAL_NEWLINE')
    expect(computeDocumentDiagnostics(inputOf('a')).diagnostics
      .some(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(true)
    // A missing-terminal-newline document-end warning must NEVER get a blank marker.
    expect(isDocumentEndTrailingBlankDiagnostic({ code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', locationKind: 'document-end', extraTrailingBlankLineCount: 3 })).toBe(false)
  })

  it('TEST-END-12: CRLF is counted identically', () => {
    const policy = computeEofNewlinePolicy('content\r\n\r\n\r\n\r\n\r\n\r\n')
    expect(policy.extraTrailingBlankLineCount).toBe(5)
    expect(policy.verdict).toBe('EXCESSIVE_TRAILING_BLANK_LINES')
  })
})

// ── synthetic EOF geometry contract (TEST-END-2 / 6 / 13) ──────────────────

describe('TEST-END-2/6/13 — synthetic EOF geometry (V5.13-R5 real trailing blank geometry)', () => {
  const base = {
    documentIsNonEmpty: true,
    lastMeaningfulRect: { left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 },
    trailingBlankRects: [] as Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>,
    meaningfulRects: [{ left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 }],
    contentBoundsRect: { left: 50, top: 0, right: 850, bottom: 1200, width: 800, height: 1200 },
    editorContentRect: { left: 0, top: 0, right: 900, bottom: 1400, width: 900, height: 1400 },
    blankLineHeight: 24,
    blankLineHeightSource: 'EDITOR_BASE_LINE_HEIGHT',
  }
  const blank = (i: number) => ({ left: 60, top: 1048 + i * 24, right: 700, bottom: 1072 + i * 24, width: 640, height: 24 })

  it('TEST-END-2 / R5: the band spans the REAL excessive blank zone (never extra × lineHeight)', () => {
    const blanks = [0, 1, 2, 3, 4].map(blank)
    const geo = computeSyntheticEofGeometry({ ...base, trailingBlankRects: blanks, extraTrailingBlankLineCount: 5 })
    expect(geo.rect).not.toBeNull()
    // §9 — the REQUIRED zone is the legal 1st real blank line (never painted).
    expect(geo.requiredBlankZoneRect!.top).toBe(1024)
    expect(geo.requiredBlankZoneRect!.bottom).toBe(1072)
    // §6/§8 — the excessive zone is the MEASURED DOM tail, not a simulated one.
    expect(geo.geometrySource).toBe('ACTUAL_TRAILING_DOM_BLANK_ZONE')
    expect(geo.presentationHeightSource).toBe('ACTUAL_TRAILING_BLANK_GEOMETRY')
    expect(geo.presentationHeightSource).not.toBe('EXTRA_COUNT_X_LINE_HEIGHT')
    expect(geo.excessiveBlankZoneRect!.top).toBe(1072 + 6)
    expect(geo.excessiveBlankZoneRect!.bottom).toBe(blanks[4].bottom)
    expect(geo.rect!.height).toBe(blanks[4].bottom - (1072 + 6))
    // §3/§35 — the forbidden formula would be 5 × 24 = 120; the REAL zone is not.
    expect(geo.presentationHeight).not.toBe(5 * 24)
    // §10 HARD — the band never rises above the last meaningful bottom.
    expect(geo.rect!.top).toBeGreaterThanOrEqual(base.lastMeaningfulRect.bottom)
    expect(geo.presentationTopMinusLastMeaningfulBottom).toBeGreaterThan(0)
    // §15 — no meaningful content is ever intersected.
    expect(geo.meaningfulIntersectionCount).toBe(0)
    expect(geo.meaningfulIntersectionArea).toBe(0)
    expect(geo.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    expect(geo.excessiveTrailingBlankLineCount).toBe(5)
    expect(geo.requiredTrailingBlankLineCount).toBe(EOF_REQUIRED_TRAILING_BLANK_LINE_COUNT)
    expect(geo.semanticZoneRect!.top).toBe(geo.rect!.top)
    expect(geo.rect!.width).toBe(geo.rect!.right - geo.rect!.left)
    expect(geo.rect!.height).toBe(geo.rect!.bottom - geo.rect!.top)
  })

  it('TEST-END-6: a 2-blank band never becomes the whole native bottom padding', () => {
    const geo = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [blank(0), blank(1)], extraTrailingBlankLineCount: 2 })
    expect(geo.geometrySource).toBe('ACTUAL_TRAILING_DOM_BLANK_ZONE')
    expect(geo.rect!.height).not.toBe(base.editorContentRect.height)
    expect(isFalseNativePaddingCoverage({
      syntheticHeight: geo.rect!.height,
      editorContentHeight: base.editorContentRect.height,
      semanticBlankCount: 2,
      lineHeight: 24,
    })).toBe(false)
    // A regression that paints the whole editor column AS the error region is caught.
    expect(isFalseNativePaddingCoverage({
      syntheticHeight: base.editorContentRect.height,
      editorContentHeight: base.editorContentRect.height,
      semanticBlankCount: 2,
      lineHeight: 24,
    })).toBe(true)
    // The right edge is the content edge — never the Drawer edge.
    expect(isDrawerRightEdgeAuthority({ syntheticRight: 850, drawerLeft: 850, semanticContentRight: 850 })).toBe(false)
    expect(isDrawerRightEdgeAuthority({ syntheticRight: 850, drawerLeft: 850, semanticContentRight: 700 })).toBe(true)
  })

  it('TEST-END-13 / R5 §8: 50 SOURCE blank lines with a COLLAPSED DOM tail never simulate a giant zone', () => {
    const geo = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [], extraTrailingBlankLineCount: 50 })
    expect(geo.geometrySource).toBe('COMPACT_SAFE_FALLBACK')
    // never `50 × 24 = 1200px` — a collapsed DOM tail yields a bounded marker
    expect(geo.presentationHeight).toBeLessThan(100)
    expect(geo.presentationHeight).not.toBe(50 * 24)
    expect(geo.rect!.top).toBeGreaterThanOrEqual(base.lastMeaningfulRect.bottom)
  })

  it('R5: the band is never viewport-clamped off the excessive zone (R4 continuity)', () => {
    const geo = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [blank(0)], extraTrailingBlankLineCount: 2 })
    expect(geo.viewportClamped).toBe(false)
    expect(geo.rect!.top).toBe(geo.excessiveBlankZoneRect!.top)
    // ratio metric: a fully-visible band is 1.0; a non-visible band is 0.0
    expect(presentationVisibleHeightRatio(
      { left: 0, top: 0, right: 900, bottom: 120, width: 900, height: 120 }, base.editorContentRect,
    )).toBe(1)
    expect(presentationVisibleHeightRatio(
      { left: 0, top: 1500, right: 900, bottom: 1560, width: 900, height: 60 }, base.editorContentRect,
    )).toBe(0)
  })

  it('R5 §5 — a NON-empty document with no resolvable last content FAILS CLOSED', () => {
    const failClosed = computeSyntheticEofGeometry({ ...base, lastMeaningfulRect: null, extraTrailingBlankLineCount: 29 })
    expect(failClosed.rect).toBeNull() // never a huge fallback zone
    expect(failClosed.failClosed).toBe(true)
    const emptyDoc = computeSyntheticEofGeometry({
      ...base, documentIsNonEmpty: false, lastMeaningfulRect: null, editorContentRect: null, extraTrailingBlankLineCount: 3,
    })
    expect(emptyDoc.rect).toBeNull()
    expect(emptyDoc.failClosed).toBe(false)
  })

  // ── V5.13-R5 §14 — the EOF targeted matrix ────────────────────────────────

  it('EOF-R5-01/11 — 29 extra blanks never cover any heading / paragraph', () => {
    const heading = { left: 60, top: 100, right: 700, bottom: 148, width: 640, height: 48 }
    const para = { left: 60, top: 160, right: 700, bottom: 208, width: 640, height: 48 }
    const last = base.lastMeaningfulRect
    const geo = computeSyntheticEofGeometry({
      ...base, trailingBlankRects: [blank(0)], meaningfulRects: [heading, para, last],
      extraTrailingBlankLineCount: 29,
    })
    expect(geo.rect!.top).toBeGreaterThanOrEqual(last.bottom)
    expect(geo.meaningfulIntersectionCount).toBe(0)
    expect(geo.meaningfulIntersectionArea).toBe(0)
    // the DETECTOR really fires when a meaningful rect WOULD be intersected
    const broken = computeSyntheticEofGeometry({
      ...base, trailingBlankRects: [blank(0)],
      meaningfulRects: [{ left: 60, top: 1040, right: 700, bottom: 1090, width: 640, height: 50 }],
      extraTrailingBlankLineCount: 29,
    })
    expect(broken.meaningfulIntersectionCount).toBeGreaterThan(0)
    expect(broken.meaningfulIntersectionArea).toBeGreaterThan(0)
  })

  it('EOF-R5-02..07 — the last meaningful block shape never changes the safety rule', () => {
    const shapes = [
      { name: 'heading', rect: { left: 60, top: 980, right: 700, bottom: 1032, width: 640, height: 52 } },
      { name: 'paragraph', rect: { left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 } },
      { name: 'table', rect: { left: 60, top: 900, right: 800, bottom: 1010, width: 740, height: 110 } },
      { name: 'code', rect: { left: 60, top: 940, right: 780, bottom: 1020, width: 720, height: 80 } },
      { name: 'list', rect: { left: 80, top: 990, right: 700, bottom: 1030, width: 620, height: 40 } },
      { name: 'blockquote', rect: { left: 80, top: 970, right: 700, bottom: 1026, width: 620, height: 56 } },
    ]
    for (const { name, rect } of shapes) {
      const geo = computeSyntheticEofGeometry({
        ...base, lastMeaningfulRect: rect, trailingBlankRects: [blank(0)], meaningfulRects: [rect],
        extraTrailingBlankLineCount: 29,
      })
      expect(geo.rect, name).not.toBeNull()
      expect(geo.rect!.top, name).toBeGreaterThanOrEqual(rect.bottom)
      expect(geo.meaningfulIntersectionCount, name).toBe(0)
      expect(geo.lastMeaningfulRect!.bottom, name).toBe(rect.bottom)
    }
  })

  it('EOF-R5-08/09/10 — 0 / 1 / 2 real trailing blanks map to the honest geometry source', () => {
    const none = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [], extraTrailingBlankLineCount: 0 })
    expect(none.geometrySource).toBe('COMPACT_SAFE_FALLBACK')
    const one = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [blank(0)], extraTrailingBlankLineCount: 2 })
    expect(one.geometrySource).toBe('EDITOR_TAIL_SPACE')
    const two = computeSyntheticEofGeometry({ ...base, trailingBlankRects: [blank(0), blank(1)], extraTrailingBlankLineCount: 3 })
    expect(two.geometrySource).toBe('ACTUAL_TRAILING_DOM_BLANK_ZONE')
    for (const geo of [none, one, two]) {
      expect(geo.rect!.top).toBeGreaterThanOrEqual(base.lastMeaningfulRect.bottom)
      expect(geo.meaningfulIntersectionCount).toBe(0)
    }
    // the degenerate MIN guard is still honoured
    expect(computeEofPresentationHeight(0, 24)).toBe(EOF_VISUAL_MIN_HEIGHT_PX)
  })

  it('R5 §11 — a heading-derived line-height source is a REAL violation', () => {
    expect(isForbiddenBlankLineHeightSource('EDITOR_BASE_LINE_HEIGHT')).toBe(false)
    expect(isForbiddenBlankLineHeightSource('ACTUAL_BLANK_NODE_GEOMETRY')).toBe(false)
    expect(isForbiddenBlankLineHeightSource('NONE')).toBe(false)
    expect(isForbiddenBlankLineHeightSource('H1_LINE_HEIGHT')).toBe(true)
    expect(isForbiddenBlankLineHeightSource('HEADING_LINE_HEIGHT')).toBe(true)
    expect(isForbiddenBlankLineHeightSource('LAST_MEANINGFUL_BLOCK_LINE_HEIGHT')).toBe(true)
  })

  it('R5 §15 — the 8 real-geometry gate keys are complete and 0 ⇒ PASS', () => {
    expect(DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS).toHaveLength(8)
    expect(Object.keys(DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_LABELS)).toHaveLength(8)
    const counters = createDocumentEndRealGeometryV513R5Counters()
    expect(evaluateDocumentEndRealGeometryV513R5Gates(counters).decision).toBe('PASS')
    const report = formatDocumentEndRealGeometryV513R5GateReport(counters)
    for (const label of [
      'DOCUMENT_END_LAST_MEANINGFUL_RECT_NULL_ON_NONEMPTY_COUNT',
      'DOCUMENT_END_FILL_INTERSECTS_MEANINGFUL_CONTENT_COUNT',
      'DOCUMENT_END_ZONE_TOP_BEFORE_LAST_MEANINGFUL_BOTTOM_COUNT',
      'DOCUMENT_END_BLANK_LINE_HEIGHT_FROM_HEADING_COUNT',
      'DOCUMENT_END_SYNTHETIC_BACK_PROJECTION_INTO_CONTENT_COUNT',
      'DOCUMENT_END_PRESENTATION_FROM_EXTRA_COUNT_X_GUESSED_LINE_HEIGHT_COUNT',
      'DOCUMENT_END_MEANINGFUL_INTERSECTION_AREA_GT_0_COUNT',
      'EOF_FILL_INTERSECTS_HEADING_MARKER_TARGET_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    counters.fillIntersectsMeaningfulContent = 1
    expect(evaluateDocumentEndRealGeometryV513R5Gates(counters).failedChecks).toEqual(['fillIntersectsMeaningfulContent'])
  })
})

// ── the 19 hard gates (pure) ──────────────────────────────────────────────

describe('TEST-END-4 (contract) — 19 + 15 hard gates + fill-only label set', () => {
  it('the gate key/label set is complete and 0 ⇒ PASS, 1 ⇒ FAIL', () => {
    expect(DOCUMENT_END_VISUAL_V513R1_GATE_KEYS).toHaveLength(19)
    expect(Object.keys(DOCUMENT_END_VISUAL_V513R1_GATE_LABELS)).toHaveLength(19)
    const counters = createDocumentEndVisualV513R1Counters()
    expect(evaluateDocumentEndVisualV513R1Gates(counters).decision).toBe('PASS')
    expect(formatDocumentEndVisualV513R1GateReport(counters)).toContain('DOCUMENT_END_VERTICAL_LINE_COUNT=0')
    counters.verticalLine = 1
    const failed = evaluateDocumentEndVisualV513R1Gates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failedChecks).toEqual(['verticalLine'])
  })

  it('R2 §9: the 14 refinement gates (semantic/presentation/drawer/closure/facts)', () => {
    // V5.13-R4 §8 — `presentationHeightGt48px` was ABOLISHED (15 → 14).
    expect(DOCUMENT_END_VISUAL_V513R2_GATE_KEYS).toHaveLength(14)
    expect(Object.keys(DOCUMENT_END_VISUAL_V513R2_GATE_LABELS)).toHaveLength(14)
    const counters = createDocumentEndVisualV513R2Counters()
    expect(evaluateDocumentEndVisualV513R2Gates(counters).decision).toBe('PASS')
    const report = formatDocumentEndVisualV513R2GateReport(counters)
    for (const label of [
      'DOCUMENT_END_SEMANTIC_RIGHT_FROM_DRAWER_COUNT',
      'DOCUMENT_END_PRESENTATION_RIGHT_FROM_DRAWER_COUNT',
      'DOCUMENT_END_PRESENTATION_VISIBLE_HEIGHT_RATIO_LT_0_90_COUNT',
      'DOCUMENT_END_PANEL_GEOMETRY_CLIP_COUNT',
      'DOCUMENT_END_VISUAL_PAINTS_ABOVE_DRAWER_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_TARGET_NULL_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_SEVERITY_MISMATCH_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_VISUAL_DECISION_NA_COUNT',
      'DOCUMENT_END_GENERIC_CLOSURE_COMMIT_DECISION_NA_COUNT',
      'DOCUMENT_END_TERMINAL_NEWLINE_FACT_NULL_COUNT',
      'DOCUMENT_END_SOURCE_REVISION_NULL_COUNT',
      'DOCUMENT_END_SCROLL_SETTLED_WITHOUT_REMEASURE_COUNT',
      'DOCUMENT_END_STALE_LAYOUT_EPOCH_COMMIT_COUNT',
      'DOCUMENT_END_SECOND_CLICK_REQUIRED_COUNT',
    ]) {
      expect(report).toContain(`${label}=0`)
    }
    counters.panelGeometryClip = 1
    expect(evaluateDocumentEndVisualV513R2Gates(counters).failedChecks).toEqual(['panelGeometryClip'])
  })
})

// ── host: synthetic EOF target commit (TEST-END-3/4/5/7/8/9/14) ────────────

let infoSpy: InfoSpy | null = null
let hosts: DocumentUtilityOverlayHost[] = []

type Internals = {
  commitSyntheticEofVisual(
    tx: unknown,
    diag: Record<string, unknown>,
    extraTrailingBlankLineCount: number,
    remeasuredAfterScroll: boolean,
  ): boolean
  clearDiagnosticLocateVisual(reason: string): void
  getPostCommitUserScrollCount(): number
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: 'doc.md' }),
      getActiveFilePath: () => 'doc.md',
      getDocumentKey: () => 'doc:eof',
      getMarkdown: () => 'content\n\n\n\n\n\n',
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

interface World {
  h: DocumentUtilityOverlayHost
  shell: HTMLElement
  write: HTMLElement
  last: HTMLElement
  diagnostics: Record<string, unknown> | null
}

function makeWorld(): World {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 700 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const last = document.createElement('p')
  last.setAttribute('data-line', '10')
  last.textContent = '最后一段正文'
  write.appendChild(last)
  stubRect(last, () => ({ left: 60, top: 1000, right: 700, bottom: 1024 }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  const world: World = { h, shell, write, last, diagnostics: null }
  return world
}

function trailingBlankDiag(extra: number, severity = 'warning'): Record<string, unknown> {
  return {
    id: `document:DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE:${extra}`,
    documentKey: 'doc:eof',
    severity,
    category: 'document',
    code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
    message: '警告：文档末尾存在过多空行',
    detail: '',
    metadata: { ruleId: 'DOCUMENT-TRAILING-BLANK-LINES-EXCESSIVE', reason: 'EXCESSIVE_TRAILING_BLANK_LINES', terminalNewlineCount: extra + 1, extraTrailingBlankLineCount: extra },
    location: { kind: 'document-end' },
  }
}

function injectSnapshot(world: World, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:eof', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 1, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (world.h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(world.h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

const fakeTx = (): Record<string, unknown> => ({
  id: 1, documentKey: 'doc:eof', diagnosticId: 'D1', targetIndex: 0, targetCount: 1,
  startedAt: 0, state: 'PRESENTING',
})

const eofCarriers = (): number => document.querySelectorAll('[data-ink-eof-marker="true"]').length

beforeEach(() => {
  document.body.innerHTML = ''
  hosts = []
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  // jsdom applies no stylesheet: double the browser-only computed-style probe with
  // a REALISTIC fill-only warning carrier (the measurement code IS under test).
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string) => {
    if (pseudo != null) return { content: 'none' } as unknown as CSSStyleDeclaration
    const isEofBand = el.getAttribute?.('data-ink-eof-marker') === 'true'
    const accent = (el as HTMLElement & { __eofAccentPx?: number }).__eofAccentPx ?? 4
    return {
      lineHeight: '24px',
      backgroundColor: 'rgba(168, 121, 50, 0.08)',
      backgroundImage: 'none',
      boxShadow: 'none',
      outlineStyle: 'none',
      outlineWidth: '0px',
      // V5.13-R3 §9/§19 — the EOF band carries a LEFT-ONLY surface accent.
      borderLeftWidth: isEofBand ? `${accent}px` : '0px',
      borderLeftStyle: isEofBand ? 'solid' : 'none',
      borderTopStyle: 'none',
      borderRightStyle: 'none',
      borderBottomStyle: 'none',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
    } as unknown as CSSStyleDeclaration
  }) as unknown as typeof window.getComputedStyle)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  for (const h of hosts) { try { h.dispose() } catch { /* noop */ } }
  hosts = []
  infoSpy?.mockRestore()
  infoSpy = null
  vi.unstubAllGlobals()
})

describe('TEST-END-3/4/5/7/8/9/14 — the host commits a synthetic EOF marker without a DOM target', () => {
  it('TEST-END-3/4: a document-end locate with NO DOM node still paints a fill-only document-space marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(ok).toBe(true)
    // §3/§7 — mounted in the DOCUMENT-SPACE layer, never viewport-fixed.
    const layer = world.write.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS}`)
    expect(layer).not.toBeNull()
    const marker = layer!.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    expect(marker).not.toBeNull()
    expect(marker.getAttribute('data-coordinate-space')).toBe('HOST_LOCAL_DOCUMENT_SPACE')
    expect(marker.getAttribute('data-severity')).toBe('warning')
    // §9 — fill-only: no line / border / outline / keyline / corner arm / shadow.
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(audit.semanticAnchorIdentity).toBe(DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY)
    expect(Number(audit.fillCount)).toBeGreaterThanOrEqual(1)
    expect(audit.finalDecision).toBe('PASS')
    // every document-end hard gate is 0
    for (const key of DOCUMENT_END_VISUAL_V513R1_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualGateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R1_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndVisualGateDecision().decision).toBe('PASS')
  })

  it('TEST-END-5: the last meaningful content block class/style is NEVER touched', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(3)
    injectSnapshot(world, [diag])
    const before = world.last.getAttribute('style')
    const beforeClass = world.last.className
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 3, true)
    expect(world.last.getAttribute('style')).toBe(before)
    expect(world.last.className).toBe(beforeClass)
    expect(world.last.querySelector('[data-ink-eof-marker="true"]')).toBeNull()
    // the marker is an overlay sibling, not a child of the content block
    expect(world.write.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(1)
  })

  it('TEST-END-7: the geometry is built from the POST-scroll measurement (stale pre-scroll rect is refused)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(4)
    injectSnapshot(world, [diag])
    // pre-scroll the last block sits far above; post-scroll it is at the bottom.
    let blockTop = 100
    stubRect(world.last, () => ({ left: 60, top: blockTop, right: 700, bottom: blockTop + 24 }))
    const internals = world.h as unknown as Internals
    // A tall editor: the post-scroll band still fits inside the visible editor, so
    // the §5 viewport clamp must NOT move it (otherwise it is a real fallback).
    stubRect(world.shell, () => ({ left: 0, top: 0, right: 900, bottom: 1400 }))
    const okPre = internals.commitSyntheticEofVisual(fakeTx(), diag, 4, false)
    // passing `remeasuredAfterScroll=false` is recorded as a violation, never silently accepted
    expect(world.h.getDocumentEndVisualCounters().missingRemeasureAfterScroll).toBe(1)
    expect(okPre).toBe(true)
    blockTop = 900 // the post-scroll position
    const ok = internals.commitSyntheticEofVisual(fakeTx(), diag, 4, true)
    expect(ok).toBe(true)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.remeasuredAfterScroll).toBe('true')
    expect(Number(audit.syntheticRect ? String(audit.syntheticRect).length : 0)).toBeGreaterThan(0)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    // local top = viewport top − host top; the host top is 0 here, and the marker
    // must follow the LAST block (+ the legal blank line + gap), proving the fresh
    // post-scroll rect was used.
    expect(marker.style.top).toBe('954px')
  })

  it('TEST-END-8/9: Drawer stays requested-open; clearing the visual removes the marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(eofCarriers()).toBe(1)
    const requestedOpen = (world.h as unknown as { isDrawerRequestedOpen?: () => boolean }).isDrawerRequestedOpen?.()
    expect(requestedOpen ?? true).toBe(true)
    // §10 — the diagnostic disappears (blank lines deleted) → the marker must go.
    ;(world.h as unknown as Internals).clearDiagnosticLocateVisual('ACTIVE_DIAGNOSTIC_REMOVED')
    expect(eofCarriers()).toBe(0)
  })

  it('TEST-END-14: a post-commit scroll never repaints / remeasures the marker', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    const styleBefore = marker.style.cssText
    world.shell.scrollTop = 200
    world.shell.dispatchEvent(new Event('scroll'))
    // The scroll IS observed and audited (observability counter), but the
    // document-space marker is never repainted / remeasured / re-written.
    expect((world.h as unknown as Internals).getPostCommitUserScrollCount()).toBe(1)
    const closure = world.h.getVisualClosureCounters()
    expect(closure.postCommitScrollRepaint).toBe(0)
    expect(closure.postCommitScrollRemeasure).toBe(0)
    expect(closure.postCommitScrollReresolve).toBe(0)
    expect(closure.postCommitScrollRecenter).toBe(0)
    expect(closure.postCommitScrollWrite).toBe(0)
    expect(world.h.getDocumentSpaceCounters().documentSpaceOverlayScrollDrift).toBe(0)
    expect((document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement).style.cssText).toBe(styleBefore)
  })
})

// ── V5.13-R2 — semantic zone / band / drawer overlay / generic closure ─────

describe('V5.13-R2 — EOF Soft Band geometry, facts and unified closure', () => {
  it('the band is compact, spans the DOCUMENT CONTENT column and carries REAL facts', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(ok).toBe(true)
    const facts = world.h.getLastDocumentEndVisualFacts()!
    // V5.13-R5 §3/§8 — this world has NO real trailing blank nodes, so the zone is
    // the bounded COMPACT_SAFE_FALLBACK (never the forbidden `5 × 24 = 120`).
    expect(facts.presentationHeight).toBe(EOF_VISUAL_MIN_HEIGHT_PX)
    expect(facts.presentationHeight).toBeLessThan(5 * 24)
    expect(facts.presentationHeightSource).toBe('ACTUAL_TRAILING_BLANK_GEOMETRY')
    expect(facts.excessiveTrailingBlankLineCount).toBe(5)
    expect(facts.excessiveCoverageRatio).toBe(1)
    expect(facts.requiredBlankPainted).toBe(false)
    expect(facts.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    // §7 — the rule-scan facts flow through (never null)
    expect(audit.sourceRevision).toBe('1')
    expect(audit.terminalNewlineCount).toBe('6')
    expect(audit.extraTrailingBlankLineCount).toBe('5')
    expect(audit.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    expect(audit.presentationHeight).toBe(String(EOF_VISUAL_MIN_HEIGHT_PX))
    expect(audit.presentationHeightSource).toBe('ACTUAL_TRAILING_BLANK_GEOMETRY')
    expect(audit.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(audit.finalDecision).toBe('PASS')
    expect(audit.expectedPanelOcclusion).toBe('false')
    expect(audit.panelGeometryClipCount).toBe('0')
    expect(audit.paintAboveDrawerCount).toBe('0')
    for (const key of DOCUMENT_END_VISUAL_V513R1_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualGateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R1_GATE_LABELS[key]}=0`)
    }
    for (const key of DOCUMENT_END_VISUAL_V513R2_GATE_KEYS) {
      expect(world.h.getDocumentEndVisualV513R2GateReport()).toContain(`${DOCUMENT_END_VISUAL_V513R2_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndVisualV513R2GateDecision().decision).toBe('PASS')
  })

  it('the band X is the TEXT COLUMN (left) + DOCUMENT CONTENT (right) — never the Drawer left edge', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    // §2.2/§8 — right = content column right (viewport 850 → local 800);
    // §3/§4 — left = the TOP-LEVEL PROSE column (the <p> at viewport 60 → local 10),
    // NOT the write outer left (viewport 50) and NOT the table/indent.
    expect(Number.parseFloat(marker.style.left)).toBe(10)
    expect(Number.parseFloat(marker.style.width)).toBe(790)
    expect(Number.parseFloat(marker.style.left) + Number.parseFloat(marker.style.width)).toBe(800)
    expect(marker.getAttribute('data-ink-marker-kind')).toBe('document-end-warning')
    const report = world.h.getDocumentEndVisualV513R2GateReport()
    expect(report).toContain('DOCUMENT_END_PRESENTATION_RIGHT_FROM_DRAWER_COUNT=0')
    expect(report).toContain('DOCUMENT_END_SEMANTIC_RIGHT_FROM_DRAWER_COUNT=0')
    expect(report).toContain('DOCUMENT_END_PANEL_GEOMETRY_CLIP_COUNT=0')
  })

  it('§6 — the GENERIC closure audit carries the same EOF facts (never NA/null)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const closure = readAudits(infoSpy!, VISUAL_CLOSURE_AUDIT_EVENT).pop()!
    expect(closure.severity).toBe('warning')
    expect(closure.visualTargetKind).toBe(DOCUMENT_END_VISUAL_TARGET_KIND)
    expect(closure.semanticAnchorIdentity).toBe(DOCUMENT_END_SEMANTIC_ANCHOR_IDENTITY)
    expect(closure.visualFragmentCount).toBe('1')
    expect(closure.visualDecision).toBe('PASS')
    expect(closure.commitDecision).toBe('COMMIT')
    expect(closure.terminalState).toBe('COMMITTED')
    expect(closure.sourceRevision).toBe('1')
    expect(closure.terminalNewlineCount).toBe('6')
    expect(closure.extraTrailingBlankLineCount).toBe('5')
    expect(closure.rightEdgeAuthority).toBe(DOCUMENT_END_RIGHT_EDGE_AUTHORITY_DOCUMENT_CONTENT)
    expect(closure.decision).toBe('PASS')
  })

  it('§3 — the band is structurally BELOW the Drawer overlay (never paints above it)', () => {
    const world = makeWorld()
    const diag = trailingBlankDiag(5)
    injectSnapshot(world, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const layer = document.querySelector(`.${LOCATE_DOCUMENT_LAYER_CLASS}`)!
    const overlayRoot = document.querySelector('[data-inkchapter-utility-root="true"]')!
    expect(overlayRoot).not.toBeNull()
    expect(overlayRoot.contains(layer)).toBe(false)
    // §2.3 — the visible-intersection facts never feed back into the band geometry
    expect(world.h.getDocumentEndVisualV513R2GateReport())
      .toContain('DOCUMENT_END_VISUAL_PAINTS_ABOVE_DRAWER_COUNT=0')
  })
})

// ── V5.13-R3 — Document text-column anchor + EOF left accent ───────────────

type LastBlockKind = 'paragraph' | 'indented' | 'list' | 'quote' | 'code' | 'table'

/** §14 — same document text column, different LAST block shapes. */
function addLastBlock(write: HTMLElement, kind: LastBlockKind): void {
  let el: HTMLElement
  if (kind === 'list') {
    const ul = document.createElement('ul')
    const li = document.createElement('li')
    li.textContent = '列表项'
    ul.appendChild(li)
    el = ul
  } else if (kind === 'quote') {
    const bq = document.createElement('blockquote')
    const p = document.createElement('p')
    p.textContent = '引用文字'
    bq.appendChild(p)
    el = bq
  } else if (kind === 'code') {
    el = document.createElement('pre')
    el.textContent = 'code line'
  } else if (kind === 'table') {
    const t = document.createElement('table')
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.textContent = 'cell'
    tr.appendChild(td)
    t.appendChild(tr)
    el = t
  } else {
    el = document.createElement('p')
    el.textContent = kind === 'indented' ? '缩进段落' : '末段'
  }
  write.appendChild(el)
  const left = kind === 'paragraph' ? 60 : kind === 'indented' ? 120 : 80
  stubRect(el, () => ({ left, top: 1000, right: left + 300, bottom: 1040 }))
}

/** §14 — a world whose PROSE column is fixed at 60 while the last block varies. */
function makeAnchorWorld(kind: LastBlockKind): { h: DocumentUtilityOverlayHost; prose: HTMLElement } {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1400 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const prose = document.createElement('p')
  prose.textContent = '普通正文段落'
  write.appendChild(prose)
  stubRect(prose, () => ({ left: 60, top: 100, right: 700, bottom: 124 }))
  addLastBlock(write, kind)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  hosts.push(h)
  return { h, prose }
}

const EOF_LOCAL_LEFT = 10 // 60 (prose column) − 50 (write host origin)

describe('V5.13-R3 §5/§6 — pickDocumentTextColumnLeft / candidate filtering (pure)', () => {
  it('priority: editor column → top-level prose MIN → cached → content fallback', () => {
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: 42, topLevelProseLefts: [60, 200], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 42, source: DOCUMENT_TEXT_COLUMN_SOURCE.EDITOR_TEXT_COLUMN })
    // §4 — the LEAST-indented prose wins: a deeply indented later block cannot drag it
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [60, 200, 320], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 60, source: DOCUMENT_TEXT_COLUMN_SOURCE.TOP_LEVEL_PROSE })
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [], cachedLeft: 33, contentLeft: 10,
    })).toEqual({ left: 33, source: DOCUMENT_TEXT_COLUMN_SOURCE.STABLE_CACHED_PROSE })
    expect(pickDocumentTextColumnLeft({
      editorTextColumnLeft: null, topLevelProseLefts: [], cachedLeft: null, contentLeft: 10,
    })).toEqual({ left: 10, source: DOCUMENT_TEXT_COLUMN_SOURCE.CONTENT_LEFT_FALLBACK })
  })

  it('§6 — li/ul/ol, blockquote, pre/code, table, nested block and overlay never qualify', () => {
    const base = { isDirectChildOfContentRoot: true, left: 100, hasText: true }
    expect(isTextColumnCandidate({ ...base, tagName: 'P', insideIndentedContainer: false })).toBe(true)
    expect(isTextColumnCandidate({ ...base, tagName: 'H3', insideIndentedContainer: false })).toBe(true)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'LI', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'BLOCKQUOTE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'PRE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'TABLE', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'DIV', insideIndentedContainer: true })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', isDirectChildOfContentRoot: false, insideIndentedContainer: false })).toBe(false)
    expect(isTextColumnCandidate({ ...base, tagName: 'P', hasText: false, insideIndentedContainer: false })).toBe(false)
  })

  it('§14/§19 — drift tolerance + the left-accent surface detector', () => {
    expect(isTextColumnDriftWithinTolerance([60, 60.5, 60.9])).toBe(true)
    expect(isTextColumnDriftWithinTolerance([60, 61.5])).toBe(false)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 4, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(true)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 3, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(true)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 4, topWidth: 1, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(false)
    expect(isSurfaceLeftAccentOnly({ leftWidth: 6, topWidth: 0, rightWidth: 0, bottomWidth: 0, leftStyle: 'solid' })).toBe(false)
    expect(EOF_ACCENT_WIDTH_PX).toBe(4)
    expect(EOF_MARKER_KIND_DOCUMENT_END_WARNING).toBe('document-end-warning')
    expect(EOF_FILL_EMPHASIS_CLASS_LOW).toBe('LOW_EMPHASIS')
  })

  it('§8/§9 — the band is intentionally NARROWER than the content box (text column → content right)', () => {
    const base = {
      documentIsNonEmpty: true,
      lastMeaningfulRect: { left: 420, top: 1000, right: 1300, bottom: 1024, width: 880, height: 24 },
      trailingBlankRects: [{ left: 420, top: 1024, right: 1414, bottom: 1048, width: 994, height: 24 }],
      meaningfulRects: [{ left: 420, top: 1000, right: 1300, bottom: 1024, width: 880, height: 24 }],
      contentBoundsRect: { left: 390, top: 0, right: 1414, bottom: 1200, width: 1024, height: 1200 },
      editorContentRect: { left: 278, top: 0, right: 1535, bottom: 750, width: 1257, height: 750 },
      blankLineHeight: 24,
      blankLineHeightSource: 'EDITOR_BASE_LINE_HEIGHT',
      extraTrailingBlankLineCount: 5,
    }
    const geo = computeSyntheticEofGeometry({ ...base, textColumnLeft: 420 })
    // left = the TEXT COLUMN (420), right = the DOCUMENT CONTENT (1414), NEVER the
    // editor/viewport right edge (1535).
    expect(geo.rect!.left).toBe(420)
    expect(geo.rect!.right).toBe(1414)
    expect(geo.rect!.width).toBe(994)
    expect(geo.rect!.width).toBeLessThan(base.contentBoundsRect.width)
    expect(geo.rect!.width).toBe(geo.rect!.right - geo.rect!.left)
    const fallback = computeSyntheticEofGeometry({ ...base, textColumnLeft: null })
    expect(fallback.rect!.left).toBe(390) // content-left fallback only when no prose exists
  })

  it('§21 — the 15 R3 gates are complete and 0 ⇒ PASS', () => {
    expect(DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS).toHaveLength(15)
    expect(Object.keys(DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS)).toHaveLength(15)
    const counters = createDocumentEndTextColumnV513R3Counters()
    const report = formatDocumentEndTextColumnV513R3GateReport(counters)
    for (const label of [
      'DOCUMENT_END_LEFT_ANCHOR_AT_PAGE_EDGE_COUNT',
      'EOF_LEFT_ANCHOR_FROM_LAST_MEANINGFUL_RECT_COUNT',
      'EOF_LEFT_ANCHOR_FROM_SEMANTIC_ZONE_LEFT_COUNT',
      'EOF_LEFT_ANCHOR_FROM_SELECTED_BLOCK_COUNT',
      'EOF_LEFT_ANCHOR_FROM_INDENTED_DESCENDANT_COUNT',
      'DOCUMENT_TEXT_COLUMN_LEFT_DRIFT_GT_1PX_COUNT',
      'DOCUMENT_END_ACCENT_WIDTH_LT_3PX_COUNT',
      'DOCUMENT_END_ACCENT_WIDTH_GT_4PX_COUNT',
      'DOCUMENT_END_TOP_BORDER_COUNT',
      'DOCUMENT_END_RIGHT_BORDER_COUNT',
      'DOCUMENT_END_BOTTOM_BORDER_COUNT',
      'DOCUMENT_END_OUTLINE_COUNT',
      'DOCUMENT_END_SHADOW_COUNT',
      'DOCUMENT_END_NON_WARNING_ACCENT_COUNT',
      'NON_EOF_ACTIVE_LOCATE_VERTICAL_LINE_REGRESSION_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    expect(evaluateDocumentEndTextColumnV513R3Gates(counters).decision).toBe('PASS')
    counters.accentWidthLt3px = 1
    expect(evaluateDocumentEndTextColumnV513R3Gates(counters).failedChecks).toEqual(['accentWidthLt3px'])
  })
})

describe('V5.13-R3 §8/§9/§14 — the EOF band X anchor is independent of the last block', () => {
  const kinds: LastBlockKind[] = ['paragraph', 'indented', 'list', 'quote', 'code', 'table']
  for (const kind of kinds) {
    it(`R3-EOF-X — last block = ${kind}: the band left stays on the PROSE column`, () => {
      const { h } = makeAnchorWorld(kind)
      const diag = trailingBlankDiag(5)
      injectSnapshot({ h } as unknown as World, [diag])
      const ok = (h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
      expect(ok).toBe(true)
      const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
      expect(Number.parseFloat(marker.style.left)).toBe(EOF_LOCAL_LEFT)
      expect(marker.getAttribute('data-ink-marker-kind')).toBe('document-end-warning')
      const anchors = h.getLastDocumentLayoutAnchors()!
      expect(anchors.documentTextColumnLeft).toBe(60)
      expect(anchors.documentTextColumnSource).toBe(DOCUMENT_TEXT_COLUMN_SOURCE.TOP_LEVEL_PROSE)
      // every R3 hard gate stays 0 for every last-block shape
      for (const key of DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_KEYS) {
        expect(h.getDocumentEndTextColumnV513R3GateReport())
          .toContain(`${DOCUMENT_END_TEXT_COLUMN_V513R3_GATE_LABELS[key]}=0`)
      }
      expect(h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('PASS')
    })
  }

  it('R3-EOF-X-03/06: the anchor is the prose column even when the last block is a table', () => {
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.presentationLeftSource).toBe('DOCUMENT_TEXT_COLUMN')
    expect(audit.presentationRightSource).toBe('DOCUMENT_CONTENT')
    expect(audit.markerKind).toBe(EOF_MARKER_KIND_DOCUMENT_END_WARNING)
    expect(audit.accentWidthPx).toBe('4')
    expect(audit.fillAlphaClass).toBe(EOF_FILL_EMPHASIS_CLASS_LOW)
    expect(audit.documentTextColumnLeft).toBe('60')
    expect(audit.surfaceLeftAccent).toBe('true')
    expect(audit.decorativeVerticalRail).toBe('false')
    expect(audit.drawerAffectsWorkspaceWidth).toBe('false')
    // §7 — the last block's own (table) left must never be the anchor
    expect(audit.lastMeaningfulLeft).not.toBe(audit.documentTextColumnLeft)
  })

  it('R3-EOF-X-07: a floating Drawer never changes the text-column anchor', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals & { drawerOpen: boolean }
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const before = world.h.getLastDocumentLayoutAnchors()
    internals.drawerOpen = true
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const after = world.h.getLastDocumentLayoutAnchors()
    expect(after!.documentTextColumnLeft).toBe(before!.documentTextColumnLeft)
    expect(after!.documentTextColumnSource).toBe(before!.documentTextColumnSource)
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('EOF_LEFT_ANCHOR_FROM_SELECTED_BLOCK_COUNT=0')
  })

  it('R3-EOF-X-08: a real reflow recomputes the anchor without drift false-positives', () => {
    // a TABLE last block guarantees the only prose candidate is the column itself
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(world.h.getLastDocumentLayoutAnchors()!.documentTextColumnLeft).toBe(60)
    // a REAL editor-width change (new layout width → new anchor key)
    stubRect(world.prose, () => ({ left: 70, top: 100, right: 700, bottom: 124 }))
    stubRect(document.getElementById('write')!, () => ({ left: 50, top: 0, right: 750, bottom: 1200 }))
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(world.h.getLastDocumentLayoutAnchors()!.documentTextColumnLeft).toBe(70)
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('DOCUMENT_TEXT_COLUMN_LEFT_DRIFT_GT_1PX_COUNT=0')
  })

  it('R3-EOF-X-09: a post-commit scroll never repaints the band (document-space)', () => {
    const world = makeAnchorWorld('table')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    const before = marker.style.cssText
    document.querySelector('.typ-markdown-view')!.dispatchEvent(new Event('scroll'))
    expect((document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement).style.cssText).toBe(before)
    expect(world.h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('PASS')
  })

  it('R3-EOF-X-10: removing the diagnostic removes the marker entirely', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    expect(document.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(1)
    ;(world.h as unknown as Internals).clearDiagnosticLocateVisual('ACTIVE_DIAGNOSTIC_REMOVED')
    expect(document.querySelectorAll('[data-ink-eof-marker="true"]').length).toBe(0)
  })

  it('R3-EOF-X-acc: a sub-3px or >4px accent is a REAL violation (never silently accepted)', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(5)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const internals = world.h as unknown as Internals
    // the mocked computed style reads the accent from `__eofAccentPx` (4px default)
    const originalCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'div') (el as HTMLElement & { __eofAccentPx?: number }).__eofAccentPx = 2
      return el
    }) as unknown as typeof document.createElement)
    internals.commitSyntheticEofVisual(fakeTx(), diag, 5, true)
    spy.mockRestore()
    expect(world.h.getDocumentEndTextColumnV513R3GateReport())
      .toContain('DOCUMENT_END_ACCENT_WIDTH_LT_3PX_COUNT=1')
    expect(world.h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('FAIL')
  })
})

// ── V5.13-R4 — full excessive-blank coverage ──────────────────────────────

describe('V5.13-R4 §7 — the 6 full-coverage hard gates', () => {
  it('the gate key/label set is complete and 0 ⇒ PASS, 1 ⇒ FAIL', () => {
    expect(DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS).toHaveLength(6)
    expect(Object.keys(DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_LABELS)).toHaveLength(6)
    const counters = createDocumentEndExcessCoverageV513R4Counters()
    expect(evaluateDocumentEndExcessCoverageV513R4Gates(counters).decision).toBe('PASS')
    const report = formatDocumentEndExcessCoverageV513R4GateReport(counters)
    for (const label of [
      'DOCUMENT_END_EXCESS_ZONE_COVERAGE_LT_098_COUNT',
      'DOCUMENT_END_EXCESS_ZONE_TOP_DRIFT_GT_1PX_COUNT',
      'DOCUMENT_END_EXCESS_ZONE_BOTTOM_DRIFT_GT_1PX_COUNT',
      'DOCUMENT_END_EXTRA_BLANK_COUNT_MISMATCH_COUNT',
      'DOCUMENT_END_REQUIRED_BLANK_LINE_PAINTED_COUNT',
      'DOCUMENT_END_EXCESS_BLANK_LINE_OMITTED_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    counters.excessZoneCoverageLt098 = 1
    expect(evaluateDocumentEndExcessCoverageV513R4Gates(counters).failedChecks).toEqual(['excessZoneCoverageLt098'])
  })

  it('§10 — the painted band spans the REAL measured zone for N = 2..8', () => {
    const base = {
      documentIsNonEmpty: true,
      lastMeaningfulRect: { left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 },
      trailingBlankRects: [] as Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>,
      meaningfulRects: [{ left: 60, top: 1000, right: 700, bottom: 1024, width: 640, height: 24 }],
      contentBoundsRect: { left: 50, top: 0, right: 850, bottom: 1400, width: 800, height: 1400 },
      editorContentRect: { left: 0, top: 0, right: 900, bottom: 1400, width: 900, height: 1400 },
      blankLineHeight: 24,
      blankLineHeightSource: 'ACTUAL_BLANK_NODE_GEOMETRY',
    }
    // §10 — n = 1 is a PASS case (the rule never fires); only the MIN guard applies.
    expect(computeEofPresentationHeight(1, 24)).toBe(EOF_VISUAL_MIN_HEIGHT_PX)
    // n = 2 (a single 24px tail line) is MIN-guarded as well
    const two = computeSyntheticEofGeometry({
      ...base, extraTrailingBlankLineCount: 2,
      trailingBlankRects: [
        { left: 60, top: 1048, right: 700, bottom: 1072, width: 640, height: 24 },
        { left: 60, top: 1072, right: 700, bottom: 1096, width: 640, height: 24 },
      ],
    })
    expect(two.rect!.height).toBe(EOF_VISUAL_MIN_HEIGHT_PX)
    // n >= 3 — the REAL measured tail dominates the geometry
    for (const n of [3, 4, 8]) {
      const blanks = Array.from({ length: n }, (_, i) => ({
        left: 60, top: 1048 + i * 24, right: 700, bottom: 1072 + i * 24, width: 640, height: 24,
      }))
      const geo = computeSyntheticEofGeometry({ ...base, trailingBlankRects: blanks, extraTrailingBlankLineCount: n })
      expect(geo.excessiveTrailingBlankLineCount).toBe(n)
      expect(geo.geometrySource).toBe('ACTUAL_TRAILING_DOM_BLANK_ZONE')
      // the band spans the REAL measured zone (never `n × 24` simulated upward);
      // the MIN guard may only ever EXTEND past the real tail, never shorten it.
      expect(geo.rect!.top).toBe(geo.excessiveBlankZoneRect!.top)
      expect(geo.rect!.bottom).toBeGreaterThanOrEqual(blanks[n - 1].bottom)
      // the R4 SPAN criteria the host really gates on
      expect(computeExcessZoneCoverage(geo.rect, geo.excessiveBlankZoneRect)).toBe(1)
      expect(Math.abs(geo.rect!.top - geo.excessiveBlankZoneRect!.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(geo.rect!.bottom - geo.excessiveBlankZoneRect!.bottom)).toBeLessThanOrEqual(1)
      // §3/§9 — the required (legal) 1st blank line is NEVER inside the band
      expect(geo.rect!.top).toBeGreaterThan(geo.requiredBlankZoneRect!.bottom)
    }
  })

  it('§3/§6 — an omitted excessive line and a painted required line are REAL violations', () => {
    const zone = { left: 0, top: 100, right: 100, bottom: 100 + 3 * 24, width: 100, height: 3 * 24 }
    const required = { left: 0, top: 76, right: 100, bottom: 100, width: 100, height: 24 }
    // the OLD compact 36px band over a 72px zone → coverage < 0.98 + one omitted line
    const short = evaluateEofExcessCoverage({
      presentationRect: { left: 0, top: 100, right: 100, bottom: 136, width: 100, height: 36 },
      excessiveBlankZoneRect: zone, requiredBlankZoneRect: required,
      excessiveTrailingBlankLineCount: 3, lineHeight: 24,
    })
    expect(short.coverageRatio).toBeLessThan(0.98)
    expect(short.coverageOk).toBe(false)
    expect(short.countMismatch).toBe(true)
    expect(short.excessBlankLineOmitted).toBe(true)
    // a band starting inside the required zone → required painted
    const painted = evaluateEofExcessCoverage({
      presentationRect: { left: 0, top: 90, right: 100, bottom: 90 + 72, width: 100, height: 72 },
      excessiveBlankZoneRect: zone, requiredBlankZoneRect: required,
      excessiveTrailingBlankLineCount: 3, lineHeight: 24,
    })
    expect(painted.requiredBlankPainted).toBe(true)
  })

  it('§6 — sub-pixel pixel-rounding never drops a whole line (302 vs 302.4)', () => {
    const lh = 43.2
    const lines = 7
    const zone = { left: 0, top: 441.1, right: 830, bottom: 441.1 + lines * lh, width: 830, height: lines * lh }
    // the real painted carrier is `Math.round()`ed → 302 tall instead of 302.4
    const band = { left: 0, top: 441, right: 830, bottom: 743, width: 830, height: 302 }
    expect(countPaintedExcessBlankLines(band, zone, lh)).toBe(lines)
    const verdict = evaluateEofExcessCoverage({
      presentationRect: band, excessiveBlankZoneRect: zone, requiredBlankZoneRect: null,
      excessiveTrailingBlankLineCount: lines, lineHeight: lh,
    })
    expect(verdict.coverageOk).toBe(true)
    expect(verdict.topDriftOk).toBe(true)
    expect(verdict.bottomDriftOk).toBe(true)
    expect(verdict.countMismatch).toBe(false)
    expect(verdict.excessBlankLineOmitted).toBe(false)
  })
})

describe('V5.13-R4/R5 §5/§9/§10 — the host commits REAL trailing-blank geometry', () => {
  it('§5/§9 — the painted band never rises above the last meaningful content', () => {
    const world = makeAnchorWorld('paragraph')
    const diag = trailingBlankDiag(3)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    const ok = (world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 3, true)
    expect(ok).toBe(true)
    const marker = document.querySelector('[data-ink-eof-marker="true"]') as HTMLElement
    // V5.13-R5 §3 — never the forbidden `3 × 24 = 72px` simulation.
    expect(Number.parseFloat(marker.style.height)).toBeGreaterThanOrEqual(EOF_VISUAL_MIN_HEIGHT_PX)
    const facts = world.h.getLastDocumentEndVisualFacts()!
    expect(facts.presentationHeight).toBe(Number.parseFloat(marker.style.height))
    expect(facts.presentationHeightSource).toBe('ACTUAL_TRAILING_BLANK_GEOMETRY')
    expect(facts.requiredTrailingBlankLineCount).toBe(1)
    expect(facts.excessiveTrailingBlankLineCount).toBe(3)
    expect(facts.requiredBlankPainted).toBe(false)
    // §13 — the audit carries the SAME real-geometry facts (never inferred)
    const audit = readAudits(infoSpy!, DOCUMENT_END_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.presentationHeightSource).toBe('ACTUAL_TRAILING_BLANK_GEOMETRY')
    expect(audit.presentationHeightSource).not.toBe('EXTRA_COUNT_X_LINE_HEIGHT')
    expect(audit.requiredBlankPainted).toBe('false')
    expect(audit.excessiveTrailingBlankLineCount).toBe('3')
    expect(audit.requiredTrailingBlankLineCount).toBe('1')
    expect(audit.documentIsNonEmpty).toBe('true')
    expect(audit.lastMeaningfulIdentity).toBeTruthy()
    expect(audit.meaningfulIntersectionCount).toBe('0')
    expect(audit.meaningfulIntersectionArea).toBe('0')
    expect(audit.requiredBlankZoneRect).not.toBe('null')
    expect(audit.excessiveBlankZoneRect).not.toBe('null')
    expect(audit.presentationTopMinusLastMeaningfulBottom).not.toBe('0')
    expect(audit.finalDecision).toBe('PASS')
    for (const key of DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_KEYS) {
      expect(world.h.getDocumentEndExcessCoverageV513R4GateReport())
        .toContain(`${DOCUMENT_END_EXCESS_COVERAGE_V513R4_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndExcessCoverageV513R4GateDecision().decision).toBe('PASS')
    // V5.13-R5 §15 — the real-geometry gates are ALL 0
    for (const key of DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_KEYS) {
      expect(world.h.getDocumentEndRealGeometryV513R5GateReport())
        .toContain(`${DOCUMENT_END_REAL_GEOMETRY_V513R5_GATE_LABELS[key]}=0`)
    }
    expect(world.h.getDocumentEndRealGeometryV513R5GateDecision().decision).toBe('PASS')
    // the R1/R2/R3 gate sets stay green as well
    expect(world.h.getDocumentEndVisualGateDecision().decision).toBe('PASS')
    expect(world.h.getDocumentEndVisualV513R2GateDecision().decision).toBe('PASS')
    expect(world.h.getDocumentEndTextColumnV513R3GateDecision().decision).toBe('PASS')
  })

  it('§10 — a REAL trailing blank tail grows the band (never a fixed 36/48px cap)', () => {
    const world = makeAnchorWorld('paragraph')
    const write = document.getElementById('write')!
    // four REAL empty trailing blocks AFTER the last meaningful <p>
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('p')
      b.textContent = ''
      write.appendChild(b)
      const top = 1040 + i * 24
      stubRect(b, () => ({ left: 60, top, right: 700, bottom: top + 24 }))
    }
    const diag = trailingBlankDiag(4)
    injectSnapshot({ h: world.h } as unknown as World, [diag])
    ;(world.h as unknown as Internals).commitSyntheticEofVisual(fakeTx(), diag, 4, true)
    const facts = world.h.getLastDocumentEndVisualFacts()!
    // the band spans the REAL DOM tail → deeper than the degenerate 28px marker
    expect(facts.presentationHeight).toBeGreaterThan(EOF_VISUAL_MIN_HEIGHT_PX)
    expect(facts.excessiveTrailingBlankLineCount).toBe(4)
    expect(world.h.getDocumentEndRealGeometryV513R5GateDecision().decision).toBe('PASS')
    expect(world.h.getDocumentEndExcessCoverageV513R4GateDecision().decision).toBe('PASS')
    expect(world.h.getDocumentEndVisualGateDecision().decision).toBe('PASS')
  })
})

// ── V5.13-R5 §29 — Strict Multi-H1 visual Authority ───────────────────────

/** §16 — a world with N real H1s whose identities are `H1:idx:<i>`. */
function makeMultiH1World(lineCount: number): { h: DocumentUtilityOverlayHost; heads: HTMLElement[] } {
  const shell = document.createElement('div')
  shell.className = 'typ-markdown-view'
  document.body.appendChild(shell)
  stubRect(shell, () => ({ left: 0, top: 0, right: 900, bottom: 1400 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  stubRect(write, () => ({ left: 50, top: 0, right: 850, bottom: 1200 }))
  const heads: HTMLElement[] = []
  for (let i = 0; i < lineCount; i++) {
    const h = document.createElement('h1')
    h.setAttribute('data-line', String(1 + i * 4))
    h.textContent = `标题${i + 1}`
    write.appendChild(h)
    const top = 100 + i * 60
    stubRect(h, () => ({ left: 60, top, right: 400 + i * 10, bottom: top + 40 }))
    heads.push(h)
  }
  const providers: DocumentDiagnosticsProviders = {
    ...fakeProviders(),
    getHeadingIdentity: (el: HTMLElement) => {
      const idx = heads.indexOf(el)
      return idx >= 0 ? `H1:idx:${idx}` : null
    },
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers })
  h.mount()
  hosts.push(h)
  return { h, heads }
}

/** §18 — ONE aggregate diagnostic carrying the COMPLETE excess target group. */
function multiH1Diag(excessIdentities: string[], h1Count: number): Record<string, unknown> {
  return {
    id: 'document:STRICT_SINGLE_H1_MULTIPLE_H1',
    documentKey: 'doc:eof',
    severity: 'error',
    category: 'document',
    code: 'STRICT_SINGLE_H1_MULTIPLE_H1',
    message: '严格模式要求全文只能包含一个一级标题（H1）。',
    detail: '',
    stableIdentity: excessIdentities[0],
    metadata: {
      ruleId: 'STRICT-SINGLE-H1', h1Count, reason: 'MULTIPLE_H1',
      violationFingerprint: `MULTIPLE_H1:${h1Count}:${excessIdentities[0] ?? ''}`,
    },
    location: {
      kind: 'multi-target',
      targets: excessIdentities.map(id => ({ kind: 'canonical-node', nodeKind: 'heading', stableIdentity: id })),
    },
  }
}

describe('V5.13-R5 §29 — Strict Multi-H1: EVERY excess target is marked', () => {
  // §16 — one `it` per H1 count keeps ONE `#write` root per test (no duplicate ids).
  for (const n of [2, 3, 5]) {
    it(`H1-R5-01/02/04 — ${n} H1s ⇒ ${n - 1} excess targets ⇒ ${n - 1} passive markers`, () => {
      const { h } = makeMultiH1World(n)
      const excess = Array.from({ length: n - 1 }, (_, i) => `H1:idx:${i + 1}`)
      const diag = multiH1Diag(excess, n)
      injectSnapshot({ h } as unknown as World, [diag])
      h.renderHeadingDiagnosticMarkers()
      const audit = readAudits(infoSpy!, STRICT_MULTI_H1_VISUAL_AUDIT_EVENT).pop()!
      expect(audit.h1Count).toBe(String(n))
      expect(audit.expectedExcessTargetCount).toBe(String(n - 1))
      expect(audit.visualTargetCount).toBe(String(n - 1))
      expect(audit.diagnosticTargetCount).toBe(String(n - 1))
      expect(audit.passiveMarkerCount).toBe(String(n - 1))
      expect(audit.validPrimaryMarked).toBe('false')
      expect(audit.siblingPassiveLostCount).toBe('0')
      expect(h.getStrictMultiH1VisualV513R5GateDecision().decision).toBe('PASS')
    })
  }

  it('H1-R5-03 — the DOM carries ONE marker per excess H1 and NONE for the primary', () => {
    const { h } = makeMultiH1World(3)
    const diag = multiH1Diag(['H1:idx:1', 'H1:idx:2'], 3)
    injectSnapshot({ h } as unknown as World, [diag])
    h.renderHeadingDiagnosticMarkers()
    const layer = document.querySelector('.inkchapter-heading-diagnostic-layer')!
    expect(layer.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(2)
    // §25 — the legal FIRST H1 must never be marked
    expect(layer.querySelector('[data-ink-heading-id="id:H1:idx:0"]')).toBeNull()
    expect(layer.querySelector('[data-ink-heading-id="id:H1:idx:1"]')).not.toBeNull()
    expect(layer.querySelector('[data-ink-heading-id="id:H1:idx:2"]')).not.toBeNull()
    for (const key of STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS) {
      expect(h.getStrictMultiH1VisualV513R5GateReport())
        .toContain(`${STRICT_MULTI_H1_VISUAL_V513R5_GATE_LABELS[key]}=0`)
    }
  })

  it('H1-R5-05/06 — an active switch never loses a sibling passive marker', () => {
    const { h, heads } = makeMultiH1World(3)
    const diag = multiH1Diag(['H1:idx:1', 'H1:idx:2'], 3)
    injectSnapshot({ h } as unknown as World, [diag])
    h.renderHeadingDiagnosticMarkers()
    const internals = h as unknown as {
      renderHeadingActiveEmphasisForTest: (id: string, d: Record<string, unknown>, el: HTMLElement) => void
    }
    const layer = document.querySelector('.inkchapter-heading-diagnostic-layer')!
    // first click → H1:idx:1 active
    internals.renderHeadingActiveEmphasisForTest(diag.id as string, diag, heads[1])
    expect(layer.querySelectorAll('.inkchapter-heading-diagnostic-active').length).toBe(1)
    h.renderHeadingDiagnosticMarkers()
    expect(layer.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(2)
    // second click → active switches to H1:idx:2; the sibling stays passive
    internals.renderHeadingActiveEmphasisForTest(diag.id as string, diag, heads[2])
    expect(layer.querySelectorAll('.inkchapter-heading-diagnostic-active').length).toBe(1)
    h.renderHeadingDiagnosticMarkers()
    const counters = h.getStrictMultiH1VisualV513R5Counters()
    expect(counters.activeMarkerCountGt1).toBe(0)
    expect(counters.activeTargetNotInExcessSet).toBe(0)
    expect(counters.siblingPassiveMarkerLost).toBe(0)
    expect(counters.passiveActiveFillStack).toBe(0)
    expect(h.getStrictMultiH1VisualV513R5GateDecision().decision).toBe('PASS')
    const audit = readAudits(infoSpy!, STRICT_MULTI_H1_VISUAL_AUDIT_EVENT).pop()!
    expect(audit.passiveMarkerCount).toBe('2')
    expect(audit.activeMarkerCount).toBe('1')
    expect(audit.siblingPassiveLostCount).toBe('0')
    expect(audit.passiveActiveFillStackCount).toBe('0')
  })

  it('§28 — the 8 Multi-H1 gate keys are complete and 0 ⇒ PASS', () => {
    expect(STRICT_MULTI_H1_VISUAL_V513R5_GATE_KEYS).toHaveLength(8)
    expect(Object.keys(STRICT_MULTI_H1_VISUAL_V513R5_GATE_LABELS)).toHaveLength(8)
    const counters = createStrictMultiH1VisualV513R5Counters()
    expect(evaluateStrictMultiH1VisualV513R5Gates(counters).decision).toBe('PASS')
    const report = formatStrictMultiH1VisualV513R5GateReport(counters)
    for (const label of [
      'STRICT_MULTI_H1_EXPECTED_EXTRA_TARGET_COUNT_MISMATCH',
      'STRICT_MULTI_H1_PASSIVE_MARKER_COUNT_MISMATCH',
      'STRICT_MULTI_H1_VALID_PRIMARY_H1_MARKED_COUNT',
      'STRICT_MULTI_H1_TRANSACTION_TARGET_COUNT_COLLAPSE',
      'STRICT_MULTI_H1_ACTIVE_TARGET_NOT_IN_EXCESS_SET_COUNT',
      'STRICT_MULTI_H1_ACTIVE_MARKER_COUNT_GT1',
      'STRICT_MULTI_H1_SIBLING_PASSIVE_MARKER_LOST_COUNT',
      'STRICT_MULTI_H1_PASSIVE_ACTIVE_FILL_STACK_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    counters.passiveMarkerCountMismatch = 1
    expect(evaluateStrictMultiH1VisualV513R5Gates(counters).failedChecks).toEqual(['passiveMarkerCountMismatch'])
  })
})
