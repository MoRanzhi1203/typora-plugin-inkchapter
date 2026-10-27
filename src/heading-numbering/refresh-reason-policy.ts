/**
 * PA-15 — refresh-batch reason policy.
 *
 * `requestRefresh()` coalesces several triggers into ONE rAF batch, then keeps
 * only the highest-priority reason as "primary". Document-switch semantics
 * (`file-open`, `active-leaf-change`) and force-refresh semantics were derived
 * from that single primary reason, so a same-frame `editor-input` (priority 6)
 * silently swallowed them. The decision must be made from the WHOLE batch.
 */

export const DOCUMENT_SWITCH_REASONS: ReadonlySet<string> = new Set(['file-open', 'active-leaf-change'])

/** Reasons that mandate a force refresh (skip the dirty check entirely). */
export const FORCE_REFRESH_REASON_IDS: ReadonlySet<string> = new Set([
  'toggle', 'manual', 'initial-load', 'focus-in', 'decoration-repair',
  'file-open', 'active-leaf-change',
])

export interface RefreshBatchDecision {
  /** The batch contains a document switch (clear bindings / strict H1 state). */
  documentSwitch: boolean
  /** At least one reason requires a full projection (no FAST_PATH_SKIP). */
  forceRefresh: boolean
}

/** Decide from the ENTIRE batch, never from the surviving primary reason. */
export function decideRefreshBatch(reasons: Iterable<string>): RefreshBatchDecision {
  let documentSwitch = false
  let forceRefresh = false
  for (const reason of reasons) {
    if (DOCUMENT_SWITCH_REASONS.has(reason)) documentSwitch = true
    if (FORCE_REFRESH_REASON_IDS.has(reason)) forceRefresh = true
    if (documentSwitch && forceRefresh) break
  }
  return { documentSwitch, forceRefresh }
}
