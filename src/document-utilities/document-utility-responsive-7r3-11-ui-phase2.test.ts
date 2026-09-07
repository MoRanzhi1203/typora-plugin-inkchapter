// @vitest-environment jsdom
/**
 * Phase 2-B — responsive layout decisions (pure, editor-geometry based).
 * These are CLASSIFICATION tests: they verify the real geometry decisions,
 * never pixel-level visual results (visual acceptance stays manual).
 */
import { describe, it, expect } from 'vitest'
import {
  decideNavigatorGutterVisible,
  decideToolbarDensity,
  decideDiagnosticsPresentation,
  decideToolbarPresentation,
  computeEditorVisibleWidth,
  decideNavigatorPresentation,
  MIN_NAVIGATOR_GUTTER_PX,
} from './document-utility-overlay-host'

describe('RESPONSIVE — navigator gutter-aware visibility', () => {
  it('right gutter enough → navigator visible', () => {
    expect(decideNavigatorGutterVisible(MIN_NAVIGATOR_GUTTER_PX)).toBe(true)
    expect(decideNavigatorGutterVisible(120)).toBe(true)
  })
  it('right gutter insufficient → navigator hidden', () => {
    expect(decideNavigatorGutterVisible(MIN_NAVIGATOR_GUTTER_PX - 1)).toBe(false)
    expect(decideNavigatorGutterVisible(0)).toBe(false)
  })
  it('unknown geometry (null) → visible (no measured crowding evidence)', () => {
    expect(decideNavigatorGutterVisible(null)).toBe(true)
  })
})

describe('RESPONSIVE — toolbar density', () => {
  it('wide editor → full toolbar', () => {
    expect(decideToolbarDensity(1200)).toBe('full')
  })
  it('narrow editor → compact toolbar', () => {
    expect(decideToolbarDensity(400)).toBe('compact')
  })
  it('unknown editor width → full (legacy default)', () => {
    expect(decideToolbarDensity(null)).toBe('full')
  })
})

describe('RESPONSIVE — diagnostics presentation', () => {
  it('wide editor → desktop anchored panel', () => {
    expect(decideDiagnosticsPresentation(1200)).toBe('desktop')
  })
  it('narrow editor → compact sheet mode', () => {
    expect(decideDiagnosticsPresentation(400)).toBe('sheet')
  })
  it('boundary width stays desktop (no jump below threshold)', () => {
    expect(decideDiagnosticsPresentation(520)).toBe('desktop')
    expect(decideDiagnosticsPresentation(519)).toBe('sheet')
  })
})

// Phase 2-B1 — three-tier toolbar presentation
describe('RESPONSIVE — toolbar presentation (full→compact→suppressed)', () => {
  it('wide editor → full', () => {
    expect(decideToolbarPresentation(1200)).toBe('full')
  })
  it('narrow editor → compact', () => {
    expect(decideToolbarPresentation(400)).toBe('compact')
  })
  it('collapsed editor (KNOWN) → suppressed', () => {
    expect(decideToolbarPresentation(240)).toBe('suppressed')
  })
  it('UNKNOWN geometry → full (never treat null as collapsed)', () => {
    expect(decideToolbarPresentation(null)).toBe('full')
  })
  it('suppressed→narrow→wide restores full', () => {
    expect(decideToolbarPresentation(200)).toBe('suppressed')
    expect(decideToolbarPresentation(400)).toBe('compact')
    expect(decideToolbarPresentation(1200)).toBe('full')
  })
})

// Phase 2-B.2 — visible editor geometry (viewport-clipped, not layout width)
describe('RESPONSIVE — visible editor width (Phase 2-B.2)', () => {
  it('viewport≈450, layout 275.8→795.8/width 520 → visibleWidth≈174.2 → suppressed', () => {
    const vw = computeEditorVisibleWidth({ left: 275.8, right: 795.8 }, 450)
    expect(vw).toBeCloseTo(174.2, 1)
    expect(decideToolbarPresentation(vw)).toBe('suppressed')
  })
  it('viewport≈150 → visibleWidth=0 → suppressed', () => {
    const vw = computeEditorVisibleWidth({ left: 275.8, right: 795.8 }, 150)
    expect(vw).toBe(0)
    expect(decideToolbarPresentation(vw)).toBe('suppressed')
  })
  it('unknown layout → null visible width (never collapsed)', () => {
    expect(computeEditorVisibleWidth(null, 1000)).toBeNull()
  })
  it('wide roundtrip full→compact→suppressed→compact→full', () => {
    const widths = [1200, 400, 150, 400, 1200]
    const out = widths.map(w => decideToolbarPresentation(w))
    expect(out).toEqual(['full', 'compact', 'suppressed', 'compact', 'full'])
  })
})

// Phase 2-B.3 — Navigator presentation (gutter | inset | hidden)
describe('RESPONSIVE — navigator presentation (Phase 2-B.3)', () => {
  const g = (o = {}) => decideNavigatorPresentation({ scrollable: true, rightGutter: 120, insetSafeWidth: 200, requiredGutter: 44, ...o })
  it('short doc → hidden NOT_SCROLLABLE', () => {
    const r = decideNavigatorPresentation({ scrollable: false, rightGutter: 500, insetSafeWidth: 500, requiredGutter: 44 })
    expect(r).toEqual({ presentation: 'hidden', reason: 'NOT_SCROLLABLE' })
  })
  it('scrollable + gutter enough → gutter', () => {
    expect(g().presentation).toBe('gutter')
  })
  it('DevTools-like medium: gutter short but inset safe → inset', () => {
    const r = g({ rightGutter: 20 })
    expect(r).toEqual({ presentation: 'inset', reason: 'INSET_AVAILABLE' })
  })
  it('no safe gutter/inset → hidden NO_SAFE_PLACEMENT', () => {
    const r = g({ rightGutter: 0, insetSafeWidth: 10 })
    expect(r).toEqual({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' })
  })
  it('gutter → inset → gutter roundtrip (reversible, scrollable stays true)', () => {
    expect(g({ rightGutter: 120 }).presentation).toBe('gutter')
    expect(g({ rightGutter: 10 }).presentation).toBe('inset')
    expect(g({ rightGutter: 120 }).presentation).toBe('gutter')
  })
})
