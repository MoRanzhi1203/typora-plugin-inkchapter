import type {
  HeadingLevel,
  HeadingLevelDefinition,
  HeadingLevelStyle,
  HeadingNumberingSettings,
  NumberFormatSegment,
} from './heading-types'
import { HEADING_LEVELS, DEFAULT_POSITION } from './heading-types'
import { getPresetLevels, buildCustomDefault } from './presets'

// ── Types ────────────────────────────────────────────────

type RawSettings = Record<string, unknown>

// ── Helpers ──────────────────────────────────────────────

function lit(value: string): NumberFormatSegment {
  return { type: 'literal', value }
}

function ref(level: HeadingLevel): NumberFormatSegment {
  return { type: 'level-reference', level }
}

// ── Legacy conversion ────────────────────────────────────

/**
 * Convert a legacy HeadingLevelStyle to a new HeadingLevelDefinition.
 *
 * Format rules:
 * - includeParents=false → [prefix, current-level-ref, suffix]
 * - includeParents=true  → [level1-ref, separator, level2-ref, separator, ..., current-level-ref],
 *                          prepended with prefix, appended with suffix.
 */
function convertLegacyLevelStyle(
  level: HeadingLevel,
  style: HeadingLevelStyle,
): HeadingLevelDefinition {
  const { tokenStyle, includeParents, prefix, suffix, separator, startAt } = style

  let format: NumberFormatSegment[]

  if (includeParents) {
    const parts: NumberFormatSegment[] = []
    for (let i = 1; i <= level; i++) {
      if (i > 1) {
        parts.push(lit(separator))
      }
      parts.push(ref(i as HeadingLevel))
    }
    if (prefix) {
      parts.unshift(lit(prefix))
    }
    if (suffix) {
      parts.push(lit(suffix))
    }
    format = parts
  } else {
    format = []
    if (prefix) {
      format.push(lit(prefix))
    }
    format.push(ref(level))
    if (suffix) {
      format.push(lit(suffix))
    }
  }

  return {
    enabled: style.enabled,
    numberStyle: tokenStyle,
    format,
    startAt,
    restartAfterLevel: level === 1 ? null : ((level - 1) as HeadingLevel),
    legalStyle: false,
    position: { ...DEFAULT_POSITION },
  }
}

/**
 * Convert raw legacy levels (Record<HeadingLevel, HeadingLevelStyle>) to new definitions,
 * filling any missing levels from the default preset.
 */
function migrateLegacyLevels(
  rawLevels: unknown,
): Record<HeadingLevel, HeadingLevelDefinition> {
  const defaults = buildCustomDefault()
  const levels = {} as Record<HeadingLevel, HeadingLevelDefinition>

  const oldLevels = rawLevels as Record<string, unknown> | null | undefined

  for (const lv of HEADING_LEVELS) {
    const oldStyle = oldLevels?.[String(lv)]
    if (oldStyle && typeof oldStyle === 'object' && oldStyle !== null) {
      const style = oldStyle as unknown as HeadingLevelStyle
      if (
        typeof style.tokenStyle === 'string' &&
        typeof style.startAt === 'number' &&
        typeof style.prefix === 'string' &&
        typeof style.suffix === 'string' &&
        typeof style.separator === 'string'
      ) {
        levels[lv] = convertLegacyLevelStyle(lv, style)
        continue
      }
    }
    // Fallback to default for this level
    levels[lv] = defaults[lv]
  }

  return levels
}

// ── Public API ───────────────────────────────────────────

/**
 * Check whether the raw settings object needs migration.
 *
 * Returns true if:
 * - raw is null/undefined
 * - preset is missing
 * - customDefinition (or its levels) is missing
 * - legacy `levels` property is still present (not yet migrated away)
 */
export function needsMigration(raw: RawSettings | null | undefined): boolean {
  if (!raw) return true
  if (!raw.preset) return true

  const cd = raw.customDefinition as Record<string, unknown> | undefined
  if (!cd || !cd.levels) return true

  // Old `levels` field still hanging around
  if (raw.levels) return true

  return false
}

/**
 * Migrate raw settings (from storage / user config) to a complete,
 * valid HeadingNumberingSettings.
 *
 * Idempotent – calling twice with the same input produces the same
 * (equivalent) output.
 */
export function migrateSettings(raw: RawSettings | null | undefined): HeadingNumberingSettings {
  // ── Default values ──────────────────────────────────
  const enabled = raw ? (raw.enabled !== undefined ? !!raw.enabled : true) : true
  const showLevelOneNumber = raw
    ? (raw.showLevelOneNumber !== undefined ? !!raw.showLevelOneNumber : false)
    : false

  const rawPreset = raw?.preset
  const preset: HeadingNumberingSettings['preset'] =
    typeof rawPreset === 'string' &&
    (rawPreset === 'decimal-hierarchical' ||
      rawPreset === 'chinese-chapter' ||
      rawPreset === 'chinese-outline' ||
      rawPreset === 'roman-hierarchical' ||
      rawPreset === 'custom')
      ? rawPreset
      : 'decimal-hierarchical'

  const rawMaxDepth = raw?.maxDepth
  const maxDepth: HeadingLevel =
    typeof rawMaxDepth === 'number' && rawMaxDepth >= 1 && rawMaxDepth <= 6
      ? (rawMaxDepth as HeadingLevel)
      : 6

  // ── Resolve levels ──────────────────────────────────
  let levels: Record<HeadingLevel, HeadingLevelDefinition>

  if (preset === 'custom') {
    const cd = raw?.customDefinition as Record<string, unknown> | undefined
    if (cd?.levels && typeof cd.levels === 'object' && cd.levels !== null) {
      // Already migrated or manually set – use as-is (validated shallow)
      levels = cd.levels as Record<HeadingLevel, HeadingLevelDefinition>
    } else if (raw?.levels) {
      // Legacy `levels` present – migrate them
      levels = migrateLegacyLevels(raw.levels)
    } else {
      // Nothing available – use defaults
      levels = buildCustomDefault()
    }
  } else {
    // Fixed preset – get from presets
    levels = getPresetLevels(preset)
  }

  return {
    enabled,
    showLevelOneNumber,
    preset,
    maxDepth,
    customDefinition: { levels },
  }
}
