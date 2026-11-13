/**
 * Diagnostic fix engine V2 — capability registry + production transaction
 * adapter + post-fix verification.
 *
 * V1 (`document-diagnostic-fix-v1`) proved the PURE planning half. V2 adds the
 * three pieces that make a fix REAL:
 *
 *   1. `describeFixCapability` — the honest per-rule capability matrix
 *      (`AUTO_SAFE` / `USER_INPUT_REQUIRED` / `MANUAL_ONLY` / `UNAVAILABLE`).
 *      A rule is only `AUTO_SAFE` when a patch can be built AND applied without
 *      a semantic choice (blank-line compression).
 *   2. `createEditorFixTransactionAdapter` — the ONLY production write path.
 *      It re-reads the live Markdown, refuses a stale base text, applies ONE
 *      whole-document `File.reloadContent` (Typora registers it as a single
 *      undo command), then reads the buffer back and proves the result.
 *   3. `classifyFixOutcome` — re-diagnosis is the ONLY success proof. A written
 *      patch is never reported as "fixed".
 *
 * No disk IO, no DOM writes and no `File` import live here: the Typora bridge
 * is injected (`MarkdownEditPort`) so the planner stays unit-testable.
 */
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  FIGURE_SYNTAX_IN_HEADING_CODE,
} from './document-figure-heading-invariant-v1'
import {
  FIGURE_UNCLOSED_DESTINATION_CODE,
  FIGURE_UNCLOSED_ALT_CODE,
} from './document-figure-syntax-integrity-v1'
import {
  CODE_LANGUAGE_FIX,
  FIGURE_BLOCK_STRUCTURE_INVALID_FIX,
  FIGURE_INLINE_FORMAT_FIX,
  FIGURE_IN_HEADING_FIX,
  FIGURE_SYNTAX_IN_HEADING_FIX,
  FIGURE_UNCLOSED_DESTINATION_FIX,
  FIGURE_UNCLOSED_ALT_FIX,
  FIGURE_EMPTY_SOURCE_FIX,
  FIGURE_IN_LIST_FIX,
  FIGURE_IN_QUOTE_FIX,
  FIGURE_MULTIPLE_SAME_BLOCK_FIX,
  FIGURE_NAME_FIX,
  FIGURE_TEXT_MIXED_FIX,
  FORMULA_SINGLE_LINE_BLOCK_FIX,
  INTERNAL_BLANK_LINES_FIX,
  LEADING_BLANK_LINES_FIX,
  LIST_EMPTY_ITEM_FIX,
  TERMINAL_NEWLINE_FIX,
  TRAILING_BLANK_LINES_FIX,
  applyPatchesToMarkdown,
  buildFixPreview,
  fixMarkdownHash,
  type DiagnosticFixPatch,
  type FixBlocker,
  type FixBlockerCode,
  type FixContext,
  type FixPlan,
  type FixPreview,
  type Fixer,
} from './document-diagnostic-fix-v1'

/**
 * `EXPLICIT_ONLY` — the repair exists and is safe, but it is a SEMANTIC CHOICE
 * (V2 §10.1: deleting an empty `![]()` placeholder), so it must never run as
 * part of the default one-click pass. The row keeps its own explicit action.
 */
export type FixCapability = 'AUTO_SAFE' | 'EXPLICIT_ONLY' | 'USER_INPUT_REQUIRED' | 'MANUAL_ONLY' | 'UNAVAILABLE'

export type FixActionKind = 'source-patches' | 'caption-name'

export interface FixInputDescriptor {
  field: 'name' | 'language'
  label: string
  placeholder?: string
}

export interface FixCapabilityDescriptor {
  code: string
  capability: FixCapability
  label: string
  actionKind: FixActionKind | null
  requiresInput?: FixInputDescriptor
  /** Caption-service target kind (code / table names are sidecar metadata). */
  captionTargetKind?: 'code' | 'table'
}

const CAPABILITY_MATRIX: Readonly<Record<string, FixCapabilityDescriptor>> = Object.freeze({
  EXCESSIVE_INTERNAL_BLANK_LINES: {
    code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
    capability: 'AUTO_SAFE',
    label: '压缩连续空行',
    actionKind: 'source-patches',
  },
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: {
    code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
    capability: 'AUTO_SAFE',
    label: '删除文末多余空行',
    actionKind: 'source-patches',
  },
  DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE: {
    code: 'DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE',
    capability: 'AUTO_SAFE',
    label: '删除文首多余空行',
    actionKind: 'source-patches',
  },
  DOCUMENT_TERMINAL_NEWLINE_MISSING: {
    code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING',
    capability: 'AUTO_SAFE',
    label: '补齐末尾换行',
    actionKind: 'source-patches',
  },
  LIST_EMPTY_ITEM: {
    code: 'LIST_EMPTY_ITEM',
    capability: 'AUTO_SAFE',
    label: '删除空列表项',
    actionKind: 'source-patches',
  },
  FORMULA_SINGLE_LINE_BLOCK: {
    code: 'FORMULA_SINGLE_LINE_BLOCK',
    capability: 'AUTO_SAFE',
    label: '拆成独立公式块',
    actionKind: 'source-patches',
  },
  FIGURE_BLOCK_STRUCTURE_INVALID: {
    code: 'FIGURE_BLOCK_STRUCTURE_INVALID',
    capability: 'AUTO_SAFE',
    label: '拆成独立图片块',
    actionKind: 'source-patches',
  },
  // V5.15 §8.2 — each classified structure issue owns its own real action.
  FIGURE_MULTIPLE_SAME_BLOCK: {
    code: 'FIGURE_MULTIPLE_SAME_BLOCK',
    capability: 'AUTO_SAFE',
    label: '拆分为独立图片段落',
    actionKind: 'source-patches',
  },
  FIGURE_TEXT_MIXED: {
    code: 'FIGURE_TEXT_MIXED',
    capability: 'AUTO_SAFE',
    label: '拆分图片与正文',
    actionKind: 'source-patches',
  },
  FIGURE_IN_LIST: {
    code: 'FIGURE_IN_LIST',
    capability: 'AUTO_SAFE',
    label: '移除图片列表格式',
    actionKind: 'source-patches',
  },
  FIGURE_IN_QUOTE: {
    code: 'FIGURE_IN_QUOTE',
    capability: 'AUTO_SAFE',
    label: '移除图片引用格式',
    actionKind: 'source-patches',
  },
  FIGURE_INLINE_FORMAT: {
    code: 'FIGURE_INLINE_FORMAT',
    capability: 'AUTO_SAFE',
    label: '移除图片行内格式',
    actionKind: 'source-patches',
  },
  FIGURE_IN_HEADING: {
    code: 'FIGURE_IN_HEADING',
    capability: 'AUTO_SAFE',
    label: '将图片移出标题',
    actionKind: 'source-patches',
  },
  FIGURE_SYNTAX_IN_HEADING: {
    code: FIGURE_SYNTAX_IN_HEADING_CODE,
    capability: 'AUTO_SAFE',
    label: '将图片语法移出标题',
    actionKind: 'source-patches',
  },
  // V3 — missing `)` / `]`: the repair only INSERTS one character at a proven
  // boundary; the URL / alt bytes are never rewritten.
  FIGURE_UNCLOSED_DESTINATION: {
    code: FIGURE_UNCLOSED_DESTINATION_CODE,
    capability: 'AUTO_SAFE',
    label: '补全图片链接括号',
    actionKind: 'source-patches',
  },
  FIGURE_UNCLOSED_ALT: {
    code: FIGURE_UNCLOSED_ALT_CODE,
    capability: 'AUTO_SAFE',
    label: '补全图片描述方括号',
    actionKind: 'source-patches',
  },
  // V2 §10.1 — an empty destination has NO reliable default resource: deletion
  // is a user CHOICE and must never be part of the default one-click pass.
  FIGURE_EMPTY_SOURCE: {
    code: 'FIGURE_EMPTY_SOURCE',
    capability: 'EXPLICIT_ONLY',
    label: '删除空图片占位符',
    actionKind: 'source-patches',
  },
  CODE_MISSING_LANGUAGE: {
    code: 'CODE_MISSING_LANGUAGE',
    capability: 'USER_INPUT_REQUIRED',
    label: '补充代码语言',
    actionKind: 'source-patches',
    requiresInput: { field: 'language', label: '代码语言', placeholder: 'python / ts / bash' },
  },
  FIGURE_MISSING_NAME: {
    code: 'FIGURE_MISSING_NAME',
    capability: 'USER_INPUT_REQUIRED',
    label: '补充图名',
    actionKind: 'source-patches',
    requiresInput: { field: 'name', label: '图名', placeholder: '系统架构' },
  },
  CODE_MISSING_NAME: {
    code: 'CODE_MISSING_NAME',
    capability: 'USER_INPUT_REQUIRED',
    label: '补充代码块名称',
    actionKind: 'caption-name',
    captionTargetKind: 'code',
    requiresInput: { field: 'name', label: '代码块名称', placeholder: '例如：初始化流程' },
  },
  TABLE_MISSING_NAME: {
    code: 'TABLE_MISSING_NAME',
    capability: 'USER_INPUT_REQUIRED',
    label: '补充表格名称',
    actionKind: 'caption-name',
    captionTargetKind: 'table',
    requiresInput: { field: 'name', label: '表格名称', placeholder: '例如：接口对照表' },
  },
})

const UNAVAILABLE: FixCapabilityDescriptor = Object.freeze({
  code: '',
  capability: 'UNAVAILABLE',
  label: '',
  actionKind: null,
})

/**
 * The ONE capability lookup. `captionAvailable=false` downgrades the two
 * caption-service rules to `UNAVAILABLE` instead of pretending a button works.
 */
export function describeFixCapability(code: string, captionAvailable = true): FixCapabilityDescriptor {
  const entry = CAPABILITY_MATRIX[code] ?? UNAVAILABLE
  if (entry.actionKind === 'caption-name' && !captionAvailable) {
    return { ...entry, capability: 'UNAVAILABLE' }
  }
  return entry
}

export function listFixCapabilities(captionAvailable = true): readonly FixCapabilityDescriptor[] {
  return Object.keys(CAPABILITY_MATRIX).map(code => describeFixCapability(code, captionAvailable))
}

// ── Planner V2 ─────────────────────────────────────────────────────────────

export interface CaptionNameAction {
  targetKind: 'code' | 'table'
  /** `block:<kind>:<ordinal>` — the canonical identity, never a line number. */
  targetIdentity: string
}

export interface FixPlanV2 {
  diagnosticId: string
  code: string
  capability: FixCapability
  label: string
  requiresInput?: FixInputDescriptor
  patches: readonly DiagnosticFixPatch[]
  captionName: CaptionNameAction | null
  blockers: readonly FixBlocker[]
  preview: FixPreview | null
  expected: {
    documentKey: string
    revision: number
    markdownHash: string
  }
  ok: boolean
}

function blocker(code: FixBlockerCode, message: string): FixBlocker {
  return { code, message }
}

function captionTargetOf(
  diagnostic: DocumentDiagnostic,
  kind: 'code' | 'table',
): CaptionNameAction | null {
  const candidates = [
    diagnostic.targetIdentity,
    diagnostic.location && 'stableIdentity' in diagnostic.location
      ? String(diagnostic.location.stableIdentity)
      : null,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = new RegExp(`^block:${kind}:(\\d+)$`).exec(candidate)
    if (match) return { targetKind: kind, targetIdentity: `block:${kind}:${match[1]}` }
  }
  return null
}

function validatePatches(markdown: string, patches: readonly DiagnosticFixPatch[]): FixBlocker[] {
  const out: FixBlocker[] = []
  for (const patch of patches) {
    if (!Number.isInteger(patch.start) || !Number.isInteger(patch.end)) {
      out.push(blocker('PATCH_OUT_OF_BOUNDS', '补丁偏移不是整数。'))
      continue
    }
    if (patch.start < 0 || patch.end < patch.start || patch.end > markdown.length) {
      out.push(blocker('PATCH_OUT_OF_BOUNDS', '补丁范围超出当前文档。'))
      continue
    }
    if (markdown.slice(patch.start, patch.end) !== patch.before) {
      out.push(blocker('STALE_SOURCE', '补丁的 before 与当前源不一致。'))
    }
  }
  return out
}

function buildPlanFromV1(
  plan: FixPlan,
  capability: FixCapability,
  requiresInput?: FixInputDescriptor,
): FixPlanV2 {
  return {
    diagnosticId: plan.diagnosticId,
    code: plan.code,
    capability,
    label: plan.label,
    requiresInput,
    patches: plan.patches,
    captionName: null,
    blockers: plan.blockers,
    preview: plan.preview,
    expected: plan.expected,
    ok: plan.ok,
  }
}

const V1_FIXERS: Readonly<Record<string, Fixer>> = Object.freeze({
  EXCESSIVE_INTERNAL_BLANK_LINES: INTERNAL_BLANK_LINES_FIX,
  DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE: LEADING_BLANK_LINES_FIX,
  DOCUMENT_TERMINAL_NEWLINE_MISSING: TERMINAL_NEWLINE_FIX,
  DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE: TRAILING_BLANK_LINES_FIX,
  LIST_EMPTY_ITEM: LIST_EMPTY_ITEM_FIX,
  FORMULA_SINGLE_LINE_BLOCK: FORMULA_SINGLE_LINE_BLOCK_FIX,
  FIGURE_BLOCK_STRUCTURE_INVALID: FIGURE_BLOCK_STRUCTURE_INVALID_FIX,
  FIGURE_MULTIPLE_SAME_BLOCK: FIGURE_MULTIPLE_SAME_BLOCK_FIX,
  FIGURE_TEXT_MIXED: FIGURE_TEXT_MIXED_FIX,
  FIGURE_IN_LIST: FIGURE_IN_LIST_FIX,
  FIGURE_IN_QUOTE: FIGURE_IN_QUOTE_FIX,
  FIGURE_INLINE_FORMAT: FIGURE_INLINE_FORMAT_FIX,
  FIGURE_IN_HEADING: FIGURE_IN_HEADING_FIX,
  FIGURE_SYNTAX_IN_HEADING: FIGURE_SYNTAX_IN_HEADING_FIX,
  FIGURE_UNCLOSED_DESTINATION: FIGURE_UNCLOSED_DESTINATION_FIX,
  FIGURE_UNCLOSED_ALT: FIGURE_UNCLOSED_ALT_FIX,
  FIGURE_EMPTY_SOURCE: FIGURE_EMPTY_SOURCE_FIX,
  CODE_MISSING_LANGUAGE: CODE_LANGUAGE_FIX,
  FIGURE_MISSING_NAME: FIGURE_NAME_FIX,
})

/** Plan ONE diagnostic with the V2 capability model. */
export function planDiagnosticFixV2(
  diagnostic: DocumentDiagnostic | null,
  ctx: FixContext,
  options: { captionAvailable?: boolean } = {},
): FixPlanV2 {
  const capability = describeFixCapability(diagnostic?.code ?? '', options.captionAvailable !== false)
  const base: FixPlanV2 = {
    diagnosticId: diagnostic?.id ?? '',
    code: diagnostic?.code ?? '',
    capability: capability.capability,
    label: capability.label,
    requiresInput: capability.requiresInput,
    patches: [],
    captionName: null,
    blockers: [],
    preview: null,
    expected: {
      documentKey: ctx.documentKey,
      revision: ctx.snapshot?.revision ?? 0,
      markdownHash: fixMarkdownHash(ctx.snapshotMarkdown ?? ctx.markdown),
    },
    ok: false,
  }
  const blockers: FixBlocker[] = []
  if (!diagnostic) {
    blockers.push(blocker('STALE_DIAGNOSTIC', '该诊断已不在最新快照中。'))
    return { ...base, blockers }
  }
  if (ctx.locked) blockers.push(blocker('DOCUMENT_LOCKED', '文档已锁定，不能修复。'))
  if (!ctx.snapshot || ctx.snapshot.documentKey !== ctx.documentKey) {
    blockers.push(blocker('STALE_DOCUMENT', '诊断快照不属于当前文档。'))
  }
  if (diagnostic.documentKey !== ctx.documentKey) {
    blockers.push(blocker('STALE_DOCUMENT', '诊断记录不属于当前文档。'))
  }
  if (ctx.expectedRevision != null && ctx.snapshot?.revision !== ctx.expectedRevision) {
    blockers.push(blocker('STALE_SOURCE', '诊断快照版本已过期。'))
  }
  if (ctx.snapshotMarkdown != null && fixMarkdownHash(ctx.snapshotMarkdown) !== fixMarkdownHash(ctx.markdown)) {
    blockers.push(blocker('STALE_SOURCE', '编辑器源已变化，请重新检测。'))
  }
  if (capability.capability === 'UNAVAILABLE') {
    blockers.push(blocker('NO_FIXER', '该诊断没有可用的修复器。'))
    return { ...base, blockers }
  }
  if (capability.requiresInput) {
    const value = capability.requiresInput.field === 'language' ? ctx.input?.language : ctx.input?.name
    if (value == null || String(value).trim() === '') {
      blockers.push(blocker('REQUIRES_INPUT', `需要提供${capability.requiresInput.label}。`))
    }
  }
  if (blockers.length > 0) return { ...base, blockers }

  if (capability.actionKind === 'caption-name') {
    const targetKind = capability.captionTargetKind
    const action = targetKind ? captionTargetOf(diagnostic, targetKind) : null
    if (!action) {
      blockers.push(blocker('INVALID_FACT', '无法解析该对象的规范化身份（block:<kind>:<n>）。'))
      return { ...base, blockers }
    }
    const name = String(ctx.input?.name ?? '').trim()
    if (name === '' || name.length > 200 || /[\r\n]/.test(name)) {
      blockers.push(blocker('REQUIRES_INPUT', '名称不能为空、不能超过 200 字或包含换行。'))
      return { ...base, blockers }
    }
    return { ...base, captionName: action, ok: true }
  }

  const fixer = V1_FIXERS[diagnostic.code]
  if (!fixer) {
    blockers.push(blocker('NO_FIXER', '该诊断没有可用的修复器。'))
    return { ...base, blockers }
  }
  const built = fixer.build(diagnostic, ctx)
  for (const b of built.blockers ?? []) blockers.push(b)
  const patches = built.patches ?? []
  for (const b of validatePatches(ctx.markdown, patches)) blockers.push(b)
  if (patches.length === 0 && blockers.length === 0) {
    blockers.push(blocker('NOT_APPLICABLE', '当前诊断没有可应用的源码修改。'))
  }
  return {
    ...base,
    patches,
    blockers,
    preview: patches.length > 0 ? buildFixPreview(ctx.markdown, patches) : null,
    ok: blockers.length === 0 && patches.length > 0,
  }
}

/** Plan every diagnostic of ONE rule (同类修复). */
export function planFixesForRuleV2(
  code: string,
  ctx: FixContext,
  options: { captionAvailable?: boolean } = {},
): FixPlanV2[] {
  const ids = (ctx.snapshot?.diagnostics ?? []).filter(d => d.code === code)
  return ids.map(d => planDiagnosticFixV2(d, ctx, options))
}

/**
 * §13.2 — dependency order of a batch repair: container structure first, then
 * composition (multiple images), then text mixing, then the generic fallback.
 * A lower number wins when two plans would patch the same bytes.
 */
const AUTO_FIX_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  FIGURE_IN_HEADING: 10,
  FIGURE_SYNTAX_IN_HEADING: 11,
  FIGURE_IN_LIST: 12,
  FIGURE_IN_QUOTE: 13,
  FIGURE_IN_TABLE: 14,
  FIGURE_MULTIPLE_SAME_BLOCK: 20,
  FIGURE_INLINE_FORMAT: 25,
  FIGURE_TEXT_MIXED: 30,
  FIGURE_BLOCK_STRUCTURE_INVALID: 40,
})

function autoFixPriorityOf(diagnostic: DocumentDiagnostic): number {
  return AUTO_FIX_PRIORITY[diagnostic.code] ?? 50
}

function diagnosticSourceStart(diagnostic: DocumentDiagnostic): number {
  const fromMeta = diagnostic.metadata?.['sourceStart']
  if (typeof fromMeta === 'number') return fromMeta
  const fromLocation = (diagnostic.location as { sourceStart?: unknown } | null)?.sourceStart
  return typeof fromLocation === 'number' ? fromLocation : Number.MAX_SAFE_INTEGER
}

/** Plan every AUTO_SAFE diagnostic (一键修复可处理项), in dependency order. */
export function planAllAutoFixesV2(
  ctx: FixContext,
  options: { captionAvailable?: boolean } = {},
): FixPlanV2[] {
  const autoCodes = new Set(
    listFixCapabilities(options.captionAvailable !== false)
      .filter(entry => entry.capability === 'AUTO_SAFE')
      .map(entry => entry.code),
  )
  const ids = (ctx.snapshot?.diagnostics ?? [])
    .filter(d => autoCodes.has(d.code))
    .slice()
    .sort((a, b) =>
      autoFixPriorityOf(a) - autoFixPriorityOf(b)
      || diagnosticSourceStart(a) - diagnosticSourceStart(b),
    )
  return ids.map(d => planDiagnosticFixV2(d, ctx, options))
}

/** Patches that can be applied together without touching the same source bytes. */
export function selectNonConflictingPlans(plans: readonly FixPlanV2[]): {
  accepted: FixPlanV2[]
  rejected: FixPlanV2[]
} {
  const accepted: FixPlanV2[] = []
  const rejected: FixPlanV2[] = []
  for (const plan of plans) {
    if (!plan.ok) { rejected.push(plan); continue }
    const overlapIndex = accepted.findIndex(other => patchesOverlap(other.patches, plan.patches))
    if (overlapIndex < 0) {
      accepted.push(plan)
      continue
    }
    // The plans arrive in dependency order, so the FIRST plan owns the bytes and
    // the later overlapping one is reported as a conflict. Re-diagnosis after the
    // write is what decides whether anything remains.
    rejected.push({
      ...plan,
      ok: false,
      blockers: [...plan.blockers, blocker('PATCH_CONFLICT', '与其他待修复项范围重叠。')],
    })
  }
  return { accepted, rejected }
}

function patchesOverlap(a: readonly DiagnosticFixPatch[], b: readonly DiagnosticFixPatch[]): boolean {
  for (const p of a) {
    for (const q of b) {
      if (p.start === p.end && q.start === q.end) {
        if (p.start === q.start) return true
      } else if (p.start < q.end && q.start < p.end) return true
    }
  }
  return false
}

/** Merge accepted plans into the ONE next document string. */
export function buildFixedMarkdown(
  markdown: string,
  plans: readonly FixPlanV2[],
): { next: string; patches: DiagnosticFixPatch[] } {
  const patches = plans.flatMap(plan => [...plan.patches])
  return { next: applyPatchesToMarkdown(markdown, patches), patches }
}

// ── Production transaction adapter ─────────────────────────────────────────

/**
 * The injected Typora bridge. `applyMarkdown` MUST be the verified editor
 * transaction (`File.reloadContent` — one undo entry), never `fs.writeFile`.
 */
export interface MarkdownEditPort {
  readMarkdown(): string | null
  /**
   * READBACK — the EXACT text mirror Typora reloaded. The structural serializer
   * is block-level and drops the document's terminal newline, so readback must
   * use the text mirror when the port can provide it.
   */
  readMarkdownExact?(): string | null
  getDocumentKey(): string | null
  /**
   * Apply the verified transaction. `expectedBefore` is the EXACT base the plan
   * was built from; a differing live buffer must be rejected (no blind write).
   */
  applyMarkdown(next: string, expectedBefore: string): { ok: boolean; reason?: string }
}

export interface FixApplyRequest {
  documentKey: string
  beforeMarkdown: string
  afterMarkdown: string
}

export interface FixApplyResult {
  ok: boolean
  reason:
    | 'APPLIED_AND_VERIFIED'
    | 'NO_CHANGE'
    | 'STALE_DOCUMENT'
    | 'STALE_SOURCE'
    | 'WRITE_REJECTED'
    | 'READBACK_MISMATCH'
  readBackMarkdown: string | null
}

export interface EditorFixTransactionAdapter {
  /** True when a real Typora range/reload transaction is wired. */
  readonly available: boolean
  apply(request: FixApplyRequest): FixApplyResult
}

/**
 * Production adapter: prove the base text, apply ONE editor transaction, read
 * the buffer back.
 *
 * Typora's `File.reloadContent(markdown, options)` registers a `reload`
 * undo command (`editor.undo.register`), so ONE Undo restores the previous
 * document. The adapter never writes disk and never touches `#write` directly.
 */
export function createEditorFixTransactionAdapter(port: MarkdownEditPort): EditorFixTransactionAdapter {
  return {
    available: true,
    apply(request) {
      if (request.afterMarkdown === request.beforeMarkdown) {
        return { ok: false, reason: 'NO_CHANGE', readBackMarkdown: null }
      }
      let currentKey: string | null = null
      try { currentKey = port.getDocumentKey() } catch { currentKey = null }
      if (currentKey !== request.documentKey) {
        return { ok: false, reason: 'STALE_DOCUMENT', readBackMarkdown: null }
      }
      let current: string | null = null
      try { current = port.readMarkdown() } catch { current = null }
      if (current !== request.beforeMarkdown) {
        return { ok: false, reason: 'STALE_SOURCE', readBackMarkdown: current }
      }
      let write: { ok: boolean; reason?: string }
      try {
        write = port.applyMarkdown(request.afterMarkdown, request.beforeMarkdown)
      } catch {
        write = { ok: false, reason: 'WRITE_THREW' }
      }
      if (!write.ok) {
        return { ok: false, reason: 'WRITE_REJECTED', readBackMarkdown: null }
      }
      let readBack: string | null = null
      try { readBack = (port.readMarkdownExact ?? port.readMarkdown).call(port) } catch { readBack = null }
      if (readBack !== request.afterMarkdown) {
        return { ok: false, reason: 'READBACK_MISMATCH', readBackMarkdown: readBack }
      }
      return { ok: true, reason: 'APPLIED_AND_VERIFIED', readBackMarkdown: readBack }
    },
  }
}

// ── Post-fix re-diagnosis (the ONLY success proof) ─────────────────────────

export type FixOutcomeStatus =
  | 'VERIFIED_FIXED'
  | 'CHANGED_BUT_PERSISTS'
  | 'SKIPPED_CONFLICT'
  | 'STALE'
  | 'LOCKED'
  | 'FAILED'

export interface FixOutcome {
  status: FixOutcomeStatus
  requestedIds: readonly string[]
  fixedIds: readonly string[]
  remainingIds: readonly string[]
  introducedIds: readonly string[]
}

/**
 * Compare the NEW authoritative snapshot against the requested diagnostics.
 * `null` after-snapshot = FAILED (never a success).
 */
export function classifyFixOutcome(input: {
  requestedIds: readonly string[]
  before: DocumentDiagnosticsSnapshot | null
  after: DocumentDiagnosticsSnapshot | null
}): FixOutcome {
  const requested = [...input.requestedIds]
  if (!input.before || !input.after) {
    return { status: 'FAILED', requestedIds: requested, fixedIds: [], remainingIds: requested, introducedIds: [] }
  }
  if (input.after.documentKey !== input.before.documentKey) {
    return { status: 'STALE', requestedIds: requested, fixedIds: [], remainingIds: requested, introducedIds: [] }
  }
  const afterIds = new Set(input.after.diagnostics.map(d => d.id))
  const beforeIds = new Set(input.before.diagnostics.map(d => d.id))
  const fixedIds = requested.filter(id => !afterIds.has(id))
  const remainingIds = requested.filter(id => afterIds.has(id))
  const introducedIds = [...afterIds].filter(id => !beforeIds.has(id)).sort()
  const status: FixOutcomeStatus = remainingIds.length === 0 ? 'VERIFIED_FIXED' : 'CHANGED_BUT_PERSISTS'
  return { status, requestedIds: requested, fixedIds, remainingIds, introducedIds }
}

/** Human-readable one-line report (UI toast / audit). */
export function formatFixOutcome(outcome: FixOutcome): string {
  if (outcome.status === 'VERIFIED_FIXED') {
    return `已修复 ${outcome.fixedIds.length} 项`
  }
  if (outcome.status === 'CHANGED_BUT_PERSISTS') {
    return `已修改，但仍有 ${outcome.remainingIds.length} 项诊断存在`
  }
  if (outcome.status === 'STALE') return '文档已切换，修复未应用'
  if (outcome.status === 'LOCKED') return '文档已锁定，修复未应用'
  if (outcome.status === 'SKIPPED_CONFLICT') return '修复项存在冲突，已跳过'
  return '修复失败：未能写回编辑器'
}
