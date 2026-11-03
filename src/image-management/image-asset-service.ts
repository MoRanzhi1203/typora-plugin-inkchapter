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

  dispose(): void {
    this.disposed = true
    this.loadPromise = null
  }
}
