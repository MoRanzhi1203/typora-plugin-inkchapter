import type { HeadingLevel, HeadingLevelStyle, HeadingNumberingPreset, HeadingNumberingSettings, NumberTokenStyle, NumberFormatSegment, HeadingFormatVariants, MultilevelFormatSegment, MultilevelFormatVariants, HeadingLevelNumberTemplate, ContextualFormatSegment, ContextualFormatVariants, LevelReferenceAppearance } from './heading-types'
import { HEADING_LEVELS, createDefaultLevelTemplate, createDefaultReferenceAppearance, generateStableId } from './heading-types'
import { getPresetLevels } from './presets'
import { stripHiddenLevelReferences } from './numbering-engine'
import { stripHiddenMultilevelReferences } from './numbering-engine'
import * as logger from '../core/logger'

const VALID_TOKEN_STYLES: ReadonlySet<string> = new Set([
  'arabic', 'chinese', 'chinese-financial',
  'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower', 'circled',
])

const VALID_PRESETS: ReadonlySet<string> = new Set([
  'decimal-hierarchical', 'chinese-chapter', 'chinese-outline', 'roman-hierarchical', 'custom',
])

const CURRENT_SCHEMA_VERSION = 8

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
      formatVariants: { withLevelOne: [], withoutLevelOne: [] },
      levelTemplate: createDefaultLevelTemplate('arabic'),
      multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
      contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
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

// ── Format migration (v5 → v6) ─────────────────────
// (kept for backward compat; v6→v7 handles the two-layer upgrade)

/** Prefix/suffix extraction context. */
interface PrefixSuffixExtraction {
  prefix: string
  suffix: string
  remainingFormat: NumberFormatSegment[]
  reliable: boolean
}

/**
 * Attempt to extract prefix/suffix literals adjacent to the current level's
 * level-reference segment.
 *
 * Recognizable patterns:
 *   第 + [L1] + 章  → prefix="第", suffix="章"
 *   （ + [L4] + ）   → prefix="（", suffix="）"
 *   [L3] + 、        → prefix="", suffix="、"
 *
 * When extraction is unreliable (complex format, multiple refs between literals),
 * returns reliable=false and empty prefix/suffix.
 */
function extractPrefixSuffixFromFormat(
  format: NumberFormatSegment[],
  currentLevel: HeadingLevel,
): PrefixSuffixExtraction {
  // Find the current level reference
  const refIdx = format.findIndex(s => s.type === 'level-reference' && s.level === currentLevel)
  if (refIdx < 0) {
    return { prefix: '', suffix: '', remainingFormat: [...format], reliable: true }
  }

  let prefix = ''
  let suffix = ''
  const remaining: NumberFormatSegment[] = []

  // Check literal before the level reference (prefix candidate)
  if (refIdx > 0 && format[refIdx - 1].type === 'literal') {
    const candidate = (format[refIdx - 1] as { type: 'literal'; value: string }).value
    // Only extract if it's a non-separator text (separators stay in composition)
    if (isPrefixSuffixCharacter(candidate)) {
      prefix = candidate
      // Don't add this literal to remaining
    } else {
      remaining.push(format[refIdx - 1])
    }
  } else if (refIdx > 0) {
    remaining.push(format[refIdx - 1])
  }

  // Check literal after the level reference (suffix candidate)
  if (refIdx + 1 < format.length && format[refIdx + 1].type === 'literal') {
    const candidate = (format[refIdx + 1] as { type: 'literal'; value: string }).value
    if (isPrefixSuffixCharacter(candidate)) {
      suffix = candidate
    } else {
      // Will be added with remaining after
    }
  }

  // Build remaining: add all segments except extracted ones
  for (let i = 0; i < format.length; i++) {
    if (i === refIdx - 1 && prefix) continue // skip extracted prefix
    if (i === refIdx + 1 && suffix) continue // skip extracted suffix
    if (i === refIdx) {
      // Replace level-reference with level-template-reference in multilevel later
      remaining.push(format[i])
    } else if (i !== refIdx - 1 || !prefix) {
      // Add non-prefix-suffix parts
      if (i !== refIdx - 1 && i !== refIdx + 1) {
        remaining.push(format[i])
      } else if (i === refIdx + 1 && !suffix) {
        remaining.push(format[i])
      }
    }
  }

  return { prefix, suffix, remainingFormat: remaining, reliable: true }
}

/** Check if a string is a prefix/suffix character (non-separator punctuation/Chinese). */
function isPrefixSuffixCharacter(s: string): boolean {
  if (!s || s.length === 0) return false
  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  // Separator-only strings stay in composition
  if ([...s].every(c => SEP.has(c) || c === ' ')) return false
  return true
}

/**
 * Convert old NumberFormatSegment[] to new MultilevelFormatSegment[].
 * - Old level-reference → new level-template-reference
 * - Literals pass through
 * - References already extracted prefix/suffix are NOT duplicated
 */
function convertFormatToMultilevelV7(
  oldFormat: NumberFormatSegment[],
  currentLevel: HeadingLevel,
  extractedPrefix: string,
  extractedSuffix: string,
): MultilevelFormatSegment[] {
  const result: MultilevelFormatSegment[] = []
  const seenLevels = new Set<number>()

  for (const seg of oldFormat) {
    if (seg.type === 'literal') {
      // Don't include literals that were extracted as prefix/suffix of the current level ref
      result.push({ type: 'literal', value: sanitizeFormatStringLit(seg.value) })
    } else {
      // level-reference → level-template-reference
      const refLv = seg.level as HeadingLevel
      if (refLv < 1 || refLv > 6) continue
      if (refLv > currentLevel) continue
      if (seenLevels.has(refLv)) continue
      seenLevels.add(refLv)
      result.push({ type: 'level-template-reference', level: refLv })
    }
  }

  // Ensure current level template reference exists
  if (!result.some(s => s.type === 'level-template-reference' && s.level === currentLevel)) {
    result.push({ type: 'level-template-reference', level: currentLevel })
  }

  return result
}

/**
 * Migrate a single level's format variants from v6 to v7.
 * Extracts prefix/suffix from the old format into the level template,
 * and converts the composition to use level-template-reference.
 */
function migrateLevelToV7(
  oldLevel: any,
  lv: HeadingLevel,
): {
  levelTemplate: HeadingLevelNumberTemplate
  multilevelFormatVariants: MultilevelFormatVariants
  formatVariants: HeadingFormatVariants  // kept for backward compat
} {
  const tokenStyle = normalizeTokenStyle(oldLevel?.tokenStyle ?? oldLevel?.numberStyle)

  // Check if already has multilevelFormatVariants (v7+)
  if (oldLevel?.multilevelFormatVariants?.withLevelOne || oldLevel?.multilevelFormatVariants?.withoutLevelOne) {
    return {
      levelTemplate: oldLevel?.levelTemplate ?? { tokenStyle, prefix: oldLevel?.prefix ?? '', suffix: oldLevel?.suffix ?? '' },
      multilevelFormatVariants: {
        withLevelOne: normalizeMultilevelFormat(oldLevel.multilevelFormatVariants.withLevelOne, lv),
        withoutLevelOne: normalizeMultilevelFormat(oldLevel.multilevelFormatVariants.withoutLevelOne, lv),
      },
      formatVariants: oldLevel?.formatVariants ?? { withLevelOne: [], withoutLevelOne: [] },
    }
  }

  // ── Migration from v6 formatVariants ─────────────
  const oldVariants = oldLevel?.formatVariants
  let withL1Old: NumberFormatSegment[] = []
  let withoutL1Old: NumberFormatSegment[] = []

  if (oldVariants?.withLevelOne && Array.isArray(oldVariants.withLevelOne) && oldVariants.withLevelOne.length > 0) {
    withL1Old = normalizeFormat(oldVariants.withLevelOne, lv)
  } else if (Array.isArray(oldLevel?.format) && oldLevel.format.length > 0) {
    withL1Old = normalizeFormat(oldLevel.format, lv)
  } else {
    // Generate from legacy fields
    const incParents = oldLevel?.includeParents ?? true
    const prefix = typeof oldLevel?.prefix === 'string' ? oldLevel.prefix : ''
    const suffix = typeof oldLevel?.suffix === 'string' ? oldLevel.suffix : ''
    const separator = typeof oldLevel?.separator === 'string' ? oldLevel.separator : '.'
    withL1Old = generateFormatFromLegacy(lv, incParents, prefix, suffix, separator)
  }

  if (oldVariants?.withoutLevelOne && Array.isArray(oldVariants.withoutLevelOne) && oldVariants.withoutLevelOne.length > 0) {
    withoutL1Old = normalizeWithoutL1Format(lv, oldVariants.withoutLevelOne)
  } else {
    const hidden = new Set<HeadingLevel>([1 as HeadingLevel])
    withoutL1Old = stripHiddenLevelReferences([...withL1Old], hidden as any, lv)
  }

  // Extract prefix/suffix from withLevelOne format
  const extraction = extractPrefixSuffixFromFormat(withL1Old, lv)

  // Determine tokenStyle: use stored or infer from extraction remaining
  let finalTokenStyle = tokenStyle
  // Keep tokenStyle from old level style

  const levelTemplate: HeadingLevelNumberTemplate = {
    tokenStyle: finalTokenStyle,
    prefix: sanitizeFormatStringLit(extraction.prefix),
    suffix: sanitizeFormatStringLit(extraction.suffix),
  }

  // Convert formats to multilevel segments
  const withL1Multilevel = convertFormatToMultilevelV7(withL1Old, lv, extraction.prefix, extraction.suffix)
  const withoutL1Multilevel = convertFormatToMultilevelV7(withoutL1Old, lv, '', '')

  // Ensure withoutLevelOne doesn't contain H1
  const cleanedWithout = stripHiddenMultilevelReferences(withoutL1Multilevel, new Set([1 as HeadingLevel]), lv)

  return {
    levelTemplate,
    multilevelFormatVariants: {
      withLevelOne: withL1Multilevel,
      withoutLevelOne: cleanedWithout,
    },
    formatVariants: {
      withLevelOne: withL1Old,
      withoutLevelOne: withoutL1Old,
    },
  }
}

/**
 * Convert old MultilevelFormatSegment[] to new ContextualFormatSegment[].
 * Pulls the referenced level's template to create per-segment appearance.
 * This makes each reference independent.
 */
function convertMultilevelToContextual(
  multilevel: MultilevelFormatSegment[],
  levelTemplates: Record<HeadingLevel, HeadingLevelNumberTemplate>,
): ContextualFormatSegment[] {
  const result: ContextualFormatSegment[] = []
  for (const seg of multilevel) {
    if (seg.type === 'literal') {
      result.push({ id: generateStableId(), type: 'literal', value: seg.value })
    } else {
      const tpl = levelTemplates[seg.level] ?? { tokenStyle: 'arabic' as NumberTokenStyle, prefix: '', suffix: '' }
      result.push({
        id: generateStableId(),
        type: 'level-reference',
        level: seg.level,
        appearance: {
          tokenStyle: tpl.tokenStyle,
          prefix: tpl.prefix ?? '',
          suffix: tpl.suffix ?? '',
        },
      })
    }
  }
  return result
}

/**
 * Migrate multilevel format variants to contextual format variants (v7 → v8).
 * Copies each level-template-reference's appearance from the level template,
 * making references independent.
 */
function migrateMultilevelToContextual(
  multilevelVariants: MultilevelFormatVariants | undefined,
  levelTemplates: Record<HeadingLevel, HeadingLevelNumberTemplate>,
): ContextualFormatVariants {
  const withL1 = multilevelVariants?.withLevelOne ?? []
  const withoutL1 = multilevelVariants?.withoutLevelOne ?? []
  return {
    withLevelOne: convertMultilevelToContextual(withL1, levelTemplates),
    withoutLevelOne: convertMultilevelToContextual(withoutL1, levelTemplates),
  }
}

function normalizeMultilevelFormat(raw: unknown, currentLevel: HeadingLevel): MultilevelFormatSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ type: 'level-template-reference', level: currentLevel }]
  }
  const cleaned: MultilevelFormatSegment[] = []
  const seenLevels = new Set<number>()

  for (const seg of raw) {
    if (!seg || typeof seg !== 'object') continue
    if ((seg as any).type === 'literal') {
      const val = typeof (seg as any).value === 'string' ? sanitizeFormatStringLit((seg as any).value) : ''
      cleaned.push({ type: 'literal', value: val })
    } else if ((seg as any).type === 'level-template-reference') {
      const lv = Number((seg as any).level)
      if (isNaN(lv) || lv < 1 || lv > 6) continue
      if (lv > currentLevel) continue
      if (seenLevels.has(lv)) continue
      seenLevels.add(lv)
      cleaned.push({ type: 'level-template-reference', level: lv as HeadingLevel })
    }
  }

  if (!seenLevels.has(currentLevel)) {
    cleaned.push({ type: 'level-template-reference', level: currentLevel })
  }

  return cleaned
}

function sanitizeFormatStringLit(val: string): string {
  return val.replace(/[\x00-\x1f\x7f]/g, '').replace(/[<>]/g, '').replace(/\n/g, '').slice(0, 32)
}

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
  levelTemplates: Record<HeadingLevel, HeadingLevelNumberTemplate>,
): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = defaultLevelStyle()
  if (!legacyLevels || typeof legacyLevels !== 'object') return levels

  for (const lv of HEADING_LEVELS) {
    const old = (legacyLevels as any)[String(lv)] ?? (legacyLevels as any)[lv]
    if (!old || typeof old !== 'object') continue

    const variants = migrateLevelToVariants(old, lv)
    const v7 = migrateLevelToV7(old, lv)

    levels[lv] = {
      enabled: old.enabled === false ? false : true,
      tokenStyle: normalizeTokenStyle(old.numberStyle ?? old.tokenStyle),
      includeParents: variants.includeParents,
      prefix: typeof old.prefix === 'string' ? old.prefix : '',
      suffix: typeof old.suffix === 'string' ? old.suffix : '',
      separator: typeof old.separator === 'string' ? old.separator : '.',
      startAt: validateStartAt((old as any).startAt),
      restartAfterLevel: validateRestartAfterLevel((old as any).restartAfterLevel, lv),
      formatVariants: variants.formatVariants,
      levelTemplate: v7.levelTemplate,
      multilevelFormatVariants: v7.multilevelFormatVariants,
      contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    }
  }

  // Second pass: build contextual format from multilevel format
  const templates: Record<HeadingLevel, HeadingLevelNumberTemplate> = {} as any
  for (const lv of HEADING_LEVELS) {
    templates[lv] = levels[lv].levelTemplate
  }
  for (const lv of HEADING_LEVELS) {
    levels[lv].contextualFormatVariants = migrateMultilevelToContextual(
      levels[lv].multilevelFormatVariants,
      templates,
    )
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
    s.levels = migrateLegacyLevels(legacyCustomDef.levels, {} as any)
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
        const v7 = migrateLevelToV7(stored, lv)
        levels[lv] = {
          enabled: stored.enabled === false ? false : true,
          tokenStyle: normalizeTokenStyle(stored.tokenStyle),
          includeParents: variants.includeParents,
          prefix: typeof stored.prefix === 'string' ? stored.prefix : '',
          suffix: typeof stored.suffix === 'string' ? stored.suffix : '',
          separator: typeof stored.separator === 'string' ? stored.separator : '.',
          startAt: validateStartAt(stored.startAt),
          restartAfterLevel: validateRestartAfterLevel(stored.restartAfterLevel, lv),
          formatVariants: variants.formatVariants,
          levelTemplate: v7.levelTemplate,
          multilevelFormatVariants: v7.multilevelFormatVariants,
          contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
        }
      }
    }
    // Build contextual from multilevel ONLY if not already populated
    const templates: Record<HeadingLevel, HeadingLevelNumberTemplate> = {} as any
    for (const lv of HEADING_LEVELS) {
      templates[lv] = levels[lv].levelTemplate
    }
    for (const lv of HEADING_LEVELS) {
      const stored = s.levels?.[lv]
      const existingContextual = (stored as any)?.contextualFormatVariants
      if (existingContextual && (existingContextual.withLevelOne?.length > 0 || existingContextual.withoutLevelOne?.length > 0)) {
        // Preserve existing contextual format; only migrate as deep copy
        levels[lv].contextualFormatVariants = {
          withLevelOne: (existingContextual.withLevelOne || []).map((seg: any) => ({ ...seg })),
          withoutLevelOne: (existingContextual.withoutLevelOne || []).map((seg: any) => ({ ...seg })),
        }
      } else {
        // First migration: generate from multilevel
        levels[lv].contextualFormatVariants = migrateMultilevelToContextual(
          levels[lv].multilevelFormatVariants,
          templates,
        )
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
        const v7 = migrateLevelToV7(sd, lv)
        customDef[lv] = {
          enabled: typeof sdObj.enabled === 'boolean' ? sdObj.enabled : true,
          tokenStyle: normalizeTokenStyle(sdObj.tokenStyle),
          includeParents: variants.includeParents,
          prefix: typeof sdObj.prefix === 'string' ? sanitizeString(sdObj.prefix) : '',
          suffix: typeof sdObj.suffix === 'string' ? sanitizeString(sdObj.suffix) : '',
          separator: typeof sdObj.separator === 'string' ? sanitizeString(sdObj.separator, '.') : '.',
          startAt: validateStartAt(sdObj.startAt),
          restartAfterLevel: validateRestartAfterLevel(sdObj.restartAfterLevel, lv),
          formatVariants: variants.formatVariants,
          levelTemplate: v7.levelTemplate,
          multilevelFormatVariants: v7.multilevelFormatVariants,
          contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
        }
      }
    }
    // Build contextual from multilevel
    const templates2: Record<HeadingLevel, HeadingLevelNumberTemplate> = {} as any
    for (const lv of HEADING_LEVELS) {
      templates2[lv] = customDef[lv].levelTemplate
    }
    for (const lv of HEADING_LEVELS) {
      customDef[lv].contextualFormatVariants = migrateMultilevelToContextual(
        customDef[lv].multilevelFormatVariants,
        templates2,
      )
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
