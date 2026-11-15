/**
 * R06 — blank-line runtime acceptance launcher.
 *
 * WHY: the old GUI acceptance drove the fix through the DevTools console, which
 * dies whenever another window steals focus. This launcher needs NO keyboard
 * input: it deploys the build to the test vault, drops a run request, opens the
 * dedicated acceptance document, and waits for the plugin's own report.
 *
 * The plugin side is gated (dedicated document inside `test/vault` + run token)
 * and calls the SAME fix entries the 检测 panel uses, then verifies the buffer,
 * the re-diagnosis and Typora's own Undo/Redo.
 *
 * Usage:
 *   node scripts/run-blank-line-acceptance.mjs
 *   node scripts/run-blank-line-acceptance.mjs --timeout=180
 *
 * Exit code 0 = PASS, 1 = FAIL/UNEXECUTED/timeout. The fixture is always
 * restored from its template afterwards.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTestVault } from './open-test-vault.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VAULT = path.join(ROOT, 'test', 'vault')
const ACCEPTANCE_DIR = path.join(VAULT, 'runtime', 'acceptance')
const TEMPLATE = path.join(ACCEPTANCE_DIR, 'Blank-Line-R06-Runtime-Acceptance.template.md')
const DOCUMENT = path.join(ACCEPTANCE_DIR, 'Blank-Line-R06-Runtime-Acceptance.md')
const REQUEST = path.join(ACCEPTANCE_DIR, 'acceptance-request.json')
const REPORT = path.join(ACCEPTANCE_DIR, 'acceptance-last-run.json')
const RUNTIME_LOAD = path.join(VAULT, '.typora', 'inkchapter-runtime-load.json')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function argValue(name, fallback) {
  const prefix = `--${name}=`
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

async function runAcceptance() {
  const timeoutMs = Number(argValue('timeout', '150000'))
  const token = `r06-${Date.now()}`

  await fs.mkdir(ACCEPTANCE_DIR, { recursive: true })
  await fs.copyFile(TEMPLATE, DOCUMENT)
  await fs.writeFile(REQUEST, `${JSON.stringify({
    token,
    requestedAt: new Date().toISOString(),
    document: path.basename(DOCUMENT),
    purpose: 'R06 blank-line fix / re-diagnosis / undo / redo acceptance',
  }, null, 2)}\n`, 'utf8')
  // A previous report for another token must not leak into this run's verdict.
  await fs.rm(REPORT, { force: true })

  console.log(`[acceptance] token:    ${token}`)
  console.log(`[acceptance] document: ${DOCUMENT}`)

  const loaded = await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })
  console.log(`[acceptance] plugin loaded from vault: ${loaded}`)

  const deadline = Date.now() + timeoutMs
  let report = null
  while (Date.now() < deadline) {
    await sleep(1500)
    const candidate = await readJson(REPORT)
    if (candidate && candidate.requestToken === token) { report = candidate; break }
  }

  // ALWAYS restore the fixture: the run must never leave a modified document.
  await fs.copyFile(TEMPLATE, DOCUMENT)

  if (!report) {
    const runtimeLoad = await readJson(RUNTIME_LOAD)
    console.error('[acceptance] TIMEOUT: no report for this token.')
    console.error(`[acceptance] running plugin sha: ${runtimeLoad?.mainJsSha256 ?? 'unknown'}`)
    console.error('[acceptance] hint: restart Typora so the deployed build is loaded, then re-run.')
    return 1
  }

  const result = {
    verdict: report.verdict,
    token: report.requestToken,
    documentKey: report.documentKey,
    baselineLineCount: report.baselineLineCount,
    baselineDiagnostics: report.baselineDiagnostics?.length ?? 0,
    finalDiagnostics: report.finalDiagnostics?.length ?? 0,
    finalMarkdownMatchesBaseline: report.finalMarkdownMatchesBaseline,
    undoApi: report.undoApi,
    failures: report.failures ?? [],
    steps: (report.steps ?? []).map((step) => ({
      id: step.id,
      label: step.label,
      lines: `${step.beforeLineCount}->${step.afterLineCount}`,
      blank: `${step.blankDiagnosticsBefore}->${step.blankDiagnosticsAfter}`,
      afterTrailingNewlines: step.afterTrailingNewlines,
      afterBlankRuns: step.afterBlankRuns,
      diff: step.diff,
      failed: (step.assertions ?? []).filter((a) => !a.ok).map((a) => `${a.id}: ${a.detail}`),
    })),
    error: report.error,
    scope: report.scope,
    reportPath: REPORT,
  }
  console.log('[acceptance] RESULT')
  console.log(JSON.stringify(result, null, 2))
  return report.verdict === 'PASS' ? 0 : 1
}

runAcceptance()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('[acceptance] launcher error:', error)
    process.exitCode = 1
  })
