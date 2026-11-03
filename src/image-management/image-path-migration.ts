/**
 * 图片目录迁移（P3）。
 *
 * 安全约束：
 * - 先计划、后执行；计划只读。
 * - 复制到目标后逐文件 SHA-256 校验，绝不覆盖目标中不同内容的同名文件。
 * - 写入回滚日志；失败自动回滚本次新建的副本，源文件保持不变。
 * - 默认不删除源文件；只有显式 `deleteSource` 才在全部校验通过后清理。
 * - 不跟随符号链接 / junction。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { isPathInside, normalizeLocalPathForKey } from './image-asset-model'
import { sha256File } from './image-asset-index'
import {
  inspectDirectoryUsage,
  inspectImagePathTarget,
  type DirectoryUsage,
} from './image-path-policy'
import type { ImagePathRole } from './image-data-paths'

export interface PathMigrationPlan {
  ok: boolean
  role: ImagePathRole
  fromRoot: string
  toRoot: string
  fileCount: number
  totalBytes: number
  freeBytes: number | null
  usage: DirectoryUsage
  problems: string[]
  warnings: string[]
}

export interface PlanPathMigrationInput {
  role: ImagePathRole
  fromRoot: string
  toRoot: string
  maxEntries?: number
}

/** 只读预览：文件数、容量、目标可用空间、路径冲突与符号链接风险。 */
export async function planPathMigration(input: PlanPathMigrationInput): Promise<PathMigrationPlan> {
  const problems: string[] = []
  const warnings: string[] = []

  const from = input.fromRoot ? path.resolve(input.fromRoot) : ''
  const to = input.toRoot ? path.resolve(input.toRoot) : ''
  if (!from) problems.push('SOURCE_EMPTY')
  if (!to) problems.push('TARGET_EMPTY')
  if (from && to && normalizeLocalPathForKey(from) === normalizeLocalPathForKey(to)) {
    problems.push('SAME_PATH')
  }
  if (from && to && (isPathInside(from, to) || isPathInside(to, from))) {
    problems.push('NESTED_PATH')
  }

  let usage: DirectoryUsage = { fileCount: 0, totalBytes: 0, skippedLinks: 0, truncated: false, errors: [] }
  let freeBytes: number | null = null

  if (from && !problems.includes('SOURCE_EMPTY')) {
    const sourceInspection = await inspectImagePathTarget(from)
    if (!sourceInspection.exists || !sourceInspection.isDirectory) problems.push('SOURCE_NOT_DIRECTORY')
    if (sourceInspection.isSymbolicLink || sourceInspection.isRedirected) warnings.push('SOURCE_REDIRECTED')
    usage = await inspectDirectoryUsage(from, { maxEntries: input.maxEntries })
    if (usage.truncated) problems.push('SOURCE_TOO_LARGE')
    if (usage.errors.length > 0) warnings.push('SOURCE_PARTIAL_READ')
    if (usage.skippedLinks > 0) warnings.push('SOURCE_LINKS_SKIPPED')
  }

  if (to && !problems.includes('TARGET_EMPTY')) {
    const targetInspection = await inspectImagePathTarget(to)
    if (targetInspection.exists && !targetInspection.isDirectory) problems.push('TARGET_NOT_DIRECTORY')
    if (targetInspection.exists && targetInspection.writable === false) problems.push('TARGET_NOT_WRITABLE')
    if (targetInspection.isSymbolicLink || targetInspection.isRedirected) warnings.push('TARGET_REDIRECTED')
    freeBytes = targetInspection.freeBytes
    if (freeBytes !== null && usage.totalBytes > 0 && freeBytes < usage.totalBytes) {
      problems.push('INSUFFICIENT_SPACE')
    }
  }

  return {
    ok: problems.length === 0,
    role: input.role,
    fromRoot: from,
    toRoot: to,
    fileCount: usage.fileCount,
    totalBytes: usage.totalBytes,
    freeBytes,
    usage,
    problems,
    warnings,
  }
}

export type MigrationFileState = 'pending' | 'copied' | 'skipped' | 'failed'

export interface MigrationFileRecord {
  relativePath: string
  sizeBytes: number
  sha256: string
  state: MigrationFileState
}

export type MigrationStatus = 'in-progress' | 'applied' | 'rolled-back' | 'failed'

export interface PathMigrationJournal {
  schemaVersion: 1
  operationId: string
  role: ImagePathRole
  fromRoot: string
  toRoot: string
  status: MigrationStatus
  deleteSource: boolean
  createdAt: string
  files: MigrationFileRecord[]
  error: string | null
}

export interface ExecutePathMigrationOptions {
  backupDir: string
  deleteSource?: boolean
  now?: Date
  onProgress?: (done: number, total: number) => void
}

export interface ExecutePathMigrationResult {
  ok: boolean
  journal: PathMigrationJournal | null
  journalPath: string | null
  error?: string
}

interface SourceFile {
  relativePath: string
  absolutePath: string
}

async function listSourceFiles(root: string, maxEntries: number): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  const stack: Array<{ dir: string; relative: string }> = [{ dir: root, relative: '' }]
  while (stack.length > 0) {
    const current = stack.pop() as { dir: string; relative: string }
    const entries = await fs.readdir(current.dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name
      const absolutePath = path.join(current.dir, entry.name)
      if (entry.isDirectory()) {
        stack.push({ dir: absolutePath, relative: relativePath })
        continue
      }
      if (!entry.isFile()) continue
      out.push({ relativePath, absolutePath })
      if (out.length > maxEntries) throw new Error('SOURCE_TOO_LARGE')
    }
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function writeJournal(journalPath: string, journal: PathMigrationJournal): Promise<void> {
  const temporary = `${journalPath}.tmp`
  await fs.mkdir(path.dirname(journalPath), { recursive: true })
  await fs.writeFile(temporary, JSON.stringify(journal, null, 2), 'utf8')
  await fs.rename(temporary, journalPath)
}

function migrationJournalPath(backupDir: string, operationId: string): string {
  return path.join(backupDir, `migration-${operationId}.json`)
}

/** 执行迁移：复制 + 校验 + 回滚日志；默认保留源文件。 */
export async function executePathMigration(
  plan: PathMigrationPlan,
  options: ExecutePathMigrationOptions,
): Promise<ExecutePathMigrationResult> {
  if (!plan.ok) {
    return { ok: false, journal: null, journalPath: null, error: plan.problems.join(',') || 'PLAN_NOT_READY' }
  }

  const now = options.now ?? new Date()
  const operationId = `mig_${now.getTime()}_${process.pid}`
  const journalPath = migrationJournalPath(options.backupDir, operationId)
  const journal: PathMigrationJournal = {
    schemaVersion: 1,
    operationId,
    role: plan.role,
    fromRoot: plan.fromRoot,
    toRoot: plan.toRoot,
    status: 'in-progress',
    deleteSource: options.deleteSource === true,
    createdAt: now.toISOString(),
    files: [],
    error: null,
  }

  let files: SourceFile[]
  try {
    files = await listSourceFiles(plan.fromRoot, 100_000)
  } catch (error) {
    journal.status = 'failed'
    journal.error = error instanceof Error ? error.message : String(error)
    await writeJournal(journalPath, journal)
    return { ok: false, journal, journalPath, error: journal.error }
  }

  // 先写入 pending 日志，确保中断后仍可识别本次操作。
  for (const file of files) {
    journal.files.push({
      relativePath: file.relativePath,
      sizeBytes: 0,
      sha256: '',
      state: 'pending',
    })
  }
  await writeJournal(journalPath, journal)

  try {
    for (let index = 0; index < files.length; index++) {
      const source = files[index]
      const target = path.join(plan.toRoot, source.relativePath)
      const record = journal.files[index]
      const digest = await sha256File(source.absolutePath)
      record.sizeBytes = digest.sizeBytes
      record.sha256 = digest.sha256

      await fs.mkdir(path.dirname(target), { recursive: true })
      const targetExists = await fs.stat(target).then(() => true, () => false)
      if (targetExists) {
        const existing = await sha256File(target)
        if (existing.sha256 === digest.sha256) {
          record.state = 'skipped'
          options.onProgress?.(index + 1, files.length)
          continue
        }
        throw new Error(`TARGET_CONFLICT:${source.relativePath}`)
      }

      const temporary = `${target}.inkchapter-tmp-${process.pid}`
      await fs.copyFile(source.absolutePath, temporary)
      const copied = await sha256File(temporary)
      if (copied.sha256 !== digest.sha256) {
        await fs.unlink(temporary).catch(() => undefined)
        throw new Error(`COPY_VERIFY_FAILED:${source.relativePath}`)
      }
      await fs.rename(temporary, target)
      record.state = 'copied'
      options.onProgress?.(index + 1, files.length)
    }

    journal.status = 'applied'
    await writeJournal(journalPath, journal)

    if (journal.deleteSource) {
      for (const record of journal.files) {
        if (record.state !== 'copied') continue
        await fs.unlink(path.join(plan.fromRoot, record.relativePath)).catch(() => undefined)
      }
    }

    return { ok: true, journal, journalPath }
  } catch (error) {
    // 只删除本次新建的副本；skipped 文件原本就存在于目标，不能动。
    for (const record of journal.files) {
      if (record.state !== 'copied') continue
      await fs.unlink(path.join(plan.toRoot, record.relativePath)).catch(() => undefined)
      record.state = 'failed'
    }
    journal.status = 'rolled-back'
    journal.error = error instanceof Error ? error.message : String(error)
    await writeJournal(journalPath, journal)
    return { ok: false, journal, journalPath, error: journal.error }
  }
}

export interface RollbackPathMigrationResult {
  ok: boolean
  restored: number
  error?: string
}

/**
 * 撤销一次已应用的迁移：
 * - 把本次复制到目标、且源已删除的文件复制回源目录并校验；
 * - 删除本次在目标新建的副本；
 * - `skipped` 文件不处理（它们原本就在目标）。
 */
export async function rollbackPathMigration(journalPath: string): Promise<RollbackPathMigrationResult> {
  let journal: PathMigrationJournal
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as PathMigrationJournal
  } catch (error) {
    return { ok: false, restored: 0, error: error instanceof Error ? error.message : String(error) }
  }
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.files)) {
    return { ok: false, restored: 0, error: 'INVALID_JOURNAL' }
  }

  let restored = 0
  for (const record of journal.files) {
    if (record.state !== 'copied' && record.state !== 'failed') continue
    const source = path.join(journal.fromRoot, record.relativePath)
    const target = path.join(journal.toRoot, record.relativePath)
    const targetExists = await fs.stat(target).then(() => true, () => false)
    if (!targetExists) continue

    const sourceExists = await fs.stat(source).then(() => true, () => false)
    if (!sourceExists) {
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.copyFile(target, source)
      const digest = await sha256File(source)
      if (record.sha256 && digest.sha256 !== record.sha256) {
        return { ok: false, restored, error: `RESTORE_VERIFY_FAILED:${record.relativePath}` }
      }
      restored++
    }
    await fs.unlink(target).catch(() => undefined)
  }

  journal.status = 'rolled-back'
  journal.error = null
  await writeJournal(journalPath, journal)
  return { ok: true, restored }
}
