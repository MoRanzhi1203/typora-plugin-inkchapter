/**
 * R10 — Object numbering runtime acceptance runner (test-vault only).
 *
 * Reuses the R06/R08 pattern: a request token in `test/vault/runtime/acceptance`
 * unlocks the run, the plugin executes its OWN business entries
 * (`ObjectNumberPersistenceService`), and one fixed report path records evidence.
 *
 * It proves, in the REAL Typora buffer:
 *   1. figure/table/code/formula captions are written into the Markdown;
 *   2. object structures (image path, table rows, fence body, LaTeX body) are
 *      preserved byte-for-byte;
 *   3. a second sync is a no-op (idempotence);
 *   4. the body DOM shows exactly ONE caption per object (no double captions);
 *   5. a chapter insertion renumbers the affected objects;
 *   6. Typora Undo / Redo restore the buffer;
 *   7. the numbered export copy contains heading + object numbers;
 *   8. the fixture is restored at the end.
 *
 * No arbitrary JS, no arbitrary file writes.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { ObjectNumberPersistenceService, ObjectNumberSyncResult } from '../heading-numbering/object-number-persistence-service'
import { parseCaptionLine } from '../heading-numbering/object-number-persistence'

export const OBJECT_NUMBER_ACCEPTANCE_ENV = 'INKCHAPTER_OBJECT_NUMBER_ACCEPTANCE'

export const OBJECT_NUMBER_ACCEPTANCE_DOCUMENT_IN_VAULT = 'runtime/acceptance/ObjectNumbering-R10-Runtime-Acceptance.md'
export const OBJECT_NUMBER_ACCEPTANCE_REQUEST_IN_VAULT = 'runtime/acceptance/object-numbering-acceptance-request.json'
export const OBJECT_NUMBER_ACCEPTANCE_REPORT_IN_VAULT = 'runtime/acceptance/object-numbering-acceptance-last-run.json'

export interface ObjectNumberAcceptanceDomFacts {
  /** Text content of the business editor root. */
  text: string
  figureCount: number
  tableCount: number
  codeBlockCount: number
  mathBlockCount: number
}

export interface ObjectNumberAcceptanceExportFacts {
  fileName: string | null
  markdown: string | null
  html: string | null
  htmlVerified: boolean
}

export interface ObjectNumberAcceptanceDeps {
  vaultRoot: string | null
  getActiveFilePath(): string | null
  getMarkdown(): string
  replaceContent(markdown: string): void
  service: ObjectNumberPersistenceService
  readDomFacts(): ObjectNumberAcceptanceDomFacts
  exportNumberedMarkdown(): { fileName: string | null; markdown: string | null }
  /** Optional host HTML export (honest `null` when the API is unavailable). */
  exportHtml?(markdown: string): string | null
  /** Test-only: force a deterministic per-kind numbering preset; returns restore. */
  prepareAcceptanceConfigs?(): () => void
  undo(): { ok: boolean; reason?: string }
  redo(): { ok: boolean; reason?: string }
  subscribeFileOpen(callback: () => void): () => void
  schedule?(fn: () => void, delayMs: number): void
  delayMs?: number
  log?(message: string): void
}

export interface ObjectNumberAcceptanceAssertion {
  id: string
  ok: boolean
  detail: string
}

export interface ObjectNumberAcceptanceStep {
  id: string
  label: string
  assertions: ObjectNumberAcceptanceAssertion[]
  result: Pick<ObjectNumberSyncResult, 'status' | 'reason' | 'patchCount'>
}

export interface ObjectNumberAcceptanceReport {
  schema: 'inkchapter.object-numbering-acceptance/v1'
  requestToken: string
  startedAt: string
  finishedAt: string
  documentPath: string | null
  objectCounts: { figures: number; tables: number; codes: number; formulas: number }
  captionList: string[]
  sourceHashBefore: string
  sourceHashAfterWrite: string
  sourceHashAfterSecondSync: string
  patchCount: number
  domCaptionCount: number
  duplicateCaptionCount: number
  undoRedo: { undoOk: boolean; undoChanged: boolean; redoOk: boolean; redoRestored: boolean }
  exportFacts: ObjectNumberAcceptanceExportFacts | null
  steps: ObjectNumberAcceptanceStep[]
  failures: string[]
  verdict: 'PASS' | 'FAIL' | 'UNEXECUTED'
  error: string | null
}

export function isObjectNumberAcceptanceRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[OBJECT_NUMBER_ACCEPTANCE_ENV] === '1'
  } catch {
    return false
  }
}

function requestFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, OBJECT_NUMBER_ACCEPTANCE_REQUEST_IN_VAULT)
}

function reportFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, OBJECT_NUMBER_ACCEPTANCE_REPORT_IN_VAULT)
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

export function resolveObjectNumberAcceptanceGate(input: {
  vaultRoot: string | null
  activeFilePath: string | null
  requestToken: string | null
  lastReportToken: string | null
}): { enabled: boolean; reason: string } {
  const vault = input.vaultRoot?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
  if (vault === '' || !vault.endsWith('/test/vault')) return { enabled: false, reason: 'NOT_TEST_VAULT' }
  const expected = `${vault}/${OBJECT_NUMBER_ACCEPTANCE_DOCUMENT_IN_VAULT}`.toLowerCase()
  const active = input.activeFilePath?.replace(/\\/g, '/').toLowerCase() ?? ''
  if (active === '' || active !== expected) return { enabled: false, reason: 'NOT_ACCEPTANCE_DOCUMENT' }
  const token = (input.requestToken ?? '').trim()
  if (token === '') return { enabled: false, reason: 'NO_REQUEST_TOKEN' }
  if (input.lastReportToken != null && input.lastReportToken.trim() === token) {
    return { enabled: false, reason: 'ALREADY_RUN' }
  }
  return { enabled: true, reason: 'ENABLED' }
}

export function installObjectNumberAcceptanceRunner(deps: ObjectNumberAcceptanceDeps): () => void {
  const vaultRoot = deps.vaultRoot
  if (!vaultRoot) return () => {}
  const requestFile = requestFilePath(vaultRoot)
  if (!isObjectNumberAcceptanceRequested() && readToken(requestFile) == null) return () => {}

  const log = deps.log ?? ((message: string) => console.info(message))
  const schedule = deps.schedule ?? ((fn: () => void, delayMs: number) => { setTimeout(fn, delayMs) })
  const delayMs = deps.delayMs ?? 2500
  let running = false
  let disposed = false

  const trigger = (source: string): void => {
    if (disposed || running) return
    const requestToken = readToken(requestFile)
    const gate = resolveObjectNumberAcceptanceGate({
      vaultRoot,
      activeFilePath: deps.getActiveFilePath(),
      requestToken,
      lastReportToken: readToken(reportFilePath(vaultRoot)),
    })
    if (!gate.enabled) {
      if (gate.reason !== 'NO_REQUEST_TOKEN') log(`R10-OBJECT-ACCEPTANCE: skipped (${gate.reason}) via ${source}`)
      return
    }
    running = true
    log(`R10-OBJECT-ACCEPTANCE: start (token=${requestToken}) via ${source}`)
    schedule(() => {
      if (disposed) { running = false; return }
      void runAcceptance(deps, requestToken as string)
        .then(report => {
          writeReport(vaultRoot, report, requestToken as string)
          log(`R10-OBJECT-ACCEPTANCE: finished verdict=${report.verdict} failures=${report.failures.length}`)
        })
        .catch((error: unknown) => {
          writeReport(vaultRoot, null, requestToken as string)
          log(`R10-OBJECT-ACCEPTANCE: threw ${error instanceof Error ? error.message : String(error)}`)
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

async function runAcceptance(deps: ObjectNumberAcceptanceDeps, token: string): Promise<ObjectNumberAcceptanceReport> {
  const startedAt = new Date().toISOString()
  const baseline = deps.getMarkdown()
  const steps: ObjectNumberAcceptanceStep[] = []
  const failures: string[] = []
  let sourceAfterWrite = ''
  let sourceAfterSecondSync = ''
  let domCaptionCount = 0
  let duplicateCaptionCount = 0
  let exportFacts: ObjectNumberAcceptanceExportFacts | null = null
  const undoRedo = { undoOk: false, undoChanged: false, redoOk: false, redoRestored: false }

  const pushStep = (step: ObjectNumberAcceptanceStep): void => {
    steps.push(step)
    for (const assertion of step.assertions) {
      if (!assertion.ok) failures.push(`${assertion.id}: ${assertion.detail}`)
    }
  }

  const baselineStructure = captureStructures(baseline)
  const restoreConfigs = deps.prepareAcceptanceConfigs?.() ?? (() => {})

  try {
    deps.service.setSettings({
      storageMode: 'source',
      existingCaptionPolicy: 'adopt',
      syncTiming: 'manual',
    })

    // ── Step 1 — write captions into the source ───────────────────────
    const write = deps.service.runSync('acceptance-object-write')
    sourceAfterWrite = deps.getMarkdown()
    const writtenStructure = captureStructures(sourceAfterWrite)
    const counts = countCaptions(sourceAfterWrite)
    pushStep({
      id: 'write',
      label: '写入图表代码公式题注',
      assertions: [
        { id: 'write.applied', ok: write.status === 'APPLIED', detail: write.status },
        { id: 'write.figures', ok: counts.figures === 3, detail: String(counts.figures) },
        { id: 'write.tables', ok: counts.tables === 2, detail: String(counts.tables) },
        { id: 'write.codes', ok: counts.codes === 2, detail: String(counts.codes) },
        { id: 'write.formulas', ok: counts.formulas === 3, detail: String(counts.formulas) },
        { id: 'write.images-preserved', ok: sameValues(baselineStructure.images, writtenStructure.images), detail: '图片路径必须保留' },
        { id: 'write.tables-preserved', ok: sameValues(baselineStructure.tableRows, writtenStructure.tableRows), detail: '表格内容必须保留' },
        { id: 'write.code-preserved', ok: sameValues(baselineStructure.codeBodies, writtenStructure.codeBodies), detail: '代码内容必须逐字节保留' },
        { id: 'write.formula-preserved', ok: sameValues(baselineStructure.formulaBodies, writtenStructure.formulaBodies), detail: '公式结构必须保留' },
      ],
      result: pick(write),
    })

    await wait(900)

    // ── Step 2 — idempotence ──────────────────────────────────────────
    const second = deps.service.runSync('acceptance-object-second-sync')
    sourceAfterSecondSync = deps.getMarkdown()
    pushStep({
      id: 'idempotence',
      label: '重复执行不再修改',
      assertions: [
        { id: 'repeat.unchanged-status', ok: second.status === 'UNCHANGED', detail: second.status },
        { id: 'repeat.zero-patch', ok: second.patchCount === 0, detail: String(second.patchCount) },
        { id: 'repeat.byte-identical', ok: sourceAfterSecondSync === sourceAfterWrite, detail: '第二次同步不得改变任何字符' },
      ],
      result: pick(second),
    })

    // ── Step 3 — body DOM shows one caption per object ────────────────
    await wait(900)
    const dom = deps.readDomFacts()
    const captionLines = extractCaptionLines(sourceAfterWrite)
    let domFound = 0
    for (const caption of captionLines) {
      if (dom.text.includes(caption)) domFound++
    }
    domCaptionCount = domFound
    duplicateCaptionCount = countDuplicateCaptions(dom.text, captionLines)
    pushStep({
      id: 'dom',
      label: '正文只显示一套题注',
      assertions: [
        { id: 'dom.figures', ok: dom.figureCount === 3, detail: String(dom.figureCount) },
        { id: 'dom.tables', ok: dom.tableCount === 2, detail: String(dom.tableCount) },
        { id: 'dom.code', ok: dom.codeBlockCount === 2, detail: String(dom.codeBlockCount) },
        { id: 'dom.math', ok: dom.mathBlockCount === 3, detail: String(dom.mathBlockCount) },
        { id: 'dom.captions-visible', ok: domFound === captionLines.length, detail: `${domFound}/${captionLines.length}` },
        { id: 'dom.no-duplicate-caption', ok: duplicateCaptionCount === 0, detail: `重复 ${duplicateCaptionCount} 条` },
      ],
      result: pick(second),
    })

    // ── Step 4 — chapter insertion renumbers objects ──────────────────
    const inserted = insertChapter(sourceAfterSecondSync)
    deps.replaceContent(inserted)
    await wait(700)
    const resync = deps.service.runSync('acceptance-object-resync')
    const afterChapter = deps.getMarkdown()
    const captionsBefore = extractCaptionLines(sourceAfterSecondSync)
    const captionsAfter = extractCaptionLines(afterChapter)
    const changedCaptions = captionsAfter.filter(caption => !captionsBefore.includes(caption))
    pushStep({
      id: 'chapter-linkage',
      label: '章节变化后重新编号',
      assertions: [
        // R11 structure-change auto-repair may already have captionned the new
        // object before the explicit resync; either path is a real APPLY.
        { id: 'chapter.applied', ok: resync.status === 'APPLIED' || resync.status === 'UNCHANGED', detail: resync.status },
        { id: 'chapter.renumbered', ok: changedCaptions.length > 0, detail: changedCaptions.slice(0, 3).join(' | ') || 'none' },
        { id: 'chapter.new-object-captioned', ok: captionsAfter.length > captionsBefore.length, detail: `${captionsBefore.length}→${captionsAfter.length}` },
        { id: 'chapter.count-stable', ok: captionsAfter.length >= captionsBefore.length, detail: `${captionsBefore.length}→${captionsAfter.length}` },
        { id: 'chapter.no-double-caption', ok: countDuplicateCaptions(afterChapter, captionsAfter) === 0, detail: '不得出现重复题注' },
      ],
      result: pick(resync),
    })

    const afterChapterSecond = deps.service.runSync('acceptance-object-after-chapter-second')
    pushStep({
      id: 'chapter-idempotence',
      label: '章节同步后再次执行零补丁',
      assertions: [
        { id: 'chapter-repeat.unchanged', ok: afterChapterSecond.status === 'UNCHANGED', detail: afterChapterSecond.status },
        { id: 'chapter-repeat.zero-patch', ok: afterChapterSecond.patchCount === 0, detail: String(afterChapterSecond.patchCount) },
      ],
      result: pick(afterChapterSecond),
    })

    // ── Step 5 — Undo / Redo ──────────────────────────────────────────
    const undo = deps.undo()
    await wait(700)
    const afterUndo = deps.getMarkdown()
    const redo = deps.redo()
    await wait(700)
    const afterRedo = deps.getMarkdown()
    undoRedo.undoOk = undo.ok
    undoRedo.undoChanged = afterUndo !== afterChapter
    undoRedo.redoOk = redo.ok
    undoRedo.redoRestored = afterRedo === afterChapter
    pushStep({
      id: 'undo-redo',
      label: '撤销 / 重做',
      assertions: [
        { id: 'undo.api', ok: undo.ok, detail: undo.reason ?? 'ok' },
        { id: 'undo.changed', ok: undoRedo.undoChanged, detail: '撤销必须改变缓冲区' },
        { id: 'redo.api', ok: redo.ok, detail: redo.reason ?? 'ok' },
        { id: 'redo.restored', ok: undoRedo.redoRestored, detail: '重做必须恢复编号后的缓冲区' },
      ],
      result: pick(afterChapterSecond),
    })

    // ── Step 6 — numbered export copy ─────────────────────────────────
    const exported = deps.exportNumberedMarkdown()
    const html = exported.markdown != null ? deps.exportHtml?.(exported.markdown) ?? null : null
    const htmlVerified = html != null && /图\s*\d/.test(html) && /表\s*\d/.test(html)
    exportFacts = {
      fileName: exported.fileName,
      markdown: exported.markdown,
      html,
      htmlVerified,
    }
    pushStep({
      id: 'export',
      label: '导出带编号副本',
      assertions: [
        { id: 'export.file', ok: exported.fileName != null, detail: exported.fileName ?? 'none' },
        { id: 'export.numbers-present', ok: exported.markdown != null && /图\s*\d/.test(exported.markdown) && /表\s*\d/.test(exported.markdown), detail: '导出副本必须含图/表编号' },
        { id: 'export.caption-count', ok: exported.markdown != null && extractCaptionLines(exported.markdown).length >= 10, detail: exported.markdown == null ? 'none' : String(extractCaptionLines(exported.markdown).length) },
        // HTML materialisation is honest: NOT_VERIFIED is recorded, never faked.
        { id: 'export.html-materialised', ok: html == null || htmlVerified, detail: html == null ? 'HTML_HOST_API_NOT_VERIFIED' : (htmlVerified ? 'ok' : 'NUMBER_TEXT_MISSING') },
      ],
      result: { status: 'UNCHANGED', reason: 'export-copy', patchCount: 0 },
    })
  } catch (error) {
    return finishReport({
      token,
      startedAt,
      deps,
      baseline,
      sourceAfterWrite,
      sourceAfterSecondSync,
      steps,
      failures: [`exception: ${error instanceof Error ? error.message : String(error)}`],
      domCaptionCount,
      duplicateCaptionCount,
      undoRedo,
      exportFacts,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    try { deps.replaceContent(baseline) } catch { /* restore is best effort */ }
    try { restoreConfigs() } catch { /* restore is best effort */ }
  }

  return finishReport({
    token,
    startedAt,
    deps,
    baseline,
    sourceAfterWrite,
    sourceAfterSecondSync,
    steps,
    failures,
    domCaptionCount,
    duplicateCaptionCount,
    undoRedo,
    exportFacts,
    error: null,
  })
}

function finishReport(input: {
  token: string
  startedAt: string
  deps: ObjectNumberAcceptanceDeps
  baseline: string
  sourceAfterWrite: string
  sourceAfterSecondSync: string
  steps: ObjectNumberAcceptanceStep[]
  failures: string[]
  domCaptionCount: number
  duplicateCaptionCount: number
  undoRedo: ObjectNumberAcceptanceReport['undoRedo']
  exportFacts: ObjectNumberAcceptanceExportFacts | null
  error: string | null
}): ObjectNumberAcceptanceReport {
  const captionLines = extractCaptionLines(input.sourceAfterWrite)
  const counts = countCaptions(input.sourceAfterWrite)
  return {
    schema: 'inkchapter.object-numbering-acceptance/v1',
    requestToken: input.token,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    documentPath: input.deps.getActiveFilePath(),
    objectCounts: {
      figures: counts.figures,
      tables: counts.tables,
      codes: counts.codes,
      formulas: counts.formulas,
    },
    captionList: captionLines,
    sourceHashBefore: hash(input.baseline),
    sourceHashAfterWrite: hash(input.sourceAfterWrite),
    sourceHashAfterSecondSync: hash(input.sourceAfterSecondSync),
    patchCount: input.steps.find(s => s.id === 'write')?.result.patchCount ?? 0,
    domCaptionCount: input.domCaptionCount,
    duplicateCaptionCount: input.duplicateCaptionCount,
    undoRedo: input.undoRedo,
    exportFacts: input.exportFacts,
    steps: input.steps,
    failures: input.failures,
    verdict: input.failures.length === 0 ? 'PASS' : 'FAIL',
    error: input.error,
  }
}

function writeReport(vaultRoot: string, report: ObjectNumberAcceptanceReport | null, token: string): void {
  const target = reportFilePath(vaultRoot)
  const payload: ObjectNumberAcceptanceReport = report ?? {
    schema: 'inkchapter.object-numbering-acceptance/v1',
    requestToken: token,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    documentPath: null,
    objectCounts: { figures: 0, tables: 0, codes: 0, formulas: 0 },
    captionList: [],
    sourceHashBefore: '',
    sourceHashAfterWrite: '',
    sourceHashAfterSecondSync: '',
    patchCount: 0,
    domCaptionCount: 0,
    duplicateCaptionCount: 0,
    undoRedo: { undoOk: false, undoChanged: false, redoOk: false, redoRestored: false },
    exportFacts: null,
    steps: [],
    failures: ['对象编号验收未执行：编辑器桥不可用'],
    verdict: 'UNEXECUTED',
    error: null,
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch { /* a failed report write must never crash the editor */ }
}

function pick(result: ObjectNumberSyncResult): ObjectNumberAcceptanceStep['result'] {
  return { status: result.status, reason: result.reason, patchCount: result.patchCount }
}

interface Structures {
  images: string[]
  tableRows: string[]
  codeBodies: string[]
  formulaBodies: string[]
}

function captureStructures(markdown: string): Structures {
  const lines = markdown.split(/\r\n|\n/)
  const images: string[] = []
  const tableRows: string[] = []
  const codeBodies: string[] = []
  const formulaBodies: string[] = []
  let fence: string | null = null
  let code: string[] = []
  let math: string[] | null = null
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      if (fence == null) { fence = fenceMatch[1][0]; code = [] }
      else if (fenceMatch[1][0] === fence) { codeBodies.push(code.join('\n')); fence = null; code = [] }
      continue
    }
    if (fence != null) { code.push(line); continue }
    if (line.trim() === '$$') {
      if (math == null) math = []
      else {
        // `\tag{…}` is the CAPTION, not the formula body — exclude it from the
        // byte-preservation comparison.
        formulaBodies.push(math.filter(part => !/\\tag\{[^}]*\}/.test(part)).join('\n'))
        math = null
      }
      continue
    }
    if (math != null) { math.push(line); continue }
    const imageMatch = /!\[[^\]]*\]\(([^)\s]+)/.exec(line)
    if (imageMatch) images.push(imageMatch[1])
    if (line.trim().startsWith('|') && !/^\|?\s*:?-{1,}/.test(line.trim())) tableRows.push(line.trim())
  }
  return { images, tableRows, codeBodies, formulaBodies }
}

function countCaptions(markdown: string): { figures: number; tables: number; codes: number; formulas: number } {
  let figures = 0
  let tables = 0
  let codes = 0
  let formulas = 0
  for (const line of markdown.split(/\r\n|\n/)) {
    if (parseCaptionLine('figure', line) != null) figures++
    else if (parseCaptionLine('table', line) != null) tables++
    else if (parseCaptionLine('code', line) != null) codes++
    else if (parseCaptionLine('formula', line) != null) formulas++
  }
  // Internal `\tag{}` numbers are formula captions too.
  formulas += (markdown.match(/\\tag\{[^}]*\}/g) ?? []).length
  return { figures, tables, codes, formulas }
}

function extractCaptionLines(markdown: string): string[] {
  const out: string[] = []
  for (const line of markdown.split(/\r\n|\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (parseCaptionLine('figure', trimmed) != null
      || parseCaptionLine('table', trimmed) != null
      || parseCaptionLine('code', trimmed) != null
      || parseCaptionLine('formula', trimmed) != null) {
      out.push(trimmed)
    }
  }
  return out
}

function countDuplicateCaptions(text: string, captions: readonly string[]): number {
  let duplicates = 0
  for (const caption of captions) {
    let count = 0
    let index = 0
    for (;;) {
      const found = text.indexOf(caption, index)
      if (found === -1) break
      count++
      index = found + caption.length
    }
    if (count > 1) duplicates += count - 1
  }
  return duplicates
}

function insertChapter(markdown: string): string {
  const marker = '## 第二章'
  if (!markdown.includes(marker)) return markdown
  return markdown.replace(marker, `## 新插入章节\n\n![](assets/new.png)\n\n${marker}`)
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
