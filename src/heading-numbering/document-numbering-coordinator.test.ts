import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { DocumentNumberingCoordinator, type ReconcileReason } from './document-numbering-coordinator'
import { buildHeadingNumberingSnapshotForRevision } from './heading-numbering-snapshot'
import type { HeadingDescriptor, HeadingNumberingSettings } from './heading-types'
import { DEFAULT_SETTINGS } from '../settings/default-settings'

const base = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault
function settings(mode: 'strict' | 'loose'): HeadingNumberingSettings {
  return { ...base, levels: { ...base.levels }, headingStructureMode: mode, showLevelOneNumber: mode === 'loose' }
}
function hd(key: string, level: 1 | 2 | 3): HeadingDescriptor { return { key, level, text: key } }
function snap(revision: number, docKey: string) {
  return buildHeadingNumberingSnapshotForRevision([hd('c', 2), hd('s', 3)], settings('strict'), undefined, undefined, revision, docKey)
}

const flush = () => new Promise<void>(r => setTimeout(r, 0))

function makeHarness() {
  let docKey = 'A.md'
  let snapshot: ReturnType<typeof snap> | null = snap(1, 'A.md')
  const commitCallbacks: (() => void)[] = []
  const invalidateCallbacks: (() => void)[] = []
  const refreshes: ReconcileReason[][] = []

  const coordinator = new DocumentNumberingCoordinator({
    getDocumentKey: () => docKey,
    getSnapshot: () => snapshot,
    refresh: reasons => refreshes.push(reasons),
    onSnapshotCommit: cb => { commitCallbacks.push(cb); return () => {} },
    onSnapshotInvalidate: cb => { invalidateCallbacks.push(cb); return () => {} },
  })

  return {
    coordinator,
    refreshes,
    commit: () => commitCallbacks.forEach(cb => cb()),
    invalidate: () => invalidateCallbacks.forEach(cb => cb()),
    setDocKey: (k: string) => { docKey = k },
    setSnapshot: (s: ReturnType<typeof snap> | null) => { snapshot = s },
  }
}

describe('DocumentNumberingCoordinator (6B)', () => {
  it('INITIAL_RECONCILE: schedules one initial refresh after construction', async () => {
    const h = makeHarness()
    await flush()
    expect(h.refreshes.length).toBe(1)
    expect(h.refreshes[0]).toEqual(['initial-reconcile'])
  })

  it('EVENT_COALESCING: N synchronous commit events collapse into one refresh', async () => {
    const h = makeHarness()
    await flush()
    const before = h.refreshes.length
    h.commit(); h.commit(); h.commit()
    await flush()
    expect(h.refreshes.length).toBe(before + 1)
    expect(h.refreshes[before]).toEqual(['snapshot-commit'])
  })

  it('DOCUMENT_INVALIDATION_HANDLED: invalidate schedules a refresh', async () => {
    const h = makeHarness()
    await flush()
    const before = h.refreshes.length
    h.invalidate()
    await flush()
    expect(h.refreshes.length).toBe(before + 1)
    expect(h.refreshes[before]).toEqual(['snapshot-invalidated'])
  })

  it('DOCUMENT_SESSION_ISOLATION: reconcile defers when snapshot does not match active document', async () => {
    const h = makeHarness()
    h.setSnapshot(snap(1, 'B.md')) // snapshot belongs to B, active doc is A
    await flush()
    // initial reconcile should NOT have refreshed (mismatched documentKey)
    expect(h.refreshes.length).toBe(0)

    // switch active doc to B
    h.setDocKey('B.md')
    h.commit()
    await flush()
    expect(h.refreshes.length).toBe(1)
    expect(h.refreshes[0]).toEqual(['snapshot-commit'])
  })

  it('BASIC_PROJECTION_LOOP_GUARD: isProjectionActive toggles around refresh', async () => {
    let observed = false
    const coordinator = new DocumentNumberingCoordinator({
      getDocumentKey: () => 'A.md',
      getSnapshot: () => snap(1, 'A.md'),
      refresh: () => { observed = coordinator.isProjectionActive() },
      onSnapshotCommit: () => () => {},
      onSnapshotInvalidate: () => () => {},
    })
    await flush()
    expect(observed).toBe(true)
    expect(coordinator.isProjectionActive()).toBe(false)
  })

  it('NO_POLLING: coordinator source has no setInterval/periodic timer', () => {
    const src = readFileSync(fileURLToPath(new URL('./document-numbering-coordinator.ts', import.meta.url)), 'utf8')
    expect(src).not.toContain('setInterval')
    expect(src).toContain('queueMicrotask')
  })
})
