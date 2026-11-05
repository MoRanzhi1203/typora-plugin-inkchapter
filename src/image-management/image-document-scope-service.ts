/**
 * 当前文档的图片配置作用域服务（V5.0）。
 *
 * 把「全局设置 + scope store + 当前文档路径」组合成一个可复用的读取入口：
 * 下载 / 上传 / 批量任务 / 图库中心 / 设置页都通过它拿**当前文档生效配置**，
 * 而不是各自直接读全局设置。
 */

import * as path from 'path'
import type { ImageSettings } from './image-settings'
import type { ImageScopeStore } from './image-scope-store'
import {
  normalizeScopePath,
  resolveImageSettingsForDocument,
  type ImageScopeEntry,
  type ImageScopeOverrides,
  type ResolvedImageScope,
} from './image-scope-settings'

export interface ImageDocumentScopeServiceOptions {
  getGlobalSettings: () => ImageSettings
  getActiveDocumentPath: () => string | null
  store: ImageScopeStore
}

export class ImageDocumentScopeService {
  constructor(private readonly options: ImageDocumentScopeServiceOptions) {}

  getStore(): ImageScopeStore {
    return this.options.store
  }

  getActiveDocumentPath(): string | null {
    return this.options.getActiveDocumentPath()
  }

  /** 当前文档所在文件夹（用于“为当前文件夹设置”），无文档时返回 null。 */
  getActiveFolderPath(): string | null {
    const documentPath = this.options.getActiveDocumentPath()
    if (!documentPath) return null
    const dir = path.dirname(documentPath)
    return dir === '.' ? null : normalizeScopePath(dir)
  }

  async resolve(): Promise<ResolvedImageScope> {
    return this.resolveFor(this.options.getActiveDocumentPath())
  }

  async resolveFor(documentPath: string | null): Promise<ResolvedImageScope> {
    const globalSettings = this.options.getGlobalSettings()
    const entries = await this.options.store.list()
    return resolveImageSettingsForDocument({ globalSettings, documentPath, entries })
  }

  async list(): Promise<ImageScopeEntry[]> {
    return this.options.store.list()
  }

  async setDocumentScope(overrides: ImageScopeOverrides): Promise<void> {
    const documentPath = this.options.getActiveDocumentPath()
    if (!documentPath) throw new Error('NO_ACTIVE_DOCUMENT')
    await this.options.store.setDocument(documentPath, overrides)
  }

  async setFolderScope(overrides: ImageScopeOverrides): Promise<void> {
    const folderPath = this.getActiveFolderPath()
    if (!folderPath) throw new Error('NO_ACTIVE_FOLDER')
    await this.options.store.setFolder(folderPath, overrides)
  }

  async clearDocumentScope(): Promise<void> {
    const documentPath = this.options.getActiveDocumentPath()
    if (!documentPath) return
    await this.options.store.remove('document', documentPath)
  }

  async clearFolderScope(): Promise<void> {
    const folderPath = this.getActiveFolderPath()
    if (!folderPath) return
    await this.options.store.remove('folder', folderPath)
  }

  /** 当前文档的实际覆盖（未设置返回 null），用于设置页回填。 */
  async getDocumentOverride(): Promise<ImageScopeOverrides | null> {
    const documentPath = this.options.getActiveDocumentPath()
    if (!documentPath) return null
    const entry = await this.options.store.getDocument(documentPath)
    return entry ? entry.overrides : null
  }

  /** 当前文件夹的实际覆盖（未设置返回 null），用于设置页回填。 */
  async getFolderOverride(): Promise<ImageScopeOverrides | null> {
    const folderPath = this.getActiveFolderPath()
    if (!folderPath) return null
    const entry = await this.options.store.getFolder(folderPath)
    return entry ? entry.overrides : null
  }
}
