import { describe, it, expect } from 'vitest'
import { computeSemanticHeadingNumbers, resolveSemanticStartAt, type SemanticCounterOptions } from './semantic-heading-numbering'
import type { PhysicalHeading, SemanticHeadingNumberState } from './semantic-heading-types'
import type { HeadingOverrideMap } from './numbering-engine'
import type { HeadingNumberingSettings } from './heading-types'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

function h(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): PhysicalHeading {
  return { key, level, text }
}

function sem(
  headings: PhysicalHeading[],
  mode: 'strict' | 'loose',
  opts: Partial<SemanticCounterOptions> = {},
): SemanticHeadingNumberState[] {
  return computeSemanticHeadingNumbers(headings, mode, {
    startAt: opts.startAt ?? [1, 1, 1, 1, 1, 1],
    sourceRevision: opts.sourceRevision ?? 1,
    overrideMap: opts.overrideMap,
    counterPolicy: opts.counterPolicy ?? 'skip',
  })
}

describe('computeSemanticHeadingNumbers — strict', () => {
  it('S-AUTH-1: H1 title / H2 chapter / H3 section -> [], [1], [1,1]', () => {
    const s = sem([h('t', 1), h('c', 2), h('s', 3)], 'strict')
    expect(s.map(x => x.semanticRole)).toEqual(['document-title', 'chapter', 'section'])
    expect(s.map(x => x.semanticPath)).toEqual([[], [1], [1, 1]])
    expect(s.map(x => x.chapterOrdinal)).toEqual([null, 1, 1])
    expect(s.map(x => x.sectionOrdinal)).toEqual([null, null, 1])
  })

  it('S-AUTH-2: H2 chapter / H3 section (no title) -> [1], [1,1]', () => {
    const s = sem([h('c', 2), h('s', 3)], 'strict')
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1]])
    expect(s.map(x => x.semanticRole)).toEqual(['chapter', 'section'])
  })

  it('S-AUTH-3: H1 / H2 / H4 -> H4 is subsection and does not consume section', () => {
    const s = sem([h('t', 1), h('c', 2), h('x', 4)], 'strict')
    expect(s.map(x => x.semanticRole)).toEqual(['document-title', 'chapter', 'subsection'])
    expect(s[2].chapterOrdinal).toBe(1)
    expect(s[2].sectionOrdinal).toBeNull()
  })

  it('strict H1 never consumes the chapter sequence', () => {
    const s = sem([h('t', 1), h('c1', 2), h('c2', 2)], 'strict')
    expect(s[0].chapterOrdinal).toBeNull()
    expect(s[1].chapterOrdinal).toBe(1)
    expect(s[2].chapterOrdinal).toBe(2)
  })
})

describe('computeSemanticHeadingNumbers — loose branch-local', () => {
  it('L-AUTH-1: H1/H2 then H1/H3 -> chapter 1/section 1, chapter 2/section 1', () => {
    const s = sem([h('c1', 1), h('s1', 2), h('c2', 1), h('s2', 3)], 'loose')
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1], [2], [2, 1]])
  })

  it('L-AUTH-2: H2/H3 then H2/H4 -> chapter 1/section 1, chapter 2/section 1', () => {
    const s = sem([h('c1', 2), h('s1', 3), h('c2', 2), h('s2', 4)], 'loose')
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1], [2], [2, 1]])
  })

  it('L-AUTH-3: heterogeneous chapter root H2/H3 then H1/H3 -> chapter 1/section 1, chapter 2/section 1', () => {
    const s = sem([h('c1', 2), h('s1', 3), h('c2', 1), h('s2', 3)], 'loose')
    expect(s.map(x => x.semanticRole)).toEqual(['chapter', 'section', 'chapter', 'section'])
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1], [2], [2, 1]])
  })

  it('L-AUTH-4: H1/H3/H2 -> chapter 1, section 1, section 2', () => {
    const s = sem([h('c', 1), h('s1', 3), h('s2', 2)], 'loose')
    expect(s.map(x => x.semanticRole)).toEqual(['chapter', 'section', 'section'])
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1], [1, 2]])
  })

  it('L-AUTH-5: H1/H4/H2/H5 -> deterministic path after physical level change', () => {
    const s = sem([h('c', 1), h('s1', 4), h('s2', 2), h('sub', 5)], 'loose')
    expect(s.map(x => x.semanticRole)).toEqual(['chapter', 'section', 'section', 'subsection'])
    expect(s.map(x => x.semanticPath)).toEqual([[1], [1, 1], [1, 2], [1, 2, 1]])
  })
})

describe('computeSemanticHeadingNumbers — mutation-as-snapshot', () => {
  it('M-AUTH-1: H1/H3 -> H1/H2 both yield chapter 1/section 1', () => {
    const before = sem([h('c', 1), h('s', 3)], 'loose')
    const after = sem([h('c', 1), h('s', 2)], 'loose')
    expect(before.map(x => x.semanticPath)).toEqual([[1], [1, 1]])
    expect(after.map(x => x.semanticPath)).toEqual([[1], [1, 1]])
  })

  it('M-AUTH-2: inserting a chapter shifts later chapter ordinals', () => {
    const before = sem([h('c1', 1), h('c2', 1)], 'loose')
    const after = sem([h('c1', 1), h('cNEW', 1), h('c2', 1)], 'loose')
    expect(before.map(x => x.semanticPath)).toEqual([[1], [2]])
    expect(after.map(x => x.semanticPath)).toEqual([[1], [2], [3]])
  })

  it('M-AUTH-3: removing a section shifts later sections', () => {
    const before = sem([h('c', 1), h('s1', 2), h('s2', 2)], 'loose')
    const after = sem([h('c', 1), h('s2', 2)], 'loose')
    expect(before.map(x => x.semanticPath)).toEqual([[1], [1, 1], [1, 2]])
    expect(after.map(x => x.semanticPath)).toEqual([[1], [1, 1]])
  })
})

describe('computeSemanticHeadingNumbers — counting policy', () => {
  it('non-default start: chapter start 3, section start 2', () => {
    const s = sem(
      [h('t', 1), h('cA', 2), h('sA', 3), h('sB', 3), h('cB', 2), h('sC', 3)],
      'strict',
      { startAt: [3, 2, 1, 1, 1, 1] },
    )
    // chapters: 3, 4; sections: A=2, B=3 (reset on chapter B to 2), C=2
    expect(s.map(x => x.chapterOrdinal)).toEqual([null, 3, 3, 3, 4, 4])
    expect(s.map(x => x.sectionOrdinal)).toEqual([null, null, 2, 3, null, 2])
    expect(s.map(x => x.semanticPath)).toEqual([[], [3], [3, 2], [3, 3], [4], [4, 2]])
  })

  it('unnumbered skip does not consume the sequence', () => {
    const overrideMap: HeadingOverrideMap = new Map([['skipMe', 'unnumbered']])
    const s = sem([h('c1', 1), h('skipMe', 1), h('c2', 1)], 'loose', { overrideMap })
    // skipMe does not consume -> c2 is still chapter 2, not chapter 3
    expect(s[0].semanticPath).toEqual([1])
    expect(s[1].semanticPath).toEqual([])
    expect(s[1].counted).toBe(false)
    expect(s[2].semanticPath).toEqual([2])
  })

  it('override numbered + consume policy occupies sequence but marks unnumbered', () => {
    const overrideMap: HeadingOverrideMap = new Map([['hidden', 'unnumbered']])
    const s = sem([h('c1', 1), h('hidden', 1), h('c2', 1)], 'loose', { overrideMap, counterPolicy: 'consume' })
    expect(s[1].counted).toBe(true)
    expect(s[1].countingReason).toBe('UNNUMBERED_CONSUME')
    expect(s[1].semanticPath).toEqual([2])
    expect(s[2].semanticPath).toEqual([3])
  })
})

describe('resolveSemanticStartAt', () => {
  it('maps semantic depth to the documented physical level start value', () => {
    const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault
    const settings: HeadingNumberingSettings = {
      ...base,
      levels: {
        ...base.levels,
        2: { ...base.levels[2], startAt: 3 },
        3: { ...base.levels[3], startAt: 2 },
      },
    }
    // strict: chapter→H2(3), section→H3(2), subsection→H4(1), ...
    expect(resolveSemanticStartAt(settings, 'strict')).toEqual([3, 2, 1, 1, 1, 1])
    // loose: chapter→H1(1), section→H2(3), subsection→H3(2), ...
    expect(resolveSemanticStartAt(settings, 'loose')).toEqual([1, 3, 2, 1, 1, 1])
  })
})
