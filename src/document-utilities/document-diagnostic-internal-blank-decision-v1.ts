/**
 * Document Diagnostics — INTERNAL BLANK-LINE PUBLICATION DECISION V1
 * (`EXCESSIVE_INTERNAL_BLANK_LINES`).
 *
 * THE BUSINESS CONTRACT (this round's root cause):
 *
 *   正常编辑模式（WYSIWYG）下，内部空行过多检测 **必须以可视空行数为判断依据**：
 *     visibleBlankLineCount <= passMaxBlankLines(1) → 不发布该诊断
 *     visibleBlankLineCount >= warningThreshold(2)  → 发布警告，且数量 = 可视数
 *
 * 为什么必须换轴：Typora 会把 N 个连续的 **源码** 空行折叠成更少的 **可视** 空行
 * （DOM `<p>` 重合）。旧实现直接用 `sourceBlankLineCount >= 2` 判定，于是
 * source=4 / visible=1 的文档会被错误地报「连续空行过多」。源码数量仍然保留，但
 * 只服务于 Markdown 源码解析、位置映射与调试，**绝不** 直接决定正常编辑模式的告警。
 *
 * DATA SOURCE SPLIT (never mixed):
 *   - WYSIWYG  → the measured VISIBLE blank-line bands (`visibleBlankLineCount`).
 *   - source   → every raw source line is directly visible, so the VISIBLE count IS
 *                the source blank-line count (a DISTINCT data source, not a guess).
 *   - unknown  → the mode cannot be proven; the visible count is NOT guessed.
 *
 * 不可测量时（unknown / RUNTIME_UNAVAILABLE）**不猜测** 可视空行数：不发布诊断。
 *
 * This module is PURE: mode detection reads the Document, the decision reads only
 * numbers. It never touches the DOM beyond the two well-known markers and never
 * owns Drawer / Active / carrier lifecycle state.
 */
import {
  EXCESSIVE_INTERNAL_BLANK_LINES_CODE,
  INTERNAL_BLANK_LINE_POLICY,
  type InternalBlankLinePolicy,
} from './document-diagnostic-internal-blank-lines-v1'

/** §7 — the editing-mode authority of the ONE internal blank-line rule. */
export type DocumentEditingMode = 'wysiwyg' | 'source' | 'unknown'

/**
 * §7 — Typora's source-code-mode marker. The community framework itself gates its
 * ribbon layout on `.typora-node.typora-sourceview-on`, so this is the sanctioned,
 * API-free signal that the WYSIWYG writing area is NOT the source of truth.
 */
export const TYPORA_SOURCE_VIEW_CLASS = 'typora-sourceview-on'

/** §7 — the runtime audit for one publication decision. */
export const INTERNAL_BLANK_DECISION_AUDIT_EVENT = 'DOCUMENT-INTERNAL-BLANK-LINE-DECISION-AUDIT'

/**
 * §7 — detect the effective editing mode. The ladder is:
 *   1. the source-view marker on `body` / `<html>` / any `.typora-node` → `source`;
 *   2. a connected `#write` business root → `wysiwyg`;
 *   3. otherwise → `unknown` (the runtime cannot prove a data source).
 */
export function detectDocumentEditingMode(doc: Document | null | undefined): DocumentEditingMode {
  if (doc == null) return 'unknown'
  const markers: Element[] = []
  if (doc.body) markers.push(doc.body)
  if (doc.documentElement) markers.push(doc.documentElement)
  try {
    for (const el of Array.from(doc.querySelectorAll('.typora-node'))) markers.push(el)
  } catch { /* a document without querySelector (defensive) → body/html only */ }
  if (markers.some(el => el.classList?.contains(TYPORA_SOURCE_VIEW_CLASS))) return 'source'
  const write = doc.getElementById('write')
  if (write != null && write.isConnected) return 'wysiwyg'
  return 'unknown'
}

export interface InternalBlankPublicationInput {
  mode: DocumentEditingMode
  /** The measured VISIBLE blank-line bands; null when the runtime cannot measure. */
  measuredVisibleBlankLineCount: number | null
  /** The source blank-line count — carried for the SOURCE mode, never a WYSIWYG decision input. */
  sourceBlankLineCount: number
  policy?: InternalBlankLinePolicy
}

export interface InternalBlankPublicationDecision {
  /** Whether the rule may be PUBLISHED at all (never merely hidden in the Drawer). */
  publish: boolean
  mode: DocumentEditingMode
  /** The visible blank-line count the decision used; null when it could not be proven. */
  visibleBlankLineCount: number | null
  /** The count the Drawer copy + the Active label must state; null when not published. */
  displayBlankLineCount: number | null
  reason: string
}

/**
 * §1/§2/§3 — the ONE publication decision. WYSIWYG REQUIRES a measured visible
 * count; source mode uses the source line count as the visible count; an unknown
 * mode (or an unmeasurable WYSIWYG count) is NEVER guessed → no publish.
 */
export function decideInternalBlankPublication(
  input: InternalBlankPublicationInput,
): InternalBlankPublicationDecision {
  const policy = input.policy ?? INTERNAL_BLANK_LINE_POLICY
  const source = Math.max(0, Math.floor(input.sourceBlankLineCount))

  let visible: number | null = null
  let dataSource: 'RENDERED_VISIBLE_BANDS' | 'SOURCE_LINES_VISIBLE' | 'UNMEASURABLE'
  if (input.mode === 'wysiwyg') {
    visible = input.measuredVisibleBlankLineCount == null
      ? null
      : Math.max(0, Math.floor(input.measuredVisibleBlankLineCount))
    dataSource = visible == null ? 'UNMEASURABLE' : 'RENDERED_VISIBLE_BANDS'
  } else if (input.mode === 'source') {
    visible = source
    dataSource = 'SOURCE_LINES_VISIBLE'
  } else {
    dataSource = 'UNMEASURABLE'
  }

  if (visible == null) {
    return {
      publish: false,
      mode: input.mode,
      visibleBlankLineCount: null,
      displayBlankLineCount: null,
      reason: `VISIBLE_UNMEASURABLE_${dataSource}`,
    }
  }
  if (visible < policy.warningThreshold) {
    return {
      publish: false,
      mode: input.mode,
      visibleBlankLineCount: visible,
      displayBlankLineCount: null,
      reason: `VISIBLE_WITHIN_ALLOWANCE_${dataSource}`,
    }
  }
  return {
    publish: true,
    mode: input.mode,
    visibleBlankLineCount: visible,
    displayBlankLineCount: visible,
    reason: `VISIBLE_EXCESSIVE_${dataSource}`,
  }
}

/**
 * §3/§9 — the Drawer copy for a PUBLISHED rule. It states the VISIBLE blank-line
 * count (the number the decision was made on and the number the user really sees),
 * never the raw source count — a source count must never impersonate the visible
 * view. The `source` is available in the record metadata for source parsing /
 * position mapping / debugging, but it is not presented as the displayed quantity.
 */
export function internalBlankLineVisibleDetail(visibleBlankLineCount: number): string {
  const n = Math.max(0, Math.floor(visibleBlankLineCount))
  return `当前两个内容块之间存在 ${n} 个可视连续空行，建议压缩为 1 个空行。`
}

/** §9 — the metadata key carrying the source count for parsing / mapping / debug. */
export const INTERNAL_BLANK_SOURCE_COUNT_META_KEY = 'sourceBlankLineCount'
/** §9 — the metadata key carrying the published (visible) count. */
export const INTERNAL_BLANK_PUBLISHED_COUNT_META_KEY = 'publishedBlankLineCount'
/** §9 — the metadata key carrying the editing mode the decision ran in. */
export const INTERNAL_BLANK_DECISION_MODE_META_KEY = 'blankLineDecisionMode'

/** §9 — the redefined runtime-consistency gate labels (all must stay 0). */
export const INTERNAL_BLANK_DECISION_GATE_KEYS = [
  /** A source count was used as the WYSIWYG publication decision. */
  'sourceCountUsedAsVisibleDecision',
  /** A visible count was invented while the runtime could not measure it. */
  'visibleCountGuessedWhenUnmeasurable',
  /** The rule was published while the visible count was within the allowance. */
  'diagnosticPublishedWithinAllowance',
  /** A drop left the diagnostic in the snapshot / counts / Active state. */
  'droppedDiagnosticRetained',
  /** A result computed in the OTHER editing mode was reused after a switch. */
  'crossModeResultReused',
  /** A Drawer / Active label stated the source count as the displayed count. */
  'sourceCountStatedAsDisplayedCount',
] as const

export type InternalBlankDecisionGateKey = typeof INTERNAL_BLANK_DECISION_GATE_KEYS[number]

export function createInternalBlankDecisionGates(): Record<InternalBlankDecisionGateKey, number> {
  const out = {} as Record<InternalBlankDecisionGateKey, number>
  for (const k of INTERNAL_BLANK_DECISION_GATE_KEYS) out[k] = 0
  return out
}

export function formatInternalBlankDecisionGateReport(
  counters: Readonly<Record<string, number>>,
): string[] {
  return INTERNAL_BLANK_DECISION_GATE_KEYS.map(k => `${k}=${counters[k] ?? 0}`)
}

export function evaluateInternalBlankDecisionGates(
  counters: Readonly<Record<string, number>>,
): { decision: 'PASS' | 'FAIL'; failCount: number; failing: string[] } {
  const failing = INTERNAL_BLANK_DECISION_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failCount: failing.length,
    failing: [...failing],
  }
}

/** §9 — the POSITIVE runtime coverage the closure needs (min values, never fatal). */
export const INTERNAL_BLANK_DECISION_COVERAGE_KEYS = [
  /** A decision ran on a visible count. */
  'INTERNAL_BLANK_LINE_VISIBLE_DECISION_COUNT',
  /** The rule was SUPPRESSED because the visible count was within the allowance. */
  'INTERNAL_BLANK_LINE_VISIBLE_SUPPRESSED_COUNT',
  /** The rule was PUBLISHED because the visible count was excessive. */
  'INTERNAL_BLANK_LINE_VISIBLE_PUBLISHED_COUNT',
  /** A decision ran in SOURCE mode (source lines are the visible data source). */
  'INTERNAL_BLANK_LINE_SOURCE_MODE_DECISION_COUNT',
  /** A mode switch re-evaluated the decision against the retained raw snapshot. */
  'INTERNAL_BLANK_LINE_MODE_RE_EVALUATED_COUNT',
] as const

export type InternalBlankDecisionCoverageKey = typeof INTERNAL_BLANK_DECISION_COVERAGE_KEYS[number]

export function createInternalBlankDecisionCoverage(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of INTERNAL_BLANK_DECISION_COVERAGE_KEYS) out[k] = 0
  return out
}

export function formatInternalBlankDecisionCoverageReport(
  counters: Readonly<Record<string, number>>,
): string[] {
  return INTERNAL_BLANK_DECISION_COVERAGE_KEYS.map(k => `${k}=${counters[k] ?? 0}`)
}

/** §9 — the ONE rule code this module decides (re-exported for callers). */
export const INTERNAL_BLANK_DECISION_RULE_CODE = EXCESSIVE_INTERNAL_BLANK_LINES_CODE
