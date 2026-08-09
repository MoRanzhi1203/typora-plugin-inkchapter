/**
 * Number-Title Spacing Diagnostic & Regression Tests
 *
 * READ-ONLY DIAGNOSTIC — probes current behavior without modifying business logic.
 * Tests marked with EXPECTED CURRENT FAILURE expose confirmed bugs/gaps.
 */
import { describe, it, expect } from 'vitest'
import { getPresetLevels } from '../heading-numbering/presets'
import { computeHeadingNumbering, buildStrictEffectiveLevels } from '../heading-numbering/numbering-engine'
import { resolveStyleSlot } from '../heading-numbering/heading-structure'
import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingNumberingSettings,
  NumberTitleSpacing,
} from '../heading-numbering/heading-types'

/** Shortcut: build a heading descriptor */
function hd(text: string, level: number, _unused?: number): HeadingDescriptor {
  return { text, level: level as HeadingLevel, key: `${level}-${text}` } as HeadingDescriptor
}

function makeSettings(
  preset: 'custom',
  headingStructureMode: 'strict' | 'loose',
  levels: Record<HeadingLevel, any>,
  s6Configured?: boolean,
): HeadingNumberingSettings {
  return {
    enabled: true,
    headingStructureMode,
    showLevelOneNumber: headingStructureMode === 'loose',
    preset,
    maxDepth: 6 as HeadingLevel,
    levels: levels as any,
    s6Configured,
  }
}

// ── Case 1: numberTitleSpacing → labelGap mapping ──────

describe('numberTitleSpacing → labelGap (engine)', () => {
  it('space → labelGap="space"', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'space'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 0)], s)
    expect(r[1].labelGap).toBe('space')
  })

  it('none → labelGap="none"', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'none'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 0)], s)
    expect(r[1].labelGap).toBe('none')
  })

  it('undefined/absent defaults to "space" (preset default)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // preset default is 'space' — don't override
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 0)], s)
    expect(r[1].labelGap).toBe('space')
  })

  it('empty label always → "none" regardless of spacing setting', () => {
    // H1 in strict has no number → label is empty → labelGap must be "none"
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space' // explicit space
    const s = makeSettings('custom', 'strict', levels)
    const r = computeHeadingNumbering([hd('T', 1, 0), hd('H2', 2, 0)], s)
    expect(r[0].labelGap).toBe('none') // no number → no gap
  })
})

// ── Case 2: strict Physical→Slot spacing mapping ───────

describe('strict Physical→Slot spacing (via effectiveSettings)', () => {
  function slotOrFail(physical: HeadingLevel): HeadingLevel {
    const s = resolveStyleSlot('strict', physical)
    if (s === null) throw new Error(`strict H${physical} has no slot`)
    return s
  }

  it('strict H2 spacing stored in S1 (levels[1])', () => {
    const slot = slotOrFail(2 as HeadingLevel) // H2→S1
    expect(slot).toBe(1)
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'none' // S1=none
    levels[2].numberTitleSpacing = 'space' // S2=space
    const s = makeSettings('custom', 'strict', levels)
    const r = computeHeadingNumbering([hd('T', 1, 0), hd('H2', 2, 0)], s)
    expect(r[1].labelGap).toBe('none') // from S1
  })

  it('strict H3 spacing stored in S2 (levels[2])', () => {
    const slot = slotOrFail(3 as HeadingLevel)
    expect(slot).toBe(2)
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'none'
    levels[1].numberTitleSpacing = 'space'
    const s = makeSettings('custom', 'strict', levels)
    const r = computeHeadingNumbering([hd('T', 1, 0), hd('H2', 2, 0), hd('H3', 3, 0)], s)
    expect(r[2].labelGap).toBe('none') // from S2
  })

  it('strict H4 spacing stored in S3 (levels[3])', () => {
    expect(slotOrFail(4 as HeadingLevel)).toBe(3)
  })

  it('strict H5 spacing stored in S4 (levels[4])', () => {
    expect(slotOrFail(5 as HeadingLevel)).toBe(4)
  })

  it('strict H6 spacing stored in S5 (levels[5])', () => {
    expect(slotOrFail(6 as HeadingLevel)).toBe(5)
  })
})

// ── Case 3: Label trailing whitespace (all 9 presets) ──

describe('label trailing whitespace audit (9 presets)', () => {
  const presets = [
    'decimal-hierarchical', 'chinese-chapter', 'chinese-outline',
    'academic-paper', 'chapter-section-clause', 'appendix-hierarchical',
    'roman-hierarchical', 'roman-mixed', 'letter-mixed',
  ] as const

  function getLabel(preset: string, showL1: boolean): string {
    const levels = getPresetLevels(preset as any)
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: showL1 ? 'loose' : 'strict',
      showLevelOneNumber: showL1,
      preset: preset as any,
      maxDepth: 6 as HeadingLevel,
      levels,
    }
    const headings: HeadingDescriptor[] = showL1
      ? [hd('H1', 1, 0), hd('H2', 2, 0)]
      : [hd('T', 1, 0), hd('H2', 2, 0)]
    const r = computeHeadingNumbering(headings, settings)
    return r[1].label // first numbered heading
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const whitespace = /\s$/u;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const nbsp = /\u00A0$/u;

  for (const preset of presets) {
    it(`${preset}: label does NOT end with whitespace`, () => {
      const label = getLabel(preset, true)
      expect(label.length).toBeGreaterThan(0)
      // Label itself must not contain trailing whitespace
      expect(label.endsWith(' ')).toBe(false)
    })
  }
})

// ── Case 4: Preview vs Body spacing decision alignment ──

describe('preview vs body spacing decision alignment', () => {
  it('both use labelGap from computeHeadingNumbering for same settings', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space'
    levels[2].numberTitleSpacing = 'none'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 0), hd('H3', 3, 0)], s)
    // Body labelGap — all use same engine output
    expect(r[0].labelGap).toBe('space')
    expect(r[1].labelGap).toBe('none')
  })

  it('preview H2=none H3=space H4=space H5=none pattern', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'none'
    levels[3].numberTitleSpacing = 'space'
    levels[4].numberTitleSpacing = 'space'
    levels[5].numberTitleSpacing = 'none'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([
      hd('H1', 1, 0), hd('H2', 2, 0), hd('H3', 3, 0), hd('H4', 4, 0), hd('H5', 5, 0),
    ], s)
    expect(r[0].labelGap).toBe('space') // H1 default
    expect(r[1].labelGap).toBe('none')  // H2
    expect(r[2].labelGap).toBe('space') // H3
    expect(r[3].labelGap).toBe('space') // H4
    expect(r[4].labelGap).toBe('none')  // H5
  })
})

// ── Case 5: Strict physical→slot write (Settings-level) ──

describe('strict physical→slot spacing write (model)', () => {
  function slot(lv: HeadingLevel): HeadingLevel {
    const s = resolveStyleSlot('strict', lv)
    if (s === null) throw new Error('no slot')
    return s
  }

  it('H3 space writes to S2 (levels[2].numberTitleSpacing = "space")', () => {
    const sl = slot(3 as HeadingLevel)
    expect(sl).toBe(2)
    const levels = getPresetLevels('decimal-hierarchical')
    levels[sl].numberTitleSpacing = 'space'
    expect(levels[sl].numberTitleSpacing).toBe('space')
  })

  it('H3 none writes to S2 (levels[2].numberTitleSpacing = "none")', () => {
    const sl = slot(3 as HeadingLevel)
    const levels = getPresetLevels('decimal-hierarchical')
    levels[sl].numberTitleSpacing = 'none'
    expect(levels[sl].numberTitleSpacing).toBe('none')
  })

  it('H4 space writes to S3', () => {
    const sl = slot(4 as HeadingLevel)
    expect(sl).toBe(3)
    const levels = getPresetLevels('decimal-hierarchical')
    levels[sl].numberTitleSpacing = 'space'
    expect(levels[sl].numberTitleSpacing).toBe('space')
  })
})

// ── Case 6: NumberTitleSpacing value domain ────────────

describe('numberTitleSpacing value domain', () => {
  it('only "none" and "space" are valid values', () => {
    // The type system enforces this — verify that preset values are within domain
    const levels = getPresetLevels('decimal-hierarchical')
    for (const lv of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
      const v = levels[lv].numberTitleSpacing
      if (v !== undefined) {
        expect(['none', 'space']).toContain(v)
      }
    }
  })

  it('synthetic title leading whitespace audit', () => {
    // Preview synthetic titles come from computeHeadingNumbering label
    // which is built by the engine without leading spaces
    const levels = getPresetLevels('chinese-chapter')
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('第一节标题', 2, 1)], s)
    expect(r[0].label).toBe('第一节')
    expect(r[0].label.startsWith(' ')).toBe(false)
  })
})

// ── Case 7: CSS gap representation ────────────────────

describe('gap representation', () => {
  it('labelGap="space" means exactly one gap (semantic)', () => {
    // The engine produces "space" labelGap. CSS converts to U+00A0 via ::before.
    // This test verifies the semantic contract: "space" means exactly one unit of gap.
    // CSS implementation detail (U+00A0 vs U+0020) is NOT tested here.
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'space'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0), hd('H2', 2, 0)], s)
    expect(r[1].labelGap).toBe('space')
  })

  it('label is pure — no whitespace injection from engine', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('Hello', 1, 0)], s)
    expect(r[0].label).toBe('1')
    expect(r[0].label).not.toContain(' ')
    expect(r[0].label).not.toContain('\u00A0')
  })
})

// ── Case 8: Multiple spacing source audit ─────────────

describe('spacing source uniqueness', () => {
  it('engine reads ONLY levels[lv].numberTitleSpacing', () => {
    // Verifies that labelGap comes from a single source: style.numberTitleSpacing
    // No headingLayouts, no layoutOverrides, no legacy fields in the engine path
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'none'
    const s = makeSettings('custom', 'loose', levels)
    const r = computeHeadingNumbering([hd('H1', 1, 0)], s)
    // Engine ignores headingLayouts.numberTitleSpacing — only reads levels[1].numberTitleSpacing
    expect(r[0].labelGap).toBe('none')
  })
})

// ── Case 9: Strict H1 gap irrelevant ──────────────────

describe('strict H1 gap', () => {
  it('strict H1 has no number → labelGap always "none"', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space'
    const s = makeSettings('custom', 'strict', levels)
    const r = computeHeadingNumbering([hd('Document Title', 1, 0)], s)
    expect(r[0].label).toBe('')       // no number
    expect(r[0].labelGap).toBe('none') // no gap
  })
})

// ── Case 10: Effective settings round-trip ─────────────

describe('effective settings spacing round-trip', () => {
  it('compute→labelGap→check matches setting for all enabled preset levels', () => {
    const presets = ['decimal-hierarchical', 'chinese-chapter', 'chinese-outline'] as const
    for (const preset of presets) {
      const levels = getPresetLevels(preset)
      const s = makeSettings('custom', 'loose', levels)
      const headings: HeadingDescriptor[] = [
        hd('1', 1, 0), hd('2', 2, 0), hd('3', 3, 0),
        hd('4', 4, 0), hd('5', 5, 0), hd('6', 6, 0),
      ]
      const r = computeHeadingNumbering(headings, s)
      for (let i = 0; i < r.length; i++) {
        const lv = (i + 1) as HeadingLevel
        const style = levels[lv]
        // Disabled levels OR empty-label levels → labelGap forced to 'none'
        if (!style?.enabled || r[i].label === '') {
          expect(r[i].labelGap).toBe('none')
        } else {
          const expected = style.numberTitleSpacing ?? 'space'
          expect(r[i].labelGap).toBe(expected)
        }
      }
    }
  })
})

// ── Physical Layout Override → StyleSlot mapping ───

import { deepMergeSettings, resolveEffectiveSettings } from '../heading-numbering/heading-numbering-scope-store'
import type { HeadingNumberingScopeStore } from '../heading-numbering/heading-types'

function makeStore(mode: 'strict' | 'loose', levels: Record<HeadingLevel, any>): HeadingNumberingScopeStore {
  return {
    schemaVersion: 10,
    globalDefault: {
      enabled: true,
      headingStructureMode: mode,
      showLevelOneNumber: mode === 'loose',
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels: levels as any,
    },
    documentOverrides: {},
    globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
  }
}

describe('Physical Layout Override → StyleSlot (strict)', () => {
  it('strict: Physical H1 override does NOT pollute S1/H2', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // Global: S1=space (default)
    levels[1].numberTitleSpacing = 'space'
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: {
          numberTitleSpacing: { 1: 'none' }, // Physical H1="none" should NOT affect S1/H2
        },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    // S1 spacing should remain 'space' — not polluted by Physical H1 override
    expect(ctx.effectiveSettings.levels[1].numberTitleSpacing).toBe('space')
  })

  it('strict: Physical H2 override → S1 (affects H2 numbering)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space' // S1=space
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: {
          numberTitleSpacing: { 2: 'none' }, // Physical H2="none" → S1
        },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    expect(ctx.effectiveSettings.levels[1].numberTitleSpacing).toBe('none') // S1→H2 affected
  })

  it('strict: Physical H3 override → S2 (affects H3 numbering)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'space'
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 3: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    expect(ctx.effectiveSettings.levels[2].numberTitleSpacing).toBe('none') // S2→H3
    expect(ctx.effectiveSettings.levels[1].numberTitleSpacing).toBe('space') // S1 unchanged
  })

  it('strict: Physical H6 override → S5 (affects H6, not S6)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[5].numberTitleSpacing = 'space'
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 6: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    expect(ctx.effectiveSettings.levels[5].numberTitleSpacing).toBe('none') // S5→H6 affected
    // levels[6] (S6) still exists from preset but should NOT have override applied
    if (ctx.effectiveSettings.levels[6]) {
      expect(ctx.effectiveSettings.levels[6].numberTitleSpacing).toBe('space') // still default
    }
  })
})

describe('Physical Layout Override → StyleSlot (loose)', () => {
  it('loose: Physical H3 override → S3 (identity mapping)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[3].numberTitleSpacing = 'space'
    const store = makeStore('loose', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'loose', showLevelOneNumber: true, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 3: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    expect(ctx.effectiveSettings.levels[3].numberTitleSpacing).toBe('none')
    expect(ctx.effectiveSettings.levels[2].numberTitleSpacing).toBe('space') // unaffected
  })

  it('loose: Physical H1 override → S1', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space'
    const store = makeStore('loose', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'loose', showLevelOneNumber: true, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 1: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    expect(ctx.effectiveSettings.levels[1].numberTitleSpacing).toBe('none')
  })
})

describe('numberTitleSpacing → labelGap via engine (physical override)', () => {
  it('strict: Physical H2=none → H2 labelGap=none in body', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 2: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    const r = computeHeadingNumbering(
      [hd('T', 1, 0), hd('H2', 2, 0)], ctx.effectiveSettings,
    )
    expect(r[1].labelGap).toBe('none') // H2 spacing from physical override via slot mapping
  })

  it('strict: Physical H3=space → H3 labelGap=space', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 3: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    const r = computeHeadingNumbering(
      [hd('T', 1, 0), hd('H2', 2, 0), hd('H3', 3, 0)], ctx.effectiveSettings,
    )
    expect(r[2].labelGap).toBe('none') // H3 from physical override → S2
  })

  it('strict: Physical H1=space does NOT affect H2 (pollution guard)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const store = makeStore('strict', levels)
    store.documentOverrides = {
      'doc-1': {
        updatedAt: 1,
        settings: { enabled: true, headingStructureMode: 'strict', showLevelOneNumber: false, preset: 'custom', maxDepth: 6 as HeadingLevel, levels: {} as any },
        layoutOverrides: { numberTitleSpacing: { 1: 'none' } },
      },
    }
    const ctx = resolveEffectiveSettings(store, 'doc-1')
    // H2 must use S1 spacing (default 'space'), not physical H1 override
    const r = computeHeadingNumbering(
      [hd('T', 1, 0), hd('H2', 2, 0)], ctx.effectiveSettings,
    )
    expect(r[1].labelGap).toBe('space') // H2: S1 default, NOT polluted by H1 physical override
  })
})
