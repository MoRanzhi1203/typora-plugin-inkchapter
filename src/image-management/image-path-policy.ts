/**
 * 图片路径策略（P3）：校验、冲突检测、变更分类与目录占用预览。
 *
 * 原则：
 * - 解析与检查阶段不创建目录、不写业务文件（写权限探针由既有图库检查负责）。
 * - 不跟随符号链接 / junction 递归，避免把用户目录误计入迁移范围。
 * - 删除与迁移永远是显式操作；这里只生成计划，不执行破坏性动作。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { isPathInside, normalizeLocalPathForKey } from './image-asset-model'
import type { ImageDataPaths, ImagePathRole } from './image-data-paths'
import { inspectImageLibraryTarget } from './image-library-inspection'

export type PathInspectionCode =
  | 'EMPTY'
  | 'INVALID'
  | 'MISSING'
  | 'NOT_DIRECTORY'
  | 'NOT_WRITABLE'
  | 'READY'

export interface PathInspection {
  ok: boolean
  code: PathInspectionCode
  normalizedPath: string | null
  exists: boolean
  isDirectory: boolean
  writable: boolean | null
  freeBytes: number | null
  entryCount: number | null
  isSymbolicLink: boolean
  isRedirected: boolean
  realPath: string | null
  warnings: string[]
}

function emptyInspection(code: PathInspectionCode): PathInspection {
  return {
    ok: false,
    code,
    normalizedPath: null,
    exists: false,
    isDirectory: false,
    writable: null,
    freeBytes: null,
    entryCount: null,
    isSymbolicLink: false,
    isRedirected: false,
    realPath: null,
    warnings: [],
  }
}

/**
 * 检查任意图片目录目标。复用图库检查的磁盘/权限/空间逻辑，
 * 并额外识别符号链接、junction 与重定向后的真实路径。
 */
export async function inspectImagePathTarget(rawPath: string): Promise<PathInspection> {
  const base = await inspectImageLibraryTarget(rawPath)
  if (!base.normalizedPath) {
    return emptyInspection(base.code === 'EMPTY_PATH' ? 'EMPTY' : 'INVALID')
  }

  let isSymbolicLink = false
  let realPath: string | null = null
  try {
    const stats = await fs.lstat(base.normalizedPath)
    isSymbolicLink = stats.isSymbolicLink()
    realPath = await fs.realpath(base.normalizedPath)
  } catch {
    realPath = null
  }

  const isRedirected = Boolean(
    realPath && normalizeLocalPathForKey(realPath) !== normalizeLocalPathForKey(base.normalizedPath),
  )

  let code: PathInspectionCode
  if (base.code === 'PATH_MISSING') code = 'MISSING'
  else if (base.code === 'NOT_A_DIRECTORY') code = 'NOT_DIRECTORY'
  else if (base.code === 'NOT_WRITABLE') code = 'NOT_WRITABLE'
  else if (base.code === 'INVALID_PATH' || base.code === 'DRIVE_MISSING') code = 'INVALID'
  else code = 'READY'

  const warnings = [...base.warnings]
  if (isSymbolicLink || isRedirected) warnings.push('REDIRECTED_PATH')

  return {
    ok: base.ok,
    code,
    normalizedPath: base.normalizedPath,
    exists: base.exists,
    isDirectory: base.isDirectory,
    writable: base.writable,
    freeBytes: base.freeBytes,
    entryCount: base.entryCount,
    isSymbolicLink,
    isRedirected,
    realPath,
    warnings,
  }
}

export type PathConflictKind = 'same' | 'nested'

export interface PathConflict {
  a: ImagePathRole
  b: ImagePathRole
  kind: PathConflictKind
  message: string
}

const CONFLICT_ROLES: ImagePathRole[] = ['library', 'cache', 'offline', 'staging', 'database']

function roleRoot(paths: ImageDataPaths, role: ImagePathRole): string | null {
  switch (role) {
    case 'library':
      return paths.libraryRoot
    case 'cache':
      return paths.cacheRoot
    case 'offline':
      return paths.offlineRoot
    case 'staging':
      return paths.stagingRoot
    case 'database':
      return paths.databaseRoot
  }
}

/**
 * 五类路径必须彼此独立：相同或互相嵌套会导致缓存清理误删图库/离线资源，
 * 或让迁移把数据库自身当作图片搬走。
 */
export function findImagePathConflicts(paths: ImageDataPaths): PathConflict[] {
  const conflicts: PathConflict[] = []
  for (let i = 0; i < CONFLICT_ROLES.length; i++) {
    for (let j = i + 1; j < CONFLICT_ROLES.length; j++) {
      const a = CONFLICT_ROLES[i]
      const b = CONFLICT_ROLES[j]
      const rootA = roleRoot(paths, a)
      const rootB = roleRoot(paths, b)
      if (!rootA || !rootB) continue
      if (normalizeLocalPathForKey(rootA) === normalizeLocalPathForKey(rootB)) {
        conflicts.push({ a, b, kind: 'same', message: `${a} 与 ${b} 不能使用同一目录` })
        continue
      }
      if (isPathInside(rootA, rootB) || isPathInside(rootB, rootA)) {
        conflicts.push({ a, b, kind: 'nested', message: `${a} 与 ${b} 不能互相嵌套` })
      }
    }
  }
  return conflicts
}

export type PathChangeKind = 'noop' | 'future-only' | 'migrate-required' | 'cancel-requires-confirmation'

/**
 * 路径变更语义：
 * - 缓存/暂存：可以只影响未来（旧内容丢弃或保留由用户选择）。
 * - 图库/离线/数据库：必须迁移或明确取消保障，不能静默丢弃。
 */
export function classifyPathChange(
  role: ImagePathRole,
  currentRoot: string | null,
  nextRoot: string | null,
): PathChangeKind {
  const current = currentRoot ? normalizeLocalPathForKey(currentRoot) : ''
  const next = nextRoot ? normalizeLocalPathForKey(nextRoot) : ''
  if (current === next) return 'noop'
  if (!next) {
    return role === 'cache' || role === 'staging'
      ? 'future-only'
      : 'cancel-requires-confirmation'
  }
  if (!current) return 'future-only'
  return 'migrate-required'
}

export interface DirectoryUsage {
  fileCount: number
  totalBytes: number
  skippedLinks: number
  truncated: boolean
  errors: string[]
}

export interface InspectDirectoryUsageOptions {
  maxEntries?: number
  maxDepth?: number
}

/**
 * 递归统计目录占用：不跟随符号链接/junction，超过上限即停止并标记 truncated。
 * 仅用于迁移预览，不修改任何文件。
 */
export async function inspectDirectoryUsage(
  root: string,
  options: InspectDirectoryUsageOptions = {},
): Promise<DirectoryUsage> {
  const maxEntries = options.maxEntries ?? 20_000
  const maxDepth = options.maxDepth ?? 32
  const usage: DirectoryUsage = {
    fileCount: 0,
    totalBytes: 0,
    skippedLinks: 0,
    truncated: false,
    errors: [],
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (stack.length > 0) {
    const current = stack.pop() as { dir: string; depth: number }
    let entries
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch (error) {
      usage.errors.push(`${current.dir}: ${(error as NodeJS.ErrnoException).code ?? 'READ_FAILED'}`)
      continue
    }
    for (const entry of entries) {
      visited++
      if (visited > maxEntries) {
        usage.truncated = true
        return usage
      }
      const full = path.join(current.dir, entry.name)
      if (entry.isSymbolicLink()) {
        usage.skippedLinks++
        continue
      }
      if (entry.isDirectory()) {
        if (current.depth + 1 > maxDepth) {
          usage.truncated = true
          continue
        }
        stack.push({ dir: full, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stats = await fs.stat(full)
        usage.fileCount++
        usage.totalBytes += stats.size
      } catch (error) {
        usage.errors.push(`${full}: ${(error as NodeJS.ErrnoException).code ?? 'STAT_FAILED'}`)
      }
    }
  }
  return usage
}

/**
 * 当前文档的图片落点 = 文档所在目录 + 生效的文档资源目录。
 *
 * `documentResourceDirectory` 来自三级解析结果（全局 → 文件夹 → 当前文档），
 * 因此下载 / 上传 / 批量任务必须调用这里，而不是各自读全局设置。
 */
export function resolveImageProjectDirectory(
  documentPath: string,
  documentResourceDirectory: string,
): string {
  return path.resolve(path.dirname(documentPath), documentResourceDirectory)
}
