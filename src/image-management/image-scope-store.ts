/**
 * 图片配置作用域存储（V5.0）。
 *
 * 存放位置：插件私有数据目录下的 `image-scopes.json`（用户级，Git 工作区之外）。
 * 这样「项目内文档」和「项目外单独打开的 Markdown」共用同一套文档 / 文件夹覆盖，
 * 且不会把本机绝对路径写进项目仓库。
 *
 * 写入采用临时文件 + rename，避免半截 JSON；读取失败一律回退为空存储，
 * 绝不让损坏的 scope 文件阻断插件启动。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ImageSettings } from './image-settings'
import {
  emptyImageScopeStore,
  normalizeScopePath,
  resolveImageSettingsForDocument,
  sanitizeImageScopeOverrides,
  type ImageScopeEntry,
  type ImageScopeKind,
  type ImageScopeOverrides,
  type ImageScopeStoreFile,
  type ResolvedImageScope,
} from './image-scope-settings'

const FILE_NAME = 'image-scopes.json'

export interface ImageScopeStoreOptions {
  dataRoot: string
  /** 测试注入点；默认使用 node:fs/promises。 */
  now?: () => Date
}

export class ImageScopeStore {
  private readonly filePath: string
  private readonly now: () => Date
  private cache: ImageScopeStoreFile | null = null

  constructor(options: ImageScopeStoreOptions) {
    this.filePath = path.join(options.dataRoot, FILE_NAME)
    this.now = options.now ?? (() => new Date())
  }

  getFilePath(): string {
    return this.filePath
  }

  private normalizeStore(raw: unknown): ImageScopeStoreFile {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return emptyImageScopeStore()
    const input = raw as { schemaVersion?: unknown; entries?: unknown }
    if (!Array.isArray(input.entries)) return emptyImageScopeStore()
    const entries: ImageScopeEntry[] = []
    const seen = new Set<string>()
    for (const candidate of input.entries) {
      if (candidate == null || typeof candidate !== 'object') continue
      const item = candidate as Partial<ImageScopeEntry>
      if (item.kind !== 'folder' && item.kind !== 'document') continue
      const normalizedPath = normalizeScopePath(String(item.path ?? ''))
      if (normalizedPath === '') continue
      const key = `${item.kind}|${normalizedPath}`
      if (seen.has(key)) continue
      seen.add(key)
      const sanitized = sanitizeImageScopeOverrides(item.overrides)
      entries.push({
        kind: item.kind,
        path: normalizedPath,
        overrides: sanitized.overrides,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      })
    }
    return { schemaVersion: 1, entries }
  }

  async load(force = false): Promise<ImageScopeStoreFile> {
    if (this.cache && !force) return this.cache
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      // 外部编辑器 / PowerShell 可能写入 UTF-8 BOM；它必须被剥离，
      // 否则 JSON.parse 失败会让整个作用域静默回退为空。
      const text = raw.replace(/^\uFEFF/, '')
      this.cache = this.normalizeStore(JSON.parse(text))
    } catch {
      this.cache = emptyImageScopeStore()
    }
    return this.cache
  }

  async list(): Promise<ImageScopeEntry[]> {
    const store = await this.load()
    return store.entries.map(entry => ({ ...entry, overrides: { ...entry.overrides } }))
  }

  async getFolder(folderPath: string): Promise<ImageScopeEntry | null> {
    const target = normalizeScopePath(folderPath)
    const store = await this.load()
    return store.entries.find(entry => entry.kind === 'folder' && entry.path === target) ?? null
  }

  async getDocument(documentPath: string): Promise<ImageScopeEntry | null> {
    const target = normalizeScopePath(documentPath)
    const store = await this.load()
    return store.entries.find(entry => entry.kind === 'document' && entry.path === target) ?? null
  }

  private async persist(entries: ImageScopeEntry[]): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    const body: ImageScopeStoreFile = { schemaVersion: 1, entries }
    const tmp = `${this.filePath}.tmp`
    await fs.promises.writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
    await fs.promises.rename(tmp, this.filePath)
    this.cache = body
  }

  private async upsert(kind: ImageScopeKind, targetPath: string, overrides: ImageScopeOverrides): Promise<void> {
    const normalizedPath = normalizeScopePath(targetPath)
    if (normalizedPath === '') throw new Error('EMPTY_SCOPE_PATH')
    const sanitized = sanitizeImageScopeOverrides(overrides)
    const store = await this.load()
    const entries = store.entries.filter(entry => !(entry.kind === kind && entry.path === normalizedPath))
    if (Object.keys(sanitized.overrides).length > 0) {
      entries.push({
        kind,
        path: normalizedPath,
        overrides: sanitized.overrides,
        updatedAt: this.now().toISOString(),
      })
    }
    await this.persist(entries)
  }

  async setFolder(folderPath: string, overrides: ImageScopeOverrides): Promise<void> {
    await this.upsert('folder', folderPath, overrides)
  }

  async setDocument(documentPath: string, overrides: ImageScopeOverrides): Promise<void> {
    await this.upsert('document', documentPath, overrides)
  }

  async remove(kind: ImageScopeKind, targetPath: string): Promise<void> {
    const normalizedPath = normalizeScopePath(targetPath)
    const store = await this.load()
    await this.persist(store.entries.filter(entry => !(entry.kind === kind && entry.path === normalizedPath)))
  }

  /** 文档路径 → 生效配置（文件夹 / 文档覆盖 + 字段来源）。 */
  async resolve(documentPath: string | null, globalSettings: ImageSettings): Promise<ResolvedImageScope> {
    const entries = await this.list()
    return resolveImageSettingsForDocument({ globalSettings, documentPath, entries })
  }
}
