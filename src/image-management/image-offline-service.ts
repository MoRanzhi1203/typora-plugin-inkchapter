/**
 * 离线资源准备（P4）。
 *
 * 严格边界：
 * - 不改写原 Markdown 的远程 URL；透明离线回退未经验证，不做 DOM 劫持。
 * - 支持两条安全路径：
 *   1. 固定离线：把缺失远端下载为受保护离线对象，并写本地清单；
 *   2. 离线工作副本：另存一份 Markdown，仅把副本中的引用改为副本内 `assets/`。
 * - 本地已有文件直接视为可用，不重复下载或复制。
 */

import * as fs from 'fs/promises'
import { createHash } from 'crypto'
import * as path from 'path'
import {
  parseMarkdownImageReferences,
  type MarkdownImageReference,
} from './image-asset-model'
import { sha256File } from './image-asset-index'
import type { ImageCacheService } from './image-cache-service'
import type { ImageDataPaths } from './image-data-paths'
import { fetchRemoteImage, type FetchLike } from './image-remote-fetch'
import {
  buildOfflineAssetName,
  extensionFromUrl,
  validateRemoteImageUrl,
} from './image-remote-url'

export const OFFLINE_MANIFEST_SCHEMA_VERSION = 1

export type OfflineEntryStatus = 'available' | 'downloaded' | 'reused-cache' | 'inline' | 'failed'

export interface OfflineManifestEntry {
  source: string
  status: OfflineEntryStatus
  objectRelativePath: string | null
  sha256: string | null
  sizeBytes: number | null
  reason: string | null
}

export interface OfflineManifest {
  schemaVersion: number
  documentKey: string
  documentName: string
  createdAt: string
  entries: OfflineManifestEntry[]
}

export interface PrepareDocumentOfflineInput {
  markdown: string
  documentPath: string
  cache?: ImageCacheService
}

export interface PrepareDocumentOfflineResult {
  ok: boolean
  manifest: OfflineManifest | null
  manifestPath: string | null
  total: number
  available: number
  downloaded: number
  reusedCache: number
  failed: number
  error?: string
}

export interface ImageOfflineServiceOptions {
  paths: ImageDataPaths
  maxDownloadBytes: number
  fetchImpl?: FetchLike
  now?: () => Date
}

function documentKeyOf(documentPath: string): string {
  return createHash('sha256')
    .update(documentPath.replace(/\\/g, '/').toLowerCase(), 'utf8')
    .digest('hex')
    .slice(0, 16)
}

function extensionOfLocalFile(filePath: string): string | null {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filePath)
  return match ? match[1].toLowerCase() : null
}

export class ImageOfflineService {
  private readonly fetchImpl: FetchLike
  private readonly now: () => Date

  constructor(private readonly options: ImageOfflineServiceOptions) {
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch
    if (!options.fetchImpl && !globalFetch) throw new Error('fetch is not available')
    this.fetchImpl = options.fetchImpl ?? (globalFetch as FetchLike)
    this.now = options.now ?? (() => new Date())
  }

  manifestPathFor(documentPath: string): string {
    return path.join(this.options.paths.offlineManifestsDir, `${documentKeyOf(documentPath)}.json`)
  }

  async prepareDocumentOffline(input: PrepareDocumentOfflineInput): Promise<PrepareDocumentOfflineResult> {
    const references = parseMarkdownImageReferences(input.markdown, input.documentPath)
    const entries: OfflineManifestEntry[] = []
    let downloaded = 0
    let reusedCache = 0
    let failed = 0

    for (const reference of references) {
      if (reference.resolved.kind === 'data') {
        entries.push({
          source: reference.rawDestination,
          status: 'inline',
          objectRelativePath: null,
          sha256: null,
          sizeBytes: null,
          reason: null,
        })
        continue
      }
      if (reference.resolved.kind === 'unsupported') {
        entries.push({
          source: reference.rawDestination,
          status: 'failed',
          objectRelativePath: null,
          sha256: null,
          sizeBytes: null,
          reason: 'UNSUPPORTED_DESTINATION',
        })
        failed++
        continue
      }

      if (reference.resolved.kind === 'local-relative' || reference.resolved.kind === 'local-absolute') {
        const filePath = reference.resolved.fsPath
        const exists = filePath ? await fs.stat(filePath).then(value => value.isFile(), () => false) : false
        if (!exists || !filePath) {
          entries.push({
            source: path.basename(reference.resolved.decoded),
            status: 'failed',
            objectRelativePath: null,
            sha256: null,
            sizeBytes: null,
            reason: 'LOCAL_MISSING',
          })
          failed++
          continue
        }
        const digest = await sha256File(filePath)
        entries.push({
          source: path.basename(filePath),
          status: 'available',
          objectRelativePath: null,
          sha256: digest.sha256,
          sizeBytes: digest.sizeBytes,
          reason: null,
        })
        continue
      }

      // remote
      const safety = validateRemoteImageUrl(reference.resolved.remoteUrl ?? '')
      if (!safety.ok) {
        entries.push({
          source: reference.rawDestination,
          status: 'failed',
          objectRelativePath: null,
          sha256: null,
          sizeBytes: null,
          reason: safety.reason ?? 'INVALID_URL',
        })
        failed++
        continue
      }

      const normalizedRemoteUrl = safety.normalized ?? reference.rawDestination
      const cached = input.cache ? await input.cache.get(normalizedRemoteUrl) : null
      const cachedPath = cached && input.cache ? input.cache.filePathFor(cached) : null
      if (cached && cachedPath && await fs.stat(cachedPath).then(value => value.isFile(), () => false)) {
        const objectName = buildOfflineAssetName(cached.sha256, cached.extension, entries.length)
        const target = path.join(this.options.paths.offlineObjectsDir, objectName)
        await this.copyVerified(cachedPath, target, cached.sha256)
        entries.push({
          source: reference.rawDestination,
          status: 'reused-cache',
          objectRelativePath: path.relative(this.options.paths.offlineRoot, target).replace(/\\/g, '/'),
          sha256: cached.sha256,
          sizeBytes: cached.sizeBytes,
          reason: null,
        })
        reusedCache++
        continue
      }

      const fetched = await fetchRemoteImage(this.fetchImpl, normalizedRemoteUrl, this.options.maxDownloadBytes)
      if (!fetched.ok) {
        entries.push({
          source: reference.rawDestination,
          status: 'failed',
          objectRelativePath: null,
          sha256: null,
          sizeBytes: null,
          reason: `${fetched.code}:${fetched.message}`,
        })
        failed++
        continue
      }
      const objectName = buildOfflineAssetName(fetched.sha256, fetched.extension, entries.length)
      const target = path.join(this.options.paths.offlineObjectsDir, objectName)
      await this.writeBytes(target, fetched.bytes)
      const digest = await sha256File(target)
      if (digest.sha256 !== fetched.sha256) {
        await fs.unlink(target).catch(() => undefined)
        entries.push({
          source: reference.rawDestination,
          status: 'failed',
          objectRelativePath: null,
          sha256: null,
          sizeBytes: null,
          reason: 'VERIFY_FAILED',
        })
        failed++
        continue
      }
      entries.push({
        source: reference.rawDestination,
        status: 'downloaded',
        objectRelativePath: path.relative(this.options.paths.offlineRoot, target).replace(/\\/g, '/'),
        sha256: fetched.sha256,
        sizeBytes: fetched.bytes.byteLength,
        reason: null,
      })
      downloaded++
    }

    const manifest: OfflineManifest = {
      schemaVersion: OFFLINE_MANIFEST_SCHEMA_VERSION,
      documentKey: documentKeyOf(input.documentPath),
      documentName: path.basename(input.documentPath),
      createdAt: this.now().toISOString(),
      entries,
    }
    const manifestPath = this.manifestPathFor(input.documentPath)
    try {
      await this.writeManifest(manifestPath, manifest)
    } catch (error) {
      return {
        ok: false,
        manifest,
        manifestPath: null,
        total: entries.length,
        available: entries.length - failed,
        downloaded,
        reusedCache,
        failed,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return {
      ok: failed === 0,
      manifest,
      manifestPath,
      total: entries.length,
      available: entries.length - failed,
      downloaded,
      reusedCache,
      failed,
    }
  }

  async readManifest(documentPath: string): Promise<OfflineManifest | null> {
    const manifestPath = this.manifestPathFor(documentPath)
    try {
      const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as OfflineManifest
      if (parsed.schemaVersion !== OFFLINE_MANIFEST_SCHEMA_VERSION || !Array.isArray(parsed.entries)) return null
      return parsed
    } catch {
      return null
    }
  }

  /** 核验离线对象是否仍存在且哈希一致；本地项目文件不在此范围内。 */
  async verifyDocumentOffline(documentPath: string): Promise<{
    ok: boolean
    total: number
    verified: number
    missing: string[]
    manifest: OfflineManifest | null
  }> {
    const manifest = await this.readManifest(documentPath)
    if (!manifest) return { ok: false, total: 0, verified: 0, missing: [], manifest: null }

    const protectedEntries = manifest.entries.filter(entry => entry.objectRelativePath)
    const missing: string[] = []
    let verified = 0
    for (const entry of protectedEntries) {
      const target = path.join(this.options.paths.offlineRoot, entry.objectRelativePath as string)
      const exists = await fs.stat(target).then(value => value.isFile(), () => false)
      if (!exists) {
        missing.push(entry.objectRelativePath as string)
        continue
      }
      if (entry.sha256) {
        const digest = await sha256File(target).catch(() => null)
        if (!digest || digest.sha256 !== entry.sha256) {
          missing.push(entry.objectRelativePath as string)
          continue
        }
      }
      verified++
    }
    return {
      ok: missing.length === 0,
      total: protectedEntries.length,
      verified,
      missing,
      manifest,
    }
  }

  /**
   * 生成离线工作副本：复制/下载图片到副本 `assets/`，只改写副本中的引用。
   * 原文档保持不变。失败项保留原 URL。
   */
  async createOfflineWorkingCopy(input: {
    markdown: string
    documentPath: string
    outDir: string
  }): Promise<{
    ok: boolean
    outputPath: string | null
    replaced: number
    copied: number
    failed: string[]
  }> {
    const references = parseMarkdownImageReferences(input.markdown, input.documentPath)
    const assetsDir = path.join(input.outDir, 'assets')
    const replacements = new Map<string, string>()
    const failed: string[] = []
    let copied = 0
    let index = 0

    for (const reference of references) {
      if (reference.resolved.kind === 'data' || reference.resolved.kind === 'unsupported') continue
      if (reference.destinationStart < 0 || reference.destinationEnd <= reference.destinationStart) continue

      let sourcePath: string | null = null
      let expectedSha: string | null = null
      let extension: string | null = null

      if (reference.resolved.kind === 'local-relative' || reference.resolved.kind === 'local-absolute') {
        sourcePath = reference.resolved.fsPath
        extension = sourcePath ? extensionOfLocalFile(sourcePath) : null
      } else {
        const safety = validateRemoteImageUrl(reference.resolved.remoteUrl ?? '')
        if (!safety.ok) {
          failed.push(reference.rawDestination)
          continue
        }
        const fetched = await fetchRemoteImage(this.fetchImpl, reference.rawDestination, this.options.maxDownloadBytes)
        if (!fetched.ok) {
          failed.push(reference.rawDestination)
          continue
        }
        expectedSha = fetched.sha256
        extension = fetched.extension ?? extensionFromUrl(reference.rawDestination)
        const tempName = `download-${fetched.sha256.slice(0, 12)}`
        const tempPath = path.join(assetsDir, tempName)
        await this.writeBytes(tempPath, fetched.bytes)
        sourcePath = tempPath
      }

      if (!sourcePath) {
        failed.push(reference.rawDestination)
        continue
      }
      const exists = await fs.stat(sourcePath).then(value => value.isFile(), () => false)
      if (!exists) {
        failed.push(reference.rawDestination)
        continue
      }

      try {
        const digest = await sha256File(sourcePath)
        if (expectedSha && digest.sha256 !== expectedSha) {
          failed.push(reference.rawDestination)
          await fs.unlink(sourcePath).catch(() => undefined)
          continue
        }
        const name = buildOfflineAssetName(digest.sha256, extension, index++)
        const target = path.join(assetsDir, name)
        if (sourcePath !== target) {
          await fs.mkdir(assetsDir, { recursive: true })
          await this.copyVerified(sourcePath, target, digest.sha256)
          if (sourcePath.includes(`${path.sep}assets${path.sep}download-`)) {
            await fs.unlink(sourcePath).catch(() => undefined)
          }
        }
        replacements.set(
          `${reference.destinationStart}:${reference.destinationEnd}`,
          `assets/${name}`,
        )
        copied++
      } catch {
        failed.push(reference.rawDestination)
      }
    }

    let output = input.markdown
    const spans = Array.from(replacements.entries())
      .map(([key, value]) => {
        const [start, end] = key.split(':').map(Number)
        return { start, end, value }
      })
      .sort((a, b) => b.start - a.start)
    for (const span of spans) {
      output = output.slice(0, span.start) + span.value + output.slice(span.end)
    }

    try {
      await fs.mkdir(input.outDir, { recursive: true })
      const base = path.basename(input.documentPath).replace(/\.md$/i, '')
      const outputPath = path.join(input.outDir, `${base}.offline.md`)
      await fs.writeFile(outputPath, output, 'utf8')
      return { ok: failed.length === 0, outputPath, replaced: spans.length, copied, failed }
    } catch {
      return { ok: false, outputPath: null, replaced: spans.length, copied, failed }
    }
  }

  private async writeManifest(manifestPath: string, manifest: OfflineManifest): Promise<void> {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    const temporary = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
    await fs.rename(temporary, manifestPath)
  }

  private async writeBytes(target: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(temporary, bytes)
    await fs.rename(temporary, target)
  }

  private async copyVerified(sourcePath: string, targetPath: string, expectedSha: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    const temporary = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    await fs.copyFile(sourcePath, temporary)
    const digest = await sha256File(temporary)
    if (digest.sha256 !== expectedSha) {
      await fs.unlink(temporary).catch(() => undefined)
      throw new Error('COPY_VERIFY_FAILED')
    }
    await fs.rename(temporary, targetPath)
  }
}

export interface CreateImageOfflineServiceInput {
  paths: ImageDataPaths
  maxDownloadBytes: number
  fetchImpl?: FetchLike
  now?: () => Date
}

export function createImageOfflineService(input: CreateImageOfflineServiceInput): ImageOfflineService {
  return new ImageOfflineService(input)
}
