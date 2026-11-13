/**
 * Document Diagnostics — ADJACENT BLANK-LINE POLICY MATRIX V1.
 *
 * THE PRODUCT CONTRACT (this round): the allowance between two adjacent content
 * blocks is decided by the PAIR of block kinds, never by one global threshold.
 *
 *   正文 → 正文            允许 1 个额外渲染空段落（只删减，不补齐）
 *   任意其他普通块组合       允许 0 个额外渲染空段落
 *   文档开头               允许 0 个
 *   文档末尾               恰好 1 个（由既有 EOF 规则负责）
 *
 * A RENDERED blank paragraph is the Typora editing structure the user really
 * sees. 1–2 Markdown source blank lines between two blocks are the required
 * structural separator and render as ZERO extra paragraphs; therefore the
 * policy always keeps `structuralSourceBlankLines = 1` when a source patch is
 * applied — a zero allowance never means "delete every source newline".
 *
 * This module is PURE: no DOM, no Markdown parsing, no rule registry. It is the
 * ONE authority the analyzer metadata, the publication decision, the Drawer
 * copy, the marker count and the fixer all read.
 */

export type BlankAdjacencyKind =
  | 'paragraph'
  | 'heading'
  | 'image'
  | 'code'
  | 'math'
  | 'table'
  | 'list'
  | 'quote'
  | 'other'

export type BlankBoundaryKind = BlankAdjacencyKind | 'document-start' | 'document-end'

export interface BlankAdjacencyPolicy {
  before: BlankBoundaryKind
  after: BlankBoundaryKind
  /** Extra RENDERED blank paragraphs allowed between the two blocks. */
  maxRenderedBlankLines: number
  /** The rendered count a repair aims for (never fills a missing blank). */
  repairTarget: number
  /** Only the document END may fill a missing blank; every other pair never does. */
  fillMissing: boolean
  /**
   * Source blank lines that are the structural Markdown separator. They render
   * as 0 extra paragraphs and must NEVER be removed by a blank-line repair.
   */
  structuralSourceBlankLines: number
}

const KIND_LABELS: Readonly<Record<BlankBoundaryKind, string>> = {
  paragraph: '正文',
  heading: '标题',
  image: '图片',
  code: '代码块',
  math: '公式块',
  table: '表格',
  list: '列表',
  quote: '引用块',
  other: '其他块',
  'document-start': '文档开头',
  'document-end': '文档末尾',
}

/**
 * Map the SOURCE scanner kind (and any legacy / unknown token) onto the policy
 * vocabulary. `formula` is the scanner's name for a display math block.
 */
export function toBlankAdjacencyKind(kind: string | null | undefined): BlankAdjacencyKind {
  switch (kind) {
    case 'paragraph': return 'paragraph'
    case 'heading': return 'heading'
    case 'image':
    case 'figure': return 'image'
    case 'code': return 'code'
    case 'math':
    case 'formula': return 'math'
    case 'table': return 'table'
    case 'list': return 'list'
    case 'quote':
    case 'blockquote': return 'quote'
    default: return 'other'
  }
}

export function blankAdjacencyLabel(kind: BlankBoundaryKind): string {
  return KIND_LABELS[kind] ?? '其他块'
}

/** The ONE matrix lookup. */
export function resolveAdjacentBlankPolicy(
  before: BlankBoundaryKind,
  after: BlankBoundaryKind,
): BlankAdjacencyPolicy {
  const base = { before, after, structuralSourceBlankLines: 1 }
  if (before === 'document-start') {
    return { ...base, maxRenderedBlankLines: 0, repairTarget: 0, fillMissing: false }
  }
  if (after === 'document-end') {
    return { ...base, maxRenderedBlankLines: 1, repairTarget: 1, fillMissing: true }
  }
  if (before === 'paragraph' && after === 'paragraph') {
    return { ...base, maxRenderedBlankLines: 1, repairTarget: 1, fillMissing: false }
  }
  return { ...base, maxRenderedBlankLines: 0, repairTarget: 0, fillMissing: false }
}

/** Convenience: the policy for two scanner / diagnostic kind tokens. */
export function resolveAdjacentBlankPolicyByKind(
  before: string | null | undefined,
  after: string | null | undefined,
): BlankAdjacencyPolicy {
  return resolveAdjacentBlankPolicy(toBlankAdjacencyKind(before), toBlankAdjacencyKind(after))
}

/** Does a measured VISIBLE count exceed the pair allowance? */
export function isRenderedBlankCountExcessive(
  visibleBlankLineCount: number,
  policy: BlankAdjacencyPolicy,
): boolean {
  return Math.max(0, Math.floor(visibleBlankLineCount)) > policy.maxRenderedBlankLines
}

/**
 * The ONE user-facing copy. It names the real block pair and states the pair's
 * own allowance, so a heading gap never claims "keep 1" any more.
 */
export function blankAdjacencyDetail(
  before: BlankBoundaryKind,
  after: BlankBoundaryKind,
  visibleBlankLineCount: number,
  policy: BlankAdjacencyPolicy = resolveAdjacentBlankPolicy(before, after),
): string {
  const n = Math.max(0, Math.floor(visibleBlankLineCount))
  if (before === 'document-start') {
    return `文档开头存在 ${n} 个额外空行，应清除为 0 个。`
  }
  if (after === 'document-end') {
    return `文档末尾存在 ${n} 个额外空行，应保留 1 个。`
  }
  if (policy.maxRenderedBlankLines === 1) {
    return `两个正文段落之间存在 ${n} 个额外空行，应保留 1 个。`
  }
  return `${blankAdjacencyLabel(before)}与${blankAdjacencyLabel(after)}之间存在 ${n} 个额外空行，应清除为 0 个。`
}
