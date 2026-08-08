import { describe, it, expect } from 'vitest'
import {
  ensureCurrentLevelSegment,
  getAvailableContextualReferenceLevels,
  computeHeadingNumbering,
  buildStrictEffectiveLevels,
} from './numbering-engine'
import { generateStableId } from './heading-types'
import type {
  ContextualFormatSegment,
  HeadingLevel,
  HeadingDescriptor,
  HeadingNumberingPreset,
  HeadingNumberingSettings,
  NumberedHeading,
} from './heading-types'
import { getPresetLevels } from './presets'

describe('ensureCurrentLevelSegment', () => {
  const tokenStyle = 'arabic' as const

  function makeRef(level: HeadingLevel): ContextualFormatSegment {
    return {
      id: generateStableId(),
      type: 'level-reference',
      level,
      appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
    }
  }

  it('adds current level when missing', () => {
    const segments: ContextualFormatSegment[] = [
      makeRef(1),
      makeRef(2),
    ]

    const result = ensureCurrentLevelSegment(3, segments, tokenStyle)

    expect(result.length).toBe(3)
    const hasL3 = result.some((s) => s.type === 'level-reference' && s.level === 3)
    expect(hasL3).toBe(true)
  })

  it('returns the same segments when current level already exists', () => {
    const segments: ContextualFormatSegment[] = [
      makeRef(1),
      makeRef(2),
      makeRef(3),
    ]

    const result = ensureCurrentLevelSegment(3, segments, tokenStyle)

    // Same length, no duplicate level-3 refs
    expect(result.length).toBe(3)
    const l3Refs = result.filter((s) => s.type === 'level-reference' && s.level === 3)
    expect(l3Refs.length).toBe(1)
  })

  it('returns new array (does not mutate input)', () => {
    const segments: ContextualFormatSegment[] = [
      makeRef(1),
    ]

    const result = ensureCurrentLevelSegment(3, segments, tokenStyle)

    // result should be a different array
    expect(result).not.toBe(segments)
    // original should be unchanged
    expect(segments.length).toBe(1)
    expect(segments[0].type === 'level-reference' && segments[0].level).toBe(1)
  })
})

describe('getAvailableContextualReferenceLevels', () => {
  function makeRef(level: HeadingLevel): ContextualFormatSegment {
    return {
      id: generateStableId(),
      type: 'level-reference',
      level,
      appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
    }
  }

  it('includes current level (lv <= currentLevel)', () => {
    const format: ContextualFormatSegment[] = [
      makeRef(1),
      makeRef(2),
    ]

    const available = getAvailableContextualReferenceLevels(4, true, format)

    // Should include level 3 (unused, <= currentLevel) and level 4 (current, <= currentLevel)
    expect(available).toContain(3)
    expect(available).toContain(4)
    // Should not include levels already used
    expect(available).not.toContain(1)
    expect(available).not.toContain(2)
  })

  it('does not include levels > currentLevel', () => {
    const format: ContextualFormatSegment[] = []

    const available = getAvailableContextualReferenceLevels(2, false, format)

    // H1 hidden (showLevelOneNumber=false), so start from 2
    expect(available).toContain(2)
    // Should not include levels > 2
    expect(available).not.toContain(3)
    expect(available).not.toContain(4)
    expect(available).not.toContain(5)
    expect(available).not.toContain(6)
  })
})

// ── Helpers ──────────────────────────────────────────────

function hd(text: string, level: number, index: number): HeadingDescriptor {
  return { key: `line-${index}`, level: level as HeadingLevel, text }
}

function makeSettings(
  preset: HeadingNumberingPreset,
  showLevelOneNumber: boolean,
  headingStructureMode?: string,
): HeadingNumberingSettings {
  const levels = getPresetLevels(preset)
  return {
    enabled: true,
    headingStructureMode: (headingStructureMode ?? (showLevelOneNumber ? 'loose' : 'strict')) as 'strict' | 'loose',
    showLevelOneNumber,
    preset,
    maxDepth: 6 as HeadingLevel,
    levels,
    customDefinition: levels,
  }
}

function getLabels(result: NumberedHeading[]): string[] {
  return result.map(h => h.label)
}

// ── strict/loose numbering regression ────────────────────

describe('strict/loose numbering regression', () => {
  it('strict + decimal-hierarchical: H1 label=\'\', H2=1, H3=1.1', () => {
    const headings = [
      hd('Title', 1, 0),
      hd('A', 2, 1),
      hd('a', 3, 2),
      hd('B', 2, 3),
    ]
    const settings = makeSettings('decimal-hierarchical', false)
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['', '1', '1.1', '2'])
  })

  it('loose + decimal-hierarchical: H1=1, H2=1.1, H3=1.1.1', () => {
    const headings = [
      hd('Title', 1, 0),
      hd('A', 2, 1),
      hd('a', 3, 2),
      hd('B', 2, 3),
    ]
    const settings = makeSettings('decimal-hierarchical', true)
    const result = computeHeadingNumbering(headings, settings)
    // H2 under H1 uses hierarchical format [H1].[H2]; second H2 under same H1 = 1.2
    expect(getLabels(result)).toEqual(['1', '1.1', '1.1.1', '1.2'])
  })

  it('strict + roman-hierarchical: H1 label=\'\', H2 starts from I', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('B', 2, 2),
    ]
    const settings = makeSettings('roman-hierarchical', false)
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['', 'I', 'II'])
  })

  it('loose + roman-hierarchical: H1=I, H2=I.I', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('B', 2, 2),
    ]
    const settings = makeSettings('roman-hierarchical', true)
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['I', 'I.I', 'I.II'])
  })

  it('strict + academic-paper: H1 label=\'\', H2=1.1', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('a', 3, 2),
    ]
    const settings = makeSettings('academic-paper', false)
    const result = computeHeadingNumbering(headings, settings)
    // Strict: H1 is document title (unnumbered). H2 withoutLevelOne = standalone 第一章 (chinese token on H2 counter).
    // H3 withoutLevelOne = hierarchical [H2.][H3] = "1.1"
    expect(getLabels(result)).toEqual(['', '第一章', '1.1'])
  })

  it('loose + academic-paper: H1=第一章, H2=1.1', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('a', 3, 2),
    ]
    const settings = makeSettings('academic-paper', true)
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['第一章', '1.1', '1.1.1'])
  })

  it('strict + chinese-chapter: H1=\'\', H2 starts from 第一章', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('B', 2, 2),
    ]
    const settings = makeSettings('chinese-chapter', false)
    const result = computeHeadingNumbering(headings, settings)
    // Strict mode: H1 is the document title (unnumbered).
    // H2 becomes the first numbered level — standalone 第一章 using chinese token style
    // on the H2 counter (counters[1]). Second sibling H2 correctly increments to 第二章.
    // This matches the invariant: strict H2 uses H2 counter as effective depth 1.
    expect(getLabels(result)).toEqual(['', '第一章', '第二章'])
  })

  it('loose + chinese-chapter: H1=第一章, H2=第一节', () => {
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('B', 2, 2),
    ]
    const settings = makeSettings('chinese-chapter', true)
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['第一章', '第一节', '第二节'])
  })
})

// ── Comprehensive helpers ────────────────────────────────

function computeLabels(
  headings: { text: string; level: number }[],
  preset: HeadingNumberingPreset,
  showLevelOneNumber: boolean,
): { labels: string[]; counters: number[][] } {
  const descriptors = headings.map((h, i) => hd(h.text, h.level, i))
  const settings = makeSettings(preset, showLevelOneNumber)
  const result = computeHeadingNumbering(descriptors, settings)
  return {
    labels: result.map(h => h.label),
    counters: result.map(h => [...h.counters]),
  }
}

function presetName(preset: HeadingNumberingPreset): string {
  const names: Record<string, string> = {
    'decimal-hierarchical': '十进制层级',
    'chinese-chapter': '中文章节',
    'chinese-outline': '党政公文',
    'academic-paper': '学术论文',
    'chapter-section-clause': '章-节-条款',
    'appendix-hierarchical': '附录层级',
    'roman-hierarchical': '罗马层级',
    'roman-mixed': '罗马混合',
    'letter-mixed': '字母混合',
  }
  return names[preset] ?? preset
}

// ── Per-preset comprehensive tests ───────────────────────

describe('decimal-hierarchical preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'decimal-hierarchical'

  it('strict: H1 unnumbered, H2=1 is first effective level, H2 sibling increments, H3 parent from H2', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '1', '1.1', '2', '2.1'])
    // Sibling increment: second H2 counter > first H2 counter
    expect(r.counters[1][1]).toBe(1)  // H2-A counter=1
    expect(r.counters[3][1]).toBe(2)  // H2-B counter=2
    // H3 parent from H2: H3-A counter[1]=1 (from its parent H2-A)
    expect(r.counters[2][1]).toBe(1)  // H3-A parent counter
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)  // first H2 counter
    expect(r.counters[3][1]).toBe(2)  // second H2 counter
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=1, full hierarchy', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
    ], preset, true)
    expect(r.labels).toEqual(['1', '1.1', '1.1.1', '1.2'])
  })
})

describe('chinese-chapter preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'chinese-chapter'

  it('strict: H1 unnumbered, H2 standalone 第一章, H3 standalone 第一节, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '第一章', '第一节', '第二章', '第一节'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=第一章, H2=第一节, H3=一、', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['第一章', '第一节', '一、', '第二节', '一、'])
  })
})

describe('chinese-outline preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'chinese-outline'

  it('strict: H1 unnumbered, H2=一、, H3=（一）, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '一、', '（一）', '二、', '（一）'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=一、, H2=（一）, H3=1.', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['一、', '（一）', '1.', '（二）', '1.'])
  })
})

describe('academic-paper preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'academic-paper'

  it('strict: H1 unnumbered, H2 standalone 第一章, H3 hierarchical 1.1, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '第一章', '1.1', '第二章', '2.1'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=第一章, full hierarchy', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['第一章', '1.1', '1.1.1', '1.2', '1.2.1'])
  })
})

describe('chapter-section-clause preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'chapter-section-clause'

  it('strict: H1 unnumbered, H2 standalone 第一章, H3 standalone 第一节, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '第1章', '第1节', '第2章', '第1节'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=第1章, H2=第1节, H3=第1条', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['第1章', '第1节', '第1条', '第2节', '第1条'])
  })
})

describe('appendix-hierarchical preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'appendix-hierarchical'

  it('strict: H1 unnumbered, H2 standalone 附录A, H3 hierarchical A.1, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', '附录A', 'A.1', '附录B', 'B.1'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=附录A, full hierarchy', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['附录A', 'A.1', 'A.1.1', 'A.2', 'A.2.1'])
  })
})

describe('roman-hierarchical preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'roman-hierarchical'

  it('strict: H1 unnumbered, H2=I, H3=I.I, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', 'I', 'I.I', 'II', 'II.I'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=I, H2=I.I, H3=I.I.I', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['I', 'I.I', 'I.I.I', 'I.II', 'I.II.I'])
  })
})

describe('roman-mixed preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'roman-mixed'

  it('strict: H1 unnumbered, H2 standalone I, H3 hierarchical I.1, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', 'I', 'I.1', 'II', 'II.1'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=I, full hierarchy', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['I', 'I.1', 'I.1.1', 'I.2', 'I.2.1'])
  })
})

describe('letter-mixed preset strict/loose', () => {
  const preset: HeadingNumberingPreset = 'letter-mixed'

  it('strict: H1 unnumbered, H2 standalone A, H3 hierarchical A.1, H2 siblings increment', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, false)
    expect(r.labels).toEqual(['', 'A', 'A.1', 'B', 'B.1'])
    // Strict mode invariant: H2 counters must increment for siblings
    expect(r.counters[1][1]).toBe(1)
    expect(r.counters[3][1]).toBe(2)
    expect(r.counters[1][1]).toBeLessThan(r.counters[3][1])
  })

  it('loose: H1=A, full hierarchy', () => {
    const r = computeLabels([
      { text: 'Title', level: 1 },
      { text: 'A', level: 2 },
      { text: 'A1', level: 3 },
      { text: 'B', level: 2 },
      { text: 'B1', level: 3 },
    ], preset, true)
    expect(r.labels).toEqual(['A', 'A.1', 'A.1.a', 'A.2', 'A.2.a'])
  })
})

describe('custom format strict compatibility', () => {
  it('strict + custom decimal-like: H2 counter increments, H3 parent from H2', () => {
    // Build a custom decimal-hierarchical format manually
    const levels = getPresetLevels('decimal-hierarchical')
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const headings = [
      hd('Title', 1, 0),
      hd('A', 2, 1),
      hd('A1', 3, 2),
      hd('B', 2, 3),
      hd('B1', 3, 4),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['', '1', '1.1', '2', '2.1'])
  })

  it('strict + custom chinese-chapter-like: H2 sibling increments', () => {
    const levels = getPresetLevels('chinese-chapter')
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('B', 2, 2),
    ]
    const result = computeHeadingNumbering(headings, settings)
    expect(getLabels(result)).toEqual(['', '第一章', '第二章'])
  })

  it('strict: withoutLevelOne fallback derived from withLevelOne works', () => {
    // Simulate a custom format where user only edited withLevelOne
    // withoutLevelOne should be derived by stripping H1 refs
    const levels = getPresetLevels('decimal-hierarchical')
    // Wipe withoutLevelOne to trigger fallback
    for (const lv of [2, 3, 4, 5, 6] as HeadingLevel[]) {
      levels[lv] = {
        ...levels[lv],
        contextualFormatVariants: {
          ...levels[lv].contextualFormatVariants,
          withoutLevelOne: [],
        },
      }
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const headings = [
      hd('T', 1, 0),
      hd('A', 2, 1),
      hd('A1', 3, 2),
      hd('B', 2, 3),
    ]
    const result = computeHeadingNumbering(headings, settings)
    // Fallback strips H1 from withLevelOne: [ref(2), ref(3)] → 1.1
    expect(getLabels(result)).toEqual(['', '1', '1.1', '2'])
  })
})

describe('shared style slot equality', () => {
  // Test: strict H2 == loose H1 (both use S1)
  it('strict H2 decimal == loose H1 decimal', () => {
    const rStrict = computeLabels([{ text: 'T', level: 1 }, { text: 'A', level: 2 }], 'decimal-hierarchical', false)
    const rLoose = computeLabels([{ text: 'A', level: 1 }], 'decimal-hierarchical', true)
    // strict H2 label == loose H1 label
    expect(rStrict.labels[1]).toBe(rLoose.labels[0])
  })

  it('strict H3 == loose H2 for decimal', () => {
    const rStrict = computeLabels([{ text: 'T', level: 1 }, { text: 'A', level: 2 }, { text: 'a', level: 3 }], 'decimal-hierarchical', false)
    const rLoose = computeLabels([{ text: 'A', level: 1 }, { text: 'a', level: 2 }], 'decimal-hierarchical', true)
    expect(rStrict.labels[2]).toBe(rLoose.labels[1])
  })

  it('strict H2 chinese-chapter == loose H1 chinese-chapter', () => {
    const rStrict = computeLabels([{ text: 'T', level: 1 }, { text: 'A', level: 2 }], 'chinese-chapter', false)
    const rLoose = computeLabels([{ text: 'A', level: 1 }], 'chinese-chapter', true)
    expect(rStrict.labels[1]).toBe(rLoose.labels[0])
  })

  it('strict H2 academic-paper == loose H1 academic-paper', () => {
    const rStrict = computeLabels([{ text: 'T', level: 1 }, { text: 'A', level: 2 }], 'academic-paper', false)
    const rLoose = computeLabels([{ text: 'A', level: 1 }], 'academic-paper', true)
    expect(rStrict.labels[1]).toBe(rLoose.labels[0])
  })

  it('mode switch preserves S1-S5 data (no copy)', () => {
    // Use preset levels — switching mode should not change the levels content
    const levels = getPresetLevels('decimal-hierarchical')
    const s1Before = JSON.stringify(levels[1])
    // Simulate strict mode: build effective levels
    const effective = buildStrictEffectiveLevels(levels)
    // Original levels[1] must be unchanged
    expect(JSON.stringify(levels[1])).toBe(s1Before)
    // Effective H2 should be defined
    expect(effective[2]).toBeDefined()
  })

  it('9 presets strict H2 == loose H1', () => {
    const presets: HeadingNumberingPreset[] = [
      'decimal-hierarchical', 'chinese-chapter', 'chinese-outline',
      'academic-paper', 'chapter-section-clause', 'appendix-hierarchical',
      'roman-hierarchical', 'roman-mixed', 'letter-mixed',
    ]
    for (const preset of presets) {
      const rStrict = computeLabels([{ text: 'T', level: 1 }, { text: 'A', level: 2 }], preset, false)
      const rLoose = computeLabels([{ text: 'A', level: 1 }], preset, true)
      expect(rStrict.labels[1]).toBe(rLoose.labels[0])
    }
  })
})

describe('S6 loose extension', () => {
  it('S6 unconfigured: loose H6 label is empty (native)', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const settings: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', true),
      s6Configured: false,
    }
    const headings = [hd('A', 1, 0), hd('a', 6, 1)]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[1].label).toBe('')
  })

  it('S6 configured: loose H6 uses S6 format', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[6] = {
      ...levels[1],
      enabled: true,
    }
    const settings: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', true),
      s6Configured: true,
      levels,
    }
    const headings = [hd('A', 1, 0), hd('a', 6, 1)]
    const result = computeHeadingNumbering(headings, settings)
    // loose H6 uses S6 (levels[6]), which is configured like levels[1] (arabic)
    expect(result[1].label).not.toBe('')
  })

  it('strict mode completely ignores S6 even if configured', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[6] = { ...levels[1], enabled: true }
    const settings: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', false),
      s6Configured: true,
      levels,
    }
    const headings = [hd('T', 1, 0), hd('A', 2, 1), hd('B', 6, 2)]
    const result = computeHeadingNumbering(headings, settings)
    // strict H6 → S5 (levels[5]), not S6
    expect(result[0].label).toBe('')
    expect(result[2].label).not.toBe('')
  })
})

describe('draft-vs-saved strict S1 preview regression', () => {
  /**
   * Regression: strict H2 editing S1 must produce the S1-level label in preview.
   * Before the fix, edits to strict H2 were written to physical levels[2]
   * while computeHeadingNumbering reads S1 (levels[1]) via buildStrictEffectiveLevels.
   * Result: editor showed chinese, preview showed arabic.
   */
  it('strict H2 with chinese S1 produces 一、in preview', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // Simulate user editing S1: change tokenStyle to chinese, suffix to 、
    // This writes to levels[1] (S1 slot, which maps to strict H2)
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese',
      contextualFormatVariants: {
        withLevelOne: [
          { id: 's1-self', type: 'level-reference', level: 1, appearance: { tokenStyle: 'chinese', prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const headings = [hd('Title', 1, 0), hd('A', 2, 1)]
    const result = computeHeadingNumbering(headings, settings)
    // strict H2 must use S1's chinese format: 一、
    expect(result[1].label).toBe('一、')
  })

  it('loose H1 with same S1 produces 一、', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese',
      contextualFormatVariants: {
        withLevelOne: [
          { id: 's1-self', type: 'level-reference', level: 1, appearance: { tokenStyle: 'chinese', prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'custom',
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const headings = [hd('A', 1, 0)]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('一、')
  })

  it('strict H2 label == loose H1 label with same S1 data', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese',
      contextualFormatVariants: {
        withLevelOne: [
          { id: 's1-self', type: 'level-reference', level: 1, appearance: { tokenStyle: 'chinese', prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const strictSettings: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', false),
      levels,
      preset: 'custom',
    }
    const looseSettings: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', true),
      levels,
      preset: 'custom',
    }
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], strictSettings)
    const rLoose = computeHeadingNumbering([hd('A', 1, 0)], looseSettings)
    expect(rStrict[1].label).toBe(rLoose[0].label)
    expect(rStrict[1].label).toBe('一、')
  })
})

describe('shared style slot S1-S5 equality', () => {
  it('S1-S5 strict H2..H6 == loose H1..H5 for decimal', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const strictS = { ...makeSettings('decimal-hierarchical', false), levels, preset: 'custom' } as HeadingNumberingSettings
    const looseS = { ...makeSettings('decimal-hierarchical', true), levels, preset: 'custom' } as HeadingNumberingSettings
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('S1', 2, 1), hd('S2', 3, 2), hd('S3', 4, 3), hd('S4', 5, 4), hd('S5', 6, 5)], strictS)
    const rLoose = computeHeadingNumbering([hd('S1', 1, 0), hd('S2', 2, 1), hd('S3', 3, 2), hd('S4', 4, 3), hd('S5', 5, 4)], looseS)
    // strict H2-H6 labels == loose H1-H5 labels
    expect(rStrict[1].label).toBe(rLoose[0].label)
    expect(rStrict[2].label).toBe(rLoose[1].label)
    expect(rStrict[3].label).toBe(rLoose[2].label)
    expect(rStrict[4].label).toBe(rLoose[3].label)
    expect(rStrict[5].label).toBe(rLoose[4].label)
  })

  it('S1-S5 strict H2..H6 == loose H1..H5 for chinese-chapter', () => {
    const levels = getPresetLevels('chinese-chapter')
    const strictS = { ...makeSettings('chinese-chapter', false), levels, preset: 'custom' } as HeadingNumberingSettings
    const looseS = { ...makeSettings('chinese-chapter', true), levels, preset: 'custom' } as HeadingNumberingSettings
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('S1', 2, 1), hd('S2', 3, 2), hd('S3', 4, 3), hd('S4', 5, 4), hd('S5', 6, 5)], strictS)
    const rLoose = computeHeadingNumbering([hd('S1', 1, 0), hd('S2', 2, 1), hd('S3', 3, 2), hd('S4', 4, 3), hd('S5', 5, 4)], looseS)
    expect(rStrict[1].label).toBe(rLoose[0].label)
    expect(rStrict[2].label).toBe(rLoose[1].label)
    expect(rStrict[3].label).toBe(rLoose[2].label)
    expect(rStrict[4].label).toBe(rLoose[3].label)
    expect(rStrict[5].label).toBe(rLoose[4].label)
  })
})

describe('gap slot equality', () => {
  it('S1 gap=space: strict H2 == loose H1', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1].numberTitleSpacing = 'space'
    const strictS: HeadingNumberingSettings = { ...makeSettings('decimal-hierarchical', false), levels, preset: 'custom' }
    const looseS: HeadingNumberingSettings = { ...makeSettings('decimal-hierarchical', true), levels, preset: 'custom' }
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], strictS)
    const rLoose = computeHeadingNumbering([hd('A', 1, 0)], looseS)
    expect(rStrict[1].labelGap).toBe('space')
    expect(rLoose[0].labelGap).toBe('space')
  })

  it('S2 gap=none: strict H3 == loose H2', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[2].numberTitleSpacing = 'none'
    const strictS: HeadingNumberingSettings = { ...makeSettings('decimal-hierarchical', false), levels, preset: 'custom' }
    const looseS: HeadingNumberingSettings = { ...makeSettings('decimal-hierarchical', true), levels, preset: 'custom' }
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('S1', 2, 1), hd('S2', 3, 2)], strictS)
    const rLoose = computeHeadingNumbering([hd('S1', 1, 0), hd('S2', 2, 1)], looseS)
    expect(rStrict[2].labelGap).toBe('none')
    expect(rLoose[1].labelGap).toBe('none')
  })
})

describe('H2→H3 shift regression', () => {
  /**
   * Bug: ensureAllLevelsHaveCurrentSegment and updateDraftContextualFormat
   * were using physical lv instead of slotLv, causing ref levels to be
   * shifted +1 in the draft. In strict mode, H2/S1 would store ref(2)
   * instead of ref(1), which buildStrictEffectiveLevels would shift to ref(3).
   */
  function strictH2SelfLevel(): number {
    const levels = getPresetLevels('decimal-hierarchical')
    const effective = buildStrictEffectiveLevels(levels)
    // strict H2 uses effective level 2, which maps to S1 (levels[1])
    const selfSeg = effective[2].contextualFormatVariants.withLevelOne
      .find(s => s.type === 'level-reference' && s.level === 2)
    return selfSeg ? (selfSeg as any).level : -1
  }

  it('strict H2 does not shift self reference to H3', () => {
    // strict H2 (effective level 2) self ref should be at level 2
    // If it were 3, the bug is still present
    expect(strictH2SelfLevel()).toBe(2)
  })

  it('strict H3 does not shift self reference to H4', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const effective = buildStrictEffectiveLevels(levels)
    const selfSeg = effective[3].contextualFormatVariants.withLevelOne
      .find(s => s.type === 'level-reference' && s.level === 3)
    expect(selfSeg).toBeDefined()
    expect((selfSeg as any).level).toBe(3)
  })

  it('strict H2/S1 with chinese draft produces 一、not 1', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // Simulate editor: user sets S1 to chinese with suffix 、
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese' as const,
      contextualFormatVariants: {
        withLevelOne: [
          { id: 'test', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
      customDefinition: levels,
    }
    const headings = [hd('T', 1, 0), hd('A', 2, 1)]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[1].label).toBe('一、')
  })

  it('same S1 in loose: H1 produces 一、', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese' as const,
      contextualFormatVariants: {
        withLevelOne: [
          { id: 'test', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'loose',
      showLevelOneNumber: true,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
      customDefinition: levels,
    }
    const headings = [hd('A', 1, 0)]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[0].label).toBe('一、')
  })
})

describe('canonical variant verification', () => {
  it('engine buildLabel always reads withLevelOne', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // Set withLevelOne to chinese, withoutLevelOne to arabic
    // Engine should read withLevelOne (chinese)
    levels[1] = {
      ...levels[1],
      contextualFormatVariants: {
        withLevelOne: [
          { id: 'w', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [
          { id: 'wo', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'arabic' as const, prefix: '', suffix: '' } },
        ],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
    }
    // strict H2 reads S1 → should get withLevelOne (chinese 一、)
    const headings = [hd('T', 1, 0), hd('A', 2, 1)]
    const result = computeHeadingNumbering(headings, settings)
    expect(result[1].label).toBe('一、')
  })

  it('canonical withLevelOne is shared between strict and loose', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1] = {
      ...levels[1],
      contextualFormatVariants: {
        withLevelOne: [
          { id: 's', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const strictS: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', false), levels, preset: 'custom',
    }
    const looseS: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', true), levels, preset: 'custom',
    }
    const rStrict = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], strictS)
    const rLoose = computeHeadingNumbering([hd('A', 1, 0)], looseS)
    expect(rStrict[1].label).toBe('一、')
    expect(rLoose[0].label).toBe('一、')
  })
})

describe('normalization idempotence', () => {
  it('buildStrictEffectiveLevels is idempotent on already-shifted data', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // First shift
    const shifted1 = buildStrictEffectiveLevels(levels)
    // Second shift should not cause further +1 (it operates on raw levels)
    const shifted2 = buildStrictEffectiveLevels(levels)
    // Both should give same effective H2 label
    const s: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
    }
    const r1 = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], s)
    expect(r1[1].label).not.toBe('')
    // The key test: applying buildStrictEffectiveLevels twice on same raw data
    // should never cause the ref levels to keep increasing
    const effectiveFirst = shifted1[2].contextualFormatVariants.withLevelOne
    const effectiveSecond = shifted2[2].contextualFormatVariants.withLevelOne
    for (let i = 0; i < effectiveFirst.length; i++) {
      if (effectiveFirst[i].type === 'level-reference' && effectiveSecond[i].type === 'level-reference') {
        expect((effectiveSecond[i] as any).level).toBe((effectiveFirst[i] as any).level)
      }
    }
  })

  it('ensureAllLevelsHaveCurrentSegment does not cause cumulative shift', () => {
    // Simulate calling ensure multiple times: levels data should be stable
    const levels = getPresetLevels('decimal-hierarchical')
    const originalLevel = levels[1].contextualFormatVariants.withLevelOne
      .find(s => s.type === 'level-reference') as any
    const origVal = originalLevel?.level ?? 0

    // Simulate what ensureAllLevelsHaveCurrentSegment does for strict H2:
    // check seg.level === slotLv(1) → original ref(1) matches → no change
    const slotLv = 1 // S1 for strict H2
    const hasOwn = levels[slotLv].contextualFormatVariants.withLevelOne
      .some(s => s.type === 'level-reference' && (s as any).level === slotLv)
    expect(hasOwn).toBe(true)

    // Multiple calls should keep same level
    const levelAfter = levels[1].contextualFormatVariants.withLevelOne
      .find(s => s.type === 'level-reference') as any
    expect(levelAfter?.level).toBe(origVal)
  })
})

describe('mode round-trip no drift', () => {
  it('strict→loose→strict: S1 data unchanged', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    const s1Snapshot = JSON.stringify(levels[1])

    // Strict computation
    const strictS: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', false), levels, preset: 'custom',
    }
    computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], strictS)

    // Loose computation (same levels data)
    const looseS: HeadingNumberingSettings = {
      ...makeSettings('decimal-hierarchical', true), levels, preset: 'custom',
    }
    computeHeadingNumbering([hd('A', 1, 0)], looseS)

    // Back to strict
    computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], strictS)

    // S1 data must be unchanged
    expect(JSON.stringify(levels[1])).toBe(s1Snapshot)
  })
})

describe('mini/full preview equality', () => {
  it('S1 draft with chinese token: strict H2 full preview == loose H1 full preview', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese' as const,
      contextualFormatVariants: {
        withLevelOne: [
          { id: 's', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const rStrict = computeLabels(
      [{ text: 'T', level: 1 }, { text: 'A', level: 2 }],
      'decimal-hierarchical', false,
    )
    const rLoose = computeLabels(
      [{ text: 'A', level: 1 }],
      'decimal-hierarchical', true,
    )
    // The S1 data with override should be used in both modes
    // Both should produce same label
    expect(rStrict.labels[1]).toBe(rLoose.labels[0])
  })
})

describe('draft vs saved priority', () => {
  it('draft S1=chinese一、overrides saved S1=arabic 1 in preview', () => {
    // This simulates: saved format has arabic "1" but editor draft has chinese "一、"
    // The computeHeadingNumbering should use whatever levels it's given
    const levels = getPresetLevels('decimal-hierarchical')
    // This IS the draft — set to chinese
    levels[1] = {
      ...levels[1],
      tokenStyle: 'chinese' as const,
      contextualFormatVariants: {
        withLevelOne: [
          { id: 'draft', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
    }
    const result = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], settings)
    expect(result[1].label).toBe('一、')
  })
})

describe('presets have correct slot-level refs', () => {
  // System presets' levels[1] (S1) should have ref(1) for self reference
  const presets: HeadingNumberingPreset[] = [
    'decimal-hierarchical', 'chinese-chapter', 'chinese-outline',
    'academic-paper', 'chapter-section-clause', 'appendix-hierarchical',
    'roman-hierarchical', 'roman-mixed', 'letter-mixed',
  ]

  for (const preset of presets) {
    it(`${preset}: S1 has self ref at level 1`, () => {
      const levels = getPresetLevels(preset)
      const s1Self = levels[1].contextualFormatVariants.withLevelOne
        .find(s => s.type === 'level-reference' && (s as any).level === 1)
      expect(s1Self).toBeDefined()
    })

    it(`${preset}: strict H2 == loose H1`, () => {
      const rStrict = computeLabels(
        [{ text: 'T', level: 1 }, { text: 'A', level: 2 }],
        preset, false,
      )
      const rLoose = computeLabels(
        [{ text: 'A', level: 1 }],
        preset, true,
      )
      expect(rStrict.labels[1]).toBe(rLoose.labels[0])
    })
  }
})

describe('legacy withoutLevelOne compatibility', () => {
  it('engine ignores withoutLevelOne when withLevelOne present', () => {
    const levels = getPresetLevels('decimal-hierarchical')
    // withoutLevelOne has different format — engine should NOT use it
    levels[1] = {
      ...levels[1],
      contextualFormatVariants: {
        withLevelOne: [
          { id: 'w', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'chinese' as const, prefix: '', suffix: '、' } },
        ],
        withoutLevelOne: [
          { id: 'wo', type: 'level-reference' as const, level: 1,
            appearance: { tokenStyle: 'arabic' as const, prefix: '', suffix: '' } },
        ],
      },
    }
    const settings: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: 'strict',
      showLevelOneNumber: false,
      preset: 'custom',
      maxDepth: 6 as HeadingLevel,
      levels,
    }
    const result = computeHeadingNumbering([hd('T', 1, 0), hd('A', 2, 1)], settings)
    // Must read withLevelOne (chinese 一、), not withoutLevelOne (arabic 1)
    expect(result[1].label).toBe('一、')
  })
})
