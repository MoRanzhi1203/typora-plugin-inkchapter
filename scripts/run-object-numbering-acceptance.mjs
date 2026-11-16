/**
 * R10 — object numbering runtime acceptance launcher.
 *
 * Mirrors the R08 numbering launcher: deploy the built plugin to the test
 * vault, drop a fresh run token, open the dedicated fixture, and wait for the
 * plugin's own report. No keyboard / DevTools input required.
 *
 * Usage:
 *   node scripts/run-object-numbering-acceptance.mjs
 *   node scripts/run-object-numbering-acceptance.mjs --timeout=180000
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
const TEMPLATE = path.join(ACCEPTANCE_DIR, 'ObjectNumbering-R10-Runtime-Acceptance.template.md')
const DOCUMENT = path.join(ACCEPTANCE_DIR, 'ObjectNumbering-R10-Runtime-Acceptance.md')
const REQUEST = path.join(ACCEPTANCE_DIR, 'object-numbering-acceptance-request.json')
const REPORT = path.join(ACCEPTANCE_DIR, 'object-numbering-acceptance-last-run.json')
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
  const token = `r10-${Date.now()}`

  await fs.mkdir(ACCEPTANCE_DIR, { recursive: true })
  await fs.copyFile(TEMPLATE, DOCUMENT)
  await fs.writeFile(REQUEST, `${JSON.stringify({
    token,
    requestedAt: new Date().toISOString(),
    document: path.basename(DOCUMENT),
    purpose: 'R10 figure/table/code/formula caption persistence / idempotence / undo / export acceptance',
  }, null, 2)}\n`, 'utf8')
  await fs.rm(REPORT, { force: true })

  console.log(`[object-number-acceptance] token:    ${token}`)
  console.log(`[object-number-acceptance] document: ${DOCUMENT}`)

  const loaded = await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })
  console.log(`[object-number-acceptance] plugin loaded from vault: ${loaded}`)

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
    console.error('[object-number-acceptance] TIMEOUT: no report for this token.')
    console.error(`[object-number-acceptance] running plugin sha: ${runtimeLoad?.mainJsSha256 ?? 'unknown'}`)
    console.error('[object-number-acceptance] hint: restart Typora so the deployed build is loaded, then re-run.')
    return 1
  }

  const result = {
    verdict: report.verdict,
    token: report.requestToken,
    documentPath: report.documentPath,
    objectCounts: report.objectCounts,
    captionList: report.captionList,
    sourceHashBefore: report.sourceHashBefore,
    sourceHashAfterWrite: report.sourceHashAfterWrite,
    sourceHashAfterSecondSync: report.sourceHashAfterSecondSync,
    patchCount: report.patchCount,
    domCaptionCount: report.domCaptionCount,
    duplicateCaptionCount: report.duplicateCaptionCount,
    undoRedo: report.undoRedo,
    export: report.exportFacts
      ? {
          fileName: report.exportFacts.fileName,
          htmlVerified: report.exportFacts.htmlVerified,
          markdownHead: String(report.exportFacts.markdown ?? '').split(/\r?\n/).slice(0, 10),
        }
      : null,
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
  console.log('[object-number-acceptance] RESULT')
  console.log(JSON.stringify(result, null, 2))
  return report.verdict === 'PASS' ? 0 : 1
}

runAcceptance()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('[object-number-acceptance] launcher error:', error)
    process.exitCode = 1
  })
