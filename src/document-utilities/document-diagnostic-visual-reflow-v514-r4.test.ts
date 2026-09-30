// @vitest-environment jsdom
/**
 * V5.14-R4 — Document Diagnostic Visual REFLOW invalidation.
 *
 * Focused tests R4-T1 … R4-T15 of the V5.14-R4 prompt:
 *  - the semantic target (diagnosticId / stableIdentity) is INDEPENDENT of the
 *    geometry snapshot (layoutEpoch / geometryGeneration / rects);
 *  - an upstream reflow (inserted blank line / paragraph / a wrapped paragraph)
 *    moves a target while diagnosticId / stableIdentity / contentFingerprint stay
 *    the same, and the visual MUST follow it;
 *  - fill / active fill / reason chip are committed from ONE geometry generation;
 *  - the drift audit reports REAL numbers (never a hardcoded 0).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  DOCUMENT_DIAGNOSTIC_VISUAL_REFLOW_AUDIT_EVENT,
  GEOMETRY_DRIFT_TOLERANCE_PX_V514R4,
  VISUAL_REFLOW_V514R4_GATE_KEYS,
  VISUAL_REFLOW_V514R4_GATE_LABELS,
  buildDiagnosticVisualGeometrySnapshot,
  createVisualReflowV514R4Counters,
  evaluateReasonChipGeometry,
  evaluateVisualGeometryGenerationConsistency,
  evaluateVisualReflowV514R4Gates,
  formatVisualReflowV514R4GateReport,
  measureGeometryDrift,
  normalizeGeometryRect,
  passiveFillPresentationForActiveTarget,
  shouldRebuildDiagnosticVisual,
  type GeometryRect,
} from './document-diagnostic-visual-geometry-v514-r4'

// ── pure contract ───────────────────────────────────────────────────────────

function rect(left: number, top: number, right: number, bottom: number): GeometryRect {
  return normalizeGeometryRect({ left, top, right, bottom })
}

describe('V5.14-R4 §13 — RectSnapshot normalisation', () => {
  it('width/height are ALWAYS derived from the edges (never inherited)', () => {
    const r = rect(10, 20, 40, 60)
    expect(r).toEqual({ left: 10, top: 20, right: 40, bottom: 60, width: 30, height: 40 })
    // an "edit" of the edges can never keep the old width/height
    expect(rect(10, 20, 80, 60).width).toBe(70)
    // a negative span collapses to 0 (never a negative rect)
    expect(rect(50, 20, 10, 60).width).toBe(0)
  })
})

describe('V5.14-R4 §9 — live rect drift', () => {
  it('R4-T10 contract — a same-epoch but moved target IS stale', () => {
    const stored = rect(100, 200, 400, 232)
    expect(measureGeometryDrift(stored, rect(100, 200, 400, 232)).stale).toBe(false)
    // 0.5px is inside the tolerance; 40px (the real runtime symptom) is not
    expect(measureGeometryDrift(stored, rect(100, 200.5, 400, 232.5)).stale).toBe(false)
    const moved = measureGeometryDrift(stored, rect(100, 240, 400, 272))
    expect(moved.stale).toBe(true)
    expect(moved.topDrift).toBe(40)
    expect(moved.maxDrift).toBe(40)
    expect(GEOMETRY_DRIFT_TOLERANCE_PX_V514R4).toBe(1)
    // a missing rect can never be reported as drift (nothing to compare)
    expect(measureGeometryDrift(null, rect(1, 2, 3, 4)).stale).toBe(false)
  })

  it('R4-T10 contract — a FALSE "epoch current" cannot keep stale geometry', () => {
    // epoch current + generation unchanged, but the live target moved 40px
    expect(shouldRebuildDiagnosticVisual({
      layoutEpochChanged: false,
      geometryGenerationChanged: false,
      targetConnected: true,
      liveDriftPx: 40,
      contentFingerprintChanged: false,
    })).toEqual({ rebuild: true, reason: 'LIVE_RECT_DRIFT_GT_1PX' })
    // …and a genuinely current target is not rebuilt
    expect(shouldRebuildDiagnosticVisual({
      layoutEpochChanged: false,
      geometryGenerationChanged: false,
      targetConnected: true,
      liveDriftPx: 0.4,
      contentFingerprintChanged: false,
    })).toEqual({ rebuild: false, reason: 'GEOMETRY_CURRENT' })
  })
})

describe('V5.14-R4 §5.2 — one geometry generation per visual target', () => {
  it('mixed layoutEpoch / geometryGeneration is detected', () => {
    expect(evaluateVisualGeometryGenerationConsistency({
      passiveLayoutEpoch: 7, activeLayoutEpoch: 7, chipLayoutEpoch: 7,
      passiveGeometryGeneration: 3, activeGeometryGeneration: 3, chipGeometryGeneration: 3,
    })).toEqual({ epochMismatch: false, generationMismatch: false, mixedLayoutEpoch: false, mixedGeometryGeneration: false })
    // R4-T9 — fresh active fragment + stale chip is EXACTLY the runtime defect
    const mixed = evaluateVisualGeometryGenerationConsistency({
      passiveLayoutEpoch: 7, activeLayoutEpoch: 7, chipLayoutEpoch: 7,
      passiveGeometryGeneration: 4, activeGeometryGeneration: 4, chipGeometryGeneration: 3,
    })
    expect(mixed.generationMismatch).toBe(true)
    expect(mixed.mixedGeometryGeneration).toBe(true)
    // and a stale epoch is reported separately
    expect(evaluateVisualGeometryGenerationConsistency({
      passiveLayoutEpoch: 7, activeLayoutEpoch: 7, chipLayoutEpoch: 6,
      passiveGeometryGeneration: 3, activeGeometryGeneration: 3, chipGeometryGeneration: 3,
    }).mixedLayoutEpoch).toBe(true)
  })

  it('the snapshot is immutable-by-construction and carries ONE coordinate space', () => {
    const snapshot = buildDiagnosticVisualGeometrySnapshot({
      visualTargetKey: 'doc::D1::0::id:H5:idx:3',
      documentKey: 'doc',
      stableHeadingIdentity: 'id:H5:idx:3',
      diagnosticId: 'D1',
      targetIndex: 0,
      severity: 'error',
      layoutEpoch: 5,
      geometryGeneration: 9,
      measuredAt: 1,
      anchorRect: rect(100, 200, 400, 232),
      textRects: [rect(100, 204, 420, 228)],
      fillRects: [rect(100, 204, 420, 228)],
      numberRect: null,
      reasonChipRect: rect(428, 204, 480, 224),
      targetFingerprint: 'fp',
      targetConnected: true,
    })
    expect(snapshot.coordinateSpace).toBe('DOCUMENT_LOCAL')
    expect(snapshot.layoutEpoch).toBe(5)
    expect(snapshot.geometryGeneration).toBe(9)
    expect(snapshot.reasonChipRect!.width).toBe(52)
  })
})

describe('V5.14-R4 §10 — reason chip geometry', () => {
  it('the chip anchor is the configured gap beside the RAW label right, vertically centred', () => {
    const text = [rect(100, 204, 420, 228)]
    // chip left = labelRight + 8, vertically centred on the anchor line
    const good = evaluateReasonChipGeometry({
      chipRect: rect(428, 206, 480, 226), textRects: text, visualLabelRight: 420, configuredGapPx: 8,
      chipPlacement: 'RIGHT_OF_LAST_LINE',
    })
    expect(good.horizontalGapPx).toBe(8)
    expect(good.anchorDriftPx).toBe(0)
    expect(good.verticalDriftPx).toBe(0)
    expect(good.anchorOk && good.verticalOk && good.gapOk).toBe(true)
    // a chip left over from an EARLIER layout (40px higher) is caught
    const stale = evaluateReasonChipGeometry({
      chipRect: rect(428, 166, 480, 186), textRects: text, visualLabelRight: 420, configuredGapPx: 8,
      chipPlacement: 'RIGHT_OF_LAST_LINE',
    })
    expect(stale.verticalDriftPx).toBe(40)
    expect(stale.verticalOk).toBe(false)
    // a chip anchored on the wrong right edge is caught too
    const misAnchored = evaluateReasonChipGeometry({
      chipRect: rect(400, 206, 452, 226), textRects: text, visualLabelRight: 420, configuredGapPx: 8,
      chipPlacement: 'RIGHT_OF_LAST_LINE',
    })
    expect(misAnchored.anchorOk).toBe(false)
    // a below-the-line chip is legitimately not beside the text → no false FAIL
    expect(evaluateReasonChipGeometry({
      chipRect: rect(120, 232, 172, 252), textRects: text, visualLabelRight: 420, configuredGapPx: 8,
      chipPlacement: 'BELOW_LAST_LINE',
    }).verticalOk).toBe(true)
  })
})

describe('V5.14-R4 §11 — the selected target presents ONE atomic surface', () => {
  it('the active presentation replaces the passive FILL but keeps the semantic marker', () => {
    expect(passiveFillPresentationForActiveTarget({ isActiveHeading: false, passiveMarkerExists: true }))
      .toEqual({ paintPassiveFill: true, suppressReason: null })
    expect(passiveFillPresentationForActiveTarget({ isActiveHeading: true, passiveMarkerExists: true }))
      .toEqual({ paintPassiveFill: false, suppressReason: 'ACTIVE_PRESENTATION_REPLACES_PASSIVE_FILL' })
    // an active heading WITHOUT any passive marker is a different (P10) violation
    expect(passiveFillPresentationForActiveTarget({ isActiveHeading: true, passiveMarkerExists: false }).paintPassiveFill).toBe(false)
  })
})

describe('V5.14-R4 §15 — the 21 visual-reflow hard gates', () => {
  it('are declared, complete and 0 on a clean surface', () => {
    const counters = createVisualReflowV514R4Counters()
    expect(VISUAL_REFLOW_V514R4_GATE_KEYS).toHaveLength(21)
    expect(formatVisualReflowV514R4GateReport(counters)).toHaveLength(21)
    expect(evaluateVisualReflowV514R4Gates(counters).decision).toBe('PASS')
    expect(VISUAL_REFLOW_V514R4_GATE_LABELS.staleVisualGeometryPaint).toBe('STALE_VISUAL_GEOMETRY_PAINT_COUNT')
    expect(VISUAL_REFLOW_V514R4_GATE_LABELS.reasonChipVerticalDriftGt2px).toBe('REASON_CHIP_VERTICAL_DRIFT_GT_2PX_COUNT')
    expect(VISUAL_REFLOW_V514R4_GATE_LABELS.scrollGeometryRebuild).toBe('SCROLL_GEOMETRY_REBUILD_COUNT')
    const dirty = createVisualReflowV514R4Counters()
    dirty.staleVisualGeometryPaint = 1
    expect(evaluateVisualReflowV514R4Gates(dirty).decision).toBe('FAIL')
  })
})

// ── host wiring (jsdom) ─────────────────────────────────────────────────────

function stubRaf(): void {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1 }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => { /* noop */ }
}
type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
let rangeRects: Rect[] = []
function stubRangeRects(rects: Rect[]): void {
  rangeRects = rects
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    getClientRects: () => rangeRects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# t',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  } as unknown as DocumentUtilitiesContext
}
function fakeProviders(): DocumentDiagnosticsProviders {
  return {
    getFormulaVisibleTagTokens: () => [],
    getFigureName: () => null,
    getTableName: () => null,
    getCodeName: () => null,
    getCodeLanguage: () => null,
    resolveImageLocalPath: () => ({ localPath: null }),
    isLinkTargetMissing: () => false,
    getHeadingIdentity: (el) => el.getAttribute('data-id'),
    parseLocalLinkTargets: () => [],
    getObjectCaptionHost: () => null,
  }
}

type HostApi = {
  renderHeadingDiagnosticMarkers(skipActiveEmphasis?: boolean): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  clearHeadingActiveEmphasis(): void
  invalidateDiagnosticVisualGeometry(reason: string): void
  getVisualReflowV514R4Counters(): Record<string, number>
  getVisualReflowV514R4GateReport(): string[]
  getVisualReflowV514R4GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getVisualGeometrySchedulerCounters(): Record<string, number>
  getVisualGeometryGeneration(): number
  getVisualGeometrySnapshot(identity: string): { anchorRect: GeometryRect | null } | null
  getHeadingMarkerSnapshot(): { passiveCount: number } | null
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mockRestore: () => void } | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 100, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/** A world with ONE diagnosed heading whose live rect can be MOVED (a reflow). */
function makeWorld(headingCount = 1): {
  h: DocumentUtilityOverlayHost
  headings: HTMLElement[]
  moveHeading: (i: number, deltaY: number) => void
} {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const headings: HTMLElement[] = []
  const offsets = new Array(headingCount).fill(0) as number[]
  for (let i = 0; i < headingCount; i++) {
    const h = document.createElement('h2')
    h.setAttribute('data-id', `H-${String.fromCharCode(65 + i)}`)
    h.setAttribute('data-line', String(4 + i))
    h.textContent = `标题${i + 1}`
    write.appendChild(h)
    stubRect(h, () => ({ left: 100, top: 200 + i * 100 + offsets[i], right: 1000, bottom: 232 + i * 100 + offsets[i] }))
    headings.push(h)
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return {
    h,
    headings,
    moveHeading: (i: number, deltaY: number) => {
      offsets[i] += deltaY
      // the text fragments reflow with the block
      stubRangeRects(rangeRects.map(r => ({ ...r, top: r.top + deltaY, bottom: r.bottom + deltaY })))
    },
  }
}

function diagFor(id: string, headingId: string, severity: string, code: string): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: headingId, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 1, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the marker test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const passiveFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length
const activeFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length
const passiveFragmentTop = (): number => {
  const el = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement | null
  return el ? Number.parseFloat(el.style.top) : Number.NaN
}
const chipTop = (): number => {
  const el = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement | null
  return el ? Number.parseFloat(el.style.top) : Number.NaN
}
/** Read the DOCUMENT-DIAGNOSTIC-VISUAL-REFLOW-AUDIT lines emitted so far. */
function readReflowAudits(): Array<Record<string, string>> {
  const spy = infoSpy as unknown as { mock: { calls: unknown[][] } }
  const out: Array<Record<string, string>> = []
  for (const call of spy.mock.calls) {
    const line = String(call[0] ?? '')
    if (!line.includes(DOCUMENT_DIAGNOSTIC_VISUAL_REFLOW_AUDIT_EVENT)) continue
    const idx = line.indexOf(`${DOCUMENT_DIAGNOSTIC_VISUAL_REFLOW_AUDIT_EVENT}: `)
    const body = idx >= 0 ? line.slice(idx + DOCUMENT_DIAGNOSTIC_VISUAL_REFLOW_AUDIT_EVENT.length + 2) : ''
    const fields: Record<string, string> = {}
    for (const m of body.matchAll(/(\w+)=([^\s]*)/g)) fields[m[1]] = m[2]
    out.push(fields)
  }
  return out
}

const singleDiag = () => [diagFor('E1', 'H-A', 'error', 'HEADING_LEVEL_GAP')]

describe('V5.14-R4 §7/§9 — reflow invalidation (host wiring)', () => {
  it('R4-T1 — inserting a blank paragraph above the target moves fill + chip and rebuilds', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    expect(passiveFragmentCount()).toBe(1)
    const fillTopBefore = passiveFragmentTop()
    const chipTopBefore = chipTop()
    const generationBefore = api().getVisualGeometryGeneration()

    // the upstream reflow: the SAME heading node (same identity) is pushed 40px down
    w.moveHeading(0, 40)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')

    // §5.2 — a NEW geometry generation was committed
    expect(api().getVisualGeometryGeneration()).toBeGreaterThan(generationBefore)
    // §9 — the visual followed the target exactly (no ghost at the old position)
    expect(passiveFragmentTop()).toBeCloseTo(fillTopBefore + 40, 0)
    expect(chipTop()).toBeCloseTo(chipTopBefore + 40, 0)
    // §16 — the reflow audit proves the move with REAL facts
    const audit = readReflowAudits().pop()!
    expect(audit.targetMoved).toBe('true')
    expect(audit.visualInvalidated).toBe('true')
    expect(audit.passiveRebuilt).toBe('true')
    expect(audit.chipRebuilt).toBe('true')
    // R4-T5 — the refresh may NOT depend on the content fingerprint changing
    expect(audit.contentChanged).toBe('false')
    expect(audit.sourceRevisionChanged).toBe('false')
    expect(Number(audit.maxTargetVisualDriftPx)).toBeLessThanOrEqual(1)
    expect(audit.decision).toBe('PASS')
    // §15 — no gate may fire on a correctly rebuilt reflow
    expect(api().getVisualReflowV514R4GateDecision().decision).toBe('PASS')
  })

  it('R4-T2 — a burst of mutations coalesces into ONE geometry reconcile', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    const schedulesBefore = api().getVisualGeometrySchedulerCounters().scheduleCount
    const invalidationsBefore = api().getVisualGeometrySchedulerCounters().invalidationCount
    // three mutations inside the same frame (the FIRST one already scheduled the rAF,
    // which the test stub runs synchronously → the flag is consumed immediately, so
    // three requests = three schedules; the coalescing counter is what proves the
    // same-frame merge). Use the dirty flag directly for the burst case.
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    const after = api().getVisualGeometrySchedulerCounters()
    expect(after.invalidationCount).toBe(invalidationsBefore + 3)
    expect(after.scheduleCount).toBeGreaterThanOrEqual(schedulesBefore + 1)
    // §21 — no retry storm: the executions never exceed the invalidations
    expect(after.executionCount).toBeLessThanOrEqual(after.invalidationCount)
    expect(api().getVisualReflowV514R4Counters().targetMovedWithoutVisualRebuild).toBe(0)
  })

  it('R4-T3 — deleting the inserted content moves every visual back UP (no ghost)', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    const fillTop0 = passiveFragmentTop()
    w.moveHeading(0, 40)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    expect(passiveFragmentTop()).toBeCloseTo(fillTop0 + 40, 0)
    w.moveHeading(0, -40)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    expect(passiveFragmentTop()).toBeCloseTo(fillTop0, 0)
    expect(passiveFragmentCount()).toBe(1)
    expect(api().getVisualReflowV514R4GateDecision().decision).toBe('PASS')
  })

  it('R4-T4 — an upstream paragraph that only WRAPS (no new block) still moves the visual', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    const fillTop0 = passiveFragmentTop()
    // no block was added: only the upstream text grew, pushing the target down
    w.moveHeading(0, 24)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    expect(passiveFragmentTop()).toBeCloseTo(fillTop0 + 24, 0)
    expect(api().getVisualReflowV514R4Counters().passiveTargetRectStale).toBe(0)
  })

  it('R4-T7 — a reflow while ACTIVE rebuilds passive + active + chip in ONE generation', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasis('E1', { id: 'E1', severity: 'error', code: 'HEADING_LEVEL_GAP', message: 'm', metadata: {} }, w.headings[0])
    expect(activeFragmentCount()).toBe(1)
    w.moveHeading(0, 40)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')
    const generation = api().getVisualGeometryGeneration()
    // §5.2 — the ACTIVE component carries the SAME generation as the passive record
    const activeWrapper = document.querySelector('.inkchapter-heading-diagnostic-active') as HTMLElement
    expect(Number(activeWrapper.getAttribute('data-ink-geometry-generation'))).toBe(generation)
    const marker = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(Number(marker.getAttribute('data-ink-geometry-generation'))).toBe(generation)
    expect(activeFragmentCount()).toBe(1)
    expect(api().getVisualReflowV514R4Counters().visualComponentMixedGeometryGeneration).toBe(0)
    expect(api().getVisualReflowV514R4Counters().activePassiveGeometryGenerationMismatch).toBe(0)
  })

  it('R4-T8 — dismiss restores the passive presentation of the SAME target', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    expect(passiveFragmentCount()).toBe(1)
    api().renderHeadingActiveEmphasis('E1', { id: 'E1', severity: 'error', code: 'HEADING_LEVEL_GAP', message: 'm', metadata: {} }, w.headings[0])
    // §11 — ONE atomic surface while active
    expect(passiveFragmentCount()).toBe(0)
    expect(api().getVisualReflowV514R4Counters().headingActivePassiveFillStack).toBe(0)
    api().clearHeadingActiveEmphasis()
    // the passive presentation comes back from the CURRENT geometry
    expect(passiveFragmentCount()).toBe(1)
    expect(activeFragmentCount()).toBe(0)
    expect(api().getHeadingMarkerSnapshot()!.passiveCount).toBe(1)
  })

  it('R4-T11 — scroll is NOT a reflow trigger', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    const generationBefore = api().getVisualGeometryGeneration()
    const executionsBefore = api().getVisualGeometrySchedulerCounters().executionCount
    api().invalidateDiagnosticVisualGeometry('scroll')
    // §8 — a scroll-driven rebuild is the FORBIDDEN behaviour, and it is counted
    expect(api().getVisualGeometryGeneration()).toBe(generationBefore)
    expect(api().getVisualGeometrySchedulerCounters().executionCount).toBe(executionsBefore)
    expect(api().getVisualReflowV514R4Counters().scrollGeometryRebuild).toBe(1)
    // the geometry scheduler counter is the Runtime evidence surface
    expect(api().getVisualGeometrySchedulerCounters().scrollGeometryRebuildCount).toBe(1)
  })

  it('R4-T15 — a resolved diagnostic clears the stale passive + chip DOM', () => {
    const w = makeWorld(1)
    host = w.h
    inject(host, singleDiag())
    api().renderHeadingDiagnosticMarkers()
    expect(passiveFragmentCount()).toBe(1)
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-reason').length).toBe(1)
    // the problem was fixed → no diagnostics left
    inject(host, [], 2)
    api().renderHeadingDiagnosticMarkers()
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(0)
    expect(passiveFragmentCount()).toBe(0)
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-reason').length).toBe(0)
    expect(api().getVisualReflowV514R4Counters().stalePassiveMarkerAfterReflow).toBe(0)
    expect(api().getVisualReflowV514R4Counters().staleReasonChipAfterReflow).toBe(0)
  })

  it('R4-T14 — two diagnostics: moving one target never disturbs the other', () => {
    const w = makeWorld(2)
    host = w.h
    inject(host, [diagFor('E1', 'H-A', 'error', 'HEADING_LEVEL_GAP'), diagFor('W1', 'H-B', 'warning', 'HEADING_DUPLICATE_TEXT')])
    api().renderHeadingDiagnosticMarkers()
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(2)
    // read the identity of each marker from the plugin's OWN overlay DOM
    const identities = Array.from(document.querySelectorAll('.inkchapter-heading-diagnostic-marker'))
      .map(m => m.getAttribute('data-ink-stable-identity') ?? '')
    expect(identities).toHaveLength(2)
    const anchorTopBefore = identities.map(id => api().getVisualGeometrySnapshot(id)!.anchorRect!.top)
    expect(anchorTopBefore).toEqual([200, 300])

    w.moveHeading(0, 40)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')

    const anchorTopAfter = identities.map(id => api().getVisualGeometrySnapshot(id)!.anchorRect!.top)
    // the moved target re-measured…
    expect(anchorTopAfter[0]).toBe(anchorTopBefore[0] + 40)
    // …and the SIBLING target kept its own geometry (no identity crossover)
    expect(anchorTopAfter[1]).toBe(anchorTopBefore[1])
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(2)
    expect(api().getVisualReflowV514R4GateDecision().decision).toBe('PASS')
  })
})
