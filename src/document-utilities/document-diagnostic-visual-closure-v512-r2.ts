/**
 * V5.12-R2 — Diagnostic Visual Closure (pure contract).
 *
 * Closes three architecture-level defects:
 *
 * ROOT_R2_6 = INLINE_SOURCE_RANGE_USES_BOUNDING_OR_UNION_RECT_AS_FINAL_VISUAL
 *             INSTEAD_OF_PER_LINE_CLIENT_RECTS
 * ROOT_R2_7 = VISUAL_PRESENTATION_FAIL_DOES_NOT_BLOCK_TERMINAL_COMMIT
 * ROOT_R2_10 = FULL_GEOMETRY_AUDIT_CAN_PASS_WHILE_PANEL_INTERSECTION_VISUAL_AUDIT_FAILS
 *
 * Four geometry objects stay STRICTLY separated (§12/§30):
 *
 *   SemanticTargetBounds  what the problem object really is
 *   PresentationBounds    what should be painted
 *   VisibleIntersection   only "did the target enter the visible region"
 *   OcclusionBounds       only "is a panel in the way"
 *
 * No DOM access, no host state.
 */

// V5.12-R4 §25 — the shared inline position-drift acceptance band.
import { INLINE_POSITION_DRIFT_HARD_PX } from './document-diagnostic-inline-document-space-v512-r4'

export const VISUAL_CLOSURE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT'

/** §10.2 — same-visual-line adjacent client rects may be merged up to this gap. */
export const INLINE_FRAGMENT_MERGE_GAP_PX = 2
/** §10.2 — vertical overlap ratio that proves two rects share a visual line. */
export const INLINE_FRAGMENT_LINE_OVERLAP_RATIO = 0.5
/** §14 — the coverage floor for both inline and block presentation. */
export const VISUAL_COVERAGE_FLOOR = 0.98

export interface ClosureRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function finite(n: number): boolean {
  return Number.isFinite(n)
}

function makeClosureRect(left: number, top: number, right: number, bottom: number): ClosureRect {
  const l = finite(left) ? left : 0
  const t = finite(top) ? top : 0
  const r = Math.max(l, finite(right) ? right : l)
  const b = Math.max(t, finite(bottom) ? bottom : t)
  return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }
}

/** §10.2 — meaningful client rects only (positive area, finite, real layout). */
export function filterMeaningfulClientRects(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }> | null | undefined,
): ClosureRect[] {
  if (!rects) return []
  const out: ClosureRect[] = []
  for (const r of Array.from(rects)) {
    if (!r) continue
    if (!finite(r.left) || !finite(r.top) || !finite(r.right) || !finite(r.bottom)) continue
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) continue
    out.push(makeClosureRect(r.left, r.top, r.right, r.bottom))
  }
  return out
}

function verticalOverlapRatio(a: ClosureRect, b: ClosureRect): number {
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const minH = Math.min(a.height, b.height)
  return minH > 0 ? overlap / minH : 0
}

/**
 * §10.2/§10.3 — ONE fragment per VISUAL LINE.
 *
 * Same-line rects whose horizontal gap is <= 2px are merged; rects on different
 * visual lines are NEVER unioned (a cross-line union is the defect this closes).
 * The output is ordered top→bottom, left→right.
 */
export function groupClientRectsToFragments(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }> | null | undefined,
): ClosureRect[] {
  const meaningful = filterMeaningfulClientRects(rects)
  if (meaningful.length === 0) return []
  const remaining = [...meaningful].sort((a, b) => (a.top - b.top) || (a.left - b.left))
  const lines: ClosureRect[][] = []
  for (const r of remaining) {
    let placed = false
    for (const line of lines) {
      // Compare against the line's vertical envelope (the first member).
      if (verticalOverlapRatio(line[0], r) >= INLINE_FRAGMENT_LINE_OVERLAP_RATIO) {
        line.push(r)
        placed = true
        break
      }
    }
    if (!placed) lines.push([r])
  }
  const out: ClosureRect[] = []
  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.left - b.left)
    let cur = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      if (next.left - cur.right <= INLINE_FRAGMENT_MERGE_GAP_PX) {
        cur = makeClosureRect(
          Math.min(cur.left, next.left),
          Math.min(cur.top, next.top),
          Math.max(cur.right, next.right),
          Math.max(cur.bottom, next.bottom),
        )
      } else {
        out.push(cur)
        cur = next
      }
    }
    out.push(cur)
  }
  return out.sort((a, b) => (a.top - b.top) || (a.left - b.left))
}

/** §10.2 — distinct visual lines inside a raw client-rect set. */
export function countVisualLines(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }> | null | undefined,
): number {
  return groupClientRectsToFragments(rects).length
}

/**
 * §10.4 Hard Gate — how much of the EXACT expected geometry the fragments cover.
 * A dropped fragment (or a wrongly merged cross-line union) lowers this below 1.
 */
export function fragmentCoverageRatio(
  expected: ArrayLike<{ left: number; top: number; right: number; bottom: number }> | null | undefined,
  fragments: readonly ClosureRect[],
): number {
  const expectedRects = filterMeaningfulClientRects(expected)
  if (expectedRects.length === 0) return 1
  let expectedArea = 0
  let coveredArea = 0
  for (const e of expectedRects) {
    expectedArea += e.width * e.height
    let coveredForRect = 0
    for (const f of fragments) {
      const w = Math.max(0, Math.min(e.right, f.right) - Math.max(e.left, f.left))
      const h = Math.max(0, Math.min(e.bottom, f.bottom) - Math.max(e.top, f.top))
      coveredForRect += w * h
    }
    coveredArea += Math.min(coveredForRect, e.width * e.height)
  }
  if (expectedArea <= 0) return 1
  return Math.max(0, Math.min(1, coveredArea / expectedArea))
}

/**
 * §10.3 Hard Gate — a cross-line union is a fragment whose vertical envelope
 * spans more visual lines than the geometry it came from.
 */
export function hasCrossLineUnion(
  expected: ArrayLike<{ left: number; top: number; right: number; bottom: number }> | null | undefined,
  fragments: readonly ClosureRect[],
): boolean {
  const expectedLines = groupClientRectsToFragments(expected).length
  if (expectedLines <= 1) return false
  return fragments.length < expectedLines
}

export interface LocateVisualCommitInput {
  semanticResolvePass: boolean
  scrollArrivalPass: boolean
  targetConnected: boolean
  freshTargetMeasurement: boolean
  layoutEpochCurrent: boolean
  presentationBuilt: boolean
  visualCarrierPresent: boolean
  targetFullyUnobscured: boolean
  panelIntersectionCount: number
  framePaintsAboveDrawer: boolean
  framePaintsAboveToolbar: boolean
  framePaintsAboveNavigator: boolean
  /** semantic ↔ presentation coverage (block frame / inline fragment box). */
  coverageRatio: number | null
  /** inline only: fragment coverage of the exact source range. */
  inlineFragmentCoverage: number | null
  /** block only: wrapper coverage. */
  blockCoverage: number | null
  staleGeometry: boolean
  /**
   * V5.12-R4 §25 — inline only: the DOCUMENT-SPACE coordinate authority. Absent
   * (or null) for block/heading targets. Coverage alone can never prove that the
   * painted fragments sit ON the source range, so the position drift is a gate.
   */
  inlineDocumentSpace?: {
    documentLocalFragmentCount: number
    meaningfulFragmentCount: number
    actualPaintedFragmentCount: number
    maxPositionDriftPx: number | null
    scrollWriteCount: number
    preScrollGeometryInvalidated: boolean
    postScrollGeometryFresh: boolean
  } | null
}

export interface LocateVisualCommitDecision {
  canCommit: boolean
  reason: string
  failedChecks: string[]
}

/** §14 — the UNIQUE commit gate. Visual FAIL always blocks COMMIT. */
export function canCommitLocateVisual(input: LocateVisualCommitInput): LocateVisualCommitDecision {
  const failed: string[] = []
  if (!input.semanticResolvePass) failed.push('SEMANTIC_RESOLVE_FAIL')
  if (!input.scrollArrivalPass) failed.push('SCROLL_ARRIVAL_FAIL')
  if (!input.targetConnected) failed.push('TARGET_NOT_CONNECTED')
  if (!input.freshTargetMeasurement) failed.push('STALE_TARGET_MEASUREMENT')
  if (!input.layoutEpochCurrent) failed.push('STALE_LAYOUT_EPOCH')
  if (!input.presentationBuilt) failed.push('PRESENTATION_NOT_BUILT')
  if (!input.visualCarrierPresent) failed.push('VISUAL_CARRIER_MISSING')
  if (!input.targetFullyUnobscured) failed.push('TARGET_NOT_FULLY_UNOBSCURED')
  if (input.panelIntersectionCount > 0) failed.push('PANEL_INTERSECTION')
  if (input.framePaintsAboveDrawer) failed.push('FRAME_PAINTS_ABOVE_DRAWER')
  if (input.framePaintsAboveToolbar) failed.push('FRAME_PAINTS_ABOVE_TOOLBAR')
  if (input.framePaintsAboveNavigator) failed.push('FRAME_PAINTS_ABOVE_NAVIGATOR')
  if (input.coverageRatio != null && input.coverageRatio < VISUAL_COVERAGE_FLOOR) failed.push('COVERAGE_LT_098')
  if (input.inlineFragmentCoverage != null && input.inlineFragmentCoverage < VISUAL_COVERAGE_FLOOR) failed.push('INLINE_FRAGMENT_COVERAGE_LT_098')
  if (input.blockCoverage != null && input.blockCoverage < VISUAL_COVERAGE_FLOOR) failed.push('BLOCK_COVERAGE_LT_098')
  if (input.staleGeometry) failed.push('STALE_GEOMETRY')
  // ── V5.12-R4 §25 — the inline DOCUMENT-SPACE coordinate authority ────────
  const id = input.inlineDocumentSpace
  if (id) {
    if (id.documentLocalFragmentCount < 1) failed.push('INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS')
    else if (id.documentLocalFragmentCount !== id.meaningfulFragmentCount) {
      failed.push('INLINE_VIEWPORT_LOCAL_FRAGMENT_COUNT_MISMATCH')
    }
    if (id.actualPaintedFragmentCount !== id.meaningfulFragmentCount) {
      failed.push('INLINE_LOCAL_PAINTED_FRAGMENT_COUNT_MISMATCH')
    }
    // NaN → fail (never a silent pass).
    if (id.maxPositionDriftPx != null && !(id.maxPositionDriftPx <= INLINE_POSITION_DRIFT_HARD_PX)) {
      failed.push('INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX')
    }
    if (id.scrollWriteCount > 0 && !id.preScrollGeometryInvalidated) {
      failed.push('INLINE_STALE_PRE_SCROLL_GEOMETRY')
    }
    if (id.scrollWriteCount > 0 && !id.postScrollGeometryFresh) {
      failed.push('INLINE_POST_SCROLL_GEOMETRY_NOT_FRESH')
    }
  }
  if (failed.length === 0) return { canCommit: true, reason: 'FULL_GEOMETRY_OK', failedChecks: [] }
  return { canCommit: false, reason: failed.join(','), failedChecks: failed }
}

/** §14 — the bounded recovery decision (max ONE visual recovery per tx). */
export function resolveLocateVisualRecoveryDecision(input: {
  canCommit: boolean
  recoveryAttempts: number
  maxRecovery: number
}): 'COMMIT' | 'RETRY_LAYOUT_RECOVERY' | 'FAILED_VISUAL_PRESENTATION' {
  if (input.canCommit) return 'COMMIT'
  return input.recoveryAttempts < input.maxRecovery ? 'RETRY_LAYOUT_RECOVERY' : 'FAILED_VISUAL_PRESENTATION'
}

// ── §18 — the V5.12-R2 hard-gate counters ───────────────────────────────────

export const VISUAL_CLOSURE_V512R2_GATE_KEYS = [
  'headingLegacyVisualRender',
  'headingFullWidthVisualWash',
  'passiveMarkerStaleLayoutEpoch',
  'passiveMarkerTargetDriftGt1px',
  'activeHeadingWithoutPassiveMarker',
  'activeHeadingWithoutIcon',
  'activeHeadingWithoutRail',
  'headingMultiTargetPassiveMissing',
  'locatableHeadingDiagnosticWithoutVisualTarget',
  'inlineExactRangeAvailableButBlockFallback',
  'inlineFragmentCoverageLt098',
  'inlineFragmentOmission',
  'inlineCrossLineUnion',
  'blockCoverageLt098',
  'finalCommitWithVisualFail',
  'finalCommitWithPanelIntersection',
  'finalCommitWithStaleLayoutEpoch',
  'framePaintsAboveDrawer',
  'framePaintsAboveToolbar',
  'framePaintsAboveNavigator',
  'drawerRecoveryWithoutRemeasure',
  'drawerRecoveryWithoutLayoutSettle',
  'drawerRecoveryRegression',
  'toolbarReopenRegression',
  'postCommitScrollRepaint',
  'postCommitScrollRemeasure',
  'postCommitScrollReresolve',
  'postCommitScrollRecenter',
  'postCommitScrollWrite',
  'tableDescendantBackgroundMutation',
  'codeDescendantBackgroundMutation',
  'nativeSelectionOverride',
  'editorLocateShadow',
  'staleRectInvariant',
  'mixedCoordinateSpace',
] as const

export type VisualClosureV512R2GateKey = typeof VISUAL_CLOSURE_V512R2_GATE_KEYS[number]

/** §18 — the exact report labels (§21 output format). */
export const VISUAL_CLOSURE_V512R2_GATE_LABELS: Record<VisualClosureV512R2GateKey, string> = {
  headingLegacyVisualRender: 'HEADING_LEGACY_VISUAL_RENDER_COUNT',
  headingFullWidthVisualWash: 'HEADING_FULL_WIDTH_VISUAL_WASH_COUNT',
  passiveMarkerStaleLayoutEpoch: 'PASSIVE_MARKER_STALE_LAYOUT_EPOCH_COUNT',
  passiveMarkerTargetDriftGt1px: 'PASSIVE_MARKER_TARGET_DRIFT_GT_1PX_COUNT',
  activeHeadingWithoutPassiveMarker: 'ACTIVE_HEADING_WITHOUT_PASSIVE_MARKER_COUNT',
  activeHeadingWithoutIcon: 'ACTIVE_HEADING_WITHOUT_ICON_COUNT',
  activeHeadingWithoutRail: 'ACTIVE_HEADING_WITHOUT_RAIL_COUNT',
  headingMultiTargetPassiveMissing: 'HEADING_MULTI_TARGET_PASSIVE_MISSING_COUNT',
  locatableHeadingDiagnosticWithoutVisualTarget: 'LOCATABLE_HEADING_DIAGNOSTIC_WITHOUT_VISUAL_TARGET_COUNT',
  inlineExactRangeAvailableButBlockFallback: 'INLINE_EXACT_RANGE_AVAILABLE_BUT_BLOCK_FALLBACK_COUNT',
  inlineFragmentCoverageLt098: 'INLINE_FRAGMENT_COVERAGE_LT_098_COUNT',
  inlineFragmentOmission: 'INLINE_FRAGMENT_OMISSION_COUNT',
  inlineCrossLineUnion: 'INLINE_CROSS_LINE_UNION_COUNT',
  blockCoverageLt098: 'BLOCK_COVERAGE_LT_098_COUNT',
  finalCommitWithVisualFail: 'FINAL_COMMIT_WITH_VISUAL_FAIL_COUNT',
  finalCommitWithPanelIntersection: 'FINAL_COMMIT_WITH_PANEL_INTERSECTION_COUNT',
  finalCommitWithStaleLayoutEpoch: 'FINAL_COMMIT_WITH_STALE_LAYOUT_EPOCH_COUNT',
  framePaintsAboveDrawer: 'FRAME_PAINTS_ABOVE_DRAWER_COUNT',
  framePaintsAboveToolbar: 'FRAME_PAINTS_ABOVE_TOOLBAR_COUNT',
  framePaintsAboveNavigator: 'FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT',
  drawerRecoveryWithoutRemeasure: 'DRAWER_RECOVERY_WITHOUT_REMEASURE_COUNT',
  drawerRecoveryWithoutLayoutSettle: 'DRAWER_RECOVERY_WITHOUT_LAYOUT_SETTLE_COUNT',
  drawerRecoveryRegression: 'DRAWER_RECOVERY_REGRESSION_COUNT',
  toolbarReopenRegression: 'TOOLBAR_REOPEN_REGRESSION_COUNT',
  postCommitScrollRepaint: 'POST_COMMIT_SCROLL_REPAINT_COUNT',
  postCommitScrollRemeasure: 'POST_COMMIT_SCROLL_REMEASURE_COUNT',
  postCommitScrollReresolve: 'POST_COMMIT_SCROLL_RERESOLVE_COUNT',
  postCommitScrollRecenter: 'POST_COMMIT_SCROLL_RECENTER_COUNT',
  postCommitScrollWrite: 'POST_COMMIT_SCROLL_WRITE_COUNT',
  tableDescendantBackgroundMutation: 'TABLE_DESCENDANT_BACKGROUND_MUTATION_COUNT',
  codeDescendantBackgroundMutation: 'CODE_DESCENDANT_BACKGROUND_MUTATION_COUNT',
  nativeSelectionOverride: 'NATIVE_SELECTION_OVERRIDE_COUNT',
  editorLocateShadow: 'EDITOR_LOCATE_SHADOW_COUNT',
  staleRectInvariant: 'STALE_RECT_INVARIANT_COUNT',
  mixedCoordinateSpace: 'MIXED_COORDINATE_SPACE_COUNT',
}

export function createVisualClosureV512R2Counters(): Record<VisualClosureV512R2GateKey, number> {
  const out = {} as Record<VisualClosureV512R2GateKey, number>
  for (const key of VISUAL_CLOSURE_V512R2_GATE_KEYS) out[key] = 0
  return out
}

/** §21 — the exact `NAME=value` lines for the final report. */
export function formatVisualClosureGateReport(
  counters: Readonly<Record<VisualClosureV512R2GateKey, number>>,
): string[] {
  return VISUAL_CLOSURE_V512R2_GATE_KEYS.map(
    key => `${VISUAL_CLOSURE_V512R2_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

/** §21 — a gate is PASS only when every counter is 0. */
export function evaluateVisualClosureGates(
  counters: Readonly<Record<VisualClosureV512R2GateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = VISUAL_CLOSURE_V512R2_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failing: failing.map(k => VISUAL_CLOSURE_V512R2_GATE_LABELS[k]) }
}
