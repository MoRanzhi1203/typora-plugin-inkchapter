/**
 * V5.1 — 当前文档图片批量操作（纯预检 / 计划，无 IO）。
 *
 * 约束：
 * - 预检只读：不创建目录、不下载、不上传、不改写 Markdown。
 * - 复用优先：已通过内容验证的本地/远程位置直接计入 reuse，不重复传输。
 * - 同名不等于同内容：只有调用方验证过的 `assetKnown` 才算复用。
 * - 执行由注入的服务完成，执行前必须经过用户确认。
 */

import type { ImageReferenceMode, ImageSettings } from './image-settings'

export type BatchReferenceKnowledge = 'local-verified' | 'remote-verified' | 'both' | 'unknown'

export interface BatchImageReference {
  rawDestination: string
  isRemote: boolean
  isLocal: boolean
  /** 本地目标是否存在（远程引用为 null；未检查为 null）。 */
  localExists: boolean | null
  /** 经过内容验证的资产知识（绝不按 URL/文件名猜测）。 */
  assetKnown: BatchReferenceKnowledge
}

export interface DocumentImageBatchInput {
  references: readonly BatchImageReference[]
  settings: Pick<ImageSettings, 'referenceMode' | 'uploadService' | 'autoUpload' | 'autoLocalizeOnInsert' | 'documentResourceDirectory'>
  /** 当前文档资源目录（已按三级 scope 解析）。 */
  projectDirectory: string | null
  /** 是否允许上传（上传服务可用且凭据就绪，由调用方判定）。 */
  uploadAvailable: boolean
}

export interface DocumentImageBatchPreview {
  totalReferences: number
  distinctDestinations: number
  localReferences: number
  remoteReferences: number
  /** 已验证可复用（本地或远程内容已验证）。 */
  reuseLocalCount: number
  reuseRemoteCount: number
  /** 真正需要传输的数量。 */
  pendingUploadCount: number
  pendingDownloadCount: number
  /** 本地目标缺失或无法解析。 */
  missingLocalCount: number
  /** 需要改写引用的数量（按当前引用模式）。 */
  rewriteCandidateCount: number
  /** 双链完整（本地 + 远程都已验证）的数量。 */
  dualLinkCompleteCount: number
  /** 预计需要创建的目录（相对路径）；预检绝不创建。 */
  directoriesToCreate: string[]
  /** 阻断原因；非空时执行必须被拒绝。 */
  blockedReasons: string[]
  /** 预览摘要（给确认弹窗使用）。 */
  summary: string
}

function uniq(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

/**
 * 生成批量操作预检。**纯函数**：任何目录列表都只是“将来可能需要创建”，
 * 预检本身不触碰文件系统。
 */
export function buildDocumentImageBatchPreview(input: DocumentImageBatchInput): DocumentImageBatchPreview {
  const refs = input.references
  const blocked: string[] = []
  let localReferences = 0
  let remoteReferences = 0
  let reuseLocalCount = 0
  let reuseRemoteCount = 0
  let pendingUploadCount = 0
  let pendingDownloadCount = 0
  let missingLocalCount = 0
  let rewriteCandidateCount = 0
  let dualLinkCompleteCount = 0

  for (const ref of refs) {
    if (ref.isRemote) {
      remoteReferences++
      if (ref.assetKnown === 'remote-verified' || ref.assetKnown === 'both') reuseRemoteCount++
      else pendingDownloadCount++
      if (ref.localExists === true) reuseLocalCount++
      if (ref.assetKnown === 'both') dualLinkCompleteCount++
      if (input.settings.referenceMode === 'local-relative') rewriteCandidateCount++
      continue
    }
    if (!ref.isLocal) continue
    localReferences++
    if (ref.localExists === false) {
      missingLocalCount++
      continue
    }
    if (ref.assetKnown === 'local-verified' || ref.assetKnown === 'both') reuseLocalCount++
    else pendingUploadCount++
    if (ref.assetKnown === 'both') dualLinkCompleteCount++
    if (input.settings.referenceMode === 'remote-url') rewriteCandidateCount++
  }

  if (pendingUploadCount > 0 && !input.uploadAvailable) {
    blocked.push('UPLOAD_UNAVAILABLE')
  }
  if (pendingDownloadCount > 0 && input.projectDirectory == null) {
    blocked.push('NO_PROJECT_DIRECTORY')
  }

  const directoriesToCreate = input.projectDirectory == null
    ? []
    : uniq(
      refs
        .filter(ref => (ref.isRemote ? input.settings.referenceMode === 'local-relative' : false))
        .map(() => input.settings.documentResourceDirectory),
    )

  const summaryParts = [
    `共 ${refs.length} 处引用`,
    `本地复用 ${reuseLocalCount}`,
    `远程复用 ${reuseRemoteCount}`,
    `待上传 ${pendingUploadCount}`,
    `待下载 ${pendingDownloadCount}`,
  ]
  if (missingLocalCount > 0) summaryParts.push(`本地缺失 ${missingLocalCount}`)
  if (rewriteCandidateCount > 0) summaryParts.push(`待改写 ${rewriteCandidateCount}`)
  if (dualLinkCompleteCount > 0) summaryParts.push(`双链完整 ${dualLinkCompleteCount}`)

  return {
    totalReferences: refs.length,
    distinctDestinations: new Set(refs.map(ref => ref.rawDestination)).size,
    localReferences,
    remoteReferences,
    reuseLocalCount,
    reuseRemoteCount,
    pendingUploadCount,
    pendingDownloadCount,
    missingLocalCount,
    rewriteCandidateCount,
    dualLinkCompleteCount,
    directoriesToCreate,
    blockedReasons: blocked,
    summary: summaryParts.join('；'),
  }
}

/** 执行是否允许：确认 + 无阻断 + 有实际工作。 */
export function canExecuteDocumentImageBatch(
  preview: DocumentImageBatchPreview,
  confirmed: boolean,
): { ok: boolean; reason?: 'NOT_CONFIRMED' | 'BLOCKED' | 'NOTHING_TO_DO' } {
  if (!confirmed) return { ok: false, reason: 'NOT_CONFIRMED' }
  if (preview.blockedReasons.length > 0) return { ok: false, reason: 'BLOCKED' }
  const work = preview.pendingUploadCount + preview.pendingDownloadCount + preview.missingLocalCount
  if (work === 0) return { ok: false, reason: 'NOTHING_TO_DO' }
  return { ok: true }
}

/** 当前图片配置的一句话摘要（面板使用）。 */
export function summarizeImagePolicy(settings: {
  referenceMode: ImageReferenceMode
  uploadService: ImageSettings['uploadService']
  autoUpload: boolean
  autoLocalizeOnInsert: boolean
}): string {
  const ref = settings.referenceMode === 'local-relative' ? '本地相对路径' : '远程 URL'
  const upload = settings.uploadService === 'github' ? 'GitHub 上传' : '不上传'
  const auto: string[] = []
  if (settings.autoUpload) auto.push('自动上传')
  if (settings.autoLocalizeOnInsert) auto.push('自动本地化')
  return `引用 ${ref} · ${upload} · 自动：${auto.length > 0 ? auto.join(' / ') : '关闭'}`
}
