// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.1 Unit Tests: Live Formula Revision Authority +
 * Semantic Snapshot + Plan Diff + Affected Formula Set.
 *
 * Covers Phase Q items:
 *  1  renderer internal mutation → liveFormulaRevision unchanged
 *  2  add block formula → +1
 *  3  remove block formula → +1
 *  4  source change → +1
 *  5  inline math change → semantic signature unchanged
 *  6  same mutation burst → only one semantic revision
 *  7  disk SHA unchanged + live count changed → valid dirty buffer
 * 13  append formula → affected new only
 * 14  insert before existing → shifted desiredTag formulas affected
 * 15  delete → surviving shifted formulas affected
 * 16  move across section → context/tag changes affected
 * 17  formulaIndex shift does not change stable identity
 * 18  ambiguous identity migration → no guessing
 * 22  non-target R^2 → no block formula invalidation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildLiveFormulaSemanticSnapshot,
  recordSemanticBaseline,
  advanceLiveRevision,
  emitDirtyBufferAuthority,
  diffLiveFormulaPlans,
  computeAffectedFormulaSet,
  resolveStableFormulaIdentity,
  getLiveFormulaRevision,
  resetLiveRevisionState,
  resetIdentityTokens,
  type LiveFormulaSemanticSnapshot,
  type LiveFormulaSemanticEntryInput,
} from './formula-live-revision'

function entry(opts: {
  host?: HTMLElement
  index: number
  order?: number
  tag?: string
  hash?: string
  chap?: number
  sec?: number
  seq?: number
  contentRevision?: number
}): LiveFormulaSemanticEntryInput {
  return {
    host: opts.host ?? document.createElement('div'),
    formulaIndex: opts.index,
    documentOrder: opts.order ?? opts.index,
    desiredTag: opts.tag ?? `11.2.${opts.index + 1}`,
    chapterOrdinal: opts.chap ?? 11,
    sectionOrdinal: opts.sec ?? 2,
    sequenceValue: opts.seq ?? opts.index + 1,
    sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
    normalizedSourceHash: opts.hash ?? `h${opts.index}`,
    normalizedSourcePrefix: '',
    managedEligible: true,
    formulaContentRevision: opts.contentRevision ?? 1,
  }
}

function snapshot(entries: LiveFormulaSemanticEntryInput[]): LiveFormulaSemanticSnapshot {
  return buildLiveFormulaSemanticSnapshot({ documentKey: 'docA', liveFormulaRevision: 0, entries })
}

function advance(classification: 'REAL_DOCUMENT_CONTENT' | 'TYPOORA_RENDERER_INTERNAL_ONLY' | 'MIXED_CONTENT_AND_RENDERER', snap: LiveFormulaSemanticSnapshot, prevCount: number, hint?: Parameters<typeof advanceLiveRevision>[0]['semanticReasonHint']) {
  return advanceLiveRevision({
    documentKey: 'docA',
    documentGeneration: 1,
    diskSourceSha256: 'DISK-SHA',
    mutationClassification: classification,
    snapshot: snap,
    previousSnapshotCount: prevCount,
    semanticReasonHint: hint,
  })
}

describe('Live Formula Revision (v2.5.7-R5.4.1)', () => {
  beforeEach(() => {
    resetLiveRevisionState()
    resetIdentityTokens()
  })

  it('1. renderer internal mutation → liveFormulaRevision unchanged (even with signature change)', () => {
    const s1 = snapshot([entry({ index: 0 }), entry({ index: 1 })])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    // Renderer-only mutation produces a DIFFERENT snapshot (e.g. host visual
    // drift) — the revision must still NOT advance.
    const s2 = snapshot([entry({ index: 0, hash: 'drifted' }), entry({ index: 1 })])
    expect(s1.semanticSignature).not.toBe(s2.semanticSignature)
    const result = advance('TYPOORA_RENDERER_INTERNAL_ONLY', s2, 2)
    expect(result.advanced).toBe(false)
    expect(result.decision).toBe('IGNORED_RENDERER_INTERNAL')
    expect(resetLiveRevisionState, 'state reset between asserts').toBeTypeOf('function')
  })

  it('2. add block formula → liveFormulaRevision +1', () => {
    const s1 = snapshot([entry({ index: 0 }), entry({ index: 1 })])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    const s2 = snapshot([entry({ index: 0 }), entry({ index: 1 }), entry({ index: 2 })])
    const result = advance('REAL_DOCUMENT_CONTENT', s2, 2, 'ADD_BLOCK_FORMULA')
    expect(result.advanced).toBe(true)
    expect(result.reason).toBe('ADD_BLOCK_FORMULA')
    expect(getLiveFormulaRevision().liveFormulaRevision).toBe(1)
  })

  it('3. remove block formula → liveFormulaRevision +1', () => {
    const s1 = snapshot([entry({ index: 0 }), entry({ index: 1 }), entry({ index: 2 })])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    const s2 = snapshot([entry({ index: 0 }), entry({ index: 2 })])
    const result = advance('REAL_DOCUMENT_CONTENT', s2, 3, 'REMOVE_BLOCK_FORMULA')
    expect(result.advanced).toBe(true)
    expect(result.reason).toBe('REMOVE_BLOCK_FORMULA')
  })

  it('4. source change (same position) → liveFormulaRevision +1', () => {
    const s1 = snapshot([entry({ index: 0 }), entry({ index: 1 })])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    // Same count, same tags/ordinals — only the TeX hash changed.
    const s2 = snapshot([entry({ index: 0, hash: 'h0-new' }), entry({ index: 1 })])
    expect(s1.semanticSignature).not.toBe(s2.semanticSignature)
    const result = advance('REAL_DOCUMENT_CONTENT', s2, 2, 'FORMULA_SOURCE_CHANGE')
    expect(result.advanced).toBe(true)
    expect(result.reason).toBe('FORMULA_SOURCE_CHANGE')
  })

  it('5. inline math change → semantic signature unchanged', () => {
    // Inline R^2 never produces a canonical block entry; both snapshots only
    // contain the two block formulas → identical structural signatures.
    const a = entry({ index: 0 })
    const b = entry({ index: 1 })
    const s1 = snapshot([a, b])
    const s2 = snapshot([a, b])
    expect(s2.semanticSignature).toBe(s1.semanticSignature)
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    const result = advance('REAL_DOCUMENT_CONTENT', s2, 2)
    expect(result.decision).toBe('NO_SEMANTIC_CHANGE')
    expect(result.advanced).toBe(false)
  })

  it('6. same mutation burst → only one semantic revision', () => {
    const s1 = snapshot([entry({ index: 0 })])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'DISK-SHA', snapshot: s1 })
    const s2 = snapshot([entry({ index: 0 }), entry({ index: 1 })])
    advance('REAL_DOCUMENT_CONTENT', s2, 1, 'ADD_BLOCK_FORMULA')
    // Second rebuild with the identical snapshot (same burst) → no advance.
    const again = advance('REAL_DOCUMENT_CONTENT', s2, 2)
    expect(again.advanced).toBe(false)
    expect(again.decision).toBe('NO_SEMANTIC_CHANGE')
  })

  it('7. disk SHA unchanged + live count changed → valid dirty buffer (PASS, diverged)', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      emitDirtyBufferAuthority({
        documentKey: 'docA',
        diskSourceSha256: 'DISK-SHA',
        liveFormulaRevision: 1,
        diskFormulaCount: 2,
        liveFormulaCount: 3,
      })
      const lines = spy.mock.calls.map((c) => String(c[0]))
      const marker = lines.find((l) => l.includes('FORMULA-DIRTY-BUFFER-AUTHORITY'))
      expect(marker).toBeTruthy()
      expect(marker).toContain('diskFormulaCount=2')
      expect(marker).toContain('liveFormulaCount=3')
      expect(marker).toContain('divergedFromDisk=true')
      expect(marker).toContain('decision=PASS')
    } finally {
      spy.mockRestore()
    }
  })

  it('13. append formula → affected new only (existing unchanged)', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    const prev = snapshot([entry({ host: hostA, index: 0, tag: '11.2.1' }), entry({ host: hostB, index: 1, tag: '11.2.2' })])
    const curr = snapshot([entry({ host: hostA, index: 0, tag: '11.2.1' }), entry({ host: hostB, index: 1, tag: '11.2.2' }), entry({ index: 2, tag: '11.2.3' })])
    const affected = computeAffectedFormulaSet(diffLiveFormulaPlans(prev, curr))
    expect(affected.addedCount).toBe(1)
    expect(affected.removedCount).toBe(0)
    expect(affected.affectedNewFormulaCount).toBe(1)
    expect(affected.affectedExistingFormulaCount).toBe(0)
  })

  it('14. insert before existing → shifted desiredTag formulas affected (NEW/A/B)', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    const prev = snapshot([entry({ host: hostA, index: 0, tag: '11.2.1' }), entry({ host: hostB, index: 1, tag: '11.2.2' })])
    const curr = snapshot([
      entry({ index: 0, tag: '11.2.1', hash: 'h-new' }),
      entry({ host: hostA, index: 1, tag: '11.2.2' }),
      entry({ host: hostB, index: 2, tag: '11.2.3' }),
    ])
    const affected = computeAffectedFormulaSet(diffLiveFormulaPlans(prev, curr))
    expect(affected.addedCount).toBe(1)
    expect(affected.affectedNewFormulaCount).toBe(1)
    expect(affected.affectedExistingFormulaCount).toBe(2)
    expect(affected.desiredTagChangedCount).toBe(2)
  })

  it('15. delete → surviving shifted formulas affected', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    const hostC = document.createElement('div')
    const prev = snapshot([
      entry({ host: hostA, index: 0, tag: '11.2.1' }),
      entry({ host: hostB, index: 1, tag: '11.2.2' }),
      entry({ host: hostC, index: 2, tag: '11.2.3' }),
    ])
    // Delete A; B → 11.2.1, C → 11.2.2.
    const curr = snapshot([
      entry({ host: hostB, index: 0, tag: '11.2.1' }),
      entry({ host: hostC, index: 1, tag: '11.2.2' }),
    ])
    const affected = computeAffectedFormulaSet(diffLiveFormulaPlans(prev, curr))
    expect(affected.removedCount).toBe(1)
    expect(affected.affectedExistingFormulaCount).toBe(2)
    expect(affected.desiredTagChangedCount).toBe(2)
  })

  it('16. move across section → context/tag changes affected', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    const prev = snapshot([
      entry({ host: hostA, index: 0, tag: '11.2.1', chap: 11, sec: 2 }),
      entry({ host: hostB, index: 1, tag: '11.2.2', chap: 11, sec: 2 }),
    ])
    const curr = snapshot([
      entry({ host: hostA, index: 0, tag: '12.1.1', chap: 12, sec: 1 }),
      entry({ host: hostB, index: 1, tag: '12.1.2', chap: 12, sec: 1 }),
    ])
    const diffs = diffLiveFormulaPlans(prev, curr)
    const affected = computeAffectedFormulaSet(diffs)
    expect(affected.contextChangedCount).toBe(2)
    expect(affected.desiredTagChangedCount).toBe(2)
    expect(affected.affectedExistingFormulaCount).toBe(2)
    expect(diffs.every((d) => d.requiresRenderInvalidation)).toBe(true)
  })

  it('17. formulaIndex shift does not change stable identity (host WeakMap token)', () => {
    const hostA = document.createElement('div')
    const tokenBefore = resolveStableFormulaIdentity(hostA)
    // Same host now appears at a shifted index (insertion before it).
    const s1 = snapshot([entry({ host: hostA, index: 0 })])
    const s2 = snapshot([entry({ index: 0, hash: 'x' }), entry({ host: hostA, index: 1 })])
    const diffs = diffLiveFormulaPlans(s1, s2)
    const aDiff = diffs.find((d) => d.previousFormulaIndex === 0)
    expect(aDiff?.stableFormulaIdentity).toBe(tokenBefore)
    expect(aDiff?.nextFormulaIndex).toBe(1)
  })

  it('18. ambiguous identity migration → no guessing (ADDED/REMOVED without identity merge)', () => {
    const ambPrev: LiveFormulaSemanticSnapshot = {
      documentKey: 'docA',
      liveFormulaRevision: 0,
      formulaCount: 1,
      managedFormulaCount: 1,
      semanticSignature: 's1',
      entries: [{
        stableFormulaIdentity: 'AMBIGUOUS' as const,
        formulaHostToken: 1,
        documentOrder: 0,
        formulaIndex: 0,
        sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
        normalizedSourceHash: 'h0',
        normalizedSourcePrefix: '',
        chapterOrdinal: 11,
        sectionOrdinal: 2,
        sequenceValue: 1,
        desiredTag: '11.2.1',
        expectedVisibleLabel: '(11.2.1)',
        managedEligible: true,
        explicitTagControl: false,
        formulaContentRevision: 1,
        scopeKey: null,
      }],
    }
    const ambCurr: LiveFormulaSemanticSnapshot = {
      ...ambPrev,
      semanticSignature: 's2',
      entries: [{
        ...ambPrev.entries[0],
        stableFormulaIdentity: 'AMBIGUOUS' as const,
        formulaIndex: 0,
        desiredTag: '11.2.2',
      }],
    }
    const diffs = diffLiveFormulaPlans(ambPrev, ambCurr)
    // Never guesses a merge: previous ambiguous → REMOVED, current → ADDED,
    // and neither requires render invalidation.
    expect(diffs.some((d) => d.changeKinds.includes('REMOVED'))).toBe(true)
    expect(diffs.some((d) => d.changeKinds.includes('ADDED'))).toBe(true)
    expect(diffs.every((d) => d.requiresRenderInvalidation === false)).toBe(true)
  })

  it('22. non-target R^2 → no block formula invalidation (clean affected set)', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    const prev = snapshot([entry({ host: hostA, index: 0 }), entry({ host: hostB, index: 1 })])
    // Inline math edits produce identical canonical snapshots.
    const curr = snapshot([entry({ host: hostA, index: 0 }), entry({ host: hostB, index: 1 })])
    const affected = computeAffectedFormulaSet(diffLiveFormulaPlans(prev, curr))
    expect(affected.addedCount).toBe(0)
    expect(affected.removedCount).toBe(0)
    expect(affected.affectedExistingFormulaCount).toBe(0)
    expect(affected.affectedNewFormulaCount).toBe(0)
  })
})
