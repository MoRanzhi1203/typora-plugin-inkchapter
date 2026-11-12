// @vitest-environment jsdom
/**
 * V3-UI — ONE line resolution for every document diagnostic.
 *
 * The projection keeps a 0-based `sourceLine`; the ONLY user-visible conversion
 * (`diagnosticDisplayLine`) renders 1-based `Lxx`. Every locator kind must
 * resolve through a REAL fact (source line / element / metadata / declared
 * document boundary) — never an array index or a blind L1.
 */
import { describe, it, expect } from 'vitest'
import type { DiagnosticLocation, DocumentDiagnostic } from './diagnostics-types'
import {
  diagnosticDisplayLine,
  flattenDiagnosticsToProjections,
  type DocumentPositionContext,
} from './document-diagnostic-drawer-order-v514-r1'

function diag(
  code: string,
  location: DiagnosticLocation | null,
  extra: Partial<DocumentDiagnostic> = {},
): DocumentDiagnostic {
  return {
    id: `${code}:id`,
    documentKey: 'doc:line',
    severity: 'error',
    category: 'heading',
    code,
    message: code,
    ...(location == null ? {} : { location }),
    ...extra,
  }
}

const ctx: DocumentPositionContext = {
  documentLineCount: 20,
  lineOfStableIdentity: id => (id === 'heading:a' ? 7 : id === 'block:figure:0' ? 9 : null),
  lineOfElement: el => (el != null ? 12 : null),
}

function linesOf(diagnostics: readonly DocumentDiagnostic[], context: DocumentPositionContext = ctx) {
  return flattenDiagnosticsToProjections(diagnostics, context).map(p => p.sourceLine)
}

describe('V3-UI — 统一行号解析', () => {
  it('source range / canonical / block locators reuse their real line', () => {
    expect(linesOf([
      diag('FIG_A', { kind: 'source-range', startLine: 4, startColumn: 0 }),
      diag('HEADING_LEVEL_GAP', { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'heading:a' }),
      diag('FIGURE_MISSING_NAME', { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' }),
    ])).toEqual([4, 7, 9])
  })

  it('caption projection / element locator resolves through data-line', () => {
    const el = document.createElement('span')
    const line = linesOf([
      diag('FIGURE_CAPTION_FORMAT_INVALID', { kind: 'caption-projection', captionKind: 'figure', captionId: 'c1' }, {
        locator: { kind: 'object', targetElement: el },
      }),
    ])
    expect(line).toEqual([12])
  })

  it('document boundaries use the explicit document line, capped by the current version', () => {
    expect(linesOf([diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { kind: 'document-end' })])).toEqual([19])
    expect(linesOf([diag('STRICT_SINGLE_H1_NO_H1', { kind: 'document-start' })])).toEqual([0])
  })

  it('multi-target / target-group use their FIRST concrete member', () => {
    // `multi-target` expands to ONE projection per target (2 rows, each with its
    // own real line); `target-group` stays ONE row anchored at its first member.
    expect(linesOf([
      diag('FIGURE_DUPLICATE_NAME', {
        kind: 'multi-target',
        targets: [
          { kind: 'source-range', startLine: 2, startColumn: 0 },
          { kind: 'source-range', startLine: 8, startColumn: 0 },
        ],
      }),
      diag('FIGURE_MULTIPLE_CAPTIONS', {
        kind: 'target-group',
        scrollAnchor: { kind: 'source-range', startLine: 5, startColumn: 0 },
        targets: [{ kind: 'source-range', startLine: 5, startColumn: 0 }],
      }),
    ])).toEqual([2, 8, 5])
  })

  it('metadata line keys are the final real-fact fallback (section / block lines)', () => {
    expect(linesOf([
      diag('SECTION_EMPTY', null, { category: 'heading', metadata: { sectionStartLine: 5 } }),
      diag('SECTION_EMPTY', null, { category: 'heading', metadata: { startLine: 3 } }),
    ])).toEqual([5, 3])
  })

  it('a declared non-locatable document notice still renders the document start (L1)', () => {
    expect(linesOf([diag('DOCUMENT_EMPTY', null, { severity: 'info', nonLocatableNotice: true })])).toEqual([0])
    expect(diagnosticDisplayLine(0)).toBe(1)
  })

  it('display line is the ONE 1-based conversion', () => {
    expect(diagnosticDisplayLine(null)).toBeNull()
    expect(diagnosticDisplayLine(0)).toBe(1)
    expect(diagnosticDisplayLine(4)).toBe(5)
    expect(diagnosticDisplayLine(19)).toBe(20)
  })

  it('every resolvable diagnostic has a non-null line (no missing Lxx row)', () => {
    const diagnostics = [
      diag('FIG_A', { kind: 'source-range', startLine: 4, startColumn: 0 }),
      diag('HEADING_LEVEL_GAP', { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'heading:a' }),
      diag('FIGURE_MISSING_NAME', { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' }),
      diag('FIGURE_CAPTION_FORMAT_INVALID', { kind: 'caption-projection', captionKind: 'figure', captionId: 'c1' }, {
        locator: { kind: 'object', targetElement: document.createElement('span') },
      }),
      diag('DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', { kind: 'document-end' }),
      diag('STRICT_SINGLE_H1_NO_H1', { kind: 'document-start' }),
      diag('SECTION_EMPTY', null, { metadata: { sectionStartLine: 5 } }),
    ]
    for (const line of linesOf(diagnostics)) expect(line).not.toBeNull()
  })
})
