import { describe, it, expect } from 'vitest'
import {
  resolveEmptySlot,
  computeCaretGeometry,
  evaluateEmptySpecialFinal,
  isTokenOnlyEmptySpecialCommand,
  decideEmptySpecialSettle,
  shouldClearActiveTxn,
} from './empty-special-command'

describe('EMPTY-SPECIAL — P0 token-only empty special command', () => {
  it('EMPTY-SPECIAL-E1: trailing empty run → source survives (SAME_NODE)', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-C',
      previousRuntimeId: 'P-B',
      nextRuntimeId: null,
      candidateRuntimeIds: [],
      paragraphCountBefore: 4,
      paragraphCountAfter: 4,
    })
    expect(r.decision).toBe('SAME_NODE')
    expect(r.resolvedRuntimeId).toBe('P-C')
    expect(r.candidateCount).toBe(1)
  })

  it('EMPTY-SPECIAL-E2: single trailing empty → caret geometry PASS', () => {
    const g = computeCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      paragraphContentLeft: 100,
      caretRectLeft: 132,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(32)
    expect(g.overall).toBe(true)
  })

  it('EMPTY-SPECIAL-E3: middle empty run → unique replacement (CONTROLLED_REPLACEMENT)', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-C',
      previousRuntimeId: 'P-B',
      nextRuntimeId: 'P-D',
      candidateRuntimeIds: ['P-C2'],
      paragraphCountBefore: 5,
      paragraphCountAfter: 5,
    })
    expect(r.decision).toBe('CONTROLLED_REPLACEMENT')
    expect(r.resolvedRuntimeId).toBe('P-C2')
  })

  it('EMPTY-SPECIAL-E4: first paragraph empty → SAME_NODE with no previous', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-0',
      previousRuntimeId: null,
      nextRuntimeId: 'P-1',
      candidateRuntimeIds: [],
      paragraphCountBefore: 2,
      paragraphCountAfter: 2,
    })
    expect(r.decision).toBe('SAME_NODE')
    expect(r.previousRuntimeId).toBeNull()
  })

  it('EMPTY-SPECIAL-E5: already FORCE_INDENT empty → semanticCorrect accepted', () => {
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
    expect(report.semanticCorrect).toBe(true)
    expect(report.overall).toBe(true)
  })

  it('EMPTY-SPECIAL-E6: FORCE_FLUSH → FORCE_INDENT (UPDATE) → source survives SAME_NODE', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-C',
      previousRuntimeId: 'P-B',
      nextRuntimeId: null,
      candidateRuntimeIds: [],
      paragraphCountBefore: 3,
      paragraphCountAfter: 3,
    })
    expect(r.decision).toBe('SAME_NODE')
    // UPDATE_EXISTING path is chosen because source survives (no replacement).
    expect(r.resolvedRuntimeId).toBe('P-C')
  })

  it('EMPTY-SPECIAL-E7: new trusted intent supersedes → caret not verified → BLOCK', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: false,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(false)
  })

  it('EMPTY-SPECIAL-E8: source survives → SAME_NODE', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-5',
      previousRuntimeId: 'P-4',
      nextRuntimeId: 'P-6',
      candidateRuntimeIds: [],
      paragraphCountBefore: 7,
      paragraphCountAfter: 7,
    })
    expect(r.decision).toBe('SAME_NODE')
  })

  it('EMPTY-SPECIAL-E9: unique replacement → CONTROLLED_REPLACEMENT', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-5',
      previousRuntimeId: 'P-4',
      nextRuntimeId: 'P-6',
      candidateRuntimeIds: ['P-5-new'],
      paragraphCountBefore: 7,
      paragraphCountAfter: 7,
    })
    expect(r.decision).toBe('CONTROLLED_REPLACEMENT')
    expect(r.resolvedRuntimeId).toBe('P-5-new')
  })

  it('EMPTY-SPECIAL-E10: ambiguous replacement → AMBIGUOUS (BLOCK, never guess)', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-5',
      previousRuntimeId: 'P-4',
      nextRuntimeId: 'P-6',
      candidateRuntimeIds: ['P-5a', 'P-5b'],
      paragraphCountBefore: 7,
      paragraphCountAfter: 7,
    })
    expect(r.decision).toBe('AMBIGUOUS')
    expect(r.resolvedRuntimeId).toBeNull()
  })

  it('EMPTY-SPECIAL-E11: ordinary nonempty "文本。。" → old path (NOT token-only)', () => {
    expect(isTokenOnlyEmptySpecialCommand('文本。。', '。。')).toBe(false)
    expect(isTokenOnlyEmptySpecialCommand('。。', '。。')).toBe(true)
  })

  it('EMPTY-SPECIAL-E12: authorizedCaretWriteCount<=1 accepted (single authorized write)', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 1,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.authorizedCaretWriteCount).toBe(1)
    expect(report.overall).toBe(true)
  })

  it('EMPTY-SPECIAL-E13: caret geometry within tolerance → PASS', () => {
    const g = computeCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      paragraphContentLeft: 200,
      caretRectLeft: 234,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(34)
    expect(Math.abs(g.actualCaretIndentPx - g.expectedIndentPx)).toBeLessThanOrEqual(g.tolerancePx)
    expect(g.overall).toBe(true)
  })

  it('EMPTY-SPECIAL-E14: caret geometry out of tolerance → BLOCK (no fake PASS)', () => {
    const g = computeCaretGeometry({
      fontSizePx: 16,
      expectedIndentPx: 32,
      paragraphContentLeft: 200,
      caretRectLeft: 200,
      tolerancePx: 4,
      logicalOffset: 0,
    })
    expect(g.actualCaretIndentPx).toBe(0)
    expect(g.overall).toBe(false)
  })
})

describe('EMPTY-SPECIAL — mutation-authoritative settle decision (B)', () => {
  it('EMPTY-SPECIAL-E15: relevant mutation + quiet frames → SETTLED_BY_MUTATION_QUIET', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 3,
      relevantMutationCount: 2,
      quietFramesSinceMutation: 2,
      elapsedMs: 40,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: true,
      topologyStable: true,
    })
    expect(d.decision).toBe('SETTLED_BY_MUTATION_QUIET')
    expect(d.shouldResolve).toBe(true)
  })

  it('EMPTY-SPECIAL-E16: relevant mutation but not yet quiet → PENDING', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 5,
      relevantMutationCount: 1,
      quietFramesSinceMutation: 0,
      elapsedMs: 10,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: true,
      topologyStable: false,
    })
    expect(d.decision).toBe('PENDING')
    expect(d.shouldResolve).toBe(false)
  })

  it('EMPTY-SPECIAL-E17: no relevant mutation + stable + connected → SETTLED_NO_RELEVANT_MUTATION', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 0,
      relevantMutationCount: 0,
      quietFramesSinceMutation: 3,
      elapsedMs: 40,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: true,
      topologyStable: true,
    })
    expect(d.decision).toBe('SETTLED_NO_RELEVANT_MUTATION')
    expect(d.shouldResolve).toBe(true)
  })

  it('EMPTY-SPECIAL-E18: relevant mutation + timeout without quiet → TIMEOUT_BLOCK (NOT success)', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 5,
      relevantMutationCount: 2,
      quietFramesSinceMutation: 0,
      elapsedMs: 300,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: true,
      topologyStable: false,
    })
    expect(d.decision).toBe('TIMEOUT_BLOCK')
    expect(d.shouldResolve).toBe(true)
  })

  it('EMPTY-SPECIAL-E19: no relevant mutation + disconnected source + timeout → TIMEOUT_BLOCK', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 0,
      relevantMutationCount: 0,
      quietFramesSinceMutation: 3,
      elapsedMs: 300,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: false,
      topologyStable: true,
    })
    expect(d.decision).toBe('TIMEOUT_BLOCK')
  })

  it('EMPTY-SPECIAL-E20: no relevant mutation + connected but not stable → PENDING', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 0,
      relevantMutationCount: 0,
      quietFramesSinceMutation: 0,
      elapsedMs: 10,
      maxTimeoutMs: 300,
      requiredQuietFrames: 2,
      sourceConnected: true,
      topologyStable: false,
    })
    expect(d.decision).toBe('PENDING')
  })
})

describe('EMPTY-SETTLE — mutation authority invariants', () => {
  // EMPTY-SETTLE-1: observer armed before consume is enforced in
  // heading-numbering-service.ts (armEmptySpecialMutationWindow runs before
  // clearParagraphToken). The observable consequence: SETTLED_BY_MUTATION_QUIET
  // requires relevantMutationCount>0, i.e. the token-consume/normalization batch
  // MUST have been observed (which is only possible if the observer was armed first).
  it('EMPTY-SETTLE-1: quiet settle requires an observed relevant mutation', () => {
    const noMutation = decideEmptySpecialSettle({
      mutationGeneration: 0, relevantMutationCount: 0, quietFramesSinceMutation: 5,
      elapsedMs: 10, maxTimeoutMs: 300, requiredQuietFrames: 2,
      sourceConnected: true, topologyStable: true,
    })
    expect(noMutation.decision).not.toBe('SETTLED_BY_MUTATION_QUIET')
  })

  it('EMPTY-SETTLE-2: relevant mutation + quiet → SETTLED_BY_MUTATION_QUIET', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 3, relevantMutationCount: 2, quietFramesSinceMutation: 2,
      elapsedMs: 40, maxTimeoutMs: 300, requiredQuietFrames: 2,
      sourceConnected: true, topologyStable: true,
    })
    expect(d.decision).toBe('SETTLED_BY_MUTATION_QUIET')
  })

  it('EMPTY-SETTLE-3: no mutation + stable topology → SETTLED_NO_RELEVANT_MUTATION', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 0, relevantMutationCount: 0, quietFramesSinceMutation: 3,
      elapsedMs: 40, maxTimeoutMs: 300, requiredQuietFrames: 2,
      sourceConnected: true, topologyStable: true,
    })
    expect(d.decision).toBe('SETTLED_NO_RELEVANT_MUTATION')
  })

  it('EMPTY-SETTLE-4: timeout without authority → TIMEOUT_BLOCK', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 5, relevantMutationCount: 2, quietFramesSinceMutation: 0,
      elapsedMs: 300, maxTimeoutMs: 300, requiredQuietFrames: 2,
      sourceConnected: true, topologyStable: false,
    })
    expect(d.decision).toBe('TIMEOUT_BLOCK')
  })

  it('EMPTY-SETTLE-5: TIMEOUT_BLOCK must not be treated as a success resolve', () => {
    const d = decideEmptySpecialSettle({
      mutationGeneration: 5, relevantMutationCount: 2, quietFramesSinceMutation: 0,
      elapsedMs: 300, maxTimeoutMs: 300, requiredQuietFrames: 2,
      sourceConnected: true, topologyStable: false,
    })
    expect(d.decision).toBe('TIMEOUT_BLOCK')
    expect(d.quietBoundaryReached).toBe(false)
    // Only SETTLED_* decisions may proceed to canonical/caret; TIMEOUT_BLOCK must BLOCK.
    expect(d.decision).not.toBe('SETTLED_BY_MUTATION_QUIET')
    expect(d.decision).not.toBe('SETTLED_NO_RELEVANT_MUTATION')
  })
})

describe('EMPTY-TERMINAL / SPECIAL-ROUTE — txn ownership guard', () => {
  it('EMPTY-TERMINAL-4: closing old txn does NOT clear newer active txn', () => {
    expect(shouldClearActiveTxn('txn-newer', 'txn-old')).toBe(false)
    expect(shouldClearActiveTxn('txn-old', 'txn-old')).toBe(true)
    expect(shouldClearActiveTxn(null, 'txn-old')).toBe(false)
  })

  it('SPECIAL-ROUTE-2: a blocked terminal old txn does NOT block next Special transaction', () => {
    // The one-at-a-time gate is only held by the SAME txn; a newer Special
    // transaction must be able to proceed once the old txn id differs.
    expect(shouldClearActiveTxn('txn-newer', 'txn-old')).toBe(false)
    // The service keeps activeEnterTransaction until the SAME txn closes it.
    expect(shouldClearActiveTxn('txn-old', 'txn-old')).toBe(true)
  })
})

describe('EMPTYBUS — P0 empty special-command business continuity contracts', () => {
  it('EMPTYBUS-4: E2 trailing empty → SAME_NODE identity preserved', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-tail',
      previousRuntimeId: 'P-text',
      nextRuntimeId: null,
      candidateRuntimeIds: [],
      paragraphCountBefore: 2,
      paragraphCountAfter: 2,
    })
    expect(r.decision).toBe('SAME_NODE')
    expect(r.resolvedRuntimeId).toBe('P-tail')
    expect(r.candidateCount).toBe(1)
  })

  it('EMPTYBUS-6: AMBIGUOUS → BLOCK (never guess)', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-mid',
      previousRuntimeId: 'P-prev',
      nextRuntimeId: 'P-next',
      candidateRuntimeIds: ['P-a', 'P-b'],
      paragraphCountBefore: 3,
      paragraphCountAfter: 4,
    })
    expect(r.decision).toBe('AMBIGUOUS')
    expect(r.resolvedRuntimeId).toBeNull()
  })

  it('EMPTYBUS-7: MISSING → BLOCK', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-mid',
      previousRuntimeId: 'P-prev',
      nextRuntimeId: 'P-next',
      candidateRuntimeIds: [],
      paragraphCountBefore: 3,
      paragraphCountAfter: 2,
    })
    expect(r.decision).toBe('MISSING')
    expect(r.resolvedRuntimeId).toBeNull()
  })

  it('EMPTYBUS-8: semantic force-indent PASS → overall true', () => {
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
    expect(report.semanticCorrect).toBe(true)
    expect(report.overall).toBe(true)
  })

  it('EMPTYBUS-9: semantic PASS + visual FAIL → no commit (overall false)', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: false,
      caretLogicalCorrect: true,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(false)
  })

  it('EMPTYBUS-10: logical caret PASS + visual caret FAIL → no commit', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: true,
      caretVisualCorrect: false,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(false)
  })

  it('EMPTYBUS-11: superseded caret correction (logical caret false) → no commit', () => {
    const report = evaluateEmptySpecialFinal({
      logicalSlotPreserved: true,
      paragraphCountPreserved: true,
      canonicalOwnerCorrect: true,
      semanticCorrect: true,
      visualIndentCorrect: true,
      caretLogicalCorrect: false,
      caretVisualCorrect: true,
      authorizedCaretWriteCount: 0,
      unexpectedMerge: false,
      unexpectedDelete: false,
    })
    expect(report.overall).toBe(false)
  })

  it('EMPTYBUS-12: blocked txn terminal cleanup clears only its own binding', () => {
    expect(shouldClearActiveTxn('txn-old', 'txn-old')).toBe(true)
    expect(shouldClearActiveTxn('txn-new', 'txn-old')).toBe(false)
    expect(shouldClearActiveTxn(null, 'txn-old')).toBe(false)
  })

  it('EMPTYBUS-13: token-only admission cannot route NORMAL_ENTER', () => {
    expect(isTokenOnlyEmptySpecialCommand('。。', '。。')).toBe(true)
    expect(isTokenOnlyEmptySpecialCommand('文本。。', '。。')).toBe(false)
  })

  it('EMPTYBUS-14: E1 trailing empty run → topology preserved (SAME_NODE)', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-3',
      previousRuntimeId: 'P-2',
      nextRuntimeId: null,
      candidateRuntimeIds: [],
      paragraphCountBefore: 4,
      paragraphCountAfter: 4,
    })
    expect(r.decision).toBe('SAME_NODE')
    expect(r.paragraphCountBefore).toBe(4)
    expect(r.paragraphCountAfter).toBe(4)
  })

  it('EMPTYBUS-15: E2 one Enter sufficient (single trailing empty survives)', () => {
    const r = resolveEmptySlot({
      sourceConnected: true,
      sourceRuntimeId: 'P-tail',
      previousRuntimeId: 'P-text',
      nextRuntimeId: null,
      candidateRuntimeIds: [],
      paragraphCountBefore: 2,
      paragraphCountAfter: 2,
    })
    expect(r.decision).toBe('SAME_NODE')
    expect(r.resolvedRuntimeId).toBe('P-tail')
  })

  it('EMPTYBUS-16: E3 middle empty not deleted (unique controlled replacement)', () => {
    const r = resolveEmptySlot({
      sourceConnected: false,
      sourceRuntimeId: 'P-mid',
      previousRuntimeId: 'P-prev',
      nextRuntimeId: 'P-next',
      candidateRuntimeIds: ['P-mid-new'],
      paragraphCountBefore: 3,
      paragraphCountAfter: 3,
    })
    expect(r.decision).toBe('CONTROLLED_REPLACEMENT')
    expect(r.resolvedRuntimeId).toBe('P-mid-new')
  })
})
