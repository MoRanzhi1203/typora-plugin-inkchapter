import { describe, it, expect } from 'vitest'
import {
  resolveReferenceState,
  shouldCacheRemoteReference,
} from './image-reference-state'
import type { AssetLocationRecord } from './image-asset-model'
import { resolveImageDestination } from './image-asset-model'

function location(overrides: Partial<AssetLocationRecord>): AssetLocationRecord {
  return {
    locationId: 'loc_test',
    assetId: 'img_test',
    type: 'project',
    bindingId: null,
    locator: 'C:/docs/a.png',
    relativePath: 'a.png',
    sha256: 'a'.repeat(64),
    availability: 'available',
    lastCheckedAt: null,
    remoteProfileId: null,
    remoteBranch: null,
    remotePath: null,
    remoteVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const remoteRef = resolveImageDestination('https://example.test/a.png', 'C:/docs')
const localRef = resolveImageDestination('assets/a.png', 'C:/docs')

describe('resolveReferenceState', () => {
  it('reports REMOTE_ONLY when only GitHub is available', () => {
    const state = resolveReferenceState(remoteRef, [location({ type: 'github', locator: 'https://example.test/a.png' })])
    expect(state.storageState).toBe('REMOTE_ONLY')
    expect(state.displayState).toBe('remote')
    expect(shouldCacheRemoteReference({ mode: 'smart', state })).toBe(true)
  })

  it('reports LOCAL_ONLY when only a permanent local copy exists', () => {
    const state = resolveReferenceState(localRef, [location({ type: 'project' })])
    expect(state.storageState).toBe('LOCAL_ONLY')
    expect(state.displayState).toBe('local')
    expect(shouldCacheRemoteReference({ mode: 'smart', state })).toBe(false)
  })

  it('reports DUAL_AVAILABLE and never caches', () => {
    const state = resolveReferenceState(remoteRef, [
      location({ type: 'library' }),
      location({ type: 'github', locator: 'https://example.test/a.png' }),
      location({ type: 'cache', locator: 'C:/cache/a.png' }),
    ])
    expect(state.storageState).toBe('DUAL_AVAILABLE')
    expect(state.displayState).toBe('dual')
    expect(shouldCacheRemoteReference({ mode: 'smart', state })).toBe(false)
  })

  it('treats cache as temporary and still reports REMOTE_ONLY', () => {
    const state = resolveReferenceState(remoteRef, [
      location({ type: 'cache', locator: 'C:/cache/a.png' }),
      location({ type: 'github', locator: 'https://example.test/a.png' }),
    ])
    expect(state.storageState).toBe('REMOTE_ONLY')
    expect(state.hasCacheOnly).toBe(true)
    expect(shouldCacheRemoteReference({ mode: 'smart', state })).toBe(false)
  })

  it('shows cache-only and unavailable states', () => {
    const cacheOnly = resolveReferenceState(remoteRef, [location({ type: 'cache', locator: 'C:/cache/a.png' })])
    expect(cacheOnly.displayState).toBe('cache-only')
    expect(resolveReferenceState(remoteRef, []).displayState).toBe('unavailable')
    expect(resolveReferenceState(resolveImageDestination('data:image/png;base64,AA', 'C:/docs'), []).displayState)
      .toBe('non-file')
  })
})

describe('shouldCacheRemoteReference', () => {
  it('never caches when disabled or manual without explicit approval', () => {
    const state = resolveReferenceState(remoteRef, [])
    expect(shouldCacheRemoteReference({ mode: 'off', state })).toBe(false)
    expect(shouldCacheRemoteReference({ mode: 'manual', state })).toBe(false)
    expect(shouldCacheRemoteReference({ mode: 'manual', state, explicit: true })).toBe(true)
  })
})
