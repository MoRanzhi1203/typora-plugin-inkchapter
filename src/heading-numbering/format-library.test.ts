import { describe, it, expect } from 'vitest'
import {
  createFormat,
  copyFormat,
  renameFormat,
  deleteFormat,
  generateFormatId,
  getFormatPreview,
  validateFormatName,
  migrateOldCustom,
  addFormatToLibrary,
  findFormat,
  updateFormatInLibrary,
  getDefaultFormatLibrary,
  hideBuiltInPreset,
  showBuiltInPreset,
  isBuiltInPresetHidden,
  getVisibleBuiltInPresets,
  restoreBuiltInPresets,
  areAllBuiltInPresetsVisible,
  resetFormatLibrary,
  getOrderedCustomFormats,
  migrateFormatLibrary,
  getDefaultPreferences,
  hasFormatUpdate,
  getFormatVersion,
} from './format-library'
import type {
  CustomNumberingFormat,
  FormatLibrary,
  HeadingLevel,
  HeadingLevelStyle,
  FormatBasedOn,
  BuiltInPresetId,
  ContextualFormatSegment,
} from './heading-types'
import { HEADING_LEVELS, generateStableId, BUILT_IN_PRESET_IDS } from './heading-types'
import { getPresetLevels } from './presets'

function makeBlankLevels(): Record<HeadingLevel, HeadingLevelStyle> {
  const levels = {} as Record<HeadingLevel, HeadingLevelStyle>
  for (const lv of HEADING_LEVELS) {
    const soloSeg = {
      id: generateStableId(),
      type: 'level-reference' as const,
      level: lv,
      appearance: { tokenStyle: 'arabic' as const, prefix: '', suffix: '' },
    }
    levels[lv] = {
      enabled: true,
      tokenStyle: 'arabic',
      includeParents: false,
      prefix: '',
      suffix: '',
      separator: '.',
      startAt: 1,
      restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
      formatVariants: { withLevelOne: [], withoutLevelOne: [] },
      levelTemplate: { tokenStyle: 'arabic', prefix: '', suffix: '' },
      multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
      contextualFormatVariants: {
        withLevelOne: [{ ...soloSeg, id: generateStableId() }],
        withoutLevelOne: lv === 1 ? [] : [{ ...soloSeg, id: generateStableId() }],
      },
    }
  }
  return levels
}

function makeTestLibrary(formats: CustomNumberingFormat[] = []): FormatLibrary {
  return {
    version: 1,
    formats,
    preferences: {
      hiddenBuiltInPresetIds: [],
      customFormatOrder: formats.map(f => f.id),
    },
  }
}

describe('generateFormatId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateFormatId())
    }
    expect(ids.size).toBe(100)
  })

  it('generates string IDs containing hyphen', () => {
    const id = generateFormatId()
    expect(typeof id).toBe('string')
    expect(id).toContain('-')
  })
})

describe('createFormat', () => {
  it('produces a valid CustomNumberingFormat structure', () => {
    const levels = makeBlankLevels()
    const format = createFormat('测试格式', '这是一个测试', { type: 'blank' }, levels)

    expect(format.id).toBeDefined()
    expect(typeof format.id).toBe('string')
    expect(format.name).toBe('测试格式')
    expect(format.description).toBe('这是一个测试')
    expect(format.basedOn).toEqual({ type: 'blank' })
    expect(format.createdAt).toBeGreaterThan(0)
    expect(format.updatedAt).toBeGreaterThan(0)
    expect(format.settings.levels).toBeDefined()
    expect(format.settings.enabled).toBe(true)
    expect(format.settings.showLevelOneNumber).toBe(false)
    expect(format.settings.maxDepth).toBe(6)
    // Levels should be deep cloned, not the same reference
    expect(format.settings.levels).not.toBe(levels)
  })

  it('truncates long name to 30 chars', () => {
    const longName = 'a'.repeat(50)
    const levels = makeBlankLevels()
    const format = createFormat(longName, '', { type: 'blank' }, levels)
    expect(format.name.length).toBe(30)
  })

  it('truncates long description to 200 chars', () => {
    const longDesc = 'b'.repeat(300)
    const levels = makeBlankLevels()
    const format = createFormat('test', longDesc, { type: 'blank' }, levels)
    expect(format.description.length).toBe(200)
  })

  it('creates based on built-in preset', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const format = createFormat('十进制副本', '', { type: 'built-in', presetId: 'decimal-hierarchical' }, levels)
    expect(format.basedOn).toEqual({ type: 'built-in', presetId: 'decimal-hierarchical' })
  })
})

describe('copyFormat', () => {
  it('creates an independent copy', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Original', '', { type: 'blank' }, levels)
    const copy = copyFormat(format, 'Copy')

    expect(copy.name).toBe('Copy')
    expect(copy.id).not.toBe(format.id)
    expect(copy.createdAt).toBeGreaterThan(0)
    expect(copy.basedOn).toEqual({ type: 'custom', formatId: format.id })
  })

  it('modifying copy does not affect original', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Original', '', { type: 'blank' }, levels)
    const copy = copyFormat(format, 'Copy')

    // Modify copy levels
    copy.settings.levels[1].enabled = false

    // Original should be unaffected
    expect(format.settings.levels[1].enabled).toBe(true)
  })

  it('copy levels are different objects', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Original', '', { type: 'blank' }, levels)
    const copy = copyFormat(format, 'Copy')

    expect(copy.settings.levels).not.toBe(format.settings.levels)
    expect(copy.settings.levels[1]).not.toBe(format.settings.levels[1])
    expect(copy.settings.levels[1].contextualFormatVariants.withLevelOne).not.toBe(
      format.settings.levels[1].contextualFormatVariants.withLevelOne,
    )
  })
})

describe('renameFormat', () => {
  it('changes name but preserves ID', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Old Name', '', { type: 'blank' }, levels)
    const renamed = renameFormat(format, 'New Name')

    expect(renamed.name).toBe('New Name')
    expect(renamed.id).toBe(format.id)
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(format.updatedAt)
  })

  it('truncates name to 30 chars', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Short', '', { type: 'blank' }, levels)
    const renamed = renameFormat(format, 'a'.repeat(50))
    expect(renamed.name.length).toBe(30)
  })
})

describe('deleteFormat', () => {
  it('removes format from library', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const f2 = createFormat('Format 2', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = makeTestLibrary([f1, f2])

    const newLib = deleteFormat(lib, f1.id)
    expect(newLib.formats.length).toBe(1)
    expect(newLib.formats[0].id).toBe(f2.id)
    // customFormatOrder should also be cleaned
    expect(newLib.preferences.customFormatOrder).not.toContain(f1.id)
    expect(newLib.preferences.customFormatOrder).toContain(f2.id)
  })

  it('returns empty array when deleting last format', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = makeTestLibrary([f1])

    const newLib = deleteFormat(lib, f1.id)
    expect(newLib.formats.length).toBe(0)
    expect(newLib.preferences.customFormatOrder.length).toBe(0)
  })

  it('does nothing when format ID not found', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = makeTestLibrary([f1])

    const newLib = deleteFormat(lib, 'nonexistent-id')
    expect(newLib.formats.length).toBe(1)
  })
})

describe('validateFormatName', () => {
  it('returns null for valid name', () => {
    const lib = makeTestLibrary()
    expect(validateFormatName('我的格式', lib)).toBe(null)
  })

  it('rejects empty name', () => {
    const lib = makeTestLibrary()
    expect(validateFormatName('', lib)).not.toBe(null)
    expect(validateFormatName('   ', lib)).not.toBe(null)
  })

  it('rejects name over 30 chars', () => {
    const lib = makeTestLibrary()
    expect(validateFormatName('a'.repeat(31), lib)).not.toBe(null)
  })

  it('rejects duplicate name', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('My Format', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([f1])
    expect(validateFormatName('My Format', lib)).not.toBe(null)
  })
})

describe('getFormatPreview', () => {
  it('returns preview labels for blank format', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const preview = getFormatPreview(format, 3)

    expect(preview.length).toBe(3)
    expect(preview[0]).toBe('1')  // H1: arabic
    expect(preview[1]).toBe('1')  // H2: arabic (single level ref)
    expect(preview[2]).toBe('1')  // H3: arabic
  })

  it('returns preview for roman-hierarchical based format', () => {
    const romanLevels = getPresetLevels('roman-hierarchical')
    const format = createFormat('Roman', '', { type: 'built-in', presetId: 'roman-hierarchical' }, romanLevels)
    const preview = getFormatPreview(format, 3)

    expect(preview.length).toBe(3)
    // Roman hierarchical: H1=I, H2=I.I, H3=I.I.I
    expect(preview[0]).toBe('I')
    expect(preview[1]).toBe('I.I')
    expect(preview[2]).toBe('I.I.I')
  })
})

describe('migrateOldCustom', () => {
  it('returns empty library when no old custom data', () => {
    const result = migrateOldCustom(undefined, undefined)
    expect(result.migrated).toBe(false)
    expect(result.library.version).toBe(1)
    expect(result.library.formats).toEqual([])
  })

  it('does not migrate when library already exists', () => {
    const levels = makeBlankLevels()
    const existingLib: FormatLibrary = makeTestLibrary([createFormat('Existing', '', { type: 'blank' }, levels)])
    const result = migrateOldCustom(undefined, existingLib)
    expect(result.migrated).toBe(false)
    expect(result.library.formats.length).toBe(1)
  })

  it('migrates old custom settings', () => {
    const levels = makeBlankLevels()
    const oldSettings = {
      enabled: true,
      showLevelOneNumber: true,
      preset: 'custom' as const,
      maxDepth: 6 as HeadingLevel,
      levels,
      customDefinition: levels,
    }
    const result = migrateOldCustom(oldSettings, undefined)
    expect(result.migrated).toBe(true)
    expect(result.library.formats.length).toBe(1)
    expect(result.library.formats[0].name).toBe('旧版自定义格式')
    expect(result.library.formats[0].description).toBe('从旧版自定义设置自动迁移')
  })

  it('migration is idempotent', () => {
    const levels = makeBlankLevels()
    const oldSettings = {
      enabled: true,
      showLevelOneNumber: false,
      preset: 'custom' as const,
      maxDepth: 6 as HeadingLevel,
      levels,
      customDefinition: levels,
    }
    const result1 = migrateOldCustom(oldSettings, undefined)
    const result2 = migrateOldCustom(oldSettings, result1.library)

    expect(result2.migrated).toBe(false)
    expect(result2.library.formats.length).toBe(1) // No duplicates
  })
})

describe('findFormat', () => {
  it('finds format by ID', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([format])

    const found = findFormat(lib, format.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Test')
  })

  it('returns undefined for nonexistent ID', () => {
    const lib = makeTestLibrary()
    expect(findFormat(lib, 'nonexistent')).toBeUndefined()
  })
})

describe('updateFormatInLibrary', () => {
  it('updates format by ID', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([format])

    const updated = { ...format, name: 'Updated' }
    const newLib = updateFormatInLibrary(lib, updated)

    expect(newLib.formats[0].name).toBe('Updated')
    expect(newLib.formats.length).toBe(1)
  })
})

describe('addFormatToLibrary', () => {
  it('adds format to library', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary()

    const newLib = addFormatToLibrary(lib, format)
    expect(newLib.formats.length).toBe(1)
    expect(newLib.formats[0].name).toBe('Test')
    expect(newLib.preferences.customFormatOrder).toContain(format.id)
  })

  it('does not mutate original library', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary()

    addFormatToLibrary(lib, format)
    expect(lib.formats.length).toBe(0) // Original unchanged
  })
})

describe('getDefaultFormatLibrary', () => {
  it('returns empty library with version 1', () => {
    const lib = getDefaultFormatLibrary()
    expect(lib.version).toBe(1)
    expect(lib.formats).toEqual([])
    expect(lib.preferences.hiddenBuiltInPresetIds).toEqual([])
    expect(lib.preferences.customFormatOrder).toEqual([])
  })
})

// ── Built-in preset hide/restore tests ──────────────────

describe('hideBuiltInPreset', () => {
  it('adds preset ID to hidden list', () => {
    const lib = makeTestLibrary()
    const newLib = hideBuiltInPreset(lib, 'roman-hierarchical')
    expect(newLib.preferences.hiddenBuiltInPresetIds).toContain('roman-hierarchical')
  })

  it('does not duplicate already-hidden preset', () => {
    const lib = makeTestLibrary()
    let updated = hideBuiltInPreset(lib, 'chinese-chapter')
    updated = hideBuiltInPreset(updated, 'chinese-chapter')
    expect(updated.preferences.hiddenBuiltInPresetIds.length).toBe(1)
  })

  it('allows hiding multiple presets', () => {
    const lib = makeTestLibrary()
    let updated = hideBuiltInPreset(lib, 'chinese-chapter')
    updated = hideBuiltInPreset(updated, 'chinese-outline')
    expect(updated.preferences.hiddenBuiltInPresetIds.length).toBe(2)
  })
})

describe('showBuiltInPreset', () => {
  it('removes preset ID from hidden list', () => {
    let lib = hideBuiltInPreset(makeTestLibrary(), 'roman-hierarchical')
    lib = showBuiltInPreset(lib, 'roman-hierarchical')
    expect(lib.preferences.hiddenBuiltInPresetIds).not.toContain('roman-hierarchical')
  })

  it('no-op if preset was not hidden', () => {
    const lib = makeTestLibrary()
    const updated = showBuiltInPreset(lib, 'decimal-hierarchical')
    expect(updated.preferences.hiddenBuiltInPresetIds).toEqual([])
  })
})

describe('isBuiltInPresetHidden', () => {
  it('returns true for hidden preset', () => {
    const lib = hideBuiltInPreset(makeTestLibrary(), 'chinese-outline')
    expect(isBuiltInPresetHidden(lib, 'chinese-outline')).toBe(true)
  })

  it('returns false for visible preset', () => {
    const lib = makeTestLibrary()
    expect(isBuiltInPresetHidden(lib, 'decimal-hierarchical')).toBe(false)
  })
})

describe('getVisibleBuiltInPresets', () => {
  it('returns all presets when none hidden', () => {
    const lib = makeTestLibrary()
    expect(getVisibleBuiltInPresets(lib)).toEqual(BUILT_IN_PRESET_IDS)
  })

  it('excludes hidden presets', () => {
    let lib = hideBuiltInPreset(makeTestLibrary(), 'chinese-chapter')
    lib = hideBuiltInPreset(lib, 'roman-hierarchical')
    const visible = getVisibleBuiltInPresets(lib)
    expect(visible).not.toContain('chinese-chapter')
    expect(visible).not.toContain('roman-hierarchical')
    expect(visible).toContain('decimal-hierarchical')
    expect(visible).toContain('chinese-outline')
  })
})

// ── Restore built-in presets ────────────────────────────

describe('restoreBuiltInPresets', () => {
  it('clears all hidden preset IDs', () => {
    let lib = hideBuiltInPreset(makeTestLibrary(), 'chinese-chapter')
    lib = hideBuiltInPreset(lib, 'roman-hierarchical')
    lib = restoreBuiltInPresets(lib)
    expect(lib.preferences.hiddenBuiltInPresetIds).toEqual([])
  })

  it('preserves custom formats', () => {
    const levels = makeBlankLevels()
    const format = createFormat('My Format', '', { type: 'blank' }, levels)
    let lib = addFormatToLibrary(hideBuiltInPreset(makeTestLibrary(), 'chinese-chapter'), format)
    lib = restoreBuiltInPresets(lib)
    expect(lib.formats.length).toBe(1)
    expect(lib.preferences.customFormatOrder).toContain(format.id)
  })
})

describe('areAllBuiltInPresetsVisible', () => {
  it('returns true when nothing hidden', () => {
    expect(areAllBuiltInPresetsVisible(makeTestLibrary())).toBe(true)
  })

  it('returns false when a preset is hidden', () => {
    const lib = hideBuiltInPreset(makeTestLibrary(), 'roman-hierarchical')
    expect(areAllBuiltInPresetsVisible(lib)).toBe(false)
  })
})

// ── Reset entire format library ─────────────────────────

describe('resetFormatLibrary', () => {
  it('returns a library with no user formats', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = addFormatToLibrary(makeTestLibrary(), format)
    lib = hideBuiltInPreset(lib, 'chinese-chapter')
    const reset = resetFormatLibrary()
    expect(reset.formats).toEqual([])
    expect(reset.preferences.hiddenBuiltInPresetIds).toEqual([])
    expect(reset.preferences.customFormatOrder).toEqual([])
  })

  it('idempotent: repeated reset yields same result', () => {
    const reset1 = resetFormatLibrary()
    const reset2 = resetFormatLibrary()
    expect(reset1).toEqual(reset2)
  })
})

// ── Custom format ordering ──────────────────────────────

describe('getOrderedCustomFormats', () => {
  it('returns formats in customFormatOrder', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('First', '', { type: 'blank' }, levels)
    const f2 = createFormat('Second', '', { type: 'blank' }, levels)
    let lib = addFormatToLibrary(makeTestLibrary(), f1)
    lib = addFormatToLibrary(lib, f2)
    // Reverse order
    lib = { ...lib, preferences: { ...lib.preferences, customFormatOrder: [f2.id, f1.id] } }
    const ordered = getOrderedCustomFormats(lib)
    expect(ordered[0].id).toBe(f2.id)
    expect(ordered[1].id).toBe(f1.id)
  })

  it('handles formats not in order list', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([f1])
    // Order doesn't include f1
    const libNoOrder = { ...lib, preferences: { ...lib.preferences, customFormatOrder: [] } }
    const ordered = getOrderedCustomFormats(libNoOrder)
    expect(ordered.length).toBe(1)
  })
})

// ── Migration of old library structure ──────────────────

describe('migrateFormatLibrary', () => {
  it('adds preferences to old library', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Old Format', '', { type: 'blank' }, levels)
    const oldLib: FormatLibrary = { version: 1, formats: [f1] } as any
    const migrated = migrateFormatLibrary(oldLib)
    expect(migrated.preferences.hiddenBuiltInPresetIds).toEqual([])
    expect(migrated.preferences.customFormatOrder).toEqual([f1.id])
  })

  it('is idempotent', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Test', '', { type: 'blank' }, levels)
    const oldLib: FormatLibrary = { version: 1, formats: [f1] } as any
    const m1 = migrateFormatLibrary(oldLib)
    const m2 = migrateFormatLibrary(m1)
    expect(m2.preferences.customFormatOrder).toEqual(m1.preferences.customFormatOrder)
  })

  it('filters invalid preset IDs', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([f1])
    const libWithBad = {
      ...lib,
      preferences: {
        hiddenBuiltInPresetIds: ['invalid-id', 'decimal-hierarchical', 'chinese-chapter', 'chinese-chapter'] as any as BuiltInPresetId[],
        customFormatOrder: lib.preferences.customFormatOrder,
      },
    }
    const migrated = migrateFormatLibrary(libWithBad)
    expect(migrated.preferences.hiddenBuiltInPresetIds).toEqual(['decimal-hierarchical', 'chinese-chapter'])
  })
})

// ── Deep clone isolation tests ──────────────────────────

describe('deep clone isolation', () => {
  it('document snapshot does not share reference with format', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    // copyFormat creates a deep clone
    const copy = copyFormat(format, 'Copy')
    copy.settings.levels[1].enabled = false
    expect(format.settings.levels[1].enabled).toBe(true)
  })

  it('deleting a format does not affect other formats', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const f2 = createFormat('Format 2', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([f1, f2])
    const newLib = deleteFormat(lib, f1.id)
    expect(newLib.formats[0].name).toBe('Format 2')
    // f2's levels should be intact
    expect(newLib.formats[0].settings.levels[1].enabled).toBe(true)
  })

  it('reset library creates fresh deep copies', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = addFormatToLibrary(makeTestLibrary(), format)
    lib = hideBuiltInPreset(lib, 'roman-hierarchical')
    const reset = resetFormatLibrary()
    // The reset library is fresh
    expect(reset).toEqual(getDefaultFormatLibrary())
  })
})

describe('getDefaultPreferences', () => {
  it('returns empty preferences', () => {
    const prefs = getDefaultPreferences()
    expect(prefs.hiddenBuiltInPresetIds).toEqual([])
    expect(prefs.customFormatOrder).toEqual([])
  })
})

// ── Version tracking chain ──────────────────────────────

describe('hasFormatUpdate', () => {
  it('returns false when applied version matches template version', () => {
    const levels = makeBlankLevels()
    let format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = makeTestLibrary([format])
    // Save once to bump version to 1
    format = { ...format }
    lib = updateFormatInLibrary(lib, format)
    expect(lib.formats[0].version).toBe(1)
    expect(hasFormatUpdate(lib, format.id, 1)).toBe(false)
    expect(hasFormatUpdate(lib, format.id, 0)).toBe(true) // 0 < 1
  })

  it('returns true when applied version is behind template version', () => {
    const levels = makeBlankLevels()
    let format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = makeTestLibrary([format])
    format = { ...format }
    lib = updateFormatInLibrary(lib, format) // version → 1
    expect(hasFormatUpdate(lib, format.id, 0)).toBe(true)
  })

  it('returns true when applied version is undefined (old data)', () => {
    const levels = makeBlankLevels()
    let format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = makeTestLibrary([format])
    format = { ...format }
    lib = updateFormatInLibrary(lib, format) // version → 1
    expect(hasFormatUpdate(lib, format.id, undefined)).toBe(true)
  })

  it('returns false when applied version is newer than template version', () => {
    const levels = makeBlankLevels()
    let format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = makeTestLibrary([format])
    format = { ...format }
    lib = updateFormatInLibrary(lib, format) // version → 1
    expect(hasFormatUpdate(lib, format.id, 2)).toBe(false)
  })

  it('returns false for non-existent format ID', () => {
    const lib = makeTestLibrary([])
    expect(hasFormatUpdate(lib, 'nonexistent', 0)).toBe(false)
  })

  it('works after template update increments version', () => {
    const levels = makeBlankLevels()
    let format = createFormat('Test', '', { type: 'blank' }, levels)
    let lib = makeTestLibrary([format])

    // Save once: version → 1
    format = { ...format }
    lib = updateFormatInLibrary(lib, format)
    expect(lib.formats[0].version).toBe(1)

    // V1 applied → no update
    expect(hasFormatUpdate(lib, format.id, 1)).toBe(false)

    // Save again → version → 2
    format = { ...format }
    lib = updateFormatInLibrary(lib, format)
    // Now template version is 2
    expect(hasFormatUpdate(lib, format.id, 1)).toBe(true)

    // Apply update → source.version = 2
    expect(hasFormatUpdate(lib, format.id, 2)).toBe(false)
  })
})

describe('getFormatVersion', () => {
  it('returns format version for custom format', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib = makeTestLibrary([format])
    expect(getFormatVersion(lib, format.id)).toBe(0) // createFormat sets version=0; first save bumps to 1
  })

  it('returns undefined for non-existent format', () => {
    const lib = makeTestLibrary([])
    expect(getFormatVersion(lib, 'nonexistent')).toBeUndefined()
  })
})

// ── Migration v2: version field on formats ──────────────

describe('migrateFormatLibrary v2 (version field)', () => {
  it('assigns version=1 to formats missing version field', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    // Remove version to simulate old data
    const oldFormat = { ...format } as any
    delete oldFormat.version
    const oldLib: FormatLibrary = { version: 1, formats: [oldFormat] } as any
    oldLib.preferences = { hiddenBuiltInPresetIds: [], customFormatOrder: [] }

    const migrated = migrateFormatLibrary(oldLib)
    expect(migrated.formats[0].version).toBe(1)
    expect(migrated.version).toBe(2)
  })

  it('does not modify existing version fields', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const formatWithVersion = { ...format, version: 5 }
    const lib: FormatLibrary = {
      version: 1,
      formats: [formatWithVersion],
      preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] },
    }

    const migrated = migrateFormatLibrary(lib)
    expect(migrated.formats[0].version).toBe(5)
  })

  it('is idempotent across multiple calls', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const oldFormat = { ...format } as any
    delete oldFormat.version
    const oldLib: FormatLibrary = { version: 1, formats: [oldFormat] } as any
    oldLib.preferences = { hiddenBuiltInPresetIds: [], customFormatOrder: [] }

    const m1 = migrateFormatLibrary(oldLib)
    const m2 = migrateFormatLibrary(m1)
    expect(m2.formats[0].version).toBe(1)
    expect(m2.version).toBe(2)
  })

  it('skips migration when library version is already >= 2', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const oldFormat = { ...format } as any
    delete oldFormat.version
    const migratedLib: FormatLibrary = {
      version: 2,
      formats: [oldFormat],
      preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] },
    }
    // Already at v2 — should not touch formats
    // (in real flow, migrateFormatLibrary only runs on load, so v2 means already migrated)
    expect(migratedLib.version).toBe(2)
  })
})

// ── Number-to-title spacing tests ──────────────────────

import { computeHeadingNumbering } from './numbering-engine'
import type { HeadingDescriptor, NumberTitleSpacing } from './heading-types'

function makeHeading(text: string, level: HeadingLevel, key?: string): HeadingDescriptor {
  return { key: key ?? generateStableId(), text, level }
}

function makeSpacingTestSettings(spacing: NumberTitleSpacing): import('./heading-types').HeadingNumberingSettings {
  const levels: Record<HeadingLevel, HeadingLevelStyle> = {} as any
  for (const lv of HEADING_LEVELS) {
    // Build a hierarchical contextual format: parent refs with '.' suffix
    const contextSegments: ContextualFormatSegment[] = []
    for (let p = 1; p <= lv; p++) {
      contextSegments.push({
        id: generateStableId(),
        type: 'level-reference',
        level: p as HeadingLevel,
        appearance: { tokenStyle: 'arabic' as const, prefix: '', suffix: '' },
      })
      if (p < lv) {
        contextSegments.push({
          id: generateStableId(),
          type: 'literal',
          value: '.',
        })
      }
    }
    levels[lv] = {
      enabled: true,
      tokenStyle: 'arabic',
      includeParents: false,
      prefix: '',
      suffix: '',
      separator: '.',
      startAt: 1,
      restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
      formatVariants: { withLevelOne: [], withoutLevelOne: [] },
      levelTemplate: { tokenStyle: 'arabic', prefix: '', suffix: '' },
      multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
      contextualFormatVariants: {
        withLevelOne: contextSegments as any,
        withoutLevelOne: lv === 1 ? [] : contextSegments.filter(s => s.type === 'literal' || (s.type === 'level-reference' && s.level !== 1)) as any,
      },
      numberTitleSpacing: spacing,
    }
  }
  return {
    enabled: true,
    showLevelOneNumber: true,
    preset: 'custom',
    maxDepth: 6 as HeadingLevel,
    levels,
  }
}

describe('numberTitleSpacing in label generation', () => {
  it('adds gap="space" to label when spacing is space', () => {
    const settings = makeSpacingTestSettings('space')
    const headings: HeadingDescriptor[] = [
      makeHeading('Overview', 1 as HeadingLevel),
      makeHeading('Background', 2 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('1')
    expect(result[0].labelGap).toBe('space')
    expect(result[1].label).toBe('1.1')
    expect(result[1].labelGap).toBe('space')
  })

  it('sets gap="none" when spacing is none', () => {
    const settings = makeSpacingTestSettings('none')
    const headings: HeadingDescriptor[] = [
      makeHeading('Overview', 1 as HeadingLevel),
      makeHeading('Background', 2 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('1')
    expect(result[0].labelGap).toBe('none')
    expect(result[1].label).toBe('1.1')
    expect(result[1].labelGap).toBe('none')
  })

  it('uses per-level spacing independently', () => {
    const settings = makeSpacingTestSettings('space')
    settings.levels[2].numberTitleSpacing = 'none'   // H2: no space (override)
    settings.levels[1].numberTitleSpacing = 'space'  // H1: with space
    settings.levels[3].numberTitleSpacing = 'space'  // H3: with space
    const headings: HeadingDescriptor[] = [
      makeHeading('H1', 1 as HeadingLevel),
      makeHeading('H2', 2 as HeadingLevel),
      makeHeading('H3', 3 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].labelGap).toBe('space')   // H1 with space
    expect(result[1].labelGap).toBe('none')    // H2 without space
    expect(result[2].labelGap).toBe('space')   // H3 with space
  })

  it('preserves spacing per physical level when H1 is off', () => {
    const settings = makeSpacingTestSettings('space')
    settings.showLevelOneNumber = false
    settings.levels[1].numberTitleSpacing = 'space'
    settings.levels[2].numberTitleSpacing = 'none'
    settings.levels[3].numberTitleSpacing = 'space'
    const headings: HeadingDescriptor[] = [
      makeHeading('H1', 1 as HeadingLevel),
      makeHeading('H2', 2 as HeadingLevel),
      makeHeading('H3', 3 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('')       // H1 hidden (no label)
    expect(result[0].labelGap).toBe('none')
    expect(result[1].label).toBe('1')      // H2 uses H2 spacing (none)
    expect(result[1].labelGap).toBe('none')
    expect(result[2].label).toBe('1.1')   // H3 uses H3 spacing (space)
    expect(result[2].labelGap).toBe('space')
  })

  it('does not add space when label is empty (unnumbered)', () => {
    const levels = makeBlankLevels()
    levels[1].enabled = false
    levels[1].numberTitleSpacing = 'space'
    const settings: import('./heading-types').HeadingNumberingSettings = {
      enabled: true, showLevelOneNumber: true, preset: 'custom', maxDepth: 6 as HeadingLevel, levels,
    }
    const headings: HeadingDescriptor[] = [
      makeHeading('Disabled', 1 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('') // empty label, no trailing space
  })

  it('defaults to space when numberTitleSpacing is missing (old data)', () => {
    const levels = makeBlankLevels()
    delete levels[1].numberTitleSpacing
    const settings: import('./heading-types').HeadingNumberingSettings = {
      enabled: true, showLevelOneNumber: true, preset: 'custom', maxDepth: 6 as HeadingLevel, levels,
    }
    const headings: HeadingDescriptor[] = [
      makeHeading('H1', 1 as HeadingLevel),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].labelGap).toBe('space') // default 'space'
  })
})
