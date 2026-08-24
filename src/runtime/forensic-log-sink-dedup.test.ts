/**
 * Phase 7R.3.11.7 — audit noise consolidation (state-token dedup).
 *
 * LOG-NOISE-1  20 consecutive identical NO_VISIBLE_OUTLINE_ROOT states →
 *              emitted ≤ 1, suppressed = 19 (delta)
 * LOG-NOISE-2  state transition visible=false → true MUST re-emit
 * LOG-NOISE-3  warn/error levels are NEVER deduped (authority preserved)
 * LOG-NOISE-4  regular emitRuntimeAudit is never deduped (write/identity path)
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  emitRuntimeAuditStateDedup,
  emitRuntimeAudit,
  getAuditDedupCounters,
  resetAuditStateDedup,
} from './forensic-log-sink'

afterEach(() => {
  resetAuditStateDedup()
  vi.restoreAllMocks()
})

function emittedCountFor(event: string, infoSpy: { mock: { calls: Array<Array<unknown>> } }): number {
  return infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event)).length
}

describe('LOG-NOISE — state-token dedup', () => {
  it('LOG-NOISE-1: 20 identical NO_VISIBLE_OUTLINE_ROOT → 1 full log + 19 suppressed', () => {
    const event = 'LOG-NOISE-1-WAIT'
    const base = getAuditDedupCounters()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    for (let i = 0; i < 20; i++) {
      emitRuntimeAuditStateDedup(
        event,
        `doc-a|3|NO_VISIBLE_OUTLINE_ROOT`,
        { decision: 'DEFER', reason: 'NO_VISIBLE_OUTLINE_ROOT' },
      )
    }

    const calls = emittedCountFor(event, infoSpy)
    expect(calls).toBeLessThanOrEqual(1)
    const after = getAuditDedupCounters()
    expect(after.emittedInfoLogCount - base.emittedInfoLogCount).toBe(1)
    expect(after.suppressedInfoLogCount - base.suppressedInfoLogCount).toBe(19)
    infoSpy.mockRestore()
  })

  it('LOG-NOISE-2: state transition visible=false → true re-emits', () => {
    const event = 'LOG-NOISE-2-CAND'
    const base = getAuditDedupCounters()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    emitRuntimeAuditStateDedup(event, 'false|false', { found: false, visible: false })
    emitRuntimeAuditStateDedup(event, 'false|false', { found: false, visible: false })
    emitRuntimeAuditStateDedup(event, 'true|true', { found: true, visible: true }) // transition

    const calls = emittedCountFor(event, infoSpy)
    expect(calls).toBe(2)
    const after = getAuditDedupCounters()
    expect(after.emittedInfoLogCount - base.emittedInfoLogCount).toBe(2)
    expect(after.suppressedInfoLogCount - base.suppressedInfoLogCount).toBe(1)
    infoSpy.mockRestore()
  })

  it('LOG-NOISE-3: warn/error levels are never deduped (authority preserved)', () => {
    const base = getAuditDedupCounters()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Identical payloads THREE times each — every one must be emitted.
    for (let i = 0; i < 3; i++) {
      emitRuntimeAudit('LOG-NOISE-3-WARN', { decision: 'FAIL' }, 'warn')
      emitRuntimeAudit('LOG-NOISE-3-ERR', { decision: 'FAIL' }, 'error')
    }

    expect(warnSpy.mock.calls.length).toBe(3)
    expect(errSpy.mock.calls.length).toBe(3)
    const after = getAuditDedupCounters()
    expect(after.warnAuditCount - base.warnAuditCount).toBe(3)
    expect(after.errorAuditCount - base.errorAuditCount).toBe(3)
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('LOG-NOISE-4: regular emitRuntimeAudit is never deduped (write/identity path)', () => {
    const event = 'LOG-NOISE-4-WRITE'
    const base = getAuditDedupCounters()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // Identical payload THREE times via the NON-dedup facade → all emitted.
    for (let i = 0; i < 3; i++) {
      emitRuntimeAudit(event, { decision: 'WRITTEN', documentKey: 'doc-a' })
    }

    const calls = emittedCountFor(event, infoSpy)
    expect(calls).toBe(3)
    expect(getAuditDedupCounters().suppressedInfoLogCount - base.suppressedInfoLogCount).toBe(0)
    infoSpy.mockRestore()
  })

  it('LOG-NOISE-5: resetAuditStateDedup() clears a token → identical state re-emits', () => {
    const event = 'LOG-NOISE-5-TOKEN'
    const base = getAuditDedupCounters()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    emitRuntimeAuditStateDedup(event, 'token|A', { reason: 'A' })
    emitRuntimeAuditStateDedup(event, 'token|A', { reason: 'A' }) // suppressed
    resetAuditStateDedup(event)
    emitRuntimeAuditStateDedup(event, 'token|A', { reason: 'A' }) // re-emitted after reset

    const calls = emittedCountFor(event, infoSpy)
    expect(calls).toBe(2)
    expect(getAuditDedupCounters().suppressedInfoLogCount - base.suppressedInfoLogCount).toBe(1)
    infoSpy.mockRestore()
  })
})
