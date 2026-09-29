/**
 * V5.12-R7 — Fill-Only Diagnostic Locate Marker (pure contract).
 *
 * THE DEFECT: the ACTIVE diagnostic locate visual painted a left vertical
 * indicator bar, a closed border frame (top/bottom/left/right lines), open-edge
 * continuation arms, a bottom-left corner cap and 2px underline keylines — the
 * target read as "framed", not as "highlighted".
 *
 * LINE_SOURCE = MIXED:
 *   BORDER          `[data-presentation='full-frame'|'open-right-frame'|'open-left-frame']`
 *                   carried `border: 1.5px solid var(--ink-locate-border)`.
 *   PSEUDO_ELEMENT  the base `.inkchapter-diagnostic-locate-frame::before` 2px
 *                   indicator bar; the open-edge `::after` 10px gradient arm;
 *                   the text-tight `::after` 14–16px corner cap; the caption
 *                   `::after` 3px keyline; the no-slot `top-edge` 2px bar.
 *   CHILD_ELEMENT   the heading ACTIVE `__keyline` (a real 1.5px painted div).
 *   KEYLINE         the `background-image: linear-gradient(...)` 2px lower edge
 *                   on the inline mark / inline fragment (a painted underline).
 *   SVG             none.
 *
 * R7 fixes it at the PRESENTATION layer: ACTIVE_LOCATE_VISUAL = FILL_ONLY —
 * `geometry carrier → fill surface` and nothing else. Here we keep the pure,
 * DOM-free measurement + the hard-gate authority so tests can assert the
 * contract directly instead of guessing from a screenshot.
 */

export const ACTIVE_LOCATE_PRESENTATION_FILL_ONLY = 'FILL_ONLY' as const

export const ACTIVE_LOCATE_LINE_SOURCE = 'MIXED' as const

export const FILL_ONLY_LOCATE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-LOCATE-FILL-ONLY-AUDIT'

/** V5.12-R7 §13/§14 — the hard-gate counters. ALL must be 0 for a PASS. */
export const ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS = [
  'activeLocateVerticalLineCount',
  'activeLocateHorizontalLineCount',
  'activeLocateBorderCount',
  'activeLocateOutlineCount',
  'activeLocateKeylineCount',
  'activeLocateCornerArmCount',
  'activeLocateLinePseudoElementCount',
  'activeLocateLineDomChildCount',
  'activeLocateSvgStrokeLineCount',
  'activeLocateEditorShadowCount',
  'passiveHeadingMarkerUnexpectedRemovalCount',
  'drawerSeverityIndicatorUnexpectedRemovalCount',
] as const

export type ActiveLocateFillOnlyGateKey = typeof ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS[number]

export const ACTIVE_LOCATE_FILL_ONLY_GATE_LABELS: Record<ActiveLocateFillOnlyGateKey, string> = {
  activeLocateVerticalLineCount: 'ACTIVE_LOCATE_VERTICAL_LINE_COUNT',
  activeLocateHorizontalLineCount: 'ACTIVE_LOCATE_HORIZONTAL_LINE_COUNT',
  activeLocateBorderCount: 'ACTIVE_LOCATE_BORDER_COUNT',
  activeLocateOutlineCount: 'ACTIVE_LOCATE_OUTLINE_COUNT',
  activeLocateKeylineCount: 'ACTIVE_LOCATE_KEYLINE_COUNT',
  activeLocateCornerArmCount: 'ACTIVE_LOCATE_CORNER_ARM_COUNT',
  activeLocateLinePseudoElementCount: 'ACTIVE_LOCATE_LINE_PSEUDO_ELEMENT_COUNT',
  activeLocateLineDomChildCount: 'ACTIVE_LOCATE_LINE_DOM_CHILD_COUNT',
  activeLocateSvgStrokeLineCount: 'ACTIVE_LOCATE_SVG_STROKE_LINE_COUNT',
  activeLocateEditorShadowCount: 'ACTIVE_LOCATE_EDITOR_SHADOW_COUNT',
  passiveHeadingMarkerUnexpectedRemovalCount: 'PASSIVE_HEADING_MARKER_UNEXPECTED_REMOVAL_COUNT',
  drawerSeverityIndicatorUnexpectedRemovalCount: 'DRAWER_SEVERITY_INDICATOR_UNEXPECTED_REMOVAL_COUNT',
}

export function createActiveLocateFillOnlyCounters(): Record<ActiveLocateFillOnlyGateKey, number> {
  const out = {} as Record<ActiveLocateFillOnlyGateKey, number>
  for (const key of ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS) out[key] = 0
  return out
}

export function formatActiveLocateFillOnlyGateReport(
  counters: Readonly<Record<ActiveLocateFillOnlyGateKey, number>>,
): string[] {
  return ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS.map(
    key => `${ACTIVE_LOCATE_FILL_ONLY_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateActiveLocateFillOnlyGates(
  counters: Readonly<Record<ActiveLocateFillOnlyGateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = ACTIVE_LOCATE_FILL_ONLY_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failing.length === 0 ? 'PASS' : 'FAIL', failing: failing.map(key => ACTIVE_LOCATE_FILL_ONLY_GATE_LABELS[key]) }
}

/** §13 — a successfully committed active locate must keep at least ONE fill. */
export const ACTIVE_LOCATE_MIN_FILL_COUNT = 1

/** A rect-like measure (viewport or local — units are irrelevant here). */
export interface LineMeasure {
  width: number
  height: number
}

/** §13 — a thin horizontal bar reads as a painted horizontal LINE. */
export const LINE_THICKNESS_MAX_PX = 3

export function isHorizontalLineBar(m: LineMeasure): boolean {
  return m.width > LINE_THICKNESS_MAX_PX && m.height <= LINE_THICKNESS_MAX_PX
}

export function isVerticalLineBar(m: LineMeasure): boolean {
  return m.height > LINE_THICKNESS_MAX_PX && m.width <= LINE_THICKNESS_MAX_PX
}

/** §12/§13 — the measured facts for one committed active locate. */
export interface ActiveLocateFillOnlyFacts {
  /** Non-transparent fill carriers painted on the active locate surface. */
  fillCount: number
  /** Thin VERTICAL bars (a left/text marker rail) on the active surface. */
  verticalLineCount: number
  /** Thin HORIZONTAL bars (a top/bottom rule) on the active surface. */
  horizontalLineCount: number
  /** Carriers still painting a CSS border. */
  borderCount: number
  /** Carriers still painting an outline. */
  outlineCount: number
  /** `background-image` gradient paints (the old 2px lower keyline). */
  keylineCount: number
  /** 10–16px corner caps / continuation arms. */
  cornerArmCount: number
  /** `::before` / `::after` pseudo elements still painting on a carrier. */
  linePseudoElementCount: number
  /** Line-ish DOM children (keyline / line / arm / stem). */
  lineDomChildCount: number
  /** SVG / path / line strokes. */
  svgStrokeLineCount: number
  /** box-shadow / inset-shadow decorations on the active surface. */
  editorShadowCount: number
  /** A heading diagnostic exists but its PASSIVE gutter marker was removed. */
  passiveHeadingMarkerRemoved: boolean
  /** Drawer rows exist but a row severity indicator was removed. */
  drawerSeverityIndicatorRemoved: boolean
}

export function emptyActiveLocateFillOnlyFacts(): ActiveLocateFillOnlyFacts {
  return {
    fillCount: 0,
    verticalLineCount: 0,
    horizontalLineCount: 0,
    borderCount: 0,
    outlineCount: 0,
    keylineCount: 0,
    cornerArmCount: 0,
    linePseudoElementCount: 0,
    lineDomChildCount: 0,
    svgStrokeLineCount: 0,
    editorShadowCount: 0,
    passiveHeadingMarkerRemoved: false,
    drawerSeverityIndicatorRemoved: false,
  }
}

/**
 * §13/§14 — fold measured facts into gate counter deltas. Pure: the caller adds
 * the (non-negative) deltas to the session counters.
 */
export function measureActiveLocateFillOnlyGates(
  facts: ActiveLocateFillOnlyFacts,
  committed: boolean,
): { counters: Record<ActiveLocateFillOnlyGateKey, number>; fillOk: boolean } {
  const counters = createActiveLocateFillOnlyCounters()
  // §13 — the line gates only apply to a SUCCESSFULLY COMMITTED active locate.
  if (!committed) return { counters, fillOk: true }
  counters.activeLocateVerticalLineCount = Math.max(0, Math.floor(facts.verticalLineCount))
  counters.activeLocateHorizontalLineCount = Math.max(0, Math.floor(facts.horizontalLineCount))
  counters.activeLocateBorderCount = Math.max(0, Math.floor(facts.borderCount))
  counters.activeLocateOutlineCount = Math.max(0, Math.floor(facts.outlineCount))
  counters.activeLocateKeylineCount = Math.max(0, Math.floor(facts.keylineCount))
  counters.activeLocateCornerArmCount = Math.max(0, Math.floor(facts.cornerArmCount))
  counters.activeLocateLinePseudoElementCount = Math.max(0, Math.floor(facts.linePseudoElementCount))
  counters.activeLocateLineDomChildCount = Math.max(0, Math.floor(facts.lineDomChildCount))
  counters.activeLocateSvgStrokeLineCount = Math.max(0, Math.floor(facts.svgStrokeLineCount))
  counters.activeLocateEditorShadowCount = Math.max(0, Math.floor(facts.editorShadowCount))
  if (facts.passiveHeadingMarkerRemoved) counters.passiveHeadingMarkerUnexpectedRemovalCount = 1
  if (facts.drawerSeverityIndicatorRemoved) counters.drawerSeverityIndicatorUnexpectedRemovalCount = 1
  return { counters, fillOk: facts.fillCount >= ACTIVE_LOCATE_MIN_FILL_COUNT }
}
