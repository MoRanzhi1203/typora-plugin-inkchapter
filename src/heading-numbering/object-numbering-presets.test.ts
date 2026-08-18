import { describe, it, expect } from 'vitest'
import {
  OBJECT_NUMBERING_PRESETS,
  OBJECT_NUMBERING_PRESET_IDS,
  isValidObjectNumberingPreset,
  resolvePresetConfig,
  resolvePresetId,
  presetFormulaLabel,
  presetOptionLabel,
  presetSelectionPatch,
  STANDARD_PRESET_START_AT,
  STANDARD_PRESET_MIN_DIGITS,
} from './object-numbering-presets'
import {
  computeObjectNumbers,
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  renderNumberingPreview,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
} from './object-numbering-engine'
import { migrateObjectNumberingConfig } from './object-numbering-settings'

function configs(cfg: ObjectNumberingConfig): Record<ObjectNumberingType, ObjectNumberingConfig> {
  return { table: cfg, figure: cfg, code: cfg, formula: cfg }
}

function renderPreset(
  preset: keyof typeof OBJECT_NUMBERING_PRESETS,
  ordinals: { chapterOrdinal?: number | null; sectionOrdinal?: number | null } = {},
  n = 1,
): string {
  const def = OBJECT_NUMBERING_PRESETS[preset]
  const config: ObjectNumberingConfig = {
    ...DEFAULT_OBJECT_NUMBERING_CONFIG.table,
    scope: def.scope,
    template: def.format,
    preset,
  }
  const r = computeObjectNumbers(
    [{ type: 'table', documentOrder: 0, headingContext: ordinals }],
    { configs: configs(config) },
  )
  return r[0].renderedNumber
}

describe('preset registry', () => {
  it('maps the 5 presets to scope + format', () => {
    expect(OBJECT_NUMBERING_PRESETS.continuous).toMatchObject({ scope: 'document', format: '{n}' })
    expect(OBJECT_NUMBERING_PRESETS['chapter-dot']).toMatchObject({ scope: 'chapter', format: '{chapter}.{n}' })
    expect(OBJECT_NUMBERING_PRESETS['chapter-dash']).toMatchObject({ scope: 'chapter', format: '{chapter}-{n}' })
    expect(OBJECT_NUMBERING_PRESETS['section-dot']).toMatchObject({ scope: 'section', format: '{chapter}.{section}.{n}' })
    expect(OBJECT_NUMBERING_PRESETS['section-dash']).toMatchObject({ scope: 'section', format: '{chapter}-{section}-{n}' })
  })

  it('has exactly 5 stable ids', () => {
    expect(OBJECT_NUMBERING_PRESET_IDS).toEqual(['continuous', 'chapter-dot', 'chapter-dash', 'section-dot', 'section-dash'])
  })

  it('validates preset ids', () => {
    expect(isValidObjectNumberingPreset('chapter-dot')).toBe(true)
    expect(isValidObjectNumberingPreset('unknown')).toBe(false)
  })
})

describe('preset rendering (reuses runtime engine)', () => {
  it('continuous → 1', () => {
    expect(renderPreset('continuous', {})).toBe('1')
  })
  it('chapter-dot → 2.1', () => {
    expect(renderPreset('chapter-dot', { chapterOrdinal: 2 })).toBe('2.1')
  })
  it('chapter-dash → 2-1', () => {
    expect(renderPreset('chapter-dash', { chapterOrdinal: 2 })).toBe('2-1')
  })
  it('section-dot → 2.3.1', () => {
    expect(renderPreset('section-dot', { chapterOrdinal: 2, sectionOrdinal: 3 })).toBe('2.3.1')
  })
  it('section-dash → 2-3-1', () => {
    expect(renderPreset('section-dash', { chapterOrdinal: 2, sectionOrdinal: 3 })).toBe('2-3-1')
  })

  it('chapter-dot minDigits=2 → 2.01 (chapter not padded)', () => {
    const def = OBJECT_NUMBERING_PRESETS['chapter-dot']
    const config: ObjectNumberingConfig = { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, scope: def.scope, template: def.format, preset: 'chapter-dot', minDigits: 2 }
    const r = computeObjectNumbers([{ type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }], { configs: configs(config) })
    expect(r[0].renderedNumber).toBe('2.01')
  })

  it('chapter-dot startAt=3 → 2.3', () => {
    const def = OBJECT_NUMBERING_PRESETS['chapter-dot']
    const config: ObjectNumberingConfig = { ...DEFAULT_OBJECT_NUMBERING_CONFIG.table, scope: def.scope, template: def.format, preset: 'chapter-dot', startAt: 3 }
    const r = computeObjectNumbers([{ type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }], { configs: configs(config) })
    expect(r[0].renderedNumber).toBe('2.3')
  })
})

describe('legacy migration', () => {
  it('maps the 5 legacy scope+format combos to presets', () => {
    expect(migrateObjectNumberingConfig('table', { scope: 'document', template: '{n}' }).preset).toBe('continuous')
    expect(migrateObjectNumberingConfig('table', { scope: 'chapter', template: '{chapter}.{n}' }).preset).toBe('chapter-dot')
    expect(migrateObjectNumberingConfig('table', { scope: 'chapter', template: '{chapter}-{n}' }).preset).toBe('chapter-dash')
    expect(migrateObjectNumberingConfig('table', { scope: 'section', template: '{chapter}.{section}.{n}' }).preset).toBe('section-dot')
    expect(migrateObjectNumberingConfig('table', { scope: 'section', template: '{chapter}-{section}-{n}' }).preset).toBe('section-dash')
  })

  it('legacy custom format is kept (never silently dropped)', () => {
    const c = migrateObjectNumberingConfig('table', { scope: 'chapter', template: '[{chapter}.{n}]' })
    expect(c.preset).toBeUndefined()
    expect(c.legacyCustomFormat).toBe(true)
    expect(c.template).toBe('[{chapter}.{n}]')
    expect(c.scope).toBe('chapter')
  })

  it('preset id is authority (overrides stale scope/template)', () => {
    const c = migrateObjectNumberingConfig('table', { preset: 'chapter-dot', scope: 'document', template: '{n}' })
    expect(c.preset).toBe('chapter-dot')
    expect(c.scope).toBe('chapter')
    expect(c.template).toBe('{chapter}.{n}')
  })
})

describe('preset fallback', () => {
  it('unknown preset id falls back to continuous', () => {
    expect(resolvePresetId('unknown')).toBe('continuous')
    const r = resolvePresetConfig({ preset: 'unknown' })
    expect(r.decision).toBe('FALLBACK')
    expect(r.preset).toBe('continuous')
    expect(r.scope).toBe('document')
    expect(r.format).toBe('{n}')
  })
})

describe('independent presets + formula label', () => {
  it('four types can hold independent presets', () => {
    const table = migrateObjectNumberingConfig('table', { preset: 'chapter-dot' })
    const figure = migrateObjectNumberingConfig('figure', { preset: 'chapter-dash' })
    const code = migrateObjectNumberingConfig('code', { preset: 'section-dot' })
    const formula = migrateObjectNumberingConfig('formula', { preset: 'chapter-dot' })
    expect([table.preset, figure.preset, code.preset, formula.preset]).toEqual(['chapter-dot', 'chapter-dash', 'section-dot', 'chapter-dot'])
  })

  it('formula preset label wraps in parentheses', () => {
    expect(presetFormulaLabel('continuous')).toBe('(1)')
    expect(presetFormulaLabel('chapter-dot')).toBe('(2.1)')
    expect(presetFormulaLabel('section-dash')).toBe('(2-3-1)')
  })
})

describe('presetOptionLabel', () => {
  it('non-formula keeps plain label', () => {
    expect(presetOptionLabel('chapter-dot', false)).toBe('按章·点号：2.1, 2.2, 2.3')
    expect(presetOptionLabel('continuous', false)).toBe('全文连续：1, 2, 3')
  })

  it('formula wraps examples in parentheses', () => {
    expect(presetOptionLabel('chapter-dot', true)).toBe('按章·点号：(2.1), (2.2), (2.3)')
    expect(presetOptionLabel('continuous', true)).toBe('全文连续：(1), (2), (3)')
  })
})

describe('formula preset rendering (reuses runtime engine)', () => {
  function formulaConfig(preset: keyof typeof OBJECT_NUMBERING_PRESETS): Record<ObjectNumberingType, ObjectNumberingConfig> {
    const def = OBJECT_NUMBERING_PRESETS[preset]
    const formula: ObjectNumberingConfig = {
      ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula,
      scope: def.scope,
      template: def.format,
      preset,
      formulaMode: 'inkchapter',
    }
    return {
      table: DEFAULT_OBJECT_NUMBERING_CONFIG.table,
      figure: DEFAULT_OBJECT_NUMBERING_CONFIG.figure,
      code: DEFAULT_OBJECT_NUMBERING_CONFIG.code,
      formula,
    }
  }

  it('continuous → (1)', () => {
    const r = computeObjectNumbers([{ type: 'formula', documentOrder: 0, headingContext: {} }], { configs: formulaConfig('continuous') })
    expect(r[0].renderedNumber).toBe('(1)')
  })

  it('chapter-dot → (2.1)', () => {
    const r = computeObjectNumbers([{ type: 'formula', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }], { configs: formulaConfig('chapter-dot') })
    expect(r[0].renderedNumber).toBe('(2.1)')
  })

  it('section-dash → (2-3-1)', () => {
    const r = computeObjectNumbers([{ type: 'formula', documentOrder: 0, headingContext: { chapterOrdinal: 2, sectionOrdinal: 3 } }], { configs: formulaConfig('section-dash') })
    expect(r[0].renderedNumber).toBe('(2-3-1)')
  })
})

describe('preset preview (reuses runtime formatter)', () => {
  it('chapter-dot table → 表 2.1 示例名称', () => {
    const config = migrateObjectNumberingConfig('table', { preset: 'chapter-dot' })
    expect(renderNumberingPreview('table', config, { n: 1, chapter: '2', section: '3', name: '示例名称' })).toBe('表 2.1 示例名称')
  })

  it('chapter-dot startAt=3 → 表 2.3 示例名称', () => {
    const config = migrateObjectNumberingConfig('table', { preset: 'chapter-dot', startAt: 3 })
    expect(renderNumberingPreview('table', config, { n: 3, chapter: '2', section: '3', name: '示例名称' })).toBe('表 2.3 示例名称')
  })

  it('chapter-dash figure → 图 2-1 示例图片', () => {
    const config = migrateObjectNumberingConfig('figure', { preset: 'chapter-dash' })
    expect(renderNumberingPreview('figure', config, { n: 1, chapter: '2', section: '3', name: '示例图片' })).toBe('图 2-1 示例图片')
  })

  it('section-dot code → 代码 2.3.1 示例代码', () => {
    const config = migrateObjectNumberingConfig('code', { preset: 'section-dot' })
    expect(renderNumberingPreview('code', config, { n: 1, chapter: '2', section: '3', name: '示例代码' })).toBe('代码 2.3.1 示例代码')
  })

  it('formula chapter-dot → (2.1)', () => {
    const config = migrateObjectNumberingConfig('formula', { preset: 'chapter-dot', formulaMode: 'inkchapter' })
    expect(renderNumberingPreview('formula', config, { n: 1, chapter: '2', section: '3' })).toBe('(2.1)')
  })
})

describe('preset normalization (v2.2)', () => {
  it('presetSelectionPatch normalizes startAt/minDigits to standard 1/1', () => {
    const patch = presetSelectionPatch('chapter-dot')
    expect(patch.preset).toBe('chapter-dot')
    expect(patch.scope).toBe('chapter')
    expect(patch.template).toBe('{chapter}.{n}')
    expect(patch.startAt).toBe(STANDARD_PRESET_START_AT)
    expect(patch.minDigits).toBe(STANDARD_PRESET_MIN_DIGITS)
    expect(patch.startAt).toBe(1)
    expect(patch.minDigits).toBe(1)
    expect(patch.legacyCustomFormat).toBeUndefined()
  })

  it('legacy startAt=3/minDigits=2 + select chapter-dot → standard 2.1 (no padding)', () => {
    const patch = presetSelectionPatch('chapter-dot')
    const config: ObjectNumberingConfig = {
      ...DEFAULT_OBJECT_NUMBERING_CONFIG.table,
      scope: patch.scope,
      template: patch.template,
      preset: patch.preset,
      startAt: patch.startAt,
      minDigits: patch.minDigits,
    }
    const r = computeObjectNumbers([{ type: 'table', documentOrder: 0, headingContext: { chapterOrdinal: 2 } }], { configs: configs(config) })
    expect(r[0].renderedNumber).toBe('2.1')
  })

  it('legacy startAt/minDigits still read safely (compatibility, no crash)', () => {
    const cfg = migrateObjectNumberingConfig('table', { scope: 'chapter', template: '{chapter}.{n}', startAt: 3, minDigits: 2 })
    expect(cfg.startAt).toBe(3)
    expect(cfg.minDigits).toBe(2)
    expect(cfg.preset).toBe('chapter-dot')
  })
})

describe('formula scoped counter reset (v2.4)', () => {
  function formulaConfigs(preset: keyof typeof OBJECT_NUMBERING_PRESETS): Record<ObjectNumberingType, ObjectNumberingConfig> {
    const def = OBJECT_NUMBERING_PRESETS[preset]
    const formula: ObjectNumberingConfig = {
      ...DEFAULT_OBJECT_NUMBERING_CONFIG.formula,
      scope: def.scope,
      template: def.format,
      preset,
      formulaMode: 'inkchapter',
      startAt: 1,
      minDigits: 1,
    }
    return {
      table: DEFAULT_OBJECT_NUMBERING_CONFIG.table,
      figure: DEFAULT_OBJECT_NUMBERING_CONFIG.figure,
      code: DEFAULT_OBJECT_NUMBERING_CONFIG.code,
      formula,
    }
  }

  it('chapter-dot resets per chapter → (1.1), (1.2), (2.1)', () => {
    const targets = [
      { type: 'formula' as const, documentOrder: 0, headingContext: { chapterOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 1, headingContext: { chapterOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 2, headingContext: { chapterOrdinal: 2 } },
    ]
    const r = computeObjectNumbers(targets, { configs: formulaConfigs('chapter-dot') })
    expect(r.map(x => x.renderedNumber)).toEqual(['(1.1)', '(1.2)', '(2.1)'])
  })

  it('chapter-dash resets per chapter → (1-1), (1-2), (2-1)', () => {
    const targets = [
      { type: 'formula' as const, documentOrder: 0, headingContext: { chapterOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 1, headingContext: { chapterOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 2, headingContext: { chapterOrdinal: 2 } },
    ]
    const r = computeObjectNumbers(targets, { configs: formulaConfigs('chapter-dash') })
    expect(r.map(x => x.renderedNumber)).toEqual(['(1-1)', '(1-2)', '(2-1)'])
  })

  it('section-dot resets per section → (1.1.1), (1.1.2), (1.2.1)', () => {
    const targets = [
      { type: 'formula' as const, documentOrder: 0, headingContext: { chapterOrdinal: 1, sectionOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 1, headingContext: { chapterOrdinal: 1, sectionOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 2, headingContext: { chapterOrdinal: 1, sectionOrdinal: 2 } },
    ]
    const r = computeObjectNumbers(targets, { configs: formulaConfigs('section-dot') })
    expect(r.map(x => x.renderedNumber)).toEqual(['(1.1.1)', '(1.1.2)', '(1.2.1)'])
  })

  it('section-dash resets per section → (1-1-1), (1-1-2), (1-2-1)', () => {
    const targets = [
      { type: 'formula' as const, documentOrder: 0, headingContext: { chapterOrdinal: 1, sectionOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 1, headingContext: { chapterOrdinal: 1, sectionOrdinal: 1 } },
      { type: 'formula' as const, documentOrder: 2, headingContext: { chapterOrdinal: 1, sectionOrdinal: 2 } },
    ]
    const r = computeObjectNumbers(targets, { configs: formulaConfigs('section-dash') })
    expect(r.map(x => x.renderedNumber)).toEqual(['(1-1-1)', '(1-1-2)', '(1-2-1)'])
  })
})
