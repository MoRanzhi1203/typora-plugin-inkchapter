/**
 * 本地图片资产索引（P1-a）。
 *
 * 设计要点：
 * - 内容寻址：SHA-256 决定「是不是同一张图」，文件名与文件名冲突不参与身份判断。
 * - 一个内容只对应一个逻辑资产；同一内容再次导入不会新增资产。
 * - 索引以 JSON 持久化，写入使用「临时文件 + rename」的原子替换。
 * - 索引损坏时**只报错，不覆盖**：用户数据优先于自动修复。
 * - 所有写操作串行化，避免并发导入互相覆盖。
 */

import * as fs from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import * as path from 'path'

export const IMAGE_INDEX_SCHEMA_VERSION = 1

export interface ImageRemoteLocation {
  remoteProfileId: string
  branch: string
  remotePath: string
  remoteUrl: string
  uploadedAt: string
}

export interface ImageAssetRecord {
  assetId: string
  sha256: string
  filename: string
  mimeType: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  /** 图库中的规范本地副本；未入库时为 null。 */
  localPath: string | null
  remoteLocations: ImageRemoteLocation[]
}

export interface ImageAssetIndexFile {
  schemaVersion: number
  assets: ImageAssetRecord[]
}

export type ImageIndexErrorCode =
  | 'INDEX_CORRUPT'
  | 'INDEX_READ_FAILED'
  | 'INDEX_WRITE_FAILED'
  | 'FILE_NOT_FOUND'
  | 'FILE_NOT_READABLE'
  | 'ASSET_NOT_FOUND'

export class ImageIndexError extends Error {
  constructor(message: string, readonly code: ImageIndexErrorCode) {
    super(message)
    this.name = 'ImageIndexError'
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

export function guessMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '')
  return MIME_BY_EXTENSION[ext] ?? null
}

export interface FileDigest {
  sha256: string
  sizeBytes: number
}

/** 流式计算文件 SHA-256 与字节数（不把整张图读入内存）。 */
export async function sha256File(filePath: string): Promise<FileDigest> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw new ImageIndexError(`file not found: ${filePath}`, 'FILE_NOT_FOUND')
  }
  if (!stat.isFile()) throw new ImageIndexError(`not a regular file: ${filePath}`, 'FILE_NOT_READABLE')

  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? new Uint8Array(Buffer.from(chunk)) : new Uint8Array(chunk)
      hash.update(bytes)
    })
    stream.on('error', error => reject(new ImageIndexError(
      `read failed: ${error instanceof Error ? error.message : String(error)}`,
      'FILE_NOT_READABLE',
    )))
    stream.on('end', () => resolve())
  })
  return { sha256: hash.digest('hex'), sizeBytes: stat.size }
}

export interface UpsertLocalFileInput {
  filePath: string
  filename?: string
  mimeType?: string | null
  /** 测试注入用；默认当前时间。 */
  now?: Date
}

export interface UpsertLocalFileResult {
  asset: ImageAssetRecord
  created: boolean
}

export interface RecordRemoteLocationInput {
  assetId: string
  remoteProfileId: string
  branch: string
  remotePath: string
  remoteUrl: string
  now?: Date
}

function cloneAsset(asset: ImageAssetRecord): ImageAssetRecord {
  return {
    ...asset,
    remoteLocations: asset.remoteLocations.map(location => ({ ...location })),
  }
}

function isAssetRecord(value: unknown): value is ImageAssetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ImageAssetRecord>
  return typeof record.assetId === 'string'
    && typeof record.sha256 === 'string'
    && typeof record.filename === 'string'
    && typeof record.sizeBytes === 'number'
    && Array.isArray(record.remoteLocations)
}

export class ImageAssetIndex {
  private readonly assets = new Map<string, ImageAssetRecord>()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly indexPath: string) {}

  getIndexPath(): string {
    return this.indexPath
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.indexPath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === 'ENOENT') {
        this.assets.clear()
        this.loaded = true
        return
      }
      throw new ImageIndexError(
        `index read failed: ${error instanceof Error ? error.message : String(error)}`,
        'INDEX_READ_FAILED',
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ImageIndexError('index is not valid JSON', 'INDEX_CORRUPT')
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new ImageIndexError('index root is not an object', 'INDEX_CORRUPT')
    }
    const file = parsed as Partial<ImageAssetIndexFile>
    if (file.schemaVersion !== IMAGE_INDEX_SCHEMA_VERSION || !Array.isArray(file.assets)) {
      throw new ImageIndexError('index schema is unsupported', 'INDEX_CORRUPT')
    }
    if (!file.assets.every(isAssetRecord)) {
      throw new ImageIndexError('index contains invalid asset records', 'INDEX_CORRUPT')
    }

    this.assets.clear()
    for (const asset of file.assets) this.assets.set(asset.assetId, cloneAsset(asset))
    this.loaded = true
  }

  list(): ImageAssetRecord[] {
    return Array.from(this.assets.values()).map(cloneAsset)
  }

  get(assetId: string): ImageAssetRecord | null {
    const asset = this.assets.get(assetId)
    return asset ? cloneAsset(asset) : null
  }

  findBySha256(sha256: string): ImageAssetRecord | null {
    for (const asset of this.assets.values()) {
      if (asset.sha256 === sha256) return cloneAsset(asset)
    }
    return null
  }

  findByLocalPath(localPath: string): ImageAssetRecord | null {
    for (const asset of this.assets.values()) {
      if (asset.localPath && asset.localPath === localPath) return cloneAsset(asset)
    }
    return null
  }

  async upsertLocalFile(input: UpsertLocalFileInput): Promise<UpsertLocalFileResult> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const digest = await sha256File(input.filePath)
      const existing = this.findBySha256(digest.sha256)
      if (existing) {
        if (!existing.localPath) {
          const updated = this.assets.get(existing.assetId)
          if (updated) {
            updated.localPath = input.filePath
            updated.updatedAt = (input.now ?? new Date()).toISOString()
            await this.persist()
          }
        }
        return { asset: this.get(existing.assetId) as ImageAssetRecord, created: false }
      }

      const now = (input.now ?? new Date()).toISOString()
      const filename = input.filename ?? path.basename(input.filePath)
      const record: ImageAssetRecord = {
        assetId: this.allocateAssetId(digest.sha256),
        sha256: digest.sha256,
        filename,
        mimeType: input.mimeType ?? guessMimeType(filename),
        sizeBytes: digest.sizeBytes,
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
        localPath: input.filePath,
        remoteLocations: [],
      }
      this.assets.set(record.assetId, record)
      await this.persist()
      return { asset: cloneAsset(record), created: true }
    })
  }

  async recordRemoteLocation(input: RecordRemoteLocationInput): Promise<ImageAssetRecord> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const asset = this.assets.get(input.assetId)
      if (!asset) throw new ImageIndexError(`asset not found: ${input.assetId}`, 'ASSET_NOT_FOUND')

      const location: ImageRemoteLocation = {
        remoteProfileId: input.remoteProfileId,
        branch: input.branch,
        remotePath: input.remotePath,
        remoteUrl: input.remoteUrl,
        uploadedAt: (input.now ?? new Date()).toISOString(),
      }
      const index = asset.remoteLocations.findIndex(
        item => item.remoteProfileId === location.remoteProfileId && item.remotePath === location.remotePath,
      )
      if (index >= 0) asset.remoteLocations[index] = location
      else asset.remoteLocations.push(location)
      asset.updatedAt = location.uploadedAt
      await this.persist()
      return cloneAsset(asset)
    })
  }

  /** 原子写入：临时文件 + rename；失败不破坏既有索引。 */
  async save(): Promise<void> {
    await this.enqueue(() => this.persist())
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async persist(): Promise<void> {
    const payload: ImageAssetIndexFile = {
      schemaVersion: IMAGE_INDEX_SCHEMA_VERSION,
      assets: Array.from(this.assets.values()).map(cloneAsset),
    }
    const temporary = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true })
      await fs.writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8')
      await fs.rename(temporary, this.indexPath)
    } catch (error) {
      try { await fs.unlink(temporary) } catch { /* 临时文件不存在时忽略 */ }
      throw new ImageIndexError(
        `index write failed: ${error instanceof Error ? error.message : String(error)}`,
        'INDEX_WRITE_FAILED',
      )
    }
  }

  private allocateAssetId(sha256: string): string {
    for (const length of [16, 24, 32, 64]) {
      const candidate = `img_${sha256.slice(0, length)}`
      const existing = this.assets.get(candidate)
      if (!existing || existing.sha256 === sha256) return candidate
    }
    let counter = 1
    while (this.assets.has(`img_${sha256}_${counter}`)) counter++
    return `img_${sha256}_${counter}`
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(() => undefined, () => undefined)
    return run
  }
}
