// @vitest-environment jsdom
/**
 * P0-3 — Delete 结构边界保护：准入矩阵（D01–D08 + 额外边界）。
 * 纯判定，无 DOM 写入、无 Selection 变更。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  classifyProtectedNextBlock,
  resolveDeleteBoundaryGuard,
  type DeleteBoundaryGuardInput,
} from './paragraph-delete-boundary'

function makeParagraph(options: {
  text?: string
  mode?: 'auto' | 'force-indent' | 'force-flush'
  html?: string
} = {}): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = options.text ?? ''
  p.setAttribute('data-inkchapter-indent-mode', options.mode ?? 'auto')
  if (options.html) p.innerHTML = options.html
  return p
}

function decide(overrides: Partial<DeleteBoundaryGuardInput> = {}) {
  return resolveDeleteBoundaryGuard({
    paragraph: makeParagraph({ mode: 'force-indent' }),
    indentMode: 'force-indent',
    selectionCollapsed: true,
    caretAtLogicalEnd: true,
    nextBlock: null,
    composing: false,
    ...overrides,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('P0-3 classifyProtectedNextBlock', () => {
  it('protects fenced code blocks (D03)', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    expect(classifyProtectedNextBlock(pre)).toBe('code')
  })

  it('protects markdown tables (D04)', () => {
    const table = document.createElement('table')
    expect(classifyProtectedNextBlock(table)).toBe('table')
  })

  it('protects display math (D05)', () => {
    const math = document.createElement('div')
    math.className = 'md-math-block'
    expect(classifyProtectedNextBlock(math)).toBe('math')
  })

  it('protects standalone images (D06)', () => {
    const p = document.createElement('p')
    p.innerHTML = '<img src="a.png">'
    expect(classifyProtectedNextBlock(p)).toBe('image')
  })

  it('protects horizontal rules (D07)', () => {
    expect(classifyProtectedNextBlock(document.createElement('hr'))).toBe('hr')
  })

  it('protects raw HTML blocks', () => {
    const div = document.createElement('div')
    div.className = 'md-htmlblock'
    expect(classifyProtectedNextBlock(div)).toBe('html')
  })

  it('allows an ordinary empty paragraph (D01)', () => {
    expect(classifyProtectedNextBlock(document.createElement('p'))).toBeNull()
  })

  it('allows an ordinary text paragraph (D02)', () => {
    const p = document.createElement('p')
    p.textContent = '正文'
    expect(classifyProtectedNextBlock(p)).toBeNull()
  })

  it('allows a paragraph mixing text and an inline image', () => {
    const p = document.createElement('p')
    p.innerHTML = '见下图 <img src="a.png">'
    expect(classifyProtectedNextBlock(p)).toBeNull()
  })

  it('allows a paragraph with inline math only', () => {
    const p = document.createElement('p')
    p.innerHTML = '<mjx-container></mjx-container>'
    expect(classifyProtectedNextBlock(p)).toBeNull()
  })

  it('does not treat headings / lists / quotes as protected structures', () => {
    const h1 = document.createElement('h1')
    h1.textContent = '标题'
    expect(classifyProtectedNextBlock(h1)).toBeNull()
    const ul = document.createElement('ul')
    expect(classifyProtectedNextBlock(ul)).toBeNull()
    const quote = document.createElement('blockquote')
    expect(classifyProtectedNextBlock(quote)).toBeNull()
  })

  it('never blocks on unknown non-paragraph containers', () => {
    const div = document.createElement('div')
    div.className = 'md-toc'
    expect(classifyProtectedNextBlock(div)).toBeNull()
  })

  it('recognizes a table wrapped in a single unlabeled container', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(document.createElement('table'))
    expect(classifyProtectedNextBlock(wrapper)).toBe('table')
  })

  it('recognizes a code block wrapped in a single unlabeled container', () => {
    const wrapper = document.createElement('div')
    const pre = document.createElement('pre')
    wrapper.appendChild(pre)
    expect(classifyProtectedNextBlock(wrapper)).toBe('code')
  })
})

describe('P0-3 resolveDeleteBoundaryGuard', () => {
  it('blocks Delete when A is force-indent empty and B is a code block', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    const decision = decide({ nextBlock: pre })
    expect(decision.blocked).toBe(true)
    expect(decision.reason).toBe('BLOCKED_STRUCTURAL_NEXT')
    expect(decision.kind).toBe('code')
    expect(decision.message).toBe('无法向后合并：下一项为代码块')
  })

  it('reports the block label for each protected structure', () => {
    const table = document.createElement('table')
    expect(decide({ nextBlock: table }).message).toBe('无法向后合并：下一项为表格')
    const math = document.createElement('div')
    math.className = 'md-math-block'
    expect(decide({ nextBlock: math }).message).toBe('无法向后合并：下一项为块级公式')
    const img = document.createElement('p')
    img.innerHTML = '<img src="a.png">'
    expect(decide({ nextBlock: img }).message).toBe('无法向后合并：下一项为图片')
    expect(decide({ nextBlock: document.createElement('hr') }).message).toBe('无法向后合并：下一项为水平分隔线')
    const html = document.createElement('div')
    html.className = 'md-htmlblock'
    expect(decide({ nextBlock: html }).message).toBe('无法向后合并：下一项为HTML 块')
  })

  it('allows legitimate merges with an ordinary paragraph (D01/D02)', () => {
    expect(decide({ nextBlock: document.createElement('p') }).blocked).toBe(false)
    const text = document.createElement('p')
    text.textContent = '正文'
    expect(decide({ nextBlock: text }).blocked).toBe(false)
  })

  it('never applies the force-indent rule to auto / force-flush paragraphs (D08)', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    expect(decide({ indentMode: 'auto', nextBlock: pre })).toMatchObject({
      blocked: false,
      reason: 'NOT_FORCE_INDENT',
    })
    expect(decide({ indentMode: 'force-flush', nextBlock: pre })).toMatchObject({
      blocked: false,
      reason: 'NOT_FORCE_INDENT',
    })
  })

  it('requires a collapsed caret at the logical end', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    expect(decide({ nextBlock: pre, caretAtLogicalEnd: false }).reason).toBe('CARET_NOT_AT_END')
    expect(decide({ nextBlock: pre, selectionCollapsed: false }).reason).toBe('RANGE_SELECTION')
    expect(decide({ nextBlock: pre, composing: true }).reason).toBe('IME_COMPOSITION')
  })

  it('requires a genuinely empty paragraph', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    const decision = decide({
      nextBlock: pre,
      paragraph: makeParagraph({ text: '已有文字', mode: 'force-indent' }),
    })
    expect(decision.blocked).toBe(false)
    expect(decision.reason).toBe('NOT_EMPTY_PARAGRAPH')
  })

  it('refuses to arm inside a nested container (never a top-level body paragraph)', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    const p = makeParagraph({ mode: 'force-indent' })
    const quote = document.createElement('blockquote')
    quote.appendChild(p)
    document.body.appendChild(quote)
    const decision = decide({ paragraph: p, nextBlock: pre })
    expect(decision.blocked).toBe(false)
    expect(decision.reason).toBe('NOT_ELIGIBLE_PARAGRAPH')
  })

  it('refuses to arm on a plugin-decorated paragraph', () => {
    const pre = document.createElement('pre')
    pre.className = 'md-fences'
    const p = makeParagraph({ mode: 'force-indent' })
    p.setAttribute('data-inkchapter-caption', 'true')
    document.body.appendChild(p)
    const decision = decide({ paragraph: p, nextBlock: pre })
    expect(decision.blocked).toBe(false)
    expect(decision.reason).toBe('NOT_ELIGIBLE_PARAGRAPH')
  })

  it('allows Delete when there is no following block', () => {
    expect(decide({ nextBlock: null }).blocked).toBe(false)
  })
})
