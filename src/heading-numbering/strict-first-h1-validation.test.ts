// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveFirstSemanticBlock,
  validateStrictFirstH1,
} from './strict-document-validator'

function root(...children: (Node | string)[]): HTMLElement {
  const r = document.createElement('div')
  for (const c of children) {
    if (typeof c === 'string') {
      const p = document.createElement('p')
      p.textContent = c
      r.appendChild(p)
    } else {
      r.appendChild(c)
    }
  }
  return r
}

function h(level: number, text = ''): HTMLElement {
  const el = document.createElement(`h${level}`)
  el.textContent = text
  return el
}

describe('STRICT-FIRST-H1: strict mode first-semantic-block H1 validation', () => {
  it('STRICT-FIRST-H1-1: strict + document starts with H1 → PASS', () => {
    const r = root(h(1, '标题'), '正文')
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('heading')
    expect(block?.headingLevel).toBe(1)
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('PASS')
  })

  it('STRICT-FIRST-H1-2: strict + blank lines then H1 → PASS', () => {
    const r = root('', '', h(1, '标题'), '正文')
    const block = resolveFirstSemanticBlock(r)
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('PASS')
  })

  it('STRICT-FIRST-H1-3: strict + BOM then H1 → PASS', () => {
    const r = document.createElement('div')
    r.appendChild(document.createTextNode('\uFEFF'))
    r.appendChild(h(1, '标题'))
    r.appendChild(root('正文'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('heading')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('PASS')
  })

  it('STRICT-FIRST-H1-4: strict + paragraph before H1 → FAIL', () => {
    const r = root('正文', h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('paragraph')
    const v = validateStrictFirstH1(block, 'strict')
    expect(v.decision).toBe('FAIL')
    expect(v.reason).toBe('STRICT_FIRST_H1_VIOLATION')
  })

  it('STRICT-FIRST-H1-5: strict + H2 before H1 → FAIL', () => {
    const r = root(h(2, '二级'), h(1, '一级'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('heading')
    expect(block?.headingLevel).toBe(2)
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-6: strict + quote before H1 → FAIL', () => {
    const bq = document.createElement('blockquote')
    bq.textContent = '引用'
    const r = root(bq, h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('quote')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-7: strict + list before H1 → FAIL', () => {
    const ul = document.createElement('ul')
    const li = document.createElement('li')
    li.textContent = '列表'
    ul.appendChild(li)
    const r = root(ul, h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('list')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-8: strict + code block before H1 → FAIL', () => {
    const pre = document.createElement('pre')
    pre.textContent = 'code()'
    const r = root(pre, h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('code')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-9: strict + table/math/image/html/hr before H1 → FAIL', () => {
    // hr
    const r1 = root(document.createElement('hr'), h(1, '标题'))
    expect(resolveFirstSemanticBlock(r1)?.type).toBe('hr')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r1), 'strict').decision).toBe('FAIL')

    // table
    const table = document.createElement('table')
    const r2 = root(table, h(1, '标题'))
    expect(resolveFirstSemanticBlock(r2)?.type).toBe('table')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r2), 'strict').decision).toBe('FAIL')

    // image (p containing img)
    const pImg = document.createElement('p')
    pImg.appendChild(document.createElement('img'))
    const r3 = root(pImg, h(1, '标题'))
    expect(resolveFirstSemanticBlock(r3)?.type).toBe('image')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r3), 'strict').decision).toBe('FAIL')

    // math block
    const math = document.createElement('div')
    math.classList.add('md-math-block')
    math.textContent = '$$x$$'
    const r4 = root(math, h(1, '标题'))
    expect(resolveFirstSemanticBlock(r4)?.type).toBe('math')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r4), 'strict').decision).toBe('FAIL')

    // html (unknown block)
    const html = document.createElement('div')
    html.textContent = '<div>raw</div>'
    const r5 = root(html, h(1, '标题'))
    expect(resolveFirstSemanticBlock(r5)?.type).toBe('html')
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r5), 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-10: strict + YAML front matter before H1 → FAIL', () => {
    const fm = document.createElement('div')
    fm.classList.add('md-meta-block')
    fm.textContent = 'title: Demo'
    const r = root(fm, h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(block?.type).toBe('front-matter')
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
  })

  it('STRICT-FIRST-H1-11: strict + empty document → FAIL', () => {
    const r = root()
    const block = resolveFirstSemanticBlock(r)
    expect(block).toBeNull()
    const v = validateStrictFirstH1(block, 'strict')
    expect(v.decision).toBe('FAIL')
    expect(v.reason).toBe('DOCUMENT_EMPTY_NO_H1')
  })

  it('STRICT-FIRST-H1-12: loose + paragraph before H1 → SKIP / no error', () => {
    const r = root('正文', h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    const v = validateStrictFirstH1(block, 'loose')
    expect(v.decision).toBe('SKIP')
    expect(v.skipped).toBe(true)
  })

  it('STRICT-FIRST-H1-13: mode toggle refreshes (strict FAIL vs loose SKIP)', () => {
    const r = root('正文', h(1, '标题'))
    const block = resolveFirstSemanticBlock(r)
    expect(validateStrictFirstH1(block, 'strict').decision).toBe('FAIL')
    expect(validateStrictFirstH1(block, 'loose').decision).toBe('SKIP')
  })

  it('STRICT-FIRST-H1-14: first paragraph changed into H1 → FAIL → PASS', () => {
    const r = root('正文')
    const p0 = r.children[0] as HTMLElement
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')

    const newH1 = h(1, '标题')
    r.replaceChild(newH1, p0)
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('PASS')
  })

  it('STRICT-FIRST-H1-15: first H1 changed into paragraph → PASS → FAIL', () => {
    const r = root(h(1, '标题'))
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('PASS')

    const h1 = r.children[0] as HTMLElement
    const newP = document.createElement('p')
    newP.textContent = '正文'
    r.replaceChild(newP, h1)
    expect(validateStrictFirstH1(resolveFirstSemanticBlock(r), 'strict').decision).toBe('FAIL')
  })
})
