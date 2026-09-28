// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.23 — Diagnostic Locate Preferred Center Placement V5.10.
 *
 * "目标已经可见" ≠ "目标已经处于合适的阅读位置".
 *
 * These kill-bug tests drive the REAL Host transaction with a simulated scroll
 * viewport (deterministic scrollTop write + V5.9 arrival gate + V5.10 placement):
 *
 *   PLACEMENT-V510-1   visible but top-biased  → one recenter write
 *   PLACEMENT-V510-2   visible but bottom-biased → one recenter write
 *   PLACEMENT-V510-3   already centered        → ZERO scroll writes
 *   PLACEMENT-V510-4   offscreen below         → centered + COMMITTED
 *   PLACEMENT-V510-5   offscreen above         → centered + COMMITTED
 *   PLACEMENT-V510-6   document start          → CLAMPED_DOCUMENT_START (PASS)
 *   PLACEMENT-V510-7   document end            → CLAMPED_DOCUMENT_END (PASS)
 *   PLACEMENT-V510-8   normal Table            → compound Primary+Secondary center
 *   PLACEMENT-V510-9   normal Code             → compound center
 *   PLACEMENT-V510-10  large Code              → LARGE_BLOCK_PRIMARY_BIASED
 *   PLACEMENT-V510-11  large Table             → LARGE_BLOCK_PRIMARY_BIASED
 *   PLACEMENT-V510-12  Missing Link            → owning block placement
 *   PLACEMENT-V510-13  Missing Image occ0/1    → occurrence unchanged
 *   PLACEMENT-V510-14  reflow after recovery   → exactly ONE correction
 *   PLACEMENT-V510-15  persistent reflow       → FAIL (never a second fix)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { LOCATE_ONE_CLICK_AUDIT_EVENT } from './document-locate-one-click-v5-8'
import {
  LOCATE_PLACEMENT_AUDIT_EVENT,
  LOCATE_PLACEMENT_V510_GATE_KEYS,
  MAX_FINAL_PLACEMENT_CORRECTION,
  centerTolerancePx,
  computePreferredPlacement,
  createLocatePlacementV510GateCounters,
  isWithinCenterTolerance,
  placementNumericTolerancePx,
  verifyFinalPlacement,
} from './document-locate-placement-v5-10'

// ── rAF harness ────────────────────────────────────────────────────────────
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
  while (rafTasks.size > 0 && guard++ < 300) {
    const cur = Array.from(rafTasks.values())
    rafTasks.clear()
    for (const cb of cur) cb(0)
    await Promise.resolve()
  }
}
/** Run exactly `n` rAF rounds — lets a test inject a reflow between frames. */
async function flushRafSteps(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
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

function fakeContext(): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
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
    getObjectCaptionHost: (obj) => (obj as unknown as { __inkCaption?: HTMLElement }).__inkCaption ?? null,
  }
}

type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): Record<string, string> | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

// ── Simulated scroll viewport ──────────────────────────────────────────────
interface World {
  h: DocumentUtilityOverlayHost
  shell: HTMLElement
  write: HTMLElement
  target: HTMLElement
  caption: HTMLElement | null
  scrollTop(): number
  setTargetHeight(h: number): void
  setTargetTop(top: number): void
  setCaptionHeight(h: number): void
  /** Stub an extra node so its viewport rect tracks the simulated scrollTop. */
  stubContentRect(el: HTMLElement, contentTop: number, height: number): void
}

function makeWorld(opts: {
  tag: string
  targetTop: number
  targetHeight: number
  viewHeight?: number
  contentHeight?: number
  initialScrollTop?: number
  targetHtml?: string
  withCaption?: boolean
  captionHeight?: number
  captionGap?: number
}): World {
  const viewHeight = opts.viewHeight ?? 600
  const contentHeight = opts.contentHeight ?? 2400
  const targetHtml = opts.targetHtml
  let targetTop = opts.targetTop
  let targetHeight = opts.targetHeight
  const captionHeight = opts.captionHeight ?? 40
  const captionGap = opts.captionGap ?? 8
  let scrollTop = Math.max(0, Math.min(opts.initialScrollTop ?? 0, Math.max(0, contentHeight - viewHeight)))

  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, Math.min(Number(v) || 0, Math.max(0, contentHeight - viewHeight))) },
  })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => viewHeight })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => contentHeight })
  stubRect(shell, () => ({ left: 0, top: 0, right: 800, bottom: viewHeight }))

  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)

  let caption: HTMLElement | null = null
  if (opts.withCaption) {
    caption = document.createElement('div')
    caption.className = 'inkchapter-caption'
    caption.textContent = '题注'
    write.appendChild(caption)
    stubRect(caption, () => {
      const top = targetTop - captionGap - captionHeight - scrollTop
      return { left: 200, top, right: 900, bottom: top + captionHeight }
    })
  }
  const target = document.createElement(opts.tag)
  if (opts.tag === 'pre') (target as HTMLElement).className = 'md-fences'
  if (targetHtml) target.innerHTML = targetHtml
  write.appendChild(target)
  stubRect(target, () => {
    const top = targetTop - scrollTop
    return { left: 200, top, right: 900, bottom: top + targetHeight }
  })
  if (caption) (target as unknown as { __inkCaption?: HTMLElement }).__inkCaption = caption

  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  const stubContentRect = (el: HTMLElement, contentTop: number, elemHeight: number): void => {
    stubRect(el, () => {
      const top = contentTop - scrollTop
      return { left: 200, top, right: 900, bottom: top + elemHeight }
    })
  }
  return {
    h, shell, write, target, caption,
    scrollTop: () => scrollTop,
    setTargetHeight: (v: number) => { targetHeight = v },
    setTargetTop: (v: number) => { targetTop = v },
    setCaptionHeight: () => { /* caption height is fixed per world */ },
    stubContentRect,
  }
}

function inject(h: DocumentUtilityOverlayHost, diag: Record<string, unknown>): void {
  const snapshot = {
    documentKey: 'doc:key', revision: 1, sourceRevision: 1, generatedAt: 0,
    diagnostics: [diag], errorCount: 0, warningCount: 0, infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the placement transaction test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
function diagOf(id: string, code: string, location: Record<string, unknown>, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, documentKey: 'doc:key', severity: 'error', category: 'document', code, message: 'm', detail: '', metadata, location }
}
async function oneClick(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic(id)
  await flushRaf()
}

const CODE_LOC = { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }
const TABLE_LOC = { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' }

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

function placementAudit(nth = 0): Record<string, string> {
  const a = readAudit(infoSpy!, LOCATE_PLACEMENT_AUDIT_EVENT, nth)
  expect(a).not.toBeNull()
  return a!
}
function expectPlacementGatesZero(h: DocumentUtilityOverlayHost): void {
  const c = h.getPlacementCounters()
  for (const key of Object.keys(c)) expect(c[key], key).toBe(0)
}

// ── PLACEMENT-V510-1 / 2 ───────────────────────────────────────────────────
describe('PLACEMENT-V510-1/2 — a visible but off-center target is recentered', () => {
  it('PLACEMENT-V510-1: visible but top-biased → one deterministic recenter', async () => {
    // scrollTop=400, targetTop(content)=440 ⇒ rect top=40 (visible, way above center)
    const w = makeWorld({ tag: 'pre', targetTop: 440, targetHeight: 100, initialScrollTop: 400 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.targetInitiallyVisible).toBe('true')
    expect(one.alreadyWithinCenterTolerance).toBe('false')
    expect(Number(one.scrollWriteCount)).toBeGreaterThanOrEqual(1)
    expect(one.terminalState).toBe('COMMITTED')
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(p.placementReason).toBe('VISIBLE_BUT_OFFCENTER')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expect(w.scrollTop()).toBeGreaterThan(0)
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-2: visible but bottom-biased → one deterministic recenter', async () => {
    // scrollTop=400, targetTop=960 ⇒ rect top=560, center 610 (below viewport center)
    const w = makeWorld({ tag: 'pre', targetTop: 960, targetHeight: 100, initialScrollTop: 400 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.targetInitiallyVisible).toBe('true')
    expect(one.alreadyWithinCenterTolerance).toBe('false')
    expect(Number(one.scrollWriteCount)).toBeGreaterThanOrEqual(1)
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-3 ───────────────────────────────────────────────────────
describe('PLACEMENT-V510-3 — an already centered target never jitters', () => {
  it('PLACEMENT-V510-3: |centerError| <= tolerance ⇒ scrollWriteCount=0', async () => {
    // rect top=250, height 100 ⇒ center 300 == viewport center (0..600)
    const w = makeWorld({ tag: 'pre', targetTop: 250, targetHeight: 100 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.targetInitiallyVisible).toBe('true')
    expect(one.alreadyWithinCenterTolerance).toBe('true')
    expect(one.scrollWriteCount).toBe('0')
    expect(one.arrivalGateDecision).toBe('PLACEMENT_FAST_PATH')
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(p.placementReason).toBe('ALREADY_WITHIN_CENTER_TOLERANCE')
    expect(w.scrollTop()).toBe(0)
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-4 / 5 ───────────────────────────────────────────────────
describe('PLACEMENT-V510-4/5 — offscreen targets stay one-click AND land centered', () => {
  it('PLACEMENT-V510-4: offscreen below → centered + COMMITTED', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.targetInitiallyVisible).toBe('false')
    expect(one.automaticScrollRequired).toBe('true')
    expect(one.terminalState).toBe('COMMITTED')
    expect(one.userClickCount).toBe('1')
    expect(one.secondUserClickRequired).toBe('false')
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-5: offscreen above → centered + COMMITTED', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 300, targetHeight: 200, initialScrollTop: 1200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.targetInitiallyVisible).toBe('false')
    expect(one.terminalState).toBe('COMMITTED')
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-6 / 7 ───────────────────────────────────────────────────
describe('PLACEMENT-V510-6/7 — document boundaries are legal results', () => {
  it('PLACEMENT-V510-6: document start → CLAMPED_DOCUMENT_START, PASS', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 100, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const p = placementAudit()
    expect(p.placementMode).toBe('CLAMPED_DOCUMENT_START')
    expect(p.clampedAtStart).toBe('true')
    expect(Number(p.desiredScrollTop)).toBeLessThan(0)
    expect(Number(p.actualScrollTop)).toBe(0)
    expect(p.finalPlacementDecision).toBe('PASS')
    expect(p.decision).toBe('PASS')
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-7: document end → CLAMPED_DOCUMENT_END, PASS', async () => {
    // contentHeight 1000 / viewHeight 600 ⇒ maxScrollTop = 400
    const w = makeWorld({ tag: 'pre', targetTop: 900, targetHeight: 200, contentHeight: 1000 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const p = placementAudit()
    expect(p.placementMode).toBe('CLAMPED_DOCUMENT_END')
    expect(p.clampedAtEnd).toBe('true')
    expect(Number(p.desiredScrollTop)).toBeGreaterThan(400)
    expect(w.scrollTop()).toBeCloseTo(400, 0)
    expect(p.finalPlacementDecision).toBe('PASS')
    expect(p.decision).toBe('PASS')
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-8 / 9 ───────────────────────────────────────────────────
describe('PLACEMENT-V510-8/9 — Table/Code use the COMPOUND Primary+Secondary bounds', () => {
  it('PLACEMENT-V510-8: normal Table centers caption cue + table body together', async () => {
    const w = makeWorld({ tag: 'table', targetTop: 1000, targetHeight: 200, withCaption: true, targetHtml: '<tr><td>x</td></tr>' })
    host = w.h
    inject(host, diagOf('T', 'TABLE_MISSING_NAME', TABLE_LOC))
    await oneClick(host, 'T')

    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(p.largeBlock).toBe('false')
    expect(Number(p.compoundHeight)).toBeGreaterThan(200) // caption + gap + table
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    // The caption cue must be inside the viewport, i.e. NOT only the block top.
    const captionTop = w.caption!.getBoundingClientRect().top
    expect(captionTop).toBeGreaterThanOrEqual(0)
    expect(captionTop).toBeLessThan(600)
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-9: normal Code centers the compound bounds', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1100, targetHeight: 180, withCaption: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(Number(p.compoundHeight)).toBeGreaterThan(180)
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-10 / 11 ─────────────────────────────────────────────────
describe('PLACEMENT-V510-10/11 — large blocks use the primary-biased policy', () => {
  it('PLACEMENT-V510-10: large Code → LARGE_BLOCK_PRIMARY_BIASED (~38%)', async () => {
    // compoundHeight ≈ 40 + 8 + 520 = 568 ≥ 0.8 * 600 = 480
    const w = makeWorld({ tag: 'pre', targetTop: 1200, targetHeight: 520, withCaption: true })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')

    const p = placementAudit()
    expect(p.placementMode).toBe('LARGE_BLOCK_PRIMARY_BIASED')
    expect(p.largeBlock).toBe('true')
    const preferred = Number(p.primaryPreferredViewportY)
    const actual = Number(p.primaryActualViewportY)
    expect(preferred).toBeCloseTo(600 * 0.38, 0)
    expect(Math.abs(actual - preferred)).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-11: large Table → LARGE_BLOCK_PRIMARY_BIASED', async () => {
    const w = makeWorld({ tag: 'table', targetTop: 1200, targetHeight: 520, withCaption: true, targetHtml: '<tr><td>x</td></tr>' })
    host = w.h
    inject(host, diagOf('T', 'TABLE_MISSING_NAME', TABLE_LOC))
    await oneClick(host, 'T')

    const p = placementAudit()
    expect(p.placementMode).toBe('LARGE_BLOCK_PRIMARY_BIASED')
    expect(p.largeBlock).toBe('true')
    const preferred = Number(p.primaryPreferredViewportY)
    expect(Math.abs(Number(p.primaryActualViewportY) - preferred)).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })
})

// ── PLACEMENT-V510-12 / 13 ─────────────────────────────────────────────────
describe('PLACEMENT-V510-12/13 — missing resources keep Source-First + occurrence', () => {
  it('PLACEMENT-V510-12: Missing Link places from the owning block, paints the fragment', async () => {
    const w = makeWorld({ tag: 'a', targetTop: 1200, targetHeight: 20 })
    ;(w.target as HTMLAnchorElement).setAttribute('href', './missing.md')
    host = w.h
    inject(host, diagOf('L', 'LINK_LOCAL_TARGET_MISSING', { kind: 'block-node', blockKind: 'link', stableIdentity: 'local:missing.md' }, { resourceKind: 'link', occurrenceIndex: 0, destination: 'missing.md', rawDestination: './missing.md' }))
    await oneClick(host, 'L')

    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.terminalState).toBe('COMMITTED')
    const p = placementAudit()
    expect(p.placementMode).toBe('CENTER')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-13: Missing Image occ0/occ1 keep distinct source ranges', async () => {
    const cases: Array<[number, string, number]> = [[0, 'I0', 1000], [1, 'I1', 1600]]
    for (let n = 0; n < cases.length; n++) {
      const [occ, id, top] = cases[n]
      const w = makeWorld({ tag: 'img', targetTop: top, targetHeight: 120 })
      const sibling = document.createElement('img')
      sibling.src = 'sibling.png'
      w.write.appendChild(sibling)
      // The sibling is `img[1]` (occurrence 1) and must be REACHABLE so the
      // one-click transaction really arrives at it.
      w.stubContentRect(sibling, 1600, 120)
      host = w.h
      inject(host, diagOf(id, 'FIGURE_LOCAL_IMAGE_MISSING', { kind: 'block-node', blockKind: 'figure', stableIdentity: `block:figure:${occ}` }, { resourceKind: 'image', occurrenceIndex: occ, destination: 'a.png', rawDestination: 'a.png' }))
      await oneClick(host, id)
      const p = placementAudit(n)
      expect(p.diagnosticId, `occ${occ}`).toBe(id)
      expect(p.placementMode, `occ${occ}`).toBe('CENTER')
      expect(Math.abs(Number(p.centerErrorAfter)), `occ${occ}`).toBeLessThanOrEqual(placementNumericTolerancePx(1))
      expectPlacementGatesZero(host)
    }
  })
})

// ── PLACEMENT-V510-14 / 15 ─────────────────────────────────────────────────
describe('PLACEMENT-V510-14/15 — post-recovery reflow + the correction budget', () => {
  it('PLACEMENT-V510-14: a reflow after the settle costs exactly ONE correction', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    ;(host as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic('C')
    // 3 rAF rounds: placement write → arrival → 2 stable frames (settle).
    await flushRafSteps(3)
    // A real reflow (Drawer width restore / re-layout) changed the target height.
    w.setTargetHeight(320)
    await flushRaf()

    const p = placementAudit()
    expect(Number(p.placementCorrectionCount)).toBe(MAX_FINAL_PLACEMENT_CORRECTION)
    expect(p.finalPlacementDecision).toBe('PASS')
    expect(p.decision).toBe('PASS')
    expect(Math.abs(Number(p.centerErrorAfter))).toBeLessThanOrEqual(placementNumericTolerancePx(1))
    const one = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(one.terminalState).toBe('COMMITTED')
    expectPlacementGatesZero(host)
  })

  it('PLACEMENT-V510-15: persistent reflow is a FAIL, never a second correction', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    ;(host as unknown as { locateDiagnostic(id: string): void }).locateDiagnostic('C')
    await flushRafSteps(3)
    w.setTargetHeight(320) // reflow #1 (the correction cannot fix a moving target)
    await flushRafSteps(1) // final verify #1 → correction write
    w.setTargetHeight(420) // the reflow persists
    await flushRaf()

    const p = placementAudit()
    expect(Number(p.placementCorrectionCount)).toBe(MAX_FINAL_PLACEMENT_CORRECTION)
    expect(p.finalPlacementDecision).toBe('FAIL')
    expect(p.decision).toBe('FAIL')
    expect(host.isLocateTransactionActive()).toBe(false)
    const c = host.getPlacementCounters()
    // Exactly ONE fix was attempted; the exceeded counter records the honest FAIL.
    expect(c.finalPlacementCorrectionExceeded).toBe(1)
  })
})

// ── V5.7 / V5.6 regression ────────────────────────────────────────────────
describe('PLACEMENT-V510-REGRESSION — no recenter outside a locate transaction', () => {
  it('REGRESSION-1: a user scroll after COMMIT never recenters', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    const afterCommit = w.scrollTop()
    const epochAfterCommit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!.visualEpoch

    // The user scrolls manually: V5.7 scroll-follow only, NEVER a recenter.
    w.shell.scrollTop = 120
    w.shell.dispatchEvent(new Event('scroll'))
    await flushRaf()

    expect(w.scrollTop()).toBe(120)
    expect(readAudit(infoSpy!, LOCATE_PLACEMENT_AUDIT_EVENT)).not.toBeNull()
    // No new transaction / no new placement audit was produced.
    const audits = infoSpy!.mock.calls.map(c => String(c[0])).filter(l => l.includes(LOCATE_PLACEMENT_AUDIT_EVENT)).length
    expect(audits).toBe(1)
    expect(readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!.visualEpoch).toBe(epochAfterCommit)
    expect(afterCommit).toBeGreaterThan(0)
    expect(host.getPlacementCounters().postCommitUserScrollRecenter).toBe(0)
    expect(host.getPlacementCounters().placementRegressionBreaksV57Topology).toBe(0)
  })

  it('REGRESSION-2: a document left-click dismiss never recenters', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1000, targetHeight: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', CODE_LOC))
    await oneClick(host, 'C')
    const afterCommit = w.scrollTop()

    w.write.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    await flushRaf()
    expect(w.scrollTop()).toBe(afterCommit)
    expect(host.getPlacementCounters().postDismissRecenter).toBe(0)
    expect(host.getPlacementCounters().placementRegressionBreaksV56Dismiss).toBe(0)
  })
})

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V510-CONTRACT — pure placement surface', () => {
  it('V510-CONTRACT-1: the 16 hard gates are declared exactly once', () => {
    expect(LOCATE_PLACEMENT_V510_GATE_KEYS.length).toBe(16)
    expect(new Set(LOCATE_PLACEMENT_V510_GATE_KEYS).size).toBe(16)
    for (const key of [
      'locateNonBoundaryCenterErrorGtTolerance',
      'visibleOffcenterTargetSkippedScroll',
      'centeredTargetUnnecessaryScroll',
      'documentStartFalseCenterFailure',
      'documentEndFalseCenterFailure',
      'locateCenteringOverscroll',
      'largeBlockPrimaryPlacementError',
      'compoundTargetCenterUsesPartialRect',
      'placementUsesStaleGeometry',
      'placementCommitBeforeSettle',
      'finalPlacementCorrectionExceeded',
      'placementRegressionBreaksV59Arrival',
      'placementRegressionBreaksV57Topology',
      'placementRegressionBreaksV56Dismiss',
      'postCommitUserScrollRecenter',
      'postDismissRecenter',
    ] as const) {
      expect(LOCATE_PLACEMENT_V510_GATE_KEYS).toContain(key)
    }
    expect(createLocatePlacementV510GateCounters().postDismissRecenter).toBe(0)
  })

  it('V510-CONTRACT-2: center tolerance is 48px..viewportHeight*0.12', () => {
    expect(centerTolerancePx(400)).toBe(48)
    expect(centerTolerancePx(600)).toBe(60)
    // Always inside [48px, viewportHeight * 0.12].
    expect(centerTolerancePx(1200)).toBe(120)
    expect(centerTolerancePx(1200)).toBeLessThanOrEqual(1200 * 0.12)
    expect(centerTolerancePx(200)).toBeLessThanOrEqual(200 * 0.12)
    expect(isWithinCenterTolerance(59, centerTolerancePx(600))).toBe(true)
    expect(isWithinCenterTolerance(61, centerTolerancePx(600))).toBe(false)
    expect(placementNumericTolerancePx(1)).toBe(4)
  })

  it('V510-CONTRACT-3: normal center + boundary clamp classification', () => {
    const normal = computePreferredPlacement({
      viewportTop: 0, viewportHeight: 600, maxScrollTop: 1800, currentScrollTop: 0,
      targetTop: 900, targetBottom: 1100, primaryTop: 900, compoundBoundsUsed: false, geometryFresh: true,
    })
    expect(normal.placementMode).toBe('CENTER')
    expect(normal.desiredScrollTop).toBe(700)
    expect(normal.clampedScrollTop).toBe(700)
    expect(normal.clampedAtStart).toBe(false)
    expect(normal.clampedAtEnd).toBe(false)
    expect(normal.centerErrorAfter).toBeCloseTo(0, 6)

    const start = computePreferredPlacement({
      viewportTop: 0, viewportHeight: 600, maxScrollTop: 1800, currentScrollTop: 0,
      targetTop: 100, targetBottom: 300, primaryTop: 100, compoundBoundsUsed: false, geometryFresh: true,
    })
    expect(start.desiredScrollTop).toBe(-100)
    expect(start.clampedAtStart).toBe(true)
    expect(start.clampedScrollTop).toBe(0)
    expect(start.placementMode).toBe('CLAMPED_DOCUMENT_START')

    const end = computePreferredPlacement({
      viewportTop: 0, viewportHeight: 600, maxScrollTop: 400, currentScrollTop: 0,
      targetTop: 900, targetBottom: 1100, primaryTop: 900, compoundBoundsUsed: false, geometryFresh: true,
    })
    expect(end.clampedAtEnd).toBe(true)
    expect(end.clampedScrollTop).toBe(400)
    expect(end.placementMode).toBe('CLAMPED_DOCUMENT_END')
  })

  it('V510-CONTRACT-4: large-block policy + boundary precedence', () => {
    const large = computePreferredPlacement({
      viewportTop: 0, viewportHeight: 600, maxScrollTop: 3000, currentScrollTop: 0,
      targetTop: 2000, targetBottom: 2600, primaryTop: 2000, compoundBoundsUsed: true, geometryFresh: true,
    })
    expect(large.largeBlock).toBe(true)
    expect(large.placementMode).toBe('LARGE_BLOCK_PRIMARY_BIASED')
    expect(large.primaryPreferredViewportY).toBeCloseTo(228, 6)
    expect(large.desiredScrollTop).toBe(2000 - 228)

    // §14 — the boundary clamp wins over the large-block policy.
    const largeAtStart = computePreferredPlacement({
      viewportTop: 0, viewportHeight: 600, maxScrollTop: 3000, currentScrollTop: 0,
      targetTop: 100, targetBottom: 700, primaryTop: 100, compoundBoundsUsed: true, geometryFresh: true,
    })
    expect(largeAtStart.largeBlock).toBe(true)
    expect(largeAtStart.placementMode).toBe('CLAMPED_DOCUMENT_START')
  })

  it('V510-CONTRACT-5: final placement verify (center / large / boundary)', () => {
    expect(verifyFinalPlacement({ placementMode: 'CENTER', centerErrorAfter: 2, actualScrollTop: 100, maxScrollTop: 900, primaryPreferredViewportY: null, primaryActualViewportY: null }).ok).toBe(true)
    expect(verifyFinalPlacement({ placementMode: 'CENTER', centerErrorAfter: 12, actualScrollTop: 100, maxScrollTop: 900, primaryPreferredViewportY: null, primaryActualViewportY: null }).ok).toBe(false)
    expect(verifyFinalPlacement({ placementMode: 'LARGE_BLOCK_PRIMARY_BIASED', centerErrorAfter: 999, actualScrollTop: 100, maxScrollTop: 900, primaryPreferredViewportY: 228, primaryActualViewportY: 230 }).ok).toBe(true)
    expect(verifyFinalPlacement({ placementMode: 'LARGE_BLOCK_PRIMARY_BIASED', centerErrorAfter: 999, actualScrollTop: 100, maxScrollTop: 900, primaryPreferredViewportY: 228, primaryActualViewportY: 300 }).ok).toBe(false)
    expect(verifyFinalPlacement({ placementMode: 'CLAMPED_DOCUMENT_START', centerErrorAfter: 999, actualScrollTop: 0, maxScrollTop: 900, primaryPreferredViewportY: null, primaryActualViewportY: null }).ok).toBe(true)
    expect(verifyFinalPlacement({ placementMode: 'CLAMPED_DOCUMENT_END', centerErrorAfter: 999, actualScrollTop: 900, maxScrollTop: 900, primaryPreferredViewportY: null, primaryActualViewportY: null }).ok).toBe(true)
    // A boundary clamp never fails just because the target is not centered.
    expect(verifyFinalPlacement({ placementMode: 'CLAMPED_DOCUMENT_START', centerErrorAfter: -250, actualScrollTop: 0, maxScrollTop: 900, primaryPreferredViewportY: null, primaryActualViewportY: null }).ok).toBe(true)
  })

  it('V510-CONTRACT-6: production source carries the placement policy', () => {
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('PREFERRED PLACEMENT')
    expect(hostSrc).toContain('DOCUMENT-DIAGNOSTIC-LOCATE-PLACEMENT-AUDIT')
    expect(hostSrc).toContain('resolvePlacementAnchor')
    expect(hostSrc).toContain('measurePlacementState')
    expect(hostSrc).toContain('PLACEMENT_FAST_PATH')
    expect(hostSrc).toContain('MAX_FINAL_PLACEMENT_CORRECTION')
    const pureSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-locate-placement-v5-10.ts'), 'utf8')
    expect(pureSrc).toContain('computePreferredPlacement')
    expect(pureSrc).toContain('LARGE_BLOCK_PRIMARY_Y_RATIO')
  })
})
