/**
 * Heading Numbering Snapshot — the atomic authority boundary that publishes, in
 * one revision, BOTH the physical numbered headings AND the canonical semantic
 * heading states, computed from the SAME source inputs.
 *
 * Two layers:
 *   - `buildHeadingNumberingSnapshotForRevision` is the PURE builder (accepts an
 *     explicit revision for unit-testing only);
 *   - `HeadingNumberingAuthority` is the production publisher that OWNS the
 *     monotonic revision and the current published snapshot. Callers cannot
 *     choose the revision. It also OWNS document transition invalidation and
 *     snapshot commit/invalidate event publication.
 */

import type {
  HeadingDescriptor,
  HeadingNumberingSettings,
  NumberedHeading,
  UnnumberedCounterPolicy,
} from './heading-types'
import { computeHeadingNumbering, type HeadingOverrideMap } from './numbering-engine'
import { resolveHeadingStructure } from './heading-structure'
import { computeSemanticHeadingNumbers, resolveSemanticStartAt } from './semantic-heading-numbering'
import type { HeadingStructureMode, SemanticHeadingNumberState } from './semantic-heading-types'
import { computeHeadingSemanticFingerprint } from './numbering-fast-path'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import { forensicVerboseEnabled } from './document-open-perf'
import {
  incHeadingSemanticPerf,
} from './heading-semantic-perf'

export interface HeadingNumberingSnapshot {
  /** Document identity this snapshot was computed for. */
  documentKey: string
  /** Monotonic revision allocated by the authority. */
  revision: number
  structureMode: HeadingStructureMode
  /** The FULL source heading descriptors (unfiltered by maxDepth). */
  headings: readonly HeadingDescriptor[]
  /** Physical numbered headings (filtered by maxDepth, for display). */
  physical: readonly NumberedHeading[]
  /** Canonical semantic heading states (full structural tree, all depths). */
  semantic: readonly SemanticHeadingNumberState[]
}

export type HeadingSnapshotChangeReason =
  | 'COMMITTED'
  | 'INVALIDATED_DOCUMENT_SWITCH'
  | 'INVALIDATED_DOCUMENT_CLOSED'

export type HeadingSnapshotListener = (
  snapshot: HeadingNumberingSnapshot | null,
  reason: HeadingSnapshotChangeReason,
) => void

/**
 * PURE builder: compute one physical + semantic snapshot for an explicit
 * revision and document key. Intended for unit tests; production must use
 * `HeadingNumberingAuthority.commit`.
 */
export function buildHeadingNumberingSnapshotForRevision(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
  overrideMap?: HeadingOverrideMap,
  counterPolicy?: UnnumberedCounterPolicy,
  revision = 1,
  documentKey = '',
): HeadingNumberingSnapshot {
  const structureMode = resolveHeadingStructure(settings).mode

  const physical = computeHeadingNumbering(headings, settings, overrideMap, counterPolicy)
  const semantic = computeSemanticHeadingNumbers(headings, structureMode, {
    startAt: resolveSemanticStartAt(settings, structureMode),
    sourceRevision: revision,
    overrideMap,
    counterPolicy,
  })

  return { documentKey, revision, structureMode, headings, physical, semantic }
}

/**
 * Production heading-numbering authority. Owns the monotonic revision and the
 * current published snapshot, plus document-transition invalidation and
 * snapshot event publication.
 *
 * Lifecycle:
 *   commit(...)        → build + atomically publish, then notify COMMITTED.
 *   invalidate(key)    → clear current snapshot, then notify INVALIDATED.
 *   subscribe(listener)→ receive commit/invalidate events (returns unsubscribe).
 */
export class HeadingNumberingAuthority {
  private revision = 0
  private currentSnapshot: HeadingNumberingSnapshot | null = null
  private currentDocumentKey: string | null = null
  private listeners = new Set<HeadingSnapshotListener>()
  /** Phase 7R.3.8-D/E: last committed canonical semantic fingerprint. */
  private lastCommittedSemanticFingerprint: string | null = null

  commit(
    headings: readonly HeadingDescriptor[],
    settings: HeadingNumberingSettings,
    overrideMap?: HeadingOverrideMap,
    counterPolicy?: UnnumberedCounterPolicy,
    documentKey?: string | null,
  ): HeadingNumberingSnapshot {
    const key = documentKey ?? ''
    incHeadingSemanticPerf('semanticRecomputeAttemptCount')
    const candidate = buildHeadingNumberingSnapshotForRevision(
      headings,
      settings,
      overrideMap,
      counterPolicy,
      this.revision + 1,
      key,
    )
    const fingerprint = computeHeadingSemanticFingerprint(candidate)
    const unchanged = this.currentSnapshot !== null
      && this.currentDocumentKey === key
      && this.lastCommittedSemanticFingerprint === fingerprint

    if (unchanged) {
      // Phase 7R.3.8-E: semantic NO-OP — do NOT advance the revision, do NOT
      // notify semantic subscribers, do NOT re-emit the boundary audit. The
      // caller may still perform renderer-local repair via the returned
      // snapshot's physical labels.
      incHeadingSemanticPerf('semanticCommitUnchangedCount')
      return this.currentSnapshot as HeadingNumberingSnapshot
    }

    this.revision++
    incHeadingSemanticPerf('semanticCommitChangedCount')
    incHeadingSemanticPerf('semanticRevisionAdvanceCount')
    this.currentSnapshot = candidate
    this.currentDocumentKey = key
    this.lastCommittedSemanticFingerprint = fingerprint
    this.emitStrictBoundaryAudit(candidate, fingerprint)
    this.notify(candidate, 'COMMITTED')
    incHeadingSemanticPerf('semanticSubscriberNotifyCount')
    return candidate
  }

  /**
   * Phase 7R.3.7 + 7R.3.8-F: STRICT boundary audit.
   *
   * Normal mode emits ONE STRICT-NUMBERING-BOUNDARY-SUMMARY per actual semantic
   * commit. Per-heading OPEN/CONTINUE_BOUNDARY detail is emitted ONLY when
   * FORENSIC_VERBOSE=true. On hard boundary failures, targeted per-heading
   * failure records are emitted so diagnostics are never silently lost.
   */
  private emitStrictBoundaryAudit(snapshot: HeadingNumberingSnapshot, fingerprint: string): void {
    if (snapshot.structureMode !== 'strict') return
    const verbose = forensicVerboseEnabled()
    const boundaryIdentities: string[] = []
    let boundaryCount = 0
    let chapterCount = 0
    let sectionCount = 0
    let invalidStrictParentCount = 0
    let previousBoundaryIdentity: string | null = null
    const failures: Array<{ stableIdentity: string; physicalLevel: number; strictBoundaryIdentity: string | null; previousBoundaryIdentity: string | null; decision: string }> = []

    for (const s of snapshot.semantic) {
      if (s.physicalLevel === 1) {
        boundaryCount++
        boundaryIdentities.push(s.strictBoundaryIdentity ?? s.stableIdentity)
        if (previousBoundaryIdentity !== null && previousBoundaryIdentity === s.strictBoundaryIdentity) {
          failures.push({ stableIdentity: s.stableIdentity, physicalLevel: 1, strictBoundaryIdentity: s.strictBoundaryIdentity, previousBoundaryIdentity, decision: 'BOUNDARY_IDENTITY_NOT_ADVANCED' })
        }
        if (verbose) {
          incHeadingSemanticPerf('strictBoundaryDetailedRecordCount')
          emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY', {
            documentKey: snapshot.documentKey,
            headingStableIdentity: s.stableIdentity,
            physicalLevel: 1,
            strictBoundaryIdentity: s.strictBoundaryIdentity,
            previousBoundaryIdentity,
            decision: 'OPEN_BOUNDARY',
          })
        }
        previousBoundaryIdentity = s.strictBoundaryIdentity
        continue
      }
      if (s.semanticRole === 'chapter') chapterCount++
      if (s.semanticRole === 'section') sectionCount++
      // Strict missing-parent detection (no fabricated zero path): a heading at
      // physical level L>=3 requires ordinalByDepth parents [0..L-3].
      if (s.physicalLevel >= 3) {
        const requiredParents = s.physicalLevel - 2
        let missing = false
        for (let i = 0; i < requiredParents; i++) {
          if (s.ordinalByDepth[i] === null) { missing = true; break }
        }
        if (missing) {
          invalidStrictParentCount++
          failures.push({ stableIdentity: s.stableIdentity, physicalLevel: s.physicalLevel, strictBoundaryIdentity: s.strictBoundaryIdentity, previousBoundaryIdentity, decision: 'INVALID_STRICT_PARENT' })
        }
      }
      if (verbose) {
        incHeadingSemanticPerf('strictBoundaryDetailedRecordCount')
        emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY', {
          documentKey: snapshot.documentKey,
          headingStableIdentity: s.stableIdentity,
          physicalLevel: s.physicalLevel,
          strictBoundaryIdentity: s.strictBoundaryIdentity,
          previousBoundaryIdentity,
          decision: 'CONTINUE_BOUNDARY',
        })
      }
    }

    incHeadingSemanticPerf('strictBoundarySummaryCount')
    emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY-SUMMARY', {
      documentKey: snapshot.documentKey,
      semanticRevision: snapshot.revision,
      semanticFingerprint: fingerprint,
      headingCount: snapshot.semantic.length,
      boundaryCount,
      boundaryIdentities,
      chapterCount,
      sectionCount,
      invalidStrictParentCount,
      zeroFillSuppressedCount: invalidStrictParentCount,
      decision: 'SEMANTIC_CHANGED',
    })

    // Hard failure escalation: emit targeted per-heading failure records so
    // failure diagnostics are available even in normal (non-verbose) mode.
    for (const f of failures) {
      incHeadingSemanticPerf('strictBoundaryDetailedRecordCount')
      emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY', {
        documentKey: snapshot.documentKey,
        headingStableIdentity: f.stableIdentity,
        physicalLevel: f.physicalLevel,
        strictBoundaryIdentity: f.strictBoundaryIdentity,
        previousBoundaryIdentity: f.previousBoundaryIdentity,
        decision: f.decision,
      })
    }
  }

  /**
   * Proactively invalidate the current snapshot on document transition. After
   * this, getCurrent() returns null until the next commit.
   */
  invalidate(nextDocumentKey?: string | null): void {
    const key = nextDocumentKey ?? null
    this.currentSnapshot = null
    this.currentDocumentKey = key
    this.lastCommittedSemanticFingerprint = null
    this.notify(null, 'INVALIDATED_DOCUMENT_SWITCH')
  }

  getCurrent(): HeadingNumberingSnapshot | null {
    return this.currentSnapshot
  }

  getCurrentRevision(): number {
    return this.revision
  }

  getCurrentDocumentKey(): string | null {
    return this.currentDocumentKey
  }

  /** Phase 7R.3.8-D: last committed canonical semantic fingerprint (diagnostics). */
  getLastCommittedSemanticFingerprint(): string | null {
    return this.lastCommittedSemanticFingerprint
  }

  subscribe(listener: HeadingSnapshotListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(snapshot: HeadingNumberingSnapshot | null, reason: HeadingSnapshotChangeReason): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot, reason)
      } catch {
        // Listener errors must not break the authority publish.
      }
    }
  }
}
