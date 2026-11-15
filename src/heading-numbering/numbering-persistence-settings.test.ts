import { describe, it, expect } from 'vitest'
import {
  createDefaultNumberingPersistenceConfig,
  getDocumentOwnership,
  normalizeNumberingPersistenceConfig,
  resolveNumberingPersistenceSettings,
  withDocumentOwnership,
  withNumberingPersistenceSettings,
} from './numbering-persistence-settings'

describe('R08 — persistence settings store', () => {
  it('fills defaults for an empty config', () => {
    const config = normalizeNumberingPersistenceConfig(null)
    expect(config.global.storageMode).toBe('render')
    expect(config.global.existingNumberPolicy).toBe('detect-only')
    expect(config.global.syncTiming).toBe('manual')
    expect(config.global.dedupeProjectedNumbers).toBe(true)
  })

  it('rejects invalid persisted values', () => {
    const config = normalizeNumberingPersistenceConfig({
      global: { storageMode: 'bogus', existingNumberPolicy: 'x', syncTiming: 'y', dedupeProjectedNumbers: 'yes' },
    })
    expect(config.global).toEqual(createDefaultNumberingPersistenceConfig().global)
  })

  it('resolves per-document overrides field by field', () => {
    const config = withNumberingPersistenceSettings(
      createDefaultNumberingPersistenceConfig(),
      { storageMode: 'source' },
      'document',
      'docs/a.md',
    )
    const resolved = resolveNumberingPersistenceSettings(config, 'docs/a.md')
    expect(resolved.storageMode).toBe('source')
    expect(resolved.existingNumberPolicy).toBe('detect-only')
    expect(resolveNumberingPersistenceSettings(config, 'docs/b.md').storageMode).toBe('render')
  })

  it('writes the ownership ledger immutably', () => {
    const base = createDefaultNumberingPersistenceConfig()
    const next = withDocumentOwnership(base, 'docs/a.md', {
      id: { identity: 'id', ownership: 'inkchapter', numberText: '1', updatedAt: 1 },
    })
    expect(base.ownership['docs/a.md']).toBeUndefined()
    expect(getDocumentOwnership(next, 'docs/a.md').id.numberText).toBe('1')
    expect(getDocumentOwnership(next, null)).toEqual({})
  })

  it('normalizes ownership records defensively', () => {
    const config = normalizeNumberingPersistenceConfig({
      ownership: {
        'a.md': {
          id: { identity: 'id', ownership: 'unknown', numberText: 5, updatedAt: 'x' },
        },
      },
    })
    expect(config.ownership['a.md'].id).toEqual({
      identity: 'id',
      ownership: 'unresolved',
      numberText: '',
      updatedAt: 0,
    })
  })
})
