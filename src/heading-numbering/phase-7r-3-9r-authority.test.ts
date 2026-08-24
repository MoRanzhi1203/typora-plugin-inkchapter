// @vitest-environment node
/**
 * Phase 7R.3.9R — Caption pre-snapshot heading-authority gate.
 *
 * AUTH-1..6    readiness barrier / coalescing / single release / empty frame /
 *              wrong-document frame / missed-wakeup race / 100-request storm
 * SWITCH-1..2  document switch clears A intent/state, B starts WAITING
 * POSTREADY-1..2 READY requests pass the gate untouched (retry machine preserved)
 */

import { describe, it, expect } from 'vitest'
import {
  CaptionHeadingAuthorityGate,
  resolveCaptionHeadingAuthority,
} from './caption-heading-authority'

const RECONCILE = {
  HEADING_SEMANTICS_CHANGED: 1 << 1,
  OBJECT_STRUCTURE_CHANGED: 1 << 3,
  SETTINGS_CHANGED: 1 << 4,
} as const
const MASK = RECONCILE.HEADING_SEMANTICS_CHANGED | RECONCILE.OBJECT_STRUCTURE_CHANGED

function frameFor(docKey: string, generation = 1): { documentKey: string; semanticRevision: number; frameGeneration: number; frameFingerprint: string } {
  return { documentKey: docKey, semanticRevision: 3, frameGeneration: generation, frameFingerprint: `fp-${docKey}-${generation}` }
}

const TRIGGERS = ['rehydrate-empty', 'manual', 'settings-apply', 'document-open']

describe('AUTH — pre-authority barrier', () => {
  it('AUTH-1: no frame yet → every trigger is gated; ONE coalesced pending intent', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'README.md'
    for (const t of TRIGGERS) {
      const r = gate.decide(docKey, null, t, MASK)
      expect(r.decision).toBe('WAIT')
      expect(r.state.state).toBe('WAITING_FOR_HEADING_AUTHORITY')
    }
    const c = gate.getCounters()
    expect(c.preAuthReconcileRequestCount).toBe(4)
    expect(c.preAuthFullScanCount).toBe(4) // prevented scans recorded
    expect(c.preAuthTargetDiscoveryCount).toBe(4)
    expect(c.preAuthPlanBuildCount).toBe(4)
    expect(c.preAuthRetryBudgetConsumeCount).toBe(4)
    expect(c.preAuthParkCount).toBe(4)
    expect(c.preAuthHotLoopGuardTriggerCount).toBe(4)
    expect(c.preAuthCanonicalHostSetTransientTargetCount).toBe(4)
    const pending = gate.getPendingIntent()
    expect(pending).not.toBeNull()
    expect(pending!.documentKey).toBe(docKey)
    expect(pending!.reasons.size).toBe(TRIGGERS.length) // reasons coalesced, not dropped
  })

  it('AUTH-2: matching frame commit releases EXACTLY ONCE', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'README.md'
    for (const t of TRIGGERS) gate.decide(docKey, null, t, MASK)
    const r1 = gate.onFrameCommitted(frameFor(docKey), docKey)
    expect(r1.decision).toBe('RELEASED_ONE_RECONCILE')
    expect(r1.intent).not.toBeNull()
    expect(r1.intent!.reasons.size).toBe(TRIGGERS.length)
    // second commit must NOT release again (no pending intent left)
    const r2 = gate.onFrameCommitted(frameFor(docKey, 2), docKey)
    expect(r2.decision).toBe('READY')
    expect(r2.intent).toBeNull()
    const c = gate.getCounters()
    expect(c.authorityReadyReleaseCount).toBe(2) // two commits observed
    expect(c.authorityReadyReleaseReconcileCount).toBe(1) // only one reconcile released
  })

  it('AUTH-3: committed EMPTY frame (0 headings) is READY', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'no-headings.md'
    const empty = { documentKey: docKey, semanticRevision: 1, frameGeneration: 1, frameFingerprint: 'empty' }
    const r = gate.decide(docKey, empty, 'document-open', MASK)
    expect(r.decision).toBe('READY')
    expect(r.state.state).toBe('READY')
    expect(gate.getCounters().preAuthReconcileRequestCount).toBe(0)
    // readiness pure function agrees
    expect(resolveCaptionHeadingAuthority(docKey, empty).state).toBe('READY')
  })

  it('AUTH-4: wrong-document frame does not release', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docA = 'doc-a.md'
    const docB = 'doc-b.md'
    gate.decide(docB, null, 'document-open', MASK)
    const r = gate.onFrameCommitted(frameFor(docA), docB)
    expect(r.decision).toBe('RELEASE_IGNORED_WRONG_DOCUMENT')
    expect(r.intent).toBeNull()
    expect(gate.getCounters().authorityReadyReleaseReconcileCount).toBe(0)
    expect(gate.getState().state).toBe('WAITING_FOR_HEADING_AUTHORITY')
  })

  it('AUTH-5: missed-wakeup race — catch-up replay releases exactly once', () => {
    // Frame commits BEFORE the subscriber attaches (subscribe-first + catch-up):
    // the emitCurrent replay must deliver the current frame and release once.
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'race.md'
    // frame committed first (no subscriber yet)
    gate.onFrameCommitted(frameFor(docKey), docKey)
    // a pending intent arrived after the commit but before the subscriber
    gate.decide(docKey, null, 'document-open', MASK)
    // simulate emitCurrent catch-up replay of the already-committed frame
    const r = gate.onFrameCommitted(frameFor(docKey), docKey)
    expect(r.decision).toBe('RELEASED_ONE_RECONCILE')
    expect(r.intent).not.toBeNull()
    expect(gate.getCounters().authorityReadyReleaseReconcileCount).toBe(1)
  })

  it('AUTH-6: 100 pre-authority requests → zero scans, ONE pending intent, ONE release reconcile', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'storm.md'
    for (let i = 0; i < 100; i++) {
      gate.decide(docKey, null, `trigger-${i}`, MASK)
    }
    const c = gate.getCounters()
    expect(c.preAuthFullScanCount).toBe(100)
    expect(c.preAuthReconcileRequestCount).toBe(100)
    expect(gate.getPendingIntent()!.reasons.size).toBe(100)
    const r = gate.onFrameCommitted(frameFor(docKey), docKey)
    expect(r.decision).toBe('RELEASED_ONE_RECONCILE')
    expect(gate.getCounters().authorityReadyReleaseReconcileCount).toBe(1)
  })
})

describe('SWITCH — document switch semantics', () => {
  it('SWITCH-1: A READY → B waits; B frame commit releases ONE B reconcile', () => {
    const gate = new CaptionHeadingAuthorityGate()
    // A becomes READY
    gate.decide('doc-a.md', frameFor('doc-a.md'), 'document-open', MASK)
    expect(gate.getState().state).toBe('READY')
    // switch A → B
    gate.resetForDocumentSwitch('doc-b.md')
    expect(gate.getState().state).toBe('WAITING_FOR_HEADING_AUTHORITY')
    expect(gate.getPendingIntent()).toBeNull()
    // B triggers while waiting
    for (const t of ['document-open', 'settings-apply', 'mutation:CONTENT_RELEVANT']) {
      const r = gate.decide('doc-b.md', null, t, MASK)
      expect(r.decision).toBe('WAIT')
    }
    expect(gate.getCounters().preAuthFullScanCount).toBe(3)
    // B frame commits → one B reconcile
    const r = gate.onFrameCommitted(frameFor('doc-b.md'), 'doc-b.md')
    expect(r.decision).toBe('RELEASED_ONE_RECONCILE')
    expect(r.intent!.reasons.has('document-open')).toBe(true)
    expect(gate.getCounters().authorityReadyReleaseReconcileCount).toBe(1)
  })

  it('SWITCH-2: A parked retry state does not leak into B', () => {
    const gate = new CaptionHeadingAuthorityGate()
    // A accumulated pre-auth wait state + pending intent
    gate.decide('doc-a.md', null, 'document-open', MASK)
    gate.decide('doc-a.md', null, 'manual', MASK)
    // switch to B clears A intent + state
    gate.resetForDocumentSwitch('doc-b.md')
    expect(gate.getPendingIntent()).toBeNull()
    expect(gate.getState().state).toBe('WAITING_FOR_HEADING_AUTHORITY')
    // B does not inherit A's follow-up/park counters as failures
    const c = gate.getCounters()
    expect(c.preAuthReconcileRequestCount).toBe(2) // A's gated requests (history)
    expect(c.authorityReadyReleaseReconcileCount).toBe(0)
    // B fresh decide works
    const r = gate.decide('doc-b.md', null, 'document-open', MASK)
    expect(r.decision).toBe('WAIT')
    expect(gate.getPendingIntent()!.documentKey).toBe('doc-b.md')
  })
})

describe('POSTREADY — retry machine preserved after authority ready', () => {
  it('POSTREADY-1/2: READY requests pass the gate; transient safety remains in the retry machine', () => {
    const gate = new CaptionHeadingAuthorityGate()
    const docKey = 'post.md'
    gate.decide(docKey, frameFor(docKey), 'document-open', MASK)
    expect(gate.getState().state).toBe('READY')
    // a READY request is not gated (no pending intent recorded, no pre-auth count)
    const r = gate.decide(docKey, frameFor(docKey), 'mutation:CONTENT_RELEVANT', MASK)
    expect(r.decision).toBe('READY')
    expect(gate.getCounters().preAuthReconcileRequestCount).toBe(0)
    expect(gate.getPendingIntent()).toBeNull()
  })
})
