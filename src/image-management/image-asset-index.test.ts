import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ImageAssetIndex,
  ImageIndexError,
  assetStorageState,
  guessMimeType,
  sha256File,
} from './image-asset-index'
import { pickReusableLocalLocation } from './image-asset-model'

const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

let root = ''
let index: ImageAssetIndex

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-image-index-'))
  index = new ImageAssetIndex(path.join(root, 'index', 'images.json'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function writeFile(name: string, content: string): Promise<string> {
  const filePath = path.join(root, name)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  return filePath
}

describe('sha256File', () => {
  it('hashes file content and reports the real size', async () => {
    const filePath = await writeFile('a.png', 'hello')
    await expect(sha256File(filePath)).resolves.toEqual({ sha256: HELLO_SHA256, sizeBytes: 5 })
  })

  it('rejects a missing file', async () => {
    await expect(sha256File(path.join(root, 'missing.png'))).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    })
  })

  it('rejects a directory', async () => {
    const dir = path.join(root, 'folder.png')
    await fs.mkdir(dir)
    await expect(sha256File(dir)).rejects.toMatchObject({ code: 'FILE_NOT_READABLE' })
  })
})

describe('guessMimeType', () => {
  it('maps known image extensions case-insensitively', () => {
    expect(guessMimeType('a.PNG')).toBe('image/png')
    expect(guessMimeType('a.jpeg')).toBe('image/jpeg')
    expect(guessMimeType('a.svg')).toBe('image/svg+xml')
    expect(guessMimeType('a.txt')).toBeNull()
  })
})

describe('ImageAssetIndex', () => {
  it('starts empty when the index file does not exist', async () => {
    await index.load()
    expect(index.list()).toEqual([])
  })

  it('creates one asset per unique content', async () => {
    const first = await writeFile('a.png', 'hello')
    const second = await writeFile('nested/b.png', 'hello')
    const third = await writeFile('c.png', 'world')

    const a = await index.upsertLocalFile({ filePath: first, now: new Date('2026-01-01T00:00:00Z') })
    const b = await index.upsertLocalFile({ filePath: second })
    const c = await index.upsertLocalFile({ filePath: third })

    expect(a.created).toBe(true)
    expect(a.asset.assetId).toBe(`img_${HELLO_SHA256.slice(0, 16)}`)
    expect(a.asset.mimeType).toBe('image/png')
    expect(b.created).toBe(false)
    expect(b.asset.assetId).toBe(a.asset.assetId)
    expect(c.created).toBe(true)
    expect(c.asset.sha256).not.toBe(a.asset.sha256)
    expect(index.list()).toHaveLength(2)
  })

  it('keeps the first local path canonical and records the second as another location', async () => {
    const first = await writeFile('a.png', 'hello')
    const second = await writeFile('b.png', 'hello')
    await index.upsertLocalFile({ filePath: first })
    const duplicate = await index.upsertLocalFile({ filePath: second })
    expect(duplicate.asset.localPath).toBe(first)
    expect(duplicate.asset.locations).toHaveLength(2)
    expect(index.findByLocalPath(second)?.assetId).toBe(duplicate.asset.assetId)
    expect(index.findByLocalPath(first)?.sha256).toBe(HELLO_SHA256)
  })

  it('records project and library locations separately with derived storage state', async () => {
    const filePath = await writeFile('a.png', 'hello')
    const { asset } = await index.upsertLocalFile({ filePath, locationType: 'project' })
    await index.upsertLocalFile({ filePath, locationType: 'library', bindingId: 'lib-1', relativePath: 'images/a.png' })
    const remote = await index.recordRemoteLocation({
      assetId: asset.assetId,
      remoteProfileId: 'p1',
      branch: 'main',
      remotePath: 'images/a.png',
      remoteUrl: 'https://example.test/a.png',
    })
    expect(remote.locations.map(location => location.type).sort()).toEqual(['github', 'library', 'project'])
    expect(assetStorageState(remote)).toBe('DUAL_AVAILABLE')
    expect(pickReusableLocalLocation(remote.locations)?.type).toBe('library')
  })

  it('updates location availability without deleting the record', async () => {
    const filePath = await writeFile('a.png', 'hello')
    const { asset } = await index.upsertLocalFile({ filePath })
    const locationId = asset.locations[0].locationId
    const updated = await index.updateLocationAvailability(locationId, 'missing', new Date('2026-03-01T00:00:00Z'))
    expect(updated.locations[0].availability).toBe('missing')
    expect(updated.locations[0].lastCheckedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(updated.locations).toHaveLength(1)
  })

  it('rewrites local locations after a directory migration and keeps remote ones', async () => {
    const filePath = await writeFile(path.join('library', 'a.png'), 'hello')
    const { asset } = await index.upsertLocalFile({ filePath, locationType: 'library' })
    await index.recordRemoteLocation({
      assetId: asset.assetId,
      remoteProfileId: 'p1',
      branch: 'main',
      remotePath: 'images/a.png',
      remoteUrl: 'https://example.test/a.png',
    })

    const updated = await index.rewriteLocalLocationRoot(
      path.join(root, 'library'),
      path.join(root, 'new-library'),
    )
    expect(updated).toBe(1)

    const reloaded = index.get(asset.assetId)
    expect(reloaded?.locations.find(location => location.type === 'library')?.locator)
      .toBe(path.join(root, 'new-library', 'a.png'))
    expect(reloaded?.remoteLocations).toHaveLength(1)
    expect(reloaded?.remoteLocations[0].remoteUrl).toBe('https://example.test/a.png')
  })

  it('persists assets and reloads them from disk', async () => {
    const filePath = await writeFile('a.png', 'hello')
    await index.upsertLocalFile({ filePath })

    const reloaded = new ImageAssetIndex(index.getIndexPath())
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.findBySha256(HELLO_SHA256)?.filename).toBe('a.png')
  })

  it('records remote locations and replaces the same profile + path', async () => {
    const filePath = await writeFile('a.png', 'hello')
    const { asset } = await index.upsertLocalFile({ filePath })

    const first = await index.recordRemoteLocation({
      assetId: asset.assetId,
      remoteProfileId: 'p1',
      branch: 'main',
      remotePath: 'images/a.png',
      remoteUrl: 'https://example.test/1.png',
      now: new Date('2026-02-01T00:00:00Z'),
    })
    expect(first.remoteLocations).toHaveLength(1)

    const replaced = await index.recordRemoteLocation({
      assetId: asset.assetId,
      remoteProfileId: 'p1',
      branch: 'main',
      remotePath: 'images/a.png',
      remoteUrl: 'https://example.test/2.png',
      now: new Date('2026-02-02T00:00:00Z'),
    })
    expect(replaced.remoteLocations).toHaveLength(1)
    expect(replaced.remoteLocations[0].remoteUrl).toBe('https://example.test/2.png')

    const added = await index.recordRemoteLocation({
      assetId: asset.assetId,
      remoteProfileId: 'p2',
      branch: 'main',
      remotePath: 'images/a.png',
      remoteUrl: 'https://example.test/3.png',
    })
    expect(added.remoteLocations).toHaveLength(2)
  })

  it('rejects remote locations for an unknown asset', async () => {
    await index.load()
    await expect(index.recordRemoteLocation({
      assetId: 'img_missing',
      remoteProfileId: 'p1',
      branch: 'main',
      remotePath: 'a.png',
      remoteUrl: 'https://example.test/a.png',
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' })
  })

  it('serializes concurrent imports of the same content', async () => {
    const first = await writeFile('a.png', 'hello')
    const second = await writeFile('b.png', 'hello')
    const results = await Promise.all([
      index.upsertLocalFile({ filePath: first }),
      index.upsertLocalFile({ filePath: second }),
    ])
    expect(index.list()).toHaveLength(1)
    expect(results.filter(result => result.created)).toHaveLength(1)
  })

  it('migrates a schema v1 index into the unified location model', async () => {
    const indexPath = index.getIndexPath()
    await fs.mkdir(path.dirname(indexPath), { recursive: true })
    await fs.writeFile(indexPath, JSON.stringify({
      schemaVersion: 1,
      assets: [{
        assetId: 'img_legacy',
        sha256: HELLO_SHA256,
        filename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 5,
        width: null,
        height: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        localPath: 'C:/docs/assets/a.png',
        remoteLocations: [{
          remoteProfileId: 'p1',
          branch: 'main',
          remotePath: 'images/a.png',
          remoteUrl: 'https://example.test/a.png',
          uploadedAt: '2026-01-03T00:00:00.000Z',
        }],
      }],
    }, null, 2), 'utf8')

    const migrated = new ImageAssetIndex(indexPath)
    await migrated.load()
    const asset = migrated.get('img_legacy')
    expect(asset?.locations).toHaveLength(2)
    expect(asset?.localPath).toBe('C:/docs/assets/a.png')
    expect(asset?.remoteLocations[0].remoteUrl).toBe('https://example.test/a.png')
    expect(assetStorageState(asset!)).toBe('DUAL_AVAILABLE')

    await migrated.save()
    const persisted = JSON.parse(await fs.readFile(indexPath, 'utf8'))
    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.assets[0].locations).toHaveLength(2)
    expect('localPath' in persisted.assets[0]).toBe(false)
  })

  it('reports a corrupt index without overwriting it', async () => {
    const indexPath = index.getIndexPath()
    await fs.mkdir(path.dirname(indexPath), { recursive: true })
    await fs.writeFile(indexPath, 'not json', 'utf8')

    const corrupt = new ImageAssetIndex(indexPath)
    await expect(corrupt.load()).rejects.toBeInstanceOf(ImageIndexError)
    await expect(corrupt.load()).rejects.toMatchObject({ code: 'INDEX_CORRUPT' })
    expect(await fs.readFile(indexPath, 'utf8')).toBe('not json')
  })

  it('rejects an unsupported index schema', async () => {
    const indexPath = index.getIndexPath()
    await fs.mkdir(path.dirname(indexPath), { recursive: true })
    await fs.writeFile(indexPath, JSON.stringify({ schemaVersion: 99, assets: [] }), 'utf8')

    const unsupported = new ImageAssetIndex(indexPath)
    await expect(unsupported.load()).rejects.toMatchObject({ code: 'INDEX_CORRUPT' })
  })

  it('does not leak the temporary file after a successful save', async () => {
    const filePath = await writeFile('a.png', 'hello')
    await index.upsertLocalFile({ filePath })
    const entries = await fs.readdir(path.dirname(index.getIndexPath()))
    expect(entries.filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})
