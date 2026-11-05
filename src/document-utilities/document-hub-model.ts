/**
 * V5.1 — 统一「墨章文档管理中心」数据模型（纯函数）。
 *
 * 一个面板同时呈现：检测摘要、锁定状态、当前文档图片策略与批量图片入口。
 * 数据模型不读 DOM / 不读盘；调用方把真实快照传进来。
 */

import type { DocumentStatusView } from './document-status-indicator'

export type ImageScopeSource = 'global' | 'folder' | 'document'

export interface DocumentHubImageSummary {
  enabled: boolean
  referenceCount: number
  localCount: number
  remoteCount: number
  reuseLocalCount: number
  reuseRemoteCount: number
  pendingUploadCount: number
  pendingDownloadCount: number
  dualLinkCompleteCount: number
  policyText: string
  scopeSource: ImageScopeSource
  scopeLabel: string
  projectDirectory: string | null
}

export interface DocumentHubModelInput {
  documentPath: string | null
  saved: boolean
  status: DocumentStatusView
  locked: boolean
  image: DocumentHubImageSummary | null
  /** 检测功能是否可用（诊断服务就绪）。 */
  diagnosticsAvailable: boolean
}

export interface DocumentHubActionAvailability {
  recheck: boolean
  toggleLock: boolean
  openDiagnostics: boolean
  uploadAll: boolean
  downloadAll: boolean
  dualLink: boolean
  openImageSettings: boolean
}

export interface DocumentHubModel {
  documentPath: string | null
  documentName: string
  saved: boolean
  status: DocumentStatusView
  locked: boolean
  image: DocumentHubImageSummary | null
  actions: DocumentHubActionAvailability
  /** 顶部一句摘要。 */
  headline: string
}

export function buildDocumentHubModel(input: DocumentHubModelInput): DocumentHubModel {
  const hasDocument = input.documentPath != null && input.documentPath !== ''
  const documentName = hasDocument
    ? input.documentPath!.split(/[\\/]/).pop() ?? input.documentPath!
    : '未保存文档'
  const imageEnabled = input.image?.enabled === true
  const canReadImages = imageEnabled && hasDocument
  return {
    documentPath: input.documentPath,
    documentName,
    saved: input.saved,
    status: input.status,
    locked: input.locked,
    image: input.image,
    actions: {
      recheck: input.diagnosticsAvailable,
      toggleLock: hasDocument,
      openDiagnostics: hasDocument,
      uploadAll: canReadImages && !input.locked,
      downloadAll: canReadImages,
      dualLink: canReadImages,
      openImageSettings: true,
    },
    headline: input.status.label,
  }
}

/** 批量操作按钮的禁用原因（用于 tooltip，避免“按钮灰了但不知道为什么”）。 */
export function explainBatchActionDisabled(
  action: 'uploadAll' | 'downloadAll' | 'dualLink',
  model: DocumentHubModel,
): string | null {
  if (!model.image || !model.image.enabled) return '图片管理未启用'
  if (!model.documentPath) return '当前文档尚未保存'
  if (action === 'uploadAll' && model.locked) return '文档已锁定：上传会改写引用，请先解锁'
  if (action === 'uploadAll' && model.image.pendingUploadCount === 0) return '没有待上传的本地图片'
  if (action === 'downloadAll' && model.image.pendingDownloadCount === 0) return '没有待下载的远程图片'
  if (action === 'dualLink' && model.image.referenceCount === 0) return '当前文档没有图片引用'
  return null
}
