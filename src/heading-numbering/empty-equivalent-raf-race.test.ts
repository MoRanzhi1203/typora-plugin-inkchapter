// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  isEmptyEquivalentParagraph,
  classifyObserverEmptyEquivalent,
  decideEmptyProjectionMode,
  computeEmptyVisualCaretGeometry,
  evaluateEmptySpecialFinal,
  decideEmptySpecialCommit,
} from './empty-special-command'

function para(html: string): HTMLElement {
  document.body.innerHTML = `<p id="p">${html}</p>`
  return document.getElementById('p')!
}

describe('EMPTY-EQ — unified empty-equivalent predicate + RAF race regression', () => {
  it('EMPTY-EQ-1: <p></p> → emptyEquivalent=true', () => {
    expect(isEmptyEquivalentParagraph(para(''))).toBe(true)
  })

  it('EMPTY-EQ-2: <p>Text("")</p> → emptyEquivalent=true', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(''))
    expect(p.childNodes.length).toBe(1)
    expect(isEmptyEquivalentParagraph(p)).toBe(true)
  })

  it('EMPTY-EQ-3: multiple zero-length Text nodes → emptyEquivalent=true', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(''))
    p.appendChild(document.createTextNode(''))
    expect(isEmptyEquivalentParagraph(p)).toBe(true)
  })

  it('EMPTY-EQ-4: <p>Text("a")</p> → emptyEquivalent=false', () => {
    expect(isEmptyEquivalentParagraph(para('a'))).toBe(false)
  })

  it('EMPTY-EQ-5: whitespace-only Text(" ") → emptyEquivalent=false (not widened)', () => {
    expect(isEmptyEquivalentParagraph(para(' '))).toBe(false)
  })

  it('EMPTY-EQ-6: existing SAFE_EMPTY md-plain span → emptyEquivalent=true', () => {
    const p = para('<span md-inline="plain" class="md-plain md-expand"></span>')
    expect(classifyObserverEmptyEquivalent(p).safeEmptyEquivalent).toBe(true)
    expect(isEmptyEquivalentParagraph(p)).toBe(true)
  })

  it('EMPTY-EQ-7: RAF zero-length Text → projectionMode=EMPTY_PADDING', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode(''))
    expect(decideEmptyProjectionMode(isEmptyEquivalentParagraph(p), 'force-indent')).toBe('EMPTY_PADDING')
  })

  it('EMPTY-EQ-8/9: RAF zero-length Text → visual/caret geometry PASS (actual≈32)', () => {
    const g = computeEmptyVisualCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      projectionMode: 'EMPTY_PADDING',
      paragraphRectLeft: 100,
      borderInlineStartWidth: 0,
      paddingInlineStart: 32,
      textIndentPx: 0,
      caretRectLeft: 132,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('EMPTY-EQ-10/11: authorizedCaretWriteCount=0 + FINAL overall=true (COMMITTED path)', () => {
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
    expect(report.authorizedCaretWriteCount).toBe(0)
    expect(report.overall).toBe(true)
  })

  it('EMPTY-EQ-12: FAILURE-PATH controlled-negative commit gate remains valid (ROLLBACK)', () => {
    expect(decideEmptySpecialCommit({
      preCommitVerifyPassed: false,
      canonicalCommitSucceeded: true,
      canonicalOwnerCorrect: true,
    })).toBe('ROLLBACK')
    expect(decideEmptySpecialCommit({
      preCommitVerifyPassed: true,
      canonicalCommitSucceeded: true,
      canonicalOwnerCorrect: true,
    })).toBe('COMMIT')
  })

  it('txn-14→txn-15 shape: normalize → RAF Text("") → EMPTY_PADDING → visual/caret PASS → COMMITTED', () => {
    // Phase 1: token consumed, normalize → native empty
    const p = document.createElement('p')
    document.body.appendChild(p)
    expect(p.childNodes.length).toBe(0)
    expect(isEmptyEquivalentParagraph(p)).toBe(true)

    // Phase 2: simulate Typora re-inserting a zero-length Text node before RAF
    p.appendChild(document.createTextNode(''))

    // Phase 3: AFTER_RAF childNodeCount=1, zero-length text only → still empty
    expect(p.childNodes.length).toBe(1)
    expect(p.textContent).toBe('')
    expect(isEmptyEquivalentParagraph(p)).toBe(true)

    const projectionMode = decideEmptyProjectionMode(isEmptyEquivalentParagraph(p), 'force-indent')
    expect(projectionMode).toBe('EMPTY_PADDING')

    const geometry = computeEmptyVisualCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      projectionMode,
      paragraphRectLeft: 100,
      borderInlineStartWidth: 0,
      paddingInlineStart: 32,
      textIndentPx: 0,
      caretRectLeft: 132,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(geometry.overall).toBe(true)

    const final = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: geometry.overall,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(final.overall).toBe(true)
    expect(final.authorizedCaretWriteCount).toBe(0)
  })
})
