import { describe, it, expect } from 'vitest'
import { formatObjectNumber, presetToScopeStyle, type NumberingPreset } from './numbering-preset-formatter'
import {
  buildPresetPreview,
  formatPresetNumber,
  getPublicPresetOptions,
  normalizeObjectNumberingConfig,
  structureModeDescription,
  PUBLIC_PRESET_DESCRIPTORS,
} from './object-numbering-presets'
import {
  DEFAULT_OBJECT_NUMBERING_CONFIG,
} from './object-numbering-engine'
import {
  defaultObjectNumberingSettings,
  migrateObjectNumberingConfig,
  migrateObjectNumberingSettings,
} from './object-numbering-settings'

describe('ONE_PRESET_AUTHORITY — object-numbering-presets delegates to canonical formatter', () => {
  it('formatPresetNumber equals formatObjectNumber for every standard preset', () => {
    for (const d of PUBLIC_PRESET_DESCRIPTORS) {
      const preset = d.id as NumberingPreset
      const { requestedScope, style } = presetToScopeStyle(preset)
      expect(formatPresetNumber(preset, 2, 1, 3))
        .toBe(formatObjectNumber(requestedScope, style, 2, 1, 3))
    }
  })

  it('object-numbering-presets does not define a second standard preset id set', () => {
    // The canonical standard id set lives in numbering-preset-formatter.ts.
    // PUBLIC_PRESET_DESCRIPTORS only decorates those five ids with labels.
    expect(PUBLIC_PRESET_DESCRIPTORS.map(d => d.id))
      .toEqual(['global', 'chapter-dot', 'section-dot', 'chapter-dash', 'section-dash'])
  })
})

describe('PERSIST — real persisted settings save/reload', () => {
  it('PERSIST-1: four kinds persist independent presets through save/reload', () => {
    const s = defaultObjectNumberingSettings()
    s.types.figure = { ...s.types.figure, preset: 'section-dash' }
    s.types.table = { ...s.types.table, preset: 'chapter-dot' }
    s.types.formula = { ...s.types.formula, preset: 'global' }
    s.types.code = { ...s.types.code, preset: 'section-dot' }

    const reloaded = migrateObjectNumberingSettings(JSON.parse(JSON.stringify(s)))
    expect(reloaded.types.figure.preset).toBe('section-dash')
    expect(reloaded.types.table.preset).toBe('chapter-dot')
    expect(reloaded.types.formula.preset).toBe('global')
    expect(reloaded.types.code.preset).toBe('section-dot')
  })

  it('PERSIST-2: changing one kind does not overwrite the others', () => {
    const s = defaultObjectNumberingSettings()
    s.types.figure = { ...s.types.figure, preset: 'section-dash' }
    expect(s.types.table.preset).toBe('global')
    expect(s.types.formula.preset).toBe('global')
    expect(s.types.code.preset).toBe('global')
  })

  it('PERSIST-3: old exact template loads as the correct semantic preset', () => {
    expect(migrateObjectNumberingConfig('figure', { template: '{n}' }).preset).toBe('global')
    expect(migrateObjectNumberingConfig('figure', { template: '{chapter}.{n}' }).preset).toBe('chapter-dot')
    expect(migrateObjectNumberingConfig('figure', { template: '{chapter}.{section}.{n}' }).preset).toBe('section-dot')
    expect(migrateObjectNumberingConfig('figure', { template: '{chapter}-{n}' }).preset).toBe('chapter-dash')
    expect(migrateObjectNumberingConfig('figure', { template: '{chapter}.{section}-{n}' }).preset).toBe('section-dash')
  })

  it('PERSIST-4: unknown legacy custom template survives load/save/reload', () => {
    const migrated = migrateObjectNumberingConfig('figure', { template: '{chapter}/{section}/{n}' })
    expect(migrated.preset).toBe('legacy-custom')
    expect(migrated.template).toBe('{chapter}/{section}/{n}')

    const reloaded = migrateObjectNumberingConfig('figure', JSON.parse(JSON.stringify(migrated)))
    expect(reloaded.preset).toBe('legacy-custom')
    expect(reloaded.template).toBe('{chapter}/{section}/{n}')
  })

  it('PERSIST-5: unknown legacy fields survive legacy-custom normalization round trip', () => {
    const legacy = { template: '{chapter}/{section}/{n}', numberingMode: 'custom', customFlag: 'keep-me' }
    const once = normalizeObjectNumberingConfig(legacy)
    expect(once.preset).toBe('legacy-custom')
    expect(once.legacyPayload).toEqual(legacy)
    const twice = normalizeObjectNumberingConfig(once)
    expect(twice).toEqual(once)
  })
})

describe('LEGACY_CUSTOM_BEHAVIOR_PRESERVED', () => {
  it('legacy-custom keeps the old template behavior (2/1/3), not a bare {n} fallback', () => {
    expect(formatPresetNumber('legacy-custom', 2, 1, 3, 1, 1, '{chapter}/{section}/{n}')).toBe('2/1/3')
  })

  it('legacy-custom preview keeps old wrapper behavior', () => {
    expect(buildPresetPreview('legacy-custom', 'figure', { chapter: 2, section: 1, ordinal: 3 }, 1, 1, '{chapter}/{section}/{n}'))
      .toBe('图 2/1/3')
  })
})

describe('REAL_UI contract', () => {
  it('UI-PRESET-1/2/3: exactly five options with no physical H-level labels', () => {
    const opts = getPublicPresetOptions()
    expect(opts.map(o => o.value)).toEqual(['global', 'chapter-dot', 'section-dot', 'chapter-dash', 'section-dash'])
    const labels = opts.map(o => o.label).join(' ')
    expect(labels).not.toMatch(/H1|H2|H3|reset-h|按一|按二|按三/)
  })

  it('UI-PRESET-5/6: strict and loose descriptions are distinct and semantic', () => {
    expect(structureModeDescription('strict')).toContain('H1 文档题目')
    expect(structureModeDescription('loose')).not.toMatch(/按 H[123]/)
  })
})

describe('PREVIEW — canonical formatter', () => {
  it('PREVIEW-2: section-dash 2,1,3 wrappers', () => {
    expect(buildPresetPreview('section-dash', 'figure', { chapter: 2, section: 1, ordinal: 3 })).toBe('图 2.1-3')
    expect(buildPresetPreview('section-dash', 'table', { chapter: 2, section: 1, ordinal: 3 })).toBe('表 2.1-3')
    expect(buildPresetPreview('section-dash', 'formula', { chapter: 2, section: 1, ordinal: 3 })).toBe('(2.1-3)')
    expect(buildPresetPreview('section-dash', 'code', { chapter: 2, section: 1, ordinal: 3 })).toBe('代码 2.1-3')
  })

  it('PREVIEW-3: minDigits=2 pads {n} only', () => {
    expect(buildPresetPreview('section-dash', 'figure', { chapter: 2, section: 1, ordinal: 3 }, 1, 2)).toBe('图 2.1-03')
  })

  it('PREVIEW-4: start=3 on first object', () => {
    expect(buildPresetPreview('section-dash', 'figure', { chapter: 2, section: 1, ordinal: 1 }, 3)).toBe('图 2.1-3')
  })

  it('PREVIEW-5: legacy-custom retains legacy formatting', () => {
    expect(buildPresetPreview('legacy-custom', 'figure', { chapter: 2, section: 1, ordinal: 3 }, 1, 1, '{chapter}/{section}/{n}'))
      .toBe('图 2/1/3')
  })
})
