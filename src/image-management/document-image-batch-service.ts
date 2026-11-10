/**
 * V5.1 — 当前文档图片批量操作执行器。
 *
 * 约束：
 * - 预检（preview）只读；执行前必须 `confirm` 返回 true。
 * - 默认**不改写 Markdown**：上传/下载只落盘/登记；引用改写是独立操作。
 * - 同一目标只处理一次（去重）；失败不中断其它项。
 * - 结果如实区分复用（REUSED_*）与新传输（UPLOADED_NEW / DOWNLOADED_NEW）。
 */

import { parseImageSourceOccurrences } from '../document-utilities/document-resource-scanner'
import type { ImageSettings } from './image-settings'
import {
  buildDocumentImageBatchPreview,
  canExecuteDocumentImageBatch,
  type BatchImageReference,
  type BatchReferenceKnowledge,
  type DocumentImageBatchPreview,
} from './document-image-batch'

export type DocumentImageBatchKind = 'upload' | 'download' | 'dual-link'

export interface DocumentImageBatchUploadResult {
  ok: boolean
  resultKind?: string
  message?: string
}

export interface DocumentImageBatchDownloadResult {
  ok: boolean
  resultKind?: string
  message?: string
}

export interface DocumentImageBatchDeps {
  getMarkdown: () => string | null
  getDocumentPath: () => string | null
  getSettings: () => ImageSettings
  /** 当前文档生效资源目录（绝对路径）；无文档时为 null。 */
  resolveProjectDirectory: (settings: ImageSettings) => string | null
  /** 资产知识：rawDestination → 已验证的本地/远程状态。 */
  getAssetKnowledge: () => ReadonlyMap<string, BatchReferenceKnowledge>
  upload: (filePath: string) => Promise<DocumentImageBatchUploadResult>
  download: (url: string) => Promise<DocumentImageBatchDownloadResult>
  confirm: (message: string) => boolean
  notify?: (message: string, kind: 'info' | 'error') => void
}

export interface DocumentImageBatchRunResult {
  kind: DocumentImageBatchKind
  preview: DocumentImageBatchPreview
  attempted: number
  reused: number
  transferred: number
  failed: number
  cancelled: boolean
  blockedReason?: string
}

function buildReferences(deps: DocumentImageBatchDeps): BatchImageReference[] {
  const markdown = deps.getMarkdown() ?? ''
  const knowledge = deps.getAssetKnowledge()
  return parseImageSourceOccurrences(markdown).map(ref => {
    const isRemote = !ref.isLocal
    return {
      rawDestination: ref.rawDestination,
      isRemote,
      isLocal: ref.isLocal,
      // 存在性由调用方在批量预览时按需校验；执行器本身不做文件系统探测。
      localExists: null,
      assetKnown: knowledge.get(ref.rawDestination) ?? 'unknown',
    }
  })
}

export class DocumentImageBatchService {
  constructor(private readonly deps: DocumentImageBatchDeps) {}

  preview(kind: DocumentImageBatchKind): DocumentImageBatchPreview {
    const settings = this.deps.getSettings()
    return buildDocumentImageBatchPreview({
      references: buildReferences(this.deps),
      settings,
      projectDirectory: this.deps.resolveProjectDirectory(settings),
      uploadAvailable: settings.uploadService === 'github',
    })
  }

  /**
   * 执行批量操作。`kind='dual-link'` 只预检返回（补齐需要显式引用改写授权）。
   */
  async run(kind: DocumentImageBatchKind): Promise<DocumentImageBatchRunResult> {
    const preview = this.preview(kind)
    const base: DocumentImageBatchRunResult = {
      kind,
      preview,
      attempted: 0,
      reused: 0,
      transferred: 0,
      failed: 0,
      cancelled: false,
    }
    if (kind === 'dual-link') return base

    const work = kind === 'upload' ? preview.pendingUploadCount : preview.pendingDownloadCount
    if (work === 0) {
      this.deps.notify?.(
        kind === 'upload' ? '没有待上传的本地图片' : '没有待下载的远程图片',
        'info',
      )
      return base
    }
    if (!this.deps.confirm(this.confirmMessage(kind, preview))) {
      return { ...base, cancelled: true }
    }
    const verdict = canExecuteDocumentImageBatch(preview, true)
    if (!verdict.ok) {
      return { ...base, blockedReason: verdict.reason }
    }

    const settings = this.deps.getSettings()
    const refs = buildReferences(this.deps)
    const seen = new Set<string>()
    for (const ref of refs) {
      const wanted = kind === 'upload' ? ref.isLocal : ref.isRemote
      if (!wanted) continue
      if (seen.has(ref.rawDestination)) continue
      seen.add(ref.rawDestination)
      base.attempted++

      if (kind === 'upload') {
        if (ref.assetKnown === 'local-verified' || ref.assetKnown === 'both') {
          base.reused++
          continue
        }
        try {
          const result = await this.deps.upload(ref.rawDestination)
          if (!result.ok) {
            base.failed++
            continue
          }
          if (result.resultKind === 'REUSED_REMOTE') base.reused++
          else base.transferred++
        } catch {
          base.failed++
        }
        continue
      }

      if (ref.assetKnown === 'remote-verified' || ref.assetKnown === 'both') {
        base.reused++
        continue
      }
      try {
        const result = await this.deps.download(ref.rawDestination)
        if (!result.ok) {
          base.failed++
          continue
        }
        if (result.resultKind === 'REUSED_LOCAL' || result.resultKind === 'COPIED_EXISTING_LOCAL') base.reused++
        else base.transferred++
      } catch {
        base.failed++
      }
    }
    // settings 变量用于确认目录语义：执行阶段由注入的 download 服务按需创建目录。
    void settings
    this.deps.notify?.(
      `${kind === 'upload' ? '上传' : '下载'}完成：复用 ${base.reused}，新传输 ${base.transferred}，失败 ${base.failed}`,
      base.failed > 0 ? 'error' : 'info',
    )
    return base
  }

  private confirmMessage(kind: DocumentImageBatchKind, preview: DocumentImageBatchPreview): string {
    const lines = [
      kind === 'upload' ? '上传当前文档全部本地图片？' : '下载当前文档全部远程图片？',
      preview.summary,
    ]
    if (preview.directoriesToCreate.length > 0) {
      lines.push(`将按需创建目录：${preview.directoriesToCreate.join('、')}`)
    }
    lines.push('默认不会修改 Markdown 引用；已有内容会直接复用。')
    return lines.join('\n')
  }
}
