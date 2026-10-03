// @vitest-environment jsdom
/**
 * Document Diagnostics Drawer Viewport Stability V1.
 *
 * EDITOR_SCROLL_OWNER != DIAGNOSTICS_DRAWER_SCROLL_OWNER: a diagnostic-row click
 * may scroll the EDITOR but must NEVER move the Drawer. ACTIVE-only updates
 * (first click / deactivate / A→B switch) are an ACTIVE_PATCH on the EXISTING row
 * nodes — never a structural rebuild; a true STRUCTURAL_RENDER captures the
 * viewport first and restores the visible anchor (+ offset) afterwards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'
import {
  evaluateDrawerActiveClickFacts,
  evaluateDrawerViewportV1Gates,
  firstVisibleRowIndex,
  resolveDrawerUpdateMode,
  resolveViewportRestore,
  createDrawerViewportV1Counters,
  formatDrawerViewportV1GateReport,
  type DrawerRowRect,
} from './document-diagnostic-drawer-viewport-v1'

// ── pure module ─────────────────────────────────────────────────────────────

describe('Drawer Viewport V1 — pure authority', () => {
  it('§16 — ACTIVE_PATCH when the projection signature is unchanged', () => {
    const base = {
      projectionSignature: 'sig',
      documentKey: 'd',
      filter: 'all',
      listHasRows: true,
    }
    expect(resolveDrawerUpdateMode({ previousSignature: 'sig', facts: base }).mode).toBe('ACTIVE_PATCH')
    expect(resolveDrawerUpdateMode({ previousSignature: 'other', facts: base }).mode).toBe('STRUCTURAL_RENDER')
    expect(resolveDrawerUpdateMode({ previousSignature: 'sig', facts: { ...base, listHasRows: false } }).mode)
      .toBe('STRUCTURAL_RENDER')
    expect(resolveDrawerUpdateMode({ previousSignature: null, facts: base }).mode).toBe('STRUCTURAL_RENDER')
  })

  it('§15 — firstVisibleRowIndex picks the row straddling the scroll offset', () => {
    const rows: DrawerRowRect[] = [0, 40, 80, 120].map((top, i) => ({
      projectionKey: `k${i}`, diagnosticId: `d${i}`, offsetTop: top, height: 38,
    }))
    expect(firstVisibleRowIndex(rows, 0)).toBe(0)
    expect(firstVisibleRowIndex(rows, 41)).toBe(1)
    expect(firstVisibleRowIndex(rows, 100)).toBe(2)
    expect(firstVisibleRowIndex([], 100)).toBe(-1)
  })

  it('§13 — restore priority: exact key → same diagnostic → surviving row → scrollTop', () => {
    const rows: DrawerRowRect[] = [
      { projectionKey: 'a#0', diagnosticId: 'a', offsetTop: 0, height: 40 },
      { projectionKey: 'b#0', diagnosticId: 'b', offsetTop: 40, height: 40 },
      { projectionKey: 'c#0', diagnosticId: 'c', offsetTop: 80, height: 40 },
    ]
    const saved = { scrollTop: 45, firstVisibleDiagnosticId: 'b', firstVisibleProjectionKey: 'b#0', firstVisibleOffsetPx: 5, filter: 'all' }
    expect(resolveViewportRestore(saved, rows).strategy).toBe('PROJECTION_KEY')
    expect(resolveViewportRestore(saved, rows).targetScrollTop).toBe(35)
    // no exact key but the same diagnostic survives
    expect(resolveViewportRestore(saved, rows.filter(r => r.diagnosticId !== 'b')).strategy).toBe('NEXT_SURVIVING')
    // nothing survives → bounded scrollTop fallback
    expect(resolveViewportRestore(saved, []).strategy).toBe('SCROLL_TOP_FALLBACK')
  })

  it('§30 — a stable active click produces ZERO gate violations', () => {
    const partial = evaluateDrawerActiveClickFacts({
      action: 'ACTIVATE', updateMode: 'ACTIVE_PATCH',
      scrollTopBefore: 300, scrollTopAfter: 300,
      firstVisibleDiagnosticIdBefore: 'd8', firstVisibleDiagnosticIdAfter: 'd8',
      firstVisibleOffsetBefore: 12, firstVisibleOffsetAfter: 12,
      clickedRowRemounted: false, scrollContainerRemounted: false,
      rowScrollIntoViewCalled: false, focusCausedScroll: false, activeRowHeightChanged: false,
    })
    expect(partial).toEqual({})
  })

  it('§30 — every violation maps to its OWN gate', () => {
    expect(evaluateDrawerActiveClickFacts({
      action: 'ACTIVATE', updateMode: 'STRUCTURAL_RENDER',
      scrollTopBefore: 300, scrollTopAfter: 0,
      firstVisibleDiagnosticIdBefore: 'd8', firstVisibleDiagnosticIdAfter: 'd1',
      firstVisibleOffsetBefore: 12, firstVisibleOffsetAfter: 0,
      clickedRowRemounted: true, scrollContainerRemounted: true,
      rowScrollIntoViewCalled: true, focusCausedScroll: true, activeRowHeightChanged: true,
    })).toEqual({
      drawerStructuralRerenderOnActiveOnlyChange: 1,
      drawerScrollTopChangedOnActiveClick: 1,
      drawerViewportAnchorChangedOnActiveClick: 1,
      drawerViewportOffsetDriftGt1px: 1,
      drawerForcedScrollIntoViewOnDiagnosticClick: 1,
      drawerFocusCausedScroll: 1,
      drawerClickedRowRemountOnActiveClick: 1,
      drawerScrollContainerRemountOnActiveClick: 1,
      drawerActiveStateRowHeightChange: 1,
    })
    expect(formatDrawerViewportV1GateReport(createDrawerViewportV1Counters()))
      .toContain('DRAWER_SCROLL_TOP_CHANGED_ON_ACTIVE_CLICK_COUNT=0')
    expect(evaluateDrawerViewportV1Gates(createDrawerViewportV1Counters()).decision).toBe('PASS')
  })
})

// ── host harness ────────────────────────────────────────────────────────────

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
    getClientRects: () => rects.map(r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top })),
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

type Internals = {
  locateDiagnostic(id: string, targetIndex?: number): void
  renderDrawer(): void
  openDrawer(filter?: string): void
}
type HostApi = {
  renderHeadingDiagnosticMarkers(): void
  getDiagnosticInteractionStateV2(): { phase: string; diagnosticId: string | null; diagnosticTargetIndex: number | null }
  getDrawerViewportV1GateReport(): string[]
  getDrawerViewportV1GateDecision(): { decision: 'PASS' | 'FAIL'; failedChecks: readonly string[] }
  getDrawerViewportV1CoverageReport(): string[]
  getDrawerViewportV1AuditFacts(): Record<string, unknown>
  getDrawerRowMountGeneration(): number
  getInternalBlankLineV1GateReport(): string[]
  getInternalBlankLineV1CoverageReport(): string[]
  getInternalBlankLineV1GateDecision(): { decision: 'PASS' | 'FAIL'; failing: readonly string[] }
}
let host: DocumentUtilityOverlayHost | null = null
let infoSpy: { mock: { calls: unknown[][] }; mockRestore: () => void } | null = null

/** Emulate the Drawer row layout on the PROTOTYPE so newly created rows inherit it. */
function installRowLayoutEmulation(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement): number {
      if (!this.classList.contains('inkchapter-doc-drawer__item')) return 0
      const parent = this.parentElement
      if (!parent) return 0
      const sibs = Array.from(parent.children).filter(c => c.classList.contains('inkchapter-doc-drawer__item'))
      return Math.max(0, sibs.indexOf(this)) * 40
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.classList.contains('inkchapter-doc-drawer__item') ? 36 : 0
    },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  stubRaf()
  installRowLayoutEmulation()
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  stubRangeRects([{ left: 200, top: 204, right: 420, bottom: 228 }])
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}) as unknown as { mock: { calls: unknown[][] }; mockRestore: () => void }
})
afterEach(() => {
  infoSpy?.mockRestore()
  infoSpy = null
  host?.dispose()
  host = null
  vi.unstubAllGlobals()
})

/** Parse the LAST emitted `<event>` audit line into a key=value map. */
function lastAudit(event: string): Record<string, string> {
  const lines = (infoSpy?.mock.calls ?? []).map(c => String(c[0] ?? '')).filter(l => l.includes(event))
  const line = lines[lines.length - 1] ?? ''
  const body = line.slice(line.indexOf(event) + event.length).replace(/^:\s*/, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g)) out[m[1]] = m[2]
  return out
}

interface World { h: DocumentUtilityOverlayHost; ids: string[]; list: HTMLElement; setScrollTop: (v: number) => void; getScrollTop: () => number }

/** A 20-row Drawer that REALLY scrolls (emulated layout: 20 × 40px rows, 280px viewport). */
function makeScrollableWorld(rowCount = 20): World {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  stubRect(shell, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const write = document.createElement('div')
  write.id = 'write'
  shell.appendChild(write)
  document.body.appendChild(shell)
  stubRect(write, () => ({ left: 0, top: 0, right: 1200, bottom: 800 }))
  const ids: string[] = []
  for (let i = 0; i < rowCount; i++) {
    const el = document.createElement(i === 0 ? 'h1' : 'h2')
    el.setAttribute('data-id', `H-${i}`)
    el.setAttribute('data-line', String(4 + i * 3))
    el.textContent = `标题 ${i}`
    write.appendChild(el)
    // Keep every heading INSIDE the visible editor viewport so the locate commits
    // without a real scroll (the Drawer is what this suite measures).
    stubRect(el, () => ({ left: 100, top: 100 + (i % 4) * 60, right: 700, bottom: 132 + (i % 4) * 60 }))
    ids.push(`H-${i}`)
  }
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  const list = document.querySelector<HTMLElement>('.inkchapter-doc-drawer__list')!
  let top = 0
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => rowCount * 40 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 280 })
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(Math.max(0, rowCount * 40 - 280), v)) },
  })
  return { h, ids, list, setScrollTop: (v: number) => { top = Math.max(0, Math.min(Math.max(0, rowCount * 40 - 280), v)) }, getScrollTop: () => top }
}

function diagFor(id: string, index: number, stableIdentity: string): Record<string, unknown> {
  const severity = index % 3 === 0 ? 'error' : index % 3 === 1 ? 'warning' : 'info'
  return {
    id, domain: 'document', documentKey: 'doc:key', severity,
    category: 'heading', code: 'HEADING_LEVEL_GAP', message: `问题 ${index}`, detail: '',
    stableIdentity, metadata: {},
    location: { kind: 'canonical-node', nodeKind: 'heading', stableIdentity },
  }
}

function inject(h: DocumentUtilityOverlayHost, diags: Array<Record<string, unknown>>, revision = 1): void {
  const snapshot = {
    documentKey: 'doc:key', revision, sourceRevision: revision, generatedAt: 0,
    diagnostics: diags,
    errorCount: diags.filter(d => d.severity === 'error').length,
    warningCount: diags.filter(d => d.severity === 'warning').length,
    infoCount: diags.filter(d => d.severity === 'info').length,
  } as unknown as DocumentDiagnosticsSnapshot
  const authority = (h as unknown as { diagnostics: { snapshot: DocumentDiagnosticsSnapshot | null; recompute: (r: string) => void } }).diagnostics
  authority.snapshot = snapshot
  authority.recompute = () => { /* frozen */ }
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot }).snapshot = snapshot
}

const api = (): HostApi => host as unknown as HostApi
const click = async (h: DocumentUtilityOverlayHost, id: string, targetIndex?: number): Promise<void> => {
  ;(h as unknown as Internals).locateDiagnostic(id, targetIndex)
  await flushRaf()
}
const rows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
const STRUCTURAL_AUDIT = 'DOCUMENT-DIAGNOSTIC-DRAWER-STRUCTURAL-RENDER-AUDIT'

async function openScrollableDrawer(rowCount = 20): Promise<World> {
  const w = makeScrollableWorld(rowCount)
  host = w.h
  inject(host, Array.from({ length: rowCount }, (_, i) => diagFor(`dg-${i}`, i, w.ids[i])))
  api().renderHeadingDiagnosticMarkers()
  ;(host as unknown as Internals).openDrawer('all')
  await flushRaf()
  w.setScrollTop(300)
  return w
}

// ── host gates ──────────────────────────────────────────────────────────────

describe('Drawer Viewport V1 — ACTIVE_PATCH on active-only clicks', () => {
  it('R1 §8/§9/§27 — first click keeps scrollTop, keeps the clicked row element, no remount', async () => {
    const w = await openScrollableDrawer()
    const before = w.getScrollTop()
    const clicked = rows()[8]
    const genBefore = api().getDrawerRowMountGeneration()

    await click(host!, 'dg-8')

    expect(api().getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
    expect(w.getScrollTop()).toBe(before)
    // §27 — the clicked row is the SAME DOM node and the container was not remounted.
    expect(rows()[8]).toBe(clicked)
    expect(rows()[8].isConnected).toBe(true)
    expect(api().getDrawerRowMountGeneration()).toBe(genBefore)
    // §16 — an active-only change is an ACTIVE_PATCH, never a structural render.
    const audit = api().getDrawerViewportV1AuditFacts()
    expect(audit.updateMode).toBe('ACTIVE_PATCH')
    expect(audit.clickedRowRemounted).toBe(false)
    expect(audit.scrollContainerRemounted).toBe(false)
    expect(audit.rowScrollIntoViewCalled).toBe(false)
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
  })

  it('R2 §6 — deactivate keeps the Drawer viewport', async () => {
    const w = await openScrollableDrawer()
    await click(host!, 'dg-8')
    const before = w.getScrollTop()
    const rowEl = rows()[8]
    await click(host!, 'dg-8')
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('IDLE')
    expect(w.getScrollTop()).toBe(before)
    expect(rows()[8]).toBe(rowEl)
    expect(api().getDrawerViewportV1AuditFacts().action).toBe('DEACTIVATE')
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
  })

  it('R3 §6 — A→B switch keeps the Drawer viewport (row elements preserved)', async () => {
    const w = await openScrollableDrawer()
    await click(host!, 'dg-8')
    const before = w.getScrollTop()
    const rowA = rows()[8]
    const rowB = rows()[12]
    await click(host!, 'dg-12')
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe('dg-12')
    expect(w.getScrollTop()).toBe(before)
    expect(rows()[8]).toBe(rowA)
    expect(rows()[12]).toBe(rowB)
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
  })

  it('§9 §25 — a repeated identical render (reconcile) is ACTIVE_PATCH, never a rebuild', async () => {
    const w = await openScrollableDrawer()
    const clicked = rows()[8]
    w.setScrollTop(300)
    ;(host as unknown as Internals).renderDrawer()
    expect(rows()[8]).toBe(clicked)
    expect(w.getScrollTop()).toBe(300)
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
  })

  it('§9/§25 — row focus never scrolls the Drawer (forced preventScroll)', async () => {
    await openScrollableDrawer()
    const row = rows()[8]
    row.focus()
    expect(api().getDrawerViewportV1GateReport()).toContain('DRAWER_FOCUS_CAUSED_SCROLL_COUNT=0')
  })

  it('§9/§27 — a trapped row scrollIntoView is counted (never silently performed)', async () => {
    await openScrollableDrawer()
    const row = rows()[8]
    ;(row as unknown as { scrollIntoView: () => void }).scrollIntoView()
    expect(api().getDrawerViewportV1GateReport()).toContain('DRAWER_FORCED_SCROLL_INTO_VIEW_ON_DIAGNOSTIC_CLICK_COUNT=1')
  })

  it('§12 — an EXTERNAL detach/re-attach of the Drawer re-applies the viewport (no re-render)', async () => {
    const w = await openScrollableDrawer()
    // The user owns a mid-list viewport; a real `scroll` event records it.
    w.setScrollTop(300)
    w.list.dispatchEvent(new Event('scroll'))
    await Promise.resolve()
    const genBefore = api().getDrawerRowMountGeneration()
    const rowCountBefore = rows().length
    const clicked = rows()[8]

    // An EXTERNAL agent detaches + re-inserts the Drawer subtree (the framework
    // re-appends the overlay root's children). Re-inserting destroys the list
    // scroll box, which is exactly the runtime defect: scrollTop silently -> 0.
    const drawerEl = w.list.parentElement as HTMLElement
    const overlayRoot = drawerEl.parentElement as HTMLElement
    overlayRoot.removeChild(drawerEl)
    overlayRoot.appendChild(drawerEl)
    w.setScrollTop(0)
    // MutationObserver callbacks are microtasks → they run before paint.
    await Promise.resolve()
    await Promise.resolve()

    expect(w.getScrollTop()).toBe(300)
    // §16 — the repair is an ACTIVE_PATCH: no rebuild, same rows, same generation.
    expect(api().getDrawerRowMountGeneration()).toBe(genBefore)
    expect(rows().length).toBe(rowCountBefore)
    expect(rows()[8]).toBe(clicked)
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
  })

  it('§13 — restore passes on the SAVED anchor + offset, never on the first-visible probe', async () => {
    const w = await openScrollableDrawer()
    // A TALL row above the anchor legitimately straddles the viewport top once the
    // anchor is put back at offset 0 — the probe would classify THAT row as first.
    Object.defineProperty(rows()[0], 'offsetHeight', { configurable: true, value: 2000 })
    const restore = (host as unknown as {
      restoreDrawerViewport(s: unknown): { ok: boolean; actualScrollTop: number }
    }).restoreDrawerViewport({
      scrollTop: 320,
      firstVisibleDiagnosticId: 'dg-8',
      firstVisibleProjectionKey: 'dg-8#0',
      firstVisibleOffsetPx: 0,
      filter: 'all',
    })
    expect(w.getScrollTop()).toBe(320)
    expect(restore.ok).toBe(true)
  })

  it('§13 — a fallback restore (the anchor did not survive a row-set change) is NOT a failure', async () => {
    await openScrollableDrawer()
    const restore = (host as unknown as {
      restoreDrawerViewport(s: unknown): { ok: boolean; strategy: string }
    }).restoreDrawerViewport({
      scrollTop: 300,
      firstVisibleDiagnosticId: 'gone-id',
      firstVisibleProjectionKey: 'gone-id#0',
      firstVisibleOffsetPx: 0,
      filter: 'error',
    })
    expect(restore.strategy).not.toBe('PROJECTION_KEY')
    expect(restore.ok).toBe(true)
  })
})

describe('Drawer Viewport V1 — STRUCTURAL_RENDER capture/restore', () => {
  it('R9 §10/§12/§13 — a diagnostic ADD is structural and restores the visible anchor', async () => {
    const w = await openScrollableDrawer()
    w.setScrollTop(300)
    const rectsOf = (): DrawerRowRect[] => rows().map((el, i) => ({
      projectionKey: `${el.getAttribute('data-diagnostic-id')}#0`,
      diagnosticId: el.getAttribute('data-diagnostic-id') ?? '',
      offsetTop: i * 40,
      height: 36,
    }))
    const anchorIdxBefore = firstVisibleRowIndex(rectsOf(), w.getScrollTop())
    const anchorBefore = rectsOf()[anchorIdxBefore].diagnosticId
    const offsetBefore = rectsOf()[anchorIdxBefore].offsetTop - w.getScrollTop()
    const genBefore = api().getDrawerRowMountGeneration()

    // A real projection-set change (one more diagnostic) → STRUCTURAL_RENDER.
    const w2 = w.ids
    inject(host!, [
      ...Array.from({ length: 20 }, (_, i) => diagFor(`dg-${i}`, i, w2[i])),
      diagFor('dg-extra', 5, w2[5]),
    ], 2)
    ;(host as unknown as Internals).renderDrawer()

    // The list DID rebuild (structural) with the extra row…
    expect(api().getDrawerRowMountGeneration()).toBe(genBefore + 1)
    expect(rows()).toHaveLength(21)
    // … and the viewport was captured + restored (visible anchor + offset).
    const structural = lastAudit(STRUCTURAL_AUDIT)
    expect(structural.updateMode).toBe('STRUCTURAL_RENDER')
    expect(structural.viewportCapturePerformed).toBe('true')
    expect(structural.viewportRestorePerformed).toBe('true')
    expect(structural.viewportRestoreOk).toBe('true')
    expect(structural.decision).toBe('STRUCTURAL_RENDER_VIEWPORT_RESTORED')
    // the SAME first-visible diagnostic is still anchored at the SAME offset
    const anchorIdxAfter = firstVisibleRowIndex(rectsOf(), w.getScrollTop())
    expect(rectsOf()[anchorIdxAfter].diagnosticId).toBe(anchorBefore)
    expect(Math.abs((rectsOf()[anchorIdxAfter].offsetTop - w.getScrollTop()) - offsetBefore)).toBeLessThanOrEqual(1)
    expect(api().getDrawerViewportV1GateReport()).toContain('DRAWER_STRUCTURAL_RENDER_WITHOUT_VIEWPORT_CAPTURE_COUNT=0')
    expect(api().getDrawerViewportV1GateReport()).toContain('DRAWER_STRUCTURAL_RENDER_VIEWPORT_RESTORE_FAIL_COUNT=0')
    const coverage = api().getDrawerViewportV1CoverageReport().find(l => l.startsWith('structuralRenderViewportRestore='))
    expect(Number.parseInt(coverage?.split('=')[1] ?? '0', 10)).toBeGreaterThanOrEqual(1)
  })
})

// ── Internal Blank-Line Policy V1 — host behaviour ──────────────────────────

const INTERNAL_ID = 'document:EXCESSIVE_INTERNAL_BLANK_LINES:blank-gap:paragraph:A#0>>paragraph:B#0'

/** The runtime-facing record the producer publishes for one excessive gap. */
function internalBlankDiagnostic(): Record<string, unknown> {
  return {
    id: INTERNAL_ID, domain: 'document', documentKey: 'doc:key', severity: 'warning',
    category: 'document', code: 'EXCESSIVE_INTERNAL_BLANK_LINES',
    message: '连续空行过多',
    detail: '当前两个内容块之间存在 3 个连续空行，建议压缩为 1 个空行。',
    targetIdentity: 'blank-gap:paragraph:A#0>>paragraph:B#0',
    metadata: {
      ruleId: 'EXCESSIVE-INTERNAL-BLANK-LINES',
      ruleCategory: 'document-format', scope: 'block-gap',
      reasonChip: false, passiveVisual: false, activeVisual: true,
      previousBlockIdentity: 'paragraph:A#0', previousBlockKind: 'paragraph',
      nextBlockIdentity: 'paragraph:B#0', nextBlockKind: 'paragraph',
      previousSourceEnd: 10, nextSourceStart: 20,
      firstBlankLine: 1, lastBlankLine: 3, actualBlankLines: 3,
      passMaxBlankLines: 2, warningThreshold: 3,
    },
    // §22/§23 — the anchor is the NEXT block; `标题 0` is the `data-line="4"` heading.
    location: { kind: 'source-range', startLine: 4, startColumn: 0, rawText: '标题 0' },
  }
}

/** A 20-row Drawer whose 9th row is the internal blank-line Warning. */
async function openDrawerWithInternalBlankLine(withInternal = true): Promise<World> {
  const w = makeScrollableWorld(20)
  host = w.h
  inject(w.h, Array.from({ length: 20 }, (_, i) =>
    i === 8 && withInternal ? internalBlankDiagnostic() : diagFor(`dg-${i}`, i, w.ids[i])))
  api().renderHeadingDiagnosticMarkers()
  ;(host as unknown as Internals).openDrawer('all')
  await flushRaf()
  w.setScrollTop(300)
  return w
}

describe('Internal Blank-Line Policy V1 — host behaviour', () => {
  it('§25/§26/§34 — the FIRST click activates AND the Drawer viewport never moves', async () => {
    const w = await openDrawerWithInternalBlankLine()
    const before = w.getScrollTop()
    const genBefore = api().getDrawerRowMountGeneration()
    const rowEl = rows().find(r => r.getAttribute('data-diagnostic-id') === INTERNAL_ID)!

    await click(host!, INTERNAL_ID)

    expect(api().getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
    expect(api().getDiagnosticInteractionStateV2().diagnosticId).toBe(INTERNAL_ID)
    expect(w.getScrollTop()).toBe(before)
    expect(api().getDrawerRowMountGeneration()).toBe(genBefore)
    // §26 — the SHARED Drawer Viewport authority agrees.
    expect(api().getDrawerViewportV1GateDecision().decision).toBe('PASS')
    // §35 — the internal rule's OWN gates stay 0.
    expect(api().getInternalBlankLineV1GateReport().every(l => l.endsWith('=0'))).toBe(true)
    expect(api().getInternalBlankLineV1GateDecision().decision).toBe('PASS')
    // §36 — the positive coverage was recorded.
    expect(api().getInternalBlankLineV1CoverageReport().some(l => l === 'INTERNAL_BLANK_LINE_FIRST_CLICK_ACTIVE_RUNTIME_COUNT=1')).toBe(true)
    expect(api().getInternalBlankLineV1CoverageReport().some(l => l === 'INTERNAL_BLANK_LINE_DRAWER_VIEWPORT_STABLE_RUNTIME_COUNT=1')).toBe(true)
    expect(api().getInternalBlankLineV1CoverageReport().some(l => l === 'INTERNAL_BLANK_LINE_PARAGRAPH_TO_PARAGRAPH_RUNTIME_COUNT=1')).toBe(true)
    // The row node was NEVER rebuilt.
    expect(rows().find(r => r.getAttribute('data-diagnostic-id') === INTERNAL_ID)).toBe(rowEl)
  })

  it('§29 — the clicked row keeps its identity and a second click deactivates', async () => {
    const w = await openDrawerWithInternalBlankLine()
    await click(host!, INTERNAL_ID)
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('ACTIVE')
    await click(host!, INTERNAL_ID)
    expect(api().getDiagnosticInteractionStateV2().phase).toBe('IDLE')
    expect(w.getScrollTop()).toBe(300)
    expect(api().getInternalBlankLineV1GateDecision().decision).toBe('PASS')
  })

  it('§21 — the row retires when the gap is fixed and returns when it reappears', async () => {
    const w = await openDrawerWithInternalBlankLine()
    expect(rows().some(r => r.getAttribute('data-diagnostic-id') === INTERNAL_ID)).toBe(true)

    // 5 blanks → 2 blanks: the rule no longer fires → the row disappears.
    inject(w.h, Array.from({ length: 20 }, (_, i) => diagFor(`dg-${i}`, i, w.ids[i])), 2)
    ;(host as unknown as Internals).renderDrawer()
    expect(rows().some(r => r.getAttribute('data-diagnostic-id') === INTERNAL_ID)).toBe(false)

    // 2 blanks → 3 blanks: the row comes back (event-driven, no polling involved).
    inject(w.h, Array.from({ length: 20 }, (_, i) =>
      i === 8 ? internalBlankDiagnostic() : diagFor(`dg-${i}`, i, w.ids[i])), 3)
    ;(host as unknown as Internals).renderDrawer()
    expect(rows().some(r => r.getAttribute('data-diagnostic-id') === INTERNAL_ID)).toBe(true)
    // §21 — still no polling timer in the internal authority.
    expect(api().getInternalBlankLineV1GateReport()).toContain('INTERNAL_BLANK_LINE_POLLING_REFRESH_COUNT=0')
  })

  it('§27 — the Toolbar warning projection stays in parity with the snapshot', async () => {
    await openDrawerWithInternalBlankLine()
    expect(api().getInternalBlankLineV1GateReport()).toContain('INTERNAL_BLANK_LINE_TOOLBAR_WARNING_COUNT_MISMATCH=0')
  })

  it('§21/§36 — a gap that DISAPPEARS then RETURNS records BOTH dynamic coverage counters', async () => {
    const w = makeScrollableWorld(3)
    host = w.h
    const internals = host as unknown as {
      snapshot: unknown
      emitInternalBlankLineSourceAudit: () => void
    }
    const snap = (withGap: boolean, rev: number) => ({
      documentKey: 'doc:key', revision: rev, sourceRevision: rev, generatedAt: 0,
      diagnostics: withGap ? [internalBlankDiagnostic()] : [],
      errorCount: 0, warningCount: withGap ? 1 : 0, infoCount: 0,
    }) as unknown as DocumentDiagnosticsSnapshot

    internals.snapshot = snap(true, 1)
    internals.emitInternalBlankLineSourceAudit()
    // 3 blanks → 2 blanks: the SAME document no longer reports the gap.
    internals.snapshot = snap(false, 2)
    internals.emitInternalBlankLineSourceAudit()
    // 2 blanks → 3 blanks: the SAME gap identity returns.
    internals.snapshot = snap(true, 3)
    internals.emitInternalBlankLineSourceAudit()

    const coverage = api().getInternalBlankLineV1CoverageReport()
    const value = (label: string): number =>
      Number((coverage.find(l => l.startsWith(`${label}=`)) ?? `${label}=-1`).split('=')[1])
    expect(value('INTERNAL_BLANK_LINE_DYNAMIC_DISAPPEAR_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    expect(value('INTERNAL_BLANK_LINE_DYNAMIC_REAPPEAR_RUNTIME_COUNT')).toBeGreaterThanOrEqual(1)
    // §21 — still no polling timer anywhere in this authority.
    expect(api().getInternalBlankLineV1GateReport()).toContain('INTERNAL_BLANK_LINE_POLLING_REFRESH_COUNT=0')
  })
})
