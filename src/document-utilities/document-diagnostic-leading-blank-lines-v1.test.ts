// @vitest-environment jsdom
/**
 * LEADING BLANK-LINE POLICY V1 + ADJACENT BLANK-LINE MATRIX wiring.
 */
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE_CODE,
  analyzeLeadingBlankLines,
} from './document-diagnostic-leading-blank-lines-v1'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { EXCESSIVE_INTERNAL_BLANK_LINES_CODE } from './document-diagnostic-internal-blank-lines-v1'

function input(markdown: string | null): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:leading',
    markdown,
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    h1Facts: [],
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
  }
}

const leadingOf = (markdown: string | null) =>
  computeDocumentDiagnostics(input(markdown)).diagnostics.filter(d => d.code === DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE_CODE)

describe('analyzeLeadingBlankLines', () => {
  it('reports 1 / 2 / 3 / 5 leading blank lines with the first content index', () => {
    for (const n of [1, 2, 3, 5]) {
      const facts = analyzeLeadingBlankLines(`${'\n'.repeat(n)}# 标题\n`)
      expect(facts, `n=${n}`).toEqual({ leadingBlankLines: n, firstContentLine: n })
    }
  })

  it('is silent for 0 leading lines, an empty document and an all-blank document', () => {
    expect(analyzeLeadingBlankLines('# 标题\n')).toBeNull()
    expect(analyzeLeadingBlankLines('')).toBeNull()
    expect(analyzeLeadingBlankLines('\n\n\n')).toBeNull()
    expect(analyzeLeadingBlankLines(null)).toBeNull()
  })

  it('treats a front-matter opener as the first content line', () => {
    expect(analyzeLeadingBlankLines('---\ntitle: x\n---\n')).toBeNull()
  })

  it('counts CRLF and invisible-only first lines as blanks', () => {
    expect(analyzeLeadingBlankLines('\r\n\r\n正文\r\n')).toEqual({ leadingBlankLines: 2, firstContentLine: 2 })
    expect(analyzeLeadingBlankLines('\u200B\n\u00A0\n正文\n')).toEqual({ leadingBlankLines: 2, firstContentLine: 2 })
  })

  it('maps Chinese / Emoji content to the correct first content line', () => {
    expect(analyzeLeadingBlankLines('\n\n中文 😀 正文\n')).toEqual({ leadingBlankLines: 2, firstContentLine: 2 })
  })
})

describe('DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE producer', () => {
  it('emits ONE warning anchored at the document start', () => {
    const hits = leadingOf('\n\n# 标题\n\n正文\n')
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
    expect(hits[0].location?.kind).toBe('document-start')
    expect(hits[0].locator?.action).toBe('GO_TOP')
    expect(hits[0].metadata?.leadingBlankLineCount).toBe(2)
    expect(hits[0].detail).toContain('文档开头存在 2 个多余空行')
  })

  it('is silent when the document starts with content', () => {
    expect(leadingOf('# 标题\n\n正文\n')).toHaveLength(0)
  })
})

describe('adjacent blank-line matrix metadata', () => {
  it('paragraph → paragraph keeps the 1-blank allowance', () => {
    const md = '正文一。\n\n\n\n正文二。\n'
    const d = computeDocumentDiagnostics(input(md)).diagnostics
      .find(x => x.code === EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
    expect(d).toBeDefined()
    expect(d!.metadata?.blankPairAllowance).toBe(1)
    expect(d!.metadata?.blankPairStructuralSourceBlankLines).toBe(1)
  })

  it('heading → paragraph owns a 0-blank allowance', () => {
    const md = '# 标题\n\n\n\n正文。\n'
    const d = computeDocumentDiagnostics(input(md)).diagnostics
      .find(x => x.code === EXCESSIVE_INTERNAL_BLANK_LINES_CODE)
    expect(d).toBeDefined()
    expect(d!.metadata?.blankPairAllowance).toBe(0)
    expect(d!.metadata?.blankPairStructuralSourceBlankLines).toBe(1)
    expect(String(d!.detail)).toContain('必要')
  })
})
