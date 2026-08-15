// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  createParagraphAnchor,
  evaluateHistoricalRehydrateIdentity,
  hashText,
} from './paragraph-layout-store'
import {
  resolveProvenMergeSemantic,
  resolveMergeSemantic,
  resolveMergeWinnerSide,
  computeMergeContentExpectation,
  verifyMergeContent,
} from './paragraph-indent-manager'

function p(text: string): HTMLElement {
  const el = document.createElement('p')
  el.textContent = text
  return el
}

describe('PF5-HIST: historical rehydrate identity isolation', () => {
  it('PF5-HIST-1: stale historical force-flush must not bind a session-born paragraph by text-only match', () => {
    // Historical anchor created in an old neighborhood.
    const oldParas = [p('OLD_PREV'), p('AAAA'), p('OLD_NEXT')]
    const oldAnchor = createParagraphAnchor(1, oldParas)
    // New session document has a same-text paragraph with different neighbors.
    const newParas = [p('NEW_PREV'), p('AAAA'), p('NEW_NEXT')]
    const r = evaluateHistoricalRehydrateIdentity(oldAnchor, 1, newParas)
    expect(r.decision).toBe('REJECT_TEXT_ONLY_COLLISION')
  })

  it('PF5-HIST-2: multiple duplicate-text paragraphs make a historical candidate ambiguous', () => {
    const paras = [p('AAAA'), p('AAAA')]
    const anchor = { lastKnownOrdinal: 0, textHash: hashText('AAAA'), occurrence: 1 }
    const r = evaluateHistoricalRehydrateIdentity(anchor, 0, paras)
    expect(r.decision).toBe('REJECT_AMBIGUOUS_DUPLICATE_TEXT')
    expect(r.duplicateTextCount).toBe(2)
  })

  it('PF5-HIST-3: strong structural identity (neighbor corroboration) still rehydrates', () => {
    const paras = [p('BEFORE'), p('AAAA'), p('AFTER')]
    const anchor = createParagraphAnchor(1, paras)
    const r = evaluateHistoricalRehydrateIdentity(anchor, 1, paras)
    expect(r.decision).toBe('ACCEPT_STRONG_IDENTITY')
    expect(r.neighborCorroborated).toBe(true)
  })

  it('PF5-HIST-4: weak text-only match is rejected (no anchor repair path)', () => {
    const paras = [p('BEFORE'), p('AAAA'), p('AFTER')]
    // Anchor has a beforeHash that does NOT match → structural mismatch.
    const anchor = {
      lastKnownOrdinal: 1,
      textHash: hashText('AAAA'),
      occurrence: 1,
      beforeHash: hashText('WRONG_PREV'),
      afterHash: hashText('AFTER'),
    }
    const r = evaluateHistoricalRehydrateIdentity(anchor, 1, paras)
    expect(r.decision).toBe('REJECT_TEXT_ONLY_COLLISION')
  })

  it('PF5-HIST-5: proven current-live owner signal is distinct from unproven force-* semantic', () => {
    // A force-* semantic WITHOUT a record is not a proven owner; with a record it is.
    expect(resolveProvenMergeSemantic('force-flush', null)).toBe('auto')
    expect(resolveProvenMergeSemantic('force-flush', 'rec-1')).toBe('force-flush')
  })

  it('PF5-HIST-6: session-born paragraph with no strong proof keeps auto (rejected)', () => {
    const oldParas = [p('X'), p('啊啊啊'), p('Y')]
    const staleAnchor = createParagraphAnchor(1, oldParas)
    const newParas = [p('P'), p('啊啊啊'), p('Q')]
    const r = evaluateHistoricalRehydrateIdentity(staleAnchor, 1, newParas)
    expect(r.decision).toBe('REJECT_TEXT_ONLY_COLLISION')
  })

  it('PF5-HIST-7: document reopen with the original paragraph still restores (neighbors intact)', () => {
    const paras = [p('BEFORE'), p('啊啊啊'), p('AFTER')]
    const anchor = createParagraphAnchor(1, paras)
    const r = evaluateHistoricalRehydrateIdentity(anchor, 1, paras)
    expect(r.decision).toBe('ACCEPT_STRONG_IDENTITY')
  })
})

describe('PF5-MERGE: merge explicit owner proof', () => {
  it('PF5-MERGE-1: left proven force-indent + right unproven force-flush + Backspace → left wins', () => {
    const leftProven = resolveProvenMergeSemantic('force-indent', 'rec-left')
    const rightProven = resolveProvenMergeSemantic('force-flush', null)
    expect(leftProven).toBe('force-indent')
    expect(rightProven).toBe('auto')

    const s = resolveMergeSemantic('backspace', leftProven, rightProven)
    expect(s.winner).toBe('force-indent')
    expect(s.reason).toBe('LEFT_EXPLICIT_ONLY')
    expect(s.reason).not.toBe('CONFLICT_BACKSPACE_RIGHT')
  })

  it('PF5-MERGE-2: left unproven force-indent + right proven force-flush → right wins', () => {
    const leftProven = resolveProvenMergeSemantic('force-indent', null)
    const rightProven = resolveProvenMergeSemantic('force-flush', 'rec-right')
    const s = resolveMergeSemantic('backspace', leftProven, rightProven)
    expect(s.winner).toBe('force-flush')
    expect(s.reason).toBe('RIGHT_EXPLICIT_ONLY')
  })

  it('PF5-MERGE-3: both proven explicit conflict — Delete left wins, Backspace right wins', () => {
    expect(resolveMergeSemantic('delete', 'force-indent', 'force-flush').winner).toBe('force-indent')
    expect(resolveMergeSemantic('backspace', 'force-indent', 'force-flush').winner).toBe('force-flush')
  })

  it('PF5-MERGE-4: both force-* but neither has canonical proof → not an explicit conflict', () => {
    const l = resolveProvenMergeSemantic('force-indent', null)
    const r = resolveProvenMergeSemantic('force-flush', null)
    const s = resolveMergeSemantic('delete', l, r)
    expect(s.winner).toBe('auto')
    expect(s.reason).toBe('BOTH_AUTO')
  })

  it('PF5-MERGE-5: single proven explicit + other auto → proven explicit wins', () => {
    const l = resolveProvenMergeSemantic('force-indent', 'rec')
    const r = resolveProvenMergeSemantic('auto', null)
    expect(resolveMergeSemantic('delete', l, r).winner).toBe('force-indent')
  })

  it('PF5-MERGE-6: single proven explicit + contaminated force-* (no record) → proven wins', () => {
    const l = resolveProvenMergeSemantic('force-indent', 'rec')
    const r = resolveProvenMergeSemantic('force-flush', null)
    const s = resolveMergeSemantic('backspace', l, r)
    expect(s.winner).toBe('force-indent')
    expect(s.reason).toBe('LEFT_EXPLICIT_ONLY')
  })

  it('PF5-MERGE-7: winner resolution is unambiguous (single non-none winner side)', () => {
    const reasons = [
      resolveMergeSemantic('backspace', resolveProvenMergeSemantic('force-indent', 'rec'), resolveProvenMergeSemantic('force-flush', null)).reason,
      resolveMergeSemantic('delete', resolveProvenMergeSemantic('force-indent', 'rec'), resolveProvenMergeSemantic('force-flush', 'rec2')).reason,
      resolveMergeSemantic('backspace', resolveProvenMergeSemantic('force-indent', 'rec'), resolveProvenMergeSemantic('force-flush', 'rec2')).reason,
    ]
    for (const r of reasons) {
      expect(resolveMergeWinnerSide(r)).not.toBe('none')
    }
  })

  it('PF5-MERGE-8: loser retirement only applies to a proven canonical loser', () => {
    // Unproven right force-flush → no conflict, no right loser record.
    const s = resolveMergeSemantic('backspace', 'force-indent', resolveProvenMergeSemantic('force-flush', null))
    expect(s.reason).toBe('LEFT_EXPLICIT_ONLY')
    expect(resolveMergeWinnerSide(s.reason)).toBe('left')
    // A genuine dual-proven conflict does produce a right loser.
    const conflict = resolveMergeSemantic('backspace', 'force-indent', 'force-flush')
    expect(resolveMergeWinnerSide(conflict.reason)).toBe('right')
  })
})

describe('PF5-REGRESSION-REAL-1: full failure chain replay', () => {
  it('historical collision rejected + left proven force-indent wins Backspace merge', () => {
    // 1. Stale historical force-flush record with text "啊啊啊" and old neighbors.
    const oldParas = [p('OLD_A'), p('啊啊啊'), p('OLD_B')]
    const staleAnchor = createParagraphAnchor(1, oldParas)

    // 2. Current session: new paragraph "啊啊啊" with different neighbors.
    const newParas = [p('NEW_A'), p('啊啊啊'), p('NEW_B')]
    const hist = evaluateHistoricalRehydrateIdentity(staleAnchor, 1, newParas)
    expect(hist.decision).toBe('REJECT_TEXT_ONLY_COLLISION')

    // 3. Left current-live force-indent + right (would-be auto) → Backspace merge.
    const leftProven = resolveProvenMergeSemantic('force-indent', 'rec-left')
    const rightProven = resolveProvenMergeSemantic('auto', null)
    const merge = resolveMergeSemantic('backspace', leftProven, rightProven)
    expect(merge.winner).toBe('force-indent')
    expect(merge.reason).not.toBe('CONFLICT_BACKSPACE_RIGHT')

    // 4. Content preserved.
    const e = computeMergeContentExpectation('啊啊啊', '文本')
    const v = verifyMergeContent(e.expectedMergedText, '啊啊啊文本', e.expectedCaretOffset)
    expect(v.preserved).toBe(true)
  })
})
