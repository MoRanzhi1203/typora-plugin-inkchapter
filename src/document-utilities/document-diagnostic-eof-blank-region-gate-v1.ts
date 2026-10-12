/**
 * TRAE §P2 — the EOF blank-region HARD GATE family.
 *
 * These gates judge the EOF blank-region presentation from the REAL painted
 * background (the parent carrier box) — never from the child fragments alone:
 * "子 Fragment 正确但父容器背景错误，同样必须判定 FAIL".
 *
 * Three are violation COUNTERS (must stay 0), four are VALIDITY BOOLEANS (must
 * stay true). A gate is PASS only when all seven hold.
 *
 * Pure: no DOM, no host state.
 */

export interface EofBlankRegionGateCounters {
  /** §P2 — the planned/painted region overlapped a non-empty content block. */
  eofNonemptyBlockOverlap: number
  /** §P2 — the REAL painted PARENT background node overlapped content. */
  eofParentBackgroundOverlap: number
  /** §P1 — a commit was reported while the measured layout epoch was stale. */
  eofStaleCommit: number
  /** §P0 — the band was derived from real rows and the overlap check passed. */
  eofBlankRowGeometryValid: boolean
  /** §P1 — the measured layout epoch equals the current document epoch. */
  eofLayoutEpochCurrent: boolean
  /** §P2 — every painted fragment is owned by the ONE carrier and matches rows. */
  eofFragmentOwnerCountMatch: boolean
  /** §P2 — the painted parent background actually covers the real excess rows. */
  eofActualCoverageValid: boolean
  // ── TRAE EOF-ENTER-BLANK §7 — the semantic-closure gate family (all 0). ──
  /** §7 — the visible blank count was CONFLATED with the source newline/line count. */
  eofVisibleSourceConflation: number
  /** §7 — the Drawer row displayed a stale (previous revision/generation) count. */
  eofStaleDrawerCount: number
  /** §7 — more than one paint owner existed for the same diagnostic + generation. */
  eofDuplicatePaintOwner: number
  /** §7 — a superseded generation repainted (old revision wrote a visual). */
  eofOldGenerationRepaint: number
  /** §7 — the EOF paint overlapped a NON-EMPTY content block. */
  eofPaintOverNonemptyBlock: number
  /** §7 — the "missing trailing blank" boundary marker could not be located. */
  eofMissingMarkerUnlocatable: number
  /**
   * §7 — a single trusted `Enter` was executed as TWO structural commits. Only a
   * REAL double execution counts: a source `\n` delta of 2 is NOT a double Enter.
   */
  eofEnterEventDoubleExecution: number
}

export const EOF_BLANK_REGION_GATE_LABELS = {
  eofNonemptyBlockOverlap: 'EOF_NONEMPTY_BLOCK_OVERLAP_COUNT',
  eofParentBackgroundOverlap: 'EOF_PARENT_BACKGROUND_OVERLAP_COUNT',
  eofBlankRowGeometryValid: 'EOF_BLANK_ROW_GEOMETRY_VALID',
  eofLayoutEpochCurrent: 'EOF_LAYOUT_EPOCH_CURRENT',
  eofFragmentOwnerCountMatch: 'EOF_FRAGMENT_OWNER_COUNT_MATCH',
  eofActualCoverageValid: 'EOF_ACTUAL_COVERAGE_VALID',
  eofStaleCommit: 'EOF_STALE_COMMIT_COUNT',
  eofVisibleSourceConflation: 'EOF_VISIBLE_COUNT_SOURCE_COUNT_CONFLATION',
  eofStaleDrawerCount: 'EOF_STALE_DRAWER_COUNT',
  eofDuplicatePaintOwner: 'EOF_DUPLICATE_PAINT_OWNER',
  eofOldGenerationRepaint: 'EOF_OLD_GENERATION_REPAINT',
  eofPaintOverNonemptyBlock: 'EOF_PAINT_OVER_NONEMPTY_BLOCK',
  eofMissingMarkerUnlocatable: 'EOF_MISSING_MARKER_UNLOCATABLE',
  eofEnterEventDoubleExecution: 'EOF_ENTER_EVENT_DOUBLE_EXECUTION',
} as const

export type EofBlankRegionGateKey = keyof typeof EOF_BLANK_REGION_GATE_LABELS

export const EOF_BLANK_REGION_GATE_KEYS = Object.keys(EOF_BLANK_REGION_GATE_LABELS) as EofBlankRegionGateKey[]

/** §P2 — the counters (0 ⇒ PASS). */
const COUNT_KEYS: EofBlankRegionGateKey[] = [
  'eofNonemptyBlockOverlap',
  'eofParentBackgroundOverlap',
  'eofStaleCommit',
  'eofVisibleSourceConflation',
  'eofStaleDrawerCount',
  'eofDuplicatePaintOwner',
  'eofOldGenerationRepaint',
  'eofPaintOverNonemptyBlock',
  'eofMissingMarkerUnlocatable',
  'eofEnterEventDoubleExecution',
]

export function createEofBlankRegionGateCounters(): EofBlankRegionGateCounters {
  return {
    eofNonemptyBlockOverlap: 0,
    eofParentBackgroundOverlap: 0,
    eofStaleCommit: 0,
    eofBlankRowGeometryValid: true,
    eofLayoutEpochCurrent: true,
    eofFragmentOwnerCountMatch: true,
    eofActualCoverageValid: true,
    eofVisibleSourceConflation: 0,
    eofStaleDrawerCount: 0,
    eofDuplicatePaintOwner: 0,
    eofOldGenerationRepaint: 0,
    eofPaintOverNonemptyBlock: 0,
    eofMissingMarkerUnlocatable: 0,
    eofEnterEventDoubleExecution: 0,
  }
}

export function evaluateEofBlankRegionGates(
  counters: Readonly<EofBlankRegionGateCounters>,
): { decision: 'PASS' | 'FAIL'; failing: string[]; invalid: EofBlankRegionGateKey[] } {
  const invalid = EOF_BLANK_REGION_GATE_KEYS.filter(key =>
    COUNT_KEYS.includes(key) ? (counters[key] as number) !== 0 : (counters[key] as boolean) !== true,
  )
  return {
    decision: invalid.length === 0 ? 'PASS' : 'FAIL',
    failing: invalid.map(k => EOF_BLANK_REGION_GATE_LABELS[k]),
    invalid,
  }
}

/** §P2 — the exact `NAME=value` report lines. */
export function formatEofBlankRegionGateReport(
  counters: Readonly<EofBlankRegionGateCounters>,
): string[] {
  return EOF_BLANK_REGION_GATE_KEYS.map(key => `${EOF_BLANK_REGION_GATE_LABELS[key]}=${String(counters[key])}`)
}
