// @vitest-environment jsdom
/**
 * Phase 7R.3.11 — Document Utility Overlay Host tests (UI-OVERLAY-*) and
 * Diagnostic Locator (DIAG-8).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost, UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE, classifyNavigatorPositionDrift, type NavigatorDriftInput, decideNavigatorPresentation, applyNavigatorStabilization, type NavigatorStabilizationResult, computeOverlayGeometry, computeNavigatorPlacementCandidate, MIN_NAVIGATOR_GUTTER_PX, NAVIGATOR_VISUAL_WIDTH_PX, auditNavigatorIconVisibility, computeNavigatorEdgeInsetCandidate, auditNavigatorMonotonicVisibility } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { DocumentDiagnosticLocator, DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'
import type { DocumentDiagnosticsSnapshot } from './diagnostics-types'

function fakeContext(overrides: Partial<DocumentUtilitiesContext['authority']> = {}): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => '/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
      ...overrides,
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
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  host = null
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({
    ctx: fakeContext(),
    providers: fakeProviders(),
    onBindDocument: () => {},
  })
  h.mount()
  host = h
  return h
}

const uiRootSelector = `[${UTILITY_UI_ROOT_ATTR}="${UTILITY_UI_ROOT_VALUE}"]`

describe('UI-OVERLAY-1 mount once', () => {
  it('creates exactly one toolbar, one navigator, one drawer', () => {
    mountHost()
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar__btn--diag')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar__btn--lock')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator__btn')).toHaveLength(2)
  })
})

describe('UI-OVERLAY-2 switch documents repeatedly', () => {
  it('no duplicate overlay / listeners after repeated mount + bindDocument', () => {
    const h = mountHost()
    h.mount() // idempotent
    h.bindDocument()
    h.bindDocument()
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
  })
})

describe('UI-OVERLAY-3 outside Markdown business content', () => {
  it('root lives on body, never inside #write', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    mountHost()
    const root = document.querySelector(uiRootSelector) as HTMLElement
    expect(root).toBeTruthy()
    expect(write.contains(root)).toBe(false)
    expect(root.parentElement).toBe(document.body)
    // #write contains no utility UI.
    expect(write.querySelector(uiRootSelector)).toBeNull()
  })
})

describe('UI-OVERLAY-4 drawer open/close does not touch document content', () => {
  it('opening the drawer mutates only the overlay root, not #write', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<h1>标题</h1><p>正文</p>'
    document.body.appendChild(write)
    const h = mountHost()
    const before = write.innerHTML
    const diagBtn = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diagBtn.click()
    expect(document.querySelector('.inkchapter-doc-drawer')!.getAttribute('style')).toContain('display: flex')
    expect(write.innerHTML).toBe(before) // zero Markdown mutation
    const closeBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__action--close')!
    closeBtn.click()
    expect(document.querySelector('.inkchapter-doc-drawer')!.getAttribute('style')).toContain('display: none')
    expect(write.innerHTML).toBe(before)
  })
})

describe('UI-OVERLAY lock button + per-document state', () => {
  it('lock button toggles text 编辑 ↔ 已锁定', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    mountHost()
    const lockBtn = document.querySelector('.inkchapter-doc-toolbar__btn--lock') as HTMLButtonElement
    expect(lockBtn.textContent).toBe('编辑')
    lockBtn.click()
    expect(lockBtn.textContent).toBe('已锁定')
    lockBtn.click()
    expect(lockBtn.textContent).toBe('编辑')
  })
})

describe('DIAG-8 locator', () => {
  it('locates target, scrolls into view, adds+removes highlight, no edit', () => {
    const target = document.createElement('h2')
    target.textContent = '定位目标'
    document.body.appendChild(target)
    const scrollIntoView = vi.fn()
    ;(target as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView

    const locator = new DocumentDiagnosticLocator({ getContainer: () => null, onStale: () => {} })
    vi.useFakeTimers()
    const result = locator.locate(target)
    expect(result.located).toBe(true)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(target.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(true)
    // Locate never edits Markdown: text content is unchanged (highlight is a
    // temporary UI class, not a content mutation).
    expect(target.textContent).toBe('定位目标')
    vi.advanceTimersByTime(1800)
    expect(target.classList.contains(DIAGNOSTIC_HIGHLIGHT_CLASS)).toBe(false)
    expect(target.textContent).toBe('定位目标')
    vi.useRealTimers()
  })

  it('stale target → no throw, no random scroll', () => {
    const target = document.createElement('h2')
    const stale = vi.fn()
    const locator = new DocumentDiagnosticLocator({ getContainer: () => null, onStale: stale })
    const result = locator.locate(target) // not connected
    expect(result.located).toBe(false)
    expect(result.reason).toBe('NOT_CONNECTED')
    expect(stale).toHaveBeenCalled()
  })
})

// ── UI Visual Consolidation V1.1 — structural DOM contracts ────────────────
function makeDiag(severity: 'error' | 'warning' | 'info', id: string, message: string): DocumentDiagnosticsSnapshot['diagnostics'][number] {
  return {
    id,
    severity,
    code: 'TEST',
    message,
    category: 'document',
    stableIdentity: id,
    targetIdentity: id,
    metadata: {},
    location: null,
  } as unknown as DocumentDiagnosticsSnapshot['diagnostics'][number]
}

function injectSnapshot(h: DocumentUtilityOverlayHost, items: DocumentDiagnosticsSnapshot['diagnostics'][number][]): void {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const d of items) counts[d.severity]++
  const snapshot = {
    documentKey: 'doc:key',
    revision: 1,
    sourceRevision: 1,
    generatedAt: 0,
    diagnostics: items,
    errorCount: counts.error,
    warningCount: counts.warning,
    infoCount: counts.info,
  } as unknown as DocumentDiagnosticsSnapshot
  ;(h as unknown as { snapshot: DocumentDiagnosticsSnapshot | null }).snapshot = snapshot
  ;(h as unknown as { renderDiagnosticsButton: () => void }).renderDiagnosticsButton()
  ;(h as unknown as { renderDrawer: () => void }).renderDrawer()
}

describe('V1.1 problems control (PC) — one shell, real segments, plain counts', () => {
  it('PC1/2: one DocumentProblemsControl; error+warning segments; no glyph duplicates', () => {
    mountHost()
    injectSnapshot(host!, [makeDiag('error', 'e1', '错误一'), makeDiag('warning', 'w1', '警告一')])
    const control = document.querySelector('.inkchapter-problems-control')
    expect(control).toBeTruthy()
    expect(document.querySelectorAll('.inkchapter-problems-control')).toHaveLength(1)
    const segs = Array.from(document.querySelectorAll('.inkchapter-toolbar-segment'))
    expect(segs).toHaveLength(2)
    expect(segs[0].getAttribute('data-severity')).toBe('error')
    expect(segs[0].querySelector('.inkchapter-toolbar-segment__count')?.textContent).toBe('1')
    // Counts are plain text — no unicode glyph prefixes inside the control.
    expect((control as HTMLElement).textContent).not.toContain('✕')
    expect((control as HTMLElement).textContent).not.toContain('△')
    // One outer shell + neutral lock action.
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelector('.inkchapter-editlock__label')?.textContent).toBe('编辑')
  })

  it('PC5/9: healthy → single entry, never 错误0/警告0', () => {
    mountHost()
    injectSnapshot(host!, [])
    const control = document.querySelector('.inkchapter-problems-control')
    expect(control?.querySelectorAll('.inkchapter-toolbar-segment')).toHaveLength(0)
    expect((control as HTMLElement).textContent).not.toContain('0')
  })
})

describe('V1.1 diagnostics header + flat rows (DH/DI)', () => {
  it('DH1/2/6: icon-only refresh/close; hint tab hidden at 0; no standalone locate', () => {
    mountHost()
    injectSnapshot(host!, [makeDiag('warning', 'w1', '警告一'), makeDiag('warning', 'w2', '警告二')])
    const refresh = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__action--refresh')
    const close = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__action--close')
    expect(refresh).toBeTruthy()
    expect(close).toBeTruthy()
    expect(refresh?.textContent).toBe('') // icon-only, aria-label carries semantics
    expect(close?.textContent).toBe('')
    expect(refresh?.getAttribute('aria-label')).toBe('重新检查文档')
    expect(document.querySelector('.inkchapter-doc-drawer__filter-tab[data-filter="info"]')).toBeNull()
    expect(document.querySelectorAll('.inkchapter-doc-drawer__item[data-diagnostic-id]')).toHaveLength(2)
    expect(document.querySelectorAll('.inkchapter-doc-drawer__item-locate')).toHaveLength(0)
  })

  it('DH7: filter state shared with toolbar — warning tab filters rows', () => {
    mountHost()
    injectSnapshot(host!, [makeDiag('error', 'e1', '错误一'), makeDiag('warning', 'w1', '警告一')])
    const warnTab = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__filter-tab[data-filter="warning"]')
    expect(warnTab?.getAttribute('aria-selected')).toBe('false')
    warnTab?.click()
    const activeWarn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-drawer__filter-tab[data-filter="warning"]')
    expect(activeWarn?.classList.contains('is-active')).toBe(true)
    expect(activeWarn?.getAttribute('aria-selected')).toBe('true')
    const rows = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('警告一')
  })

  it('DI2/3/4: row click + Enter locate; rows focusable; no locate buttons', () => {
    const h = mountHost()
    injectSnapshot(h, [makeDiag('warning', 'w1', '警告一')])
    const row = document.querySelector<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]')!
    const spy = vi.spyOn(h as unknown as { locateDiagnostic: (id: string) => void }, 'locateDiagnostic')
    row.click()
    expect(spy).toHaveBeenCalledWith('w1')
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('role')).toBe('button')
  })
})

// ── V1.1 Position Drift — D1–D7 (pure invariant, Safe-Rail untouched) ───────
function driftInput(over: Partial<NavigatorDriftInput>): NavigatorDriftInput {
  return {
    left: 120,
    right: 150,
    top: 300,
    bottom: 330,
    width: 30,
    viewportLeft: 0,
    viewportRight: 500,
    viewportTop: 0,
    viewportBottom: 400,
    contentRight: 100,
    contentGap: 8,
    safeRailLeft: 108,
    safeRailRight: 440,
    scrollbarSafeRight: 400,
    ...over,
  }
}

describe('V1.1 position drift D1–D7 (1px tolerance)', () => {
  it('D1 within tolerance → PASS', () => {
    expect(classifyNavigatorPositionDrift(driftInput({}))).toBe('PASS')
  })
  it('D2 OUTSIDE_SAFE_RAIL → FAIL', () => {
    // Fully inside viewport & clear of scrollbar, but right edge beyond the rail.
    expect(classifyNavigatorPositionDrift(driftInput({ left: 420, right: 450, scrollbarSafeRight: 490 }))).toBe('OUTSIDE_SAFE_RAIL')
  })
  it('D3 TOO_CLOSE_TO_CONTENT → FAIL', () => {
    // Left edge overlaps the content+gap boundary (contentRight=100, gap=8).
    expect(classifyNavigatorPositionDrift(driftInput({ left: 104, right: 134 }))).toBe('TOO_CLOSE_TO_CONTENT')
  })
  it('D4 TOO_CLOSE_TO_SCROLLBAR → FAIL', () => {
    // Within rail but past the scrollbar-safe right edge.
    expect(classifyNavigatorPositionDrift(driftInput({ left: 380, right: 405 }))).toBe('TOO_CLOSE_TO_SCROLLBAR')
  })
  it('D5 OUTSIDE_VISIBLE_EDITOR → FAIL', () => {
    expect(classifyNavigatorPositionDrift(driftInput({ left: 495, right: 520 }))).toBe('OUTSIDE_VISIBLE_EDITOR')
  })
  it('D6 WIDTH_NO_LONGER_FITS → FAIL', () => {
    expect(classifyNavigatorPositionDrift(driftInput({ width: 0 }))).toBe('WIDTH_NO_LONGER_FITS')
  })
  it('D7 ANCHOR_MISMATCH → FAIL', () => {
    expect(classifyNavigatorPositionDrift(driftInput({ left: Number.NaN }))).toBe('ANCHOR_MISMATCH')
  })
})

// ── UI V1.2 — DevTools roundtrip: gutter/inset/hidden is DECISION-driven,    ──
// never a viewport-width CSS hide; single DOM writer; UNKNOWN stays visible.   ─
// Numeric synthetic inputs are translated into candidate-validity flags
// (gutter: ≥ MIN_NAVIGATOR_GUTTER_PX; inset: ≥ navigator visual width). Real
// runtime validity is computed from actual Candidate Rects (see CASE_DEVTOOLS).
const decideNav = (gutterFree: number | null, insetFree: number | null) =>
  decideNavigatorPresentation({
    scrollable: true,
    gutterCandidateValid: gutterFree != null && gutterFree >= MIN_NAVIGATOR_GUTTER_PX,
    insetCandidateValid: insetFree != null && insetFree >= NAVIGATOR_VISUAL_WIDTH_PX,
    geometryKnown: gutterFree != null || insetFree != null,
  })

describe('UI V1.2 NAV-DEVTOOLS roundtrip (decision layer, DevTools NOT special-cased)', () => {
  it('NAV-DEVTOOLS-1/2/3: wide gutter → UNKNOWN visible fallback → known inset → gutter restore', () => {
    expect(decideNav(60, 200).presentation).toBe('gutter') // 1500px wide
    const unknown = decideNav(null, null)
    expect(unknown.presentation).toBe('inset') // transient UNKNOWN visible fallback
    expect(unknown.reason).toBe('INSET_UNKNOWN_FALLBACK')
    expect(decideNav(12, 160).presentation).toBe('inset') // DevTools/medium, known
    expect(decideNav(60, 200).presentation).toBe('gutter') // DevTools closed
  })

  it('NAV-DEVTOOLS-4: medium → ultra-narrow hidden(NO_SAFE) → medium restore', () => {
    expect(decideNav(12, 160).presentation).toBe('inset')
    const noSafe = decideNav(6, 18)
    expect(noSafe.presentation).toBe('hidden')
    expect(noSafe.reason).toBe('NO_SAFE_PLACEMENT')
    expect(decideNav(12, 160).presentation).toBe('inset')
  })

  it('NAV-DEVTOOLS-7: scrollable + UNKNOWN never collapses to NO_SAFE_PLACEMENT', () => {
    expect(decideNav(null, null).presentation).not.toBe('hidden')
  })

  it('NAV-DEVTOOLS-5/6 + writer roundtrip: single instance, DOM hidden only via writer', () => {
    const h = mountHost()
    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    const apply = (p: string, inset: number | null): void =>
      (h as unknown as { applyNavigatorPresentation: (p: string, inset: number | null) => void }).applyNavigatorPresentation(p, inset)
    const seq = ['gutter', 'inset', 'hidden', 'inset', 'gutter'] as const
    for (const p of seq) {
      apply(p, p === 'inset' ? 90 : null)
      expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
      expect((nav as HTMLInputElement & { dataset: Record<string, string> }).dataset.rail).toBe(p)
      expect(nav.hidden).toBe(p === 'hidden')
      expect(nav.getAttribute('aria-hidden')).toBe(String(p === 'hidden'))
    }
  })
})

// ── UI V1.4 — Resize Stabilization Gate (one-shot, no second authority) ──────
function stepStab(raw: { presentation: 'gutter' | 'inset' | 'hidden'; reason: string }, lastStable: 'gutter' | 'inset' | null, pending: boolean): NavigatorStabilizationResult {
  return applyNavigatorStabilization({ scrollable: true, presentation: raw.presentation, reason: raw.reason, lastStableVisible: lastStable, remeasureScheduled: pending })
}

describe('UI V1.4 resize stabilization gate (G)', () => {
  it('G1/G2: gutter stable; medium known inset refreshes lastStable', () => {
    const g = stepStab({ presentation: 'gutter', reason: 'GUTTER_AVAILABLE' }, null, false)
    expect(g.presentation).toBe('gutter')
    expect(g.lastStableVisible).toBe('gutter')
    const i = stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'gutter', false)
    expect(i.presentation).toBe('inset')
    expect(i.lastStableVisible).toBe('inset')
  })

  it('G3/G5: first transient hidden is HELD visible; stable frame commits NO_SAFE', () => {
    const first = stepStab({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }, 'inset', false)
    expect(first.presentation).toBe('inset') // visible stabilization
    expect(first.reason).toBe('STABILIZING_ONE_FRAME')
    expect(first.scheduleRemeasure).toBe(true)
    // second (stable) frame — pending=true → real hidden commits.
    const second = stepStab({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }, 'inset', true)
    expect(second.presentation).toBe('hidden')
    expect(second.scheduleRemeasure).toBe(false)
  })

  it('G4/G6/G7: transient→stable inset→wide gutter; visible clears the gate', () => {
    // stable inset resets pending.
    expect(stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'inset', true).scheduleRemeasure).toBe(false)
    // gutter restore.
    expect(stepStab({ presentation: 'gutter', reason: 'GUTTER_AVAILABLE' }, 'inset', true).presentation).toBe('gutter')
  })

  it('G-non-scrollable: immediate hidden NOT_SCROLLABLE, lastStable reset', () => {
    const r = applyNavigatorStabilization({ scrollable: false, presentation: 'gutter', reason: 'GUTTER_AVAILABLE', lastStableVisible: 'gutter', remeasureScheduled: false })
    expect(r.presentation).toBe('hidden')
    expect(r.reason).toBe('NOT_SCROLLABLE')
    expect(r.lastStableVisible).toBe(null)
  })

  it('no infinite RAF: single schedule consumed; visible frame clears pending', () => {
    const held = stepStab({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }, 'gutter', false)
    expect(held.scheduleRemeasure).toBe(true)
    // Without a visible frame the gate never re-schedules (pending stays true).
    const again = stepStab({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }, 'gutter', true)
    expect(again.scheduleRemeasure).toBe(false)
    // Visible frame clears the gate so a NEW transient may hold again later.
    const vis = stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'gutter', true)
    expect(vis.scheduleRemeasure).toBe(false)
    const nextTransient = stepStab({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' }, 'inset', false)
    expect(nextTransient.presentation).toBe('inset')
  })
})

// ── UI V1.5 — legacy navigator suppression regression (L) ────────────────────
describe('UI V1.5 legacy suppression closure (L1-L10)', () => {
  // Real failed parameters: window≈1151 / editorVisible≈874 / scrollable=true.
  it('L1/L3: medium scrollable (1151/874) never hides, reason is inset — no SHORT leak', () => {
    const r = decideNav(10, 300) // gutter unsafe + inset safe
    expect(r.presentation).toBe('inset')
    const held = stepStab(r, 'inset', false)
    expect(held.presentation).toBe('inset') // first + stable frame both visible
    const stable = stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'inset', true)
    expect(stable.presentation).toBe('inset')
    expect(stable.reason).not.toContain('SHORT_DOCUMENT_NAV_HIDDEN')
  })

  it('L2/L4/L9: writer DOM visible & single instance; wide 1536 → gutter; no drawer suppression', () => {
    const h = mountHost()
    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    const apply = (p: 'gutter' | 'inset' | 'hidden', inset: number | null): void =>
      (h as unknown as { applyNavigatorPresentation: (p: string, inset: number | null) => void }).applyNavigatorPresentation(p, inset)
    apply('inset', 90)
    expect(nav.hidden).toBe(false)
    expect(nav.getAttribute('aria-hidden')).toBe('false')
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    // drawer open/close never touches navigator DOM writer — re-apply inset stays visible.
    apply('inset', 90)
    expect(nav.hidden).toBe(false)
    apply('gutter', null)
    expect(nav.hidden).toBe(false)
  })

  it('L5/L6: short doc → hidden/NOT_SCROLLABLE; true no-safe coherent → hidden/NO_SAFE_PLACEMENT', () => {
    expect(applyNavigatorStabilization({ scrollable: false, presentation: 'gutter', reason: 'GUTTER_AVAILABLE', lastStableVisible: null, remeasureScheduled: false }).presentation).toBe('hidden')
    expect(decideNav(6, 18).reason).toBe('NO_SAFE_PLACEMENT')
  })

  it('L7/L8: medium → wide → gutter restore, then medium inset again (navigatorCount=1)', () => {
    mountHost()
    expect(decideNav(60, 200).presentation).toBe('gutter')
    expect(decideNav(12, 160).presentation).toBe('inset')
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
  })
})

// ── Real-case regression: 1151/874.4/2897/720 → scrollable medium → inset ──
describe('V1.5 real-case authority (R): 1151 viewport, scrollable, no drawer', () => {
  it('R1/R2: base eligibility true, final inset, visible + no legacy decision names', () => {
    const g = computeOverlayGeometry(null, { width: 1151, height: 720 }, { drawerOpen: false, scrollHeight: 2897, clientHeight: 720 })
    expect(g.scrollable).toBe(true) // maxScrollTop = 2177 > 0
    const decided = decideNav(10, 300) // gutter unsafe, inset safe (874 editor)
    expect(decided.presentation).toBe('inset')
    const stab = stepStab(decided, 'inset', false)
    expect(stab.presentation).toBe('inset') // OPEN + SETTLED both visible
    expect(stab.reason).not.toContain('SHORT_DOCUMENT_NAV_HIDDEN')
    expect(stab.reason).not.toContain('DRAWER_SUPPRESSED')
    // writer contract: inset → visible DOM.
    const h = mountHost()
    const apply = (p: 'gutter' | 'inset' | 'hidden'): void =>
      (h as unknown as { applyNavigatorPresentation: (p: string, inset: number | null) => void }).applyNavigatorPresentation(p, null)
    apply('inset')
    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    expect(nav.hidden).toBe(false)
    expect(nav.getAttribute('aria-hidden')).toBe('false')
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    // medium settled second pass stays inset (no second-frame DRAWER_SMALL_VIEWPORT hide).
    expect(stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'inset', true).presentation).toBe('inset')
  })

  it('R3: drawer open/close never directly suppresses; wide → gutter restore', () => {
    const h = mountHost()
    const apply = (p: 'gutter' | 'inset' | 'hidden'): void =>
      (h as unknown as { applyNavigatorPresentation: (p: string, inset: number | null) => void }).applyNavigatorPresentation(p, null)
    apply('inset')
    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    // Simulate drawer-independent commit: same inset re-applied (as if drawer toggled).
    apply('inset')
    expect(nav.hidden).toBe(false)
    apply('gutter')
    expect(nav.hidden).toBe(false)
    expect(decideNav(60, 200).presentation).toBe('gutter') // 1536 wide
  })
})

// ── Real Candidate-Rect inset — CASE_DEVTOOLS_1151 + overlap thresholds ─────
describe('Real Candidate-Rect inset (CASE_DEVTOOLS_1151)', () => {
  const candidateFor = (overrides: Partial<Parameters<typeof computeNavigatorPlacementCandidate>[0]> = {}) =>
    computeNavigatorPlacementCandidate({
      editorLeft: 233.8,
      editorRight: 1150.2,
      contentRight: 1118,
      scrollbarSafeRight: 1140.2,
      navigatorWidth: 30,
      ...overrides,
    })

  it('CASE_DEVTOOLS_1151: left≈1110.2/right≈1140.2/overlap 7.8 → inset valid → presentation=inset', () => {
    const c = candidateFor()
    expect(c.candidateLeft).toBeCloseTo(1110.2, 1)
    expect(c.candidateRight).toBeCloseTo(1140.2, 1)
    expect(c.contentOverlap).toBeCloseTo(7.8, 1)
    expect(c.insideEditor).toBe(true)
    expect(c.valid).toBe(true)
    const g = computeOverlayGeometry(null, { width: 1151, height: 720 }, { drawerOpen: false, scrollHeight: 2897, clientHeight: 720 })
    expect(g.scrollable).toBe(true)
    // gutter candidate is NOT valid at this width; inset candidate decides.
    const decided = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: c.valid, geometryKnown: true })
    expect(decided.presentation).toBe('inset')
    expect(decided.reason).toBe('INSET_AVAILABLE')
    const stab = stepStab(decided, 'inset', false)
    expect(stab.presentation).toBe('inset') // OPEN + SETTLED visible
  })

  it('overlap 0/8/12 → inset valid; overlap 12.1 → invalid → NO_SAFE_PLACEMENT', () => {
    // candidateLeft = sbRight − 30 = 1110.2; overlap = contentRight − 1110.2.
    const byOverlap = (overlap: number) => candidateFor({ contentRight: 1110.2 + overlap })
    expect(byOverlap(0).contentOverlap).toBeCloseTo(0, 1)
    expect(byOverlap(8).contentOverlap).toBeCloseTo(8, 1)
    expect(byOverlap(12).contentOverlap).toBeCloseTo(12, 1)
    expect(byOverlap(0).valid).toBe(true)
    expect(byOverlap(8).valid).toBe(true)
    expect(byOverlap(12).valid).toBe(true)
    const bad = byOverlap(12.1)
    expect(bad.valid).toBe(false)
    expect(decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: bad.valid, geometryKnown: true }).presentation).toBe('hidden')
  })

  it('scrollbarSafeRight drives candidateRight; wide→gutter, medium→inset, narrow→hidden, restore', () => {
    const moved = candidateFor({ scrollbarSafeRight: 1100 })
    expect(moved.candidateRight).toBe(1100)
    expect(moved.candidateLeft).toBe(1070)
    // synthetic wide/medium/narrow restore (decision layer).
    expect(decideNav(60, 200).presentation).toBe('gutter')
    expect(decideNav(10, 300).presentation).toBe('inset')
    expect(decideNav(5, null).presentation).toBe('hidden')
    expect(decideNav(10, 300).presentation).toBe('inset')
    expect(decideNav(60, 200).presentation).toBe('gutter')
    expect(stepStab({ presentation: 'inset', reason: 'INSET_AVAILABLE' }, 'inset', true).presentation).toBe('inset')
  })

  it('navigator visual width constant matches CSS shell (30px); hidden rect=0 never uses 44', () => {
    expect(NAVIGATOR_VISUAL_WIDTH_PX).toBe(30)
    // When rect.width = 0 (display:none) the candidate math must use 30px:
    const hiddenFit = computeNavigatorPlacementCandidate({ editorLeft: 233.8, editorRight: 1150.2, contentRight: 1118, scrollbarSafeRight: 1140.2, navigatorWidth: NAVIGATOR_VISUAL_WIDTH_PX })
    expect(hiddenFit.valid).toBe(true)
    // A bogus 44px fallback would make the same rect invalid (overlap 21.8 > 12):
    const bogusFit = computeNavigatorPlacementCandidate({ editorLeft: 233.8, editorRight: 1150.2, contentRight: 1118, scrollbarSafeRight: 1140.2, navigatorWidth: 44 })
    expect(bogusFit.valid).toBe(false)
    expect(bogusFit.contentOverlap).toBeCloseTo(21.8, 1)
  })
})

// ── Chevron V3 — navigator icon visibility invariant ────────────────────────
describe('NAVI-VISUAL icon visibility invariant', () => {
  const ok = {
    scrollable: true, navigatorVisible: true, enabledButtonCount: 1,
    svgWidth: 14, svgHeight: 14, svgDisplay: 'inline', svgVisibility: 'visible',
    svgOpacity: 0.8, strokeTransparent: false,
  }
  it('skip when navigator not visible / not scrollable', () => {
    expect(auditNavigatorIconVisibility({ ...ok, navigatorVisible: false }).decision).toBe('PASS')
    expect(auditNavigatorIconVisibility({ ...ok, scrollable: false }).decision).toBe('PASS')
  })
  it('no enabled button → FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE', () => {
    expect(auditNavigatorIconVisibility({ ...ok, enabledButtonCount: 0 }).decision).toBe('FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE')
  })
  it('tiny/hidden/transparent or dimmed SVG → FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE', () => {
    expect(auditNavigatorIconVisibility({ ...ok, svgWidth: 11 }).decision).toBe('FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE')
    expect(auditNavigatorIconVisibility({ ...ok, svgDisplay: 'none' }).decision).toBe('FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE')
    expect(auditNavigatorIconVisibility({ ...ok, svgOpacity: 0.5 }).decision).toBe('FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE')
    expect(auditNavigatorIconVisibility({ ...ok, strokeTransparent: true }).decision).toBe('FAIL_NAV_ICON_EFFECTIVELY_INVISIBLE')
  })
  it('renderable SVG (14×14, visible, ≥.70, currentColor) → PASS', () => {
    expect(auditNavigatorIconVisibility(ok).decision).toBe('PASS')
  })
})

// ── NAV-MONO — Edge-Inset fallback + monotonic visibility ───────────────────
describe('NAV-MONO edge-inset fallback (monotonic visibility)', () => {
  // Model: viewport W → editor left≈0.29W, right≈W−9; scrollbar-safe ≈ right−2.
  // Content hugs the right edge (overlap>12) so normal safe-inset is invalid;
  // only the edge candidate can keep the navigator visible.
  const edgeAt = (W: number) => computeNavigatorEdgeInsetCandidate({
    editorLeft: Math.round(W * 0.29),
    editorRight: W - 9,
    scrollbarSafeRight: W - 11,
    navigatorWidth: 30,
  })
  const decides = (W: number) => decideNavigatorPresentation({
    scrollable: true,
    gutterCandidateValid: false,
    insetCandidateValid: false,
    edgeInsetCandidateValid: edgeAt(W).valid,
    geometryKnown: true,
  })

  it('full width matrix (1536→520): edge fits ⇒ never hidden', () => {
    const widths = [1536, 1400, 1280, 1151, 1050, 983, 900, 853, 814, 760, 640, 520]
    for (const w of widths) {
      const edge = edgeAt(w)
      expect(edge.valid).toBe(true)
      const d = decides(w)
      expect(d.presentation).not.toBe('hidden')
      expect(d.presentation).toBe('inset')
      expect(d.reason).toBe('INSET_EDGE_FALLBACK')
    }
  })

  it('resize sequence 1536→1151→983→853→814→760→983→1151→1536 has no hole', () => {
    const seq = [1536, 1151, 983, 853, 814, 760, 983, 1151, 1536]
    for (const w of seq) {
      const d = decides(w)
      expect(d.presentation).not.toBe('hidden')
    }
  })

  it('CASE 814 DevTools: edge keeps navigator visible (INSET_EDGE_FALLBACK)', () => {
    const edge = computeNavigatorEdgeInsetCandidate({ editorLeft: 233.8, editorRight: 804.6, scrollbarSafeRight: 802.6, navigatorWidth: 30 })
    expect(edge.candidateRight).toBeCloseTo(802.6, 1)
    expect(edge.candidateLeft).toBeCloseTo(772.6, 1)
    expect(edge.valid).toBe(true)
    const d = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: false, edgeInsetCandidateValid: true, geometryKnown: true })
    expect(d).toEqual({ presentation: 'inset', reason: 'INSET_EDGE_FALLBACK' })
  })

  it('only when editor cannot hold nav + 2×edgeGap → hidden / NO_SAFE_PLACEMENT', () => {
    const tight = computeNavigatorEdgeInsetCandidate({ editorLeft: 0, editorRight: 33, scrollbarSafeRight: 31, navigatorWidth: 30 })
    expect(tight.valid).toBe(false)
    const d = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: false, edgeInsetCandidateValid: false, geometryKnown: true })
    expect(d).toEqual({ presentation: 'hidden', reason: 'NO_SAFE_PLACEMENT' })
  })

  it('monotonic invariant pure gate', () => {
    expect(auditNavigatorMonotonicVisibility({ scrollable: true, edgeInsetCandidateValid: true, finalPresentation: 'inset' }).decision).toBe('PASS')
    expect(auditNavigatorMonotonicVisibility({ scrollable: true, edgeInsetCandidateValid: true, finalPresentation: 'hidden' }).decision).toBe('FAIL_NON_MONOTONIC_VISIBILITY_HOLE')
    expect(auditNavigatorMonotonicVisibility({ scrollable: false, edgeInsetCandidateValid: true, finalPresentation: 'hidden' }).decision).toBe('PASS')
  })
})

// ── NAV-EDITOR — visible-editor containment (highest precedence) ─────────────
describe('NAV-EDITOR visible-editor containment gates', () => {
  it('editor invisible → hidden / NO_VISIBLE_EDITOR even with UNKNOWN fallback (FileTree+DevTools case)', () => {
    const d = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: false, gutterCandidateValid: false, insetCandidateValid: false, geometryKnown: false })
    expect(d).toEqual({ presentation: 'hidden', reason: 'NO_VISIBLE_EDITOR' })
  })

  it('NO_VISIBLE_EDITOR outranks every candidate/fallback', () => {
    const d1 = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: false, gutterCandidateValid: true, insetCandidateValid: true, edgeInsetCandidateValid: true, geometryKnown: true })
    expect(d1.reason).toBe('NO_VISIBLE_EDITOR')
    const d2 = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: false, gutterCandidateValid: true, insetCandidateValid: true, edgeInsetCandidateValid: true, geometryKnown: true })
    expect(d2).toEqual({ presentation: 'hidden', reason: 'NO_VISIBLE_EDITOR' })
  })

  it('visible editor keeps the UNKNOWN/GEOMETRY_PENDING visible fallback', () => {
    const d = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: true, gutterCandidateValid: false, insetCandidateValid: false, geometryKnown: false })
    expect(d.presentation).toBe('inset')
    expect(d.reason).toBe('INSET_UNKNOWN_FALLBACK')
  })

  it('restore path: editor reappears → normal candidates visible again', () => {
    const hiddenState = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: false, gutterCandidateValid: true, insetCandidateValid: true, geometryKnown: true })
    expect(hiddenState.reason).toBe('NO_VISIBLE_EDITOR')
    const restored = decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: true, gutterCandidateValid: true, insetCandidateValid: true, geometryKnown: true })
    expect(restored).toEqual({ presentation: 'gutter', reason: 'GUTTER_AVAILABLE' })
  })

  it('wide/medium/narrow/no-editor ladder: gutter → inset → edge → NO_VISIBLE_EDITOR', () => {
    expect(decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: true, gutterCandidateValid: true, insetCandidateValid: false, edgeInsetCandidateValid: false, geometryKnown: true }).reason).toBe('GUTTER_AVAILABLE')
    expect(decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: true, gutterCandidateValid: false, insetCandidateValid: true, edgeInsetCandidateValid: true, geometryKnown: true }).reason).toBe('INSET_AVAILABLE')
    expect(decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: true, gutterCandidateValid: false, insetCandidateValid: false, edgeInsetCandidateValid: true, geometryKnown: true }).reason).toBe('INSET_EDGE_FALLBACK')
    expect(decideNavigatorPresentation({ scrollable: true, hasVisibleEditor: true, editorCanContainNavigator: false, gutterCandidateValid: false, insetCandidateValid: false, edgeInsetCandidateValid: false, geometryKnown: true }).reason).toBe('NO_VISIBLE_EDITOR')
  })
})

