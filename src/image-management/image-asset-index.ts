/**
 * 本地图片资产索引（P1-a 建立，P2 扩展为统一位置模型）。
 *
 * 设计要点：
 * - 内容寻址：SHA-256 决定「是不是同一张图」，文件名与文件名冲突不参与身份判断。
 * - 一个内容只对应一个逻辑资产；同一内容再次导入只新增/复用位置，不新增资产。
 * - 一张图片可有多个位置（项目 / 图库 / 缓存 / 离线 / GitHub）。
 * - 索引以 JSON 持久化，写入使用「临时文件 + rename」的原子替换。
 * - 索引损坏时**只报错，不覆盖**：用户数据优先于自动修复。
 * - 所有写操作串行化，避免并发导入互相覆盖。
 * - schema v1 可无损读取并迁移为 v2；v2 才写入 `locations`。
 */

import * as fs from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import * as path from 'path'
import {
  buildAssetLocationKey,
  buildLocationId,
  deriveStorageState,
  isPathInside,
  isPermanentLocalLocation,
  normalizeLocalPathForKey,
  type AssetAvailability,
  type AssetLocationRecord,
  type AssetStorageState,
  type AssetLocationType,
} from './image-asset-model'

export const IMAGE_INDEX_SCHEMA_VERSION = 2
const LEGACY_SCHEMA_VERSION = 1

export interface ImageRemoteLocation {
  remoteProfileId: string
  branch: string
  remotePath: string
  remoteUrl: string
  uploadedAt: string
}

/**
 * 对外资产视图：`localPath` 与 `remoteLocations` 由 `locations` 派生，
 * 不参与持久化，避免同一事实出现两份可漂移的状态。
 */
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
  /** 内容版本；内容变化会产生新资产，版本用于后续迁移/事务记录。 */
  contentVersion: number
  locations: AssetLocationRecord[]
  /** 派生的规范本地副本；未入库时为 null。 */
  localPath: string | null
  /** 派生的远端位置视图。 */
  remoteLocations: ImageRemoteLocation[]
}

/** 当前存储状态（派生，不持久化）。 */
export function assetStorageState(asset: ImageAssetRecord): AssetStorageState {
  return deriveStorageState(asset.locations)
}

interface PersistedAssetV2 {
  assetId: string
  sha256: string
  filename: string
  mimeType: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  contentVersion: number
  locations: AssetLocationRecord[]
}

interface PersistedAssetV1 {
  assetId: string
  sha256: string
  filename: string
  mimeType: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  localPath: string | null
  remoteLocations: ImageRemoteLocation[]
}

export interface ImageAssetIndexFile {
  schemaVersion: number
  assets: Array<PersistedAssetV1 | PersistedAssetV2>
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
  /** 本地位置类型；默认按项目图片处理。 */
  locationType?: Extract<AssetLocationType, 'project' | 'library' | 'offline' | 'cache'>
  bindingId?: string | null
  relativePath?: string | null
  availability?: AssetAvailability
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
  remoteVersion?: string | null
  availability?: AssetAvailability
  now?: Date
}

export interface RecordLocationInput {
  assetId: string
  type: AssetLocationType
  locator: string
  bindingId?: string | null
  relativePath?: string | null
  availability?: AssetAvailability
  remoteProfileId?: string | null
  remoteBranch?: string | null
  remotePath?: string | null
  remoteVersion?: string | null
  now?: Date
}

function createLocation(input: {
  assetId: string
  sha256: string
  type: AssetLocationType
  locator: string
  bindingId: string | null
  relativePath: string | null
  availability: AssetAvailability
  remoteProfileId: string | null
  remoteBranch: string | null
  remotePath: string | null
  remoteVersion: string | null
  now: string
}): AssetLocationRecord {
  const key = buildAssetLocationKey({
    type: input.type,
    locator: input.locator,
    bindingId: input.bindingId,
    remoteProfileId: input.remoteProfileId,
    remoteBranch: input.remoteBranch,
    remotePath: input.remotePath,
  })
  return {
    locationId: buildLocationId(`${input.assetId}|${key}`),
    assetId: input.assetId,
    type: input.type,
    bindingId: input.bindingId,
    locator: input.locator,
    relativePath: input.relativePath,
    sha256: input.sha256,
    availability: input.availability,
    lastCheckedAt: input.availability === 'unknown' ? null : input.now,
    remoteProfileId: input.remoteProfileId,
    remoteBranch: input.remoteBranch,
    remotePath: input.remotePath,
    remoteVersion: input.remoteVersion,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function cloneLocation(location: AssetLocationRecord): AssetLocationRecord {
  return { ...location }
}

function deriveLocalPath(locations: readonly AssetLocationRecord[]): string | null {
  const permanent = locations.find(
    location => isPermanentLocalLocation(location) && location.availability === 'available',
  )
  if (permanent) return permanent.locator
  const anyLocal = locations.find(location => location.type !== 'github')
  return anyLocal?.locator ?? null
}

function deriveRemoteLocations(locations: readonly AssetLocationRecord[]): ImageRemoteLocation[] {
  return locations
    .filter(location => location.type === 'github')
    .map(location => ({
      remoteProfileId: location.remoteProfileId ?? location.bindingId ?? '',
      branch: location.remoteBranch ?? '',
      remotePath: location.remotePath ?? '',
      remoteUrl: location.locator,
      uploadedAt: location.updatedAt,
    }))
}

function cloneAsset(asset: ImageAssetRecord): ImageAssetRecord {
  const locations = asset.locations.map(cloneLocation)
  return {
    ...asset,
    locations,
    localPath: deriveLocalPath(locations),
    remoteLocations: deriveRemoteLocations(locations),
  }
}

function isLegacyAssetRecord(value: unknown): value is PersistedAssetV1 {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedAssetV1>
  return typeof record.assetId === 'string'
    && typeof record.sha256 === 'string'
    && typeof record.filename === 'string'
    && typeof record.sizeBytes === 'number'
    && Array.isArray(record.remoteLocations)
}

function isLocationRecord(value: unknown): value is AssetLocationRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AssetLocationRecord>
  return typeof record.locationId === 'string'
    && typeof record.assetId === 'string'
    && typeof record.type === 'string'
    && typeof record.locator === 'string'
    && typeof record.sha256 === 'string'
    && typeof record.availability === 'string'
}

function isV2AssetRecord(value: unknown): value is PersistedAssetV2 {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedAssetV2>
  return typeof record.assetId === 'string'
    && typeof record.sha256 === 'string'
    && typeof record.filename === 'string'
    && typeof record.sizeBytes === 'number'
    && typeof record.contentVersion === 'number'
    && Array.isArray(record.locations)
    && record.locations.every(isLocationRecord)
}

/** v1 → v2：本地路径视为项目位置，远端位置视为 GitHub 位置。 */
function migrateLegacyAsset(record: PersistedAssetV1): ImageAssetRecord {
  const locations: AssetLocationRecord[] = []
  if (record.localPath) {
    locations.push(createLocation({
      assetId: record.assetId,
      sha256: record.sha256,
      type: 'project',
      locator: record.localPath,
      bindingId: null,
      relativePath: null,
      availability: 'available',
      remoteProfileId: null,
      remoteBranch: null,
      remotePath: null,
      remoteVersion: null,
      now: record.updatedAt || record.createdAt,
    }))
  }
  for (const remote of record.remoteLocations) {
    locations.push(createLocation({
      assetId: record.assetId,
      sha256: record.sha256,
      type: 'github',
      locator: remote.remoteUrl,
      bindingId: remote.remoteProfileId,
      relativePath: remote.remotePath,
      availability: 'available',
      remoteProfileId: remote.remoteProfileId,
      remoteBranch: remote.branch,
      remotePath: remote.remotePath,
      remoteVersion: null,
      now: remote.uploadedAt || record.updatedAt,
    }))
  }
  const asset: ImageAssetRecord = {
    assetId: record.assetId,
    sha256: record.sha256,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    contentVersion: 1,
    locations,
    localPath: null,
    remoteLocations: [],
  }
  return cloneAsset(asset)
}

function fromPersistedV2(record: PersistedAssetV2): ImageAssetRecord {
  return cloneAsset({
    ...record,
    locations: record.locations.map(cloneLocation),
    localPath: null,
    remoteLocations: [],
  })
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
    if (!Array.isArray(file.assets)) {
      throw new ImageIndexError('index schema is unsupported', 'INDEX_CORRUPT')
    }

    this.assets.clear()
    if (file.schemaVersion === LEGACY_SCHEMA_VERSION) {
      if (!file.assets.every(isLegacyAssetRecord)) {
        throw new ImageIndexError('index contains invalid asset records', 'INDEX_CORRUPT')
      }
      for (const record of file.assets) {
        const migrated = migrateLegacyAsset(record as PersistedAssetV1)
        this.assets.set(migrated.assetId, migrated)
      }
      this.loaded = true
      return
    }
    if (file.schemaVersion !== IMAGE_INDEX_SCHEMA_VERSION) {
      throw new ImageIndexError('index schema is unsupported', 'INDEX_CORRUPT')
    }
    if (!file.assets.every(isV2AssetRecord)) {
      throw new ImageIndexError('index contains invalid asset records', 'INDEX_CORRUPT')
    }
    for (const record of file.assets) {
      this.assets.set(record.assetId, fromPersistedV2(record as PersistedAssetV2))
    }
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
      if (asset.locations.some(location => location.type !== 'github' && location.locator === localPath)) {
        return cloneAsset(asset)
      }
    }
    return null
  }

  findByLocation(locationId: string): AssetLocationRecord | null {
    for (const asset of this.assets.values()) {
      const found = asset.locations.find(location => location.locationId === locationId)
      if (found) return cloneLocation(found)
    }
    return null
  }

  async upsertLocalFile(input: UpsertLocalFileInput): Promise<UpsertLocalFileResult> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const digest = await sha256File(input.filePath)
      const existing = this.findBySha256(digest.sha256)
      const now = (input.now ?? new Date()).toISOString()
      const locationType = input.locationType ?? 'project'

      if (existing) {
        const stored = this.assets.get(existing.assetId)
        if (stored) {
          const location = createLocation({
            assetId: stored.assetId,
            sha256: stored.sha256,
            type: locationType,
            locator: input.filePath,
            bindingId: input.bindingId ?? null,
            relativePath: input.relativePath ?? null,
            availability: input.availability ?? 'available',
            remoteProfileId: null,
            remoteBranch: null,
            remotePath: null,
            remoteVersion: null,
            now,
          })
          const index = stored.locations.findIndex(item => item.locationId === location.locationId)
          if (index >= 0) {
            stored.locations[index] = { ...location, createdAt: stored.locations[index].createdAt }
          } else {
            stored.locations.push(location)
          }
          stored.updatedAt = now
          await this.persist()
        }
        return { asset: this.get(existing.assetId) as ImageAssetRecord, created: false }
      }

      const filename = input.filename ?? path.basename(input.filePath)
      const assetId = this.allocateAssetId(digest.sha256)
      const location = createLocation({
        assetId,
        sha256: digest.sha256,
        type: locationType,
        locator: input.filePath,
        bindingId: input.bindingId ?? null,
        relativePath: input.relativePath ?? null,
        availability: input.availability ?? 'available',
        remoteProfileId: null,
        remoteBranch: null,
        remotePath: null,
        remoteVersion: null,
        now,
      })
      const record: ImageAssetRecord = {
        assetId,
        sha256: digest.sha256,
        filename,
        mimeType: input.mimeType ?? guessMimeType(filename),
        sizeBytes: digest.sizeBytes,
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
        contentVersion: 1,
        locations: [location],
        localPath: null,
        remoteLocations: [],
      }
      this.assets.set(record.assetId, record)
      await this.persist()
      return { asset: cloneAsset(record), created: true }
    })
  }

  async recordRemoteLocation(input: RecordRemoteLocationInput): Promise<ImageAssetRecord> {
    return this.recordLocation({
      assetId: input.assetId,
      type: 'github',
      locator: input.remoteUrl,
      bindingId: input.remoteProfileId,
      relativePath: input.remotePath,
      availability: input.availability ?? 'available',
      remoteProfileId: input.remoteProfileId,
      remoteBranch: input.branch,
      remotePath: input.remotePath,
      remoteVersion: input.remoteVersion ?? null,
      now: input.now,
    })
  }

  async recordLocation(input: RecordLocationInput): Promise<ImageAssetRecord> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const asset = this.assets.get(input.assetId)
      if (!asset) throw new ImageIndexError(`asset not found: ${input.assetId}`, 'ASSET_NOT_FOUND')

      const now = (input.now ?? new Date()).toISOString()
      const location = createLocation({
        assetId: asset.assetId,
        sha256: asset.sha256,
        type: input.type,
        locator: input.locator,
        bindingId: input.bindingId ?? null,
        relativePath: input.relativePath ?? null,
        availability: input.availability ?? 'available',
        remoteProfileId: input.remoteProfileId ?? null,
        remoteBranch: input.remoteBranch ?? null,
        remotePath: input.remotePath ?? null,
        remoteVersion: input.remoteVersion ?? null,
        now,
      })
      const index = asset.locations.findIndex(item => item.locationId === location.locationId)
      if (index >= 0) {
        asset.locations[index] = { ...location, createdAt: asset.locations[index].createdAt }
      } else {
        asset.locations.push(location)
      }
      asset.updatedAt = now
      await this.persist()
      return cloneAsset(asset)
    })
  }

  async updateLocationAvailability(
    locationId: string,
    availability: AssetAvailability,
    now: Date = new Date(),
  ): Promise<ImageAssetRecord> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      for (const asset of this.assets.values()) {
        const index = asset.locations.findIndex(location => location.locationId === locationId)
        if (index < 0) continue
        const timestamp = now.toISOString()
        asset.locations[index] = {
          ...asset.locations[index],
          availability,
          lastCheckedAt: timestamp,
          updatedAt: timestamp,
        }
        asset.updatedAt = timestamp
        await this.persist()
        return cloneAsset(asset)
      }
      throw new ImageIndexError(`location not found: ${locationId}`, 'ASSET_NOT_FOUND')
    })
  }

  /**
   * 目录迁移完成后同步本地位置：只改写位于旧根内的本地 locator。
   * 远程位置、项目相对路径与内容哈希保持不变。
   */
  async rewriteLocalLocationRoot(fromRoot: string, toRoot: string, now: Date = new Date()): Promise<number> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const from = path.resolve(fromRoot)
      const to = path.resolve(toRoot)
      const timestamp = now.toISOString()
      let updated = 0
      for (const asset of this.assets.values()) {
        let changed = false
        for (let index = 0; index < asset.locations.length; index++) {
          const location = asset.locations[index]
          if (location.type === 'github') continue
          if (!isPathInside(from, location.locator)) continue
          const nextLocator = path.join(to, path.relative(from, location.locator))
          if (normalizeLocalPathForKey(nextLocator) === normalizeLocalPathForKey(location.locator)) continue
          asset.locations[index] = {
            ...location,
            locator: nextLocator,
            lastCheckedAt: timestamp,
            updatedAt: timestamp,
          }
          changed = true
          updated++
        }
        if (changed) asset.updatedAt = timestamp
      }
      if (updated > 0) await this.persist()
      return updated
    })
  }

  /**
   * 备份当前索引文件（不解析内容，损坏文件也原样备份）。
   * 索引不存在时返回 null，不创建空备份。
   */
  async backupTo(directory: string, now: Date = new Date()): Promise<string | null> {
    try {
      await fs.access(this.indexPath)
    } catch {
      return null
    }
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const target = path.join(directory, `image-assets-${stamp}.json`)
    await fs.mkdir(directory, { recursive: true })
    await fs.copyFile(this.indexPath, target)
    return target
  }

  /** 原子写入：临时文件 + rename；失败不破坏既有索引。 */
  async save(): Promise<void> {
    await this.enqueue(() => this.persist())
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async persist(): Promise<void> {
    const payload = {
      schemaVersion: IMAGE_INDEX_SCHEMA_VERSION,
      assets: Array.from(this.assets.values()).map<PersistedAssetV2>(asset => ({
        assetId: asset.assetId,
        sha256: asset.sha256,
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        contentVersion: asset.contentVersion,
        locations: asset.locations.map(cloneLocation),
      })),
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
