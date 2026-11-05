/**
 * 图片资产服务的薄生命周期封装（P2）。
 *
 * 只负责：路径解析 → 延迟加载索引 → 释放。
 * 资产模型、去重与位置规则全部在 `image-asset-index` / `image-asset-model`，
 * 不在这里另建一套并行实现。
 */

import {
  ImageAssetIndex,
  type ImageAssetRecord,
  type RecordLocationInput,
  type RecordRemoteLocationInput,
  type UpsertLocalFileInput,
  type UpsertLocalFileResult,
} from './image-asset-index'
import type { ImageDataPaths } from './image-data-paths'
import {
  executePathMigration,
  type ExecutePathMigrationResult,
  type PathMigrationPlan,
} from './image-path-migration'

export class ImageAssetService {
  private readonly index: ImageAssetIndex
  private loadPromise: Promise<void> | null = null
  private disposed = false

  constructor(readonly paths: ImageDataPaths) {
    this.index = new ImageAssetIndex(paths.assetIndexFile)
  }

  getIndexPath(): string {
    return this.index.getIndexPath()
  }

  /**
   * 首次使用时才读盘；损坏索引向调用方抛出，绝不静默重建或覆盖。
   * 加载失败后允许下一次调用重试（不会缓存被拒绝的 Promise）。
   */
  async ensureLoaded(): Promise<void> {
    if (this.disposed) throw new Error('image asset service disposed')
    if (!this.loadPromise) {
      this.loadPromise = this.index.load().catch(error => {
        this.loadPromise = null
        throw error
      })
    }
    await this.loadPromise
  }

  async upsertLocalFile(input: UpsertLocalFileInput): Promise<UpsertLocalFileResult> {
    await this.ensureLoaded()
    return this.index.upsertLocalFile(input)
  }

  async recordRemoteLocation(input: RecordRemoteLocationInput): Promise<ImageAssetRecord> {
    await this.ensureLoaded()
    return this.index.recordRemoteLocation(input)
  }

  async recordLocation(input: RecordLocationInput): Promise<ImageAssetRecord> {
    await this.ensureLoaded()
    return this.index.recordLocation(input)
  }

  async list(): Promise<ImageAssetRecord[]> {
    await this.ensureLoaded()
    return this.index.list()
  }

  /**
   * 把失效的本地位置标记为 missing；历史记录保留，便于诊断与后续修复。
   * 只更新索引，不触碰用户文件。
   */
  async markLocationUnavailable(locationId: string): Promise<boolean> {
    try {
      await this.ensureLoaded()
      await this.index.updateLocationAvailability(locationId, 'missing')
      return true
    } catch {
      return false
    }
  }

  /** 目录迁移成功后同步数据库中的本地位置。 */
  async rewriteLocalLocationRoot(fromRoot: string, toRoot: string): Promise<number> {
    await this.ensureLoaded()
    return this.index.rewriteLocalLocationRoot(fromRoot, toRoot)
  }

  /**
   * 备份 → 迁移复制校验 → 更新本地位置。
   * 迁移失败时不改写数据库；数据库更新失败时保留迁移日志以便回滚。
   */
  async applyPathMigration(
    plan: PathMigrationPlan,
    options: { deleteSource?: boolean } = {},
  ): Promise<{
    ok: boolean
    backupPath: string | null
    migration: ExecutePathMigrationResult
    indexUpdated: number
    error?: string
  }> {
    const backupPath = await this.index.backupTo(this.paths.backupDir)
    const migration = await executePathMigration(plan, {
      backupDir: this.paths.backupDir,
      deleteSource: options.deleteSource,
    })
    if (!migration.ok) {
      return { ok: false, backupPath, migration, indexUpdated: 0, error: migration.error }
    }
    try {
      const indexUpdated = await this.rewriteLocalLocationRoot(plan.fromRoot, plan.toRoot)
      return { ok: true, backupPath, migration, indexUpdated }
    } catch (error) {
      return {
        ok: false,
        backupPath,
        migration,
        indexUpdated: 0,
        error: `INDEX_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.loadPromise = null
  }
}
