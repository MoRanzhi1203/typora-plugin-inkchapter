/**
 * Heading Semantic Performance Counters (Phase 7R.3.8-H)
 *
 * Session-scoped, bounded counters that separate "semantic recompute attempted"
 * from "canonical semantic state actually changed", plus boundary-audit volume.
 * Emits exactly ONE `HEADING-SEMANTIC-PERF-SUMMARY` per report() call.
 *
 * These counters are DIAGNOSTIC ONLY — they never gate or block numbering.
 */

import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

export interface HeadingSemanticPerfCounters {
  /** Number of semantic recompute attempts (headingAuthority.commit calls). */
  semanticRecomputeAttemptCount: number
  /** Commits where the semantic fingerprint actually changed. */
  semanticCommitChangedCount: number
  /** Commits where the semantic fingerprint was unchanged (no-op). */
  semanticCommitUnchangedCount: number
  /** Times the canonical semantic snapshot revision advanced. */
  semanticRevisionAdvanceCount: number
  /** Times the revision advanced despite an UNCHANGED fingerprint (MUST stay 0). */
  semanticNoopRevisionAdvanceCount: number
  /** Times semantic snapshot subscribers were notified (broadcast per changed commit). */
  semanticSubscriberNotifyCount: number
  /** STRICT-NUMBERING-BOUNDARY-SUMMARY records emitted. */
  strictBoundarySummaryCount: number
  /** Per-heading STRICT-NUMBERING-BOUNDARY detailed records emitted. */
  strictBoundaryDetailedRecordCount: number
  /** Caption full semantic reconcile executions. */
  captionSemanticReconcileCount: number
  /** Formula semantic plan builds. */
  formulaSemanticPlanBuildCount: number
}

const zero: HeadingSemanticPerfCounters = {
  semanticRecomputeAttemptCount: 0,
  semanticCommitChangedCount: 0,
  semanticCommitUnchangedCount: 0,
  semanticRevisionAdvanceCount: 0,
  semanticNoopRevisionAdvanceCount: 0,
  semanticSubscriberNotifyCount: 0,
  strictBoundarySummaryCount: 0,
  strictBoundaryDetailedRecordCount: 0,
  captionSemanticReconcileCount: 0,
  formulaSemanticPlanBuildCount: 0,
}

const counters: HeadingSemanticPerfCounters = { ...zero }

export function getHeadingSemanticPerfCounters(): HeadingSemanticPerfCounters {
  return { ...counters }
}

export function resetHeadingSemanticPerfCounters(): void {
  Object.assign(counters, zero)
}

export function incHeadingSemanticPerf<K extends keyof HeadingSemanticPerfCounters>(field: K, delta = 1): void {
  counters[field] += delta
}

/** Emit the bounded HEADING-SEMANTIC-PERF-SUMMARY for the given document. */
export function emitHeadingSemanticPerfSummary(documentKey: string | null): HeadingSemanticPerfCounters {
  const c = { ...counters }
  emitRuntimeAudit('HEADING-SEMANTIC-PERF-SUMMARY', {
    documentKey: documentKey ?? 'none',
    semanticRecomputeAttemptCount: c.semanticRecomputeAttemptCount,
    semanticCommitChangedCount: c.semanticCommitChangedCount,
    semanticCommitUnchangedCount: c.semanticCommitUnchangedCount,
    semanticRevisionAdvanceCount: c.semanticRevisionAdvanceCount,
    semanticNoopRevisionAdvanceCount: c.semanticNoopRevisionAdvanceCount,
    semanticSubscriberNotifyCount: c.semanticSubscriberNotifyCount,
    strictBoundarySummaryCount: c.strictBoundarySummaryCount,
    strictBoundaryDetailedRecordCount: c.strictBoundaryDetailedRecordCount,
    captionSemanticReconcileCount: c.captionSemanticReconcileCount,
    formulaSemanticPlanBuildCount: c.formulaSemanticPlanBuildCount,
    decision: 'REPORTED',
  })
  return c
}
