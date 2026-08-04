import { describe, it, expect } from 'vitest'
import { getPresetLevels, PRESETS } from './presets'

describe('Roman preset (roman-hierarchical)', () => {
  const romanPreset = PRESETS['roman-hierarchical']

  it('ALL levels H1-H6 should use roman-upper', () => {
    for (const lv of [1, 2, 3, 4, 5, 6] as const) {
      expect(romanPreset.levels[lv].tokenStyle).toBe('roman-upper')
    }
  })

  it('withLevelOne: all level-refs should use roman-upper', () => {
    const h4 = romanPreset.levels[4]
    const withL1 = h4.contextualFormatVariants.withLevelOne
    const refs = withL1.filter((s) => s.type === 'level-reference')
    expect(refs.length).toBe(4)  // H1, H2, H3, H4
    for (const ref of refs) {
      if (ref.type === 'level-reference') {
        expect(ref.appearance.tokenStyle).toBe('roman-upper')
      }
    }
  })

  it('withoutLevelOne: H2-H6 should all use roman-upper', () => {
    const h6 = romanPreset.levels[6]
    const withoutL1 = h6.contextualFormatVariants.withoutLevelOne
    const refs = withoutL1.filter((s) => s.type === 'level-reference')
    expect(refs.length).toBe(5)  // H2, H3, H4, H5, H6 — no H1
    for (const ref of refs) {
      if (ref.type === 'level-reference') {
        expect(ref.appearance.tokenStyle).toBe('roman-upper')
      }
    }
  })

  it('H1 off: H2 shows I, H3 shows I.I', () => {
    const h2 = romanPreset.levels[2]
    const h3 = romanPreset.levels[3]
    // withoutLevelOne should not include H1
    expect(h2.contextualFormatVariants.withoutLevelOne.length).toBe(1)
    // In suffix-based model: [ref(2, suffix='.'), ref(3)] = 2 segments (separator moved to suffix)
    expect(h3.contextualFormatVariants.withoutLevelOne.length).toBe(2)
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
    expect(levels[3].tokenStyle).toBe('roman-upper')
    expect(levels[4].tokenStyle).toBe('roman-upper')
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
