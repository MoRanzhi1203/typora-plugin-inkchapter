/**
 * 项目图片扫描（P5）。
 *
 * 边界：
 * - 不假定同一目录下的所有 Markdown 都属于同一项目；调用方显式给出项目根与资源根。
 * - 只读：不移动、不复制、不改写任何文件。
 * - 代码块/行内代码中的示例由引用扫描器排除。
 * - 符号链接不跟随，避免越界扫描。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import {
  parseMarkdownImageReferences,
  type MarkdownImageReference,
} from './image-asset-model'
import { guessMimeType, sha256File } from './image-asset-index'

const DEFAULT_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.inkchapter', 'dist', '.typora'])
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

export interface ProjectDocumentScan {
  absolutePath: string
  relativePath: string
  content: string
  sha256: string
  references: MarkdownImageReference[]
}

export interface ProjectAssetReferenceUse {
  documentRelativePath: string
  referenceId: string
  destination: string
}

export interface ProjectAssetFile {
  absolutePath: string
  relativePath: string
  sha256: string
  sizeBytes: number
  referencedBy: ProjectAssetReferenceUse[]
}

export interface ProjectReferenceSummary {
  total: number
  local: number
  remote: number
  data: number
  missing: string[]
  outsideAssetRoot: string[]
}

export interface ProjectScanReport {
  ok: boolean
  projectRoot: string
  assetRoot: string
  assetRootRelative: string
  documents: ProjectDocumentScan[]
  assets: ProjectAssetFile[]
  unreferencedAssets: string[]
  nonImageFiles: string[]
  references: ProjectReferenceSummary
  problems: string[]
  truncated: boolean
}

export interface ScanProjectImagesInput {
  projectRoot: string
  assetRoot: string
  maxDocuments?: number
  maxAssets?: number
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/')
}

function isImageFile(filePath: string): boolean {
  return guessMimeType(filePath) !== null
}

async function listFiles(
  root: string,
  options: { extensions?: Set<string>; maxFiles: number; onSkipDirectory?: (name: string) => boolean },
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let truncated = false
  while (stack.length > 0) {
    const current = stack.pop() as { dir: string; depth: number }
    let entries
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (current.depth >= 24) continue
        if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) continue
        if (options.onSkipDirectory?.(entry.name)) continue
        stack.push({ dir: full, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (options.extensions && !options.extensions.has(path.extname(entry.name).toLowerCase())) continue
      files.push(full)
      if (files.length > options.maxFiles) {
        truncated = true
        return { files, truncated }
      }
    }
  }
  return { files, truncated }
}

/** 扫描项目文档与资源根下的图片，建立「文件 → 引用」映射。 */
export async function scanProjectImages(input: ScanProjectImagesInput): Promise<ProjectScanReport> {
  const problems: string[] = []
  const projectRoot = path.resolve(input.projectRoot)
  const assetRoot = path.resolve(input.assetRoot)
  const maxDocuments = input.maxDocuments ?? 5000
  const maxAssets = input.maxAssets ?? 20000

  if (!isPathInsideOrEqual(projectRoot, assetRoot)) {
    problems.push('ASSET_ROOT_OUTSIDE_PROJECT')
  }

  const documentsResult = await listFiles(projectRoot, {
    extensions: new Set(['.md']),
    maxFiles: maxDocuments,
  })
  const assetResult = await listFiles(assetRoot, { maxFiles: maxAssets })

  const documents: ProjectDocumentScan[] = []
  const referenceUses = new Map<string, ProjectAssetReferenceUse[]>()
  const summary: ProjectReferenceSummary = {
    total: 0,
    local: 0,
    remote: 0,
    data: 0,
    missing: [],
    outsideAssetRoot: [],
  }

  for (const documentPath of documentsResult.files) {
    const relativePath = normalizeRelative(path.relative(projectRoot, documentPath))
    let content: string
    try {
      const stats = await fs.stat(documentPath)
      if (stats.size > MAX_DOCUMENT_BYTES) {
        problems.push(`DOCUMENT_TOO_LARGE:${relativePath}`)
        continue
      }
      content = await fs.readFile(documentPath, 'utf8')
    } catch {
      problems.push(`DOCUMENT_READ_FAILED:${relativePath}`)
      continue
    }
    const digest = await sha256File(documentPath)
    const references = parseMarkdownImageReferences(content, documentPath)
    documents.push({
      absolutePath: documentPath,
      relativePath,
      content,
      sha256: digest.sha256,
      references,
    })

    for (const reference of references) {
      summary.total++
      if (reference.resolved.kind === 'remote') {
        summary.remote++
        continue
      }
      if (reference.resolved.kind === 'data') {
        summary.data++
        continue
      }
      if (reference.resolved.kind === 'unsupported') continue
      summary.local++
      const filePath = reference.resolved.fsPath
      const exists = filePath ? await fs.stat(filePath).then(value => value.isFile(), () => false) : false
      if (!exists || !filePath) {
        summary.missing.push(`${relativePath}#${reference.referenceId}`)
        continue
      }
      if (!isPathInsideOrEqual(assetRoot, filePath)) {
        summary.outsideAssetRoot.push(normalizeRelative(path.relative(projectRoot, filePath)))
        continue
      }
      const key = normalizeCase(filePath)
      const uses = referenceUses.get(key) ?? []
      uses.push({
        documentRelativePath: relativePath,
        referenceId: reference.referenceId,
        destination: reference.rawDestination,
      })
      referenceUses.set(key, uses)
    }
  }

  const assets: ProjectAssetFile[] = []
  const nonImageFiles: string[] = []
  for (const assetPath of assetResult.files) {
    if (!isImageFile(assetPath)) {
      nonImageFiles.push(normalizeRelative(path.relative(projectRoot, assetPath)))
      continue
    }
    let digest
    try {
      digest = await sha256File(assetPath)
    } catch {
      problems.push(`ASSET_READ_FAILED:${normalizeRelative(path.relative(projectRoot, assetPath))}`)
      continue
    }
    const relativePath = normalizeRelative(path.relative(projectRoot, assetPath))
    assets.push({
      absolutePath: assetPath,
      relativePath,
      sha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
      referencedBy: referenceUses.get(normalizeCase(assetPath)) ?? [],
    })
  }

  const unreferencedAssets = assets
    .filter(asset => asset.referencedBy.length === 0)
    .map(asset => asset.relativePath)

  return {
    ok: problems.length === 0,
    projectRoot,
    assetRoot,
    assetRootRelative: normalizeRelative(path.relative(projectRoot, assetRoot)),
    documents,
    assets,
    unreferencedAssets,
    nonImageFiles,
    references: summary,
    problems,
    truncated: documentsResult.truncated || assetResult.truncated,
  }
}

export function isPathInsideOrEqual(baseDir: string, candidate: string): boolean {
  const base = normalizeLocal(baseDir)
  const target = normalizeLocal(candidate)
  return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function normalizeLocal(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function normalizeCase(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase()
}
