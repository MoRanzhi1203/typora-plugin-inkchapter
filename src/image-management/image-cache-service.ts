/**
 * 普通图片缓存（P4）。
 *
 * - 仅缓存「远端且没有可用本地永久副本」的图片；已有项目/图库副本时不复制。
 * - 对象按 SHA-256 内容寻址，同一内容只存一份；URL 只是索引键。
 * - 固定离线/图库等受保护 URL 不参与 LRU 清理。
 * - 缓存关闭时不做任何持久化，也不承诺离线显示。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { fetchRemoteImage, type FetchLike } from './image-remote-fetch'
import {
  buildCacheObjectName,
  validateRemoteImageUrl,
} from './image-remote-url'
import {
  cacheQuotaBytes,
  planCacheEviction,
  type CacheEntry,
} from './image-cache-policy'
import type { ImageDataPaths } from './image-data-paths'
import type { ImageCacheMode, ImageSettings } from './image-settings'

export const IMAGE_CACHE_SCHEMA_VERSION = 1

export interface CacheRecord {
  remoteUrl: string
  sha256: string
  sizeBytes: number
  extension: string | null
  contentType: string | null
  assetId: string | null
  cachedAt: string
  lastAccessedAt: string
}

interface CacheIndexFile {
  schemaVersion: number
  entries: CacheRecord[]
}

export type CacheResultCode =
  | 'CACHED'
  | 'ALREADY_CACHED'
  | 'REUSED_LOCAL'
  | 'CACHE_OFF'
  | 'MANUAL_REQUIRES_EXPLICIT'
  | 'INVALID_URL'
  | 'DOWNLOAD_FAILED'
  | 'WRITE_FAILED'

export interface CacheRemoteImageInput {
  url: string
  assetId?: string | null
  /** 已验证的本地永久副本：存在时不再缓存。 */
  existingLocal?: { locator: string; sha256: string } | null
  /** manual 模式下必须为 true 才允许缓存。 */
  explicit?: boolean
  /** 离线固定等受保护 URL，不参与清理。 */
  protectedUrls?: ReadonlySet<string>
}

export interface CacheRemoteImageResult {
  ok: boolean
  code: CacheResultCode
  record?: CacheRecord
  message?: string
}

export interface ImageCacheServiceOptions {
  paths: ImageDataPaths
  mode: ImageCacheMode
  maxSizeMB: number
  maxDownloadBytes: number
  fetchImpl?: FetchLike
  now?: () => Date
}

export class ImageCacheService {
  private readonly records = new Map<string, CacheRecord>()
  private readonly fetchImpl: FetchLike
  private readonly now: () => Date
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ImageCacheServiceOptions) {
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch
    if (!options.fetchImpl && !globalFetch) throw new Error('fetch is not available')
    this.fetchImpl = options.fetchImpl ?? (globalFetch as FetchLike)
    this.now = options.now ?? (() => new Date())
  }

  get cacheRoot(): string | null {
    return this.options.paths.cacheRoot
  }

  getIndexPath(): string | null {
    return this.cacheRoot ? path.join(this.cacheRoot, 'index.json') : null
  }

  async list(): Promise<CacheRecord[]> {
    await this.ensureLoaded()
    return Array.from(this.records.values()).map(record => ({ ...record }))
  }

  async get(url: string): Promise<CacheRecord | null> {
    await this.ensureLoaded()
    const record = this.records.get(url)
    return record ? { ...record } : null
  }

  filePathFor(record: CacheRecord): string | null {
    if (!this.options.paths.cacheObjectsDir) return null
    return path.join(this.options.paths.cacheObjectsDir, buildCacheObjectName(record.sha256, record.extension))
  }

  /** 标记访问时间；用于 LRU。 */
  async touch(url: string): Promise<void> {
    await this.ensureLoaded()
    const record = this.records.get(url)
    if (!record) return
    record.lastAccessedAt = this.now().toISOString()
    await this.persist()
  }

  async cacheRemoteImage(input: CacheRemoteImageInput): Promise<CacheRemoteImageResult> {
    if (this.options.mode === 'off' || !this.cacheRoot) {
      return { ok: false, code: 'CACHE_OFF' }
    }
    if (input.existingLocal) {
      return { ok: true, code: 'REUSED_LOCAL' }
    }
    const safety = validateRemoteImageUrl(input.url)
    if (!safety.ok || !safety.normalized) {
      return { ok: false, code: 'INVALID_URL', message: safety.reason }
    }
    await this.ensureLoaded()

    const existing = this.records.get(input.url)
    if (existing && await this.fileExists(existing)) {
      existing.lastAccessedAt = this.now().toISOString()
      await this.persist()
      return { ok: true, code: 'ALREADY_CACHED', record: { ...existing } }
    }
    if (this.options.mode === 'manual' && input.explicit !== true) {
      return { ok: false, code: 'MANUAL_REQUIRES_EXPLICIT' }
    }

    const downloaded = await fetchRemoteImage(this.fetchImpl, input.url, this.options.maxDownloadBytes)
    if (!downloaded.ok) {
      return { ok: false, code: 'DOWNLOAD_FAILED', message: `${downloaded.code}:${downloaded.message}` }
    }

    const objectName = buildCacheObjectName(downloaded.sha256, downloaded.extension)
    const objectsDir = this.options.paths.cacheObjectsDir as string
    const objectPath = path.join(objectsDir, objectName)
    try {
      await this.writeObject(objectPath, downloaded.bytes)
    } catch (error) {
      return {
        ok: false,
        code: 'WRITE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }
    }

    const timestamp = this.now().toISOString()
    const record: CacheRecord = {
      remoteUrl: input.url,
      sha256: downloaded.sha256,
      sizeBytes: downloaded.bytes.byteLength,
      extension: downloaded.extension,
      contentType: downloaded.contentType,
      assetId: input.assetId ?? null,
      cachedAt: timestamp,
      lastAccessedAt: timestamp,
    }
    this.records.set(input.url, record)
    await this.persist()
    await this.enforceQuota(input.protectedUrls ?? new Set())
    return { ok: true, code: 'CACHED', record: { ...record } }
  }

  /**
   * 按配额执行 LRU 清理。
   * 同一内容（sha256）被多个 URL 引用时按一个对象计算；只要有一个 URL 受保护就整体保留。
   */
  async enforceQuota(protectedUrls: ReadonlySet<string>): Promise<{
    evictedObjects: string[]
    evictedBytes: number
    retainedBytes: number
  }> {
    await this.ensureLoaded()
    if (!this.cacheRoot) return { evictedObjects: [], evictedBytes: 0, retainedBytes: 0 }

    const bySha = new Map<string, { sizeBytes: number; lastAccessedAt: string; urls: string[]; pinned: boolean; extension: string | null }>()
    for (const record of this.records.values()) {
      const group = bySha.get(record.sha256)
      if (!group) {
        bySha.set(record.sha256, {
          sizeBytes: record.sizeBytes,
          lastAccessedAt: record.lastAccessedAt,
          urls: [record.remoteUrl],
          pinned: protectedUrls.has(record.remoteUrl),
          extension: record.extension,
        })
        continue
      }
      group.urls.push(record.remoteUrl)
      if (record.lastAccessedAt > group.lastAccessedAt) group.lastAccessedAt = record.lastAccessedAt
      if (protectedUrls.has(record.remoteUrl)) group.pinned = true
    }

    const entries: CacheEntry[] = Array.from(bySha.entries()).map(([sha256, group]) => ({
      locator: sha256,
      sizeBytes: group.sizeBytes,
      lastAccessedAt: group.lastAccessedAt,
      pinned: group.pinned,
    }))
    const plan = planCacheEviction(entries, cacheQuotaBytes(this.options.maxSizeMB))
    const evictedObjects: string[] = []
    for (const entry of plan.evict) {
      const group = bySha.get(entry.locator)
      if (!group) continue
      const objectPath = path.join(this.options.paths.cacheObjectsDir as string, buildCacheObjectName(entry.locator, group.extension))
      await fs.unlink(objectPath).catch(() => undefined)
      for (const url of group.urls) this.records.delete(url)
      evictedObjects.push(entry.locator)
    }
    if (evictedObjects.length > 0) await this.persist()
    return { evictedObjects, evictedBytes: plan.evictedBytes, retainedBytes: plan.retainedBytes }
  }

  async statistics(): Promise<{ objectCount: number; totalBytes: number }> {
    await this.ensureLoaded()
    const bySha = new Map<string, number>()
    for (const record of this.records.values()) bySha.set(record.sha256, record.sizeBytes)
    return {
      objectCount: bySha.size,
      totalBytes: Array.from(bySha.values()).reduce((sum, value) => sum + value, 0),
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const indexPath = this.getIndexPath()
    if (!indexPath) return
    let text: string
    try {
      text = await fs.readFile(indexPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return // 缓存索引损坏只影响缓存，不阻断插件；下次写入会重建。
    }
    const file = parsed as Partial<CacheIndexFile>
    if (file.schemaVersion !== IMAGE_CACHE_SCHEMA_VERSION || !Array.isArray(file.entries)) return
    for (const entry of file.entries) {
      if (!entry || typeof entry.remoteUrl !== 'string' || typeof entry.sha256 !== 'string') continue
      this.records.set(entry.remoteUrl, { ...entry })
    }
  }

  private async writeObject(objectPath: string, bytes: Uint8Array): Promise<void> {
    const exists = await fs.stat(objectPath).then(() => true, () => false)
    if (exists) return
    await fs.mkdir(path.dirname(objectPath), { recursive: true })
    const temporary = `${objectPath}.tmp-${process.pid}-${Date.now()}`
    try {
      await fs.writeFile(temporary, bytes)
      await fs.rename(temporary, objectPath)
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async fileExists(record: CacheRecord): Promise<boolean> {
    const filePath = this.filePathFor(record)
    if (!filePath) return false
    const stats = await fs.stat(filePath).then(value => value, () => null)
    return Boolean(stats?.isFile())
  }

  private async persist(): Promise<void> {
    const indexPath = this.getIndexPath()
    if (!indexPath) return
    const run = this.writeQueue.then(async () => {
      const payload: CacheIndexFile = {
        schemaVersion: IMAGE_CACHE_SCHEMA_VERSION,
        entries: Array.from(this.records.values()).map(record => ({ ...record })),
      }
      const temporary = `${indexPath}.${process.pid}.${Date.now()}.tmp`
      await fs.mkdir(path.dirname(indexPath), { recursive: true })
      await fs.writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8')
      await fs.rename(temporary, indexPath)
    })
    this.writeQueue = run.then(() => undefined, () => undefined)
    await run
  }
}

export interface CreateImageCacheServiceInput {
  paths: ImageDataPaths
  settings: Pick<ImageSettings, 'cache' | 'limits'>
  fetchImpl?: FetchLike
  now?: () => Date
}

export function createImageCacheService(input: CreateImageCacheServiceInput): ImageCacheService {
  return new ImageCacheService({
    paths: input.paths,
    mode: input.settings.cache.mode,
    maxSizeMB: input.settings.cache.maxSizeMB,
    maxDownloadBytes: input.settings.limits.downloadMaxBytes,
    fetchImpl: input.fetchImpl,
    now: input.now,
  })
}
