// @vitest-environment jsdom
/**
 * V1 — Figure-in-heading (H1–H6) + empty image source.
 *
 * Every case asserts the REAL Markdown input, the classified rule/severity and
 * the EXACT repaired Markdown.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences } from './document-resource-scanner'
import {
  analyzeHeadingImages,
  analyzeHeadingImageSyntax,
  scanSourceImageTokens,
  FIGURE_IN_HEADING_CODE,
  FIGURE_SYNTAX_IN_HEADING_CODE,
  FIGURE_EMPTY_SOURCE_CODE,
} from './document-figure-heading-invariant-v1'
import { FIGURE_UNCLOSED_DESTINATION_CODE } from './document-figure-syntax-integrity-v1'
import { resetFigureBlockStructureV515State } from './document-standalone-object-block-invariant-v515'
import {
  applyPatchesToMarkdown,
  createDefaultDiagnosticFixRegistry,
  type FixContext,
} from './document-diagnostic-fix-v1'
import {
  buildFixedMarkdown,
  describeFixCapability,
  planAllAutoFixesV2,
  selectNonConflictingPlans,
} from './document-diagnostic-fix-v2'
import { resolveDiagnosticCopy } from './document-diagnostic-copy-v1'

const DOC_KEY = 'doc:figure-heading'

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

function diagnosticsOf(markdown: string) {
  return computeDocumentDiagnostics(inputOf(markdown)).diagnostics
}

function headingDiagnostics(markdown: string) {
  return diagnosticsOf(markdown).filter(d => d.code === FIGURE_IN_HEADING_CODE)
}

function emptySourceDiagnostics(markdown: string) {
  return diagnosticsOf(markdown).filter(d => d.code === FIGURE_EMPTY_SOURCE_CODE)
}

function syntaxDiagnostics(markdown: string) {
  return diagnosticsOf(markdown).filter(d =>
    d.code === FIGURE_SYNTAX_IN_HEADING_CODE || d.code === FIGURE_UNCLOSED_DESTINATION_CODE,
  )
}

function fixCtx(markdown: string): FixContext {
  return { markdown, snapshotMarkdown: markdown, documentKey: DOC_KEY, snapshot: null, locked: false }
}

function fixFirstHeading(markdown: string): string {
  const diagnostic = headingDiagnostics(markdown)[0]
  expect(diagnostic, 'expected a FIGURE_IN_HEADING diagnostic').toBeTruthy()
  const fixer = createDefaultDiagnosticFixRegistry().get(FIGURE_IN_HEADING_CODE)
  expect(fixer).toBeTruthy()
  const built = fixer!.build(diagnostic, fixCtx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

function fixFirstEmptySource(markdown: string): string {
  const diagnostic = emptySourceDiagnostics(markdown)[0]
  expect(diagnostic, 'expected a FIGURE_EMPTY_SOURCE diagnostic').toBeTruthy()
  const fixer = createDefaultDiagnosticFixRegistry().get(FIGURE_EMPTY_SOURCE_CODE)
  expect(fixer).toBeTruthy()
  const built = fixer!.build(diagnostic, fixCtx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

function fixFirstSyntax(markdown: string): string {
  const diagnostic = syntaxDiagnostics(markdown)[0]
  expect(diagnostic, 'expected a syntax diagnostic').toBeTruthy()
  const fixer = createDefaultDiagnosticFixRegistry().get(diagnostic.code)
  expect(fixer).toBeTruthy()
  const built = fixer!.build(diagnostic, fixCtx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

beforeEach(() => {
  resetFigureBlockStructureV515State()
})

describe('H1–H6 — every heading level with a real image', () => {
  it('reports the dedicated rule and keeps the heading level', () => {
    for (let level = 1; level <= 6; level++) {
      const marker = '#'.repeat(level)
      const md = `${marker} 标题 ![图](a.png)\n`
      const diag = headingDiagnostics(md)[0]
      expect(diag, marker).toBeTruthy()
      expect(diag.code).toBe(FIGURE_IN_HEADING_CODE)
      expect(diag.severity).toBe('error')
      expect(diag.message).toBe('图片被插入标题')
      expect(fixFirstHeading(md)).toBe(`${marker} 标题\n\n![图](a.png)\n`)
      expect(headingDiagnostics(`${marker} 标题\n\n![图](a.png)\n`)).toEqual([])
    }
  })
})

describe('图片位于标题文字前 / 中 / 后', () => {
  it('text after the image', () => {
    const md = '## ![图](a.png) 标题\n'
    expect(headingDiagnostics(md)[0].code).toBe(FIGURE_IN_HEADING_CODE)
    expect(fixFirstHeading(md)).toBe('## 标题\n\n![图](a.png)\n')
  })

  it('image between text', () => {
    const md = '### 前文 ![图](a.png) 后文\n'
    expect(fixFirstHeading(md)).toBe('### 前文 后文\n\n![图](a.png)\n')
  })

  it('text before the image', () => {
    const md = '# 标题 ![图](a.png)\n'
    expect(fixFirstHeading(md)).toBe('# 标题\n\n![图](a.png)\n')
  })

  it('a closing ATX sequence is syntax, not heading text', () => {
    const md = '## 标题 ![图](a.png) ##\n'
    expect(fixFirstHeading(md)).toBe('## 标题\n\n![图](a.png)\n')
  })
})

describe('多图与仅图片标题', () => {
  it('multiple images produce ONE heading error and all images are extracted in order', () => {
    const md = '## 前文 ![A](a.png) 中段 ![B](b.png) 后文\n'
    const diagnostics = headingDiagnostics(md)
    expect(diagnostics).toHaveLength(1)
    expect(fixFirstHeading(md)).toBe('## 前文 中段 后文\n\n![A](a.png)\n\n![B](b.png)\n')
  })

  it('an image-only heading loses the heading marker and keeps its images', () => {
    expect(fixFirstHeading('## ![图](a.png)\n')).toBe('![图](a.png)\n')
    expect(fixFirstHeading('## ![A](a.png) ![B](b.png)\n')).toBe('![A](a.png)\n\n![B](b.png)\n')
    expect(fixFirstHeading('###### ![图](a.png)\n')).toBe('![图](a.png)\n')
  })
})

describe('空路径图片（未完成图片节点）', () => {
  it('![]( ) / ![alt]() / ![](   ) are reported and preserved verbatim', () => {
    for (const raw of ['![]()', '![alt]()', '![](   )']) {
      const md = `## 标题 ${raw}\n`
      expect(headingDiagnostics(md), raw).toHaveLength(1)
      const empty = emptySourceDiagnostics(md)
      expect(empty, raw).toHaveLength(1)
      expect(empty[0].message).toBe('图片路径为空')
      const fixed = fixFirstHeading(md)
      expect(fixed).toBe(`## 标题\n\n${raw}\n`)
      // the structure error is gone, the empty-source error stays
      expect(headingDiagnostics(fixed)).toEqual([])
      expect(emptySourceDiagnostics(fixed)).toHaveLength(1)
      expect(headingDiagnostics(fixed).map(d => d.code)).not.toContain(FIGURE_IN_HEADING_CODE)
    }
  })

  it('an image-only heading with an empty path keeps the empty token', () => {
    const fixed = fixFirstHeading('## ![]()\n')
    expect(fixed).toBe('![]()\n')
    expect(emptySourceDiagnostics(fixed)).toHaveLength(1)
  })

  it('the dedicated fix removes an inline empty token and keeps the text', () => {
    expect(fixFirstEmptySource('前文 ![]() 后文\n')).toBe('前文 后文\n')
    expect(fixFirstEmptySource('前文 ![说明]() 后文\n')).toBe('前文 后文\n')
  })

  it('the dedicated fix removes a standalone empty image line and normalizes blanks', () => {
    expect(fixFirstEmptySource('![]()\n')).toBe('')
    expect(fixFirstEmptySource('A\n\n![]()\n\nB\n')).toBe('A\n\nB\n')
  })

  it('a heading empty image is fixed together with the heading structure', () => {
    expect(fixFirstEmptySource('## 标题 ![]()\n')).toBe('## 标题\n')
    expect(fixFirstEmptySource('## ![说明]()\n')).toBe('')
    expect(fixFirstEmptySource('## 标题 ![说明]() ![A](a.png)\n'))
      .toBe('## 标题\n\n![A](a.png)\n')
    const fixed = fixFirstEmptySource('## 标题 ![]()\n')
    expect(headingDiagnostics(fixed)).toEqual([])
    expect(emptySourceDiagnostics(fixed)).toEqual([])
  })
})

describe('优先级与去重', () => {
  it('a heading with text + two images reports ONLY FIGURE_IN_HEADING', () => {
    const md = '## 前文 ![A](a.png) 后文 ![B](b.png)\n'
    const codes = diagnosticsOf(md).map(d => d.code)
    expect(codes.filter(c => c === FIGURE_IN_HEADING_CODE)).toHaveLength(1)
    expect(codes).not.toContain('FIGURE_TEXT_MIXED')
    expect(codes).not.toContain('FIGURE_MULTIPLE_SAME_BLOCK')
  })

  it('images inside a heading never reach normal figure naming rules', () => {
    const md = '## 标题 ![图](a.png)\n'
    const codes = diagnosticsOf(md).map(d => d.code)
    expect(codes).not.toContain('FIGURE_MISSING_NAME')
    expect(codes).not.toContain('FIGURE_LOCAL_IMAGE_MISSING')
  })
})

describe('行内代码 / 转义 / 代码围栏不误报', () => {
  it('inline code image syntax is literal text', () => {
    expect(headingDiagnostics('## 标题 `![图](a.png)`\n')).toEqual([])
    expect(emptySourceDiagnostics('## 标题 `![]()`\n')).toEqual([])
  })

  it('an escaped image marker is literal text', () => {
    expect(headingDiagnostics('## 标题 \\![图](a.png)\n')).toEqual([])
    expect(emptySourceDiagnostics('## 标题 \\![]()\n')).toEqual([])
  })

  it('a heading-like line inside a fenced code block is not a heading', () => {
    expect(headingDiagnostics('```md\n## 标题 ![图](a.png)\n```\n')).toEqual([])
    expect(emptySourceDiagnostics('```md\n## 标题 ![]()\n```\n')).toEqual([])
  })
})

describe('修复完整性', () => {
  it('preserves heading text formatting and image attributes', () => {
    const md = '### **重点** ![中文图](assets/图片 名.png "标题") 结尾\n'
    expect(fixFirstHeading(md)).toBe('### **重点** 结尾\n\n![中文图](assets/图片 名.png "标题")\n')
  })

  it('is idempotent and keeps every image token', () => {
    const md = '## 标题 ![A](a.png) ![B](b.png)\n'
    const once = fixFirstHeading(md)
    expect(headingDiagnostics(once)).toEqual([])
    expect((once.match(/!\[[^\]]*\]\([^)]*\)/g) ?? [])).toEqual(['![A](a.png)', '![B](b.png)'])
  })

  it('one-click and single-item repair produce the same document', () => {
    const md = '## 标题 ![A](a.png)\n\n### 另一个 ![B](b.png)\n'
    const single = applyPatchesToMarkdown(md, (() => {
      const diagnostics = headingDiagnostics(md)
      const fixer = createDefaultDiagnosticFixRegistry().get(FIGURE_IN_HEADING_CODE)!
      const patches = diagnostics.flatMap(d => fixer.build(d, fixCtx(md)).patches ?? [])
      return patches
    })())
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
    const { accepted } = selectNonConflictingPlans(plans)
    const { next } = buildFixedMarkdown(md, accepted)
    expect(next).toBe(single)
    expect(next).toBe('## 标题\n\n![A](a.png)\n\n### 另一个\n\n![B](b.png)\n')
  })

  it('one-click fixes heading structure but NEVER deletes empty-path images', () => {
    const md = '## 标题 ![]()\n\n### 另一个 ![A](a.png)\n\n## 普通 ![说明]()\n'
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
    expect(plans.some(plan => plan.code === FIGURE_EMPTY_SOURCE_CODE)).toBe(false)
    const { accepted } = selectNonConflictingPlans(plans)
    const { next } = buildFixedMarkdown(md, accepted)
    // the structure errors are gone; both empty tokens stay for an EXPLICIT choice
    expect(next).toBe('## 标题\n\n![]()\n\n### 另一个\n\n![A](a.png)\n\n## 普通\n\n![说明]()\n')
    expect(headingDiagnostics(next)).toEqual([])
    expect(emptySourceDiagnostics(next)).toHaveLength(2)
  })

  it('the empty-source rule is EXPLICIT_ONLY and its label names the real action', () => {
    const capability = describeFixCapability(FIGURE_EMPTY_SOURCE_CODE)
    expect(capability.capability).toBe('EXPLICIT_ONLY')
    expect(capability.label).toBe('删除空图片占位符')
  })

  it('the drawer copy uses the required name and explanation', () => {
    const diagnostic = headingDiagnostics('## 标题 ![图](a.png)\n')[0]
    const copy = resolveDiagnosticCopy({
      code: diagnostic.code,
      message: diagnostic.message,
      detail: diagnostic.detail,
      severity: diagnostic.severity,
    })
    expect(copy.title).toBe('图片被插入标题')
    expect(copy.description).toContain('标题中包含图片')
    expect(copy.description).toContain('独立段落')
    expect(describeFixCapability(FIGURE_IN_HEADING_CODE).capability).toBe('AUTO_SAFE')
  })
})

describe('V2 §5.5 — 标题中包含图片链接语法 / 语法残留', () => {
  it('an unclosed image syntax in a heading is reported and moved out verbatim', () => {
    const md = '## 结束 ![J](https://raw.githubusercontent.com/a/b/c.png\n'
    const diagnostics = syntaxDiagnostics(md)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe(FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(diagnostics[0].message).toBe('图片链接括号未闭合')
    expect(diagnostics[0].severity).toBe('error')
    // the complete-token rule never competes for the same heading
    expect(headingDiagnostics(md)).toEqual([])
    const fixed = fixFirstSyntax(md)
    expect(fixed).toBe('## 结束 ![J](https://raw.githubusercontent.com/a/b/c.png)\n')
    expect(syntaxDiagnostics(fixed)).toEqual([])
    // the repaired heading image now enters the heading structure rule
    expect(headingDiagnostics(fixed)).toHaveLength(1)
  })

  it('T14 — a complete remote image token is moved out and leaves NO syntax residue', () => {
    const md = '## 结束 ![J](https://raw.githubusercontent.com/a/b/c.png)\n'
    expect(syntaxDiagnostics(md)).toEqual([])
    expect(headingDiagnostics(md)).toHaveLength(1)
    const fixed = fixFirstHeading(md)
    expect(fixed).toBe('## 结束\n\n![J](https://raw.githubusercontent.com/a/b/c.png)\n')
    expect(fixed.split('\n')[0]).toBe('## 结束')
  })

  it('a token + residual syntax in the same heading moves BOTH out (one diagnostic)', () => {
    const md = '## 标题 ![A](a.png) ![B](b.png\n'
    expect(headingDiagnostics(md)).toHaveLength(1)
    expect(syntaxDiagnostics(md)).toEqual([])
    expect(fixFirstHeading(md)).toBe('## 标题\n\n![A](a.png)\n\n![B](b.png\n')
  })

  it('inline code / escaped image syntax is never a syntax diagnostic', () => {
    expect(syntaxDiagnostics('## 示例 `![a](b.png`\n')).toEqual([])
    expect(syntaxDiagnostics('## 示例 \\![a](b.png\n')).toEqual([])
    expect(syntaxDiagnostics('```md\n## 结束 ![a](b.png\n```\n')).toEqual([])
  })

  it('a heading that merely contains ! and [ is not an image error', () => {
    expect(syntaxDiagnostics('## 说明 ![不是图片 的写法\n')).toEqual([])
    expect(headingDiagnostics('## 说明 ![不是图片 的写法\n')).toEqual([])
  })

  it('a destination with balanced parentheses stays ONE token (URL never split)', () => {
    const md = '## 标题 ![图](a(b).png)\n'
    expect(headingDiagnostics(md)).toHaveLength(1)
    expect(fixFirstHeading(md)).toBe('## 标题\n\n![图](a(b).png)\n')
  })

  it('analyzeHeadingImageSyntax is pure and reports only syntax-only headings', () => {
    const entries = analyzeHeadingImageSyntax('## 结束 ![J](a.png\n\n## 完整 ![A](a.png)\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].syntaxFragments.map(f => f.raw)).toEqual(['![J](a.png'])
    expect(entries[0].textWithoutSyntax).toBe('结束')
  })
})

describe('pure source authority', () => {
  it('analyzeHeadingImages emits one entry per heading with all tokens', () => {
    const entries = analyzeHeadingImages('# A ![1](a.png)\n\n## ![2](b.png) B ![3](c.png)\n')
    expect(entries.map(e => e.level)).toEqual([1, 2])
    expect(entries[0].images).toHaveLength(1)
    expect(entries[1].images).toHaveLength(2)
    expect(entries[0].imageOnly).toBe(false)
  })

  it('scanSourceImageTokens includes empty destinations but excludes literals', () => {
    const tokens = scanSourceImageTokens('![a](x.png) ![]() `![b](y.png)` \\![c](z.png)\n')
    expect(tokens.map(t => t.rawToken)).toEqual(['![a](x.png)', '![]()'])
    expect(tokens.filter(t => t.emptyDestination)).toHaveLength(1)
  })

  it('the shared resource scanner also excludes escaped image syntax', () => {
    const occurrences = parseImageSourceOccurrences('\\![a](x.png) ![b](y.png)\n')
    expect(occurrences.map(o => o.rawToken)).toEqual(['![b](y.png)'])
  })
})
