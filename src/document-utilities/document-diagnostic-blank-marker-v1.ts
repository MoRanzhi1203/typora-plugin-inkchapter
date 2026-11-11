/**
 * Blank-line diagnostic marker facts (M1) — PURE.
 *
 * Three rules share ONE visual language but keep their OWN identities/counts:
 *
 *   INTERNAL_EXCESS  `EXCESSIVE_INTERNAL_BLANK_LINES`        left 2px solid
 *   END_EXCESS       `DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE` left 2px solid
 *   END_MISSING      `DOCUMENT_TERMINAL_NEWLINE_MISSING`     short dashed
 *
 * EVERY count comes from the normalized diagnostic metadata (the same numbers
 * the rule/publication decision used). Nothing here inspects DOM height and
 * nothing re-applies the policy threshold a second time.
 */

export type BlankLineMarkerKind = 'INTERNAL_EXCESS' | 'END_EXCESS' | 'END_MISSING'

export const INTERNAL_BLANK_MARKER_RULE = 'EXCESSIVE_INTERNAL_BLANK_LINES'
export const END_EXCESS_BLANK_MARKER_RULE = 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE'
export const END_MISSING_BLANK_MARKER_RULE = 'DOCUMENT_TERMINAL_NEWLINE_MISSING'

export interface BlankLineMarkerFact {
  kind: BlankLineMarkerKind
  /** The count stated by the label. Always >= 1 for an emitted marker. */
  count: number
  text: string
  lineStyle: 'solid' | 'dashed'
}

function intOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function metaOf(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return metadata ?? {}
}

/**
 * INTERNAL_EXCESS — `actualBlankLines` minus the policy allowance.
 * The policy allowance travels on the SAME diagnostic (`passMaxBlankLines`), so
 * this is a subtraction of two authoritative fields, not a guessed threshold.
 */
export function resolveInternalExcessCount(metadata: Record<string, unknown> | null | undefined): number | null {
  const meta = metaOf(metadata)
  const actual = intOf(meta['actualBlankLines'])
  const pass = intOf(meta['passMaxBlankLines'])
  if (actual == null || pass == null) return null
  const excess = actual - pass
  return excess > 0 ? excess : null
}

/** END_EXCESS — the producer's `extraTrailingBlankLineCount` (authoritative). */
export function resolveEndExcessCount(metadata: Record<string, unknown> | null | undefined): number | null {
  const extra = intOf(metaOf(metadata)['extraTrailingBlankLineCount'])
  if (extra == null || extra <= 0) return null
  return extra
}

/**
 * END_MISSING — `terminalNewlineCount === 0` means the file ends without the
 * required terminal newline: exactly ONE missing newline/blank slot. Never
 * derived from line heights or from the file length.
 */
export function resolveEndMissingCount(metadata: Record<string, unknown> | null | undefined): number | null {
  const meta = metaOf(metadata)
  const terminal = intOf(meta['terminalNewlineCount'])
  if (terminal == null) return null
  return terminal === 0 ? 1 : null
}

export function formatBlankMarkerText(kind: BlankLineMarkerKind, count: number): string {
  const n = Math.max(0, Math.round(count))
  return kind === 'END_MISSING' ? `缺少 ${n} 空行` : `多余 ${n} 空行`
}

export function resolveBlankLineMarkerFact(
  code: string,
  metadata: Record<string, unknown> | null | undefined,
): BlankLineMarkerFact | null {
  if (code === INTERNAL_BLANK_MARKER_RULE) {
    const count = resolveInternalExcessCount(metadata)
    return count == null ? null : { kind: 'INTERNAL_EXCESS', count, text: formatBlankMarkerText('INTERNAL_EXCESS', count), lineStyle: 'solid' }
  }
  if (code === END_EXCESS_BLANK_MARKER_RULE) {
    const count = resolveEndExcessCount(metadata)
    return count == null ? null : { kind: 'END_EXCESS', count, text: formatBlankMarkerText('END_EXCESS', count), lineStyle: 'solid' }
  }
  if (code === END_MISSING_BLANK_MARKER_RULE) {
    const count = resolveEndMissingCount(metadata)
    return count == null ? null : { kind: 'END_MISSING', count, text: formatBlankMarkerText('END_MISSING', count), lineStyle: 'dashed' }
  }
  return null
}

/** The marker label text for a diagnostic, or null when it is not a blank rule. */
export function blankLineMarkerText(
  code: string,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  return resolveBlankLineMarkerFact(code, metadata)?.text ?? null
}
