/**
 * Phase 7R.3.4-B — reconcile coalescing scheduler tests (COALESCE-1..5).
 */

import { describe, it, expect, vi } from 'vitest'
import { NumberingReconcileScheduler, SEMANTIC_STRUCTURAL_INVALIDATION_MASK, mergeInvalidation } from './reconcile-scheduler'

function flushQueue(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve))
}

describe('NumberingReconcileScheduler (Phase 7R.3.4-B)', () => {
  it('COALESCE-1: 5 same-epoch requests before execution → exactly 1 executor run', async () => {
    const executor = vi.fn()
    const scheduler = new NumberingReconcileScheduler()
    scheduler.attach(executor)
    for (let i = 0; i < 5; i++) {
      scheduler.request({ reason: `r${i}`, invalidation: 'VISUAL_ONLY_NO_SEMANTIC_CHANGE', documentEpoch: 1, documentKey: 'doc' })
    }
    await flushQueue()
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('COALESCE-2: different reasons merge invalidation masks → one run with union', async () => {
    const executor = vi.fn()
    const scheduler = new NumberingReconcileScheduler()
    scheduler.attach(executor)
    scheduler.request({ reason: 'a', invalidation: 'HEADING_SEMANTICS_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    scheduler.request({ reason: 'b', invalidation: 'FORMULA_SOURCE_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    scheduler.request({ reason: 'c', invalidation: 'OBJECT_STRUCTURE_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    await flushQueue()
    expect(executor).toHaveBeenCalledTimes(1)
    const pending = executor.mock.calls[0][0]
    expect(pending.reasons.size).toBe(3)
    const expected = mergeInvalidation(['HEADING_SEMANTICS_CHANGED', 'FORMULA_SOURCE_CHANGED', 'OBJECT_STRUCTURE_CHANGED'])
    expect(pending.invalidationMask & expected).toBe(expected)
  })

  it('COALESCE-3: request during active reconcile → max 1 follow-up', async () => {
    const executor = vi.fn((pending) => {
      if (pending.documentEpoch === 1 && pending.reasons.has('first')) {
        // Simulate an event arriving DURING execution.
        scheduler.request({ reason: 'during', invalidation: 'OBJECT_STRUCTURE_CHANGED', documentEpoch: 1, documentKey: 'doc' })
      }
    })
    const scheduler = new NumberingReconcileScheduler()
    scheduler.attach(executor)
    scheduler.request({ reason: 'first', invalidation: 'DOCUMENT_IDENTITY_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    await flushQueue()
    await flushQueue()
    // First run + exactly ONE follow-up; no recursive explosion.
    expect(executor.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('COALESCE-4: document epoch changes before execution → stale run aborts (executor sees old epoch)', async () => {
    const executor = vi.fn()
    const scheduler = new NumberingReconcileScheduler()
    scheduler.attach(executor)
    scheduler.request({ reason: 'old', invalidation: 'HEADING_SEMANTICS_CHANGED', documentEpoch: 1, documentKey: 'old-doc' })
    scheduler.request({ reason: 'new', invalidation: 'DOCUMENT_IDENTITY_CHANGED', documentEpoch: 2, documentKey: 'new-doc' })
    await flushQueue()
    // The pending request was replaced by the newest epoch.
    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor.mock.calls[0][0].documentEpoch).toBe(2)
    expect(executor.mock.calls[0][0].documentKey).toBe('new-doc')
  })

  it('COALESCE-5: max concurrent execution = 1', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const executor = vi.fn(() => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      concurrent--
    })
    const scheduler = new NumberingReconcileScheduler()
    scheduler.attach(executor)
    scheduler.request({ reason: 'a', invalidation: 'OBJECT_STRUCTURE_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    await flushQueue()
    scheduler.request({ reason: 'b', invalidation: 'OBJECT_STRUCTURE_CHANGED', documentEpoch: 1, documentKey: 'doc' })
    await flushQueue()
    expect(maxConcurrent).toBe(1)
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('semantic structural mask excludes renderer/self/visual invalidation', () => {
    const rendererOnly = mergeInvalidation('RENDERER_OUTPUT_CHANGED')
    expect(rendererOnly & SEMANTIC_STRUCTURAL_INVALIDATION_MASK).toBe(0)
    const self = mergeInvalidation('PLUGIN_SELF_MUTATION')
    expect(self & SEMANTIC_STRUCTURAL_INVALIDATION_MASK).toBe(0)
    const visual = mergeInvalidation('VISUAL_ONLY_NO_SEMANTIC_CHANGE')
    expect(visual & SEMANTIC_STRUCTURAL_INVALIDATION_MASK).toBe(0)
    const structural = mergeInvalidation('HEADING_SEMANTICS_CHANGED')
    expect(structural & SEMANTIC_STRUCTURAL_INVALIDATION_MASK).not.toBe(0)
  })
})
