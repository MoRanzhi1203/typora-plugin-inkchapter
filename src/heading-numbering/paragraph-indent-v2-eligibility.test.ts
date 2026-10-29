/**
 * Paragraph Indent V2 — Paragraph-Only Eligibility Gate (RED→GREEN).
 *
 * 缺陷基线（修复前必须失败）：
 *   - 图片段落 / 图文混排段落 / 内联字面量 / 显示公式 / 题注装饰 都能通过
 *     `resolveCurrentBodyParagraph` 与 `refreshParagraphIndentStyles`，
 *     导致 `..`+Enter 命令与文档默认缩进投影落到非普通正文业务对象上。
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveCurrentBodyParagraph,
  refreshParagraphIndentStyles,
  setParagraphIndentMode,
  INDENT_MODE_ATTR,
  INDENT_MARKER_ATTR,
  INDENT_MARKER_VALUE,
} from './paragraph-indent-manager'
import {
  resolveParagraphIndentEligibility,
  paragraphIndentIsolationCounters,
  resetParagraphIndentIsolationCounters,
} from './paragraph-indent-eligibility'
import { classifyMutationProvenance } from './document-utility-mutation-provenance-v1'
import { DEFAULT_PARAGRAPH_LAYOUT } from './heading-types'

const INDENT_CLASS = 'inkchapter-paragraph-effective-indent-2'
const INDENT_SETTINGS = { ...DEFAULT_PARAGRAPH_LAYOUT, defaultIndent: 'indent-2' as const }

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
})

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

function setCaret(el: HTMLElement, offset = 0): void {
  const range = document.createRange()
  range.setStart(el, Math.min(offset, el.childNodes.length))
  range.collapse(true)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function makeP(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  root.appendChild(p)
  return p
}

describe('RED-1 段落资格：非普通正文不得成为缩进命令目标', () => {
  it('图片独占段落不是普通正文段落', () => {
    const p = makeP('<img src="a.png" alt="">')
    setCaret(p, 0)
    expect(resolveCurrentBodyParagraph(root)).toBeNull()
  })

  it('图文混排段落（图像 + 文本）默认失败关闭', () => {
    const p = makeP('<img src="a.png" alt="">正文')
    setCaret(p, 1)
    expect(resolveCurrentBodyParagraph(root)).toBeNull()
  })

  it('内联字面量段落（code 承载 .. 令牌）不是命令目标', () => {
    const p = makeP('<code>..</code>')
    setCaret(p, 0)
    expect(resolveCurrentBodyParagraph(root)).toBeNull()
  })

  it('显示公式段落不是命令目标', () => {
    const p = makeP('<mjx-container display="true"><math></math></mjx-container>')
    setCaret(p, 0)
    expect(resolveCurrentBodyParagraph(root)).toBeNull()
  })

  it('插件题注装饰段落不是命令目标', () => {
    const p = makeP('图 1 题注')
    p.setAttribute('data-inkchapter-caption', 'figure')
    setCaret(p, 0)
    expect(resolveCurrentBodyParagraph(root)).toBeNull()
  })
})

describe('RED-2 缩进投影：非普通正文段落不得获得 CSS 缩进', () => {
  it('图文混排段落不获得文档默认缩进投影', () => {
    const p = makeP('<img src="a.png" alt="">说明文字')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
  })

  it('内联字面量段落不获得文档默认缩进投影', () => {
    const p = makeP('输入 <code>..</code> 加回车')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
  })

  it('题注装饰段落不获得缩进投影', () => {
    const p = makeP('图 1 题注')
    p.setAttribute('data-inkchapter-caption', 'figure')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
  })

  it('显示公式段落不获得缩进投影', () => {
    const p = makeP('<mjx-container display="true"><math></math></mjx-container>')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
  })

  it('普通正文段落仍获得文档默认缩进投影（对照）', () => {
    const p = makeP('正文内容')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(true)
  })
})

describe('GREEN-1 统一资格判定 resolveParagraphIndentEligibility', () => {
  it('普通正文段落 eligible', () => {
    const p = makeP('正文内容')
    expect(resolveParagraphIndentEligibility(p).eligible).toBe(true)
  })

  it('空普通段落（可编辑空段落）eligible', () => {
    const p = makeP('')
    expect(resolveParagraphIndentEligibility(p).eligible).toBe(true)
  })

  it('br-only 空段落 eligible', () => {
    const p = makeP('<br>')
    expect(resolveParagraphIndentEligibility(p).eligible).toBe(true)
  })

  const cases: Array<[string, () => HTMLElement, string]> = [
    ['图片独占段落', () => { const p = document.createElement('p'); p.innerHTML = '<img src="a.png" alt="">'; root.appendChild(p); return p }, 'NON_TEXT_BLOCK'],
    ['图文混排段落', () => { const p = document.createElement('p'); p.innerHTML = '<img src="a.png" alt="">文字'; root.appendChild(p); return p }, 'NON_TEXT_BLOCK'],
    ['内联 code 段落', () => { const p = document.createElement('p'); p.innerHTML = '<code>..</code>'; root.appendChild(p); return p }, 'INLINE_LITERAL_CONTENT'],
    ['显示公式段落', () => { const p = document.createElement('p'); p.innerHTML = '<mjx-container display="true"></mjx-container>'; root.appendChild(p); return p }, 'NON_TEXT_BLOCK'],
    ['题注装饰段落', () => { const p = document.createElement('p'); p.textContent = '图 1'; p.setAttribute('data-inkchapter-caption', 'figure'); root.appendChild(p); return p }, 'PLUGIN_DECORATION'],
  ]

  for (const [name, make, reason] of cases) {
    it(`${name} ineligible (${reason})`, () => {
      const p = make()
      const r = resolveParagraphIndentEligibility(p)
      expect(r.eligible).toBe(false)
      expect(r.reason).toBe(reason)
    })
  }

  it('标题 / 列表 / 引用 / 表格 / 代码块内段落全部 ineligible', () => {
    const h = document.createElement('h2'); h.textContent = '标题'; root.appendChild(h)
    expect(resolveParagraphIndentEligibility(h).eligible).toBe(false)

    const li = document.createElement('li'); li.textContent = '列表项'; const ul = document.createElement('ul'); ul.appendChild(li); root.appendChild(ul)
    expect(resolveParagraphIndentEligibility(li).eligible).toBe(false)

    const bq = document.createElement('blockquote'); const bp = document.createElement('p'); bp.textContent = '引用'; bq.appendChild(bp); root.appendChild(bq)
    expect(resolveParagraphIndentEligibility(bp).eligible).toBe(false)

    const table = document.createElement('table'); const tr = document.createElement('tr'); const td = document.createElement('td'); const tp = document.createElement('p'); tp.textContent = '单元格'; td.appendChild(tp); tr.appendChild(td); table.appendChild(tr); root.appendChild(table)
    expect(resolveParagraphIndentEligibility(tp).eligible).toBe(false)

    const pre = document.createElement('pre'); pre.className = 'md-fences'; const pp = document.createElement('p'); pp.textContent = '..'; pre.appendChild(pp); root.appendChild(pre)
    expect(resolveParagraphIndentEligibility(pp).eligible).toBe(false)
  })

  it('null / 非元素输入 ineligible', () => {
    expect(resolveParagraphIndentEligibility(null).eligible).toBe(false)
  })
})

describe('GREEN-2 双方框标记投影（仅显式二字符缩进）', () => {
  beforeEach(() => resetParagraphIndentIsolationCounters())

  it('force-indent 普通段落写入标记属性', () => {
    const p = makeP('正文')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe(INDENT_MARKER_VALUE)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })

  it('空普通段落（可编辑空段落）同样写入标记属性', () => {
    const p = makeP('')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe(INDENT_MARKER_VALUE)
  })

  it('auto / force-flush 不写标记', () => {
    const a = makeP('正文 A')
    setParagraphIndentMode(a, 'auto')
    expect(a.getAttribute(INDENT_MARKER_ATTR)).toBeNull()

    const b = makeP('正文 B')
    setParagraphIndentMode(b, 'force-flush')
    expect(b.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('非普通正文段落永不获得标记（失败关闭 + 计数）', () => {
    const p = makeP('<img src="a.png" alt="">')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
    expect(paragraphIndentIsolationCounters.nonParagraphIndentMarkerCount).toBe(1)
  })

  it('切回 auto 时标记被撤销', () => {
    const p = makeP('正文')
    setParagraphIndentMode(p, 'force-indent')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe(INDENT_MARKER_VALUE)
    setParagraphIndentMode(p, 'auto')
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('标记不创建文本节点、不改变可见文本', () => {
    const p = makeP('正文')
    const before = p.textContent
    const childCountBefore = p.childNodes.length
    setParagraphIndentMode(p, 'force-indent')
    expect(p.textContent).toBe(before)
    expect(p.childNodes.length).toBe(childCountBefore)
  })
})

describe('GREEN-3 标记属性归为插件呈现（诊断 / 空行兼容）', () => {
  it('data-inkchapter-indent-marker 属性变更属于 PLUGIN_PRESENTATION', () => {
    const p = makeP('正文')
    const result = classifyMutationProvenance([
      {
        type: 'attributes',
        target: p,
        addedNodes: [],
        removedNodes: [],
        attributeName: 'data-inkchapter-indent-marker',
        previousClassName: '',
      },
    ])
    expect(result.provenance).toBe('PLUGIN_PRESENTATION')
    expect(result.counts.userContentMutationCount).toBe(0)
  })
})

describe('GREEN-4 标记样式契约（style.scss）', () => {
  const scss = readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')
  const start = scss.indexOf('/* ── Explicit two-character first-line indent marker')
  const end = scss.indexOf('/* ── Settings page: live preview', start)
  const block = start >= 0 && end > start ? scss.slice(start, end) : ''
  /** Rule text only — comments mention the forbidden properties by name. */
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '')

  it('存在标记选择器', () => {
    expect(block).toContain('[data-inkchapter-indent-marker="explicit-2"]')
    expect(block).toContain('::before')
    expect(block).toContain('::after')
    expect(block).toContain('border: 1px dashed')
  })

  it('方框不额外增加 text-indent / padding（不重复缩进）', () => {
    expect(rules.includes('text-indent')).toBe(false)
    expect(rules.includes('padding')).toBe(false)
    expect(rules.includes("content: ''")).toBe(true)
  })

  it('源代码模式隐藏、打印/导出隐藏', () => {
    expect(block).toContain('body.typora-sourceview-on')
    expect(block).toContain('@media print')
    expect((block.match(/display: none/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('装饰不可交互、不进入选择', () => {
    expect(block).toContain('pointer-events: none')
    expect(block).toContain('user-select: none')
  })
})
