/**
 * TRAE §P6 — the document-end ACTIVATION LIFECYCLE hard-gate family.
 *
 * Every one of these is a violation COUNTER and MUST stay 0 for PASS. They close
 * the "click activates, then the marker instantly disappears" defect chain:
 * a plugin presentation write must not invalidate layout, geometry invalidation
 * must not silently deselect / release the active visual, and a recovery must
 * never be lost, never commit stale, and never synthesise a click event.
 *
 * Pure: no DOM, no host state.
 */

export interface ActivationLifecycleGateCounters {
  /** §P0 — a presentation-only batch still bumped the layout epoch (forbidden). */
  pluginPresentationFalseInvalidation: number
  /** §P1 — the selected diagnostic was cleared without a user action. */
  selectedDiagnosticUnexpectedClear: number
  /** §P1 — the active-visual lease was released without a user action. */
  activeVisualUnexpectedRelease: number
  /** §P2 — a pending geometry recovery was lost (geometry never restored). */
  pendingGeometryRecoveryLost: number
  /** §P3 — a stale (identity-mismatched) recovery tried to commit. */
  staleRecoveryCommit: number
  /** §P4 — a recovery produced a synthetic ACTIVATE/DEACTIVATE (forbidden). */
  recoverySyntheticClick: number
}

export const ACTIVATION_LIFECYCLE_GATE_LABELS = {
  pluginPresentationFalseInvalidation: 'PLUGIN_PRESENTATION_FALSE_INVALIDATION_COUNT',
  selectedDiagnosticUnexpectedClear: 'SELECTED_DIAGNOSTIC_UNEXPECTED_CLEAR_COUNT',
  activeVisualUnexpectedRelease: 'ACTIVE_VISUAL_UNEXPECTED_RELEASE_COUNT',
  pendingGeometryRecoveryLost: 'PENDING_GEOMETRY_RECOVERY_LOST_COUNT',
  staleRecoveryCommit: 'STALE_RECOVERY_COMMIT_COUNT',
  recoverySyntheticClick: 'RECOVERY_SYNTHETIC_CLICK_COUNT',
} as const

export type ActivationLifecycleGateKey = keyof typeof ACTIVATION_LIFECYCLE_GATE_LABELS

export const ACTIVATION_LIFECYCLE_GATE_KEYS = Object.keys(ACTIVATION_LIFECYCLE_GATE_LABELS) as ActivationLifecycleGateKey[]

export function createActivationLifecycleGateCounters(): ActivationLifecycleGateCounters {
  return {
    pluginPresentationFalseInvalidation: 0,
    selectedDiagnosticUnexpectedClear: 0,
    activeVisualUnexpectedRelease: 0,
    pendingGeometryRecoveryLost: 0,
    staleRecoveryCommit: 0,
    recoverySyntheticClick: 0,
  }
}

export function evaluateActivationLifecycleGates(
  counters: Readonly<ActivationLifecycleGateCounters>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = ACTIVATION_LIFECYCLE_GATE_KEYS
    .filter(key => (counters[key] ?? 0) !== 0)
    .map(key => ACTIVATION_LIFECYCLE_GATE_LABELS[key])
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failing }
}

/** §P6 — the exact `NAME=value` report lines. */
export function formatActivationLifecycleGateReport(
  counters: Readonly<ActivationLifecycleGateCounters>,
): string[] {
  return ACTIVATION_LIFECYCLE_GATE_KEYS.map(key => `${ACTIVATION_LIFECYCLE_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}
