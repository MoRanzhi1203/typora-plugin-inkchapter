import { describe, it, expect } from 'vitest'
import { computeHeadingNumberingSnapshot } from './heading-numbering-snapshot'
import type { HeadingDescriptor, HeadingLevel, HeadingNumberingSettings } from './heading-types'
import type { HeadingOverrideMap } from './numbering-engine'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = key): HeadingDescriptor {
  return { key, level, text }
}

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

function cloneSettings(): HeadingNumberingSettings {
  return { ...base, levels: { ...base.levels } }
}

describe('computeHeadingNumberingSnapshot — ownership + atomicity', () => {
  it('R-AUTH-1: revision is allocated and equals every semantic.sourceRevision', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snap = computeHeadingNumberingSnapshot(headings, cloneSettings(), undefined, undefined, 104)
    expect(snap.revision).toBe(105)
    expect(snap.semantic.every(s => s.sourceRevision === 105)).toBe(true)
  })

  it('R-AUTH-2: physical and semantic share the same key sequence subject to maxDepth filtering', () => {
    const settings: HeadingNumberingSettings = { ...cloneSettings(), maxDepth: 3 as HeadingLevel }
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3), hd('x', 4)]
    const snap = computeHeadingNumberingSnapshot(headings, settings)
    expect(snap.headings.map(h => h.key)).toEqual(['t', 'c', 's', 'x'])
    expect(snap.physical.map(p => p.key)).toEqual(['t', 'c', 's'])
    expect(snap.semantic.map(s => s.stableIdentity)).toEqual(['t', 'c', 's', 'x'])
  })

  it('R-AUTH-3: structure mode is resolved once and shared', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const strict = computeHeadingNumberingSnapshot(headings, cloneSettings())
    const loose = computeHeadingNumberingSnapshot(headings, { ...cloneSettings(), headingStructureMode: 'loose', showLevelOneNumber: true })
    expect(strict.structureMode).toBe('strict')
    expect(strict.semantic.map(s => s.semanticRole)).toEqual(['document-title', 'chapter', 'section'])
    expect(loose.structureMode).toBe('loose')
    expect(loose.semantic.map(s => s.semanticRole)).toEqual(['chapter', 'section', 'subsection'])
  })

  it('R-AUTH-4: one override map feeds both physical and semantic', () => {
    const overrideMap: HeadingOverrideMap = new Map([['c', 'unnumbered']])
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snap = computeHeadingNumberingSnapshot(headings, cloneSettings(), overrideMap)
    // physical: chapter c is unnumbered → empty label
    expect(snap.physical.find(p => p.key === 'c')!.label).toBe('')
    // semantic: chapter c is unnumbered + skip → not counted
    const c = snap.semantic.find(s => s.stableIdentity === 'c')!
    expect(c.counted).toBe(false)
    expect(c.countingReason).toBe('UNNUMBERED_SKIP')
  })

  it('R-AUTH-5: atomic snapshot cannot mix physical/semantic from different revisions', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snapA = computeHeadingNumberingSnapshot(headings, cloneSettings(), undefined, undefined, 10)
    const snapB = computeHeadingNumberingSnapshot(headings, cloneSettings(), undefined, undefined, snapA.revision)
    expect(snapA.revision).toBe(11)
    expect(snapB.revision).toBe(12)
    expect(snapA.semantic.every(s => s.sourceRevision === snapA.revision)).toBe(true)
    expect(snapB.semantic.every(s => s.sourceRevision === snapB.revision)).toBe(true)
  })
})

describe('computeHeadingNumberingSnapshot — counting policy contracts', () => {
  it('P-START-1: non-default chapter/section start values', () => {
    const settings: HeadingNumberingSettings = {
      ...cloneSettings(),
      levels: {
        ...base.levels,
        2: { ...base.levels[2], startAt: 3 },
        3: { ...base.levels[3], startAt: 2 },
      },
    }
    const headings = [hd('t', 1), hd('cA', 2), hd('sA', 3), hd('sB', 3), hd('cB', 2), hd('sC', 3)]
    const snap = computeHeadingNumberingSnapshot(headings, settings)
    expect(snap.semantic.map(s => s.chapterOrdinal)).toEqual([null, 3, 3, 3, 4, 4])
    expect(snap.semantic.map(s => s.sectionOrdinal)).toEqual([null, null, 2, 3, null, 2])
    expect(snap.semantic.map(s => s.semanticPath)).toEqual([[], [3], [3, 2], [3, 3], [4], [4, 2]])
  })

  it('P-RESTART-1: physical restartAfterLevel change does not alter semantic path', () => {
    const headings = [hd('t', 1), hd('cA', 2), hd('sA', 3), hd('cB', 2), hd('sB', 3)]
    const defaultSnap = computeHeadingNumberingSnapshot(headings, cloneSettings())
    const continuousSection: HeadingNumberingSettings = {
      ...cloneSettings(),
      levels: { ...base.levels, 3: { ...base.levels[3], restartAfterLevel: null } },
    }
    const continuousSnap = computeHeadingNumberingSnapshot(headings, continuousSection)
    expect(defaultSnap.semantic.map(s => s.semanticPath))
      .toEqual(continuousSnap.semantic.map(s => s.semanticPath))
  })

  it('P-MAXDEPTH-1: maxDepth is physical-display-only and does not alter semantic path', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3), hd('x', 4)]
    const snap3 = computeHeadingNumberingSnapshot(headings, { ...cloneSettings(), maxDepth: 3 as HeadingLevel })
    const snap6 = computeHeadingNumberingSnapshot(headings, { ...cloneSettings(), maxDepth: 6 as HeadingLevel })
    expect(snap3.semantic.map(s => s.semanticPath)).toEqual(snap6.semantic.map(s => s.semanticPath))
    expect(snap3.physical.length).toBe(3)
    expect(snap6.physical.length).toBe(4)
  })
})
