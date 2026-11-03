import { describe, it, expect } from 'vitest'
import { cacheQuotaBytes, planCacheEviction, type CacheEntry } from './image-cache-policy'

function entry(name: string, sizeBytes: number, lastAccessedAt: string, pinned = false): CacheEntry {
  return { locator: name, sizeBytes, lastAccessedAt, pinned }
}

describe('planCacheEviction', () => {
  it('keeps everything when the cache is under budget', () => {
    const plan = planCacheEviction([
      entry('a', 100, '2026-01-01T00:00:00Z'),
      entry('b', 100, '2026-01-02T00:00:00Z'),
    ], 1000)
    expect(plan.evict).toEqual([])
    expect(plan.retainedBytes).toBe(200)
  })

  it('evicts least recently used entries first', () => {
    const plan = planCacheEviction([
      entry('newest', 100, '2026-01-03T00:00:00Z'),
      entry('oldest', 100, '2026-01-01T00:00:00Z'),
      entry('middle', 100, '2026-01-02T00:00:00Z'),
    ], 150)
    expect(plan.evict.map(item => item.locator)).toEqual(['oldest', 'middle'])
    expect(plan.retainedBytes).toBe(100)
    expect(plan.evictedBytes).toBe(200)
  })

  it('never evicts or counts pinned offline resources', () => {
    const plan = planCacheEviction([
      entry('pinned', 10_000, '2020-01-01T00:00:00Z', true),
      entry('cache', 100, '2026-01-01T00:00:00Z'),
    ], 50)
    expect(plan.evict.map(item => item.locator)).toEqual(['cache'])
    expect(plan.retainedBytes).toBe(0)
  })

  it('evicts a single object that exceeds the limit', () => {
    const plan = planCacheEviction([entry('huge', 1000, '2026-01-01T00:00:00Z')], 100)
    expect(plan.evict.map(item => item.locator)).toEqual(['huge'])
    expect(plan.retainedBytes).toBe(0)
  })

  it('treats non-positive quota as cache disabled', () => {
    const plan = planCacheEviction([
      entry('a', 100, '2026-01-01T00:00:00Z'),
      entry('b', 100, '2026-01-02T00:00:00Z'),
    ], 0)
    expect(plan.evict).toHaveLength(2)
    expect(plan.retainedBytes).toBe(0)
  })

  it('orders ties deterministically by locator', () => {
    const plan = planCacheEviction([
      entry('b', 100, '2026-01-01T00:00:00Z'),
      entry('a', 100, '2026-01-01T00:00:00Z'),
    ], 100)
    expect(plan.evict.map(item => item.locator)).toEqual(['a'])
  })
})

describe('cacheQuotaBytes', () => {
  it('converts megabytes to bytes and treats invalid values as zero', () => {
    expect(cacheQuotaBytes(512)).toBe(512 * 1024 * 1024)
    expect(cacheQuotaBytes(0.0001)).toBe(104)
    expect(cacheQuotaBytes(0)).toBe(0)
    expect(cacheQuotaBytes(Number.NaN)).toBe(0)
  })
})
