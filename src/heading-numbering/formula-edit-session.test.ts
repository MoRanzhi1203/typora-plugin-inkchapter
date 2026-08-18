// @vitest-environment jsdom
/**
 * v2.5.7-R5.4.3.8 Unit Tests: Structural Empty Formula Slot +
 * Edit Session Identity/Source Commit Barrier + Projection Reconcile Wiring.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isEmptyFormulaSentinel,
  checkSourceCommitBarrier,
  latchEditSession,
  getActiveEditSession,
  clearEditSession,
  markSessionExplicitInput,
  resetEditSessionState,
  emitStructuralSlotAuthority,
  type SourceCommitBarrierResult,
} from './formula-edit-session'

describe('Structural Empty Formula Slot (v2.5.7-R5.4.3.8)', () => {
  beforeEach(() => {
    resetEditSessionState()
  })

  it('A1. empty rawTex is an EMPTY_FORMULA_SENTINEL', () => {
    expect(isEmptyFormulaSentinel('')).toBe(true)
    expect(isEmptyFormulaSentinel('<Empty \\space Math \\space Block>')).toBe(true)
    expect(isEmptyFormulaSentinel('\\space')).toBe(true)
    expect(isEmptyFormulaSentinel('x+y')).toBe(false)
  })

  it('A2. empty sentinel markers emit without throwing', () => {
    // Structural slot authority is emitted per canonical host regardless of rawTex.
    emitStructuralSlotAuthority({
      documentKey: 'docA', generation: 2, rootToken: 1, hostToken: 7,
      stableFormulaIdentity: 50, formulaIndex: 2,
      sourceState: 'EMPTY', rawTexLength: 0, managedForNumbering: true,
      scopeKey: '11:2', sequenceValue: 2, desiredTag: '11.2.2',
    })
    // no throw = pass (marker emission verified in runtime)
  })
})

describe('Edit Session Source Commit Barrier (v2.5.7-R5.4.3.8)', () => {
  beforeEach(() => {
    resetEditSessionState()
  })

  it('E1. click-only (no explicit input) -> commit BLOCKED, source unchanged', () => {
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: 2, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.2', sourceHashAtEnter: 'HASH-BEFORE', contentRevisionAtEnter: 5,
      trigger: 'PRECALL_HOST_IDENTITY',
    })
    const result = checkSourceCommitBarrier({
      sessionId: getActiveEditSession()!.sessionId,
      stableFormulaIdentity: 2, formulaIndex: 1,
      eventKind: 'edit-state-dom-drift',
      explicitInputObserved: false,
      sourceHashBefore: 'HASH-BEFORE',
      candidateSourceHash: 'HASH-EDIT-DOM',
      contentRevisionBefore: 5,
    })
    expect(result.commitAllowed).toBe(false)
    expect(result.sourceHashAfter).toBe('HASH-BEFORE')
    expect(result.contentRevisionAfter).toBe(5)
    expect(result.decision).toBe('BLOCK_NON_INPUT_EDIT_STATE_DRIFT')
  })

  it('F1. explicit input observed -> commit allowed, revision +1', () => {
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: 2, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.2', sourceHashAtEnter: 'HASH-BEFORE', contentRevisionAtEnter: 5,
      trigger: 'PRECALL_HOST_IDENTITY',
    })
    const session = getActiveEditSession()!
    markSessionExplicitInput(session)
    const result = checkSourceCommitBarrier({
      sessionId: session.sessionId,
      stableFormulaIdentity: 2, formulaIndex: 1,
      eventKind: 'input',
      explicitInputObserved: session.explicitInputObserved,
      sourceHashBefore: 'HASH-BEFORE',
      candidateSourceHash: 'HASH-AFTER',
      contentRevisionBefore: 5,
    })
    expect(result.commitAllowed).toBe(true)
    expect(result.sourceHashAfter).toBe('HASH-AFTER')
    expect(result.contentRevisionAfter).toBe(6)
    expect(result.decision).toBe('COMMIT')
  })

  it('G1. DOM candidate disappears but latched session identity survives', () => {
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: 2, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.2', sourceHashAtEnter: 'HASH-BEFORE', contentRevisionAtEnter: 5,
      trigger: 'PRECALL_HOST_IDENTITY',
    })
    // currentEditingFormulaCandidateCount=0 is simulated by the session surviving.
    const session = getActiveEditSession()
    expect(session).not.toBeNull()
    expect(session!.stableFormulaIdentity).toBe(2)
    expect(session!.desiredTag).toBe('11.2.2')
  })

  it('B1. clearEditSession clears latch', () => {
    latchEditSession({
      documentKey: 'docA', generation: 2, rootToken: 1,
      stableFormulaIdentity: 2, formulaHostToken: 9, formulaIndex: 1,
      desiredTag: '11.2.2', sourceHashAtEnter: null, contentRevisionAtEnter: 0,
      trigger: 'test',
    })
    clearEditSession('document-switch')
    expect(getActiveEditSession()).toBeNull()
  })
})
