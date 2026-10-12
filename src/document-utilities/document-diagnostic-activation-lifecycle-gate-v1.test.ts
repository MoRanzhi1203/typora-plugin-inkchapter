/**
 * TRAE §P6 — the document-end ACTIVATION LIFECYCLE hard-gate family.
 */
import { describe, it, expect } from 'vitest'
import {
  ACTIVATION_LIFECYCLE_GATE_KEYS,
  ACTIVATION_LIFECYCLE_GATE_LABELS,
  createActivationLifecycleGateCounters,
  evaluateActivationLifecycleGates,
  formatActivationLifecycleGateReport,
} from './document-diagnostic-activation-lifecycle-gate-v1'

describe('TRAE §P6 — activation lifecycle gates', () => {
  it('declares the 6 required gates and starts at 0 ⇒ PASS', () => {
    expect(ACTIVATION_LIFECYCLE_GATE_KEYS).toHaveLength(6)
    expect(Object.keys(ACTIVATION_LIFECYCLE_GATE_LABELS)).toHaveLength(6)
    const c = createActivationLifecycleGateCounters()
    expect(evaluateActivationLifecycleGates(c).decision).toBe('PASS')
    const report = formatActivationLifecycleGateReport(c)
    for (const label of [
      'PLUGIN_PRESENTATION_FALSE_INVALIDATION_COUNT=0',
      'SELECTED_DIAGNOSTIC_UNEXPECTED_CLEAR_COUNT=0',
      'ACTIVE_VISUAL_UNEXPECTED_RELEASE_COUNT=0',
      'PENDING_GEOMETRY_RECOVERY_LOST_COUNT=0',
      'STALE_RECOVERY_COMMIT_COUNT=0',
      'RECOVERY_SYNTHETIC_CLICK_COUNT=0',
    ]) expect(report).toContain(label)
  })

  it('any non-zero counter is a FAIL with its exact label', () => {
    for (const key of ACTIVATION_LIFECYCLE_GATE_KEYS) {
      const c = createActivationLifecycleGateCounters()
      c[key] = 1
      const r = evaluateActivationLifecycleGates(c)
      expect(r.decision, key).toBe('FAIL')
      expect(r.failing, key).toEqual([ACTIVATION_LIFECYCLE_GATE_LABELS[key]])
    }
  })
})
