/**
 * GitHub 远程图片索引（D2）。
 *
 * 目的：上传前判断目标仓库/分支的同一目录里是否已有**内容相同**的图片，
 * 命中则直接复用远端 URL，避免重复上传。
 *
 * 证据边界（已按 GitHub 官方文档取证）：
 * - Contents API 的目录响应最多返回 1000 个条目，超过时需要 Git Trees API；
 *   达到上限时本模块标记 `complete = false`，绝不据此断言“仓库没有重复”。
 * - 文件 ≤1MB 时 contents 响应带 base64 `content`；更大文件需要 raw media type。
 *   本模块对超限候选返回“未验证”，而不是冒充命中。
 * - `sha` 是 Git blob SHA，**不能**与 SHA-256 直接比较；必须解码内容后计算 SHA-256。
 * - `download_url` 会过期，因此复用 URL 由仓库/分支/路径稳定生成。
 */

import { createHash } from 'crypto'
import type { GitHubJsonRequester } from './github-connection-test'
import type { ImageRemoteProfile } from './image-settings'

/** GitHub 目录条目的 1000 条上限（官方文档）。 */
export const GITHUB_DIRECTORY_ENTRY_LIMIT = 1000
/** Contents API 直接返回 base64 内容的大小上限（1MB）。 */
export const GITHUB_INLINE_CONTENT_LIMIT_BYTES = 1024 * 1024

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])

export interface RemoteImageEntry {
  path: string
  name: string
  /** Git blob SHA；仅用于远端版本标识，不等于内容 SHA-256。 */
  sha: string
  size: number
}

export interface RemoteDirectoryIndex {
  ok: boolean
  entries: RemoteImageEntry[]
  /** false 表示结果被截断或 API 未返回完整信息，不能推断“不存在”。 */
  complete: boolean
  errorCode: string | null
}

export interface RemoteContentMatch {
  path: string
  gitSha: string
  size: number
  sha256: string
}

export interface RemoteIndexRequestContext {
  request: GitHubJsonRequester
  token: string
  profile: ImageRemoteProfile
  branch: string
}

function isImageFile(name: string): boolean {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(extension)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function encodeRepoPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment !== '' && segment !== '.')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function contentsApiPath(profile: ImageRemoteProfile, directory: string): string {
  const base = `/repos/${encodeURIComponent(profile.owner)}/${encodeURIComponent(profile.repository)}/contents`
  const encoded = encodeRepoPath(directory)
  return encoded ? `${base}/${encoded}` : base
}

function parseEntries(json: unknown): RemoteImageEntry[] {
  if (!Array.isArray(json)) return []
  const out: RemoteImageEntry[] = []
  for (const item of json) {
    const record = asRecord(item)
    if (!record) continue
    if (record.type !== 'file') continue
    const path = typeof record.path === 'string' ? record.path : ''
    const name = typeof record.name === 'string' ? record.name : path.split('/').pop() ?? ''
    const sha = typeof record.sha === 'string' ? record.sha : ''
    const size = typeof record.size === 'number' ? record.size : -1
    if (!path || !name || !sha || size < 0) continue
    if (!isImageFile(name)) continue
    out.push({ path, name, sha, size })
  }
  return out
}

/**
 * 列出上传目录内的图片条目。
 * 目录不存在（404）返回空索引并标记 `complete = true`：该目录范围内确实没有文件。
 */
export async function listRemoteImageEntries(
  context: RemoteIndexRequestContext & { directory: string },
): Promise<RemoteDirectoryIndex> {
  const path = `${contentsApiPath(context.profile, context.directory)}?ref=${encodeURIComponent(context.branch)}`
  try {
    const response = await context.request({ token: context.token, path })
    if (response.status === 404) {
      return { ok: true, entries: [], complete: true, errorCode: null }
    }
    if (response.status === 200) {
      if (!Array.isArray(response.json)) {
        // 路径指向文件而不是目录：不能假设整个目录为空。
        return { ok: false, entries: [], complete: false, errorCode: 'REMOTE_PATH_NOT_DIRECTORY' }
      }
      const entries = parseEntries(response.json)
      const complete = response.json.length < GITHUB_DIRECTORY_ENTRY_LIMIT
      return { ok: true, entries, complete, errorCode: null }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, entries: [], complete: false, errorCode: 'REMOTE_INDEX_FORBIDDEN' }
    }
    return { ok: false, entries: [], complete: false, errorCode: `REMOTE_INDEX_HTTP_${response.status}` }
  } catch {
    return { ok: false, entries: [], complete: false, errorCode: 'REMOTE_INDEX_NETWORK_ERROR' }
  }
}

interface CandidateContent {
  sha256: string
  gitSha: string
  size: number
}

/** 读取单个候选文件并计算 SHA-256；无法证明时返回 null。 */
async function readCandidateContent(
  context: RemoteIndexRequestContext,
  entry: RemoteImageEntry,
): Promise<CandidateContent | null> {
  if (entry.size > GITHUB_INLINE_CONTENT_LIMIT_BYTES) return null
  const path = `${contentsApiPath(context.profile, entry.path)}?ref=${encodeURIComponent(context.branch)}`
  try {
    const response = await context.request({ token: context.token, path })
    if (response.status !== 200) return null
    const record = asRecord(response.json)
    if (!record) return null
    if (record.encoding !== 'base64' || typeof record.content !== 'string' || !record.content) return null
    const decoded = Buffer.from(record.content.replace(/\s+/g, ''), 'base64')
    if (decoded.byteLength === 0) return null
    const bytes = new Uint8Array(decoded)
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      gitSha: typeof record.sha === 'string' ? record.sha : entry.sha,
      size: typeof record.size === 'number' ? record.size : bytes.byteLength,
    }
  } catch {
    return null
  }
}

/**
 * 在已索引条目中寻找与指定 SHA-256 完全一致的文件。
 *
 * 只用「大小相同」做候选筛选，再用实际内容哈希确认；文件名、alt 与图号
 * 不参与判定。候选过多或内容超限时返回 null（= 未找到已验证匹配）。
 */
export async function findRemoteContentBySha256(
  context: RemoteIndexRequestContext & {
    entries: readonly RemoteImageEntry[]
    sha256: string
    sizeBytes: number
    maxCandidates?: number
  },
): Promise<RemoteContentMatch | null> {
  const maxCandidates = Math.max(1, Math.floor(context.maxCandidates ?? 8))
  const candidates = context.entries
    .filter(entry => entry.size === context.sizeBytes)
    .slice(0, maxCandidates)
  for (const entry of candidates) {
    const content = await readCandidateContent(context, entry)
    if (!content) continue
    if (content.sha256 !== context.sha256) continue
    return {
      path: entry.path,
      gitSha: content.gitSha,
      size: content.size,
      sha256: content.sha256,
    }
  }
  return null
}

/**
 * 读取远端文件的 Git blob SHA 与大小，作为「对象版本」记录到资产索引。
 * 只用于后续轻量校验位置未变化；失败返回 null，不影响上传结果。
 */
export async function readRemoteFileVersion(
  context: RemoteIndexRequestContext,
  remotePath: string,
): Promise<{ gitSha: string; size: number } | null> {
  const path = `${contentsApiPath(context.profile, remotePath)}?ref=${encodeURIComponent(context.branch)}`
  try {
    const response = await context.request({ token: context.token, path })
    if (response.status !== 200) return null
    const record = asRecord(response.json)
    if (!record || typeof record.sha !== 'string') return null
    const size = typeof record.size === 'number' ? record.size : -1
    return { gitSha: record.sha, size }
  } catch {
    return null
  }
}

/**
 * 判断 URL 是否确实指向该 Profile 的仓库。
 *
 * 仅凭 `remoteProfileId` 相同不足以证明同一个仓库：用户可能修改了仓库配置。
 * 自定义 CDN 无法从 URL 反推仓库身份，返回 true 并由调用方再用目录范围校验。
 */
export function isRemoteUrlForProfile(url: string, profile: ImageRemoteProfile): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (host === 'raw.githubusercontent.com') {
    return segments[0] === profile.owner && segments[1] === profile.repository
  }
  if (host === 'github.com') {
    return segments[0] === profile.owner && segments[1] === profile.repository
  }
  return true
}

/**
 * 由仓库身份与策略生成稳定图片 URL。
 * `download_url` 会过期，不能持久化；这里每次按 profile 配置重新构造。
 */
export function buildRemoteImageUrl(input: {
  profile: ImageRemoteProfile
  branch: string
  path: string
}): string | null {
  const path = encodeRepoPath(input.path)
  if (!path) return null
  const { profile, branch } = input
  if (profile.urlStrategy === 'custom') {
    const base = profile.customUrlBase.trim().replace(/\/+$/, '')
    return /^https?:\/\/\S+$/i.test(base) ? `${base}/${path}` : null
  }
  if (profile.urlStrategy === 'blob') {
    return `https://github.com/${profile.owner}/${profile.repository}/blob/${encodeURIComponent(branch)}/${path}`
  }
  return `https://raw.githubusercontent.com/${profile.owner}/${profile.repository}/${encodeURIComponent(branch)}/${path}`
}
