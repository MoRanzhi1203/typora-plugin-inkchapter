// @vitest-environment jsdom
/**
 * V5.12-R3 — Persistent Diagnostics Drawer after Locate (Drawer Persistence).
 *
 * ROOT_R3_1 = USER INTENT and LOCATE PRESENTATION lifetime were coupled
 * ROOT_R3_2 = the LOCATE_COLLAPSE lease survived the visual COMMIT
 * ROOT_R3_3 = COMMITTED_LEASE_HELD was treated as a valid terminal presentation
 * ROOT_R3_4 = the final geometry was verified while the Drawer was HIDDEN
 * ROOT_R3_5 = the Drawer restore was deferred until a later user action
 * ROOT_R3_6 = the restore ran without a second layout settle / remeasure
 *
 * These kill-bug tests lock the fix. With `drawerRequestedOpen === true` the
 * terminal presentation is ALWAYS the user-requested one; `locate-collapse` is
 * a TRANSIENT locate-only presentation that may never outlive its lease.
 *
 *   R3-1  WIDE viewport: collapse recovery → restore → COMMITTED Drawer visible
 *   R3-2  restore chain: settle → remeasure → repaint → verify → FINAL COMMIT
 *   R3-3  Code/Table continuous switching (>= 3) never needs a manual reopen
 *   R3-4  Drawer closed at locate start → no auto-reopen after terminal
 *   R3-5  lease lifetimes are decoupled (recovery released / visual held)
 *   R3-6  ending the active visual releases the ActiveLocateVisualLease
 *   R3-7  pure contract: viewport class / restore decision / fidelity gates
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import { deriveDrawerPresentation } from './document-locate-drawer-recovery-v5-1'
import {
  DRAWER_PERSISTENCE_AUDIT_EVENT,
  DRAWER_PERSISTENCE_V512R3_GATE_KEYS,
  DRAWER_PERSISTENCE_V512R3_GATE_LABELS,
  DRAWER_WIDE_MIN_AVAILABLE_PX,
  DRAWER_MEDIUM_MIN_AVAILABLE_PX,
  createDrawerPersistenceV512R3Counters,
  evaluateDrawerPersistenceGates,
  evaluateDrawerPresentationFidelity,
  formatDrawerPersistenceGateReport,
  resolveDrawerRestoreRequired,
  resolveDrawerViewportClass,
} from './document-diagnostic-drawer-persistence-v512-r3'
import type { DrawerPresentationFidelityInput } from './document-diagnostic-drawer-persistence-v512-r3'
// V5.12-R9 §5/§7 — the unique commit gate (overlay vs geometry clip).
import { canCommitLocateVisual } from './document-diagnostic-visual-closure-v512-r2'

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
  while (rafTasks.size > 0 && guard++ < 400) {
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

type Internals = { locateDiagnostic(id: string): void }
type GateFn = (...args: unknown[]) => { canCommit: boolean; reason: string; failedChecks: string[] }

function makeHost(): { h: DocumentUtilityOverlayHost; shell: HTMLElement; write: HTMLElement } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  return { h, shell, write }
}

function injectSnapshotMulti(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>): void {
  const snapshot = {
    documentKey: 'doc:key',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: diags,
    errorCount: diags.filter(d => d.severity === 'error').length,
    warningCount: diags.filter(d => d.severity === 'warning').length,
    infoCount: 0,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen for the transaction test */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}
function injectSnapshot(h: DocumentUtilityOverlayHost, diag: Record<string, unknown>): void {
  injectSnapshotMulti(h, [diag])
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

function tableDiag(id = 'T1'): Record<string, unknown> {
  return diagOf(id, 'TABLE_MISSING_NAME', { kind: 'block-node', blockKind: 'table', stableIdentity: 'block:table:0' })
}
function codeDiag(id = 'C1'): Record<string, unknown> {
  return diagOf(id, 'CODE_MISSING_NAME', { kind: 'block-node', blockKind: 'code', stableIdentity: 'block:code:0' })
}

async function clickLocate(h: DocumentUtilityOverlayHost, id: string): Promise<void> {
  ;(h as unknown as Internals).locateDiagnostic(id)
  await flushRaf()
}

/** ARM a single PHASE_A occlusion failure per locate transaction. */
function armOcclusionOncePerTx(host: DocumentUtilityOverlayHost): { reset: () => void } {
  const self = host as unknown as Record<string, unknown>
  const real = (self.evaluateLocateCommitGate as GateFn).bind(host)
  let calls = 0
  vi.spyOn(self as { evaluateLocateCommitGate: GateFn }, 'evaluateLocateCommitGate').mockImplementation((...args: unknown[]) => {
    calls++
    if (calls === 1) {
      return { canCommit: false, reason: 'TARGET_NOT_FULLY_UNOBSCURED', failedChecks: ['TARGET_NOT_FULLY_UNOBSCURED'] }
    }
    return real(...args)
  })
  return { reset: () => { calls = 0 } }
}

// ── console audit parsing ──────────────────────────────────────────────────
type AuditParse = Record<string, string>
type InfoSpy = { mock: { calls: unknown[][] }; mockRestore: () => void }
function readAudit(spy: InfoSpy, event: string, nth = 0): AuditParse | null {
  const lines = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes(event))
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
/** The Drawer was really RE-OPENED by the user (Problems Control OPEN intent). */
function countDrawerUserOpens(spy: InfoSpy): number {
  return spy.mock.calls
    .map(c => String(c[0]))
    .filter(l => l.includes('DOCUMENT-UTILITY-DRAWER') && l.includes('action=OPEN'))
    .length
}

const ONSCREEN: Rect = { left: 200, top: 200, right: 900, bottom: 400 }
const DRAWER_RECT: Rect = { left: 980, top: 40, right: 1180, bottom: 760 }

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

/** A WIDE editor + a rendered, non-zero Drawer: the §9 real-world viewport. */
function renderWideDrawer(mounted: ReturnType<typeof makeHost>): HTMLElement {
  stubRect(mounted.write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const drawer = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')
  expect(drawer).toBeTruthy()
  stubRect(drawer!, () => DRAWER_RECT)
  return drawer!
}

function openDrawerViaProblemsControl(): void {
  const btn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')
  expect(btn).toBeTruthy()
  btn!.click()
}

function expectAllR3GatesZero(h: DocumentUtilityOverlayHost): void {
  const counters = h.getDrawerPersistenceCounters()
  for (const key of Object.keys(counters)) expect(counters[key], key).toBe(0)
}

// ── R3-1 / R3-2 ────────────────────────────────────────────────────────────
describe('R3-1/2 — WIDE viewport + requested-open Drawer survives the locate', () => {
  it('R3-1: PHASE_A locate-collapse → PHASE_B restore → COMMITTED with the Drawer OPEN', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()
    expect(host.getDrawerRequestedOpen()).toBe(true)
    expect(host.getDrawerPresentationMode()).toBe('open')

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')

    // ── §16 — the terminal persistence audit is the R3 evidence ──────────────
    const audit = host.getLastDrawerPersistenceAudit()
    expect(audit, 'persistence audit').not.toBeNull()
    expect(audit!.terminalState).toBe('COMMITTED')
    expect(audit!.drawerRequestedOpenAtStart).toBe(true)
    expect(audit!.drawerRequestedOpenAtFinal).toBe(true)
    expect(audit!.presentationBeforeLocate).toBe('open')
    expect(audit!.presentationDuringLocate).toBe('locate-collapse')
    expect(audit!.drawerViewportClass).toBe('WIDE')
    // ── §7/§8 — PHASE A really ran the transient collapse. ───────────────────
    expect(audit!.restoreRequired).toBe(true)
    expect(audit!.restoreStarted).toBe(true)
    expect(audit!.restoreSettled).toBe(true)
    expect(audit!.remeasuredAfterRestore).toBe(true)
    expect(audit!.repaintedAfterRestore).toBe(true)
    // ── §11 — the FINAL presentation is the user-requested one. ──────────────
    expect(audit!.presentationAfterRestore).toBe('open')
    expect(audit!.presentationAtFinalCommit).toBe('open')
    expect(audit!.drawerRenderedVisibleAtFinalCommit).toBe(true)
    // ── §6 — the recovery lease NEVER survives the FINAL COMMIT. ─────────────
    expect(audit!.drawerLocateRecoveryLeaseActive).toBe(false)
    expect(audit!.drawerLocateRecoveryLeaseReleased).toBe(true)
    // ── §14 — selection / filter / list context preserved. ───────────────────
    expect(audit!.selectedDiagnosticPreserved).toBe(true)
    expect(audit!.selectedDiagnosticRowId).toBe('T1')
    expect(audit!.filterPreserved).toBe(true)
    expect(audit!.drawerScrollContextPreserved).toBe(true)
    expect(audit!.decision).toBe('PASS')

    // The REAL host state matches the audit (never audit-only theatre).
    expect(host.getDrawerPresentationMode()).toBe('open')
    expect(host.getDrawerRecoveryLeaseActive()).toBe(false)
    const drawer = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')!
    expect(drawer.hasAttribute('data-locate-collapsed')).toBe(false)
    expect(drawer.hasAttribute('data-locate-compact')).toBe(false)
    expect(host.isLocateTransactionActive()).toBe(false)
    expectAllR3GatesZero(host)

    // §19 — the audit is a real console stream with the exact gate report.
    expect(readAudit(infoSpy!, DRAWER_PERSISTENCE_AUDIT_EVENT)).not.toBeNull()
    expect(host.getDrawerPersistenceGateReport()).toHaveLength(DRAWER_PERSISTENCE_V512R3_GATE_KEYS.length)
  })

  it('R3-2: the restore chain really re-derived the geometry (settle → remeasure → repaint)', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')

    const audit = host.getLastDrawerPersistenceAudit()!
    expect(audit.restoreSettled).toBe(true)
    expect(audit.remeasuredAfterRestore).toBe(true)
    expect(audit.repaintedAfterRestore).toBe(true)
    expect(audit.postRestoreCoverageRatio).toBeNull() // headless: not asserted
    expect(audit.postRestorePanelOverlayIntersectionCount).toBe(0)
    expect(audit.postRestorePanelGeometryClipCount).toBe(0)
    expect(audit.postRestoreLayoutEpochCurrent).toBe(true)
    expect(audit.drawerCompactAttempts).toBe(0) // WIDE needs no compact fallback
    expectAllR3GatesZero(host)
  })
})

// ── R3-3 ───────────────────────────────────────────────────────────────────
describe('R3-3 — Code/Table continuous switching never needs a manual Drawer reopen', () => {
  it('R3-3: locate Code/Table 3x in a row — Drawer stays OPEN, one user open only', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table><pre class="md-fences"></pre>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const code = mounted.write.querySelector('pre') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    stubRect(code, () => ({ left: 200, top: 420, right: 800, bottom: 520 }))
    injectSnapshotMulti(host, [codeDiag('C1'), tableDiag('T1')])
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()

    const arm = armOcclusionOncePerTx(host)
    const sequence = ['C1', 'T1', 'C1', 'T1']
    for (const id of sequence) {
      arm.reset()
      await clickLocate(host, id)
      const audit = host.getLastDrawerPersistenceAudit()
      expect(audit, `audit after ${id}`).not.toBeNull()
      expect(audit!.terminalState, id).toBe('COMMITTED')
      expect(audit!.decision, id).toBe('PASS')
      expect(audit!.presentationAtFinalCommit, id).toBe('open')
      expect(audit!.drawerRenderedVisibleAtFinalCommit, id).toBe(true)
      expect(audit!.drawerLocateRecoveryLeaseActive, id).toBe(false)
      expect(audit!.restoreStarted, id).toBe(true)
      // The user intent is never lost and identity follows the clicked row.
      expect(host.getDrawerRequestedOpen(), id).toBe(true)
      expect(host.getDrawerPresentationMode(), id).toBe('open')
      expect(host.getDrawerRecoveryLeaseActive(), id).toBe(false)
      expect(audit!.selectedDiagnosticRowId, id).toBe(id)
    }
    // §19 — the user opened the Drawer ONCE and never had to reopen it.
    expect(countDrawerUserOpens(infoSpy!)).toBe(1)
    const drawer = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')!
    expect(drawer.hasAttribute('data-locate-collapsed')).toBe(false)
    expect(drawer.style.display).toBe('flex')
    expectAllR3GatesZero(host)
  })
})

// ── R3-4 ───────────────────────────────────────────────────────────────────
describe('R3-4 — a Drawer that was NOT requested open is never auto-reopened', () => {
  it('R3-4: drawerRequestedOpen=false → terminal presentation stays closed', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())
    renderWideDrawer(mounted)
    expect(host.getDrawerRequestedOpen()).toBe(false)

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')

    const audit = host.getLastDrawerPersistenceAudit()!
    expect(audit.drawerRequestedOpenAtStart).toBe(false)
    expect(audit.drawerRequestedOpenAtFinal).toBe(false)
    expect(audit.presentationAtFinalCommit).toBe('closed')
    expect(audit.decision).toBe('PASS')
    // The newest intent wins: no auto reopen, and no transient collapse left.
    expect(host.getDrawerRequestedOpen()).toBe(false)
    expect(host.getDrawerPresentationMode()).toBe('closed')
    expect(host.getDrawerRecoveryLeaseActive()).toBe(false)
    expect(countDrawerUserOpens(infoSpy!)).toBe(0)
    const drawer = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')!
    expect(drawer.hasAttribute('data-locate-collapsed')).toBe(false)
    expectAllR3GatesZero(host)
  })
})

// ── R3-5 / R3-6 ────────────────────────────────────────────────────────────
describe('R3-5/6 — DrawerLocateRecoveryLease vs ActiveLocateVisualLease lifetimes', () => {
  it('R3-5: the recovery lease is released at COMMIT while the active visual lease is held', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')

    // DECOUPLED: recovery lease gone, active visual lease still protecting the
    // committed highlight — the R2 coupling bug (ROOT_R3_1/2/3) is provable here.
    expect(host.getDrawerRecoveryLeaseActive()).toBe(false)
    expect(host.getLocateVisibilityLeaseActive()).toBe(true)
    expect(host.getLastDrawerPersistenceAudit()!.activeLocateVisualLeaseActive).toBe(true)
    expectAllR3GatesZero(host)
  })

  it('R3-6: ending the active visual (new diagnostic) releases the ActiveLocateVisualLease', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table><pre class="md-fences"></pre>'
    const table = mounted.write.querySelector('table') as HTMLElement
    const code = mounted.write.querySelector('pre') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    stubRect(code, () => ({ left: 200, top: 420, right: 800, bottom: 520 }))
    injectSnapshotMulti(host, [codeDiag('C1'), tableDiag('T1')])
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')
    expect(host.getLocateVisibilityLeaseActive()).toBe(true)

    arm.reset()
    await clickLocate(host, 'C1')
    // The previous visual ended → its lease was released (proved by the audit),
    // and a fresh lease protects the NEW committed visual.
    const releaseAudit = readAudit(infoSpy!, 'DOCUMENT-DIAGNOSTIC-ACTIVE-VISUAL-LEASE-AUDIT')
    expect(releaseAudit).not.toBeNull()
    expect(releaseAudit!.released).toBe('true')
    expect(releaseAudit!.reason).toContain('VISUAL_CLEARED')
    expect(host.getLocateVisibilityLeaseActive()).toBe(true)
    expect(host.getDrawerPresentationMode()).toBe('open')
    expectAllR3GatesZero(host)
  })
})

// ── R3-7 ───────────────────────────────────────────────────────────────────
describe('R3-7 — pure contract: viewport class / restore decision / fidelity gates', () => {
  it('R3-7a: viewport classes honour the §9 thresholds', () => {
    expect(resolveDrawerViewportClass({ editorAvailableWidth: DRAWER_WIDE_MIN_AVAILABLE_PX, drawerWidth: 300, semanticTargetWidth: 700 })).toBe('WIDE')
    expect(resolveDrawerViewportClass({ editorAvailableWidth: DRAWER_WIDE_MIN_AVAILABLE_PX - 1, drawerWidth: 300, semanticTargetWidth: 700 })).toBe('MEDIUM')
    expect(resolveDrawerViewportClass({ editorAvailableWidth: DRAWER_MEDIUM_MIN_AVAILABLE_PX - 1, drawerWidth: 300, semanticTargetWidth: 700 })).toBe('TOO_NARROW')
    expect(resolveDrawerViewportClass({ editorAvailableWidth: 300, drawerWidth: 300, semanticTargetWidth: 700 })).toBe('TOO_NARROW')
    // A narrow viewport with a tiny target still fits → MEDIUM, never collapse.
    expect(resolveDrawerViewportClass({ editorAvailableWidth: 300, drawerWidth: 300, semanticTargetWidth: 0 })).toBe('MEDIUM')
  })

  it('R3-7b: a transient collapse is never terminal while the Drawer is requested open', () => {
    expect(resolveDrawerRestoreRequired({ drawerRequestedOpenAtStart: true, newestIntentOpen: true, locateCollapseActive: true }))
      .toEqual({ restoreRequired: true, releaseWithoutRestore: false })
    expect(resolveDrawerRestoreRequired({ drawerRequestedOpenAtStart: true, newestIntentOpen: false, locateCollapseActive: true }))
      .toEqual({ restoreRequired: false, releaseWithoutRestore: true })
    expect(resolveDrawerRestoreRequired({ drawerRequestedOpenAtStart: true, newestIntentOpen: true, locateCollapseActive: false }))
      .toEqual({ restoreRequired: false, releaseWithoutRestore: false })
  })

  it('R3-7c: the fidelity gate rejects every R3 terminal violation', () => {
    const base: DrawerPresentationFidelityInput = {
      drawerRequestedOpen: true,
      terminalState: 'COMMITTED',
      presentationAtFinalCommit: 'open',
      drawerLocateRecoveryLeaseActive: false,
      drawerLocateRecoveryLeaseReleased: true,
      drawerRenderedVisibleAtFinalCommit: true,
      viewportClass: 'WIDE',
      postRestoreCoverageRatio: 1,
      postRestorePanelOverlayIntersectionCount: 0,
      postRestorePanelGeometryClipCount: 0,
      postRestoreLayoutEpochCurrent: true,
      selectedDiagnosticPreserved: true,
      filterPreserved: true,
    }
    expect(evaluateDrawerPresentationFidelity(base).decision).toBe('PASS')
    // V5.12-R9 §5/§6 — a PURE overlay intersection on a full-coverage target is
    // an EXPECTED overlay occlusion: PASS with the explicit reason.
    expect(evaluateDrawerPresentationFidelity({ ...base, postRestorePanelOverlayIntersectionCount: 1 }))
      .toEqual({ decision: 'PASS', reason: 'EXPECTED_DRAWER_OVERLAY_OCCLUSION', failedChecks: [] })

    const cases: Array<[string, Partial<DrawerPresentationFidelityInput>, string]> = [
      ['lease held', { drawerLocateRecoveryLeaseActive: true, drawerLocateRecoveryLeaseReleased: false }, 'COMMITTED_WITH_DRAWER_RECOVERY_LEASE_HELD'],
      ['terminal collapse', { presentationAtFinalCommit: 'locate-collapse' }, 'TERMINAL_LOCATE_COLLAPSE_WHILE_DRAWER_REQUESTED_OPEN'],
      ['hidden after commit', { drawerRenderedVisibleAtFinalCommit: false }, 'DRAWER_REQUESTED_OPEN_BUT_HIDDEN_AFTER_COMMIT'],
      ['coverage', { postRestoreCoverageRatio: 0.9 }, 'POST_RESTORE_COVERAGE_LT_098'],
      ['geometry clip', { postRestorePanelGeometryClipCount: 1 }, 'POST_RESTORE_PANEL_GEOMETRY_CLIP'],
      ['presentation drift', { presentationDriftedDuringRestore: true }, 'DRAWER_PRESENTATION_DRIFT_DURING_RESTORE'],
      ['snapshot mismatch', { finalSnapshotEpochCurrent: false }, 'FINAL_REASON_SNAPSHOT_MISMATCH'],
      ['selection', { selectedDiagnosticPreserved: false }, 'DRAWER_SELECTED_DIAGNOSTIC_LOST_AFTER_RESTORE'],
      ['filter', { filterPreserved: false }, 'DRAWER_FILTER_LOST_AFTER_RESTORE'],
    ]
    for (const [label, override, expected] of cases) {
      const decision = evaluateDrawerPresentationFidelity({ ...base, ...override })
      expect(decision.decision, label).toBe('FAIL')
      expect(decision.failedChecks, label).toContain(expected)
    }
    // A newer USER CLOSE intent must never end with the Drawer open.
    const autoReopen = evaluateDrawerPresentationFidelity({ ...base, drawerRequestedOpen: false, presentationAtFinalCommit: 'open' })
    expect(autoReopen.decision).toBe('FAIL')
    expect(autoReopen.failedChecks).toContain('AUTO_REOPEN_AFTER_NEWER_USER_CLOSE_INTENT')
  })

  it('R3-7d: the §18 hard gates (16 + the 8 V5.12-R9 gates) report exactly and PASS when clean', () => {
    // V5.12-R9 §5 — `postRestorePanelIntersection` was SPLIT: the overlay count is
    // reported but NOT fatal, the geometry clip is the fatal gate; the 8 R9
    // locate-COMMIT-then-restore ordering gates were added.
    expect(DRAWER_PERSISTENCE_V512R3_GATE_KEYS).toHaveLength(24)
    expect(DRAWER_PERSISTENCE_V512R3_GATE_KEYS).not.toContain('postRestorePanelIntersection' as never)
    expect(DRAWER_PERSISTENCE_V512R3_GATE_KEYS).toContain('postRestorePanelGeometryClip')
    for (const label of [
      'RESTORE_BEFORE_LOCATE_COMMIT_COUNT',
      'DRAWER_PRESENTATION_DRIFT_DURING_RESTORE_COUNT',
      'STALE_PRE_RESTORE_GEOMETRY_USED_FOR_FINAL_GATE_COUNT',
      'POST_RESTORE_FULL_COVERAGE_PANEL_INTERSECTION_FATAL_COUNT',
      'POST_RESTORE_SEMANTIC_COVERAGE_LT_098_COUNT',
      'POST_RESTORE_VISUAL_PAINTS_ABOVE_DRAWER_COUNT',
      'FINAL_REASON_SNAPSHOT_MISMATCH_COUNT',
      'LOCATE_COMMITTED_THEN_RETROACTIVELY_FAILED_BY_DRAWER_COUNT',
    ]) {
      expect(Object.values(DRAWER_PERSISTENCE_V512R3_GATE_LABELS)).toContain(label)
    }
    const counters = createDrawerPersistenceV512R3Counters()
    const report = formatDrawerPersistenceGateReport(counters)
    expect(report).toHaveLength(24)
    for (const key of DRAWER_PERSISTENCE_V512R3_GATE_KEYS) {
      expect(report).toContain(`${DRAWER_PERSISTENCE_V512R3_GATE_LABELS[key]}=0`)
    }
    expect(evaluateDrawerPersistenceGates(counters)).toEqual({ decision: 'PASS', failing: [] })
    const dirty = { ...counters, drawerRequestedOpenButHiddenAfterCommit: 1 }
    expect(evaluateDrawerPersistenceGates(dirty).decision).toBe('FAIL')
  })

  it('R3-7e: deriveDrawerPresentation keeps intent and presentation separate', () => {
    expect(deriveDrawerPresentation(false, true, true)).toBe('closed')
    expect(deriveDrawerPresentation(true, false, false)).toBe('open')
    expect(deriveDrawerPresentation(true, true, false)).toBe('locate-collapse')
    expect(deriveDrawerPresentation(true, false, true)).toBe('compact-docked')
  })
})

// ── V5.12-R9 — locate COMMIT then Drawer restore ───────────────────────────

describe('R9 — locate COMMIT always precedes the Drawer restore', () => {
  it('R9-ORDER-1: a full-coverage overlay occlusion commits with the explicit reason; only a clip fails', () => {
    // §5/§6 — EXPECTED overlay occlusion.
    const overlay = canCommitLocateVisual({
      semanticResolvePass: true, scrollArrivalPass: true, targetConnected: true,
      freshTargetMeasurement: true, layoutEpochCurrent: true, presentationBuilt: true,
      visualCarrierPresent: true,
      // the target is painted over by the Drawer but its geometry is COMPLETE
      targetFullyUnobscured: true,
      panelIntersectionCount: 1, panelOverlayIntersectionCount: 1, panelGeometryClipCount: 0,
      framePaintsAboveDrawer: false, framePaintsAboveToolbar: false, framePaintsAboveNavigator: false,
      coverageRatio: 1, inlineFragmentCoverage: null, blockCoverage: null, staleGeometry: false,
    })
    expect(overlay).toEqual({ canCommit: true, reason: 'EXPECTED_DRAWER_OVERLAY_OCCLUSION', failedChecks: [] })
    // §7 — a REAL clip still blocks, and so do the coverage / paint-above failures.
    const clipped = canCommitLocateVisual({
      semanticResolvePass: true, scrollArrivalPass: true, targetConnected: true,
      freshTargetMeasurement: true, layoutEpochCurrent: true, presentationBuilt: true,
      visualCarrierPresent: true, targetFullyUnobscured: false,
      panelIntersectionCount: 1, panelOverlayIntersectionCount: 1, panelGeometryClipCount: 1,
      framePaintsAboveDrawer: false, framePaintsAboveToolbar: false, framePaintsAboveNavigator: false,
      coverageRatio: 1, inlineFragmentCoverage: null, blockCoverage: null, staleGeometry: false,
    })
    expect(clipped.canCommit).toBe(false)
    expect(clipped.failedChecks).toContain('PANEL_GEOMETRY_CLIP')
    for (const bad of [
      { coverageRatio: 0.97 }, { framePaintsAboveDrawer: true }, { layoutEpochCurrent: false },
    ]) {
      const r = canCommitLocateVisual({
        semanticResolvePass: true, scrollArrivalPass: true, targetConnected: true,
        freshTargetMeasurement: true, layoutEpochCurrent: true, presentationBuilt: true,
        visualCarrierPresent: true, targetFullyUnobscured: true,
        panelIntersectionCount: 1, panelOverlayIntersectionCount: 1, panelGeometryClipCount: 0,
        framePaintsAboveDrawer: false, framePaintsAboveToolbar: false, framePaintsAboveNavigator: false,
        coverageRatio: 1, inlineFragmentCoverage: null, blockCoverage: null, staleGeometry: false,
        ...bad,
      })
      expect(r.canCommit, JSON.stringify(bad)).toBe(false)
    }
  })

  it('R9-ORDER-2: the host commits the locate BEFORE restoring the Drawer', async () => {
    const mounted = makeHost()
    host = mounted.h
    mounted.write.innerHTML = '<table><tr><td>x</td></tr></table>'
    const table = mounted.write.querySelector('table') as HTMLElement
    stubRect(table, () => ({ ...ONSCREEN }))
    injectSnapshot(host, tableDiag())
    renderWideDrawer(mounted)
    openDrawerViaProblemsControl()

    const arm = armOcclusionOncePerTx(host)
    arm.reset()
    await clickLocate(host, 'T1')

    const audit = host.getLastDrawerPersistenceAudit()!
    // §1/§2 — the locate was really committed, and the restore ran afterwards.
    expect(audit.terminalState).toBe('COMMITTED')
    expect(audit.locateCommittedThisTransaction).toBe(true)
    expect(audit.restoreRanBeforeLocateCommit).toBe(false)
    expect(audit.restoreStarted).toBe(true)
    expect(audit.presentationAtFinalCommit).toBe('open')
    expect(audit.drawerRenderedVisibleAtFinalCommit).toBe(true)
    expect(audit.decision).toBe('PASS')
    // §5/§7 — the split panel gates: the overlay count may be reported, the clip
    // count is the ONLY fatal one, and every R9 gate stays 0.
    expect(audit.postRestorePanelGeometryClipCount).toBe(0)
    expect(audit.postRestorePanelOverlayIntersectionCount).toBe(0)
    const counters = host.getDrawerPersistenceCounters()
    for (const label of [
      'restoreBeforeLocateCommit',
      'drawerPresentationDriftDuringRestore',
      'stalePreRestoreGeometryUsedForFinalGate',
      'postRestoreFullCoveragePanelIntersectionFatal',
      'postRestoreSemanticCoverageLt098',
      'postRestoreVisualPaintsAboveDrawer',
      'finalReasonSnapshotMismatch',
      'locateCommittedThenRetroactivelyFailedByDrawer',
    ] as const) {
      expect(counters[label], label).toBe(0)
    }
    expectAllR3GatesZero(host)
    // The Drawer is still the user's OPEN Drawer (never permanently collapsed).
    expect(host.getDrawerPresentationMode()).toBe('open')
    expect(document.querySelector('.inkchapter-doc-drawer')!.hasAttribute('data-locate-collapsed')).toBe(false)
  })
})
