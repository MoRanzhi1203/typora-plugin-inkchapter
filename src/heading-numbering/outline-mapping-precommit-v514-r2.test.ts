/**
 * V5.14-R2 §P7 — Outline mapping PRE-COMMIT settle gate.
 *
 * Unit test items §10 16–22: pure gate + host wiring (jsdom).
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  OUTLINE_PRECOMMIT_MAPPING_AUDIT_EVENT,
  OUTLINE_PRECOMMIT_V514R2_GATE_KEYS,
  OUTLINE_PRECOMMIT_V514R2_GATE_LABELS,
  buildOutlineMappingSnapshot,
  createOutlinePrecommitV514R2Counters,
  evaluateOutlinePrecommitGate,
  evaluateOutlinePrecommitV514R2Gates,
  formatOutlinePrecommitV514R2GateReport,
  outlineMappingFingerprint,
  outlineMappingRetryKey,
} from './outline-mapping-precommit-v514-r2'
import { OutlineNumberingController } from './outline-numbering-controller'
import type { HeadingDescriptor } from './heading-types'

const AUTH = { documentKey: 'doc-a', sourceRevision: 7 }

function snapshot(overrides: Partial<Parameters<typeof buildOutlineMappingSnapshot>[0]> = {}) {
  return buildOutlineMappingSnapshot({
    documentKey: 'doc-a',
    sourceRevision: 7,
    layoutEpoch: 3,
    outlineRootToken: 11,
    outlineGeneration: 2,
    expectedHeadingCount: 2,
    nativeOutlineItemCount: 2,
    matchedHeadingCount: 2,
    unmatchedHeadingCount: 0,
    unmatchedOutlineCount: 0,
    rootConnected: true,
    rootVisible: true,
    ...overrides,
  })
}

describe('V5.14-R2 P7 — outline pre-commit settle gate (pure)', () => {
  // §10-16
  it('16. incomplete mapping -> WAITING_OUTLINE_SETTLE (zero DOM writes)', () => {
    const d = evaluateOutlinePrecommitGate(snapshot({ nativeOutlineItemCount: 1, matchedHeadingCount: 1, unmatchedHeadingCount: 1 }), AUTH)
    expect(d.state).toBe('WAITING_OUTLINE_SETTLE')
    expect(d.unmetConditions).toContain('EXPECTED_NATIVE_ITEM_COUNT_MISMATCH')
    expect(d.unmetConditions).toContain('MATCHED_HEADING_COUNT_MISMATCH')
    expect(d.unmetConditions).toContain('UNMATCHED_HEADING_PRESENT')
  })

  // §10-17
  it('17. matched count < expected -> no apply', () => {
    const d = evaluateOutlinePrecommitGate(snapshot({ matchedHeadingCount: 1, unmatchedHeadingCount: 1 }), AUTH)
    expect(d.state).toBe('WAITING_OUTLINE_SETTLE')
    expect(d.unmetConditions).toContain('MATCHED_HEADING_COUNT_MISMATCH')
  })

  // §10-18
  it('18. root not connected/visible -> no stale commit', () => {
    expect(evaluateOutlinePrecommitGate(snapshot({ rootConnected: false }), AUTH).unmetConditions)
      .toContain('ROOT_NOT_CONNECTED')
    expect(evaluateOutlinePrecommitGate(snapshot({ rootVisible: false }), AUTH).unmetConditions)
      .toContain('ROOT_NOT_VISIBLE')
  })

  // §10-19
  it('19. stable mapping -> PASS (apply allowed)', () => {
    const s = snapshot()
    const d = evaluateOutlinePrecommitGate(s, AUTH)
    expect(d.state).toBe('PASS')
    expect(d.unmetConditions).toEqual([])
    expect(s.mappingFingerprint).toBe(outlineMappingFingerprint({
      documentKey: 'doc-a', sourceRevision: 7, outlineGeneration: 2,
      expectedHeadingCount: 2, nativeOutlineItemCount: 2, matchedHeadingCount: 2,
      unmatchedHeadingCount: 0, unmatchedOutlineCount: 0,
    }))
  })

  // §10-22
  it('22. stale sourceRevision / documentKey -> WAITING (no commit)', () => {
    expect(evaluateOutlinePrecommitGate(snapshot(), { documentKey: 'doc-a', sourceRevision: 8 }).unmetConditions)
      .toContain('SOURCE_REVISION_NOT_CURRENT')
    expect(evaluateOutlinePrecommitGate(snapshot(), { documentKey: 'doc-b', sourceRevision: 7 }).unmetConditions)
      .toContain('DOCUMENT_KEY_NOT_CURRENT')
  })

  // §10-21
  it('21. the pending-retry identity is (documentKey, sourceRevision, outlineGeneration)', () => {
    expect(outlineMappingRetryKey({ documentKey: 'doc-a', sourceRevision: 7, outlineGeneration: 2 }))
      .toBe('doc-a::7::2')
  })

  it('23. gate keys / labels / report / counters are complete and ordered', () => {
    expect(OUTLINE_PRECOMMIT_V514R2_GATE_KEYS).toEqual([
      'outlineApplyBeforePrecommitVerify',
      'outlineUnstableMappingCommit',
      'outlineWaitingSettleDomWrite',
      'outlineCardinalityMismatchCommit',
      'outlineRootGenerationChangedDuringCommit',
      'outlineMappingRetryStorm',
      'outlineStaleRevisionCommit',
      'outlinePostcommitVerifyFailLeftDecoration',
    ])
    expect(OUTLINE_PRECOMMIT_V514R2_GATE_KEYS.length).toBe(8)
    const counters = createOutlinePrecommitV514R2Counters()
    expect(formatOutlinePrecommitV514R2GateReport(counters)).toEqual([
      'OUTLINE_APPLY_BEFORE_PRECOMMIT_VERIFY_COUNT=0',
      'OUTLINE_UNSTABLE_MAPPING_COMMIT_COUNT=0',
      'OUTLINE_WAITING_SETTLE_DOM_WRITE_COUNT=0',
      'OUTLINE_CARDINALITY_MISMATCH_COMMIT_COUNT=0',
      'OUTLINE_ROOT_GENERATION_CHANGED_DURING_COMMIT_COUNT=0',
      'OUTLINE_MAPPING_RETRY_STORM_COUNT=0',
      'OUTLINE_STALE_REVISION_COMMIT_COUNT=0',
      'OUTLINE_POSTCOMMIT_VERIFY_FAIL_LEFT_DECORATION_COUNT=0',
    ])
    for (const key of OUTLINE_PRECOMMIT_V514R2_GATE_KEYS) {
      expect(OUTLINE_PRECOMMIT_V514R2_GATE_LABELS[key]).toBeTruthy()
    }
    expect(evaluateOutlinePrecommitV514R2Gates(counters).decision).toBe('PASS')
    expect(OUTLINE_PRECOMMIT_MAPPING_AUDIT_EVENT).toBe('OUTLINE-PRECOMMIT-MAPPING-AUDIT')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function makeDom(itemCount: number): { outline: HTMLElement } {
  document.body.innerHTML = ''
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  document.body.appendChild(sidebar)
  const outline = document.createElement('div')
  outline.id = 'outline-content'
  sidebar.appendChild(outline)
  for (let i = 0; i < itemCount; i++) {
    const a = document.createElement('a')
    a.href = `#h${i + 1}`
    a.textContent = `标题${i + 1}`
    outline.appendChild(a)
    Object.defineProperty(a, 'offsetParent', { get: () => outline, configurable: true })
  }
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
  Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })
  return { outline }
}

const headings2: HeadingDescriptor[] = [
  { key: 'h1', level: 2, text: '标题1' },
  { key: 'h2', level: 2, text: '标题2' },
]
const labels2 = ['一、', '二、']

async function nextFrames(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}

type Probe = {
  precommit: {
    gateCounters: Record<string, number>
    gateDecision: string
    retriedKeys: string[]
    settleRetryPending: boolean
  }
  lastApplyTransaction: { precommitVerified: boolean } | null
}

function probe(): Probe {
  return (window as unknown as { __inkchapter_outline_sync_probe__: () => Probe }).__inkchapter_outline_sync_probe__()
}

describe('V5.14-R2 P7 — outline pre-commit settle gate (host wiring)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('H1. settled mapping commits exactly once (decorations written)', async () => {
    const { outline } = makeDom(2)
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings2, labels2)
    await nextFrames()

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBe(2)
    const p = probe()
    expect(p.lastApplyTransaction?.precommitVerified).toBe(true)
    expect(p.precommit.gateCounters.outlineUnstableMappingCommit).toBe(0)
    expect(p.precommit.gateDecision).toBe('PASS')
    ctrl.stop()
  })

  it('H2. unsettled mapping (extra native item) writes NOTHING (WAITING)', async () => {
    const { outline } = makeDom(3) // 3 native items for only 2 headings
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings2, labels2)
    await nextFrames()

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBe(0)
    const p = probe()
    expect(p.lastApplyTransaction?.precommitVerified).toBe(false)
    expect(p.precommit.gateCounters.outlineUnstableMappingCommit).toBeGreaterThan(0)
    expect(p.precommit.gateCounters.outlineWaitingSettleDomWrite).toBe(0)
    ctrl.stop()
  })

  it('H3. the settle wait never becomes a retry storm', async () => {
    const { outline } = makeDom(3)
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings2, labels2)
    await nextFrames()
    // force several more re-evaluations within the same generation
    ctrl.syncAfterRefresh('doc-a', headings2, labels2)
    await nextFrames()

    expect(outline.querySelectorAll('[data-inkchapter-number]').length).toBe(0)
    expect(probe().precommit.gateCounters.outlineMappingRetryStorm).toBe(0)
    ctrl.stop()
  })
})
