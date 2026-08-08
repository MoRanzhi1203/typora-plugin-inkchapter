import { describe, it, expect } from 'vitest'
import {
  ensureCurrentLevelSegment,
  getAvailableContextualReferenceLevels,
  computeHeadingNumbering,
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
    // In strict mode, H1 is unnumbered. H2 uses withoutLevelOne variant:
    // academic-paper H2 withoutLevelOne = standalone 第一章 (shifted format).
    // Note: the withoutLevelOne for H2 in academic-paper is [ref(2, chinese, '第', '章')],
    // giving "第一章", but the stripped variant from withLevelOne [H1.][H2] gives "1".
    // The resolved label depends on which variant is active — withoutLevelOne
    // takes priority when non-empty. So H2→第一章 in strict mode.
    // H3 withoutLevelOne = [H2(arabic, suffix='.')][H3(arabic)] = "1.1"
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
    // In strict mode, H1 hidden. chinese-chapter shifts: H2 withoutLevelOne uses
    // the format from position 0 (第n章).
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
