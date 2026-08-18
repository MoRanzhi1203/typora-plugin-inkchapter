// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Unit tests for Managed Formula Plan Authority (v2.5.7-R5.1).
 *
 * Validates that managed eligibility requires ALL hard gates:
 *   isInkChapterMode + hostConnected + sameEditorRoot + sameDocument
 *   + sameGeneration + contextReady + desiredTagReady
 *
 * Native slot state is NOT part of eligibility.
 */

describe('Managed Formula Plan Eligibility Logic', () => {
  // Simulates the managed eligibility check from caption-service.ts
  function computeManagedEligibility(options: {
    mode: string
    enabled: boolean
    blocked: boolean
    hostConnected: boolean
    sameEditorRoot: boolean
    sameDocument: boolean
    sameGeneration: boolean
    renderedNumber: string
    slotState: string
  }): { managedEligible: boolean; reason: string | null } {
    const isInkChapterMode = options.mode === 'inkchapter' && options.enabled
    const contextReady = isInkChapterMode && !options.blocked
    const desiredTagReady = isInkChapterMode && options.renderedNumber.length > 0

    const managedEligible = isInkChapterMode
      && options.hostConnected
      && options.sameEditorRoot
      && options.sameDocument
      && options.sameGeneration
      && contextReady
      && desiredTagReady

    let reason: string | null = null
    if (!managedEligible) {
      if (!isInkChapterMode) reason = 'NOT_INKCHAPTER_MODE'
      else if (!options.hostConnected) reason = 'HOST_DISCONNECTED'
      else if (!options.sameEditorRoot) reason = 'STALE_EDITOR_ROOT'
      else if (!options.sameDocument) reason = 'STALE_DOCUMENT_KEY'
      else if (!options.sameGeneration) reason = 'STALE_DOCUMENT_GENERATION'
      else if (!contextReady) reason = 'CONTEXT_NOT_READY'
      else if (!desiredTagReady) reason = 'DESIRED_TAG_NOT_READY'
      else reason = 'OTHER'
    }
    return { managedEligible, reason }
  }

  // ── Test 1: contextReady=false → managedEligible=false ──

  it('Test 1: contextReady=false (blocked=true) → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: true,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('CONTEXT_NOT_READY')
  })

  // ── Test 2: sameDocument=false → managedEligible=false ──

  it('Test 2: sameDocument=false → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: false, sameGeneration: true,
      renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('STALE_DOCUMENT_KEY')
  })

  // ── Test 3: sameGeneration=false → managedEligible=false ──

  it('Test 3: sameGeneration=false → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: false,
      renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('STALE_DOCUMENT_GENERATION')
  })

  // ── Test 4: nativeSlot=NOT_FOUND + all authority PASS → managedEligible=true ──

  it('Test 4: nativeSlot=NOT_FOUND, all authority PASS → managedEligible=true', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(true)
  })

  // ── Test 5: nativeSlot=RESOLVED + all authority PASS → managedEligible=true ──

  it('Test 5: nativeSlot=RESOLVED, all authority PASS → managedEligible=true', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '(5.3.1)', slotState: 'RESOLVED',
    })
    expect(result.managedEligible).toBe(true)
  })

  // ── Test 6: NOT_FOUND vs RESOLVED produce identical eligibility ──

  it('Test 6: nativeSlot NOT_FOUND and RESOLVED produce identical eligibility', () => {
    const allPass = {
      mode: 'inkchapter' as const, enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '(5.3.1)',
    }
    const found = computeManagedEligibility({ ...allPass, slotState: 'RESOLVED' })
    const notFound = computeManagedEligibility({ ...allPass, slotState: 'NOT_FOUND' })
    expect(found.managedEligible).toBe(notFound.managedEligible)
    expect(found.managedEligible).toBe(true)
  })

  // ── Test 7: typora-native mode → not managed ──

  it('Test 7: typora-native mode → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'typora-native', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('NOT_INKCHAPTER_MODE')
  })

  // ── Test 8: host disconnected → managedEligible=false ──

  it('Test 8: host disconnected → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: false, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('HOST_DISCONNECTED')
  })

  // ── Test 9: desiredTagReady=false → managedEligible=false ──

  it('Test 9: desiredTagReady=false (empty renderedNumber) → managedEligible=false', () => {
    const result = computeManagedEligibility({
      mode: 'inkchapter', enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
      renderedNumber: '', slotState: 'NOT_FOUND',
    })
    expect(result.managedEligible).toBe(false)
    expect(result.reason).toBe('DESIRED_TAG_NOT_READY')
  })
})

// ── Wiring-level tests: fixture-scale managed plan scenarios ──

describe('Managed Formula Plan Wiring (v2.5.7-R5.1)', () => {
  // Simulates the FULL managed plan build (collection + summary + rerender gate)
  // from caption-service.ts, using the same eligibility logic.

  function computeManagedPlan(
    formulas: Array<{
      mode: string
      enabled: boolean
      blocked: boolean
      hostConnected: boolean
      sameEditorRoot: boolean
      sameDocument: boolean
      sameGeneration: boolean
      renderedNumber: string
      slotState: string
      formulaIndex: number
    }>,
  ): {
    managedFormulaCount: number
    blockedByNativeSlotCount: number
    nativeSlotNotFoundCount: number
    managedEntries: Array<{ formulaIndex: number; desiredTag: string }>
    rerenderGateDecision: 'REQUEST' | 'SKIP'
    rerenderGateReason: string | null
  } {
    const allPass = {
      mode: 'inkchapter' as const, enabled: true, blocked: false,
      hostConnected: true, sameEditorRoot: true,
      sameDocument: true, sameGeneration: true,
    }

    let managedFormulaCount = 0
    let blockedByNativeSlotCount = 0
    let nativeSlotNotFoundCount = 0
    const managedEntries: Array<{ formulaIndex: number; desiredTag: string }> = []

    for (const f of formulas) {
      const isInkChapterMode = f.mode === 'inkchapter' && f.enabled
      const contextReady = isInkChapterMode && !f.blocked
      const desiredTagReady = isInkChapterMode && f.renderedNumber.length > 0

      const managedEligible = isInkChapterMode
        && f.hostConnected
        && f.sameEditorRoot
        && f.sameDocument
        && f.sameGeneration
        && contextReady
        && desiredTagReady

      // wouldBeEligibleWithoutNativeSlot: same as managedEligible but ignoring slot state
      const wouldBeEligible = isInkChapterMode
        && f.hostConnected
        && f.sameEditorRoot
        && f.sameDocument
        && f.sameGeneration
        && contextReady
        && desiredTagReady

      if (f.slotState === 'NOT_FOUND' || f.slotState === 'AMBIGUOUS') {
        nativeSlotNotFoundCount++
      }

      if (!managedEligible && wouldBeEligible) {
        blockedByNativeSlotCount++
      }

      if (managedEligible) {
        managedFormulaCount++
        managedEntries.push({
          formulaIndex: f.formulaIndex,
          desiredTag: f.renderedNumber.replace(/[()]/g, ''),
        })
      }
    }

    const rerenderGateDecision = managedFormulaCount > 0 ? 'REQUEST' : 'SKIP'
    const rerenderGateReason = managedFormulaCount > 0 ? 'MANAGED_FORMULA_READY' : 'NO_MANAGED_FORMULA'

    return { managedFormulaCount, blockedByNativeSlotCount, nativeSlotNotFoundCount, managedEntries, rerenderGateDecision, rerenderGateReason }
  }

  // ── Test 10: Fixture: two formulas, NOT_FOUND, all gates PASS → managedFormulaCount=2 ──

  it('Test 10: fixture Formula0=5.3.1 Formula1=11.2.1 nativeSlot=NOT_FOUND → managedFormulaCount=2 blockedByNativeSlotCount=0', () => {
    const result = computeManagedPlan([
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
        formulaIndex: 0,
      },
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(11.2.1)', slotState: 'NOT_FOUND',
        formulaIndex: 1,
      },
    ])
    expect(result.managedFormulaCount).toBe(2)
    expect(result.blockedByNativeSlotCount).toBe(0)
    expect(result.nativeSlotNotFoundCount).toBe(2)
  })

  // ── Test 11: managedFormulaCount=2 → NativeTagPlan entries match ──

  it('Test 11: NativeTagPlan entries: Formula0→5.3.1 Formula1→11.2.1', () => {
    const result = computeManagedPlan([
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
        formulaIndex: 0,
      },
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(11.2.1)', slotState: 'NOT_FOUND',
        formulaIndex: 1,
      },
    ])
    expect(result.managedEntries).toHaveLength(2)
    expect(result.managedEntries[0]).toMatchObject({ formulaIndex: 0, desiredTag: '5.3.1' })
    expect(result.managedEntries[1]).toMatchObject({ formulaIndex: 1, desiredTag: '11.2.1' })
  })

  // ── Test 12: managedFormulaCount=2 → MATHJAX-RERENDER-GATE REQUEST ──

  it('Test 12: managedFormulaCount=2 → MATHJAX-RERENDER-GATE decision=REQUEST', () => {
    const result = computeManagedPlan([
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
        formulaIndex: 0,
      },
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(11.2.1)', slotState: 'NOT_FOUND',
        formulaIndex: 1,
      },
    ])
    expect(result.rerenderGateDecision).toBe('REQUEST')
    expect(result.rerenderGateReason).toBe('MANAGED_FORMULA_READY')
  })

  // ── Test 13: managedFormulaCount=0 → MATHJAX-RERENDER-GATE SKIP ──

  it('Test 13: managedFormulaCount=0 → MATHJAX-RERENDER-GATE decision=SKIP reason=NO_MANAGED_FORMULA', () => {
    const result = computeManagedPlan([])
    expect(result.managedFormulaCount).toBe(0)
    expect(result.rerenderGateDecision).toBe('SKIP')
    expect(result.rerenderGateReason).toBe('NO_MANAGED_FORMULA')
  })

  // ── Test 14: mixed managed/non-managed formulas ──

  it('Test 14: one managed + one blocked → managedFormulaCount=1, blockedBySlot=0', () => {
    const result = computeManagedPlan([
      {
        mode: 'inkchapter', enabled: true, blocked: false,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '(5.3.1)', slotState: 'NOT_FOUND',
        formulaIndex: 0,
      },
      {
        // This one is blocked because context is not ready
        mode: 'inkchapter', enabled: true, blocked: true,
        hostConnected: true, sameEditorRoot: true,
        sameDocument: true, sameGeneration: true,
        renderedNumber: '', slotState: 'NOT_FOUND',
        formulaIndex: 1,
      },
    ])
    expect(result.managedFormulaCount).toBe(1)
    expect(result.managedEntries[0].desiredTag).toBe('5.3.1')
    expect(result.rerenderGateDecision).toBe('REQUEST')
  })
})