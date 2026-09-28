// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.22 — Diagnostic Locate Scroll Completion Authority V5.9.
 *
 * The V5.8 report was falsified by the real runtime: `scrollSettled=true` was
 * recorded while the target was STILL outside the viewport, the visual
 * pipeline started too early (visualPaintAttemptCount=3 / ZERO_PAINTED_RECT)
 * and a SECOND user click was required.
 *
 * These kill-bug tests drive the REAL Host transaction (deterministic scrollTop
 * write on a simulated scroll container + Target Arrival Authority):
 *
 *   SCROLL-V59-1  offscreen below Code  → one click → COMMITTED
 *   SCROLL-V59-2  offscreen above Code  → one click → COMMITTED
 *   SCROLL-V59-3  offscreen below Table → one click → COMMITTED
 *   SCROLL-V59-4  offscreen above Heading → one click → COMMITTED
 *   SCROLL-V59-5  missing image occurrence 0 offscreen → COMMITTED
 *   SCROLL-V59-6  missing image occurrence 1 offscreen → COMMITTED
 *   SCROLL-V59-7  missing link offscreen → COMMITTED
 *   SCROLL-V59-8  already visible → ZERO scroll writes
 *   SCROLL-V59-9  target never offscreen at paint time → 0 paint / 0 retry
 *   SCROLL-V59-10 wrong scroll container → FAILED, no paint
 *   SCROLL-V59-11 no scroll effect → bounded FAILED, no dangling tx
 *   SCROLL-V59-12 identity change during scroll → CANCELLED/FAILED, no commit
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  LOCATE_ONE_CLICK_AUDIT_EVENT,
  LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY,
} from './document-locate-one-click-v5-8'
import {
  LOCATE_SCROLL_ARRIVAL_AUDIT_EVENT,
  LOCATE_SCROLL_V59_GATE_KEYS,
  MAX_ARRIVAL_FRAMES,
  MAX_POST_ARRIVAL_STABLE_FRAMES,
  MAX_SCROLL_CORRECTION,
  SCROLL_MOVEMENT_EPSILON,
  canCommitScrollTransaction,
  canStartVisualPipeline,
  computeDesiredScrollTop,
  createLocateScrollV59GateCounters,
  hasScrollEffect,
  isArrivalStable,
  makeScrollRectSnapshot,
  measureScrollArrival,
} from './document-locate-scroll-arrival-v5-9'

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
  while (rafTasks.size > 0 && guard++ < 200) {
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
  }
}

type Internals = { locateDiagnostic(id: string): void }

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

// ── Simulated scroll container ("world") ───────────────────────────────────
interface World {
  h: DocumentUtilityOverlayHost
  shell: HTMLElement
  write: HTMLElement
  target: HTMLElement
  scrollTop(): number
  setContentScroll(v: number): void
  /** Stub an extra node so its viewport rect tracks the simulated scrollTop. */
  stubContentRect(el: HTMLElement, contentTop: number, height: number): void
}

/**
 * Build a real-ish scroll viewport: BCR + clientHeight/scrollHeight + a
 * writable `scrollTop` that ACTUALLY moves the target (exactly like a browser).
 */
function makeWorld(opts: {
  tag?: string
  targetTop: number
  targetHeight?: number
  viewHeight?: number
  contentHeight?: number
  initialScrollTop?: number
  viewTop?: number
  targetHtml?: string
}): World {
  const viewHeight = opts.viewHeight ?? 600
  const contentHeight = opts.contentHeight ?? 2400
  const viewTop = opts.viewTop ?? 0
  const height = opts.targetHeight ?? 200
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
  stubRect(shell, () => ({ left: 0, top: viewTop, right: 800, bottom: viewTop + viewHeight }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const target = document.createElement(opts.tag ?? 'pre')
  if (opts.tag === 'pre') (target as HTMLElement).className = 'md-fences'
  if (opts.targetHtml) target.innerHTML = opts.targetHtml
  write.appendChild(target)
  stubRect(target, () => {
    const top = viewTop + (opts.targetTop - scrollTop)
    return { left: 200, top, right: 900, bottom: top + height }
  })
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  const stubContentRect = (el: HTMLElement, contentTop: number, elemHeight: number): void => {
    stubRect(el, () => {
      const top = viewTop + (contentTop - scrollTop)
      return { left: 200, top, right: 900, bottom: top + elemHeight }
    })
  }
  return {
    h, shell, write, target,
    scrollTop: () => scrollTop,
    setContentScroll: (v: number) => { scrollTop = v },
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
  // Freeze the diagnostics engine: this suite exercises the SCROLL / ARRIVAL
  // orchestration, so a live reconcile must not swap the target mid-flight.
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

function diagOf(id: string, code: string, location: Record<string, unknown>, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, documentKey: 'doc:key', severity: 'error', category: 'document', code, message: 'm', detail: '', metadata, location }
}

async function oneClick(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as Internals).locateDiagnostic(id)
  await flushRaf()
}

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

function expectV59GatesZero(h: DocumentUtilityOverlayHost): void {
  const c = h.getScrollArrivalCounters()
  for (const key of Object.keys(c)) expect(c[key], key).toBe(0)
}

function expectOffscreenCommitted(a: Record<string, string>): void {
  expect(a.userClickCount).toBe('1')
  expect(a.targetInitiallyVisible).toBe('false')
  expect(a.automaticScrollRequired).toBe('true')
  expect(Number(a.scrollWriteCount)).toBeGreaterThanOrEqual(1)
  expect(a.scrollEffectObserved).toBe('true')
  expect(a.targetEnteredViewport).toBe('true')
  expect(a.targetVisibleAtSettle).toBe('true')
  expect(a.visualStartedAfterTargetVisible).toBe('true')
  expect(Number(a.visualPaintAttemptCount)).toBeGreaterThanOrEqual(1)
  expect(a.secondUserClickRequired).toBe('false')
  expect(a.terminalState).toBe('COMMITTED')
  expect(a.decision).toBe('PASS')
}

// ── SCROLL-V59-1 / 2 ───────────────────────────────────────────────────────
describe('SCROLL-V59-1/2 — offscreen Code commits on the FIRST click', () => {
  it('SCROLL-V59-1: Code below the viewport → auto scroll → visual → COMMITTED', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 900 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expect(w.scrollTop()).toBeGreaterThan(0)
    expect(host.isLocateTransactionActive()).toBe(false)
    expectV59GatesZero(host)
  })

  it('SCROLL-V59-2: Code above the viewport → auto scroll up → visual → COMMITTED', async () => {
    // The content is scrolled down so the target starts ABOVE the viewport.
    const w = makeWorld({ tag: 'pre', targetTop: 500, initialScrollTop: 1000 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expect(w.scrollTop()).toBeLessThan(1000)
    expectV59GatesZero(host)
  })
})

// ── SCROLL-V59-3 / 4 ───────────────────────────────────────────────────────
describe('SCROLL-V59-3/4 — Table below / Heading above commit on the FIRST click', () => {
  it('SCROLL-V59-3: Table below → table scroll anchor → COMMITTED', async () => {
    const w = makeWorld({ tag: 'table', targetTop: 1000, targetHtml: '<tr><td>x</td></tr>' })
    host = w.h
    inject(host, diagOf('T', 'TABLE_MISSING_NAME', { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' }))

    await oneClick(host, 'T')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expect(a.scrollAnchorKind).toBe('table')
    expectV59GatesZero(host)
  })

  it('SCROLL-V59-4: Heading above → heading semantic target → COMMITTED', async () => {
    const w = makeWorld({ tag: 'h1', targetTop: 500, targetHeight: 60, initialScrollTop: 1000 })
    w.target.setAttribute('data-id', 'H1')
    host = w.h
    inject(host, diagOf('H', 'HEADING_LEVEL_GAP', { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H1' }))

    await oneClick(host, 'H')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expect(a.targetKind).toBe('heading')
    expectV59GatesZero(host)
  })
})

// ── SCROLL-V59-5 / 6 / 7 ───────────────────────────────────────────────────
describe('SCROLL-V59-5/6/7 — missing resource offscreen commits on the FIRST click', () => {
  function imageWorld(occurrence: number, targetTop: number): World {
    const w = makeWorld({ tag: 'img', targetTop, targetHeight: 120 })
    // The sibling image carries a DIFFERENT source range (occurrence 1). It is
    // measured too, so the resolver's `block:figure:<n>` ordinal really maps.
    const other = document.createElement('img')
    other.src = 'b.png'
    w.write.appendChild(other)
    w.stubContentRect(other, 2000, 120)
    return w
  }

  it('SCROLL-V59-5: missing image occurrence 0 → COMMITTED', async () => {
    const w = imageWorld(0, 1000)
    host = w.h
    inject(host, diagOf('I0', 'FIGURE_LOCAL_IMAGE_MISSING', { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' }, { resourceKind: 'image', occurrenceIndex: 0, destination: 'a.png', rawDestination: 'a.png' }))

    await oneClick(host, 'I0')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expectV59GatesZero(host)
  })

  it('SCROLL-V59-6: missing image occurrence 1 → COMMITTED (distinct source range)', async () => {
    const w = imageWorld(1, 1500)
    host = w.h
    inject(host, diagOf('I1', 'FIGURE_LOCAL_IMAGE_MISSING', { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:1' }, { resourceKind: 'image', occurrenceIndex: 1, destination: 'b.png', rawDestination: 'b.png' }))

    await oneClick(host, 'I1')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expectV59GatesZero(host)
  })

  it('SCROLL-V59-7: missing link offscreen → COMMITTED', async () => {
    const w = makeWorld({ tag: 'a', targetTop: 1200, targetHeight: 24 })
    ;(w.target as HTMLAnchorElement).setAttribute('href', './missing.md')
    host = w.h
    inject(host, diagOf('L', 'LINK_LOCAL_TARGET_MISSING', { kind: 'block-node', blockKind: 'link', stableIdentity: 'local:missing.md' }, { resourceKind: 'link', occurrenceIndex: 0, destination: 'missing.md', rawDestination: './missing.md' }))

    await oneClick(host, 'L')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expectOffscreenCommitted(a)
    expectV59GatesZero(host)
  })
})

// ── SCROLL-V59-8 ───────────────────────────────────────────────────────────
describe('SCROLL-V59-8 — already visible fast path', () => {
  it('SCROLL-V59-8: automaticScrollRequired=false and scrollWriteCount=0', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 200 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expect(a.targetInitiallyVisible).toBe('true')
    expect(a.automaticScrollRequired).toBe('false')
    expect(a.scrollWriteCount).toBe('0')
    expect(a.arrivalGateDecision).toBe('PLACEMENT_FAST_PATH')
    expect(Number(a.visualPaintAttemptCount)).toBeGreaterThanOrEqual(1)
    expect(a.terminalState).toBe('COMMITTED')
    expect(a.decision).toBe('PASS')
    expectV59GatesZero(host)
  })
})

// ── SCROLL-V59-9 / 11 ──────────────────────────────────────────────────────
describe('SCROLL-V59-9/11 — the visual pipeline never starts while offscreen', () => {
  it('SCROLL-V59-9: a target that cannot reach the viewport gets 0 paint / 0 retry', async () => {
    // Not scrollable: scrollHeight == clientHeight ⇒ the write cannot move it.
    const w = makeWorld({ tag: 'pre', targetTop: 1400, viewHeight: 600, contentHeight: 600 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expect(a.terminalState).toBe('FAILED')
    expect(a.decision).toBe('FAIL')
    expect(a.targetEnteredViewport).toBe('false')
    expect(a.targetVisibleAtSettle).toBe('false')
    expect(a.visualPaintAttemptCount).toBe('0')
    expect(a.visualRetryCount).toBe('0')
    expect(a.secondUserClickRequired).toBe('false')
    expect(Number(a.scrollCorrectionCount)).toBeLessThanOrEqual(MAX_SCROLL_CORRECTION)
    expect(host.isLocateTransactionActive()).toBe(false)
    // The scroll/violation gates stay clean even though this target genuinely
    // cannot arrive: no paint, no retry, no settle-without-effect.
    const c = host.getScrollArrivalCounters()
    expect(c.visualPaintAttemptWhileTargetOffscreen).toBe(0)
    expect(c.visualRetryWhileTargetOffscreen).toBe(0)
    expect(c.scrollSettleWithoutEffect).toBe(0)
    expect(c.scrollSettleBeforeTargetEnteredViewport).toBe(0)
    expect(c.offscreenScrollSettledWhileTargetInvisible).toBe(0)
    expect(c.danglingScrollRaf).toBe(0)
  })

  it('SCROLL-V59-11: no scroll effect → bounded FAILED with no dangling transaction', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 1400, viewHeight: 600, contentHeight: 600 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const arrival = readAudit(infoSpy!, LOCATE_SCROLL_ARRIVAL_AUDIT_EVENT)!
    expect(arrival).not.toBeNull()
    expect(arrival.scrollEffectObserved).toBe('false')
    expect(arrival.targetEnteredViewport).toBe('false')
    expect(Number(arrival.arrivalWaitFrameCount)).toBeLessThanOrEqual(MAX_ARRIVAL_FRAMES)
    expect(arrival.decision).toBe('FAIL')
    expect(arrival.visualPaintAttemptCount).toBe('0')
    const counts = host.getLocateTransactionCounts()
    expect(counts.accepted).toBe(counts.terminal)
    expect(counts.dangling).toBe(0)
    const c = host.getScrollArrivalCounters()
    expect(c.visualPaintAttemptWhileTargetOffscreen).toBe(0)
    expect(c.visualRetryWhileTargetOffscreen).toBe(0)
    expect(c.scrollSettleWithoutEffect).toBe(0)
    expect(c.danglingScrollRaf).toBe(0)
    expect(c.acceptedTxWithoutTerminal).toBe(0)
  })
})

// ── SCROLL-V59-10 ──────────────────────────────────────────────────────────
describe('SCROLL-V59-10 — the scroll container must really own the anchor', () => {
  it('SCROLL-V59-10: a mismatched container fails without any paint', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 900 })
    host = w.h
    // Simulate "the resolved container does not contain the semantic target".
    Object.defineProperty(w.shell, 'contains', { configurable: true, value: () => false })
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    await oneClick(host, 'C')

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expect(a.terminalState).toBe('FAILED')
    expect(a.decision).toBe('FAIL')
    expect(a.arrivalGateDecision).toBe('SCROLL_CONTAINER_TARGET_MISMATCH')
    expect(a.visualPaintAttemptCount).toBe('0')
    expect(a.scrollWriteCount).toBe('0')
    expect(host.isLocateTransactionActive()).toBe(false)
    expectV59GatesZero(host)
  })
})

// ── SCROLL-V59-12 ──────────────────────────────────────────────────────────
describe('SCROLL-V59-12 — identity change during the scroll cancels the transaction', () => {
  it('SCROLL-V59-12: a mid-scroll identity change never commits a stale target', async () => {
    const w = makeWorld({ tag: 'pre', targetTop: 900 })
    host = w.h
    inject(host, diagOf('C', 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))

    ;(host as unknown as Internals).locateDiagnostic('C')
    // The rule really changed while the scroll was in flight.
    inject(host, diagOf('C', 'SOME_OTHER_RULE', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }))
    await flushRaf()

    const a = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)!
    expect(a).not.toBeNull()
    expect(a.terminalState).toBe('FAILED')
    expect(a.decision).toBe('FAIL')
    expect(a.visualPaintAttemptCount).toBe('0')
    expect(a.postRecoveryVisualVisible).toBe('false')
    expect(host.isLocateTransactionActive()).toBe(false)
    const c = host.getScrollArrivalCounters()
    expect(c.visualPaintAttemptWhileTargetOffscreen).toBe(0)
    expect(c.visualRetryWhileTargetOffscreen).toBe(0)
    expect(c.scrollAnchorIdentityChangeCommit).toBe(0)
    expect(c.postScrollStaleRectCommit).toBe(0)
    expect(c.danglingScrollRaf).toBe(0)
  })
})

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V59-CONTRACT — pure scroll-arrival surface', () => {
  it('V59-CONTRACT-1: the 20 hard gates are declared exactly once', () => {
    expect(LOCATE_SCROLL_V59_GATE_KEYS.length).toBe(20)
    expect(new Set(LOCATE_SCROLL_V59_GATE_KEYS).size).toBe(20)
    for (const key of [
      'offscreenScrollSettledWhileTargetInvisible',
      'scrollSettleBeforeTargetEnteredViewport',
      'scrollSettleWithoutEffect',
      'visualPaintAttemptWhileTargetOffscreen',
      'visualRetryWhileTargetOffscreen',
      'offscreenFirstClickZeroPaintedRect',
      'offscreenFirstClickTerminalFailed',
      'offscreenFirstClickRequiresSecondClick',
      'visibleTargetUnnecessaryScrollWrite',
      'scrollContainerTargetMismatchCommit',
      'scrollAnchorIdentityChangeCommit',
      'postScrollStaleRectCommit',
      'tableOffscreenFirstClickMissing',
      'codeOffscreenFirstClickMissing',
      'headingOffscreenFirstClickMissing',
      'imageOcc0OffscreenFirstClickMissing',
      'imageOcc1OffscreenFirstClickMissing',
      'linkOffscreenFirstClickMissing',
      'acceptedTxWithoutTerminal',
      'danglingScrollRaf',
    ] as const) {
      expect(LOCATE_SCROLL_V59_GATE_KEYS).toContain(key)
    }
  })

  it('V59-CONTRACT-2: rect snapshots are pure values (no stale spread fields)', () => {
    const s = makeScrollRectSnapshot({ left: 10, top: 20, right: 110, bottom: 80 })
    expect(s).toEqual({ x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 })
    // Inverted edges collapse instead of producing negative width/height.
    const inv = makeScrollRectSnapshot({ left: 100, top: 100, right: 50, bottom: 40 })
    expect(inv.width).toBe(0)
    expect(inv.height).toBe(0)
  })

  it('V59-CONTRACT-3: arrival requires a real vertical intersection', () => {
    const viewport = makeScrollRectSnapshot({ left: 0, top: 0, right: 800, bottom: 600 })
    const visible = measureScrollArrival({ targetRect: makeScrollRectSnapshot({ left: 10, top: 100, right: 700, bottom: 300 }), viewportRect: viewport, scrollTop: 0, targetConnected: true })
    expect(visible.enteredViewport).toBe(true)
    expect(visible.reason).toBe('TARGET_ENTERED_VIEWPORT')
    const below = measureScrollArrival({ targetRect: makeScrollRectSnapshot({ left: 10, top: 900, right: 700, bottom: 1100 }), viewportRect: viewport, scrollTop: 0, targetConnected: true })
    expect(below.enteredViewport).toBe(false)
    const above = measureScrollArrival({ targetRect: makeScrollRectSnapshot({ left: 10, top: -400, right: 700, bottom: -200 }), viewportRect: viewport, scrollTop: 0, targetConnected: true })
    expect(above.enteredViewport).toBe(false)
    // A target taller than the viewport only needs a positive intersection.
    const tall = measureScrollArrival({ targetRect: makeScrollRectSnapshot({ left: 10, top: -2000, right: 700, bottom: 2000 }), viewportRect: viewport, scrollTop: 0, targetConnected: true })
    expect(tall.enteredViewport).toBe(true)
    // No layout at all → SKIP_NO_LAYOUT (never a fabricated FAIL).
    const none = measureScrollArrival({ targetRect: null, viewportRect: null, scrollTop: 0, targetConnected: true })
    expect(none.layoutSignal).toBe(false)
    expect(none.reason).toBe('SKIP_NO_LAYOUT')
    expect(none.enteredViewport).toBe(true)
  })

  it('V59-CONTRACT-4: desiredScrollTop centres + clamps to the real scroll range', () => {
    const containerRect = makeScrollRectSnapshot({ left: 0, top: 0, right: 800, bottom: 600 })
    const below = makeScrollRectSnapshot({ left: 200, top: 900, right: 900, bottom: 1100 })
    expect(computeDesiredScrollTop({ containerScrollTop: 0, containerClientHeight: 600, containerScrollHeight: 2400, containerRect, anchorRect: below })).toBe(700)
    const above = makeScrollRectSnapshot({ left: 200, top: -500, right: 900, bottom: -300 })
    expect(computeDesiredScrollTop({ containerScrollTop: 1000, containerClientHeight: 600, containerScrollHeight: 2400, containerRect, anchorRect: above })).toBe(300)
    // Clamp low + high.
    expect(computeDesiredScrollTop({ containerScrollTop: 0, containerClientHeight: 600, containerScrollHeight: 2400, containerRect, anchorRect: makeScrollRectSnapshot({ left: 0, top: -5000, right: 1, bottom: -4900 }) })).toBe(0)
    expect(computeDesiredScrollTop({ containerScrollTop: 0, containerClientHeight: 600, containerScrollHeight: 2400, containerRect, anchorRect: makeScrollRectSnapshot({ left: 0, top: 9000, right: 1, bottom: 9100 }) })).toBe(1800)
  })

  it('V59-CONTRACT-5: effect / stability / start-gate / commit-gate', () => {
    const viewport = makeScrollRectSnapshot({ left: 0, top: 0, right: 800, bottom: 600 })
    const mk = (top: number, scrollTop: number) => measureScrollArrival({ targetRect: makeScrollRectSnapshot({ left: 10, top, right: 700, bottom: top + 200 }), viewportRect: viewport, scrollTop, targetConnected: true })
    const initial = mk(900, 0)
    const moved = mk(300, 600)
    expect(hasScrollEffect(initial, initial)).toBe(false)
    expect(hasScrollEffect(initial, moved)).toBe(true)
    expect(isArrivalStable(moved, mk(300, 600))).toBe(true)
    expect(isArrivalStable(moved, mk(320, 600))).toBe(false)
    expect(isArrivalStable(initial, initial)).toBe(false)
    expect(MAX_POST_ARRIVAL_STABLE_FRAMES).toBe(2)
    expect(SCROLL_MOVEMENT_EPSILON).toBeLessThanOrEqual(1)

    const base = {
      automaticScrollRequired: true, scrollEffectObserved: true, targetEnteredViewport: true,
      targetVisibleAtSettle: true, scrollSettled: true,
    }
    expect(canStartVisualPipeline(base)).toBe(true)
    expect(canStartVisualPipeline({ ...base, targetVisibleAtSettle: false })).toBe(false)
    expect(canStartVisualPipeline({ ...base, scrollEffectObserved: false })).toBe(false)
    expect(canStartVisualPipeline({ ...base, automaticScrollRequired: false })).toBe(true)

    const commit = {
      ...base, visualPipelineStarted: true, presentationBuiltAfterScroll: true,
      primaryMarkerVisible: true, postRecoveryVisualVisible: true,
      postScrollRevalidateDecision: 'PASS', diagnosticIdentityChanged: false,
      anchorChanged: false, occurrenceChanged: false,
      drawerRecoverySettled: true, postRecoveryRemeasured: true, postRecoveryRepainted: true,
    }
    expect(canCommitScrollTransaction(commit)).toBe(true)
    expect(canCommitScrollTransaction({ ...commit, targetVisibleAtSettle: false })).toBe(false)
    expect(canCommitScrollTransaction({ ...commit, drawerRecoverySettled: false })).toBe(false)
    expect(canCommitScrollTransaction({ ...commit, anchorChanged: true })).toBe(false)
    expect(createLocateScrollV59GateCounters().danglingScrollRaf).toBe(0)
  })

  it('V59-CONTRACT-6: production source carries the Scroll Completion Authority', () => {
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('SCROLL COMPLETION AUTHORITY')
    expect(hostSrc).toContain('resolveStableScrollAnchor')
    expect(hostSrc).toContain('applyDeterministicScroll')
    expect(hostSrc).toContain('waitForTargetArrival')
    expect(hostSrc).toContain('waitForPostArrivalSettle')
    expect(hostSrc).toContain('DOCUMENT-DIAGNOSTIC-SCROLL-ARRIVAL-AUDIT')
    // The visual pipeline must never be reachable while the target is offscreen.
    expect(hostSrc).toContain('visualPaintAttemptWhileTargetOffscreen')
    expect(hostSrc).toContain('visualRetryWhileTargetOffscreen')
    const arrivalSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-locate-scroll-arrival-v5-9.ts'), 'utf8')
    expect(arrivalSrc).toContain('canStartVisualPipeline')
    expect(arrivalSrc).toContain('MAX_ARRIVAL_FRAMES')
    expect(arrivalSrc).toContain('computeDesiredScrollTop')
  })
})

// ── V5.8 visual retry authority is unchanged ───────────────────────────────
describe('V59-V58-BOUNDARY — the V5.8 visual retry authority is preserved', () => {
  it('V59-V58-BOUNDARY-1: internal visual retry budget stays 2', () => {
    expect(LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY).toBe(2)
  })
})
