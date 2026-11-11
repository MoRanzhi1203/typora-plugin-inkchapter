/**
 * Diagnostic fix controller — the ONE orchestration authority between the
 * detection panel and the editor.
 *
 * Flow (never shortened):
 *   capability → plan (fresh Markdown) → real diff preview → user confirm
 *   → verified editor transaction → authoritative re-diagnosis → report.
 *
 * Invariants:
 *   - nothing is written before the user presses 确认修复;
 *   - plans are RE-BUILT from the live buffer at confirm time, so a patch can
 *     never be applied to a stale base;
 *   - a write is never reported as "fixed": only the NEW diagnostics snapshot
 *     decides `VERIFIED_FIXED` / `CHANGED_BUT_PERSISTS`;
 *   - a document switch / lock / duplicate submit cancels or rejects the plan.
 */
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  buildFixedMarkdown,
  classifyFixOutcome,
  createEditorFixTransactionAdapter,
  describeFixCapability,
  formatFixOutcome,
  planAllAutoFixesV2,
  planDiagnosticFixV2,
  planFixesForRuleV2,
  selectNonConflictingPlans,
  type EditorFixTransactionAdapter,
  type FixOutcome,
  type FixPlanV2,
} from './document-diagnostic-fix-v2'
import type { FixPanelHandlers, FixPanelPreviewState, FixPanelState } from './document-diagnostic-fix-panel'
import { fixMarkdownHash, type FixContext } from './document-diagnostic-fix-v1'

export interface CaptionNameRequest {
  kind: 'code' | 'table'
  targetIdentity: string
  name: string
  element: HTMLElement | null
}

export interface DiagnosticFixEnvironment {
  getMarkdown(): string | null
  getDocumentKey(): string | null
  getSnapshot(): DocumentDiagnosticsSnapshot | null
  isLocked(): boolean
  applyMarkdown(next: string, expectedBefore: string): { ok: boolean; reason?: string }
  setCaptionName(request: CaptionNameRequest): { ok: boolean; reason?: string }
  /** Authoritative diagnostics recompute (uses the live editor structural read). */
  recheck(): void
  notify(message: string, kind: 'info' | 'error'): void
  getCaptionElement?(diagnostic: DocumentDiagnostic): HTMLElement | null
  /**
   * SAFETY — true when the editor's STRUCTURAL Markdown serializer (not the
   * incremental typing mirror) produced the source we plan against. A degraded
   * read can omit blank-line structure, so a whole-document reload would risk
   * dropping content: source-patch fixes are refused instead.
   * Absent = legacy/test caller (treated as verified).
   */
  isSourceVerified?(): boolean
  /** Test hook — defaults to setTimeout. */
  schedule?(fn: () => void, delayMs: number): void
}

export interface DiagnosticFixUi {
  renderFixPanel(state: FixPanelState, handlers: FixPanelHandlers): void
  closeFixPanel(): void
}

export type FixRequest =
  | { kind: 'one'; diagnosticId: string }
  | { kind: 'rule'; code: string }
  | { kind: 'all' }

interface PreparedRequest {
  request: FixRequest
  inputValue: string
  /** Snapshot identity the user started from (documentKey guard). */
  documentKey: string
  markdownHashAtOpen: string
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  NO_CHANGE: '没有可应用的修改。',
  STALE_DOCUMENT: '文档已切换，修复已取消。',
  STALE_SOURCE: '正文已变化，请重新检测后再修复。',
  WRITE_REJECTED: '编辑器拒绝了本次写入。',
  READBACK_MISMATCH: '写回校验失败：编辑器内容与预期不一致。',
}

export class DiagnosticFixController {
  private readonly adapter: EditorFixTransactionAdapter
  private prepared: PreparedRequest | null = null
  private busy = false
  private generation = 0

  constructor(
    private readonly env: DiagnosticFixEnvironment,
    private readonly ui: DiagnosticFixUi,
  ) {
    this.adapter = createEditorFixTransactionAdapter({
      readMarkdown: () => this.env.getMarkdown(),
      getDocumentKey: () => this.env.getDocumentKey(),
      applyMarkdown: (next, expectedBefore) => this.env.applyMarkdown(next, expectedBefore),
    })
  }

  isBusy(): boolean {
    return this.busy
  }

  hasPendingRequest(): boolean {
    return this.prepared != null
  }

  /** Cancel any pending plan (document switch / tab change / Esc). */
  cancel(): void {
    this.generation++
    this.prepared = null
    this.busy = false
    this.ui.closeFixPanel()
  }

  startDiagnostic(diagnosticId: string): void {
    this.begin({ kind: 'one', diagnosticId })
  }

  /** 同类修复 — every instance of ONE rule, planned and conflict-checked. */
  startRule(code: string): void {
    this.begin({ kind: 'rule', code })
  }

  /** 一键修复可处理项 — every AUTO_SAFE plan in the current snapshot. */
  startAllAuto(): void {
    this.begin({ kind: 'all' })
  }

  // ── start phase ──────────────────────────────────────────────────────────

  private begin(request: FixRequest): void {
    if (this.busy) return
    if (this.env.isLocked()) {
      this.env.notify('文档已锁定：请先解锁再修复正文。', 'error')
      return
    }
    const documentKey = this.env.getDocumentKey()
    const snapshot = this.env.getSnapshot()
    const markdown = this.env.getMarkdown()
    if (!documentKey || !snapshot || snapshot.documentKey !== documentKey || markdown == null) {
      this.env.notify('当前没有可修复的文档检测结果。', 'error')
      return
    }
    const targets = this.collectDiagnostics(request, snapshot)
    if (targets.length === 0) {
      this.env.notify('没有找到可修复的诊断（可能已过期，请重新检测）。', 'error')
      return
    }
    const capability = describeFixCapability(targets[0].code, this.captionAvailable())
    if (capability.capability === 'UNAVAILABLE') {
      this.env.notify('该诊断暂不支持自动修复，请使用「定位」查看原因。', 'error')
      return
    }
    this.generation++
    this.prepared = {
      request,
      inputValue: '',
      documentKey,
      markdownHashAtOpen: fixMarkdownHash(markdown),
    }
    if (capability.requiresInput) {
      this.renderInput(capability.requiresInput.label, capability.requiresInput.placeholder, null)
      return
    }
    // AUTO_SAFE fixes always write the whole document back: refuse when the
    // structural serializer is unavailable (the typing mirror may be missing
    // blank-line structure, so the reload could drop content).
    if (!this.sourceVerified()) {
      this.env.notify('当前文档结构读取未验证，已取消自动修复；请稍后重试。', 'error')
      this.cancel()
      return
    }
    this.planAndPreview()
  }

  private collectDiagnostics(
    request: FixRequest,
    snapshot: DocumentDiagnosticsSnapshot,
  ): DocumentDiagnostic[] {
    if (request.kind === 'one') {
      const found = snapshot.diagnostics.filter(d => d.id === request.diagnosticId)
      return found
    }
    if (request.kind === 'rule') {
      return snapshot.diagnostics.filter(d => d.code === request.code)
    }
    return snapshot.diagnostics.filter(d => describeFixCapability(d.code, this.captionAvailable()).capability === 'AUTO_SAFE')
  }

  private captionAvailable(): boolean {
    try {
      return typeof this.env.setCaptionName === 'function'
    } catch {
      return false
    }
  }

  private sourceVerified(): boolean {
    try {
      return this.env.isSourceVerified?.() !== false
    } catch {
      return false
    }
  }

  private renderInput(label: string, placeholder: string | undefined, error: string | null): void {
    const generation = this.generation
    const state: FixPanelState = {
      phase: 'input',
      title: '逐项修复',
      description: `请输入${label}；确认后将先显示真实修改预览，再写回编辑器。`,
      label,
      placeholder,
      value: this.prepared?.inputValue ?? '',
      error,
      note: label.includes('语言')
        ? '只修改代码围栏的语言标识，不修改代码正文。'
        : '名称由现有题注/编号服务接管，不会重复编号。',
    }
    this.ui.renderFixPanel(state, {
      onInput: (value) => {
        if (generation !== this.generation) return
        if (this.prepared) this.prepared.inputValue = value
      },
      onConfirm: (value) => {
        if (generation !== this.generation) return
        const trimmed = String(value ?? '').trim()
        if (trimmed === '') {
          this.renderInput(label, placeholder, `${label}不能为空。`)
          return
        }
        if (this.prepared) this.prepared.inputValue = trimmed
        this.planAndPreview()
      },
      onCancel: () => this.cancel(),
    })
  }

  // ── planning / preview ───────────────────────────────────────────────────

  private buildContext(markdown: string, snapshot: DocumentDiagnosticsSnapshot, documentKey: string): FixContext {
    const capability = this.prepared
      ? describeFixCapability(this.currentCode(), this.captionAvailable())
      : null
    const field = capability?.requiresInput?.field
    return {
      markdown,
      snapshotMarkdown: markdown,
      documentKey,
      snapshot,
      locked: this.env.isLocked(),
      input: field === 'language'
        ? { language: this.prepared?.inputValue ?? '' }
        : { name: this.prepared?.inputValue ?? '' },
    }
  }

  private currentCode(): string {
    const prepared = this.prepared
    if (!prepared) return ''
    const snapshot = this.env.getSnapshot()
    const request = prepared.request
    if (request.kind === 'one') {
      return snapshot?.diagnostics.find(d => d.id === request.diagnosticId)?.code ?? ''
    }
    if (request.kind === 'rule') return request.code
    return ''
  }

  private planAll(
    markdown: string,
    snapshot: DocumentDiagnosticsSnapshot,
    documentKey: string,
  ): FixPlanV2[] {
    const prepared = this.prepared
    if (!prepared) return []
    const ctx = this.buildContext(markdown, snapshot, documentKey)
    const options = { captionAvailable: this.captionAvailable() }
    const request = prepared.request
    if (request.kind === 'one') {
      const diagnostic = snapshot.diagnostics.find(d => d.id === request.diagnosticId) ?? null
      return [planDiagnosticFixV2(diagnostic, ctx, options)]
    }
    if (request.kind === 'rule') {
      return planFixesForRuleV2(request.code, ctx, options)
    }
    return planAllAutoFixesV2(ctx, options)
  }

  private planAndPreview(): void {
    const prepared = this.prepared
    if (!prepared) return
    const documentKey = this.env.getDocumentKey()
    const snapshot = this.env.getSnapshot()
    const markdown = this.env.getMarkdown()
    if (!documentKey || documentKey !== prepared.documentKey || !snapshot || snapshot.documentKey !== documentKey || markdown == null) {
      this.env.notify('文档已切换，修复已取消。', 'error')
      this.cancel()
      return
    }
    if (this.env.isLocked()) {
      this.env.notify('文档已锁定：请先解锁再修复正文。', 'error')
      this.cancel()
      return
    }
    const plans = this.planAll(markdown, snapshot, documentKey)
    const { accepted, rejected } = selectNonConflictingPlans(plans)
    if (accepted.length === 0) {
      const reason = plans.flatMap(p => p.blockers).map(b => b.message)[0]
        ?? '当前没有可安全应用的修改。'
      const capability = describeFixCapability(this.currentCode(), this.captionAvailable())
      if (capability.requiresInput) {
        this.renderInput(capability.requiresInput.label, capability.requiresInput.placeholder, reason)
      } else {
        this.env.notify(reason, 'error')
        this.cancel()
      }
      return
    }
    this.renderPreview(accepted, rejected, false, null)
  }

  private renderPreview(
    accepted: readonly FixPlanV2[],
    rejected: readonly FixPlanV2[],
    busy: boolean,
    error: string | null,
  ): void {
    const prepared = this.prepared
    if (!prepared) return
    const captionPlans = accepted.filter(p => p.captionName != null)
    const patchPlans = accepted.filter(p => p.captionName == null)
    const hunks = patchPlans.flatMap(plan => plan.preview?.hunks ?? []).map(hunk => ({
      startLine: hunk.startLine,
      endLine: hunk.endLine,
      before: hunk.before,
      after: hunk.after,
    }))
    const parts: string[] = []
    if (patchPlans.length > 0) parts.push(`将修改源码 ${patchPlans.length} 处`)
    if (captionPlans.length > 0) parts.push(`将写入名称 ${captionPlans.length} 项`)
    if (rejected.length > 0) parts.push(`跳过 ${rejected.length} 项（冲突或不可用）`)
    const captionNames = captionPlans
      .filter(plan => plan.captionName != null)
      .map(plan => `${plan.captionName!.targetKind === 'code' ? '代码块' : '表格'} ${plan.captionName!.targetIdentity} → 「${prepared.inputValue}」`)
    const state: FixPanelPreviewState = {
      phase: 'preview',
      title: prepared.request.kind === 'all'
        ? '一键修复可处理项'
        : prepared.request.kind === 'rule' ? '同类修复' : '逐项修复',
      summary: parts.join(' · '),
      hunks,
      metadataOnly: patchPlans.length === 0 && captionPlans.length > 0,
      undoHint: patchPlans.length > 0
        ? '写回后可用 Ctrl+Z 一次撤销本批修改。'
        : '题注名称保存在墨章题注服务中；Markdown 正文不变。',
      busy,
      error,
      sameRule: prepared.request.kind === 'one' ? { count: this.sameRuleCount() } : null,
    }
    const generation = this.generation
    this.ui.renderFixPanel(state, {
      onConfirm: () => {
        if (generation !== this.generation || this.busy) return
        void this.confirmAndApply(accepted, captionNames)
      },
      onCancel: () => this.cancel(),
      onSameRule: () => {
        if (generation !== this.generation || this.busy) return
        this.switchToSameRule()
      },
    })
  }

  /** How many diagnostics of the CURRENT rule exist in the live snapshot. */
  private sameRuleCount(): number {
    const code = this.currentCode()
    if (code === '') return 0
    const snapshot = this.env.getSnapshot()
    return snapshot?.diagnostics.filter(d => d.code === code).length ?? 0
  }

  /**
   * 同类修复 — switch the prepared request from ONE diagnostic to its whole rule,
   * then re-plan/re-preview. Only rules with >1 instance ever expose the entry.
   */
  private switchToSameRule(): void {
    const prepared = this.prepared
    if (!prepared || prepared.request.kind !== 'one') return
    const code = this.currentCode()
    if (code === '' || this.sameRuleCount() < 2) return
    this.prepared = { ...prepared, request: { kind: 'rule', code } }
    this.planAndPreview()
  }

  // ── apply phase ──────────────────────────────────────────────────────────

  private async confirmAndApply(
    previewedPlans: readonly FixPlanV2[],
    captionNames: readonly string[],
  ): Promise<void> {
    const prepared = this.prepared
    if (!prepared || this.busy) return
    this.busy = true
    const generation = this.generation
    const beforeSnapshot = this.env.getSnapshot()
    const requestedIds = previewedPlans.map(p => p.diagnosticId)

    // Re-plan from the LIVE buffer: a stale base can never be written.
    const documentKey = this.env.getDocumentKey()
    const markdown = this.env.getMarkdown()
    const snapshot = this.env.getSnapshot()
    if (!documentKey || documentKey !== prepared.documentKey) {
      this.fail('STALE_DOCUMENT')
      return
    }
    if (this.env.isLocked()) {
      this.busy = false
      this.env.notify('文档已锁定：修复已取消。', 'error')
      this.cancel()
      return
    }
    if (!markdown || !snapshot || snapshot.documentKey !== documentKey) {
      this.fail('STALE_SOURCE')
      return
    }
    const plans = this.planAll(markdown, snapshot, documentKey)
    const { accepted } = selectNonConflictingPlans(plans)
    if (accepted.length === 0) {
      this.busy = false
      const reason = plans.flatMap(p => p.blockers).map(b => b.message)[0] ?? '修复计划已失效，请重新检测。'
      this.renderPreview(previewedPlans, [], false, reason)
      return
    }
    this.renderPreview(accepted, [], true, null)

    const captionPlans = accepted.filter(p => p.captionName != null)
    const patchPlans = accepted.filter(p => p.captionName == null)
    let sourceApplied = false

    if (patchPlans.length > 0 && !this.sourceVerified()) {
      this.busy = false
      const reason = '当前文档结构读取未验证，已取消修复；请稍后重试。'
      this.renderPreview(accepted, [], false, reason)
      this.env.notify(reason, 'error')
      return
    }

    if (patchPlans.length > 0) {
      const { next } = buildFixedMarkdown(markdown, patchPlans)
      const result = this.adapter.apply({
        documentKey,
        beforeMarkdown: markdown,
        afterMarkdown: next,
      })
      if (!result.ok) {
        this.busy = false
        const reason = REASON_TEXT[result.reason] ?? '修复未能写回编辑器。'
        this.renderPreview(accepted, [], false, reason)
        this.env.notify(reason, 'error')
        return
      }
      sourceApplied = true
    }

    let captionApplied = false
    for (const plan of captionPlans) {
      const action = plan.captionName
      if (!action) continue
      const diagnostic = snapshot.diagnostics.find(d => d.id === plan.diagnosticId) ?? null
      const element = diagnostic ? (this.env.getCaptionElement?.(diagnostic) ?? null) : null
      const outcome = this.env.setCaptionName({
        kind: action.targetKind,
        targetIdentity: action.targetIdentity,
        name: prepared.inputValue,
        element,
      })
      if (outcome.ok) captionApplied = true
      else if (!outcome.reason?.startsWith('NO_')) {
        this.busy = false
        this.renderPreview(accepted, [], false, `题注名称写入失败：${outcome.reason ?? 'UNKNOWN'}`)
        return
      }
    }

    if (!sourceApplied && !captionApplied) {
      this.busy = false
      this.renderPreview(accepted, [], false, '没有任何修复被实际应用。')
      return
    }

    this.env.recheck()
    if (captionNames.length > 0) {
      // Caption projection refresh may commit on the next frame.
      await this.waitFrame()
      this.env.recheck()
    }
    if (generation !== this.generation) return
    this.finish(requestedIds, beforeSnapshot, sourceApplied, 0)
  }

  private finish(
    requestedIds: readonly string[],
    beforeSnapshot: DocumentDiagnosticsSnapshot | null,
    sourceApplied: boolean,
    attempt: number,
  ): void {
    const after = this.env.getSnapshot()
    const outcome: FixOutcome = classifyFixOutcome({ requestedIds, before: beforeSnapshot, after })
    if (outcome.status === 'CHANGED_BUT_PERSISTS' && attempt < 3) {
      const schedule = this.env.schedule ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms) })
      schedule(() => {
        if (!this.prepared) return
        this.env.recheck()
        this.finish(requestedIds, beforeSnapshot, sourceApplied, attempt + 1)
      }, 60)
      return
    }
    this.busy = false
    const report = formatFixOutcome(outcome)
    this.env.notify(
      outcome.status === 'VERIFIED_FIXED' && sourceApplied
        ? `${report}（Ctrl+Z 可撤销）`
        : report,
      outcome.status === 'VERIFIED_FIXED' ? 'info' : 'error',
    )
    this.prepared = null
    this.ui.closeFixPanel()
  }

  private fail(reason: 'STALE_DOCUMENT' | 'STALE_SOURCE'): void {
    this.busy = false
    const message = REASON_TEXT[reason] ?? '修复失败。'
    this.env.notify(message, 'error')
    this.prepared = null
    this.ui.closeFixPanel()
  }

  private waitFrame(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
      else setTimeout(resolve, 0)
    })
  }
}
