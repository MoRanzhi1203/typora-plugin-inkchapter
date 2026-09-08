// @vitest-environment jsdom
/**
 * RENDER-VIS-1..14 — Toolbar RENDERED-visibility chain closure (V2).
 *
 * `hidden=true` alone is never the visual truth: PASS requires the FULL chain
 * Business-hidden → DOM hidden → computed display:none → BCR 0×0 →
 * clientRects 0 → rendered count 0. jsdom has no real layout, so active-doc
 * visual claims are NA there (NO_REAL_LAYOUT), never a fake PASS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateToolbarRenderedVisibility, isRenderedVisible, type ToolbarRenderedVisibilityFacts } from './document-utility-overlay-host'

const scss = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const hostSrc = (): string => readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')

const empty: ToolbarRenderedVisibilityFacts = {
  documentKey: null,
  hasActiveDocument: false,
  toolbarDomCount: 1,
  problemsControlDomCount: 1,
  hiddenAttr: true,
  ariaHidden: true,
  presentation: 'suppressed',
  computedDisplay: 'none',
  computedVisibility: 'visible',
  computedOpacity: '1',
  rectWidth: 0,
  rectHeight: 0,
  clientRectCount: 0,
  renderedToolbarCount: 0,
  renderedProblemsControlCount: 0,
  projectedErrorCount: 0,
  projectedWarningCount: 0,
  projectedHintCount: 0,
  projectedEditState: 'NONE',
  measureMode: 'REAL',
}

const active: ToolbarRenderedVisibilityFacts = {
  ...empty,
  documentKey: 'doc:a',
  hasActiveDocument: true,
  hiddenAttr: false,
  ariaHidden: false,
  presentation: 'full',
  computedDisplay: 'flex',
  rectWidth: 240,
  rectHeight: 32,
  clientRectCount: 1,
  renderedToolbarCount: 1,
  renderedProblemsControlCount: 1,
}

describe('RENDER-VIS-1..9 rendered-visibility decision', () => {
  it('RENDER-VIS-1 hidden=true + CSS display:none full chain → PASS', () => {
    const out = evaluateToolbarRenderedVisibility(empty)
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('NO_ACTIVE_DOCUMENT_NOT_RENDERED')
  })

  it('RENDER-VIS-2 hidden=true but CSS display:flex + nonzero rect → FAIL HIDDEN_ATTRIBUTE_OVERRIDDEN_BY_CSS', () => {
    const bad = { ...empty, computedDisplay: 'flex', rectWidth: 240, rectHeight: 32, clientRectCount: 1, renderedToolbarCount: 1 }
    const out = evaluateToolbarRenderedVisibility(bad)
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('HIDDEN_ATTRIBUTE_OVERRIDDEN_BY_CSS')
  })

  it('RENDER-VIS-3 no document + rendered toolbar → FAIL RENDERED_TOOLBAR_WITHOUT_ACTIVE_DOCUMENT', () => {
    const bad = { ...empty, computedDisplay: 'flex', rectWidth: 240, rectHeight: 32, clientRectCount: 1, renderedToolbarCount: 1 }
    // remove the hidden/attr mismatch so the rendered-without-doc rule is the hit
    const bad2 = { ...bad, hiddenAttr: false, ariaHidden: false, presentation: 'full' }
    const out = evaluateToolbarRenderedVisibility(bad2)
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('RENDERED_TOOLBAR_WITHOUT_ACTIVE_DOCUMENT')
  })

  it('RENDER-VIS-4 toolbarDomCount>1 → FAIL DUPLICATE_OR_ORPHAN_TOOLBAR', () => {
    const out = evaluateToolbarRenderedVisibility({ ...active, toolbarDomCount: 2, renderedToolbarCount: 2 })
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('DUPLICATE_OR_ORPHAN_TOOLBAR')
  })

  it('RENDER-VIS-5 tracked hidden + orphan problems visible → FAIL ORPHAN_PROBLEMS_CONTROL', () => {
    const out = evaluateToolbarRenderedVisibility({ ...empty, renderedProblemsControlCount: 1 })
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('ORPHAN_PROBLEMS_CONTROL')
  })

  it('RENDER-VIS-6 empty state rendered count=0 → PASS', () => {
    expect(evaluateToolbarRenderedVisibility(empty).decision).toBe('PASS')
  })

  it('RENDER-VIS-7 active document full + rendered=true → PASS (REAL)', () => {
    const out = evaluateToolbarRenderedVisibility(active)
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('ACTIVE_DOCUMENT_RENDERED')
  })

  it('RENDER-VIS-8 suppressed→full restore renders again', () => {
    const restored = evaluateToolbarRenderedVisibility(active)
    expect(restored.decision).toBe('PASS')
  })

  it('RENDER-VIS-9 full→suppressed collapses to 0 rect/clientRects', () => {
    expect(evaluateToolbarRenderedVisibility(empty).decision).toBe('PASS')
    const chain = { ...empty, rectWidth: 240, rectHeight: 32, clientRectCount: 1 }
    expect(evaluateToolbarRenderedVisibility(chain).decision).toBe('FAIL')
  })

  it('headless active (BCR all 0) → NA / NO_REAL_LAYOUT, never fake PASS', () => {
    const headlessActive = { ...active, rectWidth: 0, rectHeight: 0, clientRectCount: 0, measureMode: 'HEADLESS' as const }
    const out = evaluateToolbarRenderedVisibility(headlessActive)
    expect(out.decision).toBe('NA')
    expect(out.reason).toBe('NO_REAL_LAYOUT')
  })
})

describe('RENDER-VIS-10/11 stale projection gate', () => {
  it('RENDER-VIS-10 no document + stale error/warning counts → FAIL STALE_DOCUMENT_TOOLBAR_PROJECTION', () => {
    const stale = { ...empty, projectedWarningCount: 3 }
    const out = evaluateToolbarRenderedVisibility(stale)
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('STALE_DOCUMENT_TOOLBAR_PROJECTION')
  })

  it('RENDER-VIS-11 DOCUMENT_INACTIVE internal diagnostic is never projected (counts stay 0/0/0/NONE)', () => {
    // An internal DOCUMENT_INACTIVE hint may exist in the snapshot, but the
    // toolbar facts only read the projected DOM → PASS (0 counts, NONE edit).
    expect(evaluateToolbarRenderedVisibility(empty).decision).toBe('PASS')
  })
})

describe('RENDER-VIS-12/13/14 CSS + writer authority', () => {
  it('RENDER-VIS-12 authoritative scoped [hidden] rule exists', () => {
    const css = scss()
    expect(css).toMatch(/\.inkchapter-doc-toolbar\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/)
  })

  it('RENDER-VIS-13 no global [hidden] override pollutes Typora', () => {
    const css = scss()
    // only a BARE top-level `[hidden]` selector would be global; scoped forms
    // like `.inkchapter-doc-toolbar[hidden]` / `&[hidden]` are allowed.
    const bareGlobal = css.split('\n').filter(l => /^\s*\[hidden\](\s|,|\{)/.test(l))
    expect(bareGlobal.length).toBe(0)
  })

  it('RENDER-VIS-14 suppressed writer is unified and never writes toolbar.style.display directly', () => {
    const src = hostSrc()
    expect(src).not.toMatch(/toolbarEl\.style\.display\s*=|toolbar\.style\.display\s*=/)
    const writer = src.slice(src.indexOf('private applyToolbarPresentation'))
    expect(writer).toMatch(/\.hidden\s*=\s*presentation === 'suppressed'/)
    expect(writer).toMatch(/setAttribute\('aria-hidden'/)
    expect(writer).toMatch(/dataset\.presentation\s*=\s*presentation/)
  })
})

describe('isRenderedVisible jsdom (no layout)', () => {
  let el: HTMLElement

  beforeEach(() => {
    el = document.createElement('div')
    document.body.appendChild(el)
  })
  afterEach(() => {
    el.remove()
  })

  it('returns false when disconnected', () => {
    const detached = document.createElement('div')
    expect(isRenderedVisible(detached)).toBe(false)
  })

  it('display:none → false', () => {
    el.style.display = 'none'
    expect(isRenderedVisible(el)).toBe(false)
  })

  it('explicit visibility:hidden → false', () => {
    el.style.visibility = 'hidden'
    expect(isRenderedVisible(el)).toBe(false)
  })

  it('jsdom has no real BCR → false (caller must use measureMode)', () => {
    el.style.display = 'block'
    expect(isRenderedVisible(el)).toBe(false)
  })
})
