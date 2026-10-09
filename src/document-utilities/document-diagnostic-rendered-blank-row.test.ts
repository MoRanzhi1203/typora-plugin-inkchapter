// @vitest-environment jsdom
/**
 * TRAE — RENDERED BLANK ROW AUTHORITY.
 *
 * Covers the §34 matrix A–G + §44 dynamic behaviour for the RENDERED count
 * resolver and the split boundary decision algebra:
 *
 *   A  source == rendered            (3 → 3)
 *   B  source  > rendered            (7 → 3, the core regression)
 *   C  rendered pass                 (2 → PASS)
 *   D  0/1/2/3/4 rendered rows       (0/1/2 PASS, 3/4 WARNING)
 *   E  the boundary-kind matrix      (paragraph/code/table/formula/heading)
 *   F  CodeMirror-internal exclusion
 *   G  plugin-caption exclusion
 *   §12/§13 no fake BOUND (null element / disconnected / zero-rect / stale / wrong kind)
 *   §22/§23 N fragment geometry (never one big band)
 *   §39–§44 gates + coverage
 *   §44 dynamic 3 → 2 and 2 → 3
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RENDERED_BLANK_ROW_AUTHORITY,
  RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS,
  RENDERED_BLANK_ROW_GATE_KEYS,
  RENDERED_BLANK_ROW_GATE_LABELS,
  createRenderedBlankRowGates,
  emptyRenderedBlankRowCoverage,
  evaluateBoundaryResolution,
  evaluateRenderedBlankRowCoverage,
  evaluateRenderedBlankRowGates,
  formatRenderedBlankRowGateReport,
  renderedBlankRowUnion,
  convertRenderedRowsToLocal,
  documentLocalRectToViewportV1,
  viewportRectToDocumentLocalV1,
  roundTripViewportRectV1,
  RENDERED_BLANK_GAP_LOCAL_SPACE,
  resolveRenderedBlankRows,
  type RectLike,
} from './document-diagnostic-rendered-blank-row'
import { computeRenderedBlankRowFragments } from './document-diagnostic-block-gap-visual-v1'
import { INTERNAL_BLANK_LINE_POLICY } from './document-diagnostic-internal-blank-lines-v1'

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, r: Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

const rectOf = (el: HTMLElement): RectLike | null => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

interface Gap {
  root: HTMLElement
  previous: HTMLElement
  next: HTMLElement
  rows: HTMLElement[]
}

/** Build a business root with `previous` → N rendered blank rows → `next`. */
function buildGap(input: {
  rows: number
  previousTag?: string
  nextTag?: string
  extraRows?: Array<{ cls: string; text?: string }>
}): Gap {
  const root = document.createElement('div')
  root.className = 'typ-markdown-view'
  document.body.appendChild(root)

  const previous = document.createElement(input.previousTag ?? 'pre')
  previous.className = input.previousTag === 'pre' ? 'md-fences md-end-block' : 'md-p md-end-block'
  previous.setAttribute('data-line', '0')
  if (input.previousTag !== 'pre') previous.textContent = 'PREV'
  root.appendChild(previous)
  stubRect(previous, { left: 60, top: 0, right: 700, bottom: 40 })

  const rows: HTMLElement[] = []
  let top = 41
  for (let i = 0; i < input.rows; i++) {
    const row = document.createElement('p')
    row.className = 'md-p md-end-block'
    row.setAttribute('data-line', String(10 + i))
    root.appendChild(row)
    stubRect(row, { left: 60, top, right: 700, bottom: top + 24 })
    rows.push(row)
    top += 24
  }
  for (const extra of input.extraRows ?? []) {
    const row = document.createElement('p')
    row.className = extra.cls
    row.textContent = extra.text ?? ''
    root.appendChild(row)
    stubRect(row, { left: 60, top, right: 700, bottom: top + 24 })
    top += 24
  }

  const next = document.createElement(input.nextTag ?? 'p')
  next.className = input.nextTag === 'pre' ? 'md-fences md-end-block' : 'md-p md-end-block'
  next.setAttribute('data-line', '99')
  if (input.nextTag !== 'pre') next.textContent = 'NEXT'
  root.appendChild(next)
  stubRect(next, { left: 60, top: top + 1, right: 700, bottom: top + 30 })
  return { root, previous, next, rows }
}

function resolve(gap: Gap, sourceBlankLineCount: number) {
  return resolveRenderedBlankRows({
    businessRoot: gap.root,
    previousElement: gap.previous,
    nextElement: gap.next,
    sourceBlankLineCount,
    layoutEpoch: 1,
    expectedLayoutEpoch: 1,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({
    display: 'block', visibility: 'visible', opacity: '1',
  })) as unknown as typeof window.getComputedStyle)
})

// ── §34 A/B/C/D — the count matrix ─────────────────────────────────────────

describe('TRAE §34 A–D — source vs rendered count matrix', () => {
  it('A: source == rendered (3 → 3), warning holds', () => {
    const gap = buildGap({ rows: 3 })
    const res = resolve(gap, 3)
    expect(res.decision).toBe('VERIFIED')
    expect(res.sourceBlankLineCount).toBe(3)
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.authority).toBe(RENDERED_BLANK_ROW_AUTHORITY)
    expect(res.rows.every(r => r.physicalVerified)).toBe(true)
  })

  it('B: THE REGRESSION — source 7 > rendered 3, never a mathematical conversion', () => {
    const gap = buildGap({ rows: 3 })
    const res = resolve(gap, 7)
    expect(res.sourceBlankLineCount).toBe(7)
    expect(res.renderedBlankRowCount).toBe(3)
    // the count comes from the 3 REAL DOM rows, not a formula on the source count.
    expect(res.rows).toHaveLength(3)
    expect(res.decision).toBe('VERIFIED')
  })

  it('B: a DIFFERENT source count with the same DOM never changes the rendered count', () => {
    const gap = buildGap({ rows: 3 })
    expect(resolve(gap, 7).renderedBlankRowCount).toBe(3)
    expect(resolve(gap, 4).renderedBlankRowCount).toBe(3)
    expect(resolve(gap, 12).renderedBlankRowCount).toBe(3)
  })

  it('C: rendered 2 → below the warning threshold (PASS)', () => {
    const gap = buildGap({ rows: 2 })
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(2)
    expect(res.renderedBlankRowCount < INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(true)
  })

  it('D: 0/1/2 → below threshold, 3/4 → warning (from the RENDERED count)', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      const res = resolve(buildGap({ rows: n }), 7)
      expect(res.renderedBlankRowCount, `${n} rows`).toBe(n)
      const warning = res.renderedBlankRowCount >= INTERNAL_BLANK_LINE_POLICY.warningThreshold
      expect(warning, `${n} rows`).toBe(n >= 3)
    }
  })

  it('D: NO_RENDERED_ROWS is a distinct non-VERIFIED decision (never a fake PASS)', () => {
    const res = resolve(buildGap({ rows: 0 }), 7)
    expect(res.decision).toBe('NO_RENDERED_ROWS')
    expect(res.renderedBlankRowCount).toBe(0)
  })

  it('§29 — runtime unavailable → PENDING (0), never a fallback to the source count', () => {
    const res = resolveRenderedBlankRows({
      businessRoot: null, previousElement: null, nextElement: null,
      sourceBlankLineCount: 7, layoutEpoch: 1,
    })
    expect(res.decision).toBe('RUNTIME_UNAVAILABLE')
    expect(res.renderedBlankRowCount).toBe(0)
    expect(res.sourceBlankLineCount).toBe(7)
  })

  it('§29 — a STALE layout epoch refuses the count', () => {
    const gap = buildGap({ rows: 3 })
    const res = resolveRenderedBlankRows({
      businessRoot: gap.root, previousElement: gap.previous, nextElement: gap.next,
      sourceBlankLineCount: 7, layoutEpoch: 2, expectedLayoutEpoch: 1,
    })
    expect(res.decision).toBe('STALE_LAYOUT')
    expect(res.renderedBlankRowCount).toBe(0)
  })
})

// ── TRAE §9 P1 — zero-WIDTH editable rows (the real Typora regression) ──────

describe('TRAE §9 P1 — an EMPTY editable <p> with width 0 is still a blank row', () => {
  it('3 zero-width rows → VERIFIED count 3 (never NO_RENDERED_ROWS)', () => {
    const gap = buildGap({ rows: 3 })
    // Typora renders an empty paragraph with width === 0 but a real line height.
    gap.rows.forEach((r, i) => stubRect(r, { left: 443.8, top: 100 + i * 26, right: 443.8, bottom: 100 + i * 26 + 25.6 }))
    const res = resolve(gap, 7)
    expect(res.decision).toBe('VERIFIED')
    expect(res.renderedBlankRowCount).toBe(3)
    expect(res.sourceBlankLineCount).toBe(7)
    expect(res.rows.every(r => r.physicalVerified)).toBe(true)
  })

  it('a zero-width row still paints at the DOCUMENT text-column width', () => {
    const gap = buildGap({ rows: 3 })
    gap.rows.forEach((r, i) => stubRect(r, { left: 443.8, top: 100 + i * 26, right: 443.8, bottom: 100 + i * 26 + 25.6 }))
    const res = resolve(gap, 7)
    const { fragments } = computeRenderedBlankRowFragments({
      rowRects: res.rows.map(r => r.rect),
      contentColumns: { left: 443.8, right: 1112.2 },
    })
    expect(fragments).toHaveLength(3)
    expect(fragments.every(f => f.width > 0)).toBe(true)
    expect(fragments.every(f => Math.abs(f.width - (1112.2 - 443.8)) < 0.001)).toBe(true)
  })

  it('a zero-HEIGHT editable row is still refused (never a fake row)', () => {
    const gap = buildGap({ rows: 3 })
    gap.rows.forEach(r => stubRect(r, { left: 443.8, top: 100, right: 443.8, bottom: 100 }))
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(0)
  })
})

// ── §34 E — boundary-kind matrix ───────────────────────────────────────────

describe('TRAE §34 E — boundary-kind matrix', () => {
  const cases: Array<[string, string | undefined, string | undefined]> = [
    ['paragraph → paragraph', undefined, undefined],
    ['code → paragraph', 'pre', undefined],
    ['paragraph → code', undefined, 'pre'],
    ['code → code', 'pre', 'pre'],
    ['heading → paragraph', 'h2', undefined],
    ['paragraph → heading', undefined, 'h2'],
    ['table → paragraph', 'table', undefined],
    ['paragraph → table', undefined, 'table'],
    ['formula → paragraph', 'div', undefined],
    ['paragraph → formula', undefined, 'div'],
  ]
  for (const [label, prevTag, nextTag] of cases) {
    it(`${label} resolves the rendered rows identically`, () => {
      const gap = buildGap({ rows: 3, previousTag: prevTag, nextTag })
      const res = resolve(gap, 7)
      expect(res.decision, label).toBe('VERIFIED')
      expect(res.renderedBlankRowCount, label).toBe(3)
    })
  }
})

// ── §34 F/G — exclusions ───────────────────────────────────────────────────

describe('TRAE §34 F/G — CodeMirror internal + plugin caption exclusion', () => {
  it('F: CodeMirror internal rows are NEVER blank rows', () => {
    const gap = buildGap({ rows: 0, extraRows: [{ cls: 'cm-line' }, { cls: 'CodeMirror-line' }] })
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(0)
    expect(res.probe?.betweenSiblings.every(s => s.candidateBlankRow)).toBe(false)
    expect(res.probe?.betweenSiblings.some(s => s.codeMirrorInternal)).toBe(true)
  })

  it('G: a plugin caption is NEVER a blank row', () => {
    const gap = buildGap({ rows: 0, extraRows: [{ cls: 'inkchapter-caption' }] })
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(0)
    expect(res.probe?.betweenSiblings.some(s => s.pluginOwned)).toBe(true)
  })

  it('F/G: real blank rows still count alongside an excluded sibling', () => {
    const gap = buildGap({ rows: 3, extraRows: [{ cls: 'inkchapter-caption' }, { cls: 'cm-line' }] })
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(3)
  })

  it('§9 — a NON-empty paragraph is not a blank row', () => {
    const gap = buildGap({ rows: 1 })
    gap.rows[0].textContent = 'not blank'
    const res = resolve(gap, 7)
    expect(res.renderedBlankRowCount).toBe(0)
  })
})

// ── §12/§13 — the split boundary decision ──────────────────────────────────

describe('TRAE §12/§13 — no fake BOUND', () => {
  const base = {
    identityDecision: 'RESOLVED' as const,
    connected: true,
    insideBusinessRoot: true,
    kindVerified: true,
    layoutEpoch: 1,
    expectedLayoutEpoch: 1,
    canonicalIdentity: 'block:code:2',
    strategy: 'CANONICAL_CODE_TARGET',
  }

  it('BOUND only with a verified rect + connected element inside the root', () => {
    const el = document.createElement('pre')
    const rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }
    const res = evaluateBoundaryResolution({ ...base, element: el, rect })
    expect(res.decision).toBe('BOUND')
    expect(res.physicalDecision).toBe('VERIFIED')
  })

  it('NEVER BOUND with a null element', () => {
    const res = evaluateBoundaryResolution({ ...base, element: null, rect: null })
    expect(res.decision).not.toBe('BOUND')
    expect(res.physicalDecision).toBe('MISSING')
  })

  it('NEVER BOUND when disconnected / outside root / wrong kind', () => {
    const el = document.createElement('pre')
    const rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }
    expect(evaluateBoundaryResolution({ ...base, element: el, connected: false, rect }).decision).toBe('UNVERIFIED')
    expect(evaluateBoundaryResolution({ ...base, element: el, insideBusinessRoot: false, rect }).physicalDecision).toBe('MISSING')
    expect(evaluateBoundaryResolution({ ...base, element: el, kindVerified: false, rect }).physicalDecision).toBe('WRONG_KIND')
  })

  it('NEVER BOUND with a zero rect or a stale layout', () => {
    const el = document.createElement('pre')
    const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    expect(evaluateBoundaryResolution({ ...base, element: el, rect: zero }).physicalDecision).toBe('ZERO_RECT')
    const rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }
    expect(evaluateBoundaryResolution({ ...base, element: el, rect, layoutEpoch: 2, expectedLayoutEpoch: 1 }).physicalDecision).toBe('STALE_LAYOUT')
  })
})

// ── §22/§23 — fragment geometry ────────────────────────────────────────────

describe('TRAE §22/§23 — N fragment geometry (never one big band)', () => {
  it('3 row rects → 3 fragments inside the rendered row union', () => {
    const gap = buildGap({ rows: 3 })
    const rows = gap.rows.map(r => ({ rect: rectOf(r) }))
    const { container, fragments } = computeRenderedBlankRowFragments({
      rowRects: rows.map(r => r.rect),
      contentColumns: { left: 60, right: 700 },
    })
    expect(fragments).toHaveLength(3)
    expect(container).not.toBeNull()
    expect(container!.top).toBe(41)
    expect(container!.width).toBe(640)
    // each fragment aligns to its OWN row height; no fragment covers prev/next.
    expect(fragments.map(f => f.height)).toEqual([24, 24, 24])
    expect(fragments.every(f => f.left === 0)).toBe(true)
  })

  it('zero usable rows → no container, no fragments', () => {
    const { container, fragments } = computeRenderedBlankRowFragments({ rowRects: [null], contentColumns: null })
    expect(container).toBeNull()
    expect(fragments).toHaveLength(0)
  })
})

// ── §20 — the rendered union centre ────────────────────────────────────────

describe('TRAE §20 — the rendered blank-row union centre', () => {
  it('is the union centre, never the next paragraph centre', () => {
    const gap = buildGap({ rows: 3 })
    const union = renderedBlankRowUnion(gap.rows.map(r => ({ rect: rectOf(r) })))
    expect(union).not.toBeNull()
    expect(union!.top).toBe(41)
    expect(union!.bottom).toBe(113)
    expect(union!.centerY).toBe((41 + 113) / 2)
  })
})

// ── §39–§44 — gates + coverage ─────────────────────────────────────────────

describe('TRAE §39–§44 — gates + coverage', () => {
  it('every hard gate starts at 0 and a single hit FAILs', () => {
    const counters = createRenderedBlankRowGates()
    const report = formatRenderedBlankRowGateReport(counters)
    expect(report.every(l => l.endsWith('=0'))).toBe(true)
    expect(report).toContain(`${RENDERED_BLANK_ROW_GATE_LABELS.boundWithNullElement}=0`)
    expect(evaluateRenderedBlankRowGates(counters).decision).toBe('PASS')
    expect(evaluateRenderedBlankRowGates({ ...counters, zeroPaintedRect: 1 }).decision).toBe('FAIL')
    expect(RENDERED_BLANK_ROW_GATE_KEYS).toContain('boundWithoutPhysicalVerification')
    expect(RENDERED_BLANK_ROW_GATE_KEYS).toContain('sourceCountUsedAsDisplayCount')
  })

  it('positive coverage needs the real runtime chain', () => {
    const coverage = emptyRenderedBlankRowCoverage()
    expect(evaluateRenderedBlankRowCoverage(coverage).satisfied).toBe(false)
    for (const k of Object.keys(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS)) coverage[k] = 1
    expect(evaluateRenderedBlankRowCoverage(coverage).satisfied).toBe(true)
    expect(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS.INTERNAL_BLANK_LINE_RENDERED_COUNT_VERIFIED_COUNT).toBe(1)
  })
})

// ── §44 — dynamic 3 → 2 and 2 → 3 ──────────────────────────────────────────

describe('TRAE §44 — dynamic rendered row refresh (event-driven, no timer)', () => {
  it('3 → 2 blank rows flips the warning off on re-resolve', () => {
    const gap = buildGap({ rows: 3 })
    expect(resolve(gap, 7).renderedBlankRowCount).toBe(3)
    // remove one real blank row from the DOM
    gap.rows[1].remove()
    const after = resolve(gap, 7)
    expect(after.renderedBlankRowCount).toBe(2)
    expect(after.renderedBlankRowCount < INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(true)
  })

  it('2 → 3 blank rows restores the warning on re-resolve', () => {
    const gap = buildGap({ rows: 2 })
    expect(resolve(gap, 7).renderedBlankRowCount).toBe(2)
    const newRow = document.createElement('p')
    newRow.className = 'md-p md-end-block'
    gap.root.insertBefore(newRow, gap.next)
    stubRect(newRow, { left: 60, top: 100, right: 700, bottom: 124 })
    const after = resolve(gap, 7)
    expect(after.renderedBlankRowCount).toBe(3)
    expect(after.renderedBlankRowCount >= INTERNAL_BLANK_LINE_POLICY.warningThreshold).toBe(true)
  })
})

describe('TRAE coordinate closure §5/§7/§16/§17 — ONE canonical conversion', () => {
  const host = { left: 100, top: 604, right: 1140, bottom: 2000, width: 1040, height: 1396 }
  const viewportRows = [
    { rect: { left: 443.8, top: 378.3125, right: 1112.2, bottom: 403.9125, width: 668.4, height: 25.6 } },
    { rect: { left: 443.8, top: 416.71249, right: 1112.2, bottom: 442.31249, width: 668.4, height: 25.6 } },
    { rect: { left: 443.8, top: 455.11252, right: 1112.2, bottom: 480.71252, width: 668.4, height: 25.6 } },
  ]

  it('3 VIEWPORT rows → 3 DOCUMENT_LOCAL rects, each conversionCount=1', () => {
    const r = convertRenderedRowsToLocal({ rows: viewportRows, inputCoordinateSpace: 'VIEWPORT', contentHostRect: host, layoutEpoch: 7 })
    expect(r.localRects).toHaveLength(3)
    expect(r.conversionCount).toBe(3)
    expect(r.doubleConversionDetected).toBe(false)
    expect(r.unknownCoordinateSpace).toBe(false)
    expect(r.mixedCoordinateDetected).toBe(false)
    expect(r.rows.map(x => x.conversionCount)).toEqual([1, 1, 1])
    expect(r.rows.every(x => x.outputCoordinateSpace === RENDERED_BLANK_GAP_LOCAL_SPACE)).toBe(true)
    expect(r.rows.every(x => x.inputCoordinateSpace === 'VIEWPORT')).toBe(true)
    expect(r.localRects[0].top).toBeCloseTo(378.3125 - host.top, 6)
    expect(r.localRects[0].left).toBeCloseTo(443.8 - host.left, 6)
  })

  it('§5 — a rect that is ALREADY local is REFUSED (never a double conversion)', () => {
    const r = convertRenderedRowsToLocal({ rows: viewportRows, inputCoordinateSpace: 'DOCUMENT_LOCAL', contentHostRect: host, layoutEpoch: 7 })
    expect(r.doubleConversionDetected).toBe(true)
    expect(r.unknownCoordinateSpace).toBe(true)
    expect(r.conversionCount).toBe(0)
    expect(r.localRects).toHaveLength(0)
  })

  it('§14 — no host rect ⇒ the conversion is refused and flagged (never guessed)', () => {
    const r = convertRenderedRowsToLocal({ rows: viewportRows, inputCoordinateSpace: 'VIEWPORT', contentHostRect: null, layoutEpoch: 7 })
    expect(r.mixedCoordinateDetected).toBe(true)
    expect(r.conversionCount).toBe(0)
  })

  it('§16 — the union centre follows the ONE conversion, never a second subtraction', () => {
    const r = convertRenderedRowsToLocal({ rows: viewportRows, inputCoordinateSpace: 'VIEWPORT', contentHostRect: host, layoutEpoch: 7 })
    const viewportCenter = (378.3125 + 480.71252) / 2
    const union = renderedBlankRowUnion(r.localRects.map(rect => ({ rect })))
    expect(union).not.toBeNull()
    expect(union!.centerY).toBeCloseTo(viewportCenter - host.top, 6)
    // a DOUBLE conversion would subtract the host TWICE — a different value
    expect(union!.centerY).not.toBeCloseTo(viewportCenter - 2 * host.top, 3)
  })

  it('§17 — round trip VIEWPORT → LOCAL → VIEWPORT stays within 1px', () => {
    for (const row of viewportRows) {
      const rt = roundTripViewportRectV1(row.rect, host)
      expect(rt.maxDriftPx).toBeLessThanOrEqual(1)
      expect(rt.viewport.top).toBeCloseTo(row.rect.top, 6)
      expect(documentLocalRectToViewportV1(viewportRectToDocumentLocalV1(row.rect, host), host).left).toBeCloseTo(row.rect.left, 6)
    }
  })

  it('§14 — the coordinate gates exist, start at 0 and FAIL when hit', () => {
    const g = createRenderedBlankRowGates()
    for (const k of ['doubleCoordinateConversion', 'unknownCoordinateSpace', 'mixedCoordinateSpaceCompare', 'negativeRenderedGapCenter', 'syntheticGapUsedWhileRenderedRowsVerified'] as const) {
      expect(RENDERED_BLANK_ROW_GATE_KEYS).toContain(k)
      expect(g[k]).toBe(0)
    }
    expect(evaluateRenderedBlankRowGates(g).decision).toBe('PASS')
    g.doubleCoordinateConversion++
    expect(evaluateRenderedBlankRowGates(g).decision).toBe('FAIL')
    expect(RENDERED_BLANK_ROW_GATE_LABELS.doubleCoordinateConversion).toBe('INTERNAL_BLANK_LINE_DOUBLE_COORDINATE_CONVERSION_COUNT')
    expect(RENDERED_BLANK_ROW_GATE_LABELS.mixedCoordinateSpaceCompare).toBe('INTERNAL_BLANK_LINE_MIXED_COORDINATE_SPACE_COMPARE_COUNT')
  })

  it('§22 — the primary-geometry + fragment-conversion coverage keys exist', () => {
    expect(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS.INTERNAL_BLANK_LINE_RENDERED_BLANK_ROW_PRIMARY_GEOMETRY_USED_COUNT).toBe(1)
    expect(RENDERED_BLANK_ROW_COVERAGE_REQUIREMENTS.INTERNAL_BLANK_LINE_ROW_FRAGMENT_COORDINATE_CONVERSION_COUNT).toBe(1)
  })
})
