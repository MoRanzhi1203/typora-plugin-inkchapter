import { describe, it, expect } from 'vitest'
import {
  resolveHeadingContext,
  chapterFromHeadingNumber,
  sectionFromHeadingNumber,
  type HeadingContextEntry,
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
