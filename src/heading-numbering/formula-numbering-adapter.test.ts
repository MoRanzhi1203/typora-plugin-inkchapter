// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  FormulaNumberingAdapter,
  classifyFormulaHost,
  classifyFormulaCandidateRole,
  chooseFormulaStrategy,
  computeDoubleNumberDetected,
  safeElementClassName,
} from './formula-numbering-adapter'

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'write'
  document.body.appendChild(root)
  return root
}

/**
 * Build the REAL Typora display-math DOM shape (proven by frame.js + runtime
 * forensic): the logical raw block `div.mathjax-block.md-math-block.md-rawblock`
 * contains a `.md-rawblock-container.md-math-container` wrapper which directly
 * holds the rendered `mjx-container.MathJax`. The container does NOT match the
 * broad MATH_HOST_SELECTOR terms, which is exactly why the old resolveCanonicalHost
 * stopped at the mjx itself (Phase 7R.1 Blocker 1 root cause).
 */
function rawBlockFormula(parent: HTMLElement, opts: { nativeText?: string; withRenderedMath?: boolean; mathjaxTagText?: string } = {}): HTMLElement {
  const div = document.createElement('div')
  div.className = 'mathjax-block md-end-block md-math-block md-rawblock'
  div.setAttribute('contenteditable', 'false')
  div.setAttribute('id', `mathjax-${Math.random().toString(36).slice(2, 8)}`)

  const container = document.createElement('div')
  container.className = 'md-rawblock-container md-math-container math-jax-postprocess'
  container.setAttribute('tabindex', '-1')

  if (opts.withRenderedMath !== false) {
    const mjx = document.createElement('mjx-container')
    mjx.className = 'MathJax'
    mjx.setAttribute('display', 'true')
    const svg = document.createElement('svg')
    svg.textContent = 'x'
    mjx.appendChild(svg)
    if (opts.mathjaxTagText) {
      const tag = document.createElement('mjx-tag')
      tag.textContent = opts.mathjaxTagText
      tag.setAttribute('style', 'float: right;')
      mjx.appendChild(tag)
    }
    container.appendChild(mjx)
  } else {
    // Preprocess (renderer-not-ready) state: raw source inside the container.
    container.innerHTML = '$$<br/>x<br/>$$'
  }

  if (opts.nativeText) {
    const num = document.createElement('span')
    num.className = 'md-math-number'
    num.textContent = opts.nativeText
    container.appendChild(num)
  }

  div.appendChild(container)
  parent.appendChild(div)
  return div
}

describe('classifyFormulaCandidateRole', () => {
  it('classifies logical raw block, rendered host, and MathJax internals', () => {
    const root = makeRoot()
    const div = rawBlockFormula(root, { mathjaxTagText: '(1)' })
    const mjx = div.querySelector('mjx-container')!
    const svg = div.querySelector('svg')!
    expect(classifyFormulaCandidateRole(div)).toBe('LOGICAL_SOURCE_HOST')
    expect(classifyFormulaCandidateRole(mjx as HTMLElement)).toBe('RENDERED_MATHJAX_HOST')
    expect(classifyFormulaCandidateRole(svg as unknown as HTMLElement)).toBe('MATHJAX_INTERNAL')
  })
})

describe('classifyFormulaHost', () => {
  it('accepts block formula host', () => {
    const root = makeRoot()
    const host = rawBlockFormula(root)
    expect(classifyFormulaHost(host)).toEqual({ decision: 'ACCEPT_BLOCK_FORMULA', reason: 'BLOCK_FORMULA_HOST', canonicalHost: host })
  })

  it('rejects rendered MathJax output as a business target (ownership invariant)', () => {
    const root = makeRoot()
    const host = rawBlockFormula(root)
    const mjx = host.querySelector('mjx-container')!
    expect(classifyFormulaHost(mjx as HTMLElement).decision).toBe('REJECT_RENDERER_OUTPUT')
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
  it('C: no native node → render custom (never block on absence of a native tag)', () => {
    expect(chooseFormulaStrategy({ nativeNumberFound: false, nativeNodeSafe: false })).toBe('render-custom')
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

describe('FormulaNumberingAdapter.collectFormulaTargets — target ownership (Phase 7R.1-A)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  it('FORMULA-HOST-1: one logical formula + one rendered MJX node → 1 business target', () => {
    rawBlockFormula(root)
    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0].root.className).toContain('md-math-block')
    expect(targets[0].root.tagName).toBe('DIV')
    // The rendered host must NOT be the business target.
    expect(targets[0].root.matches('mjx-container')).toBe(false)
  })

  it('FORMULA-HOST-2: four logical formulas each with rendered MathJax → 4 business targets', () => {
    for (let i = 0; i < 4; i++) rawBlockFormula(root)
    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(4)
    expect(new Set(targets.map(t => t.root)).size).toBe(4)
    expect(targets.map(t => t.ordinal)).toEqual([0, 1, 2, 3])
  })

  it('FORMULA-HOST-3: renderer appears after initial scan → cardinality stays 1', () => {
    const host = rawBlockFormula(root, { withRenderedMath: false }) // raw/preprocess state
    expect(adapter.collectFormulaTargets()).toHaveLength(1)

    // Renderer appears (MathJax postprocess): replace container content with mjx.
    const container = host.querySelector('.md-rawblock-container')!
    const mjx = document.createElement('mjx-container')
    mjx.className = 'MathJax'
    container.appendChild(mjx)
    expect(adapter.collectFormulaTargets()).toHaveLength(1)
  })

  it('FORMULA-HOST-4: renderer disappears/reappears → cardinality stays 1', () => {
    const host = rawBlockFormula(root)
    expect(adapter.collectFormulaTargets()).toHaveLength(1)

    // Renderer disappears (back to preprocess) — logical host still exists.
    host.querySelector('.md-rawblock-container')!.innerHTML = '$$<br/>x<br/>$$'
    expect(adapter.collectFormulaTargets()).toHaveLength(1)

    // Renderer reappears.
    const container = host.querySelector('.md-rawblock-container')!
    const mjx = document.createElement('mjx-container')
    mjx.className = 'MathJax'
    container.appendChild(mjx)
    expect(adapter.collectFormulaTargets()).toHaveLength(1)
  })

  it('FORMULA-HOST-5: MathJax internal descendants never create business targets', () => {
    rawBlockFormula(root, { mathjaxTagText: '(1)' })
    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(1)
    // Broad raw candidates (raw block + mjx-container) → only the logical host is accepted.
    const forensic = adapter.formulaHostOwnershipForensic()
    expect(forensic.filter(e => e.decision === 'ACCEPT_BUSINESS_TARGET')).toHaveLength(1)
    expect(forensic.filter(e => e.decision === 'REJECT_RENDERER_OUTPUT').length).toBeGreaterThan(0)
    // The mjx-tag/svg internals never become separate candidates (bounded forensic).
    expect(targets[0].root.querySelectorAll('mjx-tag, svg').length).toBeGreaterThan(0)
  })

  it('FORMULA-HOST-6: document order preserved as A1, A2, B1, C1', () => {
    // Simulates the Phase7 fixture order: Section A ×2, Section B ×1, Chapter B ×1.
    for (let i = 0; i < 4; i++) rawBlockFormula(root)
    const targets = adapter.collectFormulaTargets()
    expect(targets.map(t => t.ordinal)).toEqual([0, 1, 2, 3])
    expect(root.querySelectorAll('.md-math-block').length).toBe(4)
  })

  it('detects native number node (div.md-math-number)', () => {
    rawBlockFormula(root, { nativeText: '(1)' })
    const targets = adapter.collectFormulaTargets()
    expect(targets[0].nativeNumberText).toBe('(1)')
    expect(targets[0].nativeNodeSafe).toBe(true)
  })

  it('detects MathJax native tag (mjx-tag) but marks it unsafe (never mutate MathJax output)', () => {
    rawBlockFormula(root, { mathjaxTagText: '(1)' })
    const targets = adapter.collectFormulaTargets()
    expect(targets[0].nativeNumberText).toBe('(1)')
    expect(targets[0].nativeNodeSafe).toBe(false)
  })

  it('no native number → nativeNumberFound false', () => {
    rawBlockFormula(root)
    const targets = adapter.collectFormulaTargets()
    expect(targets[0].nativeNumberNode).toBeNull()
    expect(targets[0].nativeNumberText).toBe('')
  })
})

describe('FormulaNumberingAdapter.formulaVisibleProjectionForensic (Phase 7R.2-A2)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  it('reports MathJax output structure and detects embedded tag-like nodes (EMBEDDED_RENDER_INPUT)', () => {
    const host = rawBlockFormula(root, { mathjaxTagText: '(1)' })
    // MathJax output structure: the tag lives INSIDE the mjx-container.
    const mjx = host.querySelector('mjx-container')!
    expect(mjx.children.length).toBeGreaterThan(0)
    const entries = adapter.formulaVisibleProjectionForensic()
    expect(entries).toHaveLength(1)
    expect(entries[0].logicalHostTag).toBe('DIV')
    expect(entries[0].logicalHostClass).toContain('md-math-block')
    expect(entries[0].mjxContainerCount).toBe(1)
    expect(entries[0].mjxOutputChildren.length).toBeGreaterThan(0)
    // The embedded mjx-tag text matches the native number label pattern.
    expect(entries[0].nativeNumberPatternNodes.some(n => n.text === '(1)')).toBe(true)
    expect(entries[0].nativeDetectorFound).toBe(true) // mjx-tag is detected (unsafe)
    expect(entries[0].projectionOrigin).toBe('TYPORA_AUTO')
    expect(entries[0].effectiveProjectionChannelsObserved).toBe(1)
    expect(entries[0].mathJaxTagLikeNodeCount).toBeGreaterThan(0)
  })

  it('counts an InkChapter decoration as a second visible projection (DOUBLE_PROJECTION evidence)', () => {
    const host = rawBlockFormula(root, { mathjaxTagText: '(1)' })
    // Add an InkChapter custom decoration next to the rendered math.
    const deco = document.createElement('span')
    deco.setAttribute('data-inkchapter-formula-number', 'true')
    deco.className = 'inkchapter-formula-number'
    deco.textContent = '(1.1-1)'
    host.querySelector('.md-rawblock-container')!.appendChild(deco)

    const entries = adapter.formulaVisibleProjectionForensic()
    expect(entries).toHaveLength(1)
    expect(entries[0].inkchapterDecorationCount).toBe(1)
    expect(entries[0].effectiveProjectionChannelsObserved).toBe(2)
  })

  it('reports renderer-not-ready state (no mjx) with zero effective projection', () => {
    rawBlockFormula(root, { withRenderedMath: false })
    const entries = adapter.formulaVisibleProjectionForensic()
    expect(entries).toHaveLength(1)
    expect(entries[0].mjxContainerCount).toBe(0)
    expect(entries[0].nativeNumberPatternNodes).toHaveLength(0)
    expect(entries[0].effectiveProjectionChannelsObserved).toBe(0)
    expect(entries[0].projectionOrigin).toBe('UNKNOWN')
    expect(entries[0].decision).toBe('NO_RENDERER')
  })

  it('reports Typora data-math-tag-* state on the logical host', () => {
    const host = rawBlockFormula(root)
    host.setAttribute('data-math-tag-before', '1')
    host.setAttribute('data-math-tag-after', '1')
    host.setAttribute('data-math-labels', '[]')
    const entries = adapter.formulaVisibleProjectionForensic()
    expect(entries[0].dataMathTagBeforePresent).toBe(true)
    expect(entries[0].dataMathTagBeforeValue).toBe('1')
    expect(entries[0].dataMathTagAfterPresent).toBe(true)
    expect(entries[0].dataMathLabelsPresent).toBe(true)
  })
})

describe('safeElementClassName / forensic SVG safety (Phase 7R.2-A1)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  it('SVG-CLASS-1: HTML element className string → string', () => {
    const div = document.createElement('div')
    div.className = 'foo bar'
    expect(safeElementClassName(div)).toBe('foo bar')
  })

  it('SVG-CLASS-2: SVGElement className = SVGAnimatedString → baseVal', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'mjx-svg')
    // jsdom exposes className as SVGAnimatedString-like with baseVal.
    const cn = (svg as unknown as { className: { baseVal: string } }).className
    expect(typeof cn === 'string' || typeof (cn as { baseVal?: unknown }).baseVal === 'string').toBe(true)
    expect(safeElementClassName(svg)).toBe('mjx-svg')
  })

  it('SVG-CLASS-3: no class attribute → ""', () => {
    const div = document.createElement('div')
    expect(safeElementClassName(div)).toBe('')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    expect(safeElementClassName(svg)).toBe('')
  })

  it('SVG-CLASS-4: unexpected non-string className object → "" without throw', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'className', {
      get() { return { notAString: true } },
    })
    // getAttribute("class") returns null here; className object → not string/baseVal → ""
    expect(safeElementClassName(div)).toBe('')
  })

  it('SVG-CLASS-4b: className getter that THROWS → "" without throw', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'className', {
      get() { throw new TypeError('className getter boom') },
    })
    expect(safeElementClassName(div)).toBe('')
  })

  it('SVG-CLASS-5: MathJax-like SVG tree (mjx-container > svg > g > use/path) → forensic traversal no throw', () => {
    const host = rawBlockFormula(root)
    const mjx = host.querySelector('mjx-container')!
    // Build a MathJax SVG-output tree with SVG elements whose className is SVGAnimatedString.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'MathJax-SVG')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'mjx-mrow')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('class', 'mjx-use')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('class', 'mjx-path')
    g.appendChild(use)
    g.appendChild(path)
    svg.appendChild(g)
    mjx.appendChild(svg)
    // MathJax tag-like node INSIDE the SVG tree.
    const tag = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    tag.setAttribute('class', 'mjx-tag')
    tag.textContent = '(1)'
    svg.appendChild(tag)

    const entries = adapter.formulaVisibleProjectionForensic()
    expect(entries).toHaveLength(1)
    expect(entries[0].svgRootCount).toBeGreaterThanOrEqual(1)
    expect(entries[0].mathJaxTagLikeNodeCount).toBeGreaterThan(0)
    expect(entries[0].mathJaxTagLikeFingerprints[0].className).toContain('tag')
  })

  it('forensic is NON-THROWING when a traversed element throws on className/textContent', () => {
    const host = rawBlockFormula(root)
    const evil = document.createElement('span')
    Object.defineProperty(evil, 'className', {
      get() { throw new TypeError('evil className') },
    })
    Object.defineProperty(evil, 'textContent', {
      get() { throw new TypeError('evil textContent') },
    })
    host.querySelector('mjx-container')!.appendChild(evil)
    expect(() => adapter.formulaVisibleProjectionForensic()).not.toThrow()
    expect(adapter.formulaVisibleProjectionForensic()).toHaveLength(1)
  })
})

describe('FormulaNumberingAdapter.extractVisibleFormulaTagTokens (Phase 7R.3.3-F exact verifier)', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  function addTagNode(host: HTMLElement, text: string): void {
    const mjx = host.querySelector('mjx-container')!
    const tag = document.createElement('mjx-tag')
    tag.textContent = text
    mjx.appendChild(tag)
  }

  it('VERIFY-EXACT-3: expected 1.1-1 / observed (1.1-1) → token ["1.1-1"] → EXACT PASS', () => {
    const host = rawBlockFormula(root)
    addTagNode(host, '(1.1-1)')
    const tokens = adapter.extractVisibleFormulaTagTokens(host)
    expect(tokens).toEqual(['1.1-1'])
    expect(tokens.includes('1.1-1')).toBe(true)
  })

  it('VERIFY-EXACT-1: expected 1-1 / observed (1.1-1) → token ["1.1-1"] → NOT equal (stale rejected)', () => {
    const host = rawBlockFormula(root)
    addTagNode(host, '(1.1-1)')
    const tokens = adapter.extractVisibleFormulaTagTokens(host)
    expect(tokens).toEqual(['1.1-1'])
    // Exact token equality only — substring must never match.
    expect(tokens.includes('1-1')).toBe(false)
    expect(tokens.some(t => t === '1-1')).toBe(false)
  })

  it('VERIFY-EXACT-2: expected 1-2 / observed (1.1-2) → NOT equal', () => {
    const host = rawBlockFormula(root)
    addTagNode(host, '(1.1-2)')
    const tokens = adapter.extractVisibleFormulaTagTokens(host)
    expect(tokens.includes('1-2')).toBe(false)
  })

  it('VERIFY-EXACT-4: expected 2-1 / observed (1.2-1) → NOT equal', () => {
    const host = rawBlockFormula(root)
    addTagNode(host, '(1.2-1)')
    const tokens = adapter.extractVisibleFormulaTagTokens(host)
    expect(tokens.includes('2-1')).toBe(false)
  })

  it('VERIFY-EXACT-5: semantic + native tags both present → two tokens (DUPLICATE evidence)', () => {
    const host = rawBlockFormula(root)
    addTagNode(host, '(1)')
    addTagNode(host, '(1.1-1)')
    const tokens = adapter.extractVisibleFormulaTagTokens(host)
    expect(tokens).toContain('1')
    expect(tokens).toContain('1.1-1')
    expect(tokens).toHaveLength(2)
  })

  it('no visible tag → empty tokens', () => {
    rawBlockFormula(root)
    const host = root.querySelector('.md-math-block') as HTMLElement
    expect(adapter.extractVisibleFormulaTagTokens(host)).toEqual([])
  })
})

describe('FormulaNumberingAdapter.reconcile — Phase 7R.3 single-authority cleanup', () => {
  let root: HTMLElement
  let adapter: FormulaNumberingAdapter

  beforeEach(() => {
    document.body.innerHTML = ''
    root = makeRoot()
    adapter = new FormulaNumberingAdapter(() => root)
  })

  function item(renderedNumber: string, mode: 'typora-native' | 'inkchapter', enabled: boolean, index = 0) {
    const targets = adapter.collectFormulaTargets()
    const t = targets[index]
    return { target: t, renderedNumber, label: renderedNumber, mode, enabled }
  }

  it('native mode: no InkChapter number created, native unchanged', () => {
    rawBlockFormula(root, { nativeText: '(1)' })
    const it = item('(1)', 'typora-native', true)
    const stats = adapter.reconcile([it])
    expect(stats.restoreNativeCount).toBe(0)
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    expect(root.textContent).toContain('(1)')
    const double = adapter.computeDoubleNumber()
    expect(double.doubleNumberDetected).toBe(false)
  })

  it('inkchapter standard mode: NO custom decoration created (native-transient owns projection)', () => {
    rawBlockFormula(root)
    const it = item('(1.1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.renderCustomCount).toBe(0)
    expect(stats.updateNativeTextCount).toBe(0)
    expect(stats.hideNativeRenderCustomCount).toBe(0)
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('inkchapter + renderer not ready: NO writes, no decoration', () => {
    rawBlockFormula(root, { withRenderedMath: false })
    const it = item('(1.1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.deferredCount).toBe(0)
    expect(stats.noOpCount).toBe(1)
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('stale custom decoration is removed when native-transient takes ownership', () => {
    const host = rawBlockFormula(root)
    // Simulate a stale Phase 7R.1 custom decoration.
    const deco = document.createElement('span')
    deco.setAttribute('data-inkchapter-formula-number', 'true')
    deco.className = 'inkchapter-formula-number'
    deco.textContent = '(1.1)'
    host.querySelector('.md-rawblock-container')!.appendChild(deco)
    expect(root.querySelector('[data-inkchapter-formula-number]')).not.toBeNull()

    const stats = adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(stats.restoreNativeCount).toBe(1)
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    const double = adapter.computeDoubleNumber()
    expect(double.inkchapterVisibleCount).toBe(0)
  })

  it('repeated reconcile → NO_OP (idempotent, no DOM mutation)', () => {
    rawBlockFormula(root)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    const snapshot = root.innerHTML
    const stats = adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(stats.noOpCount).toBe(1)
    expect(root.innerHTML).toBe(snapshot)
  })

  it('MathJax rerender keeps one logical formula → one business target, no decoration', () => {
    const host = rawBlockFormula(root)
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(root.querySelectorAll('[data-inkchapter-formula-number]')).toHaveLength(0)

    // Rerender: container rebuilt with a NEW mjx.
    const container = host.querySelector('.md-rawblock-container')!
    container.innerHTML = ''
    const mjx = document.createElement('mjx-container')
    mjx.className = 'MathJax'
    container.appendChild(mjx)

    const targets = adapter.collectFormulaTargets()
    expect(targets).toHaveLength(1) // still one business target
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(root.querySelectorAll('[data-inkchapter-formula-number]')).toHaveLength(0)
  })

  it('TeX/MathJax output unchanged by reconcile (no source or render mutation)', () => {
    const host = rawBlockFormula(root)
    const sourceContainer = host.querySelector('.md-rawblock-container')!
    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(sourceContainer.querySelector('[data-inkchapter-formula-number]')).toBeNull()
    expect(sourceContainer.querySelector('mjx-container svg')!.textContent).toBe('x')
  })

  it('inkchapter + MathJax native tag (mjx-tag): not hidden, not rewritten (MathJax owns it)', () => {
    rawBlockFormula(root, { mathjaxTagText: '(1)' })
    const it = item('(1.1)', 'inkchapter', true)
    const stats = adapter.reconcile([it])
    expect(stats.hideNativeRenderCustomCount).toBe(0)
    expect(stats.updateNativeTextCount).toBe(0)
    const tag = root.querySelector('mjx-tag') as HTMLElement | null
    expect(tag).not.toBeNull()
    expect(tag!.style.display).not.toBe('none')
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('mode switch native → inkchapter → native keeps a single authority (no decoration)', () => {
    rawBlockFormula(root, { nativeText: '(1)' })

    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(root.textContent).toContain('(1)')
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()

    adapter.reconcile([item('(1.1)', 'inkchapter', true)])
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()

    adapter.reconcile([item('(1)', 'typora-native', true)])
    expect(root.textContent).toContain('(1)')
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })

  it('disabled formula restores native and removes any stale decoration', () => {
    const host = rawBlockFormula(root, { nativeText: '(1)' })
    const deco = document.createElement('span')
    deco.setAttribute('data-inkchapter-formula-number', 'true')
    host.querySelector('.md-rawblock-container')!.appendChild(deco)
    const stats = adapter.reconcile([item('(1)', 'typora-native', false)])
    expect(stats.restoreNativeCount).toBe(1)
    expect(root.textContent).toContain('(1)')
    expect(root.querySelector('[data-inkchapter-formula-number]')).toBeNull()
  })
})
