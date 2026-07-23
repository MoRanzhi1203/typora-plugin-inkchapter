import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset, HeadingNumberingSettings, NumberTokenStyle, NumberFormatSegment } from './heading-types'
import { HEADING_LEVELS } from './heading-types'
import { getPresetLevels } from './presets'
import { stripHiddenLevelReferences } from './numbering-engine'
import * as logger from '../core/logger'

const VALID_TOKEN_STYLES: ReadonlySet<string> = new Set([
  'arabic', 'chinese', 'chinese-financial',
  'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower', 'circled',
])

const VALID_PRESETS: ReadonlySet<string> = new Set([
  'decimal-hierarchical', 'chinese-chapter', 'chinese-outline', 'roman-hierarchical', 'custom',
])

const CURRENT_SCHEMA_VERSION = 5

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
      formatVariants: { withLevelOne: [], withoutLevelOne: [] },
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

// ── Format migration (v4 → v5) ─────────────────────

/**
 * Generate formatVariants from a stored level style.
 * - withLevelOne = normalized old format (or generated from legacy fields)
 * - withoutLevelOne = withLevelOne with L1 refs stripped
 */
function migrateLevelToVariants(storedLevel: any, lv: HeadingLevel): {
  formatVariants: { withLevelOne: NumberFormatSegment[]; withoutLevelOne: NumberFormatSegment[] }
  includeParents: boolean
} {
  // Check if already has formatVariants (v5+)
  if (storedLevel?.formatVariants?.withLevelOne && storedLevel?.formatVariants?.withoutLevelOne) {
    return {
      formatVariants: {
        withLevelOne: normalizeFormat(storedLevel.formatVariants.withLevelOne, lv),
        withoutLevelOne: normalizeWithoutL1Format(lv, storedLevel.formatVariants.withoutLevelOne),
      },
      includeParents: storedLevel.includeParents ?? true,
    }
  }

  // Migrate from old format or legacy includeParents
  const oldFormat = (storedLevel as any)?.format
  let withLevelOne: NumberFormatSegment[]

  if (Array.isArray(oldFormat) && oldFormat.length > 0) {
    withLevelOne = normalizeFormat(oldFormat, lv)
  } else {
    // Generate from legacy includeParents/prefix/suffix/separator
    const incParents = (storedLevel as any)?.includeParents ?? true
    const prefix = typeof (storedLevel as any)?.prefix === 'string' ? (storedLevel as any).prefix : ''
    const suffix = typeof (storedLevel as any)?.suffix === 'string' ? (storedLevel as any).suffix : ''
    const separator = typeof (storedLevel as any)?.separator === 'string' ? (storedLevel as any).separator : '.'
    withLevelOne = generateFormatFromLegacy(lv, incParents, prefix, suffix, separator)
  }

  // Derive withoutLevelOne by stripping L1
  const hidden = new Set<HeadingLevel>([1 as HeadingLevel])
  const withoutLevelOne = stripHiddenLevelReferences([...withLevelOne], hidden as any, lv)

  return {
    formatVariants: { withLevelOne, withoutLevelOne },
    includeParents: (storedLevel as any)?.includeParents ?? true,
  }
}

/** Normalize withoutLevelOne: strip L1 and do minimal cleanup via stripHiddenLevelReferences. */
function normalizeWithoutL1Format(level: HeadingLevel, raw: unknown): NumberFormatSegment[] {
  const base = Array.isArray(raw) ? normalizeFormat(raw, level) : generateFormatFromLegacy(level, true, '', '', '.')
  const hidden = new Set<HeadingLevel>([1 as HeadingLevel])
  return stripHiddenLevelReferences([...base], hidden as any, level)
}

/**
 * Validate and normalize a format array.
 * Ensures: current-level reference exists exactly once, no future references,
 * no duplicate references, safe literal values.
 */
function normalizeFormat(raw: unknown, currentLevel: HeadingLevel): NumberFormatSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return generateFormatFromLegacy(currentLevel, true, '', '', '.')
  }
  const cleaned: NumberFormatSegment[] = []
  const seenLevels = new Set<number>()

  for (const seg of raw) {
    if (!seg || typeof seg !== 'object') continue
    if ((seg as any).type === 'literal') {
      const val = typeof (seg as any).value === 'string' ? sanitizeFormatString((seg as any).value) : ''
      cleaned.push({ type: 'literal', value: val })
    } else if ((seg as any).type === 'level-reference') {
      const lv = Number((seg as any).level)
      if (isNaN(lv) || lv < 1 || lv > 6) continue
      if (lv > currentLevel) continue
      if (seenLevels.has(lv)) continue
      seenLevels.add(lv)
      cleaned.push({ type: 'level-reference', level: lv as HeadingLevel })
    }
  }

  if (!seenLevels.has(currentLevel)) {
    cleaned.push({ type: 'level-reference', level: currentLevel })
  }

  return cleaned
}

function sanitizeFormatString(val: string): string {
  return val.replace(/[\x00-\x1f\x7f]/g, '').replace(/[<>]/g, '').replace(/\n/g, '').slice(0, 32)
}

function generateFormatFromLegacy(
  lv: HeadingLevel,
  includeParents: boolean,
  prefix: string,
  suffix: string,
  separator: string,
): NumberFormatSegment[] {
  const fmt: NumberFormatSegment[] = []
  if (prefix) fmt.push({ type: 'literal', value: prefix })

  if (includeParents) {
    for (let i = 1; i <= lv; i++) {
      if (i > 1) fmt.push({ type: 'literal', value: separator })
      fmt.push({ type: 'level-reference', level: i as HeadingLevel })
    }
  } else {
    fmt.push({ type: 'level-reference', level: lv })
  }

  if (suffix) fmt.push({ type: 'literal', value: suffix })
  return fmt
}

function normalizeTokenStyle(raw: unknown): NumberTokenStyle {
  if (typeof raw === 'string' && VALID_TOKEN_STYLES.has(raw)) {
    return raw as NumberTokenStyle
  }
  return 'arabic'
}

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

function migrateLegacyLevels(
  legacyLevels: Record<string, unknown> | null | undefined,
): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = defaultLevelStyle()
  if (!legacyLevels || typeof legacyLevels !== 'object') return levels

  for (const lv of HEADING_LEVELS) {
    const old = (legacyLevels as any)[String(lv)] ?? (legacyLevels as any)[lv]
    if (!old || typeof old !== 'object') continue

    const variants = migrateLevelToVariants(old, lv)

    levels[lv] = {
      enabled: old.enabled === false ? false : true,
      tokenStyle: normalizeTokenStyle(old.numberStyle ?? old.tokenStyle),
      includeParents: variants.includeParents,
      prefix: typeof old.prefix === 'string' ? old.prefix : '',
      suffix: typeof old.suffix === 'string' ? old.suffix : '',
      separator: typeof old.separator === 'string' ? old.separator : '.',
      startAt: validateStartAt((old as any).startAt),
      restartAfterLevel: validateRestartAfterLevel((old as any).restartAfterLevel, lv),
      legalStyle: validateLegalStyle((old as any).legalStyle),
      formatVariants: variants.formatVariants,
    }
  }
  return levels
}

// ── Main migration ──────────────────────────────────

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
    levels = { ...defaultLevelStyle() }
    for (const lv of HEADING_LEVELS) {
      const storedLevel = s.levels[lv]
      if (storedLevel && typeof storedLevel === 'object') {
        const stored = storedLevel as any
        const variants = migrateLevelToVariants(stored, lv)
        levels[lv] = {
          enabled: stored.enabled === false ? false : true,
          tokenStyle: normalizeTokenStyle(stored.tokenStyle),
          includeParents: variants.includeParents,
          prefix: typeof stored.prefix === 'string' ? stored.prefix : '',
          suffix: typeof stored.suffix === 'string' ? stored.suffix : '',
          separator: typeof stored.separator === 'string' ? stored.separator : '.',
          startAt: validateStartAt(stored.startAt),
          restartAfterLevel: validateRestartAfterLevel(stored.restartAfterLevel, lv),
          legalStyle: validateLegalStyle(stored.legalStyle),
          formatVariants: variants.formatVariants,
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
    customDef = { ...defaultLevelStyle() }
    for (const lv of HEADING_LEVELS) {
      const sd = storedCustomDef[String(lv)] ?? storedCustomDef[lv]
      if (sd && typeof sd === 'object') {
        const sdObj = sd as any
        const variants = migrateLevelToVariants(sd, lv)
        customDef[lv] = {
          enabled: typeof sdObj.enabled === 'boolean' ? sdObj.enabled : true,
          tokenStyle: normalizeTokenStyle(sdObj.tokenStyle),
          includeParents: variants.includeParents,
          prefix: typeof sdObj.prefix === 'string' ? sanitizeString(sdObj.prefix) : '',
          suffix: typeof sdObj.suffix === 'string' ? sanitizeString(sdObj.suffix) : '',
          separator: typeof sdObj.separator === 'string' ? sanitizeString(sdObj.separator, '.') : '.',
          startAt: validateStartAt(sdObj.startAt),
          restartAfterLevel: validateRestartAfterLevel(sdObj.restartAfterLevel, lv),
          legalStyle: validateLegalStyle(sdObj.legalStyle),
          formatVariants: variants.formatVariants,
        }
      }
    }
  } else {
    customDef = { ...levels }
  }

  return {
    enabled,
    showLevelOneNumber,
    preset,
    maxDepth,
    levels,
    customDefinition: customDef,
    separator: s.separator ?? '.',
    suffix: s.suffix ?? '',
    showTrailingSeparator: s.showTrailingSeparator ?? false,
  }
}

function sanitizeString(val: string, fallback = ''): string {
  return val
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\n/g, '')
    .slice(0, 16) || fallback
}

export function needsMigration(raw: Partial<HeadingNumberingSettings> | null | undefined): boolean {
  if (!raw) return true
  if (!raw.preset) return true
  if (!raw.levels || Object.keys(raw.levels).length === 0) return true
  return false
}
