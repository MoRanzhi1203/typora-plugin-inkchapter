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
  deduplicateDiagnostics,
  deriveDiagnosticsState,
} from './document-diagnostics'
import type { DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:a',
    markdown: '# H1\n',
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
        markdown: '# 一级标题\n\n## 二级\n\n正文',
        headings: [
          { level: 1, text: '一级标题', element: el() },
          { level: 2, text: '二级', element: el() },
        ],
        figures: [{ name: '系统架构', element: el() }],
      }),
    )
    expect(r.errorCount).toBe(0)
    expect(r.warningCount).toBe(0)
    const snapshot = { documentKey: 'doc:a', revision: 1, diagnostics: r.diagnostics, errorCount: r.errorCount, warningCount: r.warningCount, infoCount: r.infoCount }
    expect(deriveDiagnosticsState(snapshot).state).toBe('HEALTHY')
  })
})

describe('DIAG-2 strict heading gap', () => {
  it('reports HEADING_GAP for H1→H2→H4 without fabricating a number', () => {
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
    const gap = r.diagnostics.find(d => d.code === 'HEADING_GAP')
    expect(gap).toBeTruthy()
    expect(gap!.severity).toBe('warning')
    // No fabricated hierarchical number like 1.0.1 appears anywhere.
    expect(JSON.stringify(r.diagnostics)).not.toMatch(/1\.0\.\d/)
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
        links: [{ target: 'missing-file.md', element: null }],
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
  it('reports FIGURE_LOCAL_IMAGE_MISSING as error for a missing local path', () => {
    const r = computeDocumentDiagnostics(
      input({
        figures: [{ name: '图', localPath: 'images/not-exists.png', element: el() }],
      }),
    )
    expect(r.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING' && d.severity === 'error')).toBe(true)
  })

  it('does not flag remote images as missing local files', () => {
    const r = computeDocumentDiagnostics(input({ figures: [{ name: '图', localPath: undefined, element: el() }] }))
    expect(r.diagnostics.some(d => d.code === 'FIGURE_LOCAL_IMAGE_MISSING')).toBe(false)
  })

  it('reports strict first-H1 violation for a leading paragraph', () => {
    const r = computeDocumentDiagnostics(
      input({
        markdown: '正文开头\n',
        headings: [],
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
