/**
 * 分享包导出（P6）。
 *
 * 输出：`<basename>.md` + `inkchapter-images.json` + 可选 `assets/...`。
 * - 清单只含相对路径、原始文件名、SHA-256 与远程 locator，不含用户绝对路径或凭据。
 * - 默认生成「本地化副本」：只改写副本中的引用，原文档不变。
 * - 可选 ZIP；ZIP 写入器无额外运行时依赖。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { deflateRawSync } from 'zlib'
import {
  parseMarkdownImageReferences,
  type MarkdownImageReference,
} from './image-asset-model'
import { buildImageDestination } from '../heading-numbering/image-path-codec'
import { scanProjectImages } from './image-project-scan'
import { sha256File } from './image-asset-index'
import type { ProjectImageManifest, ProjectManifestAssetEntry } from './image-asset-model'

export const SHARE_MANIFEST_FILENAME = 'inkchapter-images.json'

export interface SharePackageOptions {
  documentPath: string
  projectRoot: string
  assetRoot: string
  outDir: string
  /** 是否把本地图片复制进分享包并改写副本引用；默认 true。 */
  localizeReferences?: boolean
  /** 是否生成 ZIP；默认 false。 */
  zip?: boolean
  /** 目标文件名覆盖；默认保留原文件名。 */
  documentName?: string
  now?: Date
}

export interface ShareExportResult {
  ok: boolean
  packageDir: string
  documentPath: string | null
  manifestPath: string | null
  zipPath: string | null
  assetsCopied: number
  referencesRewritten: number
  warnings: string[]
  problems: string[]
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/')
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

/** 最小 ZIP 写入器：UTF-8 文件名 + deflate，无外部依赖。 */
export function createZipArchive(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name.replace(/\\/g, '/'))
    const compressed = new Uint8Array(deflateRawSync(entry.data))
    const checksum = crc32(entry.data)

    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(0),
      u16(0),
      u32(checksum),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ])
    localParts.push(local)

    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(0),
      u16(0),
      u32(checksum),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    centralParts.push(central)

    offset += local.length
  }

  const centralBuffer = concatBytes(centralParts)
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuffer.length),
    u32(offset),
    u16(0),
  ])

  return concatBytes([...localParts, centralBuffer, end])
}

interface DocumentReferencePlan {
  reference: MarkdownImageReference
  projectRelativePath: string
  packageRelativePath: string
  newDestination: string
}

function applyRewrites(content: string, plans: readonly DocumentReferencePlan[]): string {
  const ordered = [...plans].sort((a, b) => b.reference.destinationStart - a.reference.destinationStart)
  const originalLength = content.length
  let output = content
  for (const plan of ordered) {
    const start = plan.reference.destinationStart
    const end = plan.reference.destinationEnd
    if (start < 0 || end > originalLength || start >= end) continue
    output = output.slice(0, start) + plan.newDestination + output.slice(end)
  }
  return output
}

export async function exportSharePackage(options: SharePackageOptions): Promise<ShareExportResult> {
  const problems: string[] = []
  const warnings: string[] = []
  const projectRoot = path.resolve(options.projectRoot)
  const assetRoot = path.resolve(options.assetRoot)
  const documentPath = path.resolve(options.documentPath)
  const outDir = path.resolve(options.outDir)
  const localize = options.localizeReferences !== false

  const scan = await scanProjectImages({ projectRoot, assetRoot })
  const document = scan.documents.find(item => path.resolve(item.absolutePath) === documentPath)
  if (!document) {
    return {
      ok: false,
      packageDir: outDir,
      documentPath: null,
      manifestPath: null,
      zipPath: null,
      assetsCopied: 0,
      referencesRewritten: 0,
      warnings,
      problems: ['DOCUMENT_NOT_IN_PROJECT'],
    }
  }

  const references = parseMarkdownImageReferences(document.content, documentPath)
  const assetByAbsolute = new Map(scan.assets.map(asset => [path.resolve(asset.absolutePath).toLowerCase(), asset]))
  const referencePlans: DocumentReferencePlan[] = []
  const manifestEntries: ProjectManifestAssetEntry[] = []
  const copied = new Set<string>()
  let assetsCopied = 0

  if (!localize && references.some(reference => reference.resolved.kind === 'local-relative' || reference.resolved.kind === 'local-absolute')) {
    warnings.push('LOCAL_REFERENCES_NOT_PORTABLE')
  }

  for (const reference of references) {
    if (reference.resolved.kind !== 'local-relative' && reference.resolved.kind !== 'local-absolute') continue
    const filePath = reference.resolved.fsPath
    if (!filePath) continue
    const asset = assetByAbsolute.get(path.resolve(filePath).toLowerCase())
    if (!asset) {
      warnings.push(`REFERENCE_OUTSIDE_ASSET_ROOT:${reference.rawDestination}`)
      continue
    }
    const packageRelativePath = normalizeRelative(asset.relativePath)
    if (localize) {
      referencePlans.push({
        reference,
        projectRelativePath: asset.relativePath,
        packageRelativePath,
        newDestination: buildImageDestination(packageRelativePath),
      })
    }
    if (!copied.has(packageRelativePath)) {
      copied.add(packageRelativePath)
      if (!manifestEntries.some(entry => entry.projectRelativePath === packageRelativePath)) {
        manifestEntries.push({
          assetId: `img_${asset.sha256.slice(0, 16)}`,
          sha256: asset.sha256,
          originalFilename: path.basename(asset.absolutePath),
          projectRelativePath: packageRelativePath,
          remoteUrl: null,
        })
      }
    }
  }

  const documentName = options.documentName ?? path.basename(documentPath)
  const manifest: ProjectImageManifest = {
    schemaVersion: 1,
    assetRoot: scan.assetRootRelative,
    assets: manifestEntries,
  }

  try {
    await fs.mkdir(outDir, { recursive: true })
    const outputContent = localize ? applyRewrites(document.content, referencePlans) : document.content
    const outputDocumentPath = path.join(outDir, documentName)
    await fs.writeFile(outputDocumentPath, outputContent, 'utf8')

    for (const relativePath of copied) {
      const source = path.join(projectRoot, relativePath)
      const target = path.join(outDir, relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
      const sourceDigest = await sha256File(source)
      const targetDigest = await sha256File(target)
      if (sourceDigest.sha256 !== targetDigest.sha256) {
        problems.push(`COPY_VERIFY_FAILED:${relativePath}`)
        continue
      }
      assetsCopied++
    }

    const manifestPath = path.join(outDir, SHARE_MANIFEST_FILENAME)
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    let zipPath: string | null = null
    if (options.zip) {
      const encoder = new TextEncoder()
      const entries: ZipEntry[] = [
        { name: documentName, data: encoder.encode(outputContent) },
        { name: SHARE_MANIFEST_FILENAME, data: encoder.encode(JSON.stringify(manifest, null, 2)) },
      ]
      for (const relativePath of copied) {
        entries.push({
          name: relativePath,
          data: new Uint8Array(await fs.readFile(path.join(outDir, relativePath))),
        })
      }
      zipPath = path.join(outDir, `${path.basename(documentName).replace(/\.md$/i, '')}.zip`)
      await fs.writeFile(zipPath, createZipArchive(entries))
    }

    return {
      ok: problems.length === 0,
      packageDir: outDir,
      documentPath: outputDocumentPath,
      manifestPath,
      zipPath,
      assetsCopied,
      referencesRewritten: localize ? referencePlans.length : 0,
      warnings,
      problems,
    }
  } catch (error) {
    return {
      ok: false,
      packageDir: outDir,
      documentPath: null,
      manifestPath: null,
      zipPath: null,
      assetsCopied,
      referencesRewritten: localize ? referencePlans.length : 0,
      warnings,
      problems: [...problems, error instanceof Error ? error.message : String(error)],
    }
  }
}
