import { describe, it, expect } from 'vitest'
import { isObjectNumberingPreset, isStandardNumberingPreset } from './numbering-preset-formatter'
import { buildPresetPreview, migrateLegacyTemplateToPreset, normalizeObjectNumberingConfig } from './object-numbering-presets'
import { migrateObjectNumberingConfig } from './object-numbering-settings'

describe('PRESET_VALIDATOR', () => {
  it('VALID-1: every valid id is accepted', () => {
    for (const id of ['global', 'chapter-dot', 'section-dot', 'chapter-dash', 'section-dash', 'legacy-custom']) {
      expect(isObjectNumberingPreset(id)).toBe(true)
    }
  })

  it('isStandardNumberingPreset excludes legacy-custom', () => {
    expect(isStandardNumberingPreset('global')).toBe(true)
    expect(isStandardNumberingPreset('section-dash')).toBe(true)
    expect(isStandardNumberingPreset('legacy-custom')).toBe(false)
  })

  it('VALID-2: invalid values are rejected', () => {
    for (const bad of ['banana', 'reset-h2', 'GLOBAL', '', null, undefined, 123]) {
      expect(isObjectNumberingPreset(bad)).toBe(false)
    }
  })

  it('VALID-3: invalid persisted preset + exact template -> fallback template migration', () => {
    const migrated = migrateObjectNumberingConfig('figure', { preset: 'banana', template: '{chapter}.{section}-{n}' })
    expect(migrated.preset).toBe('section-dash')
  })

  it('VALID-4: invalid preset + unknown template -> legacy-custom', () => {
    const migrated = migrateObjectNumberingConfig('figure', { preset: 'banana', template: '{chapter}/{section}/{n}' })
    expect(migrated.preset).toBe('legacy-custom')
  })

  it('valid preset wins over legacy compatibility fields', () => {
    const migrated = migrateObjectNumberingConfig('figure', { preset: 'section-dash', template: '{n}', numberingMode: 'continuous' })
    expect(migrated.preset).toBe('section-dash')
  })
})

describe('FORMULA legacy wrapper migration', () => {
  it('FORM-MIG-1: ({n}) -> global', () => {
    expect(migrateLegacyTemplateToPreset('({n})', 'formula')).toBe('global')
    expect(migrateObjectNumberingConfig('formula', { template: '({n})' }).preset).toBe('global')
  })
  it('FORM-MIG-2: ({chapter}.{n}) -> chapter-dot', () => {
    expect(migrateLegacyTemplateToPreset('({chapter}.{n})', 'formula')).toBe('chapter-dot')
  })
  it('FORM-MIG-3: ({chapter}.{section}.{n}) -> section-dot', () => {
    expect(migrateLegacyTemplateToPreset('({chapter}.{section}.{n})', 'formula')).toBe('section-dot')
  })
  it('FORM-MIG-4: ({chapter}-{n}) -> chapter-dash', () => {
    expect(migrateLegacyTemplateToPreset('({chapter}-{n})', 'formula')).toBe('chapter-dash')
  })
  it('FORM-MIG-5: ({chapter}.{section}-{n}) -> section-dash', () => {
    expect(migrateLegacyTemplateToPreset('({chapter}.{section}-{n})', 'formula')).toBe('section-dash')
  })
  it('FORM-MIG-6: non-exact formula template -> legacy-custom', () => {
    expect(migrateLegacyTemplateToPreset('({chapter}/{section}/{n})', 'formula')).toBe('legacy-custom')
    expect(migrateLegacyTemplateToPreset('({chapter}.{section}.{subsection}.{n})', 'formula')).toBe('legacy-custom')
  })
  it('FORM-MIG-7: standard formula preview keeps raw + wrapper separation', () => {
    expect(buildPresetPreview('global', 'formula', { chapter: 2, section: 1, ordinal: 3 })).toBe('(3)')
    expect(buildPresetPreview('section-dash', 'formula', { chapter: 2, section: 1, ordinal: 3 })).toBe('(2.1-3)')
  })
})

describe('standard preset vs legacy-custom template UI contract (config-level)', () => {
  it('standard preset: template is NOT the active authority (legacy template preserved)', () => {
    const migrated = migrateObjectNumberingConfig('figure', { preset: 'section-dash', template: '{n}' })
    expect(migrated.preset).toBe('section-dash')
    expect(migrated.template).toBe('{n}') // preserved compatibility data, but preset wins
  })

  it('legacy-custom: template drives behavior', () => {
    const migrated = migrateObjectNumberingConfig('figure', { template: '{chapter}/{section}/{n}' })
    expect(migrated.preset).toBe('legacy-custom')
    expect(migrated.template).toBe('{chapter}/{section}/{n}')
  })

  it('non-destructive switch: preset change does not erase legacy template', () => {
    const before = migrateObjectNumberingConfig('figure', { template: '{chapter}/{section}/{n}' })
    expect(before.preset).toBe('legacy-custom')
    const after = migrateObjectNumberingConfig('figure', { ...before, preset: 'section-dash' })
    expect(after.preset).toBe('section-dash')
    expect(after.template).toBe('{chapter}/{section}/{n}') // not erased
  })
})

describe('unknown legacy field policy (accurate reporting)', () => {
  it('PURE_NORMALIZER_UNKNOWN_PAYLOAD_PRESERVED = PASS', () => {
    const legacy = { template: '{chapter}/{section}/{n}', unknownField: 'x' }
    const once = normalizeObjectNumberingConfig(legacy)
    expect(once.preset).toBe('legacy-custom')
    expect(once.legacyPayload).toEqual(legacy)
  })

  it('REAL_PERSISTED_ARBITRARY_UNKNOWN_FIELDS = NOT_SUPPORTED_BY_TYPED_SCHEMA', () => {
    const migrated = migrateObjectNumberingConfig('figure', { template: '{chapter}/{section}/{n}', customExpression: 'x', unknownField: 'y' })
    // typed schema preserves known legacy fields (customExpression) but drops arbitrary unknown fields
    expect(migrated.customExpression).toBe('x')
    expect((migrated as unknown as Record<string, unknown>).unknownField).toBeUndefined()
  })
})
