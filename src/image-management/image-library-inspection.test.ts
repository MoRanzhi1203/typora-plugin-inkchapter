import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  IMAGE_LIBRARY_MARKER,
  inspectImageLibraryTarget,
  initializeImageLibrary,
} from './image-library-inspection'
import { parseFolderPickerOutput } from './image-directory-picker'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-library-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('inspectImageLibraryTarget', () => {
  it('reports an empty path and a relative path as invalid', async () => {
    expect((await inspectImageLibraryTarget('')).code).toBe('EMPTY_PATH')
    expect((await inspectImageLibraryTarget('images/library')).code).toBe('INVALID_PATH')
    expect((await inspectImageLibraryTarget('E:\\library\\..\\other')).code).toBe('INVALID_PATH')
  })

  it('reports a missing directory without creating it', async () => {
    const target = path.join(root, 'not-created')
    const result = await inspectImageLibraryTarget(target)
    expect(result.code).toBe('PATH_MISSING')
    expect(result.ok).toBe(false)
    expect(result.exists).toBe(false)
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a ready empty directory and removes its write probe', async () => {
    const result = await inspectImageLibraryTarget(root)
    expect(result.code).toBe('READY')
    expect(result.ok).toBe(true)
    expect(result.writable).toBe(true)
    expect(result.entryCount).toBe(0)
    expect(result.hasLibraryMarker).toBe(false)
    expect(result.freeBytes === null || typeof result.freeBytes === 'number').toBe(true)
    const entries = await fs.readdir(root)
    expect(entries.filter(name => name.includes('write-probe'))).toEqual([])
  })

  it('warns when the directory is not empty and has no library marker', async () => {
    await fs.writeFile(path.join(root, 'existing.txt'), 'x', 'utf8')
    const result = await inspectImageLibraryTarget(root)
    expect(result.code).toBe('DIRECTORY_NOT_EMPTY')
    expect(result.warnings).toContain('DIRECTORY_NOT_EMPTY')
    expect(result.entryCount).toBe(1)
  })

  it('recognizes an existing library marker', async () => {
    await fs.writeFile(path.join(root, IMAGE_LIBRARY_MARKER), '{}', 'utf8')
    const result = await inspectImageLibraryTarget(root)
    expect(result.code).toBe('EXISTING_LIBRARY')
    expect(result.hasLibraryMarker).toBe(true)
  })

  it('rejects a file target', async () => {
    const filePath = path.join(root, 'not-a-folder')
    await fs.writeFile(filePath, 'x', 'utf8')
    const result = await inspectImageLibraryTarget(filePath)
    expect(result.code).toBe('NOT_A_DIRECTORY')
    expect(result.exists).toBe(true)
  })
})

describe('initializeImageLibrary', () => {
  it('creates a missing directory and writes the marker', async () => {
    const target = path.join(root, 'new-library')
    const result = await initializeImageLibrary(target, { now: new Date('2026-01-01T00:00:00Z') })
    expect(result.ok).toBe(true)
    expect(result.markerCreated).toBe(true)
    expect(result.inspection.code).toBe('EXISTING_LIBRARY')

    const marker = JSON.parse(await fs.readFile(path.join(target, IMAGE_LIBRARY_MARKER), 'utf8')) as {
      schemaVersion: number
      createdAt: string
    }
    expect(marker.schemaVersion).toBe(1)
    expect(marker.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('is idempotent on an already initialized library', async () => {
    const first = await initializeImageLibrary(root)
    expect(first.markerCreated).toBe(true)
    const second = await initializeImageLibrary(root)
    expect(second.ok).toBe(true)
    expect(second.markerCreated).toBe(false)
  })

  it('refuses a non-empty directory without explicit confirmation', async () => {
    await fs.writeFile(path.join(root, 'existing.txt'), 'x', 'utf8')
    const result = await initializeImageLibrary(root)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('DIRECTORY_NOT_EMPTY')
    await expect(fs.stat(path.join(root, IMAGE_LIBRARY_MARKER))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts a non-empty directory when explicitly allowed', async () => {
    await fs.writeFile(path.join(root, 'existing.txt'), 'x', 'utf8')
    const result = await initializeImageLibrary(root, { allowNonEmpty: true })
    expect(result.ok).toBe(true)
    expect(result.markerCreated).toBe(true)
  })

  it('refuses a file target', async () => {
    const filePath = path.join(root, 'file-target')
    await fs.writeFile(filePath, 'x', 'utf8')
    const result = await initializeImageLibrary(filePath)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('NOT_A_DIRECTORY')
  })
})

describe('parseFolderPickerOutput', () => {
  it('returns a trimmed absolute path', () => {
    expect(parseFolderPickerOutput('D:\\Images Library\\\r\n')).toBe('D:\\Images Library\\')
  })

  it('returns null when the dialog is cancelled', () => {
    expect(parseFolderPickerOutput('')).toBeNull()
    expect(parseFolderPickerOutput('   \r\n')).toBeNull()
    expect(parseFolderPickerOutput(null)).toBeNull()
    expect(parseFolderPickerOutput(undefined)).toBeNull()
  })
})
