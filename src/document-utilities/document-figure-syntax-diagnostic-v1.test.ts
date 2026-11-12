// @vitest-environment jsdom
/**
 * V3 — figure syntax completeness: diagnostics + real Markdown repair +
 * re-diagnosis. Case K / Case L of the acceptance fixture are reproduced here.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computeDocumentDiagnostics, buildFigureSourceOccurrences } from './document-diagnostics'
import type { DocumentDiagnosticsInput, DiagnosticLinkFact } from './document-diagnostics'
import { parseImageSourceOccurrences } from './document-resource-scanner'
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
  planDiagnosticFixV2,
  selectNonConflictingPlans,
} from './document-diagnostic-fix-v2'
import { FIGURE_IN_HEADING_CODE, FIGURE_EMPTY_SOURCE_CODE } from './document-figure-heading-invariant-v1'
import {
  FIGURE_UNCLOSED_DESTINATION_CODE,
  FIGURE_UNCLOSED_ALT_CODE,
  FIGURE_INVALID_DESTINATION_CODE,
  FIGURE_MALFORMED_SYNTAX_CODE,
} from './document-figure-syntax-integrity-v1'
import { FIGURE_IN_LIST_CODE, FIGURE_IN_QUOTE_CODE } from './document-standalone-object-block-invariant-v515'
import { resolveDiagnosticCopy } from './document-diagnostic-copy-v1'

const DOC_KEY = 'doc:figure-syntax'

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

function ofCode(markdown: string, code: string) {
  return diagnosticsOf(markdown).filter(d => d.code === code)
}

function fixCtx(markdown: string): FixContext {
  return { markdown, snapshotMarkdown: markdown, documentKey: DOC_KEY, snapshot: null, locked: false }
}

function fixFirst(markdown: string, code: string): string {
  const diagnostic = ofCode(markdown, code)[0]
  expect(diagnostic, `expected ${code}`).toBeTruthy()
  const fixer = createDefaultDiagnosticFixRegistry().get(code)
  expect(fixer, `no fixer for ${code}`).toBeTruthy()
  const built = fixer!.build(diagnostic, fixCtx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

function snapshotOf(markdown: string) {
  const out = computeDocumentDiagnostics(inputOf(markdown))
  return {
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
}

beforeEach(() => {
  resetFigureBlockStructureV515State()
})

describe('Case K — 标题中的图片链接缺少右圆括号', () => {
  it('reports the SPECIFIC rule, not a generic structure error', () => {
    const md = '## Case K\n\n## 结束 ![K](https://raw.githubusercontent.com/a/b/c.png\n'
    const syntax = ofCode(md, FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(syntax).toHaveLength(1)
    expect(syntax[0].message).toBe('图片链接括号未闭合')
    expect(syntax[0].severity).toBe('error')
    expect(syntax[0].metadata?.autoFixable).toBe(true)
    // never the generic "图片必须作为独立块插入" copy
    expect(diagnosticsOf(md).map(d => d.message)).not.toContain('图片必须作为独立块插入')
    expect(ofCode(md, FIGURE_IN_HEADING_CODE)).toEqual([])
  })

  it('repairs ONLY the closing paren and keeps the whole URL', () => {
    const md = '## Case K\n\n## 结束 ![K](https://raw.githubusercontent.com/a/b/c.png\n'
    const fixed = fixFirst(md, FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(fixed).toBe('## Case K\n\n## 结束 ![K](https://raw.githubusercontent.com/a/b/c.png)\n')
    expect(fixed).toContain('https://raw.githubusercontent.com/a/b/c.png')
    // §4.4 — syntax gone, but the heading structure error must still be reported
    expect(ofCode(fixed, FIGURE_UNCLOSED_DESTINATION_CODE)).toEqual([])
    expect(ofCode(fixed, FIGURE_IN_HEADING_CODE)).toHaveLength(1)
  })

  it('the drawer copy is the required specific name', () => {
    const diagnostic = ofCode('## 结束 ![K](a.png\n', FIGURE_UNCLOSED_DESTINATION_CODE)[0]
    const copy = resolveDiagnosticCopy({
      code: diagnostic.code, message: diagnostic.message,
      detail: diagnostic.detail, severity: diagnostic.severity,
    })
    expect(copy.title).toBe('图片链接括号未闭合')
    expect(copy.description).toContain('右圆括号')
    expect(describeFixCapability(FIGURE_UNCLOSED_DESTINATION_CODE).capability).toBe('AUTO_SAFE')
  })
})

describe('Case L — 正常图片与空路径必须区分', () => {
  it('complete image + empty placeholder: heading + empty, no syntax error', () => {
    const md = '## Case L\n\n## 标题 ![L1](a.png) ![]()\n'
    const codes = diagnosticsOf(md).map(d => d.code)
    expect(codes).toContain(FIGURE_IN_HEADING_CODE)
    expect(codes).toContain(FIGURE_EMPTY_SOURCE_CODE)
    expect(codes).not.toContain(FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(codes).not.toContain(FIGURE_MALFORMED_SYNTAX_CODE)
  })

  it('one-click repairs the heading but NEVER deletes the empty placeholder', () => {
    const md = '## Case L\n\n## 标题 ![L1](a.png) ![]()\n'
    const plans = planAllAutoFixesV2(
      { markdown: md, snapshotMarkdown: md, documentKey: DOC_KEY, snapshot: snapshotOf(md), locked: false },
      { captionAvailable: true },
    )
    expect(plans.some(plan => plan.code === FIGURE_EMPTY_SOURCE_CODE)).toBe(false)
    const { next } = buildFixedMarkdown(md, selectNonConflictingPlans(plans).accepted)
    expect(next).toBe('## Case L\n\n## 标题\n\n![L1](a.png)\n\n![]()\n')
    expect(ofCode(next, FIGURE_IN_HEADING_CODE)).toEqual([])
    expect(ofCode(next, FIGURE_EMPTY_SOURCE_CODE)).toHaveLength(1)
  })
})

describe('缺少右方括号与非法语法', () => {
  it('unclosed alt is repaired only when the boundary is unambiguous', () => {
    const md = '![K(assets/k.png)\n'
    expect(ofCode(md, FIGURE_UNCLOSED_ALT_CODE)).toHaveLength(1)
    expect(fixFirst(md, FIGURE_UNCLOSED_ALT_CODE)).toBe('![K](assets/k.png)\n')
  })

  it('ambiguous alt stays a manual diagnostic (no patch)', () => {
    const md = '![K(说明(assets/k.png)\n'
    const diagnostic = ofCode(md, FIGURE_UNCLOSED_ALT_CODE)[0]
    expect(diagnostic.metadata?.autoFixable).toBe(false)
    const plan = planDiagnosticFixV2(diagnostic, {
      ...fixCtx(md), snapshot: snapshotOf(md),
    })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map(b => b.code)).toContain('STRUCTURE_NOT_AUTO_FIXABLE')
  })

  it('invalid destination / malformed title have no auto fix button', () => {
    const invalid = ofCode('![图](<assets/a.png)\n', FIGURE_INVALID_DESTINATION_CODE)[0]
    expect(invalid.message).toBe('图片路径语法不合法')
    expect(invalid.metadata?.autoFixable).toBe(false)
    expect(describeFixCapability(FIGURE_INVALID_DESTINATION_CODE).capability).toBe('UNAVAILABLE')

    const malformed = ofCode('![图](a.png "标题)\n', FIGURE_MALFORMED_SYNTAX_CODE)[0]
    expect(malformed.message).toBe('图片链接语法不完整')
    expect(describeFixCapability(FIGURE_MALFORMED_SYNTAX_CODE).capability).toBe('UNAVAILABLE')
  })
})

describe('结构上下文与修复后二次检测', () => {
  it('a repaired list image immediately re-enters FIGURE_IN_LIST', () => {
    const md = '- ![K](a.png\n'
    const fixed = fixFirst(md, FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(fixed).toBe('- ![K](a.png)\n')
    expect(ofCode(fixed, FIGURE_IN_LIST_CODE)).toHaveLength(1)
  })

  it('a repaired quote image immediately re-enters FIGURE_IN_QUOTE', () => {
    const md = '> ![K](a.png\n'
    const fixed = fixFirst(md, FIGURE_UNCLOSED_DESTINATION_CODE)
    expect(fixed).toBe('> ![K](a.png)\n')
    expect(ofCode(fixed, FIGURE_IN_QUOTE_CODE)).toHaveLength(1)
  })

  it('one-click repairs heading + list syntax in ONE transaction, empty stays explicit', () => {
    const md = '## 标题 ![K](a.png\n\n- ![L](b.png\n\n![]()\n'
    const plans = planAllAutoFixesV2(
      { markdown: md, snapshotMarkdown: md, documentKey: DOC_KEY, snapshot: snapshotOf(md), locked: false },
      { captionAvailable: true },
    )
    const { accepted } = selectNonConflictingPlans(plans)
    expect(accepted.filter(p => p.code === FIGURE_UNCLOSED_DESTINATION_CODE)).toHaveLength(2)
    const { next } = buildFixedMarkdown(md, accepted)
    expect(next).toBe('## 标题 ![K](a.png)\n\n- ![L](b.png)\n\n![]()\n')
    // syntax cleared; the heading / list structure and the empty resource remain
    expect(ofCode(next, FIGURE_UNCLOSED_DESTINATION_CODE)).toEqual([])
    expect(ofCode(next, FIGURE_IN_HEADING_CODE)).toHaveLength(1)
    expect(ofCode(next, FIGURE_IN_LIST_CODE)).toHaveLength(1)
    expect(ofCode(next, FIGURE_EMPTY_SOURCE_CODE)).toHaveLength(1)
    // idempotent for the syntax rule
    expect(
      planAllAutoFixesV2(
        { markdown: next, snapshotMarkdown: next, documentKey: DOC_KEY, snapshot: snapshotOf(next), locked: false },
        { captionAvailable: true },
      ).some(p => p.code === FIGURE_UNCLOSED_DESTINATION_CODE),
    ).toBe(false)
  })

  it('code / inline code / escaped image syntax never produce the rule', () => {
    for (const md of [
      '```md\n![K](a.png\n```\n',
      '行内 `![K](a.png`\n',
      '\\![K](a.png\n',
      '<!-- ![K](a.png -->\n',
    ]) {
      expect(ofCode(md, FIGURE_UNCLOSED_DESTINATION_CODE), md).toEqual([])
    }
  })
})
