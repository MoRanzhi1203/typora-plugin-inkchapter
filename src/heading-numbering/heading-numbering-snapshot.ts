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
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'

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

  commit(
    headings: readonly HeadingDescriptor[],
    settings: HeadingNumberingSettings,
    overrideMap?: HeadingOverrideMap,
    counterPolicy?: UnnumberedCounterPolicy,
    documentKey?: string | null,
  ): HeadingNumberingSnapshot {
    const key = documentKey ?? ''
    const snapshot = buildHeadingNumberingSnapshotForRevision(
      headings,
      settings,
      overrideMap,
      counterPolicy,
      ++this.revision,
      key,
    )
    this.currentSnapshot = snapshot
    this.currentDocumentKey = key
    this.emitStrictBoundaryAudit(snapshot)
    this.notify(snapshot, 'COMMITTED')
    return snapshot
  }

  /**
   * Phase 7R.3.7: STRICT-NUMBERING-BOUNDARY audit — walks the canonical
   * semantic states in document order and records every strict H1 boundary
   * transition (OPEN_BOUNDARY / CONTINUE_BOUNDARY). Diagnostic only; the
   * boundary identity itself is carried by each SemanticHeadingNumberState.
   */
  private emitStrictBoundaryAudit(snapshot: HeadingNumberingSnapshot): void {
    if (snapshot.structureMode !== 'strict') return
    let previousBoundaryIdentity: string | null = null
    for (const s of snapshot.semantic) {
      if (s.physicalLevel !== 1) {
        emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY', {
          documentKey: snapshot.documentKey,
          headingStableIdentity: s.stableIdentity,
          physicalLevel: s.physicalLevel,
          strictBoundaryIdentity: s.strictBoundaryIdentity,
          previousBoundaryIdentity,
          decision: 'CONTINUE_BOUNDARY',
        })
        continue
      }
      emitRuntimeAudit('STRICT-NUMBERING-BOUNDARY', {
        documentKey: snapshot.documentKey,
        headingStableIdentity: s.stableIdentity,
        physicalLevel: 1,
        strictBoundaryIdentity: s.strictBoundaryIdentity,
        previousBoundaryIdentity,
        decision: 'OPEN_BOUNDARY',
      })
      previousBoundaryIdentity = s.strictBoundaryIdentity
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
