import { describe, it, expect } from 'vitest'
import { computeSemanticHeadingNumbers, type SemanticCounterOptions } from './semantic-heading-numbering'
import type { PhysicalHeading, SemanticHeadingNumberState } from './semantic-heading-types'
import type { HeadingOverrideMap } from './numbering-engine'

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

describe('structural ancestry vs counted path', () => {
  it('strict: title / chapter / section / subsection carry correct structural identities', () => {
    const s = sem([h('t', 1), h('c', 2), h('s', 3), h('x', 4)], 'strict')
    expect(s[0]).toMatchObject({ semanticRole: 'document-title', structuralParentIdentity: null, structuralChapterIdentity: null, structuralSectionIdentity: null })
    expect(s[1]).toMatchObject({ semanticRole: 'chapter', structuralParentIdentity: null, structuralChapterIdentity: null, structuralSectionIdentity: null })
    expect(s[2]).toMatchObject({ semanticRole: 'section', structuralParentIdentity: 'c', structuralChapterIdentity: 'c', structuralSectionIdentity: null })
    expect(s[3]).toMatchObject({ semanticRole: 'subsection', structuralParentIdentity: 's', structuralChapterIdentity: 'c', structuralSectionIdentity: 's' })
  })

  it('loose: structural chapter/section identity preserved across heterogeneous levels', () => {
    const s = sem([h('ca', 1), h('sa', 3), h('cb', 1), h('sb', 2)], 'loose')
    expect(s[1]).toMatchObject({ semanticRole: 'section', structuralChapterIdentity: 'ca' })
    expect(s[3]).toMatchObject({ semanticRole: 'section', structuralChapterIdentity: 'cb' })
  })
})

describe('unnumbered skip/consume — section', () => {
  it('P-SKIP-SECTION-1: skip section keeps role, no ordinal, descendant inherits chapter only', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('t', 1), h('c', 2), h('s1', 3), h('us', 3), h('s2', 3)], 'strict', { overrideMap })
    // us = unnumbered section
    expect(s[3]).toMatchObject({
      semanticRole: 'section',
      counted: false,
      countingReason: 'UNNUMBERED_SKIP',
      chapterOrdinal: 1,
      sectionOrdinal: null,
      structuralChapterIdentity: 'c',
    })
    // next counted section continues (skip does not consume)
    expect(s[4]).toMatchObject({ sectionOrdinal: 2, counted: true })
  })

  it('P-CONSUME-SECTION-1: consume section consumes ordinal and descendants inherit it', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('t', 1), h('c', 2), h('s1', 3), h('us', 3), h('s3', 3)], 'strict', { overrideMap, counterPolicy: 'consume' })
    expect(s[3]).toMatchObject({
      semanticRole: 'section',
      counted: true,
      countingReason: 'UNNUMBERED_CONSUME',
      sectionOrdinal: 2,
    })
    expect(s[4].sectionOrdinal).toBe(3)
  })
})

describe('unnumbered skip/consume — chapter', () => {
  it('P-SKIP-CHAPTER-1: skip chapter keeps role, no ordinal, descendant does not gain chapter', () => {
    const overrideMap: HeadingOverrideMap = new Map([['uc', 'unnumbered']])
    const s = sem([h('uc', 1), h('s', 2)], 'loose', { overrideMap })
    expect(s[0]).toMatchObject({
      semanticRole: 'chapter',
      counted: false,
      chapterOrdinal: null,
    })
    expect(s[1]).toMatchObject({
      semanticRole: 'section',
      structuralChapterIdentity: 'uc',
      chapterOrdinal: null,
      sectionOrdinal: 1,
    })
  })

  it('P-CONSUME-CHAPTER-1: consume chapter consumes ordinal and descendants inherit it', () => {
    const overrideMap: HeadingOverrideMap = new Map([['uc', 'unnumbered']])
    const s = sem([h('c1', 1), h('uc', 1), h('c3', 1)], 'loose', { overrideMap, counterPolicy: 'consume' })
    expect(s[0].chapterOrdinal).toBe(1)
    expect(s[1]).toMatchObject({ counted: true, countingReason: 'UNNUMBERED_CONSUME', chapterOrdinal: 2 })
    expect(s[2].chapterOrdinal).toBe(3)
  })
})

describe('descendant structural ancestry (skip does not erase structure)', () => {
  it('strict: H1/H2/H3/unnumbered-H3/H4 — H4 keeps structural Section identity', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('t', 1), h('c', 2), h('s1', 3), h('us', 3), h('x', 4)], 'strict', { overrideMap })
    const x = s[4]
    expect(x.semanticRole).toBe('subsection')
    expect(x.structuralChapterIdentity).toBe('c')
    expect(x.structuralSectionIdentity).toBe('us')
    expect(x.chapterOrdinal).toBe(1)
    expect(x.sectionOrdinal).toBeNull()
  })

  it('loose: H1/H3/unnumbered-H2/H4 — H4 keeps structural Section identity', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('c', 1), h('s1', 3), h('us', 2), h('x', 4)], 'loose', { overrideMap })
    const us = s[2]
    const x = s[3]
    expect(us.semanticRole).toBe('section')
    expect(us.counted).toBe(false)
    expect(x.structuralChapterIdentity).toBe('c')
    expect(x.structuralSectionIdentity).toBe('us')
    expect(x.chapterOrdinal).toBe(1)
    expect(x.sectionOrdinal).toBeNull()
  })
})
