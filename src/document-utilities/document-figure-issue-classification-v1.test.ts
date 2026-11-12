// @vitest-environment jsdom
/**
 * V5.15 §8.2 — Figure issue classification + targeted structure repair.
 *
 * Every case asserts the REAL Markdown input, the classified rule id / severity,
 * and the EXACT repaired Markdown (never "a diagnostic appeared").
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences } from './document-resource-scanner'
import {
  FIGURE_INLINE_FORMAT_CODE,
  FIGURE_IN_LIST_CODE,
  FIGURE_IN_QUOTE_CODE,
  FIGURE_IN_TABLE_CODE,
  FIGURE_MULTIPLE_SAME_BLOCK_CODE,
  FIGURE_TEXT_MIXED_CODE,
  FIGURE_STRUCTURE_BLOCK_RULE_CODES,
  resetFigureBlockStructureV515State,
} from './document-standalone-object-block-invariant-v515'
import {
  applyPatchesToMarkdown,
  createDefaultDiagnosticFixRegistry,
  type FixContext,
} from './document-diagnostic-fix-v1'
import {
  buildFixedMarkdown,
  planAllAutoFixesV2,
  selectNonConflictingPlans,
} from './document-diagnostic-fix-v2'
import { resolveDiagnosticCopy } from './document-diagnostic-copy-v1'

const DOC_KEY = 'doc:figure-classification'

function inputOf(markdown: string): DocumentDiagnosticsInput {
  const links: DiagnosticLinkFact[] = []
  const figureSourceOccurrences = buildFigureSourceOccurrences({
    scanned: parseImageSourceOccurrences(markdown),
    documentKey: DOC_KEY,
    resolveCanonicalDestination: d => d,
    isLocalFileMissing: () => false,
  })
  return {
    documentKey: DOC_KEY,
    markdown,
    strictMode: false,
    vaultRoot: 'D:/vault',
    headings: [],
    figures: [],
    figureSourceOccurrences,
    tables: [],
    codes: [],
    formulas: [],
    links,
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

function structureDiagnostics(markdown: string) {
  return computeDocumentDiagnostics(inputOf(markdown)).diagnostics
    .filter(d => FIGURE_STRUCTURE_BLOCK_RULE_CODES.has(d.code))
}

function fixCtx(markdown: string): FixContext {
  return { markdown, snapshotMarkdown: markdown, documentKey: DOC_KEY, snapshot: null, locked: false }
}

/** Repair the FIRST classified diagnostic and return the exact new Markdown. */
function fixFirst(markdown: string): string {
  const diagnostic = structureDiagnostics(markdown)[0]
  expect(diagnostic, 'expected at least one structure diagnostic').toBeTruthy()
  const fixer = createDefaultDiagnosticFixRegistry().get(diagnostic.code)
  expect(fixer, `no fixer registered for ${diagnostic.code}`).toBeTruthy()
  const built = fixer!.build(diagnostic, fixCtx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

beforeEach(() => {
  resetFigureBlockStructureV515State()
})

describe('FIGURE_IN_LIST — remove the list marker of a simple image item', () => {
  it('unordered list', () => {
    const md = '- ![图](a.png)\n'
    expect(structureDiagnostics(md)[0].code).toBe(FIGURE_IN_LIST_CODE)
    expect(fixFirst(md)).toBe('![图](a.png)\n')
    expect(structureDiagnostics('![图](a.png)\n')).toEqual([])
  })

  it('ordered list', () => {
    const md = '1. ![图](a.png)\n'
    expect(structureDiagnostics(md)[0].code).toBe(FIGURE_IN_LIST_CODE)
    expect(fixFirst(md)).toBe('![图](a.png)\n')
  })

  it('task list', () => {
    const md = '- [ ] ![图](a.png)\n'
    expect(structureDiagnostics(md)[0].code).toBe(FIGURE_IN_LIST_CODE)
    expect(fixFirst(md)).toBe('![图](a.png)\n')
  })

  it('never deletes sibling list items', () => {
    const md = '- 文字\n- ![图](a.png)\n- 另一项\n'
    expect(fixFirst(md)).toBe('- 文字\n- 另一项\n\n![图](a.png)\n')
  })

  it('a nested list item is refused with a reason and never rewritten', () => {
    const md = '- 父项\n  - ![图](a.png)\n'
    const diagnostic = structureDiagnostics(md)[0]
    expect(diagnostic.code).toBe(FIGURE_IN_LIST_CODE)
    expect(diagnostic.metadata?.autoFixable).toBe(false)
    const built = createDefaultDiagnosticFixRegistry().get(diagnostic.code)!
      .build(diagnostic, fixCtx(md))
    expect(built.patches ?? []).toEqual([])
    expect((built.blockers ?? []).map(b => b.code)).toContain('STRUCTURE_NOT_AUTO_FIXABLE')
  })
})

describe('FIGURE_IN_QUOTE — remove EVERY quote level of the image line', () => {
  it('single-level quote', () => {
    const md = '> ![图](a.png)\n'
    expect(structureDiagnostics(md)[0].code).toBe(FIGURE_IN_QUOTE_CODE)
    expect(fixFirst(md)).toBe('![图](a.png)\n')
  })

  it('multi-level quote never leaves the image inside the quote', () => {
    for (const md of ['>> ![图](a.png)\n', '> > ![图](a.png)\n']) {
      expect(structureDiagnostics(md)[0].code).toBe(FIGURE_IN_QUOTE_CODE)
      expect(fixFirst(md)).toBe('![图](a.png)\n')
    }
  })

  it('a quote with other text keeps its text and quote semantics', () => {
    const md = '> 前文 ![图](a.png) 后文\n'
    expect(fixFirst(md)).toBe('> 前文 后文\n\n![图](a.png)\n')
    // the remaining text is still a blockquote, the image is a standalone block
    expect(structureDiagnostics('> 前文 后文\n\n![图](a.png)\n')).toEqual([])
  })
})

describe('FIGURE_MULTIPLE_SAME_BLOCK / FIGURE_TEXT_MIXED', () => {
  it('three images are split in their original order with every token intact', () => {
    const md = '![A](a.png) ![B](b.png "t") ![C](c.png)\n'
    const diagnostic = structureDiagnostics(md)[0]
    expect(diagnostic.code).toBe(FIGURE_MULTIPLE_SAME_BLOCK_CODE)
    expect(diagnostic.detail).toContain('3 张')
    expect(fixFirst(md)).toBe('![A](a.png)\n\n![B](b.png "t")\n\n![C](c.png)\n')
  })

  it('text before / after the image is preserved around a standalone image', () => {
    const md = '前面的文字 ![图](a.png) 后面的文字\n'
    const diagnostic = structureDiagnostics(md)[0]
    expect(diagnostic.code).toBe(FIGURE_TEXT_MIXED_CODE)
    expect(diagnostic.severity).toBe('warning')
    expect(fixFirst(md)).toBe('前面的文字\n\n![图](a.png)\n\n后面的文字\n')
  })

  it('text plus two images is classified as multiple images and splits completely', () => {
    const md = '文字A ![A](a.png) ![B](b.png) 文字B\n'
    expect(structureDiagnostics(md)[0].code).toBe(FIGURE_MULTIPLE_SAME_BLOCK_CODE)
    expect(fixFirst(md)).toBe('文字A\n\n![A](a.png)\n\n![B](b.png)\n\n文字B\n')
  })
})

describe('FIGURE_IN_TABLE — real table, never destroyed', () => {
  it('reports the dedicated table error and offers no auto fix', () => {
    const md = '| 列A | 列B |\n| --- | --- |\n| ![图](t.png) | x |\n'
    const diagnostic = structureDiagnostics(md)[0]
    expect(diagnostic.code).toBe(FIGURE_IN_TABLE_CODE)
    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.metadata?.autoFixable).toBe(false)
  })
})

describe('FIGURE_INLINE_FORMAT — strip only the wrapper markers', () => {
  it('bold-wrapped image becomes a bare standalone image', () => {
    const md = '**![图](a.png)**\n'
    const diagnostic = structureDiagnostics(md)[0]
    expect(diagnostic.code).toBe(FIGURE_INLINE_FORMAT_CODE)
    expect(diagnostic.severity).toBe('warning')
    expect(fixFirst(md)).toBe('![图](a.png)\n')
  })
})

describe('literal / code containers never produce a figure issue', () => {
  it('fenced code and inline code are not figures', () => {
    expect(structureDiagnostics('```md\nbefore ![](a.png) after\n```\n')).toEqual([])
    expect(structureDiagnostics('before `![](a.png)` after\n')).toEqual([])
  })
})

describe('§9 — dedupe and dependency: ONE diagnostic, then re-diagnosis', () => {
  it('a list item with two images first reports the list issue only', () => {
    const md = '- ![A](a.png) ![B](b.png)\n'
    const diagnostics = structureDiagnostics(md)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe(FIGURE_IN_LIST_CODE)
    // one repair removes the list marker AND separates both images
    expect(fixFirst(md)).toBe('![A](a.png)\n\n![B](b.png)\n')
    expect(structureDiagnostics('![A](a.png)\n\n![B](b.png)\n')).toEqual([])
  })

  it('different real problems keep different titles', () => {
    const list = structureDiagnostics('- ![图](a.png)\n')[0]
    const quote = structureDiagnostics('> ![图](a.png)\n')[0]
    const multi = structureDiagnostics('![A](a.png) ![B](b.png)\n')[0]
    const mixed = structureDiagnostics('文字 ![图](a.png)\n')[0]
    const table = structureDiagnostics('| a | b |\n| --- | --- |\n| ![图](t.png) | x |\n')[0]
    const titles = [list, quote, multi, mixed, table].map(d => d.message)
    expect(new Set(titles).size).toBe(5)
  })

  it('the drawer copy names the real cause (list kind / image count)', () => {
    const list = structureDiagnostics('- ![图](a.png)\n')[0]
    const listCopy = resolveDiagnosticCopy({
      code: list.code, message: list.message, detail: list.detail, severity: list.severity,
    })
    expect(listCopy.title).toBe('图片被设置为列表项')
    expect(listCopy.description).toContain('无序列表项')

    const multi = structureDiagnostics('![A](a.png) ![B](b.png)\n')[0]
    const multiCopy = resolveDiagnosticCopy({
      code: multi.code, message: multi.message, detail: multi.detail, severity: multi.severity,
    })
    expect(multiCopy.title).toBe('多张图片位于同一段落')
    expect(multiCopy.description).toContain('2 张')

    const quote = structureDiagnostics('> ![图](a.png)\n')[0]
    const quoteCopy = resolveDiagnosticCopy({
      code: quote.code, message: quote.message, detail: quote.detail, severity: quote.severity,
    })
    expect(quoteCopy.title).toBe('图片被设置为引用块')
    expect(quoteCopy.description).toContain('引用块')
  })
})

describe('§9 — one transaction repairs every class and the result re-diagnoses clean', () => {
  it('list / quote / multiple / text-mixed are all fixed together, idempotently', () => {
    const md = '文字 ![A](a.png) 结尾\n\n- ![B](b.png)\n\n> ![C](c.png)\n\n![D](d.png) ![E](e.png)\n'
    const out = computeDocumentDiagnostics(inputOf(md))
    const snapshot = {
      documentKey: DOC_KEY,
      revision: 1,
      sourceRevision: 1,
      generatedAt: 1,
      diagnostics: out.diagnostics,
      errorCount: out.errorCount,
      warningCount: out.warningCount,
      infoCount: out.infoCount,
      structuralVerified: true,
    }
    const plans = planAllAutoFixesV2(
      { markdown: md, snapshotMarkdown: md, documentKey: DOC_KEY, snapshot, locked: false },
      { captionAvailable: true },
    )
    const { accepted, rejected } = selectNonConflictingPlans(plans)
    expect(rejected).toEqual([])
    expect(accepted).toHaveLength(4)
    const { next } = buildFixedMarkdown(md, accepted)
    expect(next).toBe(
      '文字\n\n![A](a.png)\n\n结尾\n\n![B](b.png)\n\n![C](c.png)\n\n![D](d.png)\n\n![E](e.png)\n',
    )
    expect(structureDiagnostics(next)).toEqual([])
    // idempotent
    const again = planAllAutoFixesV2(
      { markdown: next, snapshotMarkdown: next, documentKey: DOC_KEY, snapshot, locked: false },
      { captionAvailable: true },
    )
    expect(selectNonConflictingPlans(again).accepted).toEqual([])
  })
})
