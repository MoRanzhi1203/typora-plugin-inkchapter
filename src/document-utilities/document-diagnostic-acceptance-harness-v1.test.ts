/**
 * R06-03 — acceptance harness (pure orchestration) regression tests.
 *
 * The fake port models a Typora buffer: markdown text, an undo/redo stack and a
 * diagnostics snapshot derived from the current text. It proves the RUNNER's
 * assertions (single fix / undo / redo / fix-all), NOT Typora's semantics.
 */
import { describe, expect, it } from 'vitest'
import type { DocumentDiagnostic, DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  analyzeInternalBlankLineGaps,
  internalBlankGapIdentity,
} from './document-diagnostic-internal-blank-lines-v1'
import {
  ACCEPTANCE_DOCUMENT_RELATIVE_PATH,
  compareDiagnosticLines,
  expectedLineAfterChange,
  expectedSingleFixMarkdown,
  resolveAcceptanceGate,
  runBlankLineAcceptanceScenarios,
  summarizeBlankSource,
  summarizeLineDiff,
  type AcceptanceHarnessPorts,
} from './document-diagnostic-acceptance-harness-v1'

const VAULT = 'D:\\repo\\test\\vault'
const DOC = 'D:\\repo\\test\\vault\\runtime\\acceptance\\Blank-Line-R06-Runtime-Acceptance.md'

function gate(vaultRoot: string | null, activeFilePath: string | null, token: string | null, last: string | null) {
  return resolveAcceptanceGate({ vaultRoot, activeFilePath, requestToken: token, lastReportToken: last })
}

describe('R06-03 gate — the ONLY admission authority', () => {
  it('enables only for the acceptance document inside a repository test vault', () => {
    expect(gate(VAULT, DOC, 't1', null)).toEqual({ enabled: true, reason: 'ENABLED' })
  })

  it('rejects a vault that is not a repository test vault', () => {
    expect(gate('D:\\notes\\my-vault', DOC, 't1', null).reason).toBe('NOT_TEST_VAULT')
    expect(gate(null, DOC, 't1', null).reason).toBe('NOT_TEST_VAULT')
  })

  it('rejects any other document, even inside the test vault', () => {
    expect(gate(VAULT, `${VAULT}\\doc.md`, 't1', null).reason).toBe('NOT_ACCEPTANCE_DOCUMENT')
    expect(gate(VAULT, null, 't1', null).reason).toBe('NOT_ACCEPTANCE_DOCUMENT')
  })

  it('requires a run token and refuses to repeat the same token', () => {
    expect(gate(VAULT, DOC, '', null).reason).toBe('NO_REQUEST_TOKEN')
    expect(gate(VAULT, DOC, 't1', 't1').reason).toBe('ALREADY_RUN')
    expect(gate(VAULT, DOC, 't2', 't1').enabled).toBe(true)
  })

  it('accepts forward slashes and file:// style separators', () => {
    const forward = DOC.replace(/\\/g, '/')
    expect(gate(VAULT.replace(/\\/g, '/'), forward, 't1', null).enabled).toBe(true)
  })

  it('keeps the published fixture path stable', () => {
    expect(ACCEPTANCE_DOCUMENT_RELATIVE_PATH).toBe('test/vault/runtime/acceptance/Blank-Line-R06-Runtime-Acceptance.md')
  })
})

describe('summarizeLineDiff — evidence without document content', () => {
  it('reports the changed range and counts', () => {
    const before = 'a\n\n\n\nb\n'
    const after = 'a\n\nb\n'
    const diff = summarizeLineDiff(before, after)
    expect(diff.beforeLineCount).toBe(6)
    expect(diff.afterLineCount).toBe(4)
    expect(diff.removedLines).toBe(2)
    expect(diff.addedLines).toBe(0)
    expect(diff.changedStartLine).toBe(3)
    expect(diff.changedEndLine).toBe(4)
  })

  it('reports no changed range for identical text', () => {
    expect(summarizeLineDiff('a\n', 'a\n')).toMatchObject({ changedStartLine: null, removedLines: 0, addedLines: 0 })
  })
})

describe('summarizeBlankSource — 空行矩阵证据', () => {
  it('records the trailing newline count and every blank run', () => {
    const source = ['# T', '', 'A', '', '', '', 'B', '', ''].join('\n')
    const shape = summarizeBlankSource(source)
    expect(shape.trailingNewlines).toBe(2)
    expect(shape.blankRuns).toEqual([1, 3, 1])
  })

  it('reports a structural-only document as run size 1', () => {
    expect(summarizeBlankSource('# T\n\nA\n').blankRuns).toEqual([1])
  })
})

// ── fake editor buffer ─────────────────────────────────────────────────────

interface FakeEditor {
  port: AcceptanceHarnessPorts
  markdown(): string
  fixCalls: string[]
  setBusyAlways(value: boolean): void
  breakUndo(): void
  /** Simulate a user edit (undoable, like the real editor transaction). */
  write(next: string): void
}

function blankSnapshot(markdown: string, key: string): DocumentDiagnosticsSnapshot {
  const diagnostics: DocumentDiagnostic[] = analyzeInternalBlankLineGaps(markdown).map(gap => ({
    id: `document:EXCESSIVE_INTERNAL_BLANK_LINES:${internalBlankGapIdentity(gap)}`,
    documentKey: key,
    severity: 'warning',
    category: 'document',
    code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
    message: '多余空行',
    detail: '',
    location: { kind: 'source-range', startLine: gap.firstBlankLine, startColumn: 0 },
    targetIdentity: internalBlankGapIdentity(gap),
    metadata: {
      firstBlankLine: gap.firstBlankLine,
      lastBlankLine: gap.lastBlankLine,
      actualBlankLines: gap.actualBlankLines,
      passMaxBlankLines: 1,
      previousBlockIdentity: gap.previousBlockIdentity,
      nextBlockIdentity: gap.nextBlockIdentity,
      previousBlockKind: gap.previousBlockKind,
      nextBlockKind: gap.nextBlockKind,
      previousBlockAnchorText: gap.previousBlockAnchorText,
      nextBlockAnchorText: gap.nextBlockAnchorText,
    },
  }))
  return {
    documentKey: key,
    revision: diagnostics.length + 1,
    sourceRevision: 1,
    generatedAt: Date.now(),
    diagnostics,
    errorCount: 0,
    warningCount: diagnostics.length,
    infoCount: 0,
  }
}

function createFakeEditor(initial: string): FakeEditor {
  const key = 'acceptance.md'
  const stack: string[] = [initial]
  let index = 0
  let busyAlways = false
  let undoBroken = false
  const fixCalls: string[] = []
  let markdown = initial

  const commit = (next: string): void => {
    markdown = next
    stack.splice(index + 1)
    stack.push(next)
    index = stack.length - 1
  }

  // The fake applies the SAME pure plan the controller would apply.
  const fixFirst = (id: string): void => {
    const expected = expectedSingleFixMarkdown(markdown, blankSnapshot(markdown, key), id)
    if (expected != null && expected !== markdown) commit(expected)
  }

  const fixAll = (): void => {
    let next = markdown
    for (const diagnostic of blankSnapshot(next, key).diagnostics) {
      const expected = expectedSingleFixMarkdown(next, blankSnapshot(next, key), diagnostic.id)
      if (expected != null) next = expected
    }
    if (next !== markdown) commit(next)
  }

  const port: AcceptanceHarnessPorts = {
    readMarkdown: () => markdown,
    getDocumentKey: () => key,
    getSnapshot: () => blankSnapshot(markdown, key),
    startFixOne: (id) => { fixCalls.push(`one:${id}`); fixFirst(id) },
    startFixAll: () => { fixCalls.push('all'); fixAll() },
    isBusy: () => busyAlways,
    undo: () => {
      if (undoBroken) return { ok: false, reason: 'UNDO_API_UNAVAILABLE' }
      if (index <= 0) return { ok: false, reason: 'NOTHING_TO_UNDO' }
      index--
      markdown = stack[index]
      return { ok: true }
    },
    redo: () => {
      if (index >= stack.length - 1) return { ok: false, reason: 'NOTHING_TO_REDO' }
      index++
      markdown = stack[index]
      return { ok: true }
    },
    undoStackLength: () => stack.length,
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 1))),
    writeMarkdown: (next) => {
      if (next === markdown) return false
      commit(next)
      return true
    },
  }

  return {
    port,
    markdown: () => markdown,
    fixCalls,
    setBusyAlways: (value) => { busyAlways = value },
    breakUndo: () => { undoBroken = true },
    write: (next) => { if (next !== markdown) commit(next) },
  }
}

const FIXTURE = [
  '# 验收',
  '',
  '正文 A',
  '',
  '',
  '',
  '',
  '正文 B',
  '',
  '',
  '',
  '',
  '正文 C',
  '',
  '',
  '',
  '',
  '正文 D',
  '',
].join('\n')

describe('runBlankLineAcceptanceScenarios — real buffer assertions', () => {
  it('PASS: single fix, undo, redo, fix all, undo, redo, restore', async () => {
    const editor = createFakeEditor(FIXTURE)
    const report = await runBlankLineAcceptanceScenarios(editor.port, {
      requestToken: 'token-1',
      documentPath: DOC,
      settleTimeoutMs: 200,
      baselineTimeoutMs: 200,
    })

    expect(report.verdict, report.failures.join(' | ')).toBe('PASS')
    expect(report.failures).toEqual([])
    expect(report.baselineDiagnostics.length).toBe(3)
    // The runner restores the fixture: the final state IS the baseline again.
    expect(report.finalDiagnostics.length).toBe(3)
    expect(report.finalMarkdownMatchesBaseline).toBe(true)
    expect(report.steps.map(s => s.id)).toEqual([
      'baseline',
      'single-fix',
      'undo-single',
      'redo-single',
      'reset-baseline',
      'stale-after-insert',
      'stale-missing',
      'fix-all',
      'undo-all',
      'redo-all',
      'restore-baseline',
    ])
    // single fix + stale-after-insert + stale-missing (refused) + fix-all
    expect(editor.fixCalls).toHaveLength(4)
    expect(editor.fixCalls.every(call =>
      call === 'all' || call.startsWith('one:document:EXCESSIVE_INTERNAL_BLANK_LINES:'))).toBe(true)
    expect(editor.fixCalls.filter(call => call === 'all')).toHaveLength(1)
    // Single fix only removed ONE gap; the rest were still there.
    const single = report.steps.find(s => s.id === 'single-fix')
    expect(single?.blankDiagnosticsBefore).toBe(3)
    expect(single?.blankDiagnosticsAfter).toBe(2)
    expect(single?.diff.removedLines).toBe(3)
    // Evidence carries hashes / counts / identities — never the document text.
    const stepKeys = Object.keys(report.steps[0])
    expect(stepKeys).not.toContain('markdown')
    expect(stepKeys).not.toContain('after')
    expect(stepKeys).not.toContain('before')
    // R07-02 — the simulated edit ran and the fix landed on the current text.
    expect(report.steps.map(step => step.id)).toContain('stale-after-insert')
    expect(report.steps.map(step => step.id)).toContain('stale-missing')
  })

  it('FAIL: an undo that does not restore the buffer is never reported as PASS', async () => {
    const editor = createFakeEditor(FIXTURE)
    editor.breakUndo()
    const report = await runBlankLineAcceptanceScenarios(editor.port, {
      requestToken: 'token-2',
      documentPath: DOC,
      settleTimeoutMs: 200,
      baselineTimeoutMs: 200,
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.failures.join('\n')).toContain('undo.restores-baseline')
  })

  it('FAIL: a fix transaction that never settles is a timeout, not a success', async () => {
    const editor = createFakeEditor(FIXTURE)
    editor.setBusyAlways(true)
    const report = await runBlankLineAcceptanceScenarios(editor.port, {
      requestToken: 'token-3',
      documentPath: DOC,
      settleTimeoutMs: 120,
      baselineTimeoutMs: 120,
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.failures.join('\n')).toContain('single.settled')
  })

  it('FAIL: a document without enough blank diagnostics cannot prove the chain', async () => {
    const editor = createFakeEditor('# 只有标题\n\n正文\n')
    const report = await runBlankLineAcceptanceScenarios(editor.port, {
      requestToken: 'token-4',
      documentPath: DOC,
      settleTimeoutMs: 120,
      baselineTimeoutMs: 120,
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.failures.join('\n')).toContain('baseline.blank-count')
  })
})

describe('R07 pure helpers', () => {
  const DOC_TEXT = ['# 标题', '', '段落一', '', '', '', '段落二', '', '段落三', ''].join('\n')

  it('expectedSingleFixMarkdown changes ONLY the target gap', () => {
    const snapshot = blankSnapshot(DOC_TEXT, 'doc')
    expect(snapshot.diagnostics).toHaveLength(1)
    const expected = expectedSingleFixMarkdown(DOC_TEXT, snapshot, snapshot.diagnostics[0].id)
    expect(expected).not.toBeNull()
    expect(expected).not.toBe(DOC_TEXT)
    // Everything except the blank run is byte-identical.
    expect(expected!.replace(/\n+/g, '\n')).toBe(DOC_TEXT.replace(/\n+/g, '\n'))
  })

  it('expectedLineAfterChange shifts only lines AFTER the change', () => {
    const diff = {
      beforeLineCount: 10,
      afterLineCount: 8,
      changedStartLine: 4,
      changedEndLine: 6,
      removedLines: 2,
      addedLines: 0,
    }
    expect(expectedLineAfterChange(2, diff)).toBe(2)
    expect(expectedLineAfterChange(5, diff)).toBeNull()
    expect(expectedLineAfterChange(9, diff)).toBe(7)
    expect(expectedLineAfterChange(null, diff)).toBeNull()
  })

  it('compareDiagnosticLines accepts the exact shift and rejects a stale line', () => {
    const diff = {
      beforeLineCount: 10,
      afterLineCount: 8,
      changedStartLine: 4,
      changedEndLine: 6,
      removedLines: 2,
      addedLines: 0,
    }
    const before = [
      { id: 'a', code: 'X', line: 2, targetIdentity: 'a' },
      { id: 'b', code: 'X', line: 9, targetIdentity: 'b' },
    ]
    const correct = [
      { id: 'a', code: 'X', line: 2, targetIdentity: 'a' },
      { id: 'b', code: 'X', line: 7, targetIdentity: 'b' },
    ]
    expect(compareDiagnosticLines(before, correct, diff).every(item => item.ok)).toBe(true)
    const stale = [
      { id: 'a', code: 'X', line: 2, targetIdentity: 'a' },
      { id: 'b', code: 'X', line: 9, targetIdentity: 'b' },
    ]
    expect(compareDiagnosticLines(before, stale, diff).some(item => !item.ok)).toBe(true)
  })
})
