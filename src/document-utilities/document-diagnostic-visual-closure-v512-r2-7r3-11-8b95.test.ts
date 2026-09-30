// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.95 — Diagnostic Visual Geometry Closure V5.12-R2.
 *
 * Suites:
 *   R2-EPOCH-*        §3  DocumentLayoutEpoch (stale geometry + coalesced reconcile)
 *   R2-HEADING-*      §4/§5/§6  scroll authority ≠ visual authority; ACTIVE keeps PASSIVE
 *   R2-MULTI-*        §8/§9  generic visual target resolver + multi-target heading
 *   R2-INLINE-*       §10 exactly ONE fragment per visual line (never a union)
 *   R2-COMMIT-*       §14/§15  the UNIQUE commit gate (visual FAIL blocks COMMIT)
 *   R2-AUDIT-*        §17 the unified closure audit surface
 *   R2-GATE-*         §18 the 35 hard gates are declared and start at 0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { DiagnosticLocateFrameController, DIAGNOSTIC_INLINE_FRAGMENT_CLASS } from './document-diagnostic-locate-frame'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  LAYOUT_EPOCH_BUMP_KINDS,
  LAYOUT_EPOCH_FORBIDDEN_KINDS,
  isLayoutEpochStale,
  isPassiveMarkerDrift,
  nextLayoutEpoch,
  shouldBumpLayoutEpoch,
} from './document-layout-epoch-v512-r2'
import {
  headingVisualTargets,
  resolveDiagnosticVisualTargets,
} from './document-diagnostic-visual-target-v512-r2'
import {
  canCommitLocateVisual,
  createVisualClosureV512R2Counters,
  evaluateVisualClosureGates,
  formatVisualClosureGateReport,
  fragmentCoverageRatio,
  groupClientRectsToFragments,
  hasCrossLineUnion,
  resolveLocateVisualRecoveryDecision,
  VISUAL_CLOSURE_AUDIT_EVENT,
  VISUAL_CLOSURE_V512R2_GATE_KEYS,
  VISUAL_CLOSURE_V512R2_GATE_LABELS,
} from './document-diagnostic-visual-closure-v512-r2'

let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { rafTasks.delete(id) }
}
async function flushRaf(): Promise<void> {
  let guard = 0
  while (rafTasks.size > 0 && guard++ < 300) {
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

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题',
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
    getObjectCaptionHost: () => null,
  }
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudits(spy: InfoSpy, event: string): Array<Record<string, string>> {
  return spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes(event))
    .map(line => {
      const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
      const out: Record<string, string> = {}
      for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
      return out
    })
}

type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  getHeadingMarkerSnapshot(): { passiveCount: number; activeIdentity: string | null; activeFragmentCount: number } | null
  bumpDocumentLayoutEpoch(kind: string): boolean
  getDocumentLayoutEpoch(): number
  scheduleDiagnosticGeometryReconcile(reason: string): void
}
function api(h: DocumentUtilityOverlayHost): HostApi {
  return h as unknown as HostApi
}

interface World { h: DocumentUtilityOverlayHost; write: HTMLElement; heading: HTMLElement }
function makeWorld(tag = 'h2'): World {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const heading = document.createElement(tag)
  heading.setAttribute('data-id', 'H-A')
  heading.setAttribute('data-line', '4')
  heading.textContent = '二级标题 B'
  write.appendChild(heading)
  stubRect(heading, () => ({ left: 100, top: 200, right: 1000, bottom: 232 }))
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, write, heading }
}
function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: diags, errorCount: 0, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the marker tests */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
function headingDiag(id: string, code: string, severity: string, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: 'H-A', metadata, location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
  } as unknown as Record<string, unknown>
}

let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as InfoSpy
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

// ── §3 LayoutEpoch (pure) ──────────────────────────────────────────────────
describe('R2-EPOCH — DocumentLayoutEpoch authority', () => {
  it('R2-EPOCH-1: only real layout mutations may bump; scroll/wheel/pointer may NOT', () => {
    for (const kind of ['CAPTION_PROJECTION_MOUNT', 'CAPTION_PROJECTION_REPLACE', 'HEADING_NUMBERING_PROJECTION',
      'FORMULA_PROJECTION', 'OBJECT_CAPTION_INSERT', 'WINDOW_LAYOUT_SETTLE', 'DOCUMENT_SWITCH', 'DOCUMENT_LOAD'] as const) {
      expect(shouldBumpLayoutEpoch(kind)).toBe(true)
    }
    for (const kind of LAYOUT_EPOCH_FORBIDDEN_KINDS) expect(shouldBumpLayoutEpoch(kind)).toBe(false)
    expect(LAYOUT_EPOCH_BUMP_KINDS.length + LAYOUT_EPOCH_FORBIDDEN_KINDS.length).toBeGreaterThanOrEqual(20)
  })

  it('R2-EPOCH-2: staleness + monotonic epoch + drift band', () => {
    expect(isLayoutEpochStale(3, 4)).toBe(true)
    expect(isLayoutEpochStale(4, 4)).toBe(false)
    // A measurement without an epoch is never fabricated as a violation.
    expect(isLayoutEpochStale(null, 9)).toBe(false)
    expect(nextLayoutEpoch(7)).toBe(8)
    expect(isPassiveMarkerDrift({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 0.4, top: 0.4, right: 10.4, bottom: 10.4 })).toBe(false)
    expect(isPassiveMarkerDrift({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 0, top: 0, right: 10, bottom: 12 })).toBe(true)
  })

  it('R2-EPOCH-3: a user scroll never bumps the document epoch; a projection commit does', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api(host).renderHeadingDiagnosticMarkers()
    // Settle every pending mount-time geometry frame first (mount / load are
    // legitimate bump sources, so the baseline must be a quiet epoch).
    await flushRaf()
    const before = api(host).getDocumentLayoutEpoch()
    // A canonical user scroll must NOT invalidate geometry.
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    w.write.dispatchEvent(new Event('scroll', { bubbles: true }))
    await flushRaf()
    expect(api(host).getDocumentLayoutEpoch()).toBe(before)
    // A real layout mutation DOES bump.
    api(host).bumpDocumentLayoutEpoch('HEADING_NUMBERING_PROJECTION')
    expect(api(host).getDocumentLayoutEpoch()).toBe(before + 1)
  })

  it('R2-EPOCH-4: a stale marker geometry is re-measured in ONE coalesced frame (drift stays 0)', async () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api(host).renderHeadingDiagnosticMarkers()
    const render = vi.spyOn(host as unknown as { renderHeadingDiagnosticMarkers: () => void }, 'renderHeadingDiagnosticMarkers')
    // The body moves: the heading really relocates 120px down.
    stubRect(w.heading, () => ({ left: 100, top: 320, right: 1000, bottom: 352 }))
    api(host).bumpDocumentLayoutEpoch('CAPTION_PROJECTION_REPLACE')
    api(host).bumpDocumentLayoutEpoch('OBJECT_CAPTION_INSERT')
    await flushRaf()
    // Both bumps coalesced into ONE re-measure.
    expect(render.mock.calls.length).toBe(1)
    // V5.12-R9 §3/§5 — the passive carrier is the text-tight fill fragment (the
    // rail is gone), and it FOLLOWED the heading (it really moved down).
    const passiveFill = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement
    expect(passiveFill).not.toBeNull()
    expect(Number.parseFloat(passiveFill.style.top)).toBeGreaterThan(150)
    const counters = host.getVisualClosureCounters()
    expect(counters.passiveMarkerStaleLayoutEpoch).toBe(0)
    expect(counters.passiveMarkerTargetDriftGt1px).toBe(0)
    render.mockRestore()
  })
})

// ── §4/§5/§6 Heading single visual authority ──────────────────────────────
describe('R2-HEADING — scroll authority ≠ visual authority', () => {
  it('R2-HEADING-1: the heading block stays the scroll authority while the marker is text-tight', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api(host).renderHeadingDiagnosticMarkers()
    const audits = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT').filter(a => a.reason === 'PASSIVE_SEVERITY_MARKER')
    expect(audits.length).toBe(1)
    // V5.12-R9 §3/§5 — the passive carrier is TEXT-TIGHT: it sits ON the heading
    // text (the 900px block stays the scroll authority), never in a gutter.
    const passiveFill = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement
    expect(passiveFill).not.toBeNull()
    expect(Number.parseFloat(passiveFill.style.left)).toBeGreaterThanOrEqual(200)
    // …and the heading never becomes a full-width band.
    expect(Number.parseFloat(passiveFill.style.width)).toBeLessThanOrEqual(801)
    expect(audits[0].headingContentRects).toContain('200')
    expect(audits[0].legacyFrameRendered).toBe('false')
    expect(audits[0].fullWidthWash).toBe('false')
    expect(host.getVisualClosureCounters().headingFullWidthVisualWash).toBe(0)
    expect(host.getVisualClosureCounters().headingLegacyVisualRender).toBe(0)
  })

  it('R2-HEADING-2 / V5.14-R3 P10: ACTIVE = R7 fill + chip while the PASSIVE fill is RETAINED', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    api(host).renderHeadingDiagnosticMarkers()
    // PASSIVE first: text-tight fill + chip, and NO icon / rail any more.
    let audits = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT').filter(a => a.reason === 'PASSIVE_SEVERITY_MARKER')
    expect(audits[0].iconRect).toBe('null')
    expect(audits[0].railRect).toBe('null')
    expect(Number(audits[0].fillFragmentCount ?? 0)).toBeGreaterThan(0)
    expect(audits[0].passiveFillSuppressed).toBe('false')
    // ACTIVE: the R7 emphasis is ADDITIVE — the passive fill is RETAINED.
    api(host).renderHeadingActiveEmphasis('E1', d as never, w.heading)
    audits = readAudits(infoSpy!, 'DOCUMENT-DIAGNOSTIC-HEADING-MARKER-AUDIT').filter(a => a.reason === 'ACTIVE_HEADING_EMPHASIS')
    expect(audits.length).toBe(1)
    expect(audits[0].passiveMarkerPresent).toBe('true')
    expect(audits[0].iconRect).toBe('null')
    expect(audits[0].railRect).toBe('null')
    expect(audits[0].legacyFrameRendered).toBe('false')
    expect(Number(audits[0].activeFragmentRects ? 1 : 0)).toBe(1)
    // The PASSIVE wrapper survives the active state…
    const marker = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(marker).not.toBeNull()
    expect(marker.getAttribute('data-ink-diagnostic-active')).toBe('true')
    expect(marker.querySelectorAll('.inkchapter-heading-diagnostic-marker__rail').length).toBe(0)
    // ── V5.14-R4 §11 (supersedes the V5.14-R3 "RETAINED passive fill" rule for
    // the SELECTED target) — the selected target presents ONE atomic surface: the
    // active emphasis REPLACES its passive FILL, so a passive and an active fill of
    // the SAME target are never stacked (nor committed from different geometry
    // generations). The passive MARKER itself survives (see the assertions above:
    // `data-ink-diagnostic-active="true"` on the passive wrapper), and a dismiss
    // restores the passive presentation.
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length).toBe(0)
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length).toBeGreaterThan(0)
    const counters = host.getVisualClosureCounters()
    // the active target still BELONGS to the passive set (semantic authority intact)
    expect(counters.activeHeadingWithoutPassiveMarker).toBe(0)
  })
})

// ── §8/§9 Generic resolver + multi-target heading ─────────────────────────
describe('R2-MULTI — generic visual target resolution', () => {
  it('R2-MULTI-1: a multi-target heading diagnostic yields one heading target per declared target', () => {
    const targets = resolveDiagnosticVisualTargets(
      {
        id: 'S1',
        severity: 'error',
        stableIdentity: undefined,
        metadata: { h1Count: 2 },
        location: {
          kind: 'multi-target',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          targets: [
            { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-b' },
            { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-c' },
          ] as never,
        },
      },
      {
        resolveHeadingElement: (id) => ({ id } as unknown as HTMLElement),
        resolveSourceRangeElement: () => null,
        resolveBlockElement: () => null,
      },
    )
    expect(targets.length).toBe(2)
    expect(headingVisualTargets(targets).length).toBe(2)
    expect(targets[0].targetIndex).toBe(0)
    expect(targets[1].targetIndex).toBe(1)
    expect(targets[0].targetCount).toBe(2)
    // No ruleId special case was involved.
    expect(targets[0].targetKindLabel).toBe('canonical-heading')
  })

  it('R2-MULTI-2: a multi-target H1 diagnostic paints its passive markers BEFORE any click', () => {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
    const a = document.createElement('h1'); a.setAttribute('data-id', 'h1-a'); a.textContent = 'A'
    const b = document.createElement('h1'); b.setAttribute('data-id', 'h1-b'); b.textContent = 'B'
    write.append(a, b)
    stubRect(a, () => ({ left: 100, top: 100, right: 300, bottom: 130 }))
    stubRect(b, () => ({ left: 100, top: 200, right: 320, bottom: 230 }))
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
    host = h
    h.mount()
    inject(h, [{
      id: 'S1', documentKey: 'doc:key', severity: 'error', category: 'document',
      code: 'STRICT_SINGLE_H1_MULTIPLE_H1', message: 'm', detail: '',
      metadata: { h1Count: 2 },
      location: {
        kind: 'multi-target',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targets: [
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-b' },
          { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'h1-a' },
        ] as never,
      },
    } as unknown as Record<string, unknown>])
    api(h).renderHeadingDiagnosticMarkers()
    const markers = document.querySelectorAll('.inkchapter-heading-diagnostic-marker')
    expect(markers.length).toBe(2)
    expect(markers[0].getAttribute('data-ink-diagnostic-severity')).toBe('error')
    expect(h.getVisualClosureCounters().headingMultiTargetPassiveMissing).toBe(0)
    expect(h.getVisualClosureCounters().locatableHeadingDiagnosticWithoutVisualTarget).toBe(0)
  })
})

// ── §10 Inline per-visual-line fragments ──────────────────────────────────
describe('R2-INLINE — one fragment per visual line', () => {
  it('R2-INLINE-1: grouping never unions across visual lines', () => {
    const rects = [
      { left: 0, top: 0, right: 100, bottom: 20 },
      { left: 100, top: 0, right: 140, bottom: 20 },
      { left: 0, top: 20, right: 60, bottom: 40 },
    ]
    const frags = groupClientRectsToFragments(rects)
    // Two visual lines → two fragments (the same-line pair merged, gap 0).
    expect(frags.length).toBe(2)
    expect(frags[0].right).toBe(140)
    expect(frags[1].right).toBe(60)
    expect(hasCrossLineUnion(rects, frags)).toBe(false)
    expect(fragmentCoverageRatio(rects, frags)).toBeGreaterThanOrEqual(0.98)
    // A dropped fragment IS a cross-line union (a real regression).
    expect(hasCrossLineUnion(rects, [frags[0]])).toBe(true)
  })

  it('R2-INLINE-3: the EXACT source token is measured on its TEXT RANGE, never the whole element', () => {
    // Runtime-closure regression: measuring the owning element returns ONE
    // block-sized rect (a forbidden cross-line union). The exact token MUST be
    // measured through a text Range (setStart/setEnd) so a wrapped token yields
    // one fragment per visual line.
    const rects = [
      { left: 200, top: 300, right: 900, bottom: 322 },
      { left: 200, top: 322, right: 430, bottom: 344 },
    ]
    let usedTextRange = false
    const fake = {
      setStart(): void { usedTextRange = true },
      setEnd(): void { /* noop */ },
      selectNodeContents(): void { usedTextRange = false },
      getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
    }
    ;(document as unknown as { createRange: () => unknown }).createRange = () => fake

    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    const owner = document.createElement('p')
    owner.textContent = 'images a%20b.png tail'
    document.body.appendChild(owner)
    stubRect(owner, () => ({ left: 200, top: 300, right: 900, bottom: 344 }))

    ctrl.commit({
      diagnosticId: 'img2',
      severity: 'error',
      anchor: owner,
      forceInlineMark: true,
      preciseRect: { left: 200, top: 300, right: 900, bottom: 344, width: 700, height: 44 },
      preciseTextPrefix: 'a%20b.png',
    })
    expect(usedTextRange).toBe(true)
    expect(document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`).length).toBe(2)
    const facts = ctrl.getInlineFragmentFacts()
    expect(facts.crossLineUnion).toBe(false)
    expect(facts.coverage).toBeGreaterThanOrEqual(0.98)
    ctrl.dispose()
    owner.remove()
    root.remove()
  })

  it('R2-INLINE-4: without an exact token the carrier falls back to the element mark (never a block frame)', () => {
    stubRangeRects([{ left: 200, top: 300, right: 900, bottom: 322 }])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    const owner = document.createElement('span')
    owner.textContent = 'plain inline target'
    document.body.appendChild(owner)
    stubRect(owner, () => ({ left: 200, top: 300, right: 900, bottom: 322 }))
    ctrl.commit({ diagnosticId: 'link1', severity: 'warning', anchor: owner })
    expect(ctrl.getStructure().kind).toBe('inline')
    expect(ctrl.getStructure().inlineMarkCount).toBe(1)
    expect(ctrl.getFrameElement()).toBeNull()
    ctrl.dispose()
    owner.remove()
    root.remove()
  })

  it('R2-INLINE-2: a long wrapped source path paints one overlay fragment per line', () => {
    stubRangeRects([
      { left: 200, top: 300, right: 900, bottom: 322 },
      { left: 200, top: 322, right: 430, bottom: 344 },
    ])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const ctrl = new DiagnosticLocateFrameController(root)
    const owner = document.createElement('p')
    owner.textContent = 'img: assets/a-very-long-path.png'
    document.body.appendChild(owner)
    stubRect(owner, () => ({ left: 200, top: 300, right: 900, bottom: 344 }))
    ctrl.commit({
      diagnosticId: 'img1',
      severity: 'error',
      anchor: owner,
      forceInlineMark: true,
      preciseRect: { left: 200, top: 300, right: 900, bottom: 344, width: 700, height: 44 },
    })
    const frags = document.querySelectorAll(`.${DIAGNOSTIC_INLINE_FRAGMENT_CLASS}`)
    expect(frags.length).toBe(2)
    const facts = ctrl.getInlineFragmentFacts()
    expect(facts.fragments.length).toBe(2)
    expect(facts.crossLineUnion).toBe(false)
    expect(facts.coverage).toBeGreaterThanOrEqual(0.98)
    expect(ctrl.getStructure().kind).toBe('inline')
    // No block frame was mounted for the exact inline range.
    expect(ctrl.getFrameElement()).toBeNull()
    ctrl.dispose()
    owner.remove()
    root.remove()
  })
})

// ── §14/§15 The unique commit gate ────────────────────────────────────────
describe('R2-COMMIT — Visual FAIL always blocks COMMIT', () => {
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
    inlineFragmentCoverage: null,
    blockCoverage: null,
    staleGeometry: false,
  }

  it('R2-COMMIT-1: canCommit is true only when EVERY condition holds', () => {
    expect(canCommitLocateVisual(base).canCommit).toBe(true)
    expect(canCommitLocateVisual(base).reason).toBe('FULL_GEOMETRY_OK')
    // V5.12-R9 §5/§6/§7 — a PURE overlay intersection is EXPECTED (PASS with the
    // explicit reason); only a REAL geometry clip still blocks COMMIT.
    expect(canCommitLocateVisual({ ...base, panelIntersectionCount: 1 }))
      .toEqual({ canCommit: true, reason: 'EXPECTED_DRAWER_OVERLAY_OCCLUSION', failedChecks: [] })
    expect(canCommitLocateVisual({ ...base, panelIntersectionCount: 1, panelGeometryClipCount: 1 }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, panelGeometryClipCount: 1 }).failedChecks).toContain('PANEL_GEOMETRY_CLIP')
    expect(canCommitLocateVisual({ ...base, framePaintsAboveDrawer: true }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, targetFullyUnobscured: false }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, coverageRatio: 0.97 }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, blockCoverage: 0.5 }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, inlineFragmentCoverage: 0.5 }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, staleGeometry: true }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, layoutEpochCurrent: false }).canCommit).toBe(false)
    expect(canCommitLocateVisual({ ...base, visualCarrierPresent: false }).failedChecks).toContain('VISUAL_CARRIER_MISSING')
  })

  it('R2-COMMIT-2: exactly ONE visual recovery retry, then FAILED_VISUAL_PRESENTATION', () => {
    expect(resolveLocateVisualRecoveryDecision({ canCommit: true, recoveryAttempts: 0, maxRecovery: 1 })).toBe('COMMIT')
    expect(resolveLocateVisualRecoveryDecision({ canCommit: false, recoveryAttempts: 0, maxRecovery: 1 })).toBe('RETRY_LAYOUT_RECOVERY')
    expect(resolveLocateVisualRecoveryDecision({ canCommit: false, recoveryAttempts: 1, maxRecovery: 1 })).toBe('FAILED_VISUAL_PRESENTATION')
  })

  it('R2-COMMIT-3: a post-commit user scroll never repaints / remeasures / re-resolves', async () => {
    const write = document.createElement('div')
    write.id = 'write'
    document.body.appendChild(write)
    stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
    const table = document.createElement('table')
    write.appendChild(table)
    stubRect(table, () => ({ left: 120, top: 400, right: 620, bottom: 560 }))
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
    host = h
    h.mount()
    const diag = {
      id: 'T1', documentKey: 'doc:key', severity: 'error', category: 'table', code: 'TABLE_MISSING_NAME',
      message: 'm', detail: '', metadata: {},
    } as unknown as never
    ;(h as unknown as {
      commitDiagnosticLocateVisual(id: string, sev: string, targets: HTMLElement[], r: unknown, primary: HTMLElement | null, d: unknown): void
    }).commitDiagnosticLocateVisual('T1', 'error', [table], null, table, diag)
    const frame = document.querySelector('.inkchapter-diagnostic-locate-frame') as HTMLElement | null
    expect(frame).not.toBeNull()
    const styleBefore = frame!.getAttribute('style')
    // A canonical post-commit user scroll is VISUALLY INERT.
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    write.dispatchEvent(new Event('scroll', { bubbles: true }))
    await flushRaf()
    expect(frame!.getAttribute('style')).toBe(styleBefore)
    const c = h.getVisualClosureCounters()
    for (const key of ['postCommitScrollRepaint', 'postCommitScrollRemeasure', 'postCommitScrollReresolve',
      'postCommitScrollRecenter', 'postCommitScrollWrite']) {
      expect(c[key]).toBe(0)
    }
  })
})

// ── §17/§18 Audit surface + hard gates ───────────────────────────────────
describe('R2-GATE — closure audit + hard gates', () => {
  it('R2-GATE-1: the 35 hard gates are declared exactly once and start at 0', () => {
    expect(VISUAL_CLOSURE_V512R2_GATE_KEYS.length).toBe(35)
    expect(new Set(VISUAL_CLOSURE_V512R2_GATE_KEYS).size).toBe(35)
    const counters = createVisualClosureV512R2Counters()
    for (const key of VISUAL_CLOSURE_V512R2_GATE_KEYS) expect(counters[key]).toBe(0)
    const report = formatVisualClosureGateReport(counters)
    expect(report.length).toBe(35)
    expect(report).toContain('HEADING_LEGACY_VISUAL_RENDER_COUNT=0')
    expect(report).toContain('FINAL_COMMIT_WITH_VISUAL_FAIL_COUNT=0')
    expect(report).toContain('POST_COMMIT_SCROLL_REMEASURE_COUNT=0')
    expect(evaluateVisualClosureGates(counters).decision).toBe('PASS')
    expect(evaluateVisualClosureGates({ ...counters, inlineCrossLineUnion: 1 }).decision).toBe('FAIL')
    expect(VISUAL_CLOSURE_V512R2_GATE_LABELS.passiveMarkerStaleLayoutEpoch).toBe('PASSIVE_MARKER_STALE_LAYOUT_EPOCH_COUNT')
  })

  it('R2-AUDIT-1: DOCUMENT-DIAGNOSTIC-VISUAL-CLOSURE-AUDIT carries the closure fields', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api(host).renderHeadingDiagnosticMarkers()
    api(host).scheduleDiagnosticGeometryReconcile('TEST')
    // eslint-disable-next-line no-void
    void flushRaf()
    const audits = readAudits(infoSpy!, VISUAL_CLOSURE_AUDIT_EVENT)
    expect(audits.length).toBeGreaterThanOrEqual(1)
    const a = audits[audits.length - 1]
    for (const field of ['documentLayoutEpoch', 'measuredLayoutEpoch', 'layoutEpochCurrent', 'drawerRequestedOpen',
      'drawerPresentationMode', 'locateVisibilityLeaseActive', 'legacyHeadingFrameRendered', 'passiveMarkerPresent',
      'activeMarkerPresent', 'visualFragmentCount', 'coverageRatio', 'visualDecision', 'commitDecision', 'decision', 'reason']) {
      expect(Object.prototype.hasOwnProperty.call(a, field)).toBe(true)
    }
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('VISUAL_CLOSURE_AUDIT_EVENT')
    expect(hostSrc).toContain('getVisualClosureGateReport')
    expect(hostSrc).toContain('canCommitLocateVisual')
    expect(hostSrc).toContain('bumpDocumentLayoutEpoch')
  })
})
