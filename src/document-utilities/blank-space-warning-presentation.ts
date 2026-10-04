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

/** The single presentation mode shared by every blank-space Warning band. */
export const BLANK_SPACE_WARNING_PRESENTATION_MODE = 'FILL_ONLY' as const

/** The Warning fill token reused by the EOF band and the internal gap band. */
export const BLANK_SPACE_WARNING_FILL_TOKEN = '--ink-diagnostic-warning-active-bg'

/** The marker class stamped onto every unified blank-space Warning band. */
export const BLANK_SPACE_WARNING_MARKER_CLASS = 'inkchapter-blank-space-warning'

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
  fillToken: BLANK_SPACE_WARNING_FILL_TOKEN,
  markerClass: BLANK_SPACE_WARNING_MARKER_CLASS,
  minVisibleHeightPx: BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX,
})

/** Deterministic, machine-readable policy report (one `KEY=value` line each). */
export function formatBlankSpaceWarningPolicyReport(): string[] {
  return [
    'BLANK_SPACE_WARNING_POLICY_ID=blank-space-warning-v1',
    `BLANK_SPACE_WARNING_SEVERITY=${BLANK_SPACE_WARNING_SEVERITY}`,
    `BLANK_SPACE_WARNING_PRESENTATION_MODE=${BLANK_SPACE_WARNING_PRESENTATION_MODE}`,
    `BLANK_SPACE_WARNING_FILL_TOKEN=${BLANK_SPACE_WARNING_FILL_TOKEN}`,
    `BLANK_SPACE_WARNING_MARKER_CLASS=${BLANK_SPACE_WARNING_MARKER_CLASS}`,
    `BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX=${BLANK_SPACE_WARNING_MIN_VISIBLE_HEIGHT_PX}`,
  ]
}
