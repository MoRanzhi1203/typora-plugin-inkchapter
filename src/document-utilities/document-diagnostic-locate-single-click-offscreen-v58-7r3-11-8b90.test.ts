// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.21 — Diagnostic Locate Single-Click Offscreen Atomic
 * Transaction V5.8.
 *
 * The defect: a target that starts OFFSCREEN required a SECOND user click
 * before the locate visual appeared (the first click only scrolled).
 *
 * These kill-bug tests lock the fix:
 *
 *   ONECLICK-V58-1  below-viewport target: one click → scroll → visual → COMMITTED
 *   ONECLICK-V58-2  above-viewport target: one click → scroll up → visual → COMMITTED
 *   ONECLICK-V58-3  scroll-stable with NO visual paint → MUST NOT COMMIT
 *   ONECLICK-V58-4  pre-scroll rect != post-scroll rect → post-scroll rect wins
 *   ONECLICK-V58-5  Drawer open: recovery settles before commit + final repaint
 *   ONECLICK-V58-6  first paint invalid → internal rAF retry, userClickCount stays 1
 *   ONECLICK-V58-7  exhausted internal retries → terminal FAILED (no half tx)
 *   ONECLICK-V58-8  a later click on the same diagnostic = a NEW relocate action
 *   ONECLICK-V58-VISIBLE  an initially visible target stays a one-click commit
 *   ONECLICK-V58-MATRIX   Table/Code/Image/Link/Heading offscreen one-click
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import { DiagnosticLocateFrameController } from './document-diagnostic-locate-frame'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  LOCATE_ONE_CLICK_AUDIT_EVENT,
  LOCATE_ONE_CLICK_GATE_KEYS,
  LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY,
  POST_SCROLL_NEXT_STATE,
  isScrollStableTerminalState,
  nextStateAfterScrollStable,
  resolveOneClickRetryDecision,
  shouldInvalidatePreScrollGeometry,
  verifyOneClickLocateVisual,
} from './document-locate-one-click-v5-8'

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

// ── DOM + host harness ─────────────────────────────────────────────────────
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

type Internals = {
  locateDiagnostic(id: string): void
  verifyOneClickPaintedVisual: (...args: unknown[]) => unknown
}

function makeHost(): { h: DocumentUtilityOverlayHost; shell: HTMLElement; write: HTMLElement } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 800, bottom: 600 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, shell, write }
}

function injectSnapshot(h: DocumentUtilityOverlayHost, diag: Record<string, unknown>): void {
  const snapshot = {
    documentKey: 'doc:key',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: [diag],
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  // The suite exercises the locate ORCHESTRATION, not the diagnostics engine:
  // freeze the injected snapshot so a live reconcile cannot replace the target
  // mid-transaction (which the real runtime would treat as DIAGNOSTIC_GONE).
  authority.recompute = () => { /* frozen for the transaction test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

function diagOf(
  id: string,
  code: string,
  location: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  severity: 'error' | 'warning' | 'info' = 'warning',
): Record<string, unknown> {
  return { id, documentKey: 'doc:key', severity, category: 'document', code, message: 'm', detail: '', metadata, location }
}

async function clickLocate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as Internals).locateDiagnostic(id)
  await flushRaf()
}

/**
 * V5.9 — an offscreen target must ARRIVE before the visual pipeline may start.
 * This helper performs the deterministic scroll effect: after the click the
 * live rect moves into the viewport (exactly what a real scroll does).
 */
async function clickLocateArriving(
  h: DocumentUtilityOverlayHost,
  id: string,
  live: Rect,
  arrived: Rect = ONSCREEN,
): Promise<void> {
  ;(h as unknown as Internals).locateDiagnostic(id)
  live.left = arrived.left
  live.top = arrived.top
  live.right = arrived.right
  live.bottom = arrived.bottom
  await flushRaf()
}

// ── console audit parsing ──────────────────────────────────────────────────
type AuditParse = Record<string, string>
type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): AuditParse | null {
  const lines = spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes(event))
  const line = lines[nth]
  if (!line) return null
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: AuditParse = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}
function countAudit(spy: InfoSpy, event: string): number {
  return spy.mock.calls.filter(c => String(c[0]).includes(event)).length
}

const OFFSCREEN_BELOW: Rect = { left: 200, top: 900, right: 900, bottom: 1100 }
const OFFSCREEN_ABOVE: Rect = { left: 200, top: -400, right: 900, bottom: -200 }
/**
 * V5.10 — the arrived rect is CENTERED in the 0..600 viewport (center 300), so
 * the Preferred Center Placement verify is satisfied after the arrival.
 */
const ONSCREEN: Rect = { left: 200, top: 200, right: 900, bottom: 400 }

function tableDiag(): Record<string, unknown> {
  return diagOf('T1', 'TABLE_MISSING_NAME', { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' })
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
  document.body.scrollTop = 0
})

afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

function expectAllV58GatesZero(h: DocumentUtilityOverlayHost): void {
  const counters = h.getOneClickLocateCounters()
  for (const key of Object.keys(counters)) expect(counters[key], key).toBe(0)
}

// ── ONECLICK-V58-1 / 2 ─────────────────────────────────────────────────────
describe('ONECLICK-V58-1/2 — offscreen target commits on the FIRST click', () => {
  for (const [label, rect] of [['below viewport', OFFSCREEN_BELOW], ['above viewport', OFFSCREEN_ABOVE]] as const) {
    it(`ONECLICK-V58-${label === 'below viewport' ? '1' : '2'}: ${label} → scroll → visual → COMMITTED`, async () => {
      const mounted = makeHost()
      host = mounted.h
      mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
      const table = mounted.write.querySelector('table') as HTMLElement
      const live: Rect = { ...rect }
      stubRect(table, () => live)
      injectSnapshot(host, tableDiag())

      await clickLocateArriving(host, 'T1', live)

      const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
      expect(audit).not.toBeNull()
      expect(audit!.userClickCount).toBe('1')
      expect(audit!.targetInitiallyVisible).toBe('false')
      expect(audit!.automaticScrollRequired).toBe('true')
      expect(audit!.scrollSettled).toBe('true')
      expect(audit!.postScrollRevalidateDecision).toBe('PASS')
      expect(audit!.freshTargetMeasurement).toBe('true')
      expect(audit!.freshHostMeasurement).toBe('true')
      expect(Number(audit!.visualPaintAttemptCount)).toBeGreaterThanOrEqual(1)
      expect(audit!.secondUserClickRequired).toBe('false')
      expect(audit!.drawerRecoverySettled).toBe('true')
      expect(audit!.postRecoveryRemeasured).toBe('true')
      expect(audit!.postRecoveryRepainted).toBe('true')
      expect(audit!.postRecoveryVisualVisible).toBe('true')
      expect(audit!.preScrollGeometryInvalidated).toBe('true')
      expect(audit!.terminalState).toBe('COMMITTED')
      expect(audit!.decision).toBe('PASS')
      // The visual carrier really exists after ONE click (recorded at paint).
      expect(audit!.presentationBuiltAfterScroll).toBe('true')
      expect(audit!.visualCarrierPresent).toBe('true')
      // V5.9 — the arrival authority must hold before the visual started.
      expect(audit!.targetEnteredViewport).toBe('true')
      expect(audit!.targetVisibleAtSettle).toBe('true')
      expect(audit!.scrollEffectObserved).toBe('true')
      expect(Number(audit!.scrollWriteCount)).toBeGreaterThanOrEqual(1)
      expect(audit!.visualStartedAfterTargetVisible).toBe('true')
      expect(host.isLocateTransactionActive()).toBe(false)
      expectAllV58GatesZero(host)
    })
  }
})

// ── ONECLICK-V58-3 ─────────────────────────────────────────────────────────
describe('ONECLICK-V58-3 — scroll-stable without a visual must NOT commit', () => {
  it('ONECLICK-V58-3: a never-valid visual ends in terminal FAILED, never PASS', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    const spy = vi.spyOn(host as unknown as { verifyOneClickPaintedVisual: () => unknown }, 'verifyOneClickPaintedVisual')
    spy.mockImplementation(() => ({
      ok: false, reason: 'ZERO_PAINTED_RECT', primaryMarkerVisible: false,
      secondaryContextVisible: null, expectedFragmentCount: null,
      renderedFragmentCount: null, zeroRect: true, fragmentDrop: false,
    }))

    // V5.9 — the target FIRST arrives (scroll effect), then the paint fails.
    await clickLocateArriving(host, 'T1', live)

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.decision).toBe('FAIL')
    expect(audit!.terminalState).toBe('FAILED')
    expect(audit!.postRecoveryVisualVisible).toBe('false')
    expect(Number(audit!.visualPaintAttemptCount)).toBeGreaterThanOrEqual(1)
    // Never a second user click, never a fake PASS.
    expect(audit!.secondUserClickRequired).toBe('false')
    expect(host.isLocateTransactionActive()).toBe(false)
    // The commit-time gates must not fire: we never committed an invisible visual.
    expectAllV58GatesZero(host)
    spy.mockRestore()
  })
})

// ── ONECLICK-V58-4 ─────────────────────────────────────────────────────────
describe('ONECLICK-V58-4 — the final geometry is the POST-scroll rect', () => {
  it('ONECLICK-V58-4: pre-scroll rect is invalidated and never reused', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    ;(host as unknown as Internals).locateDiagnostic('T1')
    // The deterministic scroll happened: the live rect is now on screen.
    live.left = ONSCREEN.left
    live.top = ONSCREEN.top
    live.right = ONSCREEN.right
    live.bottom = ONSCREEN.bottom
    await flushRaf()

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    const pre = JSON.parse(audit!.preScrollTargetRect) as Rect
    const post = JSON.parse(audit!.postScrollTargetRect) as Rect
    expect(pre.top).toBe(OFFSCREEN_BELOW.top)
    expect(post.top).toBe(ONSCREEN.top)
    expect(post.top).not.toBe(pre.top)
    expect(audit!.preScrollGeometryInvalidated).toBe('true')
    // V5.9 — the scroll-arrival audit records the settle rect of the REAL target.
    expect(audit!.targetVisibleAtSettle).toBe('true')
    expectAllV58GatesZero(host)
  })
})

// ── ONECLICK-V58-5 ─────────────────────────────────────────────────────────
describe('ONECLICK-V58-5 — Drawer recovery settles BEFORE the commit + final repaint', () => {
  it('ONECLICK-V58-5: with the Drawer open the commit uses the post-recovery layout', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    // User intent: the Drawer is open.
    const diagBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')
    expect(diagBtn).toBeTruthy()
    diagBtn!.click()
    expect(host.getDrawerRequestedOpen()).toBe(true)

    await clickLocateArriving(host, 'T1', live)

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.drawerRecoverySettled).toBe('true')
    expect(audit!.postRecoveryRemeasured).toBe('true')
    expect(audit!.postRecoveryRepainted).toBe('true')
    expect(audit!.postRecoveryVisualVisible).toBe('true')
    expect(audit!.terminalState).toBe('COMMITTED')
    expect(audit!.decision).toBe('PASS')
    // The Drawer intent survives the whole transaction; V5.12-R2 §13.3 — the
    // ACTIVE LOCATE VISIBILITY LEASE is HELD after COMMIT so the restored Drawer
    // can never re-cover the geometry that was just completed.
    expect(host.getLocateVisibilityLeaseActive()).toBe(true)
    expect(host.getDrawerRequestedOpen()).toBe(true)
    expect(host.getDrawerPresentationMode()).toBe('open')
    expectAllV58GatesZero(host)
  })
})

// ── ONECLICK-V58-6 / 7 ─────────────────────────────────────────────────────
describe('ONECLICK-V58-6/7 — bounded INTERNAL retry (never a second user click)', () => {
  it('ONECLICK-V58-6: a transient invalid paint is retried internally; userClickCount stays 1', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    let calls = 0
    const spy = vi.spyOn(host as unknown as { verifyOneClickPaintedVisual: () => unknown }, 'verifyOneClickPaintedVisual')
    spy.mockImplementation(() => {
      calls++
      if (calls === 1) {
        return { ok: false, reason: 'ZERO_PAINTED_RECT', primaryMarkerVisible: false, secondaryContextVisible: null, expectedFragmentCount: null, renderedFragmentCount: null, zeroRect: true, fragmentDrop: false }
      }
      return { ok: true, reason: 'VISUAL_VISIBLE', primaryMarkerVisible: true, secondaryContextVisible: true, expectedFragmentCount: null, renderedFragmentCount: null, zeroRect: false, fragmentDrop: false }
    })

    await clickLocateArriving(host, 'T1', live)

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.userClickCount).toBe('1')
    expect(audit!.decision).toBe('PASS')
    expect(audit!.terminalState).toBe('COMMITTED')
    expect(audit!.secondUserClickRequired).toBe('false')
    expect(audit!.visualRetryCount).toBe('1')
    expect(Number(audit!.visualPaintAttemptCount)).toBeGreaterThanOrEqual(2)
    expectAllV58GatesZero(host)
    spy.mockRestore()
  })

  it('ONECLICK-V58-7: exhausted retries are a terminal FAILED with no dangling transaction', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    const spy = vi.spyOn(host as unknown as { verifyOneClickPaintedVisual: () => unknown }, 'verifyOneClickPaintedVisual')
    spy.mockImplementation(() => ({
      ok: false, reason: 'PAINTED_OUTSIDE_VISIBLE_EDITOR', primaryMarkerVisible: true,
      secondaryContextVisible: false, expectedFragmentCount: null,
      renderedFragmentCount: null, zeroRect: false, fragmentDrop: false,
    }))

    await clickLocateArriving(host, 'T1', live)

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.decision).toBe('FAIL')
    expect(audit!.terminalState).toBe('FAILED')
    expect(Number(audit!.visualRetryCount)).toBe(LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY)
    expect(Number(audit!.visualPaintAttemptCount)).toBe(LOCATE_ONE_CLICK_MAX_INTERNAL_RETRY + 1)
    expect(audit!.userClickCount).toBe('1')
    expect(audit!.secondUserClickRequired).toBe('false')
    expect(host.isLocateTransactionActive()).toBe(false)
    expect(host.getDrawerRecoveryLeaseActive()).toBe(false)
    spy.mockRestore()
  })
})

// ── ONECLICK-V58-8 ─────────────────────────────────────────────────────────
describe('ONECLICK-V58-8 — a later click on the same diagnostic is a NEW relocate action', () => {
  it('ONECLICK-V58-8: the second click opens a fresh one-click transaction', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const live: Rect = { ...OFFSCREEN_BELOW }
    stubRect(table, () => live)
    injectSnapshot(host, tableDiag())

    await clickLocateArriving(host, 'T1', live)
    const first = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT, 0)
    expect(first).not.toBeNull()
    expect(first!.terminalState).toBe('COMMITTED')
    const epoch1 = Number(first!.visualEpoch)

    // Re-inject (a live reconcile may have published a fresh snapshot); the
    // relocate starts offscreen again, so it must arrive by itself too.
    live.top = OFFSCREEN_BELOW.top
    live.bottom = OFFSCREEN_BELOW.bottom
    injectSnapshot(host, tableDiag())
    await clickLocateArriving(host, 'T1', live)
    expect(countAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)).toBe(2)
    const second = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT, 1)
    expect(second).not.toBeNull()
    expect(Number(second!.transactionId)).toBeGreaterThan(Number(first!.transactionId))
    expect(Number(second!.visualEpoch)).toBeGreaterThan(epoch1)
    // The relocate is a COMPLETE one-click transaction again.
    expect(second!.userClickCount).toBe('1')
    expect(second!.terminalState).toBe('COMMITTED')
    expect(second!.decision).toBe('PASS')
    expect(second!.secondUserClickRequired).toBe('false')
    expect(host.getLocateFrameStructure().staleLocateFrameCount).toBe(0)
    expectAllV58GatesZero(host)
  })
})

// ── ONECLICK-V58-VISIBLE ───────────────────────────────────────────────────
describe('ONECLICK-V58-VISIBLE — an initially visible target stays a one-click commit', () => {
  it('ONECLICK-V58-VISIBLE: targetInitiallyVisible=true and automaticScrollRequired=false', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())

    await clickLocate(host, 'T1')

    const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
    expect(audit).not.toBeNull()
    expect(audit!.targetInitiallyVisible).toBe('true')
    expect(audit!.automaticScrollRequired).toBe('false')
    expect(audit!.preScrollGeometryInvalidated).toBe('false')
    expect(audit!.terminalState).toBe('COMMITTED')
    expect(audit!.decision).toBe('PASS')
    expect(audit!.userClickCount).toBe('1')
    expect(audit!.visualCarrierPresent).toBe('true')
    // V5.9 §9 / V5.10 §4 — the fast path requires VISIBLE **and** centered.
    expect(audit!.scrollWriteCount).toBe('0')
    expect(audit!.arrivalGateDecision).toBe('PLACEMENT_FAST_PATH')
    expect(audit!.alreadyWithinCenterTolerance).toBe('true')
    expect(audit!.visualStartedAfterTargetVisible).toBe('true')
    expect(host.getScrollArrivalCounters().visibleTargetUnnecessaryScrollWrite).toBe(0)
    expectAllV58GatesZero(host)
  })
})

// ── ONECLICK-V58-MATRIX ────────────────────────────────────────────────────
describe('ONECLICK-V58-MATRIX — every offscreen kind commits in ONE click', () => {
  const cases: Array<{ name: string; kind: 'table' | 'code' | 'image' | 'link' | 'heading'; code: string }> = [
    { name: 'table', kind: 'table', code: 'TABLE_MISSING_NAME' },
    { name: 'code', kind: 'code', code: 'CODE_MISSING_NAME' },
    { name: 'image', kind: 'image', code: 'FIGURE_LOCAL_IMAGE_MISSING' },
    { name: 'link', kind: 'link', code: 'LINK_LOCAL_TARGET_MISSING' },
    { name: 'heading', kind: 'heading', code: 'HEADING_LEVEL_GAP' },
  ]

  for (const c of cases) {
    it(`MATRIX-V58: offscreen ${c.name} → one click → COMMITTED`, async () => {
      const mounted = makeHost()
      host = mounted.h
      let anchorSelector = ''
      let location: Record<string, unknown>
      let metadata: Record<string, unknown> = {}
      if (c.kind === 'table') {
        mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
        anchorSelector = 'table'
        location = { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' }
      } else if (c.kind === 'code') {
        mounted.write.innerHTML = '<pre class="md-fences"></pre>'
        anchorSelector = 'pre'
        location = { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' }
      } else if (c.kind === 'image') {
        mounted.write.innerHTML = '<img src="a.png">'
        anchorSelector = 'img'
        location = { kind: 'block-node', blockKind: 'figure', stableIdentity: 'block:figure:0' }
        metadata = { resourceKind: 'image', occurrenceIndex: 0, destination: 'a.png', rawDestination: 'a.png' }
      } else if (c.kind === 'link') {
        mounted.write.innerHTML = '<p><a href="./missing.md">x</a></p>'
        anchorSelector = 'a'
        location = { kind: 'block-node', blockKind: 'link', stableIdentity: 'local:missing.md' }
        metadata = { resourceKind: 'link', occurrenceIndex: 0, destination: 'missing.md', rawDestination: './missing.md' }
      } else {
        mounted.write.innerHTML = '<h1 data-id="H1">标题</h1>'
        anchorSelector = 'h1'
        location = { kind: 'canonical-node', nodeKind: 'heading', stableIdentity: 'H1' }
      }
      const anchor = mounted.write.querySelector(anchorSelector) as HTMLElement
      const live: Rect = { ...OFFSCREEN_BELOW }
      stubRect(anchor, () => live)
      injectSnapshot(host, diagOf(`D-${c.kind}`, c.code, location, metadata))

      await clickLocateArriving(host, `D-${c.kind}`, live)

      const audit = readAudit(infoSpy!, LOCATE_ONE_CLICK_AUDIT_EVENT)
      expect(audit, c.name).not.toBeNull()
      expect(audit!.userClickCount, c.name).toBe('1')
      expect(audit!.targetInitiallyVisible, c.name).toBe('false')
      expect(audit!.automaticScrollRequired, c.name).toBe('true')
      expect(audit!.freshTargetMeasurement, c.name).toBe('true')
      expect(audit!.freshHostMeasurement, c.name).toBe('true')
      expect(audit!.secondUserClickRequired, c.name).toBe('false')
      expect(audit!.postRecoveryVisualVisible, c.name).toBe('true')
      expect(audit!.terminalState, c.name).toBe('COMMITTED')
      expect(audit!.decision, c.name).toBe('PASS')
      expect(audit!.visualCarrierPresent, c.name).toBe('true')
      expectAllV58GatesZero(host)
    })
  }
})

// ── V58-HOSTFRESH ──────────────────────────────────────────────────────────
describe('V58-HOSTFRESH — fresh overlay-host measurement is not defeated by an origin-anchored root', () => {
  function ctrlWithRoot(rootRect: Rect | null): { ctrl: DiagnosticLocateFrameController; table: HTMLElement; root: HTMLElement } {
    const root = document.createElement('div')
    document.body.appendChild(root)
    if (rootRect) stubRect(root, () => rootRect)
    const table = document.createElement('table')
    table.innerHTML = '<tr><td>x</td></tr>'
    document.body.appendChild(table)
    stubRect(table, () => ({ left: 200, top: 300, right: 900, bottom: 500 }))
    const ctrl = new DiagnosticLocateFrameController(root)
    ctrl.commit({ diagnosticId: 'h', severity: 'warning', anchor: table, kind: 'table' })
    ctrl.reposition({})
    return { ctrl, table, root }
  }

  it('V58-HOSTFRESH-1: a full-viewport root anchored at (0,0) IS fresh-measured', () => {
    // The overlay root is `position:fixed; inset:0` → left/top are legitimately 0.
    const { ctrl, table, root } = ctrlWithRoot({ left: 0, top: 0, right: 1280, bottom: 687 })
    const rep = ctrl.getLastScrollStabilityReport()
    expect(rep).not.toBeNull()
    expect(rep!.hostFresh).toBe(true)
    ctrl.dispose(); table.remove(); root.remove()
  })

  it('V58-HOSTFRESH-2: a not-laid-out (0×0) root is NOT fresh-measured', () => {
    const { ctrl, table, root } = ctrlWithRoot(null) // jsdom default 0×0
    const rep = ctrl.getLastScrollStabilityReport()
    expect(rep).not.toBeNull()
    expect(rep!.hostFresh).toBe(false)
    ctrl.dispose(); table.remove(); root.remove()
    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-diagnostic-locate-frame.ts'), 'utf8')
    expect(src).toContain('hr.width > 0 || hr.height > 0')
  })
})

// ── Pure contract ──────────────────────────────────────────────────────────
describe('V58-CONTRACT — pure decision surface', () => {
  it('V58-CONTRACT-1: the 21 hard gates are declared exactly once', () => {
    expect(LOCATE_ONE_CLICK_GATE_KEYS.length).toBe(21)
    expect(new Set(LOCATE_ONE_CLICK_GATE_KEYS).size).toBe(21)
    for (const key of [
      'offscreenLocateRequiresSecondClick',
      'scrollStableTerminalWithoutVisual',
      'postScrollRemeasureMissing',
      'postScrollFreshTargetMissing',
      'postScrollFreshHostMissing',
      'postScrollStaleRectCommit',
      'postScrollDiagnosticIdentityChange',
      'postScrollOccurrenceChange',
      'postScrollAnchorChange',
      'postScrollVisualNotVisibleCommit',
      'postScrollZeroRectCommit',
      'postScrollFragmentDropCommit',
      'commitBeforeDrawerRecoverySettled',
      'postRecoveryRepaintMissing',
      'postRecoveryVisualNotVisible',
      'tableOffscreenFirstClickVisualMissing',
      'codeOffscreenFirstClickVisualMissing',
      'imageOcc0SecondClickRequired',
      'imageOcc1SecondClickRequired',
      'linkOffscreenSecondClickRequired',
      'headingOffscreenSecondClickRequired',
    ] as const) {
      expect(LOCATE_ONE_CLICK_GATE_KEYS).toContain(key)
    }
  })

  it('V58-CONTRACT-2: scroll-stable may only advance into POST_SCROLL_REVALIDATING', () => {
    expect(nextStateAfterScrollStable()).toBe('POST_SCROLL_REVALIDATING')
    expect(POST_SCROLL_NEXT_STATE).toBe('POST_SCROLL_REVALIDATING')
    expect(isScrollStableTerminalState('COMMITTED')).toBe(true)
    expect(isScrollStableTerminalState('FAILED')).toBe(true)
    expect(isScrollStableTerminalState('POST_SCROLL_REVALIDATING')).toBe(false)
  })

  it('V58-CONTRACT-3: verify rejects zero / invisible / fragment-dropped visuals', () => {
    const base = {
      hasRealLayout: true, targetConnected: true, paintedWidth: 100, paintedHeight: 40,
      paintedIntersectionWithVisibleEditor: 100, primaryMarkerVisible: true,
      secondaryContextVisible: null as boolean | null,
      expectedFragmentCount: null as number | null, renderedFragmentCount: null as number | null,
    }
    expect(verifyOneClickLocateVisual(base).ok).toBe(true)
    expect(verifyOneClickLocateVisual({ ...base, targetConnected: false }).reason).toBe('TARGET_NOT_CONNECTED')
    expect(verifyOneClickLocateVisual({ ...base, paintedWidth: 0 }).reason).toBe('ZERO_PAINTED_RECT')
    expect(verifyOneClickLocateVisual({ ...base, paintedIntersectionWithVisibleEditor: 0 }).reason).toBe('PAINTED_OUTSIDE_VISIBLE_EDITOR')
    expect(verifyOneClickLocateVisual({ ...base, primaryMarkerVisible: false }).reason).toBe('PRIMARY_MARKER_NOT_VISIBLE')
    expect(verifyOneClickLocateVisual({ ...base, secondaryContextVisible: false }).reason).toBe('SECONDARY_CONTEXT_NOT_VISIBLE')
    expect(verifyOneClickLocateVisual({ ...base, expectedFragmentCount: 3, renderedFragmentCount: 2 }).reason).toBe('INLINE_FRAGMENT_DROP')
    expect(verifyOneClickLocateVisual({ ...base, staleRect: true }).reason).toBe('STALE_PRE_SCROLL_RECT')
    // Headless is explicitly SKIP_HEADLESS, never a fabricated FAIL.
    expect(verifyOneClickLocateVisual({ ...base, hasRealLayout: false, paintedWidth: 0 }).ok).toBe(true)
  })

  it('V58-CONTRACT-4: internal retry is bounded and terminal on exhaustion', () => {
    expect(resolveOneClickRetryDecision(true, 0)).toBe('COMMIT')
    expect(resolveOneClickRetryDecision(false, 0)).toBe('RETRY')
    expect(resolveOneClickRetryDecision(false, 1)).toBe('RETRY')
    expect(resolveOneClickRetryDecision(false, 2)).toBe('FAILED')
    expect(resolveOneClickRetryDecision(false, 3)).toBe('FAILED')
    expect(shouldInvalidatePreScrollGeometry(true)).toBe(true)
    expect(shouldInvalidatePreScrollGeometry(false)).toBe(false)
  })

  it('V58-CONTRACT-5: production source carries the atomic one-click contract', () => {
    const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(hostSrc).toContain('ONE USER CLICK = ONE COMPLETE LOCATE TRANSACTION')
    expect(hostSrc).toContain('POST_SCROLL_REVALIDATING')
    expect(hostSrc).toContain('beginOneClickCompletion')
    expect(hostSrc).toContain('runOneClickFinalPhase')
    expect(hostSrc).toContain('runOneClickPaintAttempt')
    expect(hostSrc).toContain('revalidateLocatePostScroll')
    expect(hostSrc).toContain('measureOneClickPostScroll')
    expect(hostSrc).toContain('verifyOneClickPaintedVisual')
    expect(hostSrc).toContain('scheduleOneClickRaf')
    expect(hostSrc).toContain('emitOneClickLocateAudit')
    // SCROLL_STABLE_FRAMES must advance into the atomic completion, never
    // straight into finishLocateTransaction.
    expect(hostSrc).toContain('TARGET_ARRIVAL_SETTLED')
    expect(hostSrc).toContain('beginOneClickCompletion')
    expect(hostSrc).toContain('waitForTargetArrival')
    expect(hostSrc).toContain('waitForPostArrivalSettle')
    expect(hostSrc).toContain('applyDeterministicScroll')
    expect(hostSrc).toContain('resolveStableScrollAnchor')
    expect(hostSrc).toContain('validateScrollContainer')
    // The terminal commit must come after the final verify.
    const finalPhaseIdx = hostSrc.indexOf('private runOneClickFinalPhase')
    const commitIdx = hostSrc.indexOf('ONE_CLICK_COMMITTED', finalPhaseIdx)
    expect(finalPhaseIdx).toBeGreaterThan(0)
    expect(commitIdx).toBeGreaterThan(finalPhaseIdx)
  })
})
