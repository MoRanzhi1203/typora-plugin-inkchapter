// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { CaptionDomAdapter } from './caption-dom-adapter'

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
  return root
}

function img(src: string, parent?: HTMLElement): HTMLElement {
  const p = document.createElement('p')
  const im = document.createElement('img')
  im.setAttribute('src', src)
  p.appendChild(im)
  ;(parent ?? document.body).appendChild(p)
  return im
}

function table(parent?: HTMLElement): HTMLElement {
  const t = document.createElement('table')
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.textContent = 'cell'
  tr.appendChild(td)
  t.appendChild(tr)
  ;(parent ?? document.body).appendChild(t)
  return t
}

function code(text: string, parent?: HTMLElement): HTMLElement {
  const pre = document.createElement('pre')
  pre.classList.add('md-fences')
  const c = document.createElement('code')
  c.textContent = text
  pre.appendChild(c)
  ;(parent ?? document.body).appendChild(pre)
  return pre
}

describe('CaptionDomAdapter', () => {
  let root: HTMLElement
  let adapter: CaptionDomAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new CaptionDomAdapter(() => root)
  })

  it('collects table/figure/code targets in document order with per-type ordinals', () => {
    const imA = img('a.png', root)
    const tb = table(root)
    const cd = code('console.log(1)', root)
    const imB = img('b.png', root)

    const targets = adapter.collectTargets()
    expect(targets.map(t => t.type)).toEqual(['figure', 'table', 'code', 'figure'])
    expect(targets[0].ordinal).toBe(0)
    expect(targets[3].ordinal).toBe(1)
    // Figure roots are the wrapping <p>.
    expect(targets[0].root.tagName).toBe('P')
    void imA; void imB
    expect(targets[1].root).toBe(tb)
    expect(targets[2].root).toBe(cd)
  })

  it('gives duplicate images the same contentSignature but distinct ordinals', () => {
    img('same.png', root)
    img('same.png', root)

    const targets = adapter.collectTargets().filter(t => t.type === 'figure')
    expect(targets).toHaveLength(2)
    expect(targets[0].contentSignature).toBeDefined()
    expect(targets[0].contentSignature).toBe(targets[1].contentSignature)
    expect(targets[0].ordinal).toBe(0)
    expect(targets[1].ordinal).toBe(1)
  })

  it('resolves an internal table cell to the table target root', () => {
    const tb = table(root)
    const td = tb.querySelector('td')!

    const target = adapter.resolveTargetForElement(td)
    expect(target).not.toBeNull()
    expect(target!.type).toBe('table')
    expect(target!.root).toBe(tb)
  })

  it('resolves an image to the figure target root', () => {
    const im = img('x.png', root)
    const target = adapter.resolveTargetForElement(im)
    expect(target!.type).toBe('figure')
  })

  it('resolves a code token to the code target root', () => {
    const pre = code('console.log(1)', root)
    const codeEl = pre.querySelector('code')!
    const target = adapter.resolveTargetForElement(codeEl)
    expect(target!.type).toBe('code')
    expect(target!.root).toBe(pre)
  })

  it('renders table caption above and figure caption below', () => {
    const tb = table(root)
    const targets = adapter.collectTargets()
    const tableTarget = targets.find(t => t.type === 'table')!

    const el = adapter.renderCaption(tableTarget, '表 1  结果', '结果', 'c1', 'above')
    expect(el.className).toContain('inkchapter-caption-table')
    expect(el.getAttribute('data-inkchapter-caption-id')).toBe('c1')
    expect(el.textContent).toBe('表 1  结果')
    // Above → inserted before the table.
    expect(root.childNodes[0]).toBe(el)
    expect(el.nextElementSibling).toBe(tb)
  })

  it('renders figure caption below the image paragraph', () => {
    const im = img('x.png', root)
    const p = im.closest('p')!
    const target = adapter.collectTargets().find(t => t.type === 'figure')!

    const el = adapter.renderCaption(target, '图 1  架构', '架构', 'c2', 'below')
    expect(el.previousElementSibling).toBe(p)
  })

  it('clears all captions and removes a single caption by id', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    adapter.renderCaption(target, '表 1  x', 'x', 'c1', 'above')
    adapter.renderCaption(target, '表 2  y', 'y', 'c2', 'above')

    adapter.removeCaption('c1')
    expect(root.querySelectorAll('.inkchapter-caption')).toHaveLength(1)

    adapter.clearAllCaptions()
    expect(root.querySelectorAll('.inkchapter-caption')).toHaveLength(0)
  })

  it('one md-fences containing CodeMirror PRE yields exactly one code target', () => {
    const fence = document.createElement('pre')
    fence.className = 'md-fences'
    const cm = document.createElement('div')
    cm.className = 'CodeMirror'
    const line = document.createElement('pre')
    line.className = 'CodeMirror-line'
    line.textContent = 'console.log(1)'
    cm.appendChild(line)
    fence.appendChild(cm)
    root.appendChild(fence)

    const codeTargets = adapter.collectTargets().filter(t => t.type === 'code')
    expect(codeTargets).toHaveLength(1)
    expect(codeTargets[0].root).toBe(fence)

    const d = adapter.getCodeDiagnostics()
    expect(d.rawPreCount).toBe(2)
    expect(d.rawMdFencesCount).toBe(1)
    expect(d.rawCodeMirrorLineCount).toBe(1)
    expect(d.canonicalFenceCount).toBe(1)
    expect(d.rejectedCodeMirrorInternalCount).toBe(1)
    expect(d.finalCodeTargetCount).toBe(1)
  })

  it('rejects PRE nested inside a canonical fence (nested PRE exclusion)', () => {
    const fence = document.createElement('pre')
    fence.className = 'md-fences'
    const inner = document.createElement('pre')
    inner.textContent = 'nested'
    fence.appendChild(inner)
    root.appendChild(fence)

    const codeTargets = adapter.collectTargets().filter(t => t.type === 'code')
    expect(codeTargets).toHaveLength(1)
    expect(codeTargets[0].root).toBe(fence)

    const d = adapter.getCodeDiagnostics()
    expect(d.rejectedNestedPreCount).toBe(1)
    expect(d.finalCodeTargetCount).toBe(1)
  })

  it('excludes PRE/CodeMirror inside a math block from code targets', () => {
    const math = document.createElement('div')
    math.className = 'md-math-block'
    const pre = document.createElement('pre')
    pre.className = 'CodeMirror-line'
    pre.textContent = 'a+b'
    math.appendChild(pre)
    root.appendChild(math)

    const codeTargets = adapter.collectTargets().filter(t => t.type === 'code')
    expect(codeTargets).toHaveLength(0)

    const d = adapter.getCodeDiagnostics()
    expect(d.rawMathHostCount).toBe(1)
    expect(d.rejectedMathInternalCount).toBe(1)
    expect(d.finalCodeTargetCount).toBe(0)
  })

  it('one code fence + one math block yields one code target', () => {
    const fence = document.createElement('pre')
    fence.className = 'md-fences'
    fence.textContent = 'code'
    root.appendChild(fence)

    const math = document.createElement('div')
    math.className = 'MathJax'
    const pre = document.createElement('pre')
    pre.className = 'CodeMirror-line'
    math.appendChild(pre)
    root.appendChild(math)

    const codeTargets = adapter.collectTargets().filter(t => t.type === 'code')
    expect(codeTargets).toHaveLength(1)

    const d = adapter.getCodeDiagnostics()
    expect(d.finalCodeTargetCount).toBe(1)
    expect(d.rejectedMathInternalCount).toBe(1)
  })

  it('code A + math + code B yields two code targets', () => {
    const fenceA = document.createElement('pre')
    fenceA.className = 'md-fences'
    fenceA.textContent = 'A'
    root.appendChild(fenceA)

    const math = document.createElement('div')
    math.className = 'md-math-block'
    const pre = document.createElement('pre')
    pre.className = 'CodeMirror-line'
    math.appendChild(pre)
    root.appendChild(math)

    const fenceB = document.createElement('pre')
    fenceB.className = 'md-fences'
    fenceB.textContent = 'B'
    root.appendChild(fenceB)

    const codeTargets = adapter.collectTargets().filter(t => t.type === 'code')
    expect(codeTargets).toHaveLength(2)
    expect(codeTargets.map(t => t.ordinal)).toEqual([0, 1])

    const d = adapter.getCodeDiagnostics()
    expect(d.finalCodeTargetCount).toBe(2)
  })

  it('reconcileCaptions is idempotent (CREATE then NO_OP, DOM identity preserved)', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const item = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }

    const r1 = adapter.reconcileCaptions([item])
    expect(r1.stats.createCount).toBe(1)
    const el1 = root.querySelector('[data-inkchapter-caption-id="c1"]')!

    const r2 = adapter.reconcileCaptions([item])
    expect(r2.stats.noOpCount).toBe(1)
    expect(r2.stats.createCount).toBe(0)
    const el2 = root.querySelector('[data-inkchapter-caption-id="c1"]')!
    expect(el2).toBe(el1)
  })

  it('reconcileCaptions updates text in place and removes stale captions', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const item1 = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }
    adapter.reconcileCaptions([item1])
    const el1 = root.querySelector('[data-inkchapter-caption-id="c1"]')!

    const item2 = { target, label: '表 1  结果', title: '结果', captionId: 'c1', position: 'above' as const }
    const r2 = adapter.reconcileCaptions([item2])
    expect(r2.stats.updateCount).toBe(1)
    expect(el1.textContent).toBe('表 1  结果')
    expect(el1).toBe(root.querySelector('[data-inkchapter-caption-id="c1"]')!)

    // A new id means the old one is stale.
    const r3 = adapter.reconcileCaptions([{ target, label: '表 1  结果', title: '结果', captionId: 'c2', position: 'above' as const }])
    expect(r3.stats.removeStaleCount).toBe(1)
    expect(root.querySelector('[data-inkchapter-caption-id="c1"]')).toBeNull()
    expect(root.querySelector('[data-inkchapter-caption-id="c2"]')).not.toBeNull()
  })

  it('resolves a caption decoration back to its owner target', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const el = adapter.renderCaption(target, '表 1  结果', '结果', 'c1', 'above')

    const resolved = adapter.resolveTargetForElement(el)
    expect(resolved).not.toBeNull()
    expect(resolved!.type).toBe('table')
    expect(resolved!.root).toBe(tb)
  })

  it('resolves a CodeMirror-line to the canonical fence', () => {
    const fence = document.createElement('pre')
    fence.className = 'md-fences'
    const cm = document.createElement('div')
    cm.className = 'CodeMirror'
    const line = document.createElement('pre')
    line.className = 'CodeMirror-line'
    line.textContent = 'code'
    cm.appendChild(line)
    fence.appendChild(cm)
    root.appendChild(fence)

    const resolved = adapter.resolveTargetForElement(line)
    expect(resolved).not.toBeNull()
    expect(resolved!.type).toBe('code')
    expect(resolved!.root).toBe(fence)
  })

  it('does not resolve a math internal PRE to a code target', () => {
    const math = document.createElement('div')
    math.className = 'md-math-block'
    const pre = document.createElement('pre')
    pre.className = 'CodeMirror-line'
    math.appendChild(pre)
    root.appendChild(math)

    expect(adapter.resolveTargetForElement(pre)).toBeNull()
  })

  it('table caption above inside a FIGURE wrapper is NO_OP on second reconcile', () => {
    const figure = document.createElement('figure')
    const tb = document.createElement('table')
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.textContent = 'cell'
    tr.appendChild(td)
    tb.appendChild(tr)
    figure.appendChild(tb)
    root.appendChild(figure)

    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const item = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }

    adapter.reconcileCaptions([item])
    const r2 = adapter.reconcileCaptions([item])
    expect(r2.stats.noOpCount).toBe(1)
    expect(r2.stats.moveCount).toBe(0)
  })

  it('position change above→below is MOVE once then NO_OP', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!

    const above = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }
    adapter.reconcileCaptions([above])
    const el1 = root.querySelector('[data-inkchapter-caption-id="c1"]')!

    const below = { target, label: '表 1', title: '', captionId: 'c1', position: 'below' as const }
    const r1 = adapter.reconcileCaptions([below])
    expect(r1.stats.moveCount).toBe(1)
    expect(el1.previousElementSibling).toBe(tb)

    const r2 = adapter.reconcileCaptions([below])
    expect(r2.stats.noOpCount).toBe(1)
    expect(r2.stats.moveCount).toBe(0)
  })

  it('name change reuses the same caption node (UPDATE_TEXT, not MOVE/CREATE)', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const item1 = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }
    adapter.reconcileCaptions([item1])
    const el1 = root.querySelector('[data-inkchapter-caption-id="c1"]')!

    const item2 = { target, label: '表 1  实验数据', title: '实验数据', captionId: 'c1', position: 'above' as const }
    const r = adapter.reconcileCaptions([item2])
    expect(r.stats.updateCount).toBe(1)
    expect(r.stats.moveCount).toBe(0)
    expect(r.stats.createCount).toBe(0)
    expect(root.querySelector('[data-inkchapter-caption-id="c1"]')).toBe(el1)
    expect(el1.textContent).toBe('表 1  实验数据')
  })

  it('resolveCaptionOwnerRoot resolves a caption to its figure owner', () => {
    const im = img('x.png', root)
    const target = adapter.collectTargets().find(t => t.type === 'figure')!
    const caption = adapter.renderCaption(target, '图 1  okok', 'okok', 'c1', 'below')

    const owner = adapter.resolveCaptionOwnerRoot(caption)
    expect(owner).not.toBeNull()
    expect(owner!.type).toBe('figure')
    expect(owner!.root).toBe(im.closest('p'))
    expect(owner!.targetKey).not.toBe('')
  })

  it('resolveCaptionOwnerRoot resolves a caption to its table owner', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const caption = adapter.renderCaption(target, '表 1  实验数据', '实验数据', 'c1', 'above')

    const owner = adapter.resolveCaptionOwnerRoot(caption)
    expect(owner).not.toBeNull()
    expect(owner!.type).toBe('table')
    expect(owner!.root).toBe(tb)
  })

  it('resolveCaptionOwnerRoot resolves a caption to its canonical code owner', () => {
    const pre = code('console.log(1)', root)
    const target = adapter.collectTargets().find(t => t.type === 'code')!
    const caption = adapter.renderCaption(target, '代码 1  初始化', '初始化', 'c1', 'above')

    const owner = adapter.resolveCaptionOwnerRoot(caption)
    expect(owner).not.toBeNull()
    expect(owner!.type).toBe('code')
    expect(owner!.root).toBe(pre)
  })

  it('resolveCaptionOwnerRoot blocks when the owner map has no entry', () => {
    const caption = document.createElement('div')
    caption.setAttribute('data-inkchapter-caption', 'true')
    caption.setAttribute('data-inkchapter-caption-type', 'figure')
    caption.setAttribute('data-inkchapter-caption-target-key', 'figure:anon:1')
    root.appendChild(caption)

    expect(adapter.resolveCaptionOwnerRoot(caption)).toBeNull()
  })

  it('targetKey is preserved across UPDATE_TEXT and MOVE', () => {
    const tb = table(root)
    const target = adapter.collectTargets().find(t => t.type === 'table')!
    const above = { target, label: '表 1', title: '', captionId: 'c1', position: 'above' as const }
    adapter.reconcileCaptions([above])
    const el = root.querySelector('[data-inkchapter-caption-id="c1"]')!
    const key1 = el.getAttribute('data-inkchapter-caption-target-key')
    expect(key1).not.toBe('')

    adapter.reconcileCaptions([{ target, label: '表 1  实验数据', title: '实验数据', captionId: 'c1', position: 'above' as const }])
    expect(el.getAttribute('data-inkchapter-caption-target-key')).toBe(key1)

    adapter.reconcileCaptions([{ target, label: '表 1  实验数据', title: '实验数据', captionId: 'c1', position: 'below' as const }])
    expect(el.getAttribute('data-inkchapter-caption-target-key')).toBe(key1)
  })
})
