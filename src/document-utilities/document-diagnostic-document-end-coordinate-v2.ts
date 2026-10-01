/**
 * V2 — Document-End One-Click Locate: coordinate-space contract + post-scroll
 * freshness authority (pure).
 *
 * THE DEFECT (proved by the real runtime log app-1790794803482.log):
 *
 *   clickSequence=8 SWITCH 10→11 phase=ACTIVE                 (interaction OK)
 *   DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT txn=8 WAITING_SCROLL_SETTLE
 *   DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT txn=8 FAIL
 *       writeContentRect.top=32   (= host viewport top with scrollTop 0)
 *       presentationRect.top=739  (= document-local 707.25 + host 32)
 *       presentationVisibleHeightRatio=0.023684  (editor viewport 32..751.6)
 *   OWNER-RETIRE-V2 LOCATE_FAILED:DOCUMENT_END_SCROLL_STABLE_FRAMES
 *   ATOMIC-TEARDOWN-V2.1 rollback 11→12 fill 1→0
 *   DOCUMENT-UTILITY-SCROLL-OPERATION operationId=4 scrollTopStart=0 → Final=632
 *
 *   ⇒ the settle gate declared "settled" BEFORE the GO_BOTTOM scroll had issued a
 *     single scroll event, so the closure measured PRE-SCROLL viewport geometry
 *     (host top 32 instead of 632): the rect was off by exactly the scroll delta.
 *
 * Rules encoded here:
 *   - visibility / occlusion / intersection ⇒ VIEWPORT geometry only;
 *   - a real scroll invalidates every pre-scroll viewport rect;
 *   - post-scroll consumers require fresh remeasure/reproject (drift <= 1 px);
 *   - a stale-coordinate closure may NOT roll back the interaction.
 */

export const DOCUMENT_END_COORDINATE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-DOCUMENT-END-COORDINATE-AUDIT'

export type DocumentEndCoordinateSpace = 'DOCUMENT_LOCAL' | 'VIEWPORT'

export interface DocEndRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** §17 — the post-scroll projection tolerance (px). */
export const DOCUMENT_END_PROJECTION_DRIFT_TOLERANCE_PX = 1

/** §9 — the settle gate's target tolerance (px). */
export const DOC_END_SCROLL_TARGET_TOLERANCE_PX = 1

/**
 * §7/§8 — the ONE document-local → viewport projection. NEVER a bare
 * `top - scrollTop`: the canonical form uses the DOCUMENT HOST's current viewport
 * origin, so it stays correct for any host/transform/zoom.
 */
export function projectDocumentLocalToViewport(input: {
  documentLocalRect: DocEndRect | null
  hostViewportRect: DocEndRect | null
}): DocEndRect | null {
  const local = input.documentLocalRect
  const host = input.hostViewportRect
  if (!local || !host) return null
  const left = local.left + host.left
  const top = local.top + host.top
  return {
    left,
    top,
    right: left + local.width,
    bottom: top + local.height,
    width: local.width,
    height: local.height,
  }
}

/** …and its inverse (a viewport measurement back into shareable doc-local space). */
export function projectViewportToDocumentLocal(input: {
  viewportRect: DocEndRect | null
  hostViewportRect: DocEndRect | null
}): DocEndRect | null {
  const viewport = input.viewportRect
  const host = input.hostViewportRect
  if (!viewport || !host) return null
  const left = viewport.left - host.left
  const top = viewport.top - host.top
  return {
    left,
    top,
    right: left + viewport.width,
    bottom: top + viewport.height,
    width: viewport.width,
    height: viewport.height,
  }
}

/** §6/§31 — the two geometry caches are NEVER the same thing. */
export interface SyntheticEofCoordinateFacts {
  transactionId: number | null
  scrollTopBefore: number
  scrollTopAfter: number
  maxScrollTopAfter: number
  scrollDelta: number
  scrollWriteCount: number
  scrollSettled: boolean
  /** a real scroll movement (or an already-at-target container) was observed. */
  scrollObserved: boolean
  alreadyAtTarget: boolean

  documentLocalRect: DocEndRect | null
  preScrollViewportRect: DocEndRect | null
  postScrollViewportRect: DocEndRect | null
  expectedViewportRect: DocEndRect | null

  /** the space the geometry that reached the closure actually lives in. */
  consumedCoordinateSpace: DocumentEndCoordinateSpace

  postScrollRemeasured: boolean
  postScrollReprojected: boolean

  layoutEpochBefore: number
  layoutEpochAfter: number
  /** the current document layout epoch at closure time. */
  layoutEpochCurrent: number
  geometryGenerationBefore: number
  geometryGenerationAfter: number

  presentationVisibleHeightRatio: number
  /** the visual verdict the closure produced from the consumed geometry. */
  visualDecision: 'PASS' | 'FAIL' | 'NOT_EVALUATED'
  /** true when the interaction was rolled back despite a successful scroll. */
  interactionRolledBackAfterScroll: boolean
}

export interface DocumentEndCoordinateEvaluation {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
  projectionDriftPx: number | null
}

/**
 * §17 — the coordinate audit decision. A real scroll REQUIRES a fresh
 * remeasure/reproject with drift <= 1 px; a closure that consumed stale/pre-scroll
 * geometry is `POST_SCROLL_COORDINATE_STALE`, never a bare visual failure.
 */
export function evaluateDocEndCoordinateAudit(
  facts: SyntheticEofCoordinateFacts,
): DocumentEndCoordinateEvaluation {
  const failed: string[] = []
  const realScroll = Math.abs(facts.scrollDelta) > 0.5 || facts.scrollWriteCount > 0
  const drift = facts.expectedViewportRect && facts.postScrollViewportRect
    ? Math.abs(facts.expectedViewportRect.top - facts.postScrollViewportRect.top)
    : null

  if (realScroll) {
    if (!facts.postScrollRemeasured && !facts.postScrollReprojected) failed.push('POST_SCROLL_REMEASURE_MISSING')
    if (facts.consumedCoordinateSpace !== 'VIEWPORT') failed.push('DOCUMENT_LOCAL_RECT_USED_AS_VIEWPORT')
    if (drift != null && drift > DOCUMENT_END_PROJECTION_DRIFT_TOLERANCE_PX) {
      failed.push('POST_SCROLL_COORDINATE_STALE')
    }
    if (facts.layoutEpochAfter !== facts.layoutEpochCurrent) failed.push('POST_SCROLL_STALE_LAYOUT_EPOCH')
  }
  if (facts.scrollObserved && !facts.scrollSettled) failed.push('SCROLL_NOT_SETTLED')
  if (facts.visualDecision === 'NOT_EVALUATED' && !facts.scrollObserved) {
    failed.push('VISUAL_CLOSURE_BEFORE_POST_SCROLL_PROJECTION')
  }
  // §13/§ROOT_EOF_4 — a successful scroll may never end in an interaction rollback.
  if (facts.scrollObserved && facts.interactionRolledBackAfterScroll) {
    failed.push('ACTIVE_STATE_ROLLED_BACK_AFTER_SCROLL_SUCCESS')
  }
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0
      ? (realScroll ? 'POST_SCROLL_COORDINATE_FRESH' : 'NO_SCROLL_GEOMETRY_FRESH')
      : failed.join(','),
    failedChecks: failed,
    projectionDriftPx: drift,
  }
}

// ── §18 — the FATAL gates (all must be 0) ─────────────────

export const DOC_END_COORDINATE_GATE_KEYS = [
  'documentEndSecondClickRequired',
  'documentEndFirstClickLocateRollback',
  'documentEndPreScrollViewportRectReused',
  'documentEndPostScrollRemeasureMissing',
  'documentEndPostScrollReprojectMissing',
  'documentEndDocumentLocalRectUsedAsViewport',
  'documentEndPostScrollCoordinateDriftGt1px',
  'documentEndPostScrollStaleLayoutEpoch',
  'documentEndPostScrollStaleGeometry',
  'documentEndActiveStateRolledBackAfterScrollSuccess',
  'documentEndFirstClickVisualNotVisible',
  'documentEndScrollSuccessWithVisualNoCommit',
  'documentEndCommitWithStaleCoordinateSpace',
  'documentEndVisualClosureBeforePostScrollProjection',
] as const

export type DocEndCoordinateGateKey = typeof DOC_END_COORDINATE_GATE_KEYS[number]

export const DOC_END_COORDINATE_GATE_LABELS: Readonly<Record<DocEndCoordinateGateKey, string>> = {
  documentEndSecondClickRequired: 'DOCUMENT_END_SECOND_CLICK_REQUIRED_COUNT',
  documentEndFirstClickLocateRollback: 'DOCUMENT_END_FIRST_CLICK_LOCATE_ROLLBACK_COUNT',
  documentEndPreScrollViewportRectReused: 'DOCUMENT_END_PRE_SCROLL_VIEWPORT_RECT_REUSED_COUNT',
  documentEndPostScrollRemeasureMissing: 'DOCUMENT_END_POST_SCROLL_REMEASURE_MISSING_COUNT',
  documentEndPostScrollReprojectMissing: 'DOCUMENT_END_POST_SCROLL_REPROJECT_MISSING_COUNT',
  documentEndDocumentLocalRectUsedAsViewport: 'DOCUMENT_END_DOCUMENT_LOCAL_RECT_USED_AS_VIEWPORT_COUNT',
  documentEndPostScrollCoordinateDriftGt1px: 'DOCUMENT_END_POST_SCROLL_COORDINATE_DRIFT_GT_1PX_COUNT',
  documentEndPostScrollStaleLayoutEpoch: 'DOCUMENT_END_POST_SCROLL_STALE_LAYOUT_EPOCH_COUNT',
  documentEndPostScrollStaleGeometry: 'DOCUMENT_END_POST_SCROLL_STALE_GEOMETRY_COUNT',
  documentEndActiveStateRolledBackAfterScrollSuccess: 'DOCUMENT_END_ACTIVE_STATE_ROLLED_BACK_AFTER_SCROLL_SUCCESS_COUNT',
  documentEndFirstClickVisualNotVisible: 'DOCUMENT_END_FIRST_CLICK_VISUAL_NOT_VISIBLE_COUNT',
  documentEndScrollSuccessWithVisualNoCommit: 'DOCUMENT_END_SCROLL_SUCCESS_WITH_VISUAL_NO_COMMIT_COUNT',
  documentEndCommitWithStaleCoordinateSpace: 'DOCUMENT_END_COMMIT_WITH_STALE_COORDINATE_SPACE_COUNT',
  documentEndVisualClosureBeforePostScrollProjection: 'DOCUMENT_END_VISUAL_CLOSURE_BEFORE_POST_SCROLL_PROJECTION_COUNT',
}

export type DocEndCoordinateCounters = Record<DocEndCoordinateGateKey, number>

export function createDocEndCoordinateCounters(): DocEndCoordinateCounters {
  return DOC_END_COORDINATE_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocEndCoordinateCounters)
}

export function formatDocEndCoordinateGateReport(counters: Readonly<DocEndCoordinateCounters>): string[] {
  return DOC_END_COORDINATE_GATE_KEYS.map(k => `${DOC_END_COORDINATE_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDocEndCoordinateGates(
  counters: Readonly<DocEndCoordinateCounters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DocEndCoordinateGateKey[] } {
  const failedChecks = DOC_END_COORDINATE_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §26 — a diagnostic click must never re-enter the semantic pipeline. */
export const DIAGNOSTIC_CLICK_ISOLATION_GATE_KEYS = [
  'diagnosticClickTriggeredCaptionFullScan',
  'diagnosticClickTriggeredCodeCandidateScan',
  'diagnosticClickTriggeredSemanticRebuild',
] as const

export type DiagnosticClickIsolationGateKey = typeof DIAGNOSTIC_CLICK_ISOLATION_GATE_KEYS[number]

export const DIAGNOSTIC_CLICK_ISOLATION_GATE_LABELS: Readonly<Record<DiagnosticClickIsolationGateKey, string>> = {
  diagnosticClickTriggeredCaptionFullScan: 'DIAGNOSTIC_CLICK_TRIGGERED_CAPTION_FULL_SCAN_COUNT',
  diagnosticClickTriggeredCodeCandidateScan: 'DIAGNOSTIC_CLICK_TRIGGERED_CODE_CANDIDATE_SCAN_COUNT',
  diagnosticClickTriggeredSemanticRebuild: 'DIAGNOSTIC_CLICK_TRIGGERED_SEMANTIC_REBUILD_COUNT',
}

export type DiagnosticClickIsolationCounters = Record<DiagnosticClickIsolationGateKey, number>

export function createDiagnosticClickIsolationCounters(): DiagnosticClickIsolationCounters {
  return DIAGNOSTIC_CLICK_ISOLATION_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DiagnosticClickIsolationCounters)
}

export function formatDiagnosticClickIsolationGateReport(
  counters: Readonly<DiagnosticClickIsolationCounters>,
): string[] {
  return DIAGNOSTIC_CLICK_ISOLATION_GATE_KEYS.map(k => `${DIAGNOSTIC_CLICK_ISOLATION_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDiagnosticClickIsolationGates(
  counters: Readonly<DiagnosticClickIsolationCounters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DiagnosticClickIsolationGateKey[] } {
  const failedChecks = DIAGNOSTIC_CLICK_ISOLATION_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §19 — the POSITIVE coverage (scenario proof only) ─────

export const DOC_END_COORDINATE_COVERAGE_KEYS = [
  'documentEndFirstClickFromNonBottomRuntime',
  'documentEndSwitchFromOtherDiagnosticRuntime',
  'documentEndActivateFromIdleRuntime',
  'documentEndAlreadyAtBottomRuntime',
  'documentEndRealScrollRuntime',
  'documentEndPostScrollRemeasureRuntime',
  'documentEndPostScrollReprojectRuntime',
  'documentEndOneClickCommittedRuntime',
  'documentEndSameTargetDeactivateRuntime',
] as const

export type DocEndCoordinateCoverageKey = typeof DOC_END_COORDINATE_COVERAGE_KEYS[number]

export const DOC_END_COORDINATE_COVERAGE_LABELS: Readonly<Record<DocEndCoordinateCoverageKey, string>> = {
  documentEndFirstClickFromNonBottomRuntime: 'DOCUMENT_END_FIRST_CLICK_FROM_NON_BOTTOM_RUNTIME_COUNT',
  documentEndSwitchFromOtherDiagnosticRuntime: 'DOCUMENT_END_SWITCH_FROM_OTHER_DIAGNOSTIC_RUNTIME_COUNT',
  documentEndActivateFromIdleRuntime: 'DOCUMENT_END_ACTIVATE_FROM_IDLE_RUNTIME_COUNT',
  documentEndAlreadyAtBottomRuntime: 'DOCUMENT_END_ALREADY_AT_BOTTOM_RUNTIME_COUNT',
  documentEndRealScrollRuntime: 'DOCUMENT_END_REAL_SCROLL_RUNTIME_COUNT',
  documentEndPostScrollRemeasureRuntime: 'DOCUMENT_END_POST_SCROLL_REMEASURE_RUNTIME_COUNT',
  documentEndPostScrollReprojectRuntime: 'DOCUMENT_END_POST_SCROLL_REPROJECT_RUNTIME_COUNT',
  documentEndOneClickCommittedRuntime: 'DOCUMENT_END_ONE_CLICK_COMMITTED_RUNTIME_COUNT',
  documentEndSameTargetDeactivateRuntime: 'DOCUMENT_END_SAME_TARGET_DEACTIVATE_RUNTIME_COUNT',
}

export const DOC_END_COORDINATE_COVERAGE_MINIMUMS: Readonly<Record<DocEndCoordinateCoverageKey, number>> = {
  documentEndFirstClickFromNonBottomRuntime: 1,
  documentEndSwitchFromOtherDiagnosticRuntime: 1,
  documentEndActivateFromIdleRuntime: 1,
  documentEndAlreadyAtBottomRuntime: 1,
  documentEndRealScrollRuntime: 1,
  documentEndPostScrollRemeasureRuntime: 1,
  documentEndPostScrollReprojectRuntime: 1,
  documentEndOneClickCommittedRuntime: 2,
  documentEndSameTargetDeactivateRuntime: 1,
}

export type DocEndCoordinateCoverageCounters = Record<DocEndCoordinateCoverageKey, number>

export function createDocEndCoordinateCoverageCounters(): DocEndCoordinateCoverageCounters {
  return DOC_END_COORDINATE_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DocEndCoordinateCoverageCounters)
}

export function formatDocEndCoordinateCoverageReport(
  counters: Readonly<DocEndCoordinateCoverageCounters>,
): string[] {
  return DOC_END_COORDINATE_COVERAGE_KEYS.map(k => `${DOC_END_COORDINATE_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDocEndCoordinateCoverage(
  counters: Readonly<DocEndCoordinateCoverageCounters>,
  minimums: Readonly<Record<DocEndCoordinateCoverageKey, number>> = DOC_END_COORDINATE_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: DocEndCoordinateCoverageKey[] } {
  const unmet = DOC_END_COORDINATE_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}
