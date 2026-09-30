/**
 * V5.14-R7 — Document Diagnostic ACTIVE INTERACTION state machine.
 *
 * ROOT_R7_1 = the Drawer row click ran `clearDiagnosticLocateVisual('DIAGNOSTIC_SWITCH')`
 *   BEFORE any classification, so a second click on the SAME active target was
 *   treated as a switch (clear → resolve → activate again) and could never
 *   toggle off.
 * ROOT_R7_2 = the ACTIVE emphasis was re-derived from the STICKY
 *   `lastLocatedDiagnosticId` (a drawer-selection authority) instead of a single
 *   active authority, so any later reconcile re-painted an emphasis the user had
 *   just dismissed.
 * ROOT_R7_3 = there was no interaction epoch / owner token, so a late cleanup of
 *   the OLD active target could clear the NEW one (two clicks needed).
 * ROOT_R7_4 = `selectedDiagnosticId`, `activeVisualTargetKey`, the heading active
 *   identity and the locate visibility lease were published independently.
 *
 * The ONE model:
 *   IDLE          + click A -> ACTIVATE(A)
 *   ACTIVE(A)     + click A -> DEACTIVATE(A)
 *   ACTIVE(A)     + click B -> SWITCH(A -> B)
 *
 * severity NEVER participates: it only selects a visual token.
 *
 * Pure contract: no DOM, no host state.
 */

export type DiagnosticActivePhase = 'activating' | 'active' | 'deactivating' | 'switching'

export type DiagnosticInteractionAction = 'ACTIVATE' | 'DEACTIVATE' | 'SWITCH'

/** §5 — the ONE active authority. */
export interface DiagnosticActiveState {
  interactionEpoch: number
  documentKey: string
  diagnosticId: string
  targetKey: string
  targetIndex: number
  transactionId: number | null
  leaseToken: string | null
  phase: DiagnosticActivePhase
}

/** §6.2 — the clicked target (severity is carried for AUDIT ONLY). */
export interface ClickedDiagnosticTarget {
  documentKey: string
  diagnosticId: string
  targetKey: string
  targetIndex: number
  severity?: string | null
}

/**
 * §6.2/§9 — the ONE classifier. It compares the STABLE target key and NEVER the
 * severity, so Error / Warning / Info share exactly one transition table.
 */
export function classifyDiagnosticInteraction(
  previous: DiagnosticActiveState | null,
  clicked: ClickedDiagnosticTarget,
): DiagnosticInteractionAction {
  if (!previous) return 'ACTIVATE'
  if (previous.targetKey === clicked.targetKey) return 'DEACTIVATE'
  return 'SWITCH'
}

/** §12 — same targetKey → DEACTIVATE; same diagnosticId but another index → SWITCH. */
export function isSameActiveTarget(
  previous: DiagnosticActiveState | null,
  clicked: ClickedDiagnosticTarget,
): boolean {
  return previous != null && previous.targetKey === clicked.targetKey
}

// ── §8 — transaction / lease / cleanup OWNERSHIP ───────────────────────────

export interface DiagnosticVisualOwner {
  interactionEpoch: number
  transactionId: number | null
  targetKey: string
  leaseToken: string | null
}

export function activeStateToOwner(state: DiagnosticActiveState): DiagnosticVisualOwner {
  return {
    interactionEpoch: state.interactionEpoch,
    transactionId: state.transactionId,
    targetKey: state.targetKey,
    leaseToken: state.leaseToken,
  }
}

/** §8 — is this cleanup owner still the CURRENT active authority? */
export function isCurrentVisualOwner(
  owner: Pick<DiagnosticVisualOwner, 'interactionEpoch' | 'targetKey'>,
  current: DiagnosticActiveState | null,
): boolean {
  return current != null
    && owner.interactionEpoch === current.interactionEpoch
    && owner.targetKey === current.targetKey
}

/** §8.1 — a stale owner cleanup is SKIPPED; a current owner cleanup is APPLIED. */
export function resolveOwnerCleanupDecision(
  owner: Pick<DiagnosticVisualOwner, 'interactionEpoch' | 'targetKey'>,
  current: DiagnosticActiveState | null,
): 'APPLY' | 'SKIP_STALE_OWNER' {
  return isCurrentVisualOwner(owner, current) ? 'APPLY' : 'SKIP_STALE_OWNER'
}

// ── §14 — the hard gates (all must be 0) ───────────────────────────────────

export const ACTIVE_INTERACTION_V514R7_GATE_KEYS = [
  'sameActiveTargetReclassifiedAsSwitch',
  'sameActiveTargetCreatedNewLocateTx',
  'sameActiveTargetFailedToToggleOff',
  'switchRequiredSecondUserClick',
  'oldActiveCleanupClearedNewActive',
  'staleVisualOwnerCleanupApplied',
  'selectedDiagnosticActiveTargetDivergence',
  'activeTargetWithoutOwner',
  'multipleActiveTarget',
  'errorWarningInteractionBranchDivergence',
  'activeSwitchLeftStableIdleBetweenClicks',
  'activeLeaseOwnerMismatch',
] as const

export type ActiveInteractionV514R7GateKey = typeof ACTIVE_INTERACTION_V514R7_GATE_KEYS[number]

export const ACTIVE_INTERACTION_V514R7_GATE_LABELS: Readonly<Record<ActiveInteractionV514R7GateKey, string>> = {
  sameActiveTargetReclassifiedAsSwitch: 'SAME_ACTIVE_TARGET_RECLASSIFIED_AS_SWITCH_COUNT',
  sameActiveTargetCreatedNewLocateTx: 'SAME_ACTIVE_TARGET_CREATED_NEW_LOCATE_TX_COUNT',
  sameActiveTargetFailedToToggleOff: 'SAME_ACTIVE_TARGET_FAILED_TOGGLE_OFF_COUNT',
  switchRequiredSecondUserClick: 'SWITCH_REQUIRED_SECOND_USER_CLICK_COUNT',
  oldActiveCleanupClearedNewActive: 'OLD_ACTIVE_CLEANUP_CLEARED_NEW_ACTIVE_COUNT',
  staleVisualOwnerCleanupApplied: 'STALE_VISUAL_OWNER_CLEANUP_APPLIED_COUNT',
  selectedDiagnosticActiveTargetDivergence: 'SELECTED_DIAGNOSTIC_ACTIVE_TARGET_DIVERGENCE_COUNT',
  activeTargetWithoutOwner: 'ACTIVE_TARGET_WITHOUT_OWNER_COUNT',
  multipleActiveTarget: 'MULTIPLE_ACTIVE_TARGET_COUNT',
  errorWarningInteractionBranchDivergence: 'ERROR_WARNING_INTERACTION_BRANCH_DIVERGENCE_COUNT',
  activeSwitchLeftStableIdleBetweenClicks: 'ACTIVE_SWITCH_LEFT_STABLE_IDLE_BETWEEN_CLICKS_COUNT',
  activeLeaseOwnerMismatch: 'ACTIVE_LEASE_OWNER_MISMATCH_COUNT',
}

export type ActiveInteractionV514R7Counters = Record<ActiveInteractionV514R7GateKey, number>

export function createActiveInteractionV514R7Counters(): ActiveInteractionV514R7Counters {
  return ACTIVE_INTERACTION_V514R7_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as ActiveInteractionV514R7Counters)
}

export function formatActiveInteractionV514R7GateReport(
  counters: Readonly<ActiveInteractionV514R7Counters>,
): string[] {
  return ACTIVE_INTERACTION_V514R7_GATE_KEYS.map(key => `${ACTIVE_INTERACTION_V514R7_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateActiveInteractionV514R7Gates(
  counters: Readonly<ActiveInteractionV514R7Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: ActiveInteractionV514R7GateKey[] } {
  const failedChecks = ACTIVE_INTERACTION_V514R7_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §13 — the interaction audits ───────────────────────────────────────────

export const DOCUMENT_DIAGNOSTIC_ACTIVE_INTERACTION_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-ACTIVE-INTERACTION-AUDIT'
export const DOCUMENT_DIAGNOSTIC_ACTIVE_OWNER_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-ACTIVE-OWNER-AUDIT'

/** §7.2 — the explicit toggle-off reason (never VISUAL_CLEARED:DIAGNOSTIC_SWITCH). */
export const SAME_TARGET_TOGGLE_OFF_REASON = 'SAME_TARGET_TOGGLE_OFF'

/**
 * §9 — the classification is severity-BLIND by construction. A structural probe
 * used by the tests (and the `errorWarningInteractionBranchDivergence` gate) to
 * prove the transition table cannot depend on the severity token.
 */
export function classifyDiagnosticInteractionIsSeverityBlind(): boolean {
  const base = {
    documentKey: 'doc',
    diagnosticId: 'D1',
    targetKey: 'doc::D1::0::H3',
    targetIndex: 0,
  }
  const previous: DiagnosticActiveState = {
    interactionEpoch: 1,
    documentKey: 'doc',
    diagnosticId: 'D1',
    targetKey: 'doc::D1::0::H3',
    targetIndex: 0,
    transactionId: null,
    leaseToken: null,
    phase: 'active',
  }
  const severities: Array<string | null> = ['error', 'warning', 'info', null]
  const decisions = severities.map(severity =>
    classifyDiagnosticInteraction(previous, { ...base, severity }))
  const idleDecisions = severities.map(severity =>
    classifyDiagnosticInteraction(null, { ...base, severity }))
  const otherDecisions = severities.map(severity =>
    classifyDiagnosticInteraction(previous, { ...base, diagnosticId: 'D2', targetKey: 'doc::D2::0::H5', severity }))
  return new Set(decisions).size === 1
    && new Set(idleDecisions).size === 1
    && new Set(otherDecisions).size === 1
}
