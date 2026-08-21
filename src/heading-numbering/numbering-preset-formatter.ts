/**
 * Numbering Preset Formatter — the CANONICAL preset id/type and raw-number
 * formatter. There must be exactly ONE switch/case that maps semantic scope +
 * style to a raw number string. UI descriptors and migration metadata live in
 * `object-numbering-presets.ts` and DELEGATE here.
 *
 *   GLOBAL       -> n
 *   CHAPTER_DOT  -> chapter.n
 *   SECTION_DOT  -> chapter.section.n
 *   CHAPTER_DASH -> chapter-n
 *   SECTION_DASH -> chapter.section-n
 *
 * Degradation only changes the effective scope passed in; the style (dot/dash)
 * stays fixed.
 */

import type { CaptionScope, NumberingStyle } from './semantic-heading-types'

export type NumberingPreset =
  | 'global'
  | 'chapter-dot'
  | 'section-dot'
  | 'chapter-dash'
  | 'section-dash'

/** Public standard presets plus the internal `legacy-custom` compatibility state. */
export type ObjectNumberingPreset = NumberingPreset | 'legacy-custom'

export interface PresetScopeStyle {
  requestedScope: CaptionScope
  style: NumberingStyle
}

export function presetToScopeStyle(preset: NumberingPreset): PresetScopeStyle {
  switch (preset) {
    case 'global': return { requestedScope: 'global', style: 'dot' }
    case 'chapter-dot': return { requestedScope: 'chapter', style: 'dot' }
    case 'section-dot': return { requestedScope: 'section', style: 'dot' }
    case 'chapter-dash': return { requestedScope: 'chapter', style: 'dash' }
    case 'section-dash': return { requestedScope: 'section', style: 'dash' }
  }
}

const STANDARD_PRESETS: readonly string[] = ['global', 'chapter-dot', 'section-dot', 'chapter-dash', 'section-dash']
const OBJECT_NUMBERING_PRESETS: readonly string[] = [...STANDARD_PRESETS, 'legacy-custom']

/** Canonical runtime membership check for the five standard presets. */
export function isStandardNumberingPreset(value: unknown): value is NumberingPreset {
  return typeof value === 'string' && STANDARD_PRESETS.includes(value)
}

/** Canonical runtime membership check for the full object-numbering preset set. */
export function isObjectNumberingPreset(value: unknown): value is ObjectNumberingPreset {
  return typeof value === 'string' && OBJECT_NUMBERING_PRESETS.includes(value)
}

/**
 * CANONICAL raw-number formatter. `minDigits` pads only the object `{n}`
 * ordinal; Chapter / Section are never padded.
 */
export function formatObjectNumber(
  scope: CaptionScope,
  style: NumberingStyle,
  chapter: number | null,
  section: number | null,
  ordinal: number,
  minDigits = 1,
): string {
  const n = String(Math.max(0, Math.floor(ordinal))).padStart(Math.max(1, minDigits), '0')
  if (scope === 'global') return n
  if (scope === 'chapter') {
    const c = chapter ?? 0
    return style === 'dash' ? `${c}-${n}` : `${c}.${n}`
  }
  const c = chapter ?? 0
  const s = section ?? 0
  return style === 'dash' ? `${c}.${s}-${n}` : `${c}.${s}.${n}`
}
