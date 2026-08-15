// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveStrictDocumentStartState,
  validateStrictFirstH1Topline,
  computeDocumentStartSignature,
  shouldRevalidateStrictFirstH1,
} from './strict-document-validator'
import { validateHeadingStructure } from './heading-structure'

describe('STRICT-TOPLINE: STRICT-FIRST-H1 top-line validation', () => {
  it('STRICT-TOPLINE-1: "# H1\\n正文" → PASS', () => {
    const r = validateStrictFirstH1Topline('# H1\n正文', 'strict')
    expect(r.decision).toBe('PASS')
    expect(r.documentStartState).toBe('FIRST_LINE_H1')
  })

  it('STRICT-TOPLINE-2: "\\n# H1" → FAIL LEADING_EMPTY_LINE', () => {
    const r = validateStrictFirstH1Topline('\n# H1', 'strict')
    expect(r.decision).toBe('FAIL')
    expect(r.documentStartState).toBe('LEADING_EMPTY_LINE')
  })

  it('STRICT-TOPLINE-3: "\\n\\n# H1" → FAIL', () => {
    expect(validateStrictFirstH1Topline('\n\n# H1', 'strict').decision).toBe('FAIL')
  })

  it('STRICT-TOPLINE-4: "BOM# H1" → PASS', () => {
    const r = validateStrictFirstH1Topline('\uFEFF# H1', 'strict')
    expect(r.decision).toBe('PASS')
  })

  it('STRICT-TOPLINE-5: "BOM\\n# H1" → FAIL', () => {
    const r = validateStrictFirstH1Topline('\uFEFF\n# H1', 'strict')
    expect(r.decision).toBe('FAIL')
    expect(r.documentStartState).toBe('LEADING_EMPTY_LINE')
  })

  it('STRICT-TOPLINE-6: "正文\\n# H1" → FAIL LEADING_PARAGRAPH', () => {
    const r = validateStrictFirstH1Topline('正文\n# H1', 'strict')
    expect(r.decision).toBe('FAIL')
    expect(r.documentStartState).toBe('LEADING_PARAGRAPH')
  })

  it('STRICT-TOPLINE-7: "## H2\\n# H1" → FAIL LEADING_OTHER_HEADING', () => {
    const r = validateStrictFirstH1Topline('## H2\n# H1', 'strict')
    expect(r.decision).toBe('FAIL')
    expect(r.documentStartState).toBe('LEADING_OTHER_HEADING')
    expect(r.firstHeadingLevel).toBe(2)
  })

  it('STRICT-TOPLINE-8: front matter before H1 → FAIL', () => {
    const r = validateStrictFirstH1Topline('---\ntitle: test\n---\n# H1', 'strict')
    expect(r.decision).toBe('FAIL')
    expect(r.documentStartState).toBe('LEADING_OTHER_BLOCK')
  })

  it('STRICT-TOPLINE-9: quote/list/code/table/formula/image/html/hr before H1 → FAIL', () => {
    expect(resolveStrictDocumentStartState('> quote\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('- list\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('```\ncode\n```\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('| a | b |\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('$$x$$\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('<div>\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(resolveStrictDocumentStartState('---\n# H1')).toBe('LEADING_OTHER_BLOCK')
    expect(validateStrictFirstH1Topline('> quote\n# H1', 'strict').decision).toBe('FAIL')
  })

  it('STRICT-TOPLINE-10: empty document → FAIL', () => {
    expect(resolveStrictDocumentStartState('')).toBe('DOCUMENT_EMPTY')
    expect(validateStrictFirstH1Topline('', 'strict').decision).toBe('FAIL')
  })

  it('STRICT-TOPLINE-11: loose + leading blank line → SKIP', () => {
    const r = validateStrictFirstH1Topline('\n# H1', 'loose')
    expect(r.decision).toBe('SKIP')
    expect(r.skipped).toBe(true)
  })

  it('STRICT-TOPLINE-12: runtime insert top blank line → PASS→FAIL', () => {
    const passSig = computeDocumentStartSignature('# H1\n正文')
    const failSig = computeDocumentStartSignature('\n# H1\n正文')
    expect(passSig).not.toBe(failSig)
    expect(shouldRevalidateStrictFirstH1('strict', passSig, true, 'strict', failSig)).toBe(true)
    expect(validateStrictFirstH1Topline('# H1\n正文', 'strict').decision).toBe('PASS')
    expect(validateStrictFirstH1Topline('\n# H1\n正文', 'strict').decision).toBe('FAIL')
  })

  it('STRICT-TOPLINE-13: runtime delete top blank line → FAIL→PASS', () => {
    const failSig = computeDocumentStartSignature('\n# H1\n正文')
    const passSig = computeDocumentStartSignature('# H1\n正文')
    expect(shouldRevalidateStrictFirstH1('strict', failSig, true, 'strict', passSig)).toBe(true)
    expect(validateStrictFirstH1Topline('\n# H1\n正文', 'strict').decision).toBe('FAIL')
    expect(validateStrictFirstH1Topline('# H1\n正文', 'strict').decision).toBe('PASS')
  })

  it('STRICT-TOPLINE-14: H1 count=1 but leading blank → count PASS, top-line FAIL (independent)', () => {
    // H1 count validation: exactly one H1 → valid.
    const countValidation = validateHeadingStructure([{ level: 1 }], 'strict')
    expect(countValidation.state).toBe('valid')
    // Top-line validation: leading blank line → FAIL (must NOT be masked by count).
    const topline = validateStrictFirstH1Topline('\n# H1', 'strict')
    expect(topline.decision).toBe('FAIL')
    expect(topline.documentStartState).toBe('LEADING_EMPTY_LINE')
  })

  it('STRICT-TOPLINE-15: settings UI reads runtime state without duplicating validator branch', () => {
    // The UI consumes the same single validator result (no second rule branch).
    const r = validateStrictFirstH1Topline('# H1\n正文', 'strict')
    expect(r.ruleId).toBe('STRICT-FIRST-H1')
    expect(r.documentStartState).toBe('FIRST_LINE_H1')
  })

  it('STRICT-TOPLINE-REAL-1: visual top empty paragraph then H1 → top-line FAIL, count PASS', () => {
    // Real screenshot scenario: a blank line before H1.
    const md = '\n# H1\n\n正文'
    const count = validateHeadingStructure([{ level: 1 }], 'strict')
    expect(count.state).toBe('valid') // "检测到 1 个 H1"
    const topline = validateStrictFirstH1Topline(md, 'strict')
    expect(topline.decision).toBe('FAIL')
    expect(topline.documentStartState).toBe('LEADING_EMPTY_LINE')
    expect(topline.message).toContain('一级标题必须位于文档首行')
  })
})
