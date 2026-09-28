/**
 * V5.12-R3 — Persistent Diagnostics Drawer after Locate (pure contract).
 *
 * ROOT_R3_1 = DRAWER_USER_INTENT_AND_LOCATE_PRESENTATION_LIFETIME_ARE_STILL_COUPLED
 * ROOT_R3_2 = LOCATE_COLLAPSE_LEASE_SURVIVES_VISUAL_COMMIT
 * ROOT_R3_3 = COMMITTED_LEASE_HELD_IS_TREATED_AS_VALID_TERMINAL_PRESENTATION
 * ROOT_R3_4 = CURRENT_FINAL_GEOMETRY_PASS_IS_MEASURED_WHILE_DRAWER_IS_HIDDEN
 * ROOT_R3_5 = DRAWER_RESTORE_IS_DEFERRED UNTIL A LATER USER ACTION
 * ROOT_R3_6 = RESTORING_DRAWER_WITHOUT A SECOND LAYOUT SETTLE / REMEASURE
 *
 * Two authorities, strictly separated:
 *
 *   drawerRequestedOpen     USER INTENT  — only the Problems Control writes it.
 *   drawerPresentationMode  UI STRATEGY  — transient during a locate.
 *
 * `locate-collapse` is a TRANSIENT LOCATE-ONLY presentation. It may NEVER be the
 * terminal presentation while `drawerRequestedOpen === true`.
 *
 * No DOM access, no host state.
 */

export const DRAWER_PERSISTENCE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-DRAWER-PERSISTENCE-AUDIT'

export type DrawerPresentationModeV3 = 'open' | 'compact' | 'locate-collapse' | 'closed'

export type DrawerViewportClass = 'WIDE' | 'MEDIUM' | 'TOO_NARROW'

/** §9 — wide viewports must end OPEN, medium may end COMPACT. */
export const DRAWER_WIDE_MIN_AVAILABLE_PX = 900
export const DRAWER_MEDIUM_MIN_AVAILABLE_PX = 620

/**
 * §9 — viewport策略：WIDE → OPEN/DOCKED_OPEN；MEDIUM → COMPACT；
 * TOO_NARROW → locate-collapse 仅可作为中间恢复状态。
 */
export function resolveDrawerViewportClass(input: {
  editorAvailableWidth: number
  drawerWidth: number
  semanticTargetWidth: number
}): DrawerViewportClass {
  const available = Math.max(0, input.editorAvailableWidth)
  if (available >= DRAWER_WIDE_MIN_AVAILABLE_PX) return 'WIDE'
  const needed = Math.max(0, input.semanticTargetWidth) + Math.max(0, input.drawerWidth)
  if (available >= DRAWER_MEDIUM_MIN_AVAILABLE_PX || needed <= available) return 'MEDIUM'
  return 'TOO_NARROW'
}

/**
 * §7/§13 — is a restore of the user-requested Drawer presentation required?
 * `newestIntentOpen` is the LATEST user intent (intent epoch authority): the
 * newest intent always overrides an older transaction's restore plan.
 */
export function resolveDrawerRestoreRequired(input: {
  drawerRequestedOpenAtStart: boolean
  newestIntentOpen: boolean
  locateCollapseActive: boolean
}): { restoreRequired: boolean; releaseWithoutRestore: boolean } {
  if (!input.locateCollapseActive) return { restoreRequired: false, releaseWithoutRestore: false }
  if (!input.newestIntentOpen) {
    // The user explicitly closed during the transaction → never auto reopen.
    return { restoreRequired: false, releaseWithoutRestore: true }
  }
  return { restoreRequired: true, releaseWithoutRestore: false }
}

export interface DrawerPresentationFidelityInput {
  drawerRequestedOpen: boolean
  terminalState: 'COMMITTED' | 'FAILED' | 'IDLE'
  presentationAtFinalCommit: DrawerPresentationModeV3
  drawerLocateRecoveryLeaseActive: boolean
  drawerLocateRecoveryLeaseReleased: boolean
  drawerRenderedVisibleAtFinalCommit: boolean
  viewportClass: DrawerViewportClass
  postRestoreCoverageRatio: number | null
  postRestorePanelIntersectionCount: number
  postRestoreLayoutEpochCurrent: boolean
  selectedDiagnosticPreserved: boolean
  filterPreserved: boolean
}

export interface DrawerPresentationFidelityDecision {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
}

/**
 * §17/§18/§29 — the terminal fidelity gate. `COMMITTED_LEASE_HELD` with a
 * requested-open Drawer is a HARD FAILURE.
 */
export function evaluateDrawerPresentationFidelity(
  input: DrawerPresentationFidelityInput,
): DrawerPresentationFidelityDecision {
  const failed: string[] = []
  const committed = input.terminalState === 'COMMITTED'
  if (input.drawerRequestedOpen && input.drawerLocateRecoveryLeaseActive && !input.drawerLocateRecoveryLeaseReleased) {
    failed.push('COMMITTED_WITH_DRAWER_RECOVERY_LEASE_HELD')
  }
  if (input.drawerRequestedOpen && committed && input.presentationAtFinalCommit === 'locate-collapse') {
    failed.push('TERMINAL_LOCATE_COLLAPSE_WHILE_DRAWER_REQUESTED_OPEN')
  }
  if (input.drawerRequestedOpen && committed && !input.drawerRenderedVisibleAtFinalCommit) {
    failed.push('DRAWER_REQUESTED_OPEN_BUT_HIDDEN_AFTER_COMMIT')
  }
  if (input.drawerRequestedOpen && input.viewportClass === 'WIDE' && committed
    && input.presentationAtFinalCommit === 'locate-collapse') {
    failed.push('WIDE_VIEWPORT_TERMINAL_LOCATE_COLLAPSE')
  }
  // §13 — the newest user intent always wins: a transaction must never leave the
  // Drawer OPEN after the user explicitly closed it.
  if (!input.drawerRequestedOpen && committed && input.presentationAtFinalCommit !== 'closed') {
    failed.push('AUTO_REOPEN_AFTER_NEWER_USER_CLOSE_INTENT')
  }
  if (input.postRestoreCoverageRatio != null && input.postRestoreCoverageRatio < 0.98) {
    failed.push('POST_RESTORE_COVERAGE_LT_098')
  }
  if (input.postRestorePanelIntersectionCount > 0) failed.push('POST_RESTORE_PANEL_INTERSECTION')
  if (committed && !input.postRestoreLayoutEpochCurrent) failed.push('POST_RESTORE_STALE_LAYOUT_EPOCH')
  if (committed && !input.selectedDiagnosticPreserved) failed.push('DRAWER_SELECTED_DIAGNOSTIC_LOST_AFTER_RESTORE')
  if (committed && !input.filterPreserved) failed.push('DRAWER_FILTER_LOST_AFTER_RESTORE')
  if (failed.length === 0) {
    return { decision: 'PASS', reason: committed ? 'COMMITTED_DRAWER_RESTORED' : 'TERMINAL_OK', failedChecks: [] }
  }
  return { decision: 'FAIL', reason: failed.join(','), failedChecks: failed }
}

// ── §18 — the V5.12-R3 hard-gate counters ──────────────────────────────────

export const DRAWER_PERSISTENCE_V512R3_GATE_KEYS = [
  'drawerRequestedOpenButHiddenAfterCommit',
  'terminalLocateCollapseWhileDrawerRequestedOpen',
  'committedWithDrawerRecoveryLeaseHeld',
  'postCommitDrawerRestoreMissing',
  'postRestoreWithoutLayoutSettle',
  'postRestoreWithoutRemeasure',
  'postRestoreWithoutRepaint',
  'postRestoreStaleLayoutEpoch',
  'postRestorePanelIntersection',
  'postRestoreCoverageLt098',
  'drawerSelectedDiagnosticLostAfterRestore',
  'drawerFilterLostAfterRestore',
  'drawerListContextLostAfterRestore',
  'autoReopenAfterNewerUserCloseIntent',
  'wideViewportTerminalLocateCollapse',
  'drawerRestoreFeedbackLoop',
] as const

export type DrawerPersistenceV512R3GateKey = typeof DRAWER_PERSISTENCE_V512R3_GATE_KEYS[number]

export const DRAWER_PERSISTENCE_V512R3_GATE_LABELS: Record<DrawerPersistenceV512R3GateKey, string> = {
  drawerRequestedOpenButHiddenAfterCommit: 'DRAWER_REQUESTED_OPEN_BUT_HIDDEN_AFTER_COMMIT_COUNT',
  terminalLocateCollapseWhileDrawerRequestedOpen: 'TERMINAL_LOCATE_COLLAPSE_WHILE_DRAWER_REQUESTED_OPEN_COUNT',
  committedWithDrawerRecoveryLeaseHeld: 'COMMITTED_WITH_DRAWER_RECOVERY_LEASE_HELD_COUNT',
  postCommitDrawerRestoreMissing: 'POST_COMMIT_DRAWER_RESTORE_MISSING_COUNT',
  postRestoreWithoutLayoutSettle: 'POST_RESTORE_WITHOUT_LAYOUT_SETTLE_COUNT',
  postRestoreWithoutRemeasure: 'POST_RESTORE_WITHOUT_REMEASURE_COUNT',
  postRestoreWithoutRepaint: 'POST_RESTORE_WITHOUT_REPAINT_COUNT',
  postRestoreStaleLayoutEpoch: 'POST_RESTORE_STALE_LAYOUT_EPOCH_COUNT',
  postRestorePanelIntersection: 'POST_RESTORE_PANEL_INTERSECTION_COUNT',
  postRestoreCoverageLt098: 'POST_RESTORE_COVERAGE_LT_098_COUNT',
  drawerSelectedDiagnosticLostAfterRestore: 'DRAWER_SELECTED_DIAGNOSTIC_LOST_AFTER_RESTORE_COUNT',
  drawerFilterLostAfterRestore: 'DRAWER_FILTER_LOST_AFTER_RESTORE_COUNT',
  drawerListContextLostAfterRestore: 'DRAWER_LIST_CONTEXT_LOST_AFTER_RESTORE_COUNT',
  autoReopenAfterNewerUserCloseIntent: 'AUTO_REOPEN_AFTER_NEWER_USER_CLOSE_INTENT_COUNT',
  wideViewportTerminalLocateCollapse: 'WIDE_VIEWPORT_TERMINAL_LOCATE_COLLAPSE_COUNT',
  drawerRestoreFeedbackLoop: 'DRAWER_RESTORE_FEEDBACK_LOOP_COUNT',
}

export function createDrawerPersistenceV512R3Counters(): Record<DrawerPersistenceV512R3GateKey, number> {
  const out = {} as Record<DrawerPersistenceV512R3GateKey, number>
  for (const key of DRAWER_PERSISTENCE_V512R3_GATE_KEYS) out[key] = 0
  return out
}

export function formatDrawerPersistenceGateReport(
  counters: Readonly<Record<DrawerPersistenceV512R3GateKey, number>>,
): string[] {
  return DRAWER_PERSISTENCE_V512R3_GATE_KEYS.map(
    key => `${DRAWER_PERSISTENCE_V512R3_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateDrawerPersistenceGates(
  counters: Readonly<Record<DrawerPersistenceV512R3GateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = DRAWER_PERSISTENCE_V512R3_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failing: failing.map(k => DRAWER_PERSISTENCE_V512R3_GATE_LABELS[k]),
  }
}
