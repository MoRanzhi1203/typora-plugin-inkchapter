import { describe, it, expect } from 'vitest'
import {
  createFormat,
  copyFormat,
  renameFormat,
  deleteFormat as deleteFormatFromLibrary,
  generateFormatId,
  getFormatPreview,
  validateFormatName,
  migrateOldCustom,
  addFormatToLibrary,
  findFormat,
  updateFormatInLibrary,
  getDefaultFormatLibrary,
} from './format-library'
import type {
  CustomNumberingFormat,
  FormatLibrary,
  HeadingLevel,
  HeadingLevelStyle,
  FormatBasedOn,
} from './heading-types'
import { HEADING_LEVELS, generateStableId } from './heading-types'
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
    const lib: FormatLibrary = { version: 1, formats: [f1, f2] }

    const remaining = deleteFormatFromLibrary(lib, f1.id)
    expect(remaining.length).toBe(1)
    expect(remaining[0].id).toBe(f2.id)
  })

  it('returns empty array when deleting last format', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = { version: 1, formats: [f1] }

    const remaining = deleteFormatFromLibrary(lib, f1.id)
    expect(remaining.length).toBe(0)
  })

  it('does nothing when format ID not found', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('Format 1', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = { version: 1, formats: [f1] }

    const remaining = deleteFormatFromLibrary(lib, 'nonexistent-id')
    expect(remaining.length).toBe(1)
  })
})

describe('validateFormatName', () => {
  it('returns null for valid name', () => {
    const lib: FormatLibrary = { version: 1, formats: [] }
    expect(validateFormatName('我的格式', lib)).toBe(null)
  })

  it('rejects empty name', () => {
    const lib: FormatLibrary = { version: 1, formats: [] }
    expect(validateFormatName('', lib)).not.toBe(null)
    expect(validateFormatName('   ', lib)).not.toBe(null)
  })

  it('rejects name over 30 chars', () => {
    const lib: FormatLibrary = { version: 1, formats: [] }
    expect(validateFormatName('a'.repeat(31), lib)).not.toBe(null)
  })

  it('rejects duplicate name', () => {
    const levels = makeBlankLevels()
    const f1 = createFormat('My Format', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = { version: 1, formats: [f1] }
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
    const existingLib: FormatLibrary = {
      version: 1,
      formats: [createFormat('Existing', '', { type: 'blank' }, levels)],
    }
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
    const lib: FormatLibrary = { version: 1, formats: [format] }

    const found = findFormat(lib, format.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Test')
  })

  it('returns undefined for nonexistent ID', () => {
    const lib: FormatLibrary = { version: 1, formats: [] }
    expect(findFormat(lib, 'nonexistent')).toBeUndefined()
  })
})

describe('updateFormatInLibrary', () => {
  it('updates format by ID', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = { version: 1, formats: [format] }

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
    const lib: FormatLibrary = { version: 1, formats: [] }

    const newLib = addFormatToLibrary(lib, format)
    expect(newLib.formats.length).toBe(1)
    expect(newLib.formats[0].name).toBe('Test')
  })

  it('does not mutate original library', () => {
    const levels = makeBlankLevels()
    const format = createFormat('Test', '', { type: 'blank' }, levels)
    const lib: FormatLibrary = { version: 1, formats: [] }

    addFormatToLibrary(lib, format)
    expect(lib.formats.length).toBe(0) // Original unchanged
  })
})

describe('getDefaultFormatLibrary', () => {
  it('returns empty library with version 1', () => {
    const lib = getDefaultFormatLibrary()
    expect(lib.version).toBe(1)
    expect(lib.formats).toEqual([])
  })
})
