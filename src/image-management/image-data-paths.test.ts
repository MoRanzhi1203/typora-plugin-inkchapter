import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { ImageAssetService } from './image-asset-service'
import type { ImageSettings } from './image-settings'
import { planPathMigration } from './image-path-migration'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-image-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

const ENV = {
  localAppData: path.join('C:', 'LocalAppData'),
  tempDir: path.join('C:', 'Temp'),
}

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

describe('resolveImageDataPaths', () => {
  it('keeps the database and backup inside the plugin data directory', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root, { settings: settings(), env: ENV })
    expect(paths.dataRoot).toBe(path.join(root, 'image'))
    expect(paths.assetIndexFile.endsWith('image-assets.json')).toBe(true)
    expect(paths.backupDir.startsWith(paths.dataRoot)).toBe(true)
    expect(paths.databaseRoot).toBe(paths.dataRoot)
    expect(paths.sources.database).toBe('default')
  })

  it('resolves system defaults without writing personal paths into config', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root, { settings: settings(), env: ENV })
    expect(paths.libraryRoot).toBeNull()
    expect(paths.libraryImagesDir).toBeNull()
    expect(paths.cacheRoot).toBe(path.join(ENV.localAppData, 'InkChapter', 'ImageCache'))
    expect(paths.cacheObjectsDir).toBe(path.join(ENV.localAppData, 'InkChapter', 'ImageCache', 'objects'))
    expect(paths.thumbnailsDir).toBe(path.join(ENV.localAppData, 'InkChapter', 'ImageCache', 'thumbnails'))
    expect(paths.offlineRoot).toBe(path.join(ENV.localAppData, 'InkChapter', 'OfflineAssets'))
    expect(paths.offlineObjectsDir).toBe(path.join(ENV.localAppData, 'InkChapter', 'OfflineAssets', 'objects'))
    expect(paths.offlineManifestsDir).toBe(path.join(ENV.localAppData, 'InkChapter', 'OfflineAssets', 'manifests'))
    expect(paths.stagingRoot).toBe(path.join(ENV.tempDir, 'InkChapter', 'ImageUpload'))
    expect(paths.sources).toMatchObject({
      library: 'disabled',
      cache: 'default',
      offline: 'default',
      staging: 'default',
    })
  })

  it('honours explicit overrides and reports their source', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root, {
      settings: settings({
        globalLibrary: { mode: 'archive', root: path.join('D:', 'Library') },
        cache: { mode: 'manual', root: path.join('D:', 'Cache'), maxSizeMB: 256 },
        offline: { root: path.join('D:', 'Offline') },
        uploadStaging: { root: path.join('D:', 'Stage') },
        database: { root: path.join('D:', 'Db') },
      }),
      env: ENV,
    })
    expect(paths.libraryRoot).toBe(path.join('D:', 'Library'))
    expect(paths.libraryImagesDir).toBe(path.join('D:', 'Library', 'images'))
    expect(paths.cacheRoot).toBe(path.join('D:', 'Cache'))
    expect(paths.offlineRoot).toBe(path.join('D:', 'Offline'))
    expect(paths.stagingRoot).toBe(path.join('D:', 'Stage'))
    expect(paths.databaseRoot).toBe(path.join('D:', 'Db'))
    expect(Object.values(paths.sources).every(source => source === 'override')).toBe(true)
  })

  it('disables cache directories when the cache mode is off', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root, {
      settings: settings({ cache: { mode: 'off', root: '', maxSizeMB: 512 } }),
      env: ENV,
    })
    expect(paths.cacheRoot).toBeNull()
    expect(paths.cacheObjectsDir).toBeNull()
    expect(paths.thumbnailsDir).toBeNull()
    expect(paths.sources.cache).toBe('disabled')
  })

  it('does not create any directory during resolution', async () => {
    const root = await makeRoot()
    resolveImageDataPaths(root, { settings: settings(), env: ENV })
    await expect(fs.access(path.join(root, 'image'))).rejects.toThrow()
  })

  it('rejects an empty plugin data path', () => {
    expect(() => resolveImageDataPaths('  ')).toThrow()
  })
})

describe('ImageAssetService', () => {
  it('loads lazily and persists through the resolved index path', async () => {
    const root = await makeRoot()
    const service = new ImageAssetService(resolveImageDataPaths(root))
    const imagePath = path.join(root, 'a.png')
    await fs.writeFile(imagePath, 'hello')

    expect(await service.list()).toEqual([])
    const upserted = await service.upsertLocalFile({ filePath: imagePath })
    expect(upserted.created).toBe(true)
    expect(await fs.stat(service.getIndexPath())).toBeTruthy()

    const reloaded = new ImageAssetService(resolveImageDataPaths(root))
    expect(await reloaded.list()).toHaveLength(1)
    reloaded.dispose()
    service.dispose()
  })

  it('surfaces a corrupt index instead of rebuilding it', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root)
    await fs.mkdir(path.dirname(paths.assetIndexFile), { recursive: true })
    await fs.writeFile(paths.assetIndexFile, 'not json', 'utf8')

    const service = new ImageAssetService(paths)
    await expect(service.list()).rejects.toMatchObject({ code: 'INDEX_CORRUPT' })
    expect(await fs.readFile(paths.assetIndexFile, 'utf8')).toBe('not json')
    service.dispose()
  })

  it('backs up the index and rewrites locations after a successful migration', async () => {
    const root = await makeRoot()
    const service = new ImageAssetService(resolveImageDataPaths(root))
    const sourceRoot = path.join(root, 'library')
    await fs.mkdir(sourceRoot, { recursive: true })
    const sourceFile = path.join(sourceRoot, 'a.png')
    await fs.writeFile(sourceFile, 'hello')
    await service.upsertLocalFile({ filePath: sourceFile, locationType: 'library' })

    const targetRoot = path.join(root, 'new-library')
    const plan = await planPathMigration({ role: 'library', fromRoot: sourceRoot, toRoot: targetRoot })
    const result = await service.applyPathMigration(plan)

    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(result.indexUpdated).toBe(1)
    expect(await fs.readFile(path.join(targetRoot, 'a.png'), 'utf8')).toBe('hello')
    const asset = (await service.list())[0]
    expect(asset.locations[0].locator).toBe(path.join(targetRoot, 'a.png'))
    service.dispose()
  })

  it('rejects use after dispose', async () => {
    const root = await makeRoot()
    const service = new ImageAssetService(resolveImageDataPaths(root))
    service.dispose()
    await expect(service.list()).rejects.toThrow()
  })
})
