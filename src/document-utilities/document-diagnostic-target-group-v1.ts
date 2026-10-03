/**
 * Target Group V1 — the ONE provable gate/coverage authority for the
 * `target-group` interaction model.
 *
 * A TARGET GROUP is ONE diagnostic / ONE Drawer row / ONE active transaction /
 * ONE lease with N co-equal members. It is ARCHITECTURALLY distinct from the
 * ordinary occurrence `multi-target` (N rows / 1-N badge / cursor / switch).
 *
 * This module holds NO DOM and NO host state: the overlay measures the REAL facts
 * and feeds them here, so every gate is a provable count (never a log-only PASS).
 */

/** §20 — the fatal gates (every one must stay 0). */
export const TARGET_GROUP_V1_GATE_KEYS = [
  // one diagnostic / one row
  'targetGroupDuplicatedDiagnosticCount',
  'targetGroupDuplicatedDrawerRowCount',
  'targetGroupOccurrenceBadgeRenderCount',
  'targetGroupFlattenedAsOccurrenceCount',
  'targetGroupProjectionCountGtOneCount',
  'targetGroupDrawerVisibleRowMismatchCount',
  // ordinary occurrence multi-target must NOT regress
  'multiTargetOccurrenceRegressionCount',
  // no cursor / no member switch
  'targetGroupCursorReadCount',
  'targetGroupCursorAdvanceCount',
  'targetGroupTargetSwitchCount',
  'targetGroupRepeatedClickNotDeactivateCount',
  // locate anchor coherence
  'targetGroupScrollAnchorMismatchCount',
  'targetGroupLocateMemberIndexNonzeroCount',
  'targetGroupStateLocateAuthorityDivergenceCount',
  // active members / visuals
  'targetGroupActiveMemberMissingCount',
  'targetGroupActiveMemberDuplicateCount',
  'targetGroupSingleRectSpansMultipleHeadingsCount',
  'targetGroupActiveWrapperCountMismatchCount',
  // teardown / stale
  'targetGroupStaleFillAfterDeactivateCount',
  'targetGroupStaleFillAfterDocumentSwitchCount',
  'targetGroupStaleFillAfterDiagnosticDisappearCount',
  // closure counts
  'targetGroupExpectedActiveTargetCountMismatchCount',
  'targetGroupSelectedActiveRowCountMismatchCount',
  'targetGroupActiveLeaseCountMismatchCount',
] as const

export type TargetGroupV1GateKey = typeof TARGET_GROUP_V1_GATE_KEYS[number]

export const TARGET_GROUP_V1_GATE_LABELS: Readonly<Record<TargetGroupV1GateKey, string>> = {
  targetGroupDuplicatedDiagnosticCount: 'TARGET_GROUP_DUPLICATED_DIAGNOSTIC_COUNT',
  targetGroupDuplicatedDrawerRowCount: 'TARGET_GROUP_DUPLICATED_DRAWER_ROW_COUNT',
  targetGroupOccurrenceBadgeRenderCount: 'TARGET_GROUP_OCCURRENCE_BADGE_RENDER_COUNT',
  targetGroupFlattenedAsOccurrenceCount: 'TARGET_GROUP_FLATTENED_AS_OCCURRENCE_COUNT',
  targetGroupProjectionCountGtOneCount: 'TARGET_GROUP_PROJECTION_COUNT_GT_ONE_COUNT',
  targetGroupDrawerVisibleRowMismatchCount: 'TARGET_GROUP_DRAWER_VISIBLE_ROW_MISMATCH_COUNT',
  multiTargetOccurrenceRegressionCount: 'MULTI_TARGET_OCCURRENCE_REGRESSION_COUNT',
  targetGroupCursorReadCount: 'TARGET_GROUP_CURSOR_READ_COUNT',
  targetGroupCursorAdvanceCount: 'TARGET_GROUP_CURSOR_ADVANCE_COUNT',
  targetGroupTargetSwitchCount: 'TARGET_GROUP_TARGET_SWITCH_COUNT',
  targetGroupRepeatedClickNotDeactivateCount: 'TARGET_GROUP_REPEATED_CLICK_NOT_DEACTIVATE_COUNT',
  targetGroupScrollAnchorMismatchCount: 'TARGET_GROUP_SCROLL_ANCHOR_MISMATCH_COUNT',
  targetGroupLocateMemberIndexNonzeroCount: 'TARGET_GROUP_LOCATE_MEMBER_INDEX_NONZERO_COUNT',
  targetGroupStateLocateAuthorityDivergenceCount: 'TARGET_GROUP_STATE_LOCATE_AUTHORITY_DIVERGENCE_COUNT',
  targetGroupActiveMemberMissingCount: 'TARGET_GROUP_ACTIVE_MEMBER_MISSING_COUNT',
  targetGroupActiveMemberDuplicateCount: 'TARGET_GROUP_ACTIVE_MEMBER_DUPLICATE_COUNT',
  targetGroupSingleRectSpansMultipleHeadingsCount: 'TARGET_GROUP_SINGLE_RECT_SPANS_MULTIPLE_HEADINGS_COUNT',
  targetGroupActiveWrapperCountMismatchCount: 'TARGET_GROUP_ACTIVE_WRAPPER_COUNT_MISMATCH_COUNT',
  targetGroupStaleFillAfterDeactivateCount: 'TARGET_GROUP_STALE_FILL_AFTER_DEACTIVATE_COUNT',
  targetGroupStaleFillAfterDocumentSwitchCount: 'TARGET_GROUP_STALE_FILL_AFTER_DOCUMENT_SWITCH_COUNT',
  targetGroupStaleFillAfterDiagnosticDisappearCount: 'TARGET_GROUP_STALE_FILL_AFTER_DIAGNOSTIC_DISAPPEAR_COUNT',
  targetGroupExpectedActiveTargetCountMismatchCount: 'TARGET_GROUP_EXPECTED_ACTIVE_TARGET_COUNT_MISMATCH_COUNT',
  targetGroupSelectedActiveRowCountMismatchCount: 'TARGET_GROUP_SELECTED_ACTIVE_ROW_COUNT_MISMATCH_COUNT',
  targetGroupActiveLeaseCountMismatchCount: 'TARGET_GROUP_ACTIVE_LEASE_COUNT_MISMATCH_COUNT',
}

export type TargetGroupV1Counters = Record<TargetGroupV1GateKey, number>

export function createTargetGroupV1Counters(): TargetGroupV1Counters {
  return TARGET_GROUP_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as TargetGroupV1Counters)
}

export function formatTargetGroupV1GateReport(counters: Readonly<TargetGroupV1Counters>): string[] {
  return TARGET_GROUP_V1_GATE_KEYS.map(k => `${TARGET_GROUP_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateTargetGroupV1Gates(
  counters: Readonly<TargetGroupV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: TargetGroupV1GateKey[] } {
  const failedChecks = TARGET_GROUP_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §19 — the positive coverage of the target-group scenarios. */
export const TARGET_GROUP_V1_COVERAGE_KEYS = [
  'targetGroupTwoMemberActivationCount',
  'targetGroupThreeMemberActivationCount',
  'targetGroupSingleRowRenderCount',
  'targetGroupRepeatClickDeactivateCount',
  'targetGroupDocumentSwitchCleanupCount',
  'multiTargetOccurrenceRowCount',
] as const

export type TargetGroupV1CoverageKey = typeof TARGET_GROUP_V1_COVERAGE_KEYS[number]

export function createTargetGroupV1CoverageCounters(): Record<TargetGroupV1CoverageKey, number> {
  return TARGET_GROUP_V1_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as Record<TargetGroupV1CoverageKey, number>)
}

export function formatTargetGroupV1CoverageReport(
  counters: Readonly<Record<TargetGroupV1CoverageKey, number>>,
): string[] {
  return TARGET_GROUP_V1_COVERAGE_KEYS.map(k => `${k}=${counters[k] ?? 0}`)
}

// ── §8/§9 — the Drawer projection measurement (REAL facts → gates) ──────────

export interface TargetGroupDrawerFacts {
  /** group diagnostics present in the current snapshot. */
  groupDiagnosticCount: number
  /** group projections produced by the ONE projection authority. */
  groupProjectionCount: number
  /** group rows really painted in the Drawer DOM. */
  groupRowCount: number
  /** group rows carrying a `1/N` occurrence badge. */
  groupOccurrenceBadgeCount: number
  /** ordinary multi-target diagnostics present. */
  multiTargetDiagnosticCount: number
  /** ordinary multi-target projections produced. */
  multiTargetProjectionCount: number
  /** expected ordinary multi-target projection count (sum of occurrence sizes). */
  multiTargetExpectedProjectionCount: number
}

/**
 * §8/§9/§20 — evaluate the Drawer projections. A group must be EXACTLY ONE
 * projection AND ONE row AND ZERO badge; the ordinary multi-target must keep its
 * N occurrence projections (never collapsed).
 */
export function evaluateTargetGroupDrawerFacts(facts: TargetGroupDrawerFacts): Partial<TargetGroupV1Counters> {
  const out: Partial<TargetGroupV1Counters> = {}
  // §7 — 1 diagnostic per document (the group is emitted once by construction;
  // a duplicate diagnostic would surface as >1 group diagnostic for the same rule).
  if (facts.groupDiagnosticCount > 1) out.targetGroupDuplicatedDiagnosticCount = facts.groupDiagnosticCount - 1
  // §8 — exactly ONE projection AND ONE row.
  if (facts.groupDiagnosticCount > 0 && facts.groupProjectionCount > 1) {
    out.targetGroupProjectionCountGtOneCount = facts.groupProjectionCount - 1
    out.targetGroupFlattenedAsOccurrenceCount = facts.groupProjectionCount - 1
  }
  if (facts.groupDiagnosticCount > 0 && facts.groupRowCount > 1) {
    out.targetGroupDuplicatedDrawerRowCount = facts.groupRowCount - 1
  }
  // A group's VISIBLE row count must equal its projection count (exactly ONE).
  if (facts.groupDiagnosticCount > 0 && facts.groupRowCount !== facts.groupProjectionCount) {
    out.targetGroupDrawerVisibleRowMismatchCount = Math.abs(facts.groupRowCount - facts.groupProjectionCount)
  }
  // §8.3 — a group never renders `1/N`.
  if (facts.groupOccurrenceBadgeCount > 0) out.targetGroupOccurrenceBadgeRenderCount = facts.groupOccurrenceBadgeCount
  // §8.1/§20 — the ordinary multi-target must keep its occurrence projections.
  if (facts.multiTargetDiagnosticCount > 0 && facts.multiTargetProjectionCount !== facts.multiTargetExpectedProjectionCount) {
    out.multiTargetOccurrenceRegressionCount = Math.abs(
      facts.multiTargetProjectionCount - facts.multiTargetExpectedProjectionCount,
    ) || 1
  }
  return out
}

// ── §12/§13/§15/§16 — the ACTIVE closure measurement ───────────────────────

export interface TargetGroupClosureFacts {
  groupMemberCount: number
  /** the REAL active target count (must equal groupMemberCount). */
  activeTargetCount: number
  /** distinct ACTIVE heading member identities (wrappers). */
  activeMemberIdentities: readonly string[]
  activeWrapperCount: number
  activeHeadingFragmentCount: number
  selectedActiveRowCount: number
  activeLeaseCount: number
  /** the locate member index the activation used (must be 0). */
  locateMemberIndex: number
  /** scroll anchor identity vs the state owner's anchor identity. */
  anchorIdentity: string | null
  stateAnchorIdentity: string | null
  /** the max width of any one active wrapper's fragments vs the document width. */
  singleWrapperSpansMultipleMembers: boolean
}

export function evaluateTargetGroupClosureFacts(facts: TargetGroupClosureFacts): Partial<TargetGroupV1Counters> {
  const out: Partial<TargetGroupV1Counters> = {}
  const distinct = new Set(facts.activeMemberIdentities.filter(s => s !== ''))
  if (distinct.size < facts.groupMemberCount) {
    out.targetGroupActiveMemberMissingCount = facts.groupMemberCount - distinct.size
  }
  if (facts.activeMemberIdentities.length !== distinct.size) {
    out.targetGroupActiveMemberDuplicateCount = facts.activeMemberIdentities.length - distinct.size
  }
  if (facts.activeWrapperCount !== facts.groupMemberCount) {
    out.targetGroupActiveWrapperCountMismatchCount = Math.abs(facts.activeWrapperCount - facts.groupMemberCount)
  }
  if (facts.activeHeadingFragmentCount < facts.groupMemberCount) {
    out.targetGroupActiveMemberMissingCount = Math.max(
      out.targetGroupActiveMemberMissingCount ?? 0,
      facts.groupMemberCount - facts.activeHeadingFragmentCount,
    )
  }
  if (facts.singleWrapperSpansMultipleMembers) out.targetGroupSingleRectSpansMultipleHeadingsCount = 1
  if (facts.locateMemberIndex !== 0) out.targetGroupLocateMemberIndexNonzeroCount = 1
  if (facts.stateAnchorIdentity != null && facts.anchorIdentity !== facts.stateAnchorIdentity) {
    out.targetGroupScrollAnchorMismatchCount = 1
    out.targetGroupStateLocateAuthorityDivergenceCount = 1
  }
  if (facts.selectedActiveRowCount !== 1) out.targetGroupSelectedActiveRowCountMismatchCount = 1
  if (facts.activeLeaseCount !== 1) out.targetGroupActiveLeaseCountMismatchCount = 1
  if (facts.activeTargetCount !== facts.groupMemberCount) {
    out.targetGroupExpectedActiveTargetCountMismatchCount = Math.abs(facts.activeTargetCount - facts.groupMemberCount) || 1
  }
  return out
}
