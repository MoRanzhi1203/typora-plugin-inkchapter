/**
 * 分享包接收与本地化（P6）。
 *
 * - 有清单：恢复原始文件名与相对目录，校验 SHA-256 后写入接收者资源根。
 * - 无清单：保留远程 URL，建立仅含远端位置的资产记录，不猜测原始文件名。
 * - 上传接收者图床只能使用真实返回的 URL；绝不仅替换用户名。
 * - 文件名与路径经过 Windows 保留名、大小写冲突、`..` 穿越防护。
 */

import * as fs from 'fs/promises'
import { createHash } from 'crypto'
import * as path from 'path'
import {
  parseMarkdownImageReferences,
  parseProjectImageManifest,
  type ProjectImageManifest,
  type ProjectManifestAssetEntry,
} from './image-asset-model'
import { buildImageDestination } from '../heading-numbering/image-path-codec'
import { sha256File } from './image-asset-index'
import { fetchRemoteImage, type FetchLike } from './image-remote-fetch'
import { validateRemoteImageUrl } from './image-remote-url'

export const SHARE_IMPORT_MANIFEST = 'inkchapter-images.json'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function sanitizeShareFilename(raw: string, fallback = 'image'): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? ''
  let value = base
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!value || value === '.' || value === '..') value = fallback
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`
  if (value.length > 120) {
    const extension = path.extname(value)
    value = value.slice(0, Math.max(1, 120 - extension.length)) + extension
  }
  return value
}

export type ImportedAssetOwnership = 'sender' | 'receiver'

export interface ImportedAssetLocation {
  type: 'github' | 'local'
  url: string | null
  relativePath: string | null
  ownership: ImportedAssetOwnership
  deletable: boolean
}

export interface ImportedAsset {
  assetId: string
  sha256: string | null
  originalFilename: string | null
  locations: ImportedAssetLocation[]
  uploadStatus: 'none' | 'pending' | 'uploaded' | 'failed'
}

export interface ImportSharePackageOptions {
  packageDir: string
  targetProjectRoot: string
  targetAssetRoot: string
  documentName?: string
  outputDocumentName?: string
  overwrite?: boolean
  /** 是否下载远程图片到接收者资源根；默认 false（保留远程 URL）。 */
  downloadRemote?: boolean
  fetchImpl?: FetchLike
  maxDownloadBytes?: number
  /** 接收者自己的上传器；必须返回真实可用的 HTTPS URL。 */
  uploadImpl?: (input: { filePath: string; sha256: string; originalFilename: string }) => Promise<string>
  now?: Date
}

export interface ImportSharePackageResult {
  ok: boolean
  documentPath: string | null
  manifestUsed: boolean
  assets: ImportedAsset[]
  copied: number
  downloaded: number
  remoteKept: number
  uploaded: number
  pendingUpload: number
  failures: string[]
  warnings: string[]
  problems: string[]
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/')
}

function isInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir).replace(/\\/g, '/').toLowerCase()
  const target = path.resolve(candidate).replace(/\\/g, '/').toLowerCase()
  return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function sanitizeRelativePath(raw: string, senderAssetRoot: string | undefined): string {
  let value = normalizeRelative(raw).replace(/^\/+/, '')
  if (senderAssetRoot) {
    const root = normalizeRelative(senderAssetRoot).replace(/\/+$/, '')
    if (value.toLowerCase().startsWith(`${root.toLowerCase()}/`)) value = value.slice(root.length + 1)
  }
  const segments = value.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.some(segment => segment === '..')) {
    return sanitizeShareFilename(path.basename(value))
  }
  return segments.map(segment => sanitizeShareFilename(segment)).join('/')
}

async function findDocument(packageDir: string, documentName?: string): Promise<string | null> {
  if (documentName) {
    const candidate = path.resolve(packageDir, documentName)
    if (!isInside(packageDir, candidate)) return null
    const exists = await fs.stat(candidate).then(value => value.isFile(), () => false)
    return exists ? candidate : null
  }
  const entries = await fs.readdir(packageDir, { withFileTypes: true })
  const documents = entries
    .filter(entry => entry.isFile() && /\.md$/i.test(entry.name))
    .map(entry => entry.name)
    .sort()
  return documents.length > 0 ? path.join(packageDir, documents[0]) : null
}

async function uniqueTargetPath(
  assetRoot: string,
  relativePath: string,
  sha256: string | null,
  claimed: Set<string>,
): Promise<string> {
  const candidate = path.resolve(assetRoot, relativePath)
  if (!isInside(assetRoot, candidate)) throw new Error('TARGET_PATH_ESCAPE')
  const key = candidate.toLowerCase()
  if (!claimed.has(key)) {
    const exists = await fs.stat(candidate).then(value => value.isFile(), () => false)
    if (!exists) {
      claimed.add(key)
      return candidate
    }
    if (sha256) {
      const digest = await sha256File(candidate).catch(() => null)
      if (digest?.sha256 === sha256) {
        claimed.add(key)
        return candidate
      }
    }
  }
  const extension = path.extname(relativePath)
  const stem = relativePath.slice(0, relativePath.length - extension.length)
  const suffix = (sha256 ?? createHash('sha256').update(relativePath).digest('hex')).slice(0, 8)
  let counter = 0
  while (counter < 1000) {
    const extra = counter === 0 ? suffix : `${suffix}-${counter}`
    const next = path.resolve(assetRoot, `${stem}-${extra}${extension}`)
    if (!isInside(assetRoot, next)) throw new Error('TARGET_PATH_ESCAPE')
    const nextKey = next.toLowerCase()
    if (!claimed.has(nextKey)) {
      claimed.add(nextKey)
      return next
    }
    counter++
  }
  throw new Error('TARGET_NAME_EXHAUSTED')
}

function referenceKey(start: number, end: number): string {
  return `${start}:${end}`
}

export async function importSharePackage(options: ImportSharePackageOptions): Promise<ImportSharePackageResult> {
  const packageDir = path.resolve(options.packageDir)
  const targetProjectRoot = path.resolve(options.targetProjectRoot)
  const targetAssetRoot = path.resolve(options.targetAssetRoot)
  const failures: string[] = []
  const warnings: string[] = []
  const problems: string[] = []
  const assets: ImportedAsset[] = []

  const sourceDocument = await findDocument(packageDir, options.documentName)
  if (!sourceDocument) {
    return {
      ok: false,
      documentPath: null,
      manifestUsed: false,
      assets,
      copied: 0,
      downloaded: 0,
      remoteKept: 0,
      uploaded: 0,
      pendingUpload: 0,
      failures,
      warnings,
      problems: ['DOCUMENT_NOT_FOUND'],
    }
  }

  const outputName = options.outputDocumentName ?? path.basename(sourceDocument)
  const outputDocumentPath = path.resolve(targetProjectRoot, outputName)
  if (!isInside(targetProjectRoot, outputDocumentPath)) {
    return {
      ok: false,
      documentPath: null,
      manifestUsed: false,
      assets,
      copied: 0,
      downloaded: 0,
      remoteKept: 0,
      uploaded: 0,
      pendingUpload: 0,
      failures,
      warnings,
      problems: ['OUTPUT_DOCUMENT_ESCAPE'],
    }
  }
  if (!options.overwrite && await fs.stat(outputDocumentPath).then(() => true, () => false)) {
    return {
      ok: false,
      documentPath: null,
      manifestUsed: false,
      assets,
      copied: 0,
      downloaded: 0,
      remoteKept: 0,
      uploaded: 0,
      pendingUpload: 0,
      failures,
      warnings,
      problems: ['TARGET_DOCUMENT_EXISTS'],
    }
  }

  let manifest: ProjectImageManifest | null = null
  let manifestUsed = false
  try {
    const raw = JSON.parse(await fs.readFile(path.join(packageDir, SHARE_IMPORT_MANIFEST), 'utf8'))
    const parsed = parseProjectImageManifest(raw)
    if (parsed.ok && parsed.manifest) {
      manifest = parsed.manifest
      manifestUsed = true
    } else {
      warnings.push(`MANIFEST_INVALID:${parsed.problems.join(',')}`)
    }
  } catch {
    warnings.push('MANIFEST_MISSING')
  }

  const manifestByPath = new Map<string, ProjectManifestAssetEntry>()
  for (const entry of manifest?.assets ?? []) {
    manifestByPath.set(normalizeRelative(entry.projectRelativePath).toLowerCase(), entry)
  }

  const packageRealRoot = await fs.realpath(packageDir).catch(() => packageDir)
  const content = await fs.readFile(sourceDocument, 'utf8')
  const references = parseMarkdownImageReferences(content, sourceDocument)
  const replacements = new Map<string, string>()
  const claimed = new Set<string>()
  const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch
  const maxDownloadBytes = options.maxDownloadBytes ?? 50 * 1024 * 1024
  let copied = 0
  let downloaded = 0
  let remoteKept = 0
  let uploaded = 0
  let pendingUpload = 0

  const importLocalFile = async (
    sourcePath: string,
    entry: ProjectManifestAssetEntry | undefined,
    rawDestination: string,
  ): Promise<string | null> => {
    const digest = await sha256File(sourcePath)
    if (entry && entry.sha256 !== digest.sha256) {
      failures.push(`SHA_MISMATCH:${rawDestination}`)
      return null
    }
    const originalFilename = entry?.originalFilename ?? path.basename(sourcePath)
    const relative = entry
      ? sanitizeRelativePath(entry.projectRelativePath, manifest?.assetRoot)
      : sanitizeShareFilename(originalFilename)
    const target = await uniqueTargetPath(targetAssetRoot, relative, digest.sha256, claimed)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
    await fs.copyFile(sourcePath, temporary)
    const verify = await sha256File(temporary)
    if (verify.sha256 !== digest.sha256) {
      await fs.unlink(temporary).catch(() => undefined)
      failures.push(`COPY_VERIFY_FAILED:${rawDestination}`)
      return null
    }
    await fs.rename(temporary, target)
    copied++

    const locations: ImportedAssetLocation[] = []
    if (entry?.remoteUrl && validateRemoteImageUrl(entry.remoteUrl).ok) {
      locations.push({
        type: 'github',
        url: entry.remoteUrl,
        relativePath: null,
        ownership: 'sender',
        deletable: false,
      })
    }
    locations.push({
      type: 'local',
      url: null,
      relativePath: normalizeRelative(path.relative(targetProjectRoot, target)),
      ownership: 'receiver',
      deletable: true,
    })
    let uploadStatus: ImportedAsset['uploadStatus'] = 'none'
    let finalDestination = buildImageDestination(normalizeRelative(path.relative(path.dirname(outputDocumentPath), target)))

    if (options.uploadImpl) {
      try {
        const url = await options.uploadImpl({ filePath: target, sha256: digest.sha256, originalFilename })
        if (validateRemoteImageUrl(url).ok) {
          locations.push({ type: 'github', url, relativePath: null, ownership: 'receiver', deletable: true })
          uploadStatus = 'uploaded'
          uploaded++
          finalDestination = url
        } else {
          uploadStatus = 'failed'
          failures.push(`UPLOAD_URL_INVALID:${rawDestination}`)
        }
      } catch {
        uploadStatus = 'failed'
        failures.push(`UPLOAD_FAILED:${rawDestination}`)
      }
    }

    assets.push({
      assetId: `img_${digest.sha256.slice(0, 16)}`,
      sha256: digest.sha256,
      originalFilename,
      locations,
      uploadStatus,
    })
    return finalDestination
  }

  for (const reference of references) {
    if (reference.resolved.kind === 'data' || reference.resolved.kind === 'unsupported') continue

    if (reference.resolved.kind === 'local-relative' || reference.resolved.kind === 'local-absolute') {
      const sourcePath = reference.resolved.fsPath
      if (!sourcePath || !isInside(packageDir, sourcePath)) {
        failures.push(`PACKAGE_PATH_ESCAPE:${reference.rawDestination}`)
        continue
      }
      const exists = await fs.stat(sourcePath).then(value => value.isFile(), () => false)
      if (!exists) {
        failures.push(`PACKAGE_FILE_MISSING:${reference.rawDestination}`)
        continue
      }
      const realSource = await fs.realpath(sourcePath).catch(() => sourcePath)
      if (!isInside(packageRealRoot, realSource)) {
        failures.push(`PACKAGE_SYMLINK_ESCAPE:${reference.rawDestination}`)
        continue
      }
      const packageRelative = normalizeRelative(path.relative(packageDir, sourcePath))
      const entry = manifestByPath.get(packageRelative.toLowerCase())
      try {
        const destination = await importLocalFile(sourcePath, entry, reference.rawDestination)
        if (destination) replacements.set(referenceKey(reference.destinationStart, reference.destinationEnd), destination)
      } catch (error) {
        failures.push(`IMPORT_FAILED:${reference.rawDestination}:${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    // remote
    if (!options.downloadRemote) {
      remoteKept++
      const url = reference.resolved.remoteUrl ?? reference.rawDestination
      assets.push({
        assetId: `remote_${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
        sha256: null,
        originalFilename: null,
        locations: [{ type: 'github', url, relativePath: null, ownership: 'sender', deletable: false }],
        uploadStatus: 'none',
      })
      continue
    }

    if (!fetchImpl) {
      failures.push(`FETCH_UNAVAILABLE:${reference.rawDestination}`)
      continue
    }
    const fetched = await fetchRemoteImage(fetchImpl, reference.rawDestination, maxDownloadBytes)
    if (!fetched.ok) {
      failures.push(`DOWNLOAD_FAILED:${reference.rawDestination}:${fetched.code}`)
      continue
    }
    const originalFilename = sanitizeShareFilename(path.basename(new URL(reference.rawDestination).pathname), 'image')
    const target = await uniqueTargetPath(targetAssetRoot, originalFilename, fetched.sha256, claimed)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, fetched.bytes)
    const verify = await sha256File(target)
    if (verify.sha256 !== fetched.sha256) {
      await fs.unlink(target).catch(() => undefined)
      failures.push(`DOWNLOAD_VERIFY_FAILED:${reference.rawDestination}`)
      continue
    }
    downloaded++

    const senderUrl = reference.resolved.remoteUrl ?? reference.rawDestination
    const locations: ImportedAssetLocation[] = [{
      type: 'github',
      url: senderUrl,
      relativePath: null,
      ownership: 'sender',
      deletable: false,
    }, {
      type: 'local',
      url: null,
      relativePath: normalizeRelative(path.relative(targetProjectRoot, target)),
      ownership: 'receiver',
      deletable: true,
    }]
    let uploadStatus: ImportedAsset['uploadStatus'] = 'none'
    let destination = buildImageDestination(normalizeRelative(path.relative(path.dirname(outputDocumentPath), target)))
    if (options.uploadImpl) {
      try {
        const url = await options.uploadImpl({ filePath: target, sha256: fetched.sha256, originalFilename })
        if (validateRemoteImageUrl(url).ok) {
          locations.push({ type: 'github', url, relativePath: null, ownership: 'receiver', deletable: true })
          uploadStatus = 'uploaded'
          uploaded++
          destination = url
        } else {
          uploadStatus = 'failed'
          failures.push(`UPLOAD_URL_INVALID:${reference.rawDestination}`)
        }
      } catch {
        uploadStatus = 'failed'
        failures.push(`UPLOAD_FAILED:${reference.rawDestination}`)
      }
    } else {
      uploadStatus = 'pending'
      pendingUpload++
    }
    assets.push({
      assetId: `img_${fetched.sha256.slice(0, 16)}`,
      sha256: fetched.sha256,
      originalFilename,
      locations,
      uploadStatus,
    })
    replacements.set(referenceKey(reference.destinationStart, reference.destinationEnd), destination)
  }

  let output = content
  const ordered = Array.from(replacements.entries())
    .map(([key, value]) => {
      const [start, end] = key.split(':').map(Number)
      return { start, end, value }
    })
    .sort((a, b) => b.start - a.start)
  for (const span of ordered) {
    output = output.slice(0, span.start) + span.value + output.slice(span.end)
  }

  try {
    await fs.mkdir(targetProjectRoot, { recursive: true })
    const temporary = `${outputDocumentPath}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(temporary, output, 'utf8')
    await fs.rename(temporary, outputDocumentPath)
  } catch (error) {
    return {
      ok: false,
      documentPath: null,
      manifestUsed,
      assets,
      copied,
      downloaded,
      remoteKept,
      uploaded,
      pendingUpload,
      failures,
      warnings,
      problems: [...problems, error instanceof Error ? error.message : String(error)],
    }
  }

  return {
    ok: failures.length === 0 && problems.length === 0,
    documentPath: outputDocumentPath,
    manifestUsed,
    assets,
    copied,
    downloaded,
    remoteKept,
    uploaded,
    pendingUpload,
    failures,
    warnings,
    problems,
  }
}
