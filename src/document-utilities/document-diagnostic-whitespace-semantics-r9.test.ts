// @vitest-environment jsdom
/**
 * R9 — Blank-gap whitespace semantics.
 *
 * THE DEFECT THIS SUITE LOCKS DOWN
 *
 * Typora renders an empty paragraph as `<p><br></p>`. Once the user types only
 * SPACES into it, Typora serializes that block back to Markdown as a line that
 * holds a single U+200B ZERO WIDTH SPACE.
 *
 * `String.prototype.trim()` strips U+0020 / Tab / U+00A0 / U+FEFF but NOT U+200B,
 * so before this fix the chain disagreed with itself:
 *
 *   source scanner `isBlank(U+200B)`          → false → the phantom line CUT a
 *                                               6-blank run into 3 + 2
 *   anchor projection (`normalizeSourceAnchorText`) → '' → NO_TEXT_ANCHOR
 *   rendered row (`\s+`)                      → '\u200B' survived → not a row
 *
 * Result: both halves were published as unmeasurable (`publish=false`) and the
 * still-violating region vanished from Drawer + highlight while the user only
 * typed spaces.
 *
 * Every item below FAILS before the fix and PASSES after it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  hasInvisiblePlaceholderChars,
  isWhitespaceOnlyText,
  stripInvisiblePlaceholderChars,
} from './document-diagnostic-whitespace-semantics-v1'
import { analyzeInternalBlankLineGaps, internalBlankGapIdentity } from './document-diagnostic-internal-blank-lines-v1'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import {
  normalizeRenderedRowText,
  isEditableBusinessRowElement,
  classifyRenderedRowCandidate,
  resolveRenderedBlankRows,
  type RenderedBlankRowResult,
} from './document-diagnostic-rendered-blank-row'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

const CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
const ZWSP = '\u200B'
const blanks = (n: number): string => '\n'.repeat(n + 1)

// ── shared harness ─────────────────────────────────────────────────────────

type Internals = {
  resolveRenderedBlankRowsForMeta(meta: Record<string, unknown>): RenderedBlankRowResult | null
  resolveGapBoundaryElementFromMeta(meta: Record<string, unknown>, side: 'previous' | 'next'): HTMLElement | null
  bindGapBoundary(ref: {
    canonicalKind: string | null
    canonicalOrdinal: number | null
    startLine: number | null
    anchorText: string
    blockOrdinal?: number | null
  }): { element: HTMLElement | null; decision: 'BOUND' | 'AMBIGUOUS' | 'MISSING'; strategy: string }
}

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/r9.md',
      getDocumentKey: () => 'doc:r9',
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

function diagnosticsOf(markdown: string): DocumentDiagnosticsSnapshot['diagnostics'] {
  const input: DocumentDiagnosticsInput = {
    documentKey: 'doc:r9', markdown, strictMode: true, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [], h1Facts: null,
  }
  return computeDocumentDiagnostics(input).diagnostics.filter(d => d.code === CODE)
}

/** Build `#write` from paragraph texts; `gapBefore[i]` empty `<p>` rows before paragraph i. */
function mountDom(paragraphs: string[], gapBefore: number[]): void {
  const root = document.createElement('div')
  root.id = 'write'
  paragraphs.forEach((text, i) => {
    const count = gapBefore[i] ?? 0
    for (let k = 0; k < count; k++) {
      const empty = document.createElement('p')
      empty.className = 'md-end-block md-p'
      root.appendChild(empty)
    }
    const p = document.createElement('p')
    p.className = 'md-end-block md-p'
    p.textContent = text
    root.appendChild(p)
  })
  document.body.appendChild(root)
}

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

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', (() => {}) as typeof cancelAnimationFrame)
})

// ── the shared contract ────────────────────────────────────────────────────

describe('R9-03 — ONE whitespace contract across the chain', () => {
  it('R9-03a every blank-ish code point is whitespace-only', () => {
    const cases = ['', ' ', '   ', '\t', '\u00A0', '\u3000', ZWSP, '\u200C', '\u200D', '\uFEFF', '\u2060', ZWSP + '   ']
    for (const text of cases) {
      expect(isWhitespaceOnlyText(text), `codepoints of ${JSON.stringify(text)}`).toBe(true)
    }
  })

  it('R9-03b JS trim() alone is NOT enough (the exact pre-fix gap)', () => {
    // the premise of the defect: trim keeps U+200B
    expect(ZWSP.trim() === '').toBe(false)
    expect(isWhitespaceOnlyText(ZWSP)).toBe(true)
    expect(hasInvisiblePlaceholderChars(ZWSP)).toBe(true)
    expect(stripInvisiblePlaceholderChars(ZWSP + 'a' + ZWSP)).toBe('a')
  })

  it('R9-03c real content and Markdown syntax are never flattened', () => {
    for (const text of ['a', '# 标题', '- item', '    code', '| a | b |', 'a' + ZWSP]) {
      expect(isWhitespaceOnlyText(text), text).toBe(false)
    }
  })
})

// ── source scanning ────────────────────────────────────────────────────────

describe('R9-01/02/03 — a spaces-only paragraph never cuts a blank run', () => {
  it('R9-01 six plain blank lines produce exactly ONE gap', () => {
    const md = `A${blanks(6)}B`
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps.length).toBe(1)
    expect(gaps[0].actualBlankLines).toBe(6)
  })

  it('R9-02 a U+200B line inside the run still yields ONE gap with the full count', () => {
    // `\u200B` is what Typora writes for a paragraph that only holds spaces.
    const md = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps.length).toBe(1)
    expect(gaps[0].actualBlankLines).toBe(6)
  })

  it('R9-02b 1/2/3/4/8/16 spaces typed into the empty row never split the run', () => {
    for (const n of [1, 2, 3, 4, 8, 16]) {
      const md = `A${blanks(3)}${ZWSP}${' '.repeat(n)}${blanks(2)}B`
      const gaps = analyzeInternalBlankLineGaps(md)
      expect(gaps.length, `spaces=${n}`).toBe(1)
      expect(gaps[0].actualBlankLines, `spaces=${n}`).toBe(6)
    }
  })

  it('R9-03b Tab / NBSP / FEFF placeholder rows also keep the run whole', () => {
    for (const filler of ['\t', '\u00A0', '\uFEFF', '\u200B\u200B']) {
      const md = `A${blanks(3)}${filler}${blanks(2)}B`
      const gaps = analyzeInternalBlankLineGaps(md)
      expect(gaps.length, `filler=${JSON.stringify(filler)}`).toBe(1)
      expect(gaps[0].actualBlankLines).toBe(6)
    }
  })

  it('R9-03c a U+200B placeholder never produces a phantom boundary identity', () => {
    const md = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps[0].previousBlockAnchorText).toBe('A')
    expect(gaps[0].nextBlockAnchorText).toBe('B')
    // no block identity derived from the invisible placeholder
    expect(gaps[0].nextBlockIdentity).not.toContain(ZWSP)
  })

  it('R9-11 fenced code / list / table interiors keep their Markdown semantics', () => {
    // blank line INSIDE a fence stays protected content, never a gap
    const fence = ['```', 'a', '', '', 'b', '```', '', 'C'].join('\n')
    expect(analyzeInternalBlankLineGaps(fence).length).toBe(0)
    // a U+200B line inside a fence is also just content
    const fenceZw = ['```', 'a', ZWSP, ZWSP, 'b', '```', '', 'C'].join('\n')
    expect(analyzeInternalBlankLineGaps(fenceZw).length).toBe(0)
    // a loose list keeps its container semantics
    const loose = ['- a', '', '', '', '- b'].join('\n')
    expect(analyzeInternalBlankLineGaps(loose).length).toBe(0)
  })

  it('R9-12 a trailing single blank line is never an internal gap', () => {
    const md = `A${blanks(6)}B\n`
    expect(analyzeInternalBlankLineGaps(md).length).toBe(1)
    const onlyTrailing = `A\n`
    expect(analyzeInternalBlankLineGaps(onlyTrailing).length).toBe(0)
    const trailingZw = `A${blanks(6)}B\n${ZWSP}\n`
    expect(analyzeInternalBlankLineGaps(trailingZw).length).toBe(1)
  })
})

// ── rendered row semantics ─────────────────────────────────────────────────

describe('R9-02d — the DOM side agrees with the source side', () => {
  it('R9-02d a paragraph holding only U+200B / spaces normalizes to empty', () => {
    expect(normalizeRenderedRowText(ZWSP)).toBe('')
    expect(normalizeRenderedRowText(` ${ZWSP}  `)).toBe('')
    expect(normalizeRenderedRowText('\u00A0')).toBe('')
    expect(normalizeRenderedRowText('a' + ZWSP)).toBe('a')
  })

  it('R9-02e such a paragraph is a real editable business row', () => {
    const p = document.createElement('p')
    p.className = 'md-end-block md-p'
    p.textContent = ZWSP
    document.body.appendChild(p)
    stubRects()
    expect(isEditableBusinessRowElement(p)).toBe(true)
    const cls = classifyRenderedRowCandidate(p, el => {
      const r = el.getBoundingClientRect()
      return { left: 0, top: 0, right: r.width, bottom: r.height, width: r.width, height: r.height }
    })
    expect(cls.blankText).toBe(true)
    expect(cls.candidateBlankRow).toBe(true)
  })

  it('R9-02f six blank rows + one U+200B row all count as rendered rows', () => {
    mountDom(['A', ZWSP, 'B'], [0, 3, 2])
    stubRects()
    const root = document.getElementById('write')!
    const all = Array.from(document.querySelectorAll<HTMLElement>('#write > p'))
    const a = all[0]
    const zw = all[4]
    const b = all[7]
    expect(a.textContent).toBe('A')
    expect(zw.textContent).toBe(ZWSP)
    expect(b.textContent).toBe('B')
    const result = resolveRenderedBlankRows({
      businessRoot: root, previousElement: a, nextElement: b,
      sourceBlankLineCount: 6, layoutEpoch: 1, expectedLayoutEpoch: 1,
    })
    expect(result.decision).toBe('VERIFIED')
    // 3 empty rows + the U+200B row + 2 empty rows, all physically verified
    expect(result.probe?.betweenSiblingCount).toBe(6)
    expect(result.renderedBlankRowCount).toBe(6)
  })
})

// ── end to end through the real host ───────────────────────────────────────

describe('R9-02g/13/15 — diagnosis is published independently of the active group', () => {
  it('R9-02g the space-only gap binds both boundaries and measures VERIFIED', () => {
    const markdown = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    mountDom(['A', 'B'], [0, 6])
    stubRects()
    const h = hostOf()
    const diags = diagnosticsOf(markdown)
    expect(diags.length).toBe(1)
    const meta = (diags[0].metadata ?? {}) as Record<string, unknown>
    expect(h.resolveGapBoundaryElementFromMeta(meta, 'previous')).not.toBeNull()
    expect(h.resolveGapBoundaryElementFromMeta(meta, 'next')).not.toBeNull()
    const rows = h.resolveRenderedBlankRowsForMeta(meta)
    expect(rows).not.toBeNull()
    expect(rows!.decision).toBe('VERIFIED')
    expect(rows!.visibleBlankLineCount).toBeGreaterThanOrEqual(2)
  })

  it('R9-13 a genuinely unbindable blank anchor still fails closed (never a fake PASS)', () => {
    mountDom(['A', 'B'], [0, 6])
    stubRects()
    const h = hostOf()
    const bound = h.bindGapBoundary({
      canonicalKind: null, canonicalOrdinal: null, startLine: 3, anchorText: ZWSP, blockOrdinal: 0,
    })
    expect(bound.decision).toBe('MISSING')
    expect(bound.strategy).toBe('NO_TEXT_ANCHOR')
    expect(bound.element).toBeNull()
  })

  it('R9-15 the same gap measures identically with no group, ACTIVE, DORMANT', () => {
    const markdown = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const measure = (): RenderedBlankRowResult | null => {
      document.body.innerHTML = ''
      vi.restoreAllMocks()
      mountDom(['A', 'B'], [0, 6])
      stubRects()
      const meta = (diagnosticsOf(markdown)[0].metadata ?? {}) as Record<string, unknown>
      return hostOf().resolveRenderedBlankRowsForMeta(meta)
    }
    const unactivated = measure()
    const active = measure()
    const dormant = measure()
    expect(unactivated?.decision).toBe('VERIFIED')
    expect(active?.decision).toBe('VERIFIED')
    expect(dormant?.decision).toBe('VERIFIED')
    expect(unactivated?.visibleBlankLineCount).toBe(active?.visibleBlankLineCount)
    expect(active?.visibleBlankLineCount).toBe(dormant?.visibleBlankLineCount)
  })
})

// ── split / merge / undo-redo cycles ──────────────────────────────────────

describe('R9-06/07/09/10 — split, compliance and merge stay correct with placeholders', () => {
  const gapCount = (md: string): number => analyzeInternalBlankLineGaps(md).length

  it('R9-07 one to four level splits keep every effective gap', () => {
    const l1 = `A${blanks(5)}B`
    const l2 = `A${blanks(3)}X${blanks(3)}B`
    const l3 = `A${blanks(3)}X${blanks(3)}X${blanks(3)}B`
    const l4 = `A${blanks(3)}X${blanks(3)}X${blanks(3)}X${blanks(3)}B`
    expect(gapCount(l1)).toBe(1)
    expect(gapCount(l2)).toBe(2)
    expect(gapCount(l3)).toBe(3)
    expect(gapCount(l4)).toBe(4)
    // the same four levels with the split row written as a spaces-only placeholder
    const l2zw = `A${blanks(3)}${ZWSP}${blanks(3)}B`
    expect(gapCount(l2zw)).toBe(1)   // the placeholder is NOT a real split
    // 3 blanks + the placeholder row itself + 3 blanks = 7 blank source lines
    expect(analyzeInternalBlankLineGaps(l2zw)[0].actualBlankLines).toBe(7)
  })

  it('R9-06 spaces then a real letter then delete restores the original gap', () => {
    const base = `A${blanks(6)}B`
    const spaces = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const letter = `A${blanks(3)}a${blanks(2)}B`
    const backToSpaces = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    expect(gapCount(base)).toBe(1)
    expect(gapCount(spaces)).toBe(1)
    expect(gapCount(letter)).toBe(2)          // a real character DOES split
    expect(gapCount(backToSpaces)).toBe(1)    // deleting it merges back
    expect(analyzeInternalBlankLineGaps(backToSpaces)[0].actualBlankLines).toBe(6)
  })

  it('R9-09 a compliant child leaves only itself, the violating sibling stays', () => {
    // left side 4 blanks (violating), right side 1 blank (legal → no gap)
    const md = `A${blanks(4)}X${blanks(1)}B`
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps.length).toBe(1)
    expect(gaps[0].actualBlankLines).toBe(4)
    expect(gaps[0].previousBlockAnchorText).toBe('A')
    expect(gaps[0].nextBlockAnchorText).toBe('X')
  })

  it('R9-10 reverse merge + undo/redo never loses a surviving gap', () => {
    const l4 = `A${blanks(3)}X${blanks(3)}X${blanks(3)}X${blanks(3)}B`
    const l3 = `A${blanks(3)}X${blanks(3)}X${blanks(3)}B`
    const l2 = `A${blanks(3)}X${blanks(3)}B`
    const l1 = `A${blanks(5)}B`
    const sequence: Array<{ md: string; gaps: number; perGap: number }> = [
      { md: l4, gaps: 4, perGap: 3 },
      { md: l3, gaps: 3, perGap: 3 },
      { md: l2, gaps: 2, perGap: 3 },
      { md: l1, gaps: 1, perGap: 5 },
      { md: l2, gaps: 2, perGap: 3 },
      { md: l3, gaps: 3, perGap: 3 },
      { md: l4, gaps: 4, perGap: 3 },
    ]
    sequence.forEach((step, i) => {
      const gaps = analyzeInternalBlankLineGaps(step.md)
      expect(gaps.length, `step ${i} gap count`).toBe(step.gaps)
      for (const gap of gaps) {
        expect(gap.actualBlankLines, `step ${i} blank lines`).toBe(step.perGap)
      }
    })
  })

  it('R9-10b a U+200B placeholder between two real splits does not change the count', () => {
    const clean = `A${blanks(3)}X${blanks(3)}X${blanks(3)}B`
    const withPlaceholder = `A${blanks(3)}X${blanks(3)}${ZWSP}${blanks(3)}X${blanks(3)}B`
    expect(gapCount(clean)).toBe(3)
    expect(gapCount(withPlaceholder)).toBe(3)
  })
})

// ── identity / boundary disambiguation ────────────────────────────────────

describe('R9-08 — block identity and boundary disambiguation', () => {
  it('R9-08 same-text blocks keep ordinal identities; distinct texts stay distinct', () => {
    const same = `A${blanks(3)}啊${blanks(3)}啊${blanks(3)}B`
    const ids = analyzeInternalBlankLineGaps(same).map(internalBlankGapIdentity)
    expect(ids.length).toBe(3)
    expect(ids.join('|')).toContain('啊#0')
    expect(ids.join('|')).toContain('啊#1')

    const distinct = `A${blanks(3)}甲${blanks(3)}乙${blanks(3)}B`
    const distinctIds = analyzeInternalBlankLineGaps(distinct).map(internalBlankGapIdentity)
    expect(distinctIds.length).toBe(3)
    expect(distinctIds.join('|')).toContain('甲#0')
    expect(distinctIds.join('|')).toContain('乙#0')
  })
})

// ── stale snapshot / DOM rebuild ──────────────────────────────────────────

describe('R9-14 — a stale snapshot or a rebuilt DOM never deletes a confirmed gap', () => {
  const gapCount = (md: string): number => analyzeInternalBlankLineGaps(md).length

  it('R9-14 two revisions of the same document each re-diagnose from their own markdown', () => {
    const first = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const second = `A${blanks(3)}${ZWSP}${ZWSP}${blanks(2)}B`
    expect(gapCount(first)).toBe(1)
    expect(gapCount(second)).toBe(1)
    expect(analyzeInternalBlankLineGaps(first)[0].actualBlankLines).toBe(6)
    expect(analyzeInternalBlankLineGaps(second)[0].actualBlankLines).toBe(6)
  })

  it('R9-14b a DOM rebuilt while keeping the same markdown still measures VERIFIED', () => {
    const markdown = `A${blanks(3)}${ZWSP}${blanks(2)}B`
    const meta = (diagnosticsOf(markdown)[0].metadata ?? {}) as Record<string, unknown>
    for (let round = 0; round < 3; round++) {
      document.body.innerHTML = ''
      vi.restoreAllMocks()
      mountDom(['A', 'B'], [0, 6])
      stubRects()
      const rows = hostOf().resolveRenderedBlankRowsForMeta(meta)
      expect(rows?.decision, `round ${round}`).toBe('VERIFIED')
    }
  })
})
