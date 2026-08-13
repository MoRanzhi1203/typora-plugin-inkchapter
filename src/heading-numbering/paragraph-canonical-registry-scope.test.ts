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
