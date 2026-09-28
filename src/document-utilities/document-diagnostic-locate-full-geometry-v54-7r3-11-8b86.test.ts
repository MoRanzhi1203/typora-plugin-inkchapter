// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.17 — Diagnostic Locate Full Geometry V5.4 kill-bugs.
 *
 *   GEOMETRY-V54   semantic/presentation/visibility authority split
 *   CODE-GEO-V54   full code-block wrapper geometry (never drawer-clipped)
 *   TABLE-GEO-V54  full table wrapper geometry (never drawer-clipped)
 *   INLINE-GEO-V54 link/path inline stays on the full semantic text rect
 *   DRAWER-TEXT-V54 drawer active-row vs text bounds independence
 *   RECT-V54       rect invariants + viewport→host conversion
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildLocateVisualGeometryV4 } from './document-locate-visual-geometry-v4'
import { makeRectSnapshot, validateRectInvariants, viewportToHostRect, inflateRectBy } from './document-locate-rect-v4'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

function rectStub(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

// ── GEOMETRY-V54 ────────────────────────────────────────
describe('GEOMETRY-V54 — semantic vs presentation vs visibility clip', () => {
  const wide = { left: 200, top: 300, right: 1200, bottom: 500 } // 1000px object
  const drawerClip = { left: 200, top: 0, right: 700, bottom: 900 } // drawer covers right

  it('GEOMETRY-V54-1: semanticRect.right follows the real target, NOT drawer.left', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'code', semanticRect: wide, unobscuredRect: drawerClip, headless: false })
    expect(g.semanticRect.right).toBe(1200)
    expect(g.presentationRect!.right).toBe(1200) // full box kept
    expect(g.visibilityClipRect!.right).toBe(700) // clip recorded separately
    expect(g.rightEdgeAuthority).toBe('SEMANTIC_TARGET')
  })

  it('GEOMETRY-V54-2: unobscured right < target right still keeps presentation on the semantic edge', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'table', semanticRect: wide, unobscuredRect: { left: 200, top: 0, right: 500, bottom: 900 }, headless: false })
    expect(g.semanticRect.right).toBe(1200)
    expect(g.presentationRect!.right).toBe(1200)
    expect(g.fullyVisible).toBe(false)
    expect(g.presentation).toBe('open-right-frame')
  })

  it('GEOMETRY-V54-3: drawer occlusion still flows through open-edge flags + full coverage', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: wide, unobscuredRect: drawerClip, headless: false })
    expect(g.occlusion).toContain('right')
    expect(g.borderRendered.right).toBe(false)
    expect(g.coverage.horizontal).toBeGreaterThanOrEqual(0.98)
    expect(g.coverage.vertical).toBeGreaterThanOrEqual(0.98)
    expect(validateRectInvariants(g.presentationRect)).toBe(true)
  })
})

// ── CODE-GEO-V54 / TABLE-GEO-V54 ────────────────────────
describe('CODE-GEO-V54 / TABLE-GEO-V54 — full block wrapper geometry', () => {
  function commitBlock(kind: 'code' | 'table') {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement(kind === 'code' ? 'pre' : 'table')
    rectStub(anchor, { left: 200, top: 300, right: 1200, bottom: 500 })
    document.body.appendChild(anchor)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'g', severity: 'warning', anchor, kind })
    return { ctrl, anchor, root }
  }

  it('CODE-GEO-V54-1: full code wrapper rect is the semantic width (drawer narrower clip ignored for geometry)', () => {
    const { ctrl, anchor, root } = commitBlock('code')
    // Drawer open: visibility clip stops at x=600; presentation must still wrap.
    ctrl.reposition({ headless: false, clipRect: { left: 200, top: 0, right: 600, bottom: 900, width: 400, height: 900 } })
    const f = ctrl.getFrameRect()!
    const sem = ctrl.getSemanticRect()!
    expect(Math.abs(sem.width - 1000)).toBeLessThanOrEqual(6) // +2 outset each side
    expect(Math.abs((f.left + f.width) - (sem.left + sem.width))).toBeLessThanOrEqual(1)
    const report = ctrl.getGeometryReport()
    expect(report.rightEdgeAuthority).toBe('SEMANTIC_TARGET')
    expect(report.horizontalCoverage).toBeGreaterThanOrEqual(0.98)
    expect(report.verticalCoverage).toBeGreaterThanOrEqual(0.98)
    ctrl.dispose(); anchor.remove(); root.remove()
  })

  it('CODE-GEO-V54-2: after a narrower clip there is no truncated frame', () => {
    const { ctrl, anchor, root } = commitBlock('code')
    ctrl.reposition({ headless: false, clipRect: { left: 200, top: 0, right: 600, bottom: 900, width: 400, height: 900 } })
    const f = ctrl.getFrameRect()!
    // Frame right never stops at the clip/drawer edge (600).
    expect(f.left + f.width).toBeGreaterThan(600)
    ctrl.dispose(); anchor.remove(); root.remove()
  })

  it('TABLE-GEO-V54-1/2: full table wrapper is semantic host and right edge is never drawer-left', () => {
    const { ctrl, anchor, root } = commitBlock('table')
    ctrl.reposition({ headless: false, clipRect: { left: 200, top: 0, right: 650, bottom: 900, width: 450, height: 900 } })
    const f = ctrl.getFrameRect()!
    const sem = ctrl.getSemanticRect()!
    expect(Math.abs(sem.right - 1200)).toBeLessThanOrEqual(4) // +2 outset
    expect(Math.abs((f.left + f.width) - 1200)).toBeLessThanOrEqual(5)
    expect(f.left + f.width).toBeGreaterThan(650)
    const report = ctrl.getGeometryReport()
    expect(report.horizontalCoverage).toBeGreaterThanOrEqual(0.98)
    ctrl.dispose(); anchor.remove(); root.remove()
  })

  it('TABLE-GEO-V54-3/4: cells keep native background and geometry is complete', () => {
    const { ctrl, anchor, root } = commitBlock('table')
    const td = document.createElement('td')
    td.textContent = 'user'
    anchor.appendChild(td)
    ctrl.reposition({ headless: false, clipRect: { left: 200, top: 0, right: 600, bottom: 900, width: 400, height: 900 } })
    expect(td.style.background).toBe('')
    expect(anchor.style.background).toBe('')
    ctrl.dispose(); anchor.remove(); root.remove()
  })
})

// ── INLINE-GEO-V54 ──────────────────────────────────────
describe('INLINE-GEO-V54 — link/path inline on the full semantic text', () => {
  it('INLINE-GEO-V54-1/4: drawer state does not shorten the inline presentation rect', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'inline', semanticRect: { left: 240, top: 300, right: 900, bottom: 322 }, unobscuredRect: { left: 200, top: 0, right: 480, bottom: 900 }, headless: false })
    expect(g.presentation).toBe('inline-mark')
    expect(g.presentationRect!.right).toBe(900)
    expect(g.visibilityClipRect!.right).toBe(480)
    expect(validateRectInvariants(g.presentationRect)).toBe(true)
  })

  it('INLINE-GEO-V54-2: wrapped/fragment semantics preserved via full Range union (headless fallback keeps semantic box)', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'inline', semanticRect: { left: 240, top: 300, right: 980, bottom: 344 }, unobscuredRect: null, headless: true })
    expect(g.presentationRect!.right).toBe(980)
    expect(g.coverage.horizontal).toBeGreaterThanOrEqual(0.98)
  })

  it('INLINE-GEO-V54-3: long missing-image destination keeps full width (no unobscured clip)', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: { left: 240, top: 300, right: 1100, bottom: 330 }, unobscuredRect: { left: 200, top: 0, right: 760, bottom: 900 }, headless: false, forceInlineMark: true })
    expect(g.presentation).toBe('inline-mark')
    expect(g.presentationRect!.right).toBe(1100)
    expect(g.borderRendered.right).toBe(true)
  })
})

// ── DRAWER-TEXT-V54 ─────────────────────────────────────
describe('DRAWER-TEXT-V54 — drawer text bounds never follow panel geometry', () => {
  it('DRAWER-TEXT-V54-1/2/3: active row = full-width; text highlight independent; no content-column clip in CSS', () => {
    // Row active is the ONLY full-width drawer wash; no text/segment clip rules.
    expect(scss).not.toMatch(/inkchapter-doc-drawer__item[^{}]*\{[^}]*overflow:\s*hidden/)
    const active = scss.slice(scss.indexOf('.inkchapter-doc-drawer__item--error.is-selected,'))
    expect(active).toContain('background: color-mix(')
    // Active background is bounded but NEVER positioned off the text bounds.
    expect(active).not.toContain('right: 0')
  })

  it('DRAWER-TEXT-V54-4: no fixed-width text highlight shrinks the description', () => {
    // Drawer text spans live in normal flow; CSS adds no width/right authority.
    expect(scss).not.toMatch(/inkchapter-doc-drawer__item-(title|desc|code)[^{}]*\{[^}]*width:/)
  })
})

// ── RECT-V54 ────────────────────────────────────────────
describe('RECT-V54 — invariants + conversion', () => {
  it('RECT-V54-1/2: width/height always re-derived from borders', () => {
    const r = makeRectSnapshot({ left: 100, top: 50, right: 400, bottom: 200 })
    expect(r.width).toBe(300)
    expect(r.height).toBe(150)
    expect(Math.abs(r.width - (r.right - r.left))).toBe(0)
    expect(Math.abs(r.height - (r.bottom - r.top))).toBe(0)
  })

  it('RECT-V54-3: derived rects rebuild width/height (no stale spread)', () => {
    const a = makeRectSnapshot({ left: 100, top: 50, right: 400, bottom: 200 })
    const b = makeRectSnapshot({ left: a.left, top: a.top, right: 600, bottom: a.bottom })
    expect(b.width).toBe(500) // NOT 300 (stale width dropped)
    expect(validateRectInvariants(b)).toBe(true)
  })

  it('RECT-V54-4: frozen source DOMRect remains unchanged by operations', () => {
    const src = { left: 100, top: 50, right: 400, bottom: 200 }
    const out = inflateRectBy(src, 2)
    expect(src.right).toBe(400)
    expect(out.left).toBe(98)
    expect(out.right).toBe(402)
  })

  it('RECT-V54-5: viewport→host conversion preserves dimensions', () => {
    const h = viewportToHostRect({ left: 300, top: 400, right: 1300, bottom: 500 }, { left: 100, top: 80, right: 1200, bottom: 900 })
    expect(h.left).toBe(200)
    expect(h.top).toBe(320)
    expect(h.width).toBe(1000)
    expect(h.height).toBe(100)
    expect(Math.abs(h.width - (h.right - h.left))).toBe(0)
  })
})
