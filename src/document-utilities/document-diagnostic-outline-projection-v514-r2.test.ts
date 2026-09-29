/**
 * V5.14-R2 §P8 — Left-outline heading diagnostic projection.
 *
 * Unit test items §10 23–32: pure projection + host wiring (jsdom).
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  OUTLINE_DIAGNOSTIC_PROJECTION_AUDIT_EVENT,
  OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS,
  OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_LABELS,
  buildOutlineDiagnosticTargetKey,
  createOutlineDiagnosticProjectionV514R2Counters,
  evaluateOutlineDiagnosticProjectionV514R2Gates,
  formatOutlineDiagnosticProjectionV514R2GateReport,
  outlineDiagnosticReconciliationToGateCounters,
  projectOutlineDiagnostics,
  reconcileOutlineDiagnosticProjections,
  type OutlineDiagnosticMarkerFact,
  type OutlineDiagnosticProjection,
  type OutlineDiagnosticTargetInput,
} from './document-diagnostic-outline-projection-v514-r2'
import { OutlineNumberingController } from '../heading-numbering/outline-numbering-controller'
import type { HeadingDescriptor } from '../heading-numbering/heading-types'

// ── pure contract ───────────────────────────────────────────────────────────

function target(identity: string, overrides: Partial<OutlineDiagnosticTargetInput> = {}): OutlineDiagnosticTargetInput {
  return {
    documentKey: 'doc-a',
    diagnosticId: 'DIAG-1',
    targetIndex: 0,
    stableHeadingIdentity: identity,
    severity: 'error',
    active: false,
    ...overrides,
  }
}

function baseInput(targets: OutlineDiagnosticTargetInput[], mapping: Array<{ stableHeadingIdentity: string; outlineItemIdentity: string }>) {
  return {
    documentKey: 'doc-a',
    sourceRevision: 3,
    layoutEpoch: 1,
    outlineGeneration: 4,
    mappingCommitted: true,
    targets,
    mapping,
  }
}

describe('V5.14-R2 P8 — outline diagnostic projection (pure)', () => {
  // §10-23
  it('23. one heading diagnostic -> one outline projection', () => {
    const r = projectOutlineDiagnostics(baseInput(
      [target('h1')],
      [{ stableHeadingIdentity: 'h1', outlineItemIdentity: 'outline-item:0' }],
    ))
    expect(r.state).toBe('COMMITTED')
    expect(r.projections).toHaveLength(1)
    expect(r.projections[0].outlineItemIdentity).toBe('outline-item:0')
    expect(r.projections[0].passive).toBe(true)
    expect(r.projections[0].active).toBe(false)
  })

  // §10-24
  it('24. multi-target -> EVERY occurrence is projected', () => {
    const r = projectOutlineDiagnostics(baseInput(
      [target('h1a', { targetIndex: 0 }), target('h1b', { targetIndex: 1 })],
      [
        { stableHeadingIdentity: 'h1a', outlineItemIdentity: 'outline-item:1' },
        { stableHeadingIdentity: 'h1b', outlineItemIdentity: 'outline-item:2' },
      ],
    ))
    expect(r.projections.map(p => p.outlineItemIdentity)).toEqual(['outline-item:1', 'outline-item:2'])
    expect(r.projections.every(p => p.passive)).toBe(true)
  })

  // §10-25
  it('25. only the ACTIVE occurrence is strengthened', () => {
    const r = projectOutlineDiagnostics(baseInput(
      [target('h1a', { targetIndex: 0, active: true }), target('h1b', { targetIndex: 1 })],
      [
        { stableHeadingIdentity: 'h1a', outlineItemIdentity: 'outline-item:1' },
        { stableHeadingIdentity: 'h1b', outlineItemIdentity: 'outline-item:2' },
      ],
    ))
    expect(r.projections.filter(p => p.active).map(p => p.outlineItemIdentity)).toEqual(['outline-item:1'])
    expect(r.projections.filter(p => p.passive).map(p => p.outlineItemIdentity)).toEqual(['outline-item:2'])
  })

  // §10-27
  it('27. the projection never consults a filter / severity selection', () => {
    const input = baseInput(
      [target('h1', { severity: 'info' })],
      [{ stableHeadingIdentity: 'h1', outlineItemIdentity: 'outline-item:0' }],
    )
    const a = projectOutlineDiagnostics(input)
    const b = projectOutlineDiagnostics(input)
    expect(a.projections).toEqual(b.projections)
    expect(a.projections).toHaveLength(1)
  })

  // §10-31
  it('31. PRE-SETTLE (mapping not committed) projects NOTHING', () => {
    const r = projectOutlineDiagnostics({ ...baseInput([target('h1')], [
      { stableHeadingIdentity: 'h1', outlineItemIdentity: 'outline-item:0' },
    ]), mappingCommitted: false })
    expect(r.state).toBe('DEFERRED')
    expect(r.projections).toEqual([])
    expect(r.reason).toBe('MAPPING_NOT_COMMITTED')
  })

  it('33. an unmapped heading target is reported, never fabricated', () => {
    const r = projectOutlineDiagnostics(baseInput([target('h-ghost')], []))
    expect(r.projections).toEqual([])
    expect(r.unmappedTargetKeys).toEqual([
      buildOutlineDiagnosticTargetKey({ documentKey: 'doc-a', diagnosticId: 'DIAG-1', targetIndex: 0, stableHeadingIdentity: 'h-ghost' }),
    ])
  })

  it('34. reconciliation maps onto the 11 frozen gates', () => {
    const p: OutlineDiagnosticProjection = {
      documentKey: 'doc-a', diagnosticId: 'D1', targetIndex: 0, stableHeadingIdentity: 'h1',
      outlineItemIdentity: 'outline-item:0', severity: 'error', active: false, passive: true,
      layoutEpoch: 1, outlineGeneration: 4, sourceRevision: 3,
      key: buildOutlineDiagnosticTargetKey({ documentKey: 'doc-a', diagnosticId: 'D1', targetIndex: 0, stableHeadingIdentity: 'h1' }),
    }
    const goodFact: OutlineDiagnosticMarkerFact = {
      key: p.key, documentKey: 'doc-a', diagnosticId: 'D1', targetIndex: 0, stableHeadingIdentity: 'h1',
      outlineItemIdentity: 'outline-item:0', severity: 'error', active: false, outlineGeneration: 4, sourceRevision: 3,
    }
    expect(reconcileOutlineDiagnosticProjections([p], [goodFact], 4, 3).missingKeys).toEqual([])
    const missing = outlineDiagnosticReconciliationToGateCounters(
      reconcileOutlineDiagnosticProjections([p], [], 4, 3),
      { textMutation: 0, reasonText: 0, badge: 0, preSettlePaint: 0 },
    )
    expect(missing.outlineDiagnosticExpectedMarkerMissing).toBe(1)
    const stale = outlineDiagnosticReconciliationToGateCounters(
      reconcileOutlineDiagnosticProjections([p], [goodFact], 9, 7),
      { textMutation: 1, reasonText: 2, badge: 3, preSettlePaint: 4 },
    )
    expect(stale.outlineDiagnosticStaleGenerationMarker).toBe(1)
    expect(stale.outlineDiagnosticStaleRevisionMarker).toBe(1)
    expect(stale.outlineDiagnosticTextMutation).toBe(1)
    expect(stale.outlineDiagnosticReasonText).toBe(2)
    expect(stale.outlineDiagnosticBadge).toBe(3)
    expect(stale.outlineDiagnosticPreSettlePaint).toBe(4)
    expect(evaluateOutlineDiagnosticProjectionV514R2Gates(stale).decision).toBe('FAIL')
  })

  it('35. gate keys / labels / report / counters are complete and ordered', () => {
    expect(OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS).toEqual([
      'outlineDiagnosticExpectedMarkerMissing',
      'outlineDiagnosticExtraMarker',
      'outlineDiagnosticDuplicateMarker',
      'outlineDiagnosticIdentityMismatch',
      'outlineDiagnosticTargetIndexMismatch',
      'outlineDiagnosticStaleGenerationMarker',
      'outlineDiagnosticStaleRevisionMarker',
      'outlineDiagnosticTextMutation',
      'outlineDiagnosticReasonText',
      'outlineDiagnosticBadge',
      'outlineDiagnosticPreSettlePaint',
    ])
    expect(OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS.length).toBe(11)
    const counters = createOutlineDiagnosticProjectionV514R2Counters()
    expect(formatOutlineDiagnosticProjectionV514R2GateReport(counters)).toEqual([
      'OUTLINE_DIAGNOSTIC_EXPECTED_MARKER_MISSING_COUNT=0',
      'OUTLINE_DIAGNOSTIC_EXTRA_MARKER_COUNT=0',
      'OUTLINE_DIAGNOSTIC_DUPLICATE_MARKER_COUNT=0',
      'OUTLINE_DIAGNOSTIC_IDENTITY_MISMATCH_COUNT=0',
      'OUTLINE_DIAGNOSTIC_TARGET_INDEX_MISMATCH_COUNT=0',
      'OUTLINE_DIAGNOSTIC_STALE_GENERATION_MARKER_COUNT=0',
      'OUTLINE_DIAGNOSTIC_STALE_REVISION_MARKER_COUNT=0',
      'OUTLINE_DIAGNOSTIC_TEXT_MUTATION_COUNT=0',
      'OUTLINE_DIAGNOSTIC_REASON_TEXT_COUNT=0',
      'OUTLINE_DIAGNOSTIC_BADGE_COUNT=0',
      'OUTLINE_DIAGNOSTIC_PRE_SETTLE_PAINT_COUNT=0',
    ])
    for (const key of OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_KEYS) {
      expect(OUTLINE_DIAGNOSTIC_PROJECTION_V514R2_GATE_LABELS[key]).toBeTruthy()
    }
    expect(OUTLINE_DIAGNOSTIC_PROJECTION_AUDIT_EVENT).toBe('OUTLINE-DIAGNOSTIC-PROJECTION-AUDIT')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function makeDom(): { outline: HTMLElement; items: HTMLElement[] } {
  document.body.innerHTML = ''
  const sidebar = document.createElement('div')
  sidebar.id = 'typora-sidebar'
  document.body.appendChild(sidebar)
  const outline = document.createElement('div')
  outline.id = 'outline-content'
  sidebar.appendChild(outline)
  const items: HTMLElement[] = []
  for (let i = 0; i < 2; i++) {
    const a = document.createElement('a')
    a.href = `#h${i + 1}`
    a.textContent = `标题${i + 1}`
    outline.appendChild(a)
    Object.defineProperty(a, 'offsetParent', { get: () => outline, configurable: true })
    items.push(a)
  }
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  Object.defineProperty(sidebar, 'offsetParent', { get: () => document.body, configurable: true })
  Object.defineProperty(outline, 'offsetParent', { get: () => sidebar, configurable: true })
  return { outline, items }
}

const headings: HeadingDescriptor[] = [
  { key: 'h1', level: 2, text: '标题1' },
  { key: 'h2', level: 2, text: '标题2' },
]
const labels = ['一、', '二、']

async function nextFrames(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}

type Probe = {
  outlineDiagnosticProjection: {
    committedMapping: boolean
    targetCount: number
    appliedCount: number
    appliedKeys: string[]
    gateCounters: Record<string, number>
    gateDecision: string
  }
}

function probe(): Probe {
  return (window as unknown as { __inkchapter_outline_sync_probe__: () => Probe }).__inkchapter_outline_sync_probe__()
}

const MARK = '.inkchapter-outline-diagnostic'

describe('V5.14-R2 P8 — outline diagnostic projection (host wiring)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('H1/H29/H30. a committed mapping paints ONE class-only marker, text untouched', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    const textBefore = outline.textContent
    const nodeCountBefore = outline.querySelectorAll('*').length
    ctrl.setHeadingDiagnosticTargets([target('id:h1', { severity: 'error' })])
    await nextFrames()

    const marked = outline.querySelectorAll(MARK)
    expect(marked.length).toBe(1)
    expect(marked[0].classList.contains('inkchapter-outline-diagnostic--error')).toBe(true)
    // §29 the native text is NEVER mutated; §30 no badge / reason text node is created
    expect(outline.textContent).toBe(textBefore)
    expect(outline.querySelectorAll('*').length).toBe(nodeCountBefore)
    expect(probe().outlineDiagnosticProjection.gateCounters.outlineDiagnosticTextMutation).toBe(0)
    expect(probe().outlineDiagnosticProjection.gateCounters.outlineDiagnosticReasonText).toBe(0)
    expect(probe().outlineDiagnosticProjection.gateCounters.outlineDiagnosticBadge).toBe(0)
    ctrl.stop()
  })

  it('H25/H26. multi-target marks EVERY item; only the active one is strengthened', async () => {
    const { outline, items } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()

    ctrl.setHeadingDiagnosticTargets([
      target('id:h1', { severity: 'warning', active: true }),
      target('id:h2', { severity: 'warning', targetIndex: 1 }),
    ])
    await nextFrames()

    expect(outline.querySelectorAll(MARK).length).toBe(2)
    expect(items[0].classList.contains('inkchapter-outline-diagnostic--active')).toBe(true)
    expect(items[1].classList.contains('inkchapter-outline-diagnostic--active')).toBe(false)
    // passive sibling preserved
    expect(items[1].classList.contains('inkchapter-outline-diagnostic')).toBe(true)
    ctrl.stop()
  })

  it('H31. PRE-SETTLE (no committed mapping) paints NOTHING', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    // no syncAfterRefresh → no committed mapping yet
    ctrl.setHeadingDiagnosticTargets([target('id:h1')])
    await nextFrames()

    expect(outline.querySelectorAll(MARK).length).toBe(0)
    expect(probe().outlineDiagnosticProjection.committedMapping).toBe(false)
    expect(probe().outlineDiagnosticProjection.gateCounters.outlineDiagnosticPreSettlePaint).toBe(0)
    ctrl.stop()
  })

  it('H28/H32. a document switch clears every stale outline marker', async () => {
    const { outline } = makeDom()
    const ctrl = new OutlineNumberingController()
    ctrl.start()
    ctrl.setDocumentKey('doc-a')
    ctrl.syncAfterRefresh('doc-a', headings, labels)
    await nextFrames()
    ctrl.setHeadingDiagnosticTargets([target('id:h1')])
    await nextFrames()
    expect(outline.querySelectorAll(MARK).length).toBe(1)

    ctrl.setDocumentKey('doc-b')
    await nextFrames()

    expect(outline.querySelectorAll(MARK).length).toBe(0)
    expect(probe().outlineDiagnosticProjection.appliedCount).toBe(0)
    expect(probe().outlineDiagnosticProjection.targetCount).toBe(0)
    ctrl.stop()
  })
})
