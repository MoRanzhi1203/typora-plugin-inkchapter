/**
 * Paragraph Indent V2 — Delete 结构边界保护（纯函数，零 DOM 写入）。
 *
 * 场景：显式首行缩进（force-indent）的空段落 A，其后紧跟代码块 / 表格 /
 * 块级公式 / 独立图片 / HTML 块 / 水平分隔线 B。Typora 原生 Delete 在这种
 * 边界上会产生段落与结构块的交换/重排；本模块只负责“判定是否必须阻止”，
 * 阻止动作（preventDefault / 提示 / 审计）由服务层完成。
 *
 * 设计约束：
 *   - 只读：不修改 DOM、Selection、Sidecar 或 Markdown。
 *   - 只保护明确列出的结构块；标题 / 列表 / 引用 / 前置元数据保持原生边界语义。
 *   - 绝不以“非 P 元素”作为判定依据：未知容器一律放行，避免全局禁用 Delete。
 */

import { classifySemanticBlock } from './strict-document-validator'
import { resolveParagraphIndentEligibility, type ParagraphIndentIneligibleReason } from './paragraph-indent-eligibility'

export type ProtectedDeleteBlockKind = 'code' | 'table' | 'math' | 'image' | 'html' | 'hr'

const BLOCK_LABELS: Record<ProtectedDeleteBlockKind, string> = {
  code: '代码块',
  table: '表格',
  math: '块级公式',
  image: '图片',
  html: 'HTML 块',
  hr: '水平分隔线',
}

const BOM_AND_WHITESPACE = /[\s\uFEFF\u200B\u00A0]/g

function isVisuallyEmptyText(text: string): boolean {
  return text.replace(BOM_AND_WHITESPACE, '') === ''
}

function isRawHtmlBlock(el: HTMLElement): boolean {
  try {
    if (el.classList.contains('md-htmlblock') || el.classList.contains('md-html-block')) return true
    if (el.getAttribute('mdtype') === 'html') return true
    return el.getAttribute('data-type') === 'html'
  } catch {
    return false
  }
}

/**
 * 独立图片块：块内只有图片/题注等媒体，没有可见正文。
 * 带正文的 `text ![]()` 段落不算独立图片块（它仍可与空段落合法合并）。
 */
function isStandaloneImageBlock(el: HTMLElement): boolean {
  try {
    if (el.tagName === 'IMG') return true
    if (!el.querySelector('img')) return false
    return isVisuallyEmptyText(el.textContent ?? '')
  } catch {
    return false
  }
}

function isDisplayMathBlock(el: HTMLElement): boolean {
  try {
    if (el.classList.contains('md-math-block') || el.classList.contains('mathjax-block')) return true
    // A display formula owns its own block; inline math inside a text paragraph
    // is NOT a structural boundary.
    return el.querySelector('mjx-container[display="true"]') != null
  } catch {
    return false
  }
}

/**
 * 把“下一块”解析为受保护结构；null 表示允许原生 Delete。
 *
 * 明确放行：普通段落、标题、列表、引用、前置元数据、未知容器。
 */
export function classifyProtectedNextBlock(next: Element | null): ProtectedDeleteBlockKind | null {
  if (!next || !(next instanceof HTMLElement)) return null
  const tag = next.tagName.toUpperCase()

  if (tag === 'HR') return 'hr'
  if (tag === 'PRE' || next.classList.contains('md-fences') || next.classList.contains('md-codeblock')) return 'code'
  if (isDisplayMathBlock(next)) return 'math'
  if (tag === 'TABLE') return 'table'
  if (tag === 'FIGURE' && next.querySelector('table')) return 'table'
  if (isRawHtmlBlock(next)) return 'html'
  if (isStandaloneImageBlock(next)) return 'image'

  // Typora 可能给结构块加一层无公文语义的包装（figure / div）：只认唯一子块。
  const wrapper = next.firstElementChild
  if (wrapper && next.children.length === 1 && isVisuallyEmptyText(next.textContent ?? '')) {
    const wrapperTag = wrapper.tagName.toUpperCase()
    if (wrapperTag === 'PRE') return 'code'
    if (wrapperTag === 'TABLE') return 'table'
    if (wrapperTag === 'IMG') return 'image'
    if (wrapper.classList.contains('md-math-block')) return 'math'
  }

  const block = classifySemanticBlock(next)
  if (block.type === 'code') return 'code'
  if (block.type === 'table') return 'table'
  if (block.type === 'math' && isDisplayMathBlock(next)) return 'math'
  if (block.type === 'image' && isStandaloneImageBlock(next)) return 'image'
  return null
}

export function protectedDeleteBlockLabel(kind: ProtectedDeleteBlockKind): string {
  return BLOCK_LABELS[kind]
}

export type DeleteBoundaryDecisionReason =
  | 'ALLOW'
  | 'BLOCKED_STRUCTURAL_NEXT'
  | 'NOT_ELIGIBLE_PARAGRAPH'
  | 'NOT_EMPTY_PARAGRAPH'
  | 'NOT_FORCE_INDENT'
  | 'CARET_NOT_AT_END'
  | 'RANGE_SELECTION'
  | 'IME_COMPOSITION'

export interface DeleteBoundaryGuardInput {
  /** 当前正文段落（已由选区解析）。 */
  paragraph: HTMLElement | null
  /** 段落语义缩进模式（`data-inkchapter-indent-mode`，不是 CSS 效果）。 */
  indentMode: 'auto' | 'force-indent' | 'force-flush'
  /** 选区是否折叠。 */
  selectionCollapsed: boolean
  /** 光标是否位于段落逻辑末端。 */
  caretAtLogicalEnd: boolean
  /** 紧邻的下一块 DOM 元素。 */
  nextBlock: Element | null
  /** 是否处于 IME composition。 */
  composing: boolean
}

export interface DeleteBoundaryGuardDecision {
  blocked: boolean
  reason: DeleteBoundaryDecisionReason
  /** 被保护的结构块类型（blocked 时必有）。 */
  kind: ProtectedDeleteBlockKind | null
  /** 用户可见文案（blocked 时必有）。 */
  message: string | null
  /** 段落资格失败原因（诊断用）。 */
  ineligibleReason: ParagraphIndentIneligibleReason | null
}

function allow(reason: DeleteBoundaryDecisionReason, ineligibleReason: ParagraphIndentIneligibleReason | null = null): DeleteBoundaryGuardDecision {
  return { blocked: false, reason, kind: null, message: null, ineligibleReason }
}

/**
 * Delete 边界保护的唯一准入判定。所有条件必须同时满足才阻止。
 */
export function resolveDeleteBoundaryGuard(input: DeleteBoundaryGuardInput): DeleteBoundaryGuardDecision {
  if (input.composing) return allow('IME_COMPOSITION')
  if (!input.selectionCollapsed) return allow('RANGE_SELECTION')

  const paragraph = input.paragraph
  if (!paragraph) return allow('NOT_ELIGIBLE_PARAGRAPH')

  const eligibility = resolveParagraphIndentEligibility(paragraph)
  if (!eligibility.eligible) {
    return allow('NOT_ELIGIBLE_PARAGRAPH', eligibility.reason === 'ELIGIBLE' ? null : eligibility.reason)
  }

  if (!isVisuallyEmptyText(paragraph.textContent ?? '')) return allow('NOT_EMPTY_PARAGRAPH')
  if (input.indentMode !== 'force-indent') return allow('NOT_FORCE_INDENT')
  if (!input.caretAtLogicalEnd) return allow('CARET_NOT_AT_END')

  const kind = classifyProtectedNextBlock(input.nextBlock)
  if (!kind) return allow('ALLOW')

  return {
    blocked: true,
    reason: 'BLOCKED_STRUCTURAL_NEXT',
    kind,
    message: `无法向后合并：下一项为${protectedDeleteBlockLabel(kind)}`,
    ineligibleReason: null,
  }
}
