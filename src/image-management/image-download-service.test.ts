import { describe, expect, it, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { resolveImageSettings } from './image-settings'
import { ImageAssetService } from './image-asset-service'
import { ImageTransferTaskStore } from './image-transfer-task-store'
import { ImageDownloadService, sniffImageFormat, type ImageDownloadServiceOptions } from './image-download-service'
import type { FetchLike } from './image-remote-fetch'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

function imageResponse(bytes: Uint8Array = PNG, status = 200): Response {
  return new Response(bytes.slice(), {
    status,
    headers: { 'content-type': 'image/png' },
  })
}

async function setup(fetchImpl?: FetchLike) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-download-'))
  roots.push(root)
  const settings = resolveImageSettings({ enabled: true, initialized: true })
  const paths = resolveImageDataPaths(root, {
    settings,
    env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
  })
  const assets = new ImageAssetService(paths)
  const tasks = new ImageTransferTaskStore(path.join(paths.dataRoot, 'tasks.json'))
  const projectDirectory = path.join(root, 'project', 'assets', 'images')
  let fetchCount = 0
  const fetcher: FetchLike = async (input, init) => {
    fetchCount++
    return (fetchImpl ?? (async () => imageResponse()))(input, init)
  }
  const options: ImageDownloadServiceOptions = {
    paths,
    assets,
    tasks,
    fetchImpl: fetcher,
    now: () => new Date('2026-11-04T00:00:00.000Z'),
  }
  const service = new ImageDownloadService(options)
  return {
    root,
    paths,
    assets,
    tasks,
    service,
    projectDirectory,
    documentPath: path.join(root, 'doc.md'),
    fetchCount: () => fetchCount,
  }
}

describe('sniffImageFormat', () => {
  it('detects real image headers instead of trusting MIME', () => {
    expect(sniffImageFormat(PNG)).toBe('png')
    expect(sniffImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImageFormat(new TextEncoder().encode('<svg xmlns="..."></svg>'))).toBe('svg')
    expect(sniffImageFormat(new TextEncoder().encode('<html>not image</html>'))).toBeNull()
  })
})

describe('ImageDownloadService', () => {
  it('downloads a remote image into the project image directory and records a local location', async () => {
    const h = await setup()
    const result = await h.service.download({
      url: 'https://example.test/images/a.png',
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })

    expect(result.ok).toBe(true)
    expect(result.filePath).toBe(path.join(h.projectDirectory, 'a.png'))
    await expect(fs.readFile(result.filePath!)).resolves.toEqual(Buffer.from(PNG))
    expect(result.assetId).toBeTruthy()
    expect(result.locationId).toBeTruthy()
    expect(result.reused).toBe(false)
    expect(result.taskId).toBeTruthy()

    const assets = await h.assets.list()
    const asset = assets.find(item => item.assetId === result.assetId)!
    expect(asset.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'project', locator: result.filePath, availability: 'available' }),
    ]))
    const tasks = await h.tasks.list()
    expect(tasks[0]).toEqual(expect.objectContaining({
      kind: 'download',
      status: 'succeeded',
      locationId: result.locationId,
    }))
  })

  it('reuses an existing local copy instead of downloading again', async () => {
    const h = await setup()
    const input = {
      url: 'https://example.test/images/a.png',
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project' as const,
    }
    const first = await h.service.download(input)
    const second = await h.service.download(input)

    expect(first.ok && second.ok).toBe(true)
    expect(h.fetchCount()).toBe(1)
    expect(second.reused).toBe(true)
    expect(second.filePath).toBe(first.filePath)
  })

  it('never overwrites a same-name file with different content', async () => {
    const h = await setup()
    await fs.mkdir(h.projectDirectory, { recursive: true })
    const existing = path.join(h.projectDirectory, 'a.png')
    const existingBytes = Uint8Array.from([...PNG, 9, 9, 9])
    await fs.writeFile(existing, existingBytes)

    const result = await h.service.download({
      url: 'https://example.test/images/a.png',
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })
    expect(result.ok && result.filePath).toBeTruthy()
    expect(result.filePath).not.toBe(existing)
    expect(path.basename(result.filePath!)).toMatch(/^a-[0-9a-f]{8}\.png$/)
    await expect(fs.readFile(existing)).resolves.toEqual(Buffer.from(existingBytes))
  })

  it('rejects private-network URLs before touching the network', async () => {
    const h = await setup()
    const blocked = await h.service.download({
      url: 'http://127.0.0.1/a.png',
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })
    expect(blocked).toEqual(expect.objectContaining({ ok: false, code: 'INVALID_URL' }))
    expect(h.fetchCount()).toBe(0)
  })

  it('rejects fake image bytes', async () => {
    const h = await setup(async () => imageResponse(new TextEncoder().encode('<html>nope</html>')))
    const result = await h.service.download({
      url: 'https://example.test/a.png',
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'INVALID_IMAGE_BYTES' }))
  })

  it('rejects unavailable library targets and relative custom directories', async () => {
    const h = await setup()
    const library = await h.service.download({
      url: 'https://example.test/a.png',
      placement: 'library',
    })
    expect(library).toEqual(expect.objectContaining({ ok: false, code: 'DESTINATION_UNAVAILABLE' }))

    const relative = await h.service.download({
      url: 'https://example.test/a.png',
      placement: 'custom',
      customDirectory: 'relative/dir',
    })
    expect(relative).toEqual(expect.objectContaining({ ok: false, code: 'DESTINATION_INVALID' }))
  })

  it('deduplicates concurrent downloads of the same target', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    const h = await setup(async () => {
      await new Promise<void>(resolve => { gate.release = resolve })
      return imageResponse()
    })
    const input = {
      url: 'https://example.test/images/a.png',
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project' as const,
    }
    const p1 = h.service.download(input)
    const p2 = h.service.download(input)
    expect(p1).toBe(p2)
    // 等待真正的网络阶段开始（预检/哈希是异步的，固定 0ms 在满载时会漏等）。
    const deadline = Date.now() + 5000
    while (!gate.release && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    gate.release?.()
    await p1
    expect(h.fetchCount()).toBe(1)
  })

  it('sanitizes traversal filenames so the file stays inside the target directory', async () => {
    const h = await setup()
    const result = await h.service.download({
      url: 'https://example.test/images/..%2F..%2Fevil.png',
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })
    expect(result.ok).toBe(true)
    expect(result.filePath!.startsWith(h.projectDirectory)).toBe(true)
    expect(path.basename(result.filePath!)).toBe('evil.png')
  })

  it('reuses an already indexed project copy with zero network and zero copies', async () => {
    const h = await setup()
    const url = 'https://example.test/images/a.png'
    const projectFile = path.join(h.projectDirectory, 'a.png')
    await fs.mkdir(h.projectDirectory, { recursive: true })
    await fs.writeFile(projectFile, PNG)
    const upserted = await h.assets.upsertLocalFile({ filePath: projectFile, locationType: 'project' })
    await h.assets.recordLocation({
      assetId: upserted.asset.assetId,
      type: 'github',
      locator: url,
    })

    const result = await h.service.download({
      url,
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })

    expect(result.ok).toBe(true)
    expect(result.resultKind).toBe('REUSED_LOCAL')
    expect(result.networkTransfers).toBe(0)
    expect(result.localCopies).toBe(0)
    expect(h.fetchCount()).toBe(0)
    expect(result.filePath).toBe(projectFile)
    const tasks = await h.tasks.list()
    expect(tasks[0]).toEqual(expect.objectContaining({ status: 'succeeded', resultKind: 'REUSED_LOCAL' }))
  })

  it('copies a verified library copy into the project without network access', async () => {
    const h = await setup()
    const url = 'https://example.test/images/a.png'
    const libraryFile = path.join(h.root, 'library', 'a.png')
    await fs.mkdir(path.dirname(libraryFile), { recursive: true })
    await fs.writeFile(libraryFile, PNG)
    const upserted = await h.assets.upsertLocalFile({ filePath: libraryFile, locationType: 'library' })
    await h.assets.recordLocation({ assetId: upserted.asset.assetId, type: 'github', locator: url })

    const result = await h.service.download({
      url,
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })

    expect(result.ok).toBe(true)
    expect(result.resultKind).toBe('COPIED_EXISTING_LOCAL')
    expect(result.networkTransfers).toBe(0)
    expect(result.localCopies).toBe(1)
    expect(h.fetchCount()).toBe(0)
    await expect(fs.readFile(result.filePath!)).resolves.toEqual(Buffer.from(PNG))
    expect(result.filePath).toBe(path.join(h.projectDirectory, 'a.png'))
  })

  it('re-downloads when an indexed local file was modified and marks that location missing', async () => {
    const h = await setup()
    const url = 'https://example.test/images/a.png'
    const projectFile = path.join(h.projectDirectory, 'a.png')
    await fs.mkdir(h.projectDirectory, { recursive: true })
    await fs.writeFile(projectFile, PNG)
    const upserted = await h.assets.upsertLocalFile({ filePath: projectFile, locationType: 'project' })
    await h.assets.recordLocation({ assetId: upserted.asset.assetId, type: 'github', locator: url })

    const tampered = Uint8Array.from([...PNG, 9, 9, 9])
    await fs.writeFile(projectFile, tampered)

    const result = await h.service.download({
      url,
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })

    expect(result.ok).toBe(true)
    expect(result.resultKind).toBe('DOWNLOADED_NEW')
    expect(result.networkTransfers).toBe(1)
    expect(h.fetchCount()).toBe(1)
    expect(result.filePath).not.toBe(projectFile)
    expect(path.basename(result.filePath!)).toMatch(/^a-[0-9a-f]{8}\.png$/)
    // 被修改的旧文件绝不覆盖。
    await expect(fs.readFile(projectFile)).resolves.toEqual(Buffer.from(tampered))

    const asset = (await h.assets.list()).find(item => item.assetId === result.assetId)!
    const stale = asset.locations.find(location => location.locator === projectFile)
    expect(stale?.availability).toBe('missing')
  })

  it('does not trust a cache entry whose bytes no longer match the asset', async () => {
    const h = await setup()
    const url = 'https://example.test/images/a.png'
    const cacheFile = path.join(h.root, 'cache', 'a.png')
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, PNG)
    const upserted = await h.assets.upsertLocalFile({ filePath: cacheFile, locationType: 'cache' })
    await h.assets.recordLocation({ assetId: upserted.asset.assetId, type: 'github', locator: url })
    await fs.writeFile(cacheFile, Uint8Array.from([...PNG, 7]))

    const result = await h.service.download({
      url,
      documentPath: h.documentPath,
      projectDirectory: h.projectDirectory,
      placement: 'project',
    })

    expect(result.ok).toBe(true)
    expect(result.resultKind).toBe('DOWNLOADED_NEW')
    expect(h.fetchCount()).toBe(1)
  })
})
