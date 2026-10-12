/**
 * TRAE §4.7 — Document-diagnostics PERFORMANCE METRICS (pure contract).
 *
 * Records per-phase durations for the stages that MUST stay separated
 * (semantic detection / layout measure / list refresh / visual commit) plus the
 * locate transaction total, and reports avg / P50 / P95 / max over a BOUNDED
 * window. A bounded window (never an unbounded array, never a poll) keeps the
 * memory flat while the P95 still exposes the tail of a slow layout frame.
 *
 * Pure: no DOM, no timers, no host state.
 */

export type DiagnosticPerfPhase =
  | 'semanticDetect'
  | 'layoutMeasure'
  | 'listRefresh'
  | 'visualCommit'
  | 'transactionTotal'

export const DIAGNOSTIC_PERF_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-PERF-SUMMARY'
/** Bounded ring size per phase (a single slow frame can never be averaged away). */
export const DIAGNOSTIC_PERF_WINDOW = 128

export interface DiagnosticPerfSeries {
  phase: DiagnosticPerfPhase
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

/**
 * Nearest-rank percentile (0..1) over a copy of the samples. `p=0.95` returns the
 * smallest value that is >= 95% of the samples (the standard P95 definition).
 */
export function percentileMs(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[rank]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export class DiagnosticPerfAccumulator {
  private readonly samples = new Map<DiagnosticPerfPhase, number[]>()

  constructor(private readonly window: number = DIAGNOSTIC_PERF_WINDOW) {}

  /** Record one duration (ms). Non-finite / negative samples are ignored. */
  record(phase: DiagnosticPerfPhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    let arr = this.samples.get(phase)
    if (!arr) {
      arr = []
      this.samples.set(phase, arr)
    }
    arr.push(ms)
    if (arr.length > this.window) arr.splice(0, arr.length - this.window)
  }

  /** The per-phase avg / P50 / P95 / max summary over the bounded window. */
  series(): DiagnosticPerfSeries[] {
    const out: DiagnosticPerfSeries[] = []
    for (const [phase, arr] of this.samples) {
      if (arr.length === 0) continue
      const sum = arr.reduce((a, b) => a + b, 0)
      out.push({
        phase,
        count: arr.length,
        avgMs: round2(sum / arr.length),
        p50Ms: round2(percentileMs(arr, 0.5)),
        p95Ms: round2(percentileMs(arr, 0.95)),
        maxMs: round2(Math.max(...arr)),
      })
    }
    return out
  }

  reset(): void {
    this.samples.clear()
  }
}
