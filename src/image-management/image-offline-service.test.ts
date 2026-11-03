import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveImageDataPaths } from './image-data-paths'
import { ImageCacheService } from './image-cache-service'
import { ImageOfflineService } from './image-offline-service'
import type { FetchLike } from './image-remote-fetch'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-offline-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

function makePaths(root: string) {
  return resolveImageDataPaths(root, {
    env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
  })
}

function bytesOf(size: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index++) bytes[index] = (seed + index) % 256
  return bytes
}

function fakeFetch(entries: Record<string, Uint8Array>): FetchLike {
  return async (input: string) => {
    const bytes = entries[input]
    if (!bytes) return new Response('not found', { status: 404 })
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
  }
}

describe('ImageOfflineService', () => {
  it('keeps existing local files and downloads only remote images', async () => {
    const root = await makeRoot()
    const documentDir = path.join(root, 'docs')
    await fs.mkdir(documentDir, { recursive: true })
    const documentPath = path.join(documentDir, 'note.md')
    await fs.writeFile(path.join(documentDir, 'local.png'), 'LOCAL')
    const remoteUrl = 'https://example.test/r.png'
    const paths = makePaths(root)
    const service = new ImageOfflineService({
      paths,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({ [remoteUrl]: bytesOf(30, 7) }),
    })

    const markdown = `![l](local.png)\n\n![r](${remoteUrl})\n`
    const result = await service.prepareDocumentOffline({ markdown, documentPath })
    expect(result.ok).toBe(true)
    expect(result.total).toBe(2)
    expect(result.available).toBe(2)
    expect(result.downloaded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.manifestPath).toBeTruthy()

    const text = await fs.readFile(result.manifestPath as string, 'utf8')
    expect(text).not.toContain(documentDir)
    expect(text).toContain('local.png')

    const verified = await service.verifyDocumentOffline(documentPath)
    expect(verified.ok).toBe(true)
    expect(verified.verified).toBe(1)
  })

  it('reuses a cached object instead of downloading twice', async () => {
    const root = await makeRoot()
    const documentDir = path.join(root, 'docs')
    await fs.mkdir(documentDir, { recursive: true })
    const documentPath = path.join(documentDir, 'note.md')
    const remoteUrl = 'https://example.test/r.png'
    const bytes = bytesOf(25, 3)
    const paths = makePaths(root)
    const cache = new ImageCacheService({
      paths,
      mode: 'smart',
      maxSizeMB: 512,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({ [remoteUrl]: bytes }),
    })
    await cache.cacheRemoteImage({ url: remoteUrl })

    const service = new ImageOfflineService({
      paths,
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({ [remoteUrl]: bytes }),
    })
    const result = await service.prepareDocumentOffline({
      markdown: `![r](${remoteUrl})`,
      documentPath,
      cache,
    })
    expect(result.ok).toBe(true)
    expect(result.reusedCache).toBe(1)
    expect(result.downloaded).toBe(0)

    const verified = await service.verifyDocumentOffline(documentPath)
    expect(verified.ok).toBe(true)
    expect(verified.total).toBe(1)

    // 删除离线对象后，核验必须如实报告缺失。
    const objectRelative = result.manifest?.entries[0].objectRelativePath as string
    await fs.unlink(path.join(paths.offlineRoot, objectRelative))
    const missing = await service.verifyDocumentOffline(documentPath)
    expect(missing.ok).toBe(false)
    expect(missing.missing).toEqual([objectRelative])
  })

  it('reports missing local files and invalid remote URLs as failures', async () => {
    const root = await makeRoot()
    const documentDir = path.join(root, 'docs')
    await fs.mkdir(documentDir, { recursive: true })
    const documentPath = path.join(documentDir, 'note.md')
    const service = new ImageOfflineService({
      paths: makePaths(root),
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({}),
    })

    const result = await service.prepareDocumentOffline({
      markdown: '![missing](missing.png)\n\n![bad](http://127.0.0.1/a.png)',
      documentPath,
    })
    expect(result.ok).toBe(false)
    expect(result.failed).toBe(2)
    expect(result.manifest?.entries.map(entry => entry.reason)).toEqual([
      'LOCAL_MISSING',
      'BLOCKED_HOST',
    ])
  })

  it('creates an offline working copy without touching the original', async () => {
    const root = await makeRoot()
    const documentDir = path.join(root, 'docs')
    await fs.mkdir(documentDir, { recursive: true })
    const documentPath = path.join(documentDir, 'note.md')
    await fs.writeFile(path.join(documentDir, 'local.png'), 'LOCAL')
    const remoteUrl = 'https://example.test/r.png'
    const codeUrl = 'https://example.test/code.png'
    const markdown = [
      '![l](local.png)',
      '',
      `![r](${remoteUrl})`,
      '',
      '```md',
      `![code](${codeUrl})`,
      '```',
    ].join('\n')
    const outDir = path.join(root, 'offline-copy')
    const service = new ImageOfflineService({
      paths: makePaths(root),
      maxDownloadBytes: 1024,
      fetchImpl: fakeFetch({ [remoteUrl]: bytesOf(12, 9) }),
    })

    const result = await service.createOfflineWorkingCopy({ markdown, documentPath, outDir })
    expect(result.ok).toBe(true)
    expect(result.replaced).toBe(2)
    expect(result.outputPath).toBeTruthy()

    const output = await fs.readFile(result.outputPath as string, 'utf8')
    expect(output).toMatch(/!\[l\]\(assets\/img-[0-9a-f]{10}-\d+\.png\)/)
    expect(output).toMatch(/!\[r\]\(assets\/img-[0-9a-f]{10}-\d+\.png\)/)
    expect(output).toContain(`![code](${codeUrl})`)
    const assets = await fs.readdir(path.join(outDir, 'assets'))
    expect(assets.length).toBe(2)
  })
})
