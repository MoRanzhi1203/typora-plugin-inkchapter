// @vitest-environment jsdom
/**
 * B2 §B2-01/02/03/06 — behavior tests for the new source rules.
 */
import { describe, expect, it } from 'vitest'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import type { DocumentDiagnostic } from './diagnostics-types'
import { resolveDiagnosticProfile } from './document-diagnostic-profile-v1'

function input(partial: Partial<DocumentDiagnosticsInput> = {}): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc:b2',
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

const codes = (list: readonly DocumentDiagnostic[]): string[] => list.map(d => d.code)
const run = (partial: Partial<DocumentDiagnosticsInput>) => computeDocumentDiagnostics(input(partial)).diagnostics

describe('B2 §B2-01 — Front Matter malformed', () => {
  it('reports a duplicate top-level key as a warning', () => {
    const d = run({ markdown: '---\ntitle: x\ntitle: y\n---\n\n# H1\n' })
    const malformed = d.filter(x => x.code === 'FRONTMATTER_MALFORMED')
    expect(malformed).toHaveLength(1)
    expect(malformed[0].severity).toBe('warning')
    expect(malformed[0].location?.kind).toBe('source-range')
    if (malformed[0].location?.kind === 'source-range') expect(malformed[0].location.startLine).toBe(2)
  })

  it('reports a top-level line without a colon', () => {
    const d = run({ markdown: '---\ntitle: x\nnot yaml\n---\n\n# H1\n' })
    expect(codes(d)).toContain('FRONTMATTER_MALFORMED')
  })

  it('does not report valid YAML-subset front matter or indented/block content', () => {
    const valid = run({ markdown: '---\ntitle: x\ntags:\n  - a\n  - b\nabstract: |\n  line one\n  line two\n---\n\n# H1\n' })
    expect(codes(valid)).not.toContain('FRONTMATTER_MALFORMED')
  })

  it('unclosed front matter owns its own error and suppresses MALFORMED', () => {
    const d = run({ markdown: '---\ntitle: x\n\n# H1\n' })
    const found = codes(d)
    expect(found).toContain('FRONTMATTER_UNCLOSED')
    expect(found).not.toContain('FRONTMATTER_MALFORMED')
  })
})

describe('B2 §B2-02 — table column count', () => {
  it('reports a body row with fewer cells than the header', () => {
    const d = run({ markdown: '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n' })
    const row = d.find(x => x.code === 'TABLE_COLUMN_COUNT_MISMATCH')
    expect(row).toBeTruthy()
    expect(row!.metadata?.expectedColumns).toBe(3)
    expect(row!.metadata?.actualColumns).toBe(2)
  })

  it('does not report a legal table with escaped pipes', () => {
    const d = run({ markdown: '| A \\| B | C |\n| --- | --- |\n| x | y |\n' })
    expect(codes(d)).not.toContain('TABLE_COLUMN_COUNT_MISMATCH')
  })

  it('does not report a table inside a fenced code block', () => {
    const d = run({ markdown: '```\n| A | B |\n| --- | --- |\n| 1 |\n```\n' })
    expect(codes(d)).not.toContain('TABLE_COLUMN_COUNT_MISMATCH')
  })
})

describe('B2 §B2-03 — list indentation', () => {
  it('reports a dedent to an indent that never existed', () => {
    const d = run({ markdown: '- a\n  - b\n - c\n' })
    const issue = d.find(x => x.code === 'LIST_INDENTATION_INVALID')
    expect(issue).toBeTruthy()
    expect(issue!.location?.kind).toBe('source-range')
  })

  it('does not report legal sibling/child indentation or mixed markers', () => {
    const d = run({ markdown: '- a\n  * b\n    + c\n  * d\n- e\n' })
    expect(codes(d)).not.toContain('LIST_INDENTATION_INVALID')
  })

  it('does not report ordered lists starting at a non-1 number', () => {
    const d = run({ markdown: '3. a\n4. b\n   5. c\n' })
    expect(codes(d)).not.toContain('LIST_INDENTATION_INVALID')
  })
})

describe('B2 §B2-06 — formula source and render rules', () => {
  const longFormula = '$$\n' + 'x'.repeat(320) + '\n$$\n'
  const longLineFormula = '$$\n' + 'y'.repeat(130) + '\n$$\n'

  it('source-length / line-length stay off by default', () => {
    const d = run({ markdown: longFormula })
    expect(codes(d)).not.toContain('FORMULA_SOURCE_LENGTH_EXCEEDING')
    expect(codes(d)).not.toContain('FORMULA_SOURCE_LINE_TOO_LONG')
  })

  it('source-length triggers when explicit limits are supplied', () => {
    const d = run({ markdown: longFormula, formulaSourceRules: { lengthLimit: 300 } })
    expect(codes(d)).toContain('FORMULA_SOURCE_LENGTH_EXCEEDING')
    const longLine = run({ markdown: longLineFormula, formulaSourceRules: { lineLimit: 120 } })
    expect(codes(longLine)).toContain('FORMULA_SOURCE_LINE_TOO_LONG')
  })

  it('render width triggers only for a MEASURED fact that exceeds available width', () => {
    const formula = [{ visibleTagTokens: [], element: document.createElement('div'), targetIdentity: 'block:formula:0' }]
    const over = run({
      markdown: '$$\nx\n$$\n',
      formulas: formula,
      formulaRenderFacts: [{ targetIdentity: 'block:formula:0', status: 'MEASURED', naturalWidth: 200, availableWidth: 100 }],
    })
    expect(codes(over)).toContain('FORMULA_RENDER_WIDTH_OVERFLOW')
    const within = run({
      markdown: '$$\nx\n$$\n',
      formulas: formula,
      formulaRenderFacts: [{ targetIdentity: 'block:formula:0', status: 'MEASURED', naturalWidth: 80, availableWidth: 100 }],
    })
    expect(codes(within)).not.toContain('FORMULA_RENDER_WIDTH_OVERFLOW')
  })

  it('render failure triggers only for a FAILED fact', () => {
    const formula = [{ visibleTagTokens: [], element: document.createElement('div'), targetIdentity: 'block:formula:0' }]
    const failed = run({
      markdown: '$$\n\\badcommand\n$$\n',
      formulas: formula,
      formulaRenderFacts: [{ targetIdentity: 'block:formula:0', status: 'FAILED', reason: 'parse error' }],
    })
    expect(codes(failed)).toContain('FORMULA_LATEX_RENDER_FAILED')
    expect(failed.find(x => x.code === 'FORMULA_LATEX_RENDER_FAILED')!.severity).toBe('error')
    const pending = run({
      markdown: '$$\nx\n$$\n',
      formulas: formula,
      formulaRenderFacts: [{ targetIdentity: 'block:formula:0', status: 'PENDING' }],
    })
    expect(codes(pending)).not.toContain('FORMULA_LATEX_RENDER_FAILED')
  })
})

describe('B2b — effective heading number sequence', () => {
  const h = (level: number, path: number[], counted = true) => ({
    level,
    text: `H${level}`,
    element: document.createElement('h' + level),
    stableIdentity: `h-${level}-${path.join('.')}`,
    counted,
    displayCountedPath: path,
  })

  it('reports a same-depth number gap from the canonical display path', () => {
    const d = run({
      markdown: '# A\n\n## B\n\n## D\n',
      headings: [h(1, [1]), h(2, [1, 1]), h(2, [1, 3])],
    })
    const issue = d.find(x => x.code === 'HEADING_NUMBER_SEQUENCE_INVALID')
    expect(issue).toBeTruthy()
    expect(issue!.severity).toBe('warning')
    expect(issue!.location?.kind).toBe('canonical-node')
  })

  it('does not report a continuous path', () => {
    const d = run({
      markdown: '# A\n\n## B\n\n## C\n',
      headings: [h(1, [1]), h(2, [1, 1]), h(2, [1, 2])],
    })
    expect(codes(d)).not.toContain('HEADING_NUMBER_SEQUENCE_INVALID')
  })

  it('ignores headings the canonical authority did not count', () => {
    const d = run({
      markdown: '# A\n\n## B\n',
      headings: [h(1, [1]), h(2, [1, 3], false)],
    })
    expect(codes(d)).not.toContain('HEADING_NUMBER_SEQUENCE_INVALID')
  })

  it('leaves a level jump to HEADING_LEVEL_GAP instead of double-reporting', () => {
    const d = run({
      markdown: '# A\n\n### C\n',
      headings: [h(1, [1]), h(3, [1, 1, 1])],
    })
    expect(codes(d)).toContain('HEADING_LEVEL_GAP')
    expect(codes(d)).not.toContain('HEADING_NUMBER_SEQUENCE_INVALID')
  })
})

describe('B3 §B3-01/03 — profile wiring', () => {  it('academic profile enables the opt-in formula source limits', () => {
    const d = run({
      markdown: '$$\n' + 'x'.repeat(320) + '\n$$\n',
      diagnosticProfile: resolveDiagnosticProfile('academic'),
    })
    expect(codes(d)).toContain('FORMULA_SOURCE_LENGTH_EXCEEDING')
    expect(codes(d)).toContain('FORMULA_SOURCE_LINE_TOO_LONG')
  })

  it('general profile keeps the opt-in formula source limits off', () => {
    const d = run({
      markdown: '$$\n' + 'x'.repeat(320) + '\n$$\n',
      diagnosticProfile: resolveDiagnosticProfile('general'),
    })
    expect(codes(d)).not.toContain('FORMULA_SOURCE_LENGTH_EXCEEDING')
  })

  it('profile content width caps the formula width limit', () => {
    const formula = [{ visibleTagTokens: [], element: document.createElement('div'), targetIdentity: 'block:formula:0' }]
    const d = run({
      markdown: '$$\nx\n$$\n',
      formulas: formula,
      diagnosticProfile: resolveDiagnosticProfile('custom', {
        inherits: 'general',
        contentWidthPx: 600,
      }),
      formulaRenderFacts: [{ targetIdentity: 'block:formula:0', status: 'MEASURED', naturalWidth: 700, availableWidth: 800 }],
    })
    expect(codes(d)).toContain('FORMULA_RENDER_WIDTH_OVERFLOW')
  })
})
