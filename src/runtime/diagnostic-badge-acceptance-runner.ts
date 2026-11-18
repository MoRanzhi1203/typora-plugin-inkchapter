/**
 * R14 — 正文诊断徽章 Runtime 验收（仅 test/vault）。
 *
 * 复用 R06/R11 的「请求 token → 插件内执行 → 固定报告路径」模式。验收对象是
 * 真实 Typora DOM：
 *   - 正文徽章的文案 / 严重级别 / 聚合数量 / tooltip / 行号
 *   - 徽章点击、`+N` 汇总点击、键盘 Enter
 *   - 中央检测面板的选中项与临时聚焦集合
 *   - 内容重置后旧徽章清理、恢复后重新渲染
 *   - 若存在 AUTO_SAFE 编号诊断：真实修复 → 徽章消失 → 撤销 → 徽章恢复
 *
 * 不做第二套检测：徽章的期望值全部来自插件当前发布的诊断快照。
 */
import * as fs from 'fs'
import * as path from 'path'
import type { DocumentDiagnosticsSnapshot } from '../document-utilities/diagnostics-types'
import {
  buildDiagnosticBadgeSet,
  formatDiagnosticBadgeTooltip,
  isGenericBadgeLabel,
  type DiagnosticBadge,
  type DiagnosticBadgeInput,
} from '../document-utilities/document-diagnostic-badge-v1'
import { shouldRenderReasonChip } from '../document-utilities/document-heading-diagnostic-marker-v5-12'
import { normalizeGatePath } from '../document-utilities/document-diagnostic-acceptance-harness-v1'

export const DIAGNOSTIC_BADGE_ACCEPTANCE_ENV = 'INKCHAPTER_DIAGNOSTIC_BADGE_ACCEPTANCE'
export const DIAGNOSTIC_BADGE_ACCEPTANCE_DOCUMENT_IN_VAULT = 'runtime/acceptance/DiagnosticBadges-R14-Runtime-Acceptance.md'
export const DIAGNOSTIC_BADGE_ACCEPTANCE_REQUEST_IN_VAULT = 'runtime/acceptance/diagnostic-badge-acceptance-request.json'
export const DIAGNOSTIC_BADGE_ACCEPTANCE_REPORT_IN_VAULT = 'runtime/acceptance/diagnostic-badge-acceptance-last-run.json'

/** R14 — only AUTO_SAFE heading-number fixes are used for the fix/undo proof. */
export const DIAGNOSTIC_BADGE_AUTO_FIX_CODES = [
  'HEADING_DOUBLE_NUMBER_PREFIX',
  'HEADING_NUMBER_ORDER_ANOMALY',
] as const

export interface BadgeAcceptanceBadgeFact {
  text: string
  severity: string
  diagnosticId: string
  kind: 'diagnostic' | 'summary'
  tooltip: string
}

export interface BadgeAcceptanceMarkerFact {
  identity: string
  headingText: string
  headingLine: number | null
  /** Every diagnostic the heading really owns (chip-eligible or not). */
  diagnosticIds: string[]
  badges: BadgeAcceptanceBadgeFact[]
}

export interface BadgeAcceptanceDrawerFact {
  open: boolean
  rows: Array<{ diagnosticId: string; selected: boolean; groupFocused: boolean }>
}

export interface BadgeAcceptanceDomFacts {
  markers: BadgeAcceptanceMarkerFact[]
  drawer: BadgeAcceptanceDrawerFact
  numberedHeadings: Array<{ text: string; number: string }>
}

export interface DiagnosticBadgeAcceptanceDeps {
  vaultRoot: string | null
  getActiveFilePath(): string | null
  getMarkdown(): string
  replaceContent(markdown: string): void
  readSnapshot(): DocumentDiagnosticsSnapshot | null
  readDomFacts(): BadgeAcceptanceDomFacts
  /** Real DOM click on a specific badge (same path a user click takes). */
  clickBadge(diagnosticId: string): boolean
  /** Real DOM click on this heading's `+N` summary badge. */
  clickSummary(headingIdentity: string): boolean
  /** Real keyboard event on a specific badge. */
  pressBadgeKey(diagnosticId: string, key: string): boolean
  fixDiagnostic(diagnosticId: string): boolean
  isFixBusy(): boolean
  /** Force one real diagnostics recompute (used after a native Undo). */
  recomputeDiagnostics?(): void
  undo(): { ok: boolean; reason?: string }
  redo(): { ok: boolean; reason?: string }
  wait(ms: number): Promise<void> | void
  subscribeFileOpen(callback: () => void): () => void
  log?(message: string): void
}

export interface BadgeAcceptanceAssertion {
  id: string
  ok: boolean
  detail: string
}

export interface BadgeAcceptanceStep {
  id: string
  label: string
  assertions: BadgeAcceptanceAssertion[]
}

export interface BadgeAcceptanceReport {
  schema: 'inkchapter.diagnostic-badge-acceptance/v1'
  requestToken: string
  startedAt: string
  finishedAt: string
  documentPath: string | null
  steps: BadgeAcceptanceStep[]
  markers: BadgeAcceptanceMarkerFact[]
  failures: string[]
  verdict: 'PASS' | 'FAIL' | 'UNEXECUTED'
  error: string | null
}

export function isDiagnosticBadgeAcceptanceRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[DIAGNOSTIC_BADGE_ACCEPTANCE_ENV] === '1'
  } catch {
    return false
  }
}

function reportFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, DIAGNOSTIC_BADGE_ACCEPTANCE_REPORT_IN_VAULT)
}

function requestFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, DIAGNOSTIC_BADGE_ACCEPTANCE_REQUEST_IN_VAULT)
}

interface AcceptanceRequest {
  token?: string
  document?: string
}

function readJsonFile<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return null }
}

function writeReport(vaultRoot: string, report: BadgeAcceptanceReport): void {
  try {
    fs.mkdirSync(path.dirname(reportFilePath(vaultRoot)), { recursive: true })
    fs.writeFileSync(reportFilePath(vaultRoot), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } catch { /* fail-open — the launcher reports TIMEOUT */ }
}

function badgeInputsForMarker(
  marker: BadgeAcceptanceMarkerFact,
  snapshot: DocumentDiagnosticsSnapshot | null,
): DiagnosticBadgeInput[] {
  const byId = new Map((snapshot?.diagnostics ?? []).map(d => [d.id, d]))
  const out: DiagnosticBadgeInput[] = []
  for (const id of marker.diagnosticIds) {
    const d = byId.get(id)
    if (!d) continue
    if (!shouldRenderReasonChip({ metadata: (d.metadata ?? {}) as Record<string, unknown>, code: d.code })) continue
    out.push({
      diagnosticId: d.id,
      code: d.code,
      severity: d.severity,
      message: d.message,
      detail: d.detail ?? null,
      category: d.category ?? null,
      metadata: (d.metadata ?? null) as Record<string, unknown> | null,
      line: marker.headingLine,
      headingText: marker.headingText,
      targetIdentity: d.targetIdentity ?? null,
    })
  }
  return out
}

function expectedBadgesForMarker(
  marker: BadgeAcceptanceMarkerFact,
  snapshot: DocumentDiagnosticsSnapshot | null,
): { visible: DiagnosticBadge[]; summaryLabel: string | null; allCount: number } {
  const set = buildDiagnosticBadgeSet(badgeInputsForMarker(marker, snapshot))
  return { visible: set.visible, summaryLabel: set.summary?.label ?? null, allCount: set.all.length }
}

function domBadgeSignature(badges: readonly BadgeAcceptanceBadgeFact[]): string {
  return badges.map(b => `${b.kind}:${b.diagnosticId}:${b.text}:${b.severity}`).join('|')
}

async function runAcceptance(
  deps: DiagnosticBadgeAcceptanceDeps,
  token: string,
): Promise<BadgeAcceptanceReport> {
  const startedAt = new Date().toISOString()
  const steps: BadgeAcceptanceStep[] = []
  const failures: string[] = []
  let markers: BadgeAcceptanceMarkerFact[] = []

  const push = (id: string, label: string, assertions: BadgeAcceptanceAssertion[]): void => {
    steps.push({ id, label, assertions })
    for (const a of assertions) if (!a.ok) failures.push(`${a.id}: ${a.detail}`)
  }

  const snapshotNow = (): DocumentDiagnosticsSnapshot | null => {
    try { return deps.readSnapshot() } catch { return null }
  }
  const domNow = (): BadgeAcceptanceDomFacts => {
    try { return deps.readDomFacts() } catch { return { markers: [], drawer: { open: false, rows: [] }, numberedHeadings: [] } }
  }

  try {
    const originalMarkdown = deps.getMarkdown()
    const snapshot = snapshotNow()
    markers = domNow().markers
    const facts = domNow()
    const snapshotIds = new Set((snapshot?.diagnostics ?? []).map(d => d.id))

    // ── 1. Badge presence / copy / severity / aggregation ────────────────
    {
      const assertions: BadgeAcceptanceAssertion[] = []
      assertions.push({
        id: 'badges.present',
        ok: markers.length > 0 && markers.some(m => m.badges.length > 0),
        detail: `markers=${markers.length} badges=${markers.reduce((n, m) => n + m.badges.length, 0)}`,
      })
      const allBadgeTexts = markers.flatMap(m => m.badges.map(b => b.text))
      const generic = allBadgeTexts.filter(t => isGenericBadgeLabel(t))
      assertions.push({
        id: 'badges.no-generic-copy',
        ok: generic.length === 0,
        detail: generic.length > 0 ? generic.join(' | ') : 'none',
      })
      assertions.push({
        id: 'badges.diagnostic-identity',
        ok: markers.every(m => m.diagnosticIds.every(id => snapshotIds.has(id))),
        detail: markers.flatMap(m => m.diagnosticIds).join(' | '),
      })

      for (const marker of markers) {
        const expected = expectedBadgesForMarker(marker, snapshot)
        const specific = marker.badges.filter(b => b.kind === 'diagnostic')
        const summary = marker.badges.find(b => b.kind === 'summary') ?? null
        assertions.push({
          id: `badges.copy.${marker.identity}`,
          ok: specific.map(b => b.text).join('|') === expected.visible.map(b => b.shortLabel).join('|'),
          detail: `dom=${specific.map(b => b.text).join('|')} expected=${expected.visible.map(b => b.shortLabel).join('|')}`,
        })
        assertions.push({
          id: `badges.severity.${marker.identity}`,
          ok: specific.every((b, i) => b.severity === expected.visible[i]?.severity),
          detail: specific.map(b => `${b.text}:${b.severity}`).join(' | '),
        })
        assertions.push({
          id: `badges.aggregation.${marker.identity}`,
          ok: (summary?.text ?? null) === expected.summaryLabel
            && specific.length === Math.min(2, expected.allCount),
          detail: `specific=${specific.length} summary=${summary?.text ?? 'none'} distinct=${expected.allCount} expectedSummary=${expected.summaryLabel ?? 'none'}`,
        })
        assertions.push({
          id: `badges.tooltip.${marker.identity}`,
          ok: specific.every((b, i) => {
            const badge = expected.visible[i]
            return badge != null && b.tooltip === formatDiagnosticBadgeTooltip(badge)
          }),
          detail: specific.map(b => b.tooltip).join(' || ') || 'none',
        })
      }

      const codes = new Set((snapshot?.diagnostics ?? []).map(d => d.code))
      const texts = allBadgeTexts.join('|')
      if (codes.has('HEADING_LEVEL_GAP')) {
        assertions.push({
          id: 'badges.dynamic.level-gap',
          ok: /层级跳级 H\d→H\d/.test(texts),
          detail: texts,
        })
      }
      if (codes.has('HEADING_DUPLICATE_TEXT')) {
        assertions.push({
          id: 'badges.dynamic.duplicate',
          ok: /重复标题：/.test(texts),
          detail: texts,
        })
      }
      if (codes.has('HEADING_MANUAL_NUMBER_PREFIX')) {
        assertions.push({
          id: 'badges.dynamic.manual-number',
          ok: /手工编号/.test(texts),
          detail: texts,
        })
      }
      const summaryMarkers = markers.filter(m => m.badges.some(b => b.kind === 'summary'))
      if (summaryMarkers.length > 0) {
        assertions.push({
          id: 'badges.summary-count',
          ok: summaryMarkers.every(m => {
            const expected = expectedBadgesForMarker(m, snapshot)
            const summary = m.badges.find(b => b.kind === 'summary')
            return summary?.text === expected.summaryLabel
          }),
          detail: summaryMarkers.map(m => `${m.identity}:${m.badges.find(b => b.kind === 'summary')?.text}`).join(' | '),
        })
      }
      push('badges-presentation', '正文徽章文案、严重级别与聚合数量一致', assertions)
    }

    // ── 2. Specific badge click → central panel selection ────────────────
    {
      const target = markers.flatMap(m => m.badges).find(b => b.kind === 'diagnostic' && b.diagnosticId !== '') ?? null
      const assertions: BadgeAcceptanceAssertion[] = []
      if (!target) {
        assertions.push({ id: 'click.specific.available', ok: false, detail: 'NO_SPECIFIC_BADGE' })
      } else {
        const clicked = deps.clickBadge(target.diagnosticId)
        await deps.wait(1200)
        const drawer = domNow().drawer
        const selected = drawer.rows.find(r => r.selected)?.diagnosticId ?? ''
        assertions.push({ id: 'click.specific.dispatched', ok: clicked, detail: target.diagnosticId })
        assertions.push({ id: 'click.specific.drawer-open', ok: drawer.open, detail: String(drawer.open) })
        assertions.push({ id: 'click.specific.selected', ok: selected === target.diagnosticId, detail: `${selected} / ${target.diagnosticId}` })
        assertions.push({
          id: 'click.specific.markdown-unchanged',
          ok: deps.getMarkdown() === originalMarkdown,
          detail: 'badge clicks are presentation-only',
        })
      }
      push('badges-click-specific', '点击具体徽章定位到对应诊断', assertions)
    }

    // ── 3. `+N` summary click → EVERY heading diagnostic focused ─────────
    {
      const target = markers.find(m => m.badges.some(b => b.kind === 'summary')) ?? null
      const assertions: BadgeAcceptanceAssertion[] = []
      if (!target) {
        assertions.push({ id: 'click.summary.available', ok: true, detail: 'NO_SUMMARY_BADGE_IN_FIXTURE' })
      } else {
        const clicked = deps.clickSummary(target.identity)
        await deps.wait(1200)
        const drawer = domNow().drawer
        const focused = new Set(drawer.rows.filter(r => r.groupFocused || r.selected).map(r => r.diagnosticId))
        const missing = target.diagnosticIds.filter(id => !focused.has(id))
        assertions.push({ id: 'click.summary.dispatched', ok: clicked, detail: target.identity })
        assertions.push({ id: 'click.summary.drawer-open', ok: drawer.open, detail: String(drawer.open) })
        assertions.push({
          id: 'click.summary.all-focused',
          ok: missing.length === 0,
          detail: `focused=${[...focused].join('|')} missing=${missing.join('|') || 'none'}`,
        })
        assertions.push({
          id: 'click.summary.markdown-unchanged',
          ok: deps.getMarkdown() === originalMarkdown,
          detail: 'summary click is presentation-only',
        })
      }
      push('badges-click-summary', '点击汇总徽章聚焦该标题的全部诊断', assertions)
    }

    // ── 4. Keyboard Enter ────────────────────────────────────────────────
    {
      const candidates = markers.flatMap(m => m.badges).filter(b => b.kind === 'diagnostic' && b.diagnosticId !== '')
      const target = candidates[candidates.length - 1] ?? null
      const assertions: BadgeAcceptanceAssertion[] = []
      if (!target) {
        assertions.push({ id: 'keyboard.available', ok: false, detail: 'NO_SPECIFIC_BADGE' })
      } else {
        const pressed = deps.pressBadgeKey(target.diagnosticId, 'Enter')
        await deps.wait(1200)
        const selected = domNow().drawer.rows.find(r => r.selected)?.diagnosticId ?? ''
        assertions.push({ id: 'keyboard.dispatched', ok: pressed, detail: target.diagnosticId })
        assertions.push({ id: 'keyboard.selected', ok: selected === target.diagnosticId, detail: `${selected} / ${target.diagnosticId}` })
      }
      push('badges-keyboard', '键盘 Enter 激活徽章', assertions)
    }

    // ── 5. Real fix → badge disappears → Undo → badge returns ────────────
    // Runs BEFORE the content-reset step: `undo()` must target the fix, never a
    // fixture reload.
    {
      const candidates = (snapshot?.diagnostics ?? []).filter(d =>
        (DIAGNOSTIC_BADGE_AUTO_FIX_CODES as readonly string[]).includes(d.code)
        && markers.some(m => m.diagnosticIds.includes(d.id)))
      // Prefer a diagnostic the real planner can safely rewrite (non-empty
      // numberingAfter); `HEADING_DOUBLE_NUMBER_PREFIX` is the deterministic
      // AUTO_SAFE removal of a duplicated source prefix.
      const rewritable = candidates.filter(d => {
        const after = d.metadata?.['numberingAfter']
        return typeof after === 'string' && after !== ''
      })
      const fixable = rewritable.find(d => d.code === 'HEADING_DOUBLE_NUMBER_PREFIX')
        ?? rewritable[0]
        ?? candidates[0]
        ?? null
      const assertions: BadgeAcceptanceAssertion[] = []
      if (!fixable) {
        assertions.push({ id: 'fix.available', ok: true, detail: 'N/A_NO_AUTO_FIXABLE_DIAGNOSTIC' })
      } else {
        const markdownBeforeFix = deps.getMarkdown()
        const started = deps.fixDiagnostic(fixable.id)
        let markdownChanged = false
        let badgeGone = false
        for (let i = 0; i < 16; i++) {
          await deps.wait(400)
          markdownChanged = deps.getMarkdown() !== markdownBeforeFix
          badgeGone = !domNow().markers.some(m => m.badges.some(b => b.diagnosticId === fixable.id))
          if (markdownChanged && badgeGone) break
        }
        const undo = deps.undo()
        try { deps.recomputeDiagnostics?.() } catch { /* fail-open */ }
        let restored = false
        for (let i = 0; i < 16; i++) {
          await deps.wait(500)
          // The diagnostic ID may be regenerated after an undo; match the SAME
          // rule (and target identity when present) in the fresh snapshot, then
          // confirm the DOM actually paints it again.
          const fresh = snapshotNow()
          const sameCode = (fresh?.diagnostics ?? []).filter(d => d.code === fixable.code)
          const equivalent = sameCode.find(d => d.targetIdentity === fixable.targetIdentity)
            ?? sameCode.find(d => d.stableIdentity != null && d.stableIdentity === fixable.stableIdentity)
            ?? sameCode[0]
          restored = equivalent != null
            && domNow().markers.some(m => m.diagnosticIds.includes(equivalent.id))
          if (restored) break
        }
        assertions.push({ id: 'fix.started', ok: started, detail: `${fixable.code} ${fixable.id}` })
        assertions.push({
          id: 'fix.markdown-changed',
          ok: markdownChanged,
          detail: markdownChanged ? 'source updated' : 'NO_SAFE_REWRITE_OR_BLOCKED',
        })
        assertions.push({ id: 'fix.badge-removed', ok: badgeGone, detail: badgeGone ? 'removed' : 'STILL_PRESENT' })
        assertions.push({ id: 'fix.undo-ok', ok: undo.ok, detail: undo.reason ?? 'ok' })
        assertions.push({ id: 'fix.badge-restored', ok: restored, detail: restored ? 'restored' : 'MISSING' })
      }
      push('badges-fix-undo', '单项修复后徽章更新，撤销后恢复', assertions)
    }

    // ── 6. Content reset → stale badges removed, restore → rebuilt ───────
    {
      const beforeNumbers = domNow().numberedHeadings
      deps.replaceContent('')
      await deps.wait(1500)
      const cleared = domNow()
      deps.replaceContent(originalMarkdown)
      await deps.wait(1800)
      const restored = domNow()
      const afterNumbers = restored.numberedHeadings
      push('badges-content-reset', '内容清空后无旧徽章，恢复后重新渲染', [
        { id: 'reset.cleared', ok: cleared.markers.length === 0, detail: `markers=${cleared.markers.length}` },
        { id: 'reset.rebuilt', ok: restored.markers.length === markers.length, detail: `${restored.markers.length}/${markers.length}` },
        {
          id: 'reset.heading-numbers',
          ok: beforeNumbers.length === afterNumbers.length
            && beforeNumbers.every((h, i) => h.number === afterNumbers[i]?.number),
          detail: `${JSON.stringify(beforeNumbers)} → ${JSON.stringify(afterNumbers)}`,
        },
      ])
    }

    return {
      schema: 'inkchapter.diagnostic-badge-acceptance/v1',
      requestToken: token,
      startedAt,
      finishedAt: new Date().toISOString(),
      documentPath: deps.getActiveFilePath(),
      steps,
      markers,
      failures,
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      error: null,
    }
  } catch (error) {
    return {
      schema: 'inkchapter.diagnostic-badge-acceptance/v1',
      requestToken: token,
      startedAt,
      finishedAt: new Date().toISOString(),
      documentPath: deps.getActiveFilePath(),
      steps,
      markers,
      failures,
      verdict: 'FAIL',
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    }
  }
}

export function installDiagnosticBadgeAcceptanceRunner(deps: DiagnosticBadgeAcceptanceDeps): () => void {
  if (!deps.vaultRoot) return () => undefined
  const vault = normalizeGatePath(deps.vaultRoot)
  if (vault === '' || !vault.endsWith('/test/vault')) return () => undefined
  const initialRequest = readJsonFile<AcceptanceRequest>(requestFilePath(deps.vaultRoot))
  if (!isDiagnosticBadgeAcceptanceRequested() && (initialRequest?.token ?? '').trim() === '') {
    return () => undefined
  }

  let running = false
  let disposed = false
  let unsubscribe: (() => void) | null = null

  const check = async (): Promise<void> => {
    if (disposed || running) return
    const request = readJsonFile<AcceptanceRequest>(requestFilePath(deps.vaultRoot!))
    const token = (request?.token ?? '').trim()
    if (token === '') return
    const active = deps.getActiveFilePath() ? normalizeGatePath(deps.getActiveFilePath()!) : ''
    const expected = `${vault}/${DIAGNOSTIC_BADGE_ACCEPTANCE_DOCUMENT_IN_VAULT}`
    if (active === '' || active !== expected) return
    const previous = readJsonFile<{ requestToken?: string }>(reportFilePath(deps.vaultRoot!))
    if (previous?.requestToken === token) return
    running = true
    try {
      const report = await runAcceptance(deps, token)
      writeReport(deps.vaultRoot!, report)
      deps.log?.(`[diagnostic-badge-acceptance] ${report.verdict} token=${token} steps=${report.steps.length}`)
    } finally {
      running = false
    }
  }

  try {
    unsubscribe = deps.subscribeFileOpen(() => { void check() })
  } catch { unsubscribe = null }
  // The file:open event may already have fired before this runner mounted.
  setTimeout(() => { void check() }, 1200)
  return () => {
    disposed = true
    unsubscribe?.()
  }
}
