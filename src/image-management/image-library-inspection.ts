/**
 * 本地图库目录校验与初始化（P1-b）。
 *
 * 原则：
 * - 只检查、不擅自创建：`inspectImageLibraryTarget` 永不写盘（写入探针除外，且立即删除）。
 * - 创建必须显式调用 `initializeImageLibrary`，并遵守「非空目录需确认」。
 * - 任何失败都返回结构化原因，不抛出到 UI 之外。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { validateImageLibraryPath } from './image-settings'

export const IMAGE_LIBRARY_MARKER = '.inkchapter-image-library.json'
export const IMAGE_LIBRARY_MARKER_SCHEMA_VERSION = 1

export type LibraryInspectionCode =
  | 'EMPTY_PATH'
  | 'INVALID_PATH'
  | 'DRIVE_MISSING'
  | 'NOT_A_DIRECTORY'
  | 'NOT_WRITABLE'
  | 'EXISTING_LIBRARY'
  | 'DIRECTORY_NOT_EMPTY'
  | 'PATH_MISSING'
  | 'READY'

export interface LibraryInspection {
  ok: boolean
  code: LibraryInspectionCode
  normalizedPath: string | null
  exists: boolean
  isDirectory: boolean
  writable: boolean | null
  freeBytes: number | null
  entryCount: number | null
  hasLibraryMarker: boolean
  warnings: string[]
}

interface StatFsLike {
  bsize: number
  bavail: number
}

const NODE_STATFS_BSIZE = 4096

function emptyInspection(code: LibraryInspectionCode, rawPath: string | null): LibraryInspection {
  return {
    ok: false,
    code,
    normalizedPath: rawPath,
    exists: false,
    isDirectory: false,
    writable: null,
    freeBytes: null,
    entryCount: null,
    hasLibraryMarker: false,
    warnings: [],
  }
}

async function readFreeBytes(target: string): Promise<number | null> {
  const candidate = fs as unknown as { statfs?: (value: string) => Promise<StatFsLike> }
  if (typeof candidate.statfs !== 'function') return null
  try {
    const stats = await candidate.statfs(target)
    const blockSize = Number.isFinite(stats.bsize) && stats.bsize > 0 ? stats.bsize : NODE_STATFS_BSIZE
    return stats.bavail * blockSize
  } catch {
    return null
  }
}

async function probeWritable(directory: string): Promise<boolean> {
  const probe = path.join(directory, `.inkchapter-write-probe-${process.pid}-${Date.now()}.tmp`)
  try {
    await fs.writeFile(probe, 'probe', 'utf8')
    await fs.unlink(probe)
    return true
  } catch {
    try { await fs.unlink(probe) } catch { /* 探针未创建或已删除 */ }
    return false
  }
}

async function driveExists(normalizedPath: string): Promise<boolean> {
  const root = path.parse(normalizedPath).root
  if (!/^[a-zA-Z]:[\\/]?$/.test(root)) return true // UNC / 其他根由目标 stat 判定
  try {
    await fs.stat(root)
    return true
  } catch {
    return false
  }
}

/** 检查一个候选图库目录是否可用；不创建目录、不写业务文件。 */
export async function inspectImageLibraryTarget(rawPath: string): Promise<LibraryInspection> {
  const validation = validateImageLibraryPath(rawPath)
  if (!validation.ok || !validation.normalized) {
    return emptyInspection(validation.code === 'EMPTY' ? 'EMPTY_PATH' : 'INVALID_PATH', null)
  }
  const normalizedPath = validation.normalized

  if (!await driveExists(normalizedPath)) return emptyInspection('DRIVE_MISSING', normalizedPath)

  let stats
  try {
    stats = await fs.stat(normalizedPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') return emptyInspection('PATH_MISSING', normalizedPath)
    return emptyInspection('INVALID_PATH', normalizedPath)
  }

  if (!stats.isDirectory()) {
    return { ...emptyInspection('NOT_A_DIRECTORY', normalizedPath), exists: true }
  }

  let entryCount: number | null = null
  let hasLibraryMarker = false
  try {
    const entries = await fs.readdir(normalizedPath, { withFileTypes: true })
    entryCount = entries.length
    hasLibraryMarker = entries.some(entry => entry.isFile() && entry.name === IMAGE_LIBRARY_MARKER)
  } catch {
    entryCount = null
  }

  const writable = await probeWritable(normalizedPath)
  const freeBytes = await readFreeBytes(normalizedPath)

  const warnings: string[] = []
  if (!writable) warnings.push('NOT_WRITABLE')
  if (!hasLibraryMarker && (entryCount ?? 0) > 0) warnings.push('DIRECTORY_NOT_EMPTY')
  if (freeBytes !== null && freeBytes < 100 * 1024 * 1024) warnings.push('LOW_FREE_SPACE')

  let code: LibraryInspectionCode
  if (!writable) code = 'NOT_WRITABLE'
  else if (hasLibraryMarker) code = 'EXISTING_LIBRARY'
  else if ((entryCount ?? 0) > 0) code = 'DIRECTORY_NOT_EMPTY'
  else code = 'READY'

  return {
    ok: writable,
    code,
    normalizedPath,
    exists: true,
    isDirectory: true,
    writable,
    freeBytes,
    entryCount,
    hasLibraryMarker,
    warnings,
  }
}

export interface InitializeImageLibraryOptions {
  /** 非空且无墨章标记时是否允许直接接管；默认 false。 */
  allowNonEmpty?: boolean
  now?: Date
}

export interface InitializeImageLibraryResult {
  ok: boolean
  inspection: LibraryInspection
  markerCreated: boolean
  error?: string
}

function markerPayload(now: Date): string {
  return JSON.stringify({
    schemaVersion: IMAGE_LIBRARY_MARKER_SCHEMA_VERSION,
    createdBy: 'inkchapter',
    createdAt: now.toISOString(),
  }, null, 2)
}

/** 显式初始化图库：创建目录、写入标记；非空目录必须显式允许。 */
export async function initializeImageLibrary(
  rawPath: string,
  options: InitializeImageLibraryOptions = {},
): Promise<InitializeImageLibraryResult> {
  const before = await inspectImageLibraryTarget(rawPath)
  if (!before.ok && before.code !== 'PATH_MISSING') {
    return { ok: false, inspection: before, markerCreated: false, error: before.code }
  }

  const normalizedPath = before.normalizedPath
  if (!normalizedPath) {
    return { ok: false, inspection: before, markerCreated: false, error: 'INVALID_PATH' }
  }

  if (!before.exists) {
    try {
      await fs.mkdir(normalizedPath, { recursive: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'MKDIR_FAILED'
      return {
        ok: false,
        inspection: await inspectImageLibraryTarget(normalizedPath),
        markerCreated: false,
        error: code,
      }
    }
  }

  const current = await inspectImageLibraryTarget(normalizedPath)
  if (!current.ok) {
    return { ok: false, inspection: current, markerCreated: false, error: current.code }
  }
  if (current.code === 'DIRECTORY_NOT_EMPTY' && options.allowNonEmpty !== true) {
    return { ok: false, inspection: current, markerCreated: false, error: 'DIRECTORY_NOT_EMPTY' }
  }

  if (current.hasLibraryMarker) {
    return { ok: true, inspection: current, markerCreated: false }
  }

  const target = path.join(current.normalizedPath as string, IMAGE_LIBRARY_MARKER)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, markerPayload(options.now ?? new Date()), 'utf8')
    await fs.rename(temporary, target)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* 临时文件不存在时忽略 */ }
    const code = (error as NodeJS.ErrnoException | null)?.code ?? 'MARKER_WRITE_FAILED'
    return { ok: false, inspection: current, markerCreated: false, error: code }
  }

  const after = await inspectImageLibraryTarget(normalizedPath)
  return { ok: after.ok, inspection: after, markerCreated: true, error: after.ok ? undefined : after.code }
}
