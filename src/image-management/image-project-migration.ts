/**
 * 项目图片整理与迁移（P5）。
 *
 * - 先扫描、再计划、最后显式执行；计划阶段只读。
 * - 只迁移被引用的图片（可选包含未引用），按 SHA-256 校验复制，绝不覆盖不同内容。
 * - 文档在计划后被修改则拒绝执行；执行前备份文档，可完整回滚。
 * - 默认保留旧文件；只有显式调用清理函数并在目标校验通过后才删除。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash } from 'crypto'
import {
  resolveImageDestination,
  type MarkdownImageReference,
} from './image-asset-model'
import { buildImageDestination } from '../heading-numbering/image-path-codec'
import { sha256File } from './image-asset-index'
import { scanProjectImages, type ProjectScanReport } from './image-project-scan'

export interface ProjectMigrationReferenceChange {
  documentRelativePath: string
  documentAbsolutePath: string
  referenceId: string
  syntax: MarkdownImageReference['syntax']
  start: number
  end: number
  oldDestination: string
  newDestination: string
}

export interface ProjectMigrationFileOperation {
  sourceAbsolutePath: string
  sourceRelativePath: string
  targetAbsolutePath: string
  targetRelativePath: string
  sha256: string
  sizeBytes: number
  action: 'copy' | 'skip'
  references: ProjectMigrationReferenceChange[]
}

export interface ProjectMigrationDocumentPlan {
  absolutePath: string
  relativePath: string
  sha256: string
  changes: ProjectMigrationReferenceChange[]
}

export interface ProjectMigrationPlan {
  ok: boolean
  projectRoot: string
  assetRoot: string
  targetRoot: string
  operations: ProjectMigrationFileOperation[]
  documents: ProjectMigrationDocumentPlan[]
  warnings: string[]
  problems: string[]
  summary: {
    filesToCopy: number
    filesSkipped: number
    documents: number
    references: number
    conflicts: number
    unreferenced: number
    longestTargetPath: number
  }
  scan: ProjectScanReport
}

export interface PlanProjectImageMigrationInput {
  projectRoot: string
  assetRoot: string
  /** 目标目录，必须是项目内的相对路径，例如 `assets/images`。 */
  targetDirectory: string
  includeUnreferenced?: boolean
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/')
}

function relativeSegments(value: string): string[] {
  return value.split('/').filter(segment => segment !== '' && segment !== '.')
}

/** 拒绝 assets/assets、images/images、Project/Project 这类重复层级。 */
export function hasDuplicateAdjacentSegments(segments: readonly string[]): boolean {
  for (let index = 1; index < segments.length; index++) {
    if (segments[index].toLowerCase() === segments[index - 1].toLowerCase()) return true
  }
  return false
}

function validateTargetDirectory(projectRoot: string, targetDirectory: string): {
  ok: boolean
  targetRoot: string
  problems: string[]
} {
  const problems: string[] = []
  const value = typeof targetDirectory === 'string' ? targetDirectory.trim().replace(/\\/g, '/') : ''
  if (!value) problems.push('TARGET_DIRECTORY_EMPTY')
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) problems.push('TARGET_DIRECTORY_NOT_RELATIVE')
  const segments = relativeSegments(value)
  if (segments.length === 0) problems.push('TARGET_DIRECTORY_EMPTY')
  if (segments.some(segment => segment === '..')) problems.push('TARGET_DIRECTORY_TRAVERSAL')
  if (hasDuplicateAdjacentSegments(segments)) problems.push('DUPLICATE_PATH_SEGMENT')
  if (segments.length > 0 && segments[0].toLowerCase() === path.basename(projectRoot).toLowerCase()) {
    problems.push('DUPLICATE_PROJECT_SEGMENT')
  }
  const targetRoot = path.resolve(projectRoot, ...segments)
  const normalizedProject = path.resolve(projectRoot)
  if (targetRoot !== normalizedProject && !targetRoot.startsWith(normalizedProject + path.sep)) {
    problems.push('TARGET_DIRECTORY_OUTSIDE_PROJECT')
  }
  return { ok: problems.length === 0, targetRoot, problems }
}

function extensionOf(filePath: string): string | null {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filePath)
  return match ? match[1].toLowerCase() : null
}

function referenceMap(report: ProjectScanReport): Map<string, Map<string, MarkdownImageReference>> {
  const map = new Map<string, Map<string, MarkdownImageReference>>()
  for (const document of report.documents) {
    const refs = new Map<string, MarkdownImageReference>()
    for (const reference of document.references) refs.set(reference.referenceId, reference)
    map.set(document.relativePath, refs)
  }
  return map
}

function isInsideOrEqual(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir).replace(/\\/g, '/').toLowerCase()
  const target = path.resolve(candidate).replace(/\\/g, '/').toLowerCase()
  return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function buildRelativeDestination(documentPath: string, targetPath: string): string {
  return normalizeRelative(path.relative(path.dirname(documentPath), targetPath))
}

export async function planProjectImageMigration(
  input: PlanProjectImageMigrationInput,
): Promise<ProjectMigrationPlan> {
  const projectRoot = path.resolve(input.projectRoot)
  const assetRoot = path.resolve(input.assetRoot)
  const target = validateTargetDirectory(projectRoot, input.targetDirectory)
  const scan = await scanProjectImages({ projectRoot, assetRoot })
  const problems = [...target.problems, ...scan.problems]
  const warnings: string[] = []
  if (scan.truncated) warnings.push('SCAN_TRUNCATED')
  if (path.resolve(target.targetRoot).toLowerCase() === path.resolve(assetRoot).toLowerCase()) {
    problems.push('TARGET_EQUALS_ASSET_ROOT')
  }
  if (isInsideOrEqual(target.targetRoot, assetRoot) && !isInsideOrEqual(assetRoot, target.targetRoot)) {
    problems.push('TARGET_CONTAINS_ASSET_ROOT')
  }

  const refsByDocument = referenceMap(scan)
  const operations: ProjectMigrationFileOperation[] = []
  const documentChanges = new Map<string, ProjectMigrationReferenceChange[]>()
  const claimedTargets = new Map<string, { sha256: string; sourceRelative: string }>()
  const existingTargetHashes = new Map<string, string | null>()
  let conflicts = 0
  let longestTargetPath = 0

  const candidates = scan.assets.filter(asset => {
    if (asset.referencedBy.length === 0 && input.includeUnreferenced !== true) return false
    if (isInsideOrEqual(target.targetRoot, asset.absolutePath)) return false
    return true
  })

  for (const asset of candidates) {
    const baseName = path.basename(asset.absolutePath)
    let targetPath = path.join(target.targetRoot, baseName)
    let action: 'copy' | 'skip' = 'copy'

    const existingHash = async (candidatePath: string): Promise<string | null> => {
      const key = candidatePath.toLowerCase()
      if (existingTargetHashes.has(key)) return existingTargetHashes.get(key) ?? null
      const exists = await fs.stat(candidatePath).then(value => value.isFile(), () => false)
      if (!exists) {
        existingTargetHashes.set(key, null)
        return null
      }
      const digest = await sha256File(candidatePath).catch(() => null)
      existingTargetHashes.set(key, digest?.sha256 ?? null)
      return digest?.sha256 ?? null
    }

    const claimed = claimedTargets.get(targetPath.toLowerCase())
    const existingSha = await existingHash(targetPath)
    const targetTaken = claimed !== undefined || existingSha !== null
    if (targetTaken) {
      if (claimed?.sha256 === asset.sha256 || existingSha === asset.sha256) {
        // 目标已有相同内容：复用目标，不复制。
        action = 'skip'
      } else {
        conflicts++
        const stem = baseName.replace(/\.[^.]+$/, '')
        const extension = path.extname(baseName) || (extensionOf(baseName) ? `.${extensionOf(baseName)}` : '.img')
        let counter = 0
        do {
          const suffix = counter === 0 ? asset.sha256.slice(0, 8) : `${asset.sha256.slice(0, 8)}-${counter}`
          targetPath = path.join(target.targetRoot, `${stem}-${suffix}${extension}`)
          counter++
        } while (
          claimedTargets.has(targetPath.toLowerCase())
          || (await existingHash(targetPath)) !== null
        )
      }
    }
    claimedTargets.set(targetPath.toLowerCase(), { sha256: asset.sha256, sourceRelative: asset.relativePath })
    longestTargetPath = Math.max(longestTargetPath, targetPath.length)

    const changes: ProjectMigrationReferenceChange[] = []
    for (const use of asset.referencedBy) {
      const reference = refsByDocument.get(use.documentRelativePath)?.get(use.referenceId)
      if (!reference) continue
      const document = scan.documents.find(item => item.relativePath === use.documentRelativePath)
      if (!document) continue
      const relativeDestination = buildRelativeDestination(document.absolutePath, targetPath)
      if (path.isAbsolute(relativeDestination)) {
        problems.push(`CROSS_DRIVE_REFERENCE:${document.relativePath}`)
        continue
      }
      const wrapped = document.content[reference.destinationStart - 1] === '<'
        && document.content[reference.destinationEnd] === '>'
      const newDestination = reference.syntax === 'html-img' || reference.syntax === 'markdown-reference'
        ? relativeDestination
        : wrapped
          ? relativeDestination
          : buildImageDestination(relativeDestination)
      const change: ProjectMigrationReferenceChange = {
        documentRelativePath: document.relativePath,
        documentAbsolutePath: document.absolutePath,
        referenceId: reference.referenceId,
        syntax: reference.syntax,
        start: reference.destinationStart,
        end: reference.destinationEnd,
        oldDestination: reference.rawDestination,
        newDestination,
      }
      changes.push(change)
      const list = documentChanges.get(document.relativePath) ?? []
      list.push(change)
      documentChanges.set(document.relativePath, list)
    }

    operations.push({
      sourceAbsolutePath: asset.absolutePath,
      sourceRelativePath: asset.relativePath,
      targetAbsolutePath: targetPath,
      targetRelativePath: normalizeRelative(path.relative(projectRoot, targetPath)),
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      action,
      references: changes,
    })
  }

  const documents: ProjectMigrationDocumentPlan[] = []
  for (const [relativePath, changes] of documentChanges) {
    const document = scan.documents.find(item => item.relativePath === relativePath)
    if (!document) continue
    documents.push({
      absolutePath: document.absolutePath,
      relativePath,
      sha256: document.sha256,
      changes,
    })
  }

  if (longestTargetPath > 240) warnings.push('LONG_TARGET_PATH')

  return {
    ok: problems.length === 0,
    projectRoot,
    assetRoot,
    targetRoot: target.targetRoot,
    operations,
    documents,
    warnings,
    problems,
    summary: {
      filesToCopy: operations.filter(operation => operation.action === 'copy').length,
      filesSkipped: operations.filter(operation => operation.action === 'skip').length,
      documents: documents.length,
      references: documents.reduce((sum, document) => sum + document.changes.length, 0),
      conflicts,
      unreferenced: scan.unreferencedAssets.length,
      longestTargetPath,
    },
    scan,
  }
}

export type ProjectMigrationStatus = 'in-progress' | 'applied' | 'rolled-back' | 'failed'

export interface ProjectMigrationJournalFile {
  sourceAbsolutePath: string
  targetAbsolutePath: string
  sha256: string
  state: 'pending' | 'copied' | 'skipped' | 'failed'
}

export interface ProjectMigrationJournalDocument {
  relativePath: string
  absolutePath: string
  backupPath: string
  originalHash: string
  /** 迁移写入后的文档哈希；用于回滚时检测用户的新编辑。 */
  writtenHash: string | null
  state: 'pending' | 'written' | 'restored' | 'failed'
}

export interface ProjectMigrationJournal {
  schemaVersion: 1
  operationId: string
  projectRoot: string
  assetRoot: string
  targetRoot: string
  status: ProjectMigrationStatus
  createdAt: string
  error: string | null
  sourcesCleaned: boolean
  files: ProjectMigrationJournalFile[]
  documents: ProjectMigrationJournalDocument[]
}

export interface ExecuteProjectMigrationOptions {
  backupDir: string
  /** 可选：由运行时提供，阻止迁移仍在编辑器中打开的文档。 */
  isDocumentOpen?: (absolutePath: string) => boolean
  now?: Date
}

export interface ExecuteProjectMigrationResult {
  ok: boolean
  journal: ProjectMigrationJournal | null
  journalPath: string | null
  error?: string
}

async function writeJournal(journalPath: string, journal: ProjectMigrationJournal): Promise<void> {
  await fs.mkdir(path.dirname(journalPath), { recursive: true })
  const temporary = `${journalPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporary, JSON.stringify(journal, null, 2), 'utf8')
  await fs.rename(temporary, journalPath)
}

function applyDocumentChanges(content: string, changes: readonly ProjectMigrationReferenceChange[]): string {
  const ordered = [...changes].sort((a, b) => b.start - a.start)
  const originalLength = content.length
  let output = content
  for (const change of ordered) {
    if (change.start < 0 || change.end > originalLength || change.start >= change.end) {
      throw new Error(`INVALID_SPAN:${change.referenceId}`)
    }
    output = output.slice(0, change.start) + change.newDestination + output.slice(change.end)
  }
  return output
}

export async function executeProjectImageMigration(
  plan: ProjectMigrationPlan,
  options: ExecuteProjectMigrationOptions,
): Promise<ExecuteProjectMigrationResult> {
  if (!plan.ok) {
    return { ok: false, journal: null, journalPath: null, error: plan.problems.join(',') || 'PLAN_NOT_READY' }
  }
  const now = options.now ?? new Date()
  const operationId = `projmig_${now.getTime()}_${process.pid}`
  const journalPath = path.join(options.backupDir, `project-migration-${operationId}.json`)
  const operationBackupDir = path.join(options.backupDir, operationId)
  const journal: ProjectMigrationJournal = {
    schemaVersion: 1,
    operationId,
    projectRoot: plan.projectRoot,
    assetRoot: plan.assetRoot,
    targetRoot: plan.targetRoot,
    status: 'in-progress',
    createdAt: now.toISOString(),
    error: null,
    sourcesCleaned: false,
    files: plan.operations.map(operation => ({
      sourceAbsolutePath: operation.sourceAbsolutePath,
      targetAbsolutePath: operation.targetAbsolutePath,
      sha256: operation.sha256,
      state: 'pending',
    })),
    documents: plan.documents.map(document => ({
      relativePath: document.relativePath,
      absolutePath: document.absolutePath,
      backupPath: path.join(operationBackupDir, 'documents', `${createHash('sha256').update(document.relativePath).digest('hex').slice(0, 16)}.md`),
      originalHash: document.sha256,
      writtenHash: null,
      state: 'pending',
    })),
  }
  await writeJournal(journalPath, journal)

  try {
    // 1. 文档必须未被修改且未在编辑器打开。
    for (const document of plan.documents) {
      if (options.isDocumentOpen?.(document.absolutePath)) throw new Error(`DOCUMENT_OPEN:${document.relativePath}`)
      const digest = await sha256File(document.absolutePath)
      if (digest.sha256 !== document.sha256) throw new Error(`DOCUMENT_CHANGED:${document.relativePath}`)
    }

    // 2. 备份文档。
    for (const document of journal.documents) {
      await fs.mkdir(path.dirname(document.backupPath), { recursive: true })
      await fs.copyFile(document.absolutePath, document.backupPath)
    }
    await writeJournal(journalPath, journal)

    // 3. 复制文件（先复制，后改写文档）。
    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]
      const record = journal.files[index]
      const exists = await fs.stat(operation.targetAbsolutePath).then(value => value.isFile(), () => false)
      if (exists) {
        const existing = await sha256File(operation.targetAbsolutePath)
        if (existing.sha256 !== operation.sha256) throw new Error(`TARGET_CONFLICT:${operation.targetRelativePath}`)
        record.state = 'skipped'
        continue
      }
      await fs.mkdir(path.dirname(operation.targetAbsolutePath), { recursive: true })
      const temporary = `${operation.targetAbsolutePath}.inkchapter-tmp-${process.pid}`
      await fs.copyFile(operation.sourceAbsolutePath, temporary)
      const copied = await sha256File(temporary)
      if (copied.sha256 !== operation.sha256) {
        await fs.unlink(temporary).catch(() => undefined)
        throw new Error(`COPY_VERIFY_FAILED:${operation.sourceRelativePath}`)
      }
      await fs.rename(temporary, operation.targetAbsolutePath)
      record.state = 'copied'
    }
    await writeJournal(journalPath, journal)

    // 4. 改写文档。
    for (const documentPlan of plan.documents) {
      const record = journal.documents.find(item => item.relativePath === documentPlan.relativePath)
      if (!record) continue
      const current = await fs.readFile(documentPlan.absolutePath, 'utf8')
      const output = applyDocumentChanges(current, documentPlan.changes)
      const temporary = `${documentPlan.absolutePath}.inkchapter-tmp-${process.pid}`
      await fs.writeFile(temporary, output, 'utf8')
      await fs.rename(temporary, documentPlan.absolutePath)
      record.state = 'written'
      record.writtenHash = (await sha256File(documentPlan.absolutePath)).sha256
    }
    await writeJournal(journalPath, journal)

    // 5. 核验每条新引用都能解析到真实文件。
    for (const documentPlan of plan.documents) {
      for (const change of documentPlan.changes) {
        const resolved = resolveImageDestination(change.newDestination, path.dirname(documentPlan.absolutePath))
        const exists = resolved.fsPath
          ? await fs.stat(resolved.fsPath).then(value => value.isFile(), () => false)
          : false
        if (!exists) throw new Error(`REFERENCE_TARGET_MISSING:${change.referenceId}`)
      }
    }

    journal.status = 'applied'
    await writeJournal(journalPath, journal)
    return { ok: true, journal, journalPath }
  } catch (error) {
    for (const document of journal.documents) {
      if (document.state !== 'written') continue
      await fs.copyFile(document.backupPath, document.absolutePath).catch(() => undefined)
      document.state = 'restored'
    }
    for (const file of journal.files) {
      if (file.state !== 'copied') continue
      await fs.unlink(file.targetAbsolutePath).catch(() => undefined)
      file.state = 'failed'
    }
    journal.status = 'rolled-back'
    journal.error = error instanceof Error ? error.message : String(error)
    await writeJournal(journalPath, journal)
    return { ok: false, journal, journalPath, error: journal.error }
  }
}

export interface RollbackProjectMigrationResult {
  ok: boolean
  restoredDocuments: number
  removedTargets: number
  error?: string
}

export async function rollbackProjectImageMigration(journalPath: string): Promise<RollbackProjectMigrationResult> {
  let journal: ProjectMigrationJournal
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as ProjectMigrationJournal
  } catch (error) {
    return {
      ok: false,
      restoredDocuments: 0,
      removedTargets: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.files) || !Array.isArray(journal.documents)) {
    return { ok: false, restoredDocuments: 0, removedTargets: 0, error: 'INVALID_JOURNAL' }
  }

  // 若迁移后文档又被编辑，回滚会覆盖用户新内容，必须先拒绝。
  for (const document of journal.documents) {
    if (document.state === 'pending' || !document.writtenHash) continue
    const current = await sha256File(document.absolutePath).catch(() => null)
    if (!current || current.sha256 !== document.writtenHash) {
      return {
        ok: false,
        restoredDocuments: 0,
        removedTargets: 0,
        error: `DOCUMENT_CHANGED_SINCE_MIGRATION:${document.relativePath}`,
      }
    }
  }

  let restoredDocuments = 0
  let removedTargets = 0
  for (const document of journal.documents) {
    if (document.state === 'pending') continue
    await fs.copyFile(document.backupPath, document.absolutePath).catch(() => undefined)
    document.state = 'restored'
    restoredDocuments++
  }
  for (const file of journal.files) {
    if (file.state !== 'copied') continue
    await fs.unlink(file.targetAbsolutePath).catch(() => undefined)
    file.state = 'failed'
    removedTargets++
  }
  journal.status = 'rolled-back'
  journal.error = null
  await writeJournal(journalPath, journal)
  return { ok: true, restoredDocuments, removedTargets }
}

export interface CleanupProjectSourcesResult {
  ok: boolean
  removed: number
  skipped: number
  error?: string
}

/**
 * 显式清理迁移前的旧文件：只有目标存在且哈希一致才删除源文件。
 * 必须在迁移成功且用户确认后调用。
 */
export async function cleanupProjectImageSources(journalPath: string): Promise<CleanupProjectSourcesResult> {
  let journal: ProjectMigrationJournal
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as ProjectMigrationJournal
  } catch (error) {
    return { ok: false, removed: 0, skipped: 0, error: error instanceof Error ? error.message : String(error) }
  }
  if (journal.schemaVersion !== 1 || journal.status !== 'applied') {
    return { ok: false, removed: 0, skipped: 0, error: 'JOURNAL_NOT_APPLIED' }
  }

  let removed = 0
  let skipped = 0
  for (const file of journal.files) {
    if (file.state !== 'copied' && file.state !== 'skipped') continue
    if (path.resolve(file.sourceAbsolutePath).toLowerCase() === path.resolve(file.targetAbsolutePath).toLowerCase()) {
      skipped++
      continue
    }
    const targetExists = await fs.stat(file.targetAbsolutePath).then(value => value.isFile(), () => false)
    if (!targetExists) {
      skipped++
      continue
    }
    const digest = await sha256File(file.targetAbsolutePath).catch(() => null)
    if (!digest || digest.sha256 !== file.sha256) {
      skipped++
      continue
    }
    await fs.unlink(file.sourceAbsolutePath).catch(() => undefined)
    removed++
  }
  journal.sourcesCleaned = true
  await writeJournal(journalPath, journal)
  return { ok: true, removed, skipped }
}
