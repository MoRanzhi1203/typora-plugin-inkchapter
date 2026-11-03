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
export type ImageNamingStrategy = 'timestamp-hash' | 'original-name' | 'custom'
export type ImageCompressionMode = 'keep' | 'lossless' | 'smart'
export type ImageRemoteProvider = 'github'
export type ImageUrlStrategy = 'raw' | 'blob' | 'custom'

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
  localLibraryPath: string
  /** 文档级资源目录（相对文档所在目录）。 */
  documentResourceDirectory: string
  storageMode: ImageStorageMode
  referenceMode: ImageReferenceMode
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
  localLibraryPath: '',
  documentResourceDirectory: 'assets/images',
  storageMode: 'dual-storage',
  referenceMode: 'local-relative',
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

function resolveStorageMode(value: unknown): ImageStorageMode {
  return value === 'local-first' || value === 'remote-first' ? value : 'dual-storage'
}

function resolveReferenceMode(value: unknown): ImageReferenceMode {
  return value === 'remote-url' ? 'remote-url' : 'local-relative'
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
export function resolveImageSettings(raw: Partial<ImageSettings> | null | undefined): ImageSettings {
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

  const localLibraryPath =
    validateImageLibraryPath(raw?.localLibraryPath).normalized ?? DEFAULT_IMAGE_SETTINGS.localLibraryPath
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
    localLibraryPath,
    documentResourceDirectory,
    storageMode: resolveStorageMode(raw?.storageMode),
    referenceMode: resolveReferenceMode(raw?.referenceMode),
    autoUpload: raw?.autoUpload === true,
    namingStrategy: resolveNamingStrategy(raw?.namingStrategy),
    compressionMode: resolveCompressionMode(raw?.compressionMode),
    convertToWebp: raw?.convertToWebp === true,
    defaultRemoteProfileId,
    remoteProfiles: resolvedProfiles,
    limits,
  }
}
