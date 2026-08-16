import { describe, it, expect } from 'vitest'
import {
  migrateObjectNumberingSettings,
  migrateObjectNumberingConfig,
  defaultObjectNumberingSettings,
  OBJECT_NUMBERING_SCHEMA_VERSION,
} from './object-numbering-settings'

describe('migrateObjectNumberingConfig', () => {
  it('maps legacy continuous caption config into V2', () => {
    const cfg = migrateObjectNumberingConfig('table', { enabled: true, position: 'above', prefix: '表', numbering: 'continuous' })
    expect(cfg.enabled).toBe(true)
    expect(cfg.prefix).toBe('表')
    expect(cfg.position).toBe('above')
    expect(cfg.numberingMode).toBe('continuous')
    expect(cfg.numberStyle).toBe('arabic')
    expect(cfg.startAt).toBe(1)
    expect(cfg.minDigits).toBe(1)
    expect(cfg.template).toBe('{n}')
  })

  it('preserves V2 overrides', () => {
    const cfg = migrateObjectNumberingConfig('figure', {
      numberingMode: 'chapter-linked', numberStyle: 'chinese', startAt: 3, minDigits: 2, template: '{chapter}-{n}',
    })
    expect(cfg.numberingMode).toBe('chapter-linked')
    expect(cfg.numberStyle).toBe('chinese')
    expect(cfg.startAt).toBe(3)
    expect(cfg.minDigits).toBe(2)
    expect(cfg.template).toBe('{chapter}-{n}')
  })

  it('clamps minDigits and rejects negative startAt', () => {
    expect(migrateObjectNumberingConfig('code', { minDigits: 99 }).minDigits).toBe(6)
    expect(migrateObjectNumberingConfig('code', { startAt: -5 }).startAt).toBe(1)
  })

  it('formula defaults to typora-native and disabled', () => {
    const cfg = migrateObjectNumberingConfig('formula', undefined)
    expect(cfg.enabled).toBe(false)
    expect(cfg.formulaMode).toBe('typora-native')
  })
})

describe('migrateObjectNumberingSettings', () => {
  it('migrates a legacy settings object into V2', () => {
    const migrated = migrateObjectNumberingSettings({
      types: {
        table: { enabled: true, position: 'above', prefix: '表', numbering: 'continuous' },
        figure: { enabled: true, position: 'below', prefix: '图', numbering: 'continuous' },
        code: { enabled: true, position: 'above', prefix: '代码', numbering: 'continuous' },
      },
    })
    expect(migrated.schemaVersion).toBe(OBJECT_NUMBERING_SCHEMA_VERSION)
    expect(migrated.types.table.template).toBe('{n}')
    expect(migrated.types.figure.numberStyle).toBe('arabic')
    expect(migrated.types.formula.enabled).toBe(false)
    expect(migrated.types.formula.formulaMode).toBe('typora-native')
  })

  it('is idempotent', () => {
    const once = migrateObjectNumberingSettings(undefined)
    const twice = migrateObjectNumberingSettings(once)
    expect(twice).toEqual(once)
  })

  it('empty input yields defaults', () => {
    const d = defaultObjectNumberingSettings()
    const migrated = migrateObjectNumberingSettings({})
    expect(migrated.types.table.prefix).toBe(d.types.table.prefix)
    expect(migrated.types.figure.prefix).toBe(d.types.figure.prefix)
    expect(migrated.types.code.prefix).toBe(d.types.code.prefix)
  })

  it('legacy caption config migrates with no undefined/NaN in UI fields', () => {
    const migrated = migrateObjectNumberingSettings({
      types: {
        table: { enabled: true, position: 'above', prefix: '表', numbering: 'continuous' },
        figure: { enabled: true, position: 'below', prefix: '图', numbering: 'continuous' },
        code: { enabled: true, position: 'above', prefix: '代码', numbering: 'continuous' },
      },
    })
    for (const type of ['table', 'figure', 'code', 'formula'] as const) {
      const c = migrated.types[type]
      expect(typeof c.enabled).toBe('boolean')
      expect(typeof c.prefix).toBe('string')
      expect(['above', 'below', 'left', 'right']).toContain(c.position)
      expect(c.numberingMode).toBeDefined()
      expect(c.numberStyle).toBeDefined()
      expect(Number.isFinite(c.startAt)).toBe(true)
      expect(Number.isFinite(c.minDigits)).toBe(true)
      expect(typeof c.template).toBe('string')
      expect(c.template).toContain('{n}')
    }
  })
})
