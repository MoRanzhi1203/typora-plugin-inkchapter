/**
 * V5.14-R8 / Active State Machine V2 — the PURE contract (no DOM, no host):
 * the every-click-versioning reducer, the owner guard, the post-settle closure
 * verdict and the V2 gate / coverage reports.
 */
import { describe, it, expect } from 'vitest'
import {
  ACTIVE_STATE_MACHINE_V2_GATE_KEYS,
  ACTIVE_STATE_MACHINE_V2_GATE_LABELS,
  DOCUMENT_DIAGNOSTIC_CLICK_DISPATCH_V2,
  DOCUMENT_DIAGNOSTIC_OWNER_RETIRE_V2,
  DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2,
  DOCUMENT_DIAGNOSTIC_STALE_CALLBACK_DROPPED_V2,
  DOCUMENT_DIAGNOSTIC_STATE_TRANSITION_V2,
  DOCUMENT_DIAGNOSTIC_VISUAL_PUBLISH_V2,
  SAME_TARGET_TOGGLE_OFF_REASON_V2,
  computePassiveSemanticSetHash,
  createActiveStateMachineV2Counters,
  createActiveStateMachineV2CoverageCounters,
  emptyDiagnosticInteractionState,
  evaluateActiveStateMachineV2Coverage,
  evaluateActiveStateMachineV2Gates,
  evaluatePostSettleClosure,
  formatActiveStateMachineV2CoverageReport,
  formatActiveStateMachineV2GateReport,
  isCurrentOwnerV2,
  ownerOf,
  reduceDiagnosticClick,
  type DiagnosticInteractionState,
  type PostSettleClosureFacts,
} from './document-diagnostic-active-state-machine-v2'

const A = { diagnosticId: 'E1', targetKey: 'doc::E1::0::H-A', targetIndex: 0 }
const B = { diagnosticId: 'W1', targetKey: 'doc::W1::0::H-B', targetIndex: 0 }
const B2 = { diagnosticId: 'W1', targetKey: 'doc::W1::1::H-C', targetIndex: 1 }

describe('V5.14-R8 §4 — the every-click-versioning reducer', () => {
  it('IDLE + A → ACTIVE(A); ACTIVE(A) + A → IDLE; ACTIVE(A) + B → ACTIVE(B)', () => {
    const idle = emptyDiagnosticInteractionState()
    const t1 = reduceDiagnosticClick(idle, A, 11, null)
    expect(t1.action).toBe('ACTIVATE')
    expect(t1.next.phase).toBe('ACTIVE')
    expect(t1.next.diagnosticId).toBe(A.diagnosticId)
    expect(t1.next.targetKey).toBe(A.targetKey)
    expect(t1.next.transactionId).toBe(11)

    const t2 = reduceDiagnosticClick(t1.next, A, 12, null)
    expect(t2.action).toBe('DEACTIVATE')
    expect(t2.next.phase).toBe('IDLE')
    expect(t2.next.diagnosticId).toBeNull()
    expect(t2.next.targetKey).toBeNull()
    expect(t2.next.targetIndex).toBeNull()
    expect(t2.next.transactionId).toBeNull()
    expect(t2.next.leaseToken).toBeNull()

    const t3 = reduceDiagnosticClick(t1.next, B, 13, null)
    expect(t3.action).toBe('SWITCH')
    expect(t3.next.phase).toBe('ACTIVE')
    expect(t3.next.diagnosticId).toBe(B.diagnosticId)
    expect(t3.previous.diagnosticId).toBe(A.diagnosticId)
  })

  it('§4.1 — EVERY click increments the version EXACTLY once (DEACTIVATE included)', () => {
    let st: DiagnosticInteractionState = emptyDiagnosticInteractionState()
    const sequence = [A, A, B, A, B2, B2]
    const versions: number[] = []
    for (const click of sequence) {
      const t = reduceDiagnosticClick(st, click, 100 + versions.length, null)
      expect(t.next.version).toBe(t.previous.version + 1)
      versions.push(t.next.version)
      st = t.next
    }
    expect(versions).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('§12 — same diagnosticId at another targetIndex is a SWITCH, never a toggle-off', () => {
    const t1 = reduceDiagnosticClick(emptyDiagnosticInteractionState(), B, 1, null)
    const t2 = reduceDiagnosticClick(t1.next, B2, 2, null)
    expect(t2.action).toBe('SWITCH')
    expect(t2.next.targetIndex).toBe(1)
    const t3 = reduceDiagnosticClick(t2.next, B2, 3, null)
    expect(t3.action).toBe('DEACTIVATE')
  })

  it('§9 — the reducer is severity-BLIND (no severity input exists at all)', () => {
    const idle = emptyDiagnosticInteractionState()
    const first = reduceDiagnosticClick(idle, A, 1, null)
    // the same transition table for any severity: the reducer has no severity arg
    expect(reduceDiagnosticClick(idle, { ...A }, 1, null).action).toBe(first.action)
    expect(reduceDiagnosticClick(first.next, { ...A }, 2, null).action).toBe('DEACTIVATE')
    expect(reduceDiagnosticClick(first.next, { ...B }, 3, null).action).toBe('SWITCH')
  })
})

describe('V5.14-R8 §6 — the owner guard', () => {
  it('a captured owner is current ONLY while phase/target/version match', () => {
    const t = reduceDiagnosticClick(emptyDiagnosticInteractionState(), A, 7, null)
    const owner = ownerOf(t.next)!
    expect(owner.version).toBe(t.next.version)
    expect(isCurrentOwnerV2(owner, t.next)).toBe(true)
    // a new click (same target) bumps the version → the captured owner is STALE
    const t2 = reduceDiagnosticClick(t.next, A, null, null)
    expect(isCurrentOwnerV2(owner, t2.next)).toBe(false)
    // IDLE can never satisfy an owner
    expect(isCurrentOwnerV2(owner, emptyDiagnosticInteractionState())).toBe(false)
    // another target is stale too
    const t3 = reduceDiagnosticClick(t.next, B, 9, null)
    expect(isCurrentOwnerV2(owner, t3.next)).toBe(false)
  })

  it('ownerOf is null while IDLE (nothing to guard)', () => {
    expect(ownerOf(emptyDiagnosticInteractionState())).toBeNull()
  })
})

describe('V5.14-R8 §14 — the post-settle closure verdict', () => {
  function facts(over: Partial<PostSettleClosureFacts> = {}): PostSettleClosureFacts {
    return {
      statePhase: 'ACTIVE',
      stateDiagnosticId: 'E1',
      stateTargetKey: 'doc::E1::0::H-A',
      stateVersion: 4,
      selectedActiveRowCount: 1,
      drawerRowsRendered: true,
      activeTargetCount: 1,
      activeFillCount: 1,
      activeFillCountMeasurable: false,
      activeVisualWithoutOwner: false,
      activeHeadingFragmentCount: 1,
      activeTargetIsHeading: true,
      activeLeasePresent: true,
      activeLeaseOwnerVersion: 4,
      activeLeaseTargetKey: 'doc::E1::0::H-A',
      passiveSemanticSetUnchanged: true,
      globalUnscopedClearObserved: false,
      ...over,
    }
  }

  it('a clean ACTIVE heading closure is PASS', () => {
    expect(evaluatePostSettleClosure(facts()).decision).toBe('PASS')
  })

  it('§10 — ACTIVE heading with ZERO fill FAILS (ROOT_4)', () => {
    const v = evaluatePostSettleClosure(facts({ activeHeadingFragmentCount: 0, activeFillCount: 0 }))
    expect(v.decision).toBe('FAIL')
    expect(v.reasons).toContain('ACTIVE_HEADING_WITH_ZERO_FILL')
  })

  it('§14.2 — ACTIVE without a lease / with 2 targets / 0 rows FAILS', () => {
    expect(evaluatePostSettleClosure(facts({ activeLeasePresent: false })).reasons).toContain('ACTIVE_WITHOUT_LEASE')
    expect(evaluatePostSettleClosure(facts({ activeTargetCount: 2 })).reasons).toContain('ACTIVE_TARGET_COUNT_NOT_ONE')
    expect(evaluatePostSettleClosure(facts({ selectedActiveRowCount: 0 })).reasons).toContain('ACTIVE_SELECTED_ACTIVE_ROW_NOT_ONE')
  })

  it('§8/§11 — a global unscoped clear or a changed passive set FAILS', () => {
    expect(evaluatePostSettleClosure(facts({ globalUnscopedClearObserved: true })).reasons)
      .toContain('GLOBAL_UNSCOPED_CLEAR_OBSERVED')
    expect(evaluatePostSettleClosure(facts({ passiveSemanticSetUnchanged: false })).reasons)
      .toContain('PASSIVE_SEMANTIC_SET_CHANGED')
  })

  it('§14.1 — IDLE must be a TOTAL closure (0 rows / 0 targets / 0 fills / no lease)', () => {
    const idle = facts({
      statePhase: 'IDLE', stateDiagnosticId: null, stateTargetKey: null,
      selectedActiveRowCount: 0, drawerRowsRendered: true, activeTargetCount: 0, activeFillCount: 0,
      activeHeadingFragmentCount: 0, activeTargetIsHeading: false,
      activeLeasePresent: false, activeLeaseOwnerVersion: null, activeLeaseTargetKey: null,
    })
    expect(evaluatePostSettleClosure(idle).decision).toBe('PASS')
    expect(evaluatePostSettleClosure({ ...idle, selectedActiveRowCount: 1 })).toMatchObject({ decision: 'FAIL' })
    expect(evaluatePostSettleClosure({ ...idle, activeFillCount: 1 }).reasons).toContain('IDLE_WITH_ACTIVE_FILL')
    expect(evaluatePostSettleClosure({ ...idle, activeLeasePresent: true }).reasons).toContain('IDLE_WITH_ACTIVE_LEASE')
  })
})

describe('V5.14-R8 §15/§24 — the V2 gates + runtime coverage', () => {
  it('the 10 V2 gates are declared, complete and 0 on a clean surface', () => {
    expect(ACTIVE_STATE_MACHINE_V2_GATE_KEYS).toHaveLength(10)
    const counters = createActiveStateMachineV2Counters()
    expect(formatActiveStateMachineV2GateReport(counters)).toHaveLength(10)
    expect(evaluateActiveStateMachineV2Gates(counters).decision).toBe('PASS')
    expect(ACTIVE_STATE_MACHINE_V2_GATE_LABELS.activeWithZeroFill).toBe('ACTIVE_WITH_ZERO_FILL_COUNT')
    expect(ACTIVE_STATE_MACHINE_V2_GATE_LABELS.switchWithGlobalUnscopedClear).toBe('SWITCH_WITH_GLOBAL_UNSCOPED_CLEAR_COUNT')
    const dirty = createActiveStateMachineV2Counters()
    dirty.deactivateReusedInteractionVersion = 1
    expect(evaluateActiveStateMachineV2Gates(dirty).decision).toBe('FAIL')
  })

  it('§24 — the coverage gate requires BOTH same-target DEACTIVATE counts >= 1', () => {
    const c = createActiveStateMachineV2CoverageCounters()
    expect(evaluateActiveStateMachineV2Coverage(c).decision).toBe('FAIL')
    c.errorSameTargetDeactivateRuntime = 1
    expect(evaluateActiveStateMachineV2Coverage(c).decision).toBe('FAIL')
    c.warningSameTargetDeactivateRuntime = 1
    expect(evaluateActiveStateMachineV2Coverage(c).decision).toBe('PASS')
    expect(formatActiveStateMachineV2CoverageReport(c))
      .toEqual(['ERROR_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=1', 'WARNING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=1'])
  })

  it('the V2 audit event names + the toggle-off reason are stable', () => {
    expect(DOCUMENT_DIAGNOSTIC_CLICK_DISPATCH_V2).toBe('DOCUMENT-DIAGNOSTIC-CLICK-DISPATCH-V2')
    expect(DOCUMENT_DIAGNOSTIC_STATE_TRANSITION_V2).toBe('DOCUMENT-DIAGNOSTIC-STATE-TRANSITION-V2')
    expect(DOCUMENT_DIAGNOSTIC_OWNER_RETIRE_V2).toBe('DOCUMENT-DIAGNOSTIC-OWNER-RETIRE-V2')
    expect(DOCUMENT_DIAGNOSTIC_STALE_CALLBACK_DROPPED_V2).toBe('DOCUMENT-DIAGNOSTIC-STALE-CALLBACK-DROPPED-V2')
    expect(DOCUMENT_DIAGNOSTIC_VISUAL_PUBLISH_V2).toBe('DOCUMENT-DIAGNOSTIC-VISUAL-PUBLISH-V2')
    expect(DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2).toBe('DOCUMENT-DIAGNOSTIC-POST-SETTLE-CLOSURE-V2')
    expect(SAME_TARGET_TOGGLE_OFF_REASON_V2).toBe('SAME_TARGET_TOGGLE_OFF_V2')
  })

  it('§11 — the passive semantic set hash ignores order and duplicates', () => {
    expect(computePassiveSemanticSetHash(['a', 'b'])).toBe(computePassiveSemanticSetHash(['b', 'a', 'b']))
    expect(computePassiveSemanticSetHash(['a', 'b'])).not.toBe(computePassiveSemanticSetHash(['a']))
    expect(computePassiveSemanticSetHash([])).toBe(computePassiveSemanticSetHash([]))
  })
})
