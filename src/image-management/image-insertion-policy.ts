/**
 * 原生插入后的图片策略（V5.0）。
 *
 * 原则：**不替换 Typora 原生六种插入方式**，也不修改 Typora 首选项。
 * 插件只在 Markdown 出现「新增图片引用」后，按当前文档的生效配置决定
 * 是否接管（上传 / 本地化）。默认策略为 NONE，原生语义完全不变。
 *
 * 纯函数：不读盘、不联网；执行交给调用方（上传 / 下载服务）。
 */

import { parseImageSourceOccurrences, type ImageSourceOccurrence } from '../document-utilities/document-resource-scanner'
import type { ImageSettings } from './image-settings'

export type InsertionActionKind = 'NONE' | 'UPLOAD' | 'LOCALIZE'

export type InsertionReason =
  | 'DISABLED'
  | 'POLICY_OFF'
  | 'NOT_ELIGIBLE'
  | 'UPLOAD_ENABLED'
  | 'LOCALIZE_ENABLED'

export interface InsertionDecision {
  action: InsertionActionKind
  reason: InsertionReason
  rawDestination: string
  rawToken: string
}

function occurrenceKey(ref: ImageSourceOccurrence): string {
  return `${ref.rawDestination}\u0000${ref.rawToken}`
}

function countByKey(refs: readonly ImageSourceOccurrence[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ref of refs) {
    const key = occurrenceKey(ref)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * 对比前后 Markdown，返回真正新增的图片引用（按 token 内容计数，不受偏移变化影响）。
 * 同一 token 被删除再加回不会重复触发；真正多插入一张相同图片会被识别为新增。
 */
export function detectNewImageReferences(
  previousMarkdown: string | null,
  nextMarkdown: string | null,
): ImageSourceOccurrence[] {
  if (!nextMarkdown) return []
  const nextRefs = parseImageSourceOccurrences(nextMarkdown)
  if (nextRefs.length === 0) return []
  if (!previousMarkdown) return nextRefs
  const remaining = countByKey(parseImageSourceOccurrences(previousMarkdown))
  const added: ImageSourceOccurrence[] = []
  for (const ref of nextRefs) {
    const key = occurrenceKey(ref)
    const left = remaining.get(key) ?? 0
    if (left > 0) remaining.set(key, left - 1)
    else added.push(ref)
  }
  return added
}

/** 远程 URL（http/https）。 */
export function isRemoteImageDestination(destination: string): boolean {
  return /^https?:\/\//i.test((destination ?? '').trim())
}

/** Windows 绝对本地路径（盘符或 UNC）。 */
export function isAbsoluteLocalDestination(destination: string): boolean {
  const value = (destination ?? '').trim()
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value)
}

/**
 * 对「新增引用」做策略判定。
 *
 * - 远程 URL + 文档生效配置开启 `autoLocalizeOnInsert` + 引用模式为本地相对
 *   → LOCALIZE（下载到当前文档资源目录并改写引用）。
 * - 本地绝对路径 + 开启 `autoUpload` + 上传服务为 github
 *   → UPLOAD（上传后改写为远程 URL）。
 * - 其余一律 NONE，保持 Typora 原生结果。
 */
export function decideInsertionAction(input: {
  settings: ImageSettings
  reference: Pick<ImageSourceOccurrence, 'rawDestination' | 'rawToken'>
}): InsertionDecision {
  const base = {
    rawDestination: input.reference.rawDestination,
    rawToken: input.reference.rawToken,
  }
  if (!input.settings.enabled) {
    return { action: 'NONE', reason: 'DISABLED', ...base }
  }
  const destination = input.reference.rawDestination
  if (isRemoteImageDestination(destination)) {
    if (!input.settings.autoLocalizeOnInsert) {
      return { action: 'NONE', reason: 'POLICY_OFF', ...base }
    }
    if (input.settings.referenceMode !== 'local-relative') {
      return { action: 'NONE', reason: 'NOT_ELIGIBLE', ...base }
    }
    return { action: 'LOCALIZE', reason: 'LOCALIZE_ENABLED', ...base }
  }
  if (isAbsoluteLocalDestination(destination)) {
    if (!input.settings.autoUpload) {
      return { action: 'NONE', reason: 'POLICY_OFF', ...base }
    }
    if (input.settings.uploadService !== 'github') {
      return { action: 'NONE', reason: 'NOT_ELIGIBLE', ...base }
    }
    return { action: 'UPLOAD', reason: 'UPLOAD_ENABLED', ...base }
  }
  return { action: 'NONE', reason: 'NOT_ELIGIBLE', ...base }
}

/** 批量判定：新增引用 → 需要执行的动作（NONE 被过滤掉）。 */
export function planInsertionActions(input: {
  settings: ImageSettings
  previousMarkdown: string | null
  nextMarkdown: string | null
}): InsertionDecision[] {
  const added = detectNewImageReferences(input.previousMarkdown, input.nextMarkdown)
  return added
    .map(reference => decideInsertionAction({ settings: input.settings, reference }))
    .filter(decision => decision.action !== 'NONE')
}
