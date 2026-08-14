// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  computeFirstGlyphVisualGeometry,
  evaluateEmptyNonemptyProjectionTransition,
  shouldEmitEmptyNonemptyTransition,
  type EmptyNonemptyProjectionBefore,
  type EmptyNonemptyProjectionAfter,
} from './empty-special-command'

function before(overrides: Partial<EmptyNonemptyProjectionBefore> = {}): EmptyNonemptyProjectionBefore {
  return {
    runtimeId: 'P-RUNTIME-2',
    canonicalRecordId: 'R',
    generation: 1,
    semanticMode: 'force-indent',
    visibleText: '',
    isNativeEmpty: true,
    paddingInlineStartPx: 32,
    textIndentPx: 0,
    fontSizePx: 16,
    paragraphRectLeft: 100,
    borderInlineStartWidth: 0,
    selectionRuntimeId: 'P-RUNTIME-2',
    logicalOffset: 0,
    ...overrides,
  }
}

function after(overrides: Partial<EmptyNonemptyProjectionAfter> = {}): EmptyNonemptyProjectionAfter {
  return {
    runtimeId: 'P-RUNTIME-2',
    canonicalRecordId: 'R',
    generation: 1,
    semanticMode: 'force-indent',
    visibleText: '啊',
    isNativeEmpty: false,
    paddingInlineStartPx: 0,
    textIndentPx: 32,
    fontSizePx: 16,
    paragraphRectLeft: 100,
    borderInlineStartWidth: 0,
    firstGlyphRectLeft: 132,
    selectionRuntimeId: 'P-RUNTIME-2',
    logicalOffset: 1,
    pluginSelectionWriteCount: 0,
    caretContinuityRestoreCount: 0,
    caretRepairCount: 0,
    ...overrides,
  }
}

describe('ENOT — empty→nonempty projection transition observability', () => {
  it('ENOT-1: empty force-indent BEFORE → padding32 textIndent0', () => {
    const b = before()
    expect(b.isNativeEmpty).toBe(true)
    expect(b.semanticMode).toBe('force-indent')
    expect(b.paddingInlineStartPx).toBe(32)
    expect(b.textIndentPx).toBe(0)
  })

  it('ENOT-2: first real char AFTER → padding0 textIndent32', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.paddingInlineStartAfterPx).toBe(0)
    expect(r.textIndentAfterPx).toBe(32)
    expect(r.projectionExclusive).toBe(true)
  })

  it('ENOT-3: same canonical record → canonicalIdentityPreserved', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.canonicalIdentityPreserved).toBe(true)
  })

  it('ENOT-4: first glyph actual≈expected (32)', () => {
    const g = computeFirstGlyphVisualGeometry({
      paragraphRectLeft: 100,
      borderInlineStartWidth: 0,
      firstGlyphRectLeft: 132,
      expectedIndentPx: 32,
      tolerancePx: 4,
    })
    expect(g.actualFirstGlyphIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('ENOT-5: no selection/caret write → selectionOwnershipClean', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.selectionOwnershipClean).toBe(true)
  })

  it('ENOT-6: not emitted for second ordinary character (before not native empty)', () => {
    expect(shouldEmitEmptyNonemptyTransition(true, 'force-indent', false, 'R', '啊')).toBe(false)
  })

  it('ENOT-7: not emitted for non-force-indent paragraph', () => {
    expect(shouldEmitEmptyNonemptyTransition(true, 'auto', true, 'R', '')).toBe(false)
  })

  it('ENOT-8: first-glyph geometry is read-only (pure, no Selection write)', () => {
    // Pure helper carries no DOM/Selection; result is derived from numeric inputs only.
    const g = computeFirstGlyphVisualGeometry({ paragraphRectLeft: 100, borderInlineStartWidth: 0, firstGlyphRectLeft: 132, expectedIndentPx: 32, tolerancePx: 4 })
    expect(g).toHaveProperty('actualFirstGlyphIndentPx', 32)
  })

  it('ENOT-9: transition evaluation is deterministic (fail-open pure)', () => {
    const r1 = evaluateEmptyNonemptyProjectionTransition(before(), after())
    const r2 = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r1.overall).toBe(r2.overall)
  })

  it('ENOT-10: overall=true only when all invariants hold', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.canonicalIdentityPreserved).toBe(true)
    expect(r.projectionExclusive).toBe(true)
    expect(r.firstGlyphGeometryCorrect).toBe(true)
    expect(r.selectionOwnershipClean).toBe(true)
    expect(r.overall).toBe(true)

    // Double-indent regression: padding stays 32 → projectionExclusive=false.
    const double = evaluateEmptyNonemptyProjectionTransition(
      before(),
      after({ paddingInlineStartPx: 32, textIndentPx: 32 }),
    )
    expect(double.projectionExclusive).toBe(false)
    expect(double.overall).toBe(false)
  })
})
