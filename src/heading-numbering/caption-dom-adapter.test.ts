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
})
