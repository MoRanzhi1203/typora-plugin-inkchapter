import { describe, it, expect } from 'vitest'
import { HeadingNumberingAuthority } from './heading-numbering-snapshot'
import { computeSemanticHeadingNumbers, type SemanticCounterOptions } from './semantic-heading-numbering'
import type { PhysicalHeading, SemanticHeadingNumberState } from './semantic-heading-types'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import type { HeadingOverrideMap } from './numbering-engine'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6): HeadingDescriptor {
  return { key, level, text: key }
}

function h(key: string, level: 1 | 2 | 3 | 4 | 5 | 6): PhysicalHeading {
  return { key, level, text: key }
}

const settings: HeadingNumberingSettings = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

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

describe('HeadingNumberingAuthority — service revision ownership', () => {
  it('SRV-REV-1: revision is monotonic across commits', () => {
    const authority = new HeadingNumberingAuthority()
    const s1 = authority.commit([hd('c', 1)], settings)
    const s2 = authority.commit([hd('c', 1), hd('s', 2)], settings)
    const s3 = authority.commit([hd('c', 1), hd('s', 2), hd('ss', 3)], settings)
    expect(s1.revision).toBe(1)
    expect(s2.revision).toBe(2)
    expect(s3.revision).toBe(3)
  })

  it('SRV-REV-2: commit has no revision argument — revision is owned, not chosen', () => {
    const authority = new HeadingNumberingAuthority()
    const s = authority.commit([hd('c', 1)], settings)
    expect(s.revision).toBe(authority.getCurrentRevision())
    expect(authority.getCurrentRevision()).toBe(1)
  })

  it('SRV-REV-3: snapshot.revision equals every semantic.sourceRevision', () => {
    const authority = new HeadingNumberingAuthority()
    const s = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3)], settings)
    expect(s.revision).toBe(authority.getCurrentRevision())
    expect(s.semantic.every(x => x.sourceRevision === s.revision)).toBe(true)
  })

  it('SRV-REV-4: two different heading states cannot share one revision', () => {
    const authority = new HeadingNumberingAuthority()
    const a = authority.commit([hd('c', 1)], settings)
    const b = authority.commit([hd('c', 1), hd('s', 2)], settings)
    expect(a.revision).not.toBe(b.revision)
    expect(a.semantic).not.toEqual(b.semantic)
  })

  it('SRV-REV-5: document/session isolation does not reuse another document snapshot', () => {
    const authority = new HeadingNumberingAuthority()
    const A: HeadingDescriptor[] = [hd('t', 1), hd('cA', 2), hd('sA', 3)]
    const B: HeadingDescriptor[] = [hd('cB', 1), hd('sB', 2)]
    const a1 = authority.commit(A, settings, undefined, undefined, 'A.md')
    const b1 = authority.commit(B, settings, undefined, undefined, 'B.md')
    const a2 = authority.commit(A, settings, undefined, undefined, 'A.md')

    expect(authority.getCurrentDocumentKey()).toBe('A.md')
    expect(a2.semantic.map(s => s.stableIdentity)).toEqual(a1.semantic.map(s => s.stableIdentity))
    expect(a2.semantic.map(s => s.ordinalByDepth)).toEqual(a1.semantic.map(s => s.ordinalByDepth))
    expect(b1.semantic.map(s => s.stableIdentity)).not.toEqual(a1.semantic.map(s => s.stableIdentity))
    expect(a1.revision).toBe(1)
    expect(b1.revision).toBe(2)
    expect(a2.revision).toBe(3)
  })
})

describe('ordinalByDepth — positional canonical path', () => {
  it('PATH-1: Chapter 1 -> [1]', () => {
    const s = sem([h('c', 1)], 'loose')
    expect(s[0].ordinalByDepth).toEqual([1])
    expect(s[0].chapterOrdinal).toBe(1)
    expect(s[0].sectionOrdinal).toBeNull()
  })

  it('PATH-2: Chapter 1 / Section 2 -> [1, 2]', () => {
    const s = sem([h('c', 1), h('s1', 2), h('s2', 2)], 'loose')
    expect(s[2].ordinalByDepth).toEqual([1, 2])
    expect(s[2].chapterOrdinal).toBe(1)
    expect(s[2].sectionOrdinal).toBe(2)
  })

  it('PATH-3: Chapter 1 / skipped Section -> [1, null]', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('c', 1), h('us', 2)], 'loose', { overrideMap })
    expect(s[1].ordinalByDepth).toEqual([1, null])
    expect(s[1].chapterOrdinal).toBe(1)
    expect(s[1].sectionOrdinal).toBeNull()
  })

  it('PATH-4: skipped Chapter / Section 1 -> [null, 1] and is NOT [1]', () => {
    const overrideMap: HeadingOverrideMap = new Map([['uc', 'unnumbered']])
    const s = sem([h('uc', 1), h('s', 2)], 'loose', { overrideMap })
    expect(s[1].ordinalByDepth).toEqual([null, 1])
    expect(s[1].chapterOrdinal).toBeNull()
    expect(s[1].sectionOrdinal).toBe(1)
    expect(s[1].displayCountedPath).toEqual([1])
    expect(s[1].ordinalByDepth).not.toEqual([1])
  })

  it('PATH-5: skipped deep level keeps null position (depth >= 3)', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('t', 1), h('c', 2), h('s', 3), h('us', 4)], 'strict', { overrideMap })
    expect(s[3].ordinalByDepth).toEqual([1, 1, null])
    expect(s[3].chapterOrdinal).toBe(1)
    expect(s[3].sectionOrdinal).toBe(1)
    expect(s[3].counted).toBe(false)
  })

  it('PATH-6: consumed unnumbered heading has a real ordinal slot, not null', () => {
    const overrideMap: HeadingOverrideMap = new Map([['us', 'unnumbered']])
    const s = sem([h('t', 1), h('c', 2), h('s1', 3), h('us', 3), h('s3', 3)], 'strict', { overrideMap, counterPolicy: 'consume' })
    expect(s[3].ordinalByDepth).toEqual([1, 2])
    expect(s[3].sectionOrdinal).toBe(2)
    expect(s[3].counted).toBe(true)
  })
})
