import { describe, it, expect } from 'vitest'
import {
  resolveHeadingContext,
  chapterFromHeadingNumber,
  sectionFromHeadingNumber,
  resolveLogicalHeadingRoleMap,
  resolveLogicalHeadingContext,
  type HeadingContextEntry,
  type LogicalHeadingContextEntry,
} from './heading-context-resolver'

function entries(): HeadingContextEntry[] {
  return [
    { level: 1, number: '1', documentOrder: 0 },
    { level: 2, number: '1.1', documentOrder: 1 },
    { level: 3, number: '1.1.1', documentOrder: 2 },
    { level: 2, number: '1.2', documentOrder: 3 },
    { level: 1, number: '2', documentOrder: 4 },
    { level: 2, number: '2.3', documentOrder: 5 },
  ]
}

describe('resolveHeadingContext', () => {
  it('target before first H1 → all undefined (fallback 0)', () => {
    expect(resolveHeadingContext(entries(), 0)).toEqual({})
  })

  it('target under H1 only', () => {
    const ctx = resolveHeadingContext(entries(), 1)
    expect(ctx.h1).toBe('1')
    expect(ctx.h2).toBeUndefined()
    expect(ctx.h3).toBeUndefined()
  })

  it('target under H2', () => {
    const ctx = resolveHeadingContext(entries(), 2)
    expect(ctx.h1).toBe('1')
    expect(ctx.h2).toBe('1.1')
    expect(ctx.h3).toBeUndefined()
  })

  it('target under H3', () => {
    const ctx = resolveHeadingContext(entries(), 3)
    expect(ctx.h1).toBe('1')
    expect(ctx.h2).toBe('1.1')
    expect(ctx.h3).toBe('1.1.1')
  })

  it('target after nested heading resolves nearest preceding H2 (H3 stays last-seen)', () => {
    const ctx = resolveHeadingContext(entries(), 4)
    expect(ctx.h1).toBe('1')
    expect(ctx.h2).toBe('1.2')
    expect(ctx.h3).toBe('1.1.1')
  })

  it('target in second chapter resolves new H1/H2', () => {
    const ctx = resolveHeadingContext(entries(), 6)
    expect(ctx.h1).toBe('2')
    expect(ctx.h2).toBe('2.3')
  })
})

describe('chapterFromHeadingNumber / sectionFromHeadingNumber', () => {
  it('chapter = first segment of H1', () => {
    expect(chapterFromHeadingNumber('2')).toBe('2')
    expect(chapterFromHeadingNumber('2.3')).toBe('2')
    expect(chapterFromHeadingNumber(undefined)).toBe('0')
  })

  it('section = last segment of H2', () => {
    expect(sectionFromHeadingNumber('2.3')).toBe('3')
    expect(sectionFromHeadingNumber('3')).toBe('3')
    expect(sectionFromHeadingNumber(undefined)).toBe('0')
  })
})

describe('resolveLogicalHeadingRoleMap (v2.5.1)', () => {
  it('loose (showLevelOne=true) → chapter=1 section=2 subsection=3', () => {
    expect(resolveLogicalHeadingRoleMap('loose')).toEqual({
      chapterPhysicalLevel: 1,
      sectionPhysicalLevel: 2,
      subsectionPhysicalLevel: 3,
    })
  })

  it('strict (showLevelOne=false) → chapter=2 section=3 subsection=4', () => {
    expect(resolveLogicalHeadingRoleMap('strict')).toEqual({
      chapterPhysicalLevel: 2,
      sectionPhysicalLevel: 3,
      subsectionPhysicalLevel: 4,
    })
  })
})

describe('resolveLogicalHeadingContext (v2.5.1)', () => {
  const roleMap = resolveLogicalHeadingRoleMap('strict') // chapter=H2, section=H3

  it('H2=5 + H3=1 → chapterOrdinal=5 sectionOrdinal=1', () => {
    const headings: LogicalHeadingContextEntry[] = [
      { physicalLevel: 1, number: '', documentOrder: 0 },
      { physicalLevel: 2, number: '5', documentOrder: 1 },
      { physicalLevel: 3, number: '5.1', documentOrder: 2 },
    ]
    const ctx = resolveLogicalHeadingContext(headings, 3, roleMap)
    expect(ctx.chapterOrdinal).toBe(5)
    expect(ctx.sectionOrdinal).toBe(1)
  })

  it('H2=5 + H3=2 → chapterOrdinal=5 sectionOrdinal=2', () => {
    const headings: LogicalHeadingContextEntry[] = [
      { physicalLevel: 2, number: '5', documentOrder: 0 },
      { physicalLevel: 3, number: '5.2', documentOrder: 1 },
    ]
    const ctx = resolveLogicalHeadingContext(headings, 2, roleMap)
    expect(ctx.chapterOrdinal).toBe(5)
    expect(ctx.sectionOrdinal).toBe(2)
  })

  it('H1 is not a chapter in strict mode (skipped)', () => {
    const headings: LogicalHeadingContextEntry[] = [
      { physicalLevel: 1, number: '1', documentOrder: 0 },
      { physicalLevel: 2, number: '5', documentOrder: 1 },
    ]
    const ctx = resolveLogicalHeadingContext(headings, 2, roleMap)
    expect(ctx.chapterOrdinal).toBe(5)
    expect(ctx.sectionOrdinal).toBeUndefined()
  })
})
