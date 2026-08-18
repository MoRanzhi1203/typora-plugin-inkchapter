// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  FormulaNumberingAdapter,
  classifyFormulaHost,
  chooseFormulaStrategy,
  computeDoubleNumberDetected,
  resolveFormulaNativeNumberSlot,
  computeFormulaCurrentSetAuthority,
  normalizePseudoContent,
  type NativeVisualReader,
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
  it('C: create custom (native not required)', () => {
    expect(chooseFormulaStrategy({ nativeNumberFound: false, nativeNodeSafe: false })).toBe('create')
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

  it('custom mode with native → one InkChapter number, native suppressed', () => {
    const host = blockFormula('(1)', root)
    const it = item('(1.1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.createCustomCount).toBe(1)
    expect(stats.hideNativeRenderCustomCount).toBe(1)
    const inv = adapter.computeNumberNodeInventory(host, 0)
    expect(inv.visibleInkChapterCount).toBe(1)
    expect(inv.visibleNativeCount).toBe(0)
    expect(inv.totalVisibleNumberCount).toBe(1)
    expect(inv.decision).toBe('PASS')
  })

  it('custom mode without native number creates InkChapter decoration (no block)', () => {
    const host = blockFormula('', root)
    const it = item('(1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.createCustomCount).toBe(1)
    const deco = host.querySelector('[data-inkchapter-formula-number]')
    expect(deco).not.toBeNull()
    expect(deco?.textContent).toBe('(1)')
    expect(deco?.getAttribute('data-inkchapter-formula-number-owner')).toBe('inkchapter')
  })

  it('mode switch native → custom → native restores original native text', () => {
    const host = blockFormula('(1)', root)

    // native
    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(host.textContent).toContain('(1)')

    // custom (InkChapter owns number, native suppressed)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(host.textContent).toContain('(1.1)')
    expect(adapter.computeNumberNodeInventory(host, 0).visibleNativeCount).toBe(0)

    // back to native → restore original "(1)"
    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(host.textContent).toContain('(1)')
    expect(host.textContent).not.toContain('(1.1)')
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    expect(adapter.computeNumberNodeInventory(host, 0).visibleNativeCount).toBe(1)
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

  it('native selector never matches an InkChapter-owned node', () => {
    const host = blockFormula('(1)', root)
    // After InkChapter reconcile, the InkChapter node must not be detected as native.
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    const native = adapter.detectNativeNumber(host)
    // The native (1) was suppressed but is still the only native external node.
    expect(native.node).not.toBeNull()
    expect(native.node?.getAttribute('data-inkchapter-formula-number-owner')).not.toBe('inkchapter')
    const inv = adapter.computeNumberNodeInventory(host, 0)
    expect(inv.typoraNativeExternalCount).toBe(1)
    expect(inv.visibleNativeCount).toBe(0)
    expect(inv.visibleInkChapterCount).toBe(1)
  })

  it('restoreAllNative restores every suppressed native', () => {
    const host = blockFormula('(1)', root)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(adapter.computeNumberNodeInventory(host, 0).visibleNativeCount).toBe(0)
    adapter.restoreAllNative()
    expect(adapter.computeNumberNodeInventory(host, 0).visibleNativeCount).toBe(1)
  })
})

describe('FormulaNumberingAdapter global visual inventory (v2.5.4)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  function currentNode(parent: HTMLElement): HTMLElement {
    const s = document.createElement('span')
    s.className = 'inkchapter-formula-number'
    s.setAttribute('data-inkchapter-formula-number', 'true')
    s.setAttribute('data-inkchapter-formula-number-owner', 'inkchapter')
    s.textContent = '(1)'
    parent.appendChild(s)
    return s
  }

  it('Case A: one current node inside host → PASS', () => {
    const host = blockFormula('', root)
    currentNode(host)
    const inv = adapter.computeGlobalFormulaVisualInventory()
    expect(inv).toHaveLength(1)
    expect(inv[0].totalVisibleAssociated).toBe(1)
    expect(inv[0].decision).toBe('PASS')
  })

  it('Case B: current + sibling legacy → cleanup → 1', () => {
    const host = blockFormula('', root)
    currentNode(host)
    const legacy = document.createElement('span')
    legacy.setAttribute('data-inkchapter-formula-number', 'true')
    legacy.textContent = '(1)'
    root.appendChild(legacy) // sibling of host (same parent = root)

    let inv = adapter.computeGlobalFormulaVisualInventory()
    expect(inv[0].totalVisibleAssociated).toBe(2)
    expect(inv[0].decision).toBe('FAIL')

    const scan = adapter.scanVisualFormulaNodes()
    const cleanup = adapter.cleanupVisualNodes(scan)
    expect(cleanup.removedLegacyCount).toBe(1)

    inv = adapter.computeGlobalFormulaVisualInventory()
    expect(inv[0].totalVisibleAssociated).toBe(1)
    expect(inv[0].decision).toBe('PASS')
  })

  it('Case C: current + native → suppress → 1', () => {
    const host = blockFormula('(1)', root)
    currentNode(host)
    const scan = adapter.scanVisualFormulaNodes()
    const cleanup = adapter.cleanupVisualNodes(scan)
    expect(cleanup.suppressedNativeCount).toBe(1)
    const inv = adapter.computeGlobalFormulaVisualInventory()
    expect(inv[0].totalVisibleAssociated).toBe(1)
  })

  it('Case D: orphan legacy is detected and removed', () => {
    const orphan = document.createElement('span')
    orphan.setAttribute('data-inkchapter-formula-number', 'true')
    orphan.textContent = '(9)'
    root.appendChild(orphan) // no canonical host anywhere
    const scan = adapter.scanVisualFormulaNodes()
    const orphanAttr = scan.attributions.find(a => a.owner === 'ORPHAN_FORMULA_NUMBER')
    expect(orphanAttr).toBeDefined()
    const cleanup = adapter.cleanupVisualNodes(scan)
    expect(cleanup.removedOrphanCount).toBe(1)
  })

  it('Case E: plain body text "(1)" is never removed', () => {
    const p = document.createElement('p')
    p.textContent = '这是一段正文 (1) 不是公式编号'
    root.appendChild(p)
    const scan = adapter.scanVisualFormulaNodes()
    // The <p> itself is not a candidate (we only scan span/div), so no orphan/formula node.
    const numberNodes = scan.attributions.filter(a => a.text === '(1)' || a.text.includes('(1)'))
    expect(numberNodes).toHaveLength(0)
    const cleanup = adapter.cleanupVisualNodes(scan)
    expect(cleanup.removedLegacyCount).toBe(0)
    expect(cleanup.removedOrphanCount).toBe(0)
    expect(p.textContent).toContain('(1)')
  })
})

describe('FormulaNumberingAdapter native equation number slot (v2.5.5)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  function nativeNumberSpan(parent: HTMLElement, text: string): HTMLElement {
    const s = document.createElement('span')
    s.className = 'md-math-number'
    s.textContent = text
    parent.appendChild(s)
    return s
  }

  it('native DOM slot → DOM_NODE/RESOLVED', () => {
    const host = blockFormula('', root)
    nativeNumberSpan(host, '(1)')
    const res = adapter.resolveNativeNumberSlot(host, 0)
    expect(res.decision).toBe('RESOLVED')
    expect(res.sourceKind).toBe('DOM_NODE')
    expect(res.slot?.nativeNode?.textContent).toBe('(1)')
  })

  it('pseudo ::after slot → PSEUDO_AFTER/RESOLVED (mock reader)', () => {
    const host = blockFormula('', root)
    const reader: NativeVisualReader = {
      readPseudoContent: (el, pseudo) => (pseudo === '::after' && el === host ? '"(1)"' : ''),
      readAttribute: () => null,
      isVisible: () => true,
      getRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    }
    const res = adapter.resolveNativeNumberSlot(host, 0, reader)
    expect(res.decision).toBe('RESOLVED')
    expect(res.sourceKind).toBe('PSEUDO_AFTER')
    expect(res.nativePseudoContent).toBe('(1)')
  })

  it('ambiguous slot (multiple candidates) → AMBIGUOUS', () => {
    const host = blockFormula('', root)
    nativeNumberSpan(host, '(1)')
    nativeNumberSpan(root, '(2)') // sibling candidate
    const res = adapter.resolveNativeNumberSlot(host, 0)
    expect(res.decision).toBe('AMBIGUOUS')
  })

  it('normalizePseudoContent strips quotes', () => {
    expect(normalizePseudoContent('"(1)"')).toBe('(1)')
    expect(normalizePseudoContent("'(1)'")).toBe('(1)')
  })

  it('project → native suppressed + InkChapter visible; restore → native restored', () => {
    const host = blockFormula('', root)
    const native = nativeNumberSpan(host, '(1)')
    const res = adapter.resolveNativeNumberSlot(host, 0)
    expect(res.slot).not.toBeNull()

    adapter.projectNativeSlot(res.slot!, '(5.3.1)', 0)
    expect(native.style.display).toBe('none')
    expect(host.textContent).toContain('(5.3.1)')

    adapter.restoreNativeSlot(host)
    expect(native.style.display).not.toBe('none')
    expect(host.textContent).toContain('(1)')
    expect(host.textContent).not.toContain('(5.3.1)')
  })

  it('V3 inventory: one projection → effectiveVisibleNumberCount=1', () => {
    const host = blockFormula('', root)
    nativeNumberSpan(host, '(1)')
    const res = adapter.resolveNativeNumberSlot(host, 0)
    adapter.projectNativeSlot(res.slot!, '(5.3.1)', 0)
    const inv = adapter.computeFormulaVisualInventoryV3()
    expect(inv).toHaveLength(1)
    expect(inv[0].effectiveVisibleNumberCount).toBe(1)
    expect(inv[0].placementAuthority).toBe('NATIVE_EQUATION_NUMBER_SLOT')
    expect(inv[0].decision).toBe('PASS')
  })
})

describe('FormulaNumberingAdapter structural native probe + hard barrier + verifier (v2.5.6)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  it('connected formula host always yields structuralCandidateCount >= 1', () => {
    const host = blockFormula('', root)
    const res = adapter.resolveNativeNumberSlot(host, 0)
    expect(res.candidateSummary?.structuralCandidateCount).toBeGreaterThanOrEqual(1)
    // Even with no number-like node, the structural candidates are probed.
    expect(res.structuralCandidates?.length).toBeGreaterThanOrEqual(1)
  })

  it('pseudo ::after number-like content resolves to PSEUDO_AFTER', () => {
    const host = blockFormula('', root)
    const reader: NativeVisualReader = {
      readPseudoContent: (el, pseudo) => (pseudo === '::after' && el === host ? '"(1)"' : ''),
      readAttribute: () => null,
      isVisible: () => true,
      getRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    }
    const res = adapter.resolveNativeNumberSlot(host, 0, reader)
    expect(res.decision).toBe('RESOLVED')
    expect(res.sourceKind).toBe('PSEUDO_AFTER')
  })

  it('hard barrier: slot NOT_FOUND → no InkChapter flow projection created', () => {
    const host = blockFormula('', root)
    const targets = adapter.collectFormulaTargets()
    const stats = adapter.reconcile([
      { target: targets[0], renderedNumber: '', label: '(5.3.1)', mode: 'inkchapter', enabled: true, slotState: 'NOT_FOUND' },
    ])
    expect(stats.createCustomCount).toBe(0)
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('hard barrier: slot AMBIGUOUS → BLOCK (no legacy CREATE_CUSTOM)', () => {
    const host = blockFormula('', root)
    const targets = adapter.collectFormulaTargets()
    const stats = adapter.reconcile([
      { target: targets[0], renderedNumber: '', label: '(5.3.1)', mode: 'inkchapter', enabled: true, slotState: 'AMBIGUOUS' },
    ])
    expect(stats.createCustomCount).toBe(0)
    expect(host.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('V4 inventory only consumes the current canonical set', () => {
    const h0 = blockFormula('', root)
    const h1 = blockFormula('', root)
    const inv = adapter.computeFormulaVisualInventoryV4([
      { host: h0, slotState: 'NOT_FOUND' },
      { host: h1, slotState: 'NOT_FOUND' },
    ])
    expect(inv).toHaveLength(2)
    expect(inv.map((i) => i.formulaIndex)).toEqual([0, 1])
  })

  it('current-set authority: phantom verifier entries are detected', () => {
    expect(computeFormulaCurrentSetAuthority(2, 5, 3)).toMatchObject({
      canonicalFormulaCount: 2,
      verifierFormulaCount: 5,
      phantomVerifierEntryCount: 3,
      decision: 'FAIL',
    })
    expect(computeFormulaCurrentSetAuthority(2, 2, 0)).toMatchObject({
      canonicalFormulaCount: 2,
      verifierFormulaCount: 2,
      phantomVerifierEntryCount: 0,
      decision: 'PASS',
    })
  })
})
