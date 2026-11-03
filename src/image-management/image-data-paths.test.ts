import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { ImageAssetService } from './image-asset-service'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-image-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

describe('resolveImageDataPaths', () => {
  it('keeps every path inside the plugin data directory', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root)
    expect(paths.root.startsWith(path.join(root, 'image'))).toBe(true)
    expect(paths.assetIndexFile.endsWith('image-assets.json')).toBe(true)
    expect(paths.backupDir.startsWith(paths.root)).toBe(true)
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

  it('rejects use after dispose', async () => {
    const root = await makeRoot()
    const service = new ImageAssetService(resolveImageDataPaths(root))
    service.dispose()
    await expect(service.list()).rejects.toThrow()
  })
})
