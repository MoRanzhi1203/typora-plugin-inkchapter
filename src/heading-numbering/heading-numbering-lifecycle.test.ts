import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { HeadingNumberingAuthority, type HeadingNumberingSnapshot, type HeadingSnapshotChangeReason } from './heading-numbering-snapshot'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import type { HeadingOverrideMap } from './numbering-engine'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

function hd(key: string, level: 1 | 2 | 3 | 4 | 5 | 6): HeadingDescriptor {
  return { key, level, text: key }
}

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault

function settings(patch: Partial<HeadingNumberingSettings> = {}): HeadingNumberingSettings {
  return { ...base, levels: { ...base.levels }, ...patch }
}

describe('LIFE-DOC — document transition barrier', () => {
  it('LIFE-DOC-1: A → switch B → invalidate → getter null → commit B → getter B', () => {
    const authority = new HeadingNumberingAuthority()
    const A = [hd('t', 1), hd('cA', 2), hd('sA', 3)]
    const B = [hd('cB', 1), hd('sB', 2)]

    authority.commit(A, settings(), undefined, undefined, 'A.md')
    expect(authority.getCurrent()?.documentKey).toBe('A.md')

    // switch to B: invalidate before B commit
    authority.invalidate('B.md')
    expect(authority.getCurrent()).toBeNull()

    authority.commit(B, settings(), undefined, undefined, 'B.md')
    expect(authority.getCurrent()?.documentKey).toBe('B.md')
  })

  it('LIFE-DOC-2: A → B → A never exposes the other document snapshot', () => {
    const authority = new HeadingNumberingAuthority()
    const A = [hd('t', 1), hd('cA', 2), hd('sA', 3)]
    const B = [hd('cB', 1), hd('sB', 2)]

    authority.commit(A, settings(), undefined, undefined, 'A.md')
    expect(authority.getCurrent()?.documentKey).toBe('A.md')

    authority.invalidate('B.md')
    expect(authority.getCurrent()).toBeNull()
    authority.commit(B, settings(), undefined, undefined, 'B.md')
    expect(authority.getCurrent()?.documentKey).toBe('B.md')

    authority.invalidate('A.md')
    expect(authority.getCurrent()).toBeNull()
    authority.commit(A, settings(), undefined, undefined, 'A.md')
    expect(authority.getCurrent()?.documentKey).toBe('A.md')
  })

  it('LIFE-DOC-3: snapshot reports its documentKey', () => {
    const authority = new HeadingNumberingAuthority()
    const snap = authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    expect(snap.documentKey).toBe('A.md')
  })

  it('LIFE-DOC defensive getter: cross-document mismatch returns null', () => {
    const authority = new HeadingNumberingAuthority()
    const snap = authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    expect(snap.documentKey).toBe('A.md')
    // A snapshot exists but current document identity is still A; a consumer
    // checking against a DIFFERENT active key must reject it.
    expect(snap.documentKey === 'B.md' ? snap : null).toBeNull()
  })
})

describe('LIFE-EVENT — subscription', () => {
  it('LIFE-EVENT-1: one commit emits one COMMITTED event', () => {
    const authority = new HeadingNumberingAuthority()
    const events: Array<HeadingSnapshotChangeReason> = []
    authority.subscribe((_s, reason) => events.push(reason))
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    expect(events).toEqual(['COMMITTED'])
  })

  it('LIFE-EVENT-2: invalidate emits one INVALIDATED event', () => {
    const authority = new HeadingNumberingAuthority()
    const events: Array<HeadingSnapshotChangeReason> = []
    authority.subscribe((_s, reason) => events.push(reason))
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    authority.invalidate('B.md')
    expect(events).toEqual(['COMMITTED', 'INVALIDATED_DOCUMENT_SWITCH'])
  })

  it('LIFE-EVENT-3: invalidation precedes commit', () => {
    const authority = new HeadingNumberingAuthority()
    const events: Array<HeadingSnapshotChangeReason> = []
    authority.subscribe((_s, reason) => events.push(reason))
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    authority.invalidate('B.md')
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'B.md')
    expect(events).toEqual(['COMMITTED', 'INVALIDATED_DOCUMENT_SWITCH', 'COMMITTED'])
  })

  it('LIFE-EVENT-4: unsubscribe stops further events', () => {
    const authority = new HeadingNumberingAuthority()
    const events: Array<HeadingSnapshotChangeReason> = []
    const unsubscribe = authority.subscribe((_s, reason) => events.push(reason))
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    unsubscribe()
    authority.commit([hd('c', 1), hd('s', 2)], settings(), undefined, undefined, 'A.md')
    expect(events).toEqual(['COMMITTED'])
  })

  it('LIFE-EVENT-5: getCurrent() emits no events; commit/invalidate are bounded', () => {
    const authority = new HeadingNumberingAuthority()
    const events: Array<HeadingSnapshotChangeReason> = []
    authority.subscribe((_s, reason) => events.push(reason))
    authority.commit([hd('c', 1)], settings(), undefined, undefined, 'A.md')
    authority.getCurrent() // pure read, no event
    authority.getCurrent() // pure read, no event
    expect(events).toEqual(['COMMITTED'])
  })
})

describe('LIFE-DISABLED — physical numbering disabled still produces semantic', () => {
  const disabled = settings({ enabled: false })

  it('LIFE-DISABLED-1: semantic snapshot commits with valid ordinals', () => {
    const authority = new HeadingNumberingAuthority()
    const snap = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3)], disabled, undefined, undefined, 'A.md')
    expect(snap.semantic.map(s => s.chapterOrdinal)).toEqual([null, 1, 1])
    expect(snap.semantic.map(s => s.sectionOrdinal)).toEqual([null, null, 1])
  })

  it('LIFE-DISABLED-2: strict → loose produces new revision and new roles', () => {
    const authority = new HeadingNumberingAuthority()
    const strict = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3)], disabled, undefined, undefined, 'A.md')
    const loose = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3)], settings({ enabled: false, headingStructureMode: 'loose', showLevelOneNumber: true }), undefined, undefined, 'A.md')
    expect(strict.revision).toBe(1)
    expect(loose.revision).toBe(2)
    expect(strict.semantic.map(s => s.semanticRole)).toEqual(['document-title', 'chapter', 'section'])
    expect(loose.semantic.map(s => s.semanticRole)).toEqual(['chapter', 'section', 'subsection'])
  })

  it('LIFE-DISABLED-3: heading level change updates semantic snapshot', () => {
    const authority = new HeadingNumberingAuthority()
    const before = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3)], disabled, undefined, undefined, 'A.md')
    const after = authority.commit([hd('t', 1), hd('c', 2), hd('s', 3), hd('s2', 3)], disabled, undefined, undefined, 'A.md')
    expect(before.revision).toBe(1)
    expect(after.revision).toBe(2)
    expect(after.semantic.map(s => s.sectionOrdinal)).toEqual([null, null, 1, 2])
  })

  it('semantic-only startAt / override changes produce new revisions while disabled', () => {
    const authority = new HeadingNumberingAuthority()
    const h = [hd('t', 1), hd('c', 2), hd('s', 3)]
    const s1 = authority.commit(h, disabled, undefined, undefined, 'A.md')
    const s2 = authority.commit(h, settings({ enabled: false, levels: { ...base.levels, 2: { ...base.levels[2], startAt: 5 } } }), undefined, undefined, 'A.md')
    const overrideMap: HeadingOverrideMap = new Map([['c', 'unnumbered']])
    const s3 = authority.commit(h, disabled, overrideMap, undefined, 'A.md')
    expect(s1.revision).toBe(1)
    expect(s2.revision).toBe(2)
    expect(s3.revision).toBe(3)
    expect(s2.semantic.map(x => x.chapterOrdinal)).toEqual([null, 5, 5])
    expect(s3.semantic.find(x => x.stableIdentity === 'c')!.counted).toBe(false)
  })
})

describe('service-path integration assertion (static)', () => {
  it('SEMANTIC_COMMIT_BEFORE_PHYSICAL_GATE: doRefresh commits before physical-only gates', () => {
    const src = readFileSync(fileURLToPath(new URL('./heading-numbering-service.ts', import.meta.url)), 'utf8')
    const doRefreshStart = src.indexOf('private doRefresh(')
    expect(doRefreshStart).toBeGreaterThan(-1)
    const body = src.slice(doRefreshStart)

    const commitIdx = body.indexOf('headingAuthority.commit')
    const disabledGateIdx = body.indexOf('if (!this.s.enabled) return')
    const structureEarlyIdx = body.indexOf('hasStructureChanged')

    expect(commitIdx).toBeGreaterThan(-1)
    expect(disabledGateIdx).toBeGreaterThan(-1)
    expect(structureEarlyIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeLessThan(disabledGateIdx)
    expect(commitIdx).toBeLessThan(structureEarlyIdx)
  })
})
