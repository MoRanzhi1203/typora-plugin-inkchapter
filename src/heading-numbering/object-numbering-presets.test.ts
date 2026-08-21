import { describe, it, expect } from 'vitest'
import {
  PUBLIC_PRESET_DESCRIPTORS,
  buildPresetPreview,
  formatPresetNumber,
  migrateLegacyTemplateToPreset,
  normalizeObjectNumberingConfig,
  structureModeDescription,
} from './object-numbering-presets'

describe('legacy template migration (exact mapping)', () => {
  it('MIG-1: {n} -> global', () => {
    expect(migrateLegacyTemplateToPreset('{n}')).toBe('global')
  })
  it('MIG-2: {chapter}.{n} -> chapter-dot', () => {
    expect(migrateLegacyTemplateToPreset('{chapter}.{n}')).toBe('chapter-dot')
  })
  it('MIG-3: {chapter}.{section}.{n} -> section-dot', () => {
    expect(migrateLegacyTemplateToPreset('{chapter}.{section}.{n}')).toBe('section-dot')
  })
  it('MIG-4: {chapter}-{n} -> chapter-dash', () => {
    expect(migrateLegacyTemplateToPreset('{chapter}-{n}')).toBe('chapter-dash')
  })
  it('MIG-5: {chapter}.{section}-{n} -> section-dash', () => {
    expect(migrateLegacyTemplateToPreset('{chapter}.{section}-{n}')).toBe('section-dash')
  })
  it('MIG-6: unknown template -> legacy-custom', () => {
    expect(migrateLegacyTemplateToPreset('{chapter}-{section}-{n}')).toBe('legacy-custom')
    expect(migrateLegacyTemplateToPreset('{chapter}.{n}.{section}')).toBe('legacy-custom')
    expect(migrateLegacyTemplateToPreset('')).toBe('legacy-custom')
    expect(migrateLegacyTemplateToPreset(undefined)).toBe('legacy-custom')
  })
})

describe('normalizeObjectNumberingConfig — idempotency + preservation', () => {
  it('MIG-7: migration is idempotent', () => {
    const legacy = { template: '{chapter}.{section}-{n}', startAt: 3, minDigits: 2 }
    const once = normalizeObjectNumberingConfig(legacy)
    const twice = normalizeObjectNumberingConfig(once)
    expect(twice).toEqual(once)
    expect(once.preset).toBe('section-dash')

    const custom = { template: '{chapter}/{section}/{n}', numberingMode: 'reset-h2' }
    const cOnce = normalizeObjectNumberingConfig(custom)
    const cTwice = normalizeObjectNumberingConfig(cOnce)
    expect(cTwice).toEqual(cOnce)
  })

  it('MIG-8: unknown legacy fields are preserved (not destroyed)', () => {
    const legacy = { template: '{chapter}-{section}-{n}', numberingMode: 'reset-h2', customFlag: 'keep-me' }
    const norm = normalizeObjectNumberingConfig(legacy)
    expect(norm.preset).toBe('legacy-custom')
    expect(norm.legacyPayload).toEqual(legacy)
    expect(norm.legacyCustomTemplate).toBe('{chapter}-{section}-{n}')
  })

  it('non-numbering fields are not part of the normalized number config', () => {
    const norm = normalizeObjectNumberingConfig({ template: '{n}', enabled: true })
    expect(norm).toEqual({ enabled: true, preset: 'global', startNumber: 1, minDigits: 1 })
  })
})

describe('five public presets contract', () => {
  it('has exactly five public presets with semantic scopes and no H-level names', () => {
    const ids = PUBLIC_PRESET_DESCRIPTORS.map(d => d.id)
    expect(ids).toEqual(['global', 'chapter-dot', 'section-dot', 'chapter-dash', 'section-dash'])
    for (const d of PUBLIC_PRESET_DESCRIPTORS) {
      expect(d.label).toBeTruthy()
      expect(['global', 'chapter', 'section']).toContain(d.scope)
      expect(['dot', 'dash']).toContain(d.style)
      expect(d.template).toBeTruthy()
      expect(d.preview.length).toBeGreaterThan(0)
    }
  })

  it('no public preset label references physical H levels', () => {
    const labels = PUBLIC_PRESET_DESCRIPTORS.map(d => d.label).join(' ')
    expect(labels).not.toMatch(/H1|H2|H3|reset-h/)
  })

  it('raw number examples match the canonical formatter', () => {
    expect(formatPresetNumber('global', null, null, 3)).toBe('3')
    expect(formatPresetNumber('chapter-dot', 2, null, 3)).toBe('2.3')
    expect(formatPresetNumber('section-dot', 2, 1, 3)).toBe('2.1.3')
    expect(formatPresetNumber('chapter-dash', 2, null, 3)).toBe('2-3')
    expect(formatPresetNumber('section-dash', 2, 1, 3)).toBe('2.1-3')
  })
})

describe('startNumber / minDigits contract', () => {
  it('startNumber offsets {n} only', () => {
    expect(formatPresetNumber('global', null, null, 1, 3)).toBe('3')
    expect(formatPresetNumber('chapter-dash', 2, null, 1, 3)).toBe('2-3')
    expect(formatPresetNumber('section-dash', 2, 1, 1, 3)).toBe('2.1-3')
  })

  it('minDigits pads {n} only, never Chapter/Section', () => {
    expect(formatPresetNumber('section-dash', 2, 1, 3, 1, 2)).toBe('2.1-03')
    expect(formatPresetNumber('section-dash', 2, 1, 1, 1, 3)).toBe('2.1-001')
  })
})

describe('preview shared formatter (raw number + wrapper separation)', () => {
  it('SECTION_DASH with chapter=2, section=1, ordinal=3', () => {
    expect(buildPresetPreview('section-dash', 'figure', { chapter: 2, section: 1, ordinal: 3 })).toBe('图 2.1-3')
    expect(buildPresetPreview('section-dash', 'table', { chapter: 2, section: 1, ordinal: 3 })).toBe('表 2.1-3')
    expect(buildPresetPreview('section-dash', 'formula', { chapter: 2, section: 1, ordinal: 3 })).toBe('(2.1-3)')
    expect(buildPresetPreview('section-dash', 'code', { chapter: 2, section: 1, ordinal: 3 })).toBe('代码 2.1-3')
  })

  it('raw number is separate from wrapper', () => {
    const raw = formatPresetNumber('section-dash', 2, 1, 3)
    expect(raw).toBe('2.1-3')
    expect(buildPresetPreview('section-dash', 'figure', { chapter: 2, section: 1, ordinal: 3 })).toBe(`图 ${raw}`)
  })
})

describe('per-kind independent configuration', () => {
  it('each kind can select a different preset without overwriting others', () => {
    const figure = normalizeObjectNumberingConfig({ template: '{chapter}.{section}-{n}' })
    const table = normalizeObjectNumberingConfig({ template: '{chapter}.{n}' })
    const formula = normalizeObjectNumberingConfig({ template: '{n}' })
    const code = normalizeObjectNumberingConfig({ template: '{chapter}.{section}.{n}' })

    expect(figure.preset).toBe('section-dash')
    expect(table.preset).toBe('chapter-dot')
    expect(formula.preset).toBe('global')
    expect(code.preset).toBe('section-dot')
  })
})

describe('Strict/Loose structure mode descriptions', () => {
  it('strict describes H1 title / H2 chapter / H3 section', () => {
    expect(structureModeDescription('strict')).toContain('H1 文档题目')
    expect(structureModeDescription('strict')).toContain('H2 章')
    expect(structureModeDescription('strict')).toContain('H3 节')
  })

  it('loose describes branch-local semantic path (no H-level claim)', () => {
    const loose = structureModeDescription('loose')
    expect(loose).toContain('有效标题路径')
    expect(loose).not.toMatch(/按 H[123]/)
  })
})
