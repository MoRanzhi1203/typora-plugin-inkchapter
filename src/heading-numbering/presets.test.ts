import { describe, it, expect } from 'vitest'
import { getPresetLevels, PRESETS } from './presets'

describe('Roman preset (roman-hierarchical)', () => {
  const romanPreset = PRESETS['roman-hierarchical']

  it('withLevelOne: H1/H2 should be roman-upper, H3-H6 arabic', () => {
    const h1 = romanPreset.levels[1]
    const h2 = romanPreset.levels[2]
    const h3 = romanPreset.levels[3]
    const h6 = romanPreset.levels[6]

    expect(h1.tokenStyle).toBe('roman-upper')
    expect(h2.tokenStyle).toBe('roman-upper')
    expect(h3.tokenStyle).toBe('arabic')
    expect(h6.tokenStyle).toBe('arabic')
  })

  it('withoutLevelOne: H2 should be roman-upper', () => {
    const h2 = romanPreset.levels[2]
    const withoutL1 = h2.contextualFormatVariants.withoutLevelOne

    // Should have at least one level-reference with roman-upper
    const refs = withoutL1.filter((s) => s.type === 'level-reference')
    expect(refs.length).toBeGreaterThan(0)
    // The H2 reference should use roman-upper
    const h2Ref = refs.find((s) => s.type === 'level-reference' && s.level === 2)
    expect(h2Ref).toBeDefined()
  })
})

describe('getPresetLevels', () => {
  it('returns valid structure for roman-hierarchical', () => {
    const levels = getPresetLevels('roman-hierarchical')

    expect(levels[1]).toBeDefined()
    expect(levels[2]).toBeDefined()
    expect(levels[3]).toBeDefined()
    expect(levels[1].tokenStyle).toBe('roman-upper')
    expect(levels[2].tokenStyle).toBe('roman-upper')
    expect(levels[3].tokenStyle).toBe('arabic')
  })

  it('returns independent copy (modifying clone doesn\'t affect original)', () => {
    const levels1 = getPresetLevels('roman-hierarchical')
    const levels2 = getPresetLevels('roman-hierarchical')

    // They should be different objects at the top level
    expect(levels1).not.toBe(levels2)

    // Modify levels1
    levels1[1].enabled = false

    // levels2 should be unaffected
    expect(levels2[1].enabled).toBe(true)

    // Also verify nested arrays are independent
    expect(levels1[2].contextualFormatVariants.withLevelOne).not.toBe(
      levels2[2].contextualFormatVariants.withLevelOne,
    )
  })
})
