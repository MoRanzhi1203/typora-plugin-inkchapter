/**
 * 用户级图片配置（P1-a）。
 *
 * 约束：
 * - 默认值中**不得**包含任何个人路径 / 账号 / 仓库（如 E 盘图库、某人的 GitHub 仓库）。
 * - 凭据只保存引用 ID（`credentialReferenceId`），绝不保存 Token 明文。
 * - 读取侧唯一权威：缺失或非法字段一律按默认值补齐，绝不因配置损坏阻断插件启动。
 */

export type ImageStorageMode = 'local-first' | 'remote-first' | 'dual-storage'
export type ImageReferenceMode = 'local-relative' | 'remote-url'
/**
 * 上传服务。`none` 表示墨章不发起任何新上传、不新增远程位置与双链；
 * 历史远程 URL 仍可正常打开与保留。`github` 只提供上传能力，不会因为
 * 用户选择本地复制模式而自动上传。
 */
export type ImageUploadService = 'none' | 'github'
export type ImageNamingStrategy = 'timestamp-hash' | 'original-name' | 'custom'
export type ImageCompressionMode = 'keep' | 'lossless' | 'smart'
export type ImageRemoteProvider = 'github'
export type ImageUrlStrategy = 'raw' | 'blob' | 'custom'

/** 全局图库：关闭 / 仅索引 / 长期归档。默认关闭，归档才需要物理目录。 */
export type ImageLibraryMode = 'off' | 'index' | 'archive'
export interface ImageGlobalLibrarySettings {
  mode: ImageLibraryMode
  /** 空字符串 = 未选择；仅 `archive` 必须有目录。 */
  root: string
}

/** 普通缓存：关闭 / 智能按需 / 手动。 */
export type ImageCacheMode = 'off' | 'smart' | 'manual'
export interface ImageCacheSettings {
  mode: ImageCacheMode
  /** 空字符串 = 运行时默认（%LOCALAPPDATA%）。 */
  root: string
  maxSizeMB: number
}

export interface ImageOfflineSettings {
  /** 空字符串 = 运行时默认（%LOCALAPPDATA%）。 */
  root: string
}

export interface ImageUploadStagingSettings {
  /** 空字符串 = 运行时默认（%TEMP%）。 */
  root: string
}

export interface ImageDatabaseSettings {
  /** 空字符串 = 插件私有数据目录。 */
  root: string
}

export const DEFAULT_CACHE_MAX_SIZE_MB = 512
export const CACHE_MAX_SIZE_OPTIONS_MB = [256, 512, 1024] as const

export interface ImageRemoteProfile {
  remoteProfileId: string
  provider: ImageRemoteProvider
  owner: string
  repository: string
  /** 空字符串表示「从真实仓库信息读取默认分支」，不得假定为 main。 */
  branch: string
  /** 空字符串表示仓库根目录。 */
  remoteDirectory: string
  urlStrategy: ImageUrlStrategy
  customUrlBase: string
  /** 操作系统凭据中的键名，不是凭据本身。 */
  credentialReferenceId: string
  enabled: boolean
}

export interface ImageTaskLimits {
  maxConcurrentUploads: number
  maxConcurrentDownloads: number
  maxTransientRetries: number
  downloadMaxBytes: number
}

export interface ImageSettings {
  schemaVersion: number
  enabled: boolean
  /** 首次初始化向导是否已完成；未完成时不得创建图库目录。 */
  initialized: boolean
  globalLibrary: ImageGlobalLibrarySettings
  cache: ImageCacheSettings
  offline: ImageOfflineSettings
  uploadStaging: ImageUploadStagingSettings
  database: ImageDatabaseSettings
  /** 文档级资源目录（相对文档所在目录）。 */
  documentResourceDirectory: string
  storageMode: ImageStorageMode
  referenceMode: ImageReferenceMode
  /** 默认 `none`：未显式启用 GitHub 时绝不发起上传。 */
  uploadService: ImageUploadService
  autoUpload: boolean
  namingStrategy: ImageNamingStrategy
  compressionMode: ImageCompressionMode
  convertToWebp: boolean
  defaultRemoteProfileId: string | null
  remoteProfiles: ImageRemoteProfile[]
  limits: ImageTaskLimits
}

export const DEFAULT_IMAGE_LIMITS: ImageTaskLimits = {
  maxConcurrentUploads: 2,
  maxConcurrentDownloads: 3,
  maxTransientRetries: 3,
  downloadMaxBytes: 50 * 1024 * 1024,
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  schemaVersion: 1,
  enabled: false,
  initialized: false,
  globalLibrary: { mode: 'off', root: '' },
  cache: { mode: 'smart', root: '', maxSizeMB: DEFAULT_CACHE_MAX_SIZE_MB },
  offline: { root: '' },
  uploadStaging: { root: '' },
  database: { root: '' },
  documentResourceDirectory: 'assets/images',
  storageMode: 'dual-storage',
  referenceMode: 'local-relative',
  uploadService: 'none',
  autoUpload: false,
  namingStrategy: 'timestamp-hash',
  compressionMode: 'keep',
  convertToWebp: false,
  defaultRemoteProfileId: null,
  remoteProfiles: [],
  limits: DEFAULT_IMAGE_LIMITS,
}

export const EMPTY_IMAGE_REMOTE_PROFILE: ImageRemoteProfile = {
  remoteProfileId: '',
  provider: 'github',
  owner: '',
  repository: '',
  branch: '',
  remoteDirectory: '',
  urlStrategy: 'raw',
  customUrlBase: '',
  credentialReferenceId: '',
  enabled: false,
}

export type PathValidationCode =
  | 'EMPTY'
  | 'INVALID_CHARACTER'
  | 'NOT_ABSOLUTE'
  | 'PARENT_TRAVERSAL'

export interface PathValidationResult {
  ok: boolean
  code?: PathValidationCode
  normalized?: string
}

/** 绝对路径校验（Windows：盘符或 UNC；不支持相对路径）。 */
export function validateImageLibraryPath(raw: unknown): PathValidationResult {
  if (typeof raw !== 'string') return { ok: false, code: 'EMPTY' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, code: 'EMPTY' }
  if (trimmed.includes('\0')) return { ok: false, code: 'INVALID_CHARACTER' }
  const isDrive = /^[a-zA-Z]:[\\/]/.test(trimmed)
  const isUnc = /^\\\\[^\\]/.test(trimmed)
  if (!isDrive && !isUnc) return { ok: false, code: 'NOT_ABSOLUTE' }
  if (trimmed.split(/[\\/]+/).some(segment => segment === '..')) {
    return { ok: false, code: 'PARENT_TRAVERSAL' }
  }
  const normalized = trimmed.replace(/[\\/]+$/, '')
  return { ok: true, normalized }
}

/** 文档资源目录：必须是相对目录，禁止绝对路径与 `..`。空串返回 null。 */
export function normalizeDocumentResourceDirectory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/\\/g, '/')
  if (!value) return null
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null
  const segments = value.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return null
  if (segments.some(segment => segment === '..')) return null
  return segments.join('/')
}

/** 远程目录：`''` 表示根目录；非法（`..`、绝对、控制字符）返回 null。 */
export function normalizeRemoteDirectory(raw: unknown): string | null {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/\\/g, '/')
  if (!value) return ''
  if (/^\/+$/.test(value)) return ''
  if (value.startsWith('/')) return null
  if (/[\0-\x1f]/.test(value)) return null
  const segments = value.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.some(segment => segment === '..')) return null
  return segments.join('/')
}

const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/
const BRANCH_RE = /^[^\s~^:?*[\]\\]+$/

export interface RemoteProfileValidation {
  ok: boolean
  problems: string[]
  normalized: ImageRemoteProfile | null
}

/** 远程仓库配置校验（不访问网络；仓库存在性由 P1-b 的连接测试负责）。 */
export function validateRemoteProfile(raw: unknown): RemoteProfileValidation {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: ['NOT_AN_OBJECT'], normalized: null }
  }
  const input = raw as Partial<ImageRemoteProfile>

  const remoteProfileId = typeof input.remoteProfileId === 'string' ? input.remoteProfileId.trim() : ''
  if (!remoteProfileId) problems.push('REMOTE_PROFILE_ID_REQUIRED')

  const owner = typeof input.owner === 'string' ? input.owner.trim() : ''
  if (!GITHUB_OWNER_RE.test(owner)) problems.push('OWNER_INVALID')

  const repository = typeof input.repository === 'string' ? input.repository.trim() : ''
  if (!GITHUB_REPO_RE.test(repository)) problems.push('REPOSITORY_INVALID')

  const branch = typeof input.branch === 'string' ? input.branch.trim() : ''
  if (branch && (!BRANCH_RE.test(branch) || branch.startsWith('-') || branch.includes('..'))) {
    problems.push('BRANCH_INVALID')
  }

  const remoteDirectory = normalizeRemoteDirectory(input.remoteDirectory)
  if (remoteDirectory === null) problems.push('REMOTE_DIRECTORY_INVALID')

  const urlStrategy: ImageUrlStrategy =
    input.urlStrategy === 'blob' || input.urlStrategy === 'custom' ? input.urlStrategy : 'raw'
  const customUrlBase = typeof input.customUrlBase === 'string' ? input.customUrlBase.trim() : ''
  if (urlStrategy === 'custom' && !/^https?:\/\/\S+$/i.test(customUrlBase)) {
    problems.push('CUSTOM_URL_BASE_INVALID')
  }

  const credentialReferenceId =
    typeof input.credentialReferenceId === 'string' ? input.credentialReferenceId.trim() : ''

  if (problems.length > 0 || remoteDirectory === null) {
    return { ok: false, problems, normalized: null }
  }

  return {
    ok: true,
    problems: [],
    normalized: {
      remoteProfileId,
      provider: 'github',
      owner,
      repository,
      branch,
      remoteDirectory,
      urlStrategy,
      customUrlBase: urlStrategy === 'custom' ? customUrlBase : '',
      credentialReferenceId,
      enabled: input.enabled === true,
    },
  }
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function resolveLimits(raw: Partial<ImageTaskLimits> | undefined): ImageTaskLimits {
  return {
    maxConcurrentUploads: boundedInt(raw?.maxConcurrentUploads, DEFAULT_IMAGE_LIMITS.maxConcurrentUploads, 1, 8),
    maxConcurrentDownloads: boundedInt(raw?.maxConcurrentDownloads, DEFAULT_IMAGE_LIMITS.maxConcurrentDownloads, 1, 8),
    maxTransientRetries: boundedInt(raw?.maxTransientRetries, DEFAULT_IMAGE_LIMITS.maxTransientRetries, 0, 10),
    downloadMaxBytes: boundedInt(
      raw?.downloadMaxBytes,
      DEFAULT_IMAGE_LIMITS.downloadMaxBytes,
      1024 * 1024,
      200 * 1024 * 1024,
    ),
  }
}

function resolveOptionalAbsolutePath(value: unknown): string {
  const validation = validateImageLibraryPath(value)
  return validation.ok && validation.normalized ? validation.normalized : ''
}

function resolveLibraryMode(value: unknown): ImageLibraryMode {
  return value === 'index' || value === 'archive' ? value : 'off'
}

function resolveGlobalLibrary(
  raw: Partial<ImageGlobalLibrarySettings> | undefined,
  legacyRoot: string,
): ImageGlobalLibrarySettings {
  if (!raw && legacyRoot) return { mode: 'archive', root: legacyRoot }
  const root = resolveOptionalAbsolutePath(raw?.root)
  let mode = resolveLibraryMode(raw?.mode)
  // 归档必须有真实目录；缺失时回落到关闭，而不是悄悄创建目录。
  if (mode === 'archive' && !root) mode = 'off'
  return { mode, root }
}

function resolveCache(raw: Partial<ImageCacheSettings> | undefined): ImageCacheSettings {
  const mode: ImageCacheMode = raw?.mode === 'off' || raw?.mode === 'manual' ? raw.mode : 'smart'
  return {
    mode,
    root: resolveOptionalAbsolutePath(raw?.root),
    maxSizeMB: boundedInt(raw?.maxSizeMB, DEFAULT_CACHE_MAX_SIZE_MB, 64, 100 * 1024),
  }
}

function resolveStorageMode(value: unknown): ImageStorageMode {
  return value === 'local-first' || value === 'remote-first' ? value : 'dual-storage'
}

function resolveReferenceMode(value: unknown): ImageReferenceMode {
  return value === 'remote-url' ? 'remote-url' : 'local-relative'
}

/**
 * 上传服务只能显式开启，且必须有已启用的远程配置。
 * 缺失、拼写错误或没有可用远程配置时一律回落为 `none`，
 * 避免旧配置或损坏数据在用户不知情时触发上传。
 */
function resolveUploadService(value: unknown, profiles: ImageRemoteProfile[]): ImageUploadService {
  if (value !== 'github') return 'none'
  return profiles.some(profile => profile.enabled) ? 'github' : 'none'
}

function resolveNamingStrategy(value: unknown): ImageNamingStrategy {
  return value === 'original-name' || value === 'custom' ? value : 'timestamp-hash'
}

function resolveCompressionMode(value: unknown): ImageCompressionMode {
  return value === 'lossless' || value === 'smart' ? value : 'keep'
}

/**
 * 读取侧权威：把任意持久化数据补齐为完整、合法的图片配置。
 * 非法远程配置会被丢弃（而不是带着错误配置继续上传）。
 */
export function resolveImageSettings(
  raw: (Partial<ImageSettings> & { localLibraryPath?: unknown }) | null | undefined,
): ImageSettings {
  const limits = resolveLimits(raw?.limits)

  const resolvedProfiles: ImageRemoteProfile[] = []
  const seenIds = new Set<string>()
  if (Array.isArray(raw?.remoteProfiles)) {
    for (const candidate of raw.remoteProfiles) {
      const validation = validateRemoteProfile(candidate)
      const profile = validation.normalized
      if (!profile || seenIds.has(profile.remoteProfileId)) continue
      seenIds.add(profile.remoteProfileId)
      resolvedProfiles.push(profile)
    }
  }

  // 旧版单一图库路径迁移为归档模式；新配置一旦存在就不再被旧字段覆盖。
  const legacyLibraryRoot = resolveOptionalAbsolutePath(raw?.localLibraryPath)
  const globalLibrary = resolveGlobalLibrary(raw?.globalLibrary, legacyLibraryRoot)
  const cache = resolveCache(raw?.cache)
  const offline = { root: resolveOptionalAbsolutePath(raw?.offline?.root) }
  const uploadStaging = { root: resolveOptionalAbsolutePath(raw?.uploadStaging?.root) }
  const database = { root: resolveOptionalAbsolutePath(raw?.database?.root) }
  const documentResourceDirectory =
    normalizeDocumentResourceDirectory(raw?.documentResourceDirectory)
    ?? DEFAULT_IMAGE_SETTINGS.documentResourceDirectory

  const requestedDefault =
    typeof raw?.defaultRemoteProfileId === 'string' ? raw.defaultRemoteProfileId : null
  const defaultRemoteProfileId = requestedDefault
    && resolvedProfiles.some(profile => profile.remoteProfileId === requestedDefault)
    ? requestedDefault
    : null

  return {
    schemaVersion: 1,
    enabled: raw?.enabled === true,
    initialized: raw?.initialized === true,
    globalLibrary,
    cache,
    offline,
    uploadStaging,
    database,
    documentResourceDirectory,
    storageMode: resolveStorageMode(raw?.storageMode),
    referenceMode: resolveReferenceMode(raw?.referenceMode),
    uploadService: resolveUploadService(raw?.uploadService, resolvedProfiles),
    autoUpload: raw?.autoUpload === true,
    namingStrategy: resolveNamingStrategy(raw?.namingStrategy),
    compressionMode: resolveCompressionMode(raw?.compressionMode),
    convertToWebp: raw?.convertToWebp === true,
    defaultRemoteProfileId,
    remoteProfiles: resolvedProfiles,
    limits,
  }
}
