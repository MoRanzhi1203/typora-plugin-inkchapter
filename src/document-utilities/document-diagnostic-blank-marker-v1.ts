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
 * INTERNAL_EXCESS — the VISIBLE excess over THIS PAIR's allowance.
 *
 * ADJACENT BLANK-LINE POLICY MATRIX V1 — the label must state the rendered
 * paragraphs the user really sees, so the count is
 * `publishedBlankLineCount − blankPairAllowance − structuralRenderedBlankLines`
 * (the one structural separator row is never an "extra" blank; the extra
 * allowance is 1 only for paragraph→paragraph, 0 otherwise). The source
 * `actualBlankLines − passMaxBlankLines` is kept ONLY as a legacy fallback for
 * records produced before the matrix.
 */
export function resolveInternalExcessCount(metadata: Record<string, unknown> | null | undefined): number | null {
  const meta = metaOf(metadata)
  const published = intOf(meta['publishedBlankLineCount']) ?? intOf(meta['visibleBlankLineCount'])
  const allowance = intOf(meta['blankPairAllowance']) ?? intOf(meta['passMaxBlankLines'])
  if (published != null && allowance != null) {
    // The structural separator row is NOT an extra blank: subtract it too.
    const structural = intOf(meta['blankPairStructuralRenderedBlankLines']) ?? 0
    const excess = published - allowance - structural
    return excess > 0 ? excess : null
  }
  const actual = intOf(meta['actualBlankLines'])
  if (actual == null || allowance == null) return null
  const excess = actual - allowance
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

/**
 * M1 — is the EOF marker SURFACE actually painted?
 *
 * The unified presentation is NO-FILL by design (left 2px rail / 18px dashed
 * endpoint), while the legacy FILL_ONLY gate required `fillCount >= 1` and
 * therefore rolled the marker back on every click. Any plugin-owned visible
 * surface (background fill, the endpoint form, or the left rail border) proves
 * the marker was really painted; a carrier with none of them must still FAIL.
 */
export function resolveEofMarkerSurfacePainted(input: {
  fillCount: number
  pluginOwnedBorderCount: number
  endpointForm: boolean
  /** M1-LAYOUT — the rail is a separate gutter strip (no carrier border). */
  railPainted?: boolean
}): boolean {
  return input.fillCount >= 1
    || input.pluginOwnedBorderCount >= 1
    || input.endpointForm === true
    || input.railPainted === true
}

/**
 * §4/§5 — RENDER-LAYER blank-line counting authority (M1-RENDER-COUNT).
 *
 * The count the USER sees must come from the REAL Typora editing structure, NOT
 * from the number of `\n` characters in the Markdown source. Measured mapping
 * (Typora 1.6.7, WYSIWYG, fixture `__gui-b*.md`):
 *
 *   source blank lines | rendered empty `<p>` rows
 *   -------------------+---------------------------
 *          0           |            0   (soft break)
 *          1           |            0
 *          2           |            0
 *          4           |            1
 *          9           |            4
 *   EOF 3 trailing      |            2
 *   EOF 0 (clean file)  |            0   (no phantom placeholder row)
 *
 * Therefore `renderedBlankLineCount` is the number of REAL empty editable rows
 * inside the region (see `resolveRenderedBlankRows`), never `sourceBlankLineCount`
 * and never `actualBlankLines - passMaxBlankLines`.
 *
 * When the rendered structure cannot be proven, the result is explicitly
 * `NOT_VERIFIED` with a null count — a source number must NEVER impersonate it.
 */
export type BlankLineCountConfidence = 'VERIFIED' | 'NOT_VERIFIED'

export interface BlankLineMarkerCounts {
  renderedBlankLineCount: number | null
  allowedBlankLineCount: number
  excessBlankLineCount: number | null
  missingBlankLineCount: number | null
  countEvidence: string
  countConfidence: BlankLineCountConfidence
}

/**
 * §5 — `excess = max(0, rendered − allowed)` and
 *       `missing = max(0, required − rendered)`, computed ONLY from a verified
 *       rendered count. `allowed` is the rule's own allowance (never re-guessed).
 */
export function resolveRenderedBlankLineCounts(input: {
  kind: BlankLineMarkerKind
  renderedBlankLineCount: number | null
  allowedBlankLineCount: number
  requiredBlankLineCount?: number
  evidence: string
}): BlankLineMarkerCounts {
  const allowed = Math.max(0, Math.round(input.allowedBlankLineCount))
  const rendered = input.renderedBlankLineCount
  const verified = typeof rendered === 'number' && Number.isFinite(rendered) && rendered >= 0
  if (!verified) {
    return {
      renderedBlankLineCount: null,
      allowedBlankLineCount: allowed,
      excessBlankLineCount: null,
      missingBlankLineCount: null,
      countEvidence: `${input.evidence}:RENDERED_UNKNOWN`,
      countConfidence: 'NOT_VERIFIED',
    }
  }
  const count = Math.round(rendered)
  const required = Math.max(0, Math.round(input.requiredBlankLineCount ?? 1))
  return {
    renderedBlankLineCount: count,
    allowedBlankLineCount: allowed,
    excessBlankLineCount: Math.max(0, count - allowed),
    missingBlankLineCount: Math.max(0, required - count),
    countEvidence: input.evidence,
    countConfidence: 'VERIFIED',
  }
}

/**
 * §5 — the label number for a verified rendered count.
 *
 * Excesso rules state the RENDERED blank-line count (the number the user can
 * actually see and count in the editor) — the same number the Drawer headline
 * states; the Drawer then spells out allowed/excess. The missing rule states the
 * shortfall. Returns null when the rendered structure is not verified.
 */
export function renderedMarkerLabelText(counts: BlankLineMarkerCounts, kind: BlankLineMarkerKind): string | null {
  if (counts.countConfidence !== 'VERIFIED') return null
  if (kind === 'END_MISSING') {
    const missing = counts.missingBlankLineCount
    return missing == null ? null : formatBlankMarkerText('END_MISSING', missing)
  }
  const rendered = counts.renderedBlankLineCount
  return rendered == null ? null : formatBlankMarkerText(kind, rendered)
}
