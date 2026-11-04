/**
 * 远程图片下载（墨章图片资产操作）。
 *
 * 约束：
 * - 复用 `fetchRemoteImage` 的 URL 安全校验（拒绝内网/凭据 URL）、重定向复检、
 *   内容类型与大小限制；本模块额外做文件头格式校验与原子写。
 * - 下载只新增 Local Location，不自动改写 Markdown；替换引用由调用方显式触发。
 * - 同名不同内容绝不覆盖：自动追加内容哈希后缀。
 * - 已有本地/缓存副本优先复用，避免重复下载。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { ImageAssetService } from './image-asset-service'
import { pickReusableLocalLocation, type AssetLocationType } from './image-asset-model'
import { sha256File, type ImageAssetRecord } from './image-asset-index'
import type { ImageDataPaths } from './image-data-paths'
import { sanitizeShareFilename } from './image-share-import'
import type { ImageTransferTaskStore } from './image-transfer-task-store'
import { fetchRemoteImage, type FetchLike, type RemoteFetchErrorCode } from './image-remote-fetch'
import { extensionFromUrl, validateRemoteImageUrl } from './image-remote-url'

export type ImageDownloadPlacement = 'project' | 'library' | 'offline' | 'custom'

export type ImageDownloadErrorCode =
  | RemoteFetchErrorCode
  | 'INVALID_IMAGE_BYTES'
  | 'DESTINATION_UNAVAILABLE'
  | 'DESTINATION_INVALID'
  | 'PATH_ESCAPE'
  | 'WRITE_FAILED'
  | 'ASSET_RECORD_FAILED'
  | 'SOURCE_LOCATION_MISSING'
  | 'DOWNLOAD_IN_PROGRESS'

export interface DownloadImageInput {
  url: string
  /** 当前文档目录；`project` 目标必须提供。 */
  documentPath?: string | null
  /** 当前文档图片目录（绝对路径）；`project` 目标必须提供。 */
  projectDirectory?: string | null
  placement: ImageDownloadPlacement
  /** `custom` 目标的绝对目录。 */
  customDirectory?: string | null
  /** 已知资产 ID；缺省时按远程 URL 或内容哈希匹配。 */
  assetId?: string | null
  /** 资产映射中的原始文件名（优先恢复）。 */
  originalFilename?: string | null
}

export interface ImageDownloadResult {
  ok: boolean
  code?: ImageDownloadErrorCode
  message: string
  filePath: string | null
  sha256: string | null
  assetId: string | null
  locationId: string | null
  reused: boolean
  taskId: string | null
}

export interface ImageDownloadServiceOptions {
  paths: ImageDataPaths
  assets: ImageAssetService
  tasks?: ImageTransferTaskStore
  fetchImpl?: FetchLike
  maxBytes?: number
  now?: () => Date
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

function fail(
  code: ImageDownloadErrorCode,
  message: string,
  taskId: string | null = null,
  assetId: string | null = null,
): ImageDownloadResult {
  return { ok: false, code, message, filePath: null, sha256: null, assetId, locationId: null, reused: false, taskId }
}

/** 文件头格式校验：MIME 可能撒谎，字节必须真的像图片。 */
export function sniffImageFormat(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b.length >= 12
    && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b.length >= 12
    && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return 'avif'
  }
  // SVG 是文本；只按开头声明判断，避免把普通 HTML 当图片。
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 512)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return null
}

function isAbsoluteDirectory(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value)
}

type DownloadLocationType = Extract<AssetLocationType, 'project' | 'library' | 'offline'>

function destinationDirectory(
  input: DownloadImageInput,
  paths: ImageDataPaths,
): { dir: string | null; type: DownloadLocationType; invalid?: boolean } {
  if (input.placement === 'project') {
    const dir = input.projectDirectory?.trim() || null
    return { dir, type: 'project', invalid: !!dir && !isAbsoluteDirectory(dir) }
  }
  if (input.placement === 'library') {
    return { dir: paths.libraryImagesDir, type: 'library' }
  }
  if (input.placement === 'offline') {
    return { dir: paths.offlineObjectsDir, type: 'offline' }
  }
  const dir = input.customDirectory?.trim() || null
  return { dir, type: 'project', invalid: !!dir && !isAbsoluteDirectory(dir) }
}

/** 恢复原始文件名时，若扩展名与真实内容不一致，以内容格式为准。 */
function alignExtension(filename: string, extension: string | null): string {
  if (!extension) return filename
  const current = path.extname(filename).replace(/^\./, '').toLowerCase()
  if (current === extension || (current === 'jpeg' && extension === 'jpg')) return filename
  const base = filename.slice(0, filename.length - path.extname(filename).length)
  return `${base}.${extension}`
}

function normalizedExtension(extension: string | null, fallback: string): string {
  const value = (extension ?? '').replace(/^\./, '').toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(value) ? value : fallback
}

function ensureExtension(filename: string, extension: string): string {
  return path.extname(filename) ? filename : `${filename}.${extension}`
}

export class ImageDownloadService {
  private readonly inFlight = new Map<string, Promise<ImageDownloadResult>>()
  private readonly fetchImpl: FetchLike | null
  private readonly maxBytes: number

  constructor(private readonly options: ImageDownloadServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch ?? null
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /** 同一 URL/资产 + 目标目录的并发请求复用同一个 Promise。 */
  download(input: DownloadImageInput): Promise<ImageDownloadResult> {
    const key = `${input.assetId ?? ''}|${input.url}|${input.placement}|${input.projectDirectory ?? ''}|${input.customDirectory ?? ''}`
    const running = this.inFlight.get(key)
    if (running) return running
    const task = this.run(input).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, task)
    return task
  }

  private async run(input: DownloadImageInput): Promise<ImageDownloadResult> {
    const safety = validateRemoteImageUrl(input.url)
    if (!safety.ok || !safety.normalized) {
      return fail('INVALID_URL', '远程图片地址无效或指向内网/本地地址')
    }
    const url = safety.normalized
    const destination = destinationDirectory(input, this.options.paths)
    if (destination.invalid) return fail('DESTINATION_INVALID', '下载目录必须是绝对路径')
    if (!destination.dir) {
      return fail('DESTINATION_UNAVAILABLE', destination.type === 'library'
        ? '全局图库未启用或未选择目录'
        : '未找到可用的下载目录')
    }
    const dir = path.resolve(destination.dir)

    let asset: ImageAssetRecord | null
    try {
      asset = await this.findAsset(input.assetId, url)
    } catch {
      return fail('ASSET_RECORD_FAILED', '资产索引不可读，已取消下载')
    }
    const reusable = asset ? pickReusableLocalLocation(asset.locations) : null

    let taskId: string | null = null
    const failed = (code: ImageDownloadErrorCode, message: string): ImageDownloadResult => {
      if (taskId && this.options.tasks) {
        void this.options.tasks.update(taskId, { status: 'failed', errorCode: code, attempt: 1 }).catch(() => undefined)
      }
      return fail(code, message, taskId, asset?.assetId ?? null)
    }
    if (asset && this.options.tasks) {
      try {
        const task = await this.options.tasks.enqueue({ kind: 'download', assetId: asset.assetId })
        taskId = task.taskId
        await this.options.tasks.update(task.taskId, { status: 'running' })
      } catch {
        taskId = null
      }
    }

    let sourceBytes: Uint8Array | null = null
    let sourcePath: string | null = null
    let sha256: string | null = null
    let extension: string | null = null

    if (reusable) {
      try {
        await fs.access(reusable.locator)
        sourcePath = reusable.locator
        sha256 = reusable.sha256
      } catch {
        sourcePath = null
      }
    }

    if (!sourcePath) {
      if (!this.fetchImpl) return failed('NETWORK_ERROR', '当前环境不支持远程下载')
      const fetched = await fetchRemoteImage(this.fetchImpl, url, this.maxBytes)
      if (!fetched.ok) return failed(fetched.code, fetched.message)
      const sniffed = sniffImageFormat(fetched.bytes)
      if (!sniffed) return failed('INVALID_IMAGE_BYTES', '下载内容不是受支持的图片格式')
      sourceBytes = fetched.bytes
      sha256 = fetched.sha256
      extension = sniffed
    }

    const fallbackExt = normalizedExtension(extension ?? extensionFromUrl(url), 'img')
    let urlName = ''
    try {
      urlName = path.basename(decodeURIComponent(new URL(url).pathname))
    } catch {
      urlName = ''
    }
    const mappedName = asset?.filename || input.originalFilename || urlName
    const safeName = ensureExtension(sanitizeShareFilename(mappedName || 'image', 'image'), fallbackExt)
    const baseName = alignExtension(safeName, extension)

    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return failed('DESTINATION_UNAVAILABLE', '下载目录不可创建或不可写')
    }

    const target = await this.resolveTargetPath(dir, baseName, sha256)
    if (!target.ok) return failed('PATH_ESCAPE', '目标路径越过了下载目录')

    let reused = false
    if (target.existingSame) {
      reused = true
      sha256 = target.existingSha ?? sha256
    } else {
      try {
        const expectedSha = sha256
        if (sourcePath) {
          const temp = `${target.path}.${process.pid}.${Date.now()}.tmp`
          await fs.copyFile(sourcePath, temp)
          await fs.rename(temp, target.path)
        } else if (sourceBytes) {
          const temp = `${target.path}.${process.pid}.${Date.now()}.tmp`
          await fs.writeFile(temp, sourceBytes)
          await fs.rename(temp, target.path)
        } else {
          return failed('SOURCE_LOCATION_MISSING', '没有可复用的本地副本')
        }
        // 落盘后重新计算哈希，防止截断/损坏写入被当作成功。
        sha256 = (await sha256File(target.path)).sha256
        if (expectedSha && sha256 !== expectedSha) {
          try { await fs.rm(target.path, { force: true }) } catch { /* ignore */ }
          return failed('WRITE_FAILED', '图片写入后完整性校验失败；未保留损坏文件')
        }
      } catch {
        return failed('WRITE_FAILED', '图片写入失败；原有文件与 Markdown 均未改动')
      }
    }

    // 资产绑定：优先同一 Asset ID；否则按内容哈希归并。
    let locationId: string | null = null
    try {
      if (asset) {
        const updated = await this.options.assets.recordLocation({
          assetId: asset.assetId,
          type: destination.type,
          locator: target.path,
          relativePath: path.basename(target.path),
          availability: 'available',
        })
        const record = updated.locations.find(item => item.locator === target.path)
        locationId = record?.locationId ?? null
        asset = updated
      } else {
        const upserted = await this.options.assets.upsertLocalFile({
          filePath: target.path,
          filename: path.basename(target.path),
          locationType: destination.type,
          relativePath: path.basename(target.path),
        })
        asset = upserted.asset
        const record = upserted.asset.locations.find(item => item.locator === target.path)
        locationId = record?.locationId ?? null
      }
    } catch {
      return failed('ASSET_RECORD_FAILED', '图片已下载，但资产索引写入失败')
    }

    // 把远程 URL 绑定到同一资产，后续下载可按 URL 找到已有副本。
    if (asset) {
      const hasRemote = asset.locations.some(
        location => location.type === 'github' && location.locator === url,
      )
      if (!hasRemote) {
        try {
          asset = await this.options.assets.recordLocation({
            assetId: asset.assetId,
            type: 'github',
            locator: url,
            availability: 'available',
          })
        } catch { /* 远程位置记录失败不影响本地副本 */ }
      }
    }

    if (!taskId && asset && this.options.tasks) {
      try {
        const task = await this.options.tasks.enqueue({ kind: 'download', assetId: asset.assetId })
        taskId = task.taskId
        await this.options.tasks.update(task.taskId, { status: 'running' })
      } catch {
        taskId = null
      }
    }
    if (taskId && this.options.tasks) {
      try {
        await this.options.tasks.update(taskId, { status: 'succeeded', attempt: 1, locationId })
      } catch { /* 任务记录失败不影响下载结果 */ }
    }

    return {
      ok: true,
      message: reused ? '已复用现有本地图片' : '图片已下载',
      filePath: target.path,
      sha256,
      assetId: asset?.assetId ?? null,
      locationId,
      reused,
      taskId,
    }
  }

  private async findAsset(assetId: string | null | undefined, url: string): Promise<ImageAssetRecord | null> {
    const list = await this.options.assets.list()
    if (assetId) {
      const found = list.find(asset => asset.assetId === assetId)
      if (found) return found
    }
    return list.find(asset => asset.locations.some(
      location => location.type === 'github' && location.locator === url,
    )) ?? null
  }

  /**
   * 同名文件：内容一致直接复用；不一致时追加内容哈希，绝不覆盖。
   */
  private async resolveTargetPath(
    dir: string,
    filename: string,
    sha256: string | null,
  ): Promise<{ ok: true; path: string; existingSame: boolean; existingSha: string | null } | { ok: false }> {
    const candidate = path.resolve(dir, filename)
    const inside = candidate === dir || candidate.startsWith(`${dir}${path.sep}`)
    if (!inside) return { ok: false }

    const existing = await fs.stat(candidate).then(() => true, () => false)
    if (!existing) return { ok: true, path: candidate, existingSame: false, existingSha: null }

    if (sha256) {
      const existingSha = (await sha256File(candidate)).sha256
      if (existingSha === sha256) {
        return { ok: true, path: candidate, existingSame: true, existingSha }
      }
    }
    const extension = path.extname(candidate)
    const base = candidate.slice(0, candidate.length - extension.length)
    const suffix = sha256 ? sha256.slice(0, 8) : String(Date.now())
    const unique = `${base}-${suffix}${extension}`
    const uniqueInside = unique === dir || unique.startsWith(`${dir}${path.sep}`)
    if (!uniqueInside) return { ok: false }
    const uniqueExists = await fs.stat(unique).then(() => true, () => false)
    if (uniqueExists && sha256) {
      const existingSha = (await sha256File(unique)).sha256
      if (existingSha === sha256) {
        return { ok: true, path: unique, existingSame: true, existingSha }
      }
    }
    return { ok: true, path: unique, existingSame: false, existingSha: null }
  }
}
