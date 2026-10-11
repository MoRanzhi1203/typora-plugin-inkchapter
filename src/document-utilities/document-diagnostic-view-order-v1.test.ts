import { describe, it, expect } from 'vitest'
import {
  DIAGNOSTIC_PROBLEM_TYPES,
  DIAGNOSTIC_SORT_MODES,
  DRAWER_VIEW_ORDER_STACK_WIDTH_PX,
  comparatorForSortMode,
  filterProjectionsByProblemType,
  groupProjectionsByProblemType,
  resolveDrawerViewOrderLayout,
  resolveProblemType,
  resolveProblemTypeLabel,
  sortProjections,
} from './document-diagnostic-view-order-v1'
import type { DiagnosticTargetProjection } from './document-diagnostic-drawer-order-v514-r1'

function proj(over: Partial<DiagnosticTargetProjection> & { diagnosticId: string }): DiagnosticTargetProjection {
  return {
    ruleId: 'DOCUMENT_EMPTY',
    severity: 'warning',
    targetIndex: 0,
    targetCount: 1,
    stableIdentity: over.diagnosticId,
    documentKey: 'doc:key',
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

describe('view order V1 — problem type authority', () => {
  it('derives the type from the rule code', () => {
    expect(resolveProblemType('HEADING_LEVEL_GAP')).toBe('heading')
    expect(resolveProblemType('FIGURE_MISSING_NAME')).toBe('figure')
    expect(resolveProblemType('TABLE_EMPTY_CONTENT')).toBe('table')
    expect(resolveProblemType('CODE_FENCE_UNCLOSED')).toBe('code')
    expect(resolveProblemType('FORMULA_NUMBER_ORDER_INVALID')).toBe('formula')
    expect(resolveProblemType('LINK_LOCAL_ANCHOR_MISSING')).toBe('link')
    expect(resolveProblemType('FOOTNOTE_DEFINITION_DUPLICATE')).toBe('link')
    expect(resolveProblemType('EXCESSIVE_INTERNAL_BLANK_LINES')).toBe('document')
  })

  it('has a label for each type', () => {
    for (const t of DIAGNOSTIC_PROBLEM_TYPES) expect(resolveProblemTypeLabel(t === 'heading' ? 'HEADING_X' : 'DOCUMENT_X')).toBeTruthy()
  })
})

describe('view order V1 — default document-position sort', () => {
  it('orders by source line; document-end sorts last', () => {
    const list = [
      proj({ diagnosticId: 'end', ruleId: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', locationKind: 'document-end' }),
      proj({ diagnosticId: 'b', ruleId: 'HEADING_LEVEL_GAP', sourceLine: 20 }),
      proj({ diagnosticId: 'a', ruleId: 'HEADING_LEVEL_GAP', sourceLine: 5 }),
      proj({ diagnosticId: 'start', ruleId: 'DOCUMENT_EMPTY', locationKind: 'document-start' }),
    ]
    const sorted = sortProjections(list, 'document')
    expect(sorted.map(p => p.diagnosticId)).toEqual(['start', 'a', 'b', 'end'])
  })

  it('breaks a same-position tie by severity, then by stable rule priority', () => {
    const list = [
      proj({ diagnosticId: 'w-format', ruleId: 'EXCESSIVE_INTERNAL_BLANK_LINES', severity: 'warning', sourceLine: 10 }),
      proj({ diagnosticId: 'e-heading', ruleId: 'HEADING_EMPTY_TEXT', severity: 'error', sourceLine: 10 }),
      proj({ diagnosticId: 'w-heading', ruleId: 'HEADING_LEVEL_GAP', severity: 'warning', sourceLine: 10 }),
      proj({ diagnosticId: 'i-heading', ruleId: 'HEADING_DUPLICATE_TEXT', severity: 'info', sourceLine: 10 }),
    ]
    const sorted = sortProjections(list, 'document')
    // error first; among warnings: format (220) before heading (300); then info.
    expect(sorted.map(p => p.diagnosticId)).toEqual(['e-heading', 'w-format', 'w-heading', 'i-heading'])
  })

  it('is deterministic and does not mutate the input', () => {
    const list = [proj({ diagnosticId: 'x', sourceLine: 2 }), proj({ diagnosticId: 'y', sourceLine: 1 })]
    const snapshot = list.map(p => p.diagnosticId)
    const sorted = sortProjections(list, 'document')
    expect(sorted.map(p => p.diagnosticId)).toEqual(['y', 'x'])
    expect(list.map(p => p.diagnosticId)).toEqual(snapshot)
    // sort twice → identical
    expect(sortProjections(list, 'document').map(p => p.diagnosticId)).toEqual(['y', 'x'])
  })
})

describe('view order V1 — severity / type modes', () => {
  it('severity mode puts every error before every warning before every info', () => {
    const list = [
      proj({ diagnosticId: 'i', severity: 'info', sourceLine: 1 }),
      proj({ diagnosticId: 'e', severity: 'error', sourceLine: 9 }),
      proj({ diagnosticId: 'w', severity: 'warning', sourceLine: 5 }),
    ]
    expect(sortProjections(list, 'severity').map(p => p.diagnosticId)).toEqual(['e', 'w', 'i'])
  })

  it('type mode orders by the fixed problem-type order', () => {
    const list = [
      proj({ diagnosticId: 'link', ruleId: 'LINK_TEXT_EMPTY' }),
      proj({ diagnosticId: 'doc', ruleId: 'DOCUMENT_EMPTY' }),
      proj({ diagnosticId: 'figure', ruleId: 'FIGURE_MISSING_NAME' }),
      proj({ diagnosticId: 'heading', ruleId: 'HEADING_LEVEL_GAP' }),
    ]
    expect(sortProjections(list, 'type').map(p => p.diagnosticId)).toEqual(['doc', 'heading', 'figure', 'link'])
  })

  it('exposes a comparator for every mode', () => {
    for (const mode of DIAGNOSTIC_SORT_MODES) {
      const cmp = comparatorForSortMode(mode)
      const a = proj({ diagnosticId: 'a', sourceLine: 1 })
      expect(cmp(a, a)).toBe(0)
    }
  })
})

describe('view order V1 — type filter', () => {
  it('removes non-matching entries and preserves the survivors order', () => {
    const list = [
      proj({ diagnosticId: 'h1', ruleId: 'HEADING_LEVEL_GAP', sourceLine: 1 }),
      proj({ diagnosticId: 'f1', ruleId: 'FIGURE_MISSING_NAME', sourceLine: 2 }),
      proj({ diagnosticId: 'h2', ruleId: 'HEADING_EMPTY_TEXT', sourceLine: 3 }),
    ]
    const filtered = filterProjectionsByProblemType(list, 'heading')
    expect(filtered.map(p => p.diagnosticId)).toEqual(['h1', 'h2'])
    expect(filterProjectionsByProblemType(list, 'all').map(p => p.diagnosticId)).toEqual(['h1', 'f1', 'h2'])
  })
})

describe('view order V1 — optional grouping', () => {
  it('groups in the fixed type order and preserves the in-group order', () => {
    const list = [
      proj({ diagnosticId: 'h1', ruleId: 'HEADING_LEVEL_GAP' }),
      proj({ diagnosticId: 'f1', ruleId: 'FIGURE_MISSING_NAME' }),
      proj({ diagnosticId: 'h2', ruleId: 'HEADING_EMPTY_TEXT' }),
      proj({ diagnosticId: 'd1', ruleId: 'DOCUMENT_EMPTY' }),
    ]
    const groups = groupProjectionsByProblemType(list)
    expect(groups.map(g => g.type)).toEqual(['document', 'heading', 'figure'])
    const heading = groups.find(g => g.type === 'heading')!
    expect(heading.items.map(p => p.diagnosticId)).toEqual(['h1', 'h2'])
    const figure = groups.find(g => g.type === 'figure')!
    expect(figure.items.map(p => p.diagnosticId)).toEqual(['f1'])
  })

  it('omits empty groups', () => {
    const groups = groupProjectionsByProblemType([proj({ diagnosticId: 'x', ruleId: 'TABLE_EMPTY_CONTENT' })])
    expect(groups.map(g => g.type)).toEqual(['table'])
  })
})

describe('view order V1 — control-strip layout at different Drawer widths', () => {
  it('wide Drawer → one row', () => {
    expect(resolveDrawerViewOrderLayout(320)).toBe('wide')
    expect(resolveDrawerViewOrderLayout(DRAWER_VIEW_ORDER_STACK_WIDTH_PX)).toBe('wide')
    expect(resolveDrawerViewOrderLayout(1200)).toBe('wide')
  })

  it('very narrow Drawer → stacked', () => {
    expect(resolveDrawerViewOrderLayout(DRAWER_VIEW_ORDER_STACK_WIDTH_PX - 1)).toBe('stacked')
    expect(resolveDrawerViewOrderLayout(180)).toBe('stacked')
  })

  it('unknown / zero width → wide (never force a stacked layout on unmeasured width)', () => {
    expect(resolveDrawerViewOrderLayout(null)).toBe('wide')
    expect(resolveDrawerViewOrderLayout(undefined)).toBe('wide')
    expect(resolveDrawerViewOrderLayout(0)).toBe('wide')
    expect(resolveDrawerViewOrderLayout(Number.NaN)).toBe('wide')
  })
})
