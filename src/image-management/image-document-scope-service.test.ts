import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings } from './image-settings'
import { ImageScopeStore } from './image-scope-store'
import { ImageDocumentScopeService } from './image-document-scope-service'

const tempDirs: string[] = []
const DOC = 'D:/vault/notes/chapter/doc.md'

async function makeService(initialDocumentPath: string | null = DOC) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inkchapter-doc-scope-'))
  tempDirs.push(dir)
  let documentPath = initialDocumentPath
  const service = new ImageDocumentScopeService({
    getGlobalSettings: () => resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, autoUpload: false } as never),
    getActiveDocumentPath: () => documentPath,
    store: new ImageScopeStore({ dataRoot: dir }),
  })
  return {
    service,
    setDocument: (next: string | null) => { documentPath = next },
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('ImageDocumentScopeService', () => {
  it('resolves the active document with folder + document overrides', async () => {
    const { service } = await makeService()
    await service.setFolderScope({ autoLocalizeOnInsert: true })
    await service.setDocumentScope({ documentResourceDirectory: 'assets/doc', autoUpload: true })

    const resolved = await service.resolve()
    expect(resolved.settings.documentResourceDirectory).toBe('assets/doc')
    expect(resolved.settings.autoLocalizeOnInsert).toBe(true)
    expect(resolved.settings.autoUpload).toBe(true)
    expect(resolved.appliedFolderPath).toBe('d:/vault/notes/chapter')
    expect(resolved.appliedDocumentPath).toBe('d:/vault/notes/chapter/doc.md')
  })

  it('reports the active folder path', async () => {
    const { service } = await makeService()
    expect(service.getActiveFolderPath()).toBe('d:/vault/notes/chapter')
    const { service: noDoc } = await makeService(null)
    expect(noDoc.getActiveFolderPath()).toBeNull()
  })

  it('round-trips document and folder overrides', async () => {
    const { service } = await makeService()
    await service.setDocumentScope({ namingStrategy: 'original-name' })
    await service.setFolderScope({ compressionMode: 'lossless' })
    expect(await service.getDocumentOverride()).toEqual({ namingStrategy: 'original-name' })
    expect(await service.getFolderOverride()).toEqual({ compressionMode: 'lossless' })

    await service.clearDocumentScope()
    await service.clearFolderScope()
    expect(await service.getDocumentOverride()).toBeNull()
    expect(await service.getFolderOverride()).toBeNull()
  })

  it('supports a document opened outside the project', async () => {
    const outside = 'E:/standalone/solo.md'
    const { service, setDocument } = await makeService()
    setDocument(outside)
    await service.setDocumentScope({ autoLocalizeOnInsert: true, documentResourceDirectory: 'img' })
    const resolved = await service.resolve()
    expect(resolved.settings.autoLocalizeOnInsert).toBe(true)
    expect(resolved.settings.documentResourceDirectory).toBe('img')
    expect(resolved.appliedDocumentPath).toBe('e:/standalone/solo.md')
  })

  it('ignores scopes when no document is open', async () => {
    const { service, setDocument } = await makeService()
    await service.setDocumentScope({ autoUpload: true })
    setDocument(null)
    const resolved = await service.resolve()
    expect(resolved.settings.autoUpload).toBe(false)
    expect(resolved.appliedDocumentPath).toBeNull()
  })

  it('throws a stable error when setting a document scope without a document', async () => {
    const { service, setDocument } = await makeService()
    setDocument(null)
    await expect(service.setDocumentScope({ autoUpload: true })).rejects.toThrow('NO_ACTIVE_DOCUMENT')
  })
})
