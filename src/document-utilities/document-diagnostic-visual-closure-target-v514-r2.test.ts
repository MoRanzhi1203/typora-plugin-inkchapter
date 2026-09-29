/**
 * V5.14-R2 §P6 — Multi-target Visual Closure reconciliation against the REAL
 * rendered passive markers.
 *
 * Unit test items §10 8–15.
 */
import { describe, expect, it } from 'vitest'
import {
  VISUAL_CLOSURE_TARGET_AUDIT_EVENT,
  VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS,
  VISUAL_CLOSURE_TARGET_V514R2_GATE_LABELS,
  buildDiagnosticVisualTargetKey,
  createVisualClosureTargetV514R2Counters,
  evaluateVisualClosureTargetV514R2Gates,
  formatVisualClosureTargetV514R2GateReport,
  reconcileExpectedVisualTargets,
  visualClosureReconciliationToGateCounters,
  type ExpectedVisualTarget,
  type PassiveMarkerFact,
} from './document-diagnostic-visual-closure-target-v514-r2'

const DOC = 'doc-A'

function makeExpected(
  stableIdentity: string,
  diagnosticId = 'DIAG-1',
  targetIndex = 0,
  documentKey = DOC,
  multiTarget = true,
): ExpectedVisualTarget {
  return {
    visualTargetKey: buildDiagnosticVisualTargetKey({ documentKey, diagnosticId, targetIndex, stableIdentity }),
    documentKey,
    diagnosticId,
    targetIndex,
    stableIdentity,
    multiTarget,
  }
}

function makeFact(
  expected: ExpectedVisualTarget,
  overrides: Partial<PassiveMarkerFact> = {},
): PassiveMarkerFact {
  return {
    visualTargetKey: expected.visualTargetKey,
    documentKey: expected.documentKey,
    diagnosticId: expected.diagnosticId,
    targetIndex: expected.targetIndex,
    stableIdentity: expected.stableIdentity,
    role: 'passive',
    connected: true,
    ...overrides,
  }
}

describe('V5.14-R2 P6 — real passive-marker reconciliation', () => {
  // §10-8
  it('08. multi-target 2 expected / 2 rendered -> PASS', () => {
    const h1 = makeExpected('heading:H1b')
    const h2 = makeExpected('heading:H1c', 'DIAG-1', 1)
    const recon = reconcileExpectedVisualTargets([h1, h2], [makeFact(h1), makeFact(h2)], DOC)
    expect(recon.expectedCount).toBe(2)
    expect(recon.actualCount).toBe(2)
    expect(recon.missingKeys).toEqual([])
    expect(recon.extraKeys).toEqual([])
    expect(recon.duplicateKeys).toEqual([])
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).decision).toBe('PASS')
  })

  // §10-9
  it('09. missing target -> FAIL (expectedPassiveMarkerMissing)', () => {
    const h1 = makeExpected('heading:H1b')
    const h2 = makeExpected('heading:H1c', 'DIAG-1', 1)
    const recon = reconcileExpectedVisualTargets([h1, h2], [makeFact(h1)], DOC)
    expect(recon.missingKeys).toEqual([h2.visualTargetKey])
    expect(recon.multiTargetMissingCount).toBe(1)
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.expectedPassiveMarkerMissing).toBe(1)
    expect(counters.headingMultiTargetPassiveMissing).toBe(1)
    const decision = evaluateVisualClosureTargetV514R2Gates(counters)
    expect(decision.decision).toBe('FAIL')
    expect(decision.failedChecks).toContain('expectedPassiveMarkerMissing')
  })

  // §10-10
  it('10. extra rendered marker -> FAIL (unexpectedPassiveMarkerExtra)', () => {
    const expected = makeExpected('heading:H1b')
    const orphan = makeExpected('heading:H1z', 'DIAG-9', 0)
    const recon = reconcileExpectedVisualTargets([expected], [makeFact(expected), makeFact(orphan)], DOC)
    expect(recon.extraKeys).toEqual([orphan.visualTargetKey])
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.unexpectedPassiveMarkerExtra).toBe(1)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).failedChecks).toContain('unexpectedPassiveMarkerExtra')
  })

  // §10-11
  it('11. duplicate rendered marker -> FAIL (duplicatePassiveMarker)', () => {
    const expected = makeExpected('heading:H1b')
    const recon = reconcileExpectedVisualTargets([expected], [makeFact(expected), makeFact(expected)], DOC)
    expect(recon.duplicateKeys).toEqual([expected.visualTargetKey])
    expect(recon.actualCount).toBe(2)
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.duplicatePassiveMarker).toBe(1)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).failedChecks).toContain('duplicatePassiveMarker')
  })

  // §10-12
  it('12. wrong stableIdentity on a matched key -> FAIL', () => {
    const expected = makeExpected('heading:H1b')
    const recon = reconcileExpectedVisualTargets(
      [expected],
      [makeFact(expected, { stableIdentity: 'heading:H1b-other' })],
      DOC,
    )
    expect(recon.identityMismatchKeys).toEqual([expected.visualTargetKey])
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.passiveMarkerIdentityMismatch).toBe(1)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).failedChecks).toContain('passiveMarkerIdentityMismatch')
  })

  // §10-13
  it('13. wrong targetIndex on a matched key -> FAIL', () => {
    const expected = makeExpected('heading:H1b', 'DIAG-1', 1)
    const recon = reconcileExpectedVisualTargets([expected], [makeFact(expected, { targetIndex: 0 })], DOC)
    expect(recon.targetIndexMismatchKeys).toEqual([expected.visualTargetKey])
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.passiveMarkerTargetIndexMismatch).toBe(1)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).failedChecks).toContain('passiveMarkerTargetIndexMismatch')
  })

  // §10-14
  it('14. stale document marker -> FAIL (passiveMarkerStaleDocument)', () => {
    const expected = makeExpected('heading:H1b')
    const stale = makeExpected('heading:H1z', 'DIAG-9', 0, 'doc-OLD')
    const recon = reconcileExpectedVisualTargets(
      [expected],
      [makeFact(expected), makeFact(stale, { documentKey: 'doc-OLD' })],
      DOC,
    )
    expect(recon.staleDocumentKeys).toEqual([stale.visualTargetKey])
    const counters = visualClosureReconciliationToGateCounters(recon, 0)
    expect(counters.passiveMarkerStaleDocument).toBe(1)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).failedChecks).toContain('passiveMarkerStaleDocument')
  })

  // §10-15
  it('15. an ACTIVE marker never substitutes a passive one (except the active key)', () => {
    const a = makeExpected('heading:H1b')
    const b = makeExpected('heading:H1c', 'DIAG-1', 1)
    const facts = [makeFact(a, { role: 'active' })]
    // without the active-key exemption, BOTH are missing
    const strict = reconcileExpectedVisualTargets([a, b], facts, DOC, null)
    expect(strict.missingKeys).toEqual([a.visualTargetKey, b.visualTargetKey])
    // with the exemption only A (the active occurrence) is satisfied; B stays missing
    const withActive = reconcileExpectedVisualTargets([a, b], facts, DOC, new Set([a.visualTargetKey]))
    expect(withActive.missingKeys).toEqual([b.visualTargetKey])
    expect(withActive.activeSatisfied).toBe(true)
    // an active fact for a NON-active key still cannot substitute it
    const wrongActive = reconcileExpectedVisualTargets([a, b], facts, DOC, new Set([b.visualTargetKey]))
    expect(wrongActive.missingKeys).toEqual([a.visualTargetKey, b.visualTargetKey])
  })

  it('16. disconnected markers never satisfy an expectation', () => {
    const expected = makeExpected('heading:H1b')
    const recon = reconcileExpectedVisualTargets([expected], [makeFact(expected, { connected: false })], DOC)
    expect(recon.missingKeys).toEqual([expected.visualTargetKey])
    expect(recon.actualCount).toBe(0)
  })

  it('17. locatableHeadingDiagnosticWithoutVisualTarget is carried through untouched', () => {
    const counters = visualClosureReconciliationToGateCounters(
      reconcileExpectedVisualTargets([], [], DOC),
      2,
    )
    expect(counters.locatableHeadingDiagnosticWithoutVisualTarget).toBe(2)
    expect(evaluateVisualClosureTargetV514R2Gates(counters).decision).toBe('FAIL')
  })

  it('18. gate keys / labels / report / counters are complete and ordered', () => {
    expect(VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS).toEqual([
      'expectedPassiveMarkerMissing',
      'unexpectedPassiveMarkerExtra',
      'duplicatePassiveMarker',
      'passiveMarkerIdentityMismatch',
      'passiveMarkerTargetIndexMismatch',
      'passiveMarkerStaleDocument',
      'locatableHeadingDiagnosticWithoutVisualTarget',
      'headingMultiTargetPassiveMissing',
    ])
    expect(VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS.length).toBe(8)
    const counters = createVisualClosureTargetV514R2Counters()
    expect(formatVisualClosureTargetV514R2GateReport(counters)).toEqual([
      'EXPECTED_PASSIVE_MARKER_MISSING_COUNT=0',
      'UNEXPECTED_PASSIVE_MARKER_EXTRA_COUNT=0',
      'DUPLICATE_PASSIVE_MARKER_COUNT=0',
      'PASSIVE_MARKER_IDENTITY_MISMATCH_COUNT=0',
      'PASSIVE_MARKER_TARGET_INDEX_MISMATCH_COUNT=0',
      'PASSIVE_MARKER_STALE_DOCUMENT_COUNT=0',
      'LOCATABLE_HEADING_DIAGNOSTIC_WITHOUT_VISUAL_TARGET_COUNT=0',
      'HEADING_MULTI_TARGET_PASSIVE_MISSING_COUNT=0',
    ])
    for (const key of VISUAL_CLOSURE_TARGET_V514R2_GATE_KEYS) {
      expect(VISUAL_CLOSURE_TARGET_V514R2_GATE_LABELS[key]).toBeTruthy()
    }
    expect(VISUAL_CLOSURE_TARGET_AUDIT_EVENT).toBe('DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-TARGET-AUDIT')
  })
})
