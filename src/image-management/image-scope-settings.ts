/**
 * 图片配置三级作用域（V5.0）。
 *
 * 层级（优先级从低到高）：
 *   1. 全局默认（用户级 `image` 设置，存于插件设置文件）
 *   2. 指定文件夹（folder scope，只覆盖白名单字段）
 *   3. 当前 Markdown 文档（document scope，只覆盖白名单字段）
 *
 * 设计约束：
 * - 只允许「无隐私、非凭据」的字段被覆盖；Token / 远程仓库凭据 / 本机目录永不进入 scope。
 * - 未设置的字段严格继承上一级，`resolveImageSettingsForDocument` 必须给出每个字段的
 *   真实来源（global / folder / document），设置页据此显示继承关系。
 * - 纯函数，无 IO；路径规范化只在比较时使用，不写入任何绝对路径到共享配置。
 */

import {
  normalizeDocumentResourceDirectory,
  resolveImageSettings,
  type ImageCompressionMode,
  type ImageNamingStrategy,
  type ImageReferenceMode,
  type ImageSettings,
  type ImageStorageMode,
  type ImageUploadService,
} from './image-settings'

export type ImageScopeKind = 'folder' | 'document'

/** 允许被文件夹 / 文档覆盖的字段白名单。 */
export const IMAGE_SCOPE_OVERRIDABLE_KEYS = [
  'documentResourceDirectory',
  'storageMode',
  'referenceMode',
  'uploadService',
  'autoUpload',
  'autoLocalizeOnInsert',
  'namingStrategy',
  'compressionMode',
  'convertToWebp',
  'defaultRemoteProfileId',
] as const

export type ImageScopeOverrideKey = typeof IMAGE_SCOPE_OVERRIDABLE_KEYS[number]

export type ImageScopeOverrides = Partial<Pick<ImageSettings, ImageScopeOverrideKey>>

export interface ImageScopeEntry {
  kind: ImageScopeKind
  /** 规范化后的绝对路径：folder 为文件夹，document 为 Markdown 文件。 */
  path: string
  overrides: ImageScopeOverrides
  updatedAt: string
}

export interface ImageScopeStoreFile {
  schemaVersion: 1
  entries: ImageScopeEntry[]
}

export interface ImageScopeOverrideOrigin {
  key: ImageScopeOverrideKey
  /** 最终生效值的来源层。 */
  origin: 'global' | 'folder' | 'document'
  /** 生效值（用于设置页展示）。 */
  value: unknown
  /** 被覆盖时，上一层（更基础）的值。 */
  inheritedValue: unknown
}

export interface ResolvedImageScope {
  settings: ImageSettings
  origins: ImageScopeOverrideOrigin[]
  appliedFolderPath: string | null
  appliedDocumentPath: string | null
}

export interface ImageScopeSanitizeResult {
  overrides: ImageScopeOverrides
  problems: string[]
}

const STORAGE_MODES: readonly ImageStorageMode[] = ['local-first', 'remote-first', 'dual-storage']
const REFERENCE_MODES: readonly ImageReferenceMode[] = ['local-relative', 'remote-url']
const UPLOAD_SERVICES: readonly ImageUploadService[] = ['none', 'github']
const NAMING_STRATEGIES: readonly ImageNamingStrategy[] = ['timestamp-hash', 'original-name', 'custom']
const COMPRESSION_MODES: readonly ImageCompressionMode[] = ['keep', 'lossless', 'smart']

/** 统一路径形式：正斜杠、去尾斜杠、Windows 盘符小写；不改变大小写语义之外的层级。 */
export function normalizeScopePath(raw: string): string {
  let value = (raw ?? '').trim().replace(/\\/g, '/')
  if (value === '') return ''
  value = value.replace(/\/+/g, '/')
  value = value.replace(/\/+$/, '')
  if (/^[A-Za-z]:\//.test(value)) value = value[0].toLowerCase() + value.slice(1)
  return value
}

/** 文档是否位于某个文件夹作用域内（含同目录）。 */
export function isPathInsideFolder(documentPath: string, folderPath: string): boolean {
  const doc = normalizeScopePath(documentPath)
  const folder = normalizeScopePath(folderPath)
  if (doc === '' || folder === '') return false
  if (doc === folder) return true
  return doc.startsWith(`${folder}/`)
}

/** 选出与当前文档最接近（最长前缀）的文件夹作用域。 */
export function findFolderScope(
  entries: readonly ImageScopeEntry[],
  documentPath: string | null,
): ImageScopeEntry | null {
  if (!documentPath) return null
  let best: ImageScopeEntry | null = null
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue
    if (!isPathInsideFolder(documentPath, entry.path)) continue
    if (best == null || normalizeScopePath(entry.path).length > normalizeScopePath(best.path).length) {
      best = entry
    }
  }
  return best == null ? null : { ...best, path: normalizeScopePath(best.path) }
}

/** 精确匹配当前文档的文档作用域。 */
export function findDocumentScope(
  entries: readonly ImageScopeEntry[],
  documentPath: string | null,
): ImageScopeEntry | null {
  if (!documentPath) return null
  const doc = normalizeScopePath(documentPath)
  const found = entries.find(entry => entry.kind === 'document' && normalizeScopePath(entry.path) === doc)
  return found ? { ...found, path: doc } : null
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/**
 * 校验并裁剪 scope 覆盖：未知键、类型不符、绝对/穿越路径一律丢弃并给出问题码。
 * 绝不接受凭据、Token、远程仓库配置或本机绝对目录。
 */
export function sanitizeImageScopeOverrides(raw: unknown): ImageScopeSanitizeResult {
  const problems: string[] = []
  const overrides: ImageScopeOverrides = {}
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { overrides, problems: ['NOT_AN_OBJECT'] }
  }
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!(IMAGE_SCOPE_OVERRIDABLE_KEYS as readonly string[]).includes(key)) {
      problems.push(`KEY_NOT_ALLOWED:${key}`)
    }
  }
  if (input.documentResourceDirectory !== undefined) {
    const normalized = normalizeDocumentResourceDirectory(input.documentResourceDirectory)
    if (normalized == null) problems.push('DOCUMENT_RESOURCE_DIRECTORY_INVALID')
    else overrides.documentResourceDirectory = normalized
  }
  if (input.storageMode !== undefined) {
    if (isOneOf(input.storageMode, STORAGE_MODES)) overrides.storageMode = input.storageMode
    else problems.push('STORAGE_MODE_INVALID')
  }
  if (input.referenceMode !== undefined) {
    if (isOneOf(input.referenceMode, REFERENCE_MODES)) overrides.referenceMode = input.referenceMode
    else problems.push('REFERENCE_MODE_INVALID')
  }
  if (input.uploadService !== undefined) {
    if (isOneOf(input.uploadService, UPLOAD_SERVICES)) overrides.uploadService = input.uploadService
    else problems.push('UPLOAD_SERVICE_INVALID')
  }
  if (input.autoUpload !== undefined) {
    if (isBoolean(input.autoUpload)) overrides.autoUpload = input.autoUpload
    else problems.push('AUTO_UPLOAD_INVALID')
  }
  if (input.autoLocalizeOnInsert !== undefined) {
    if (isBoolean(input.autoLocalizeOnInsert)) overrides.autoLocalizeOnInsert = input.autoLocalizeOnInsert
    else problems.push('AUTO_LOCALIZE_INVALID')
  }
  if (input.namingStrategy !== undefined) {
    if (isOneOf(input.namingStrategy, NAMING_STRATEGIES)) overrides.namingStrategy = input.namingStrategy
    else problems.push('NAMING_STRATEGY_INVALID')
  }
  if (input.compressionMode !== undefined) {
    if (isOneOf(input.compressionMode, COMPRESSION_MODES)) overrides.compressionMode = input.compressionMode
    else problems.push('COMPRESSION_MODE_INVALID')
  }
  if (input.convertToWebp !== undefined) {
    if (isBoolean(input.convertToWebp)) overrides.convertToWebp = input.convertToWebp
    else problems.push('CONVERT_TO_WEBP_INVALID')
  }
  if (input.defaultRemoteProfileId !== undefined) {
    if (input.defaultRemoteProfileId === null || typeof input.defaultRemoteProfileId === 'string') {
      overrides.defaultRemoteProfileId = input.defaultRemoteProfileId as string | null
    } else {
      problems.push('DEFAULT_REMOTE_PROFILE_INVALID')
    }
  }
  return { overrides, problems }
}

function applyOverrides(base: ImageSettings, overrides: ImageScopeOverrides): ImageSettings {
  const next: ImageSettings = { ...base }
  for (const key of IMAGE_SCOPE_OVERRIDABLE_KEYS) {
    if (overrides[key] !== undefined) {
      // 白名单键与 ImageSettings 字段一一对应，类型由 sanitize 保证。
      ;(next as unknown as Record<string, unknown>)[key] = overrides[key]
    }
  }
  return next
}

/**
 * 解析当前文档的生效图片配置。
 *
 * - document scope 精确匹配文件路径；
 * - folder scope 取覆盖该文件的最近祖先目录；
 * - 字段级继承：global → folder → document；
 * - 返回值包含每个可覆盖字段的真实来源，供设置页展示“继承自哪里”。
 */
export function resolveImageSettingsForDocument(input: {
  globalSettings: ImageSettings
  documentPath: string | null
  entries: readonly ImageScopeEntry[]
}): ResolvedImageScope {
  const folderScope = findFolderScope(input.entries, input.documentPath)
  const documentScope = findDocumentScope(input.entries, input.documentPath)

  const afterFolder = folderScope ? applyOverrides(input.globalSettings, folderScope.overrides) : input.globalSettings
  const merged = documentScope ? applyOverrides(afterFolder, documentScope.overrides) : afterFolder
  // 合并后仍走一次读取侧权威校验：scope 选了 github 但没有可用远程配置时回落 none，
  // 绝不因为作用域覆盖而绕过“上传服务必须显式可用”的约束。
  const finalSettings = resolveImageSettings(merged as never)

  const origins: ImageScopeOverrideOrigin[] = IMAGE_SCOPE_OVERRIDABLE_KEYS.map(key => {
    const globalValue = (input.globalSettings as unknown as Record<string, unknown>)[key]
    const folderValue = folderScope?.overrides[key]
    const documentValue = documentScope?.overrides[key]
    const finalValue = (finalSettings as unknown as Record<string, unknown>)[key]
    if (documentValue !== undefined) {
      return { key, origin: 'document', value: finalValue, inheritedValue: folderValue ?? globalValue }
    }
    if (folderValue !== undefined) {
      return { key, origin: 'folder', value: finalValue, inheritedValue: globalValue }
    }
    return { key, origin: 'global', value: finalValue, inheritedValue: globalValue }
  })

  return {
    settings: finalSettings,
    origins,
    appliedFolderPath: folderScope ? normalizeScopePath(folderScope.path) : null,
    appliedDocumentPath: documentScope ? normalizeScopePath(documentScope.path) : null,
  }
}

/** 读取某个字段的生效来源（设置页徽章用）。 */
export function scopeOriginOf(resolved: ResolvedImageScope, key: ImageScopeOverrideKey): 'global' | 'folder' | 'document' {
  return resolved.origins.find(item => item.key === key)?.origin ?? 'global'
}

/** 生成一个空的 scope 存储文件。 */
export function emptyImageScopeStore(): ImageScopeStoreFile {
  return { schemaVersion: 1, entries: [] }
}
