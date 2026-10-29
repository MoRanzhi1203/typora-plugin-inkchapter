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
  getParagraphIndentMode,
  healExplicitSemanticOnTokenText,
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
  const start = scss.indexOf('/* ── Two-character first-line indent marker')
  const end = scss.indexOf('/* ── Settings page: live preview', start)
  const block = start >= 0 && end > start ? scss.slice(start, end) : ''
  /** Rule text only — comments mention the forbidden properties by name. */
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '')

  it('存在标记选择器', () => {
    expect(block).toContain('[data-inkchapter-indent-marker]')
    expect(block).toContain('::before')
    expect(block).toContain('::after')
    expect(block).toContain('border: 1px dashed')
  })

  it('方框不额外增加 text-indent / padding（不重复缩进）', () => {
    expect(rules.includes('text-indent')).toBe(false)
    expect(rules.includes('padding')).toBe(false)
    expect(rules.includes("content: ''")).toBe(true)
  })

  it('源代码模式隐藏、打印/导出隐藏（对显式与继承两种标记同时生效）', () => {
    expect(block).toContain('body.typora-sourceview-on #write p[data-inkchapter-indent-marker]')
    expect(block).toContain('@media print')
    expect((block.match(/display: none/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('装饰不可交互、不进入选择', () => {
    expect(block).toContain('pointer-events: none')
    expect(block).toContain('user-select: none')
  })

  it('继承标记使用更浅的不透明度（与显式覆盖可区分）', () => {
    expect(block).toContain('[data-inkchapter-indent-marker="inherited-2"]')
    expect(block).toContain('opacity: 0.2')
  })

  // IND-053 — deterministic cascade check: the source-view rule must come AFTER
  // the base pseudo-element rule and carry `display: none`, with a selector at
  // least as specific (`body.typora-sourceview-on` adds one class).
  it('IND-053 源代码模式规则在基础规则之后且更高特异性 ⇒ 覆盖为 display:none', () => {
    const baseIdx = block.indexOf('#write p[data-inkchapter-indent-marker]::before,')
    const sourceIdx = block.indexOf('body.typora-sourceview-on #write p[data-inkchapter-indent-marker]::before,')
    expect(baseIdx).toBeGreaterThanOrEqual(0)
    expect(sourceIdx).toBeGreaterThan(baseIdx)
    const sourceRule = block.slice(sourceIdx, block.indexOf('}', sourceIdx) + 1)
    expect(sourceRule).toContain('display: none')
  })

  // IND-052 — the plugin's own read-only lock (`DocumentEditGuard`) marks the
  // editor root with `inkchapter-document-locked`. Read-only is a viewing mode:
  // the editing boxes must disappear while the first-line indent stays.
  it('IND-052 锁定/只读规则存在、位于基础规则之后、且只隐藏伪元素', () => {
    const baseIdx = block.indexOf('#write p[data-inkchapter-indent-marker]::before,')
    const lockedIdx = block.indexOf('#write.inkchapter-document-locked p[data-inkchapter-indent-marker]::before,')
    expect(baseIdx).toBeGreaterThanOrEqual(0)
    expect(lockedIdx).toBeGreaterThan(baseIdx)
    const lockedRule = block.slice(lockedIdx, block.indexOf('}', lockedIdx) + 1)
    expect(lockedRule).toContain('display: none')
    // Indent itself is NOT touched by this rule (no text-indent / padding).
    expect(lockedRule.includes('text-indent')).toBe(false)
    expect(lockedRule.includes('padding')).toBe(false)
  })
})

describe('IND-052 只读锁定态：缩进保留、标记由 CSS 隐藏', () => {
  const LOCK_SETTINGS = { ...INDENT_SETTINGS, showInheritedIndentMarker: true }

  it('锁定不改变段落投影（缩进 class 与标记属性照常写入）', () => {
    const p = makeP('正文内容')
    root.classList.add('inkchapter-document-locked')
    refreshParagraphIndentStyles(root, LOCK_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('inherited-2')
  })

  it('解锁后投影保持一致（无需重算）', () => {
    const p = makeP('正文内容')
    root.classList.add('inkchapter-document-locked')
    refreshParagraphIndentStyles(root, LOCK_SETTINGS)
    root.classList.remove('inkchapter-document-locked')
    expect(p.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('inherited-2')
  })
})

describe('IND-058 / IND-059 / IND-060 几何契约：几何随字号缩放，不依赖视口', () => {
  const scss = readFileSync(join(process.cwd(), 'src', 'style.scss'), 'utf8')
  const start = scss.indexOf('/* ── Two-character first-line indent marker')
  const end = scss.indexOf('/* ── Settings page: live preview', start)
  const block = start >= 0 && end > start ? scss.slice(start, end) : ''
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '')

  it('标记段落建立包含块，伪元素绝对定位（随段落滚动/重排，不脱离文档流）', () => {
    const paragraphRule = rules.slice(
      rules.indexOf('#write p[data-inkchapter-indent-marker] {'),
      rules.indexOf('}', rules.indexOf('#write p[data-inkchapter-indent-marker] {')) + 1,
    )
    expect(paragraphRule).toContain('position: relative')

    const pseudoRule = rules.slice(
      rules.indexOf('#write p[data-inkchapter-indent-marker]::before,'),
      rules.indexOf('}', rules.indexOf('content:')) + 1,
    )
    expect(pseudoRule).toContain('position: absolute')
    // Absolute children are positioned from the paragraph box, never the viewport.
    expect(pseudoRule.includes('position: fixed')).toBe(false)
  })

  it('IND-058 缩放：所有尺寸使用 em（唯一 px 为 1px 描边/圆角）', () => {
    const pxValues = rules.match(/[\d.]+px/g) ?? []
    expect(pxValues.length).toBeGreaterThan(0)
    expect(pxValues.every(v => v === '1px')).toBe(true)
    expect(rules).toContain('width: 0.72em')
    expect(rules).toContain('height: 0.72em')
    expect(rules).toContain('top: 0.3em')
  })

  it('IND-059 宽度/侧栏变化：水平位置用逻辑内联起点（em），不写死 left/right', () => {
    expect(rules).toContain('inset-inline-start: 0.18em')
    expect(rules).toContain('inset-inline-start: 1.04em')
    expect(/(^|[^-])left\s*:/.test(rules)).toBe(false)
    expect(/(^|[^-])right\s*:/.test(rules)).toBe(false)
    expect(rules.includes('vw') || rules.includes('vh')).toBe(false)
  })

  it('IND-060 主题/字体/折行：标记无固定行高与像素定位，缩进本体为 em', () => {
    expect(rules.includes('line-height')).toBe(false)
    expect(rules.includes('%')).toBe(false)
    const indentRule = scss.slice(
      scss.indexOf('#write p.inkchapter-paragraph-effective-indent-2 {'),
      scss.indexOf('}', scss.indexOf('#write p.inkchapter-paragraph-effective-indent-2 {')) + 1,
    )
    expect(indentRule).toContain('text-indent: 2em')
  })
})

describe('IND-020 / IND-045 IME 组合期不覆盖投影', () => {
  const IME_SETTINGS = { ...INDENT_SETTINGS, showInheritedIndentMarker: true }

  it('组合中的段落保持原样，其它段落照常投影', () => {
    const p1 = makeP('正在输入')
    const p2 = makeP('另一段')
    setCaret(p1, 0)
    const stats = refreshParagraphIndentStyles(root, IME_SETTINGS, true)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(false)
    expect(p1.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
    expect(p2.classList.contains(INDENT_CLASS)).toBe(true)
    expect(stats.composingSkipped).toBe(1)
  })

  it('组合结束（isComposing=false）后同一段落立即补投影', () => {
    const p1 = makeP('正在输入')
    setCaret(p1, 0)
    refreshParagraphIndentStyles(root, IME_SETTINGS, true)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(false)
    const stats = refreshParagraphIndentStyles(root, IME_SETTINGS, false)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p1.getAttribute(INDENT_MARKER_ATTR)).toBe('inherited-2')
    expect(stats.composingSkipped).toBe(0)
  })

  it('组合期不撤销已有显式投影（不清 class / 不清标记）', () => {
    const p1 = makeP('正文内容')
    refreshParagraphIndentStyles(root, IME_SETTINGS)
    setParagraphIndentMode(p1, 'force-indent')
    refreshParagraphIndentStyles(root, IME_SETTINGS)
    expect(p1.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')

    setCaret(p1, 0)
    const stats = refreshParagraphIndentStyles(root, IME_SETTINGS, true)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p1.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')
    expect(stats.composingSkipped).toBe(1)
  })

  it('组合中出现的独占标记字符不会在组合期把缩进降级为 flush', () => {
    const p1 = makeP('正文内容')
    refreshParagraphIndentStyles(root, IME_SETTINGS)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(true)

    // IME inserts a lone "。" while composing.
    p1.textContent = '。'
    setCaret(p1, 0)
    const stats = refreshParagraphIndentStyles(root, IME_SETTINGS, true)
    expect(stats.composingSkipped).toBe(1)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p1.classList.contains('inkchapter-paragraph-effective-flush')).toBe(false)

    // Composition ends: the editing-token rule now legitimately applies.
    refreshParagraphIndentStyles(root, IME_SETTINGS, false)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(false)
    expect(p1.classList.contains('inkchapter-paragraph-effective-flush')).toBe(true)
  })

  it('无选区时组合标志不跳过任何段落', () => {
    const p1 = makeP('正文内容')
    window.getSelection()?.removeAllRanges()
    const stats = refreshParagraphIndentStyles(root, IME_SETTINGS, true)
    expect(stats.composingSkipped).toBe(0)
    expect(p1.classList.contains(INDENT_CLASS)).toBe(true)
  })
})

describe('IND-032…035 Undo/Redo：令牌文本回归时自愈显式语义', () => {
  it('force-indent + 文本回到 ".." ⇒ 语义回退 auto', () => {
    const p = makeP('正文内容')
    setParagraphIndentMode(p, 'force-indent')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)

    // Typora undo restores the token text, the plugin attribute survives.
    p.textContent = '..'
    expect(healExplicitSemanticOnTokenText(root)).toBe(1)
    expect(getParagraphIndentMode(p)).toBe('auto')
  })

  it('自愈后投影为 flush 且无标记（不再显示已提交的缩进）', () => {
    const p = makeP('正文内容')
    setParagraphIndentMode(p, 'force-indent')
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')

    p.textContent = '。。'
    healExplicitSemanticOnTokenText(root)
    refreshParagraphIndentStyles(root, INDENT_SETTINGS)
    expect(p.classList.contains(INDENT_CLASS)).toBe(false)
    expect(p.classList.contains('inkchapter-paragraph-effective-flush')).toBe(true)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('非令牌文本保持显式语义（不误伤真实覆盖）', () => {
    const p = makeP('正文内容')
    setParagraphIndentMode(p, 'force-indent')
    expect(healExplicitSemanticOnTokenText(root)).toBe(0)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })

  it('令牌只是文本前缀/后缀时不触发（必须是整段恰为令牌）', () => {
    const p = makeP('..正文')
    setParagraphIndentMode(p, 'force-indent')
    expect(healExplicitSemanticOnTokenText(root)).toBe(0)

    p.textContent = '正文。。'
    expect(healExplicitSemanticOnTokenText(root)).toBe(0)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBe('force-indent')
  })

  it('force-flush + 令牌文本同样回退 auto', () => {
    const p = makeP('。')
    setParagraphIndentMode(p, 'force-flush')
    expect(healExplicitSemanticOnTokenText(root)).toBe(1)
    expect(getParagraphIndentMode(p)).toBe('auto')
  })

  it('自愈是幂等的（重复刷新不再计次）', () => {
    const p = makeP('..')
    setParagraphIndentMode(p, 'force-indent')
    expect(healExplicitSemanticOnTokenText(root)).toBe(1)
    expect(healExplicitSemanticOnTokenText(root)).toBe(0)
  })

  it('auto 段落上的令牌文本不产生副作用', () => {
    const p = makeP('..')
    expect(healExplicitSemanticOnTokenText(root)).toBe(0)
    expect(p.getAttribute(INDENT_MODE_ATTR)).toBeNull()
  })
})

describe('IND-057 继承缩进标记开关（showInheritedIndentMarker）', () => {
  const INHERITED_SETTINGS = { ...INDENT_SETTINGS, showInheritedIndentMarker: true }
  const INHERITED_OFF = { ...INDENT_SETTINGS, showInheritedIndentMarker: false }

  it('默认关闭：继承默认缩进的段落不显示标记', () => {
    const p = makeP('正文内容')
    refreshParagraphIndentStyles(root, INHERITED_OFF)
    expect(p.classList.contains(INDENT_CLASS)).toBe(true)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('开启后：继承默认缩进的段落显示 inherited-2 标记', () => {
    const p = makeP('正文内容')
    refreshParagraphIndentStyles(root, INHERITED_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('inherited-2')
  })

  it('开启后：默认顶格的段落仍无标记', () => {
    const p = makeP('正文内容')
    refreshParagraphIndentStyles(root, { ...INHERITED_SETTINGS, defaultIndent: 'flush' })
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('开启后：显式 force-indent 仍是 explicit-2（不降级为继承）', () => {
    const p = makeP('正文内容')
    setParagraphIndentMode(p, 'force-indent')
    refreshParagraphIndentStyles(root, INHERITED_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('explicit-2')
  })

  it('关闭开关后重建投影会撤销继承标记', () => {
    const p = makeP('正文内容')
    refreshParagraphIndentStyles(root, INHERITED_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBe('inherited-2')
    refreshParagraphIndentStyles(root, INHERITED_OFF)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('开启后：非普通正文段落（图文混排）永不显示标记', () => {
    const p = makeP('<img src="a.png" alt="">说明文字')
    refreshParagraphIndentStyles(root, INHERITED_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })

  it('开启后：force-flush 段落无标记', () => {
    const p = makeP('正文内容')
    setParagraphIndentMode(p, 'force-flush')
    refreshParagraphIndentStyles(root, INHERITED_SETTINGS)
    expect(p.getAttribute(INDENT_MARKER_ATTR)).toBeNull()
  })
})
