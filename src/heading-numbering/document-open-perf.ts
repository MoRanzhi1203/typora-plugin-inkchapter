/**
 * Document-Open Performance Transaction (Phase 7R.3.4-A)
 *
 * ONE low-noise transaction per document epoch. Tracks the initial open
 * critical path T0..T8 and reconcile/scan counters, then emits exactly ONE
 * `INKCHAPTER-DOCUMENT-OPEN-PERF` summary when the pipeline stabilizes.
 *
 * Counting is intentionally bounded and does NOT block the projection path.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export interface DocumentOpenPerfCounters {
  headingSnapshotEventCount: number
  coordinatorScheduleCount: number
  coordinatorExecutionCount: number
  fullCaptionScanCount: number
  formulaPlanBuildCount: number
  formulaVisibleForensicCount: number
  formulaVisibleVerifyCount: number
  mathJaxHookInstallAttemptCount: number
  mathJaxHookInstallSuccessCount: number
  controlledFormulaRerenderCount: number
  semanticNoopSkipCount: number
  projectionNoopSkipCount: number
  selfMutationSkipCount: number
}

const T_KEY = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'] as const
export type PerfMilestoneKey = (typeof T_KEY)[number]

export class DocumentOpenPerfTracker {
  private epochValue = 0
  private documentKey: string | null = null
  private startedAt = 0
  private marks = new Map<PerfMilestoneKey, number>()
  private counters: DocumentOpenPerfCounters = this.zeroCounters()
  private finalized = false

  private zeroCounters(): DocumentOpenPerfCounters {
    return {
      headingSnapshotEventCount: 0,
      coordinatorScheduleCount: 0,
      coordinatorExecutionCount: 0,
      fullCaptionScanCount: 0,
      formulaPlanBuildCount: 0,
      formulaVisibleForensicCount: 0,
      formulaVisibleVerifyCount: 0,
      mathJaxHookInstallAttemptCount: 0,
      mathJaxHookInstallSuccessCount: 0,
      controlledFormulaRerenderCount: 0,
      semanticNoopSkipCount: 0,
      projectionNoopSkipCount: 0,
      selfMutationSkipCount: 0,
    }
  }

  /** Begin a new document epoch (returns the epoch id). */
  beginEpoch(documentKey: string | null): number {
    this.epochValue++
    this.documentKey = documentKey
    this.startedAt = Date.now()
    this.marks.clear()
    this.counters = this.zeroCounters()
    this.finalized = false
    this.mark('T0')
    return this.epochValue
  }

  epoch(): number {
    return this.epochValue
  }

  mark(key: PerfMilestoneKey, at = Date.now()): void {
    if (this.finalized) return
    if (!this.marks.has(key)) this.marks.set(key, at)
  }

  private count(field: keyof DocumentOpenPerfCounters, delta = 1): void {
    if (this.finalized) return
    this.counters[field] += delta
  }

  incHeadingSnapshotEvent(): void { this.count('headingSnapshotEventCount') }
  incCoordinatorSchedule(): void { this.count('coordinatorScheduleCount') }
  incCoordinatorExecution(): void { this.count('coordinatorExecutionCount') }
  incFullCaptionScan(): void { this.count('fullCaptionScanCount') }
  incFormulaPlanBuild(): void { this.count('formulaPlanBuildCount') }
  incFormulaVisibleForensic(): void { this.count('formulaVisibleForensicCount') }
  incFormulaVisibleVerify(): void { this.count('formulaVisibleVerifyCount') }
  incHookInstallAttempt(): void { this.count('mathJaxHookInstallAttemptCount') }
  incHookInstallSuccess(): void { this.count('mathJaxHookInstallSuccessCount') }
  incControlledRerender(): void { this.count('controlledFormulaRerenderCount') }
  incSemanticNoopSkip(): void { this.count('semanticNoopSkipCount') }
  incProjectionNoopSkip(): void { this.count('projectionNoopSkipCount') }
  incSelfMutationSkip(): void { this.count('selfMutationSkipCount') }

  /** Counters snapshot (tests / diagnostics). */
  snapshot(): { epoch: number; documentKey: string | null; counters: DocumentOpenPerfCounters } {
    return { epoch: this.epochValue, documentKey: this.documentKey, counters: { ...this.counters } }
  }

  private ms(from: PerfMilestoneKey | 'START', to: PerfMilestoneKey): number | null {
    const a = from === 'START' ? this.startedAt : this.marks.get(from)
    const b = this.marks.get(to)
    if (a === undefined || b === undefined) return null
    return Math.max(0, b - a)
  }

  /** Emit the single per-epoch summary; idempotent. */
  finalize(documentKey: string | null = this.documentKey): void {
    if (this.finalized) return
    this.finalized = true
    this.mark('T8')
    const doc = documentKey ?? this.documentKey ?? 'none'
    emitRuntimeAudit('INKCHAPTER-DOCUMENT-OPEN-PERF', {
      documentEpoch: this.epochValue,
      documentKey: doc,
      openToContextReadyMs: this.ms('START', 'T1'),
      contextToHeadingSnapshotMs: this.ms('T1', 'T2'),
      contextToObjectPlanMs: this.ms('T1', 'T3'),
      contextToFormulaPlanMs: this.ms('T1', 'T5'),
      formulaPlanToFirstMathJaxCallMs: this.ms('T5', 'T6'),
      openToFirstNonFormulaProjectionMs: this.ms('START', 'T4'),
      openToFirstFormulaSemanticCommitMs: this.ms('START', 'T7'),
      openToStableMs: this.ms('START', 'T8'),
      headingSnapshotEventCount: this.counters.headingSnapshotEventCount,
      coordinatorScheduleCount: this.counters.coordinatorScheduleCount,
      coordinatorExecutionCount: this.counters.coordinatorExecutionCount,
      fullCaptionScanCount: this.counters.fullCaptionScanCount,
      formulaPlanBuildCount: this.counters.formulaPlanBuildCount,
      formulaVisibleForensicCount: this.counters.formulaVisibleForensicCount,
      formulaVisibleVerifyCount: this.counters.formulaVisibleVerifyCount,
      mathJaxHookInstallAttemptCount: this.counters.mathJaxHookInstallAttemptCount,
      mathJaxHookInstallSuccessCount: this.counters.mathJaxHookInstallSuccessCount,
      controlledFormulaRerenderCount: this.counters.controlledFormulaRerenderCount,
      semanticNoopSkipCount: this.counters.semanticNoopSkipCount,
      projectionNoopSkipCount: this.counters.projectionNoopSkipCount,
      selfMutationSkipCount: this.counters.selfMutationSkipCount,
      decision: 'MEASURED',
    })
  }

  isFinalized(): boolean {
    return this.finalized
  }
}

/** Whether verbose per-target forensic records should be emitted. */
export function forensicVerboseEnabled(): boolean {
  try {
    const g = globalThis as { __inkchapter_forensic_verbose__?: unknown }
    return g.__inkchapter_forensic_verbose__ === true
  } catch {
    return false
  }
}

// ── Active tracker registry (allows the MathJax hook to mark milestones) ──

let activePerfTracker: DocumentOpenPerfTracker | null = null

export function registerActivePerfTracker(tracker: DocumentOpenPerfTracker | null): void {
  activePerfTracker = tracker
}

export function getActivePerfTracker(): DocumentOpenPerfTracker | null {
  return activePerfTracker
}
