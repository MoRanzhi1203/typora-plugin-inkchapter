import { describe, it, expect } from 'vitest'
import {
  DOC_END_COORDINATE_COVERAGE_KEYS,
  DOC_END_COORDINATE_GATE_KEYS,
  DOCUMENT_END_PROJECTION_DRIFT_TOLERANCE_PX,
  createDocEndCoordinateCounters,
  createDocEndCoordinateCoverageCounters,
  evaluateDocEndCoordinateAudit,
  evaluateDocEndCoordinateCoverage,
  evaluateDocEndCoordinateGates,
  formatDocEndCoordinateCoverageReport,
  formatDocEndCoordinateGateReport,
  projectDocumentLocalToViewport,
  projectViewportToDocumentLocal,
  type DocEndRect,
  type SyntheticEofCoordinateFacts,
} from './document-diagnostic-document-end-coordinate-v2'

const rect = (left: number, top: number, width: number, height: number): DocEndRect => ({
  left, top, right: left + width, bottom: top + height, width, height,
})

/**
 * The REAL runtime numbers (app-1790794803482.log, transactionId=8 fail vs 9 pass):
 *   document-local band  = 707.25 .. 1238.85 (height 531.6)
 *   settled scrollTop    = 632
 *   host viewport top    = -600 after the scroll, +32 before it
 *   expected viewport    = 107.25 .. 638.85   (the PASS case)
 *   observed BAD viewport= 739.25 .. 1270.85  (local + 32: the pre-scroll host)
 */
const DOCUMENT_LOCAL = rect(30, 707.25, 830, 531.6)
const HOST_AFTER_SCROLL = rect(280.5, -600, 860, 1351.65)
const HOST_BEFORE_SCROLL = rect(280.5, 32, 860, 1351.65)

function facts(over: Partial<SyntheticEofCoordinateFacts> = {}): SyntheticEofCoordinateFacts {
  return {
    transactionId: 8,
    scrollTopBefore: 0,
    scrollTopAfter: 632,
    maxScrollTopAfter: 632,
    scrollDelta: 632,
    scrollWriteCount: 1,
    scrollSettled: true,
    scrollObserved: true,
    alreadyAtTarget: false,
    documentLocalRect: DOCUMENT_LOCAL,
    preScrollViewportRect: rect(310.5, 739.25, 830, 531.6),
    postScrollViewportRect: rect(310.5, 107.25, 830, 531.6),
    expectedViewportRect: rect(310.5, 107.25, 830, 531.6),
    consumedCoordinateSpace: 'VIEWPORT',
    postScrollRemeasured: true,
    postScrollReprojected: true,
    layoutEpochBefore: 28,
    layoutEpochAfter: 29,
    layoutEpochCurrent: 29,
    geometryGenerationBefore: 5,
    geometryGenerationAfter: 6,
    presentationVisibleHeightRatio: 1,
    visualDecision: 'PASS',
    interactionRolledBackAfterScroll: false,
    ...over,
  }
}

describe('EOF-V2 — coordinate-space contract', () => {
  it('A — document-local + host origin projects to the CORRECT viewport rect', () => {
    const fresh = projectDocumentLocalToViewport({
      documentLocalRect: DOCUMENT_LOCAL,
      hostViewportRect: HOST_AFTER_SCROLL,
    })!
    expect(Math.round(fresh.top)).toBe(107)
    expect(Math.round(fresh.bottom)).toBe(639)
    // …and the inverse restores the document-local rect exactly.
    const back = projectViewportToDocumentLocal({
      viewportRect: fresh,
      hostViewportRect: HOST_AFTER_SCROLL,
    })!
    expect(back.top).toBeCloseTo(DOCUMENT_LOCAL.top, 6)
  })

  it('A2 — the PRE-SCROLL host origin produces the exact reported defect (drift == scrollTop)', () => {
    const stale = projectDocumentLocalToViewport({
      documentLocalRect: DOCUMENT_LOCAL,
      hostViewportRect: HOST_BEFORE_SCROLL,
    })!
    expect(Math.round(stale.top)).toBe(739)
    expect(Math.round(stale.bottom)).toBe(1271)
    expect(Math.round(stale.top - 107)).toBe(632)
  })

  it('B — a real scroll with a stale projection FAILS as POST_SCROLL_COORDINATE_STALE', () => {
    const stale = projectDocumentLocalToViewport({
      documentLocalRect: DOCUMENT_LOCAL,
      hostViewportRect: HOST_BEFORE_SCROLL,
    })!
    const r = evaluateDocEndCoordinateAudit(facts({
      postScrollViewportRect: stale,
      expectedViewportRect: projectDocumentLocalToViewport({
        documentLocalRect: DOCUMENT_LOCAL, hostViewportRect: HOST_AFTER_SCROLL,
      }),
      presentationVisibleHeightRatio: 0.023684279362958176,
      visualDecision: 'FAIL',
    }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('POST_SCROLL_COORDINATE_STALE')
    expect(r.projectionDriftPx).toBeGreaterThan(DOCUMENT_END_PROJECTION_DRIFT_TOLERANCE_PX)
  })

  it('B2 — a document-local rect consumed as viewport is a hard violation', () => {
    const r = evaluateDocEndCoordinateAudit(facts({ consumedCoordinateSpace: 'DOCUMENT_LOCAL' }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('DOCUMENT_LOCAL_RECT_USED_AS_VIEWPORT')
  })

  it('B3 — a real scroll without a remeasure is a hard violation', () => {
    const r = evaluateDocEndCoordinateAudit(facts({ postScrollRemeasured: false, postScrollReprojected: false }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('POST_SCROLL_REMEASURE_MISSING')
  })

  it('C — the no-scroll fast path (ALREADY_AT_TARGET) still commits with fresh geometry', () => {
    const r = evaluateDocEndCoordinateAudit(facts({
      transactionId: 9,
      scrollTopBefore: 632,
      scrollTopAfter: 632,
      scrollDelta: 0,
      scrollWriteCount: 0,
      alreadyAtTarget: true,
      postScrollViewportRect: rect(310.5, 107.25, 830, 531.6),
    }))
    expect(r.decision).toBe('PASS')
    expect(r.reason).toBe('NO_SCROLL_GEOMETRY_FRESH')
  })

  it('D — a closure evaluated BEFORE the scroll is never a visual failure', () => {
    const r = evaluateDocEndCoordinateAudit(facts({
      scrollObserved: false,
      scrollTopAfter: 0,
      scrollDelta: 0,
      scrollWriteCount: 0,
      postScrollRemeasured: false,
      postScrollReprojected: false,
      visualDecision: 'NOT_EVALUATED',
      presentationVisibleHeightRatio: 0.023684279362958176,
    }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('VISUAL_CLOSURE_BEFORE_POST_SCROLL_PROJECTION')
  })

  it('E — a successful scroll rolled back is a hard violation (§13)', () => {
    const r = evaluateDocEndCoordinateAudit(facts({ interactionRolledBackAfterScroll: true }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('ACTIVE_STATE_ROLLED_BACK_AFTER_SCROLL_SUCCESS')
  })

  it('F — stale layout epoch after the scroll is a hard violation', () => {
    const r = evaluateDocEndCoordinateAudit(facts({ layoutEpochAfter: 28, layoutEpochCurrent: 29 }))
    expect(r.decision).toBe('FAIL')
    expect(r.failedChecks).toContain('POST_SCROLL_STALE_LAYOUT_EPOCH')
  })

  it('G — every fatal gate is 0 by default and a non-zero one FAILs', () => {
    const counters = createDocEndCoordinateCounters()
    expect(formatDocEndCoordinateGateReport(counters).length).toBe(DOC_END_COORDINATE_GATE_KEYS.length)
    expect(evaluateDocEndCoordinateGates(counters).decision).toBe('PASS')
    counters.documentEndSecondClickRequired = 1
    expect(evaluateDocEndCoordinateGates(counters).decision).toBe('FAIL')
  })

  it('H — the positive coverage minimums are enforced (no all-zero false pass)', () => {
    const empty = createDocEndCoordinateCoverageCounters()
    expect(formatDocEndCoordinateCoverageReport(empty).length).toBe(DOC_END_COORDINATE_COVERAGE_KEYS.length)
    expect(evaluateDocEndCoordinateCoverage(empty).decision).toBe('FAIL')
    const full = createDocEndCoordinateCoverageCounters()
    full.documentEndFirstClickFromNonBottomRuntime = 1
    full.documentEndSwitchFromOtherDiagnosticRuntime = 1
    full.documentEndActivateFromIdleRuntime = 1
    full.documentEndAlreadyAtBottomRuntime = 1
    full.documentEndRealScrollRuntime = 1
    full.documentEndPostScrollRemeasureRuntime = 1
    full.documentEndPostScrollReprojectRuntime = 1
    full.documentEndOneClickCommittedRuntime = 2
    full.documentEndSameTargetDeactivateRuntime = 1
    expect(evaluateDocEndCoordinateCoverage(full).decision).toBe('PASS')
  })
})
