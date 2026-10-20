/**
 * 真实文件复制服务。
 *
 * 约束（与「拖入即移动」的原生行为相反）：
 *   - 只做 copyFile，绝不 rename / unlink / move 源文件；
 *   - 源必须是普通文件且不是符号链接；
 *   - 目标目录必须在 vault 之内、是真实目录且不是符号链接；
 *   - 同名冲突按 rename / skip / overwrite 策略显式处理，默认 rename；
 *   - 逐文件返回结果，批量复制中单个失败不影响其他文件。
 *
 * 本模块只依赖 Node `fs` / `path`，不依赖 Typora、DOM 或 Electron，便于单测。
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  MARKDOWN_EXTENSIONS,
  isMarkdownPath,
  isPathInsideRoot,
  isSamePath,
  uniqueFileName,
} from './file-transfer-policy'

export type ConflictPolicy = 'rename' | 'skip' | 'overwrite'

export type CopyStatus = 'copied' | 'skipped' | 'failed'

export type CopyReason =
  | 'INVALID_SOURCE'
  | 'SOURCE_MISSING'
  | 'SOURCE_NOT_FILE'
  | 'SOURCE_SYMLINK_REJECTED'
  | 'UNSUPPORTED_EXTENSION'
  | 'NO_DESTINATION'
  | 'DESTINATION_MISSING'
  | 'DESTINATION_NOT_DIRECTORY'
  | 'DESTINATION_SYMLINK_REJECTED'
  | 'DESTINATION_OUTSIDE_VAULT'
  | 'SAME_FILE'
  | 'CONFLICT_SKIPPED'
  | 'CONFLICT_DIRECTORY'
  | 'DESTINATION_EXISTS_AS_SYMLINK'
  | 'COPY_FAILED'
  | 'COPY_SIZE_MISMATCH'

export interface CopyFileOptions {
  /** 当前打开的文件夹；所有落点必须位于其中。 */
  vaultRoot: string
  /** 同名冲突策略，默认 `rename`。 */
  conflictPolicy?: ConflictPolicy
  /** 允许的扩展名（小写），默认 .md / .markdown。 */
  allowedExtensions?: readonly string[]
}

export interface CopyEntry {
  source: string
  destination: string | null
  status: CopyStatus
  reason?: CopyReason
  /** 目标已存在并触发了冲突处理。 */
  conflict: boolean
  /** 目标名因冲突被改写（rename 策略）。 */
  renamed: boolean
  /** 成功复制后的字节数。 */
  bytes?: number
  /** 失败时的系统错误码 / 说明（用于诊断，不直接展示完整堆栈）。 */
  detail?: string
}

export interface CopyBatchResult {
  entries: CopyEntry[]
  copiedCount: number
  skippedCount: number
  failedCount: number
  conflictCount: number
  /** 本服务只复制，源文件永不移动。 */
  sourcePreserved: true
}

const DEFAULT_CONFLICT_POLICY: ConflictPolicy = 'rename'
const MAX_RENAME_ATTEMPTS = 200

function errnoOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FileCopyService {

  async copyBatch(
    sources: readonly string[],
    destinationDir: string,
    options: CopyFileOptions,
  ): Promise<CopyBatchResult> {
    const entries: CopyEntry[] = []
    for (const source of sources) {
      try {
        entries.push(await this.copyOne(source, destinationDir, options))
      } catch (error) {
        entries.push(failed(source, null, 'COPY_FAILED', errnoOf(error) ?? messageOf(error)))
      }
    }
    return summarize(entries)
  }

  async copyOne(
    source: string,
    destinationDir: string,
    options: CopyFileOptions,
  ): Promise<CopyEntry> {
    const policy = options.conflictPolicy ?? DEFAULT_CONFLICT_POLICY
    const allowed = (options.allowedExtensions ?? MARKDOWN_EXTENSIONS)
      .map(ext => ext.toLowerCase())

    if (typeof source !== 'string' || !source.trim()) {
      return failed('', null, 'INVALID_SOURCE')
    }
    if (typeof destinationDir !== 'string' || !destinationDir.trim()) {
      return failed(source, null, 'NO_DESTINATION')
    }

    const sourcePath = path.resolve(source)
    const sourceStat = await statOrNull(sourcePath)
    if (!sourceStat) return failed(source, null, 'SOURCE_MISSING')
    if (sourceStat.isSymbolicLink()) return failed(source, null, 'SOURCE_SYMLINK_REJECTED')
    if (!sourceStat.isFile()) return failed(source, null, 'SOURCE_NOT_FILE')
    if (!isMarkdownPath(sourcePath) || !allowed.includes(path.extname(sourcePath).toLowerCase())) {
      return failed(source, null, 'UNSUPPORTED_EXTENSION')
    }

    const destination = path.resolve(destinationDir)
    if (!isPathInsideRoot(options.vaultRoot, destination)) {
      return failed(source, null, 'DESTINATION_OUTSIDE_VAULT')
    }
    const destinationStat = await statOrNull(destination)
    if (!destinationStat) return failed(source, null, 'DESTINATION_MISSING')
    // vault 根本身可以是用户选择的 junction / 符号链接；其内部的目标目录不允许。
    if (destinationStat.isSymbolicLink() && !isSamePath(destination, options.vaultRoot)) {
      return failed(source, null, 'DESTINATION_SYMLINK_REJECTED')
    }
    const destinationDirectory = destinationStat.isSymbolicLink()
      ? await statFollowOrNull(destination)
      : destinationStat
    if (!destinationDirectory?.isDirectory()) {
      return failed(source, null, 'DESTINATION_NOT_DIRECTORY')
    }
    // 复核 realpath：父级 junction / 符号链接可能把“看起来在 vault 内”的目录
    // 实际指向 vault 之外，仅靠字符串包含关系无法发现。
    const realVault = await realpathOrNull(options.vaultRoot)
    const realDestination = await realpathOrNull(destination)
    if (!realVault || !realDestination) {
      return failed(source, null, 'DESTINATION_MISSING', 'REALPATH')
    }
    if (!isPathInsideRoot(realVault, realDestination)) {
      return failed(source, null, 'DESTINATION_OUTSIDE_VAULT', 'REALPATH')
    }

    const fileName = path.basename(sourcePath)
    const directTarget = path.join(destination, fileName)

    if (isSamePath(sourcePath, directTarget)) {
      return {
        source,
        destination: directTarget,
        status: 'skipped',
        reason: 'SAME_FILE',
        conflict: false,
        renamed: false,
      }
    }

    const existing = await statOrNull(directTarget)

    if (policy === 'skip' && existing) {
      return {
        source,
        destination: directTarget,
        status: 'skipped',
        reason: 'CONFLICT_SKIPPED',
        conflict: true,
        renamed: false,
      }
    }

    if (policy === 'overwrite' && existing) {
      if (existing.isDirectory()) return failed(source, directTarget, 'CONFLICT_DIRECTORY', undefined, true)
      if (existing.isSymbolicLink()) return failed(source, directTarget, 'DESTINATION_EXISTS_AS_SYMLINK', undefined, true)
    }

    if (policy === 'rename') {
      return this.copyWithUniqueName(source, sourcePath, sourceStat.size, destination, fileName, existing !== null)
    }

    const overwrite = policy === 'overwrite'
    return this.copyTo(source, sourcePath, sourceStat.size, directTarget, overwrite, existing !== null)
  }

  private async copyWithUniqueName(
    source: string,
    sourcePath: string,
    sourceSize: number,
    destinationDir: string,
    fileName: string,
    hasConflict: boolean,
  ): Promise<CopyEntry> {
    let conflict = hasConflict
    for (let index = 1; index <= MAX_RENAME_ATTEMPTS; index++) {
      const candidateName = uniqueFileName(fileName, index)
      const candidate = path.join(destinationDir, candidateName)
      const exists = await pathExists(candidate)
      if (exists) {
        conflict = true
        continue
      }
      const result = await this.copyTo(source, sourcePath, sourceSize, candidate, false, conflict)
      if (result.status === 'failed' && result.reason === 'COPY_FAILED' && result.detail === 'EEXIST') {
        conflict = true
        continue
      }
      return {
        ...result,
        renamed: candidateName !== fileName,
      }
    }
    return failed(source, null, 'COPY_FAILED', 'EXISTS_TOO_MANY_TIMES', conflict)
  }

  private async copyTo(
    source: string,
    sourcePath: string,
    sourceSize: number,
    destinationPath: string,
    overwrite: boolean,
    conflict: boolean,
  ): Promise<CopyEntry> {
    const flags = overwrite ? 0 : fs.constants.COPYFILE_EXCL
    try {
      await fs.promises.copyFile(sourcePath, destinationPath, flags)
      const copiedSize = (await fs.promises.stat(destinationPath)).size
      if (copiedSize !== sourceSize) {
        return {
          source,
          destination: destinationPath,
          status: 'failed',
          reason: 'COPY_SIZE_MISMATCH',
          conflict,
          renamed: false,
          bytes: copiedSize,
        }
      }
      return {
        source,
        destination: destinationPath,
        status: 'copied',
        conflict,
        renamed: false,
        bytes: copiedSize,
      }
    } catch (error) {
      const code = errnoOf(error)
      return {
        source,
        destination: destinationPath,
        status: 'failed',
        reason: 'COPY_FAILED',
        conflict,
        renamed: false,
        detail: code ?? messageOf(error),
      }
    }
  }
}

async function statOrNull(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(filePath)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return null
    throw error
  }
}

async function realpathOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(filePath)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return null
    throw error
  }
}

async function statFollowOrNull(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(filePath)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return null
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return (await statOrNull(filePath)) !== null
}

function failed(
  source: string,
  destination: string | null,
  reason: CopyReason,
  detail?: string,
  conflict = false,
): CopyEntry {
  return {
    source,
    destination,
    status: 'failed',
    reason,
    conflict,
    renamed: false,
    detail,
  }
}

function summarize(entries: CopyEntry[]): CopyBatchResult {
  let copiedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let conflictCount = 0
  for (const entry of entries) {
    if (entry.status === 'copied') copiedCount++
    else if (entry.status === 'skipped') skippedCount++
    else failedCount++
    if (entry.conflict) conflictCount++
  }
  return {
    entries,
    copiedCount,
    skippedCount,
    failedCount,
    conflictCount,
    sourcePreserved: true,
  }
}
