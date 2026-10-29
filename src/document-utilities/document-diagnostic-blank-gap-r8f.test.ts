// @vitest-environment jsdom
/**
 * R8F — same-text block boundary binding + split/merge cycle regression.
 *
 * ROOT CAUSE this suite locks down (proven by
 * `runtime/evidence/blank-gap-r8f/` audit replay):
 *
 *   THIS Typora build renders business blocks (`<p class="md-end-block md-p">`)
 *   WITHOUT `data-line`. When an edit creates a SECOND paragraph whose visible
 *   text equals an existing one (`啊` → `啊`), `bindGapBlock` collected two text
 *   matches, both ranked `Infinity` by data-line distance, and returned
 *   `ANCHOR_TEXT_AMBIGUOUS`. Both boundaries became `null` →
 *   `resolveRenderedBlankRowsForMeta` returned `null` → every gap in the
 *   document was published as unmeasurable → Drawer empty, group DORMANT,
 *   zero highlight.
 *
 * The fix does NOT widen the search: it consumes the SOURCE occurrence ordinal
 * the scanner already emits (`paragraph:啊#1`) and indexes the document-ordered
 * DOM match list with it. An overflowing ordinal still fails closed.
 *
 * Every item below FAILS before the fix and PASSES after it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { RenderedBlankRowResult } from './document-diagnostic-rendered-blank-row'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'

type Binding = {
  element: HTMLElement | null
  decision: 'BOUND' | 'AMBIGUOUS' | 'MISSING'
  strategy: string
  semanticTextMatch: boolean
}

type Internals = {
  bindGapBoundary(ref: {
    canonicalKind: string | null
    canonicalOrdinal: number | null
    startLine: number | null
    anchorText: string
    blockOrdinal?: number | null
  }): Binding
  sourceOrdinalFromBlockIdentity(identity: unknown): number | null
  resolveRenderedBlankRowsForMeta(meta: Record<string, unknown>): RenderedBlankRowResult | null
  resolveGapBoundaryElementFromMeta(meta: Record<string, unknown>, side: 'previous' | 'next'): HTMLElement | null
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/r8f.md',
      getDocumentKey: () => 'doc:r8f',
      getMarkdown: () => '',
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
    getFormulaVisibleTagTokens: () => [], getFigureName: () => null, getTableName: () => null,
    getCodeName: () => null, getCodeLanguage: () => null, resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false, getHeadingIdentity: () => null, parseLocalLinkTargets: () => [],
  } as unknown as DocumentDiagnosticsProviders
}

function hostOf(): Internals {
  return new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() } as never) as unknown as Internals
}

const blanks = (n: number): string => '\n'.repeat(n + 1)

/** Write the DOM shape this build renders for `markdown` (no `data-line`). */
function mountDom(paragraphs: string[], blanksBetween: number[]): void {
  const root = document.createElement('div')
  root.id = 'write'
  paragraphs.forEach((text, i) => {
    const p = document.createElement('p')
    p.className = 'md-end-block md-p'
    p.textContent = text
    root.appendChild(p)
    const between = blanksBetween[i] ?? 0
    for (let b = 0; b < between; b++) {
      const empty = document.createElement('p')
      empty.className = 'md-end-block md-p'
      root.appendChild(empty)
    }
  })
  document.body.appendChild(root)
}

/** Deterministic positive-height rects so the physical gate can pass. */
function stubRects(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const root = document.getElementById('write')
    const all = root ? Array.from(root.querySelectorAll('*')) : []
    const index = Math.max(0, all.indexOf(this))
    const top = index * 20
    return {
      left: 0, top, right: 200, bottom: top + 18, width: 200, height: 18, x: 0, y: top,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function diagnosticsOf(markdown: string): DocumentDiagnosticsSnapshot['diagnostics'] {
  const input: DocumentDiagnosticsInput = {
    documentKey: 'doc:r8f', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
  }
  return computeDocumentDiagnostics(input).diagnostics.filter(d => d.code === CODE)
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
})

// ── the identity parser ────────────────────────────────────────────────────

describe('R8F — source occurrence ordinal is read from the block identity', () => {
  it('R8F-IDENTITY parses the trailing ordinal and refuses canonical identities', () => {
    const h = hostOf()
    expect(h.sourceOrdinalFromBlockIdentity('paragraph:啊#0')).toBe(0)
    expect(h.sourceOrdinalFromBlockIdentity('paragraph:啊#12')).toBe(12)
    expect(h.sourceOrdinalFromBlockIdentity('heading:标题#3')).toBe(3)
    // canonical object identities carry NO occurrence suffix
    expect(h.sourceOrdinalFromBlockIdentity('block:code:0')).toBeNull()
    expect(h.sourceOrdinalFromBlockIdentity('')).toBeNull()
    expect(h.sourceOrdinalFromBlockIdentity(null)).toBeNull()
    expect(h.sourceOrdinalFromBlockIdentity(42)).toBeNull()
  })
})

// ── the binding ladder ─────────────────────────────────────────────────────

describe('R8F — a same-text block binds by source ordinal, never by first match', () => {
  it('R8F-BIND-1 two identical paragraphs: ordinal 1 binds the SECOND DOM match', () => {
    mountDom(['前段', '啊', '啊', '后段'], [0, 0, 0])
    const h = hostOf()
    const second = document.querySelectorAll('#write > p')[2]
    const b = h.bindGapBoundary({
      canonicalKind: null, canonicalOrdinal: null, startLine: 5, anchorText: '啊', blockOrdinal: 1,
    })
    expect(b.decision).toBe('BOUND')
    expect(b.strategy).toBe('ANCHOR_TEXT_SOURCE_ORDINAL')
    expect(b.element).toBe(second)
  })

  it('R8F-BIND-2 WITHOUT the ordinal the same DOM is AMBIGUOUS (the pre-fix failure)', () => {
    mountDom(['前段', '啊', '啊', '后段'], [0, 0, 0])
    const h = hostOf()
    const b = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 5, anchorText: '啊' })
    expect(b.decision).toBe('AMBIGUOUS')
    expect(b.element).toBeNull()
    expect(h.bindGapBoundary({
      canonicalKind: null, canonicalOrdinal: null, startLine: 5, anchorText: '啊', blockOrdinal: null,
    }).decision).toBe('AMBIGUOUS')
  })

  it('R8F-BIND-3 an overflowing ordinal still fails closed', () => {
    mountDom(['前段', '啊', '啊', '后段'], [0, 0, 0])
    const h = hostOf()
    const b = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 5, anchorText: '啊', blockOrdinal: 3 })
    expect(b.decision).toBe('AMBIGUOUS')
    expect(b.element).toBeNull()
    const neg = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 5, anchorText: '啊', blockOrdinal: -1 })
    expect(neg.decision).toBe('AMBIGUOUS')
  })

  it('R8F-BIND-4 a UNIQUE text still binds through ANCHOR_TEXT_UNIQUE', () => {
    mountDom(['前段', '啊', '后段'], [0, 0])
    const h = hostOf()
    const b = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 3, anchorText: '前段', blockOrdinal: 0 })
    expect(b.decision).toBe('BOUND')
    expect(b.strategy).toBe('ANCHOR_TEXT_UNIQUE')
    expect(b.element).toBe(document.querySelectorAll('#write > p')[0])
  })

  it('R8F-BIND-5 a strictly nearer data-line still wins over the ordinal', () => {
    mountDom(['前段', '啊', '啊', '后段'], [0, 0, 0])
    const all = document.querySelectorAll<HTMLElement>('#write > p')
    all[1].setAttribute('data-line', '40')   // distance 10 from line 50
    all[2].setAttribute('data-line', '9')    // distance 41 from line 50
    const h = hostOf()
    const b = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 50, anchorText: '啊', blockOrdinal: 1 })
    expect(b.decision).toBe('BOUND')
    expect(b.strategy).toBe('ANCHOR_TEXT_NEAREST_LINE')
    expect(b.element).toBe(all[1])
  })

  it('R8F-BIND-6 text mismatch never degrades into an adjacent-block bind', () => {
    mountDom(['前段', '啊', '后段'], [0, 0])
    const h = hostOf()
    const b = h.bindGapBoundary({ canonicalKind: null, canonicalOrdinal: null, startLine: 3, anchorText: '不存在的段落', blockOrdinal: 0 })
    expect(b.decision).toBe('MISSING')
    expect(b.element).toBeNull()
  })
})

// ── end-to-end: the split / merge cycle that used to lose every gap ────────

describe('R8F — split / merge cycle keeps every gap measurable', () => {
  const measureAll = (markdown: string, paragraphs: string[], between: number[]) => {
    mountDom(paragraphs, between)
    stubRects()
    const h = hostOf()
    return diagnosticsOf(markdown).map(d => ({
      identity: String((d as { targetIdentity?: string }).targetIdentity ?? ''),
      result: h.resolveRenderedBlankRowsForMeta((d.metadata ?? {}) as Record<string, unknown>),
    }))
  }

  it('R8F-SPLIT-2 a second-level split (甲 / 啊 / 啊 / 乙) measures ALL three gaps', () => {
    const markdown = `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`
    const rows = measureAll(markdown, ['甲', '啊', '啊', '乙'], [3, 3, 3])
    expect(rows.length).toBe(3)
    // the SECOND `啊` really occurs as a boundary (the same-text case)
    expect(rows.map(r => r.identity).join('|')).toContain('啊#1')
    for (const row of rows) {
      expect(row.result).not.toBeNull()
      expect(row.result!.decision).toBe('VERIFIED')
      expect(row.result!.renderedBlankRowCount).toBe(3)
      expect(row.result!.visibleBlankLineCount).toBe(3)
    }
    // both same-text sides resolved to DIFFERENT physical paragraphs
    const first = rows[0].result!.rows[0].element
    const last = rows[rows.length - 1].result!.rows[0].element
    expect(first).not.toBe(last)
  })

  it('R8F-SPLIT-3 a third-level split (甲 / 啊 / 啊 / 啊 / 乙) keeps all four gaps', () => {
    const markdown = `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`
    const rows = measureAll(markdown, ['甲', '啊', '啊', '啊', '乙'], [3, 3, 3, 3])
    expect(rows.length).toBe(4)
    for (const row of rows) {
      expect(row.result).not.toBeNull()
      expect(row.result!.decision).toBe('VERIFIED')
      expect(row.result!.visibleBlankLineCount).toBe(3)
    }
  })

  it('R8F-SPLIT-4 a fourth-level split (甲 / 啊 ×4 / 乙) keeps all five gaps', () => {
    const markdown = `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`
    const rows = measureAll(markdown, ['甲', '啊', '啊', '啊', '啊', '乙'], [3, 3, 3, 3, 3])
    expect(rows.length).toBe(5)
    for (const row of rows) {
      expect(row.result).not.toBeNull()
      expect(row.result!.decision).toBe('VERIFIED')
    }
  })

  it('R8F-MERGE one level at a time (4 → 3 → 2 → 1) never drops a surviving gap', () => {
    const levels: Array<{ md: string; paragraphs: string[]; between: number[]; gaps: number }> = [
      { md: `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`, paragraphs: ['甲', '啊', '啊', '啊', '乙'], between: [3, 3, 3, 3], gaps: 4 },
      { md: `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`, paragraphs: ['甲', '啊', '啊', '乙'], between: [3, 3, 3], gaps: 3 },
      { md: `甲${blanks(3)}啊${blanks(3)}乙`, paragraphs: ['甲', '啊', '乙'], between: [3, 3], gaps: 2 },
      { md: `甲${blanks(3)}乙`, paragraphs: ['甲', '乙'], between: [3], gaps: 1 },
    ]
    for (const level of levels) {
      const rows = measureAll(level.md, level.paragraphs, level.between)
      expect(rows.length).toBe(level.gaps)
      for (const row of rows) {
        expect(row.result).not.toBeNull()
        expect(row.result!.decision).toBe('VERIFIED')
      }
      document.body.innerHTML = ''
      vi.restoreAllMocks()
    }
  })

  it('R8F-UNDO-REDO returning to a split level re-measures every gap', () => {
    const level2 = `甲${blanks(3)}啊${blanks(3)}乙`
    const level3 = `甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`
    for (const state of [level2, level3, level2, level3]) {
      const paragraphs = state === level2 ? ['甲', '啊', '乙'] : ['甲', '啊', '啊', '乙']
      const between = state === level2 ? [3, 3] : [3, 3, 3]
      const rows = measureAll(state, paragraphs, between)
      expect(rows.length).toBe(state === level2 ? 2 : 3)
      for (const row of rows) {
        expect(row.result).not.toBeNull()
        expect(row.result!.decision).toBe('VERIFIED')
      }
      document.body.innerHTML = ''
      vi.restoreAllMocks()
    }
  })

  it('R8F-INDEPENDENT the boundary binding never depends on an active gap group', () => {
    mountDom(['甲', '啊', '啊', '乙'], [3, 3, 3])
    stubRects()
    const h = hostOf()
    // no group seeded, no click, no snapshot commit — pure document diagnosis
    const meta = (diagnosticsOf(`甲${blanks(3)}啊${blanks(3)}啊${blanks(3)}乙`)[1].metadata ?? {}) as Record<string, unknown>
    const prev = h.resolveGapBoundaryElementFromMeta(meta, 'previous')
    const next = h.resolveGapBoundaryElementFromMeta(meta, 'next')
    expect(prev).not.toBeNull()
    expect(next).not.toBeNull()
    expect(prev).not.toBe(next)
    const rows = h.resolveRenderedBlankRowsForMeta(meta)
    expect(rows).not.toBeNull()
    expect(rows!.decision).toBe('VERIFIED')
  })

  it('R8F-NO-DATA-LINE the fixture really has no data-line (the premise of the bug)', () => {
    mountDom(['甲', '啊', '啊', '乙'], [3, 3, 3])
    const all = Array.from(document.querySelectorAll<HTMLElement>('#write > p'))
    expect(all.length).toBeGreaterThan(0)
    expect(all.every(p => p.getAttribute('data-line') == null)).toBe(true)
  })
})
