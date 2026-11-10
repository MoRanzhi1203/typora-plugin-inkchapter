// @vitest-environment jsdom
/**
 * B1 §B1-04/§B1-05/§B1-06 — reliability regressions for gating, code-block
 * availability, duplicate-name behavior and same-root suppression.
 */
import { describe, expect, it } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:b1',
    markdown: '# H1\n\n正文\n\n',
    strictMode: false,
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
const codes = (list: readonly DocumentDiagnostic[]): string[] => list.map(d => d.code)

describe('B1 §B1-04 — strict policy activation is separate from severity mode', () => {
  const headings = [{ level: 1, text: 'H1', element: el() }]
  const h1Facts = [{ stableIdentity: 'h1', element: headings[0].element }]

  it('strictMode=true + strictPolicyActive=false does NOT run strict-H1-only rules', () => {
    const r = computeDocumentDiagnostics(input({
      strictMode: true,
      strictPolicyActive: false,
      markdown: '正文\n\n# H1\n',
      headings,
      h1Facts,
    }))
    const found = codes(r.diagnostics)
    expect(found.some(c => c.startsWith('STRICT_FIRST_H1_'))).toBe(false)
    expect(found).not.toContain('STRICT_SINGLE_H1_NO_H1')
    expect(found).not.toContain('STRICT_SINGLE_H1_MULTIPLE_H1')
  })

  it('strictPolicyActive=true runs the same strict rule', () => {
    const r = computeDocumentDiagnostics(input({
      strictMode: true,
      strictPolicyActive: true,
      markdown: '正文\n\n# H1\n',
      headings,
      h1Facts,
    }))
    expect(codes(r.diagnostics)).toContain('STRICT_FIRST_H1_LEADING_PARAGRAPH')
  })
})

describe('B1 §B1-05 — SOURCE_UNAVAILABLE has one owner per root cause', () => {
  const headings = [{ level: 1, text: 'H1', element: el() }]
  const h1Facts = [{ stableIdentity: 'h1', element: headings[0].element }]

  it('strict first-H1 SOURCE_UNAVAILABLE suppresses the generic notice', () => {
    const r = computeDocumentDiagnostics(input({
      strictMode: true,
      strictPolicyActive: true,
      markdown: null,
      headings,
      h1Facts,
    }))
    const found = codes(r.diagnostics)
    expect(found).toContain('STRICT_FIRST_H1_SOURCE_UNAVAILABLE')
    expect(found).not.toContain('DOCUMENT_SOURCE_UNAVAILABLE')
  })

  it('without an active strict policy the generic notice is still emitted', () => {
    const r = computeDocumentDiagnostics(input({
      strictMode: true,
      strictPolicyActive: false,
      markdown: null,
      headings,
      h1Facts,
    }))
    expect(codes(r.diagnostics)).toContain('DOCUMENT_SOURCE_UNAVAILABLE')
  })
})

describe('B1 §B1-04 — code-block availability', () => {
  const code = (name: string | null, language: string | null) => [{
    name, language, element: el(), targetIdentity: 'block:code:0',
  }]

  it('CB007 fires when the raw fence source genuinely mixes CRLF and LF', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '```ts\r\na\nb\r\n```\r\n',
      codes: code('示例', 'ts'),
    }))
    expect(codes(r.diagnostics)).toContain('CB007')
  })

  it('CB007 stays silent for an all-CRLF block', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '```ts\r\na\r\nb\r\n```\r\n',
      codes: code('示例', 'ts'),
    }))
    expect(codes(r.diagnostics)).not.toContain('CB007')
  })

  it('CB008 and CB010 are not emitted by the default producer', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: `\`\`\`\n${'x'.repeat(200)}\n\`\`\`\n`,
      codes: code('示例', ''),
    }))
    const found = codes(r.diagnostics)
    expect(found).not.toContain('CB008')
    expect(found).not.toContain('CB010')
    // The canonical language rule still owns the missing-language fact.
    expect(found).toContain('CODE_MISSING_LANGUAGE')
  })

  it('empty code block with a caption is owned by CB009, not the generic CODE_EMPTY_BLOCK', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '```ts\n```\n',
      codes: code('示例', 'ts'),
    }))
    const found = codes(r.diagnostics)
    expect(found).toContain('CB009')
    expect(found).not.toContain('CODE_EMPTY_BLOCK')
  })

  it('empty code block without a caption keeps the generic CODE_EMPTY_BLOCK', () => {
    const r = computeDocumentDiagnostics(input({
      markdown: '```ts\n```\n',
      codes: code(null, 'ts'),
    }))
    const found = codes(r.diagnostics)
    expect(found).toContain('CODE_EMPTY_BLOCK')
    expect(found).not.toContain('CB009')
  })
})

describe('B1 §B1-06 — duplicate-name rules produce real diagnostics and targets', () => {
  it('figure duplicate names produce one warning with a multi-target locator', () => {
    const r = computeDocumentDiagnostics(input({
      figures: [
        { name: '图A', element: el(), targetIdentity: 'block:figure:0' },
        { name: '图A', element: el(), targetIdentity: 'block:figure:1' },
      ],
    }))
    const d = r.diagnostics.find(x => x.code === 'FIGURE_DUPLICATE_NAME')
    expect(d).toBeTruthy()
    expect(d!.severity).toBe('warning')
    expect(d!.location?.kind).toBe('multi-target')
    if (d!.location?.kind === 'multi-target') {
      expect(d!.location.targets).toHaveLength(1)
      const target = d!.location.targets[0]
      expect(target.kind).toBe('block-node')
      if (target.kind === 'block-node') expect(target.stableIdentity).toBe('block:figure:1')
    }
  })

  it('table duplicate names produce one warning with a multi-target locator', () => {
    const r = computeDocumentDiagnostics(input({
      tables: [
        { name: '表A', element: el(), targetIdentity: 'block:table:0' },
        { name: '表A', element: el(), targetIdentity: 'block:table:1' },
      ],
    }))
    const d = r.diagnostics.find(x => x.code === 'TABLE_DUPLICATE_NAME')
    expect(d).toBeTruthy()
    expect(d!.location?.kind).toBe('multi-target')
  })

  it('code duplicate names produce one warning with a multi-target locator', () => {
    const r = computeDocumentDiagnostics(input({
      codes: [
        { name: '代码A', language: 'ts', element: el(), targetIdentity: 'block:code:0' },
        { name: '代码A', language: 'ts', element: el(), targetIdentity: 'block:code:1' },
      ],
    }))
    const d = r.diagnostics.find(x => x.code === 'CODE_DUPLICATE_NAME')
    expect(d).toBeTruthy()
    expect(d!.location?.kind).toBe('multi-target')
  })
})
