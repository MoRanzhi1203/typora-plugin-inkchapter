/**
 * R11 — Formula numbering runtime acceptance launcher.
 *
 * Mirrors the R10 object-numbering launcher: deploy the built plugin to the
 * test vault first, then run this script. It drops a fresh run token, opens the
 * dedicated fixture, and waits for the plugin's own DOM-first report. No
 * DevTools, no keyboard input, no manual verification.
 *
 * Usage:
 *   node scripts/run-formula-numbering-acceptance.mjs
 *   node scripts/run-formula-numbering-acceptance.mjs --timeout=240000
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
const TEMPLATE = path.join(ACCEPTANCE_DIR, 'FormulaNumbering-R11-Runtime-Acceptance.template.md')
const DOCUMENT = path.join(ACCEPTANCE_DIR, 'FormulaNumbering-R11-Runtime-Acceptance.md')
const REQUEST = path.join(ACCEPTANCE_DIR, 'formula-numbering-acceptance-request.json')
const REPORT = path.join(ACCEPTANCE_DIR, 'formula-numbering-acceptance-last-run.json')
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
  const timeoutMs = Number(argValue('timeout', '240000'))
  const token = `r11-${Date.now()}`

  await fs.mkdir(ACCEPTANCE_DIR, { recursive: true })
  await fs.copyFile(TEMPLATE, DOCUMENT)
  await fs.writeFile(REQUEST, `${JSON.stringify({
    token,
    requestedAt: new Date().toISOString(),
    document: path.basename(DOCUMENT),
    purpose: 'R11 formula numbering real-DOM acceptance (visibility, chapter linkage, dedupe)',
  }, null, 2)}\n`, 'utf8')
  await fs.rm(REPORT, { force: true })

  console.log(`[formula-number-acceptance] token:    ${token}`)
  console.log(`[formula-number-acceptance] document: ${DOCUMENT}`)

  const loaded = await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })
  console.log(`[formula-number-acceptance] plugin loaded from vault: ${loaded}`)

  const deadline = Date.now() + timeoutMs
  let report = null
  while (Date.now() < deadline) {
    await sleep(2000)
    const candidate = await readJson(REPORT)
    if (candidate && candidate.requestToken === token) { report = candidate; break }
  }

  await fs.copyFile(TEMPLATE, DOCUMENT)

  if (!report) {
    const runtimeLoad = await readJson(RUNTIME_LOAD)
    console.error('[formula-number-acceptance] TIMEOUT: no report for this token.')
    console.error(`[formula-number-acceptance] running plugin sha: ${runtimeLoad?.mainJsSha256 ?? 'unknown'}`)
    console.error('[formula-number-acceptance] hint: reopen the vault so the deployed build is loaded, then re-run.')
    return 1
  }

  const result = {
    verdict: report.verdict,
    token: report.requestToken,
    documentPath: report.documentPath,
    stepCount: (report.steps ?? []).length,
    steps: (report.steps ?? []).map((step) => ({
      id: step.id,
      label: step.label,
      failed: (step.assertions ?? []).filter((a) => !a.ok).map((a) => `${a.id}: ${a.detail}`),
    })),
    formulas: (report.domFacts?.formulas ?? []).map((f) => ({
      index: f.index,
      numbers: f.visibleNumberTexts,
      tags: f.tagTexts,
      decorations: f.decorationTexts,
      visible: f.numberVisible,
      rightAligned: f.numberRightOfHost,
      mjx: f.mjxContainerCount,
    })),
    expected: report.expected,
    failures: report.failures ?? [],
    error: report.error,
    reportPath: REPORT,
  }
  console.log('[formula-number-acceptance] RESULT')
  console.log(JSON.stringify(result, null, 2))
  return report.verdict === 'PASS' ? 0 : 1
}

runAcceptance()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('[formula-number-acceptance] launcher error:', error)
    process.exitCode = 1
  })
