import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  cleanupProjectImageSources,
  executeProjectImageMigration,
  hasDuplicateAdjacentSegments,
  planProjectImageMigration,
  rollbackProjectImageMigration,
} from './image-project-migration'
import { scanProjectImages } from './image-project-scan'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-project-migration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function makeProject(): Promise<{ root: string; project: string; assets: string; docs: string }> {
  const root = await makeRoot()
  const project = path.join(root, 'project')
  const assets = path.join(project, 'assets')
  const docs = path.join(project, 'docs')
  await fs.mkdir(assets, { recursive: true })
  await fs.mkdir(docs, { recursive: true })
  await fs.writeFile(path.join(assets, 'x.png'), 'X-CONTENT')
  await fs.writeFile(path.join(assets, 'y.png'), 'Y-CONTENT')
  await fs.writeFile(path.join(assets, 'z.png'), 'Z-CONTENT')
  await fs.writeFile(path.join(assets, 'notes.txt'), 'not an image')
  await fs.writeFile(path.join(docs, 'a.md'), [
    '# A',
    '',
    '![x](../assets/x.png)',
    '![y](../assets/y.png)',
    '',
    '```md',
    '![code](../assets/y.png)',
    '```',
  ].join('\n'))
  await fs.writeFile(path.join(docs, 'b.md'), '![x](../assets/x.png)\n')
  return { root, project, assets, docs }
}

describe('scanProjectImages', () => {
  it('maps referenced assets, unreferenced files and non-image files', async () => {
    const { project, assets } = await makeProject()
    const report = await scanProjectImages({ projectRoot: project, assetRoot: assets })
    expect(report.ok).toBe(true)
    expect(report.documents).toHaveLength(2)
    const x = report.assets.find(asset => asset.relativePath === 'assets/x.png')
    expect(x?.referencedBy.map(use => use.documentRelativePath).sort()).toEqual(['docs/a.md', 'docs/b.md'])
    expect(report.unreferencedAssets).toEqual(['assets/z.png'])
    expect(report.nonImageFiles).toEqual(['assets/notes.txt'])
    expect(report.references.local).toBe(3)
    expect(report.references.missing).toEqual([])
  })
})

describe('planProjectImageMigration', () => {
  it('plans flat assets into assets/images and rewrites only real references', async () => {
    const { project, assets } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    expect(plan.ok).toBe(true)
    expect(plan.summary.filesToCopy).toBe(2)
    expect(plan.summary.documents).toBe(2)
    expect(plan.summary.references).toBe(3)
    expect(plan.summary.unreferenced).toBe(1)
    expect(plan.targetRoot).toBe(path.join(project, 'assets', 'images'))

    const aChanges = plan.documents.find(document => document.relativePath === 'docs/a.md')?.changes ?? []
    expect(aChanges.map(change => change.newDestination).sort()).toEqual([
      '../assets/images/x.png',
      '../assets/images/y.png',
    ])
    // 代码块中的引用不产生改写。
    expect(aChanges.some(change => change.referenceId.includes('code'))).toBe(false)
  })

  it('disambiguates same-name different-content files', async () => {
    const { project, assets, docs } = await makeProject()
    await fs.mkdir(path.join(assets, 'nested'), { recursive: true })
    await fs.writeFile(path.join(assets, 'nested', 'x.png'), 'OTHER-X')
    await fs.writeFile(path.join(docs, 'c.md'), '![other](../assets/nested/x.png)\n')

    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    expect(plan.ok).toBe(true)
    expect(plan.summary.conflicts).toBeGreaterThan(0)
    const targets = plan.operations.map(operation => path.basename(operation.targetAbsolutePath))
    expect(new Set(targets).size).toBe(targets.length)
    const disambiguated = plan.operations.find(operation => /^x-[0-9a-f]{8}\.png$/.test(path.basename(operation.targetAbsolutePath)))
    expect(disambiguated).toBeTruthy()
  })

  it('rejects redundant path segments and target roots outside the project', async () => {
    const { project, assets } = await makeProject()
    const duplicate = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/assets',
    })
    expect(duplicate.ok).toBe(false)
    expect(duplicate.problems).toContain('DUPLICATE_PATH_SEGMENT')

    const traversal = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: '../outside',
    })
    expect(traversal.ok).toBe(false)
    expect(traversal.problems).toContain('TARGET_DIRECTORY_TRAVERSAL')
  })
})

describe('executeProjectImageMigration', () => {
  it('copies files, rewrites references and keeps the sources by default', async () => {
    const { root, project, assets, docs } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    const result = await executeProjectImageMigration(plan, { backupDir: path.join(root, 'backup') })
    expect(result.ok).toBe(true)
    expect(result.journal?.status).toBe('applied')

    expect(await fs.readFile(path.join(assets, 'images', 'x.png'), 'utf8')).toBe('X-CONTENT')
    expect(await fs.readFile(path.join(docs, 'a.md'), 'utf8')).toContain('![x](../assets/images/x.png)')
    expect(await fs.readFile(path.join(docs, 'b.md'), 'utf8')).toContain('../assets/images/x.png')
    expect(await fs.readFile(path.join(assets, 'x.png'), 'utf8')).toBe('X-CONTENT')
    expect(await fs.readFile(path.join(docs, 'a.md'), 'utf8')).toContain('![code](../assets/y.png)')
  })

  it('aborts when a document changed after planning', async () => {
    const { root, project, assets, docs } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    await fs.writeFile(path.join(docs, 'b.md'), '![x](../assets/x.png)\n\nchanged\n')
    const result = await executeProjectImageMigration(plan, { backupDir: path.join(root, 'backup') })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('DOCUMENT_CHANGED')
    await expect(fs.access(path.join(assets, 'images', 'x.png'))).rejects.toThrow()
  })

  it('rolls back documents and removes copied targets', async () => {
    const { root, project, assets, docs } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    const result = await executeProjectImageMigration(plan, { backupDir: path.join(root, 'backup') })
    expect(result.ok).toBe(true)

    const rolledBack = await rollbackProjectImageMigration(result.journalPath as string)
    expect(rolledBack.ok).toBe(true)
    expect(await fs.readFile(path.join(docs, 'a.md'), 'utf8')).toContain('![x](../assets/x.png)')
    await expect(fs.access(path.join(assets, 'images', 'x.png'))).rejects.toThrow()
    expect(await fs.readFile(path.join(assets, 'x.png'), 'utf8')).toBe('X-CONTENT')
  })

  it('refuses rollback after the document was edited again', async () => {
    const { root, project, assets, docs } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    const result = await executeProjectImageMigration(plan, { backupDir: path.join(root, 'backup') })
    expect(result.ok).toBe(true)
    await fs.appendFile(path.join(docs, 'a.md'), '\n\nnew edit\n')

    const rolledBack = await rollbackProjectImageMigration(result.journalPath as string)
    expect(rolledBack.ok).toBe(false)
    expect(rolledBack.error).toContain('DOCUMENT_CHANGED_SINCE_MIGRATION')
    expect(await fs.readFile(path.join(docs, 'a.md'), 'utf8')).toContain('new edit')
    expect(await fs.readFile(path.join(assets, 'images', 'x.png'), 'utf8')).toBe('X-CONTENT')
  })

  it('refuses to run while a changed document is open', async () => {
    const { root, project, assets } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    const result = await executeProjectImageMigration(plan, {
      backupDir: path.join(root, 'backup'),
      isDocumentOpen: () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('DOCUMENT_OPEN')
  })
})

describe('cleanupProjectImageSources', () => {
  it('deletes old sources only after explicit cleanup and target verification', async () => {
    const { root, project, assets } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    const result = await executeProjectImageMigration(plan, { backupDir: path.join(root, 'backup') })
    expect(result.ok).toBe(true)

    const cleanup = await cleanupProjectImageSources(result.journalPath as string)
    expect(cleanup.ok).toBe(true)
    expect(cleanup.removed).toBe(2)
    await expect(fs.access(path.join(assets, 'x.png'))).rejects.toThrow()
    await expect(fs.access(path.join(assets, 'y.png'))).rejects.toThrow()
    expect(await fs.readFile(path.join(assets, 'images', 'x.png'), 'utf8')).toBe('X-CONTENT')
    // 未迁移的未引用文件保持不动。
    expect(await fs.readFile(path.join(assets, 'z.png'), 'utf8')).toBe('Z-CONTENT')
  })

  it('rejects cleanup before the migration is applied', async () => {
    const { root, project, assets } = await makeProject()
    const plan = await planProjectImageMigration({
      projectRoot: project,
      assetRoot: assets,
      targetDirectory: 'assets/images',
    })
    expect(plan.ok).toBe(true)
    const cleanup = await cleanupProjectImageSources(path.join(root, 'missing.json'))
    expect(cleanup.ok).toBe(false)
  })
})

describe('hasDuplicateAdjacentSegments', () => {
  it('detects duplicated path segments case-insensitively', () => {
    expect(hasDuplicateAdjacentSegments(['assets', 'images'])).toBe(false)
    expect(hasDuplicateAdjacentSegments(['assets', 'Assets'])).toBe(true)
    expect(hasDuplicateAdjacentSegments(['project', 'assets', 'assets'])).toBe(true)
  })
})
