/**
 * 当前文档远程图片批量下载。
 *
 * 只下载并登记资产，不改写 Markdown；单张替换引用仍走现有工具栏动作。
 * 下载去重复用 `ImageDownloadService` 的资产/远程 URL 匹配，并发受设置上限约束。
 */

import { parseMarkdownImageReferences, type ReuseResultKind } from './image-asset-model'
import type { DownloadImageInput, ImageDownloadResult } from './image-download-service'

export interface DocumentRemoteImageTarget {
  url: string
  referenceCount: number
}

export interface DocumentRemoteDownloadItem {
  url: string
  referenceCount: number
  ok: boolean
  filePath: string | null
  reused: boolean
  resultKind: ReuseResultKind
  networkTransfers: number
  localCopies: number
  message: string
}

export interface DocumentRemoteDownloadSummary {
  total: number
  downloaded: number
  reused: number
  copied: number
  failed: number
  networkTransfers: number
  items: DocumentRemoteDownloadItem[]
}

/** 按远程 URL 去重收集当前文档的远程图片；本地引用与代码块示例不计入。 */
export function collectDocumentRemoteImages(
  markdown: string,
  documentPath: string,
): DocumentRemoteImageTarget[] {
  const counts = new Map<string, number>()
  for (const reference of parseMarkdownImageReferences(markdown, documentPath)) {
    const url = reference.resolved.remoteUrl
    if (!url) continue
    counts.set(url, (counts.get(url) ?? 0) + 1)
  }
  return Array.from(counts, ([url, referenceCount]) => ({ url, referenceCount }))
}

/**
 * 下载文档内的全部远程图片。
 * 单个 URL 失败不会中断其它 URL；返回结果按文档出现顺序稳定排列。
 */
export async function downloadDocumentRemoteImages(input: {
  markdown: string
  documentPath: string
  projectDirectory: string
  download: (input: DownloadImageInput) => Promise<ImageDownloadResult>
  maxConcurrent?: number
}): Promise<DocumentRemoteDownloadSummary> {
  const targets = collectDocumentRemoteImages(input.markdown, input.documentPath)
  if (targets.length === 0) {
    return { total: 0, downloaded: 0, reused: 0, copied: 0, failed: 0, networkTransfers: 0, items: [] }
  }

  const items: DocumentRemoteDownloadItem[] = new Array(targets.length)
  const limit = Math.max(1, Math.min(input.maxConcurrent ?? 3, targets.length))
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const index = cursor++
      const target = targets[index]
      let result: ImageDownloadResult
      try {
        result = await input.download({
          url: target.url,
          documentPath: input.documentPath,
          projectDirectory: input.projectDirectory,
          placement: 'project',
        })
      } catch (error) {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : '下载失败',
          filePath: null,
          sha256: null,
          assetId: null,
          locationId: null,
          reused: false,
          resultKind: 'TRANSFER_FAILED',
          networkTransfers: 0,
          localCopies: 0,
          bytesTransferred: 0,
          taskId: null,
        }
      }
      items[index] = {
        url: target.url,
        referenceCount: target.referenceCount,
        ok: result.ok,
        filePath: result.filePath,
        reused: result.reused,
        resultKind: result.resultKind,
        networkTransfers: result.networkTransfers,
        localCopies: result.localCopies,
        message: result.message,
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))

  const downloaded = items.filter(item => item.ok && item.resultKind === 'DOWNLOADED_NEW').length
  const copied = items.filter(item => item.ok && item.resultKind === 'COPIED_EXISTING_LOCAL').length
  const reused = items.filter(item => item.ok && item.resultKind === 'REUSED_LOCAL').length
  const networkTransfers = items.reduce((sum, item) => sum + item.networkTransfers, 0)
  return {
    total: items.length,
    downloaded,
    reused,
    copied,
    failed: items.length - downloaded - reused - copied,
    networkTransfers,
    items,
  }
}
