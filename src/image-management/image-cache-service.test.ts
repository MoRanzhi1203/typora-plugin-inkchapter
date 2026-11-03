import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { ImageCacheService } from './image-cache-service'
import type { ImageSettings } from './image-settings'
import type { FetchLike } from './image-remote-fetch'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-cache-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

type PathSettings = Pick<
  ImageSettings,
  'globalLibrary' | 'cache' | 'offline' | 'uploadStaging' | 'database'
>

function settings(overrides: Partial<PathSettings> = {}): PathSettings {
  return {
    globalLibrary: { mode: 'off', root: '' },
    cache: { mode: 'smart', root: '', maxSizeMB: 512 },
    offline: { root: '' },
    uploadStaging: { root: '' },
    database: { root: '' },
    ...overrides,
  }
}

function makePaths(root: string, cacheSettings = settings().cache) {
  return resolveImageDataPaths(root, {
    settings: settings({ cache: cacheSettings }),
    env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
  })
}

function bytesOf(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index++) bytes[index] = (seed + index) % 256
  return bytes
}

function clock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++))
}

function fakeFetch(entries: Record<string, { bytes?: Uint8Array; contentType?: string; status?: number }>): FetchLike {
  return async (input: string) => {
    const entry = entries[input]
    if (!entry || entry.status === 404) return new Response('not found', { status: 404 })
    return new Response(entry.bytes ?? new Uint8Array([1, 2, 3]), {
      status: entry.status ?? 200,
      headers: { 'content-type': entry.contentType ?? 'image/png' },
    })
  }
}

describe('ImageCacheService', () => {
  it('caches a remote image once and reuses the cached object', async () => {
    const root = await makeRoot()
    const url = 'https://example.test/a.png'
    const service = new ImageCacheService({
      paths: makePaths(root),
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({ [url]: { bytes: bytesOf(10) } }),
    })

    const first = await service.cacheRemoteImage({ url })
    expect(first.code).toBe('CACHED')
    expect(first.record?.sizeBytes).toBe(10)
    const filePath = service.filePathFor(first.record!)
    expect(filePath).toBeTruthy()
    expect(await fs.stat(filePath as string)).toBeTruthy()

    const second = await service.cacheRemoteImage({ url })
    expect(second.code).toBe('ALREADY_CACHED')
    expect((await service.statistics()).objectCount).toBe(1)
  })

  it('skips caching when a permanent local copy already exists', async () => {
    const root = await makeRoot()
    const service = new ImageCacheService({
      paths: makePaths(root),
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({}),
    })
    const result = await service.cacheRemoteImage({
      url: 'https://example.test/a.png',
      existingLocal: { locator: 'C:/project/a.png', sha256: 'a'.repeat(64) },
    })
    expect(result.code).toBe('REUSED_LOCAL')
    expect((await service.statistics()).objectCount).toBe(0)
  })

  it('requires explicit approval in manual mode and does nothing when off', async () => {
    const root = await makeRoot()
    const url = 'https://example.test/a.png'
    const fetchImpl = fakeFetch({ [url]: { bytes: bytesOf(5) } })

    const manual = new ImageCacheService({
      paths: makePaths(root, { mode: 'manual', root: '', maxSizeMB: 512 }),
      mode: 'manual',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl,
    })
    expect((await manual.cacheRemoteImage({ url })).code).toBe('MANUAL_REQUIRES_EXPLICIT')
    expect((await manual.cacheRemoteImage({ url, explicit: true })).code).toBe('CACHED')

    const off = new ImageCacheService({
      paths: makePaths(root, { mode: 'off', root: '', maxSizeMB: 512 }),
      mode: 'off',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl,
    })
    expect((await off.cacheRemoteImage({ url })).code).toBe('CACHE_OFF')
  })

  it('rejects unsafe URLs and non-image responses', async () => {
    const root = await makeRoot()
    const paths = makePaths(root)
    const service = new ImageCacheService({
      paths,
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({
        'https://example.test/page.html': { contentType: 'text/html' },
        'https://example.test/big.png': { bytes: bytesOf(2048) },
      }),
    })
    expect((await service.cacheRemoteImage({ url: 'http://127.0.0.1/a.png' })).code).toBe('INVALID_URL')
    expect((await service.cacheRemoteImage({ url: 'https://example.test/page.html' })).code).toBe('DOWNLOAD_FAILED')
    expect((await service.cacheRemoteImage({ url: 'https://example.test/big.png' })).code).toBe('DOWNLOAD_FAILED')
  })

  it('stores identical content once even when referenced by two URLs', async () => {
    const root = await makeRoot()
    const bytes = bytesOf(20)
    const service = new ImageCacheService({
      paths: makePaths(root),
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({
        'https://example.test/a.png': { bytes },
        'https://example.test/b.png': { bytes },
      }),
    })
    await service.cacheRemoteImage({ url: 'https://example.test/a.png' })
    await service.cacheRemoteImage({ url: 'https://example.test/b.png' })
    const stats = await service.statistics()
    expect(stats.objectCount).toBe(1)
    expect(stats.totalBytes).toBe(20)
  })

  it('evicts least-recently-used objects under the quota', async () => {
    const root = await makeRoot()
    const a = 'https://example.test/a.png'
    const b = 'https://example.test/b.png'
    const service = new ImageCacheService({
      paths: makePaths(root),
      mode: 'smart',
      maxSizeMB: 0.0001, // ~104 bytes
      maxDownloadBytes: 1024,
      now: clock(),
      fetchImpl: fakeFetch({
        [a]: { bytes: bytesOf(60, 1) },
        [b]: { bytes: bytesOf(60, 2) },
      }),
    })

    await service.cacheRemoteImage({ url: a })
    await service.cacheRemoteImage({ url: b })
    expect(await service.get(a)).toBeNull()
    expect(await service.get(b)).not.toBeNull()
  })

  it('never evicts protected offline URLs', async () => {
    const root = await makeRoot()
    const a = 'https://example.test/a.png'
    const b = 'https://example.test/b.png'
    const fetchImpl = fakeFetch({
      [a]: { bytes: bytesOf(60, 1) },
      [b]: { bytes: bytesOf(60, 2) },
    })
    const paths = makePaths(root)
    await new ImageCacheService({
      paths,
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl,
    }).cacheRemoteImage({ url: a })

    // b is protected and larger than the quota: only unprotected a may be evicted.
    const small = new ImageCacheService({
      paths,
      mode: 'smart',
      maxSizeMB: 0.00004, // ~41 bytes
      maxDownloadBytes: 1024,
      fetchImpl,
    })
    await small.cacheRemoteImage({ url: b, protectedUrls: new Set([b]) })
    expect(await small.get(b)).not.toBeNull()
    expect(await small.get(a)).toBeNull()
  })
})
