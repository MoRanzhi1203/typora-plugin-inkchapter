/**
 * V5.14-R9 / Active State Machine V2.1 — recoverable visual collision, atomic
 * rollback (fill + marker + lease + transaction closure) and the illegal-IDLE
 * production repair.
 */
import { describe, it, expect } from 'vitest'
import {
  VISUAL_TRANSACTION_V21_GATE_KEYS,
  VISUAL_TRANSACTION_V21_GATE_LABELS,
  classifyDiagnosticVisualFailure,
  createVisualTransactionV21Counters,
  createVisualTransactionV21CoverageCounters,
  evaluateAtomicTeardown,
  evaluateVisualTransactionV21Gates,
  formatVisualTransactionV21CoverageReport,
  formatVisualTransactionV21GateReport,
  isPanelLayeringCollisionReason,
} from './document-diagnostic-visual-transaction-v2-1'

const RESOLVED_OK = {
  gateReason: 'FRAME_PAINTS_ABOVE_PANEL_SURFACE',
  targetResolved: true,
  targetEnteredViewport: true,
  fillCommitted: true,
  coverageValid: true,
  panelLayeringCollision: true,
  documentEndClamped: false,
}

describe('V2.1 §3/§4 — visual outcome is DECOUPLED from the interaction outcome', () => {
  it('§4.3 — a navigator collision with a resolved+filled target is RECOVERABLE, never a locate failure', () => {
    const c = classifyDiagnosticVisualFailure(RESOLVED_OK)
    expect(c.locate).toBe('RESOLVED')
    expect(c.visual).toBe('RECOVERABLE_COLLISION')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
    expect(c.strategy).toBe('PANEL_ABOVE_OVERLAY')
    // the exact ROOT_A prohibition: fill success + navigator collision != LOCATE_FAILED
    expect(c.locate).not.toBe('UNRESOLVABLE')
  })

  it('§4.1 — a target that did NOT resolve IS an interaction failure (rollback required)', () => {
    const c = classifyDiagnosticVisualFailure({
      ...RESOLVED_OK, targetResolved: false, fillCommitted: false, panelLayeringCollision: false,
    })
    expect(c.locate).toBe('UNRESOLVABLE')
    expect(c.visual).toBe('UNRECOVERABLE_PRESENTATION_FAILURE')
    expect(c.keepActive).toBe(false)
    expect(c.rollbackRequired).toBe(true)
  })

  it('§4.2 — resolved + presented (no layering collision) is a clean PRESENTED commit', () => {
    const c = classifyDiagnosticVisualFailure({
      gateReason: '', targetResolved: true, targetEnteredViewport: true,
      fillCommitted: true, coverageValid: true, panelLayeringCollision: false, documentEndClamped: false,
    })
    expect(c.visual).toBe('PRESENTED')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
  })

  it('§8 — at the document end the recovery strategy is the inset-safe geometry', () => {
    const c = classifyDiagnosticVisualFailure({ ...RESOLVED_OK, documentEndClamped: true })
    expect(c.visual).toBe('RECOVERABLE_COLLISION')
    expect(c.strategy).toBe('INSET_SAFE_GEOMETRY')
  })

  it('the layering-collision reason family is recognised (drawer / toolbar / navigator)', () => {
    expect(isPanelLayeringCollisionReason('FRAME_PAINTS_ABOVE_PANEL_SURFACE')).toBe(true)
    expect(isPanelLayeringCollisionReason('FRAME_PAINTS_ABOVE_NAVIGATOR')).toBe(true)
    expect(isPanelLayeringCollisionReason('FRAME_INTERSECTS_TOOLBAR')).toBe(true)
    expect(isPanelLayeringCollisionReason('FRAME_NOT_VISIBLE')).toBe(false)
    expect(isPanelLayeringCollisionReason('RECT_INVARIANT_FAIL')).toBe(false)
  })
})

describe('V2.1 §9/§11/§12 — the ATOMIC teardown verdict', () => {
  it('a complete teardown requires IDLE + 0 fill + no lease + 0 marker + no transaction', () => {
    const good = evaluateAtomicTeardown({
      statePhase: 'IDLE', activeFillCount: 0, activeLeasePresent: false,
      activeMarkerCount: 0, activeTransactionPresent: false,
    })
    expect(good.complete).toBe(true)
    expect(good.missing).toEqual([])
  })

  it('§12 — a fill that SURVIVES the rollback is an incomplete teardown (ROOT_E)', () => {
    const v = evaluateAtomicTeardown({
      statePhase: 'IDLE', activeFillCount: 2, activeLeasePresent: false,
      activeMarkerCount: 0, activeTransactionPresent: false,
    })
    expect(v.complete).toBe(false)
    expect(v.missing).toContain('FILL_SURVIVED')
  })

  it('§11 — a lease that SURVIVES the rollback is an incomplete teardown (ROOT_D)', () => {
    const v = evaluateAtomicTeardown({
      statePhase: 'IDLE', activeFillCount: 0, activeLeasePresent: true,
      activeMarkerCount: 0, activeTransactionPresent: false,
    })
    expect(v.complete).toBe(false)
    expect(v.missing).toContain('LEASE_SURVIVED')
  })

  it('a marker / transaction that survives is also incomplete', () => {
    expect(evaluateAtomicTeardown({
      statePhase: 'IDLE', activeFillCount: 0, activeLeasePresent: false,
      activeMarkerCount: 1, activeTransactionPresent: false,
    }).missing).toContain('MARKER_SURVIVED')
    expect(evaluateAtomicTeardown({
      statePhase: 'IDLE', activeFillCount: 0, activeLeasePresent: false,
      activeMarkerCount: 0, activeTransactionPresent: true,
    }).missing).toContain('TRANSACTION_SURVIVED')
  })
})

describe('V2.1 §16/§17 — the hard gates + the collision coverage surface', () => {
  it('the 13 V2.1 gates are declared, complete and 0 on a clean surface', () => {
    expect(VISUAL_TRANSACTION_V21_GATE_KEYS).toHaveLength(13)
    const counters = createVisualTransactionV21Counters()
    expect(formatVisualTransactionV21GateReport(counters)).toHaveLength(13)
    expect(evaluateVisualTransactionV21Gates(counters).decision).toBe('PASS')
    expect(VISUAL_TRANSACTION_V21_GATE_LABELS.idleWithActiveFill).toBe('IDLE_WITH_ACTIVE_FILL_COUNT')
    expect(VISUAL_TRANSACTION_V21_GATE_LABELS.unrecoveredFramePaintsAboveNavigator)
      .toBe('UNRECOVERED_FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT')
    const dirty = createVisualTransactionV21Counters()
    dirty.idleWithActiveFill = 1
    expect(evaluateVisualTransactionV21Gates(dirty).decision).toBe('FAIL')
  })

  it('§17 — DETECTION may be > 0, UNRECOVERED must be 0', () => {
    const c = createVisualTransactionV21CoverageCounters()
    c.framePaintsAboveNavigatorDetected = 3
    c.recoverableCollisionRecovered = 3
    expect(formatVisualTransactionV21CoverageReport(c)).toEqual([
      'FRAME_PAINTS_ABOVE_NAVIGATOR_COUNT=3',
      'RECOVERABLE_COLLISION_RECOVERED_COUNT=3',
      'RECOVERABLE_COLLISION_KEPT_ACTIVE_DEGRADED_COUNT=0',
      'NAVIGATOR_COLLISION_RUNTIME_OBSERVED_COUNT=0',
    ])
    expect(evaluateVisualTransactionV21Gates(createVisualTransactionV21Counters()).decision).toBe('PASS')
  })
})
