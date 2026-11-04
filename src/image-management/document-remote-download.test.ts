import { describe, expect, it } from 'vitest'
import {
  collectDocumentRemoteImages,
  downloadDocumentRemoteImages,
} from './document-remote-download'
import type { DownloadImageInput, ImageDownloadResult } from './image-download-service'

const documentPath = 'D:/project/docs/note.md'
const projectDirectory = 'D:/project/docs/assets/images'

function markdown(): string {
  return [
    '# 标题',
    '',
    '![远程一](https://example.test/a.png)',
    '![远程一重复](https://example.test/a.png)',
    '![远程二](https://cdn.example.test/b.jpg)',
    '![本地](assets/images/c.png)',
    '',
    '```md',
    '![代码示例](https://example.test/not-a-real-image.png)',
    '```',
    '',
  ].join('\n')
}

function result(input: DownloadImageInput, reused = false): ImageDownloadResult {
  return {
    ok: true,
    message: reused ? '已复用现有本地图片' : '图片已下载',
    filePath: `${projectDirectory}/${input.url.split('/').pop()}`,
    sha256: 'a'.repeat(64),
    assetId: `asset-${input.url}`,
    locationId: 'loc-1',
    reused,
    taskId: 'task-1',
  }
}

describe('collectDocumentRemoteImages', () => {
  it('deduplicates remote URLs and ignores local/code-fence images', () => {
    expect(collectDocumentRemoteImages(markdown(), documentPath)).toEqual([
      { url: 'https://example.test/a.png', referenceCount: 2 },
      { url: 'https://cdn.example.test/b.jpg', referenceCount: 1 },
    ])
  })

  it('returns nothing for a document without remote images', () => {
    expect(collectDocumentRemoteImages('![本地](assets/a.png)', documentPath)).toEqual([])
  })
})

describe('downloadDocumentRemoteImages', () => {
  it('downloads each unique URL once and reports stable per-URL results', async () => {
    const calls: string[] = []
    const summary = await downloadDocumentRemoteImages({
      markdown: markdown(),
      documentPath,
      projectDirectory,
      download: async (input) => {
        calls.push(input.url)
        return result(input)
      },
    })

    expect(calls.sort()).toEqual([
      'https://cdn.example.test/b.jpg',
      'https://example.test/a.png',
    ])
    expect(summary).toMatchObject({ total: 2, downloaded: 2, reused: 0, failed: 0 })
    expect(summary.items.map(item => item.url)).toEqual([
      'https://example.test/a.png',
      'https://cdn.example.test/b.jpg',
    ])
    expect(summary.items[0].referenceCount).toBe(2)
    expect(summary.items.every(item => item.filePath && item.ok)).toBe(true)
  })

  it('continues after a failed URL and counts reused copies separately', async () => {
    const summary = await downloadDocumentRemoteImages({
      markdown: markdown(),
      documentPath,
      projectDirectory,
      download: async (input) => {
        if (input.url.includes('b.jpg')) {
          return { ...result(input), ok: false, message: '网络失败', filePath: null }
        }
        return result(input, true)
      },
    })

    expect(summary).toMatchObject({ total: 2, downloaded: 0, reused: 1, failed: 1 })
    expect(summary.items[1]).toMatchObject({
      url: 'https://cdn.example.test/b.jpg',
      ok: false,
      reused: false,
    })
  })

  it('honors the concurrency limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const urls = Array.from({ length: 6 }, (_, index) => `https://example.test/${index}.png`)
    const source = urls.map((url, index) => `![${index}](${url})`).join('\n\n')

    await downloadDocumentRemoteImages({
      markdown: source,
      documentPath,
      projectDirectory,
      maxConcurrent: 2,
      download: async (input) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        inFlight--
        return result(input)
      },
    })

    expect(maxInFlight).toBe(2)
  })

  it('turns a thrown downloader error into a failed item', async () => {
    const summary = await downloadDocumentRemoteImages({
      markdown: '![远程](https://example.test/throw.png)',
      documentPath,
      projectDirectory,
      download: async () => {
        throw new Error('boom')
      },
    })

    expect(summary).toMatchObject({ total: 1, failed: 1 })
    expect(summary.items[0]).toMatchObject({ ok: false, message: 'boom' })
  })
})
