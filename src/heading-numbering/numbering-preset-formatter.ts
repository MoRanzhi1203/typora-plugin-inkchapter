/**
 * Numbering Preset Formatter (Phase 4) — the five ordinary presets and the
 * shared format-number function.
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

/**
 * Format the canonical numeric ordinals into a display number string.
 *
 * @param scope       effective (already-degraded) scope
 * @param style       dot or dash
 * @param chapter     chapter ordinal (null unless scope >= chapter)
 * @param section     section ordinal (null unless scope === section)
 * @param ordinal     1-based ordinal within the effective scope
 */
export function formatObjectNumber(
  scope: CaptionScope,
  style: NumberingStyle,
  chapter: number | null,
  section: number | null,
  ordinal: number,
): string {
  if (scope === 'global') return String(ordinal)
  if (scope === 'chapter') {
    const c = chapter ?? 0
    return style === 'dash' ? `${c}-${ordinal}` : `${c}.${ordinal}`
  }
  const c = chapter ?? 0
  const s = section ?? 0
  return style === 'dash' ? `${c}.${s}-${ordinal}` : `${c}.${s}.${ordinal}`
}
