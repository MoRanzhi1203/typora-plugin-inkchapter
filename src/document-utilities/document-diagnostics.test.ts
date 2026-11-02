// @vitest-environment jsdom
/**
 * Phase 7R.3.11 — Document Diagnostics authority compute tests (DIAG-*).
 *
 * Pure, authority-driven: consumes structured facts, never re-derives
 * numbering semantics. No timers / polling in the code under test.
 */
import { describe, it, expect } from 'vitest'
import {
  computeDocumentDiagnostics,
  computeEofNewlinePolicy,
  deduplicateDiagnostics,
  deriveDiagnosticsState,
} from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n\n',
    strictMode: true,
    vaultRoot: '/vault',
    headings: [],
    figures: [],
    tables: [],
    codes: [],
    formulas: [],
    links: [],
    canonicalDuplicateIdentities: [],
    captionDuplicateNames: [],
    ...partial,
  }
}

const el = (): HTMLElement => document.createElement('div')

describe('DIAG-1 healthy document', () => {
  it('reports zero errors/warnings for a well-formed strict document', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '# 一级标题\n\n## 二级\n\n正文\n\n',
        headings: [
          { level: 1, text: '一级标题', element: el() },
          { level: 2, text: '二级', element: el() },
        ],
        h1Facts: [{ stableIdentity: 'h1-1', element: el() }],
        figures: [{ name: '系统架构', element: el() }],
      }),
    )
    expect(r.errorCount).toBe(0)
    expect(r.warningCount).toBe(0)
    const snapshot = { documentKey: 'doc:a', revision: 1, sourceRevision: 1, generatedAt: 0, diagnostics: r.diagnostics, errorCount: r.errorCount, warningCount: r.warningCount, infoCount: r.infoCount }
    expect(deriveDiagnosticsState(snapshot).state).toBe('HEALTHY')
  })
})

describe('DIAG-2 strict heading gap', () => {
  it('reports HEADING_LEVEL_GAP for H1→H2→H4 without fabricating a number', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '# H1\n\n## H2\n\n#### H4\n',
        headings: [
          { level: 1, text: 'H1', element: el() },
          { level: 2, text: 'H2', element: el() },
          { level: 4, text: 'H4', element: el() },
        ],
      }),
    )
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap).toBeTruthy()
    // Phase 7R.3.11.8B.4 — strict mode → HEADING_LEVEL_GAP severity = ERROR.
    expect(gap!.severity).toBe('error')
    expect(gap!.detail).toContain('缺少 H3')
    expect(gap!.metadata?.missingLevels).toEqual([3])
    // No fabricated hierarchical number like 1.0.1 appears anywhere.
    expect(JSON.stringify(r.diagnostics)).not.toMatch(/1\.0\.\d/)
  })

  it('reports HEADING_LEVEL_GAP even in loose mode (structure lint uses physical levels)', () => {
    const r = computeDocumentDiagnostics(
      input({
        strictMode: false,
        markdown: '## H2\n\n#### H4\n',
        headings: [
          { level: 2, text: 'H2', element: el() },
          { level: 4, text: 'H4', element: el() },
        ],
      }),
    )
    const gap = r.diagnostics.find(d => d.code === 'HEADING_LEVEL_GAP')
    expect(gap).toBeTruthy()
    // Phase 7R.3.11.8B.4 — loose mode → HEADING_LEVEL_GAP severity = WARNING.
    expect(gap!.severity).toBe('warning')
  })
})

describe('DIAG-3 multiple strict H1 boundaries', () => {
  it('does NOT report a generic multiple-H1 error (valid numbering boundary)', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '# 第一章\n\n# 第二章\n',
        headings: [
          { level: 1, text: '第一章', element: el() },
          { level: 1, text: '第二章', element: el() },
        ],
      }),
    )
    expect(r.diagnostics.some(d => /multiple|多个.*H1|H1.*多个/i.test(d.message))).toBe(false)
    expect(r.errorCount).toBe(0)
  })
})

describe('DIAG-4 unnamed objects', () => {
  it('reports warnings (not crash/errors) for missing figure/table/code names', () => {
    const r = computeDocumentDiagnostics(
      input({
        figures: [{ name: null, element: el() }],
        tables: [{ name: '', element: el() }],
        codes: [{ name: null, language: 'ts', element: el() }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'FIGURE_MISSING_NAME')).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'TABLE_MISSING_NAME')).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'CODE_MISSING_NAME')).toBe(true)
    expect(r.errorCount).toBe(0)
  })

  it('reports CODE_MISSING_LANGUAGE when a code block has no language', () => {
    const r = computeDocumentDiagnostics(input({ codes: [{ name: 'x', language: '', element: el() }] }))
    expect(r.diagnostics.some(d => d.code === 'CODE_MISSING_LANGUAGE')).toBe(true)
  })
})

describe('DIAG-5 formula projection invariant', () => {
  it('reports FORMULA_DUPLICATE_VISIBLE_TAG as error when tags repeat', () => {
    const r = computeDocumentDiagnostics(
      input({
        formulas: [{ visibleTagTokens: ['1.1-1', '1.1-1'], element: el() }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'FORMULA_DUPLICATE_VISIBLE_TAG' && d.severity === 'error')).toBe(true)
  })

  it('does NOT report a normal single tag as an error (transient states stay invisible)', () => {
    const r = computeDocumentDiagnostics(
      input({ formulas: [{ visibleTagTokens: ['1.1-1'], element: el() }] }),
    )
    expect(r.diagnostics.some(d => d.code === 'FORMULA_DUPLICATE_VISIBLE_TAG')).toBe(false)
    expect(r.errorCount).toBe(0)
  })
})

describe('DIAG-6 local broken link', () => {
  it('reports LINK_LOCAL_TARGET_MISSING without any network dependency', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '[丢失](missing-file.md)',
        links: [{ target: 'missing-file.md', element: null, index: 0 }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'LINK_LOCAL_TARGET_MISSING')).toBe(true)
  })
})

describe('DIAG-7 deduplication', () => {
  it('collapses identical root causes into one stable item', () => {
    const make = (i: number): DocumentDiagnostic => ({
      id: `x${i}`,
      documentKey: 'doc:a',
      severity: 'warning',
      category: 'heading',
      code: 'HEADING_EMPTY_TEXT',
      message: '存在空标题',
      targetIdentity: 'identity:h3-1',
    })
    const deduped = deduplicateDiagnostics([make(1), make(2), make(3)])
    expect(deduped).toHaveLength(1)
  })

  it('keeps distinct target identities separate', () => {
    const a: DocumentDiagnostic = {
      id: 'a', documentKey: 'doc:a', severity: 'warning', category: 'heading',
      code: 'HEADING_EMPTY_TEXT', message: 'x', targetIdentity: 'identity:1',
    }
    const b: DocumentDiagnostic = {
      id: 'b', documentKey: 'doc:a', severity: 'warning', category: 'heading',
      code: 'HEADING_EMPTY_TEXT', message: 'x', targetIdentity: 'identity:2',
    }
    expect(deduplicateDiagnostics([a, b])).toHaveLength(2)
  })
})

describe('DIAG extra: figure local image missing + strict first H1', () => {
  it('reports FIGURE_LOCAL_IMAGE_MISSING as warning for a missing local path (V5.12-R8 §9)', () => {
    const r = computeDocumentDiagnostics(
      input({
        figures: [{ name: '图', localPath: 'images/not-exists.png', element: el() }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING' && d.severity === 'warning')).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING' && d.severity === 'error')).toBe(false)
  })

  it('does not flag remote images as missing local files', () => {
    const r = computeDocumentDiagnostics(input({ figures: [{ name: '图', localPath: undefined, element: el() }] }))
    expect(r.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(false)
  })

  it('B11: pure body (no heading) is EXEMPT — no strict first-H1 error', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '正文开头\n',
        headings: [],
        h1Facts: [],
      }),
    )
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
  })

  it('B11: body THEN H1 → exemption ends, strict first-H1 violation returns', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '正文开头\n\n# 题目\n',
        headings: [{ level: 1, text: '题目', element: el() }],
        h1Facts: [{ stableIdentity: 'h1-x', element: el() }],
      }),
    )
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(true)
  })

  it('no active document → info, not a scary error', () => {
    const r = computeDocumentDiagnostics(input({ documentKey: null, markdown: null, headings: [] }))
    expect(r.errorCount).toBe(0)
    expect(r.diagnostics.some(d => d.severity === 'info')).toBe(true)
  })
})

// ── Phase 7R.3.11.8-B — STRICT-SINGLE-H1 ────────────────────────────────
const h1 = (identity: string): { stableIdentity: string; element: HTMLElement } => ({ stableIdentity: identity, element: el() })

describe('SINGLE-H1 strict single-H1 rule', () => {
  it('SINGLE-H1-1: strict + exactly one H1 at top → no STRICT_SINGLE_H1 error', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '# H1\n\n正文\n',
      headings: [{ level: 1, text: 'H1', element: el() }],
      h1Facts: [h1('h1-1')],
    }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('SINGLE-H1-2: strict + heading present but zero H1 (H2-only shape) → ERROR NO_H1 (locate → GO_TOP)', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '## 二级\n\n正文\n',
      headings: [{ level: 2, text: '二级', element: el() }],
      h1Facts: [],
    }))
    const item = r.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_NO_H1')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('error')
    expect(item!.metadata?.reason).toBe('NO_H1')
    expect(item!.metadata?.h1Count).toBe(0)
    expect(item!.locator?.action).toBe('GO_TOP')
  })

  it('SINGLE-H1-3: strict + two H1 → ERROR MULTIPLE_H1 (locate → SECOND H1)', () => {
    const first = el()
    const second = el()
    const r = computeDocumentDiagnostics(input({
      markdown: '# A\n\n# B\n',
      headings: [
        { level: 1, text: 'A', element: first },
        { level: 1, text: 'B', element: second },
      ],
      h1Facts: [{ stableIdentity: 'h1-a', element: first }, { stableIdentity: 'h1-b', element: second }],
    }))
    const item = r.diagnostics.find(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('error')
    expect(item!.metadata?.reason).toBe('MULTIPLE_H1')
    expect(item!.metadata?.h1Count).toBe(2)
    expect(item!.stableIdentity).toBe('h1-b') // offending = second H1
    expect(item!.locator?.targetElement).toBe(second)
  })

  it('SINGLE-H1-4: loose + zero H1 → SKIP (no STRICT_SINGLE_H1 error)', () => {
    const r = computeDocumentDiagnostics(input({ strictMode: false, h1Facts: [] }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('SINGLE-H1-5: loose + multiple H1 → SKIP', () => {
    const r = computeDocumentDiagnostics(input({ strictMode: false, h1Facts: [h1('a'), h1('b')] }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })

  it('SINGLE-H1-10: first line H1 + second H1 → STRICT-FIRST-H1 PASS + STRICT-SINGLE-H1 ERROR', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '# H1\n\n# H2\n\n',
      headings: [
        { level: 1, text: 'H1', element: el() },
        { level: 1, text: 'H2', element: el() },
      ],
      h1Facts: [h1('a'), h1('b')],
    }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(false) // first line IS H1
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(true)
  })

  it('SINGLE-H1-11: one H1 but leading blank line → STRICT-SINGLE-H1 PASS + STRICT-FIRST-H1 FAIL', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '\n# H1\n\n',
      headings: [{ level: 1, text: 'H1', element: el() }],
      h1Facts: [h1('a')],
    }))
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_MULTIPLE_H1')).toBe(false)
    expect(r.diagnostics.some(d => d.code === 'STRICT_SINGLE_H1_NO_H1')).toBe(false)
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_FIRST_H1_'))).toBe(true) // leading blank line
  })

  it('SINGLE-H1-12: h1Facts null (frame not ready) → WAIT, never judged', () => {
    const r = computeDocumentDiagnostics(input({ h1Facts: null }))
    expect(r.diagnostics.some(d => d.code.startsWith('STRICT_SINGLE_H1_'))).toBe(false)
  })
})

// ── Phase 7R.3.11.8B.8 — Standard EOF newline policy ─────────────────────
describe('EOF-NEWLINE standard file-level newline policy', () => {
  it('EOF-NEWLINE-1: "content\\n" → PASS (terminal newline, 0 extra blank)', () => {
    expect(computeEofNewlinePolicy('content\n').verdict).toBe('PASS')
    expect(computeEofNewlinePolicy('content\n').hasTerminalNewline).toBe(true)
    expect(computeEofNewlinePolicy('content\n').extraTrailingBlankLineCount).toBe(0)
  })
  it('EOF-NEWLINE-2: "content\\r\\n" → PASS (CRLF terminal newline, 0 extra blank)', () => {
    expect(computeEofNewlinePolicy('content\r\n').verdict).toBe('PASS')
    expect(computeEofNewlinePolicy('content\r\n').hasTerminalNewline).toBe(true)
  })
  it('EOF-NEWLINE-3: "content" → MISSING_TERMINAL_NEWLINE (no line break at EOF)', () => {
    expect(computeEofNewlinePolicy('content').verdict).toBe('MISSING_TERMINAL_NEWLINE')
    expect(computeEofNewlinePolicy('content').hasTerminalNewline).toBe(false)
  })
  it('EOF-NEWLINE-4: "content\\n   \\n" → PASS (1 whitespace-only blank line is legal)', () => {
    expect(computeEofNewlinePolicy('content\n   \n').verdict).toBe('PASS')
    expect(computeEofNewlinePolicy('content\n   \n').extraTrailingBlankLineCount).toBe(1)
  })
  it('EOF-NEWLINE-9: empty / whitespace-only → SKIP', () => {
    expect(computeEofNewlinePolicy('').verdict).toBe('SKIP')
    expect(computeEofNewlinePolicy('   \n  ').verdict).toBe('SKIP')
    expect(computeEofNewlinePolicy(null).verdict).toBe('SKIP')
  })
  it('diagnostics item: missing terminal newline → WARNING DOCUMENT_TERMINAL_NEWLINE_MISSING (locate → GO_BOTTOM)', () => {
    const r = computeDocumentDiagnostics(input({ markdown: 'content' }))
    const item = r.diagnostics.find(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')
    expect(item).toBeTruthy()
    expect(item!.severity).toBe('warning')
    expect(item!.message).toContain('文档末尾缺少换行符')
    expect(item!.detail).toContain('应以一个换行符结束')
    expect(item!.locator?.action).toBe('GO_BOTTOM')
  })
  it('standard EOF "content\\n" / "content\\n\\n" → NO warning at all', () => {
    for (const md of ['content\n', 'content\n\n']) {
      const r = computeDocumentDiagnostics(input({ markdown: md }))
      expect(r.diagnostics.some(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
      expect(r.diagnostics.some(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(false)
    }
  })
  it('two extra blank lines → WARNING DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE (never MISSING)', () => {
    const r = computeDocumentDiagnostics(input({ markdown: 'content\n\n\n' }))
    expect(r.diagnostics.some(d => d.code === 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE')).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(false)
  })
  it('EOF-NEWLINE-10: loose mode also applies (all Markdown docs)', () => {
    const r = computeDocumentDiagnostics(input({ strictMode: false, markdown: 'content' }))
    expect(r.diagnostics.some(d => d.code === 'DOCUMENT_TERMINAL_NEWLINE_MISSING')).toBe(true)
  })
})

// ── Code Block V4 — read-only lint wired into the code segment ──────────────
describe('DIAG code block V4 — read-only lint wiring', () => {
  const fenceMarkdown = (body: readonly string[]): string => [
    '# 标题',
    '',
    '```javascript',
    ...body,
    '```',
    '',
  ].join('\n')

  it('CB101 / CB102 / CB002 land on block:code:0 with a unique per-finding identity', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: fenceMarkdown(['console.log（"你好"）；', '', '']),
        codes: [{ name: '示例代码', language: 'javascript', element: el(), targetIdentity: 'block:code:0' }],
      }),
    )
    const codes = r.diagnostics.filter(d => d.category === 'code').map(d => d.code)
    expect(codes).toContain('CB101')
    expect(codes).toContain('CB102')
    expect(codes).toContain('CB002')

    const paren = r.diagnostics.find(d => d.code === 'CB101')!
    expect(paren.severity).toBe('warning')
    expect(paren.location).toEqual({ kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
    expect(String(paren.targetIdentity)).toContain(':cb:CB101:')

    const trailing = r.diagnostics.find(d => d.code === 'CB002')!
    expect(trailing.severity).toBe('warning')
    expect(trailing.location).toEqual({ kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
    expect(trailing.metadata?.ruleId).toBe('CB002')
    expect(trailing.metadata?.language).toBe('javascript')
  })

  it('does NOT flag Chinese punctuation inside JS strings / comments (CB101–CB105 silent)', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: fenceMarkdown(['const a = "（你好）；"', '// 注释：（全角），；：', 'const b = 1']),
        codes: [{ name: '示例代码', language: 'javascript', element: el(), targetIdentity: 'block:code:0' }],
      }),
    )
    for (const code of ['CB101', 'CB102', 'CB103', 'CB104', 'CB105']) {
      expect(r.diagnostics.some(d => d.code === code), code).toBe(false)
    }
  })

  it('prefers the live CodeMirror source over a polluted serialized fence', () => {
    const codeEl = document.createElement('pre')
    codeEl.className = 'md-fences'
    const cmEl = document.createElement('div')
    cmEl.className = 'CodeMirror'
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      getValue: () => 'const a = 1\n\n',
    }
    codeEl.appendChild(cmEl)
    const r = computeDocumentDiagnostics(
      input({
        markdown: fenceMarkdown(['xxxxxxxxxx1 1const a = 1JSJavaScript 2 行']),
        codes: [{ name: '示例代码', language: 'javascript', element: codeEl, targetIdentity: 'block:code:0' }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'CB002')).toBe(true)
    expect(r.diagnostics.some(d => d.code === 'CB006')).toBe(false)
  })

  it('maps hint findings to info and publishes nothing without a targetIdentity', () => {
    const markdown = fenceMarkdown(['const ok = 1。'])
    const withIdentity = computeDocumentDiagnostics(
      input({
        markdown,
        codes: [{ name: '示例代码', language: 'javascript', element: el(), targetIdentity: 'block:code:0' }],
      }),
    )
    const hits = withIdentity.diagnostics.filter(d => d.code === 'CB105')
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('info')
    expect(String(hits[0].targetIdentity)).toContain(':cb:CB105:')
    expect(hits[0].location).toEqual({ kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })

    const withoutIdentity = computeDocumentDiagnostics(
      input({
        markdown,
        codes: [{ name: '示例代码', language: 'javascript', element: el() }],
      }),
    )
    expect(withoutIdentity.diagnostics.some(d => d.code.startsWith('CB'))).toBe(false)
  })
})
