// @vitest-environment jsdom
/**
 * V5.12-R6 — Empty Document Diagnostic Short-Circuit Closure.
 *
 * THE DEFECT (real fixture `regression/r58/r58-automation-input-smoke.md`,
 * BOM + CRLF only): a semantically EMPTY document published Strict-H1 errors,
 * first-H1 warnings AND the "文档为空" notice together —
 * 全部 3 / 错误 1 / 警告 1 / 提示 1.
 *
 * These kill-bug tests lock the fix: an empty (whitespace-only) Markdown source
 * is a TERMINAL diagnostics state whose snapshot is EXCLUSIVELY
 * `[DOCUMENT_EMPTY]` (error=0 / warning=0 / hint=1, locatable=false).
 *
 *   EMPTY-01  ""                                    → only DOCUMENT_EMPTY
 *   EMPTY-02  "\n\n"                                → only DOCUMENT_EMPTY
 *   EMPTY-03  " \t\r\n \n "                         → only DOCUMENT_EMPTY
 *   EMPTY-04  body without any heading              → NO empty notice, exemption kept
 *   EMPTY-05  H2 only                               → NO empty notice, strict heading runs
 *   EMPTY-06  empty → body                          → notice disappears
 *   EMPTY-07  body → empty (atomic replace)         → old errors/warnings gone
 *   EMPTY-08  H2 → empty (atomic replace)           → old heading errors gone
 *   EMPTY-09  whitespace-only edits                 → never accumulates
 *   EMPTY-10  stale revision must never overwrite   → older snapshot discarded
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { computeDocumentDiagnostics, deriveDiagnosticsState } from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import { computeDiagnosticLocationContract, hasLocatableLocation } from './document-diagnostic-location'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_EMPTY_DIAGNOSTIC_CODE,
  EMPTY_DOCUMENT_EXPECTED_HINT_COUNT,
  EMPTY_DOCUMENT_EXCLUSIVE_REASON,
  EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT,
  EMPTY_DOCUMENT_V512R6_GATE_KEYS,
  EMPTY_DOCUMENT_V512R6_GATE_LABELS,
  classifyDocumentDiagnosticRuleFamily,
  createEmptyDocumentV512R6Counters,
  evaluateEmptyDocumentV512R6Gates,
  formatEmptyDocumentV512R6GateReport,
  isSemanticallyEmptyDocument,
  measureEmptyDocumentShortCircuit,
} from './document-diagnostic-empty-short-circuit-v512-r6'

// ── pure pipeline fixtures ─────────────────────────────────────────────────
function inputOf(markdown: string | null, overrides: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:r6',
    markdown,
    strictMode: true,
    vaultRoot: 'D:/vault',
    headings: [],
    h1Facts: [],
    latentAtxMarkers: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...overrides,
  }
}

function emptyNoticeCount(diags: readonly DocumentDiagnostic[]): number {
  return diags.filter(d => d.code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE).length
}

describe('R6-PREDICATE — the minimal empty-document definition (§3)', () => {
  it('R6-PREDICATE-1: whitespace-only sources are empty; null is NOT (no active source)', () => {
    for (const s of ['', '\n', '\r\n', '\n\n', '   ', '\t', ' \t \r\n \n ', '\uFEFF\r\n']) {
      expect(isSemanticallyEmptyDocument(s), JSON.stringify(s)).toBe(true)
    }
    expect(isSemanticallyEmptyDocument(null)).toBe(false)
    expect(isSemanticallyEmptyDocument(undefined)).toBe(false)
  })

  it('R6-PREDICATE-2: body / heading / comment / fence sources are NOT empty', () => {
    for (const s of ['正文', '# 标题', '## 二级标题', '<!-- comment -->', '---', '```']) {
      expect(isSemanticallyEmptyDocument(s), JSON.stringify(s)).toBe(false)
    }
  })

  it('R6-PREDICATE-3: the rule-family classifier is measurement-only and covers every family', () => {
    expect(classifyDocumentDiagnosticRuleFamily('DOCUMENT_EMPTY')).toBe('emptyNotice')
    expect(classifyDocumentDiagnosticRuleFamily('STRICT_FIRST_H1_POSITION')).toBe('strictH1')
    expect(classifyDocumentDiagnosticRuleFamily('STRICT_SINGLE_H1_NO_H1')).toBe('strictH1')
    expect(classifyDocumentDiagnosticRuleFamily('STRICT_SINGLE_H1_MULTIPLE_H1')).toBe('strictH1')
    expect(classifyDocumentDiagnosticRuleFamily('HEADING_LEVEL_GAP')).toBe('headingStructure')
    expect(classifyDocumentDiagnosticRuleFamily('HEADING_DUPLICATE_TEXT')).toBe('headingStructure')
    expect(classifyDocumentDiagnosticRuleFamily('FIGURE_MISSING_NAME')).toBe('object')
    expect(classifyDocumentDiagnosticRuleFamily('CODE_MISSING_LANGUAGE')).toBe('object')
    expect(classifyDocumentDiagnosticRuleFamily('TABLE_MISSING_NAME')).toBe('object')
    expect(classifyDocumentDiagnosticRuleFamily('FORMULA_DUPLICATE_VISIBLE_TAG')).toBe('object')
    expect(classifyDocumentDiagnosticRuleFamily('FIGURE_LOCAL_IMAGE_MISSING')).toBe('resource')
    expect(classifyDocumentDiagnosticRuleFamily('LINK_LOCAL_TARGET_MISSING')).toBe('resource')
    expect(classifyDocumentDiagnosticRuleFamily('DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe('eof')
    expect(classifyDocumentDiagnosticRuleFamily('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe('eof')
  })
})

describe('R6-EMPTY-01..03 — a whitespace-only source publishes ONLY DOCUMENT_EMPTY', () => {
  const cases: Array<[string, string]> = [
    ['EMPTY-01', ''],
    ['EMPTY-02', '\n\n'],
    ['EMPTY-03', ' \t\r\n \n '],
  ]
  for (const [label, source] of cases) {
    it(`${label}: ${JSON.stringify(source)} → diagnosticCount=1 / error=0 / warning=0 / hint=1`, () => {
      const out = computeDocumentDiagnostics(inputOf(source))
      expect(out.diagnostics).toHaveLength(1)
      expect(out.diagnostics[0].code).toBe(DOCUMENT_EMPTY_DIAGNOSTIC_CODE)
      expect(out.diagnostics[0].message).toBe('文档为空')
      expect(out.diagnostics[0].detail).toBe('当前文档没有内容。')
      expect(out.errorCount).toBe(0)
      expect(out.warningCount).toBe(0)
      expect(out.infoCount).toBe(EMPTY_DOCUMENT_EXPECTED_HINT_COUNT)
      // §10 — no Strict-H1 / heading / object / resource / EOF rule leaked.
      const families = new Set(out.diagnostics.map(d => classifyDocumentDiagnosticRuleFamily(d.code)))
      expect([...families]).toEqual(['emptyNotice'])
    })
  }

  it('EMPTY-01b: the notice is NOT locatable (§9) and never carries a fake source target', () => {
    const out = computeDocumentDiagnostics(inputOf('\uFEFF\r\n'))
    const d = out.diagnostics[0]
    expect(d.location).toBeUndefined()
    expect(hasLocatableLocation(d.location)).toBe(false)
    expect(d.nonLocatableNotice).toBe(true)
    // The location contract must stay PASS: the notice is DECLARED non-locatable.
    const contract = computeDiagnosticLocationContract({
      documentKey: 'doc:r6', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: out.diagnostics, errorCount: out.errorCount,
      warningCount: out.warningCount, infoCount: out.infoCount,
    } as DocumentDiagnosticsSnapshot)
    expect(contract.diagnosticCount).toBe(1)
    expect(contract.locatableDiagnosticCount).toBe(0)
    expect(contract.unlocatableDiagnosticCount).toBe(0)
    expect(contract.nonLocatableNoticeCount).toBe(1)
    expect(contract.decision).toBe('PASS')
  })

  it('EMPTY-01c: the diagnostics state is not "has issues" (error=0 / warning=0)', () => {
    const out = computeDocumentDiagnostics(inputOf('   '))
    const state = deriveDiagnosticsState({
      documentKey: 'doc:r6', revision: 1, sourceRevision: 1, generatedAt: 0,
      diagnostics: out.diagnostics, errorCount: out.errorCount,
      warningCount: out.warningCount, infoCount: out.infoCount,
    } as DocumentDiagnosticsSnapshot)
    expect(state.state).not.toBe('HAS_ISSUES')
    expect(state.errorCount).toBe(0)
    expect(state.warningCount).toBe(0)
  })
})

describe('R6-EMPTY-04/05 — empty is NOT the headingCount=0 exemption (§4)', () => {
  it('EMPTY-04: ordinary body with no heading keeps the plain-body exemption (no empty notice)', () => {
    const out = computeDocumentDiagnostics(inputOf('这是一段普通正文。'))
    expect(emptyNoticeCount(out.diagnostics)).toBe(0)
    expect(out.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
    expect(out.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(false)
    expect(out.errorCount).toBe(0)
  })

  it('EMPTY-05: H2-only is NOT empty — strict heading diagnostics run normally', () => {
    const el = document.createElement('h2')
    el.setAttribute('data-line', '0')
    const out = computeDocumentDiagnostics(inputOf('## 二级标题\n', {
      headings: [{ level: 2, text: '二级标题', stableIdentity: 'h2-a', element: el }],
      h1Facts: [],
    }))
    expect(emptyNoticeCount(out.diagnostics)).toBe(0)
    expect(out.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
    expect(out.errorCount).toBeGreaterThan(0)
  })

  it('EMPTY-04b: a heading appearing immediately ends the plain-body exemption (shape gate intact)', () => {
    const body = computeDocumentDiagnostics(inputOf('正文'))
    expect(body.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
    const el = document.createElement('h2')
    el.setAttribute('data-line', '2')
    const withHeading = computeDocumentDiagnostics(inputOf('正文\n\n## H2\n', {
      headings: [{ level: 2, text: 'H2', stableIdentity: 'h2-b', element: el }],
      h1Facts: [],
    }))
    expect(withHeading.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(true)
  })
})

describe('R6-EMPTY-06..09 — the switch is an ATOMIC snapshot replacement (§13)', () => {
  it('EMPTY-06: empty → body removes the notice', () => {
    const a = computeDocumentDiagnostics(inputOf(''))
    expect(emptyNoticeCount(a.diagnostics)).toBe(1)
    const b = computeDocumentDiagnostics(inputOf('测试正文'))
    expect(emptyNoticeCount(b.diagnostics)).toBe(0)
  })

  it('EMPTY-07: body → empty clears every old diagnostic (no residue)', () => {
    const el = document.createElement('h2')
    el.setAttribute('data-line', '4')
    const before = computeDocumentDiagnostics(inputOf('正文\n\n## H2\n\n', {
      headings: [{ level: 2, text: 'H2', stableIdentity: 'h2-c', element: el }],
      h1Facts: [],
    }))
    expect(before.diagnostics.length).toBeGreaterThan(1)
    const after = computeDocumentDiagnostics(inputOf(''))
    expect(after.diagnostics).toHaveLength(1)
    const beforeIds = new Set(before.diagnostics.map(d => d.id))
    expect(after.diagnostics.some(d => beforeIds.has(d.id))).toBe(false)
  })

  it('EMPTY-08: illegal heading → empty clears all heading diagnostics', () => {
    const el = document.createElement('h2')
    el.setAttribute('data-line', '0')
    const before = computeDocumentDiagnostics(inputOf('## 二级标题\n', {
      headings: [{ level: 2, text: '二级标题', stableIdentity: 'h2-d', element: el }],
      h1Facts: [],
    }))
    expect(before.diagnostics.some(d => classifyDocumentDiagnosticRuleFamily(d.code) === 'strictH1')).toBe(true)
    const after = computeDocumentDiagnostics(inputOf('\n\n'))
    expect(after.diagnostics).toHaveLength(1)
    expect(after.diagnostics[0].code).toBe(DOCUMENT_EMPTY_DIAGNOSTIC_CODE)
  })

  it('EMPTY-09: whitespace-only edits never accumulate diagnostics', () => {
    let previousIds: string[] = []
    for (const source of ['', '\n', '   ', '\t\n', '\uFEFF\r\n']) {
      const out = computeDocumentDiagnostics(inputOf(source))
      expect(out.diagnostics).toHaveLength(1)
      expect(out.diagnostics[0].code).toBe(DOCUMENT_EMPTY_DIAGNOSTIC_CODE)
      expect(out.diagnostics.some(d => previousIds.includes(d.id))).toBe(false)
      previousIds = out.diagnostics.map(d => d.id)
    }
  })
})

describe('R6-GATES — the measurement helpers and the 13 hard gates', () => {
  const emptyDiag = (over: Partial<DocumentDiagnostic> = {}): DocumentDiagnostic => ({
    id: 'document:DOCUMENT_EMPTY:x',
    documentKey: 'doc:r6',
    severity: 'info',
    category: 'document',
    code: DOCUMENT_EMPTY_DIAGNOSTIC_CODE,
    message: '文档为空',
    nonLocatableNotice: true,
    ...over,
  })

  it('R6-GATE-1: an exclusive empty snapshot measures all 13 gates as 0', () => {
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive: true,
      diagnostics: [{ id: 'document:DOCUMENT_EMPTY:x', code: DOCUMENT_EMPTY_DIAGNOSTIC_CODE, severity: 'info', locatable: false }],
      errorCount: 0,
      warningCount: 0,
      hintCount: 1,
      uiErrorCount: 0,
      uiWarningCount: 0,
      uiHintCount: 1,
      uiTotalCount: 1,
      previousDiagnosticIds: ['document:DOCUMENT_EMPTY:x'],
    })
    for (const key of EMPTY_DOCUMENT_V512R6_GATE_KEYS) expect(measured[key], key).toBe(0)
  })

  it('R6-GATE-2: a leaked Strict-H1 error is counted in every relevant bucket', () => {
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive: true,
      diagnostics: [
        { id: 'a', code: DOCUMENT_EMPTY_DIAGNOSTIC_CODE, severity: 'info', locatable: false },
        { id: 'b', code: 'STRICT_SINGLE_H1_NO_H1', severity: 'error', locatable: false },
      ],
      errorCount: 1,
      warningCount: 0,
      hintCount: 1,
      uiErrorCount: 1,
      uiWarningCount: 0,
      uiHintCount: 1,
      uiTotalCount: 2,
      previousDiagnosticIds: ['b'],
    })
    expect(measured.emptyDocumentNonEmptyDiagnosticCount).toBe(1)
    expect(measured.emptyDocumentErrorCount).toBe(1)
    expect(measured.emptyDocumentStrictH1DiagnosticCount).toBe(1)
    expect(measured.emptyDocumentDiagnosticCountNotOne).toBe(1)
    expect(measured.emptyDocumentStaleDiagnosticResidueCount).toBe(1)
    expect(evaluateEmptyDocumentV512R6Gates(measured).decision).toBe('FAIL')
  })

  it('R6-GATE-3: a UI/snapshot count mismatch is caught (no hand-written counters)', () => {
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive: true,
      diagnostics: [{ id: 'a', code: DOCUMENT_EMPTY_DIAGNOSTIC_CODE, severity: 'info', locatable: false }],
      errorCount: 0, warningCount: 0, hintCount: 1,
      uiErrorCount: 0, uiWarningCount: 0, uiHintCount: 0, uiTotalCount: 0,
      previousDiagnosticIds: [],
    })
    expect(measured.emptyDocumentUiCountSnapshotMismatchCount).toBe(1)
  })

  it('R6-GATE-4: a locatable empty notice is a violation', () => {
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive: true,
      diagnostics: [{ id: 'a', code: DOCUMENT_EMPTY_DIAGNOSTIC_CODE, severity: 'info', locatable: true }],
      errorCount: 0, warningCount: 0, hintCount: 1,
      uiErrorCount: 0, uiWarningCount: 0, uiHintCount: 1, uiTotalCount: 1,
      previousDiagnosticIds: [],
    })
    expect(measured.emptyDocumentLocatableDiagnosticCount).toBe(1)
  })

  it('R6-GATE-5: measurement is inert for a non-empty document', () => {
    const measured = measureEmptyDocumentShortCircuit({
      shortCircuitActive: false,
      diagnostics: [{ code: 'STRICT_SINGLE_H1_NO_H1', severity: 'error', locatable: true }],
      errorCount: 1, warningCount: 0, hintCount: 0,
      uiErrorCount: 1, uiWarningCount: 0, uiHintCount: 0, uiTotalCount: 1,
      previousDiagnosticIds: [],
    })
    for (const key of EMPTY_DOCUMENT_V512R6_GATE_KEYS) expect(measured[key], key).toBe(0)
  })

  it('R6-GATE-6: the report is exactly the 13 gates and maps every key', () => {
    expect(EMPTY_DOCUMENT_V512R6_GATE_KEYS).toHaveLength(13)
    const counters = createEmptyDocumentV512R6Counters()
    expect(formatEmptyDocumentV512R6GateReport(counters)).toHaveLength(13)
    expect(evaluateEmptyDocumentV512R6Gates(counters).decision).toBe('PASS')
    counters.emptyDocumentEofDiagnosticCount = 1
    const failed = evaluateEmptyDocumentV512R6Gates(counters)
    expect(failed.decision).toBe('FAIL')
    expect(failed.failing).toContain(EMPTY_DOCUMENT_V512R6_GATE_LABELS.emptyDocumentEofDiagnosticCount)
  })
})

// ── host-level atomic publish + audit + stale revision ─────────────────────
interface Model { file: string | null; key: string | null; leafPath: string | null; markdown: string }

function makeCtx(model: Model): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: true, leafPath: model.leafPath }),
      getActiveFilePath: () => model.file,
      getDocumentKey: () => model.key,
      getMarkdown: () => model.markdown,
      isStrictMode: () => true,
      vaultRoot: '/root',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => model.file != null && model.key != null,
  }
}

function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

const hosts: DocumentUtilityOverlayHost[] = []
afterEach(() => {
  for (const h of hosts) h.dispose()
  hosts.length = 0
  vi.restoreAllMocks()
})

function makeHost(model: Model): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({
    ctx: makeCtx(model),
    providers: fakeProviders(),
    onBindDocument: (bind) => void bind,
    onActiveLeafLifecycle: () => () => undefined,
    onDiagnosticsTrigger: () => () => undefined,
  })
  h.mount()
  hosts.push(h)
  return h
}

type HostInternals = {
  admitDiagnosticsSnapshot(snapshot: DocumentDiagnosticsSnapshot, source: string): { decision: string; reason: string }
}
type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

describe('R6-HOST — empty fixture, atomic switches, audit and stale-revision guard', () => {
  it('R6-HOST-1: empty fixture → UI 全部1/错误0/警告0/提示1 + gates all 0 + audit PASS', () => {
    const model: Model = { file: 'r58-automation-input-smoke.md', key: 'r58-automation-input-smoke.md', leafPath: 'r58-automation-input-smoke.md', markdown: '\uFEFF\r\n' }
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
    const h = makeHost(model)
    h.diagnostics.recompute('R6_TEST')

    const proj = h.getCurrentProblemsProjection()
    expect(proj.documentKey).toBe(model.key)
    expect(proj.totalCount).toBe(1)
    expect(proj.errorCount).toBe(0)
    expect(proj.warningCount).toBe(0)
    expect(proj.hintCount).toBe(1)
    expect(h.getSnapshot()?.diagnostics.map(d => d.code)).toEqual([DOCUMENT_EMPTY_DIAGNOSTIC_CODE])
    expect(h.getEmptyDocumentV512R6GateDecision().decision).toBe('PASS')
    expect(h.getEmptyDocumentV512R6GateReport()).toHaveLength(13)

    const audit = readAudit(infoSpy, EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.isSemanticallyEmpty).toBe('true')
    expect(audit!.shortCircuitActivated).toBe('true')
    expect(audit!.diagnosticCount).toBe('1')
    expect(audit!.errorCount).toBe('0')
    expect(audit!.warningCount).toBe('0')
    expect(audit!.hintCount).toBe('1')
    expect(audit!.documentEmptyCount).toBe('1')
    expect(audit!.headingRuleExecuted).toBe('false')
    expect(audit!.objectRuleExecuted).toBe('false')
    expect(audit!.resourceRuleExecuted).toBe('false')
    expect(audit!.eofRuleExecuted).toBe('false')
    expect(audit!.decision).toBe('PASS')
    expect(audit!.reason).toBe(EMPTY_DOCUMENT_EXCLUSIVE_REASON)
    // VNext Presentation Closure V1.1 §17/§19 — a hint-only document shows an
    // INDEPENDENT Hint badge (segment) with the real count, and NEVER the `✓`
    // success entry (a document with a Hint is not "healthy").
    const infoSegments = document.querySelectorAll('.inkchapter-problems-control .inkchapter-toolbar-segment--info')
    expect(infoSegments).toHaveLength(1)
    expect(infoSegments[0].querySelector('.inkchapter-toolbar-segment__count')?.textContent).toBe('1')
    expect(infoSegments[0].getAttribute('data-severity')).toBe('info')
    expect(document.querySelector('.inkchapter-problems-control .inkchapter-toolbar-segment--error')).toBeNull()
    expect(document.querySelector('.inkchapter-problems-control .inkchapter-toolbar-segment--warning')).toBeNull()
    expect(document.querySelector('.inkchapter-problems-control .inkchapter-toolbar-entry.is-healthy')).toBeNull()
    // No leaked Strict-H1 / first-H1 diagnostic in the drawer rows.
    expect(document.querySelectorAll('[data-diagnostic-id]').length).toBeLessThanOrEqual(1)
    infoSpy.mockRestore()
  })

  it('R6-HOST-2: empty → body → empty → H2 switches atomically', () => {
    const model: Model = { file: 'doc.md', key: 'doc.md', leafPath: 'doc.md', markdown: '' }
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
    const h = makeHost(model)

    h.diagnostics.recompute('R6_A_EMPTY')
    expect(h.getCurrentProblemsProjection().totalCount).toBe(1)
    expect(h.getCurrentProblemsProjection().hintCount).toBe(1)

    model.markdown = '测试正文'
    h.diagnostics.recompute('R6_B_BODY')
    const body = h.getCurrentProblemsProjection()
    expect(h.getSnapshot()?.diagnostics.some(d => d.code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE)).toBe(false)
    expect(body.errorCount).toBe(0)

    model.markdown = '   \n'
    h.diagnostics.recompute('R6_C_CLEARED')
    const cleared = h.getCurrentProblemsProjection()
    expect(cleared.totalCount).toBe(1)
    expect(cleared.errorCount).toBe(0)
    expect(cleared.warningCount).toBe(0)
    expect(cleared.hintCount).toBe(1)
    expect(h.getSnapshot()?.diagnostics.map(d => d.code)).toEqual([DOCUMENT_EMPTY_DIAGNOSTIC_CODE])

    model.markdown = '## 二级标题\n'
    h.diagnostics.recompute('R6_D_H2')
    // §12.3 — the notice disappears and the normal pipeline runs again. The
    // strict-heading diagnostics themselves are driven by the real heading
    // facts (covered at the pure level by EMPTY-05); this harness has no
    // heading DOM, so the honest assertion is the pipeline re-entry itself.
    expect(h.getSnapshot()?.diagnostics.some(d => d.code === DOCUMENT_EMPTY_DIAGNOSTIC_CODE)).toBe(false)
    const audits = infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes(EMPTY_DOCUMENT_SHORT_CIRCUIT_AUDIT_EVENT))
    const last = audits[audits.length - 1]
    expect(last).toContain('shortCircuitActivated=false')
    expect(last).toContain('headingRuleExecuted=true')
    expect(last).toContain('reason=NON_EMPTY_DOCUMENT_PIPELINE')
    expect(h.getEmptyDocumentV512R6GateDecision().decision).toBe('PASS')
    infoSpy.mockRestore()
  })

  it('R6-HOST-3 (EMPTY-10): an older-revision snapshot of the same document is discarded', () => {
    const model: Model = { file: 'doc.md', key: 'doc.md', leafPath: 'doc.md', markdown: '   ' }
    const h = makeHost(model)
    h.diagnostics.recompute('R6_LATEST')
    const latest = h.getSnapshot()
    expect(latest).not.toBeNull()
    const admittedBefore = h.getAdmissionCounters().staleDiscard
    const staleProjection = h.getCurrentProblemsProjection()

    const internals = h as unknown as HostInternals
    const stale: DocumentDiagnosticsSnapshot = {
      documentKey: latest!.documentKey,
      revision: Math.max(0, latest!.revision - 1),
      sourceRevision: latest!.sourceRevision,
      generatedAt: 0,
      diagnostics: [
        { id: 'x', documentKey: latest!.documentKey ?? '', severity: 'error', category: 'document', code: 'STRICT_SINGLE_H1_NO_H1', message: 'stale' },
      ],
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
    }
    const admission = internals.admitDiagnosticsSnapshot(stale, 'R6_STALE_TEST')
    expect(admission.decision).toBe('DISCARD_STALE_DIAGNOSTICS_RESULT')
    expect(admission.reason).toBe('STALE_REVISION')
    expect(h.getAdmissionCounters().staleDiscard).toBe(admittedBefore + 1)
    // The newer [DOCUMENT_EMPTY] snapshot is untouched (never overwritten).
    expect(h.getCurrentProblemsProjection().errorCount).toBe(0)
    expect(h.getCurrentProblemsProjection().totalCount).toBe(staleProjection.totalCount)
    expect(h.getSnapshot()?.diagnostics.map(d => d.code)).toEqual([DOCUMENT_EMPTY_DIAGNOSTIC_CODE])
    expect(h.getEmptyDocumentV512R6GateDecision().decision).toBe('PASS')
  })
})
