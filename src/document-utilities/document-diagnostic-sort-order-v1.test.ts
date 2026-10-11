import { describe, it, expect } from 'vitest'
import type { DocumentDiagnostic } from './diagnostics-types'
import { computeDocumentDiagnostics, type DocumentDiagnosticsInput } from './document-diagnostics'
import { analyzeInternalBlankLineGaps } from './document-diagnostic-internal-blank-lines-v1'
import {
  DOCUMENT_POSITION_BAND_END,
  DOCUMENT_POSITION_BAND_SOURCE,
  DOCUMENT_POSITION_BAND_START,
  DOCUMENT_POSITION_KEY_UNKNOWN,
  documentPositionOf,
  flattenDiagnosticsToProjections,
  sortProjectionsByDocumentPosition,
  type DiagnosticTargetProjection,
  type DocumentPositionContext,
} from './document-diagnostic-drawer-order-v514-r1'
import {
  filterProjectionsByProblemType,
  groupProjectionsByProblemType,
  sortProjections,
} from './document-diagnostic-view-order-v1'

/**
 * SORT — unified source-position ordering model.
 *
 * ROOT CAUSE covered here: the old ordering mixed TWO incomparable key scales
 * (a real source LINE vs a canonical heading/block INDEX). An object/heading
 * whose source line was not resolved fell back to an index key FAR larger than
 * any line key, so a mid-document `source-range` diagnostic (e.g.
 * `EXCESSIVE_INTERNAL_BLANK_LINES`) sorted BEFORE it. The unified model uses ONE
 * unit (the source line) and never promotes an unresolved anchor to the front.
 */

function inputOf(markdown: string): DocumentDiagnosticsInput {
  return {
    documentKey: 'doc', markdown, strictMode: false, vaultRoot: '/vault',
    headings: [], figures: [], tables: [], codes: [], formulas: [], links: [],
    canonicalDuplicateIdentities: [], captionDuplicateNames: [],
    h1Facts: null,
  }
}

function proj(
  ruleId: string,
  over: Partial<DiagnosticTargetProjection> = {},
): DiagnosticTargetProjection {
  return {
    diagnosticId: `${ruleId}#${over.targetIndex ?? 0}`,
    ruleId,
    severity: 'warning',
    targetIndex: 0,
    targetCount: 1,
    stableIdentity: ruleId,
    documentKey: 'doc',
    sourceStartOffset: null,
    sourceEndOffset: null,
    canonicalBlockIndex: null,
    canonicalHeadingIndex: null,
    sourceLine: null,
    sourceColumn: null,
    locationKind: 'source-range',
    active: false,
    ...over,
  }
}

/** A heading/object identity → source-line context (as the host builds it). */
const ctx: DocumentPositionContext = {
  headingIndexOfStableIdentity: id => (id === 'h0' ? 0 : id === 'h1' ? 1 : null),
  blockIndexOfStableIdentity: id => {
    const m = /^block:\w+:(\d+)$/.exec(id)
    return m ? Number.parseInt(m[1], 10) : null
  },
  lineOfStableIdentity: id => {
    if (id === 'h0') return 2
    if (id === 'h1') return 40
    const m = /^block:(figure|table|code|formula):(\d+)$/.exec(id)
    if (m) return { '0': 6, '1': 22 }[m[2]] ?? null
    return null
  },
}

// ── SORT-01 — the reported defect: a mid-document gap must NOT be first ─────

describe('SORT-01 — a mid-document internal blank gap orders by its SOURCE LINE', () => {
  it('an earlier object/heading sorts BEFORE the gap (never the gap first)', () => {
    const gapLine = 300
    const ps = sortProjectionsByDocumentPosition([
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: gapLine }),
      proj('FIGURE_MISSING_NAME', { diagnosticId: 'fig', locationKind: 'block-node', stableIdentity: 'block:figure:0', sourceLine: 6 }),
      proj('HEADING_LEVEL_GAP', { diagnosticId: 'h', locationKind: 'canonical-node', stableIdentity: 'h0', sourceLine: 2 }),
    ])
    expect(ps.map(p => p.diagnosticId)).toEqual(['h', 'fig', 'gap'])
  })

  it('the REAL producer emits the gap at its true mid-document line', () => {
    const md = ['# 标题', '正文一。', '', '', '', '## 小节', 'end'].join('\n')
    const gaps = analyzeInternalBlankLineGaps(md)
    expect(gaps).toHaveLength(1)
    // next block ('## 小节') starts at source line 5.
    expect(gaps[0].nextBlockStartLine).toBe(5)
    const diag = computeDocumentDiagnostics(inputOf(md)).diagnostics
      .find(d => d.code === 'EXCESSIVE_INTERNAL_BLANK_LINES')!
    expect((diag.location as { startLine: number }).startLine).toBe(5)
  })
})

// ── SORT-02 — source line is primary over severity ─────────────────────────

describe('SORT-02 — the source line outranks severity', () => {
  it('an early warning precedes a later error', () => {
    const ps = sortProjectionsByDocumentPosition([
      proj('STRICT_SINGLE_H1_MULTIPLE_H1', { diagnosticId: 'err-late', severity: 'error', sourceLine: 80 }),
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'warn-early', sourceLine: 10 }),
    ])
    expect(ps.map(p => p.diagnosticId)).toEqual(['warn-early', 'err-late'])
  })
})

// ── SORT-03 — same position → severity → stable rule priority ──────────────

describe('SORT-03 — the tie-break order at one position', () => {
  it('error → warning → info, then by stable rule priority', () => {
    const at = (id: string, ruleId: string, severity: DiagnosticTargetProjection['severity']) =>
      proj(ruleId, { diagnosticId: id, severity, sourceLine: 30 })
    const ps = sortProjectionsByDocumentPosition([
      at('i', 'SECTION_EMPTY', 'info'),
      at('w-code', 'CODE_MISSING_NAME', 'warning'),
      at('w-heading', 'HEADING_EMPTY_TEXT', 'warning'),
      at('e', 'HEADING_DUPLICATE_IDENTITY', 'error'),
    ])
    // error first; among warnings heading (priority 310) before code (700); then info.
    expect(ps.map(p => p.diagnosticId)).toEqual(['e', 'w-heading', 'w-code', 'i'])
  })
})

// ── SORT-04 — document-end last ────────────────────────────────────────────

describe('SORT-04 — document-end diagnostics are always last', () => {
  it('EOF rules follow every in-body item, even a very late one', () => {
    const ps = sortProjectionsByDocumentPosition([
      proj('DOCUMENT_TERMINAL_NEWLINE_MISSING', { diagnosticId: 'eof', locationKind: 'document-end' }),
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: 999 }),
    ])
    expect(ps.map(p => p.diagnosticId)).toEqual(['gap', 'eof'])
    expect(documentPositionOf(ps[ps.length - 1]).band).toBe(DOCUMENT_POSITION_BAND_END)
  })
})

// ── SORT-05 — a degraded boundary fallback is NOT promoted to the front ────

describe('SORT-05 — an unresolved anchor fallback never jumps to the front', () => {
  it('a genuine document-start GUARD is band 0', () => {
    const p = proj('DOCUMENT_EMPTY', { locationKind: 'document-start' })
    expect(documentPositionOf(p).band).toBe(DOCUMENT_POSITION_BAND_START)
  })

  it('a source-bearing rule whose location degraded to document-start stays in-body', () => {
    // HEADING_DUPLICATE_TEXT declares `multi-target`; a document-start location on
    // it is an UNRESOLVED anchor fallback, NOT a document boundary.
    const p = proj('HEADING_DUPLICATE_TEXT', { locationKind: 'document-start' })
    const pos = documentPositionOf(p)
    expect(pos.band).toBe(DOCUMENT_POSITION_BAND_SOURCE)
    expect(pos.key).toBe(DOCUMENT_POSITION_KEY_UNKNOWN)
    // and it sorts AFTER every located in-body item
    const sorted = sortProjectionsByDocumentPosition([
      p,
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: 5 }),
    ])
    expect(sorted[0].diagnosticId).toBe('gap')
  })

  it('a real document-start guard still sorts before a located in-body item', () => {
    const sorted = sortProjectionsByDocumentPosition([
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: 5 }),
      proj('DOCUMENT_EMPTY', { diagnosticId: 'guard', locationKind: 'document-start' }),
    ])
    expect(sorted.map(p => p.diagnosticId)).toEqual(['guard', 'gap'])
  })
})

// ── SORT-06 — unknown source position: after located, before document-end ──

describe('SORT-06 — an unknown source position is never first', () => {
  it('sorts after located items but before document-end', () => {
    const ps = sortProjectionsByDocumentPosition([
      proj('FIGURE_DUPLICATE_NAME', { diagnosticId: 'unknown', locationKind: 'block-node', stableIdentity: 'block:figure:9' }),
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'located', sourceLine: 12 }),
      proj('DOCUMENT_TERMINAL_NEWLINE_MISSING', { diagnosticId: 'end', locationKind: 'document-end' }),
    ])
    expect(ps.map(p => p.diagnosticId)).toEqual(['located', 'unknown', 'end'])
    expect(documentPositionOf(ps[1]).key).toBe(DOCUMENT_POSITION_KEY_UNKNOWN)
  })
})

// ── SORT-07 — ONE ordering rule across every diagnostic kind ───────────────

describe('SORT-07 — every kind orders on the SAME unit (the source line)', () => {
  it('heading / figure / table / code / formula / internal-blank / EOF interleave by line', () => {
    const ps = sortProjectionsByDocumentPosition([
      proj('DOCUMENT_TERMINAL_NEWLINE_MISSING', { diagnosticId: 'eof', locationKind: 'document-end' }),
      proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'blank', sourceLine: 30 }),
      proj('FORMULA_EMPTY_CONTENT', { diagnosticId: 'formula', locationKind: 'block-node', stableIdentity: 'block:formula:1' }),
      proj('CODE_MISSING_NAME', { diagnosticId: 'code', locationKind: 'block-node', stableIdentity: 'block:code:0' }),
      proj('TABLE_MISSING_NAME', { diagnosticId: 'table', locationKind: 'block-node', stableIdentity: 'block:table:0' }),
      proj('FIGURE_MISSING_NAME', { diagnosticId: 'figure', locationKind: 'block-node', stableIdentity: 'block:figure:0' }),
      proj('HEADING_LEVEL_GAP', { diagnosticId: 'heading', locationKind: 'canonical-node', stableIdentity: 'h0' }),
    ].map(p => {
      // resolve the canonical identities through the SAME ctx the host supplies
      const line = ctx.lineOfStableIdentity?.(p.stableIdentity) ?? null
      return line != null ? { ...p, sourceLine: line } : p
    }))
    // lines: heading 2, figure 6, table 6, code 6, formula 22, blank 30, eof
    expect(ps.map(p => p.diagnosticId)).toEqual([
      'heading', 'figure', 'table', 'code', 'formula', 'blank', 'eof',
    ])
    expect(ps.every(p => documentPositionOf(p).band !== -1)).toBe(true)
  })
})

// ── SORT-08 — dynamic edit → live re-sort ──────────────────────────────────

describe('SORT-08 — a live edit re-sorts by the NEW source positions', () => {
  it('moving the excess gap later moves its projection later', () => {
    const before = ['# H', 'A', '', '', '', 'B'].join('\n')   // gap before line 5
    const after = ['# H', 'A', '', 'B', '', '', '', 'C'].join('\n') // gap before line 6
    const pick = (md: string): number => {
      const diag = computeDocumentDiagnostics(inputOf(md)).diagnostics
        .find(d => d.code === 'EXCESSIVE_INTERNAL_BLANK_LINES')!
      return (diag.location as { startLine: number }).startLine
    }
    const l0 = pick(before)
    const l1 = pick(after)
    expect(l0).toBeLessThan(l1)
    const p0 = proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: l0 })
    const p1 = proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'gap', sourceLine: l1 })
    const other = proj('HEADING_LEVEL_GAP', { diagnosticId: 'h', sourceLine: 4 })
    expect(sortProjectionsByDocumentPosition([p0, other]).map(p => p.diagnosticId)).toEqual(['h', 'gap'])
    expect(sortProjectionsByDocumentPosition([p1, other]).map(p => p.diagnosticId)).toEqual(['h', 'gap'])
    // and the sort is deterministic across modes
    expect(sortProjections([p1, other], 'document').map(p => p.diagnosticId)).toEqual(['h', 'gap'])
  })
})

// ── SORT-09 — filter / group never reorder or re-identify ──────────────────

describe('SORT-09 — filter and group preserve order + identity', () => {
  const base = sortProjectionsByDocumentPosition([
    proj('HEADING_LEVEL_GAP', { diagnosticId: 'h1', sourceLine: 1 }),
    proj('EXCESSIVE_INTERNAL_BLANK_LINES', { diagnosticId: 'blank', sourceLine: 2 }),
    proj('FIGURE_MISSING_NAME', { diagnosticId: 'fig', sourceLine: 3 }),
    proj('HEADING_EMPTY_TEXT', { diagnosticId: 'h2', sourceLine: 4 }),
  ])

  it('the type filter is an order-preserving subsequence', () => {
    const headings = filterProjectionsByProblemType(base, 'heading')
    expect(headings.map(p => p.diagnosticId)).toEqual(['h1', 'h2'])
    const indices = headings.map(p => base.findIndex(b => b.diagnosticId === p.diagnosticId))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })

  it('grouping keeps the in-group order and the diagnostic identity', () => {
    const groups = groupProjectionsByProblemType(base)
    // groups in the FIXED problem-type order
    expect(groups.map(g => g.type)).toEqual(['document', 'heading', 'figure'])
    // the in-group order is the document-position order (never re-sorted)
    expect(groups.find(g => g.type === 'heading')!.items.map(p => p.diagnosticId)).toEqual(['h1', 'h2'])
    // no diagnostic is lost or duplicated by grouping
    const ids = groups.flatMap(g => g.items.map(p => p.diagnosticId))
    expect(ids).toHaveLength(base.length)
    expect(new Set(ids).size).toBe(base.length)
  })
})

// ── The unified key contract (guard against a future scale mix) ────────────

describe('SORT-0x — ONE in-body key scale (no index-vs-line mix)', () => {
  it('a resolved line always produces a line key; an unresolved item is UNKNOWN', () => {
    expect(documentPositionOf(proj('X', { sourceLine: 0 })).key).toBe(0)
    expect(documentPositionOf(proj('X', { sourceLine: 12, sourceColumn: 3 })).key).toBe(12 * 1000 + 3)
    const unresolved = documentPositionOf(proj('X', { canonicalBlockIndex: 0, canonicalHeadingIndex: 0 }))
    expect(unresolved.key).toBe(DOCUMENT_POSITION_KEY_UNKNOWN)
    // an index must NEVER outrank a real (even large) line
    expect(documentPositionOf(proj('X', { sourceLine: 900_000 })).key)
      .toBeLessThan(DOCUMENT_POSITION_KEY_UNKNOWN)
  })

  it('flatten + sort keeps a stable, inversion-free order', () => {
    const diags: DocumentDiagnostic[] = [
      { id: 'gap', documentKey: 'doc', severity: 'warning', category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES', message: 'x', location: { kind: 'source-range', startLine: 50, startColumn: 0 } },
      { id: 'h', documentKey: 'doc', severity: 'warning', category: 'heading', code: 'HEADING_LEVEL_GAP', message: 'y', location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h0' } },
    ] as DocumentDiagnostic[]
    const sorted = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections(diags, ctx))
    expect(sorted.map(p => p.diagnosticId)).toEqual(['h', 'gap'])
  })
})
