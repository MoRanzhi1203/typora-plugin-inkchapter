/**
 * V5.14-R1 (Phase 2/3) — DiagnosticTargetProjection + documentPosition authority.
 *
 * R1: the drawer exists as ONE occurrence-level, document-position-sorted list.
 * R2: a multi-target diagnostic expands to N entries that MAY interleave.
 * R3: severity / ruleId / creation order are NEVER the primary sort key.
 * R4: filtering removes entries but never reorders the survivors.
 */
import { describe, expect, it } from 'vitest'
import type { DocumentDiagnostic } from './diagnostics-types'
import {
  DRAWER_ORDER_V514R1_GATE_KEYS,
  DRAWER_ORDER_V514R1_GATE_LABELS,
  createDrawerOrderV514R1Counters,
  countDocumentOrderDriftWithoutSourceChange,
  countDocumentOrderInversions,
  countMultiTargetGroupedInsteadOfPositionSorted,
  documentPositionOf,
  evaluateDrawerOrderV514R1Gates,
  filterProjectionsBySeverity,
  flattenDiagnosticsToProjections,
  formatDrawerOrderV514R1GateReport,
  isOrderPreservingSubsequence,
  projectionKey,
  sortProjectionsByDocumentPosition,
  summarizeDrawerOrderAudit,
  type DiagnosticTargetProjection,
} from './document-diagnostic-drawer-order-v514-r1'

function diag(over: Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>): DocumentDiagnostic {
  return {
    documentKey: 'doc:v514',
    severity: 'warning',
    category: 'document',
    message: over.code,
    detail: '',
    ...over,
  } as DocumentDiagnostic
}

/** A multi-target heading diagnostic whose targets sit at lines 10 and 30. */
function multiH1(): DocumentDiagnostic {
  return diag({
    id: 'document:STRICT_SINGLE_H1_MULTIPLE_H1',
    code: 'STRICT_SINGLE_H1_MULTIPLE_H1',
    severity: 'error',
    location: {
      kind: 'multi-target',
      targets: [
        { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H1:idx:1' },
        { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H1:idx:2' },
      ],
    },
  } as Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>)
}

/** A single-target source-range diagnostic on an explicit source LINE. */
function at(id: string, code: string, line: number, severity: DocumentDiagnostic['severity'] = 'warning'): DocumentDiagnostic {
  return diag({
    id,
    code,
    severity,
    location: {
      kind: 'source-range', startLine: line, startColumn: 1,
      sourceStart: line * 40, sourceEnd: line * 40 + 3,
    },
  })
}

const ctx = {
  lineOfStableIdentity: (id: string) => (id === 'H1:idx:1' ? 10 : id === 'H1:idx:2' ? 30 : null),
  headingIndexOfStableIdentity: (id: string) => (id === 'H1:idx:1' ? 1 : id === 'H1:idx:2' ? 2 : null),
}

describe('V5.14-R1 §4 — occurrence-level flatten', () => {
  it('R2: a multi-target diagnostic expands to N projections (never split into N diagnostics)', () => {
    const ps = flattenDiagnosticsToProjections([multiH1()], ctx)
    expect(ps).toHaveLength(2)
    expect(ps.map(p => p.targetIndex)).toEqual([0, 1])
    expect(ps.map(p => p.targetCount)).toEqual([2, 2])
    expect(ps.map(p => p.diagnosticId)).toEqual([multiH1().id, multiH1().id])
    expect(ps.map(p => p.stableIdentity)).toEqual(['H1:idx:1', 'H1:idx:2'])
  })

  it('a single-target diagnostic yields exactly one projection', () => {
    const ps = flattenDiagnosticsToProjections([at('a', 'CODE_MISSING', 12)], ctx)
    expect(ps).toHaveLength(1)
    expect(ps[0].targetIndex).toBe(0)
    expect(ps[0].targetCount).toBe(1)
    expect(ps[0].sourceLine).toBe(12)
    expect(ps[0].sourceStartOffset).toBe(480)
  })

  it('§3: canonical-node targets resolve their position from the host identity map', () => {
    const ps = flattenDiagnosticsToProjections([multiH1()], ctx)
    expect(ps[0].canonicalHeadingIndex).toBe(1)
    expect(ps[1].canonicalHeadingIndex).toBe(2)
    expect(ps[0].sourceLine).toBe(10)
    expect(ps[1].sourceLine).toBe(30)
  })
})

describe('V5.14-R1 §3/§31 — documentPosition authority', () => {
  it('document-start sorts first, document-end last, real source positions in between', () => {
    const ps = flattenDiagnosticsToProjections([
      at('late', 'A', 90),
      diag({ id: 'end', code: 'DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE', location: { kind: 'document-end' } } as Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>),
      diag({ id: 'start', code: 'DOCUMENT_EMPTY', location: { kind: 'document-start' } } as Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>),
      at('early', 'B', 10),
    ], ctx)
    const sorted = sortProjectionsByDocumentPosition(ps)
    expect(sorted.map(p => p.diagnosticId)).toEqual(['start', 'early', 'late', 'end'])
    expect(documentPositionOf(sorted[0]).band).toBe(0)
    expect(documentPositionOf(sorted[sorted.length - 1]).band).toBe(2)
  })

  it('§41: severity is a TIE-BREAK only — a later warning never jumps an earlier error', () => {
    const ps = flattenDiagnosticsToProjections([
      at('err-late', 'E', 80, 'error'),
      at('warn-early', 'W', 10, 'warning'),
    ], ctx)
    const sorted = sortProjectionsByDocumentPosition(ps)
    expect(sorted.map(p => p.diagnosticId)).toEqual(['warn-early', 'err-late'])
  })

  it('§3: at an identical position the order is error → warning → info', () => {
    const ps = flattenDiagnosticsToProjections([
      at('i', 'I', 30, 'info'),
      at('e', 'E', 30, 'error'),
      at('w', 'W', 30, 'warning'),
    ], ctx)
    expect(sortProjectionsByDocumentPosition(ps).map(p => p.diagnosticId)).toEqual(['e', 'w', 'i'])
  })

  it('R2: multi-target occurrences MAY interleave with other diagnostics', () => {
    const ps = flattenDiagnosticsToProjections([
      multiH1(),              // targets resolve to line 10 and line 30
      at('code', 'CODE_MISSING_NAME', 20), // sits BETWEEN them in source order
    ], ctx)
    const sorted = sortProjectionsByDocumentPosition(ps)
    expect(sorted.map(projectionKey)).toEqual([
      'document:STRICT_SINGLE_H1_MULTIPLE_H1#0',
      'code#0',
      'document:STRICT_SINGLE_H1_MULTIPLE_H1#1',
    ])
  })

  it('§3: an unlocatable target sorts after every located one but before document-end', () => {
    const ps = flattenDiagnosticsToProjections([
      diag({ id: 'unknown', code: 'X' } as Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>),
      at('located', 'A', 10),
      diag({ id: 'end', code: 'Y', location: { kind: 'document-end' } } as Partial<DocumentDiagnostic> & Pick<DocumentDiagnostic, 'id' | 'code'>),
    ], ctx)
    expect(sortProjectionsByDocumentPosition(ps).map(p => p.diagnosticId)).toEqual(['located', 'unknown', 'end'])
  })
})

describe('V5.14-R1 §32/§41 — filters and gates', () => {
  it('R4/§32: filtering only REMOVES entries and preserves the relative order', () => {
    const ps = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections([
      at('e1', 'E1', 10, 'error'),
      at('w1', 'W1', 20, 'warning'),
      at('e2', 'E2', 30, 'error'),
    ], ctx))
    const errors = filterProjectionsBySeverity(ps, 'error')
    expect(errors.map(p => p.diagnosticId)).toEqual(['e1', 'e2'])
    expect(isOrderPreservingSubsequence(ps, errors)).toBe(true)
    expect(isOrderPreservingSubsequence(ps, filterProjectionsBySeverity(ps, 'all'))).toBe(true)
  })

  it('R1: the sorted list has ZERO document-order inversions and 0 ties here', () => {
    const ps = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections([
      at('b', 'B', 50), at('a', 'A', 10), multiH1(),
    ], ctx))
    expect(countDocumentOrderInversions(ps)).toBe(0)
    const summary = summarizeDrawerOrderAudit([], ps)
    expect(summary.isMonotonicDocumentOrder).toBe(true)
    expect(summary.entryCount).toBe(4)
    expect(summary.driftWithoutSourceChange).toBe(0)
  })

  it('R3/§41: a rule-grouped (non-interleaved) multi-target render is detected', () => {
    const expected = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections([
      multiH1(), at('code', 'CODE_MISSING_NAME', 20),
    ], ctx))
    // the OLD behaviour: keep the diagnostic's own targets adjacent
    const grouped: DiagnosticTargetProjection[] = [expected[0], expected[2], expected[1]]
    expect(countMultiTargetGroupedInsteadOfPositionSorted(expected, grouped)).toBe(1)
    expect(countMultiTargetGroupedInsteadOfPositionSorted(expected, expected)).toBe(0)
    expect(countDocumentOrderInversions(grouped)).toBe(1)
  })

  it('§6: identical source facts forbid order drift', () => {
    const a = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections([at('x', 'X', 10), at('y', 'Y', 20)], ctx))
    const b = [...a]
    expect(countDocumentOrderDriftWithoutSourceChange(a, b)).toBe(0)
    const swapped = [b[1], b[0]]
    expect(countDocumentOrderDriftWithoutSourceChange(a, swapped)).toBe(1)
    // a REAL source change is not "drift" (the order is allowed to change)
    const changed = sortProjectionsByDocumentPosition(flattenDiagnosticsToProjections([at('x', 'X', 30), at('y', 'Y', 20)], ctx))
    expect(countDocumentOrderDriftWithoutSourceChange(a, changed)).toBe(0)
  })

  it('§41: the 5 Drawer gate keys are complete and 0 ⇒ PASS', () => {
    expect(DRAWER_ORDER_V514R1_GATE_KEYS).toHaveLength(5)
    expect(Object.keys(DRAWER_ORDER_V514R1_GATE_LABELS)).toHaveLength(5)
    const counters = createDrawerOrderV514R1Counters()
    expect(evaluateDrawerOrderV514R1Gates(counters).decision).toBe('PASS')
    const report = formatDrawerOrderV514R1GateReport(counters)
    for (const label of [
      'DRAWER_DOCUMENT_ORDER_INVERSION_COUNT',
      'DRAWER_FILTER_RELATIVE_ORDER_MUTATION_COUNT',
      'DRAWER_MULTI_TARGET_GROUPED_INSTEAD_OF_POSITION_SORTED_COUNT',
      'DRAWER_SELECTED_TARGET_CHANGED_WITHOUT_USER_INTENT_COUNT',
      'DRAWER_DOCUMENT_ORDER_DRIFT_WITHOUT_SOURCE_CHANGE_COUNT',
    ]) expect(report).toContain(`${label}=0`)
    counters.documentOrderInversion = 1
    expect(evaluateDrawerOrderV514R1Gates(counters).failedChecks).toEqual(['documentOrderInversion'])
  })
})
