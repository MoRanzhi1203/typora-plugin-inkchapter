import { describe, it, expect } from 'vitest'
import { normalizeContextualFormatAfterDrag } from './format-drag-utils'
import { generateStableId } from './heading-types'
import type { ContextualFormatSegment, HeadingLevel } from './heading-types'

describe('normalizeContextualFormatAfterDrag', () => {
  const tokenStyle = 'arabic' as const
  const hiddenLevels = new Set<HeadingLevel>()
  const hiddenWithH1 = new Set<HeadingLevel>([1 as HeadingLevel])

  function makeRef(level: HeadingLevel): ContextualFormatSegment {
    return {
      id: generateStableId(),
      type: 'level-reference',
      level,
      appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
    }
  }

  function makeLit(value: string): ContextualFormatSegment {
    return {
      id: generateStableId(),
      type: 'literal',
      value,
    }
  }

  it('preserves current-level reference', () => {
    const format: ContextualFormatSegment[] = [
      makeRef(1),
      makeLit('.'),
      makeRef(2),
    ]

    const result = normalizeContextualFormatAfterDrag(format, 2, hiddenLevels, tokenStyle)

    // Should preserve H2 reference
    const hasL2 = result.some((s) => s.type === 'level-reference' && s.level === 2)
    expect(hasL2).toBe(true)
  })

  it('adds current-level reference if missing', () => {
    const format: ContextualFormatSegment[] = [
      makeRef(1),
    ]

    const result = normalizeContextualFormatAfterDrag(format, 3, hiddenLevels, tokenStyle)

    // Should add H3 reference
    const hasL3 = result.some((s) => s.type === 'level-reference' && s.level === 3)
    expect(hasL3).toBe(true)
  })

  it('filters out levels > currentLevel', () => {
    const format: ContextualFormatSegment[] = [
      makeRef(1),
      makeLit('.'),
      makeRef(2),
      makeLit('.'),
      makeRef(3),
      makeLit('.'),
      makeRef(4), // level > currentLevel(3)
    ]

    const result = normalizeContextualFormatAfterDrag(format, 3, hiddenLevels, tokenStyle)

    // Should not include level 4
    const hasL4 = result.some((s) => s.type === 'level-reference' && s.level === 4)
    expect(hasL4).toBe(false)

    // Should preserve levels 1, 2, 3
    const hasL1 = result.some((s) => s.type === 'level-reference' && s.level === 1)
    const hasL2 = result.some((s) => s.type === 'level-reference' && s.level === 2)
    const hasL3 = result.some((s) => s.type === 'level-reference' && s.level === 3)
    expect(hasL1).toBe(true)
    expect(hasL2).toBe(true)
    expect(hasL3).toBe(true)
  })

  it('filters out hidden levels', () => {
    const format: ContextualFormatSegment[] = [
      makeRef(1),
      makeLit('.'),
      makeRef(2),
    ]

    const result = normalizeContextualFormatAfterDrag(format, 2, hiddenWithH1, tokenStyle)

    // Should filter H1
    const hasL1 = result.some((s) => s.type === 'level-reference' && s.level === 1)
    expect(hasL1).toBe(false)

    // Should preserve H2
    const hasL2 = result.some((s) => s.type === 'level-reference' && s.level === 2)
    expect(hasL2).toBe(true)
  })
})
