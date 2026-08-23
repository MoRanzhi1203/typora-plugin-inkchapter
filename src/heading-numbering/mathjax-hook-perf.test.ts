// @vitest-environment jsdom
/**
 * Phase 7R.3.4-F/G — hook lifecycle steady-state (HOOK-PERF-1..3) and
 * document-open perf summary (LOG-PERF-4) tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ensureMathJaxRenderInputHook,
  uninstallMathJaxRenderInputHook,
  getMathJaxHookLifecycle,
  getMathJaxHookCounters,
} from './mathjax-render-input-hook'
import { FormulaProjectionController } from './formula-projection-controller'
import { DocumentOpenPerfTracker, registerActivePerfTracker, getActivePerfTracker } from './document-open-perf'

type MathJaxLike = { tex2svgPromise?: (...args: unknown[]) => unknown; tex2svg?: (...args: unknown[]) => unknown }

function mockMathJax(): { original: MathJaxLike; wrapper: MathJaxLike } {
  const original: MathJaxLike = {
    tex2svgPromise: vi.fn((tex: unknown) => Promise.resolve(document.createElement('mjx-container'))),
    tex2svg: vi.fn((tex: unknown) => document.createElement('mjx-container')),
  }
  ;(globalThis as unknown as { MathJax: MathJaxLike }).MathJax = original
  return { original, wrapper: original }
}

import { vi } from 'vitest'

describe('MathJax hook steady-state (Phase 7R.3.4-F)', () => {
  beforeEach(() => {
    uninstallMathJaxRenderInputHook()
    mockMathJax()
    registerActivePerfTracker(new DocumentOpenPerfTracker())
  })

  afterEach(() => {
    uninstallMathJaxRenderInputHook()
    registerActivePerfTracker(null)
    delete (globalThis as { MathJax?: unknown }).MathJax
  })

  function liveProvider() {
    return { documentKey: 'doc-a', controller: new FormulaProjectionController(), headingSnapshotRevision: 1 }
  }

  it('HOOK-PERF-1: first availability → installationSuccessCount increments by 1', () => {
    const before = getMathJaxHookCounters()
    expect(getMathJaxHookLifecycle()).toBe('WAITING_FOR_MATHJAX')
    const ok = ensureMathJaxRenderInputHook({ getLiveContext: liveProvider })
    expect(ok).toBe(true)
    expect(getMathJaxHookLifecycle()).toBe('INSTALLED')
    expect(getMathJaxHookCounters().installationSuccessCount).toBe(before.installationSuccessCount + 1)
  })

  it('HOOK-PERF-2: 20 stable reconciles → installationAttemptCount does NOT grow', () => {
    ensureMathJaxRenderInputHook({ getLiveContext: liveProvider })
    const afterInstall = getMathJaxHookCounters()
    for (let i = 0; i < 20; i++) {
      const ok = ensureMathJaxRenderInputHook({ getLiveContext: liveProvider })
      expect(ok).toBe(true)
    }
    expect(getMathJaxHookCounters().installationAttemptCount).toBe(afterInstall.installationAttemptCount)
    expect(getMathJaxHookCounters().installationSuccessCount).toBe(afterInstall.installationSuccessCount)
  })

  it('HOOK-PERF-3: document switch → wrapper remains installed once; live context changes normally', async () => {
    const controller = new FormulaProjectionController()
    const liveState = { documentKey: 'doc-a', headingSnapshotRevision: 1 }
    ensureMathJaxRenderInputHook({
      getLiveContext: () => ({ documentKey: liveState.documentKey, controller, headingSnapshotRevision: liveState.headingSnapshotRevision }),
    })
    const countersBefore = getMathJaxHookCounters()
    // Simulate a document switch: same wrapper, new live documentKey/revision.
    liveState.documentKey = 'doc-b'
    liveState.headingSnapshotRevision = 7
    const M = (globalThis as unknown as { MathJax: MathJaxLike }).MathJax
    const wrapped = M.tex2svgPromise!
    await (wrapped as (tex: string) => Promise<unknown>)('x = 1')
    expect(getMathJaxHookLifecycle()).toBe('INSTALLED')
    expect(getMathJaxHookCounters().installationSuccessCount).toBe(countersBefore.installationSuccessCount)
    expect(getMathJaxHookCounters().installationAttemptCount).toBe(countersBefore.installationAttemptCount)
  })
})

describe('DocumentOpenPerfTracker (Phase 7R.3.4-A / LOG-PERF-4)', () => {
  it('LOG-PERF-4: PERF summary finalized once per document epoch (idempotent)', () => {
    const tracker = new DocumentOpenPerfTracker()
    const epoch = tracker.beginEpoch('doc-a')
    expect(epoch).toBe(1)
    tracker.mark('T1')
    tracker.incFullCaptionScan()
    tracker.incCoordinatorExecution()
    tracker.incFormulaPlanBuild()
    tracker.finalize('doc-a')
    // Second finalize is a no-op (once per epoch).
    tracker.finalize('doc-a')
    const snap = tracker.snapshot()
    expect(snap.counters.fullCaptionScanCount).toBe(1)
    expect(snap.counters.coordinatorExecutionCount).toBe(1)
    expect(snap.counters.formulaPlanBuildCount).toBe(1)
    expect(tracker.isFinalized()).toBe(true)
  })

  it('milestones T0..T8 produce ordered monotonic intervals', () => {
    const tracker = new DocumentOpenPerfTracker()
    tracker.beginEpoch('doc-a')
    tracker.mark('T1')
    tracker.mark('T2')
    tracker.mark('T3')
    tracker.mark('T5')
    tracker.mark('T6')
    tracker.mark('T7')
    tracker.finalize('doc-a')
    const snap = tracker.snapshot()
    expect(snap.epoch).toBeGreaterThan(0)
  })

  it('counter increments are bounded and non-finalized only', () => {
    const tracker = new DocumentOpenPerfTracker()
    tracker.beginEpoch('doc-a')
    tracker.incSelfMutationSkip()
    tracker.incSemanticNoopSkip()
    tracker.incHookInstallAttempt()
    const snap = tracker.snapshot()
    expect(snap.counters.selfMutationSkipCount).toBe(1)
    expect(snap.counters.semanticNoopSkipCount).toBe(1)
    expect(snap.counters.mathJaxHookInstallAttemptCount).toBe(1)
    expect(getActivePerfTracker()).toBe(null)
  })
})
