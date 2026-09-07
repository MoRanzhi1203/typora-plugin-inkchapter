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
