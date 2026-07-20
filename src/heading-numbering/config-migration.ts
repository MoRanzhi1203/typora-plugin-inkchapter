import type { HeadingLevel, HeadingNumberingPreset, HeadingNumberingSettings } from './heading-types'
import { HEADING_LEVELS } from './heading-types'
import { getPresetLevels } from './presets'

/** Default level style for custom mode. */
function defaultLevelStyle(): Record<HeadingLevel, import('./heading-types').HeadingLevelStyle> {
  const ls = {} as Record<HeadingLevel, import('./heading-types').HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    ls[lv] = {
      enabled: true,
      tokenStyle: 'arabic',
      includeParents: true,
      prefix: '',
      suffix: '',
      separator: '.',
    }
  }
  return ls
}

/**
 * Migrate legacy or incomplete settings to the current schema.
 * Idempotent: repeated calls produce the same result.
 */
export function migrateSettings(
  raw: Partial<HeadingNumberingSettings> | null | undefined,
): HeadingNumberingSettings {
  const s = raw ?? ({} as Partial<HeadingNumberingSettings>)

  const preset: HeadingNumberingPreset =
    s.preset === 'chinese-chapter' || s.preset === 'chinese-outline' ||
    s.preset === 'roman-hierarchical' || s.preset === 'custom'
      ? s.preset
      : 'decimal-hierarchical'

  const showLevelOneNumber = s.showLevelOneNumber ?? false
  const enabled = s.enabled ?? true
  const maxDepth = s.maxDepth ?? 6

  // Build levels from preset or stored custom
  let levels: Record<HeadingLevel, import('./heading-types').HeadingLevelStyle>
  if (preset === 'custom' && s.levels) {
    // Merge stored levels with defaults for missing keys
    levels = { ...defaultLevelStyle() }
    for (const lv of HEADING_LEVELS) {
      if (s.levels[lv]) {
        levels[lv] = { ...levels[lv], ...s.levels[lv] }
      }
    }
  } else {
    levels = getPresetLevels(preset)
  }

  return {
    enabled,
    showLevelOneNumber,
    preset,
    maxDepth: maxDepth as HeadingLevel,
    levels,
    // Preserve legacy fields for idempotency
    separator: s.separator ?? '.',
    suffix: s.suffix ?? '',
    showTrailingSeparator: s.showTrailingSeparator ?? false,
  }
}

/**
 * Check if the stored settings need migration (missing preset or levels).
 */
export function needsMigration(raw: Partial<HeadingNumberingSettings> | null | undefined): boolean {
  if (!raw) return true
  if (!raw.preset) return true
  if (!raw.levels || Object.keys(raw.levels).length === 0) return true
  return false
}
