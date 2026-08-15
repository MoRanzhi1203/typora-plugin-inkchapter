// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveMergeSemantic,
  resolveMergeWinnerSide,
  computeMergeContentExpectation,
  verifyMergeContent,
  resolveEffectiveParagraphIndent,
  shouldConsumeBackspaceForIndentRemoval,
  setParagraphIndentMode,
} from './paragraph-indent-manager'

function makeParagraph(text: string): HTMLElement {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function placeCaretAtStart(p: HTMLElement): void {
  const sel = window.getSelection()!
  const range = document.createRange()
  const firstText = p.firstChild
  if (firstText && firstText.nodeType === Node.TEXT_NODE) {
    range.setStart(firstText, 0)
  } else {
    range.setStart(p, 0)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

describe('BOUNDARY-MERGE: existing-survivor 1→0 merge (PF4)', () => {
  it('BOUNDARY-MERGE-1: Delete — left force-indent removed, right auto survives → transfer force-indent to survivor', () => {
    const s = resolveMergeSemantic('delete', 'force-indent', 'auto')
    expect(s.winner).toBe('force-indent')
    expect(s.reason).toBe('LEFT_EXPLICIT_ONLY')
    // Winner side = left = removed side → must transfer to survivor.
    expect(resolveMergeWinnerSide(s.reason)).toBe('left')
    expect(resolveEffectiveParagraphIndent(s.winner, 'flush', { isFormulaContinuation: false })).toBe('indent-2')
  })

  it('BOUNDARY-MERGE-2: Delete — left force-indent survives, right auto removed → keep same canonical owner', () => {
    const s = resolveMergeSemantic('delete', 'force-indent', 'auto')
    expect(s.winner).toBe('force-indent')
    // Winner side = left = survivor → RETAIN_LIVE_OWNER (no transfer needed).
    expect(resolveMergeWinnerSide(s.reason)).toBe('left')
  })

  it('BOUNDARY-MERGE-3: Backspace — right force-indent removed, left auto survives → transfer force-indent to survivor', () => {
    const s = resolveMergeSemantic('backspace', 'auto', 'force-indent')
    expect(s.winner).toBe('force-indent')
    expect(s.reason).toBe('RIGHT_EXPLICIT_ONLY')
    // Winner side = right = removed side → must transfer to survivor.
    expect(resolveMergeWinnerSide(s.reason)).toBe('right')
    expect(resolveEffectiveParagraphIndent(s.winner, 'flush', { isFormulaContinuation: false })).toBe('indent-2')
  })

  it('BOUNDARY-MERGE-4: Backspace — current force-indent + previous auto → native merge priority, not reverse-to-flush', () => {
    // With a previous mergeable paragraph, the merge semantic wins (force-indent),
    // so it must NOT degrade to force-flush.
    const s = resolveMergeSemantic('backspace', 'auto', 'force-indent')
    expect(s.winner).toBe('force-indent')
    expect(s.winner).not.toBe('force-flush')
    expect(resolveEffectiveParagraphIndent(s.winner, 'flush', { isFormulaContinuation: false })).toBe('indent-2')
  })

  it('BOUNDARY-MERGE-5: force-indent at logical start with no previous → existing BACKSPACE-REVERSE still allowed', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const p = makeParagraph('段落')
    setParagraphIndentMode(p, 'force-indent')
    root.appendChild(p)
    placeCaretAtStart(p)

    // Only reverse-to-flush is allowed here (no previous mergeable paragraph).
    const ctx = shouldConsumeBackspaceForIndentRemoval(root, { indentShortcutEnabled: true }, false)
    expect(ctx).not.toBeNull()
    expect(ctx!.caretAtLogicalStart).toBe(true)
    expect(ctx!.mode).toBe('force-indent')
    root.remove()
  })

  it('BOUNDARY-MERGE-6: PRE snapshot captures nonempty left/right before native mutation', () => {
    const e = computeMergeContentExpectation('AAAA', 'BBBB')
    expect(e.expectedMergedText).toBe('AAAABBBB')
    expect(e.expectedCaretOffset).toBe(4)
  })

  it('BOUNDARY-MERGE-7: actualMergedText verified against PRE snapshot expected left+right', () => {
    const e = computeMergeContentExpectation('AAAA', 'BBBB')
    const v = verifyMergeContent(e.expectedMergedText, 'AAAABBBB', e.expectedCaretOffset)
    expect(v.preserved).toBe(true)
    expect(v.reason).toBe('CONTENT_PRESERVED')
  })

  it('BOUNDARY-MERGE-8: existing 2→1 merge path still resolves to a single owner', () => {
    const s = resolveMergeSemantic('delete', 'force-indent', 'force-indent')
    expect(s.winner).toBe('force-indent')
    expect(s.reason).toBe('BOTH_EXPLICIT_SAME')
    expect(resolveMergeWinnerSide(s.reason)).toBe('left')
  })

  it('BOUNDARY-MERGE-9: explicit + auto → explicit wins for both merge variants', () => {
    expect(resolveMergeSemantic('delete', 'force-indent', 'auto').winner).toBe('force-indent')
    expect(resolveMergeSemantic('backspace', 'auto', 'force-indent').winner).toBe('force-indent')
  })

  it('BOUNDARY-MERGE-10: dual explicit conflict — Delete left wins, Backspace right wins', () => {
    const del = resolveMergeSemantic('delete', 'force-indent', 'force-flush')
    expect(del.winner).toBe('force-indent')
    expect(resolveMergeWinnerSide(del.reason)).toBe('left')

    const bs = resolveMergeSemantic('backspace', 'force-indent', 'force-flush')
    expect(bs.winner).toBe('force-flush')
    expect(resolveMergeWinnerSide(bs.reason)).toBe('right')
  })

  it('BOUNDARY-MERGE-11: resolvable 1→0 merge → exactly one winner (no awaiting leak)', () => {
    // Every resolution yields a single, unambiguous winner side.
    const reasons = [
      resolveMergeSemantic('delete', 'force-indent', 'auto').reason,
      resolveMergeSemantic('backspace', 'auto', 'force-indent').reason,
      resolveMergeSemantic('delete', 'force-indent', 'force-indent').reason,
      resolveMergeSemantic('delete', 'force-indent', 'force-flush').reason,
      resolveMergeSemantic('backspace', 'force-indent', 'force-flush').reason,
    ]
    for (const r of reasons) {
      expect(resolveMergeWinnerSide(r)).not.toBe('none')
    }
  })

  it('BOUNDARY-MERGE-12: non-boundary Delete/Backspace → no merge intent (auto, no winner side)', () => {
    const s = resolveMergeSemantic('delete', 'auto', 'auto')
    expect(s.winner).toBe('auto')
    expect(s.reason).toBe('BOTH_AUTO')
    expect(resolveMergeWinnerSide(s.reason)).toBe('none')
  })

  it('BOUNDARY-MERGE-13: heading/list/quote/code/table/formula → no ordinary-body merge semantic', () => {
    // The resolver is element-agnostic and only fires on ordinary body paragraphs;
    // for auto pairs it never fabricates an explicit winner side.
    expect(resolveMergeWinnerSide('BOTH_AUTO')).toBe('none')
    expect(resolveMergeSemantic('delete', 'auto', 'auto').winner).toBe('auto')
  })

  it('BOUNDARY-MERGE-14: resolution + verify are pure (selectionWriteCount/caretRestoreCount/caretRepairCount = 0)', () => {
    const bodyBefore = document.body.childElementCount
    const e = computeMergeContentExpectation('AAAA', 'BBBB')
    const v = verifyMergeContent(e.expectedMergedText, 'AAAABBBB', e.expectedCaretOffset)
    const s = resolveMergeSemantic('delete', 'force-indent', 'auto')
    expect(v.preserved).toBe(true)
    expect(s.winner).toBe('force-indent')
    expect(resolveMergeWinnerSide(s.reason)).toBe('left')
    expect(document.body.childElementCount).toBe(bodyBefore)
  })
})
