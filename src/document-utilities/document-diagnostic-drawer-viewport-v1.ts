/**
 * Document Diagnostics Drawer VIEWPORT STABILITY V1 — the ONE authority for the
 * Drawer render lifecycle and its scroll viewport.
 *
 * TWO independent scroll owners:
 *   EDITOR_SCROLL_OWNER            — the editor locate may scroll freely;
 *   DIAGNOSTICS_DRAWER_SCROLL_OWNER— a diagnostic click may NEVER move it.
 *
 * The Drawer update lifecycle is split into exactly two modes (§5/§6/§10):
 *   ACTIVE_PATCH      — the row SET is unchanged (first click / deactivate /
 *                       A→B switch / locate completion / lease / active visual
 *                       commit). It may ONLY toggle active state on the EXISTING
 *                       row nodes: no `replaceChildren`, no `innerHTML`, no
 *                       re-created rows, no scroll write.
 *   STRUCTURAL_RENDER — the row set really changed (diagnostic add/remove, order,
 *                       filter, document switch, first open). It MAY rebuild the
 *                       list, but MUST capture the viewport first and restore the
 *                       visible anchor (+ offset) afterwards.
 *
 * Pure: no DOM. The overlay measures the REAL facts and feeds them here.
 */

export type DrawerUpdateMode = 'ACTIVE_PATCH' | 'STRUCTURAL_RENDER'

/** §11 — the captured Drawer viewport. */
export interface DrawerViewportState {
  scrollTop: number
  firstVisibleDiagnosticId: string | null
  firstVisibleProjectionKey: string | null
  firstVisibleOffsetPx: number
  filter: string
}

/** §30 — the fatal gates (every one must stay 0). */
export const DRAWER_VIEWPORT_V1_GATE_KEYS = [
  'drawerScrollTopChangedOnActiveClick',
  'drawerScrollTopChangedOnDeactivate',
  'drawerScrollTopChangedOnActiveSwitch',
  'drawerViewportAnchorChangedOnActiveClick',
  'drawerViewportOffsetDriftGt1px',
  'drawerForcedScrollIntoViewOnDiagnosticClick',
  'drawerStructuralRerenderOnActiveOnlyChange',
  'drawerScrollContainerRemountOnActiveClick',
  'drawerClickedRowRemountOnActiveClick',
  'drawerActiveStateRowHeightChange',
  'drawerFocusCausedScroll',
  'drawerStructuralRenderWithoutViewportCapture',
  'drawerStructuralRenderViewportRestoreFail',
] as const

export type DrawerViewportV1GateKey = typeof DRAWER_VIEWPORT_V1_GATE_KEYS[number]

export const DRAWER_VIEWPORT_V1_GATE_LABELS: Readonly<Record<DrawerViewportV1GateKey, string>> = {
  drawerScrollTopChangedOnActiveClick: 'DRAWER_SCROLL_TOP_CHANGED_ON_ACTIVE_CLICK_COUNT',
  drawerScrollTopChangedOnDeactivate: 'DRAWER_SCROLL_TOP_CHANGED_ON_DEACTIVATE_COUNT',
  drawerScrollTopChangedOnActiveSwitch: 'DRAWER_SCROLL_TOP_CHANGED_ON_ACTIVE_SWITCH_COUNT',
  drawerViewportAnchorChangedOnActiveClick: 'DRAWER_VIEWPORT_ANCHOR_CHANGED_ON_ACTIVE_CLICK_COUNT',
  drawerViewportOffsetDriftGt1px: 'DRAWER_VIEWPORT_OFFSET_DRIFT_GT_1PX_COUNT',
  drawerForcedScrollIntoViewOnDiagnosticClick: 'DRAWER_FORCED_SCROLL_INTO_VIEW_ON_DIAGNOSTIC_CLICK_COUNT',
  drawerStructuralRerenderOnActiveOnlyChange: 'DRAWER_STRUCTURAL_RERENDER_ON_ACTIVE_ONLY_CHANGE_COUNT',
  drawerScrollContainerRemountOnActiveClick: 'DRAWER_SCROLL_CONTAINER_REMOUNT_ON_ACTIVE_CLICK_COUNT',
  drawerClickedRowRemountOnActiveClick: 'DRAWER_CLICKED_ROW_REMOUNT_ON_ACTIVE_CLICK_COUNT',
  drawerActiveStateRowHeightChange: 'DRAWER_ACTIVE_STATE_ROW_HEIGHT_CHANGE_COUNT',
  drawerFocusCausedScroll: 'DRAWER_FOCUS_CAUSED_SCROLL_COUNT',
  drawerStructuralRenderWithoutViewportCapture: 'DRAWER_STRUCTURAL_RENDER_WITHOUT_VIEWPORT_CAPTURE_COUNT',
  drawerStructuralRenderViewportRestoreFail: 'DRAWER_STRUCTURAL_RENDER_VIEWPORT_RESTORE_FAIL_COUNT',
}

export type DrawerViewportV1Counters = Record<DrawerViewportV1GateKey, number>

export function createDrawerViewportV1Counters(): DrawerViewportV1Counters {
  return DRAWER_VIEWPORT_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as DrawerViewportV1Counters)
}

export function formatDrawerViewportV1GateReport(counters: Readonly<DrawerViewportV1Counters>): string[] {
  return DRAWER_VIEWPORT_V1_GATE_KEYS.map(k => `${DRAWER_VIEWPORT_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateDrawerViewportV1Gates(
  counters: Readonly<DrawerViewportV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: DrawerViewportV1GateKey[] } {
  const failedChecks = DRAWER_VIEWPORT_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §31 — the positive coverage of the drawer viewport scenarios. */
export const DRAWER_VIEWPORT_V1_COVERAGE_KEYS = [
  'activeClickStability',
  'deactivateStability',
  'activeSwitchStability',
  'targetGroupStability',
  'multiTargetStability',
  'structuralRenderViewportRestore',
] as const

export type DrawerViewportV1CoverageKey = typeof DRAWER_VIEWPORT_V1_COVERAGE_KEYS[number]

export function createDrawerViewportV1CoverageCounters(): Record<DrawerViewportV1CoverageKey, number> {
  return DRAWER_VIEWPORT_V1_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as Record<DrawerViewportV1CoverageKey, number>)
}

export function formatDrawerViewportV1CoverageReport(
  counters: Readonly<Record<DrawerViewportV1CoverageKey, number>>,
): string[] {
  return DRAWER_VIEWPORT_V1_COVERAGE_KEYS.map(k => `${k}=${counters[k] ?? 0}`)
}

// ── §10/§16 — STRUCTURAL_RENDER decision ───────────────────────────────────

export interface DrawerStructureFacts {
  /** ordered visible projection keys (`<diagnosticId>#<targetIndex>#<severity>#<contentHash>`). */
  projectionSignature: string
  documentKey: string | null
  filter: string
  /** the LIST really holds rows for the previous signature. */
  listHasRows: boolean
}

/**
 * §5/§6/§16 — the ONE structural-render decision. When the projection signature
 * (row set + order + content) is unchanged AND the list already holds rows, the
 * update is an ACTIVE_PATCH — the list must NOT be rebuilt.
 */
export function resolveDrawerUpdateMode(input: {
  previousSignature: string | null
  facts: DrawerStructureFacts
}): { mode: DrawerUpdateMode; reason: string } {
  if (!input.facts.listHasRows) return { mode: 'STRUCTURAL_RENDER', reason: 'LIST_EMPTY_FIRST_RENDER' }
  if (input.previousSignature == null) return { mode: 'STRUCTURAL_RENDER', reason: 'NO_PREVIOUS_RENDER' }
  if (input.previousSignature !== input.facts.projectionSignature) {
    return { mode: 'STRUCTURAL_RENDER', reason: 'PROJECTION_SET_CHANGED' }
  }
  return { mode: 'ACTIVE_PATCH', reason: 'PROJECTION_SET_UNCHANGED' }
}

// ── §12/§13 — capture / restore (pure selection) ────────────────────────────

export interface DrawerRowRect {
  projectionKey: string
  diagnosticId: string
  /** offsetTop relative to the list content. */
  offsetTop: number
  height: number
}

/** §15 — the index of the FIRST row visible at `scrollTop` (0 when unknown). */
export function firstVisibleRowIndex(rows: readonly DrawerRowRect[], scrollTop: number): number {
  if (rows.length === 0) return -1
  const probe = Math.max(0, scrollTop) + 1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].offsetTop + rows[i].height > probe) return i
  }
  return rows.length - 1
}

/** §13 — restore priority: exact projection key → same diagnostic → next → previous → scrollTop. */
export function resolveViewportRestore(
  saved: DrawerViewportState,
  rows: readonly DrawerRowRect[],
): { strategy: 'PROJECTION_KEY' | 'DIAGNOSTIC_ID' | 'NEXT_SURVIVING' | 'PREVIOUS_SURVIVING' | 'SCROLL_TOP_FALLBACK'; targetScrollTop: number; anchorIndex: number } {
  const clamp = (v: number): number => Math.max(0, v)
  if (saved.firstVisibleProjectionKey != null) {
    const exact = rows.findIndex(r => r.projectionKey === saved.firstVisibleProjectionKey)
    if (exact >= 0) {
      return { strategy: 'PROJECTION_KEY', targetScrollTop: clamp(rows[exact].offsetTop - saved.firstVisibleOffsetPx), anchorIndex: exact }
    }
  }
  if (saved.firstVisibleDiagnosticId != null) {
    const sameDiag = rows.findIndex(r => r.diagnosticId === saved.firstVisibleDiagnosticId)
    if (sameDiag >= 0) {
      return { strategy: 'DIAGNOSTIC_ID', targetScrollTop: clamp(rows[sameDiag].offsetTop - saved.firstVisibleOffsetPx), anchorIndex: sameDiag }
    }
  }
  // next / previous surviving row relative to the ORIGINAL index order is
  // approximated by the saved scroll offset: pick the first row whose end is
  // beyond the saved scrollTop, else the last row.
  const probe = firstVisibleRowIndex(rows, saved.scrollTop)
  if (probe >= 0) {
    return { strategy: 'NEXT_SURVIVING', targetScrollTop: clamp(rows[probe].offsetTop - saved.firstVisibleOffsetPx), anchorIndex: probe }
  }
  return { strategy: 'SCROLL_TOP_FALLBACK', targetScrollTop: clamp(saved.scrollTop), anchorIndex: -1 }
}

// ── §30 — ACTIVE-only stability evaluation ─────────────────────────────────

export interface DrawerActiveClickFacts {
  action: 'ACTIVATE' | 'DEACTIVATE' | 'SWITCH'
  updateMode: DrawerUpdateMode
  scrollTopBefore: number
  scrollTopAfter: number
  firstVisibleDiagnosticIdBefore: string | null
  firstVisibleDiagnosticIdAfter: string | null
  firstVisibleOffsetBefore: number
  firstVisibleOffsetAfter: number
  clickedRowRemounted: boolean
  scrollContainerRemounted: boolean
  rowScrollIntoViewCalled: boolean
  focusCausedScroll: boolean
  /** row height changed between inactive and active state. */
  activeRowHeightChanged: boolean
}

/**
 * §8/§15/§27/§30 — evaluate ONE diagnostic-row click. Any real violation
 * increments only its OWN gate (never a blanket failure).
 */
export function evaluateDrawerActiveClickFacts(facts: DrawerActiveClickFacts): Partial<DrawerViewportV1Counters> {
  const out: Partial<DrawerViewportV1Counters> = {}
  const scrollDrift = Math.abs(facts.scrollTopAfter - facts.scrollTopBefore)
  // §16 — an active-only change must NEVER be a structural render.
  if (facts.updateMode === 'STRUCTURAL_RENDER') {
    out.drawerStructuralRerenderOnActiveOnlyChange = 1
  }
  // §2 — the Drawer scrollTop must not move on any diagnostic click.
  if (scrollDrift > 1) {
    if (facts.action === 'DEACTIVATE') out.drawerScrollTopChangedOnDeactivate = 1
    else if (facts.action === 'SWITCH') out.drawerScrollTopChangedOnActiveSwitch = 1
    else out.drawerScrollTopChangedOnActiveClick = 1
  }
  // §15 — the visible anchor + offset must not move.
  if (facts.firstVisibleDiagnosticIdBefore !== facts.firstVisibleDiagnosticIdAfter) {
    out.drawerViewportAnchorChangedOnActiveClick = 1
  }
  if (Math.abs(facts.firstVisibleOffsetAfter - facts.firstVisibleOffsetBefore) > 1) {
    out.drawerViewportOffsetDriftGt1px = 1
  }
  if (facts.rowScrollIntoViewCalled) out.drawerForcedScrollIntoViewOnDiagnosticClick = 1
  if (facts.focusCausedScroll) out.drawerFocusCausedScroll = 1
  if (facts.clickedRowRemounted) out.drawerClickedRowRemountOnActiveClick = 1
  if (facts.scrollContainerRemounted) out.drawerScrollContainerRemountOnActiveClick = 1
  if (facts.activeRowHeightChanged) out.drawerActiveStateRowHeightChange = 1
  return out
}

/**
 * §13/§30 — evaluate ONE structural render: it MUST capture before and restore
 * after, and the restore MUST succeed (anchor or a bounded scrollTop fallback).
 */
export function evaluateDrawerStructuralRenderFacts(facts: {
  capturePerformed: boolean
  restorePerformed: boolean
  restoreOk: boolean
}): Partial<DrawerViewportV1Counters> {
  const out: Partial<DrawerViewportV1Counters> = {}
  if (!facts.capturePerformed) out.drawerStructuralRenderWithoutViewportCapture = 1
  if (!facts.restorePerformed || !facts.restoreOk) out.drawerStructuralRenderViewportRestoreFail = 1
  return out
}
