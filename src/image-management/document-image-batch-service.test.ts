import { describe, expect, it, vi } from 'vitest'
import { DocumentImageBatchService, type DocumentImageBatchDeps } from './document-image-batch-service'
import { DEFAULT_IMAGE_SETTINGS, resolveImageSettings } from './image-settings'
import type { BatchReferenceKnowledge } from './document-image-batch'

const PROFILE = {
  remoteProfileId: 'p1', provider: 'github' as const, owner: 'o', repository: 'r', branch: 'main',
  remoteDirectory: '', urlStrategy: 'raw' as const, customUrlBase: '', credentialReferenceId: 'c', enabled: true,
}

function settings(overrides: Record<string, unknown> = {}) {
  return resolveImageSettings({ ...DEFAULT_IMAGE_SETTINGS, remoteProfiles: [PROFILE], ...overrides } as never)
}

function deps(overrides: Partial<DocumentImageBatchDeps> = {}) {
  const knowledge: Map<string, BatchReferenceKnowledge> = new Map()
  const state = {
    upload: vi.fn(async () => ({ ok: true, resultKind: 'UPLOADED_NEW' })),
    download: vi.fn(async () => ({ ok: true, resultKind: 'DOWNLOADED_NEW' })),
    confirm: vi.fn(() => true),
    notify: vi.fn(),
  }
  const base: DocumentImageBatchDeps = {
    getMarkdown: () => [
      '![](https://cdn.example.test/a.png)',
      '![](https://cdn.example.test/b.png)',
      '![](assets/local-one.png)',
      '![](assets/local-two.png)',
    ].join('\n'),
    getDocumentPath: () => 'D:/vault/notes/doc.md',
    getSettings: () => settings({ enabled: true, uploadService: 'github' }),
    resolveProjectDirectory: () => 'D:/vault/notes/assets/images',
    getAssetKnowledge: () => knowledge,
    upload: state.upload,
    download: state.download,
    confirm: state.confirm,
    notify: state.notify,
    ...overrides,
  }
  return { deps: base, state, knowledge }
}

describe('DocumentImageBatchService.preview', () => {
  it('summarizes the current document references without any transfer', () => {
    const { deps: d, state } = deps()
    const service = new DocumentImageBatchService(d)
    const preview = service.preview('upload')
    expect(preview.remoteReferences).toBe(2)
    expect(preview.localReferences).toBe(2)
    expect(preview.pendingUploadCount).toBe(2)
    expect(preview.pendingDownloadCount).toBe(2)
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.download).not.toHaveBeenCalled()
  })

  it('uses verified asset knowledge for reuse', () => {
    const { deps: d, knowledge } = deps()
    knowledge.set('https://cdn.example.test/a.png', 'remote-verified')
    knowledge.set('assets/local-one.png', 'local-verified')
    const preview = new DocumentImageBatchService(d).preview('upload')
    expect(preview.reuseRemoteCount).toBe(1)
    expect(preview.reuseLocalCount).toBe(1)
    expect(preview.pendingUploadCount).toBe(1)
  })
})

describe('DocumentImageBatchService.run', () => {
  it('uploads only the unknown local references and deduplicates targets', async () => {
    const { deps: d, state, knowledge } = deps({
      getMarkdown: () => '![](assets/a.png)\n![](assets/a.png)\n![](assets/b.png)',
    })
    knowledge.set('assets/b.png', 'local-verified')
    const service = new DocumentImageBatchService(d)
    const result = await service.run('upload')
    expect(result.attempted).toBe(2)
    expect(result.reused).toBe(1)
    expect(result.transferred).toBe(1)
    expect(state.upload).toHaveBeenCalledTimes(1)
    expect(state.upload).toHaveBeenCalledWith('assets/a.png')
  })

  it('counts REUSED_REMOTE as reuse, not transfer', async () => {
    const { deps: d } = deps({
      getMarkdown: () => '![](assets/a.png)',
      upload: async () => ({ ok: true, resultKind: 'REUSED_REMOTE' }),
    })
    const result = await new DocumentImageBatchService(d).run('upload')
    expect(result.reused).toBe(1)
    expect(result.transferred).toBe(0)
  })

  it('does not stop on a failed item', async () => {
    const upload = vi.fn(async (filePath: string) => (filePath === 'assets/a.png'
      ? { ok: false, message: 'X' }
      : { ok: true, resultKind: 'UPLOADED_NEW' }))
    const { deps: d } = deps({
      getMarkdown: () => '![](assets/a.png)\n![](assets/b.png)',
      upload,
    })
    const result = await new DocumentImageBatchService(d).run('upload')
    expect(result.failed).toBe(1)
    expect(result.transferred).toBe(1)
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('downloads only remote references', async () => {
    const { deps: d, state } = deps()
    const result = await new DocumentImageBatchService(d).run('download')
    expect(result.attempted).toBe(2)
    expect(result.transferred).toBe(2)
    expect(state.download).toHaveBeenCalledTimes(2)
  })

  it('requires explicit confirmation', async () => {
    const { deps: d, state } = deps({ confirm: () => false })
    const result = await new DocumentImageBatchService(d).run('upload')
    expect(result.cancelled).toBe(true)
    expect(state.upload).not.toHaveBeenCalled()
  })

  it('dual-link only previews and never transfers', async () => {
    const { deps: d, state } = deps()
    const result = await new DocumentImageBatchService(d).run('dual-link')
    expect(result.attempted).toBe(0)
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.download).not.toHaveBeenCalled()
  })

  it('never invokes a markdown rewrite callback (default: no reference changes)', async () => {
    const { deps: d } = deps()
    const service = new DocumentImageBatchService(d)
    const result = await service.run('upload')
    // deps 没有提供任何 rewrite 回调；结果只包含传输统计。
    expect(Object.keys(result)).not.toContain('rewritten')
  })
})
