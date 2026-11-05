/**
 * 把当前 DOM 图片映射回 Markdown 中的唯一引用，并只替换目标地址。
 *
 * 身份策略：远程 URL / 本地绝对路径 + 同 URL 出现序号；绝不单独使用
 * alt、文件名或图号确定资产。替换只改 destination 范围，保留 alt、图号、
 * 图名与文档其它内容。
 */

import * as path from 'path'
import {
  parseMarkdownImageReferences,
  resolveImageDestination,
  type MarkdownImageReference,
} from './image-asset-model'
import { buildImageDestination } from '../heading-numbering/image-path-codec'

export type ReferenceSelectionReason =
  | 'NO_REFERENCE'
  | 'SHARED_REFERENCE_DEFINITION'
  | 'UNSUPPORTED_SYNTAX'

export interface ReferenceSelection {
  reference: MarkdownImageReference | null
  reason?: ReferenceSelectionReason
}

function normalizeLocal(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function candidatesFor(rawDestinations: Array<string | null | undefined>): string[] {
  return rawDestinations
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
}

/**
 * 选择当前图片对应的引用。
 * `occurrenceIndex` = 当前图片在“同一远程 URL/同一本地路径”的图片中的序号。
 */
export function selectMarkdownImageReference(input: {
  markdown: string
  documentPath: string
  rawDestinations: Array<string | null | undefined>
  occurrenceIndex: number
}): ReferenceSelection {
  const candidates = candidatesFor(input.rawDestinations)
  if (candidates.length === 0) return { reference: null, reason: 'NO_REFERENCE' }

  const references = parseMarkdownImageReferences(input.markdown, input.documentPath)
  const documentDir = path.dirname(input.documentPath)
  const matched = references.filter(reference => candidates.some(candidate => {
    if (reference.rawDestination === candidate) return true
    const resolved = resolveImageDestination(candidate, documentDir)
    if (resolved.remoteUrl && reference.resolved.remoteUrl === resolved.remoteUrl) return true
    if (resolved.fsPath && reference.resolved.fsPath
      && normalizeLocal(resolved.fsPath) === normalizeLocal(reference.resolved.fsPath)) return true
    return false
  }))
  if (matched.length === 0) return { reference: null, reason: 'NO_REFERENCE' }

  const index = Math.max(0, Math.min(input.occurrenceIndex, matched.length - 1))
  const reference = matched[index]
  if (reference.syntax === 'markdown-reference') {
    const shared = references.filter(item => item.destinationStart === reference.destinationStart)
    if (shared.length > 1) {
      return { reference: null, reason: 'SHARED_REFERENCE_DEFINITION' }
    }
  }
  return { reference }
}

/** 只替换 destination 范围；返回 null 表示范围不可用。 */
export function rewriteReferenceDestination(
  markdown: string,
  reference: MarkdownImageReference,
  newDestination: string,
): string | null {
  const start = reference.destinationStart
  const end = reference.destinationEnd
  if (start < 0 || end <= start || end > markdown.length) return null
  const destination = reference.syntax === 'html-img'
    ? newDestination
    : buildImageDestination(newDestination)
  return markdown.slice(0, start) + destination + markdown.slice(end)
}

/**
 * 引用改写的真实结果。
 *
 * `ALREADY_LINKED` 表示当前 Markdown 已经指向目标地址：此时 **不得** 重写正文
 * （否则会制造无意义的撤销步骤，并可能扰动 alt / 图名 / 图号）。
 */
export type ReferenceRewriteOutcome =
  | { kind: 'REWRITTEN'; markdown: string }
  | { kind: 'ALREADY_LINKED'; markdown: string }

/** 应用一次引用改写，并区分「已正确」与「真的改写」。 */
export function applyReferenceDestination(
  markdown: string,
  reference: MarkdownImageReference,
  newDestination: string,
): ReferenceRewriteOutcome | null {
  const next = rewriteReferenceDestination(markdown, reference, newDestination)
  if (next == null) return null
  return next === markdown
    ? { kind: 'ALREADY_LINKED', markdown }
    : { kind: 'REWRITTEN', markdown: next }
}

/** 生成 Markdown 可读相对路径（正斜杠）。 */
export function relativeMarkdownImagePath(documentPath: string, filePath: string): string {
  const relative = path.relative(path.dirname(documentPath), filePath).replace(/\\/g, '/')
  return relative || path.basename(filePath)
}
