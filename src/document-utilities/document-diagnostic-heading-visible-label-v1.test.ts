// @vitest-environment jsdom
/**
 * Heading Visible Label Coverage V1 — targeted tests (§22).
 *
 * The product contract this round fixes:
 *
 *   Markdown source      `## 小节`      -> SOURCE identity `小节`
 *   InkChapter runtime   `一、小节`      -> VISUAL coverage `[一、小节]`
 *   reason chip          `一、小节 [原因]` -> `[一、小节] [原因]`
 *
 * Pure contract + real host wiring + the fixture contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT,
  HEADING_VISIBLE_LABEL_RENUMBER_AUDIT_EVENT,
  HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS,
  HEADING_VISIBLE_LABEL_V1_COVERAGE_LABELS,
  HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS,
  HEADING_VISIBLE_LABEL_V1_GATE_KEYS,
  HEADING_VISIBLE_LABEL_V1_GATE_LABELS,
  applyHeadingVisibleLabelCoverageFailure,
  classifyHeadingNumberStyle,
  createHeadingVisibleLabelV1Counters,
  createHeadingVisibleLabelV1Coverage,
  evaluateHeadingVisibleLabelCoverage,
  evaluateHeadingVisibleLabelRenumber,
  evaluateHeadingVisibleLabelV1Coverage,
  evaluateHeadingVisibleLabelV1Gates,
  formatHeadingVisibleLabelV1CoverageReport,
  formatHeadingVisibleLabelV1GateReport,
  noteHeadingVisibleLabelCoverage,
  type HeadingVisibleLabelCoverageFacts,
  type HeadingVisibleLabelRenumberFacts,
} from './document-diagnostic-heading-visible-label-v1'

const FIXTURE_PATH = 'test/vault/runtime/smoke/Heading-Visible-Label-Coverage-Test.md'
const R1_FIXTURE_PATH = 'test/vault/runtime/smoke/VNext-Headings-Only-No-Body-H1H2H3.md'

function baseFacts(overrides: Partial<HeadingVisibleLabelCoverageFacts> = {}): HeadingVisibleLabelCoverageFacts {
  return {
    documentKey: 'doc:key',
    diagnosticId: 'W1',
    diagnosticCode: 'DOCUMENT_HEADINGS_ONLY_NO_BODY',
    headingStableIdentity: 'id:H2:line:3',
    headingLevel: '2',
    canonicalSourceText: '小节',
    generatedNumberPrefix: '一、',
    visibleTitleText: '小节',
    sourceIdentityIncludesNumbering: false,
    visualCoverageIncludesNumbering: true,
    visualCoverageIncludesTitle: true,
    reasonChipPresent: true,
    reasonChipIncludedInCoverage: false,
    semanticTargetCount: 1,
    visualFragmentCount: 1,
    coverageSpansUnrelatedBlock: false,
    coverageIncludesUnrelatedUi: false,
    scrollAnchorIsCanonicalHeadingBlock: true,
    ...overrides,
  }
}

// ── §1/§2/§5 — pure contract ────────────────────────────────────────────────

describe('V1 §5/§16 — the rendered number STYLE classification', () => {
  it('classifies Chinese / Decimal / Roman / multi-level / none', () => {
    expect(classifyHeadingNumberStyle('一、')).toBe('chinese')
    expect(classifyHeadingNumberStyle('二、')).toBe('chinese')
    expect(classifyHeadingNumberStyle('1.1')).toBe('decimal')
    expect(classifyHeadingNumberStyle('1')).toBe('decimal')
    expect(classifyHeadingNumberStyle('II')).toBe('roman')
    expect(classifyHeadingNumberStyle('IV.')).toBe('roman')
    expect(classifyHeadingNumberStyle('2.3.1')).toBe('multi-level')
    expect(classifyHeadingNumberStyle('')).toBe('none')
    expect(classifyHeadingNumberStyle(null)).toBe('none')
    expect(classifyHeadingNumberStyle(undefined)).toBe('none')
  })
})

describe('V1 §1/§2/§14 — the visible-label coverage decision', () => {
  it('PASSes the current screenshot: number + title covered, chip excluded', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts())
    expect(verdict.decision).toBe('PASS')
    expect(verdict.reason).toBe('VISIBLE_HEADING_LABEL_COVERAGE_CLOSED')
    expect(verdict.failedChecks).toEqual([])
  })

  it('FAILs when the auto number entered the source identity', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ sourceIdentityIncludesNumbering: true }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY')
  })

  it('FAILs a numbered heading whose coverage omits the number prefix (一、[小节])', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ visualCoverageIncludesNumbering: false }))
    expect(verdict.decision).toBe('FAIL')
    expect(verdict.failedChecks).toContain('MISSING_NUMBER_PREFIX')
  })

  it('FAILs when the title text is not covered', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ visualCoverageIncludesTitle: false }))
    expect(verdict.failedChecks).toContain('MISSING_TITLE_TEXT')
  })

  it('FAILs when the reason chip is inside the coverage', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ reasonChipIncludedInCoverage: true }))
    expect(verdict.failedChecks).toContain('REASON_CHIP_INCLUDED')
  })

  it('FAILs a scroll anchor that is not the canonical heading block', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ scrollAnchorIsCanonicalHeadingBlock: false }))
    expect(verdict.failedChecks).toContain('SCROLL_ANCHOR_NOT_HEADING_BLOCK')
  })

  it('FAILs a coverage spanning an unrelated block', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ coverageSpansUnrelatedBlock: true }))
    expect(verdict.failedChecks).toContain('COVERAGE_SPANS_UNRELATED_BLOCK')
  })

  it('§6 — H1 numbering OFF needs no number: the title alone is a PASS', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({
      headingLevel: '1', generatedNumberPrefix: null, visualCoverageIncludesNumbering: false,
    }))
    expect(verdict.decision).toBe('PASS')
  })

  it('§8 — a multiline heading may paint more fragments than semantic targets', () => {
    const verdict = evaluateHeadingVisibleLabelCoverage(baseFacts({ visualFragmentCount: 3 }))
    expect(verdict.decision).toBe('PASS')
  })
})

describe('V1 §15/§16 — the renumber / style-switch decision', () => {
  function renumberFacts(overrides: Partial<HeadingVisibleLabelRenumberFacts> = {}): HeadingVisibleLabelRenumberFacts {
    return {
      diagnosticIdBefore: 'W1',
      diagnosticIdAfter: 'W1',
      headingStableIdentityBefore: 'id:H2:line:3',
      headingStableIdentityAfter: 'id:H2:line:3',
      canonicalSourceTextBefore: '小节',
      canonicalSourceTextAfter: '小节',
      numberPrefixBefore: '一、',
      numberPrefixAfter: '二、',
      visualCoverageBefore: '一、小节',
      visualCoverageAfter: '二、小节',
      staleFragmentCount: 0,
      ...overrides,
    }
  }

  it('PASSes a sibling insert (一、→二、): identity kept, coverage refreshed', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts())
    expect(verdict.decision).toBe('PASS')
    expect(verdict.prefixRefreshed).toBe(true)
  })

  it('FAILs when the diagnostic id moved with the auto number', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts({ diagnosticIdAfter: 'W2' }))
    expect(verdict.failedChecks).toContain('DIAGNOSTIC_ID_CHANGED_ONLY_BY_AUTO_NUMBER')
  })

  it('FAILs when the heading source identity moved with the renumber', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts({ headingStableIdentityAfter: 'id:H2:line:9' }))
    expect(verdict.failedChecks).toContain('HEADING_SOURCE_IDENTITY_CHANGED_ONLY_BY_RENUMBER')
  })

  it('FAILs a stale number-prefix fragment', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts({ staleFragmentCount: 1 }))
    expect(verdict.failedChecks).toContain('STALE_HEADING_NUMBERING_ACTIVE_FRAGMENT')
  })

  it('FAILs a visible coverage that never refreshed', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts({ visualCoverageAfter: '一、小节' }))
    expect(verdict.failedChecks).toContain('VISIBLE_COVERAGE_NOT_REFRESHED')
  })

  it('PASSes a numbering style switch (一、→1.1)', () => {
    const verdict = evaluateHeadingVisibleLabelRenumber(renumberFacts({
      numberPrefixAfter: '1.1', visualCoverageAfter: '1.1 小节',
    }))
    expect(verdict.decision).toBe('PASS')
    expect(verdict.prefixRefreshed).toBe(true)
  })
})

describe('V1 §23/§24 — the gate + coverage authorities', () => {
  it('declares every gate with its label and starts at 0', () => {
    const counters = createHeadingVisibleLabelV1Counters()
    expect(HEADING_VISIBLE_LABEL_V1_GATE_KEYS).toHaveLength(22)
    expect(formatHeadingVisibleLabelV1GateReport(counters)).toHaveLength(22)
    expect(evaluateHeadingVisibleLabelV1Gates(counters).decision).toBe('PASS')
    expect(HEADING_VISIBLE_LABEL_V1_GATE_LABELS.autoNumberPrefixEnteredSemanticIdentity)
      .toBe('AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY_COUNT')
    expect(HEADING_VISIBLE_LABEL_V1_GATE_LABELS.headingActiveCoverageMissingNumberPrefix)
      .toBe('HEADING_ACTIVE_COVERAGE_MISSING_NUMBER_PREFIX_COUNT')
    expect(HEADING_VISIBLE_LABEL_V1_GATE_LABELS.headingReasonChipIncludedInActiveCoverage)
      .toBe('HEADING_REASON_CHIP_INCLUDED_IN_ACTIVE_COVERAGE_COUNT')
    expect(HEADING_VISIBLE_LABEL_V1_GATE_LABELS.drawerViewportRegression)
      .toBe('DRAWER_VIEWPORT_REGRESSION_COUNT')
  })

  it('folds a failed coverage decision into the right gate counters', () => {
    const counters = createHeadingVisibleLabelV1Counters()
    applyHeadingVisibleLabelCoverageFailure(counters, [
      'MISSING_NUMBER_PREFIX', 'REASON_CHIP_INCLUDED', 'NOT_A_GATE',
    ])
    expect(counters.headingActiveCoverageMissingNumberPrefix).toBe(1)
    expect(counters.headingReasonChipIncludedInActiveCoverage).toBe(1)
    expect(evaluateHeadingVisibleLabelV1Gates(counters).decision).toBe('FAIL')
  })

  it('§24 — the positive coverage requires the documented minimums', () => {
    const coverage = createHeadingVisibleLabelV1Coverage()
    expect(HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS).toHaveLength(7)
    expect(formatHeadingVisibleLabelV1CoverageReport(coverage)).toHaveLength(7)
    expect(evaluateHeadingVisibleLabelV1Coverage(coverage).decision).toBe('FAIL')
    expect(evaluateHeadingVisibleLabelV1Coverage(coverage).unmet.length).toBe(7)
    expect(HEADING_VISIBLE_LABEL_V1_COVERAGE_LABELS.visibleLabelWithNumber)
      .toBe('HEADING_VISIBLE_LABEL_WITH_NUMBER_RUNTIME_COUNT')
    expect(HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS.dynamicRenumberVisualRefresh).toBe(2)
    for (let i = 0; i < HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS.visibleLabelWithNumber; i++) {
      noteHeadingVisibleLabelCoverage(coverage, { numberPrefix: '一、', visualFragmentCount: 1 })
    }
    noteHeadingVisibleLabelCoverage(coverage, { numberPrefix: '1.1', visualFragmentCount: 2 })
    noteHeadingVisibleLabelCoverage(coverage, { numberPrefix: 'II', visualFragmentCount: 1 })
    expect(coverage.chineseNumberActiveCoverage).toBe(4)
    expect(coverage.decimalNumberActiveCoverage).toBe(1)
    expect(coverage.romanNumberActiveCoverage).toBe(1)
    expect(coverage.multilineVisibleLabel).toBe(1)
  })

  it('§17 — the visible-label refresh path contains no timer / polling', () => {
    const sources = [
      'src/document-utilities/document-diagnostic-heading-visible-label-v1.ts',
      'src/document-utilities/document-diagnostic-heading-coverage-v514-r6.ts',
    ].map(p => readFileSync(p, 'utf8')).join('\n')
    expect(sources).not.toMatch(/setInterval|requestAnimationFrame|setTimeout/)
  })
})

// ── §21 — the fixture contract ──────────────────────────────────────────────

describe('V1 §21 — the runtime fixture contract', () => {
  const md = readFileSync(FIXTURE_PATH, 'utf8')
  const r1 = readFileSync(R1_FIXTURE_PATH, 'utf8')

  it('covers the no-number / Chinese / long / empty / level-gap / duplicate cases', () => {
    expect(md).toContain('# Heading Visible Label Coverage 测试夹具')
    expect(md).toContain('## 小节')
    expect(md).toContain('### 参数估计')
    expect(md).toContain('## 这是一个非常长的标题')
    expect(md).toContain('#### 跳级标题')
    expect(md).toContain('## 动态重编号用例 A')
    expect(md).toContain('## 动态重编号用例 B')
  })

  it('carries the duplicate source titles (auto numbering must not mask them)', () => {
    const methods = md.split('\n').filter(l => l.trim() === '## 方法').length
    const sections = md.split('\n').filter(l => l.trim() === '## 小节').length
    expect(methods).toBe(2)
    expect(sections).toBe(2)
  })

  it('carries an EMPTY heading (auto numbering must not make it non-empty)', () => {
    expect(md.split('\n').some(l => /^##\s*$/.test(l))).toBe(true)
  })

  it('is NOT headings-only (so the doc-level headings-only rule cannot mask the cases)', () => {
    expect(md).toContain('正文段落')
  })

  it('§19 — the R1 fixture is the headings-only document from the current screenshot', () => {
    expect(r1.startsWith('# 形状夹具')).toBe(true)
    expect(r1).toContain('## 小节一')
  })
})

// ── host wiring ─────────────────────────────────────────────────────────────

interface Rect { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, get: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const r = get()
      return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }
    },
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
function stubRaf(): void {
  ;(globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
    ((cb: (t: number) => void) => { cb(0); return 1 }) as unknown as (cb: (t: number) => void) => number
  ;(globalThis as unknown as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame = () => { /* noop */ }
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
  renderHeadingActiveEmphasisForTest(id: string, diag: unknown, el: HTMLElement): void
  getHeadingCoverageSnapshot(identity: string, diagnosticId?: string): { coverageMask: number; semanticFragmentRects: Array<{ left: number; top: number; right: number; bottom: number }> } | null
  getHeadingVisibleLabelV1GateReport(): string[]
  getHeadingVisibleLabelV1GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getHeadingVisibleLabelV1CoverageReport(): string[]
  getHeadingVisibleLabelV1Coverage(): Record<string, number>
  getHeadingVisibleLabelV1Counters(): Record<string, number>
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void; mock: { calls: unknown[][] } } | null = null

function auditLines(event: string): Array<Record<string, string>> {
  const calls = infoSpy?.mock.calls ?? []
  return calls
    .map(c => String(c[0] ?? ''))
    .filter(line => line.includes(event))
    .map(line => {
      const fields: Record<string, string> = {}
      for (const m of line.matchAll(/(\w+)=([^\s]*)/g)) fields[m[1]] = m[2]
      return fields
    })
}

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
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as {
    mockRestore: () => void; mock: { calls: unknown[][] }
  }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/** ONE diagnosed heading whose numbering decoration can be toggled at runtime. */
function makeWorld(input: { tag?: string; number?: string | null; gap?: 'space' | 'none' }): {
  h: DocumentUtilityOverlayHost
  heading: HTMLElement
} {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const heading = document.createElement(input.tag ?? 'h2')
  heading.setAttribute('data-id', 'H-A')
  heading.setAttribute('data-line', '4')
  heading.textContent = '小节'
  if (input.number != null && input.number !== '') {
    heading.setAttribute('data-inkchapter-heading-number', input.number)
    heading.setAttribute('data-inkchapter-heading-gap', input.gap ?? 'none')
  }
  write.appendChild(heading)
  stubRect(heading, () => headingBlock)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, heading }
}
function headingDiag(code = 'DOCUMENT_HEADINGS_ONLY_NO_BODY', id = 'W1'): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity: 'info', category: 'document',
    code, message: '文档只有标题结构', detail: '', metadata: { reasonChip: false },
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 0, infoCount: diags.length,
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
const activeFragments = (): Array<{ left: number; width: number }> =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-active__fragment'))
    .map(el => ({ left: Number.parseFloat(el.style.left), width: Number.parseFloat(el.style.width) }))

describe('V1 §19/§20 — ACTIVE visible-label coverage (host wiring)', () => {
  it('R1/R2 — Chinese `一、` + title are covered as ONE text-tight fragment', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    const snapshot = api().getHeadingCoverageSnapshot(identity, 'W1')!
    expect(snapshot.semanticFragmentRects).toHaveLength(1)
    expect(snapshot.semanticFragmentRects[0].left).toBeCloseTo(30, 3)
    expect(snapshot.semanticFragmentRects[0].right).toBeCloseTo(142.5, 3)
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    const painted = activeFragments()
    expect(painted).toHaveLength(1)
    // the painted fragment is DOM-rounded (Math.round) — allow ±1px
    expect(Math.abs(painted[0].left - 30)).toBeLessThanOrEqual(1)
    expect(Math.abs(painted[0].width - 112.5)).toBeLessThanOrEqual(1)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    expect(audits.length).toBeGreaterThanOrEqual(1)
    const last = audits[audits.length - 1]
    expect(last.generatedNumberPrefix).toBe('一、')
    expect(last.sourceIdentityIncludesNumbering).toBe('false')
    expect(last.visualCoverageIncludesNumbering).toBe('true')
    expect(last.visualCoverageIncludesTitle).toBe('true')
    expect(last.visibleLabelText).toBe('一、小节')
    expect(last.decision).toBe('PASS')
    expect(api().getHeadingVisibleLabelV1Coverage().chineseNumberActiveCoverage).toBeGreaterThanOrEqual(1)
    expect(api().getHeadingVisibleLabelV1GateDecision().decision).toBe('PASS')
  })

  it('R5/R7 — an UNNUMBERED heading covers the title alone (H1 numbering OFF)', () => {
    const w = makeWorld({ tag: 'h1', number: null })
    host = w.h
    inject(host, [headingDiag('DOCUMENT_HEADING_ONLY_NO_BODY')])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag('DOCUMENT_HEADING_ONLY_NO_BODY') as never, w.heading)
    const painted = activeFragments()
    expect(painted).toHaveLength(1)
    expect(Math.abs(painted[0].left - 70.5)).toBeLessThanOrEqual(1)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    const last = audits[audits.length - 1]
    expect(last.generatedNumberPrefix).toBe('null')
    expect(last.visualCoverageIncludesNumbering).toBe('false')
    expect(last.visualCoverageIncludesTitle).toBe('true')
    expect(last.decision).toBe('PASS')
  })

  it('R14 — the reason chip is excluded from the ACTIVE coverage', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    const diag = headingDiag('HEADING_LEVEL_GAP')
    // force the ONE reason-chip authority to paint a real chip
    ;(diag.metadata as Record<string, unknown>).reasonChip = true
    inject(host, [diag])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', diag as never, w.heading)
    expect(api().getHeadingVisibleLabelV1Counters().headingReasonChipIncludedInActiveCoverage).toBe(0)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    const last = audits[audits.length - 1]
    expect(last.reasonChipPresent).toBe('true')
    expect(last.reasonChipIncludedInCoverage).toBe('false')
    expect(last.decision).toBe('PASS')
  })

  it('§7 — a MULTILINE heading paints the number band + one fragment per line', () => {
    headingBlock = { left: 30, top: 100, right: 830, bottom: 152 }
    const w = makeWorld({ number: '2.3.1' })
    host = w.h
    stubRangeRects([
      { left: 70.5, top: 100, right: 830, bottom: 124 },
      { left: 30, top: 128, right: 400, bottom: 152 },
    ])
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    const painted = activeFragments()
    expect(painted).toHaveLength(2)
    expect(painted[0].left).toBeCloseTo(30, 0)
    expect(api().getHeadingVisibleLabelV1Coverage().multilineVisibleLabel).toBeGreaterThanOrEqual(1)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    const last = audits[audits.length - 1]
    expect(last.visualFragmentCount).toBe('2')
    expect(last.semanticTargetCount).toBe('1')
    expect(last.decision).toBe('PASS')
  })
})

describe('V1 §15/§16 — dynamic renumber + style switch (host wiring)', () => {
  it('R8/R9 — a sibling insert (一、→二、) and delete (二、→一、) never move the identity', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    const identity = markerIdentity()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    // R8 — the numbering controller stamps the NEW prefix after the sibling insert
    w.heading.setAttribute('data-inkchapter-heading-number', '二、')
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    const afterInsert = auditLines(HEADING_VISIBLE_LABEL_RENUMBER_AUDIT_EVENT)
    expect(afterInsert.length).toBeGreaterThanOrEqual(1)
    const insert = afterInsert[0]
    expect(insert.numberPrefixBefore).toBe('一、')
    expect(insert.numberPrefixAfter).toBe('二、')
    expect(insert.diagnosticIdBefore).toBe(insert.diagnosticIdAfter)
    expect(insert.headingStableIdentityBefore).toBe(insert.headingStableIdentityAfter)
    expect(insert.canonicalSourceTextAfter).toBe('小节')
    expect(insert.prefixRefreshed).toBe('true')
    expect(insert.staleFragmentCount).toBe('0')
    expect(insert.decision).toBe('PASS')
    // R9 — deleting the sibling rolls the prefix back 二、→一、
    w.heading.setAttribute('data-inkchapter-heading-number', '一、')
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    const afterDelete = auditLines(HEADING_VISIBLE_LABEL_RENUMBER_AUDIT_EVENT)
    const del = afterDelete[afterDelete.length - 1]
    expect(del.numberPrefixBefore).toBe('二、')
    expect(del.numberPrefixAfter).toBe('一、')
    expect(del.decision).toBe('PASS')
    expect(del.staleFragmentCount).toBe('0')
    expect(identity).not.toBe('')
    expect(markerIdentity()).toBe(identity)
    expect(api().getHeadingVisibleLabelV1Coverage().dynamicRenumberVisualRefresh).toBeGreaterThanOrEqual(2)
    expect(api().getHeadingVisibleLabelV1Counters().staleHeadingNumberingActiveFragment).toBe(0)
  })

  it('R10 — a Chinese → Decimal → Roman style switch refreshes the coverage each time', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    for (const prefix of ['1.1', 'II']) {
      w.heading.setAttribute('data-inkchapter-heading-number', prefix)
      api().renderHeadingDiagnosticMarkers()
      api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    }
    const coverage = api().getHeadingVisibleLabelV1Coverage()
    expect(coverage.chineseNumberActiveCoverage).toBeGreaterThanOrEqual(1)
    expect(coverage.decimalNumberActiveCoverage).toBeGreaterThanOrEqual(1)
    expect(coverage.romanNumberActiveCoverage).toBeGreaterThanOrEqual(1)
    expect(coverage.dynamicRenumberVisualRefresh).toBeGreaterThanOrEqual(2)
    for (const audit of auditLines(HEADING_VISIBLE_LABEL_RENUMBER_AUDIT_EVENT)) {
      expect(audit.decision).toBe('PASS')
      expect(audit.staleFragmentCount).toBe('0')
    }
    expect(api().getHeadingVisibleLabelV1GateDecision().decision).toBe('PASS')
  })

  it('R6/R7 — an H1 numbering OFF → ON toggle refreshes the visible label', () => {
    const w = makeWorld({ tag: 'h1', number: null })
    host = w.h
    inject(host, [headingDiag('DOCUMENT_HEADING_ONLY_NO_BODY')])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag('DOCUMENT_HEADING_ONLY_NO_BODY') as never, w.heading)
    w.heading.setAttribute('data-inkchapter-heading-number', '一、')
    w.heading.setAttribute('data-inkchapter-heading-gap', 'none')
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag('DOCUMENT_HEADING_ONLY_NO_BODY') as never, w.heading)
    expect(api().getHeadingVisibleLabelV1Coverage().h1NumberingToggleVisualRefresh).toBeGreaterThanOrEqual(1)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    const last = audits[audits.length - 1]
    expect(last.generatedNumberPrefix).toBe('一、')
    expect(last.visibleLabelText).toBe('一、小节')
    expect(last.decision).toBe('PASS')
  })

  it('§1/§12 — the SOURCE text stays the Markdown title while the visible label grows', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('W1', headingDiag() as never, w.heading)
    const audits = auditLines(HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT)
    const last = audits[audits.length - 1]
    expect(last.canonicalSourceText).toBe('小节')
    expect(last.sourceIdentityIncludesNumbering).toBe('false')
    expect(last.visibleLabelText).toBe('一、小节')
    expect(api().getHeadingVisibleLabelV1Counters().autoNumberPrefixEnteredSemanticIdentity).toBe(0)
    expect(api().getHeadingVisibleLabelV1Counters().autoNumberPrefixMaskedDuplicateHeadingText).toBe(0)
    expect(api().getHeadingVisibleLabelV1Counters().autoNumberPrefixReportedAsManualNumber).toBe(0)
    expect(api().getHeadingVisibleLabelV1Counters().duplicateHeadingVisibleLabelResolver).toBe(0)
    expect(api().getHeadingVisibleLabelV1Counters().numberingFragmentCountedAsSemanticTarget).toBe(0)
  })

  it('§18 — the Drawer viewport / Toolbar / Target Group gates observe this round too', () => {
    const w = makeWorld({ number: '一、' })
    host = w.h
    inject(host, [headingDiag()])
    api().renderHeadingDiagnosticMarkers()
    const counters = api().getHeadingVisibleLabelV1Counters()
    expect(counters.drawerViewportRegression).toBe(0)
    expect(counters.targetGroupRegression).toBe(0)
    expect(counters.toolbarSeveritySummaryRegression).toBe(0)
    expect(api().getHeadingVisibleLabelV1GateReport()).toHaveLength(22)
  })
})
