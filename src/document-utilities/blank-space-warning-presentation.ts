/**
 * Blank-Space Warning Presentation Policy.
 *
 * Unifies the IN-DOCUMENT marker AND the Drawer/inline presentation of every
 * blank-space Warning so they look IDENTICAL to the reference
 * `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` ("trailing blank lines excessive")
 * document-end band: one FILL_ONLY Warning fill (no border / outline / shadow /
 * pseudo line).
 *
 * Pure contract: constants + predicates only — no DOM, no host state.
 */

export const BLANK_SPACE_WARNING_SEVERITY = 'warning' as const

/**
 * V8 §3 — the ONE active presentation shared by every blank-space Warning.
 * NEVER `FILL_ONLY`: it is a low-emphasis Warning surface PLUS one left accent
 * rail (the original document-end EOF band).
 */
export const BLANK_SPACE_WARNING_PRESENTATION_MODE = 'FILL_WITH_LEFT_ACCENT' as const

/** The marker class stamped onto every unified blank-space Warning band. */
export const BLANK_SPACE_WARNING_MARKER_CLASS = 'inkchapter-blank-space-warning'

// ── V8 §2/§3 — the shared document-end EOF presentation, extracted from
// `53f08b9:src/style.scss`. The COLOUR stays the token-based Warning mix (never a
// re-invented bright `rgba(255,190,20,0.38)` whole-surface fill); 醒目度优化 only
// raised the MIX (8 → 18) and moved the fill onto the continuous carrier band so
// the rendered blank-row warning is legible.
/** Warning surface token (a deepened Warning mix — raised from 8% for legibility). */
export const BLANK_SPACE_WARNING_BACKGROUND_TOKEN = '--ink-blank-space-warning-bg'
/** LEFT accent colour token (`--ink-ui-sev-warning`). */
export const BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN = '--ink-blank-space-warning-accent'
/**
 * The Warning surface mix percentage. Raised 8 → 18 (醒目度优化): the rendered
 * blank-row band now paints this ONCE on the continuous carrier container, so the
 * user actually sees a solid warning band (the old 8% per-row fragments read as
 * faint dashes).
 */
export const BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT = 18
/** The original LEFT accent rail width (px). */
export const BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX = 4
/** The original band border radius. */
export const BLANK_SPACE_WARNING_BORDER_RADIUS = '0 6px 6px 0'
/** Exactly one LEFT accent rail per band. */
export const BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT = 1

/** An honest band needs at least this many pixels of height to be painted. */
export const BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX = 2

/** Reference code — the document-end trailing-blank Warning. */
export const BLANK_SPACE_WARNING_EOF_CODE = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'

/** The internal sibling-block blank-gap Warning. */
export const BLANK_SPACE_WARNING_INTERNAL_CODE = 'EXCESSIVE_INTERNAL_BLANK_LINES'

/** The document-terminal-newline Warning. */
export const BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE = 'DOCUMENT_TERMINAL_NEWLINE_MISSING'

/** The strict first-H1 leading blank-space Warning family prefix. */
export const BLANK_SPACE_WARNING_LEADING_H1_PREFIX = 'STRICT_FIRST_H1_LEADING'

/** True for the `STRICT_FIRST_H1_LEADING*` family (leading blank zone above H1). */
export function isLeadingBlankSpaceWarningCode(code: string): boolean {
  return code.startsWith(BLANK_SPACE_WARNING_LEADING_H1_PREFIX)
}

/** True for the terminal-newline Warning code (strict equality). */
export function isTerminalNewlineBlankSpaceWarningCode(code: string): boolean {
  return code === BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE
}

/** True for every blank-space Warning code covered by this policy. */
export function isBlankSpaceWarningCode(code: string): boolean {
  return code === BLANK_SPACE_WARNING_EOF_CODE
    || code === BLANK_SPACE_WARNING_INTERNAL_CODE
    || code === BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE
    || isLeadingBlankSpaceWarningCode(code)
}

/** Every blank-space Warning code covered by this policy. */
export const BLANK_SPACE_WARNING_CODES: readonly string[] = [
  BLANK_SPACE_WARNING_EOF_CODE,
  BLANK_SPACE_WARNING_INTERNAL_CODE,
  BLANK_SPACE_WARNING_TERMINAL_NEWLINE_CODE,
  BLANK_SPACE_WARNING_LEADING_H1_PREFIX,
]

/** Frozen aggregation of the Blank-Space Warning Presentation Policy. */
export const BLANK_SPACE_WARNING_POLICY = Object.freeze({
  severity: BLANK_SPACE_WARNING_SEVERITY,
  presentationMode: BLANK_SPACE_WARNING_PRESENTATION_MODE,
  backgroundToken: BLANK_SPACE_WARNING_BACKGROUND_TOKEN,
  backgroundMixPercent: BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT,
  leftAccent: true,
  leftAccentToken: BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN,
  leftAccentWidthPx: BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX,
  leftAccentCount: BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT,
  borderTopWidthPx: 0,
  borderRightWidthPx: 0,
  borderBottomWidthPx: 0,
  borderRadius: BLANK_SPACE_WARNING_BORDER_RADIUS,
  outline: false,
  boxShadow: false,
  pointerEvents: 'none',
  layoutMutation: false,
  markerClass: BLANK_SPACE_WARNING_MARKER_CLASS,
  minVisibleHeightPx: BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX,
})

/** Deterministic, machine-readable policy report (one `KEY=value` line each). */
export function formatBlankSpaceWarningPolicyReport(): string[] {
  return [
    'BLANK_SPACE_WARNING_POLICY_ID=blank-space-warning-v1',
    `BLANK_SPACE_WARNING_SEVERITY=${BLANK_SPACE_WARNING_SEVERITY}`,
    `BLANK_SPACE_WARNING_PRESENTATION_MODE=${BLANK_SPACE_WARNING_PRESENTATION_MODE}`,
    `BLANK_SPACE_WARNING_BACKGROUND_TOKEN=${BLANK_SPACE_WARNING_BACKGROUND_TOKEN}`,
    `BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT=${BLANK_SPACE_WARNING_BACKGROUND_MIX_PERCENT}`,
    `BLANK_SPACE_WARNING_LEFT_ACCENT=true`,
    `BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN=${BLANK_SPACE_WARNING_LEFT_ACCENT_TOKEN}`,
    `BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX=${BLANK_SPACE_WARNING_LEFT_ACCENT_WIDTH_PX}`,
    `BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT=${BLANK_SPACE_WARNING_LEFT_ACCENT_COUNT}`,
    `BLANK_SPACE_WARNING_BORDER_RADIUS=${BLANK_SPACE_WARNING_BORDER_RADIUS}`,
    `BLANK_SPACE_WARNING_MARKER_CLASS=${BLANK_SPACE_WARNING_MARKER_CLASS}`,
    `BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX=${BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX}`,
  ]
}
