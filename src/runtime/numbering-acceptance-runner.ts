/**
 * R08 — Numbering runtime acceptance runner (test-vault only).
 *
 * Reuses the R06 pattern: a request token in `test/vault/runtime/acceptance`
 * unlocks the run, the plugin executes its OWN business entries
 * (`NumberingPersistenceService`), and one fixed report path records the verdict.
 *
 * It proves, in the REAL Typora buffer:
 *   1. source mode actually writes numbers into the Markdown;
 *   2. a second sync is a no-op (idempotence);
 *   3. the body/outline do not project a second number on top of the source one;
 *   4. Typora Undo / Redo restore the pre-write / post-write buffer;
 *   5. the removal command deletes only plugin-managed prefixes;
 *   6. the fixture is restored at the end.
 *
 * No arbitrary JS, no arbitrary file writes.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { NumberingPersistenceService, NumberingSyncResult } from '../heading-numbering/numbering-persistence-service'
import { scanHeadingNumber } from '../heading-numbering/heading-number-source-scanner'
import { isRewritableHeadingNumber } from '../heading-numbering/heading-number-source-scanner'

export const NUMBERING_ACCEPTANCE_ENV = 'INKCHAPTER_NUMBERING_ACCEPTANCE'

export const NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT = 'runtime/acceptance/Numbering-R08-Runtime-Acceptance.md'
export const NUMBERING_ACCEPTANCE_REQUEST_IN_VAULT = 'runtime/acceptance/numbering-acceptance-request.json'
export const NUMBERING_ACCEPTANCE_REPORT_IN_VAULT = 'runtime/acceptance/numbering-acceptance-last-run.json'

export interface NumberingAcceptanceDomFacts {
  headingCount: number
  /** Headings carrying a body decoration (`data-inkchapter-heading-number`). */
  projectedNumberCount: number
  headingTexts: string[]
  projectedLabels: Array<string | null>
}

export interface NumberingAcceptanceDeps {
  vaultRoot: string | null
  getActiveFilePath(): string | null
  getMarkdown(): string
  replaceContent(markdown: string): void
  persistence: NumberingPersistenceService
  readDomFacts(): NumberingAcceptanceDomFacts
  undo(): { ok: boolean; reason?: string }
  redo(): { ok: boolean; reason?: string }
  undoStackLength(): number | null
  subscribeFileOpen(callback: () => void): () => void
  schedule?(fn: () => void, delayMs: number): void
  delayMs?: number
  log?(message: string): void
}

export interface NumberingAcceptanceAssertion {
  id: string
  ok: boolean
  detail: string
}

export interface NumberingAcceptanceStep {
  id: string
  label: string
  assertions: NumberingAcceptanceAssertion[]
  result: Pick<NumberingSyncResult, 'status' | 'reason' | 'patchCount'>
}

export interface NumberingAcceptanceReport {
  schema: 'inkchapter.numbering-acceptance/v1'
  requestToken: string
  startedAt: string
  finishedAt: string
  documentPath: string | null
  sourceAfterWrite: string
  sourceAfterSecondSync: string
  sourceAfterRemove: string
  domAfterWrite: NumberingAcceptanceDomFacts | null
  undoApi: { available: boolean; undoStackLengthStart: number | null; undoStackLengthEnd: number | null }
  steps: NumberingAcceptanceStep[]
  failures: string[]
  verdict: 'PASS' | 'FAIL' | 'UNEXECUTED'
  error: string | null
}

export function isNumberingAcceptanceRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[NUMBERING_ACCEPTANCE_ENV] === '1'
  } catch {
    return false
  }
}

function requestFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, NUMBERING_ACCEPTANCE_REQUEST_IN_VAULT)
}

function reportFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, NUMBERING_ACCEPTANCE_REPORT_IN_VAULT)
}

function readToken(file: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { token?: unknown; requestToken?: unknown }
    if (typeof parsed.token === 'string') return parsed.token
    if (typeof parsed.requestToken === 'string') return parsed.requestToken
    return null
  } catch {
    return null
  }
}

function writeReport(vaultRoot: string, report: NumberingAcceptanceReport | null, token: string): void {
  const target = reportFilePath(vaultRoot)
  const payload: NumberingAcceptanceReport = report ?? {
    schema: 'inkchapter.numbering-acceptance/v1',
    requestToken: token,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    documentPath: null,
    sourceAfterWrite: '',
    sourceAfterSecondSync: '',
    sourceAfterRemove: '',
    domAfterWrite: null,
    undoApi: { available: false, undoStackLengthStart: null, undoStackLengthEnd: null },
    steps: [],
    failures: ['编号验收未执行：编辑器桥不可用'],
    verdict: 'UNEXECUTED',
    error: null,
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch { /* a failed report write must never crash the editor */ }
}

/** The acceptance gate: repository test vault + the dedicated document + a fresh token. */
export function resolveNumberingAcceptanceGate(input: {
  vaultRoot: string | null
  activeFilePath: string | null
  requestToken: string | null
  lastReportToken: string | null
}): { enabled: boolean; reason: string } {
  const vault = input.vaultRoot?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
  if (vault === '' || !vault.endsWith('/test/vault')) return { enabled: false, reason: 'NOT_TEST_VAULT' }
  const expected = `${vault}/${NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT}`.toLowerCase()
  const active = input.activeFilePath?.replace(/\\/g, '/').toLowerCase() ?? ''
  if (active === '' || active !== expected) return { enabled: false, reason: 'NOT_ACCEPTANCE_DOCUMENT' }
  const token = (input.requestToken ?? '').trim()
  if (token === '') return { enabled: false, reason: 'NO_REQUEST_TOKEN' }
  if (input.lastReportToken != null && input.lastReportToken.trim() === token) {
    return { enabled: false, reason: 'ALREADY_RUN' }
  }
  return { enabled: true, reason: 'ENABLED' }
}

export function installNumberingAcceptanceRunner(deps: NumberingAcceptanceDeps): () => void {
  const vaultRoot = deps.vaultRoot
  if (!vaultRoot) return () => {}
  const requestFile = requestFilePath(vaultRoot)
  if (!isNumberingAcceptanceRequested() && readToken(requestFile) == null) return () => {}

  const log = deps.log ?? ((message: string) => console.info(message))
  const schedule = deps.schedule ?? ((fn: () => void, delayMs: number) => { setTimeout(fn, delayMs) })
  const delayMs = deps.delayMs ?? 2500
  let running = false
  let disposed = false

  const trigger = (source: string): void => {
    if (disposed || running) return
    const requestToken = readToken(requestFile)
    const activeFilePath = deps.getActiveFilePath()
    const gate = resolveNumberingAcceptanceGate({
      vaultRoot,
      activeFilePath,
      requestToken,
      lastReportToken: readToken(reportFilePath(vaultRoot)),
    })
    if (!gate.enabled) {
      if (gate.reason !== 'NO_REQUEST_TOKEN') log(`R08-ACCEPTANCE: skipped (${gate.reason}) via ${source}`)
      return
    }
    running = true
    log(`R08-ACCEPTANCE: start (token=${requestToken}) via ${source}`)
    schedule(() => {
      if (disposed) { running = false; return }
      void runAcceptance(deps, requestToken as string)
        .then(report => {
          writeReport(vaultRoot, report, requestToken as string)
          log(`R08-ACCEPTANCE: finished verdict=${report.verdict} failures=${report.failures.length}`)
        })
        .catch((error: unknown) => {
          writeReport(vaultRoot, null, requestToken as string)
          log(`R08-ACCEPTANCE: threw ${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => { running = false })
    }, delayMs)
  }

  const disposeSubscription = deps.subscribeFileOpen(() => trigger('file:open'))
  trigger('install')
  return () => {
    disposed = true
    disposeSubscription()
  }
}

async function runAcceptance(deps: NumberingAcceptanceDeps, token: string): Promise<NumberingAcceptanceReport> {
  const startedAt = new Date().toISOString()
  const baseline = deps.getMarkdown()
  const steps: NumberingAcceptanceStep[] = []
  const failures: string[] = []
  let sourceAfterWrite = ''
  let sourceAfterSecondSync = ''
  let sourceAfterRemove = ''
  let domAfterWrite: NumberingAcceptanceDomFacts | null = null
  const undoStackLengthStart = deps.undoStackLength()

  /** Record a step and aggregate EVERY failed assertion into the verdict. */
  const pushStep = (step: NumberingAcceptanceStep): void => {
    steps.push(step)
    for (const assertion of step.assertions) {
      if (!assertion.ok) failures.push(`${assertion.id}: ${assertion.detail}`)
    }
  }

  try {
    deps.persistence.setSettings({
      storageMode: 'source',
      existingNumberPolicy: 'adopt',
      syncTiming: 'manual',
    })

    // ── Step 1 — write numbers into the source ──────────
    const write = deps.persistence.runSync('acceptance-write')
    sourceAfterWrite = deps.getMarkdown()
    const writeAssertions: NumberingAcceptanceAssertion[] = [
      { id: 'write.applied', ok: write.status === 'APPLIED', detail: write.status },
      { id: 'write.source-has-number', ok: /^##\s+\d/im.test(sourceAfterWrite), detail: firstHeadingLine(sourceAfterWrite) },
      { id: 'write.titles-preserved', ok: baselineHeadingTitles(baseline).every(t => sourceAfterWrite.includes(t)), detail: '标题文字必须保留' },
      { id: 'write.no-double-prefix', ok: !hasDoublePrefix(sourceAfterWrite), detail: '不得出现双重编号' },
    ]
    pushStep({ id: 'write', label: '写入源码编号', assertions: writeAssertions, result: pick(write) })

    await wait(900)

    // ── Step 2 — idempotence ────────────────────────────
    const second = deps.persistence.runSync('acceptance-second-sync')
    sourceAfterSecondSync = deps.getMarkdown()
    pushStep({
      id: 'idempotence',
      label: '重复执行不再修改',
      assertions: [
        { id: 'repeat.unchanged-status', ok: second.status === 'UNCHANGED', detail: second.status },
        { id: 'repeat.byte-identical', ok: sourceAfterSecondSync === sourceAfterWrite, detail: '第二次同步不得改变任何字符' },
      ],
      result: pick(second),
    })

    // ── Step 3 — body/outline projection dedupe ─────────
    await wait(700)
    domAfterWrite = deps.readDomFacts()
    // Only a CONFIRMED number prefix counts as "from source"; the weak year
    // prefix in `2026 年研究报告` stays eligible for a projected number.
    const isSourceNumbered = (text: string): boolean =>
      isRewritableHeadingNumber(scanHeadingNumber(text).first)
    const numberedHeadings = domAfterWrite.headingTexts.filter(isSourceNumbered)
    const stillProjected = domAfterWrite.headingTexts
      .filter((text, index) => isSourceNumbered(text) && domAfterWrite?.projectedLabels[index] != null)
    pushStep({
      id: 'dedupe',
      label: '正文/大纲不叠加第二套编号',
      assertions: [
        { id: 'dedupe.headings-found', ok: domAfterWrite.headingCount > 0, detail: String(domAfterWrite.headingCount) },
        { id: 'dedupe.numbered-from-source', ok: numberedHeadings.length > 0, detail: String(numberedHeadings.length) },
        { id: 'dedupe.no-projected-duplicate', ok: stillProjected.length === 0, detail: `重复投影 ${stillProjected.length} 个` },
        { id: 'dedupe.no-double-prefix-in-dom', ok: domAfterWrite.headingTexts.every(text => !hasDoublePrefix(text)), detail: 'DOM 标题不得出现双重编号' },
      ],
      result: pick(second),
    })

    // ── Step 4 — Undo / Redo ────────────────────────────
    const undo = deps.undo()
    await wait(700)
    const afterUndo = deps.getMarkdown()
    const redo = deps.redo()
    await wait(700)
    const afterRedo = deps.getMarkdown()
    pushStep({
      id: 'undo-redo',
      label: '撤销 / 重做',
      assertions: [
        { id: 'undo.api', ok: undo.ok, detail: undo.reason ?? 'ok' },
        { id: 'undo.restores-baseline', ok: afterUndo === baseline, detail: firstHeadingLine(afterUndo) },
        { id: 'redo.calls', ok: redo.ok, detail: redo.reason ?? 'ok' },
        { id: 'redo.restores-numbered', ok: afterRedo === sourceAfterWrite, detail: firstHeadingLine(afterRedo) },
      ],
      result: pick(second),
    })

    // ── Step 5 — remove managed numbers ─────────────────
    const remove = deps.persistence.removeManagedNumbers()
    await wait(700)
    const afterRemove = deps.getMarkdown()
    sourceAfterRemove = afterRemove
    const remainingNumberedLines = afterRemove.split(/\r?\n/).filter(line => {
      const match = /^#{1,6}\s+(.*)$/.exec(line)
      if (!match) return false
      return isRewritableHeadingNumber(scanHeadingNumber(match[1]).first)
    })
    pushStep({
      id: 'remove',
      label: '移除墨章管理的编号',
      assertions: [
        { id: 'remove.applied', ok: remove.status === 'APPLIED', detail: remove.status },
        { id: 'remove.no-managed-prefix', ok: remainingNumberedLines.length === 0, detail: remainingNumberedLines.join(' | ') || 'none' },
        { id: 'remove.titles-preserved', ok: baselineHeadingTitles(baseline).every(t => afterRemove.includes(t)), detail: '标题文字必须保留' },
      ],
      result: pick(remove),
    })
  } catch (error) {
    return {
      schema: 'inkchapter.numbering-acceptance/v1',
      requestToken: token,
      startedAt,
      finishedAt: new Date().toISOString(),
      documentPath: deps.getActiveFilePath(),
      sourceAfterWrite,
      sourceAfterSecondSync,
      sourceAfterRemove,
      domAfterWrite,
      undoApi: { available: undoStackLengthStart != null, undoStackLengthStart, undoStackLengthEnd: deps.undoStackLength() },
      steps,
      failures: [`exception: ${error instanceof Error ? error.message : String(error)}`],
      verdict: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    // ALWAYS leave the fixture exactly as found.
    try { deps.replaceContent(baseline) } catch { /* restore is best effort */ }
  }

  return {
    schema: 'inkchapter.numbering-acceptance/v1',
    requestToken: token,
    startedAt,
    finishedAt: new Date().toISOString(),
    documentPath: deps.getActiveFilePath(),
    sourceAfterWrite,
    sourceAfterSecondSync,
    sourceAfterRemove,
    domAfterWrite,
    undoApi: { available: undoStackLengthStart != null, undoStackLengthStart, undoStackLengthEnd: deps.undoStackLength() },
    steps,
    failures,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    error: null,
  }
}

function pick(result: NumberingSyncResult): NumberingAcceptanceStep['result'] {
  return { status: result.status, reason: result.reason, patchCount: result.patchCount }
}

function hasDoublePrefix(markdown: string): boolean {
  return markdown.split(/\r?\n/).some(line => {
    const match = /^#{1,6}\s+(.*)$/.exec(line)
    if (!match) return false
    const scan = scanHeadingNumber(match[1])
    return scan.extra.length > 0
  })
}

function baselineHeadingTitles(markdown: string): string[] {
  const titles: string[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.*)$/.exec(line)
    if (!match) continue
    const title = scanHeadingNumber(match[1]).title.trim()
    if (title !== '') titles.push(title)
  }
  return titles
}

function firstHeadingLine(markdown: string): string {
  return markdown.split(/\r?\n/).find(line => /^#{1,6}\s/.test(line)) ?? '(none)'
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
