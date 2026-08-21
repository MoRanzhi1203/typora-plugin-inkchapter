/**
 * DocumentNumberingCoordinator (Phase 6B) — production orchestration for
 * Figure/Table/Code numbering.
 *
 * It owns ONLY orchestration: subscribing to the canonical HeadingNumberingSnapshot
 * lifecycle (COMMITTED / INVALIDATED), coalescing rapid events into a single
 * reconcile, validating document identity, and triggering the CaptionService's
 * full-logical recompute + idempotent projection.
 *
 * It is NOT a second semantic heading authority and does NOT reimplement the
 * desired-state computation — that lives in the CaptionService (via the
 * caption-semantic-bridge) and its idempotent reconciliation.
 */

import type { HeadingNumberingSnapshot } from './heading-numbering-snapshot'

export type ReconcileReason =
  | 'initial-reconcile'
  | 'snapshot-commit'
  | 'snapshot-invalidated'
  | 'object-mutation'
  | 'config-change'

export interface DocumentNumberingCoordinatorDeps {
  getDocumentKey: () => string | null
  getSnapshot: () => HeadingNumberingSnapshot | null
  /** Trigger the CaptionService full recompute + idempotent projection. */
  refresh: (reasons: ReconcileReason[]) => void
  onSnapshotCommit: (cb: () => void) => () => void
  onSnapshotInvalidate: (cb: () => void) => () => void
}

export class DocumentNumberingCoordinator {
  private pendingReasons = new Set<ReconcileReason>()
  private reconcileScheduled = false
  private projecting = false
  private disposed = false
  private unsubscribes: (() => void)[] = []

  constructor(private readonly deps: DocumentNumberingCoordinatorDeps) {
    this.unsubscribes.push(deps.onSnapshotCommit(() => this.schedule('snapshot-commit')))
    this.unsubscribes.push(deps.onSnapshotInvalidate(() => this.schedule('snapshot-invalidated')))
    this.schedule('initial-reconcile')
  }

  /** Event coalescing: multiple synchronous reasons collapse into one microtask reconcile. */
  schedule(reason: ReconcileReason): void {
    if (this.disposed) return
    this.pendingReasons.add(reason)
    if (this.reconcileScheduled) return
    this.reconcileScheduled = true
    queueMicrotask(() => {
      this.reconcileScheduled = false
      const reasons = [...this.pendingReasons]
      this.pendingReasons.clear()
      this.reconcile(reasons)
    })
  }

  /** True while the CaptionService projection is running (minimal loop guard). */
  isProjectionActive(): boolean {
    return this.projecting
  }

  private reconcile(reasons: ReconcileReason[]): void {
    if (this.disposed) return
    const docKey = this.deps.getDocumentKey()
    const snapshot = this.deps.getSnapshot()
    // Never project across documents; defer until a current snapshot exists.
    if (!docKey || !snapshot || snapshot.documentKey !== docKey) return

    this.projecting = true
    try {
      this.deps.refresh(reasons)
    } finally {
      this.projecting = false
    }
  }

  dispose(): void {
    this.disposed = true
    for (const u of this.unsubscribes) u()
    this.unsubscribes = []
  }
}
