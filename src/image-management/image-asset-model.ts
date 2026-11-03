/**
 * 图片资产统一模型（P2）。
 *
 * 约束（来自主计划）：
 * - 一张图片一个稳定 `assetId`；`sha256` 只用于完全相同内容的去重。
 * - 同一资产可有多个 `location`（项目 / 图库 / 缓存 / 离线 / GitHub），
 *   以及多个 Markdown `reference`。
 * - `cache` 是临时副本，不能当作永久双存储；离线固定资源与图库不得被普通缓存清理混淆。
 * - 本模块只做纯函数与类型定义，不做文件 IO、不发网络请求。
 */

import { createHash } from 'crypto'
import * as path from 'path'
import {
  classifyResourceClass,
  parseImageSourceOccurrences,
  type ResourceClass,
} from '../document-utilities/document-resource-scanner'
import { computeMarkdownLiteralRanges, isSourceRangeLiteral } from '../document-utilities/document-markdown-literal-exclusion-v1'

export type AssetLocationType = 'project' | 'library' | 'cache' | 'offline' | 'github'
export type AssetAvailability = 'available' | 'missing' | 'unknown'
export type AssetStorageState = 'LOCAL_ONLY' | 'REMOTE_ONLY' | 'DUAL_AVAILABLE'

/** 一个资产在某处的具体落点。 */
export interface AssetLocationRecord {
  locationId: string
  assetId: string
  type: AssetLocationType
  /** project/library/cache/offline 为逻辑绑定 ID；github 为 remoteProfileId。 */
  bindingId: string | null
  /** 本地绝对路径或远程 URL。 */
  locator: string
  /** 项目/仓库内相对路径；用于可分享清单，不含用户绝对路径。 */
  relativePath: string | null
  sha256: string
  availability: AssetAvailability
  lastCheckedAt: string | null
  remoteProfileId: string | null
  remoteBranch: string | null
  remotePath: string | null
  /** 远端不可变版本（如 Git blob sha）；本地内容 sha256 与之不可直接比较。 */
  remoteVersion: string | null
  createdAt: string
  updatedAt: string
}

export interface BuildLocationKeyInput {
  type: AssetLocationType
  locator: string
  bindingId?: string | null
  remoteProfileId?: string | null
  remoteBranch?: string | null
  remotePath?: string | null
}

/**
 * 去重键：
 * - 本地位置按「类型 + 绑定 + 规范化路径」；Windows 大小写不敏感。
 * - GitHub 位置按「profile + 分支 + 仓库内路径」，URL 变化不产生新位置。
 */
export function buildAssetLocationKey(input: BuildLocationKeyInput): string {
  if (input.type === 'github') {
    return [
      'github',
      input.remoteProfileId ?? input.bindingId ?? '',
      input.remoteBranch ?? '',
      normalizeRemotePathForKey(input.remotePath ?? input.locator),
    ].join('|')
  }
  return [
    input.type,
    input.bindingId ?? '',
    normalizeLocalPathForKey(input.locator),
  ].join('|')
}

export function buildLocationId(key: string): string {
  return `loc_${sha256Hex(key).slice(0, 20)}`
}

/** Windows 本地路径比较规范化：分隔符、重复斜杠、尾斜杠、大小写。 */
export function normalizeLocalPathForKey(raw: string): string {
  let value = raw.trim().replace(/\\/g, '/')
  if (value.startsWith('//')) {
    value = `//${value.slice(2).replace(/\/+/g, '/')}`
  } else {
    value = value.replace(/\/+/g, '/')
  }
  value = value.replace(/\/+$/, '')
  return value.toLowerCase()
}

/** 仓库内路径比较规范化：保留大小写（GitHub 区分大小写），去掉首尾斜杠。 */
export function normalizeRemotePathForKey(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * 永久本地副本：项目 / 图库 / 离线固定。
 * `cache` 明确排除，避免把临时缓存冒充为双存储。
 */
export function isPermanentLocalLocation(location: AssetLocationRecord): boolean {
  return location.type === 'project' || location.type === 'library' || location.type === 'offline'
}

/**
 * 存储状态仅描述「当前有哪些真实可用的落点」。
 * 上传待办、失败、远端失效使用 `availability` 与任务记录表达，不压进本枚举。
 */
export function deriveStorageState(locations: readonly AssetLocationRecord[]): AssetStorageState {
  const hasLocal = locations.some(
    location => isPermanentLocalLocation(location) && location.availability === 'available',
  )
  const hasRemote = locations.some(
    location => location.type === 'github' && location.availability === 'available',
  )
  if (hasLocal && hasRemote) return 'DUAL_AVAILABLE'
  if (hasRemote) return 'REMOTE_ONLY'
  return 'LOCAL_ONLY'
}

/**
 * 本地副本复用顺序：图库 → 项目 → 离线固定 → 普通缓存。
 * 该顺序只决定「复用哪个本地副本」，不改变在线/离线策略。
 */
const LOCAL_REUSE_ORDER: AssetLocationType[] = ['library', 'project', 'offline', 'cache']

export function pickReusableLocalLocation(
  locations: readonly AssetLocationRecord[],
): AssetLocationRecord | null {
  for (const type of LOCAL_REUSE_ORDER) {
    const found = locations.find(location => location.type === type && location.availability === 'available')
    if (found) return found
  }
  return null
}

export type ResolvedImageDestinationKind =
  | 'remote'
  | 'local-relative'
  | 'local-absolute'
  | 'data'
  | 'unsupported'

export interface ResolvedImageDestination {
  kind: ResolvedImageDestinationKind
  raw: string
  decoded: string
  /** 本地文件的绝对路径；非本地为 null。 */
  fsPath: string | null
  /** 远程 URL；非远程为 null。 */
  remoteUrl: string | null
}

/**
 * 解码 Typora 可能写出的两种百分号编码：
 * - 标准 `%XX`（含中文、空格、`#` → `%23`）
 * - Typora 历史 `%uXXXX`
 * 只解码一层，失败时保留原文，绝不二次解码。
 */
export function decodeTyporaPath(raw: string): string {
  const unicodeDecoded = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)))
  try {
    return decodeURIComponent(unicodeDecoded)
  } catch {
    return unicodeDecoded
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripAngleBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1).trim()
  return trimmed
}

/**
 * 解析 Markdown 图片目标为可用的本地路径或远程 URL。
 * 不假定工作区根目录：相对路径一律相对当前文档所在目录解析。
 */
export function resolveImageDestination(rawDestination: string, documentDir: string): ResolvedImageDestination {
  const raw = rawDestination
  const stripped = stripAngleBrackets(raw)
  if (!stripped) {
    return { kind: 'unsupported', raw, decoded: '', fsPath: null, remoteUrl: null }
  }
  const resourceClass: ResourceClass = classifyResourceClass(stripped)
  if (resourceClass === 'data') {
    return { kind: 'data', raw, decoded: stripped, fsPath: null, remoteUrl: null }
  }
  if (/^file:\/\//i.test(stripped)) {
    const withoutScheme = stripped.replace(/^file:\/\/\/?/i, '')
    const decoded = decodeTyporaPath(withoutScheme)
    if (!decoded) return { kind: 'unsupported', raw, decoded, fsPath: null, remoteUrl: null }
    return {
      kind: 'local-absolute',
      raw,
      decoded,
      fsPath: path.normalize(decoded),
      remoteUrl: null,
    }
  }
  if (resourceClass === 'remote') {
    return { kind: 'remote', raw, decoded: stripped, fsPath: null, remoteUrl: stripped }
  }
  if (resourceClass === 'other') {
    return { kind: 'unsupported', raw, decoded: stripped, fsPath: null, remoteUrl: null }
  }

  const decoded = decodeTyporaPath(stripped)
  if (/^[a-zA-Z]:[\\/]/.test(decoded)) {
    return { kind: 'local-absolute', raw, decoded, fsPath: path.normalize(decoded), remoteUrl: null }
  }
  return {
    kind: 'local-relative',
    raw,
    decoded,
    fsPath: path.resolve(documentDir, decoded),
    remoteUrl: null,
  }
}

/** 判断 candidate 是否仍在 baseDir 内（用于下载/迁移时的路径穿越防护）。 */
export function isPathInside(baseDir: string, candidate: string): boolean {
  const base = normalizeLocalPathForKey(path.resolve(baseDir))
  const target = normalizeLocalPathForKey(path.resolve(candidate))
  if (base === target) return true
  const withSeparator = base.endsWith('/') ? base : `${base}/`
  return target.startsWith(withSeparator)
}

export type TransferTaskKind = 'upload' | 'download' | 'copy' | 'verify'
export type TransferTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 持久化传输任务：上传待办、失败与重试不并入资产可用状态。 */
export interface TransferTask {
  taskId: string
  kind: TransferTaskKind
  status: TransferTaskStatus
  assetId: string
  locationId: string | null
  attempt: number
  maxAttempts: number
  /** 错误分类码，不保存凭据或响应正文。 */
  errorCode: string | null
  createdAt: string
  updatedAt: string
}

export type ImageOperationKind = 'import' | 'migrate' | 'cache-promote' | 'offline-pin' | 'reference-rewrite'
export type ImageOperationStatus = 'planned' | 'applied' | 'rolled-back' | 'failed'

/** 可回滚的批处理事务记录。 */
export interface ImageOperation {
  operationId: string
  kind: ImageOperationKind
  status: ImageOperationStatus
  affectedAssetIds: string[]
  rollbackToken: string | null
  createdAt: string
  updatedAt: string
}

/** 固定离线资源：不参与普通缓存 LRU 清理。 */
export interface OfflinePin {
  assetId: string
  locationId: string
  sizeBytes: number
  pinnedAt: string
  verifiedAt: string | null
}

export type ImageReferenceSyntax = 'markdown-inline' | 'markdown-reference' | 'html-img'
export type ReferenceValidationStatus = 'unresolved' | 'local-verified' | 'remote-recorded'

/** 文档中的一条图片引用事实；与资产位置解耦。 */
export interface MarkdownImageReference {
  referenceId: string
  syntax: ImageReferenceSyntax
  altText: string
  rawDestination: string
  tokenStart: number
  tokenEnd: number
  /** 目标文本在原文中的范围；参考式/HTML 无精确范围时为 -1。 */
  destinationStart: number
  destinationEnd: number
  startLine: number
  startColumn: number
  resolved: ResolvedImageDestination
  assetId: string | null
  validationStatus: ReferenceValidationStatus
}

export function createReferenceId(documentPath: string, tokenStart: number, rawDestination: string): string {
  return `ref_${sha256Hex(`${normalizeLocalPathForKey(documentPath)}|${tokenStart}|${rawDestination}`).slice(0, 20)}`
}

function lineColumnAt(markdown: string, offset: number): { line: number; column: number } {
  let line = 1
  let lastBreak = -1
  for (let i = 0; i < offset && i < markdown.length; i++) {
    if (markdown.charCodeAt(i) === 10) {
      line++
      lastBreak = i
    }
  }
  return { line, column: offset - lastBreak }
}

interface ReferenceDefinition {
  destination: string
  destinationStart: number
  destinationEnd: number
}

function collectReferenceDefinitions(
  markdown: string,
  literalRanges: ReturnType<typeof computeMarkdownLiteralRanges>,
): Map<string, ReferenceDefinition> {
  const definitions = new Map<string, ReferenceDefinition>()
  const re = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    if (isSourceRangeLiteral(literalRanges, match.index, re.lastIndex)) continue
    const label = match[1].trim().toLowerCase()
    if (!label || definitions.has(label)) continue
    const destination = match[2] ?? match[3] ?? ''
    if (!destination) continue
    const valueOffset = match.index + match[0].indexOf(destination, match[0].indexOf(']') + 1)
    definitions.set(label, {
      destination,
      destinationStart: valueOffset,
      destinationEnd: valueOffset + destination.length,
    })
  }
  return definitions
}

function pushReference(
  out: MarkdownImageReference[],
  markdown: string,
  documentPath: string,
  documentDir: string,
  input: {
    syntax: ImageReferenceSyntax
    altText: string
    rawDestination: string
    tokenStart: number
    tokenEnd: number
    destinationStart: number
    destinationEnd: number
    /** 用于解析的值；HTML 实体会先解码，但原文偏移仍按 rawDestination 保留。 */
    resolveFrom?: string
  },
): void {
  const position = lineColumnAt(markdown, input.tokenStart)
  out.push({
    referenceId: createReferenceId(documentPath, input.tokenStart, input.rawDestination),
    syntax: input.syntax,
    altText: input.altText,
    rawDestination: input.rawDestination,
    tokenStart: input.tokenStart,
    tokenEnd: input.tokenEnd,
    destinationStart: input.destinationStart,
    destinationEnd: input.destinationEnd,
    startLine: position.line,
    startColumn: position.column,
    resolved: resolveImageDestination(input.resolveFrom ?? input.rawDestination, documentDir),
    assetId: null,
    validationStatus: 'unresolved',
  })
}

/**
 * 扫描文档中的图片引用：行内 Markdown、参考式 Markdown、HTML `<img>`。
 * 代码块/行内代码中的内容由既有 literal 排除区间剔除，绝不误改代码示例。
 */
export function parseMarkdownImageReferences(markdown: string, documentPath: string): MarkdownImageReference[] {
  const documentDir = path.dirname(documentPath)
  const out: MarkdownImageReference[] = []

  for (const occurrence of parseImageSourceOccurrences(markdown)) {
    pushReference(out, markdown, documentPath, documentDir, {
      syntax: 'markdown-inline',
      altText: occurrence.altText,
      rawDestination: occurrence.rawDestination,
      tokenStart: occurrence.tokenStart,
      tokenEnd: occurrence.tokenEnd,
      destinationStart: occurrence.destinationStart,
      destinationEnd: occurrence.destinationEnd,
    })
  }

  const literalRanges = computeMarkdownLiteralRanges(markdown)
  const definitions = collectReferenceDefinitions(markdown, literalRanges)

  const referenceImage = /!\[([^\]]*)\](?:\[([^\]]*)\])?/g
  let match: RegExpExecArray | null
  while ((match = referenceImage.exec(markdown)) !== null) {
    const after = markdown[referenceImage.lastIndex]
    if (after === '(') continue // 行内图片已由既有扫描器处理
    if (isSourceRangeLiteral(literalRanges, match.index, referenceImage.lastIndex)) continue
    const altText = match[1]
    const label = (match[2] || altText).trim().toLowerCase()
    const definition = definitions.get(label)
    if (!definition) continue
    pushReference(out, markdown, documentPath, documentDir, {
      syntax: 'markdown-reference',
      altText,
      rawDestination: definition.destination,
      tokenStart: match.index,
      tokenEnd: referenceImage.lastIndex,
      destinationStart: definition.destinationStart,
      destinationEnd: definition.destinationEnd,
    })
  }

  const htmlImage = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  while ((match = htmlImage.exec(markdown)) !== null) {
    if (isSourceRangeLiteral(literalRanges, match.index, htmlImage.lastIndex)) continue
    const destination = match[1] ?? match[2] ?? match[3] ?? ''
    if (!destination) continue
    const altMatch = /<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0])
    const destinationOffset = match.index + match[0].indexOf(destination)
    pushReference(out, markdown, documentPath, documentDir, {
      syntax: 'html-img',
      altText: decodeHtmlEntities(altMatch?.[1] ?? altMatch?.[2] ?? ''),
      rawDestination: destination,
      resolveFrom: decodeHtmlEntities(destination),
      tokenStart: match.index,
      tokenEnd: htmlImage.lastIndex,
      destinationStart: destinationOffset,
      destinationEnd: destinationOffset + destination.length,
    })
  }

  return out.sort((a, b) => a.tokenStart - b.tokenStart)
}

/** 项目可分享清单中的一条资产（只允许相对路径与远程 locator）。 */
export interface ProjectManifestAssetEntry {
  assetId: string
  sha256: string
  originalFilename: string
  projectRelativePath: string
  remoteUrl: string | null
}

export interface ProjectImageManifest {
  schemaVersion: 1
  assets: ProjectManifestAssetEntry[]
}

export interface ProjectManifestParseResult {
  ok: boolean
  manifest: ProjectImageManifest | null
  problems: string[]
}

function isSafeProjectRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = value.trim().replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false
  return normalized.split('/').every(segment => segment !== '..')
}

/** 校验项目清单：禁止本机绝对路径、凭据与路径穿越。 */
export function parseProjectImageManifest(raw: unknown): ProjectManifestParseResult {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, manifest: null, problems: ['NOT_AN_OBJECT'] }
  }
  const input = raw as Partial<ProjectImageManifest>
  if (input.schemaVersion !== 1) problems.push('SCHEMA_VERSION_UNSUPPORTED')
  if (!Array.isArray(input.assets)) problems.push('ASSETS_NOT_ARRAY')

  const assets: ProjectManifestAssetEntry[] = []
  if (Array.isArray(input.assets)) {
    input.assets.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        problems.push(`ASSET_${index}_NOT_OBJECT`)
        return
      }
      const problemsBefore = problems.length
      const entry = candidate as Partial<ProjectManifestAssetEntry>
      if (typeof entry.assetId !== 'string' || !entry.assetId) problems.push(`ASSET_${index}_ID_INVALID`)
      if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
        problems.push(`ASSET_${index}_SHA_INVALID`)
      }
      if (typeof entry.originalFilename !== 'string' || !entry.originalFilename) {
        problems.push(`ASSET_${index}_FILENAME_INVALID`)
      }
      if (!isSafeProjectRelativePath(entry.projectRelativePath)) {
        problems.push(`ASSET_${index}_PATH_INVALID`)
      }
      if (entry.remoteUrl !== null && entry.remoteUrl !== undefined
        && !/^https?:\/\/\S+$/i.test(String(entry.remoteUrl))) {
        problems.push(`ASSET_${index}_REMOTE_URL_INVALID`)
      }
      if (problems.length === problemsBefore) {
        assets.push({
          assetId: String(entry.assetId),
          sha256: String(entry.sha256).toLowerCase(),
          originalFilename: String(entry.originalFilename),
          projectRelativePath: String(entry.projectRelativePath).replace(/\\/g, '/'),
          remoteUrl: entry.remoteUrl ? String(entry.remoteUrl) : null,
        })
      }
    })
  }

  if (problems.length > 0) return { ok: false, manifest: null, problems }
  return { ok: true, manifest: { schemaVersion: 1, assets }, problems: [] }
}
