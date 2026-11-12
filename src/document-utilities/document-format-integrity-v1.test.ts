import { describe, expect, it } from 'vitest'
import {
  FORMULA_SINGLE_LINE_BLOCK_CODE,
  LIST_EMPTY_ITEM_CODE,
  computeFormatIntegrityDiagnostics,
} from './document-format-integrity-v1'
import {
  FORMULA_SINGLE_LINE_BLOCK_FIX,
  LIST_EMPTY_ITEM_FIX,
  applyPatchesToMarkdown,
  type FixContext,
} from './document-diagnostic-fix-v1'

function ctx(markdown: string): FixContext {
  return { markdown, documentKey: 'doc:fmt', snapshot: null, locked: false }
}

function codes(markdown: string): string[] {
  return computeFormatIntegrityDiagnostics({ markdown, documentKey: 'doc:fmt' }).map(d => d.code)
}

function applyFix(
  fixer: typeof LIST_EMPTY_ITEM_FIX,
  diagnostic: ReturnType<typeof computeFormatIntegrityDiagnostics>[number],
  markdown: string,
): string {
  const built = fixer.build(diagnostic, ctx(markdown))
  expect(built.blockers ?? []).toEqual([])
  return applyPatchesToMarkdown(markdown, built.patches ?? [])
}

describe('FORMAT-INTEGRITY §1 — empty list item', () => {
  it('flags the contentless marker line (the real README case)', () => {
    const markdown = '## 规则\n\n- 第一条\n- \n- 第三条\n'
    const found = computeFormatIntegrityDiagnostics({ markdown, documentKey: 'd' })
    expect(found).toHaveLength(1)
    expect(found[0].code).toBe(LIST_EMPTY_ITEM_CODE)
    expect(found[0].metadata?.['lineNumber']).toBe(3)
    expect(found[0].location).toMatchObject({ kind: 'source-range', startLine: 4 })
  })

  it('deleting it restores a clean three-item list', () => {
    const markdown = '## 规则\n\n- 第一条\n- \n- 第三条\n'
    const d = computeFormatIntegrityDiagnostics({ markdown, documentKey: 'd' })[0]
    expect(applyFix(LIST_EMPTY_ITEM_FIX, d, markdown)).toBe('## 规则\n\n- 第一条\n- 第三条\n')
  })

  it('never flags a marker that owns a MORE-indented child block', () => {
    expect(codes('- \n  - 子项\n')).toEqual([])
  })

  it('never flags a marker with content', () => {
    expect(codes('- 有内容\n1. 也有内容\n')).toEqual([])
  })
})

describe('FORMAT-INTEGRITY §2 — single-line display formula', () => {
  it('flags `$$x$$` on its own line (Typora renders it as plain text)', () => {
    const markdown = '正文\n\n$$\\sum_{i=1}^{n} x_i$$\n\n后续\n'
    const found = computeFormatIntegrityDiagnostics({ markdown, documentKey: 'd' })
    expect(found).toHaveLength(1)
    expect(found[0].code).toBe(FORMULA_SINGLE_LINE_BLOCK_CODE)
    expect(found[0].metadata?.['formulaSource']).toBe('\\sum_{i=1}^{n} x_i')
  })

  it('expands it into the renderable three-line block', () => {
    const markdown = '正文\n\n$$\\sum_{i=1}^{n} x_i$$\n\n后续\n'
    const d = computeFormatIntegrityDiagnostics({ markdown, documentKey: 'd' })[0]
    expect(applyFix(FORMULA_SINGLE_LINE_BLOCK_FIX, d, markdown))
      .toBe('正文\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\n后续\n')
  })

  it('keeps the document EOL style (CRLF fixture)', () => {
    const markdown = '\u6b63\u6587\r\n\r\n$$x=1$$\r\n'
    const d = computeFormatIntegrityDiagnostics({ markdown, documentKey: 'd' })[0]
    expect(applyFix(FORMULA_SINGLE_LINE_BLOCK_FIX, d, markdown)).toBe('\u6b63\u6587\r\n\r\n$$\r\nx=1\r\n$$\r\n')
  })

  it('never flags a properly multi-line $$ block or inline $x$ math', () => {
    expect(codes('$$\nx=1\n$$\n')).toEqual([])
    expect(codes('行内 $x=1$ 公式\n')).toEqual([])
  })

  it('never flags $$ inside a fenced code block', () => {
    expect(codes('```text\n$$x=1$$\n```\n')).toEqual([])
  })
})

describe('FORMAT-INTEGRITY §3 — the image rule is NOT duplicated here', () => {
  it('never emits an image-mixed rule of its own (ONE entry: FIGURE_BLOCK_STRUCTURE_INVALID)', () => {
    expect(codes('before ![B](a.png) after\n')).toEqual([])
    expect(codes('![1](x.png) ![2](y.png)\n')).toEqual([])
    expect(codes('```md\nbefore ![B](a.png) after\n```\n')).toEqual([])
  })
})
