/**
 * R08 — numbering runtime acceptance launcher.
 *
 * Mirrors the R06 blank-line launcher: deploy the built plugin to the test
 * vault, drop a fresh run token, open the dedicated numbering fixture, and wait
 * for the plugin's own report. No keyboard / DevTools input required.
 *
 * Usage:
 *   node scripts/run-numbering-acceptance.mjs
 *   node scripts/run-numbering-acceptance.mjs --timeout=180
 *
 * Exit 0 = PASS. The fixture is always restored from its template afterwards.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTestVault } from './open-test-vault.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VAULT = path.join(ROOT, 'test', 'vault')
const ACCEPTANCE_DIR = path.join(VAULT, 'runtime', 'acceptance')
const TEMPLATE = path.join(ACCEPTANCE_DIR, 'Numbering-R08-Runtime-Acceptance.template.md')
const DOCUMENT = path.join(ACCEPTANCE_DIR, 'Numbering-R08-Runtime-Acceptance.md')
const REQUEST = path.join(ACCEPTANCE_DIR, 'numbering-acceptance-request.json')
const REPORT = path.join(ACCEPTANCE_DIR, 'numbering-acceptance-last-run.json')
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
  const timeoutMs = Number(argValue('timeout', '180000'))
  const token = `r08-${Date.now()}`

  await fs.mkdir(ACCEPTANCE_DIR, { recursive: true })
  await fs.copyFile(TEMPLATE, DOCUMENT)
  await fs.writeFile(REQUEST, `${JSON.stringify({
    token,
    requestedAt: new Date().toISOString(),
    document: path.basename(DOCUMENT),
    purpose: 'R08 heading number persistence / dedupe / undo / remove acceptance',
  }, null, 2)}\n`, 'utf8')
  await fs.rm(REPORT, { force: true })

  console.log(`[numbering-acceptance] token:    ${token}`)
  console.log(`[numbering-acceptance] document: ${DOCUMENT}`)

  const loaded = await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })
  console.log(`[numbering-acceptance] plugin loaded from vault: ${loaded}`)

  const deadline = Date.now() + timeoutMs
  let report = null
  while (Date.now() < deadline) {
    await sleep(1500)
    const candidate = await readJson(REPORT)
    if (candidate && candidate.requestToken === token) { report = candidate; break }
  }

  await fs.copyFile(TEMPLATE, DOCUMENT)

  if (!report) {
    const runtimeLoad = await readJson(RUNTIME_LOAD)
    console.error('[numbering-acceptance] TIMEOUT: no report for this token.')
    console.error(`[numbering-acceptance] running plugin sha: ${runtimeLoad?.mainJsSha256 ?? 'unknown'}`)
    console.error('[numbering-acceptance] hint: restart Typora so the deployed build is loaded, then re-run.')
    return 1
  }

  const result = {
    verdict: report.verdict,
    token: report.requestToken,
    documentPath: report.documentPath,
    sourceAfterWriteHead: firstLines(report.sourceAfterWrite, 8),
    sourceAfterSecondSyncHead: firstLines(report.sourceAfterSecondSync, 8),
    sourceAfterRemoveHead: firstLines(report.sourceAfterRemove, 8),
    dom: report.domAfterWrite
      ? {
          headingCount: report.domAfterWrite.headingCount,
          projectedNumberCount: report.domAfterWrite.projectedNumberCount,
          headingTexts: report.domAfterWrite.headingTexts,
          projectedLabels: report.domAfterWrite.projectedLabels,
        }
      : null,
    undoApi: report.undoApi,
    steps: (report.steps ?? []).map((step) => ({
      id: step.id,
      label: step.label,
      result: step.result,
      failed: (step.assertions ?? []).filter((a) => !a.ok).map((a) => `${a.id}: ${a.detail}`),
    })),
    failures: report.failures ?? [],
    error: report.error,
    reportPath: REPORT,
  }
  console.log('[numbering-acceptance] RESULT')
  console.log(JSON.stringify(result, null, 2))
  return report.verdict === 'PASS' ? 0 : 1
}

function firstLines(text, count) {
  return String(text ?? '').split(/\r?\n/).slice(0, count)
}

runAcceptance()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('[numbering-acceptance] launcher error:', error)
    process.exitCode = 1
  })
