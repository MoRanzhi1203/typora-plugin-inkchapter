// @vitest-environment jsdom
/**
 * V5.14-R6.1 — Heading Diagnostic COVERAGE POLICY (DiagnosticCode -> policy).
 *
 * R6 unified every heading diagnostic to NUMBER|GAP|TITLE. R6.1 corrects that
 * over-generalisation: the coverage is decided by the DiagnosticCode SEMANTICS.
 *
 *  A  HEADING_DUPLICATE_TEXT + numbered -> TITLE_ONLY   (2.1 [第一节])
 *  B  HEADING_DUPLICATE_TEXT + unnumbered -> TITLE_ONLY (第一节)
 *  C  HEADING_LEVEL_GAP + numbered      -> FULL_VISIBLE_HEADING (NUMBER|GAP|TITLE)
 *  D  STRICT multi-H1 / first-H1        -> FULL_VISIBLE_HEADING
 *  E  LATENT_ATX source issue           -> SOURCE_RANGE
 *  F  ONE heading with Duplicate + LevelGap -> two diagnostics, two policies
 *  §28 Passive -> Active keeps the policy / mask / rects
 *  §29 Outline shares the policy (reprojects, never copies a body rect)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_AUDIT_EVENT,
  DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_POLICY_AUDIT_EVENT,
  HEADING_COVERAGE_NUMBERED,
  HEADING_COVERAGE_UNNUMBERED,
  HEADING_COVERAGE_V514R6_GATE_KEYS,
  HEADING_COVERAGE_V514R6_GATE_LABELS,
  HeadingCoveragePart,
  buildHeadingDiagnosticTargetSnapshot,
  coverageMaskForPolicy,
  coverageMaskHas,
  coverageRectInvariantHolds,
  coverageUsesFullBlockFallback,
  createHeadingCoverageV514R6Counters,
  evaluateHeadingCoverageV514R6Gates,
  formatCoverageMask,
  formatHeadingCoverageV514R6GateReport,
  isExplicitlyMappedHeadingDiagnosticCode,
  isKnownHeadingDiagnosticCode,
  makeCoverageRect,
  reasonChipExcludedFromCoverage,
  resolveHeadingDiagnosticCoveragePolicy,
  splitNumberAndGapRects,
  unionCoverageMasks,
  type HeadingDiagnosticTargetSnapshot,
} from './document-diagnostic-heading-coverage-v514-r6'

// ── pure contract ───────────────────────────────────────────────────────────

function rect(left: number, top: number, right: number, bottom: number) {
  return makeCoverageRect({ left, top, right, bottom })
}

describe('V5.14-R6.1 §3/§7 — the policy resolver', () => {
  it('maps the REAL DiagnosticCodes to their coverage policy', () => {
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'HEADING_DUPLICATE_TEXT' })).toBe('TITLE_ONLY')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'HEADING_DUPLICATE_IDENTITY' })).toBe('TITLE_ONLY')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'HEADING_EMPTY_TEXT' })).toBe('TITLE_ONLY')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'HEADING_LEVEL_GAP' })).toBe('FULL_VISIBLE_HEADING')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'STRICT_SINGLE_H1_NO_H1' })).toBe('FULL_VISIBLE_HEADING')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'STRICT_SINGLE_H1_MULTIPLE_H1' })).toBe('FULL_VISIBLE_HEADING')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'STRICT_FIRST_H1_POSITION' })).toBe('FULL_VISIBLE_HEADING')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'STRICT_FIRST_H1_LEADING_PARAGRAPH' })).toBe('FULL_VISIBLE_HEADING')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'LATENT_ATX_HEADING_MARKER' })).toBe('SOURCE_RANGE')
    expect(resolveHeadingDiagnosticCoveragePolicy({ code: 'LATENT_ATX_HEADING_MARKER_LEVEL_2' })).toBe('SOURCE_RANGE')
  })

  it('§7 — only FULL_VISIBLE_HEADING consumes the numbering decoration', () => {
    expect(coverageMaskForPolicy('FULL_VISIBLE_HEADING', { hasNumberDecoration: true })).toBe(HEADING_COVERAGE_NUMBERED)
    expect(coverageMaskForPolicy('FULL_VISIBLE_HEADING', { hasNumberDecoration: false })).toBe(HEADING_COVERAGE_UNNUMBERED)
    // TITLE_ONLY never includes the number/gap, numbered or not (§4/§17)
    expect(coverageMaskForPolicy('TITLE_ONLY', { hasNumberDecoration: true })).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(coverageMaskForPolicy('TITLE_ONLY', { hasNumberDecoration: false })).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(coverageMaskForPolicy('SOURCE_RANGE', { hasNumberDecoration: true })).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(formatCoverageMask(HEADING_COVERAGE_NUMBERED)).toBe('NUMBER|GAP|TITLE')
    expect(formatCoverageMask(HEADING_COVERAGE_UNNUMBERED)).toBe('TITLE')
    expect(coverageMaskHas(HEADING_COVERAGE_NUMBERED, HeadingCoveragePart.GAP)).toBe(true)
    expect(coverageMaskHas(HEADING_COVERAGE_UNNUMBERED, HeadingCoveragePart.NUMBER)).toBe(false)
  })

  it('§25 — every KNOWN heading diagnostic code is explicitly mapped', () => {
    for (const code of [
      'HEADING_DUPLICATE_TEXT', 'HEADING_DUPLICATE_IDENTITY', 'HEADING_LEVEL_GAP', 'HEADING_EMPTY_TEXT',
      'STRICT_SINGLE_H1_NO_H1', 'STRICT_SINGLE_H1_MULTIPLE_H1', 'STRICT_FIRST_H1_POSITION',
      'LATENT_ATX_HEADING_MARKER_LEVEL_2',
    ]) {
      expect(isKnownHeadingDiagnosticCode(code)).toBe(true)
      expect(isExplicitlyMappedHeadingDiagnosticCode(code)).toBe(true)
    }
    // an invented heading code is KNOWN but NOT explicitly mapped → the gate catches it
    expect(isKnownHeadingDiagnosticCode('HEADING_MADE_UP_CODE')).toBe(true)
    expect(isExplicitlyMappedHeadingDiagnosticCode('HEADING_MADE_UP_CODE')).toBe(false)
  })

  it('§18 — the heading-level fill is the UNION of its diagnostics’ masks', () => {
    expect(unionCoverageMasks([HEADING_COVERAGE_UNNUMBERED, HEADING_COVERAGE_NUMBERED])).toBe(HEADING_COVERAGE_NUMBERED)
    expect(unionCoverageMasks([HEADING_COVERAGE_UNNUMBERED, HEADING_COVERAGE_UNNUMBERED])).toBe(HEADING_COVERAGE_UNNUMBERED)
  })

  it('the reason chip is never part of the coverage union', () => {
    const fragments = [rect(30, 100, 240, 124)]
    expect(reasonChipExcludedFromCoverage({ reasonChipRect: rect(248, 102, 300, 122), semanticFragmentRects: fragments })).toBe(true)
    expect(reasonChipExcludedFromCoverage({ reasonChipRect: rect(100, 102, 160, 122), semanticFragmentRects: fragments })).toBe(false)
    expect(reasonChipExcludedFromCoverage({ reasonChipRect: null, semanticFragmentRects: fragments })).toBe(true)
  })

  it('§10/§11 — the measured number advance splits the decoration band into NUMBER + GAP', () => {
    const band = rect(30, 100, 70.5, 124)
    const split = splitNumberAndGapRects({ decorationBand: band, numberTextWidthPx: 9, gapMode: 'space' })
    expect(split.numberRect).toEqual({ left: 30, top: 100, right: 39, bottom: 124, width: 9, height: 24 })
    expect(split.gapRect).toEqual({ left: 39, top: 100, right: 70.5, bottom: 124, width: 31.5, height: 24 })
    expect(splitNumberAndGapRects({ decorationBand: band, numberTextWidthPx: 9, gapMode: 'none' }).gapRect).toBeNull()
    const unsplit = splitNumberAndGapRects({ decorationBand: band, numberTextWidthPx: null, gapMode: 'space' })
    expect(unsplit.numberRect).toEqual(band)
    expect(unsplit.gapRect).toBeNull()
  })

  it('§5 — FULL_VISIBLE_HEADING merges NUMBER|GAP|TITLE on the first line, keeps the number/gap authority', () => {
    const snapshot = buildHeadingDiagnosticTargetSnapshot({
      diagnosticId: 'W1', coveragePolicy: 'FULL_VISIBLE_HEADING',
      stableIdentity: 'id:H3:idx:5', layoutEpoch: 3, geometryGeneration: 1, hasNumberDecoration: true,
      numberRect: rect(30, 100, 39, 124),
      gapRect: rect(39, 100, 70.5, 124),
      titleRects: [rect(70.5, 100, 142.5, 124), rect(30, 128, 120, 152)],
    })
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    expect(snapshot.semanticFragmentRects).toHaveLength(2)
    expect(snapshot.semanticFragmentRects[0]).toEqual({ left: 30, top: 100, right: 142.5, bottom: 124, width: 112.5, height: 24 })
    expect(snapshot.semanticFragmentRects[1]).toEqual({ left: 30, top: 128, right: 120, bottom: 152, width: 90, height: 24 })
    expect(snapshot.reasonChipExcluded).toBe(true)
    for (const r of snapshot.semanticFragmentRects) expect(coverageRectInvariantHolds(r)).toBe(true)
  })

  it('§4/§12 — TITLE_ONLY keeps the number/gap authority but NEVER paints it', () => {
    const snapshot = buildHeadingDiagnosticTargetSnapshot({
      diagnosticId: 'W1', coveragePolicy: 'TITLE_ONLY',
      stableIdentity: 'id:H3:idx:5', layoutEpoch: 3, geometryGeneration: 1, hasNumberDecoration: true,
      numberRect: rect(30, 100, 39, 124),
      gapRect: rect(39, 100, 70.5, 124),
      titleRects: [rect(70.5, 100, 142.5, 124)],
    })
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    // the authority survives (§12) …
    expect(snapshot.numberRect).not.toBeNull()
    expect(snapshot.gapRect).not.toBeNull()
    // … but it is NOT painted: the fill starts at the title glyph (70.5), not the number (30)
    expect(snapshot.semanticFragmentRects).toHaveLength(1)
    expect(snapshot.semanticFragmentRects[0]).toEqual({ left: 70.5, top: 100, right: 142.5, bottom: 124, width: 72, height: 24 })
  })

  it('§12 — a fragment as wide as the heading block is the forbidden full-width fallback', () => {
    expect(coverageUsesFullBlockFallback({
      semanticFragmentRects: [rect(30, 100, 830, 124)],
      headingBlockRect: rect(30, 100, 830, 124),
    })).toBe(true)
    expect(coverageUsesFullBlockFallback({
      semanticFragmentRects: [rect(30, 100, 142.5, 124)],
      headingBlockRect: rect(30, 100, 830, 124),
    })).toBe(false)
  })

  it('§25/§26 — the 22 policy-aware gates are declared, complete and 0 on a clean surface', () => {
    const counters = createHeadingCoverageV514R6Counters()
    expect(HEADING_COVERAGE_V514R6_GATE_KEYS).toHaveLength(22)
    expect(formatHeadingCoverageV514R6GateReport(counters)).toHaveLength(22)
    expect(evaluateHeadingCoverageV514R6Gates(counters).decision).toBe('PASS')
    expect(HEADING_COVERAGE_V514R6_GATE_LABELS.fullVisibleHeadingNumberOmitted)
      .toBe('FULL_VISIBLE_HEADING_NUMBER_OMITTED_COUNT')
    expect(HEADING_COVERAGE_V514R6_GATE_LABELS.duplicateHeadingNumberIncluded)
      .toBe('DUPLICATE_HEADING_NUMBER_INCLUDED_COUNT')
    expect(HEADING_COVERAGE_V514R6_GATE_LABELS.bodyPassiveActivePolicyMismatch)
      .toBe('BODY_PASSIVE_ACTIVE_POLICY_MISMATCH_COUNT')
    expect(HEADING_COVERAGE_V514R6_GATE_LABELS.bodyOutlinePolicyMismatch)
      .toBe('BODY_OUTLINE_POLICY_MISMATCH_COUNT')
    const dirty = createHeadingCoverageV514R6Counters()
    dirty.headingBlockFullWidthFallback = 1
    expect(evaluateHeadingCoverageV514R6Gates(dirty).decision).toBe('FAIL')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function stubRaf(): void {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1 }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
let rangeRects: Rect[] = []
let headingBlock: Rect = { left: 30, top: 100, right: 830, bottom: 124 }
let numberAdvancePx = 3
function stubLayout(): void {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Element) {
      const cls = typeof this.className === 'string' ? this.className : ''
      if (cls.includes('inkchapter-heading-number-measure')) {
        const text = this.textContent ?? ''
        const w = text.length * numberAdvancePx
        return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 20, width: w, height: 20, toJSON: () => ({}) }
      }
      if (cls.includes('inkchapter-heading-diagnostic-reason')) {
        const text = this.textContent ?? ''
        const w = 14 + text.length * 8
        return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 20, width: w, height: 20, toJSON: () => ({}) }
      }
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
    },
  })
}
function stubRangeRects(rects: Rect[]): void {
  rangeRects = rects
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rangeRects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
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
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type HostApi = {
  renderHeadingDiagnosticMarkers(skipActiveEmphasis?: boolean): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  getHeadingCoverageSnapshot(identity: string, diagnosticId?: string): HeadingDiagnosticTargetSnapshot | null
  getHeadingCoverageV514R6Counters(): Record<string, number>
  getHeadingCoverageV514R6GateReport(): string[]
  getHeadingCoverageV514R6GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  stubLayout()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  headingBlock = { left: 30, top: 100, right: 830, bottom: 124 }
  numberAdvancePx = 3
  stubRangeRects([{ left: 70.5, top: 100, right: 142.5, bottom: 124 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/** A world with ONE diagnosed heading that may carry the numbering decoration. */
function makeWorld(input: { numbered: boolean; gap?: 'space' | 'none' }): {
  h: DocumentUtilityOverlayHost
  heading: HTMLElement
} {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const heading = document.createElement('h3')
  heading.setAttribute('data-id', 'H-A')
  heading.setAttribute('data-line', '4')
  heading.textContent = '第一节'
  if (input.numbered) {
    heading.setAttribute('data-inkchapter-heading-number', '2.1')
    heading.setAttribute('data-inkchapter-heading-gap', input.gap ?? 'space')
  }
  write.appendChild(heading)
  stubRect(heading, () => headingBlock)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, heading }
}
function headingDiag(code = 'HEADING_DUPLICATE_TEXT', id = 'W1'): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity: 'warning', category: 'heading',
    code, message: '重复的标题文字「第一节」', detail: '', metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 1, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const markerIdentity = (): string =>
  (document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement | null)
    ?.getAttribute('data-ink-stable-identity') ?? ''
const passiveFragments = (): Array<{ left: number; top: number; width: number; height: number }> =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-passive__fragment')).map(el => ({
    left: Number.parseFloat(el.style.left), top: Number.parseFloat(el.style.top),
    width: Number.parseFloat(el.style.width), height: Number.parseFloat(el.style.height),
  }))

describe('V5.14-R6.1 — coverage policy (host wiring)', () => {
  it('A — Duplicate + numbered covers TITLE_ONLY (2.1 [第一节]), never the number', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('TITLE_ONLY')
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    // the number/gap authority is retained (§12) but excluded from the paint
    expect(snapshot.numberRect).not.toBeNull()
    expect(snapshot.gapRect).not.toBeNull()
    expect(snapshot.titleRects).toHaveLength(1)
    expect(snapshot.semanticFragmentRects).toHaveLength(1)
    // the fill starts at the TITLE glyph (70.5), NOT at the number (30)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(70.5, 3)
    expect(snapshot.semanticFragmentRects[0].right).toBeCloseTo(142.5, 3)
    // the PASSIVE DOM paint matches exactly (DOM style rounds to whole px → ±1)
    const fragments = passiveFragments()
    expect(fragments).toHaveLength(1)
    expect(Math.abs(fragments[0].left - 70.5)).toBeLessThanOrEqual(1)
    expect(Math.abs(fragments[0].width - 72)).toBeLessThanOrEqual(1)
    const counters = api().getHeadingCoverageV514R6Counters()
    expect(counters.duplicateHeadingNumberIncluded).toBe(0)
    expect(counters.duplicateHeadingGapIncluded).toBe(0)
    expect(counters.duplicateHeadingNonTitleCoverage).toBe(0)
    expect(counters.headingBlockFullWidthFallback).toBe(0)
    expect(counters.reasonChipIncludedInHeadingTarget).toBe(0)
    expect(counters.bodyOutlineSemanticCoverageMismatch).toBe(0)
    expect(counters.bodyOutlinePolicyMismatch).toBe(0)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('B — Duplicate + unnumbered is still TITLE_ONLY (第一节)', () => {
    const w = makeWorld({ numbered: false })
    host = w.h
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('TITLE_ONLY')
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(snapshot.numberRect).toBeNull()
    expect(snapshot.gapRect).toBeNull()
    expect(snapshot.semanticFragmentRects).toHaveLength(1)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(70.5, 3)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('C — Level Gap + numbered covers FULL_VISIBLE_HEADING (NUMBER|GAP|TITLE)', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_LEVEL_GAP')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('FULL_VISIBLE_HEADING')
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    expect(snapshot.semanticFragmentRects).toHaveLength(1)
    // ONE continuous fragment from the NUMBER start (30) to the title end (142.5)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(30, 3)
    expect(snapshot.semanticFragmentRects[0].right).toBeCloseTo(142.5, 3)
    const counters = api().getHeadingCoverageV514R6Counters()
    expect(counters.fullVisibleHeadingNumberOmitted).toBe(0)
    expect(counters.fullVisibleHeadingGapOmitted).toBe(0)
    expect(counters.numberGapVisualDiscontinuity).toBe(0)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('D — Strict multi-H1 structure problems also use FULL_VISIBLE_HEADING', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('STRICT_SINGLE_H1_MULTIPLE_H1')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('FULL_VISIBLE_HEADING')
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(30, 3)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('E — a LATENT_ATX source issue is SOURCE_RANGE (title text, never the number)', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('LATENT_ATX_HEADING_MARKER_LEVEL_2')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('SOURCE_RANGE')
    expect(snapshot.coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(70.5, 3)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('F — ONE heading with Duplicate + LevelGap keeps two diagnostics with two policies', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [
      headingDiag('HEADING_DUPLICATE_TEXT', 'DUP'),
      { ...headingDiag('HEADING_LEVEL_GAP', 'GAP'), severity: 'error' },
    ])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    const dup = api().getHeadingCoverageSnapshot(identity, 'DUP')!
    const gap = api().getHeadingCoverageSnapshot(identity, 'GAP')!
    expect(dup.coveragePolicy).toBe('TITLE_ONLY')
    expect(dup.coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    expect(dup.semanticFragmentRects[0].left).toBeCloseTo(70.5, 3)
    expect(gap.coveragePolicy).toBe('FULL_VISIBLE_HEADING')
    expect(gap.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    expect(gap.semanticFragmentRects[0].left).toBeCloseTo(30, 3)
    // the heading-level PASSIVE fill paints the UNION (FULL ⊇ TITLE): the FULL range
    const headingLevel = api().getHeadingCoverageSnapshot(identity)!
    expect(headingLevel.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    const counters = api().getHeadingCoverageV514R6Counters()
    expect(counters.duplicateHeadingNumberIncluded).toBe(0)
    expect(counters.fullVisibleHeadingNumberOmitted).toBe(0)
    expect(counters.knownHeadingDiagnosticWithoutCoveragePolicy).toBe(0)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('§28 — Passive -> Active keeps the policy, mask and rects (only the emphasis changes)', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    const passive = api().getHeadingCoverageSnapshot(identity, 'W1')!
    const passiveRects = passive.semanticFragmentRects.map(r => ({ ...r }))
    api().renderHeadingActiveEmphasis('W1', headingDiag('HEADING_DUPLICATE_TEXT') as never, w.heading)
    const active = api().getHeadingCoverageSnapshot(identity, 'W1')!
    expect(active.coveragePolicy).toBe('TITLE_ONLY')
    expect(active.coverageMask).toBe(passive.coverageMask)
    const activeFragments = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-active__fragment'))
      .map(el => ({ left: Number.parseFloat(el.style.left), width: Number.parseFloat(el.style.width) }))
    expect(activeFragments).toHaveLength(passiveRects.length)
    for (let i = 0; i < activeFragments.length; i++) {
      expect(Math.abs(activeFragments[i].left - passiveRects[i].left)).toBeLessThanOrEqual(1)
      expect(Math.abs(activeFragments[i].width - passiveRects[i].width)).toBeLessThanOrEqual(1)
    }
    const counters = api().getHeadingCoverageV514R6Counters()
    expect(counters.bodyPassiveActivePolicyMismatch).toBe(0)
    expect(counters.bodyPassiveActiveTargetRectMismatch).toBe(0)
    expect(counters.bodyPassiveActiveFragmentCountMismatch).toBe(0)
    expect(counters.bodyPassiveActiveCoverageMaskMismatch).toBe(0)
    expect(counters.duplicateHeadingNumberIncluded).toBe(0)
  })

  it('§29 — the OUTLINE projects the SAME policy (TITLE_ONLY / FULL_VISIBLE_HEADING)', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    const published: Array<Record<string, unknown>> = []
    ;(host as unknown as { opts: { providers: Record<string, unknown> } }).opts.providers.publishOutlineHeadingDiagnostics =
      (targets: Array<Record<string, unknown>>) => { published.push(...targets) }
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    expect(published).toHaveLength(1)
    expect(published[0].coveragePolicy).toBe('TITLE_ONLY')
    expect(published[0].coverageMask).toBe(HEADING_COVERAGE_UNNUMBERED)
    // §14 — the outline carries the MASK/policy, never the body rects
    expect(Object.keys(published[0])).not.toContain('bodyPassiveRects')
    expect(Object.keys(published[0])).not.toContain('semanticFragmentRects')
    expect(api().getHeadingCoverageV514R6Counters().bodyOutlinePolicyMismatch).toBe(0)
    expect(api().getHeadingCoverageV514R6Counters().bodyOutlineSemanticCoverageMismatch).toBe(0)
  })

  it('§14/§24 — the reason chip is excluded and the policy audit is emitted', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.reasonChipRect).not.toBeNull()
    expect(snapshot.reasonChipExcluded).toBe(true)
    expect(snapshot.reasonChipRect!.left).toBeGreaterThanOrEqual(snapshot.semanticUnionRect.right)
    expect(api().getHeadingCoverageV514R6Counters().reasonChipIncludedInHeadingTarget).toBe(0)
    // the policy audit is a console line: `EVENT: k=v k=v ...`
    const calls = (infoSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const line = calls.map(c => String(c[0] ?? '')).find(l => l.includes(DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_POLICY_AUDIT_EVENT))
    expect(line).toBeDefined()
    const fields: Record<string, string> = {}
    for (const m of String(line).matchAll(/(\w+)=([^\s]*)/g)) fields[m[1]] = m[2]
    expect(fields.coveragePolicy).toBe('TITLE_ONLY')
    expect(fields.numberIncluded).toBe('false')
    expect(fields.gapIncluded).toBe('false')
    expect(fields.titleIncluded).toBe('true')
    expect(fields.bodyPassivePolicy).toBe('TITLE_ONLY')
    expect(fields.outlinePolicy).toBe('TITLE_ONLY')
    expect(fields.reasonChipExcluded).toBe('true')
    // the R6 coverage audit must report the POLICY-derived inclusion, not the
    // mere presence of the (retained) numberRect/gapRect authority
    const covLine = calls.map(c => String(c[0] ?? '')).find(l => l.includes(DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_AUDIT_EVENT))
    expect(covLine).toBeDefined()
    const cov: Record<string, string> = {}
    for (const m of String(covLine).matchAll(/(\w+)=([^\s]*)/g)) cov[m[1]] = m[2]
    expect(cov.coveragePolicy).toBe('TITLE_ONLY')
    expect(cov.numberVisible).toBe('true')
    expect(cov.bodyPassiveNumberIncluded).toBe('false')
    expect(cov.bodyPassiveGapIncluded).toBe('false')
    expect(cov.bodyPassiveTitleIncluded).toBe('true')
    expect(cov.outlineNumberIncluded).toBe('false')
    expect(cov.outlinePolicy).toBe('TITLE_ONLY')
    expect(cov.decision).toBe('PASS')
  })

  it('F-multiline — a multi-line Duplicate paints one TITLE fragment per line', () => {
    headingBlock = { left: 30, top: 100, right: 830, bottom: 152 }
    const w = makeWorld({ numbered: true })
    host = w.h
    stubRangeRects([
      { left: 70.5, top: 100, right: 830, bottom: 124 },
      { left: 30, top: 128, right: 400, bottom: 152 },
    ])
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const snapshot = api().getHeadingCoverageSnapshot(markerIdentity())!
    expect(snapshot.coveragePolicy).toBe('TITLE_ONLY')
    expect(snapshot.semanticFragmentRects).toHaveLength(2)
    // line 1 = the title line only (starts at 70.5, NOT the number)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(70.5, 3)
    expect(snapshot.semanticFragmentRects[0].right).toBeCloseTo(830, 3)
    // line 2 = its own fragment (the inter-line gap is NEVER painted)
    expect(snapshot.semanticFragmentRects[1].top).toBeCloseTo(128, 3)
    expect(snapshot.semanticFragmentRects[1].bottom).toBeCloseTo(152, 3)
    expect(passiveFragments()).toHaveLength(2)
    expect(api().getHeadingCoverageV514R6Counters().headingBlockFullWidthFallback).toBe(0)
    expect(api().getHeadingCoverageV514R6Counters().duplicateHeadingNonTitleCoverage).toBe(0)
  })

  it('G — a numberTitleSpacing toggle re-measures and never leaves a stale gap rect', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_LEVEL_GAP')])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    expect(api().getHeadingCoverageSnapshot(identity)!.gapRect).not.toBeNull()
    w.heading.setAttribute('data-inkchapter-heading-gap', 'none')
    api().renderHeadingDiagnosticMarkers()
    const after = api().getHeadingCoverageSnapshot(identity)!
    expect(after.gapRect).toBeNull()
    // the FULL paint is still continuous (no hole between the number and the title)
    expect(after.semanticFragmentRects).toHaveLength(1)
    expect(after.semanticFragmentRects[0].left).toBeCloseTo(30, 3)
    expect(after.semanticFragmentRects[0].right).toBeCloseTo(142.5, 3)
    expect(api().getHeadingCoverageV514R6Counters().numberGapVisualDiscontinuity).toBe(0)
    expect(api().getHeadingCoverageV514R6Counters().staleHeadingCoverageAfterGapChange).toBe(0)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })

  it('H — switching a heading from Duplicate to LevelGap changes the policy (stale-policy gate)', () => {
    const w = makeWorld({ numbered: true })
    host = w.h
    inject(host, [headingDiag('HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    expect(api().getHeadingCoverageSnapshot(identity)!.coveragePolicy).toBe('TITLE_ONLY')
    // the SAME diagnosticId now reports a structural problem
    inject(host, [headingDiag('HEADING_LEVEL_GAP')], 2)
    api().renderHeadingDiagnosticMarkers()
    const after = api().getHeadingCoverageSnapshot(identity)!
    expect(after.coveragePolicy).toBe('FULL_VISIBLE_HEADING')
    expect(after.coverageMask).toBe(HEADING_COVERAGE_NUMBERED)
    // a real diagnostic-semantics change must be a rebuild, never a stale paint
    expect(api().getHeadingCoverageV514R6Counters().staleHeadingPolicyAfterDiagnosticChange).toBe(0)
    expect(api().getHeadingCoverageV514R6GateDecision().decision).toBe('PASS')
  })
})
