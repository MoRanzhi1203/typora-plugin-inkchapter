// @vitest-environment jsdom
/**
 * V5.12-R4 — Inline Document-Space Coordinate Authority Closure.
 *
 * The defect: the exact inline Range fragments were measured ONCE during
 * `commit()` (PRE-scroll viewport geometry) and never re-measured after the
 * locator's programmatic scroll, so the painted marker showed
 * `deltaTop ≈ scrollWriteDistance` (~12.8px downward). At the same time the
 * Document-Space audit reported `documentLocalInlineRects=[]` because only the
 * class-based element carrier was ever normalized.
 *
 * These kill-bug tests lock the fix:
 *
 *   R4-1  reprojection is the exact inverse of the shared normalizer (no scrollTop)
 *   R4-2  a whole-fragment shift is caught by the position-drift measurement
 *   R4-3  the inline coordinate authority gate rejects every terminal violation
 *   R4-4  canCommitLocateVisual() blocks COMMIT for inline doc-space violations
 *   R4-5  the §24 gate report is exactly the 9 inline counters
 *   R4-6  a reposition AFTER the scroll re-measures the Range (core regression)
 *   R4-7  a programmatic scroll invalidates, then a paint proves freshness
 *   R4-8  releaseViewportInlineCarrier() detaches only the viewport carrier
 *   R4-9  multi-line fragments stay per-visual-line (never a cross-line union)
 *   R4-10 painted fragment rects are the REAL DOM rects (viewport space)
 *   R4-11 the host commits inline fragments into the shared Document-Space layer
 *   R4-12 an inline COMMIT with empty document-local rects is impossible
 *   R4-13 post-commit user scroll keeps the inline local geometry inert
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { DiagnosticLocateFrameController, DIAGNOSTIC_INLINE_FRAGMENT_CLASS } from './document-diagnostic-locate-frame'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { viewportRectToDocumentLocalRect } from './document-locate-document-space-v5-11'
import { canCommitLocateVisual } from './document-diagnostic-visual-closure-v512-r2'
import { LOCATE_DOCUMENT_SPACE_AUDIT_EVENT } from './document-locate-document-space-v5-11'
import {
  INLINE_COORDINATE_AUTHORITY_AUDIT_EVENT,
  INLINE_COORDINATE_NORMALIZER_ID,
  INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS,
  INLINE_DOCUMENT_SPACE_V512R4_GATE_LABELS,
  INLINE_POSITION_DRIFT_HARD_PX,
  createInlineDocumentSpaceV512R4Counters,
  evaluateInlineCoordinateAuthority,
  evaluateInlineDocumentSpaceGates,
  formatInlineDocumentSpaceGateReport,
  makeInlineRect,
  measureInlineFragmentPositionDrift,
  projectDocumentLocalRectToViewport,
} from './document-diagnostic-inline-document-space-v512-r4'

// ── rAF + rect harness ─────────────────────────────────────────────────────
let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  const caf = (id: number): void => { rafTasks.delete(id) }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = caf
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 400) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}

type Rect = { left: number; top: number; right: number; bottom: number }
function stubRect(el: Element, getRect: () => Rect): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => { const r = getRect(); return { x: r.left, y: r.top, ...r, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => ({}) } },
  })
}
function stubRangeRects(rects: Rect[]): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
    selectNodeContents(): void { /* noop */ },
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
  }
  ;(document as unknown as { createRange: () => unknown }).createRange = () => fake
}

// ── host harness ───────────────────────────────────────────────────────────
function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '![系统架构](b.png)',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => true,
  }
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
  }
}
function makeHost(): { h: DocumentUtilityOverlayHost; write: HTMLElement; root: HTMLElement } {
  const write = document.createElement('div')
  write.id = 'write'
  stubRect(write, () => ({ left: 280, top: 24, right: 1400, bottom: 2000 }))
  document.body.appendChild(write)
  const root = document.createElement('div')
  root.className = 'inkchapter-doc-overlay-root'
  stubRect(root, () => ({ left: 0, top: 0, right: 1536, bottom: 782 }))
  document.body.appendChild(root)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, write, root }
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAuditLine(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}
function lastAuditPayload<T = Record<string, unknown>>(h: DocumentUtilityOverlayHost, key: 'getLastInlineCoordinateAudit'): T | null {
  return h[key]() as T | null
}

const V1: Rect[] = [{ left: 422.67, top: 386.17, right: 465.67, bottom: 404.17 }]
/** The same token AFTER the locator scrolled the document by 12.8px. */
const V2: Rect[] = [{ left: 422.67, top: 373.37, right: 465.67, bottom: 391.37 }]
const MULTI: Rect[] = [
  { left: 300, top: 400, right: 900, bottom: 420 },
  { left: 300, top: 420, right: 520, bottom: 440 },
]

let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})

afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/** A controller whose Range measurement can be swapped between scroll states. */
function makeInlineController(rects: Rect[]): { ctrl: DiagnosticLocateFrameController; owner: HTMLElement; root: HTMLElement } {
  stubRangeRects(rects)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const owner = document.createElement('p')
  owner.textContent = '系统架构 b.png tail'
  document.body.appendChild(owner)
  stubRect(owner, () => ({ left: 422.67, top: 386.17, right: 900, bottom: 404.17 }))
  const ctrl = new DiagnosticLocateFrameController(root)
  return { ctrl, owner, root }
}
function commitInline(ctrl: DiagnosticLocateFrameController, owner: HTMLElement, prefix = 'b.png'): void {
  ctrl.commit({
    diagnosticId: 'img:b.png',
    severity: 'error',
    anchor: owner,
    forceInlineMark: true,
    preciseRect: { left: 422.67, top: 386.17, right: 465.67, bottom: 404.17, width: 43, height: 18 },
    preciseTextPrefix: prefix,
  })
}

// ── R4-1..R4-5 — pure contract ─────────────────────────────────────────────
describe('R4-1/2 — the shared normalizer and the position-drift authority', () => {
  it('R4-1: the document-host normalizer round-trips EXACTLY (no scrollTop anywhere)', () => {
    const hostRect = { left: 280.5, top: 24.8, right: 1516.5, bottom: 800 }
    const viewport = makeInlineRect({ left: 422.67, top: 386.17, right: 465.67, bottom: 404.17 })
    const local = viewportRectToDocumentLocalRect({ viewportRect: viewport, contentHostRect: hostRect })!
    expect(local.left).toBeCloseTo(142.17, 2)
    expect(local.top).toBeCloseTo(361.37, 2)
    expect(local.width).toBeCloseTo(43, 2)
    const back = projectDocumentLocalRectToViewport({ localRect: local, documentHostRect: hostRect })!
    expect(back.left).toBeCloseTo(viewport.left, 6)
    expect(back.top).toBeCloseTo(viewport.top, 6)
    expect(back.right).toBeCloseTo(viewport.right, 6)
    expect(back.bottom).toBeCloseTo(viewport.bottom, 6)
    // §6 — derived rects are rebuilt, never spread with a stale width/height.
    expect(back.width).toBeCloseTo(back.right - back.left, 9)
    expect(back.height).toBeCloseTo(back.bottom - back.top, 9)
  })

  it('R4-2: a whole-fragment shift of the scroll distance is caught', () => {
    const expected = [makeInlineRect({ left: 422.67, top: 386.17, right: 465.67, bottom: 404.17 })]
    const shifted = [makeInlineRect({ left: 422.67, top: 386.17 + 12.8, right: 465.67, bottom: 404.17 + 12.8 })]
    const bad = measureInlineFragmentPositionDrift({ expectedViewport: expected, actualViewport: shifted })
    expect(bad.ok).toBe(false)
    expect(bad.maxPositionDrift).toBeCloseTo(12.8, 1)
    expect(bad.maxDeltaTop).toBeCloseTo(12.8, 1)
    // A sub-pixel rendering difference is inside the band.
    const good = measureInlineFragmentPositionDrift({
      expectedViewport: expected,
      actualViewport: [makeInlineRect({ left: 422.9, top: 386.4, right: 465.9, bottom: 404.4 })],
    })
    expect(good.ok).toBe(true)
    expect(good.maxPositionDrift).toBeLessThanOrEqual(INLINE_POSITION_DRIFT_HARD_PX)
    // A dropped / extra fragment is a count mismatch, never a pass.
    const mismatch = measureInlineFragmentPositionDrift({
      expectedViewport: expected,
      actualViewport: [...expected, ...expected],
    })
    expect(mismatch.countMismatch).toBe(true)
    expect(mismatch.ok).toBe(false)
  })

  it('R4-3: the authority gate rejects every terminal inline violation', () => {
    const clean = {
      kindIsInline: true,
      exactInlinePresent: true,
      documentLocalFragmentCount: 1,
      meaningfulFragmentCount: 1,
      actualPaintedFragmentCount: 1,
      maxPositionDriftPx: 0.4,
      scrollWriteCount: 1,
      preScrollGeometryInvalidated: true,
      postScrollGeometryFresh: true,
      manualScrollOffsetApplied: false,
      privateViewportRenderPath: false,
      reprojectedDriftPx: 0.2,
    }
    expect(evaluateInlineCoordinateAuthority(clean).decision).toBe('PASS')
    // Not applicable (block / heading) is a PASS, never a silent inline failure.
    expect(evaluateInlineCoordinateAuthority({ ...clean, kindIsInline: false }).decision).toBe('PASS')
    expect(evaluateInlineCoordinateAuthority({ ...clean, exactInlinePresent: false }).decision).toBe('PASS')
    const cases: Array<[string, Partial<typeof clean>, string]> = [
      ['empty local rects', { documentLocalFragmentCount: 0 }, 'INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS'],
      ['fragment count mismatch', { documentLocalFragmentCount: 2 }, 'INLINE_VIEWPORT_LOCAL_FRAGMENT_COUNT_MISMATCH'],
      ['painted count mismatch', { actualPaintedFragmentCount: 0 }, 'INLINE_LOCAL_PAINTED_FRAGMENT_COUNT_MISMATCH'],
      ['stale pre-scroll', { preScrollGeometryInvalidated: false }, 'INLINE_STALE_PRE_SCROLL_GEOMETRY'],
      ['not fresh after scroll', { postScrollGeometryFresh: false }, 'INLINE_POST_SCROLL_GEOMETRY_NOT_FRESH'],
      ['manual scroll offset', { manualScrollOffsetApplied: true }, 'INLINE_MANUAL_SCROLL_OFFSET_APPLIED'],
      ['private viewport path', { privateViewportRenderPath: true }, 'INLINE_PRIVATE_VIEWPORT_RENDER_PATH'],
      ['position drift', { maxPositionDriftPx: 12.8 }, 'INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX'],
      ['reprojected drift', { reprojectedDriftPx: 12.8 }, 'INLINE_REPROJECTED_VIEWPORT_DRIFT_GT_1_5PX'],
    ]
    for (const [label, override, expected] of cases) {
      const d = evaluateInlineCoordinateAuthority({ ...clean, ...override })
      expect(d.decision, label).toBe('FAIL')
      expect(d.failedChecks, label).toContain(expected)
    }
    // NaN drift must FAIL (never a silent pass).
    const nan = evaluateInlineCoordinateAuthority({ ...clean, maxPositionDriftPx: Number.NaN })
    expect(nan.decision).toBe('FAIL')
  })

  it('R4-4: canCommitLocateVisual() blocks COMMIT for the inline doc-space violations', () => {
    const base = {
      semanticResolvePass: true,
      scrollArrivalPass: true,
      targetConnected: true,
      freshTargetMeasurement: true,
      layoutEpochCurrent: true,
      presentationBuilt: true,
      visualCarrierPresent: true,
      targetFullyUnobscured: true,
      panelIntersectionCount: 0,
      framePaintsAboveDrawer: false,
      framePaintsAboveToolbar: false,
      framePaintsAboveNavigator: false,
      coverageRatio: 1,
      inlineFragmentCoverage: 1,
      blockCoverage: null,
      staleGeometry: false,
    }
    const okInline = {
      documentLocalFragmentCount: 1,
      meaningfulFragmentCount: 1,
      actualPaintedFragmentCount: 1,
      maxPositionDriftPx: 0.3,
      scrollWriteCount: 1,
      preScrollGeometryInvalidated: true,
      postScrollGeometryFresh: true,
    }
    expect(canCommitLocateVisual({ ...base, inlineDocumentSpace: okInline }).canCommit).toBe(true)
    const empty = canCommitLocateVisual({ ...base, inlineDocumentSpace: { ...okInline, documentLocalFragmentCount: 0 } })
    expect(empty.canCommit).toBe(false)
    expect(empty.failedChecks).toContain('INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS')
    const drifted = canCommitLocateVisual({ ...base, inlineDocumentSpace: { ...okInline, maxPositionDriftPx: 12.8 } })
    expect(drifted.canCommit).toBe(false)
    expect(drifted.failedChecks).toContain('INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX')
    const stale = canCommitLocateVisual({ ...base, inlineDocumentSpace: { ...okInline, preScrollGeometryInvalidated: false } })
    expect(stale.canCommit).toBe(false)
    expect(stale.failedChecks).toContain('INLINE_STALE_PRE_SCROLL_GEOMETRY')
    // A BLOCK / heading target never carries the inline gate.
    expect(canCommitLocateVisual({ ...base, inlineDocumentSpace: null }).canCommit).toBe(true)
  })

  it('R4-5: the §24 report is exactly the 9 inline counters', () => {
    expect(INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS).toHaveLength(9)
    const counters = createInlineDocumentSpaceV512R4Counters()
    const report = formatInlineDocumentSpaceGateReport(counters)
    expect(report).toHaveLength(9)
    for (const key of INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS) {
      expect(report).toContain(`${INLINE_DOCUMENT_SPACE_V512R4_GATE_LABELS[key]}=0`)
    }
    expect(evaluateInlineDocumentSpaceGates(counters)).toEqual({ decision: 'PASS', failing: [] })
    expect(evaluateInlineDocumentSpaceGates({ ...counters, inlinePrivateViewportRenderPath: 1 }).decision).toBe('FAIL')
  })
})

// ── R4-6..R4-10 — the frame controller ─────────────────────────────────────
describe('R4-6/7/8 — programmatic scroll invalidation + fresh re-measure', () => {
  it('R4-6: a reposition AFTER the scroll re-measures the Range (core regression)', () => {
    const { ctrl, owner, root } = makeInlineController(V1)
    commitInline(ctrl, owner)
    const afterCommit = ctrl.getInlineCoordinateFacts()
    expect(afterCommit.viewportFragments).toHaveLength(1)
    expect(afterCommit.viewportFragments[0].top).toBeCloseTo(V1[0].top, 2)
    const paintedAfterCommit = document.querySelectorAll<HTMLElement>(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)
    expect(paintedAfterCommit).toHaveLength(1)
    expect(Number.parseFloat(paintedAfterCommit[0].style.top)).toBe(Math.round(V1[0].top))

    // The locator scrolled the document → the SAME token now lives 12.8px higher.
    // Before the fix the fragment kept the PRE-scroll top (deltaTop ≈ 12.8px).
    stubRangeRects(V2)
    ctrl.reposition({})

    const afterScroll = ctrl.getInlineCoordinateFacts()
    expect(afterScroll.viewportFragments).toHaveLength(1)
    expect(afterScroll.viewportFragments[0].top).toBeCloseTo(V2[0].top, 2)
    expect(afterScroll.generation).toBeGreaterThan(afterCommit.generation)
    const paintedAfterScroll = document.querySelectorAll<HTMLElement>(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)
    expect(paintedAfterScroll).toHaveLength(1)
    expect(Number.parseFloat(paintedAfterScroll[0].style.top)).toBe(Math.round(V2[0].top))
    // The stale pre-scroll geometry can never be what the overlay shows.
    expect(Number.parseFloat(paintedAfterScroll[0].style.top)).not.toBe(Math.round(V1[0].top))
    ctrl.dispose()
    owner.remove()
    root.remove()
  })

  it('R4-7: a scroll invalidation is followed by a provably FRESH paint', () => {
    const { ctrl, owner, root } = makeInlineController(V1)
    commitInline(ctrl, owner)
    expect(ctrl.getInlineCoordinateFacts().preScrollGeometryInvalidated).toBe(false)
    const generationBefore = ctrl.getInlineCoordinateFacts().generation

    ctrl.invalidateInlineGeometry('PROGRAMMATIC_LOCATE_SCROLL')
    const invalidated = ctrl.getInlineCoordinateFacts()
    expect(invalidated.preScrollGeometryInvalidated).toBe(true)
    expect(invalidated.postScrollGeometryFresh).toBe(false)
    expect(invalidated.invalidationReason).toBe('PROGRAMMATIC_LOCATE_SCROLL')
    expect(invalidated.generationAtInvalidation).toBe(generationBefore)
    // The stale pre-scroll fragments are gone (never committed).
    expect(invalidated.viewportFragments).toHaveLength(0)
    expect(invalidated.paintedFragmentElementCount).toBe(0)
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(0)

    // The post-scroll re-measure is the ONLY geometry allowed to reach COMMIT.
    stubRangeRects(V2)
    ctrl.reposition({})
    const fresh = ctrl.getInlineCoordinateFacts()
    expect(fresh.postScrollGeometryFresh).toBe(true)
    expect(fresh.preScrollGeometryInvalidated).toBe(true)
    expect(fresh.generation).toBeGreaterThan(generationBefore)
    expect(fresh.viewportFragments[0].top).toBeCloseTo(V2[0].top, 2)
    ctrl.dispose()
    owner.remove()
    root.remove()
  })

  it('R4-8: releaseViewportInlineCarrier() detaches ONLY the viewport carrier', () => {
    const { ctrl, owner, root } = makeInlineController(V1)
    commitInline(ctrl, owner)
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(1)
    const released = ctrl.releaseViewportInlineCarrier()
    expect(released).toBe(true)
    // No private viewport render path survives …
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(0)
    expect(ctrl.getStructure().inlineFragmentCount).toBe(0)
    // … but the MEASURED geometry is preserved for the document-space conversion.
    const facts = ctrl.getInlineCoordinateFacts()
    expect(facts.viewportFragments).toHaveLength(1)
    expect(facts.viewportFragments[0].top).toBeCloseTo(V1[0].top, 2)
    expect(facts.expectedViewportRects).toHaveLength(1)
    ctrl.dispose()
    owner.remove()
    root.remove()
  })
})

describe('R4-9/10 — multi-line fragments and the real painted rects', () => {
  it('R4-9: a wrapped token stays one fragment per visual line (no cross-line union)', () => {
    const { ctrl, owner, root } = makeInlineController(MULTI)
    commitInline(ctrl, owner, 'b.png')
    const facts = ctrl.getInlineCoordinateFacts()
    expect(facts.viewportFragments).toHaveLength(2)
    expect(facts.expectedViewportRects.length).toBeGreaterThanOrEqual(2)
    expect(ctrl.getInlineFragmentFacts().crossLineUnion).toBe(false)
    // A layout reflow re-measures WITHOUT painting a viewport carrier.
    const before = document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`).length
    const generationBefore = facts.generation
    const remeasured = ctrl.remeasureInlineGeometry()
    expect(remeasured.fragments).toHaveLength(2)
    expect(ctrl.getInlineCoordinateFacts().generation).toBeGreaterThan(generationBefore)
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`).length).toBe(before)
    ctrl.dispose()
    owner.remove()
    root.remove()
  })

  it('R4-10: the painted fragment facts are the REAL overlay DOM rects', () => {
    const { ctrl, owner, root } = makeInlineController(MULTI)
    commitInline(ctrl, owner, 'b.png')
    const painted = Array.from(document.querySelectorAll<HTMLElement>(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`))
    expect(painted).toHaveLength(2)
    // jsdom has no layout: model the real painted rect (that is exactly what the
    // browser does for an absolutely positioned overlay child).
    stubRect(painted[0], () => ({ left: MULTI[0].left, top: MULTI[0].top, right: MULTI[0].right, bottom: MULTI[0].bottom }))
    stubRect(painted[1], () => ({ left: MULTI[1].left, top: MULTI[1].top, right: MULTI[1].right, bottom: MULTI[1].bottom }))
    const facts = ctrl.getInlineCoordinateFacts()
    expect(facts.paintedFragmentElementCount).toBe(2)
    expect(facts.paintedViewportRects).toHaveLength(2)
    const drift = measureInlineFragmentPositionDrift({
      expectedViewport: facts.viewportFragments.map(f => makeInlineRect({ left: f.left, top: f.top, right: f.right, bottom: f.bottom })),
      actualViewport: facts.paintedViewportRects.map(r => makeInlineRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
    })
    expect(drift.ok).toBe(true)
    expect(drift.maxPositionDrift).toBeLessThanOrEqual(INLINE_POSITION_DRIFT_HARD_PX)
    ctrl.dispose()
    owner.remove()
    root.remove()
  })
})

// ── R4-11..R4-13 — the host document-space carrier ─────────────────────────
type HostInternals = {
  locateFrame: DiagnosticLocateFrameController
  commitDocumentSpaceCarrier(tx: unknown, diag: unknown, result: unknown): boolean
  auditPostCommitScrollInert(): void
}
function internals(h: DocumentUtilityOverlayHost): HostInternals {
  return h as unknown as HostInternals
}

function fakeTx(id = 1): Record<string, unknown> {
  return {
    id,
    documentKey: 'doc:key',
    diagnosticId: 'img:b.png',
    targetIndex: 0,
    targetCount: 1,
    startedAt: 0,
    state: 'FINAL_VERIFYING',
    oneClick: { initialScrollTop: 0, scrollWriteCount: 1 },
  }
}
function fakeDiag(): Record<string, unknown> {
  return {
    id: 'img:b.png',
    documentKey: 'doc:key',
    severity: 'error',
    category: 'document',
    code: 'FIGURE_LOCAL_IMAGE_MISSING',
    message: 'm',
    detail: '',
    metadata: { resourceKind: 'image', occurrenceIndex: 0, destination: 'b.png', rawDestination: 'b.png' },
    location: { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' },
  }
}

describe('R4-11/12/13 — the inline DOCUMENT-SPACE carrier', () => {
  it('R4-11: inline fragments are committed into the shared document-space layer', async () => {
    const mounted = makeHost()
    host = mounted.h
    const { ctrl, owner, root: ctrlRoot } = makeInlineController(V1)
    const h = internals(host)
    h.locateFrame = ctrl
    // The exact-fragment carrier is painted during commit (pre-scroll viewport).
    commitInline(ctrl, owner)
    expect(ctrlRoot.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(1)
    // The locator wrote scroll → invalidate, then re-measure the settled Range.
    ctrl.invalidateInlineGeometry('PROGRAMMATIC_LOCATE_SCROLL')
    stubRangeRects(V2)
    ctrl.reposition({})

    const ok = h.commitDocumentSpaceCarrier(fakeTx(), fakeDiag(), { element: owner })
    expect(ok).toBe(true)

    const audit = lastAuditPayload(host, 'getLastInlineCoordinateAudit')!
    expect(audit).not.toBeNull()
    expect(audit.normalizerAuthority).toBe(INLINE_COORDINATE_NORMALIZER_ID)
    expect(audit.coordinateNormalizerId).toBe(INLINE_COORDINATE_NORMALIZER_ID)
    expect(audit.manualScrollOffsetApplied).toBe(false)
    expect(audit.scrollCompensationMode).toBe('NONE_DOCUMENT_HOST_RECT_ONLY')
    expect(audit.rangeResolved).toBe(true)
    expect(audit.preScrollGeometryInvalidated).toBe(true)
    expect(audit.postScrollGeometryFresh).toBe(true)
    expect(audit.decision).toBe('PASS')
    expect(audit.failedChecks).toEqual([])
    const localRects = audit.documentLocalRects as Array<Record<string, number>>
    expect(Array.isArray(localRects)).toBe(true)
    expect(localRects.length).toBeGreaterThanOrEqual(1)
    // local = viewport - documentHostRect  (host stub: left 280, top 24) and it
    // MUST use the POST-scroll range (V2), never the stale pre-scroll one (V1).
    expect(localRects[0].left).toBeCloseTo(V2[0].left - 280, 1)
    expect(localRects[0].top).toBeCloseTo(V2[0].top - 24, 1)
    expect(localRects[0].top).not.toBeCloseTo(V1[0].top - 24, 0)

    // The DOCUMENT-SPACE audit carries the same evidence (§13).
    const spaceAudit = readAuditLine(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)
    expect(spaceAudit).not.toBeNull()
    expect(spaceAudit!.coordinateNormalizerId).toBe(INLINE_COORDINATE_NORMALIZER_ID)
    expect(spaceAudit!.scrollCompensationMode).toBe('NONE_DOCUMENT_HOST_RECT_ONLY')
    expect(Number(spaceAudit!.documentLocalFragmentCount)).toBeGreaterThanOrEqual(1)
    expect(Number(spaceAudit!.expectedFragmentCount)).toBe(Number(spaceAudit!.documentLocalFragmentCount))
    // The inline coordinate audit really reached the console stream.
    expect(readAuditLine(infoSpy!, INLINE_COORDINATE_AUTHORITY_AUDIT_EVENT)).not.toBeNull()

    // NO private viewport render path survives the COMMIT.
    expect(ctrlRoot.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(0)
    expect(ctrl.getStructure().inlineFragmentCount).toBe(0)
    // …and the document-space carriers live inside the document layer.
    const docLayer = document.querySelector('.inkchapter-locate-document-layer')!
    expect(docLayer).toBeTruthy()
    expect(docLayer.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`).length).toBe(localRects.length)
    expect(mounted.root.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(0)

    expect(Object.values(host.getInlineDocumentSpaceCounters()).every(v => v === 0)).toBe(true)
    expect(host.getInlineDocumentSpaceGateReport()).toHaveLength(9)

    ctrl.dispose()
    owner.remove()
  })

  it('R4-12: an inline COMMIT with empty document-local rects is impossible', async () => {
    const mounted = makeHost()
    host = mounted.h
    const { ctrl, owner, root: ctrlRoot } = makeInlineController(V1)
    const h = internals(host)
    h.locateFrame = ctrl
    commitInline(ctrl, owner)
    expect(ctrlRoot.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(1)
    // The locator scrolled and the settled Range is NO LONGER measurable: the
    // pre-scroll fragments were invalidated and no fresh geometry can be produced.
    ctrl.invalidateInlineGeometry('PROGRAMMATIC_LOCATE_SCROLL')
    stubRangeRects([])
    expect(ctrl.getInlineCoordinateFacts().viewportFragments).toHaveLength(0)

    const gateFacts = (host as unknown as {
      measureInlineDocumentSpaceGateFacts(): {
        documentLocalFragmentCount: number
        meaningfulFragmentCount: number
        actualPaintedFragmentCount: number
        maxPositionDriftPx: number | null
        scrollWriteCount: number
        preScrollGeometryInvalidated: boolean
        postScrollGeometryFresh: boolean
      } | null
    }).measureInlineDocumentSpaceGateFacts()
    expect(gateFacts).not.toBeNull()
    expect(gateFacts!.documentLocalFragmentCount).toBe(0)
    expect(gateFacts!.scrollWriteCount).toBe(0)
    expect(gateFacts!.preScrollGeometryInvalidated).toBe(true)
    expect(gateFacts!.postScrollGeometryFresh).toBe(false)

    // The UNIQUE commit gate is what actually blocks COMMIT.
    const decision = canCommitLocateVisual({
      semanticResolvePass: true,
      scrollArrivalPass: true,
      targetConnected: true,
      freshTargetMeasurement: true,
      layoutEpochCurrent: true,
      presentationBuilt: true,
      visualCarrierPresent: true,
      targetFullyUnobscured: true,
      panelIntersectionCount: 0,
      framePaintsAboveDrawer: false,
      framePaintsAboveToolbar: false,
      framePaintsAboveNavigator: false,
      coverageRatio: 1,
      inlineFragmentCoverage: 1,
      blockCoverage: null,
      staleGeometry: false,
      inlineDocumentSpace: { ...gateFacts!, scrollWriteCount: 1 },
    })
    expect(decision.canCommit).toBe(false)
    expect(decision.failedChecks).toContain('INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS')
    // The invalidation DID happen (so it is not the stale case) — what is missing
    // is the post-scroll fresh geometry the terminal COMMIT requires.
    expect(decision.failedChecks).toContain('INLINE_POST_SCROLL_GEOMETRY_NOT_FRESH')
    expect(decision.failedChecks).not.toContain('INLINE_STALE_PRE_SCROLL_GEOMETRY')

    // The host also mounts NO document-space inline carrier in that state.
    expect(h.commitDocumentSpaceCarrier(fakeTx(), fakeDiag(), { element: owner })).toBe(true)
    const docLayer = document.querySelector('.inkchapter-locate-document-layer')!
    expect(docLayer.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(0)
    ctrl.dispose()
    owner.remove()
  })

  it('R4-13: a post-commit user scroll keeps the inline document-local geometry inert', async () => {
    const mounted = makeHost()
    host = mounted.h
    const { ctrl, owner } = makeInlineController(V1)
    const h = internals(host)
    h.locateFrame = ctrl
    commitInline(ctrl, owner)
    expect(h.commitDocumentSpaceCarrier(fakeTx(2), fakeDiag(), { element: owner })).toBe(true)

    const spaceBefore = readAuditLine(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT)! as Record<string, string>
    const localCountBefore = Number(spaceBefore.documentLocalFragmentCount)
    expect(localCountBefore).toBeGreaterThanOrEqual(1)

    h.auditPostCommitScrollInert()
    const scrollAudit = readAuditLine(infoSpy!, LOCATE_DOCUMENT_SPACE_AUDIT_EVENT, 1)!
    expect(scrollAudit).not.toBeNull()
    expect(scrollAudit.reason).toBe('POST_COMMIT_USER_SCROLL_INERT')
    expect(scrollAudit.postCommitRemeasureCount).toBe('0')
    expect(scrollAudit.postCommitRepaintCount).toBe('0')
    expect(scrollAudit.postCommitReresolveCount).toBe('0')
    expect(scrollAudit.postCommitScrollWriteCount).toBe('0')
    expect(Number(scrollAudit.inlineLocalDriftPx)).toBe(0)
    expect(Number(scrollAudit.documentLocalInlineRectCount)).toBe(localCountBefore)
    // No user scroll is ever a layout reflow, and the inline geometry is untouched.
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)).toHaveLength(localCountBefore)
    ctrl.dispose()
    owner.remove()
  })
})
