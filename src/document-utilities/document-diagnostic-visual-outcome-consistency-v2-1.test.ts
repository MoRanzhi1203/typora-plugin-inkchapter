/**
 * P0 VIS — the V2.1 visual-outcome record must never describe a FAILED presentation
 * gate as `PRESENTED`.
 *
 * Observed on the current build (audit session runtime-sess-1793189621674.log):
 *
 *   gateReason    = "PRESENTATION_NOT_BUILT,VISUAL_CARRIER_MISSING,PANEL_GEOMETRY_CLIP"
 *   visualOutcome = "PRESENTED"
 *   fillCommitted = false
 *
 * while the closure audit for the same transaction reported `blockGapActiveFillCount=1`.
 * Two defects made that possible:
 *
 *  1. `classifyDiagnosticVisualFailure` returned `PRESENTED` for ANY non-layering gate
 *     reason, so a gate that really failed was recorded as a clean presentation;
 *  2. `isPanelLayeringCollisionReason` compared the WHOLE string, so a comma-joined
 *     reason list could never match the layering family.
 */
import { describe, it, expect } from 'vitest'

import {
  classifyDiagnosticVisualFailure,
  isPanelLayeringCollisionReason,
} from './document-diagnostic-visual-transaction-v2-1'

const OBSERVED_GATE_REASON = 'PRESENTATION_NOT_BUILT,VISUAL_CARRIER_MISSING,PANEL_GEOMETRY_CLIP'

const BASE = {
  gateReason: OBSERVED_GATE_REASON,
  targetResolved: true,
  targetEnteredViewport: true,
  fillCommitted: true,
  coverageValid: true,
  panelLayeringCollision: false,
  documentEndClamped: false,
}

describe('VIS — the outcome record may not contradict its own gate', () => {
  it('a failed non-layering gate with a committed fill is DEGRADED_PRESENTED, never PRESENTED', () => {
    const c = classifyDiagnosticVisualFailure(BASE)
    expect(c.visual).not.toBe('PRESENTED')
    expect(c.visual).toBe('DEGRADED_PRESENTED')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
    expect(c.reason).toBe('GATE_FAILED_NON_LAYERING')
  })

  it('a failed gate WITHOUT a fill is still DEGRADED (the interaction succeeded), never PRESENTED', () => {
    const c = classifyDiagnosticVisualFailure({ ...BASE, fillCommitted: false })
    expect(c.visual).toBe('DEGRADED_PRESENTED')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
  })

  it('a clean gate with a committed fill is still PRESENTED', () => {
    const c = classifyDiagnosticVisualFailure({ ...BASE, gateReason: '' })
    expect(c.visual).toBe('PRESENTED')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
  })

  it('a comma-joined reason list is recognised by the layering-collision family', () => {
    expect(isPanelLayeringCollisionReason('PRESENTATION_NOT_BUILT,FRAME_PAINTS_ABOVE_PANEL_SURFACE')).toBe(true)
    expect(isPanelLayeringCollisionReason('PANEL_GEOMETRY_CLIP, FRAME_PAINTS_ABOVE_NAVIGATOR')).toBe(true)
    expect(isPanelLayeringCollisionReason('PRESENTATION_NOT_BUILT,VISUAL_CARRIER_MISSING')).toBe(false)
  })

  it('a joined layering list still classifies as RECOVERABLE_COLLISION (not DEGRADED)', () => {
    const c = classifyDiagnosticVisualFailure({
      ...BASE,
      gateReason: 'PRESENTATION_NOT_BUILT,FRAME_PAINTS_ABOVE_PANEL_SURFACE',
    })
    expect(c.visual).toBe('RECOVERABLE_COLLISION')
    expect(c.keepActive).toBe(true)
    expect(c.rollbackRequired).toBe(false)
  })

  it('an unresolved target stays an interaction failure regardless of the gate text', () => {
    const c = classifyDiagnosticVisualFailure({ ...BASE, targetResolved: false, fillCommitted: false })
    expect(c.locate).toBe('UNRESOLVABLE')
    expect(c.visual).toBe('UNRECOVERABLE_PRESENTATION_FAILURE')
    expect(c.rollbackRequired).toBe(true)
  })
})
