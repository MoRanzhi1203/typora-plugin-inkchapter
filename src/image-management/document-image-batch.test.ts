import { describe, expect, it } from 'vitest'
import {
  buildDocumentImageBatchPreview,
  canExecuteDocumentImageBatch,
  summarizeImagePolicy,
  type BatchImageReference,
} from './document-image-batch'

const SETTINGS = {
  referenceMode: 'local-relative' as const,
  uploadService: 'github' as const,
  autoUpload: false,
  autoLocalizeOnInsert: false,
  documentResourceDirectory: 'assets/images',
}

function ref(overrides: Partial<BatchImageReference> = {}): BatchImageReference {
  return {
    rawDestination: 'https://cdn.example.test/a.png',
    isRemote: true,
    isLocal: false,
    localExists: null,
    assetKnown: 'unknown',
    ...overrides,
  }
}

describe('buildDocumentImageBatchPreview', () => {
  it('classifies remote and local references with reuse priority', () => {
    const preview = buildDocumentImageBatchPreview({
      references: [
        ref({ assetKnown: 'remote-verified' }),
        ref({ rawDestination: 'https://cdn.example.test/b.png' }),
        ref({ rawDestination: 'assets/local-known.png', isRemote: false, isLocal: true, localExists: true, assetKnown: 'local-verified' }),
        ref({ rawDestination: 'assets/local-new.png', isRemote: false, isLocal: true, localExists: true, assetKnown: 'unknown' }),
        ref({ rawDestination: 'assets/missing.png', isRemote: false, isLocal: true, localExists: false, assetKnown: 'unknown' }),
      ],
      settings: SETTINGS,
      projectDirectory: 'D:/vault/assets/images',
      uploadAvailable: true,
    })
    expect(preview.totalReferences).toBe(5)
    expect(preview.remoteReferences).toBe(2)
    expect(preview.localReferences).toBe(3)
    expect(preview.reuseRemoteCount).toBe(1)
    expect(preview.reuseLocalCount).toBe(1)
    expect(preview.pendingDownloadCount).toBe(1)
    expect(preview.pendingUploadCount).toBe(1)
    expect(preview.missingLocalCount).toBe(1)
    expect(preview.rewriteCandidateCount).toBe(2)
    expect(preview.blockedReasons).toEqual([])
  })

  it('counts dual-link complete references only when both sides are verified', () => {
    const preview = buildDocumentImageBatchPreview({
      references: [ref({ isRemote: false, isLocal: true, localExists: true, assetKnown: 'both' })],
      settings: SETTINGS,
      projectDirectory: 'D:/vault/assets/images',
      uploadAvailable: true,
    })
    expect(preview.dualLinkCompleteCount).toBe(1)
    expect(preview.pendingUploadCount).toBe(0)
  })

  it('blocks when uploads are pending and upload is unavailable', () => {
    const preview = buildDocumentImageBatchPreview({
      references: [ref({ isRemote: false, isLocal: true, localExists: true, assetKnown: 'unknown' })],
      settings: SETTINGS,
      projectDirectory: 'D:/vault/assets/images',
      uploadAvailable: false,
    })
    expect(preview.blockedReasons).toContain('UPLOAD_UNAVAILABLE')
  })

  it('blocks downloads without a project directory', () => {
    const preview = buildDocumentImageBatchPreview({
      references: [ref()],
      settings: SETTINGS,
      projectDirectory: null,
      uploadAvailable: true,
    })
    expect(preview.blockedReasons).toContain('NO_PROJECT_DIRECTORY')
  })

  it('never creates directories during preview (only lists candidates)', () => {
    const preview = buildDocumentImageBatchPreview({
      references: [ref(), ref({ rawDestination: 'https://cdn.example.test/c.png' })],
      settings: SETTINGS,
      projectDirectory: 'D:/vault/assets/images',
      uploadAvailable: true,
    })
    expect(preview.directoriesToCreate).toEqual(['assets/images'])
    // 纯函数：没有文件系统访问，调用方只能拿到候选目录名
    expect(preview.summary).toContain('待下载')
  })
})

describe('canExecuteDocumentImageBatch', () => {
  const preview = buildDocumentImageBatchPreview({
    references: [ref()],
    settings: SETTINGS,
    projectDirectory: 'D:/vault/assets/images',
    uploadAvailable: true,
  })

  it('requires explicit confirmation', () => {
    expect(canExecuteDocumentImageBatch(preview, false)).toEqual({ ok: false, reason: 'NOT_CONFIRMED' })
  })

  it('refuses blocked previews', () => {
    const blocked = buildDocumentImageBatchPreview({
      references: [ref()],
      settings: SETTINGS,
      projectDirectory: null,
      uploadAvailable: true,
    })
    expect(canExecuteDocumentImageBatch(blocked, true)).toEqual({ ok: false, reason: 'BLOCKED' })
  })

  it('refuses when there is no work', () => {
    const idle = buildDocumentImageBatchPreview({
      references: [ref({ assetKnown: 'both' })],
      settings: SETTINGS,
      projectDirectory: 'D:/vault/assets/images',
      uploadAvailable: true,
    })
    expect(canExecuteDocumentImageBatch(idle, true)).toEqual({ ok: false, reason: 'NOTHING_TO_DO' })
  })

  it('allows a confirmed, unblocked preview with work', () => {
    expect(canExecuteDocumentImageBatch(preview, true)).toEqual({ ok: true })
  })
})

describe('summarizeImagePolicy', () => {
  it('states reference mode, upload service and automation', () => {
    expect(summarizeImagePolicy({
      referenceMode: 'local-relative',
      uploadService: 'github',
      autoUpload: true,
      autoLocalizeOnInsert: false,
    })).toContain('GitHub 上传')
    expect(summarizeImagePolicy({
      referenceMode: 'remote-url',
      uploadService: 'none',
      autoUpload: false,
      autoLocalizeOnInsert: false,
    })).toContain('自动：关闭')
  })
})
