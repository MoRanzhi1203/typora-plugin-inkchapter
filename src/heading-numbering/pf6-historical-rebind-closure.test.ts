// @vitest-environment jsdom
/**
 * PF6 — Historical Empty-Paragraph Indent Rebinding Closure.
 *
 * Failure being locked down (app-1793310238729.log, 21:43:36–21:43:43):
 *   NORMAL-ENTER-POST creates a fresh empty paragraph with semantic=auto,
 *   then REHYDRATE-APPLY re-binds a HISTORICAL sidecar record
 *   (`indent-1793304479550-0`, MATCH-NORMALIZED-ANCHOR) onto that NEW empty
 *   paragraph and flips it to force-indent. The same record then re-binds to
 *   every subsequent new empty paragraph (P-RUNTIME-36/40/42/45/49).
 *
 * Root cause: an anchor that has NO textHash describes an EMPTY paragraph.
 * Two different empty paragraphs between the same neighbours are
 * indistinguishable, so neighbour corroboration is NOT an identity proof.
 * A historical record must fail closed unless it can prove ownership of the
 * current paragraph (exact business-text identity, a live canonical binding,
 * or a controlled Undo recovery tied to this session's explicit deletion).
 */
import { describe, it, expect } from 'vitest'
import { createParagraphAnchor, hashText, type ParagraphIndentOverrideRecord } from './paragraph-layout-store'
import {
  evaluateHistoricalRehydrateAdmission,
  selectTemporaryHistoricalRecordsForRetirement,
  SessionRetiredIndentLedger,
  HISTORY_UNDO_CLAIM_WINDOW_MS,
} from './paragraph-rehydrate-ownership'

function p(text: string): HTMLElement {
  const el = document.createElement('p')
  el.textContent = text
  return el
}

function tempRecord(id: string, anchor: ParagraphIndentOverrideRecord['anchor']): ParagraphIndentOverrideRecord {
  return { id, mode: 'force-indent', anchor, temporary: true }
}

function stableRecord(id: string, anchor: ParagraphIndentOverrideRecord['anchor']): ParagraphIndentOverrideRecord {
  return { id, mode: 'force-indent', anchor, temporary: false }
}

describe('PF6-ADMISSION: historical record admission', () => {
  it('PF6-A1: temporary empty-target record must NOT bind a freshly created empty paragraph (the reported bug)', () => {
    // Document: 甲段正文 / [new empty paragraph] / 乙段正文
    const paras = [p('甲段正文'), p(''), p('乙段正文')]
    // The stale record was created for an empty paragraph between the SAME neighbours.
    const stale = tempRecord('indent-1793304479550-0', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('甲段正文'),
      afterHash: hashText('乙段正文'),
    })

    const r = evaluateHistoricalRehydrateAdmission({
      record: stale,
      resolvedConfidence: 'high', // MATCH-NORMALIZED-ANCHOR
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'LIVE_EDIT',
    })

    expect(r.admitted).toBe(false)
    expect(r.decision).toBe('REJECT_TEMPORARY_HISTORICAL')
  })

  it('PF6-A1b: temporary record survives INITIAL_LOAD through its unique empty structural slot', () => {
    const paras = [p('甲段正文'), p(''), p('乙段正文')]
    const record = tempRecord('indent-persist', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('甲段正文'),
      afterHash: hashText('乙段正文'),
    })
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'INITIAL_LOAD',
    })
    expect(r.admitted).toBe(true)
    expect(r.decision).toBe('ADMIT_TEMPORARY_EMPTY_STRUCTURAL')
    expect(r.resolvedIndexOverride).toBe(1)
  })

  it('PF6-A1c: temporary record is rejected when its empty slot is gone or ambiguous', () => {
    const deleted = tempRecord('indent-deleted', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('甲段正文'),
      afterHash: hashText('乙段正文'),
    })
    const body = [p('甲段正文'), p('乙段正文')]
    expect(evaluateHistoricalRehydrateAdmission({
      record: deleted,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: body,
      phase: 'INITIAL_LOAD',
    }).admitted).toBe(false)

    // Two identical gaps -> the same anchor matches two empty paragraphs.
    const ambiguous = [
      p('甲段正文'), p(''), p('乙段正文'),
      p('甲段正文'), p(''), p('乙段正文'),
    ]
    const twoSided = tempRecord('indent-two', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('甲段正文'),
      afterHash: hashText('乙段正文'),
    })
    expect(evaluateHistoricalRehydrateAdmission({
      record: twoSided,
      resolvedConfidence: 'fallback',
      resolvedIndex: 1,
      allParagraphs: ambiguous,
      phase: 'INITIAL_LOAD',
    }).admitted).toBe(false)
  })

  it('PF6-A2: an empty target has no business identity — even a non-temporary record fails closed', () => {
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    const record = stableRecord('rec-empty', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
    })
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'INITIAL_LOAD',
    })
    expect(r.admitted).toBe(false)
    expect(r.decision).toBe('REJECT_EMPTY_TARGET')
  })

  it('PF6-A3: initial load restores a business paragraph with exact text identity', () => {
    const paras = [p('BEFORE'), p('正文段落'), p('AFTER')]
    const record = stableRecord('rec-body', createParagraphAnchor(1, paras))
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'exact',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'INITIAL_LOAD',
    })
    expect(r.admitted).toBe(true)
    expect(r.decision).toBe('ADMIT_EXACT_TEXT_IDENTITY')
  })

  it('PF6-A4: live editing requires exact business-text identity (neighbour-only is rejected)', () => {
    const paras = [p('BEFORE'), p('正文段落'), p('AFTER')]
    const anchor = createParagraphAnchor(1, paras)
    const record = stableRecord('rec-body', anchor)
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'LIVE_EDIT',
    })
    expect(r.admitted).toBe(false)
    expect(r.decision).toBe('REJECT_NON_EXACT_IDENTITY')
  })

  it('PF6-A5: initial load may restore a paragraph whose text changed when both neighbours still corroborate', () => {
    const oldParas = [p('BEFORE'), p('旧文本'), p('AFTER')]
    const anchor = createParagraphAnchor(1, oldParas)
    const record = stableRecord('rec-edited', anchor)
    const newParas = [p('BEFORE'), p('新文本'), p('AFTER')]
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: newParas,
      phase: 'INITIAL_LOAD',
    })
    expect(r.admitted).toBe(true)
    expect(r.decision).toBe('ADMIT_INITIAL_LOAD_STRUCTURAL')
  })

  it('PF6-A6: anchor without any text identity is rejected', () => {
    const paras = [p('BEFORE'), p('正文段落'), p('AFTER')]
    const record = stableRecord('rec-no-text', { lastKnownOrdinal: 1 })
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'fallback',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'INITIAL_LOAD',
    })
    expect(r.admitted).toBe(false)
    expect(r.decision).toBe('REJECT_NO_TEXT_IDENTITY')
  })

  it('PF6-A7: controlled Undo recovery is the only way an empty target regains its indent', () => {
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    const record = tempRecord('rec-undo', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
    })
    const r = evaluateHistoricalRehydrateAdmission({
      record,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'UNDO_REDO',
      undoRecoveryProof: true,
    })
    expect(r.admitted).toBe(true)
    expect(r.decision).toBe('ADMIT_UNDO_RECOVERY')
  })
})

describe('PF6-SIDECAR: temporary historical retirement', () => {
  it('PF6-S1: only temporary (empty-target) records are retired; business records are preserved', () => {
    const records: ParagraphIndentOverrideRecord[] = [
      tempRecord('indent-1793304479550-0', { lastKnownOrdinal: 1 }),
      tempRecord('indent-1793310577316-12', { lastKnownOrdinal: 2 }),
      stableRecord('indent-1793306276727-2', {
        lastKnownOrdinal: 2,
        textHash: hashText('正文'),
        occurrence: 1,
      }),
    ]
    const ids = selectTemporaryHistoricalRecordsForRetirement(records)
    expect(ids).toEqual(['indent-1793304479550-0', 'indent-1793310577316-12'])
  })

  it('PF6-S2: with a document view, a unique empty slot is kept; a vanished/ambiguous one is retired', () => {
    const kept = tempRecord('kept', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
    })
    const vanished = tempRecord('vanished', {
      lastKnownOrdinal: 2,
      beforeHash: hashText('MISSING-BEFORE'),
    })
    const paras = [p('BEFORE'), p(''), p('AFTER'), p('X'), p(''), p('Y')]
    expect(selectTemporaryHistoricalRecordsForRetirement([kept, vanished], paras))
      .toEqual(['vanished'])

    // Two identical gaps -> the same anchor matches two empty paragraphs.
    const duplicateGap = [
      p('BEFORE'), p(''), p('AFTER'),
      p('BEFORE'), p(''), p('AFTER'),
    ]
    const ambiguous = tempRecord('ambiguous', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
    })
    expect(selectTemporaryHistoricalRecordsForRetirement([ambiguous], duplicateGap))
      .toEqual(['ambiguous'])
  })
})

describe('PF6-LEDGER: session-scoped controlled recovery', () => {
  it('PF6-L1: a new empty paragraph at the same gap is NOT claimed without an Undo intent', () => {
    const ledger = new SessionRetiredIndentLedger()
    ledger.retire({
      recordId: 'rec-1',
      record: tempRecord('rec-1', { lastKnownOrdinal: 1 }),
      documentKey: 'doc',
      ordinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
      targetWasEmpty: true,
      deletedAt: Date.now(),
    })
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    expect(ledger.claimUndoRecovery('doc', paras, Date.now() + 100)).toBeNull()
  })

  it('PF6-L2: Undo claims the disposed record exactly once', () => {
    const ledger = new SessionRetiredIndentLedger()
    const now = Date.now()
    ledger.retire({
      recordId: 'rec-1',
      record: tempRecord('rec-1', { lastKnownOrdinal: 1 }),
      documentKey: 'doc',
      ordinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
      targetWasEmpty: true,
      deletedAt: now,
    })
    ledger.noteHistoryIntent('undo', now + 10)
    const paras = [p('BEFORE'), p(''), p('AFTER')]

    const first = ledger.claimUndoRecovery('doc', paras, now + 50)
    expect(first?.entry.recordId).toBe('rec-1')
    expect(first?.matchedIndex).toBe(1)
    expect(ledger.claimUndoRecovery('doc', paras, now + 60)).toBeNull()
  })

  it('PF6-L3: Undo claim expires outside the history window', () => {
    const ledger = new SessionRetiredIndentLedger()
    const now = Date.now()
    ledger.retire({
      recordId: 'rec-1',
      record: tempRecord('rec-1', { lastKnownOrdinal: 1 }),
      documentKey: 'doc',
      ordinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
      targetWasEmpty: true,
      deletedAt: now,
    })
    ledger.noteHistoryIntent('undo', now)
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    expect(ledger.claimUndoRecovery('doc', paras, now + HISTORY_UNDO_CLAIM_WINDOW_MS + 1)).toBeNull()
  })

  it('PF6-L4: a fresh content edit invalidates a pending Undo claim', () => {
    const ledger = new SessionRetiredIndentLedger()
    const now = Date.now()
    ledger.retire({
      recordId: 'rec-1',
      record: tempRecord('rec-1', { lastKnownOrdinal: 1 }),
      documentKey: 'doc',
      ordinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
      targetWasEmpty: true,
      deletedAt: now,
    })
    ledger.noteHistoryIntent('undo', now + 5)
    ledger.invalidateOnContentEdit(now + 5_000)
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    expect(ledger.claimUndoRecovery('doc', paras, now + 10)).toBeNull()
  })

  it('PF6-L5: the synthetic beforeinput produced BY the Undo must not cancel the claim', () => {
    // Undo replays the deletion natively, emitting a beforeinput whose inputType
    // is `deleteContentBackward` (classified as Backspace). That is not a NEW
    // user edit and must not invalidate the just-recorded Undo intent.
    const ledger = new SessionRetiredIndentLedger()
    const now = Date.now()
    ledger.retire({
      recordId: 'rec-1',
      record: tempRecord('rec-1', { lastKnownOrdinal: 1 }),
      documentKey: 'doc',
      ordinal: 1,
      beforeHash: hashText('BEFORE'),
      afterHash: hashText('AFTER'),
      targetWasEmpty: true,
      deletedAt: now,
    })
    ledger.noteHistoryIntent('undo', now + 5)
    ledger.invalidateOnContentEdit(now + 120)
    const paras = [p('BEFORE'), p(''), p('AFTER')]
    expect(ledger.claimUndoRecovery('doc', paras, now + 200)?.entry.recordId).toBe('rec-1')
  })
})

describe('PF6-REPLAY: the reported Enter/Rehydrate sequence', () => {
  it('PF6-R1: a temporary empty record persists on INITIAL_LOAD but never during live editing', () => {
    // 1. Document state after Enter (fresh empty paragraph in the middle).
    const paras = [p('甲段正文'), p(''), p('乙段正文')]

    // 2. Sidecar still holds the record created by an earlier session.
    const historical = tempRecord('indent-1793304479550-0', {
      lastKnownOrdinal: 1,
      beforeHash: hashText('甲段正文'),
      afterHash: hashText('乙段正文'),
    })

    // 3. INITIAL_LOAD re-admits through the unique empty structural slot.
    const initial = evaluateHistoricalRehydrateAdmission({
      record: historical,
      resolvedConfidence: 'high',
      resolvedIndex: 1,
      allParagraphs: paras,
      phase: 'INITIAL_LOAD',
    })
    expect(initial.admitted).toBe(true)
    expect(initial.decision).toBe('ADMIT_TEMPORARY_EMPTY_STRUCTURAL')

    // 4. Live editing / history replay never re-admit a temporary record.
    for (const phase of ['LIVE_EDIT', 'UNDO_REDO'] as const) {
      const r = evaluateHistoricalRehydrateAdmission({
        record: historical,
        resolvedConfidence: 'high',
        resolvedIndex: 1,
        allParagraphs: paras,
        phase,
      })
      expect(r.admitted).toBe(false)
    }

    // 5. With the document view the surviving slot keeps the record; the legacy
    //    caller without a document view still retires it (fail closed).
    expect(selectTemporaryHistoricalRecordsForRetirement([historical], paras)).toEqual([])
    expect(selectTemporaryHistoricalRecordsForRetirement([historical])).toEqual([historical.id])
  })
})
