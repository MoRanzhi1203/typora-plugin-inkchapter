import { describe, it, expect } from 'vitest'
import {
  PostTextInputObservationLifecycle,
  type PostTextInputObservationArmInput,
} from './post-text-input-observation'

function makeArmInput(
  overrides: Partial<PostTextInputObservationArmInput> = {},
): PostTextInputObservationArmInput {
  return {
    inputIntentId: 'intent-1-1',
    intentEpoch: 1,
    inputType: 'insertCompositionText',
    scopeId: 'doc-1',
    editorInstanceId: 'editor-1',
    compositionSessionId: 'ime-1',
    supersededExpectationId: 'ce-split-1',
    supersededExpectationEpoch: 0,
    selectionWriteCounterAtInput: 0,
    caretRestoreCounterAtInput: 0,
    caretRepairCounterAtInput: 0,
    rehydratePlanCounterAtInput: 0,
    rehydrateApplyCounterAtInput: 0,
    rehydrateDomWriteCounterAtInput: 0,
    ...overrides,
  }
}

describe('PostTextInputObservationLifecycle (PL forensic-only)', () => {
  it('PL-1: complete() at +2200 → activeObservation=null, completeCount=1, pendingCallbackCount=0', () => {
    const lc = new PostTextInputObservationLifecycle()
    const obs = lc.arm(makeArmInput())
    expect(lc.activeObservation).toBe(obs)
    expect(lc.commit('COMPOSITION_END')).toBe(true)

    const offsets = [16, 50, 150, 300, 500, 1000, 2200]
    for (const _ms of offsets) {
      lc.scheduleCallback(obs)
    }
    expect(obs.pendingCallbackCount).toBe(7)
    for (const _ms of offsets) {
      lc.onCallbackFired(obs)
    }
    expect(obs.pendingCallbackCount).toBe(0)

    const completed = lc.complete()
    expect(completed).toBe(obs)
    expect(lc.activeObservation).toBeNull()
    expect(lc.activeObservationAfterComplete).toBe('none')
    expect(lc.completeCount).toBe(1)
    expect(completed!.pendingCallbackCount).toBe(0)
  })

  it('PL-2: foreign composition session → FOREIGN_BLOCK, foreignInputAccepted=0', () => {
    const lc = new PostTextInputObservationLifecycle()
    lc.arm(makeArmInput({ compositionSessionId: 'ime-C1' }))

    expect(lc.acceptInputEvent('ime-C2')).toBe('FOREIGN_BLOCK')
    expect(lc.foreignInputBlockedCount).toBe(1)
    expect(lc.foreignInputAcceptedCount).toBe(0)
  })

  it('PL-3: same composition session → ACCEPT, observation remains active', () => {
    const lc = new PostTextInputObservationLifecycle()
    const obs = lc.arm(makeArmInput({ compositionSessionId: 'ime-C1' }))

    expect(lc.acceptInputEvent('ime-C1')).toBe('ACCEPT')
    expect(lc.activeObservation).toBe(obs)
    expect(lc.foreignInputBlockedCount).toBe(0)
  })

  it('PL-4: stale callback after complete → isCurrent=false, staleCallbackExecutedCount stays 0', () => {
    const lc = new PostTextInputObservationLifecycle()
    const obs = lc.arm(makeArmInput())
    const generation = obs.generation
    lc.commit('INPUT_EVENT')
    lc.complete()

    // stale callback for the completed observation must be dropped
    expect(lc.isCurrent(obs, generation, 'doc-1', 'editor-1')).toBe(false)
    lc.markStaleCallbackDropped()
    expect(lc.staleCallbackDroppedCount).toBe(1)
    expect(lc.staleCallbackExecutedCount).toBe(0)
  })

  it('PL-5: scope/editor/unload cancel → activeObservation=null', () => {
    const lc = new PostTextInputObservationLifecycle()

    lc.arm(makeArmInput({ scopeId: 'doc-1', editorInstanceId: 'editor-1' }))
    expect(lc.activeObservation).not.toBeNull()
    lc.cancel('SCOPE_CHANGED')
    expect(lc.activeObservation).toBeNull()

    lc.arm(makeArmInput({ scopeId: 'doc-2' }))
    lc.cancel('EDITOR_UNBOUND')
    expect(lc.activeObservation).toBeNull()

    lc.arm(makeArmInput())
    lc.cancel('UNLOAD')
    expect(lc.activeObservation).toBeNull()
  })

  it('maxActiveObservation=1: arm while active cancels previous observation', () => {
    const lc = new PostTextInputObservationLifecycle()
    const first = lc.arm(makeArmInput())
    const second = lc.arm(makeArmInput())
    expect(lc.activeObservation).toBe(second)
    expect(lc.activeObservation).not.toBe(first)
    expect(lc.activeObservationPeak).toBe(1)
  })
})
