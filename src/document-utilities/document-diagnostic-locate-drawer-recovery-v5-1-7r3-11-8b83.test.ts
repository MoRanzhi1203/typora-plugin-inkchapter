// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.14 — Diagnostic Locate Presentation V5.1 Recovery Hotfix.
 *
 * The suite drives the EXACT pure predicates the overlay host consumes (see
 * document-locate-drawer-recovery-v5-1.ts) plus host-level terminal-path
 * checks (lease released on COMMITTED / FAILED / CANCELLED / EXCEPTION, Drawer
 * intent never lost). Headless jsdom can never enter LOCATE_COLLAPSE (real
 * layout gate), so the restore *policy* is asserted via the pure state machine
 * + the shared releaseDrawerRecoveryLease that every terminal path calls.
 *
 * Suites:
 *   DRAWER-RECOVERY-*  intent/presentation separation + lease release
 *   DRAWER-REOPEN-*    Problems Control explicit REOPEN authority (no blind toggle)
 *   OCCLUSION-5_1-*    zero-width/zero-rect Drawer never occludes
 *   LAYER-5_1-*        paint-above requires rendered + non-zero + real intersection
 *   RETRY-5_1-*        layout recovery is transaction-local, max 1 per tx
 *   SELECTED-5_1-*     selected diagnostic survives collapse/restore + failures
 *   NAME-SLOT-5_1-*    primary name slot must be a real small slot (never the body)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import {
  MAX_LAYOUT_RECOVERY_RETRY_PER_TX,
  canPerformLayoutRecovery,
  computeDrawerOcclusionFacts,
  deriveDrawerPresentation,
  evaluatePanelPaintRelation,
  resolveNameSlotPresentation,
  resolveProblemsControlAction,
  rectsIntersect,
  type SimpleRect,
} from './document-locate-drawer-recovery-v5-1'

function r(l: number, t: number, right: number, b: number): SimpleRect {
  return { left: l, top: t, right, bottom: b, width: right - l, height: b - t }
}

/** README-style geometry: a code object in the middle of the page, Toolbar at
 *  the top (no intersection), Navigator hidden, Drawer collapsed to 0×0. */
const codeBody = r(233.8, 230.7, 1038, 428.3)
const toolbarTop = r(0, 0, 1400, 44)
const collapsedDrawer = r(1390, 0, 1390, 900)

describe('DRAWER-RECOVERY — user intent is separate from LOCATE_COLLAPSE', () => {
  it('DRAWER-RECOVERY-1: requestedOpen=true is NEVER flipped by a locate-collapse', () => {
    expect(deriveDrawerPresentation(true, false)).toBe('open')
    // Temporary collapse while the user still wants the Drawer open.
    expect(deriveDrawerPresentation(true, true)).toBe('locate-collapse')
    // requestedOpen is the intent axis — collapse only changes the mode axis.
    expect(deriveDrawerPresentation(false, true)).toBe('closed')
    expect(deriveDrawerPresentation(false, false)).toBe('closed')
  })
})

describe('DRAWER-REOPEN — Problems Control explicit REOPEN authority', () => {
  it('DRAWER-REOPEN-1: LOCATE_COLLAPSE click ⇒ REOPEN (never CLOSE/OPEN blind toggle)', () => {
    expect(resolveProblemsControlAction('locate-collapse', true)).toBe('REOPEN')
  })

  it('DRAWER-REOPEN-2: REOPEN is a distinct intent — must not be interpreted as CLOSE', () => {
    const action = resolveProblemsControlAction('locate-collapse', true)
    expect(action).toBe('REOPEN')
    expect(action).not.toBe('CLOSE')
    // Only a real requested-open with NO collapse may toggle to CLOSE.
    expect(resolveProblemsControlAction('open', true)).toBe('CLOSE')
    expect(resolveProblemsControlAction('closed', false)).toBe('OPEN')
  })

  it('DRAWER-REOPEN-3: after REOPEN the requested-open intent yields the previous stable mode', () => {
    // REOPEN = release the collapse lease, keep requestedOpen=true.
    expect(deriveDrawerPresentation(true, false)).toBe('open')
    // Filter/items/counts live on the Drawer snapshot, never in the lease.
    expect(deriveDrawerPresentation(true, true)).not.toBe('closed')
  })
})

describe('OCCLUSION-5_1 — zero-width / hidden Drawer never occludes', () => {
  it('OCCLUSION-5_1-1: drawerWidth=0 / drawerRect 0×0 ⇒ drawerOccludesTarget=false', () => {
    const facts = computeDrawerOcclusionFacts(r(1390, 0, 1390, 900), codeBody)
    expect(facts.drawerIntersectsFrame).toBe(false)
    expect(facts.drawerIntersectionArea).toBe(0)
    expect(facts.drawerOccludesTarget).toBe(false)
  })

  it('OCCLUSION-5_1-2: drawer hidden (null rect) ⇒ no drawer occlusion at all', () => {
    const facts = computeDrawerOcclusionFacts(null, codeBody)
    expect(facts.drawerOccludesTarget).toBe(false)
    expect(facts.drawerIntersectsFrame).toBe(false)
    expect(facts.drawerIntersectionArea).toBe(0)
  })

  it('OCCLUSION-5_1-3: a real rendered drawer still occludes only via true geometry', () => {
    const drawer = r(800, 0, 1400, 900)
    expect(rectsIntersect(drawer, codeBody)).toBe(true)
    const facts = computeDrawerOcclusionFacts(drawer, codeBody)
    expect(facts.drawerIntersectsFrame).toBe(true)
    expect(facts.drawerIntersectionArea).toBeGreaterThan(0)
    expect(facts.drawerOccludesTarget).toBe(true)
  })
})

describe('LAYER-5_1 — paint-above requires rendered + non-zero + real intersection', () => {
  it('LAYER-5_1-1: toolbar visible but NOT intersecting the frame ⇒ framePaintsAboveToolbar=false', () => {
    // README: code target top≈230.7 vs toolbar bottom≈44 — never intersect.
    expect(rectsIntersect(toolbarTop, codeBody)).toBe(false)
    expect(evaluatePanelPaintRelation(codeBody, toolbarTop, true)).toBe(false)
  })

  it('LAYER-5_1-2: hidden Navigator (null / zero rect) ⇒ framePaintsAboveNavigator=false', () => {
    expect(evaluatePanelPaintRelation(codeBody, null, true)).toBe(false)
    expect(evaluatePanelPaintRelation(codeBody, r(0, 0, 0, 0), true)).toBe(false)
  })

  it('LAYER-5_1-3: Drawer collapsed to a zero rect ⇒ framePaintsAboveDrawer=false', () => {
    expect(evaluatePanelPaintRelation(codeBody, collapsedDrawer, true)).toBe(false)
  })

  it('LAYER-5_1-4: frame really intersects a rendered panel AND paints above it ⇒ true (real FAIL)', () => {
    const overlayPanel = r(300, 100, 900, 300)
    expect(rectsIntersect(codeBody, overlayPanel)).toBe(true)
    expect(evaluatePanelPaintRelation(codeBody, overlayPanel, true)).toBe(true)
    // …and a real intersection that does NOT paint above stays clean.
    expect(evaluatePanelPaintRelation(codeBody, overlayPanel, false)).toBe(false)
  })
})

describe('RETRY-5_1 — layout recovery is transaction-local, max 1 per tx', () => {
  it('RETRY-5_1-1: a new transaction starts with txVisualRetryCount=0 ⇒ recovery allowed', () => {
    expect(canPerformLayoutRecovery(0)).toBe(true)
  })

  it('RETRY-5_1-2: after one layout recovery the counter is 1 ⇒ no second retry this tx', () => {
    expect(MAX_LAYOUT_RECOVERY_RETRY_PER_TX).toBe(1)
    expect(canPerformLayoutRecovery(1)).toBe(false)
  })

  it('RETRY-5_1-3: ATTEMPT_2/ATTEMPT_3 are forbidden (gate stays closed)', () => {
    expect(canPerformLayoutRecovery(2)).toBe(false)
    expect(canPerformLayoutRecovery(3)).toBe(false)
  })

  it('RETRY-5_1-4: a new independent click resets the tx counter to 0 ⇒ gate re-opens', () => {
    expect(canPerformLayoutRecovery(0)).toBe(true)
  })
})

describe('NAME-SLOT-5_1 — primary must be a real small slot, never the whole body', () => {
  const codeBodyWide = r(233.8, 230.7, 1038, 428.3) // ≈804×197.6

  it('NAME-SLOT-5_1-1: real small caption slot ⇒ resolved with primaryRect != codeBodyRect', () => {
    const slot = r(233.8, 192, 420, 228) // small name line above the body
    const res = resolveNameSlotPresentation(slot, codeBodyWide)
    expect(res.expected).toBe(true)
    expect(res.decision).toBe('resolved')
    expect(res.primaryRect).not.toBeNull()
    // Distinct rect: the whole four-edge box differs from the object body.
    const isSame =
      res.primaryRect!.left === codeBodyWide.left &&
      res.primaryRect!.top === codeBodyWide.top &&
      res.primaryRect!.right === codeBodyWide.right &&
      res.primaryRect!.bottom === codeBodyWide.bottom
    expect(isSame).toBe(false)
    expect(res.areaRatio).toBeLessThan(0.35)
  })

  it('NAME-SLOT-5_1-2: primaryArea must be < 0.35 × contextArea', () => {
    const tiny = r(233.8, 192, 420, 228) // 186×36 = 6696 vs 804×197.6
    const res = resolveNameSlotPresentation(tiny, codeBodyWide)
    expect(res.expected).toBe(true)
    expect(res.areaRatio).toBeLessThan(0.35)
    const bigSlot = r(233.8, 230.7, 900, 428.3) // ~666×197.6 ≥ 35%
    const bigRes = resolveNameSlotPresentation(bigSlot, codeBodyWide)
    expect(bigRes.expected).toBe(false)
    expect(bigRes.decision).toBe('fallback')
  })

  it('NAME-SLOT-5_1-3: slot equal to the body / unmeasurable ⇒ FALLBACK (never fake true)', () => {
    const same = resolveNameSlotPresentation(codeBodyWide, codeBodyWide)
    expect(same.expected).toBe(false)
    expect(same.decision).toBe('fallback')
    const none = resolveNameSlotPresentation(null, codeBodyWide)
    expect(none.expected).toBe(false)
    expect(none.decision).toBe('fallback')
    expect(none.primaryRect).toBeNull()
    const zero = resolveNameSlotPresentation(r(0, 0, 0, 0), codeBodyWide)
    expect(zero.expected).toBe(false)
    expect(zero.decision).toBe('fallback')
    // TABLE_MISSING_NAME shares the SAME honest resolver (no separate rule).
    expect(resolveNameSlotPresentation(r(100, 100, 200, 200), r(100, 100, 500, 500)).expected).toBe(true)
  })
})

// ── Host-level terminal-path checks ────────────────────────────────────────
type HostInternals = {
  activeLocateTx: { id: number; diagnosticId: string } | null
  locateDiagnostic(diagnosticId: string): void
  cancelActiveLocateTransaction(reason: string): void
  abortLocateTransaction(tx: { id: number }, completionReason: string, detail: string): void
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
    getHeadingIdentity: () => null,
    parseLocalLinkTargets: () => [],
  }
}

let host: DocumentUtilityOverlayHost | null = null

function mountHostWithWrite(): DocumentUtilityOverlayHost {
  const write = document.createElement('div')
  write.id = 'write'
  write.innerHTML = '<h1>标题</h1><p>正文</p><pre class="md-fences"></pre>'
  document.body.appendChild(write)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders() })
  h.mount()
  h.bindDocument()
  host = h
  return h
}

describe('DRAWER-RECOVERY / SELECTED-5_1 — host terminal paths release the lease and keep the Drawer intent', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number)
    Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    host?.dispose()
    host = null
  })

  function openDrawerViaToolbar(h: DocumentUtilityOverlayHost): void {
    const diagBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')
    expect(diagBtn).toBeTruthy()
    diagBtn!.click()
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(h.getDrawerPresentationMode()).toBe('open')
  }

  function clickFirstRow(): string | null {
    const drawer = document.querySelector('.inkchapter-doc-drawer') as HTMLElement
    // V5.12-R2 — the visibility lease protects an ACTIVE VISUAL, so a target with
    // a real element carrier is required (a document-level row has no carrier).
    const items = Array.from(drawer.querySelectorAll<HTMLElement>('.inkchapter-doc-drawer__item[data-diagnostic-id]'))
      .filter(el => !String(el.getAttribute('data-diagnostic-id')).startsWith('document:'))
    expect(items.length).toBeGreaterThan(0)
    items[0].click()
    return items[0].getAttribute('data-diagnostic-id')
  }

  it('COMMITTED terminal: V5.12-R2 keeps the ACTIVE LOCATE VISIBILITY LEASE held', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    const rowId = clickFirstRow()
    vi.advanceTimersByTime(60) // async settle gate completes the tx
    expect(h.isLocateTransactionActive()).toBe(false)
    // V5.12-R2 §13.3 — a COMMIT must NOT release the lease: the ACTIVE VISUAL is
    // still on screen and restoring the Drawer would re-cover the target.
    expect(h.getLocateVisibilityLeaseActive()).toBe(true)
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(h.getDrawerPresentationMode()).toBe('open')
    expect(h.getLastLocatedDiagnosticId()).toBe(rowId)
    expect(h.getTxVisualRetryCount()).toBe(0) // new tx always starts at 0
    // The lease is released by a real END of the active visual (dismiss).
    ;(h as unknown as { dismissLocateVisualFromDocumentPointer: (ev: PointerEvent) => void })
      .dismissLocateVisualFromDocumentPointer(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true }))
    expect(h.getLocateVisibilityLeaseActive()).toBe(false)
  })

  it('DRAWER-REOPEN-V512R2: an explicit Problems-Control reopen releases the held lease', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    clickFirstRow()
    vi.advanceTimersByTime(60)
    expect(h.getLocateVisibilityLeaseActive()).toBe(true)
    // §13.4 — an explicit OPEN intent is the absolute reopen authority.
    ;(h as unknown as { openDrawer(filter?: string): void }).openDrawer('all')
    expect(h.getLocateVisibilityLeaseActive()).toBe(false)
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(h.getDrawerPresentationMode()).toBe('open')
    expect(h.getVisualClosureCounters().toolbarReopenRegression).toBe(0)
  })

  it('DRAWER-RECOVERY-2 + FAILED terminal: a failing locate never drops the requested-open Drawer', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    const internals = h as unknown as HostInternals
    internals.locateDiagnostic('ghost:not-present') // NOT_FOUND → finish(FAILED)
    expect(h.isLocateTransactionActive()).toBe(false)
    expect(h.getDrawerRecoveryLeaseActive()).toBe(false)
    expect(h.getDrawerRequestedOpen()).toBe(true) // intent preserved
    expect(h.getDrawerPresentationMode()).toBe('open') // restored (never collapse/closed)
    expect(h.getPresentationCounters().failedLocateWithDrawerCollapsed).toBe(0)
    expect(h.getPresentationCounters().drawerRequestedOpenLost).toBe(0)
  })

  it('DRAWER-RECOVERY-3 + CANCELLED (document switch): no stale collapse lease', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    const internals = h as unknown as HostInternals
    clickFirstRow() // starts an async settle tx
    expect(h.isLocateTransactionActive()).toBe(true)
    internals.cancelActiveLocateTransaction('DOCUMENT_SWITCH')
    expect(h.isLocateTransactionActive()).toBe(false)
    expect(h.getDrawerRecoveryLeaseActive()).toBe(false)
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(h.getDrawerPresentationMode()).toBe('open')
  })

  it('DRAWER-RECOVERY-4 + EXCEPTION terminal: abort always restores the Drawer', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    const internals = h as unknown as HostInternals
    clickFirstRow()
    expect(h.isLocateTransactionActive()).toBe(true)
    const tx = internals.activeLocateTx
    expect(tx).not.toBeNull()
    internals.abortLocateTransaction(tx!, 'FORCED_EXCEPTION', 'test')
    expect(h.isLocateTransactionActive()).toBe(false)
    expect(h.getDrawerRecoveryLeaseActive()).toBe(false)
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(h.getDrawerPresentationMode()).toBe('open')
  })

  it('SELECTED-5_1-1/2: selected diagnostic survives locate + is never lost to null on failure', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    const internals = h as unknown as HostInternals
    const rowId = clickFirstRow()
    vi.advanceTimersByTime(60) // commit → selected row stays
    expect(h.getLastLocatedDiagnosticId()).toBe(rowId)
    // A second independent tx (new attempt) also keeps a non-null selection.
    internals.locateDiagnostic('ghost:not-present') // FAILED terminal
    expect(h.getLastLocatedDiagnosticId()).not.toBeNull()
    expect(h.getPresentationCounters().selectedDiagnosticLostDuringRecovery).toBe(0)
  })

  it('REOPEN-5_1 regression: clicking Problems Control again re-opens and preserves item counts', () => {
    const h = mountHostWithWrite()
    openDrawerViaToolbar(h)
    vi.advanceTimersByTime(60)
    const drawerEl = document.querySelector('.inkchapter-doc-drawer') as HTMLElement
    const itemCountBefore = drawerEl.querySelectorAll('.inkchapter-doc-drawer__item[data-diagnostic-id]').length
    expect(itemCountBefore).toBeGreaterThan(0)
    expect(h.getDrawerRequestedOpen()).toBe(true)
    // Problems-Control segments always openDrawer (explicit intent) — a second
    // click must never be interpreted as a blind CLOSE that hides the Drawer.
    const diagBtn = document.querySelector<HTMLButtonElement>('.inkchapter-doc-toolbar__btn--diag')
    diagBtn!.click()
    expect(h.getDrawerRequestedOpen()).toBe(true)
    expect(drawerEl.style.display).toContain('flex')
    const itemCountAfter = drawerEl.querySelectorAll('.inkchapter-doc-drawer__item[data-diagnostic-id]').length
    expect(itemCountAfter).toBe(itemCountBefore)
  })
})
