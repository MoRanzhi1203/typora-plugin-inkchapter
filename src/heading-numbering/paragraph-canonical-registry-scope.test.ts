import { describe, it, expect } from 'vitest'
import { ParagraphCanonicalRegistry } from './paragraph-canonical-registry'
import type { ParagraphIndentOverrideRecord } from './paragraph-layout-store'

// R58.7 Document-Switch Scope Authority — DS-5..DS-8 (registry behavior)

function mockEl(connected = true): HTMLElement {
  return { isConnected: connected } as unknown as HTMLElement
}

function makeRecord(id: string): ParagraphIndentOverrideRecord {
  return { id, mode: 'force-indent', anchor: { lastKnownOrdinal: 0 }, temporary: true }
}

describe('ParagraphCanonicalRegistry — scope authority (DS)', () => {
  it('DS-5: post-switch REGISTER_CURRENT carries scopeId=B / persistenceKey=B', () => {
    const r = new ParagraphCanonicalRegistry('sess-ds')
    const meta = r.registerCurrentSessionRecord(
      makeRecord('rec-b'), 'B', mockEl(), 'rt-b', true, 'B', 'B',
    )
    expect(meta.scopeId).toBe('B')
    expect(meta.persistenceKey).toBe('B')
    expect(meta.documentKey).toBe('B')
    expect(meta.state).toBe('CURRENT_LIVE')
  })

  it('DS-6: document switch retires old current-session owners (A → B)', () => {
    const r = new ParagraphCanonicalRegistry('sess-ds')
    r.registerCurrentSessionRecord(makeRecord('rec-a'), 'A', mockEl(), 'rt-a', true, 'A', 'A')

    r.clearDocumentBindings('B')

    const meta = r.getRuntimeMeta('rec-a')
    expect(meta).not.toBeNull()
    expect(meta!.state).toBe('CURRENT_RETIRED')
  })

  it('DS-7: cross-scope canonical mutation is hard-stopped', () => {
    const r = new ParagraphCanonicalRegistry('sess-ds')
    expect(r.assertCanonicalScope('A', 'B', 'TRANSFER', 'rec-1')).toBe(false)
    expect(r.assertCanonicalScope('A', 'A', 'TRANSFER', 'rec-1')).toBe(true)
  })

  it('DS-8: historical load stays PERSISTED_HISTORICAL (never CURRENT_LIVE)', () => {
    const r = new ParagraphCanonicalRegistry('sess-ds')
    const meta = r.registerPersistedHistorical(makeRecord('rec-h'), 'A')
    expect(meta.state).toBe('PERSISTED_HISTORICAL')
    expect(meta.origin).toBe('persisted-load')
    expect(meta.state).not.toBe('CURRENT_LIVE')
    expect(meta.state).not.toBe('CURRENT_AWAITING_TRANSFER')
  })
})

describe('ParagraphCanonicalRegistry — rebindCurrentLiveRecord lease (D)', () => {
  it('D-REBIND-1: valid lease → rebind success, generation+1, recordCount preserved', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    const el1 = mockEl(true)
    const meta = r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', el1, 'rt-1', true, 'scope-a', 'doc-a')
    const genBefore = meta.generation
    const el2 = mockEl(true)

    const ok = r.rebindCurrentLiveRecord('rec-1', el2, 'rt-2', {
      scopeId: 'scope-a',
      documentKey: 'doc-a',
      expectedGeneration: genBefore,
      expectedOldRuntimeId: 'rt-1',
    })

    expect(ok).toBe(true)
    const after = r.getRuntimeMeta('rec-1')!
    expect(after.state).toBe('CURRENT_LIVE')
    expect(after.currentRuntimeId).toBe('rt-2')
    expect(after.generation).toBe(genBefore + 1)
    expect(r.resolveByRuntimeId('rt-1')).toBeNull()
    expect(r.resolveByRuntimeId('rt-2')?.recordId).toBe('rec-1')
    expect(r.resolveExactLiveRecord(el1)).toBeNull()
    expect(r.resolveExactLiveRecord(el2)?.recordId).toBe('rec-1')
  })

  it('D-REBIND-2: scope mismatch → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    const meta = r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-WRONG', documentKey: 'doc-a', expectedGeneration: meta.generation, expectedOldRuntimeId: 'rt-1',
    })
    expect(ok).toBe(false)
    expect(r.getRuntimeMeta('rec-1')!.currentRuntimeId).toBe('rt-1')
  })

  it('D-REBIND-3: documentKey mismatch → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    const meta = r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-a', documentKey: 'doc-WRONG', expectedGeneration: meta.generation, expectedOldRuntimeId: 'rt-1',
    })
    expect(ok).toBe(false)
  })

  it('D-REBIND-4: expectedGeneration mismatch → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    const meta = r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-a', documentKey: 'doc-a', expectedGeneration: meta.generation + 1, expectedOldRuntimeId: 'rt-1',
    })
    expect(ok).toBe(false)
  })

  it('D-REBIND-5: expectedOldRuntimeId mismatch → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    const meta = r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-a', documentKey: 'doc-a', expectedGeneration: meta.generation, expectedOldRuntimeId: 'rt-WRONG',
    })
    expect(ok).toBe(false)
  })

  it('D-REBIND-6: runtime collision (new runtimeId owned by another record) → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    const meta2 = r.registerCurrentSessionRecord(makeRecord('rec-2'), 'doc-a', mockEl(true), 'rt-2', true, 'scope-a', 'doc-a')

    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-a', documentKey: 'doc-a', expectedGeneration: meta2.generation, expectedOldRuntimeId: 'rt-1',
    })
    expect(ok).toBe(false)
    expect(r.getRuntimeMeta('rec-1')!.currentRuntimeId).toBe('rt-1')
    expect(r.getRuntimeMeta('rec-2')!.currentRuntimeId).toBe('rt-2')
  })

  it('D-REBIND-7: non-CURRENT_LIVE state → BLOCK', () => {
    const r = new ParagraphCanonicalRegistry('sess-rebind')
    r.registerCurrentSessionRecord(makeRecord('rec-1'), 'doc-a', mockEl(true), 'rt-1', true, 'scope-a', 'doc-a')
    r.markAwaitingTransfer('rec-1', undefined, 'split', 'scope-a')

    const ok = r.rebindCurrentLiveRecord('rec-1', mockEl(true), 'rt-2', {
      scopeId: 'scope-a', documentKey: 'doc-a', expectedOldRuntimeId: 'rt-1',
    })
    expect(ok).toBe(false)
  })
})
