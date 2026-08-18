// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.1 Unit Tests: Typora-owned Render Invalidation +
 * Dedupe + Feedback Loop Barrier.
 *
 * Covers Phase Q items:
 * 19  same revision/same formula invalidation executes once
 * 20  invalidation renderer mutation does not create new semantic revision
 * 21  rerender does not create invalidation feedback loop
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  requestFormulaRenderInvalidation,
  resetInvalidationDedupeState,
  emitLoopBarrier,
  setInvalidationInProgress,
  markRendererInternalMutationObserved,
} from './typora-formula-render-invalidation'
import {
  buildLiveFormulaSemanticSnapshot,
  recordSemanticBaseline,
  advanceLiveRevision,
  getLiveFormulaRevision,
  resetLiveRevisionState,
  resetIdentityTokens,
  type LiveFormulaSemanticSnapshot,
  type LiveFormulaSemanticEntryInput,
} from './formula-live-revision'

function entry(index: number, hash = `h${index}`): LiveFormulaSemanticEntryInput {
  return {
    host: document.createElement('div'),
    formulaIndex: index,
    documentOrder: index,
    desiredTag: `11.2.${index + 1}`,
    chapterOrdinal: 11,
    sectionOrdinal: 2,
    sequenceValue: index + 1,
    sourceKind: 'RAWBLOCK_SOURCE_CONTAINER',
    normalizedSourceHash: hash,
    normalizedSourcePrefix: '',
    managedEligible: true,
    formulaContentRevision: 1,
  }
}

function snapshot(entries: LiveFormulaSemanticEntryInput[]): LiveFormulaSemanticSnapshot {
  return buildLiveFormulaSemanticSnapshot({ documentKey: 'docA', liveFormulaRevision: 0, entries })
}

describe('Typora-owned Render Invalidation (v2.5.7-R5.4.1)', () => {
  beforeEach(() => {
    resetInvalidationDedupeState()
    resetLiveRevisionState()
    resetIdentityTokens()
  })

  it('19. same revision + same formula invalidation executes once', () => {
    const first = requestFormulaRenderInvalidation({
      liveFormulaRevision: 3,
      stableFormulaIdentity: 42,
      formulaIndex: 1,
      previousDesiredTag: '11.2.2',
      nextDesiredTag: '11.2.3',
      reason: 'DESIRED_TAG_CHANGED,ORDER_CHANGED',
      triggerName: 'updateMathBlock',
    })
    expect(first.decision).toBe('REQUESTED')
    const second = requestFormulaRenderInvalidation({
      liveFormulaRevision: 3,
      stableFormulaIdentity: 42,
      formulaIndex: 1,
      previousDesiredTag: '11.2.2',
      nextDesiredTag: '11.2.3',
      reason: 'DESIRED_TAG_CHANGED,ORDER_CHANGED',
      triggerName: 'updateMathBlock',
    })
    expect(second.decision).toBe('SKIPPED_DUPLICATE')
    // A different formula at the same revision is NOT a duplicate.
    const other = requestFormulaRenderInvalidation({
      liveFormulaRevision: 3,
      stableFormulaIdentity: 43,
      formulaIndex: 2,
      previousDesiredTag: '11.2.3',
      nextDesiredTag: '11.2.4',
      reason: 'DESIRED_TAG_CHANGED',
      triggerName: 'updateMathBlock',
    })
    expect(other.decision).toBe('REQUESTED')
  })

  it('20. invalidation renderer mutation does not create a new semantic revision', () => {
    const s1 = snapshot([entry(0), entry(1)])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'SHA', snapshot: s1 })
    // Advance once (real content change).
    const s2 = snapshot([entry(0), entry(1), entry(2)])
    advanceLiveRevision({
      documentKey: 'docA',
      documentGeneration: 1,
      diskSourceSha256: 'SHA',
      mutationClassification: 'REAL_DOCUMENT_CONTENT',
      snapshot: s2,
      previousSnapshotCount: 2,
      semanticReasonHint: 'ADD_BLOCK_FORMULA',
    })
    const revisionAfterAdvance = getRevision()
    // The Typora-owned rerender replaces mjx/SVG nodes → classified
    // TYPOORA_RENDERER_INTERNAL_ONLY → ignored even if the snapshot differs.
    const s3 = snapshot([entry(0, 'drifted-visual'), entry(1), entry(2)])
    const result = advanceLiveRevision({
      documentKey: 'docA',
      documentGeneration: 1,
      diskSourceSha256: 'SHA',
      mutationClassification: 'TYPOORA_RENDERER_INTERNAL_ONLY',
      snapshot: s3,
      previousSnapshotCount: 3,
    })
    expect(result.decision).toBe('IGNORED_RENDERER_INTERNAL')
    expect(getRevision()).toBe(revisionAfterAdvance)
  })

  it('21. rerender does not create an invalidation feedback loop', () => {
    const s1 = snapshot([entry(0)])
    recordSemanticBaseline({ documentKey: 'docA', documentGeneration: 1, diskSourceSha256: 'SHA', snapshot: s1 })
    // 1) Real edit: add formula → revision 1 → invalidation requested.
    const s2 = snapshot([entry(0), entry(1)])
    advanceLiveRevision({
      documentKey: 'docA',
      documentGeneration: 1,
      diskSourceSha256: 'SHA',
      mutationClassification: 'REAL_DOCUMENT_CONTENT',
      snapshot: s2,
      previousSnapshotCount: 1,
      semanticReasonHint: 'ADD_BLOCK_FORMULA',
    })
    const rev1 = getRevision()
    setInvalidationInProgress(true)
    const req = requestFormulaRenderInvalidation({
      liveFormulaRevision: rev1,
      stableFormulaIdentity: 7,
      formulaIndex: 1,
      previousDesiredTag: '11.2.2',
      nextDesiredTag: '11.2.2',
      reason: 'ADDED',
      triggerName: 'updateMathBlock',
    })
    expect(req.decision).toBe('REQUESTED')
    // 2) The rerender mutates the DOM (renderer-internal) → must be ignored.
    markRendererInternalMutationObserved()
    const rendererResult = advanceLiveRevision({
      documentKey: 'docA',
      documentGeneration: 1,
      diskSourceSha256: 'SHA',
      mutationClassification: 'TYPOORA_RENDERER_INTERNAL_ONLY',
      snapshot: s2,
      previousSnapshotCount: 2,
    })
    expect(rendererResult.decision).toBe('IGNORED_RENDERER_INTERNAL')
    // 3) No new semantic revision was created → re-requesting the SAME
    //    revision+formula is a duplicate → no repeated invalidation.
    const again = requestFormulaRenderInvalidation({
      liveFormulaRevision: rev1,
      stableFormulaIdentity: 7,
      formulaIndex: 1,
      previousDesiredTag: '11.2.2',
      nextDesiredTag: '11.2.2',
      reason: 'ADDED',
      triggerName: 'updateMathBlock',
    })
    expect(again.decision).toBe('SKIPPED_DUPLICATE')
    // 4) Loop barrier reports no new semantic revision / no repeated invalidation.
    expect(getRevision()).toBe(rev1)
    expect(again.decision).toBe('SKIPPED_DUPLICATE')
  })
})

function getRevision(): number {
  return getLiveFormulaRevision().liveFormulaRevision
}
