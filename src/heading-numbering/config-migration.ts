import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset, HeadingNumberingSettings, NumberTokenStyle } from './heading-types'
import { HEADING_LEVELS } from './heading-types'
import { getPresetLevels } from './presets'
import * as logger from '../core/logger'

const VALID_TOKEN_STYLES: ReadonlySet<string> = new Set([
  'arabic', 'chinese', 'chinese-financial',
  'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower', 'circled',
])

const VALID_PRESETS: ReadonlySet<string> = new Set([
  'decimal-hierarchical', 'chinese-chapter', 'chinese-outline', 'roman-hierarchical', 'custom',
])

const CURRENT_SCHEMA_VERSION = 3

// ── Validation helpers ─────────────────────────────────

function validateBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function validatePreset(raw: unknown): HeadingNumberingPreset {
  if (typeof raw === 'string' && VALID_PRESETS.has(raw)) {
    return raw as HeadingNumberingPreset
  }
  return 'decimal-hierarchical'
}

function validateMaxDepth(raw: unknown): HeadingLevel {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 6) {
    return raw as HeadingLevel
  }
  return 6 as HeadingLevel
}

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
      startAt: 1,
      restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
      legalStyle: false,
    }
  }
  return ls
}

function validateStartAt(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 999) return raw
  return 1
}

function validateRestartAfterLevel(raw: unknown, currentLevel: HeadingLevel): HeadingLevel | null {
  if (raw === null || raw === undefined) return currentLevel === 1 ? null : (currentLevel - 1) as HeadingLevel
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw < currentLevel) return raw as HeadingLevel
  return currentLevel === 1 ? null : (currentLevel - 1) as HeadingLevel
}

function validateLegalStyle(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  return false
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
      startAt: validateStartAt((old as any).startAt),
      restartAfterLevel: validateRestartAfterLevel((old as any).restartAfterLevel, lv),
      legalStyle: validateLegalStyle((old as any).legalStyle),
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
    const defaults = defaultLevelStyle()
    return {
      enabled: true,
      showLevelOneNumber: false,
      preset: 'decimal-hierarchical',
      maxDepth: 6 as HeadingLevel,
      levels: defaults,
      customDefinition: { ...defaults },
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

  const preset = validatePreset(s.preset)
  const showLevelOneNumber = validateBoolean(s.showLevelOneNumber, false)
  const enabled = validateBoolean(s.enabled, true)
  const maxDepth = validateMaxDepth(s.maxDepth)

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
          startAt: validateStartAt((storedLevel as any).startAt),
          restartAfterLevel: validateRestartAfterLevel((storedLevel as any).restartAfterLevel, lv),
          legalStyle: validateLegalStyle((storedLevel as any).legalStyle),
        }
      }
    }
  } else {
    levels = getPresetLevels(preset)
  }

  // ── Migrate / normalize customDefinition ───────────────
  let customDef: Record<HeadingLevel, HeadingLevelStyle> | undefined
  const storedCustomDef = (s as any)?.customDefinition as Record<string, unknown> | undefined
  if (storedCustomDef && typeof storedCustomDef === 'object') {
    // V2 format: customDefinition is a flat {1: style, 2: style, ...} record
    customDef = { ...defaultLevelStyle() }
    for (const lv of HEADING_LEVELS) {
      const sd = storedCustomDef[String(lv)] ?? storedCustomDef[lv]
      if (sd && typeof sd === 'object') {
        customDef[lv] = {
          enabled: typeof (sd as any).enabled === 'boolean' ? (sd as any).enabled : true,
          tokenStyle: normalizeTokenStyle((sd as any).tokenStyle),
          includeParents: typeof (sd as any).includeParents === 'boolean' ? (sd as any).includeParents : true,
          prefix: typeof (sd as any).prefix === 'string' ? sanitizeString((sd as any).prefix) : '',
          suffix: typeof (sd as any).suffix === 'string' ? sanitizeString((sd as any).suffix) : '',
          separator: typeof (sd as any).separator === 'string' ? sanitizeString((sd as any).separator, '.') : '.',
          startAt: validateStartAt((sd as any).startAt),
          restartAfterLevel: validateRestartAfterLevel((sd as any).restartAfterLevel, lv),
          legalStyle: validateLegalStyle((sd as any).legalStyle),
        }
      }
    }
  } else {
    // V1→V2: initialize customDefinition from current levels
    customDef = { ...levels }
  }

  return {
    enabled,
    showLevelOneNumber,
    preset,
    maxDepth,
    levels,
    customDefinition: customDef,
    // Preserve legacy fields for idempotency
    separator: s.separator ?? '.',
    suffix: s.suffix ?? '',
    showTrailingSeparator: s.showTrailingSeparator ?? false,
  }
}

/**
 * Clean control chars, HTML, and newlines from user input strings.
 */
function sanitizeString(val: string, fallback = ''): string {
  return val
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\n/g, '')
    .slice(0, 16) || fallback
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
