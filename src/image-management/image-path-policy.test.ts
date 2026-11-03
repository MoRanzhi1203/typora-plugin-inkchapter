import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  classifyPathChange,
  findImagePathConflicts,
  inspectDirectoryUsage,
  inspectImagePathTarget,
} from './image-path-policy'
import { resolveImageDataPaths } from './image-data-paths'
import type { ImageSettings } from './image-settings'

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-path-policy-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

type PathSettings = Pick<
  ImageSettings,
  'globalLibrary' | 'cache' | 'offline' | 'uploadStaging' | 'database'
>

function settings(overrides: Partial<PathSettings> = {}): PathSettings {
  return {
    globalLibrary: { mode: 'off', root: '' },
    cache: { mode: 'smart', root: '', maxSizeMB: 512 },
    offline: { root: '' },
    uploadStaging: { root: '' },
    database: { root: '' },
    ...overrides,
  }
}

describe('classifyPathChange', () => {
  it('treats identical paths as no-op (case-insensitive on Windows)', () => {
    expect(classifyPathChange('cache', 'C:/Cache', 'c:\\cache')).toBe('noop')
  })

  it('allows cache and staging to change for future tasks only', () => {
    expect(classifyPathChange('cache', 'C:/Old', 'C:/New')).toBe('migrate-required')
    expect(classifyPathChange('cache', 'C:/Old', null)).toBe('future-only')
    expect(classifyPathChange('staging', 'C:/Old', null)).toBe('future-only')
  })

  it('requires explicit confirmation before dropping library/offline/database guarantees', () => {
    expect(classifyPathChange('library', 'D:/Lib', null)).toBe('cancel-requires-confirmation')
    expect(classifyPathChange('offline', 'D:/Offline', null)).toBe('cancel-requires-confirmation')
    expect(classifyPathChange('database', 'D:/Db', null)).toBe('cancel-requires-confirmation')
  })
})

describe('findImagePathConflicts', () => {
  it('accepts separate default roots', async () => {
    const root = await makeRoot()
    const paths = resolveImageDataPaths(root, {
      settings: settings({ globalLibrary: { mode: 'archive', root: path.join(root, 'library') } }),
      env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
    })
    expect(findImagePathConflicts(paths)).toEqual([])
  })

  it('rejects identical and nested roots', async () => {
    const root = await makeRoot()
    const same = resolveImageDataPaths(root, {
      settings: settings({
        globalLibrary: { mode: 'archive', root: path.join(root, 'shared') },
        cache: { mode: 'smart', root: path.join(root, 'shared'), maxSizeMB: 512 },
      }),
      env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
    })
    expect(findImagePathConflicts(same).map(conflict => conflict.kind)).toContain('same')

    const nested = resolveImageDataPaths(root, {
      settings: settings({
        globalLibrary: { mode: 'archive', root: path.join(root, 'library') },
        offline: { root: path.join(root, 'library', 'offline') },
      }),
      env: { localAppData: path.join(root, 'local'), tempDir: path.join(root, 'temp') },
    })
    expect(findImagePathConflicts(nested).map(conflict => conflict.kind)).toContain('nested')
  })
})

describe('inspectDirectoryUsage', () => {
  it('counts nested files and bytes without following links', async () => {
    const root = await makeRoot()
    await fs.mkdir(path.join(root, 'a', 'b'), { recursive: true })
    await fs.writeFile(path.join(root, 'a', 'one.png'), '12345')
    await fs.writeFile(path.join(root, 'a', 'b', 'two.png'), '123')

    const usage = await inspectDirectoryUsage(root)
    expect(usage.fileCount).toBe(2)
    expect(usage.totalBytes).toBe(8)
    expect(usage.truncated).toBe(false)
    expect(usage.errors).toEqual([])
  })

  it('stops at the entry budget and reports truncation', async () => {
    const root = await makeRoot()
    for (let index = 0; index < 5; index++) {
      await fs.writeFile(path.join(root, `${index}.png`), 'x')
    }
    const usage = await inspectDirectoryUsage(root, { maxEntries: 2 })
    expect(usage.truncated).toBe(true)
  })
})

describe('inspectImagePathTarget', () => {
  it('reports an existing writable directory as ready', async () => {
    const root = await makeRoot()
    const inspection = await inspectImagePathTarget(root)
    expect(inspection.code).toBe('READY')
    expect(inspection.ok).toBe(true)
    expect(inspection.isDirectory).toBe(true)
  })

  it('reports missing paths and files separately', async () => {
    const root = await makeRoot()
    const missing = await inspectImagePathTarget(path.join(root, 'missing'))
    expect(missing.code).toBe('MISSING')

    const file = path.join(root, 'note.txt')
    await fs.writeFile(file, 'x')
    const notDirectory = await inspectImagePathTarget(file)
    expect(notDirectory.code).toBe('NOT_DIRECTORY')
  })
})
