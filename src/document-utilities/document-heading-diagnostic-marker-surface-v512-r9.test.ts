// @vitest-environment jsdom
/**
 * V5.12-R9 — Heading Diagnostic Marker Surface (targeted tests §20).
 *
 * HEADING_DIAGNOSTIC_MARKER = SOFT_TEXT_SURFACE + REASON_CHIP
 *
 * The standalone severity circle, the long vertical rail, the horizontal rail,
 * the L corner arm, the outline and the editor shadow are GONE (no DOM, no CSS).
 * What remains is a text-tight soft severity fill (one carrier per visible line)
 * plus a compact reason chip — and the two are mutually exclusive with the R7
 * ACTIVE fill (never a stacked double fill).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  HEADING_CHIP_CENTER_TOLERANCE_PX,
  HEADING_CHIP_GAP_MAX_PX,
  HEADING_CHIP_GAP_MIN_PX,
  HEADING_CHIP_HEIGHT_MAX_PX,
  HEADING_MARKER_SURFACE_V512R9_GATE_LABELS,
  HEADING_MARKER_SURFACE_V512R9_GATE_KEYS,
} from './document-heading-diagnostic-marker-surface-v512-r9'

let rafTasks = new Map<number, FrameRequestCallback>()
let rafSeq = 1
function stubRaf(): void {
  rafTasks = new Map()
  rafSeq = 1
  const raf = (cb: FrameRequestCallback): number => { const id = rafSeq++; rafTasks.set(id, cb); return id }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = raf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { rafTasks.delete(id) }
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

interface World { h: DocumentUtilityOverlayHost; write: HTMLElement; heading: HTMLElement }
function makeWorld(tag = 'h1'): World {
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)
  stubRect(write, () => ({ left: 0, top: 0, right: 900, bottom: 3000 }))
  const heading = document.createElement(tag)
  heading.setAttribute('data-id', 'H-A')
  heading.setAttribute('data-line', '4')
  heading.textContent = '乙'
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
  dismissLocateVisualFromDocumentPointer(ev: PointerEvent): void
  getHeadingMarkerSnapshot(): { passiveCount: number } | null
  getHeadingMarkerSurfaceV512R9GateReport(): string[]
  getHeadingMarkerSurfaceV512R9GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getHeadingMarkerSurfaceCounters(): Record<string, number>
}
function api(): HostApi {
  return host as unknown as HostApi
}
const passiveFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-passive__fragment').length
const activeFragmentCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-active__fragment').length
const chipCount = (): number => document.querySelectorAll('.inkchapter-heading-diagnostic-reason').length

let infoSpy: InfoSpy | null = null
let host: DocumentUtilityOverlayHost | null = null

const multiH1 = () => headingDiag('E1', 'STRICT_SINGLE_H1_MULTIPLE_H1', 'error', { h1Count: 2, reason: 'MULTIPLE_H1' })
const gapWarning = () => headingDiag('W1', 'HEADING_LEVEL_GAP', 'warning', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })

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

// ── R9-HEADING-01 — Multi H1 Passive ───────────────────────────────────────
describe('R9-HEADING-01 — Multi H1 Passive (Conditional-Strict-Multi-H1 fixture shape)', () => {
  it('left icon absent, vertical rail absent, reason chip present, soft text fill present, no full-width fill', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [multiH1()])
    api().renderHeadingDiagnosticMarkers()
    const wrapper = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(wrapper).not.toBeNull()
    // never CREATED (not merely hidden).
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__icon')).toBeNull()
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__rail')).toBeNull()
    expect(document.querySelector('[class*="hline"]')).toBeNull()
    expect(document.querySelector('[class*="corner-arm"]')).toBeNull()
    // reason chip + soft text-tight fill.
    expect(chipCount()).toBe(1)
    expect((document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement).textContent).toBe('多余 H1')
    expect(passiveFragmentCount()).toBe(1)
    const frag = document.querySelector('.inkchapter-heading-diagnostic-passive__fragment') as HTMLElement
    expect(Number.parseFloat(frag.style.width)).toBe(220) // text width, NOT the 900 block
    const c = api().getHeadingMarkerSurfaceCounters()
    expect(c.leftIcon).toBe(0)
    expect(c.verticalRail).toBe(0)
    expect(c.fullWidthFill).toBe(0)
    expect(c.outline).toBe(0)
    expect(c.editorShadow).toBe(0)
  })
})

// ── R9-HEADING-02 — Multi H1 Active ────────────────────────────────────────
describe('R9-HEADING-02 — Multi H1 Active', () => {
  it('R7 active fill present, passive fill REPLACED by the active presentation (V5.14-R4 §11), reason chip remains', () => {
    const w = makeWorld()
    host = w.h
    const d = multiH1()
    inject(host, [d])
    api().renderHeadingDiagnosticMarkers()
    expect(passiveFragmentCount()).toBe(1)
    api().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    expect(activeFragmentCount()).toBe(1)
    // ── V5.14-R4 §11 (supersedes the V5.14-R3 "ADDITIVE passive fill" rule for the
    // SELECTED target) — the selected target presents ONE atomic surface: the active
    // emphasis REPLACES its passive FILL so a passive and an active fill of the same
    // target can never be stacked (or committed from different geometry
    // generations). The passive MARKER / semantic key set / chip stay intact and a
    // dismiss restores the passive presentation.
    expect(passiveFragmentCount()).toBe(0)
    expect(chipCount()).toBe(1)
    expect(api().getHeadingMarkerSurfaceCounters().activePassiveFillStack).toBe(0)
    // the passive MARKER (semantic key) survives the selection
    expect(api().getHeadingMarkerSnapshot()!.passiveCount).toBe(1)
  })
})

// ── R9-HEADING-03 — Heading Gap Warning ────────────────────────────────────
describe('R9-HEADING-03 — Heading Gap (warning severity)', () => {
  it('warning amber semantic, no icon / rail, correct chip text', () => {
    const w = makeWorld('h6')
    host = w.h
    inject(host, [gapWarning()])
    api().renderHeadingDiagnosticMarkers()
    const wrapper = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(wrapper.getAttribute('data-ink-diagnostic-severity')).toBe('warning')
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__icon')).toBeNull()
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__rail')).toBeNull()
    expect((document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement).textContent).toBe('H4 → H6 · 缺 H5')
    // the amber soft fill + a light pill are the SCSS severity semantics.
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(css).toMatch(/--ink-heading-sev-soft:\s*color-mix\(in srgb, var\(--ink-heading-sev\) 10%, transparent\)/)
    expect(css).toContain('box-shadow: none')
  })
})

// ── R9-HEADING-04 — Duplicate Heading ──────────────────────────────────────
describe('R9-HEADING-04 — Duplicate Heading', () => {
  it('a duplicate-text heading gets the SAME soft fill + "重复标题" chip (V5.14-R5 §4)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [headingDiag('D1', 'HEADING_DUPLICATE_TEXT', 'error', { text: '乙' })])
    api().renderHeadingDiagnosticMarkers()
    const wrapper = document.querySelector('.inkchapter-heading-diagnostic-marker') as HTMLElement
    expect(wrapper.getAttribute('data-ink-diagnostic-severity')).toBe('error')
    expect(passiveFragmentCount()).toBe(1)
    expect((document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement).textContent).toBe('重复标题')
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__icon')).toBeNull()
    expect(wrapper.querySelector('.inkchapter-heading-diagnostic-marker__rail')).toBeNull()
  })
})

// ── R9-HEADING-05 — Long Heading ───────────────────────────────────────────
describe('R9-HEADING-05 — Long / multi-line heading', () => {
  it('never paints a full-width band; one carrier per line and the chip clears the text', () => {
    stubRangeRects([
      { left: 200, top: 204, right: 1080, bottom: 228 },
      { left: 200, top: 234, right: 1080, bottom: 258 },
    ])
    const w = makeWorld('h2')
    host = w.h
    stubRect(w.heading, () => ({ left: 100, top: 200, right: 1200, bottom: 262 }))
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api().renderHeadingDiagnosticMarkers()
    const frags = Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-heading-diagnostic-passive__fragment'))
    expect(frags.length).toBe(2)
    for (const f of frags) expect(Number.parseFloat(f.style.width)).toBe(880) // text, not the block band
    expect(document.querySelector('[class*="full-width"]')).toBeNull()
    // the chip is placed clear of the last line (right of it, else below it —
    // never over the body text and never as a full-width band).
    const chip = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement
    const chipLeft = Number.parseFloat(chip.style.left)
    const chipTop = Number.parseFloat(chip.style.top)
    expect(chipLeft >= 1080 + HEADING_CHIP_GAP_MIN_PX || chipTop >= 258 + HEADING_CHIP_GAP_MIN_PX - 1).toBe(true)
    expect(api().getHeadingMarkerSurfaceCounters().fullWidthFill).toBe(0)
    expect(api().getHeadingMarkerSurfaceCounters().chipGapLt4px).toBe(0)
    expect(api().getHeadingMarkerSurfaceCounters().chipGapGt12px).toBe(0)
  })
})

// ── R9-HEADING-06 — Numbering ──────────────────────────────────────────────
describe('R9-HEADING-06 — Heading Numbering stays stable', () => {
  it('the numbering attribute is untouched and the marker geometry stays text-tight', () => {
    const w = makeWorld('h2')
    host = w.h
    w.heading.setAttribute('data-inkchapter-heading-number', '1.1')
    const numberBefore = w.heading.getAttribute('data-inkchapter-heading-number')
    inject(host, [headingDiag('E1', 'HEADING_LEVEL_GAP', 'error', { previousLevel: 4, currentLevel: 6, missingLevels: [5] })])
    api().renderHeadingDiagnosticMarkers()
    expect(w.heading.getAttribute('data-inkchapter-heading-number')).toBe(numberBefore)
    expect(passiveFragmentCount()).toBeGreaterThan(0)
    expect(chipCount()).toBe(1)
    const c = api().getHeadingMarkerSurfaceCounters()
    expect(c.lineHeightMutation).toBe(0)
    expect(c.blockHeightDriftGt2px).toBe(0)
  })
})

// ── R9-HEADING-07 — Editing ────────────────────────────────────────────────
describe('R9-HEADING-07 — Editing / caret', () => {
  it('the marker is overlay-only (never inside the heading) and refreshes with diagnostics', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [multiH1()])
    api().renderHeadingDiagnosticMarkers()
    // the accessory lives in the marker layer, never inside the editable heading.
    expect(w.heading.querySelector('.inkchapter-heading-diagnostic-marker')).toBeNull()
    expect(w.heading.querySelector('.inkchapter-heading-diagnostic-reason')).toBeNull()
    // a diagnostics refresh re-renders exactly one marker (no duplicate accumulation).
    api().renderHeadingDiagnosticMarkers()
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(1)
    expect(passiveFragmentCount()).toBe(1)
    expect(chipCount()).toBe(1)
    // The chip / carrier are pointer-events:none, so the caret cannot be stolen.
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    const chipBlock = css.slice(css.indexOf('.inkchapter-heading-diagnostic-reason {'))
    expect(chipBlock.slice(0, chipBlock.indexOf('}'))).toContain('pointer-events: none')
  })
})

// ── R9-HEADING-08 — Dismiss Active ─────────────────────────────────────────
describe('R9-HEADING-08 — Dismiss Active', () => {
  it('left-click on the body removes the R7 active fill and keeps the passive marker', () => {
    const w = makeWorld()
    host = w.h
    const d = multiH1()
    inject(host, [d])
    api().renderHeadingDiagnosticMarkers()
    api().renderHeadingActiveEmphasis('E1', d as never, w.heading)
    expect(activeFragmentCount()).toBe(1)
    api().dismissLocateVisualFromDocumentPointer(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    expect(activeFragmentCount()).toBe(0)
    // the passive marker survives (the diagnostic still exists).
    expect(document.querySelectorAll('.inkchapter-heading-diagnostic-marker').length).toBe(1)
    expect(api().getHeadingMarkerSnapshot()!.passiveCount).toBe(1)
  })
})

// ── R9-HEADING-09/10 — the full gate report + scope discipline ─────────────
describe('R9-HEADING-09 — the R9 gate report exposes all 15 hard gates at 0', () => {
  it('every label is present and every counter is exactly 0 on a clean surface', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [multiH1()])
    api().renderHeadingDiagnosticMarkers()
    const report = api().getHeadingMarkerSurfaceV512R9GateReport()
    expect(report.length).toBe(HEADING_MARKER_SURFACE_V512R9_GATE_KEYS.length)
    for (const key of HEADING_MARKER_SURFACE_V512R9_GATE_KEYS) {
      expect(report).toContain(`${HEADING_MARKER_SURFACE_V512R9_GATE_LABELS[key]}=0`)
    }
    const decision = api().getHeadingMarkerSurfaceV512R9GateDecision()
    expect(decision.decision).toBe('PASS')
    expect(decision.failedChecks.length).toBe(0)
  })

  it('the chip gap / center are inside their bands and the chip is vertically centred', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [multiH1()])
    api().renderHeadingDiagnosticMarkers()
    const chip = document.querySelector('.inkchapter-heading-diagnostic-reason') as HTMLElement
    const gap = Number.parseFloat(chip.style.left) - 420
    expect(gap).toBeGreaterThanOrEqual(HEADING_CHIP_GAP_MIN_PX)
    expect(gap).toBeLessThanOrEqual(HEADING_CHIP_GAP_MAX_PX)
    // centred on the text line (204..228 → centre 216; chip height 20 → top 206).
    const drift = Math.abs((Number.parseFloat(chip.style.top) + HEADING_CHIP_HEIGHT_MAX_PX / 2) - 216)
    expect(drift).toBeLessThanOrEqual(HEADING_CHIP_CENTER_TOLERANCE_PX)
    const c = api().getHeadingMarkerSurfaceCounters()
    expect(c.chipGapLt4px).toBe(0)
    expect(c.chipGapGt12px).toBe(0)
    expect(c.chipCenterDriftGt2px).toBe(0)
  })
})

describe('R9-HEADING-10 — scope discipline (no global heading pollution, Drawer frozen)', () => {
  it('style.scss has no bare heading selector; every marker rule is scoped', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(css).not.toMatch(/^\s*h[1-6]\s*[,{]/m)
    expect(css).not.toContain('.inkchapter-heading-diagnostic-marker__icon')
    expect(css).not.toContain('.inkchapter-heading-diagnostic-marker__rail')
    for (const line of css.split('\n')) {
      if (line.includes('.inkchapter-heading-diagnostic')) expect(line.trim().startsWith('.inkchapter-heading-diagnostic')).toBe(true)
    }
  })

  it('the Drawer / Problems Control gates stay 0 (nothing in R9 touches them)', () => {
    const w = makeWorld()
    host = w.h
    inject(host, [multiH1()])
    api().renderHeadingDiagnosticMarkers()
    const c = api().getHeadingMarkerSurfaceCounters()
    expect(c.drawerStyleMutation).toBe(0)
    expect(c.problemsControlStyleMutation).toBe(0)
  })
})
