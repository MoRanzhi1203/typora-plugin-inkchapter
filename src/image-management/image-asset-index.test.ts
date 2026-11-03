import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ImageAssetIndex,
  ImageIndexError,
  guessMimeType,
  sha256File,
} from './image-asset-index'

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

  it('keeps the first canonical local path when the same content is imported twice', async () => {
    const first = await writeFile('a.png', 'hello')
    const second = await writeFile('b.png', 'hello')
    await index.upsertLocalFile({ filePath: first })
    const duplicate = await index.upsertLocalFile({ filePath: second })
    expect(duplicate.asset.localPath).toBe(first)
    expect(index.findByLocalPath(second)).toBeNull()
    expect(index.findByLocalPath(first)?.sha256).toBe(HELLO_SHA256)
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
