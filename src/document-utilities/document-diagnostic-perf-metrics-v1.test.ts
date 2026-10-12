/**
 * TRAE §4.7 — Document-diagnostics performance metrics (bounded P95).
 */
import { describe, it, expect } from 'vitest'
import {
  DIAGNOSTIC_PERF_WINDOW,
  DiagnosticPerfAccumulator,
  percentileMs,
} from './document-diagnostic-perf-metrics-v1'

describe('TRAE §4.7 — DiagnosticPerfAccumulator', () => {
  it('percentileMs uses nearest-rank and handles empty / unsorted input', () => {
    expect(percentileMs([], 0.95)).toBe(0)
    expect(percentileMs([5], 0.95)).toBe(5)
    // 1..100 → P95 = 95, P50 = 50.
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentileMs(oneToHundred, 0.95)).toBe(95)
    expect(percentileMs(oneToHundred, 0.5)).toBe(50)
    expect(percentileMs([3, 1, 2], 0.95)).toBe(3)
  })

  it('keeps a BOUNDED window per phase and reports avg / P50 / P95 / max', () => {
    const perf = new DiagnosticPerfAccumulator(4)
    for (const ms of [10, 20, 30, 40, 50]) perf.record('semanticDetect', ms)
    const [series] = perf.series()
    expect(series.phase).toBe('semanticDetect')
    expect(series.count).toBe(4) // 10 was evicted by the bounded window
    expect(series.avgMs).toBe(35) // (20+30+40+50)/4
    expect(series.p50Ms).toBe(30)
    expect(series.p95Ms).toBe(50)
    expect(series.maxMs).toBe(50)
  })

  it('ignores non-finite / negative samples and is empty until something is recorded', () => {
    const perf = new DiagnosticPerfAccumulator()
    expect(perf.series()).toEqual([])
    perf.record('visualCommit', Number.NaN)
    perf.record('visualCommit', -1)
    expect(perf.series()).toEqual([])
    perf.record('visualCommit', 12.345)
    expect(perf.series()[0].maxMs).toBe(12.35)
    perf.reset()
    expect(perf.series()).toEqual([])
  })

  it('defaults to the declared bounded window', () => {
    const perf = new DiagnosticPerfAccumulator()
    for (let i = 0; i < DIAGNOSTIC_PERF_WINDOW + 20; i++) perf.record('listRefresh', i)
    expect(perf.series()[0].count).toBe(DIAGNOSTIC_PERF_WINDOW)
  })
})
