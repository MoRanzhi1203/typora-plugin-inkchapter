/**
 * Numbering Reconcile Scheduler (Phase 7R.3.4-B)
 *
 * ONE production scheduling authority for object/caption/formula recompute.
 *
 * Properties:
 *   - Multiple requests in the same document epoch coalesce into ONE pending
 *     reconcile (invalidation reasons merged via a bit mask).
 *   - Executor runs via ONE queued microtask (no debounce / timer).
 *   - MAX_CONCURRENT_RECONCILE_EXECUTION = 1.
 *   - Requests arriving DURING execution mark rerunNeeded; at most ONE
 *     follow-up reconcile is scheduled afterwards.
 *   - The executor captures {documentEpoch, documentKey}; a stale transaction
 *     (epoch/doc changed before DOM write) is aborted by the executor.
 */

export const RECONCILE_INVALIDATION = {
  DOCUMENT_IDENTITY_CHANGED: 1 << 0,
  HEADING_SEMANTICS_CHANGED: 1 << 1,
  FORMULA_SOURCE_CHANGED: 1 << 2,
  OBJECT_STRUCTURE_CHANGED: 1 << 3,
  SETTINGS_CHANGED: 1 << 4,
  RENDERER_OUTPUT_CHANGED: 1 << 5,
  PLUGIN_SELF_MUTATION: 1 << 6,
  VISUAL_ONLY_NO_SEMANTIC_CHANGE: 1 << 7,
  /** Phase 7R.3.6: genuine logical Formula host add/remove (canonical, complete). */
  FORMULA_STRUCTURE_CHANGED: 1 << 8,
} as const

export type ReconcileInvalidationKey = keyof typeof RECONCILE_INVALIDATION

export const RECONCILE_INVALIDATION_KEYS = Object.keys(RECONCILE_INVALIDATION) as ReconcileInvalidationKey[]

/** Structural/semantic invalidation classes that defeat the no-op fast path. */
export const SEMANTIC_STRUCTURAL_INVALIDATION_MASK =
  RECONCILE_INVALIDATION.DOCUMENT_IDENTITY_CHANGED |
  RECONCILE_INVALIDATION.HEADING_SEMANTICS_CHANGED |
  RECONCILE_INVALIDATION.FORMULA_SOURCE_CHANGED |
  RECONCILE_INVALIDATION.OBJECT_STRUCTURE_CHANGED |
  RECONCILE_INVALIDATION.SETTINGS_CHANGED |
  RECONCILE_INVALIDATION.FORMULA_STRUCTURE_CHANGED

export interface PendingNumberingReconcile {
  documentEpoch: number
  documentKey: string
  invalidationMask: number
  reasons: Set<string>
}

export interface ReconcileRequestInput {
  reason: string
  invalidation: ReconcileInvalidationKey | ReconcileInvalidationKey[]
  documentEpoch: number
  documentKey: string | null
}

export type ReconcileExecutor = (pending: PendingNumberingReconcile) => void

export function mergeInvalidation(
  invalidation: ReconcileInvalidationKey | ReconcileInvalidationKey[],
): number {
  const keys = Array.isArray(invalidation) ? invalidation : [invalidation]
  let mask = 0
  for (const k of keys) mask |= RECONCILE_INVALIDATION[k]
  return mask
}

/**
 * Pure, framework-agnostic coalescing scheduler. The executor is invoked
 * exactly once per flushed batch (per microtask) unless a follow-up is
 * required because a request arrived during execution.
 */
export class NumberingReconcileScheduler {
  private pending: PendingNumberingReconcile | null = null
  private scheduled = false
  private executing = false
  private rerunNeeded = false
  private executor: ReconcileExecutor | null = null
  private disposeFn: (() => void) | null = null
  private scheduleRunner: ((run: () => void) => void) | null = null

  /** Install the executor and (optionally) a custom microtask scheduler. */
  attach(executor: ReconcileExecutor, schedule: (run: () => void) => void = run => queueMicrotask(run)): void {
    this.executor = executor
    this.scheduleRunner = schedule
  }

  request(input: ReconcileRequestInput): { coalesced: boolean; pending: PendingNumberingReconcile } {
    const epoch = input.documentEpoch
    const docKey = input.documentKey ?? ''
    const mask = mergeInvalidation(input.invalidation)

    if (this.pending && this.pending.documentEpoch === epoch && this.pending.documentKey === docKey) {
      // Same epoch → merge reasons/invalidation; DO NOT schedule a second executor.
      this.pending.invalidationMask |= mask
      this.pending.reasons.add(input.reason)
      return { coalesced: true, pending: this.pending }
    }

    // New epoch / document — replace the pending request. The single scheduled
    // microtask will run the latest transaction (stale ones abort via epoch).
    this.pending = {
      documentEpoch: epoch,
      documentKey: docKey,
      invalidationMask: mask,
      reasons: new Set([input.reason]),
    }
    if (!this.scheduled && !this.executing) this.scheduleRun()
    else if (this.executing) this.rerunNeeded = true
    return { coalesced: false, pending: this.pending }
  }

  /** True when a reconcile is currently executing (MAX_CONCURRENT=1). */
  isExecuting(): boolean {
    return this.executing
  }

  /** Whether the scheduler is holding a pending request. */
  hasPending(): boolean {
    return this.pending !== null
  }

  /** For synchronous tests: run the pending transaction immediately. */
  flushNow(): boolean {
    if (!this.pending || !this.executor) return false
    const pending = this.pending
    this.pending = null
    this.scheduled = false
    this.runExecutor(pending)
    return true
  }

  dispose(): void {
    this.pending = null
    this.scheduled = false
    this.executing = false
    this.rerunNeeded = false
    if (this.disposeFn) {
      try { this.disposeFn() } catch { /* ignore */ }
      this.disposeFn = null
    }
  }

  private scheduleRun(): void {
    this.scheduled = true
    const run = (): void => {
      this.scheduled = false
      if (this.executing) {
        // A reconcile is already in flight — defer to the follow-up path.
        this.rerunNeeded = true
        return
      }
      if (!this.pending || !this.executor) return
      const pending = this.pending
      this.pending = null
      this.runExecutor(pending)
    }
    if (this.scheduleRunner) this.scheduleRunner(run)
    else queueMicrotask(run)
  }

  private runExecutor(pending: PendingNumberingReconcile): void {
    if (this.executing) {
      this.rerunNeeded = true
      return
    }
    this.executing = true
    try {
      this.executor?.(pending)
    } finally {
      this.executing = false
      // At most ONE follow-up reconcile (never recursive).
      if (this.rerunNeeded && this.pending) {
        this.rerunNeeded = false
        this.scheduleRun()
      } else {
        this.rerunNeeded = false
      }
    }
  }
}
