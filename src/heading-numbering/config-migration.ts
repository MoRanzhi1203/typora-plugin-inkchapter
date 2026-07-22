import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset, HeadingNumberingSettings, NumberTokenStyle } from './heading-types'
import { HEADING_LEVELS } from './heading-types'
import { getPresetLevels } from './presets'
import * as logger from '../core/logger'

const VALID_TOKEN_STYLES: ReadonlySet<string> = new Set([
  'arabic', 'chinese', 'chinese-financial',
  'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower', 'circled',
])

/** Default level style for custom mode. */
function defaultLevelStyle(): Record<HeadingLevel, HeadingLevelStyle> {
  const ls = {} as Record<HeadingLevel, HeadingLevelStyle>
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
 * Try to map legacy numberStyle (string) to current tokenStyle.
 * Returns a valid tokenStyle or 'arabic' as fallback.
 */
function normalizeTokenStyle(raw: unknown): NumberTokenStyle {
  if (typeof raw === 'string' && VALID_TOKEN_STYLES.has(raw)) {
    return raw as NumberTokenStyle
  }
  return 'arabic'
}

/**
 * Detect includeParents from legacy format array.
 * If any segment references a level below the current level, includeParents = true.
 */
function inferIncludeParents(format: unknown, currentLevel: HeadingLevel): boolean {
  if (!Array.isArray(format) || format.length === 0) return true
  for (const seg of format) {
    if (seg && typeof seg === 'object' && (seg as any).type === 'level-reference') {
      const refLevel = Number((seg as any).level)
      if (!isNaN(refLevel) && refLevel < currentLevel) {
        return true
      }
    }
  }
  return format.every((seg: any) => seg?.type !== 'level-reference')
    ? true
    : false
}

/**
 * Migrate legacy customDefinition.levels (old Word-style format) to current schema.
 * Fields mapped: numberStyle→tokenStyle, format→includeParents.
 * Fields dropped: position, startAt, restartAfterLevel, legalStyle, isCustomFormat.
 */
function migrateLegacyLevels(
  legacyLevels: Record<string, unknown> | null | undefined,
): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = defaultLevelStyle()
  if (!legacyLevels || typeof legacyLevels !== 'object') return levels

  for (const lv of HEADING_LEVELS) {
    const old = (legacyLevels as any)[String(lv)] ?? (legacyLevels as any)[lv]
    if (!old || typeof old !== 'object') continue

    levels[lv] = {
      enabled: old.enabled === false ? false : true,
      tokenStyle: normalizeTokenStyle(old.numberStyle ?? old.tokenStyle),
      includeParents: inferIncludeParents(old.format, lv),
      prefix: typeof old.prefix === 'string' ? old.prefix : '',
      suffix: typeof old.suffix === 'string' ? old.suffix : '',
      separator: typeof old.separator === 'string' ? old.separator : '.',
    }
  }
  return levels
}

/**
 * Migrate legacy or incomplete settings to the current schema.
 * Idempotent: repeated calls produce the same result.
 * Never throws: returns safe defaults on any error.
 */
export function migrateSettings(
  raw: Partial<HeadingNumberingSettings> | null | undefined,
): HeadingNumberingSettings {
  try {
    return doMigrate(raw)
  } catch (e) {
    logger.error('设置迁移失败，将使用默认标题编号设置', e)
    return {
      enabled: true,
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6 as HeadingLevel,
      levels: defaultLevelStyle(),
    }
  }
}

function doMigrate(
  raw: Partial<HeadingNumberingSettings> | null | undefined,
): HeadingNumberingSettings {
  const s = raw ?? ({} as Partial<HeadingNumberingSettings>)

  // ── Handle legacy customDefinition wrapper ──────────────
  const legacyCustomDef = (s as any)?.customDefinition
  if (legacyCustomDef?.levels && !s.levels) {
    logger.info('检测到旧版 customDefinition 配置，自动迁移中...')
    s.levels = migrateLegacyLevels(legacyCustomDef.levels)
  }

  const preset: HeadingNumberingPreset =
    s.preset === 'chinese-chapter' || s.preset === 'chinese-outline' ||
    s.preset === 'roman-hierarchical' || s.preset === 'custom'
      ? s.preset
      : 'decimal-hierarchical'

  const showLevelOneNumber = s.showLevelOneNumber ?? false
  const enabled = s.enabled ?? true
  const maxDepth = s.maxDepth ?? 6

  // Build levels from preset or stored custom
  let levels: Record<HeadingLevel, HeadingLevelStyle>
  if (preset === 'custom' && s.levels) {
    // Merge stored levels with defaults for missing keys
    levels = { ...defaultLevelStyle() }
    for (const lv of HEADING_LEVELS) {
      const storedLevel = s.levels[lv]
      if (storedLevel && typeof storedLevel === 'object') {
        // Defensive per-level merge: only copy known fields
        levels[lv] = {
          enabled: storedLevel.enabled === false ? false : true,
          tokenStyle: normalizeTokenStyle(storedLevel.tokenStyle),
          includeParents: storedLevel.includeParents === false ? false : true,
          prefix: typeof storedLevel.prefix === 'string' ? storedLevel.prefix : '',
          suffix: typeof storedLevel.suffix === 'string' ? storedLevel.suffix : '',
          separator: typeof storedLevel.separator === 'string' ? storedLevel.separator : '.',
        }
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
