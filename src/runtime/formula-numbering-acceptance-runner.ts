/**
 * R11 — Formula numbering runtime acceptance runner (test-vault only).
 *
 * Reuses the R06/R08/R10 pattern: a request token in
 * `test/vault/runtime/acceptance` unlocks the run, the plugin executes its OWN
 * production caption service, and one fixed report path records evidence.
 *
 * The acceptance is DOM-FIRST: every assertion reads the REAL Typora formula
 * host (`.md-math-block`), its real MathJax output and the REAL visible number
 * node. A `rawNumber` computed by the planner is never accepted as proof on its
 * own.
 *
 * Covered: single/multiple formulas, H1/H2/H3 scopes, global/section numbering,
 * empty / multi-line / aligned / cases formulas, edit + reload, heading changes,
 * formula add/remove/move, setting switches, narrow/wide widths, DOM dedupe and
 * actual visibility.
 */
import * as fs from 'fs'
import * as path from 'path'

export const FORMULA_NUMBERING_ACCEPTANCE_ENV = 'INKCHAPTER_FORMULA_NUMBER_ACCEPTANCE'

export const FORMULA_NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT = 'runtime/acceptance/FormulaNumbering-R11-Runtime-Acceptance.md'
export const FORMULA_NUMBERING_ACCEPTANCE_REQUEST_IN_VAULT = 'runtime/acceptance/formula-numbering-acceptance-request.json'
export const FORMULA_NUMBERING_ACCEPTANCE_REPORT_IN_VAULT = 'runtime/acceptance/formula-numbering-acceptance-last-run.json'

export interface FormulaNumberingRect {
  left: number
  top: number
  width: number
  height: number
}

export interface FormulaNumberingDomEntry {
  index: number
  hostClass: string
  hostConnected: boolean
  mjxContainerCount: number
  tagTexts: string[]
  decorationTexts: string[]
  visibleNumberTexts: string[]
  hostRect: FormulaNumberingRect | null
  /** MathJax formula body rect (math/svg/container), the right-alignment anchor. */
  bodyRect: FormulaNumberingRect | null
  /** Right edge (viewport x) of the furthest visible formula-content leaf. */
  contentRight?: number | null
  numberRects: FormulaNumberingRect[]
  numberRightOfHost: boolean | null
  numberVisible: boolean
  /** Nearest preceding heading (same source as the heading projection). */
  precedingHeading: FormulaNumberingHeadingFact | null
}

export interface FormulaNumberingHeadingFact {
  level: number
  text: string
  /** Heading number projected by the heading service (`data-inkchapter-heading-number`). */
  projectedNumber: string
}

export interface FormulaNumberingDomFacts {
  documentKey: string | null
  writeWidth: number
  formulas: FormulaNumberingDomEntry[]
  headings: FormulaNumberingHeadingFact[]
  /** Standalone source number paragraphs OUTSIDE the formula hosts (`（1-1）`). */
  sourceNumberParagraphCount: number
}

export interface FormulaNumberingExpectedFact {
  rawNumber: string
  renderedNumber: string
  planPresent: boolean
  hostConnected: boolean
}

export interface FormulaNumberingConfigPatch {
  enabled?: boolean
  formulaMode?: 'typora-native' | 'inkchapter'
  preset?: 'global' | 'chapter-dot' | 'section-dot' | 'chapter-dash' | 'section-dash' | 'legacy-custom'
}

export interface FormulaNumberingAcceptanceDeps {
  vaultRoot: string | null
  getActiveFilePath(): string | null
  getMarkdown(): string
  replaceContent(markdown: string): void
  readDomFacts(): FormulaNumberingDomFacts
  getExpected(): FormulaNumberingExpectedFact[]
  /** Apply a temporary Formula config; returns a restore function. */
  applyConfig(patch: FormulaNumberingConfigPatch): () => void
  /** Switch object-number persistence mode; returns a restore function. */
  applyObjectPersistenceMode(
    mode: 'render' | 'source',
    policy?: 'adopt' | 'replace' | 'preserve' | 'detect-only',
  ): () => void
  /** Write object numbers into the Markdown source (source mode only). */
  syncObjectNumbers(): { status: string; detail?: string }
  /** Temporarily force the editor body width; `null` restores the original. */
  setWriteWidth(widthPx: number | null): void
  /** Read the user's academic template fixture (read-only, no modification). */
  readUserDocument?(): string | null
  /**
   * Move a whole chapter directly in the EDITOR DOM (no document reload), the
   * closest probe for a real outline drag: existing formula hosts are NOT
   * rebuilt, so their MathJax output must be re-rendered by the plugin.
   */
  moveSectionDom?(sectionText: string, afterSectionText: string): boolean
  wait(ms: number): Promise<void> | void
  subscribeFileOpen(callback: () => void): () => void
  log?(message: string): void
}

export interface FormulaNumberingAssertion {
  id: string
  ok: boolean
  detail: string
}

export interface FormulaNumberingStep {
  id: string
  label: string
  assertions: FormulaNumberingAssertion[]
}

export interface FormulaNumberingAcceptanceReport {
  schema: 'inkchapter.formula-numbering-acceptance/v1'
  requestToken: string
  startedAt: string
  finishedAt: string
  documentPath: string | null
  steps: FormulaNumberingStep[]
  domFacts: FormulaNumberingDomFacts | null
  expected: FormulaNumberingExpectedFact[]
  failures: string[]
  verdict: 'PASS' | 'FAIL' | 'UNEXECUTED'
  error: string | null
}

export function isFormulaNumberingAcceptanceRequested(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[FORMULA_NUMBERING_ACCEPTANCE_ENV] === '1'
  } catch {
    return false
  }
}

function requestFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, FORMULA_NUMBERING_ACCEPTANCE_REQUEST_IN_VAULT)
}

function reportFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, FORMULA_NUMBERING_ACCEPTANCE_REPORT_IN_VAULT)
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

export function resolveFormulaNumberingAcceptanceGate(input: {
  vaultRoot: string | null
  activeFilePath: string | null
  requestToken: string | null
  lastReportToken: string | null
}): { enabled: boolean; reason: string } {
  const vault = input.vaultRoot?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''
  if (vault === '' || !vault.endsWith('/test/vault')) return { enabled: false, reason: 'NOT_TEST_VAULT' }
  const expected = `${vault}/${FORMULA_NUMBERING_ACCEPTANCE_DOCUMENT_IN_VAULT}`.toLowerCase()
  const active = input.activeFilePath?.replace(/\\/g, '/').toLowerCase() ?? ''
  if (active === '' || active !== expected) return { enabled: false, reason: 'NOT_ACCEPTANCE_DOCUMENT' }
  const token = (input.requestToken ?? '').trim()
  if (token === '') return { enabled: false, reason: 'NO_REQUEST_TOKEN' }
  if (input.lastReportToken != null && input.lastReportToken.trim() === token) {
    return { enabled: false, reason: 'ALREADY_RUN' }
  }
  return { enabled: true, reason: 'ENABLED' }
}

export function installFormulaNumberingAcceptanceRunner(deps: FormulaNumberingAcceptanceDeps): () => void {
  const vaultRoot = deps.vaultRoot
  if (!vaultRoot) return () => {}
  const requestFile = requestFilePath(vaultRoot)
  if (!isFormulaNumberingAcceptanceRequested() && readToken(requestFile) == null) return () => {}

  const log = deps.log ?? ((message: string) => console.info(message))
  const wait = deps.wait
  let running = false
  let disposed = false

  const trigger = (source: string): void => {
    if (disposed || running) return
    const requestToken = readToken(requestFile)
    const gate = resolveFormulaNumberingAcceptanceGate({
      vaultRoot,
      activeFilePath: deps.getActiveFilePath(),
      requestToken,
      lastReportToken: readToken(reportFilePath(vaultRoot)),
    })
    if (!gate.enabled) {
      if (gate.reason !== 'NO_REQUEST_TOKEN') log(`R11-FORMULA-ACCEPTANCE: skipped (${gate.reason}) via ${source}`)
      return
    }
    running = true
    log(`R11-FORMULA-ACCEPTANCE: start (token=${requestToken}) via ${source}`)
    void (async () => {
      try {
        // Let the first real MathJax render settle before snapshotting.
        await wait(2500)
        const report = await runAcceptance(deps, requestToken as string)
        writeReport(vaultRoot, report, requestToken as string)
        log(`R11-FORMULA-ACCEPTANCE: finished verdict=${report.verdict} failures=${report.failures.length}`)
      } catch (error) {
        writeReport(vaultRoot, failureReport(requestToken as string, error), requestToken as string)
        log(`R11-FORMULA-ACCEPTANCE: threw ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        running = false
      }
    })()
  }

  const disposeSubscription = deps.subscribeFileOpen(() => trigger('file:open'))
  trigger('install')
  return () => {
    disposed = true
    disposeSubscription()
  }
}

function failureReport(token: string, error: unknown): FormulaNumberingAcceptanceReport {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return {
    schema: 'inkchapter.formula-numbering-acceptance/v1',
    requestToken: token,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    documentPath: null,
    steps: [],
    domFacts: null,
    expected: [],
    failures: [message],
    verdict: 'FAIL',
    error: message,
  }
}

function writeReport(vaultRoot: string, report: FormulaNumberingAcceptanceReport | null, token: string): void {
  const body = report ?? failureReport(token, 'runner produced no report')
  try {
    fs.mkdirSync(path.dirname(reportFilePath(vaultRoot)), { recursive: true })
    fs.writeFileSync(reportFilePath(vaultRoot), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  } catch { /* fail-open observability */ }
}

const NUMBER_TEXT = /^[（(]\s*[0-9][0-9.\-－]*\s*[）)]$/

function normalizeNumberText(value: string): string {
  return value.replace(/[－—–]/g, '-').replace(/\s+/g, '')
}

function sameToken(observed: string, expected: string): boolean {
  const a = normalizeNumberText(observed)
  const b = normalizeNumberText(expected)
  return a === b || a === `(${b})` || `(${a})` === b
}

/**
 * R11 — formula number vs the heading projection it belongs to.
 *
 * `section` preset: prefix must equal the preceding heading number
 * (`5.3` + `5.3-1`). A formula under an H2 with no H3 legally falls back to the
 * chapter scope (`5-1` is still consistent with heading `5.1`). `global` preset
 * intentionally carries no chapter/section prefix and is not checked here.
 */
function headingPrefixConsistency(
  formulaText: string,
  heading: FormulaNumberingHeadingFact | null,
): { ok: boolean; detail: string } {
  if (!heading || heading.projectedNumber === '') return { ok: true, detail: 'no heading projection' }
  const observed = normalizeNumberText(formulaText).replace(/[（）()]/g, '')
  if (observed === '') return { ok: true, detail: 'number lives in source paragraph' }
  const prefix = observed.replace(/-[0-9]+$/, '')
  const headingNumber = heading.projectedNumber
  if (prefix === headingNumber) return { ok: true, detail: `prefix=${prefix} heading=${headingNumber}` }
  const chapter = headingNumber.split('.')[0]
  if (prefix === chapter) return { ok: true, detail: `chapter-fallback prefix=${prefix} heading=${headingNumber}` }
  return { ok: false, detail: `prefix=${prefix} heading=${headingNumber}` }
}

/** Exactly ONE visible number node per formula + visible + right of the body. */
function evaluateFormulaDom(entry: FormulaNumberingDomEntry, expected: FormulaNumberingExpectedFact | undefined): FormulaNumberingAssertion[] {
  const out: FormulaNumberingAssertion[] = []
  const prefix = `dom.f${entry.index}`
  const visible = entry.visibleNumberTexts
  out.push({
    id: `${prefix}.visible-count`,
    ok: visible.length === 1,
    detail: `visible=${JSON.stringify(visible)} tag=${JSON.stringify(entry.tagTexts)} deco=${JSON.stringify(entry.decorationTexts)}`,
  })
  out.push({
    id: `${prefix}.not-duplicated`,
    ok: entry.tagTexts.length + entry.decorationTexts.length <= 1,
    detail: `tag=${entry.tagTexts.length} decoration=${entry.decorationTexts.length}`,
  })
  out.push({ id: `${prefix}.rendered`, ok: entry.numberVisible, detail: entry.numberVisible ? 'visible' : 'not visible (rect/display)' })
  out.push({
    id: `${prefix}.right-aligned`,
    ok: entry.numberRightOfHost === true,
    detail: `numberRightOfHost=${String(entry.numberRightOfHost)}`,
  })
  if (expected && expected.rawNumber !== '') {
    out.push({
      id: `${prefix}.matches-plan`,
      ok: visible.length === 1 && sameToken(visible[0], expected.rawNumber),
      detail: `observed=${visible[0] ?? 'none'} expected=${expected.rawNumber}`,
    })
  }
  return out
}

function allFormulasHaveOneNumber(facts: FormulaNumberingDomFacts): FormulaNumberingAssertion[] {
  const out: FormulaNumberingAssertion[] = []
  out.push({
    id: 'dom.host-count',
    ok: facts.formulas.length > 0,
    detail: String(facts.formulas.length),
  })
  out.push({
    id: 'dom.every-host-connected',
    ok: facts.formulas.every(f => f.hostConnected),
    detail: facts.formulas.map(f => String(f.hostConnected)).join(','),
  })
  return out
}

function extractFormulaSnippets(markdown: string): string[] {
  const out: string[] = []
  const re = /\$\$([\s\S]*?)\$\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) out.push(m[1])
  return out
}

function replaceFormulaSnippet(markdown: string, index: number, replacement: string): string {
  let seen = -1
  return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (whole) => {
    seen++
    return seen === index ? replacement : whole
  })
}

function insertFormulaBefore(markdown: string, index: number, body: string): string {
  let seen = -1
  let inserted = false
  const result = markdown.replace(/\$\$([\s\S]*?)\$\$/g, (whole) => {
    seen++
    if (!inserted && seen === index) {
      inserted = true
      return `$$\n${body}\n$$\n\n${whole}`
    }
    return whole
  })
  return inserted ? result : `${markdown}\n\n$$\n${body}\n$$\n`
}

function removeFormula(markdown: string, index: number): string {
  let seen = -1
  return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (whole) => {
    seen++
    return seen === index ? '' : whole
  })
}

function swapFormulas(markdown: string, a: number, b: number): string {
  const snippets = extractFormulaSnippets(markdown)
  if (a >= snippets.length || b >= snippets.length) return markdown
  let seen = -1
  return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (whole) => {
    seen++
    if (seen === a) return `$$\n${snippets[b].trim()}\n$$`
    if (seen === b) return `$$\n${snippets[a].trim()}\n$$`
    return whole
  })
}

/**
 * Move a whole H2 section (heading + its H3 subsections + bodies) to the end of
 * another H2 section. This is the closest buffer-level equivalent of dragging a
 * chapter in Typora's outline: heading order, chapter/section ordinals and all
 * formula scopes change while the formula bodies stay byte-identical.
 */
function moveSectionAfter(markdown: string, sectionHeading: string, afterHeading: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.trim() === sectionHeading)
  if (start < 0) return markdown
  let end = start + 1
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++
  const section = lines.slice(start, end)
  const remaining = [...lines.slice(0, start), ...lines.slice(end)]
  const afterStart = remaining.findIndex(line => line.trim() === afterHeading)
  if (afterStart < 0) return markdown
  let afterEnd = afterStart + 1
  while (afterEnd < remaining.length && !/^#{1,2}\s/.test(remaining[afterEnd])) afterEnd++
  return [...remaining.slice(0, afterEnd), ...section, ...remaining.slice(afterEnd)].join('\n')
}

async function runAcceptance(deps: FormulaNumberingAcceptanceDeps, token: string): Promise<FormulaNumberingAcceptanceReport> {
  const startedAt = new Date().toISOString()
  const steps: FormulaNumberingStep[] = []
  const failures: string[] = []
  const template = deps.getMarkdown()
  let lastFacts: FormulaNumberingDomFacts | null = null
  let lastExpected: FormulaNumberingExpectedFact[] = []
  const restoreConfig = deps.applyConfig({ enabled: true, formulaMode: 'inkchapter', preset: 'section-dash' })

  const push = (id: string, label: string, assertions: FormulaNumberingAssertion[]): void => {
    steps.push({ id, label, assertions })
    for (const a of assertions) if (!a.ok) failures.push(`${a.id}: ${a.detail}`)
  }

  const pushHeadingConsistency = (id: string, label: string, facts: FormulaNumberingDomFacts): void => {
    push(id, label, facts.formulas.map((f, i) => {
      const observed = f.visibleNumberTexts[0] ?? ''
      const consistency = headingPrefixConsistency(observed, f.precedingHeading)
      return {
        id: `${id}.f${i}`,
        ok: consistency.ok,
        detail: `${consistency.detail}; formula=${observed || 'none'} heading=${f.precedingHeading?.text ?? 'none'}`,
      }
    }))
  }

  const snapshot = async (): Promise<{ facts: FormulaNumberingDomFacts; expected: FormulaNumberingExpectedFact[] }> => {
    await deps.wait(1200)
    const facts = deps.readDomFacts()
    const expected = deps.getExpected()
    lastFacts = facts
    lastExpected = expected
    return { facts, expected }
  }

  try {
    // ── 1. Initial: every formula has exactly one visible number ───────
    {
      const { facts, expected } = await snapshot()
      const assertions = [
        ...allFormulasHaveOneNumber(facts),
        {
          id: 'initial.formula-count',
          ok: facts.formulas.length === expected.length && facts.formulas.length === 7,
          detail: `dom=${facts.formulas.length} plan=${expected.length}`,
        },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ]
      push('initial', '真实公式节点显示唯一编号', assertions)
    }

    // ── 2. H1/H2/H3 scoped numbering (section-dash) ─────────────────────
    {
      const expected = lastExpected.map(e => e.rawNumber)
      push('scope-section', 'H1/H2/H3 章节联动编号', [
        { id: 'scope.count', ok: expected.length >= 5, detail: expected.join(' | ') },
        { id: 'scope.first', ok: expected[0] === '1.1-1', detail: expected[0] ?? 'none' },
        { id: 'scope.second', ok: expected[1] === '1.2-1', detail: expected[1] ?? 'none' },
        { id: 'scope.multi', ok: expected[2] === '1.2-2', detail: expected[2] ?? 'none' },
        // A formula directly under H2 has no H3 section; the documented legal
        // fallback is the chapter scope (`2-1`), never a fabricated `2.0-1`.
        { id: 'scope.chapter-reset', ok: expected.some(v => v.startsWith('2-') || v.startsWith('2.1-')), detail: expected.join(' | ') },
      ])
      const factsNow = lastFacts as FormulaNumberingDomFacts | null
      if (factsNow) {
        pushHeadingConsistency('scope-heading-consistency', '节内编号与前置标题编号一致', factsNow)
      }
    }

    // ── 3. Chapter-dash preset (the saved user preset) ──────────────────
    {
      const restore = deps.applyConfig({ preset: 'chapter-dash' })
      const { facts, expected } = await snapshot()
      const chapterNumbers = expected.map(e => e.rawNumber)
      push('setting-chapter-dash', '按章编号设置下立即刷新', [
        { id: 'chapter-dash.plan', ok: chapterNumbers.slice(0, 3).join(',') === '1-1,1-2,1-3', detail: chapterNumbers.join(' | ') },
        { id: 'chapter-dash.dom', ok: facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')), detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | ') },
      ])
      restore()
      await deps.wait(1200)
    }

    // ── 4. Global numbering setting ─────────────────────────────────────
    {
      const restore = deps.applyConfig({ preset: 'global' })
      const { facts, expected } = await snapshot()
      const globalNumbers = expected.map(e => e.rawNumber)
      push('setting-global', '切换全局编号后立即刷新', [
        { id: 'global.plan', ok: globalNumbers.slice(0, 3).join(',') === '1,2,3', detail: globalNumbers.join(' | ') },
        { id: 'global.dom', ok: facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')), detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | ') },
      ])
      restore()
      await deps.wait(1200)
    }

    // ── 4. Section numbering setting (restored baseline) ────────────────
    {
      const { facts, expected } = await snapshot()
      push('setting-section', '切换节内编号后立即刷新', [
        { id: 'section.plan', ok: expected[0]?.rawNumber === '1.1-1', detail: expected[0]?.rawNumber ?? 'none' },
        { id: 'section.dom', ok: facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')), detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | ') },
      ])
    }

    // ── 5. Empty formula also carries a number ──────────────────────────
    {
      const emptyIndex = extractFormulaSnippets(deps.getMarkdown()).findIndex(s => s.trim() === '')
      const factsNow = lastFacts as FormulaNumberingDomFacts | null
      const emptyEntry = emptyIndex >= 0 ? factsNow?.formulas[emptyIndex] : undefined
      push('empty-formula', '空公式仍占用编号且编号可见', [
        { id: 'empty.exists', ok: emptyIndex >= 0, detail: String(emptyIndex) },
        {
          id: 'empty.visible-number',
          ok: emptyIndex >= 0 && (emptyEntry?.visibleNumberTexts.length ?? 0) === 1,
          detail: JSON.stringify(emptyEntry?.visibleNumberTexts ?? []),
        },
        {
          id: 'empty.matches-plan',
          ok: emptyIndex >= 0 && sameToken(emptyEntry?.visibleNumberTexts[0] ?? '', lastExpected[emptyIndex]?.rawNumber ?? ''),
          detail: `${emptyEntry?.visibleNumberTexts[0] ?? 'none'} / ${lastExpected[emptyIndex]?.rawNumber ?? 'none'}`,
        },
      ])
    }

    // ── 6. Edit a formula in place (source change) ──────────────────────
    {
      const edited = replaceFormulaSnippet(deps.getMarkdown(), 0, '$$\na = 10\n$$')
      deps.replaceContent(edited)
      const { facts, expected } = await snapshot()
      push('formula-edit', '编辑公式后编号保持稳定', [
        { id: 'edit.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 7. Add a formula in the same section ────────────────────────────
    {
      const added = insertFormulaBefore(deps.getMarkdown(), 1, 'd = 4')
      deps.replaceContent(added)
      const { facts, expected } = await snapshot()
      push('formula-add', '新增公式后同节后续公式递增', [
        { id: 'add.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 8. Remove a formula (same section) ──────────────────────────────
    {
      const removed = removeFormula(deps.getMarkdown(), 2)
      deps.replaceContent(removed)
      const { facts, expected } = await snapshot()
      push('formula-remove', '删除公式后同节后续公式递减', [
        { id: 'remove.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 9. Move a formula across scopes ─────────────────────────────────
    {
      const moved = swapFormulas(deps.getMarkdown(), 0, 3)
      deps.replaceContent(moved)
      const { facts, expected } = await snapshot()
      push('formula-move', '公式跨节移动后重新编号', [
        { id: 'move.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 10. Heading text change must not destroy numbering ──────────────
    {
      const retitled = deps.getMarkdown().replace('## 研究背景', '## 研究背景（已改名）')
      deps.replaceContent(retitled)
      const { facts, expected } = await snapshot()
      push('heading-retitle', '标题改名后公式编号保持', [
        { id: 'retitle.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 11. Heading move / level change renumbers formulas ──────────────
    {
      const movedHeading = deps.getMarkdown()
        .replace('### 数据特征', '## 数据特征')
        .replace('### 模型构建', '## 模型构建')
      deps.replaceContent(movedHeading)
      const { facts, expected } = await snapshot()
      push('heading-level', '标题层级变化后公式重新编号', [
        { id: 'level.count', ok: facts.formulas.length === expected.length, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 12. Narrow / wide body width ────────────────────────────────────
    {
      deps.setWriteWidth(520)
      const narrow = await snapshot()
      deps.setWriteWidth(1100)
      const wide = await snapshot()
      deps.setWriteWidth(null)
      push('width', '窄窗口与宽窗口编号位置稳定', [
        { id: 'width.narrow', ok: narrow.facts.formulas.every(f => f.visibleNumberTexts.length === 1 && f.numberVisible && f.numberRightOfHost === true), detail: JSON.stringify(narrow.facts.formulas.map(f => f.numberVisible)) },
        { id: 'width.wide', ok: wide.facts.formulas.every(f => f.visibleNumberTexts.length === 1 && f.numberVisible && f.numberRightOfHost === true), detail: JSON.stringify(wide.facts.formulas.map(f => f.numberVisible)) },
        { id: 'width.no-duplicate', ok: narrow.facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1) && wide.facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1), detail: '每式最多一个编号节点' },
      ])
    }

    // ── 13. Disabled setting → no number (state follows the setting) ────
    {
      const restore = deps.applyConfig({ enabled: false })
      const { facts } = await snapshot()
      push('setting-disabled', '关闭公式编号后不再投影', [
        { id: 'disabled.no-number', ok: facts.formulas.every(f => f.tagTexts.length === 0 && f.decorationTexts.length === 0), detail: JSON.stringify(facts.formulas.map(f => f.tagTexts)) },
      ])
      restore()
      await deps.wait(1200)
    }

    // ── 14. Typora-native configured but unavailable → takeover ─────────
    {
      const restore = deps.applyConfig({ enabled: true, formulaMode: 'typora-native', preset: 'section-dash' })
      const { facts, expected } = await snapshot()
      push('setting-native-fallback', '原生不可用时墨章接管编号', [
        { id: 'fallback.visible', ok: facts.formulas.length === expected.length && facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')), detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | ') },
        { id: 'fallback.dedupe', ok: facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1), detail: '不得出现双编号' },
      ])
      restore()
      await deps.wait(1200)
    }

    // ── 15. Source persistence mode: per-formula dedupe only when valid ──
    {
      const restore = deps.applyObjectPersistenceMode('source')
      await deps.wait(1200)
      const beforeSync = deps.readDomFacts()
      push('source-before-sync', '源码模式尚无源码编号时仍显示投影', [
        { id: 'source-before.visible', ok: beforeSync.formulas.length > 0 && beforeSync.formulas.every(f => f.visibleNumberTexts.length === 1), detail: beforeSync.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | ') },
      ])
      // Simulate an already-persisted source number for the FIRST formula only.
      const firstNumber = deps.getExpected()[0]?.rawNumber ?? ''
      let seen = -1
      const withSourceNumber = deps.getMarkdown().replace(/\$\$([\s\S]*?)\$\$/g, (whole) => {
        seen++
        return seen === 0 && firstNumber !== '' ? `${whole}\n\n（${firstNumber}）` : whole
      })
      deps.replaceContent(withSourceNumber)
      await deps.wait(1800)
      const afterSync = deps.readDomFacts()
      const expectedAfter = deps.getExpected()
      const firstFormula = afterSync.formulas[0]
      push('source-after-sync', '源码已有有效编号后才允许去重', [
        { id: 'source-after.paragraphs', ok: afterSync.sourceNumberParagraphCount > 0, detail: String(afterSync.sourceNumberParagraphCount) },
        {
          id: 'source-after.first-deduped',
          ok: firstFormula != null && firstFormula.tagTexts.length + firstFormula.decorationTexts.length === 0,
          detail: `tag=${JSON.stringify(firstFormula?.tagTexts ?? [])} deco=${JSON.stringify(firstFormula?.decorationTexts ?? [])}`,
        },
        {
          id: 'source-after.others-visible',
          ok: afterSync.formulas.slice(1).every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expectedAfter[i + 1]?.rawNumber ?? '')),
          detail: afterSync.formulas.slice(1).map(f => f.visibleNumberTexts[0] ?? 'none').join(' | '),
        },
        { id: 'source-after.no-double', ok: afterSync.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1), detail: '不得出现第二套编号' },
      ])
      restore()
      await deps.wait(1500)
    }

    // ── 16. Reload the document from its template ───────────────────────
    {
      deps.replaceContent(template)
      const { facts, expected } = await snapshot()
      push('document-reload', '文档重新加载后编号恢复', [
        { id: 'reload.count', ok: facts.formulas.length === expected.length && facts.formulas.length === 7, detail: `${facts.formulas.length}/${expected.length}` },
        ...facts.formulas.flatMap((f, i) => evaluateFormulaDom(f, expected[i])),
      ])
    }

    // ── 17. Whole chapter move (outline drag equivalent) ────────────────
    {
      const restore = deps.applyConfig({ preset: 'section-dash' })
      await deps.wait(1200)
      const expectedBefore = deps.getExpected()
      const moved = moveSectionAfter(deps.getMarkdown(), '## 研究背景', '## 实验设置')
      deps.replaceContent(moved)
      const { facts, expected } = await snapshot()
      push('chapter-move', '整节移动后公式编号随章节更新', [
        { id: 'chapter-move.count', ok: facts.formulas.length === 7 && expected.length === 7, detail: `${facts.formulas.length}/${expected.length}` },
        // 实验设置 becomes chapter section 1, 研究背景 becomes section 2:
        // D/E → 1-1,1-2 (H2 body, chapter fallback), A → 2.1-1, B/C → 2.2-1,2.2-2.
        { id: 'chapter-move.scope', ok: expected.slice(0, 3).map(e => e.rawNumber).join(',') === '1-1,1-2,2.1-1' && expected.slice(3, 5).map(e => e.rawNumber).join(',') === '2.2-1,2.2-2', detail: expected.map(e => e.rawNumber).join(' | ') },
        {
          id: 'chapter-move.dom',
          ok: facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')),
          detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | '),
        },
        {
          id: 'chapter-move.renumbered',
          ok: expectedBefore[0]?.rawNumber === '1.1-1' && expected[2]?.rawNumber === '2.1-1',
          detail: `${expectedBefore[0]?.rawNumber ?? 'none'} → ${expected[2]?.rawNumber ?? 'none'}`,
        },
      ])
      pushHeadingConsistency('chapter-move-heading-consistency', '整节移动后公式与标题编号一致', facts)
      restore()
      await deps.wait(1500)
    }

    // ── 18. Real DOM-level chapter move (formula hosts are NOT rebuilt) ─
    {
      const restore = deps.applyConfig({ preset: 'section-dash' })
      deps.replaceContent(template)
      await deps.wait(1500)
      const before = deps.readDomFacts()
      const moved = deps.moveSectionDom?.('研究背景', '实验设置') ?? false
      // Deliberately SHORT settle window: a real drag must update the number in
      // the same event-driven pass, not after a later unrelated refresh.
      await deps.wait(800)
      const after = deps.readDomFacts()
      const headingNumberOf = (facts: FormulaNumberingDomFacts, text: string): string =>
        facts.headings.find(h => h.text.includes(text))?.projectedNumber ?? ''
      const beforeResearch = headingNumberOf(before, '研究背景')
      const afterResearch = headingNumberOf(after, '研究背景')
      push('chapter-move-dom', '直接移动章节 DOM 后编号随章节更新', [
        { id: 'dom-move.applied', ok: moved, detail: String(moved) },
        {
          id: 'dom-move.count',
          ok: before.formulas.length === 7 && after.formulas.length === 7,
          detail: `${before.formulas.length}→${after.formulas.length}`,
        },
        {
          id: 'dom-move.heading-linkage',
          ok: beforeResearch === '1' && afterResearch === '2' && after.formulas[2]?.visibleNumberTexts[0] === '(2.1-1)',
          detail: `研究背景 ${beforeResearch || 'none'}→${afterResearch || 'none'}; formula=${after.formulas[2]?.visibleNumberTexts[0] ?? 'none'}`,
        },
        {
          id: 'dom-move.renumbered',
          ok: after.formulas[2]?.visibleNumberTexts[0] === '(2.1-1)',
          detail: after.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | '),
        },
        {
          id: 'dom-move.no-duplicate',
          ok: after.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1),
          detail: after.formulas.map(f => `tag=${f.tagTexts.length},deco=${f.decorationTexts.length}`).join(' | '),
        },
      ])
      pushHeadingConsistency('dom-move-heading-consistency', '直接移动章节 DOM 后公式与标题编号一致', after)
      deps.replaceContent(template)
      await deps.wait(1200)
      restore()
    }

    // ── 19. Source persistence: structure commit repairs stale numbers ──
    {
      const restore = deps.applyObjectPersistenceMode('source', 'adopt')
      deps.replaceContent(template)
      await deps.wait(1500)
      // Force a stale source number under the first formula.
      const staleDocument = deps.getMarkdown().replace(
        /\$\$([\s\S]*?)\$\$/,
        (whole) => `${whole}\n\n（9-9）`,
      )
      deps.replaceContent(staleDocument)
      await deps.wait(1200)
      // A chapter move invalidates the persisted number; auto-repair must
      // rewrite the SOURCE (syncTiming is manual here).
      const movedSource = moveSectionAfter(deps.getMarkdown(), '## 研究背景', '## 实验设置')
      deps.replaceContent(movedSource)
      await deps.wait(3000)
      const repaired = deps.getMarkdown()
      const facts = deps.readDomFacts()
      push('source-structure-repair', '结构变化后自动修正失效源码编号', [
        { id: 'source-repair.stale-removed', ok: !repaired.includes('（9-9）'), detail: repaired.includes('（9-9）') ? 'still present' : 'replaced' },
        {
          id: 'source-repair.new-number',
          ok: /（2(?:\.\d+)?-1）/.test(repaired),
          detail: /（2(?:\.\d+)?-1）/.exec(repaired)?.[0] ?? 'missing',
        },
        {
          id: 'source-repair.source-numbers',
          ok: facts.sourceNumberParagraphCount >= 7,
          detail: String(facts.sourceNumberParagraphCount),
        },
        {
          id: 'source-repair.no-double',
          ok: facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1)
            && facts.formulas.every(f => f.visibleNumberTexts.length <= 1),
          detail: facts.formulas.map(f => `tag=${f.tagTexts.length},deco=${f.decorationTexts.length}`).join(' | '),
        },
      ])
      deps.replaceContent(template)
      await deps.wait(1200)
      restore()
    }

    // ── 20. The user's real academic template (5.3 formula) ─────────────
    {
      const userDocument = deps.readUserDocument?.() ?? null
      if (userDocument == null) {
        push('user-document', '用户学术模板中的公式显示编号', [
          { id: 'user.available', ok: false, detail: 'user template unavailable' },
        ])
      } else {
        deps.replaceContent(userDocument)
        const { facts, expected } = await snapshot()
        push('user-document', '用户学术模板中的公式显示编号', [
          { id: 'user.count', ok: facts.formulas.length === 2 && expected.length === 2, detail: `${facts.formulas.length}/${expected.length}` },
          {
            id: 'user.visible',
            ok: facts.formulas.length > 0 && facts.formulas.every((f, i) => f.visibleNumberTexts.length === 1 && sameToken(f.visibleNumberTexts[0], expected[i]?.rawNumber ?? '')),
            detail: facts.formulas.map(f => f.visibleNumberTexts[0] ?? 'none').join(' | '),
          },
          { id: 'user.right-aligned', ok: facts.formulas.every(f => f.numberRightOfHost === true), detail: JSON.stringify(facts.formulas.map(f => f.numberRightOfHost)) },
          // The template's first formula is under `数据与方法 → 模型构建` (chapter 5).
          // Assert chapter linkage without hard-coding the screenshot's `5.3-1`:
          // chapter-dash gives `5-1`, section-dash gives `5.3-1` — both are valid.
          { id: 'user.chapter-linkage', ok: /^5(?:\.\d+)?-1$/.test(expected[0]?.rawNumber ?? ''), detail: expected[0]?.rawNumber ?? 'none' },
          { id: 'user.no-double', ok: facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1), detail: '不得出现双编号' },
        ])

        // Move the user's real chapter `数据与方法` after `实验结果` and verify
        // BOTH the heading projection and the formula number follow the move.
        const movedUser = moveSectionAfter(userDocument, '## 数据与方法', '## 实验结果')
        if (movedUser !== userDocument) {
          deps.replaceContent(movedUser)
          const moved = await snapshot()
          const headingNumberOf = (text: string): string =>
            moved.facts.headings.find(h => h.text.includes(text))?.projectedNumber ?? ''
          push('user-document-move', '用户学术模板章节移动后编号联动', [
            { id: 'user-move.count', ok: moved.facts.formulas.length === 2, detail: String(moved.facts.formulas.length) },
            {
              id: 'user-move.formula',
              ok: moved.expected[0]?.rawNumber === '6.3-1' && moved.facts.formulas[0]?.visibleNumberTexts[0] === '(6.3-1)',
              detail: `plan=${moved.expected[0]?.rawNumber ?? 'none'} dom=${moved.facts.formulas[0]?.visibleNumberTexts[0] ?? 'none'}`,
            },
            {
              id: 'user-move.heading',
              ok: headingNumberOf('模型构建') === '6.3',
              detail: `模型构建=${headingNumberOf('模型构建') || 'none'}`,
            },
            {
              id: 'user-move.no-double',
              ok: moved.facts.formulas.every(f => f.tagTexts.length + f.decorationTexts.length <= 1),
              detail: moved.facts.formulas.map(f => `tag=${f.tagTexts.length},deco=${f.decorationTexts.length}`).join(' | '),
            },
          ])
          pushHeadingConsistency('user-move-heading-consistency', '用户模板移动后公式与标题编号一致', moved.facts)
          // Restore the user's original template (read-only fixture).
          deps.replaceContent(userDocument)
          await deps.wait(1200)
          await snapshot()
        }
      }
    }

    const verdict: FormulaNumberingAcceptanceReport['verdict'] = failures.length === 0 ? 'PASS' : 'FAIL'
    return {
      schema: 'inkchapter.formula-numbering-acceptance/v1',
      requestToken: token,
      startedAt,
      finishedAt: new Date().toISOString(),
      documentPath: deps.getActiveFilePath(),
      steps,
      domFacts: lastFacts,
      expected: lastExpected,
      failures,
      verdict,
      error: null,
    }
  } finally {
    deps.setWriteWidth(null)
    restoreConfig()
    try { deps.replaceContent(template) } catch { /* restore best effort */ }
  }
}

export const FORMULA_NUMBER_TEXT_PATTERN = NUMBER_TEXT
