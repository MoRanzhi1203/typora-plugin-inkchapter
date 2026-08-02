/**
 * Format Library Manager — manages user-created custom numbering formats.
 *
 * All functions are pure: they take inputs and return new objects.
 * No mutation of input parameters. No side effects.
 *
 * Deep cloning is done via deepCloneLevelStyle from the scope store,
 * NEVER via JSON.parse/JSON.stringify which loses class identity.
 */

import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingSettings,
  CustomNumberingFormat,
  FormatLibrary,
  FormatBasedOn,
  NumberTokenStyle,
} from './heading-types'

// ── ID generation ───────────────────────────────────────

/** Generate a stable unique ID for a custom format. */
export function generateFormatId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Deep clone levels ───────────────────────────────────

function deepCloneLevels(
  levels: Record<HeadingLevel, HeadingLevelStyle>,
): Record<HeadingLevel, HeadingLevelStyle> {
  const cloned = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lvStr of Object.keys(levels)) {
    const lv = Number(lvStr) as HeadingLevel
    cloned[lv] = deepCloneLevelStyle(levels[lv])
  }
  return cloned
}

function deepCloneLevelStyle(s: HeadingLevelStyle): HeadingLevelStyle {
  return {
    enabled: s.enabled,
    tokenStyle: s.tokenStyle,
    includeParents: s.includeParents,
    prefix: s.prefix,
    suffix: s.suffix,
    separator: s.separator,
    startAt: s.startAt,
    restartAfterLevel: s.restartAfterLevel,
    formatVariants: {
      withLevelOne: s.formatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
      withoutLevelOne: s.formatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
    },
    levelTemplate: { ...s.levelTemplate },
    multilevelFormatVariants: {
      withLevelOne: s.multilevelFormatVariants.withLevelOne.map(seg => ({ ...seg })) as any,
      withoutLevelOne: s.multilevelFormatVariants.withoutLevelOne.map(seg => ({ ...seg })) as any,
    },
    contextualFormatVariants: {
      withLevelOne: s.contextualFormatVariants.withLevelOne.map(seg => ({
        ...seg,
        appearance: seg.type === 'level-reference'
          ? { ...(seg as any).appearance }
          : undefined,
      })) as any,
      withoutLevelOne: s.contextualFormatVariants.withoutLevelOne.map(seg => ({
        ...seg,
        appearance: seg.type === 'level-reference'
          ? { ...(seg as any).appearance }
          : undefined,
      })) as any,
    },
  }
}

// ── Format CRUD ─────────────────────────────────────────

/**
 * Create a new custom format.
 * @param name         Display name (1-30 chars, non-empty, unique).
 * @param description  Description text.
 * @param basedOn      What this format was based on.
 * @param levels       Deep-cloned levels to use as the format's level definitions.
 */
export function createFormat(
  name: string,
  description: string,
  basedOn: FormatBasedOn,
  levels: Record<HeadingLevel, HeadingLevelStyle>,
): CustomNumberingFormat {
  const now = Date.now()
  return {
    id: generateFormatId(),
    name: name.slice(0, 30),
    description: description.slice(0, 200),
    createdAt: now,
    updatedAt: now,
    basedOn,
    settings: {
      levels: deepCloneLevels(levels),
      showLevelOneNumber: false,
      enabled: true,
      maxDepth: 6 as HeadingLevel,
    },
  }
}

/**
 * Copy an existing format under a new name.
 * The copy is fully independent — modifying the copy does not affect the original.
 */
export function copyFormat(
  format: CustomNumberingFormat,
  newName: string,
): CustomNumberingFormat {
  const now = Date.now()
  return {
    id: generateFormatId(),
    name: newName.slice(0, 30),
    description: `${format.description} (副本)`.slice(0, 200),
    createdAt: now,
    updatedAt: now,
    basedOn: { type: 'custom', formatId: format.id },
    settings: {
      levels: deepCloneLevels(format.settings.levels),
      showLevelOneNumber: format.settings.showLevelOneNumber,
      enabled: format.settings.enabled,
      maxDepth: format.settings.maxDepth,
    },
  }
}

/**
 * Rename a format. Returns a new format object with the updated name.
 * ID and all other fields remain unchanged.
 */
export function renameFormat(
  format: CustomNumberingFormat,
  newName: string,
): CustomNumberingFormat {
  return {
    ...format,
    name: newName.slice(0, 30),
    updatedAt: Date.now(),
  }
}

/**
 * Delete a format from the library. Returns the new formats array.
 */
export function deleteFormat(
  library: FormatLibrary,
  formatId: string,
): CustomNumberingFormat[] {
  return library.formats.filter(f => f.id !== formatId)
}

// ── Validation ──────────────────────────────────────────

/**
 * Validate a format name. Returns null if valid, or an error message string if invalid.
 */
export function validateFormatName(
  name: string,
  library: FormatLibrary,
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '格式名称不能为空'
  if (trimmed.length > 30) return '格式名称不能超过30个字符'
  if (library.formats.some(f => f.name === trimmed)) return '格式名称已存在，请使用其他名称'
  return null
}

// ── Preview ─────────────────────────────────────────────

/** Sample token for each token style. */
function getSampleToken(style: NumberTokenStyle): string {
  switch (style) {
    case 'arabic': return '1'
    case 'fullwidth-arabic': return '１'
    case 'chinese': return '一'
    case 'chinese-financial': return '壹'
    case 'roman-upper': return 'I'
    case 'roman-lower': return 'i'
    case 'alpha-upper': return 'A'
    case 'alpha-lower': return 'a'
    case 'upper-greek': return 'Α'
    case 'lower-greek': return 'α'
    case 'heavenly-stems': return '甲'
    case 'earthly-branches': return '子'
    case 'circled': return '①'
    default: return '1'
  }
}

/**
 * Generate preview labels for a format up to maxLevel.
 * Returns an array of strings like ['I', 'I.I', 'I.I.I'] for Roman,
 * or ['第一章', '第一节', '一、'] for Chinese chapter.
 *
 * Uses the contextualFormatVariants from the format's levels to build
 * a realistic preview. Each level shows the full composed label.
 */
export function getFormatPreview(
  format: CustomNumberingFormat,
  maxLevel: HeadingLevel = 6,
): string[] {
  const result: string[] = []
  for (let lv = 1; lv <= maxLevel; lv++) {
    const style = format.settings.levels[lv as HeadingLevel]
    if (!style || !style.enabled) continue
    const variant = style.contextualFormatVariants.withLevelOne
    if (variant && variant.length > 0) {
      const label = variant.map(seg => {
        if (seg.type === 'literal') return seg.value
        return `${(seg as any).appearance?.prefix ?? ''}${getSampleToken((seg as any).appearance?.tokenStyle ?? 'arabic')}${(seg as any).appearance?.suffix ?? ''}`
      }).join('')
      result.push(label)
    } else {
      // Fallback: use level template
      const tpl = style.levelTemplate
      result.push(`${tpl.prefix}${getSampleToken(tpl.tokenStyle)}${tpl.suffix}`)
    }
  }
  return result
}

// ── Migration ───────────────────────────────────────────

/**
 * Migrate the old "custom" preset with customDefinition into a custom format
 * in the format library.
 *
 * Idempotent: if formatLibrary already exists and has formats, does nothing.
 * Only migrates when the version is 0 (uninitialized).
 */
export function migrateOldCustom(
  oldSettings: HeadingNumberingSettings | undefined,
  existingLibrary: FormatLibrary | undefined,
): { library: FormatLibrary; migrated: boolean } {
  // Already migrated?
  if (existingLibrary && existingLibrary.version >= 1) {
    return { library: existingLibrary, migrated: false }
  }

  const library: FormatLibrary = {
    version: 1,
    formats: existingLibrary?.formats ?? [],
  }

  // Only migrate if there's old custom data
  if (
    oldSettings?.preset === 'custom'
    && oldSettings.customDefinition
    && Object.keys(oldSettings.customDefinition).length > 0
  ) {
    // Check idempotency: don't create duplicates if formats already contain migrated data
    const existingNames = new Set(library.formats.map(f => f.name))
    const migratedName = '旧版自定义格式'
    if (!existingNames.has(migratedName)) {
      const now = Date.now()
      const format: CustomNumberingFormat = {
        id: generateFormatId(),
        name: migratedName,
        description: '从旧版自定义设置自动迁移',
        createdAt: now,
        updatedAt: now,
        basedOn: { type: 'blank' },
        settings: {
          levels: deepCloneLevels(oldSettings.customDefinition),
          showLevelOneNumber: oldSettings.showLevelOneNumber ?? false,
          enabled: oldSettings.enabled ?? true,
          maxDepth: oldSettings.maxDepth ?? 6,
        },
      }
      library.formats = [format, ...library.formats]
    }

    return { library, migrated: true }
  }

  return { library, migrated: false }
}

// ── Library helpers ─────────────────────────────────────

/**
 * Get a format by ID from the library. Returns undefined if not found.
 */
export function findFormat(
  library: FormatLibrary,
  formatId: string,
): CustomNumberingFormat | undefined {
  return library.formats.find(f => f.id === formatId)
}

/**
 * Update a format in the library. Returns a new library with the format replaced.
 */
export function updateFormatInLibrary(
  library: FormatLibrary,
  updatedFormat: CustomNumberingFormat,
): FormatLibrary {
  return {
    ...library,
    formats: library.formats.map(f =>
      f.id === updatedFormat.id ? updatedFormat : f,
    ),
  }
}

/**
 * Add a format to the library. Returns a new library.
 */
export function addFormatToLibrary(
  library: FormatLibrary,
  format: CustomNumberingFormat,
): FormatLibrary {
  return {
    ...library,
    formats: [...library.formats, format],
  }
}

/**
 * Get the default empty format library.
 */
export function getDefaultFormatLibrary(): FormatLibrary {
  return { version: 1, formats: [] }
}
