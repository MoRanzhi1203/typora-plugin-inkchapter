/**
 * R06-03 — TEST-VAULT runtime acceptance driver (lifecycle only).
 *
 * The DevTools-console route died the moment another window stole focus, so the
 * REAL editor fix chain stopped being re-verified. This driver runs the
 * acceptance INSIDE the plugin, with three independent gates:
 *
 *   1. `INKCHAPTER_BLANK_ACCEPTANCE=1` at startup (off by default),
 *   2. the active document is the dedicated acceptance fixture inside the
 *      repository's `test/vault`,
 *   3. a run-request token exists and differs from the last recorded report.
 *
 * It writes ONE fixed report path inside that acceptance folder. It cannot run
 * arbitrary JS, cannot write arbitrary files, and never plans/writes a patch on
 * its own — the business entry is the same one the 检测 panel uses.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  ACCEPTANCE_REPORT_IN_VAULT,
  ACCEPTANCE_REQUEST_IN_VAULT,
  resolveAcceptanceGate,
  type AcceptanceRunOptions,
  type AcceptanceRunReport,
} from '../document-utilities/document-diagnostic-acceptance-harness-v1'

export const BLANK_LINE_ACCEPTANCE_ENV = 'INKCHAPTER_BLANK_ACCEPTANCE'

export interface BlankLineAcceptanceRunnerOptions {
  vaultRoot: string | null
  getActiveFilePath(): string | null
  runAcceptance(options: AcceptanceRunOptions): Promise<AcceptanceRunReport | null>
  subscribeFileOpen(callback: () => void): () => void
  /** Let the freshly opened document finish loading + diagnosing. */
  delayMs?: number
  schedule?(fn: () => void, delayMs: number): void
  log?(message: string): void
}

export function isBlankLineAcceptanceRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[BLANK_LINE_ACCEPTANCE_ENV] === '1'
  } catch {
    return false
  }
}
function requestFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, ACCEPTANCE_REQUEST_IN_VAULT)
}

function reportFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, ACCEPTANCE_REPORT_IN_VAULT)
}

function readRequestToken(vaultRoot: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(requestFilePath(vaultRoot), 'utf8')) as { token?: unknown }
    return typeof parsed.token === 'string' ? parsed.token : null
  } catch {
    return null
  }
}

function readReportToken(vaultRoot: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(reportFilePath(vaultRoot), 'utf8')) as { requestToken?: unknown }
    return typeof parsed.requestToken === 'string' ? parsed.requestToken : null
  } catch {
    return null
  }
}

function writeReport(vaultRoot: string, report: AcceptanceRunReport | null, token: string): void {
  const target = reportFilePath(vaultRoot)
  const payload: AcceptanceRunReport = report ?? {
    schema: 'inkchapter.blank-line-acceptance/v1',
    requestToken: token,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    documentPath: null,
    documentKey: null,
    baselineHash: '',
    baselineLineCount: 0,
    baselineDiagnostics: [],
    finalDiagnostics: [],
    finalMarkdownMatchesBaseline: false,
    steps: [],
    failures: ['编辑器桥未提供 Undo/Redo；无法验证撤销与重做'],
    error: null,
    verdict: 'UNEXECUTED',
    scope: '未执行：Runtime 撤销/重做入口不可用。',
    undoApi: { available: false, undoStackLengthStart: null, undoStackLengthEnd: null },
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch { /* the run already happened; a failed write must not crash the app */ }
}

/**
 * Install the acceptance driver. Returns a dispose for BOTH the subscription
 * and any pending scheduled run.
 */
export function installBlankLineAcceptanceRunner(options: BlankLineAcceptanceRunnerOptions): () => void {
  const vaultRoot = options.vaultRoot
  if (!vaultRoot) return () => {}
  // Opt-in: the env flag OR a run-request file — the request file only exists in
  // this repository's `test/vault/runtime/acceptance` folder, and is written by
  // the acceptance script. A production vault never has one, so the driver is
  // off by default there.
  if (!isBlankLineAcceptanceRequested() && readRequestToken(vaultRoot) == null) return () => {}
  const log = options.log ?? ((message: string) => console.info(message))
  const schedule = options.schedule ?? ((fn: () => void, delayMs: number) => { setTimeout(fn, delayMs) })
  const delayMs = options.delayMs ?? 2500
  let running = false
  let disposed = false

  const trigger = (source: string): void => {
    if (disposed || running) return
    const requestToken = readRequestToken(vaultRoot)
    const activeFilePath = options.getActiveFilePath()
    const gate = resolveAcceptanceGate({
      vaultRoot,
      activeFilePath,
      requestToken,
      lastReportToken: readReportToken(vaultRoot),
    })
    if (!gate.enabled) {
      if (gate.reason !== 'NO_REQUEST_TOKEN') log(`R06-ACCEPTANCE: skipped (${gate.reason}) via ${source}`)
      return
    }
    running = true
    log(`R06-ACCEPTANCE: start (token=${requestToken}) via ${source}`)
    schedule(() => {
      if (disposed) { running = false; return }
      void options.runAcceptance({ requestToken: requestToken as string, documentPath: activeFilePath })
        .then((report) => {
          writeReport(vaultRoot, report, requestToken as string)
          const verdict = report?.verdict ?? 'UNEXECUTED'
          const count = report?.failures.length ?? 0
          log(`R06-ACCEPTANCE: finished verdict=${verdict} failures=${count}`)
        })
        .catch((error: unknown) => {
          writeReport(vaultRoot, null, requestToken as string)
          log(`R06-ACCEPTANCE: threw ${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => { running = false })
    }, delayMs)
  }

  const disposeSubscription = options.subscribeFileOpen(() => trigger('file:open'))
  // The acceptance document may already be open when the plugin finishes loading.
  trigger('install')

  return () => {
    disposed = true
    disposeSubscription()
  }
}
