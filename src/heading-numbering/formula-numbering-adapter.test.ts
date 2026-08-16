// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  FormulaNumberingAdapter,
  classifyFormulaHost,
  chooseFormulaStrategy,
  computeDoubleNumberDetected,
} from './formula-numbering-adapter'

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
  return root
}

function blockFormula(nativeText: string, parent: HTMLElement): HTMLElement {
  const div = document.createElement('div')
  div.className = 'md-math-block'
  div.setAttribute('contenteditable', 'false')
  const mjx = document.createElement('mjx-container')
  mjx.className = 'MathJax'
  mjx.setAttribute('display', 'true')
  const svg = document.createElement('svg')
  svg.textContent = 'x'
  mjx.appendChild(svg)
  div.appendChild(mjx)
  if (nativeText) {
    const num = document.createElement('span')
    num.className = 'md-math-number'
    num.textContent = nativeText
    div.appendChild(num)
  }
  parent.appendChild(div)
  return div
}

describe('classifyFormulaHost', () => {
  it('accepts block formula host', () => {
    const root = makeRoot()
    const host = blockFormula('(1)', root)
    expect(classifyFormulaHost(host)).toEqual({ decision: 'ACCEPT_BLOCK_FORMULA', reason: 'BLOCK_FORMULA_HOST', canonicalHost: host })
  })

  it('rejects inline math (span)', () => {
    const root = makeRoot()
    const p = document.createElement('p')
    const span = document.createElement('span')
    span.className = 'md-math'
    span.textContent = 'x'
    p.appendChild(span)
    root.appendChild(p)
    expect(classifyFormulaHost(span).decision).toBe('REJECT_INLINE_MATH')
  })

  it('rejects nested pre (math editor internal)', () => {
    const root = makeRoot()
    const pre = document.createElement('pre')
    const div = document.createElement('div')
    div.className = 'md-math-block'
    pre.appendChild(div)
    root.appendChild(pre)
    expect(classifyFormulaHost(div).decision).toBe('REJECT_NESTED_PRE')
  })

  it('rejects CodeMirror internal', () => {
    const root = makeRoot()
    const cm = document.createElement('div')
    cm.className = 'CodeMirror'
    const div = document.createElement('div')
    div.className = 'md-math-block'
    cm.appendChild(div)
    root.appendChild(cm)
    expect(classifyFormulaHost(div).decision).toBe('REJECT_CODEMIRROR_INTERNAL')
  })
})

describe('chooseFormulaStrategy', () => {
  it('A: reuse native node', () => {
    expect(chooseFormulaStrategy({ nativeNumberFound: true, nativeNodeSafe: true })).toBe('reuse-native')
  })
  it('B: hide native + render custom', () => {
    expect(chooseFormulaStrategy({ nativeNumberFound: true, nativeNodeSafe: false })).toBe('hide-native')
  })
  it('C: block custom', () => {
    expect(chooseFormulaStrategy({ nativeNumberFound: false, nativeNodeSafe: false })).toBe('block')
  })
})

describe('computeDoubleNumberDetected', () => {
  it('detects only when both native and inkchapter visible', () => {
    expect(computeDoubleNumberDetected(1, 1)).toBe(true)
    expect(computeDoubleNumberDetected(1, 0)).toBe(false)
    expect(computeDoubleNumberDetected(0, 1)).toBe(false)
    expect(computeDoubleNumberDetected(0, 0)).toBe(false)
  })
})

describe('FormulaNumberingAdapter.collectFormulaTargets', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  it('collects block formulas and detects native number', () => {
    blockFormula('(1)', root)
    blockFormula('(2)', root)

    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(2)
    expect(targets[0].ordinal).toBe(0)
    expect(targets[0].nativeNumberText).toBe('(1)')
    expect(targets[0].nativeNodeSafe).toBe(true)
    expect(targets[1].nativeNumberText).toBe('(2)')
  })

  it('excludes inline math and dedupes mjx inside host', () => {
    blockFormula('(1)', root)
    const p = document.createElement('p')
    const span = document.createElement('span')
    span.className = 'md-math'
    span.textContent = 'x'
    p.appendChild(span)
    root.appendChild(p)

    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(1)
  })

  it('no native number → nativeNumberFound false', () => {
    blockFormula('', root)
    const targets = adapter.collectFormulaTargets()
    expect(targets[0].nativeNumberNode).toBeNull()
    expect(targets[0].nativeNumberText).toBe('')
  })
})

describe('FormulaNumberingAdapter.reconcile', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  function item(renderedNumber: string, mode: 'typora-native' | 'inkchapter', enabled: boolean) {
    const targets = adapter.collectFormulaTargets()
    const t = targets[0]
    return { target: t, renderedNumber, label: renderedNumber, mode, enabled }
  }

  it('native mode: no InkChapter number created, native unchanged', () => {
    blockFormula('(1)', root)
    const it = item('(1)', 'typora-native', true)
    const stats = adapter.reconcile([it])
    expect(stats.restoreNativeCount).toBe(0)
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    expect(root.textContent).toContain('(1)')
    const double = adapter.computeDoubleNumber()
    expect(double.doubleNumberDetected).toBe(false)
  })

  it('custom mode reuses native node (UPDATE_TEXT), no double number', () => {
    const host = blockFormula('(1)', root)
    const it = item('(1.1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.updateNativeTextCount).toBe(1)
    // No InkChapter decoration created (reuse native node).
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    expect(host.textContent).toContain('(1.1)')
    const double = adapter.computeDoubleNumber()
    expect(double.doubleNumberDetected).toBe(false)
    expect(double.nativeVisibleCount).toBe(1)
    expect(double.inkchapterVisibleCount).toBe(0)
  })

  it('custom mode without native number blocks custom (no decoration)', () => {
    const host = blockFormula('', root)
    const it = item('(1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.blockCustomCount).toBe(1)
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('mode switch native → custom → native restores original native text', () => {
    const host = blockFormula('(1)', root)

    // native
    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(host.textContent).toContain('(1)')

    // custom (reuse)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(host.textContent).toContain('(1.1)')
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()

    // back to native → restore original "(1)"
    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(host.textContent).toContain('(1)')
    expect(host.textContent).not.toContain('(1.1)')
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('custom mode is idempotent (stable state → NO_OP, no mutation)', () => {
    const host = blockFormula('(1)', root)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    const snapshot = host.innerHTML
    const stats = adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(stats.noOpCount).toBe(1)
    expect(host.innerHTML).toBe(snapshot)
  })

  it('disabled formula restores native and removes any decoration', () => {
    blockFormula('(1)', root)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    const stats = adapter.reconcile([item('(1)', 'typora-native', false)])
    expect(stats.restoreNativeCount).toBe(1)
    expect(root.textContent).toContain('(1)')
  })
})
