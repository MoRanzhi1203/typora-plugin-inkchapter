/**
 * V5.12-R8 §11/§14/§15 — Code Caption → Code Body scoped spacing (pure).
 *
 * ONLY the vertical gap between an InkChapter CODE caption and ITS code block
 * is tightened. Code line-height, the code block's internal padding, the global
 * Typora `pre` / `code` / `.md-fences` margins and the Table/Figure/Formula
 * caption spacing are all FROZEN.
 */

export const CAPTION_CODE_SPACING_AUDIT_EVENT = 'DOCUMENT-CAPTION-CODE-SPACING-AUDIT'

/** §11 — the visual target band. */
export const CAPTION_CODE_GAP_TARGET_MIN_PX = 2
export const CAPTION_CODE_GAP_TARGET_MAX_PX = 4
/** §11 — the hard gate band (never glued, never a legacy 15px block margin). */
export const CAPTION_CODE_GAP_GATE_MIN_PX = 1
export const CAPTION_CODE_GAP_GATE_MAX_PX = 6

export interface CaptionCodeSpacingFacts {
  captionRect: { left: number; top: number; right: number; bottom: number } | null
  codeBodyRect: { left: number; top: number; right: number; bottom: number } | null
  /** Measured gap in px (codeBodyRect.top − captionRect.bottom). */
  effectiveGapPx: number | null
  captionMarginBottom: number | null
  codeMarginTop: number | null
  wrapperGap: number | null
  decision: 'PASS' | 'FAIL' | 'NOT_APPLICABLE'
}

export function evaluateCaptionCodeSpacingGap(
  effectiveGapPx: number | null,
): { decision: 'PASS' | 'FAIL' | 'NOT_APPLICABLE'; reason: string } {
  if (effectiveGapPx == null || !Number.isFinite(effectiveGapPx)) {
    return { decision: 'NOT_APPLICABLE', reason: 'NO_MEASURABLE_GAP' }
  }
  if (effectiveGapPx < CAPTION_CODE_GAP_GATE_MIN_PX) {
    return { decision: 'FAIL', reason: 'CODE_CAPTION_BODY_GAP_LT_1PX' }
  }
  if (effectiveGapPx > CAPTION_CODE_GAP_GATE_MAX_PX) {
    return { decision: 'FAIL', reason: 'CODE_CAPTION_BODY_GAP_GT_6PX' }
  }
  return { decision: 'PASS', reason: 'CODE_CAPTION_BODY_GAP_OK' }
}

// ── Hard gates (§14) ─────────────────────────────────────

export const CAPTION_CODE_SPACING_V512R8_GATE_KEYS = [
  'gapGt6px',
  'gapLt1px',
  'globalPreMarginMutation',
  'lineHeightMutation',
  'internalCodePaddingMutation',
] as const

export type CaptionCodeSpacingV512R8GateKey = typeof CAPTION_CODE_SPACING_V512R8_GATE_KEYS[number]

export const CAPTION_CODE_SPACING_V512R8_GATE_LABELS: Readonly<Record<CaptionCodeSpacingV512R8GateKey, string>> = {
  gapGt6px: 'CODE_CAPTION_BODY_GAP_GT_6PX_COUNT',
  gapLt1px: 'CODE_CAPTION_BODY_GAP_LT_1PX_COUNT',
  globalPreMarginMutation: 'CODE_CAPTION_GLOBAL_PRE_MARGIN_MUTATION_COUNT',
  lineHeightMutation: 'CODE_CAPTION_LINE_HEIGHT_MUTATION_COUNT',
  internalCodePaddingMutation: 'CODE_CAPTION_INTERNAL_CODE_PADDING_MUTATION_COUNT',
}

export type CaptionCodeSpacingV512R8Counters = Record<CaptionCodeSpacingV512R8GateKey, number>

export function createCaptionCodeSpacingV512R8Counters(): CaptionCodeSpacingV512R8Counters {
  return CAPTION_CODE_SPACING_V512R8_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as CaptionCodeSpacingV512R8Counters)
}

export function evaluateCaptionCodeSpacingV512R8Gates(
  counters: Readonly<CaptionCodeSpacingV512R8Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: CaptionCodeSpacingV512R8GateKey[] } {
  const failedChecks = CAPTION_CODE_SPACING_V512R8_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

export function formatCaptionCodeSpacingV512R8GateReport(
  counters: Readonly<CaptionCodeSpacingV512R8Counters>,
): string[] {
  return CAPTION_CODE_SPACING_V512R8_GATE_KEYS.map(k => `${CAPTION_CODE_SPACING_V512R8_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}
