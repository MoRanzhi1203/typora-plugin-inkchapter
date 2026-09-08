// @vitest-environment jsdom
/**
 * TAB-CLOSE-1..14 targeted tests for the workspace tab close × hover/focus-only
 * feature. The visibility is CSS-only; jsdom cannot resolve :hover layout, so
 * these tests cover (a) the pure decision logic with fabricated states and
 * (b) static rule assertions against the single authoritative style.scss block.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TabCloseVisibilityEnhancer,
  evaluateTabCloseVisibility,
  evaluateTabCloseCentering,
  measureTabCloseCentering,
  measureTabCloseVisibility,
  isCloseElementVisible,
} from './document-utility-tab-close-visibility'

const scss = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const moduleSrc = (): string => readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-tab-close-visibility.ts'), 'utf8')

/** The single authoritative style block for this feature. */
const closeCss = (): string => {
  const all = scss()
  // slice from the first close-rule selector so the explanatory comment (which
  // legitimately names display:none / dirty) is excluded from rule assertions
  const start = all.indexOf('.typ-workspace-root .typ-workspace-tabs .typ-tab .typ-icon.typ-close')
  return all.slice(start).replace(/\/\*[\s\S]*?\*\//g, '')
}

function run(params: Parameters<typeof evaluateTabCloseVisibility>[0]): ReturnType<typeof evaluateTabCloseVisibility> {
  return evaluateTabCloseVisibility(params)
}

const layout = { tabWidthDeltaPx: null, titleWidthDeltaPx: null, titleLeftDeltaPx: null }
const layoutZero = { tabWidthDeltaPx: 0, titleWidthDeltaPx: 0, titleLeftDeltaPx: 0 }
const layoutShift = { tabWidthDeltaPx: 3, titleWidthDeltaPx: 2, titleLeftDeltaPx: 2 }

let enhancers: TabCloseVisibilityEnhancer[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  enhancers = []
})

afterEach(() => {
  for (const e of enhancers) e.dispose()
  enhancers = []
})

function mount(): TabCloseVisibilityEnhancer {
  const e = new TabCloseVisibilityEnhancer()
  e.attach()
  enhancers.push(e)
  return e
}

describe('TAB-CLOSE default / hover / focus decision logic', () => {
  it('TAB-CLOSE-1 default: all × hidden → PASS (DEFAULT_ZERO_VISIBLE)', () => {
    const out = run({ tabCount: 4, activeIndex: 0, hoveredOrFocusedIndex: -1, visibleIndices: [], origin: 'none', layout })
    expect(out.visibleCloseCount).toBe(0)
    expect(out.defaultStateOk).toBe(true)
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('DEFAULT_ZERO_VISIBLE')
  })

  it('TAB-CLOSE-2 hover first tab only', () => {
    const out = run({ tabCount: 3, activeIndex: 2, hoveredOrFocusedIndex: 0, visibleIndices: [0], origin: 'hover', layout })
    expect(out.visibleCloseCount).toBe(1)
    expect(out.otherVisibleCloseCount).toBe(0)
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('HOVER_ONLY_CURRENT')
  })

  it('TAB-CLOSE-3 hover middle tab only', () => {
    const out = run({ tabCount: 5, activeIndex: 0, hoveredOrFocusedIndex: 2, visibleIndices: [2], origin: 'hover', layout })
    expect(out.decision).toBe('PASS')
    expect(out.otherVisibleCloseCount).toBe(0)
  })

  it('TAB-CLOSE-4 hover active tab only', () => {
    const out = run({ tabCount: 3, activeIndex: 1, hoveredOrFocusedIndex: 1, visibleIndices: [1], origin: 'hover', layout })
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('HOVER_ONLY_CURRENT')
  })

  it('TAB-CLOSE-5 hover inactive tab only (active not shown)', () => {
    const out = run({ tabCount: 3, activeIndex: 0, hoveredOrFocusedIndex: 2, visibleIndices: [2], origin: 'hover', layout })
    expect(out.decision).toBe('PASS')
    // active + no hover → not among visible
    expect(out.visibleCloseCount).toBe(1)
    expect(out.otherVisibleCloseCount).toBe(0)
  })

  it('TAB-CLOSE-6 focus-within visible', () => {
    const out = run({ tabCount: 3, activeIndex: 0, hoveredOrFocusedIndex: 1, visibleIndices: [1], origin: 'focus', layout })
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('FOCUS_ONLY_CURRENT')
  })

  it('TAB-CLOSE-7 pointer-events gating: hidden rows ignore pointer, visible row receives pointer', () => {
    const css = closeCss()
    expect(css).toMatch(/opacity:\s*0;/)
    expect(css).toMatch(/visibility:\s*hidden;/)
    expect(css).toMatch(/pointer-events:\s*none;/)
    expect(css).toMatch(/pointer-events:\s*auto;/)
    expect(css).toMatch(/:hover[\s\S]*?\.typ-close/)
    expect(css).toMatch(/:focus-within[\s\S]*?\.typ-close/)
  })

  it('TAB-CLOSE-8 layout slot preserved: 0/1px delta passes, >1px delta FAILs with TAB_CLOSE_CAUSES_LAYOUT_SHIFT', () => {
    const ok = run({ tabCount: 2, activeIndex: 0, hoveredOrFocusedIndex: 1, visibleIndices: [1], origin: 'hover', layout: layoutZero })
    expect(ok.decision).toBe('PASS')
    const one = run({ tabCount: 2, activeIndex: 0, hoveredOrFocusedIndex: 1, visibleIndices: [1], origin: 'hover', layout: { tabWidthDeltaPx: 1, titleWidthDeltaPx: 1, titleLeftDeltaPx: 1 } })
    expect(one.decision).toBe('PASS')
    const bad = run({ tabCount: 2, activeIndex: 0, hoveredOrFocusedIndex: 1, visibleIndices: [1], origin: 'hover', layout: layoutShift })
    expect(bad.decision).toBe('FAIL')
    expect(bad.reason).toBe('TAB_CLOSE_CAUSES_LAYOUT_SHIFT')
  })

  it('TAB-CLOSE-9 never uses display:none/block / dynamic geometry on the × element', () => {
    const css = closeCss()
    const elementPart = css.slice(0, css.indexOf('.typ-close::before'))
    expect(elementPart).not.toMatch(/display\s*:\s*none/)
    expect(elementPart).not.toMatch(/display\s*:\s*block/)
    expect(elementPart).not.toMatch(/width\s*:\s*0/)
    expect(elementPart).not.toMatch(/transform|translate/)
    // only static zero resets + a single fixed 20px slot are allowed (V2 centering)
    expect(elementPart).toMatch(/width:\s*20px/)
    expect(elementPart).toMatch(/flex:\s*0 0 20px/)
  })

  it('TAB-CLOSE-10 dirty state preserved: rules only target the × slot, never basename/icon/marker', () => {
    const css = closeCss()
    expect(css).not.toMatch(/dirty|unsaved|modified|\.typ-file-basename|\.typ-file-icon/)
    // active underline/border untouched: no rule selects .typ-tab.active border/outline
    expect(css).not.toMatch(/\.typ-tab\.active[\s\S]*?border|\.typ-tab\.active[\s\S]*?outline/)
  })

  it('TAB-CLOSE-11/12/13 close click / right-click / drag unchanged: module adds no listeners & touches no tab semantics', () => {
    const src = moduleSrc()
    expect(src).not.toMatch(/addEventListener|onclick|onmousedown|onmouseup/)
    expect(src).not.toMatch(/contextmenu/)
    expect(src).not.toMatch(/draggable|setAttribute/)
    const css = closeCss()
    // pointer-events only gated on the × itself, not on the whole tab (drag-safe)
    expect(css).not.toMatch(/\.typ-tab\s*\{\s*pointer-events/)
    expect(css).not.toMatch(/\.typ-tab\[draggable/)
  })

  it('TAB-CLOSE-14 repeated hover state never leaks (deterministic evaluator)', () => {
    const base = { tabCount: 8, activeIndex: 3, hoveredOrFocusedIndex: 5, visibleIndices: [5], origin: 'hover' as const, layout }
    const a = run(base)
    const b = run({ ...base, visibleIndices: [5, 3] }) // leak simulation → FAIL
    const c = run(base)
    expect(a).toEqual(c)
    expect(a.decision).toBe('PASS')
    expect(b.decision).toBe('FAIL')
    expect(b.otherVisibleCloseCount).toBe(1)
  })
})

describe('single-mount enhancer guard + measure helper', () => {
  it('enhancer counts exactly 1 with no duplicate listener', () => {
    const e = mount()
    expect(e.getInvariant()).toEqual({ tabCloseEnhancerCount: 1, duplicateListener: false })
    const second = mount()
    expect(second.getInvariant().tabCloseEnhancerCount).toBe(2)
    expect(second.getInvariant().duplicateListener).toBe(true)
    second.dispose()
    expect(e.getInvariant().tabCloseEnhancerCount).toBe(1)
  })

  it('measure + isCloseElementVisible work against the real framework tab DOM shape', () => {
    // jsdom: default opacity computed '' → not "hidden"; measure should treat it as visible
    document.body.innerHTML = [
      '<div class="typ-workspace-tab-header"><div class="typ-tabs">',
      '<div class="typ-tab active" data-id="a"><i class="typ-icon typ-close"></i></div>',
      '<div class="typ-tab" data-id="b"><i class="typ-icon typ-close"></i></div>',
      '</div></div>',
    ].join('')
    const m = measureTabCloseVisibility(document)
    expect(m.tabCount).toBe(2)
    expect(m.activeIndex).toBe(0)
    expect(m.closeSlotWidthsPx.length).toBe(2)
  })

  it('isCloseElementVisible respects explicit computed visibility', () => {
    const el = document.createElement('i')
    document.body.appendChild(el)
    el.style.opacity = '1'
    el.style.visibility = 'hidden'
    expect(isCloseElementVisible(el)).toBe(false)
    el.style.visibility = 'visible'
    expect(isCloseElementVisible(el)).toBe(true)
  })
})

// ── TAB-CLOSE-CENTER (V2 20×20 hitbox + flex centering) ────────────────────
describe('TAB-CLOSE-CENTER-1..14 20×20 hitbox + glyph centering', () => {
  const ok = (over: Partial<Parameters<typeof evaluateTabCloseCentering>[0]> = {}): Parameters<typeof evaluateTabCloseCentering>[0] => ({
    deltaCenterX: null,
    deltaCenterY: null,
    widthPx: 20,
    heightPx: 20,
    paddingZero: true,
    marginZero: true,
    inlineFlex: true,
    alignItemsCenter: true,
    justifyContentCenter: true,
    square: true,
    pseudoNoOffset: true,
    slotWidthDefault: 20,
    slotWidthHover: 20,
    tabWidthDeltaPx: 0,
    titleWidthDeltaPx: 0,
    titleLeftDeltaPx: 0,
    ...over,
  })

  it('TAB-CLOSE-CENTER-1/2 square 20×20 hitbox PASS (structural)', () => {
    const r = evaluateTabCloseCentering(ok())
    expect(r.hitboxOk).toBe(true)
    expect(r.decision).toBe('PASS')
    expect(r.reason).toBe('HITBOX_AND_GLYPH_CENTERED')
  })

  it('TAB-CLOSE-CENTER-3/4/5 inline-flex + align/justify center (css + rules)', () => {
    const css = closeCss()
    expect(css).toMatch(/display:\s*inline-flex/)
    expect(css).toMatch(/align-items:\s*center/)
    expect(css).toMatch(/justify-content:\s*center/)
    expect(css).toMatch(/align-self:\s*center/)
    const r = evaluateTabCloseCentering(ok({ inlineFlex: false }))
    expect(r.hitboxOk).toBe(false)
    expect(r.decision).toBe('FAIL')
  })

  it('TAB-CLOSE-CENTER-6/7 padding & margin are zero (css + rules)', () => {
    const css = closeCss()
    expect(css).toMatch(/padding:\s*0;/)
    expect(css).toMatch(/margin:\s*0;/)
    const bad = evaluateTabCloseCentering(ok({ paddingZero: false }))
    expect(bad.decision).toBe('FAIL')
  })

  it('TAB-CLOSE-CENTER-8 pseudo-element metrics reset (no offset)', () => {
    const css = closeCss()
    const idx = css.indexOf('.typ-close::before')
    expect(idx).toBeGreaterThan(-1)
    const pseudoRule = css.slice(idx, css.indexOf('}', idx) + 1)
    expect(pseudoRule).toMatch(/content:\s*'×'/)
    expect(pseudoRule).toMatch(/padding:\s*0;/)
    expect(pseudoRule).toMatch(/margin:\s*0;/)
    expect(pseudoRule).toMatch(/line-height:\s*1;/)
    expect(pseudoRule).not.toMatch(/top:|left:|transform|position:\s*absolute/)
  })

  it('TAB-CLOSE-CENTER-9 hover background stays on the same 20×20 hitbox', () => {
    const css = closeCss()
    const hoverIdx = css.indexOf('.typ-close:hover')
    const hoverRule = css.slice(hoverIdx, css.indexOf('}', hoverIdx) + 1)
    expect(hoverRule).toMatch(/background-color:/)
    expect(hoverRule).toMatch(/border-radius:\s*4px/)
    expect(hoverRule).not.toMatch(/width:|height:|padding:|margin:|transform/)
    const r = evaluateTabCloseCentering(ok({ slotWidthHover: 20 }))
    expect(r.slotStable).toBe(true)
  })

  it('TAB-CLOSE-CENTER-10 slot width stable (default == hover)', () => {
    const pass = evaluateTabCloseCentering(ok())
    expect(pass.slotStable).toBe(true)
    const unstable = evaluateTabCloseCentering(ok({ slotWidthHover: 23 }))
    expect(unstable.decision).toBe('FAIL')
    expect(unstable.reason).toBe('CLOSE_SLOT_WIDTH_UNSTABLE')
  })

  it('TAB-CLOSE-CENTER-11/12 tab & title geometry stable', () => {
    const pass = evaluateTabCloseCentering(ok())
    expect(pass.layoutStable).toBe(true)
    const bad = evaluateTabCloseCentering(ok({ titleWidthDeltaPx: 2 }))
    expect(bad.decision).toBe('FAIL')
    expect(bad.reason).toBe('TAB_TITLE_LAYOUT_SHIFT')
  })

  it('TAB-CLOSE-CENTER-13 active/inactive visibility semantics unchanged (no active-only close rule)', () => {
    const css = closeCss()
    expect(css).not.toMatch(/\.typ-tab\.active[\s\S]*?opacity:\s*1/)
    // visibility semantics from TAB-CLOSE-4/5 remain governed by :hover/:focus-within
    expect(css).toMatch(/:hover[\s\S]*?\.typ-close/)
    expect(css).toMatch(/:focus-within[\s\S]*?\.typ-close/)
  })

  it('TAB-CLOSE-CENTER-14 no display toggle on the × element (pseudo block allowed)', () => {
    const css = closeCss()
    const elementPart = css.slice(0, css.indexOf('.typ-close::before'))
    expect(elementPart).not.toMatch(/display\s*:\s*none/)
    expect(elementPart).not.toMatch(/display\s*:\s*block/)
  })

  it('real deltas within ±1px → REAL PASS; >1px → FAIL GLYPH_CENTER_MISMATCH', () => {
    const aligned = evaluateTabCloseCentering(ok({ deltaCenterX: 0.4, deltaCenterY: -0.6 }))
    expect(aligned.measureMode).toBe('REAL')
    expect(aligned.decision).toBe('PASS')
    expect(aligned.reason).toBe('GLYPH_CENTERED_WITHIN_HITBOX')
    const off = evaluateTabCloseCentering(ok({ deltaCenterX: 2, deltaCenterY: 0 }))
    expect(off.measureMode).toBe('REAL')
    expect(off.decision).toBe('FAIL')
    expect(off.reason).toBe('GLYPH_CENTER_MISMATCH')
  })

  it('measureTabCloseCentering reads real layout when a close exists (jsdom: rect 0, computed defaults present)', () => {
    document.body.innerHTML = '<div class="typ-workspace-tab-header"><div class="typ-tab"><i class="typ-icon typ-close"></i></div></div>'
    const m = measureTabCloseCentering(document)
    expect(m.computed).not.toBeNull()
    expect(m.pseudo).not.toBeNull()
  })
})
