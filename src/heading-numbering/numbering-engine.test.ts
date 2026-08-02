import { describe, it, expect } from 'vitest'
import { ensureCurrentLevelSegment, getAvailableContextualReferenceLevels } from './numbering-engine'
import { generateStableId } from './heading-types'
import type { ContextualFormatSegment, HeadingLevel } from './heading-types'

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
