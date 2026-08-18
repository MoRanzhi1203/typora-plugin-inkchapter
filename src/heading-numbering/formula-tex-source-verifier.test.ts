// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  verifyFormulaTexSource,
  normalizeTexSource,
  extractMarkdownDisplayBlock,
  resolveEditState,
  simpleHash,
} from './formula-tex-source-verifier'

/**
 * Unit tests for Formula TeX Source Verifier (v2.5.7-R5.3.1).
 * Focus: Formula0 non-edit raw source recovery without deriving TeX from
 * rendered output, and without hardcoding fixture TeX/hashes in production.
 */

describe('normalizeTexSource', () => {
  it('CRLF→LF, trims, strips outer $$ delimiters only', () => {
    expect(normalizeTexSource('$$\r\n  x+1  \r\n$$')).toBe('x+1')
    expect(normalizeTexSource('  $x$  ')).toBe('$x$') // inline delimiters kept
    expect(normalizeTexSource('x+1')).toBe('x+1')
  })
})

describe('resolveEditState', () => {
  it('detects edit / non-edit / unknown', () => {
    const edit = document.createElement('div')
    edit.className = 'mathjax-block md-rawblock-on-edit'
    expect(resolveEditState(edit)).toBe('EDIT')

    const nonEdit = document.createElement('div')
    nonEdit.className = 'mathjax-block md-rawblock md-math-block'
    expect(resolveEditState(nonEdit)).toBe('NON_EDIT')

    expect(resolveEditState(document.createElement('div'))).toBe('UNKNOWN')
    expect(resolveEditState(null)).toBe('UNKNOWN')
  })
})

describe('extractMarkdownDisplayBlock', () => {
  it('picks the N-th $$...$$ block', () => {
    const md = '$$a$$\ntext\n$$b$$\n$$c$$'
    expect(extractMarkdownDisplayBlock(md, 0)).toBe('$$a$$')
    expect(extractMarkdownDisplayBlock(md, 1)).toBe('$$b$$')
    expect(extractMarkdownDisplayBlock(md, 2)).toBe('$$c$$')
    expect(extractMarkdownDisplayBlock(md, 3)).toBeNull()
  })
})

describe('verifyFormulaTexSource (v2.5.7-R5.3.1)', () => {
  it('15. non-edit host without <pre> → SAFE_HOST_TEXT_SOURCE_SEGMENT recovers raw tex', () => {
    const host = document.createElement('div')
    host.className = 'mathjax-block md-end-block md-math-block md-rawblock'
    // Raw source text lives in the host text (no <pre>, non-edit state).
    host.innerHTML = '$$\\mathrm{RMSE}=\\sqrt{x}$$'
    const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null })
    expect(result.sourceKind).toBe('SAFE_HOST_TEXT_SOURCE_SEGMENT')
    expect(result.editState).toBe('NON_EDIT')
    expect(result.decision).toBe('DEGRADED')
    expect(result.containsDisplayDelimiter).toBe(true)
    expect(result.normalizedSourceLength).toBeGreaterThan(0)
    expect(result.sourceHash).toBe(simpleHash(normalizeTexSource('$$\\mathrm{RMSE}=\\sqrt{x}$$')))
  })

  it('edit host with <pre> → FORMULA_HOST_RAW_SOURCE_NODE READY', () => {
    const host = document.createElement('div')
    host.className = 'mathjax-block md-math-block md-rawblock md-rawblock-on-edit'
    const pre = document.createElement('pre')
    pre.textContent = '$$\\hat{y}=f(x)$$'
    host.appendChild(pre)
    const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null })
    expect(result.sourceKind).toBe('FORMULA_HOST_RAW_SOURCE_NODE')
    expect(result.editState).toBe('EDIT')
    expect(result.decision).toBe('READY')
    expect(result.sourceHash).toBe(simpleHash('\\hat{y}=f(x)'))
  })

  it('RAWBLOCK_SOURCE_CONTAINER fallback', () => {
    const host = document.createElement('div')
    host.className = 'mathjax-block md-math-block md-rawblock'
    const container = document.createElement('div')
    container.className = 'md-rawblock-container'
    container.textContent = '$$x^{2}+y^{2}$$'
    host.appendChild(container)
    const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null })
    expect(result.sourceKind).toBe('RAWBLOCK_SOURCE_CONTAINER')
    expect(result.sourceHash).toBe(simpleHash('x^{2}+y^{2}'))
  })

  it('EDITOR_MARKDOWN_BLOCK_AUTHORITY fallback when markdown provided', () => {
    const host = document.createElement('div')
    const md = 'intro\n$$z=\\alpha$$'
    const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null, markdown: md })
    expect(result.sourceKind).toBe('EDITOR_MARKDOWN_BLOCK_AUTHORITY')
    expect(result.sourceHash).toBe(simpleHash('z=\\alpha'))
  })

  it('no raw source anywhere → UNAVAILABLE', () => {
    const host = document.createElement('div')
    const result = verifyFormulaTexSource({ host, formulaIndex: 0, editorRoot: null })
    expect(result.sourceKind).toBe('UNAVAILABLE')
    expect(result.decision).toBe('UNAVAILABLE')
    expect(result.sourceHash).toBe(simpleHash(''))
  })
})
