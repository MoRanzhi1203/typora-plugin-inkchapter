/**
 * B3 §B3-03 — academic / lab-report WIDTH model (pure).
 *
 * Converts a named width preset (or a custom CSS px value) into a bounded
 * content-width contract. It never writes CSS; the UI layer consumes the result.
 */
export const ACADEMIC_WIDTH_PRESETS = Object.freeze({
  narrow: 720,
  standard: 820,
  wide: 960,
  'lab-report': 900,
} as const)

export type AcademicWidthPreset = keyof typeof ACADEMIC_WIDTH_PRESETS

export interface AcademicWidthModel {
  preset: AcademicWidthPreset | 'custom'
  contentWidthPx: number
  /** Comfortable reading range used by the over-wide warning. */
  comfortableMinPx: number
  comfortableMaxPx: number
  /** Hard bounds; a custom value is clamped into this range with a notice. */
  minPx: number
  maxPx: number
  clamped: boolean
}

export const ACADEMIC_WIDTH_BOUNDS = Object.freeze({
  minPx: 560,
  maxPx: 1200,
  comfortableMinPx: 640,
  comfortableMaxPx: 1100,
})

export function resolveAcademicWidthModel(input: {
  preset?: AcademicWidthPreset
  customPx?: number
}): AcademicWidthModel {
  const preset = input.preset ?? 'standard'
  const requested = input.preset != null
    ? ACADEMIC_WIDTH_PRESETS[input.preset]
    : (Number.isFinite(input.customPx) ? Math.round(input.customPx as number) : ACADEMIC_WIDTH_PRESETS.standard)
  const clamped = requested < ACADEMIC_WIDTH_BOUNDS.minPx || requested > ACADEMIC_WIDTH_BOUNDS.maxPx
  const contentWidthPx = Math.min(
    ACADEMIC_WIDTH_BOUNDS.maxPx,
    Math.max(ACADEMIC_WIDTH_BOUNDS.minPx, requested),
  )
  return {
    preset: input.preset ?? (clamped ? 'custom' : 'standard'),
    contentWidthPx,
    comfortableMinPx: ACADEMIC_WIDTH_BOUNDS.comfortableMinPx,
    comfortableMaxPx: ACADEMIC_WIDTH_BOUNDS.comfortableMaxPx,
    minPx: ACADEMIC_WIDTH_BOUNDS.minPx,
    maxPx: ACADEMIC_WIDTH_BOUNDS.maxPx,
    clamped,
  }
}

/** Formula render overflow threshold relative to the resolved content width. */
export function formulaWidthLimitForContent(contentWidthPx: number): number {
  return Math.max(1, Math.floor(contentWidthPx))
}
