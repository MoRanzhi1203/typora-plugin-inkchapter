/**
 * V5.12-R9 — Heading Diagnostic Marker Surface (pure contract).
 *
 * HEADING_DIAGNOSTIC_MARKER = SOFT_TEXT_SURFACE + REASON_CHIP
 *
 * The body-heading diagnostic marker keeps a text-tight soft severity fill and a
 * compact reason chip. The standalone severity circle, the long vertical rail,
 * the horizontal rail, the L corner arm, the outline and the editor shadow are
 * GONE (their DOM is never created and their CSS no longer exists).
 *
 * Drawer / Drawer row / severity icon / Problems Control / diagnostic rules /
 * Heading Numbering / V5.12-R3-R7 authorities are FROZEN by this round.
 */

export const HEADING_MARKER_AUDIT_EVENT_R9 = 'DOCUMENT-DIAGNOSTIC-HEADING-MARKER-SURFACE-AUDIT'

/** §3 — the unified presentation of a heading diagnostic marker. */
export const HEADING_DIAGNOSTIC_MARKER_MODE = 'SOFT_TEXT_SURFACE_PLUS_REASON_CHIP' as const

/** §6 — reason chip spec band. */
export const HEADING_CHIP_HEIGHT_MIN_PX = 18
export const HEADING_CHIP_HEIGHT_MAX_PX = 20
export const HEADING_CHIP_FONT_SIZE_MIN_PX = 11
export const HEADING_CHIP_FONT_SIZE_MAX_PX = 12
/** §8 — chip gap band (target 6~8px, hard gate 4..12px). */
export const HEADING_CHIP_GAP_MIN_PX = 4
export const HEADING_CHIP_GAP_MAX_PX = 12
/** §8 — chip vertical centering tolerance. */
export const HEADING_CHIP_CENTER_TOLERANCE_PX = 2
/** §7 — the chip must not change the heading block height by more than this. */
export const HEADING_BLOCK_HEIGHT_DRIFT_MAX_PX = 2

// ── §21 — the R9 hard gates ──────────────────────────────

export const HEADING_MARKER_SURFACE_V512R9_GATE_KEYS = [
  'leftIcon',
  'verticalRail',
  'horizontalRail',
  'cornerArm',
  'outline',
  'editorShadow',
  'fullWidthFill',
  'lineHeightMutation',
  'blockHeightDriftGt2px',
  'chipCenterDriftGt2px',
  'chipGapLt4px',
  'chipGapGt12px',
  'activePassiveFillStack',
  'drawerStyleMutation',
  'problemsControlStyleMutation',
] as const

export type HeadingMarkerSurfaceV512R9GateKey = typeof HEADING_MARKER_SURFACE_V512R9_GATE_KEYS[number]

export const HEADING_MARKER_SURFACE_V512R9_GATE_LABELS: Readonly<Record<HeadingMarkerSurfaceV512R9GateKey, string>> = {
  leftIcon: 'HEADING_DIAGNOSTIC_LEFT_ICON_COUNT',
  verticalRail: 'HEADING_DIAGNOSTIC_VERTICAL_RAIL_COUNT',
  horizontalRail: 'HEADING_DIAGNOSTIC_HORIZONTAL_RAIL_COUNT',
  cornerArm: 'HEADING_DIAGNOSTIC_CORNER_ARM_COUNT',
  outline: 'HEADING_DIAGNOSTIC_OUTLINE_COUNT',
  editorShadow: 'HEADING_DIAGNOSTIC_EDITOR_SHADOW_COUNT',
  fullWidthFill: 'HEADING_DIAGNOSTIC_FULL_WIDTH_FILL_COUNT',
  lineHeightMutation: 'HEADING_DIAGNOSTIC_LINE_HEIGHT_MUTATION_COUNT',
  blockHeightDriftGt2px: 'HEADING_DIAGNOSTIC_BLOCK_HEIGHT_DRIFT_GT_2PX_COUNT',
  chipCenterDriftGt2px: 'HEADING_DIAGNOSTIC_CHIP_CENTER_DRIFT_GT_2PX_COUNT',
  chipGapLt4px: 'HEADING_DIAGNOSTIC_CHIP_GAP_LT_4PX_COUNT',
  chipGapGt12px: 'HEADING_DIAGNOSTIC_CHIP_GAP_GT_12PX_COUNT',
  activePassiveFillStack: 'HEADING_ACTIVE_PASSIVE_FILL_STACK_COUNT',
  drawerStyleMutation: 'DRAWER_STYLE_MUTATION_IN_R9_COUNT',
  problemsControlStyleMutation: 'PROBLEMS_CONTROL_STYLE_MUTATION_IN_R9_COUNT',
}

export type HeadingMarkerSurfaceV512R9Counters = Record<HeadingMarkerSurfaceV512R9GateKey, number>

export function createHeadingMarkerSurfaceV512R9Counters(): HeadingMarkerSurfaceV512R9Counters {
  return HEADING_MARKER_SURFACE_V512R9_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as HeadingMarkerSurfaceV512R9Counters)
}

export function formatHeadingMarkerSurfaceV512R9GateReport(
  counters: Readonly<HeadingMarkerSurfaceV512R9Counters>,
): string[] {
  return HEADING_MARKER_SURFACE_V512R9_GATE_KEYS.map(k => `${HEADING_MARKER_SURFACE_V512R9_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateHeadingMarkerSurfaceV512R9Gates(
  counters: Readonly<HeadingMarkerSurfaceV512R9Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingMarkerSurfaceV512R9GateKey[] } {
  const failedChecks = HEADING_MARKER_SURFACE_V512R9_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §8/§7 — pure geometry decisions (no DOM). */
export function evaluateHeadingChipGap(gapPx: number | null | undefined): {
  gapLt4: boolean
  gapGt12: boolean
} {
  if (gapPx == null || !Number.isFinite(gapPx)) return { gapLt4: false, gapGt12: false }
  return { gapLt4: gapPx < HEADING_CHIP_GAP_MIN_PX, gapGt12: gapPx > HEADING_CHIP_GAP_MAX_PX }
}

export function evaluateHeadingChipCenterDrift(contentCenterY: number | null | undefined, chipCenterY: number | null | undefined): number | null {
  if (contentCenterY == null || chipCenterY == null) return null
  if (!Number.isFinite(contentCenterY) || !Number.isFinite(chipCenterY)) return null
  return Math.abs(chipCenterY - contentCenterY)
}

/** §5 — a fill is "full width" when it spans the whole editor surface. */
export function isFullWidthHeadingFill(fillWidth: number | null | undefined, editorWidth: number | null | undefined): boolean {
  if (fillWidth == null || editorWidth == null) return false
  if (!Number.isFinite(fillWidth) || !Number.isFinite(editorWidth)) return false
  return editorWidth > 0 && fillWidth >= editorWidth - 1
}
