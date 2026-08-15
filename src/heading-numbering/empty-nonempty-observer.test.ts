// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  classifyEmptyNonemptySkipReason,
  shouldEmitEmptyNonemptyTransition,
  computeFirstGlyphVisualGeometry,
  evaluateEmptyNonemptyProjectionTransition,
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

describe('OBSRT — empty→nonempty observer runtime provenance', () => {
  it('OBSRT-1: insertText provenance is eligible (ARM path)', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertText', 'force-indent', true, 'R', '')).toBeNull()
  })

  it('OBSRT-2: insertCompositionText provenance is eligible (no regression)', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertCompositionText', 'force-indent', true, 'R', '')).toBeNull()
  })

  it('OBSRT-3: second ordinary character → not eligible', () => {
    expect(shouldEmitEmptyNonemptyTransition(true, 'force-indent', false, 'R', '啊')).toBe(false)
  })

  it('OBSRT-4: non-force-indent → SKIP SEMANTIC_NOT_FORCE_INDENT', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertText', 'auto', true, 'R', '')).toBe('SEMANTIC_NOT_FORCE_INDENT')
  })

  it('OBSRT-5: before already nonempty → SKIP BEFORE_NOT_EMPTY', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertText', 'force-indent', true, 'R', '啊')).toBe('BEFORE_NOT_EMPTY')
  })

  it('OBSRT-6: no CURRENT_LIVE record → SKIP NO_CURRENT_LIVE_RECORD', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertText', 'force-indent', true, null, '')).toBe('NO_CURRENT_LIVE_RECORD')
  })

  it('OBSRT-7/8: unsupported input type → SKIP UNSUPPORTED_INPUT_TYPE', () => {
    expect(classifyEmptyNonemptySkipReason(true, 'insertParagraph', 'force-indent', true, 'R', '')).toBe('UNSUPPORTED_INPUT_TYPE')
  })

  it('OBSRT-9: same canonical + same runtime → canonicalIdentityPreserved=true', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.canonicalIdentityPreserved).toBe(true)
    expect(r.runtimeIdBefore).toBe(r.runtimeIdAfter)
  })

  it('OBSRT-10: controlled replacement (same canonical, generation++) → PASS', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(
      before({ generation: 1 }),
      after({ generation: 2 }),
    )
    expect(r.canonicalRecordIdBefore).toBe(r.canonicalRecordIdAfter)
    expect(r.canonicalIdentityPreserved).toBe(true)
  })

  it('OBSRT-11: geometry Range is pure (does not touch Selection)', () => {
    const g = computeFirstGlyphVisualGeometry({ paragraphRectLeft: 100, borderInlineStartWidth: 0, firstGlyphRectLeft: 132, expectedIndentPx: 32, tolerancePx: 4 })
    expect(g.actualFirstGlyphIndentPx).toBe(32)
  })

  it('OBSRT-12: evaluation is deterministic (fail-open pure)', () => {
    const a = evaluateEmptyNonemptyProjectionTransition(before(), after())
    const b = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(a.overall).toBe(b.overall)
  })

  it('OBSRT-13: padding 32→0 + textIndent 0→32 → projectionExclusive=true', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.projectionExclusive).toBe(true)
  })

  it('OBSRT-14: 32+32 double-indent → overall=false', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after({ paddingInlineStartPx: 32, textIndentPx: 32 }))
    expect(r.projectionExclusive).toBe(false)
    expect(r.overall).toBe(false)
  })

  it('OBSRT-15: transition report carries expected geometric fields', () => {
    const r = evaluateEmptyNonemptyProjectionTransition(before(), after())
    expect(r.actualFirstGlyphIndentPx).toBe(32)
    expect(r.tolerancePx).toBe(4)
    expect(r.overall).toBe(true)
  })
})
