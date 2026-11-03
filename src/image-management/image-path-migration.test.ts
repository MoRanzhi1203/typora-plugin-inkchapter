import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { executePathMigration, planPathMigration, rollbackPathMigration } from './image-path-migration'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-path-migration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function makeSource(root: string): Promise<string> {
  const source = path.join(root, 'source')
  await fs.mkdir(path.join(source, 'nested'), { recursive: true })
  await fs.writeFile(path.join(source, 'a.png'), 'alpha')
  await fs.writeFile(path.join(source, 'nested', 'b.png'), 'beta')
  return source
}

describe('planPathMigration', () => {
  it('previews file count, size and rejects identical or nested roots', async () => {
    const root = await makeRoot()
    const source = await makeSource(root)
    const plan = await planPathMigration({ role: 'library', fromRoot: source, toRoot: path.join(root, 'target') })
    expect(plan.ok).toBe(true)
    expect(plan.fileCount).toBe(2)
    expect(plan.totalBytes).toBe(9)

    const same = await planPathMigration({ role: 'library', fromRoot: source, toRoot: source })
    expect(same.ok).toBe(false)
    expect(same.problems).toContain('SAME_PATH')

    const nested = await planPathMigration({
      role: 'library',
      fromRoot: source,
      toRoot: path.join(source, 'nested'),
    })
    expect(nested.ok).toBe(false)
    expect(nested.problems).toContain('NESTED_PATH')
  })

  it('rejects a missing source directory', async () => {
    const root = await makeRoot()
    const plan = await planPathMigration({
      role: 'cache',
      fromRoot: path.join(root, 'missing'),
      toRoot: path.join(root, 'target'),
    })
    expect(plan.ok).toBe(false)
    expect(plan.problems).toContain('SOURCE_NOT_DIRECTORY')
  })
})

describe('executePathMigration', () => {
  it('copies and verifies files while keeping the source by default', async () => {
    const root = await makeRoot()
    const source = await makeSource(root)
    const target = path.join(root, 'target')
    const backupDir = path.join(root, 'backup')

    const plan = await planPathMigration({ role: 'library', fromRoot: source, toRoot: target })
    const result = await executePathMigration(plan, { backupDir })
    expect(result.ok).toBe(true)
    expect(result.journal?.status).toBe('applied')
    expect(result.journal?.files.every(file => file.state === 'copied')).toBe(true)

    expect(await fs.readFile(path.join(target, 'a.png'), 'utf8')).toBe('alpha')
    expect(await fs.readFile(path.join(target, 'nested', 'b.png'), 'utf8')).toBe('beta')
    expect(await fs.readFile(path.join(source, 'a.png'), 'utf8')).toBe('alpha')
    expect(result.journalPath).toBeTruthy()
  })

  it('deletes the source only when explicitly requested, and rollback restores it', async () => {
    const root = await makeRoot()
    const source = await makeSource(root)
    const target = path.join(root, 'target')
    const backupDir = path.join(root, 'backup')

    const plan = await planPathMigration({ role: 'cache', fromRoot: source, toRoot: target })
    const result = await executePathMigration(plan, { backupDir, deleteSource: true })
    expect(result.ok).toBe(true)
    await expect(fs.access(path.join(source, 'a.png'))).rejects.toThrow()
    expect(await fs.readFile(path.join(target, 'a.png'), 'utf8')).toBe('alpha')

    const rolledBack = await rollbackPathMigration(result.journalPath as string)
    expect(rolledBack.ok).toBe(true)
    expect(rolledBack.restored).toBe(2)
    expect(await fs.readFile(path.join(source, 'a.png'), 'utf8')).toBe('alpha')
    expect(await fs.readFile(path.join(source, 'nested', 'b.png'), 'utf8')).toBe('beta')
    await expect(fs.access(path.join(target, 'a.png'))).rejects.toThrow()
  })

  it('skips identical target files but refuses to overwrite different content', async () => {
    const root = await makeRoot()
    const source = await makeSource(root)
    const target = path.join(root, 'target')
    const backupDir = path.join(root, 'backup')
    await fs.mkdir(path.join(target, 'nested'), { recursive: true })
    await fs.writeFile(path.join(target, 'a.png'), 'alpha')

    const plan = await planPathMigration({ role: 'library', fromRoot: source, toRoot: target })
    const result = await executePathMigration(plan, { backupDir })
    expect(result.ok).toBe(true)
    expect(result.journal?.files.find(file => file.relativePath === 'a.png')?.state).toBe('skipped')
    expect(result.journal?.files.find(file => file.relativePath === 'nested/b.png')?.state).toBe('copied')

    await fs.writeFile(path.join(target, 'nested', 'b.png'), 'different')
    const conflict = await executePathMigration(plan, { backupDir })
    expect(conflict.ok).toBe(false)
    expect(conflict.error).toContain('TARGET_CONFLICT')
    expect(await fs.readFile(path.join(target, 'nested', 'b.png'), 'utf8')).toBe('different')
    expect(await fs.readFile(path.join(source, 'nested', 'b.png'), 'utf8')).toBe('beta')
    expect(conflict.journal?.status).toBe('rolled-back')
  })
})
