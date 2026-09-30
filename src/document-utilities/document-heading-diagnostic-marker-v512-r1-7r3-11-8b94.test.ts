// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.25 — Heading Diagnostic In-Document Marker V5.12-R1.
 *
 * Level 1 Passive severity marker (gutter icon + rail, NEVER a wash)
 * Level 2 Active text-tight emphasis (fragments + keyline)
 * Level 3 Active reason chip (overlay only)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  HEADING_ACTIVE_FILL_ALPHA,
  HEADING_MARKER_AUDIT_EVENT,
  HEADING_MARKER_ICON_RAIL_GAP_PX,
  HEADING_MARKER_ICON_SIZE_PX,
  HEADING_MARKER_MIN_TEXT_GAP_PX,
  HEADING_MARKER_PREFERRED_TEXT_GAP_PX,
  HEADING_MARKER_RAIL_WIDTH_PX,
  HEADING_MARKER_V512R1_GATE_KEYS,
  buildHeadingLocateReason,
  computeHeadingMarkerGeometry,
  computeHeadingReasonChipPlacement,
  createHeadingMarkerV512R1GateCounters,
  headingLevelLabel,
  headingMarkerIdentity,
  makeHeadingRect,
  mergeHeadingMarkerSeverity,
  severityRank,
  unionHeadingNumberAndTextRects,
} from './document-heading-diagnostic-marker-v5-12'

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
/** jsdom Range returns [] — stub per-line text fragments. */
function stubRangeRects(rects: Rect[]): void {
  const fake = {
    setStart(): void { /* noop */ },
    setEnd(): void { /* noop */ },
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
  // The heading BLOCK is 900 wide; the visible text is only 220 wide.
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
  authority.recompute = () => { /* frozen for the heading marker test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
function headingDiag(id: string, code: string, severity: string, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, documentKey: 'doc:key', severity, category: 'heading', code, message: 'm', detail: '',
    stableIdentity: 'H-A', metadata, location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H-A' },
  } as unknown as Record<string, unknown>
}
type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  renderHeadingActiveEmphasis(id: string, diag: unknown, el: HTMLElement): void
  getHeadingMarkerSnapshot(): {
    passiveCount: number
    passiveSeverities: Record<string, string>
    activeIdentity: string | null
    activeFragmentCount: number
    reasonText: string | null
    markerRight: number | null
    contentLeft: number | null
    textGap: number | null
  } | null
  getHeadingMarkerCounters(): Record<string, number>
}
function headingHost(): HostApi {
  return host as unknown as HostApi
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

// ── V512R1-1 / 2 / 4 ───────────────────────────────────────────────────────
describe('V512R1-1/2/4 — passive gutter marker never touches the glyphs', () => {
  it('V512R1-1: Error marker keeps >= 4px to the heading content', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    headingHost().renderHeadingDiagnosticMarkers()
    const snap = headingHost().getHeadingMarkerSnapshot()!
    expect(snap.passiveCount).toBe(1)
    expect(snap.passiveSeverities['id:H-A']).toBe('error')
    const audits = readAudits(infoSpy!, HEADING_MARKER_AUDIT_EVENT).filter(a => a.reason === 'PASSIVE_SEVERITY_MARKER')
    expect(audits.length).toBe(1)
    expect(Number(audits[0].markerTextGap)).toBeGreaterThanOrEqual(HEADING_MARKER_MIN_TEXT_GAP_PX)
    expect(audits[0].fullWidthWash).toBe('false')
    expect(Number(audits[0].railRect ? 0 : 1)).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingMarkerTextOverlap).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingPassiveFullWidthWash).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingPassiveBackgroundMutation).toBe(0)
  })

  it('V512R1-2: Warning marker behaves identically (rail + icon, no wash)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('W1', 'HEADING_LEVEL_GAP', 'warning', { previousLevel: 2, currentLevel: 4, missingLevels: [3] })])
    headingHost().renderHeadingDiagnosticMarkers()
    const snap = headingHost().getHeadingMarkerSnapshot()!
    expect(snap.passiveSeverities['id:H-A']).toBe('warning')
    const wrapper = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(wrapper.getAttribute('data-ink-diagnostic-severity')).toBe('warning')
    // Passive carries NO background/width on the wrapper (no wash).
    expect(wrapper.style.background).toBe('')
    expect(wrapper.style.width).toBe('0px')
    expect(headingHost().getHeadingMarkerCounters().headingPassiveFullWidthWash).toBe(0)
  })
})

// ── V512R1-3 ───────────────────────────────────────────────────────────────
describe('V512R1-3 — Error / Warning differ by shape, not only colour', () => {
  it('V512R1-3 / V5.12-R9 §10: error vs warning differ by severity FILL + CHIP — the shape icons are gone', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    // V5.12-R9 §10/§19 — the standalone circle icon + the rails were REMOVED at
    // the source (no DOM is created and no CSS remains): a shape icon must NOT
    // exist, so error vs warning can no longer differ by icon shape.
    expect(css).not.toContain('.inkchapter-heading-diagnostic-marker__icon')
    expect(css).not.toContain('.inkchapter-heading-diagnostic-marker__rail')
    // The severity semantics now live in the text-tight soft fill + the chip.
    expect(css).toContain(".inkchapter-heading-diagnostic-marker[data-ink-diagnostic-severity='error']")
    expect(css).toContain(".inkchapter-heading-diagnostic-marker[data-ink-diagnostic-severity='warning']")
    expect(css).toContain('.inkchapter-heading-diagnostic-passive__fragment')
    expect(css).toContain('--ink-heading-sev-soft')
    // V5.12-R7 §9 — the ACTIVE heading keyline (solid/dashed underline) is GONE:
    // the active emphasis is the fill-only `__fragment`.
    expect(css).not.toContain('__keyline')
    expect(css).toContain('.inkchapter-heading-diagnostic-active__fragment')
  })
})

// ── V512R1-5 / 6 / 7 ───────────────────────────────────────────────────────
describe('V512R1-5/6/7 — active emphasis is text-tight (fragments, numbering, multiline)', () => {
  it('V512R1-5: active fill uses the CONTENT width (220), never the block width (900)', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingDiagnosticMarkers()
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    const snap = headingHost().getHeadingMarkerSnapshot()!
    expect(snap.activeFragmentCount).toBe(1)
    expect(snap.contentLeft).toBe(200)
    const frag = document.querySelector('.inkchapter-heading-diagnostic-active__fragment') as HTMLElement
    expect(Number.parseFloat(frag.style.width)).toBe(220)
    expect(Number.parseFloat(frag.style.width)).not.toBe(900)
    expect(headingHost().getHeadingMarkerCounters().headingActiveUsesFullBlockRect).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingActiveFullWidthWash).toBe(0)
  })

  it('V512R1-6: the墨章 numbering rect joins the active content rect', () => {
    const w = makeWorld()
    host = w.h
    w.heading.setAttribute('data-inkchapter-heading-number', '1.1')
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingDiagnosticMarkers()
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    const audits = readAudits(infoSpy!, HEADING_MARKER_AUDIT_EVENT).filter(a => a.reason === 'ACTIVE_HEADING_EMPHASIS')
    expect(audits.length).toBe(1)
    expect(audits[0].numberRectIncluded).toBe('true')
    // The first fragment starts at the heading block left (100), i.e. the number.
    const frag = document.querySelector('.inkchapter-heading-diagnostic-active__fragment') as HTMLElement
    expect(Number.parseFloat(frag.style.left)).toBe(100)
    expect(headingHost().getHeadingMarkerCounters().headingNumberingExcludedFromActiveContent).toBe(0)
  })

  it('V512R1-7: a 2-line heading paints 2 fragments, never one union wash', () => {
    stubRangeRects([
      { left: 200, top: 204, right: 420, bottom: 228 },
      { left: 200, top: 234, right: 360, bottom: 258 },
    ])
    const w = makeWorld()
    host = w.h
    stubRect(w.heading, () => ({ left: 100, top: 200, right: 1000, bottom: 262 }))
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    const frags = document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment')
    expect(frags.length).toBe(2)
    const tops = Array.from(frags).map(f => Number.parseFloat((f as HTMLElement).style.top))
    expect(tops[1]).toBeGreaterThan(tops[0])
    expect(headingHost().getHeadingMarkerCounters().headingMultilineUnionWash).toBe(0)
  })
})

// ── V512R1-8 ───────────────────────────────────────────────────────────────
describe('V512R1-8 — the reason chip is short and overlay-only', () => {
  it('V512R1-8: H4 → H6 produces "H4 → H6 · 缺 H5" without reflowing the heading', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    const chip = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.textContent).toBe('H4 → H6 · 缺 H5')
    expect(chip.getAttribute('title')).toBe('H4 → H6 · 缺 H5')
    // The chip lives in the document layer, NOT inside the heading.
    expect(w.heading.querySelector('.inkchapter-heading-diagnostic-reason')).toBeNull()
    expect(headingHost().getHeadingMarkerCounters().headingReasonChipReflow).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingReasonChipTextOverlap).toBe(0)
  })
})

// ── V512R1-9 / 10 ──────────────────────────────────────────────────────────
describe('V512R1-9/10 — dismiss keeps passive; multiple diagnostics merge', () => {
  it('V512R1-9: left-click cancels ACTIVE only, the PASSIVE marker survives', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingDiagnosticMarkers()
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    expect(document.querySelector('.inkchapter-heading-diagnostic-active')).not.toBeNull()

    ;(host as unknown as { dismissLocateVisualFromDocumentPointer: (ev: PointerEvent) => void })
      .dismissLocateVisualFromDocumentPointer(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    expect(document.querySelector('.inkchapter-heading-diagnostic-active')).toBeNull()
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(1)
    expect(headingHost().getHeadingMarkerSnapshot()!.passiveCount).toBe(1)
    expect(headingHost().getHeadingMarkerCounters().headingDismissRemovesPassiveDiagnostic).toBe(0)
  })

  it('V512R1-10: two diagnostics on ONE heading → one marker with the highest severity', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [
      headingDiag('W1', 'HEADING_LEVEL_GAP', 'warning', { previousLevel: 2, currentLevel: 4, missingLevels: [3] }),
      headingDiag('E2', 'STRICT_SINGLE_H1_MULTIPLE_H1', 'error', { h1Count: 2, reason: 'MULTIPLE_H1' }),
    ])
    headingHost().renderHeadingDiagnosticMarkers()
    const markers = document.querySelectorAll('.inkchapter-heading-diagnostic-marker')
    expect(markers.length).toBe(1)
    expect(markers[0].getAttribute('data-ink-diagnostic-severity')).toBe('error')
    // V5.12-R9 §10 — one marker, and NO gutter rail/icon child any more.
    expect(markers[0].querySelectorAll('.inkchapter-heading-diagnostic-marker__rail').length).toBe(0)
    expect(markers[0].querySelectorAll('.inkchapter-heading-diagnostic-marker__icon').length).toBe(0)
    expect(markers[0].querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length).toBeGreaterThan(0)
    expect(headingHost().getHeadingMarkerCounters().multipleHeadingMarkerOverlap).toBe(0)
    // The active reason shows the CURRENTLY clicked diagnostic.
    headingHost().renderHeadingActiveEmphasis('W1', headingDiag('W1', 'HEADING_LEVEL_GAP', 'warning', { previousLevel: 2, currentLevel: 4, missingLevels: [3] }) as never, w.heading)
    expect((document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement).textContent).toBe('H2 → H4 · 缺 H3')
  })
})

// ── V512R1-11 / 12 ─────────────────────────────────────────────────────────
describe('V512R1-11/12 — document-space inertness + same-target reflow', () => {
  it('V512R1-11: a user scroll never repaints / remeasures / re-resolves the marker', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingDiagnosticMarkers()
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    const markerBefore = (document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement).innerHTML
    const fragBefore = (document.querySelector('.inkchapter-heading-diagnostic-active__fragment') as HTMLElement).getAttribute('style')

    const render = vi.spyOn(host as unknown as { renderHeadingDiagnosticMarkers: () => void }, 'renderHeadingDiagnosticMarkers')
    const active = vi.spyOn(host as unknown as { renderHeadingActiveEmphasis: () => void }, 'renderHeadingActiveEmphasis')
    // A canonical user scroll (no locate transaction, no lease).
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    w.write.dispatchEvent(new Event('scroll', { bubbles: true }))
    void flushRaf()

    expect(render.mock.calls.length).toBe(0)
    expect(active.mock.calls.length).toBe(0)
    expect((document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement).innerHTML).toBe(markerBefore)
    expect((document.querySelector('.inkchapter-heading-diagnostic-active__fragment') as HTMLElement).getAttribute('style')).toBe(fragBefore)
    expect(headingHost().getHeadingMarkerCounters().headingPostCommitScrollRepaint).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingPostCommitScrollRemeasure).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingPostCommitScrollReresolve).toBe(0)
    expect(headingHost().getHeadingMarkerCounters().headingScrollGeometryDrift).toBe(0)
    render.mockRestore(); active.mockRestore()
  })

  it('V512R1-12: a real width reflow re-derives the SAME heading fragments once', () => {
    const w = makeWorld()
    host = w.h
    const d = headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })
    inject(host, [d])
    headingHost().renderHeadingDiagnosticMarkers()
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length).toBe(1)

    // The heading really re-wraps into two lines.
    stubRangeRects([
      { left: 200, top: 204, right: 420, bottom: 228 },
      { left: 200, top: 234, right: 300, bottom: 258 },
    ])
    stubRect(w.heading, () => ({ left: 100, top: 200, right: 1000, bottom: 262 }))
    window.dispatchEvent(new Event('resize'))
    // Same-target reconcile: the SAME heading identity is re-emphasised.
    headingHost().renderHeadingActiveEmphasis('E1', d as never, w.heading)

    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length).toBe(2)
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(1)
    expect(headingHost().getHeadingMarkerSnapshot()!.activeIdentity).toBe('E1')
  })
})

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V512R1-CONTRACT — pure marker surface', () => {
  it('V512R1-CONTRACT-1: the 15 hard gates are declared exactly once', () => {
    expect(HEADING_MARKER_V512R1_GATE_KEYS.length).toBe(15)
    expect(new Set(HEADING_MARKER_V512R1_GATE_KEYS).size).toBe(15)
    for (const key of [
      'headingMarkerTextOverlap', 'headingPassiveFullWidthWash', 'headingPassiveBackgroundMutation',
      'headingActiveUsesFullBlockRect', 'headingActiveFullWidthWash', 'headingNumberingExcludedFromActiveContent',
      'headingMultilineUnionWash', 'multipleHeadingMarkerOverlap', 'headingReasonChipReflow',
      'headingReasonChipTextOverlap', 'headingPostCommitScrollRepaint', 'headingPostCommitScrollRemeasure',
      'headingPostCommitScrollReresolve', 'headingScrollGeometryDrift', 'headingDismissRemovesPassiveDiagnostic',
    ] as const) expect(HEADING_MARKER_V512R1_GATE_KEYS).toContain(key)
    expect(createHeadingMarkerV512R1GateCounters().headingMarkerTextOverlap).toBe(0)
  })

  it('V512R1-CONTRACT-2: gutter geometry never overlaps the content', () => {
    const anchor = makeHeadingRect({ left: 100, top: 200, right: 1000, bottom: 232 })
    const content = makeHeadingRect({ left: 200, top: 204, right: 420, bottom: 228 })
    const geo = computeHeadingMarkerGeometry({ anchorRect: anchor, contentRect: content, editorLeft: 0, firstLineHeight: 24 })
    expect(geo.markerRight).toBeLessThanOrEqual(content.left - HEADING_MARKER_MIN_TEXT_GAP_PX)
    expect(geo.textGap).toBeGreaterThanOrEqual(HEADING_MARKER_MIN_TEXT_GAP_PX)
    expect(geo.railRect.width).toBe(HEADING_MARKER_RAIL_WIDTH_PX)
    expect(geo.iconRect).not.toBeNull()
    expect(geo.iconRect!.right).toBeLessThanOrEqual(geo.railRect.left)
    // Near the editor's left edge: shorten the icon gap, then keep only the rail.
    const tight = computeHeadingMarkerGeometry({ anchorRect: anchor, contentRect: makeHeadingRect({ left: 12, top: 204, right: 232, bottom: 228 }), editorLeft: 0, firstLineHeight: 24 })
    expect(tight.markerRight).toBeLessThanOrEqual(12 - HEADING_MARKER_MIN_TEXT_GAP_PX)
    const tighter = computeHeadingMarkerGeometry({ anchorRect: anchor, contentRect: makeHeadingRect({ left: 6, top: 204, right: 226, bottom: 228 }), editorLeft: 0, firstLineHeight: 24 })
    expect(tighter.markerRight).toBeLessThanOrEqual(6 - HEADING_MARKER_MIN_TEXT_GAP_PX)
    if (tighter.iconRect == null) expect(tighter.railOnlyFallback).toBe(true)
  })

  it('V512R1-CONTRACT-3: numbering union + reason chip placement', () => {
    const number = makeHeadingRect({ left: 100, top: 204, right: 170, bottom: 228 })
    const text = makeHeadingRect({ left: 178, top: 204, right: 420, bottom: 228 })
    const union = unionHeadingNumberAndTextRects(number, [text])!
    expect(union.left).toBe(100)
    expect(union.right).toBe(420)
    expect(unionHeadingNumberAndTextRects(null, [])).toBeNull()

    const right = computeHeadingReasonChipPlacement({ contentRects: [text], chipWidth: 120, chipHeight: 20, editorLeft: 0, editorRight: 1200, drawerLeft: null })!
    expect(right.placement).toBe('RIGHT_OF_LAST_LINE')
    expect(right.rect.left).toBe(428)
    const below = computeHeadingReasonChipPlacement({ contentRects: [text], chipWidth: 600, chipHeight: 20, editorLeft: 0, editorRight: 700, drawerLeft: null })!
    expect(below.placement).toBe('BELOW_LAST_LINE')
    expect(below.rect.top).toBeGreaterThan(text.bottom)
    expect(computeHeadingReasonChipPlacement({ contentRects: [], chipWidth: 10, chipHeight: 10, editorLeft: 0, editorRight: 10, drawerLeft: null })).toBeNull()
  })

  it('V512R1-CONTRACT-4: reason builder + severity merge + identity', () => {
    // ── V5.14-R5 §4/§5/§17 — the inline chip is GENERATED from the DiagnosticCode
    // (never a slice of the long message); an unmapped code yields a short CATEGORY
    // label instead of the truncated severity sentence.
    expect(buildHeadingLocateReason({ code: 'HEADING_LEVEL_GAP', metadata: { previousLevel: 4, currentLevel: 6, missingLevels: [5] } })).toBe('H4 → H6 · 缺 H5')
    expect(buildHeadingLocateReason({ code: 'HEADING_LEVEL_GAP', metadata: { previousLevel: 1, currentLevel: 3, missingLevels: [2] } })).toBe('H1 → H3 · 缺 H2')
    expect(buildHeadingLocateReason({ code: 'STRICT_SINGLE_H1_MULTIPLE_H1', metadata: { h1Count: 2, reason: 'MULTIPLE_H1' } })).toBe('多余 H1')
    expect(buildHeadingLocateReason({ code: 'X', metadata: { reason: 'H1_NOT_FIRST' } })).toBe('H1 非首项')
    // V5.14-R5 §21 — an unknown code never leaks a long / severity-bearing message.
    const unknown = buildHeadingLocateReason({ code: 'UNKNOWN', message: 'A'.repeat(40), metadata: {} })!
    expect(unknown.length).toBeLessThanOrEqual(10)
    expect(unknown).toBe('文档问题')
    expect(buildHeadingLocateReason({ code: 'UNKNOWN', message: '', metadata: {} })).toBe('文档问题')

    expect(severityRank('error')).toBeGreaterThan(severityRank('warning'))
    expect(mergeHeadingMarkerSeverity(['warning', 'error', 'info'])).toBe('error')
    expect(mergeHeadingMarkerSeverity(['warning', 'info'])).toBe('warning')
    expect(mergeHeadingMarkerSeverity([])).toBeNull()
    // §16 — level and severity are independent.
    expect(headingLevelLabel(6)).toBe('H6')
    expect(headingLevelLabel(0)).toBeNull()
    expect(headingMarkerIdentity({ stableIdentity: 'S', line: 3, text: 't' })).toBe('id:S')
    expect(headingMarkerIdentity({ stableIdentity: null, line: 3, text: 't' })).toBe('line:3')
  })

  it('V512R1-CONTRACT-5: production source keeps the heading marker document-space', () => {
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('renderHeadingDiagnosticMarkers')
    expect(hostSrc).toContain('renderHeadingActiveEmphasis')
    expect(hostSrc).toContain('clearHeadingActiveEmphasis')
    expect(hostSrc).toContain('HEADING_MARKER_AUDIT_EVENT')
    expect(hostSrc).toContain('ensureHeadingMarkerLayer')
    // The passive marker layer is mounted inside the DOCUMENT-SPACE layer.
    const ensure = hostSrc.indexOf('private ensureHeadingMarkerLayer')
    const docLayer = hostSrc.indexOf('this.ensureLocateDocumentLayer()', ensure)
    expect(docLayer).toBeGreaterThan(ensure)
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(css).toContain('.inkchapter-heading-diagnostic-marker')
    expect(css).toContain('.inkchapter-heading-diagnostic-active__fragment')
    expect(css).toContain('.inkchapter-heading-diagnostic-reason')
    expect(css).toContain('data-ink-diagnostic-severity')
  })
})
