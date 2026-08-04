/**
 * Format Library Manager — manages user-created custom numbering formats
 * and built-in preset visibility preferences.
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
  FormatLibraryPreferences,
  FormatBasedOn,
  NumberTokenStyle,
  BuiltInPresetId,
  NumberingFormatSource,
} from './heading-types'
import { BUILT_IN_PRESET_IDS } from './heading-types'

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
    version: 0,
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
    version: 0,
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
    version: format.version,
  }
}

/**
 * Delete a format from the library. Returns the new formats array.
 * Also removes the ID from customFormatOrder.
 */
export function deleteFormat(
  library: FormatLibrary,
  formatId: string,
): FormatLibrary {
  const newFormats = library.formats.filter(f => f.id !== formatId)
  const newOrder = library.preferences.customFormatOrder.filter(id => id !== formatId)
  return {
    ...library,
    formats: newFormats,
    preferences: {
      ...library.preferences,
      customFormatOrder: newOrder,
    },
  }
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
 * Generate preview labels for a format.
 *
 * @param format             The format to preview.
 * @param maxLevel           Number of preview lines to generate (default 6).
 * @param showLevelOneNumber Whether H1 numbering is active; determines
 *                           which contextual variant to read and which
 *                           physical levels to map.
 *
 * When showLevelOneNumber is true:
 *   maxLevel=3 → physical H1, H2, H3 using withLevelOne variant.
 *
 * When showLevelOneNumber is false:
 *   maxLevel=3 → physical H2, H3, H4 using withoutLevelOne variant.
 *
 * Returns an array of strings like ['I', 'I.I', 'I.I.I'] for Roman,
 * or ['第一章', '第一节', '一、'] for Chinese chapter.
 */
export function getFormatPreview(
  format: CustomNumberingFormat,
  maxLevel: HeadingLevel = 6,
  showLevelOneNumber: boolean = true,
): string[] {
  const result: string[] = []
  const startPhysicalLevel: number = showLevelOneNumber ? 1 : 2
  const endPhysicalLevel: number = startPhysicalLevel + maxLevel - 1
  const variantKey = showLevelOneNumber ? 'withLevelOne' : 'withoutLevelOne'

  for (let lv = startPhysicalLevel; lv <= endPhysicalLevel; lv++) {
    const style = format.settings.levels[lv as HeadingLevel]
    if (!style || !style.enabled) continue
    const variant = style.contextualFormatVariants[variantKey]
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

  const library: FormatLibrary = existingLibrary
    ? { ...existingLibrary, preferences: migratePreferences(existingLibrary.preferences) }
    : getDefaultFormatLibrary()

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
        version: 0,
        basedOn: { type: 'blank' },
        settings: {
          levels: deepCloneLevels(oldSettings.customDefinition),
          showLevelOneNumber: oldSettings.showLevelOneNumber ?? false,
          enabled: oldSettings.enabled ?? true,
          maxDepth: oldSettings.maxDepth ?? 6,
        },
      }
      library.formats = [format, ...library.formats]
      library.preferences.customFormatOrder = [format.id, ...library.preferences.customFormatOrder]
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
      f.id === updatedFormat.id
        ? { ...updatedFormat, version: (f.version ?? 0) + 1, updatedAt: Date.now() }
        : f,
    ),
  }
}

/**
 * Add a format to the library. Returns a new library.
 * Also adds the new ID to customFormatOrder.
 */
export function addFormatToLibrary(
  library: FormatLibrary,
  format: CustomNumberingFormat,
): FormatLibrary {
  return {
    ...library,
    formats: [...library.formats, format],
    preferences: {
      ...library.preferences,
      customFormatOrder: [...library.preferences.customFormatOrder, format.id],
    },
  }
}

/**
 * Get the default empty format library.
 */
export function getDefaultFormatLibrary(): FormatLibrary {
  return {
    version: 1,
    formats: [],
    preferences: getDefaultPreferences(),
  }
}

// ── Preferences ─────────────────────────────────────────

/** Get default preferences (nothing hidden, empty order). */
export function getDefaultPreferences(): FormatLibraryPreferences {
  return {
    hiddenBuiltInPresetIds: [],
    customFormatOrder: [],
  }
}

/**
 * Ensure preferences exist on an existing library (for migration).
 * Returns preferences as-is if valid, or creates defaults.
 * Idempotent — never creates duplicate entries.
 */
function migratePreferences(
  prefs: FormatLibraryPreferences | undefined,
): FormatLibraryPreferences {
  if (!prefs) return getDefaultPreferences()
  return {
    hiddenBuiltInPresetIds: filterValidPresetIds(prefs.hiddenBuiltInPresetIds ?? []),
    customFormatOrder: prefs.customFormatOrder ?? [],
  }
}

/** Filter out invalid preset IDs, deduplicate. */
function filterValidPresetIds(ids: string[]): BuiltInPresetId[] {
  const validSet = new Set<string>(BUILT_IN_PRESET_IDS)
  const seen = new Set<string>()
  return ids.filter(id => {
    if (!validSet.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }) as BuiltInPresetId[]
}

// ── Built-in preset visibility ──────────────────────────

/**
 * Hide a built-in preset. The preset definition is retained; only the UI hides it.
 * If already hidden, does nothing.
 */
export function hideBuiltInPreset(
  library: FormatLibrary,
  presetId: BuiltInPresetId,
): FormatLibrary {
  const hidden = library.preferences.hiddenBuiltInPresetIds
  if (hidden.includes(presetId)) return library
  return {
    ...library,
    preferences: {
      ...library.preferences,
      hiddenBuiltInPresetIds: [...hidden, presetId],
    },
  }
}

/**
 * Restore a hidden built-in preset so it appears in the UI again.
 */
export function showBuiltInPreset(
  library: FormatLibrary,
  presetId: BuiltInPresetId,
): FormatLibrary {
  return {
    ...library,
    preferences: {
      ...library.preferences,
      hiddenBuiltInPresetIds: library.preferences.hiddenBuiltInPresetIds.filter(id => id !== presetId),
    },
  }
}

/** Check whether a built-in preset is hidden. */
export function isBuiltInPresetHidden(
  library: FormatLibrary,
  presetId: BuiltInPresetId,
): boolean {
  return library.preferences.hiddenBuiltInPresetIds.includes(presetId)
}

/** Get the list of visible built-in preset IDs. */
export function getVisibleBuiltInPresets(library: FormatLibrary): BuiltInPresetId[] {
  const hidden = new Set(library.preferences.hiddenBuiltInPresetIds)
  return BUILT_IN_PRESET_IDS.filter(id => !hidden.has(id))
}

// ── Restore built-in presets ────────────────────────────

/**
 * Restore all built-in presets to visible state.
 * Does NOT modify custom formats, document settings, or global defaults.
 * Returns the updated library.
 */
export function restoreBuiltInPresets(library: FormatLibrary): FormatLibrary {
  return {
    ...library,
    preferences: {
      ...library.preferences,
      hiddenBuiltInPresetIds: [],
    },
  }
}

/**
 * Check if all built-in presets are already visible.
 */
export function areAllBuiltInPresetsVisible(library: FormatLibrary): boolean {
  return library.preferences.hiddenBuiltInPresetIds.length === 0
}

// ── Reset entire format library ─────────────────────────

/**
 * Reset the entire format library to factory state.
 * Deletes ALL user formats, clears hidden state, clears customFormatOrder.
 * Only built-in presets remain (all visible).
 * Returns the new library.
 */
export function resetFormatLibrary(): FormatLibrary {
  return getDefaultFormatLibrary()
}

// ── Custom format ordering ──────────────────────────────

/**
 * Get user formats in their persisted order. Any format not yet in the order
 * is appended at the end (e.g., from migration or older versions).
 */
export function getOrderedCustomFormats(library: FormatLibrary): CustomNumberingFormat[] {
  const orderMap = new Map<string, number>()
  library.preferences.customFormatOrder.forEach((id, idx) => {
    orderMap.set(id, idx)
  })

  const ordered = [...library.formats]
  ordered.sort((a, b) => {
    const aIdx = orderMap.get(a.id)
    const bIdx = orderMap.get(b.id)
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx
    if (aIdx !== undefined) return -1
    if (bIdx !== undefined) return 1
    return a.createdAt - b.createdAt
  })
  return ordered
}

/**
 * Update the custom format order (e.g., after drag-and-drop reordering).
 */
export function setCustomFormatOrder(
  library: FormatLibrary,
  order: string[],
): FormatLibrary {
  return {
    ...library,
    preferences: {
      ...library.preferences,
      customFormatOrder: [...order],
    },
  }
}

// ── Migration of old library structure ──────────────────

/**
 * Migrate an existing FormatLibrary that may lack preferences.
 * Idempotent: if preferences already exist, returns as-is.
 */
export function migrateFormatLibrary(library: FormatLibrary): FormatLibrary {
  let result = library

  // Migration 1: add preferences if missing
  if (!library.preferences || library.preferences.hiddenBuiltInPresetIds === undefined
    || library.preferences.customFormatOrder === undefined) {
    result = {
      ...result,
      preferences: {
        hiddenBuiltInPresetIds: library.preferences?.hiddenBuiltInPresetIds
          ? filterValidPresetIds(library.preferences.hiddenBuiltInPresetIds) : [],
        customFormatOrder: library.preferences?.customFormatOrder ?? library.formats.map(f => f.id),
      },
    }
  } else {
    // Already migrated — only sanitize hidden IDs
    result = {
      ...result,
      preferences: {
        hiddenBuiltInPresetIds: filterValidPresetIds(result.preferences.hiddenBuiltInPresetIds),
        customFormatOrder: result.preferences.customFormatOrder,
      },
    }
  }

  // Migration 2: ensure every format has a version (idempotent, never modifies existing versions)
  if (result.version < 2) {
    result = {
      ...result,
      version: 2,
      formats: result.formats.map(f => ({
        ...f,
        version: (f.version != null) ? f.version : 1,
      })),
    }
  }

  return result
}

// ── Applied format state computation ─────────────────

/**
 * Compute the applied format info for the current document scope.
 * Returns the format source and format ID from the document override or global default.
 */
export interface AppliedFormatInfo {
  source: NumberingFormatSource | null
  formatId: string | null
  /** Whether it inherits from global (no document override). */
  inheritsGlobal: boolean
}

/**
 * Check if an applied format (custom) has a template update available.
 * Uses version comparison: appliedVersion < format.version means there's an update.
 */
export function hasFormatUpdate(
  library: FormatLibrary,
  formatId: string,
  appliedVersion?: number,
): boolean {
  const format = library.formats.find(f => f.id === formatId)
  if (!format) return false
  return (appliedVersion ?? 0) < (format.version ?? 0)
}

/**
 * Get the format version for a custom format ID.
 */
export function getFormatVersion(
  library: FormatLibrary,
  formatId: string,
): number | undefined {
  return library.formats.find(f => f.id === formatId)?.version
}
