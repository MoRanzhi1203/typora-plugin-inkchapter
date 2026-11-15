/**
 * R06-03 — TEST-VAULT ONLY blank-line acceptance harness.
 *
 * WHY: the fix chain used to be validated by pasting scripts into the DevTools
 * console. Any window-focus steal (Trae IDE / browser) made that impossible, so
 * the REAL editor path was never re-verified after a change. This module runs
 * the SAME business entry the 检测 panel button calls
 * (`DiagnosticFixController.startDiagnostic` / `startAllAuto`), from inside the
 * plugin, and records what the REAL Typora buffer did — including Undo/Redo.
 *
 * Safety contract (no new write path, no new fixer):
 *   - pure orchestration over injected ports; the fix planner, the editor
 *     transaction, the version guards and the re-diagnosis stay untouched;
 *   - nothing here can execute arbitrary JS or write arbitrary files;
 *   - the runner only exists when `resolveAcceptanceGate` says this is the
 *     dedicated acceptance document inside the repository's `test/vault`.
 */
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { fixMarkdownHash } from './document-diagnostic-fix-v1'

/** The three blank-line rules the fix chain owns. */
export const BLANK_LINE_ACCEPTANCE_RULE_CODES = [
  'EXCESSIVE_INTERNAL_BLANK_LINES',
  'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE',
  'DOCUMENT_LEADING_BLANK_LINES_EXCESSIVE',
] as const

const BLANK_LINE_RULE_SET: ReadonlySet<string> = new Set(BLANK_LINE_ACCEPTANCE_RULE_CODES)

export const ACCEPTANCE_DIR_IN_VAULT = 'runtime/acceptance'
export const ACCEPTANCE_DOCUMENT_IN_VAULT = `${ACCEPTANCE_DIR_IN_VAULT}/Blank-Line-R06-Runtime-Acceptance.md`
export const ACCEPTANCE_REQUEST_IN_VAULT = `${ACCEPTANCE_DIR_IN_VAULT}/acceptance-request.json`
export const ACCEPTANCE_REPORT_IN_VAULT = `${ACCEPTANCE_DIR_IN_VAULT}/acceptance-last-run.json`
export const ACCEPTANCE_DIR_RELATIVE_PATH = 'test/vault/runtime/acceptance'
export const ACCEPTANCE_DOCUMENT_RELATIVE_PATH = `test/vault/${ACCEPTANCE_DOCUMENT_IN_VAULT}`
export const ACCEPTANCE_REQUEST_RELATIVE_PATH = `test/vault/${ACCEPTANCE_REQUEST_IN_VAULT}`
export const ACCEPTANCE_REPORT_RELATIVE_PATH = `test/vault/${ACCEPTANCE_REPORT_IN_VAULT}`

export type AcceptanceGateReason =
  | 'ENABLED'
  | 'NOT_TEST_VAULT'
  | 'NOT_ACCEPTANCE_DOCUMENT'
  | 'NO_REQUEST_TOKEN'
  | 'ALREADY_RUN'

export interface AcceptanceGateInput {
  vaultRoot: string | null
  activeFilePath: string | null
  /** Token read from the run-request file; empty ⇒ no run requested. */
  requestToken: string | null
  /** Token of the last recorded report (idempotence guard). */
  lastReportToken: string | null
}

/** Forward slashes, no trailing slash, lower-case drive letter tolerance. */
export function normalizeGatePath(value: string): string {
  const unified = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return unified.replace(/^([a-zA-Z]):/, (m) => m.toLowerCase())
}

/**
 * The ONLY admission authority for the runtime acceptance harness.
 *
 * Requirements are conjunctive: a repository test vault, the dedicated
 * acceptance document, an explicit run token, and no report for that token yet.
 */
export function resolveAcceptanceGate(input: AcceptanceGateInput): {
  enabled: boolean
  reason: AcceptanceGateReason
} {
  const vault = input.vaultRoot ? normalizeGatePath(input.vaultRoot) : ''
  if (vault === '' || !vault.endsWith('/test/vault')) return { enabled: false, reason: 'NOT_TEST_VAULT' }
  const expected = `${vault}/${ACCEPTANCE_DOCUMENT_IN_VAULT}`
  const active = input.activeFilePath ? normalizeGatePath(input.activeFilePath) : ''
  if (active === '' || active !== expected) return { enabled: false, reason: 'NOT_ACCEPTANCE_DOCUMENT' }
  const token = (input.requestToken ?? '').trim()
  if (token === '') return { enabled: false, reason: 'NO_REQUEST_TOKEN' }
  if (input.lastReportToken != null && input.lastReportToken.trim() === token) {
    return { enabled: false, reason: 'ALREADY_RUN' }
  }
  return { enabled: true, reason: 'ENABLED' }
}

// ── evidence model ─────────────────────────────────────────────────────────

export interface LineDiffSummary {
  beforeLineCount: number
  afterLineCount: number
  /** First changed line (1-based) in the BEFORE document, null when identical. */
  changedStartLine: number | null
  changedEndLine: number | null
  removedLines: number
  addedLines: number
}

/**
 * Line-level diff summary for the evidence record. It never stores document
 * content: only counts and the changed range.
 */
export function summarizeLineDiff(before: string, after: string): LineDiffSummary {
  const a = before.split(/\r\n|\r|\n/)
  const b = after.split(/\r\n|\r|\n/)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++
  const removed = a.length - prefix - suffix
  const added = b.length - prefix - suffix
  return {
    beforeLineCount: a.length,
    afterLineCount: b.length,
    changedStartLine: removed === 0 && added === 0 ? null : prefix + 1,
    changedEndLine: removed === 0 && added === 0 ? null : prefix + removed,
    removedLines: removed,
    addedLines: added,
  }
}

/**
 * Source-shape summary of the AFTER text: terminal newline count and the sizes
 * of consecutive blank-line runs (structural separators are size 1). NO content.
 */
export function summarizeBlankSource(markdown: string): {
  trailingNewlines: number
  blankRuns: number[]
} {
  const trailingMatch = /\n+$/.exec(markdown)
  const trailingNewlines = trailingMatch ? trailingMatch[0].length : 0
  const blankRuns: number[] = []
  const re = /\n{2,}/g
  let match: RegExpExecArray | null = null
  while ((match = re.exec(markdown)) != null && blankRuns.length < 8) {
    // `\n{n}` between two non-empty lines = n-1 blank lines.
    blankRuns.push(match[0].length - 1)
  }
  return { trailingNewlines, blankRuns }
}

export interface AcceptanceAssertion {
  id: string
  ok: boolean
  detail: string
}

export interface AcceptanceDiagnosticFact {
  id: string
  code: string
  line: number | null
  targetIdentity: string | null
}

export interface AcceptanceStepEvidence {
  id: string
  label: string
  beforeHash: string
  afterHash: string
  beforeLineCount: number
  afterLineCount: number
  diff: LineDiffSummary
  /** Number of terminal newlines in the AFTER text (文末恰好 1 的验收证据). */
  afterTrailingNewlines: number
  /** Sizes of consecutive blank-line runs in the AFTER text (capped at 8 runs). */
  afterBlankRuns: number[]
  blankDiagnosticsBefore: number
  blankDiagnosticsAfter: number
  undoStackLengthBefore: number | null
  undoStackLengthAfter: number | null
  assertions: AcceptanceAssertion[]
}

export type AcceptanceVerdict = 'PASS' | 'FAIL' | 'UNEXECUTED'

export interface AcceptanceRunReport {
  schema: 'inkchapter.blank-line-acceptance/v1'
  requestToken: string
  startedAt: string
  finishedAt: string
  documentPath: string | null
  documentKey: string | null
  baselineHash: string
  baselineLineCount: number
  baselineDiagnostics: AcceptanceDiagnosticFact[]
  finalDiagnostics: AcceptanceDiagnosticFact[]
  finalMarkdownMatchesBaseline: boolean
  steps: AcceptanceStepEvidence[]
  failures: string[]
  /** Exceptions are recorded, never thrown to the caller. */
  error: string | null
  verdict: AcceptanceVerdict
  /** What this run proves, and what it does not. */
  scope: string
  undoApi: {
    available: boolean
    undoStackLengthStart: number | null
    undoStackLengthEnd: number | null
  }
}

// ── ports ──────────────────────────────────────────────────────────────────

export interface AcceptanceUndoResult {
  ok: boolean
  reason?: string
}

/**
 * Everything the runner may touch. `startFixOne` / `startFixAll` are the SAME
 * entries the 检测 panel buttons call; the runner never plans or writes itself.
 */
export interface AcceptanceHarnessPorts {
  readMarkdown(): string | null
  getDocumentKey(): string | null
  getSnapshot(): DocumentDiagnosticsSnapshot | null
  startFixOne(diagnosticId: string): void
  startFixAll(): void
  isBusy(): boolean
  undo(): AcceptanceUndoResult
  redo(): AcceptanceUndoResult
  undoStackLength(): number | null
  now(): number
  sleep(ms: number): Promise<void>
}

export interface AcceptanceRunOptions {
  requestToken: string
  documentPath: string | null
  /** Max wait for one fix transaction to settle. */
  settleTimeoutMs?: number
  /** Max wait for the baseline diagnostics snapshot. */
  baselineTimeoutMs?: number
}

const DEFAULT_SETTLE_TIMEOUT_MS = 8000
const DEFAULT_BASELINE_TIMEOUT_MS = 10000
const POLL_INTERVAL_MS = 60
const PUBLISH_SETTLE_MS = 160

function blankDiagnostics(snapshot: DocumentDiagnosticsSnapshot | null): DocumentDiagnostic[] {
  if (!snapshot) return []
  return snapshot.diagnostics.filter(d => BLANK_LINE_RULE_SET.has(d.code))
}

function diagnosticLines(diagnostics: readonly DocumentDiagnostic[]): AcceptanceDiagnosticFact[] {
  return diagnostics.map(d => ({
    id: d.id,
    code: d.code,
    line: d.location?.kind === 'source-range' ? d.location.startLine : null,
    targetIdentity: typeof d.targetIdentity === 'string' ? d.targetIdentity : null,
  }))
}

class AssertionLog {
  readonly items: AcceptanceAssertion[] = []

  check(id: string, ok: boolean, detail: string): void {
    this.items.push({ id, ok, detail })
  }

  get failures(): string[] {
    return this.items.filter(item => !item.ok).map(item => `${item.id}: ${item.detail}`)
  }
}

/**
 * Run the full acceptance scenario against the LIVE editor buffer:
 * baseline → single fix → undo → redo → undo → fix all → undo → redo → undo.
 *
 * Every step asserts on the actual Markdown text and the authoritative
 * re-diagnosis snapshot; a failed Undo/Redo is a FAIL, never a PASS.
 */
export async function runBlankLineAcceptanceScenarios(
  port: AcceptanceHarnessPorts,
  options: AcceptanceRunOptions,
): Promise<AcceptanceRunReport> {
  const startedAt = new Date().toISOString()
  const settleTimeout = options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS
  const baselineTimeout = options.baselineTimeoutMs ?? DEFAULT_BASELINE_TIMEOUT_MS
  const steps: AcceptanceStepEvidence[] = []
  const failures: string[] = []
  const documentKeyAtStart = safe(() => port.getDocumentKey())
  let error: string | null = null
  let baselineMarkdown = ''
  let baselineFacts: AcceptanceDiagnosticFact[] = []
  const undoStackStart = safe(() => port.undoStackLength())

  const waitUntil = async (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
    const deadline = port.now() + timeoutMs
    while (port.now() < deadline) {
      if (predicate()) return true
      await port.sleep(POLL_INTERVAL_MS)
    }
    return predicate()
  }

  const settle = async (): Promise<void> => {
    await port.sleep(PUBLISH_SETTLE_MS)
  }

  const recordStep = (
    id: string,
    label: string,
    before: string,
    after: string,
    beforeBlank: number,
    afterBlank: number,
    stackBefore: number | null,
    assertions: AssertionLog,
  ): void => {
    const sourceShape = summarizeBlankSource(after)
    steps.push({
      id,
      label,
      beforeHash: fixMarkdownHash(before),
      afterHash: fixMarkdownHash(after),
      beforeLineCount: before.split(/\r\n|\r|\n/).length,
      afterLineCount: after.split(/\r\n|\r|\n/).length,
      diff: summarizeLineDiff(before, after),
      afterTrailingNewlines: sourceShape.trailingNewlines,
      afterBlankRuns: sourceShape.blankRuns,
      blankDiagnosticsBefore: beforeBlank,
      blankDiagnosticsAfter: afterBlank,
      undoStackLengthBefore: stackBefore,
      undoStackLengthAfter: safe(() => port.undoStackLength()),
      assertions: [...assertions.items],
    })
    failures.push(...assertions.failures)
  }

  try {
    // ── baseline ───────────────────────────────────────────────────────────
    const ready = await waitUntil(() => {
      const key = safe(() => port.getDocumentKey())
      const snapshot = safe(() => port.getSnapshot())
      const markdown = safe(() => port.readMarkdown())
      return typeof markdown === 'string'
        && markdown !== ''
        && snapshot != null
        && key != null
        && snapshot.documentKey === key
    }, baselineTimeout)
    baselineMarkdown = safe(() => port.readMarkdown()) ?? ''
    const baselineSnapshot = safe(() => port.getSnapshot())
    const baselineBlank = blankDiagnostics(baselineSnapshot)
    baselineFacts = diagnosticLines(baselineBlank)
    const baseLog = new AssertionLog()
    baseLog.check('baseline.ready', ready, ready ? '诊断快照与当前文档一致' : '等待基线诊断快照超时')
    baseLog.check('baseline.markdown', baselineMarkdown !== '', '当前缓冲区可读')
    baseLog.check(
      'baseline.blank-count',
      baselineBlank.length >= 2,
      `基线空行诊断数量 ${baselineBlank.length}（需要 ≥2 才能验证单项与一键）`,
    )
    baseLog.check(
      'baseline.undo-stack',
      true,
      undoStackStart === null
        ? 'Typora 撤销栈不可直接读取（撤销/重做改由命令结果验证）'
        : `撤销栈长度 ${undoStackStart}`,
    )
    const baselineStep = new AssertionLog()
    baselineStep.items.push(...baseLog.items)
    recordStep(
      'baseline',
      '基线读取（不改写）',
      baselineMarkdown,
      baselineMarkdown,
      baselineBlank.length,
      baselineBlank.length,
      undoStackStart,
      baselineStep,
    )

    const firstTarget = baselineBlank[0] ?? null

    if (firstTarget) {
      // ── S1 single fix (the panel button entry) ───────────────────────────
      const s1 = new AssertionLog()
      const before = baselineMarkdown
      const stackBefore = safe(() => port.undoStackLength())
      port.startFixOne(firstTarget.id)
      const settled = await waitUntil(() => !safe(() => port.isBusy()), settleTimeout)
      await settle()
      const after = safe(() => port.readMarkdown()) ?? ''
      const afterBlank = blankDiagnostics(safe(() => port.getSnapshot()))
      s1.check('single.settled', settled, settled ? '修复事务已结束' : '修复事务超时未结束')
      s1.check('single.changed', after !== before, '单项修复应改变缓冲区')
      s1.check(
        'single.target-removed',
        !afterBlank.some(d => d.id === firstTarget.id),
        `目标诊断 ${firstTarget.id} 应消失`,
      )
      s1.check(
        'single.one-gap-only',
        afterBlank.length === baselineBlank.length - 1,
        `剩余空行诊断 ${afterBlank.length}（期望 ${baselineBlank.length - 1}）`,
      )
      recordStep('single-fix', '单项修复（检测面板「修复」同一入口）', before, after, baselineBlank.length, afterBlank.length, stackBefore, s1)

      const fixedOne = after

      // ── S2 undo ──────────────────────────────────────────────────────────
      const s2 = new AssertionLog()
      const undoResult = safeResult(() => port.undo())
      await settle()
      const afterUndo = safe(() => port.readMarkdown()) ?? ''
      s2.check('undo.api', undoResult.ok, undoResult.ok ? '撤销命令已执行' : `撤销失败：${undoResult.reason ?? 'UNKNOWN'}`)
      s2.check('undo.restores-baseline', afterUndo === baselineMarkdown, describeMarkdownMismatch(baselineMarkdown, afterUndo))
      recordStep('undo-single', 'Ctrl+Z 撤销单项修复', fixedOne, afterUndo, afterBlank.length, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s2)

      // ── S3 redo ──────────────────────────────────────────────────────────
      const s3 = new AssertionLog()
      const redoResult = safeResult(() => port.redo())
      await settle()
      const afterRedo = safe(() => port.readMarkdown()) ?? ''
      s3.check('redo.api', redoResult.ok, redoResult.ok ? '重做命令已执行' : `重做失败：${redoResult.reason ?? 'UNKNOWN'}`)
      s3.check('redo.reapplies-fix', afterRedo === fixedOne, describeMarkdownMismatch(fixedOne, afterRedo))
      recordStep('redo-single', 'Ctrl+Y 重做单项修复', afterUndo, afterRedo, blankDiagnostics(safe(() => port.getSnapshot())).length, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s3)

      // ── S4 back to baseline ──────────────────────────────────────────────
      const s4 = new AssertionLog()
      safeResult(() => port.undo())
      await settle()
      const backToBaseline = safe(() => port.readMarkdown()) ?? ''
      s4.check('reset.single-undo', backToBaseline === baselineMarkdown, describeMarkdownMismatch(baselineMarkdown, backToBaseline))
      const beforeResetBlank = blankDiagnostics(safe(() => port.getSnapshot())).length
      recordStep('reset-baseline', '再次撤销回到基线（为一键修复准备）', afterRedo, backToBaseline, beforeResetBlank, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s4)
    }

    // ── S5 fix all ─────────────────────────────────────────────────────────
    {
      const s5 = new AssertionLog()
      const before = safe(() => port.readMarkdown()) ?? ''
      const beforeBlank = blankDiagnostics(safe(() => port.getSnapshot()))
      const stackBefore = safe(() => port.undoStackLength())
      port.startFixAll()
      const settled = await waitUntil(() => !safe(() => port.isBusy()), settleTimeout)
      await settle()
      const after = safe(() => port.readMarkdown()) ?? ''
      const afterBlank = blankDiagnostics(safe(() => port.getSnapshot()))
      s5.check('all.settled', settled, settled ? '一键修复事务已结束' : '一键修复超时未结束')
      s5.check('all.changed', after !== before, '一键修复应改变缓冲区')
      s5.check('all.no-blank-diagnostics', afterBlank.length === 0, `剩余空行诊断 ${afterBlank.length}（期望 0）`)
      recordStep('fix-all', '一键修复全部安全空行诊断', before, after, beforeBlank.length, afterBlank.length, stackBefore, s5)

      const fixedAll = after
      const fixedAllCount = afterBlank.length

      // ── S6 undo fix-all ──────────────────────────────────────────────────
      const s6 = new AssertionLog()
      const undoResult = safeResult(() => port.undo())
      await settle()
      const afterUndo = safe(() => port.readMarkdown()) ?? ''
      s6.check('all-undo.api', undoResult.ok, undoResult.ok ? '撤销命令已执行' : `撤销失败：${undoResult.reason ?? 'UNKNOWN'}`)
      s6.check('all-undo.restores-baseline', afterUndo === baselineMarkdown, describeMarkdownMismatch(baselineMarkdown, afterUndo))
      recordStep('undo-all', 'Ctrl+Z 撤销一键修复', fixedAll, afterUndo, fixedAllCount, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s6)

      // ── S7 redo fix-all ─────────────────────────────────────────────────
      const s7 = new AssertionLog()
      const redoResult = safeResult(() => port.redo())
      await settle()
      const afterRedo = safe(() => port.readMarkdown()) ?? ''
      s7.check('all-redo.api', redoResult.ok, redoResult.ok ? '重做命令已执行' : `重做失败：${redoResult.reason ?? 'UNKNOWN'}`)
      s7.check('all-redo.reapplies-fix', afterRedo === fixedAll, describeMarkdownMismatch(fixedAll, afterRedo))
      recordStep('redo-all', 'Ctrl+Y 重做一键修复', afterUndo, afterRedo, blankDiagnostics(safe(() => port.getSnapshot())).length, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s7)

      // ── S8 restore baseline (fixture hygiene) ───────────────────────────
      const s8 = new AssertionLog()
      safeResult(() => port.undo())
      await settle()
      const restored = safe(() => port.readMarkdown()) ?? ''
      s8.check('restore.baseline', restored === baselineMarkdown, describeMarkdownMismatch(baselineMarkdown, restored))
      recordStep('restore-baseline', '撤销回到基线（验收夹具复位）', afterRedo, restored, 0, blankDiagnostics(safe(() => port.getSnapshot())).length, safe(() => port.undoStackLength()), s8)
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    failures.push(`exception: ${error}`)
  }

  const finalMarkdown = safe(() => port.readMarkdown()) ?? ''
  const verdict: AcceptanceVerdict = steps.length === 0
    ? 'UNEXECUTED'
    : (error == null && failures.length === 0 ? 'PASS' : 'FAIL')

  return {
    schema: 'inkchapter.blank-line-acceptance/v1',
    requestToken: options.requestToken,
    startedAt,
    finishedAt: new Date().toISOString(),
    documentPath: options.documentPath,
    documentKey: documentKeyAtStart,
    baselineHash: baselineMarkdown === '' ? '' : fixMarkdownHash(baselineMarkdown),
    baselineLineCount: baselineMarkdown === '' ? 0 : baselineMarkdown.split(/\r\n|\r|\n/).length,
    baselineDiagnostics: baselineFacts,
    finalDiagnostics: diagnosticLines(blankDiagnostics(safe(() => port.getSnapshot()))),
    finalMarkdownMatchesBaseline: finalMarkdown === baselineMarkdown,
    steps,
    failures,
    error,
    verdict,
    scope: '调用与检测面板「修复 / 一键修复」相同的业务入口；通过 Typora 自身的 undo/redo 命令验证撤销与重做；不模拟鼠标点击。',
    undoApi: {
      available: steps.some(step => step.assertions.some(a =>
        (a.id === 'undo.api' || a.id === 'all-undo.api') && a.ok))
        && steps.some(step => step.assertions.some(a =>
          (a.id === 'redo.api' || a.id === 'all-redo.api') && a.ok)),
      undoStackLengthStart: undoStackStart,
      undoStackLengthEnd: safe(() => port.undoStackLength()),
    },
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

function safeResult(fn: () => AcceptanceUndoResult): AcceptanceUndoResult {
  try {
    const result = fn()
    if (result == null || typeof result !== 'object') return { ok: false, reason: 'NO_RESULT' }
    return result
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'THREW' }
  }
}

/** Never leaks document content — only the first differing line index. */
function describeMarkdownMismatch(expected: string, actual: string): string {
  if (expected === actual) return '内容一致'
  const a = expected.split(/\r\n|\r|\n/)
  const b = actual.split(/\r\n|\r|\n/)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return `内容不一致：首个差异在第 ${i + 1} 行（期望 ${a.length} 行，实际 ${b.length} 行）`
}
