/**
 * V5.14-R8 / Active State Machine V2 — SINGLE AUTHORITY + EVERY-CLICK VERSIONING
 * + OWNER-SCOPED RETIREMENT + STALE-CALLBACK DROP + POST-SETTLE DOM CLOSURE.
 *
 * ROOT_1 = `activeDiagnosticState` was NOT the single authority: the sticky
 *   `lastLocatedDiagnosticId` kept driving the Drawer selection / restore after a
 *   DEACTIVATE ("Active=null, Selected=old Warning").
 * ROOT_2 = a DEACTIVATE reused the previous interaction version, so callbacks
 *   captured by the previous ACTIVATE could never be recognised as stale.
 * ROOT_3 = the SWITCH path still ran a GLOBAL `VISUAL_CLEARED:DIAGNOSTIC_SWITCH`
 *   instead of an old-owner SCOPED retirement.
 * ROOT_4 = the interaction said ACTIVE while the real DOM had NO active fill
 *   (`fillCount=0` + `fillGateSatisfied=false`) and the interaction still PASSed.
 * ROOT_5 = the runtime acceptance only verified the action/state log, never the
 *   settled DOM / Drawer active row / fill / lease.
 *
 * Pure contract: no DOM, no host state.
 */

// ── §3.1 — the single interaction authority ────────────────────────────────

export type DiagnosticInteractionPhase = 'IDLE' | 'ACTIVE'

export interface DiagnosticInteractionState {
  /** §4.1 — EVERY click increments this EXACTLY once (DEACTIVATE included). */
  version: number
  phase: DiagnosticInteractionPhase

  diagnosticId: string | null
  targetKey: string | null
  /**
   * V1 §6/§7 — the CANONICAL index of the target inside the diagnostic's OWN
   * `location.targets`. It is NEVER a transaction-local index.
   */
  diagnosticTargetIndex: number | null
  /**
   * V1 §7 — the index inside the NARROWED locate transaction (usually 0). It is
   * transaction-scoped and must never be written back as the canonical index.
   */
  transactionLocalTargetIndex: number | null

  transactionId: number | null
  leaseToken: string | null

  /**
   * Target Group V1 §11 — the interaction target MODE. `group` means ONE fact with
   * N co-equal members (`groupMemberCount`); `occurrence` means the ordinary
   * multi-target cursor model; `single` is the default. OPTIONAL so pre-group
   * callers/tests keep working (absent === 'single').
   */
  targetMode?: 'single' | 'occurrence' | 'group'
  /** Target Group V1 §11 — the number of co-equal members of a group activation. */
  groupMemberCount?: number
}

export function emptyDiagnosticInteractionState(): DiagnosticInteractionState {
  return {
    version: 0,
    phase: 'IDLE',
    diagnosticId: null,
    targetKey: null,
    diagnosticTargetIndex: null,
    transactionLocalTargetIndex: null,
    transactionId: null,
    leaseToken: null,
  }
}

export interface DiagnosticClick {
  diagnosticId: string
  targetKey: string
  /** V1 §7 — the canonical diagnostic target index (never the local one). */
  diagnosticTargetIndex: number
  /** V1 §7 — the narrowed-transaction local index (null when not narrowed). */
  transactionLocalTargetIndex: number | null
  /** Target Group V1 §11 — OPTIONAL interaction mode (absent === 'single'). */
  targetMode?: 'single' | 'occurrence' | 'group'
  /** Target Group V1 §11 — the group's member count (only for targetMode='group'). */
  groupMemberCount?: number
}

export type DiagnosticTransitionAction = 'ACTIVATE' | 'DEACTIVATE' | 'SWITCH'

export interface DiagnosticTransition {
  action: DiagnosticTransitionAction
  previous: DiagnosticInteractionState
  next: DiagnosticInteractionState
}

/**
 * §4 — the ONE reducer. It is the ONLY place a transition is computed, so the
 * click handler can never mutate several state objects independently.
 *
 * §4.1 — `version` ALWAYS increments, once per click.
 * §4.2 — the three (and only three) transitions:
 *          IDLE      + A -> ACTIVE(A)
 *          ACTIVE(A) + A -> IDLE
 *          ACTIVE(A) + B -> ACTIVE(B)
 */
export function reduceDiagnosticClick(
  prev: DiagnosticInteractionState,
  click: DiagnosticClick,
  nextTransactionId: number | null,
  nextLeaseToken: string | null,
): DiagnosticTransition {
  const version = prev.version + 1
  const sameTarget = prev.phase === 'ACTIVE' && prev.targetKey === click.targetKey
  if (sameTarget) {
    // §7 — DEACTIVATE is a NEW interaction version, and every active identity is
    // cleared in the SAME commit (never "reuse the previous version").
    return {
      action: 'DEACTIVATE',
      previous: prev,
      next: {
        version,
        phase: 'IDLE',
        diagnosticId: null,
        targetKey: null,
        diagnosticTargetIndex: null,
        transactionLocalTargetIndex: null,
        transactionId: null,
        leaseToken: null,
      },
    }
  }
  const action: DiagnosticTransitionAction = prev.phase === 'ACTIVE' ? 'SWITCH' : 'ACTIVATE'
  return {
    action,
    previous: prev,
    next: {
      version,
      phase: 'ACTIVE',
      diagnosticId: click.diagnosticId,
      targetKey: click.targetKey,
      diagnosticTargetIndex: click.diagnosticTargetIndex,
      transactionLocalTargetIndex: click.transactionLocalTargetIndex,
      transactionId: nextTransactionId,
      leaseToken: nextLeaseToken,
      // Target Group V1 §11 — carry the interaction mode (absent === 'single').
      targetMode: click.targetMode ?? 'single',
      ...(click.groupMemberCount != null ? { groupMemberCount: click.groupMemberCount } : {}),
    },
  }
}

// ── §6 — the owner snapshot every async visual task must carry ──────────────

export interface DiagnosticVisualOwnerV2 {
  version: number
  diagnosticId: string
  targetKey: string
  transactionId: number | null
  leaseToken: string | null
}

export function ownerOf(state: DiagnosticInteractionState): DiagnosticVisualOwnerV2 | null {
  if (state.phase !== 'ACTIVE' || state.diagnosticId == null || state.targetKey == null) return null
  return {
    version: state.version,
    diagnosticId: state.diagnosticId,
    targetKey: state.targetKey,
    transactionId: state.transactionId,
    leaseToken: state.leaseToken,
  }
}

/**
 * §6 — the guard EVERY async callback must pass before touching the DOM. A
 * callback whose owner snapshot is no longer the current authority is STALE.
 *
 * NOTE: `transactionId` / `leaseToken` are compared only when the OWNER has one
 * (a pre-commit activation legitimately has neither yet — the lease is acquired
 * at commit time, so the owner is re-stamped then).
 */
export function isCurrentOwnerV2(
  owner: DiagnosticVisualOwnerV2,
  current: DiagnosticInteractionState,
): boolean {
  if (current.phase !== 'ACTIVE') return false
  if (current.version !== owner.version) return false
  if (current.diagnosticId !== owner.diagnosticId) return false
  if (current.targetKey !== owner.targetKey) return false
  if (owner.transactionId != null && current.transactionId !== owner.transactionId) return false
  return true
}

// ── §11 — the PASSIVE semantic set must be untouched by Active switching ────

/** A stable (order-independent) hash of the PASSIVE semantic target set. */
export function computePassiveSemanticSetHash(keys: readonly string[]): string {
  const sorted = [...new Set(keys)].sort()
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const k of sorted) {
    for (let i = 0; i < k.length; i++) {
      const c = k.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
    }
    h1 = Math.imul(h1 ^ 0x2c, 0x01000193) >>> 0
  }
  return `${sorted.length}:${h1.toString(16)}${h2.toString(16)}`
}

// ── §15 — the V2 hard gates ────────────────────────────────────────────────

export const ACTIVE_STATE_MACHINE_V2_GATE_KEYS = [
  'deactivateReusedInteractionVersion',
  'idleWithSelectedActiveRow',
  'idleWithSelectedDiagnosticAsActive',
  'activeWithZeroFill',
  'activeWithoutLease',
  'activeWithMultipleTargets',
  'switchWithGlobalUnscopedClear',
  'staleCallbackMutation',
  'postSettleStateDomDivergence',
  'postSettleClosureFail',
] as const

export type ActiveStateMachineV2GateKey = typeof ACTIVE_STATE_MACHINE_V2_GATE_KEYS[number]

export const ACTIVE_STATE_MACHINE_V2_GATE_LABELS: Readonly<Record<ActiveStateMachineV2GateKey, string>> = {
  deactivateReusedInteractionVersion: 'DEACTIVATE_REUSED_INTERACTION_VERSION_COUNT',
  idleWithSelectedActiveRow: 'IDLE_WITH_SELECTED_ACTIVE_ROW_COUNT',
  idleWithSelectedDiagnosticAsActive: 'IDLE_WITH_SELECTED_DIAGNOSTIC_AS_ACTIVE_COUNT',
  activeWithZeroFill: 'ACTIVE_WITH_ZERO_FILL_COUNT',
  activeWithoutLease: 'ACTIVE_WITHOUT_LEASE_COUNT',
  activeWithMultipleTargets: 'ACTIVE_WITH_MULTIPLE_TARGETS_COUNT',
  switchWithGlobalUnscopedClear: 'SWITCH_WITH_GLOBAL_UNSCOPED_CLEAR_COUNT',
  staleCallbackMutation: 'STALE_CALLBACK_MUTATION_COUNT',
  postSettleStateDomDivergence: 'POST_SETTLE_STATE_DOM_DIVERGENCE_COUNT',
  postSettleClosureFail: 'POST_SETTLE_CLOSURE_FAIL_COUNT',
}

export type ActiveStateMachineV2Counters = Record<ActiveStateMachineV2GateKey, number>

export function createActiveStateMachineV2Counters(): ActiveStateMachineV2Counters {
  return ACTIVE_STATE_MACHINE_V2_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as ActiveStateMachineV2Counters)
}

export function formatActiveStateMachineV2GateReport(
  counters: Readonly<ActiveStateMachineV2Counters>,
): string[] {
  return ACTIVE_STATE_MACHINE_V2_GATE_KEYS.map(key => `${ACTIVE_STATE_MACHINE_V2_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateActiveStateMachineV2Gates(
  counters: Readonly<ActiveStateMachineV2Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: ActiveStateMachineV2GateKey[] } {
  const failedChecks = ACTIVE_STATE_MACHINE_V2_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/**
 * §15 — the two runtime COVERAGE gates. These are NOT "must be 0"; they prove the
 * Error / Warning same-target toggle actually ran in the real Runtime.
 */
export interface ActiveStateMachineV2CoverageCounters {
  errorSameTargetDeactivateRuntime: number
  warningSameTargetDeactivateRuntime: number
}

export function createActiveStateMachineV2CoverageCounters(): ActiveStateMachineV2CoverageCounters {
  return { errorSameTargetDeactivateRuntime: 0, warningSameTargetDeactivateRuntime: 0 }
}

export function formatActiveStateMachineV2CoverageReport(
  counters: Readonly<ActiveStateMachineV2CoverageCounters>,
): string[] {
  return [
    `ERROR_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=${counters.errorSameTargetDeactivateRuntime}`,
    `WARNING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT=${counters.warningSameTargetDeactivateRuntime}`,
  ]
}

/** §24 — the runtime coverage gate (both must be >= 1 for FEATURE PASS). */
export function evaluateActiveStateMachineV2Coverage(
  counters: Readonly<ActiveStateMachineV2CoverageCounters>,
): { decision: 'PASS' | 'FAIL'; missing: string[] } {
  const missing: string[] = []
  if (counters.errorSameTargetDeactivateRuntime < 1) missing.push('ERROR_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT')
  if (counters.warningSameTargetDeactivateRuntime < 1) missing.push('WARNING_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT')
  return { decision: missing.length === 0 ? 'PASS' : 'FAIL', missing }
}

// ── §19 — the V2 audit events ──────────────────────────────────────────────

export const DOCUMENT_DIAGNOSTIC_CLICK_DISPATCH_V2 = 'DOCUMENT-DIAGNOSTIC-CLICK-DISPATCH-V2'
export const DOCUMENT_DIAGNOSTIC_STATE_TRANSITION_V2 = 'DOCUMENT-DIAGNOSTIC-STATE-TRANSITION-V2'
export const DOCUMENT_DIAGNOSTIC_OWNER_RETIRE_V2 = 'DOCUMENT-DIAGNOSTIC-OWNER-RETIRE-V2'
export const DOCUMENT_DIAGNOSTIC_STALE_CALLBACK_DROPPED_V2 = 'DOCUMENT-DIAGNOSTIC-STALE-CALLBACK-DROPPED-V2'
export const DOCUMENT_DIAGNOSTIC_VISUAL_PUBLISH_V2 = 'DOCUMENT-DIAGNOSTIC-VISUAL-PUBLISH-V2'
export const DOCUMENT_DIAGNOSTIC_POST_SETTLE_CLOSURE_V2 = 'DOCUMENT-DIAGNOSTIC-POST-SETTLE-CLOSURE-V2'

/** §7 — the reason that identifies a same-target toggle-off retirement. */
export const SAME_TARGET_TOGGLE_OFF_REASON_V2 = 'SAME_TARGET_TOGGLE_OFF_V2'

/**
 * §14 — the post-settle DOM facts the closure audit judges. Pure so it can be
 * unit-tested without a DOM.
 */
export interface PostSettleClosureFacts {
  statePhase: DiagnosticInteractionPhase
  stateDiagnosticId: string | null
  stateTargetKey: string | null
  stateVersion: number

  selectedActiveRowCount: number
  /** §14 — the Drawer row requirement only applies once rows were really rendered. */
  drawerRowsRendered: boolean
  activeTargetCount: number
  /**
   * VNext Presentation Closure V1.1 §13 — the EXPECTED number of ACTIVE targets.
   * Absent / 1 = the existing single-target contract (identical behavior).
   * A `text-tight-multi-target` group activation declares N so the closure proves
   * "1 diagnostic → N heading targets" instead of a hardcoded 1.
   */
  activeTargetCountExpected?: number
  activeFillCount: number
  activeHeadingFragmentCount: number
  /** §10 — a heading target MUST own a painted active fragment + a real fill. */
  activeTargetIsHeading: boolean
  /** true when the runtime could read a real computed background (browser). */
  activeFillCountMeasurable: boolean
  /** §14.1 — an ACTIVE visual node left behind while the authority is IDLE. */
  activeVisualWithoutOwner: boolean

  activeLeasePresent: boolean
  activeLeaseOwnerVersion: number | null
  activeLeaseTargetKey: string | null

  passiveSemanticSetUnchanged: boolean
  globalUnscopedClearObserved: boolean
}

export interface PostSettleClosureVerdict {
  decision: 'PASS' | 'FAIL'
  reasons: string[]
}

/** §14.1/§14.2 — the ONE closure verdict for both IDLE and ACTIVE. */
export function evaluatePostSettleClosure(facts: PostSettleClosureFacts): PostSettleClosureVerdict {
  const reasons: string[] = []
  if (facts.statePhase === 'IDLE') {
    if (facts.stateDiagnosticId != null) reasons.push('IDLE_WITH_DIAGNOSTIC_ID')
    if (facts.stateTargetKey != null) reasons.push('IDLE_WITH_TARGET_KEY')
    if (facts.drawerRowsRendered && facts.selectedActiveRowCount !== 0) reasons.push('IDLE_WITH_SELECTED_ACTIVE_ROW')
    if (facts.activeTargetCount !== 0) reasons.push('IDLE_WITH_ACTIVE_TARGET')
    if (facts.activeFillCount !== 0) reasons.push('IDLE_WITH_ACTIVE_FILL')
    if (facts.activeHeadingFragmentCount !== 0) reasons.push('IDLE_WITH_HEADING_FRAGMENT')
    if (facts.activeLeasePresent) reasons.push('IDLE_WITH_ACTIVE_LEASE')
    // §14.1 — a settled IDLE must not leave any ACTIVE visual node behind.
    if (facts.activeVisualWithoutOwner) reasons.push('IDLE_WITH_ACTIVE_VISUAL')
  } else {
    if (facts.stateDiagnosticId == null) reasons.push('ACTIVE_WITHOUT_DIAGNOSTIC_ID')
    if (facts.stateTargetKey == null) reasons.push('ACTIVE_WITHOUT_TARGET_KEY')
    if (facts.drawerRowsRendered && facts.selectedActiveRowCount !== 1) reasons.push('ACTIVE_SELECTED_ACTIVE_ROW_NOT_ONE')
    // VNext §13 — default 1 keeps the single-target contract; a multi-target group
    // declares its real N so the closure verifies the group size it committed.
    if (facts.activeTargetCount !== (facts.activeTargetCountExpected ?? 1)) reasons.push('ACTIVE_TARGET_COUNT_NOT_ONE')
    // §10 — an ACTIVE heading target must own a REAL painted fill. The fragment
    // count is GEOMETRY based (a present, non-zero sized active fragment), so the
    // verdict is meaningful in the real runtime AND in the jsdom harness.
    if (facts.activeTargetIsHeading && facts.activeHeadingFragmentCount < 1) {
      reasons.push('ACTIVE_HEADING_WITH_ZERO_FILL')
    }
    if (facts.activeTargetIsHeading && facts.activeFillCountMeasurable && facts.activeFillCount < 1) {
      reasons.push('ACTIVE_HEADING_WITH_TRANSPARENT_FILL')
    }
    if (!facts.activeLeasePresent) reasons.push('ACTIVE_WITHOUT_LEASE')
    if (facts.activeLeaseOwnerVersion != null && facts.activeLeaseOwnerVersion !== facts.stateVersion) {
      reasons.push('ACTIVE_LEASE_OWNER_VERSION_MISMATCH')
    }
    if (facts.activeLeaseTargetKey != null && facts.activeLeaseTargetKey !== facts.stateTargetKey) {
      reasons.push('ACTIVE_LEASE_TARGET_KEY_MISMATCH')
    }
  }
  if (!facts.passiveSemanticSetUnchanged) reasons.push('PASSIVE_SEMANTIC_SET_CHANGED')
  if (facts.globalUnscopedClearObserved) reasons.push('GLOBAL_UNSCOPED_CLEAR_OBSERVED')
  return { decision: reasons.length === 0 ? 'PASS' : 'FAIL', reasons }
}
