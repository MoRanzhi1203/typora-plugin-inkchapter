// @vitest-environment jsdom
/**
 * Unified Geometry Transaction Closure — ACTIVE ↔ PASSIVE same-generation contract.
 *
 * The real-Typora defect (session sess-1791559141853):
 *   `DOCUMENT-DIAGNOSTIC-HEADING-POST-RECONCILE-CLOSURE` reported
 *   `geometryGeneration=19` with `activeReadinessReason=ACTIVE_VISUAL_GEOMETRY_GENERATION_STALE`
 *   while the SAME pass' `DOCUMENT-DIAGNOSTIC-VISUAL-REFLOW-AUDIT` claimed
 *   `activeRebuilt=true / visualSnapshotAtomic=true / decision=PASS` — a false PASS.
 *
 * This suite pins the fixed contract:
 *   ACT-TX-1  a RETAINED active visual whose geometry the reconcile PROVED unchanged
 *             is re-stamped to the CURRENT geometry generation (ONE atomic commit);
 *   ACT-TX-2  a RETAINED active visual whose geometry DRIFTED is NEVER re-stamped
 *             (the closure still FAILs — the re-stamp never masks a real error);
 *   ACT-TX-3  the verified reflow-audit facts are the committed ones (no claim).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import type { HeadingActiveVisualFacts } from './document-diagnostic-heading-active-persistence-v1'

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
function fakeContext(docKey = 'doc:key'): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => docKey,
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
  renderHeadingActiveEmphasisForTest(id: string, diag: unknown, el: HTMLElement): void
  getVisualGeometryGeneration(): number
  getVisualClosureCounters(): Readonly<Record<string, number>>
  invalidateDiagnosticVisualGeometry(reason: string): void
  getHeadingReasonChipStabilityV2Counters(): Readonly<Record<string, number>>
}
type HostInternals = {
  headingActiveVisualFacts: Map<string, HeadingActiveVisualFacts>
  headingActiveMarkerIdentity: string | null
  renderActiveHeadingEmphasisForCommittedVisual: () => void
  restampRetainedActiveHeadingVisualForCurrentGeneration: () => void
  activeHeadingVisualGenerationRestampCount: number
  activeHeadingVisualGenerationUnverifiedCount: number
  setHeadingVisualDirtyTargets(entries: ReadonlyArray<{ targetKey: string; reason: string }>): void
  isHeadingVisualDirty(identity: string): boolean
  bumpDocumentLayoutEpoch(kind: string): boolean
  headingPassiveMarkers: Map<string, { rebuiltThisPass?: boolean; geometryGeneration?: number; measuredLayoutEpoch?: number }>
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

function makeWorld(docKey = 'doc:key'): { h: DocumentUtilityOverlayHost; heading: HTMLElement; move: (deltaY: number) => void } {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const heading = document.createElement('h2')
  heading.setAttribute('data-id', 'H-A')
  heading.setAttribute('data-line', '4')
  heading.textContent = '标题一'
  write.appendChild(heading)
  let offset = 0
  stubRect(heading, () => ({ left: 100, top: 200 + offset, right: 1000, bottom: 232 + offset }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(docKey), providers: fakeProviders() })
  h.mount()
  return {
    h,
    heading,
    move: (deltaY: number) => {
      offset += deltaY
      stubRangeRects(rangeRects.map(r => ({ ...r, top: r.top + deltaY, bottom: r.bottom + deltaY })))
    },
  }
}

function diagFor(id: string, headingId: string, docKey = 'doc:key'): Record<string, unknown> {
  return {
    id, documentKey: docKey, severity: 'warning', category: 'heading', code: 'HEADING_LEVEL_GAP',
    message: 'm', detail: '', stableIdentity: headingId, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: headingId },
  } as unknown as Record<string, unknown>
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 1, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for this test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
const api = (): HostApi => host as unknown as HostApi
const internals = (): HostInternals => host as unknown as HostInternals
const activeWrapper = (): HTMLElement | null => document.querySelector('.inkchapter-heading-diagnostic-active')

describe('Unified Geometry Transaction — ACTIVE shares the ONE commit generation', () => {
  it('ACT-TX-1 — a retained active visual with VERIFIED-unchanged geometry is re-stamped to the current generation', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('E1', diagFor('E1', 'H-A'), w.heading)

    const identity = internals().headingActiveMarkerIdentity
    expect(identity).toBe('id:H-A')
    const wrapper = activeWrapper()
    expect(wrapper).not.toBeNull()
    const generationBefore = Number(wrapper!.getAttribute('data-ink-geometry-generation'))

    // Simulate the real-runtime defect: the active re-projection silently bails
    // (resolve failure / element unresolved) while the passive pass DID bump the
    // generation. The target did NOT move → the retained geometry is still valid.
    internals().renderActiveHeadingEmphasisForCommittedVisual = () => { /* simulated silent bail */ }
    api().renderHeadingDiagnosticMarkers()

    const currentGeneration = api().getVisualGeometryGeneration()
    expect(currentGeneration).toBeGreaterThan(generationBefore)
    // §3.2 — ONE generation for the whole commit: the DOM witness AND the
    // state-derived facts both carry the CURRENT generation.
    expect(Number(wrapper!.getAttribute('data-ink-geometry-generation'))).toBe(currentGeneration)
    const facts = internals().headingActiveVisualFacts.get('id:H-A')!
    expect(facts.geometryGeneration).toBe(currentGeneration)
    expect(facts.fragmentCount).toBeGreaterThanOrEqual(1)
    expect(internals().activeHeadingVisualGenerationRestampCount).toBeGreaterThanOrEqual(1)
  })

  it('ACT-TX-2 — a retained active visual that DRIFTED is NEVER re-stamped (no masked staleness)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('E1', diagFor('E1', 'H-A'), w.heading)

    const wrapper = activeWrapper()
    const generationBefore = Number(wrapper!.getAttribute('data-ink-geometry-generation'))
    // the target really moved, and this pass bumps the generation while the active
    // re-projection silently bails — the exact scenario a naive re-stamp would hide.
    w.move(40)
    internals().renderActiveHeadingEmphasisForCommittedVisual = () => { /* simulated silent bail */ }
    api().renderHeadingDiagnosticMarkers()

    expect(api().getVisualGeometryGeneration()).toBeGreaterThan(generationBefore)
    const facts = internals().headingActiveVisualFacts.get('id:H-A')!
    // the geometry is NOT verified current → the facts keep the OLD generation and
    // the post-commit closure still observes the staleness (never masked).
    expect(facts.geometryGeneration).toBe(generationBefore)
    expect(internals().activeHeadingVisualGenerationUnverifiedCount).toBeGreaterThanOrEqual(1)
  })

  it('ACT-TX-3 — the re-stamp is not a no-op claim: the passive record of the active target moves too', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasisForTest('E1', diagFor('E1', 'H-A'), w.heading)

    internals().renderActiveHeadingEmphasisForCommittedVisual = () => { /* simulated silent bail */ }
    api().renderHeadingDiagnosticMarkers()
    const currentGeneration = api().getVisualGeometryGeneration()
    const rec = (host as unknown as {
      headingPassiveMarkers: Map<string, { geometryGeneration: number }>
    }).headingPassiveMarkers.get('id:H-A')!
    expect(rec.geometryGeneration).toBe(currentGeneration)
  })
})

// ── Unified Geometry Transaction Closure — dirty-key + closure deferral ─────

/** Read one audit event's `k=v` fields from the captured console.info lines. */
function readAudit(event: string): Array<Record<string, string>> {
  const spy = infoSpy as unknown as { mock: { calls: unknown[][] } }
  const out: Array<Record<string, string>> = []
  for (const call of spy.mock.calls) {
    const line = String(call[0] ?? '')
    if (!line.includes(event)) continue
    const idx = line.indexOf(`${event}: `)
    if (idx < 0) continue
    const fields: Record<string, string> = {}
    for (const m of line.slice(idx + event.length + 2).matchAll(/(\w+)=([^\s,}]+)/g)) fields[m[1]] = m[2]
    out.push(fields)
  }
  return out
}

describe('Unified Geometry Transaction Closure — dirty keys + closure deferral', () => {
  it('ROOT_DIRTY_KEY — a canonical dirty targetKey also marks its MARKER identity dirty', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    // The reducer publishes CANONICAL keys (`doc::diag::0::id:H-A`); every consumer
    // queries the marker identity (`id:H-A`). Pre-fix this lookup was ALWAYS false,
    // so every heading was "non-dirty" (484 non-dirty remeasures + 96 false chip FAILs).
    internals().setHeadingVisualDirtyTargets([{ targetKey: 'doc:key::E1::0::id:H-A', reason: 'ACTIVE_ENTER' }])
    expect(internals().isHeadingVisualDirty('id:H-A')).toBe(true)
    expect(internals().isHeadingVisualDirty('doc:key::E1::0::id:H-A')).toBe(true)
    expect(internals().isHeadingVisualDirty('id:H-Z')).toBe(false)
  })

  it('ROOT_CLOSURE_DEFER — an unresolved heading target with NO ready document is DEFERRED, never counted', () => {
    // Exact real-runtime false FAIL (sess-1791560998955 @16:10:22.595): a
    // content-mutation reconcile ran while the document context was NOT READY
    // (`documentKey=''`), every heading node was transiently detached, and the
    // transient produced a PERMANENT `LOCATABLE_HEADING_DIAGNOSTIC_WITHOUT_VISUAL_TARGET_COUNT=1`.
    const w = makeWorld('')
    host = w.h
    inject(host, [diagFor('E1', 'H-MISSING', '')])
    api().renderHeadingDiagnosticMarkers()

    const counters = api().getVisualClosureCounters()
    expect(counters.locatableHeadingDiagnosticWithoutVisualTarget).toBe(0)
    const deferred = readAudit('DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-TARGET-AUDIT')
    expect(deferred.length).toBeGreaterThan(0)
    expect(deferred[deferred.length - 1].state).toBe('DEFERRED')
    expect(deferred[deferred.length - 1].reason).toBe('WAITING_DOCUMENT_READY')
  })

  it('ROOT_CLOSURE_DEFER — a ready document that RESOLVES its target stays clean (0)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    expect(api().getVisualClosureCounters().locatableHeadingDiagnosticWithoutVisualTarget).toBe(0)
  })

  it('ROOT_DIRTY_SCOPE — a FULL reconcile (no interaction) never charges non-dirty remeasure counters', () => {
    // Real-runtime regression: 5 legitimate full reconciles (EDITOR_REFLOW /
    // DOCUMENT_SWITCH, dirty scope === null) charged `nonDirtyHeadingVisualRemeasure`
    // and `nonActiveHeadingRebuiltOnNonHeadingSwitch`, even though re-measuring every
    // heading in a full reconcile is REQUIRED. Those violations are only meaningful
    // inside an interaction-scoped reconcile.
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    w.move(30)
    api().invalidateDiagnosticVisualGeometry('EDITOR_REFLOW')

    const c = api().getHeadingReasonChipStabilityV2Counters()
    expect(c.nonDirtyHeadingVisualRemeasure).toBe(0)
    expect(c.nonActiveHeadingRebuiltOnNonHeadingSwitch).toBe(0)
  })

  it('ROOT_V2_D — a plugin-owned epoch bump with UNCHANGED live geometry does NOT rebuild a non-dirty heading', () => {
    // The real-runtime regression: the plugin's OWN projection bumps the document
    // layout epoch (`LAYOUT_EPOCH:PLUGIN_DOM_MUTATION` ×11). The epoch guard then
    // bypassed the scoped skip on every plugin write → global heading re-measure
    // (PLUGIN_DOM_MUTATION_GLOBAL_HEADING_REFLOW_COUNT, NON_DIRTY_…).
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    // scope the reconcile to an UNRELATED target → H-A is a non-dirty heading
    internals().setHeadingVisualDirtyTargets([{ targetKey: 'doc:key::OTHER::0::id:H-Z', reason: 'ACTIVE_ENTER' }])
    internals().bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')

    const rec = internals().headingPassiveMarkers.get('id:H-A')!
    expect(rec.rebuiltThisPass).toBe(false)
    const c = api().getHeadingReasonChipStabilityV2Counters()
    expect(c.pluginDomMutationGlobalHeadingReflow).toBe(0)
    expect(c.nonDirtyHeadingVisualRemeasure).toBe(0)
    expect(c.nonActiveHeadingRebuiltOnNonHeadingSwitch).toBe(0)
  })

  it('ROOT_V2_D — a scoped reconcile DOES rebuild a non-dirty heading that really MOVED (no violation charged)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [diagFor('E1', 'H-A')])
    api().renderHeadingDiagnosticMarkers()
    internals().setHeadingVisualDirtyTargets([{ targetKey: 'doc:key::OTHER::0::id:H-Z', reason: 'ACTIVE_ENTER' }])
    w.move(40)
    internals().bumpDocumentLayoutEpoch('PLUGIN_DOM_MUTATION')

    const rec = internals().headingPassiveMarkers.get('id:H-A')!
    // it really moved → the rebuild is REQUIRED (correctness), so it is not charged
    expect(rec.rebuiltThisPass).toBe(true)
    const c = api().getHeadingReasonChipStabilityV2Counters()
    expect(c.pluginDomMutationGlobalHeadingReflow).toBe(0)
  })
})
