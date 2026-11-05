import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ImageScopeStore } from './image-scope-store'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings } from './image-settings'

const tempDirs: string[] = []

async function makeStore(): Promise<{ store: ImageScopeStore; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-scope-'))
  tempDirs.push(dir)
  return { store: new ImageScopeStore({ dataRoot: dir }), dir }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const DOC = 'D:/vault/notes/chapter/doc.md'
const FOLDER = 'D:/vault/notes'

describe('ImageScopeStore — persistence', () => {
  it('persists folder and document scopes across instances', async () => {
    const { store, dir } = await makeStore()
    await store.setFolder(FOLDER, { autoUpload: false, documentResourceDirectory: 'assets/folder' })
    await store.setDocument(DOC, { documentResourceDirectory: 'assets/doc' })

    const reopened = new ImageScopeStore({ dataRoot: dir })
    const entries = await reopened.list()
    expect(entries).toHaveLength(2)
    expect(entries.find(e => e.kind === 'folder')?.overrides.documentResourceDirectory).toBe('assets/folder')
    expect(entries.find(e => e.kind === 'document')?.path).toBe('d:/vault/notes/chapter/doc.md')
  })

  it('replaces an existing scope for the same kind + path', async () => {
    const { store } = await makeStore()
    await store.setDocument(DOC, { autoUpload: true })
    await store.setDocument(DOC, { autoUpload: false, autoLocalizeOnInsert: true })
    const entries = await store.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].overrides).toEqual({ autoUpload: false, autoLocalizeOnInsert: true })
  })

  it('removes an empty override set instead of persisting a dead entry', async () => {
    const { store } = await makeStore()
    await store.setDocument(DOC, { autoUpload: true })
    await store.setDocument(DOC, {})
    expect(await store.list()).toHaveLength(0)
  })

  it('falls back to an empty store when the file is corrupt', async () => {
    const { store, dir } = await makeStore()
    await fs.writeFile(path.join(dir, 'image-scopes.json'), '{not-json', 'utf8')
    expect(await store.list()).toEqual([])
  })

  it('drops disallowed / malformed entries on load', async () => {
    const { store, dir } = await makeStore()
    await fs.writeFile(path.join(dir, 'image-scopes.json'), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { kind: 'folder', path: FOLDER, overrides: { token: 'x', autoUpload: true } },
        { kind: 'document', path: '', overrides: { autoUpload: true } },
        { kind: 'workspace', path: 'D:/x', overrides: {} },
      ],
    }), 'utf8')
    const entries = await store.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].overrides).toEqual({ autoUpload: true })
  })
})

describe('ImageScopeStore — resolution', () => {
  it('resolves document over folder over global and reports origins', async () => {
    const { store } = await makeStore()
    await store.setFolder(FOLDER, { autoUpload: false })
    await store.setDocument(DOC, { documentResourceDirectory: 'assets/doc' })
    const globalSettings = resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, autoUpload: true } as never)
    const resolved = await store.resolve(DOC, globalSettings)
    expect(resolved.settings.autoUpload).toBe(false)
    expect(resolved.settings.documentResourceDirectory).toBe('assets/doc')
    expect(resolved.appliedFolderPath).toBe('d:/vault/notes')
    expect(resolved.appliedDocumentPath).toBe('d:/vault/notes/chapter/doc.md')
  })

  it('supports a document opened outside any project folder', async () => {
    const outside = 'E:/standalone/solo.md'
    const { store } = await makeStore()
    await store.setDocument(outside, { autoLocalizeOnInsert: true })
    const globalSettings = resolveImageSettings(DEFAULT_IMAGE_SETTINGS as never)
    const resolved = await store.resolve(outside, globalSettings)
    expect(resolved.settings.autoLocalizeOnInsert).toBe(true)
    expect(resolved.appliedDocumentPath).toBe('e:/standalone/solo.md')
  })

  it('keeps working when documentPath is null (unsaved document)', async () => {
    const { store } = await makeStore()
    await store.setFolder(FOLDER, { autoUpload: true })
    const globalSettings = resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, autoUpload: false } as never)
    const resolved = await store.resolve(null, globalSettings)
    expect(resolved.settings.autoUpload).toBe(false)
    expect(resolved.appliedFolderPath).toBeNull()
  })
})
