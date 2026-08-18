/**
 * Object Numbering V2 settings schema + idempotent migration.
 *
 * Migrates legacy `{ enabled, position, prefix, numbering: 'continuous' }`
 * per-type caption settings into the V2 `ObjectNumberingConfig` shape without
 * losing any user value. Formula is added with `enabled=false` /
 * `formulaMode='typora-native'` so upgrading never produces a second formula
 * number next to Typora's native one.
 */

import {
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  scopeFromNumberingMode,
  type ObjectNumberingType,
  type ObjectNumberingConfig,
  type NumberingMode,
  type NumberStyle,
  type ObjectPosition,
  type ObjectNumberingScope,
  type ObjectNumberingPreset,
} from './object-numbering-engine'
import {
  isValidObjectNumberingPreset,
  resolvePresetConfig,
  OBJECT_NUMBERING_PRESETS,
} from './object-numbering-presets'

export interface ObjectNumberingSettings {
  schemaVersion: number
  types: Record<ObjectNumberingType, ObjectNumberingConfig>
}

export const OBJECT_NUMBERING_SCHEMA_VERSION = 2

export function defaultObjectNumberingSettings(): ObjectNumberingSettings {
  return {
    schemaVersion: OBJECT_NUMBERING_SCHEMA_VERSION,
    types: {
      table: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table },
      figure: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.figure },
      code: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.code },
      formula: { ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula },
    },
  }
}

type LegacyNumbering = string | NumberingMode | undefined

function asNumberingMode(value: LegacyNumbering): NumberingMode {
  if (value === 'reset-h1' || value === 'reset-h2' || value === 'reset-h3' || value === 'chapter-linked' || value === 'custom') {
    return value
  }
  return 'continuous'
}

function asNumberStyle(value: unknown): NumberStyle {
  const styles: NumberStyle[] = ['arabic', 'arabic-padded', 'chinese', 'chinese-financial', 'roman-lower', 'roman-upper', 'alpha-lower', 'alpha-upper']
  return (styles as string[]).includes(value as string) ? (value as NumberStyle) : 'arabic'
}

function asPosition(value: unknown, fallback: ObjectPosition): ObjectPosition {
  return value === 'above' || value === 'below' || value === 'left' || value === 'right' ? value : fallback
}

/** Formula parens are the formatter's concern; strip one outer pair for preset matching. */
function stripFormulaParens(template: string): string {
  const s = template.trim()
  if (s.startsWith('(') && s.endsWith(')')) return s.slice(1, -1)
  return template
}

/** Migrate a single (possibly legacy/partial) type config into V2 shape. */
export function migrateObjectNumberingConfig(
  type: ObjectNumberingType,
  raw: unknown,
): ObjectNumberingConfig {
  const base = DEFAULT_OBJECT_NUMBERING_CONFIG[type]
  const r = (raw ?? {}) as Record<string, unknown>
  const prefix = typeof r.prefix === 'string' ? r.prefix : base.prefix
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : base.enabled
  const numberingMode = asNumberingMode((r.numberingMode ?? r.numbering) as LegacyNumbering)
  const numberStyle = asNumberStyle(r.numberStyle)
  const startAt = typeof r.startAt === 'number' && Number.isFinite(r.startAt) && r.startAt >= 0 ? Math.floor(r.startAt) : base.startAt
  const minDigits = typeof r.minDigits === 'number' ? Math.min(6, Math.max(1, Math.floor(r.minDigits))) : base.minDigits
  const rawTemplate = typeof r.template === 'string' && r.template.trim() !== '' ? r.template : base.template
  const matchTemplate = type === 'formula' ? stripFormulaParens(rawTemplate) : rawTemplate
  const resetHeadingLevel = r.resetHeadingLevel === 1 || r.resetHeadingLevel === 2 || r.resetHeadingLevel === 3 ? (r.resetHeadingLevel as 1 | 2 | 3) : base.resetHeadingLevel
  const customExpression = typeof r.customExpression === 'string' ? r.customExpression : base.customExpression
  const formulaMode = r.formulaMode === 'inkchapter' ? 'inkchapter' : (r.formulaMode === 'typora-native' ? 'typora-native' : base.formulaMode)
  const scope: ObjectNumberingScope | undefined =
    r.scope === 'document' || r.scope === 'chapter' || r.scope === 'section' || r.scope === 'subsection'
      ? (r.scope as ObjectNumberingScope)
      : undefined
  // Legacy configs saved `numberingMode` (not `scope`); derive scope for preset matching.
  const matchScope: ObjectNumberingScope = scope ?? scopeFromNumberingMode(numberingMode)

  // ── v2 preset resolution: preset ID is authority; scope+format derive from it. ──
  const resolved = resolvePresetConfig({ preset: r.preset, scope: matchScope, format: matchTemplate })
  const preset: ObjectNumberingPreset | undefined = resolved.preset ?? undefined
  const effectiveScope = resolved.decision === 'LEGACY_CUSTOM' ? scope : resolved.scope
  const effectiveTemplate = resolved.decision === 'LEGACY_CUSTOM' ? rawTemplate : resolved.format
  const legacyCustomFormat = resolved.decision === 'LEGACY_CUSTOM' ? true : undefined
  console.info(
    `[InkChapter Numbering] OBJECT-NUMBERING-PRESET-MIGRATION type=${type} ` +
    `oldScope=${scope ?? 'none'} oldFormat=${JSON.stringify(rawTemplate)} ` +
    `resolvedPreset=${preset ?? 'none'} decision=${resolved.decision}`,
  )

  return {
    enabled,
    prefix,
    position: asPosition(r.position, base.position),
    numberingMode,
    numberStyle,
    startAt,
    minDigits,
    template: effectiveTemplate,
    ...(effectiveScope ? { scope: effectiveScope } : {}),
    ...(preset ? { preset } : {}),
    ...(legacyCustomFormat ? { legacyCustomFormat } : {}),
    resetHeadingLevel,
    customExpression,
    ...(type === 'formula' ? { formulaMode } : {}),
  }
}

/** Migrate a whole settings object into V2 shape (idempotent). */
export function migrateObjectNumberingSettings(raw: unknown): ObjectNumberingSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const rawTypes = (r.types ?? {}) as Record<string, unknown>
  return {
    schemaVersion: OBJECT_NUMBERING_SCHEMA_VERSION,
    types: {
      table: migrateObjectNumberingConfig('table', rawTypes.table),
      figure: migrateObjectNumberingConfig('figure', rawTypes.figure),
      code: migrateObjectNumberingConfig('code', rawTypes.code),
      formula: migrateObjectNumberingConfig('formula', rawTypes.formula),
    },
  }
}
