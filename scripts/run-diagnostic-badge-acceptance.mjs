/**
 * R14 — 正文诊断徽章 Runtime 验收启动器。
 *
 * 1. 从现有 vault 夹具 `墨章插件测试/08-标题编号与跳级翻转测试.md` 生成验收文档；
 * 2. 追加一个“同一标题 3 个诊断”的聚合场景（H3→H5 + 重复标题 + 重复规范身份）；
 * 3. 写入请求 token，打开 vault + 验收文档；
 * 4. 等待插件自身的 DOM 优先报告；退出码 0 = PASS。
 *
 * 用法：
 *   node scripts/run-diagnostic-badge-acceptance.mjs
 *   node scripts/run-diagnostic-badge-acceptance.mjs --timeout=300000
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openTestVault } from './open-test-vault.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VAULT = path.join(ROOT, 'test', 'vault')
const ACCEPTANCE_DIR = path.join(VAULT, 'runtime', 'acceptance')
const SOURCE_FIXTURE = path.join(VAULT, '墨章插件测试', '08-标题编号与跳级翻转测试.md')
const DOCUMENT = path.join(ACCEPTANCE_DIR, 'DiagnosticBadges-R14-Runtime-Acceptance.md')
const REQUEST = path.join(ACCEPTANCE_DIR, 'diagnostic-badge-acceptance-request.json')
const REPORT = path.join(ACCEPTANCE_DIR, 'diagnostic-badge-acceptance-last-run.json')
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

/**
 * A heading with THREE independent real diagnostics:
 *   - H3 → H5 level gap
 *   - duplicate title text (`HEADING_DUPLICATE_TEXT`)
 *   - duplicate canonical identity (`HEADING_DUPLICATE_IDENTITY`)
 * This is the runtime proof of the “2 specific + +N” aggregation.
 *
 * The extra double-prefix heading provides a genuinely AUTO_SAFE fix
 * (`HEADING_DOUBLE_NUMBER_PREFIX` → 移除重复编号) for the fix/undo proof.
 */
function buildFixture(source) {
  return `${source.replace(/\s+$/, '')}

## 第三章 徽章聚合

### 5 实验

##### 5 实验

## 1.1 1.1 双重编号测试
`
}

async function runAcceptance() {
  const timeoutMs = Number(argValue('timeout', '300000'))
  const token = `r14-${Date.now()}`

  await fs.mkdir(ACCEPTANCE_DIR, { recursive: true })
  const source = await fs.readFile(SOURCE_FIXTURE, 'utf8')
  await fs.writeFile(DOCUMENT, buildFixture(source), 'utf8')
  await fs.writeFile(REQUEST, `${JSON.stringify({
    token,
    requestedAt: new Date().toISOString(),
    document: path.basename(DOCUMENT),
    purpose: 'R14 body diagnostic badge runtime acceptance (copy, aggregation, panel linkage)',
  }, null, 2)}\n`, 'utf8')
  await fs.rm(REPORT, { force: true })

  console.log(`[diagnostic-badge-acceptance] token:    ${token}`)
  console.log(`[diagnostic-badge-acceptance] document: ${DOCUMENT}`)

  // Children inherit this env; the runner also admits a fresh request token.
  process.env.INKCHAPTER_DIAGNOSTIC_BADGE_ACCEPTANCE = '1'

  const loaded = await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })
  console.log(`[diagnostic-badge-acceptance] plugin loaded from vault: ${loaded}`)
  await sleep(4000)
  await openTestVault({ vaultDir: VAULT, docPath: DOCUMENT })

  const deadline = Date.now() + timeoutMs
  let report = null
  while (Date.now() < deadline) {
    await sleep(2000)
    const candidate = await readJson(REPORT)
    if (candidate && candidate.requestToken === token) { report = candidate; break }
  }

  if (!report) {
    const runtimeLoad = await readJson(RUNTIME_LOAD)
    console.error('[diagnostic-badge-acceptance] TIMEOUT: no report for this token.')
    console.error(`[diagnostic-badge-acceptance] running plugin sha: ${runtimeLoad?.mainJsSha256 ?? 'unknown'}`)
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
    markers: (report.markers ?? []).map((marker) => ({
      id: marker.identity,
      heading: marker.headingText,
      line: marker.headingLine,
      diagnostics: marker.diagnosticIds,
      badges: marker.badges.map((b) => `${b.kind}:${b.text}:${b.severity}:${b.diagnosticId}`),
    })),
    failures: report.failures ?? [],
    error: report.error,
    reportPath: REPORT,
  }
  console.log('[diagnostic-badge-acceptance] RESULT')
  console.log(JSON.stringify(result, null, 2))
  return report.verdict === 'PASS' ? 0 : 1
}

runAcceptance()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    console.error('[diagnostic-badge-acceptance] launcher error:', error)
    process.exitCode = 1
  })
