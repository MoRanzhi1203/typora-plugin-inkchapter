// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  decideEmptyProjectionMode,
  computeEmptyVisualCaretGeometry,
  decideEmptySpecialCommit,
  evaluateEmptySpecialFinal,
  isNativeEmptyParagraph,
} from './empty-special-command'
import {
  setParagraphIndentMode,
  getParagraphIndentMode,
  applyEffectiveParagraphIndent,
  clearParagraphIndentVisualAndSemantic,
} from './paragraph-indent-manager'
import { ParagraphCanonicalRegistry } from './paragraph-canonical-registry'
import type { ParagraphIndentOverrideRecord } from './paragraph-layout-store'

function makeRecord(id: string): ParagraphIndentOverrideRecord {
  return { id, mode: 'force-indent', anchor: { lastKnownOrdinal: 0 }, temporary: true }
}

describe('EVC — empty visual projection', () => {
  it('EVC-1: non-empty force-indent → TEXT_INDENT (text-indent=2em, no empty padding)', () => {
    expect(decideEmptyProjectionMode(false, 'force-indent')).toBe('TEXT_INDENT')
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'TEXT_INDENT',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 0,
      textIndentPx: 32, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('EVC-2: native-empty force-indent → EMPTY_PADDING projection active', () => {
    expect(decideEmptyProjectionMode(true, 'force-indent')).toBe('EMPTY_PADDING')
  })

  it('EVC-3: native-empty force-indent → effective caret visual target=2em', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'EMPTY_PADDING',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 32,
      textIndentPx: 0, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('EVC-4: empty auto paragraph → NONE (unaffected)', () => {
    expect(decideEmptyProjectionMode(true, 'auto')).toBe('NONE')
  })

  it('EVC-5: empty flush paragraph → NONE (unaffected)', () => {
    expect(decideEmptyProjectionMode(true, 'force-flush')).toBe('NONE')
  })

  it('EVC-6: first real char → empty projection removed (EMPTY_PADDING → TEXT_INDENT)', () => {
    expect(decideEmptyProjectionMode(true, 'force-indent')).toBe('EMPTY_PADDING')
    expect(decideEmptyProjectionMode(false, 'force-indent')).toBe('TEXT_INDENT')
  })

  it('EVC-7: first real char → text-indent restored to 2em (padding back to 0)', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'TEXT_INDENT',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 0,
      textIndentPx: 32, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.textIndentPx).toBe(32)
    expect(g.paddingInlineStart).toBe(0)
    expect(g.actualCaretIndentPx).toBe(32)
  })

  it('EVC-8: no double-indent after first char (still 32px, not 64px)', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'TEXT_INDENT',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 0,
      textIndentPx: 32, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.actualCaretIndentPx).not.toBe(64)
  })

  it('EVC-9: semantic remains force-indent in both empty and non-empty projection', () => {
    expect(decideEmptyProjectionMode(true, 'force-indent')).toBe('EMPTY_PADDING')
    expect(decideEmptyProjectionMode(false, 'force-indent')).toBe('TEXT_INDENT')
    // projection is purely visual — semantic mode stays force-indent.
  })

  it('EVC-10: projection never inserts Markdown/DOM placeholder', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    setParagraphIndentMode(p, 'force-indent')
    applyEffectiveParagraphIndent(p, 'indent-2')
    expect(p.innerHTML).toBe('')
    expect(p.textContent).toBe('')
    expect(p.childNodes.length).toBe(0)
    expect(p.textContent).not.toContain('\u200B')
    expect(p.textContent).not.toContain('&nbsp;')
  })

  it('EVC-11: projection does not write Selection', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(p, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    const beforeAnchor = sel.anchorNode
    const beforeOffset = sel.anchorOffset

    setParagraphIndentMode(p, 'force-indent')
    applyEffectiveParagraphIndent(p, 'indent-2')

    expect(sel.anchorNode).toBe(beforeAnchor)
    expect(sel.anchorOffset).toBe(beforeOffset)
  })

  it('EVC-12: NormalEnter destination (non-empty) stays TEXT_INDENT, not empty padding', () => {
    expect(decideEmptyProjectionMode(false, 'force-indent')).toBe('TEXT_INDENT')
    expect(isNativeEmptyParagraph({ childNodes: [] as any, textContent: 'text' } as HTMLElement)).toBe(false)
  })
})

describe('GEOM — empty visual caret geometry authority', () => {
  it('GEOM-1: TEXT_INDENT mode → expected≈32 / actual≈32', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'TEXT_INDENT',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 0,
      textIndentPx: 32, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('GEOM-2: EMPTY_PADDING mode → padding≈32 / textIndent≈0 / actual≈32', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'EMPTY_PADDING',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 32,
      textIndentPx: 0, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.paddingInlineStart).toBe(32)
    expect(g.textIndentPx).toBe(0)
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('GEOM-3: padded content box must NOT produce actual=0', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'EMPTY_PADDING',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 32,
      textIndentPx: 0, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.paragraphContentLeft).toBe(132)
    expect(g.unindentedVisualStart).toBe(100)
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.actualCaretIndentPx).not.toBe(0)
  })

  it('GEOM-4: border/padding changes keep unindentedVisualStart correct', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'EMPTY_PADDING',
      paragraphRectLeft: 100, borderInlineStartWidth: 2, paddingInlineStart: 32,
      textIndentPx: 0, caretRectLeft: 134, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.unindentedVisualStart).toBe(102)
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('GEOM-5: empty→text transition never yields 64px', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16, expectedIndentPx: 32, projectionMode: 'TEXT_INDENT',
      paragraphRectLeft: 100, borderInlineStartWidth: 0, paddingInlineStart: 0,
      textIndentPx: 32, caretRectLeft: 132, tolerancePx: 4, logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.actualCaretIndentPx).not.toBe(64)
  })
})

describe('ATOMIC — failed-transaction atomic commit gate', () => {
  it('ATOMIC-1: geometry FAIL → FINAL=false → ROLLBACK (no committed canonical)', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: false,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: false, // geometry failed
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(false)
    const decision = decideEmptySpecialCommit({
      preCommitVerifyPassed: false,
      canonicalCommitSucceeded: false,
      canonicalOwnerCorrect: false,
    })
    expect(decision).toBe('ROLLBACK')
  })

  it('ATOMIC-2: geometry FAIL → no persistence-eligible record', () => {
    expect(decideEmptySpecialCommit({
      preCommitVerifyPassed: false,
      canonicalCommitSucceeded: false,
      canonicalOwnerCorrect: false,
    })).toBe('ROLLBACK')
  })

  it('ATOMIC-3: geometry FAIL → no rehydrate winner (never registered)', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    const registry = new ParagraphCanonicalRegistry('sess-atomic-3')
    // commit was deferred → nothing registered → no rehydrate winner
    expect(registry.resolveExactLiveRecord(p)).toBeNull()
  })

  it('ATOMIC-4: geometry FAIL → provisional visual/semantic rolled back', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    setParagraphIndentMode(p, 'force-indent')
    applyEffectiveParagraphIndent(p, 'indent-2')
    expect(getParagraphIndentMode(p)).toBe('force-indent')

    clearParagraphIndentVisualAndSemantic(p)

    expect(getParagraphIndentMode(p)).toBe('auto')
    expect(p.classList.contains('inkchapter-paragraph-effective-indent-2')).toBe(false)
    expect(p.classList.contains('inkchapter-paragraph-effective-flush')).toBe(false)
    expect(p.style.textIndent).toBe('')
  })

  it('ATOMIC-5: FINAL PASS → exactly one canonical commit (COMMIT)', () => {
    const decision = decideEmptySpecialCommit({
      preCommitVerifyPassed: true,
      canonicalCommitSucceeded: true,
      canonicalOwnerCorrect: true,
    })
    expect(decision).toBe('COMMIT')
  })

  it('ATOMIC-6: FINAL PASS → record becomes persistence eligible', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(true)
    expect(decideEmptySpecialCommit({
      preCommitVerifyPassed: true,
      canonicalCommitSucceeded: true,
      canonicalOwnerCorrect: true,
    })).toBe('COMMIT')
  })

  it('ATOMIC-7: BLOCKED txn → registry serialization excludes record', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    const registry = new ParagraphCanonicalRegistry('sess-atomic-7')
    registry.registerCurrentSessionRecord(makeRecord('rec-x'), 'doc-a', p, 'rt-1', true, 'scope-a', 'doc-a')
    expect(registry.resolveExactLiveRecord(p)?.recordId).toBe('rec-x')

    registry.deleteRecord('rec-x')

    expect(registry.resolveExactLiveRecord(p)).toBeNull()
    expect(registry.getAllRecordIds()).not.toContain('rec-x')
  })

  it('ATOMIC-8: BLOCKED txn → next clean txn starts with no leaked owner', () => {
    document.body.innerHTML = '<p id="p1"></p>'
    const p = document.getElementById('p1')!
    const registry = new ParagraphCanonicalRegistry('sess-atomic-8')
    registry.registerCurrentSessionRecord(makeRecord('rec-old'), 'doc-a', p, 'rt-1', true, 'scope-a', 'doc-a')
    registry.deleteRecord('rec-old')

    // no leaked owner → a new record can register on the same element cleanly
    const meta = registry.registerCurrentSessionRecord(makeRecord('rec-new'), 'doc-a', p, 'rt-1', true, 'scope-a', 'doc-a')
    expect(meta.state).toBe('CURRENT_LIVE')
    expect(registry.resolveExactLiveRecord(p)?.recordId).toBe('rec-new')
  })
})
