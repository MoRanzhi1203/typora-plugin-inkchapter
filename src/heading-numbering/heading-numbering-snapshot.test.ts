import { describe, it, expect } from 'vitest'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
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

describe('buildHeadingNumberingSnapshotForRevision — pure builder', () => {
  it('uses the explicit revision and stamps every semantic.sourceRevision', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snap = buildHeadingNumberingSnapshotForRevision(headings, cloneSettings(), undefined, undefined, 105)
    expect(snap.revision).toBe(105)
    expect(snap.semantic.every(s => s.sourceRevision === 105)).toBe(true)
  })

  it('physical and semantic share the same key sequence subject to maxDepth filtering', () => {
    const settings: HeadingNumberingSettings = { ...cloneSettings(), maxDepth: 3 as HeadingLevel }
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3), hd('x', 4)]
    const snap = buildHeadingNumberingSnapshotForRevision(headings, settings)
    expect(snap.headings.map(h => h.key)).toEqual(['t', 'c', 's', 'x'])
    expect(snap.physical.map(p => p.key)).toEqual(['t', 'c', 's'])
    expect(snap.semantic.map(s => s.stableIdentity)).toEqual(['t', 'c', 's', 'x'])
  })

  it('structure mode is resolved once and shared', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const strict = buildHeadingNumberingSnapshotForRevision(headings, cloneSettings())
    const loose = buildHeadingNumberingSnapshotForRevision(headings, { ...cloneSettings(), headingStructureMode: 'loose', showLevelOneNumber: true })
    expect(strict.structureMode).toBe('strict')
    expect(strict.semantic.map(s => s.semanticRole)).toEqual(['document-title', 'chapter', 'section'])
    expect(loose.structureMode).toBe('loose')
    expect(loose.semantic.map(s => s.semanticRole)).toEqual(['chapter', 'section', 'subsection'])
  })

  it('one override map feeds both physical and semantic', () => {
    const overrideMap: HeadingOverrideMap = new Map([['c', 'unnumbered']])
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snap = buildHeadingNumberingSnapshotForRevision(headings, cloneSettings(), overrideMap)
    expect(snap.physical.find(p => p.key === 'c')!.label).toBe('')
    const c = snap.semantic.find(s => s.stableIdentity === 'c')!
    expect(c.counted).toBe(false)
    expect(c.countingReason).toBe('UNNUMBERED_SKIP')
  })

  it('physical + semantic are produced from one input (atomic single call)', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const snap = buildHeadingNumberingSnapshotForRevision(headings, cloneSettings(), undefined, undefined, 7)
    expect(snap.physical.length).toBe(snap.headings.length)
    expect(snap.semantic.length).toBe(snap.headings.length)
    expect(snap.semantic.every(s => s.sourceRevision === snap.revision)).toBe(true)
  })
})

describe('counting policy contracts', () => {
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
    const snap = buildHeadingNumberingSnapshotForRevision(headings, settings)
    expect(snap.semantic.map(s => s.chapterOrdinal)).toEqual([null, 3, 3, 3, 4, 4])
    expect(snap.semantic.map(s => s.sectionOrdinal)).toEqual([null, null, 2, 3, null, 2])
    expect(snap.semantic.map(s => s.ordinalByDepth)).toEqual([[], [3], [3, 2], [3, 3], [4], [4, 2]])
  })

  it('P-RESTART-1: physical restartAfterLevel change does not alter semantic path', () => {
    const headings = [hd('t', 1), hd('cA', 2), hd('sA', 3), hd('cB', 2), hd('sB', 3)]
    const defaultSnap = buildHeadingNumberingSnapshotForRevision(headings, cloneSettings())
    const continuousSection: HeadingNumberingSettings = {
      ...cloneSettings(),
      levels: { ...base.levels, 3: { ...base.levels[3], restartAfterLevel: null } },
    }
    const continuousSnap = buildHeadingNumberingSnapshotForRevision(headings, continuousSection)
    expect(defaultSnap.semantic.map(s => s.ordinalByDepth))
      .toEqual(continuousSnap.semantic.map(s => s.ordinalByDepth))
  })

  it('P-MAXDEPTH-1: maxDepth is physical-display-only and does not alter semantic path', () => {
    const headings = [hd('t', 1), hd('c', 2), hd('s', 3), hd('x', 4)]
    const snap3 = buildHeadingNumberingSnapshotForRevision(headings, { ...cloneSettings(), maxDepth: 3 as HeadingLevel })
    const snap6 = buildHeadingNumberingSnapshotForRevision(headings, { ...cloneSettings(), maxDepth: 6 as HeadingLevel })
    expect(snap3.semantic.map(s => s.ordinalByDepth)).toEqual(snap6.semantic.map(s => s.ordinalByDepth))
    expect(snap3.physical.length).toBe(3)
    expect(snap6.physical.length).toBe(4)
  })
})
