// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.13 — Diagnostic Locate Visual Geometry V4 kill-bugs.
 *
 *   RECT-V4        unique rect factory + invariants (width must be re-derived)
 *   OCCLUSION-V4   drawer occlusion => OPEN-EDGE presentation, never a fake
 *                  closed clipped rectangle; full visibility => full-frame
 *   TABLE/CODE-V4  caption/expected-name keyline + cell/content untouched
 *   IMAGE-V4       sourceRange-exact inline geometry (no generic paragraph frame)
 *   HEADING-V4     text-tight marker (no full-width fill/border)
 *   VISUAL-COMMIT  open-edge borders are NEVER rendered closed; rect gate holds
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  clampRectToClip,
  inflateRectBy,
  makeRectSnapshot,
  validateRectInvariants,
} from './document-locate-rect-v4'
import { buildLocateVisualGeometryV4 } from './document-locate-visual-geometry-v4'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import type { DiagnosticLocateSeverity } from './document-diagnostic-locate-frame'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

function rectStub(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) }),
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

// ── RECT-V4 ────────────────────────────────────────────
describe('RECT-V4 — derived rect invariants', () => {
  it('RECT-V4-1: left=233.8 / right=778.4125 → width≈544.61 (NOT 916.4)', () => {
    const r = makeRectSnapshot({ left: 233.8, top: 10, right: 778.4125, bottom: 90 })
    expect(Math.abs(r.width - (r.right - r.left))).toBeLessThanOrEqual(0.5)
    expect(Math.abs(r.width - 544.6125)).toBeLessThanOrEqual(0.01)
    expect(r.width).not.toBeCloseTo(916.4, 0)
    expect(validateRectInvariants(r)).toBe(true)
  })

  it('RECT-V4-2: frozen source rect is never mutated by a clip', () => {
    const source = makeRectSnapshot({ left: 200, top: 0, right: 1000, bottom: 400 })
    const clip = makeRectSnapshot({ left: 200, top: 0, right: 492, bottom: 400 })
    const out = clampRectToClip(source, clip)!
    expect(out.right).toBe(492)
    expect(source.right).toBe(1000) // source untouched
    expect(source.width).toBe(800) // stale width NOT reused
    expect(out.width).toBe(292)
    expect(validateRectInvariants(out)).toBe(true)
  })

  it('RECT-V4-3: inflate/clip outputs always satisfy invariants', () => {
    const a = inflateRectBy(makeRectSnapshot({ left: 100, top: 100, right: 900, bottom: 300 }), 2)
    const b = clampRectToClip(a, makeRectSnapshot({ left: 100, top: 100, right: 500, bottom: 300 }))!
    expect(validateRectInvariants(a)).toBe(true)
    expect(validateRectInvariants(b)).toBe(true)
    expect(b.width).toBe(400)
  })
})

// ── OCCLUSION-V4 ───────────────────────────────────────
describe('OCCLUSION-V4 — open-edge vs full frame', () => {
  const wide = { left: 200, top: 300, right: 1000, bottom: 500 } // 800px object
  const unobscuredHalf = { left: 200, top: 0, right: 500, bottom: 900 } // drawer clips right half

  it('OCCLUSION-V4-1 (V5.4): drawer clips right half → open-right-frame, border OFF, presentation stays FULL semantic', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'table', semanticRect: wide, unobscuredRect: unobscuredHalf, headless: false })
    expect(g.presentation).toBe('open-right-frame')
    expect(g.borderRendered.right).toBe(false)
    expect(g.borderRendered.left).toBe(true)
    expect(g.radius.topRight).toBe(0)
    expect(g.radius.bottomRight).toBe(0)
    expect(g.rectInvariantPass).toBe(true)
    // V5.4 — drawer left is NOT a geometry authority. The presentation box
    // keeps the FULL semantic width; only the drawer-side border opens.
    expect(g.presentationRect!.right).toBe(1000)
    expect(g.visibilityClipRect!.right).toBe(500)
    expect(g.rightEdgeAuthority).toBe('SEMANTIC_TARGET')
    expect(g.coverage.horizontal).toBeGreaterThanOrEqual(0.98)
    expect(g.fullyVisible).toBe(false)
    expect(validateRectInvariants(g.presentationRect!)).toBe(true)
  })

  it('OCCLUSION-V4-2: drawer closed + fully visible → full-frame, right border ON', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'table', semanticRect: wide, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false })
    expect(g.presentation).toBe('full-frame')
    expect(g.borderRendered.right).toBe(true)
    expect(g.fullyVisible).toBe(true)
  })

  it('OCCLUSION-V4-3: no fake closed frame — open-edge right radius is 0', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'code', semanticRect: wide, unobscuredRect: unobscuredHalf, headless: false })
    expect(g.presentation).toBe('open-right-frame')
    expect(g.borderRendered.right).toBe(false)
    expect(g.radius.topRight).toBe(0)
    expect(g.radius.bottomRight).toBe(0)
  })
})

// ── TABLE-V4 / CODE-V4 ─────────────────────────────────
describe('TABLE-V4 / CODE-V4 — caption cue + native content untouched', () => {
  function commitObject(kind: 'table' | 'code', withCaption: boolean) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement(kind === 'table' ? 'table' : 'pre')
    rectStub(anchor, { left: 200, top: 300, right: 1000, bottom: 500 })
    document.body.appendChild(anchor)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({
      diagnosticId: 'd1', severity: 'warning', anchor,
      kind, captionHostRect: withCaption ? { left: 200, top: 260, right: 320, bottom: 292, width: 120, height: 32 } : null,
    })
    return { root, anchor, ctrl }
  }

  it('TABLE-V4: caption host available → caption-edge keyline + full-frame; td untouched', () => {
    const { root, anchor, ctrl } = commitObject('table', true)
    const frame = root.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame).toBeTruthy()
    expect(frame.dataset.presentation).toBe('full-frame')
    expect(frame.dataset.captionCue).toBe('caption-host')
    expect(frame.querySelectorAll('[data-marker-kind="caption-edge"]').length).toBe(1)
    // td/th/tr never get a background (native styles untouched).
    expect(anchor.querySelectorAll('td,th,tr').length).toBe(0)
    expect(anchor.style.background).toBe('')
  })

  it('CODE-V4: no caption host → NO cue line (fill-only); pre untouched; occluded → open-right', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const anchor = document.createElement('pre')
    rectStub(anchor, { left: 200, top: 300, right: 1000, bottom: 520 })
    document.body.appendChild(anchor)
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'c1', severity: 'warning', anchor, kind: 'code' })
    ctrl.reposition({ clipRect: { left: 200, top: 0, right: 500, bottom: 900, width: 300, height: 900 }, headless: false })
    const frame = root.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement
    expect(frame.dataset.presentation).toBe('open-right-frame')
    expect(frame.dataset.openEdge).toBe('right')
    // V5.12-R7 §5A — the 2px `top-edge` keyline cue is NO LONGER CREATED: the
    // frame's own severity fill is the whole locate visual.
    expect(frame.dataset.captionCue).toBeUndefined()
    expect(frame.querySelectorAll('[data-marker-kind="caption-edge"]').length).toBe(0)
    expect(anchor.style.background).toBe('')
  })
})

// ── IMAGE-V4 ───────────────────────────────────────────
describe('IMAGE-V4 — sourceRange-exact inline geometry', () => {
  it('IMAGE-V4-1: force-inline exact rect → inline-mark presentation, compact width', () => {
    const g = buildLocateVisualGeometryV4({
      kind: 'block',
      semanticRect: { left: 300, top: 400, right: 470, bottom: 430 },
      unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 },
      headless: false,
      forceInlineMark: true,
    })
    expect(g.presentation).toBe('inline-mark')
    expect(g.presentationRect!.width).toBe(170)
    expect(g.borderRendered.right).toBe(true) // inline marks are not open-edge
  })

  it('IMAGE-V4-2: exact inline geometry is used INSTEAD of a generic 800px closed frame', () => {
    // The paragraph is 800 wide; the verified sourceRange text is only ~170px.
    const widePara = { left: 200, top: 400, right: 1000, bottom: 430 }
    const exact = { left: 300, top: 400, right: 470, bottom: 430 }
    const exactG = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: exact, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false, forceInlineMark: true })
    const generic = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: widePara, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false })
    expect(exactG.presentation).toBe('inline-mark')
    expect(exactG.presentationRect!.width).toBeLessThan(300)
    expect(generic.presentation).toBe('full-frame')
    // The verified geometry must drive the visual, not the whole paragraph.
    expect(exactG.presentationRect!.width).toBeLessThan(generic.presentationRect!.width)
  })

  it('IMAGE-V4-3: occurrence 0 and occurrence 1 map to DISTINCT visual geometry', () => {
    const oc0 = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: { left: 200, top: 400, right: 470, bottom: 430 }, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false, forceInlineMark: true })
    const oc1 = buildLocateVisualGeometryV4({ kind: 'block', semanticRect: { left: 200, top: 500, right: 420, bottom: 530 }, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false, forceInlineMark: true })
    expect(oc0.presentation).toBe('inline-mark')
    expect(oc1.presentation).toBe('inline-mark')
    expect(oc0.presentationRect!.top).not.toBe(oc1.presentationRect!.top)
    expect(oc0.presentationRect!.height).toBeGreaterThan(0)
    expect(oc1.presentationRect!.height).toBeGreaterThan(0)
    expect(validateRectInvariants(oc0.presentationRect)).toBe(true)
    expect(validateRectInvariants(oc1.presentationRect)).toBe(true)
  })
})

// ── HEADING-V4 ─────────────────────────────────────────
describe('HEADING-V4 — text-tight marker', () => {
  it('HEADING-V4-1/2: heading carrier is a text-tight FILL, never a full-width band/border', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'heading', semanticRect: { left: 200, top: 100, right: 1000, bottom: 150 }, unobscuredRect: { left: 200, top: 0, right: 1400, bottom: 900 }, headless: false })
    expect(g.presentation).toBe('text-tight-marker')
    // V5.12-R7 §9 — CSS: border none + a severity FILL (no corner cap / keyline).
    expect(scss).toMatch(/text-tight-marker[\s\S]{0,200}border: none/)
    expect(scss).toMatch(/text-tight-marker[\s\S]{0,240}background: var\(--ink-locate-context-bg\)/)
    expect(scss).not.toContain(".inkchapter-diagnostic-locate-frame[data-presentation='text-tight-marker']::after")
  })

  it('HEADING-V4-3: text geometry unavailable → marker-only fallback (still text-tight)', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'heading', semanticRect: { left: 200, top: 100, right: 340, bottom: 150 }, unobscuredRect: null, headless: true })
    expect(g.presentation).toBe('text-tight-marker')
    expect(g.rectInvariantPass).toBe(true)
  })
})

// ── VISUAL-COMMIT-V4 ───────────────────────────────────
describe('VISUAL-COMMIT-V4 — no fake closed frame; gate holds', () => {
  it('VISUAL-COMMIT-2/3: an occluded object is an OPEN frame (border off), never a closed clipped rect', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'table', semanticRect: { left: 200, top: 300, right: 1000, bottom: 500 }, unobscuredRect: { left: 200, top: 0, right: 500, bottom: 900 }, headless: false })
    expect(g.presentation).toBe('open-right-frame')
    expect(g.borderRendered.right).toBe(false)
    expect(g.rectInvariantPass).toBe(true) // VISUAL-COMMIT-3: open-right is a VALID commit
  })

  it('VISUAL-COMMIT-4: DOM-order layering keeps frame below the drawer (no paint above)', () => {
    document.body.innerHTML = '<div id="root"><div class="inkchapter-diagnostic-locate-frame"></div><div class="inkchapter-doc-toolbar"></div><div class="inkchapter-doc-navigator"></div><div class="inkchapter-doc-drawer"></div></div>'
    const root = document.getElementById('root')!
    const els = Array.from(root.children)
    const frameIdx = els.findIndex(el => el.classList.contains('inkchapter-diagnostic-locate-frame'))
    const drawerIdx = els.findIndex(el => el.classList.contains('inkchapter-doc-drawer'))
    expect(frameIdx).toBeGreaterThanOrEqual(0)
    expect(frameIdx).toBeLessThan(drawerIdx)
  })

  it('VISUAL-COMMIT-1: rect gate — derived presentation rects always pass invariants', () => {
    const g = buildLocateVisualGeometryV4({ kind: 'code', semanticRect: { left: 233.8, top: 10, right: 1000, bottom: 400 }, unobscuredRect: { left: 233.8, top: 0, right: 700, bottom: 900 }, headless: false })
    expect(g.rectInvariantPass).toBe(true)
    expect(Math.abs(g.presentationRect!.width - (g.presentationRect!.right - g.presentationRect!.left))).toBeLessThanOrEqual(0.5)
  })
})
