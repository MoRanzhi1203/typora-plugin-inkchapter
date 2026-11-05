import { describe, expect, it } from 'vitest'
import { buildDocumentHubModel, explainBatchActionDisabled } from './document-hub-model'
import { buildDocumentStatusView, type DocumentStatusFacts } from './document-status-indicator'

const GREEN_FACTS: DocumentStatusFacts = {
  hasDocument: true,
  diagnosticsEnabled: true,
  checking: false,
  structuralVerified: true,
  hasProjection: true,
  errorCount: 0,
  warningCount: 0,
  hintCount: 0,
}

const IMAGE = {
  enabled: true,
  referenceCount: 5,
  localCount: 3,
  remoteCount: 2,
  reuseLocalCount: 1,
  reuseRemoteCount: 1,
  pendingUploadCount: 1,
  pendingDownloadCount: 1,
  dualLinkCompleteCount: 0,
  policyText: '引用 本地相对路径 · GitHub 上传 · 自动：关闭',
  scopeSource: 'document' as const,
  scopeLabel: '覆盖：当前文档',
  projectDirectory: 'D:/vault/assets/images',
}

describe('buildDocumentHubModel', () => {
  it('summarizes the document, status and image policy', () => {
    const model = buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md',
      saved: true,
      status: buildDocumentStatusView(GREEN_FACTS, false),
      locked: false,
      image: IMAGE,
      diagnosticsAvailable: true,
    })
    expect(model.documentName).toBe('doc.md')
    expect(model.saved).toBe(true)
    expect(model.image?.referenceCount).toBe(5)
    expect(model.actions.uploadAll).toBe(true)
    expect(model.actions.downloadAll).toBe(true)
    expect(model.actions.dualLink).toBe(true)
  })

  it('disables markdown-writing actions when locked', () => {
    const model = buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md',
      saved: true,
      status: buildDocumentStatusView(GREEN_FACTS, true),
      locked: true,
      image: IMAGE,
      diagnosticsAvailable: true,
    })
    expect(model.actions.uploadAll).toBe(false)
    // 下载/补链不写 Markdown，锁定仍可用
    expect(model.actions.downloadAll).toBe(true)
    expect(model.actions.dualLink).toBe(true)
    expect(model.actions.toggleLock).toBe(true)
  })

  it('marks an unsaved document and disables document actions', () => {
    const model = buildDocumentHubModel({
      documentPath: null,
      saved: false,
      status: buildDocumentStatusView({ ...GREEN_FACTS, hasDocument: false }, false),
      locked: false,
      image: null,
      diagnosticsAvailable: true,
    })
    expect(model.documentName).toBe('未保存文档')
    expect(model.actions.toggleLock).toBe(false)
    expect(model.actions.uploadAll).toBe(false)
    expect(model.actions.openImageSettings).toBe(true)
  })

  it('disables image actions when image management is off', () => {
    const model = buildDocumentHubModel({
      documentPath: 'D:/vault/notes/doc.md',
      saved: true,
      status: buildDocumentStatusView(GREEN_FACTS, false),
      locked: false,
      image: { ...IMAGE, enabled: false },
      diagnosticsAvailable: true,
    })
    expect(model.actions.uploadAll).toBe(false)
    expect(model.actions.downloadAll).toBe(false)
    expect(model.actions.dualLink).toBe(false)
  })
})

describe('explainBatchActionDisabled', () => {
  const base = buildDocumentHubModel({
    documentPath: 'D:/vault/notes/doc.md',
    saved: true,
    status: buildDocumentStatusView(GREEN_FACTS, false),
    locked: false,
    image: IMAGE,
    diagnosticsAvailable: true,
  })

  it('explains locked upload', () => {
    expect(explainBatchActionDisabled('uploadAll', { ...base, locked: true })).toContain('已锁定')
  })

  it('explains nothing to transfer', () => {
    const idle = { ...base, image: { ...IMAGE, pendingUploadCount: 0, pendingDownloadCount: 0 } }
    expect(explainBatchActionDisabled('uploadAll', idle)).toContain('没有待上传')
    expect(explainBatchActionDisabled('downloadAll', idle)).toContain('没有待下载')
  })

  it('returns null when the action is available', () => {
    expect(explainBatchActionDisabled('uploadAll', base)).toBeNull()
  })
})
