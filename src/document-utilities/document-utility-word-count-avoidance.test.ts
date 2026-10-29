// @vitest-environment jsdom
/**
 * Native word-count panel ↔ InkChapter navigator avoidance.
 *
 * Covers:
 *  - panel CLOSED → navigator keeps its resolved base anchor (no shift);
 *  - panel OPEN + intersection → LEFT avoidance first (right edge clears the
 *    panel's left edge);
 *  - left space exhausted → UP avoidance;
 *  - neither direction fits → temporary HIDE (panel-scoped);
 *  - window / sidebar geometry changes (bounds) re-decide LEFT → UP → HIDE;
 *  - panel size changes alter the required offset;
 *  - CLOSE restores the exact base anchor, with no residual offset or marker;
 *  - the native panel is only READ (measured), never written;
 *  - host/CSS wiring contracts (bounded observers, single writer, focus safety).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computeWordCountPanelAvoidance,
  measureWordCountPanelRect,
  writeNavigatorWordCountAvoidance,
  NAV_WORD_COUNT_AVOID_ATTR,
  WORD_COUNT_AVOID_GAP_PX,
  WORD_COUNT_PANEL_OPEN_CLASS,
  type AvoidRect,
} from './document-utility-word-count-avoidance'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'

/** 30×57 navigator anchored near the bottom-right corner (CSS px). */
const NAV: AvoidRect = { left: 1382, top: 800, right: 1412, bottom: 857 }
/** 196×160 native panel above the status bar, right-aligned at right:4px. */
const PANEL: AvoidRect = { left: 1290, top: 700, right: 1486, bottom: 860 }
const BOUNDS = { left: 400, top: 100 }

describe('WCA-1 panel closed → default anchor', () => {
  it('no panel rect means no avoidance and a stable signature', () => {
    const r = computeWordCountPanelAvoidance({ navigator: NAV, panel: null, bounds: BOUNDS })
    expect(r.mode).toBe('DEFAULT')
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
    expect(r.reason).toBe('PANEL_CLOSED')

    const again = computeWordCountPanelAvoidance({ navigator: NAV, panel: null, bounds: BOUNDS })
    expect(again.signature).toBe(r.signature)
  })

  it('non-intersecting panel (far above) also keeps the base anchor', () => {
    const r = computeWordCountPanelAvoidance({
      navigator: NAV,
      panel: { left: 1290, top: 200, right: 1486, bottom: 360 },
      bounds: BOUNDS,
    })
    expect(r.mode).toBe('DEFAULT')
    expect(r.reason).toBe('NO_INTERSECTION')
  })
})

describe('WCA-2 panel open → prefer LEFT avoidance', () => {
  it('right edge clears panel.left - gap', () => {
    const r = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: BOUNDS })
    expect(r.mode).toBe('SHIFT_LEFT')
    expect(r.dy).toBe(0)
    const expectedDx = NAV.right - (PANEL.left - WORD_COUNT_AVOID_GAP_PX)
    expect(r.dx).toBe(Math.ceil(expectedDx))
    // After shifting, the two boxes no longer intersect.
    expect(NAV.right - r.dx).toBeLessThanOrEqual(PANEL.left - WORD_COUNT_AVOID_GAP_PX)
    // …and the shifted box still starts right of the editor's left limit.
    expect(NAV.left - r.dx).toBeGreaterThanOrEqual(BOUNDS.left)
  })
})

describe('WCA-3 left space exhausted → UP avoidance', () => {
  it('bottom edge clears panel.top - gap', () => {
    const r = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 1300, top: 100 } })
    expect(r.mode).toBe('SHIFT_UP')
    expect(r.dx).toBe(0)
    const expectedDy = NAV.bottom - (PANEL.top - WORD_COUNT_AVOID_GAP_PX)
    expect(r.dy).toBe(Math.ceil(expectedDy))
    expect(NAV.bottom - r.dy).toBeLessThanOrEqual(PANEL.top - WORD_COUNT_AVOID_GAP_PX)
    expect(NAV.top - r.dy).toBeGreaterThanOrEqual(100)
  })
})

describe('WCA-4 no room in either direction → temporary HIDE', () => {
  it('hides when left and up are both exhausted', () => {
    const r = computeWordCountPanelAvoidance({
      navigator: NAV,
      panel: PANEL,
      bounds: { left: 1300, top: 800 },
    })
    expect(r.mode).toBe('HIDE')
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
    expect(r.reason).toBe('NO_SPACE_LEFT_AND_UP')
  })
})

describe('WCA-5 geometry changes re-decide (window resize / sidebar pin / width drag)', () => {
  // The same panel + navigator, two different editor-left limits: this is the
  // exact input that changes on window resize, sidebar pin/unpin and a sidebar
  // width drag (the editor's visible left edge moves, the panel does not).
  it('narrow left room flips LEFT → UP', () => {
    expect(computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 400, top: 100 } }).mode).toBe('SHIFT_LEFT')
    expect(computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 1300, top: 100 } }).mode).toBe('SHIFT_UP')
  })

  it('a navigator resolved further right clears the panel and needs no shift', () => {
    // Geometry pass changes the BASE anchor (gutter ↔ inset): a navigator that
    // already sits right of the panel is left alone; the overlapping one moves.
    const inside = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 0, top: 0 } })
    const outside = computeWordCountPanelAvoidance({
      navigator: { ...NAV, left: 1500, right: 1530 },
      panel: PANEL,
      bounds: { left: 0, top: 0 },
    })
    expect(inside.mode).toBe('SHIFT_LEFT')
    expect(outside.mode).toBe('DEFAULT')
  })
})

describe('WCA-6 panel size changes drive the offset', () => {
  it('a wider panel (smaller left edge) needs a larger dx; the height is irrelevant', () => {
    const base = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: BOUNDS })
    const wider = computeWordCountPanelAvoidance({
      navigator: NAV,
      panel: { ...PANEL, left: PANEL.left - 60 },
      bounds: BOUNDS,
    })
    expect(base.mode).toBe('SHIFT_LEFT')
    expect(wider.mode).toBe('SHIFT_LEFT')
    expect(wider.dx).toBe(base.dx + 60)

    const taller = computeWordCountPanelAvoidance({ navigator: NAV, panel: { ...PANEL, top: PANEL.top - 80 }, bounds: BOUNDS })
    expect(taller.dx).toBe(base.dx)
  })

  it('a panel that grows down onto the navigator becomes intersecting', () => {
    const below = { ...PANEL, top: NAV.bottom + 40, bottom: NAV.bottom + 40 }
    expect(computeWordCountPanelAvoidance({ navigator: NAV, panel: below, bounds: BOUNDS }).mode).toBe('DEFAULT')
    const grown = { ...below, top: NAV.top + 10 }
    expect(computeWordCountPanelAvoidance({ navigator: NAV, panel: grown, bounds: BOUNDS }).mode).not.toBe('DEFAULT')
  })
})

describe('WCA-7 DOM writer: temporary hide + exact restore', () => {
  let nav: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    nav = document.createElement('div')
    nav.className = 'inkchapter-doc-navigator'
    document.body.appendChild(nav)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('SHIFT_LEFT writes base + dx on right and keeps bottom', () => {
    const r = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: BOUNDS })
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, r)
    expect(nav.style.right).toBe(`${12 + r.dx}px`)
    expect(nav.style.bottom).toBe('94px')
    expect(nav.style.display).toBe('flex')
    expect(nav.hasAttribute(NAV_WORD_COUNT_AVOID_ATTR)).toBe(false)
  })

  it('SHIFT_UP writes base + dy on bottom and keeps right', () => {
    const r = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 1300, top: 100 } })
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, r)
    expect(nav.style.right).toBe('12px')
    expect(nav.style.bottom).toBe(`${94 + r.dy}px`)
  })

  it('HIDE sets the panel-scoped marker, then CLOSE removes it and restores the base anchor', () => {
    const hide = computeWordCountPanelAvoidance({ navigator: NAV, panel: PANEL, bounds: { left: 1300, top: 800 } })
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, hide)
    expect(nav.getAttribute(NAV_WORD_COUNT_AVOID_ATTR)).toBe('hidden')
    expect(nav.style.display).toBe('none')
    expect(nav.hidden).toBe(true)

    // Panel closed → the SAME writer restores the base anchor exactly.
    const closed = computeWordCountPanelAvoidance({ navigator: NAV, panel: null, bounds: { left: 1300, top: 800 } })
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, closed)
    expect(nav.hasAttribute(NAV_WORD_COUNT_AVOID_ATTR)).toBe(false)
    expect(nav.style.display).toBe('flex')
    expect(nav.hidden).toBe(false)
    expect(nav.style.right).toBe('12px')
    expect(nav.style.bottom).toBe('94px')
  })

  it('repeated DEFAULT writes are idempotent (no accumulated offset)', () => {
    const closed = computeWordCountPanelAvoidance({ navigator: NAV, panel: null, bounds: BOUNDS })
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, closed)
    writeNavigatorWordCountAvoidance(nav, { right: 12, bottom: 94 }, closed)
    expect(nav.style.right).toBe('12px')
    expect(nav.style.bottom).toBe('94px')
  })
})

describe('WCA-8 native panel measurement (read-only)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    vi.restoreAllMocks()
  })

  function mountPanel(rect: AvoidRect | null, open = true): HTMLElement {
    const panel = document.createElement('ul')
    panel.id = 'footer-word-count-info'
    panel.className = 'dropdown-menu'
    document.body.appendChild(panel)
    if (open) document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
    if (rect) {
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.right - rect.left, height: rect.bottom - rect.top,
        x: rect.left, y: rect.top, toJSON: () => ({}),
      } as DOMRect)
    }
    return panel
  }

  it('closed body marker → no panel, no avoidance', () => {
    mountPanel(PANEL, false)
    expect(measureWordCountPanelRect(document)).toEqual({ open: false, rect: null })
  })

  it('open marker + real box → measured rect', () => {
    mountPanel(PANEL, true)
    const m = measureWordCountPanelRect(document)
    expect(m.open).toBe(true)
    expect(m.rect).toEqual(PANEL)
  })

  it('open marker but a zero box (source-code mode) → treated as closed', () => {
    mountPanel(null, true)
    const m = measureWordCountPanelRect(document)
    expect(m.open).toBe(true)
    expect(m.rect).toBeNull()
    expect(computeWordCountPanelAvoidance({ navigator: NAV, panel: m.rect, bounds: BOUNDS }).mode).toBe('DEFAULT')
  })

  it('the panel DOM is never mutated by measuring', () => {
    const panel = mountPanel(PANEL, true)
    const before = panel.outerHTML
    measureWordCountPanelRect(document)
    expect(panel.outerHTML).toBe(before)
  })
})

describe('WCA-10 host integration (real resolver + freshly measured rects)', () => {
  let host: DocumentUtilityOverlayHost | null = null
  const VIEWPORT = { w: 1024, h: 768 }

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
      getHeadingIdentity: () => null,
      parseLocalLinkTargets: () => [],
    } as unknown as DocumentDiagnosticsProviders
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT.w })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT.h })
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} } as unknown as typeof ResizeObserver)
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)

    // The NATIVE panel (only ever measured, never written).
    const panel = document.createElement('ul')
    panel.id = 'footer-word-count-info'
    panel.className = 'dropdown-menu'
    document.body.appendChild(panel)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 800, top: 500, right: 1010, bottom: 660, width: 210, height: 160,
      x: 800, y: 500, toJSON: () => ({}),
    } as DOMRect)

    const shell = document.createElement('div')
    shell.style.cssText = 'position:relative;overflow-y:auto;'
    Object.defineProperty(shell, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, right: 900, bottom: 700, left: 250, width: 650, height: 600 }),
    })
    const write = document.createElement('div')
    write.id = 'write'
    shell.appendChild(write)
    document.body.appendChild(shell)
  })

  afterEach(() => {
    try { host?.dispose() } catch { /* jsdom best-effort */ }
    host = null
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('open → SHIFT_LEFT with the real dx; close → DEFAULT (restore)', () => {
    host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} } as never)
    host.mount()

    const nav = document.querySelector('.inkchapter-doc-navigator') as HTMLElement
    expect(nav).toBeTruthy()
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
      left: 982, top: 617, right: 1012, bottom: 674, width: 30, height: 57,
      x: 982, y: 617, toJSON: () => ({}),
    } as DOMRect)

    // A resolved visible presentation with the production base anchor.
    ;(host as unknown as { lastNavVis: unknown }).lastNavVis = { presentation: 'inset', reason: 'TEST', insetRightPx: 12 }
    const resolve = (host as unknown as {
      resolveWordCountPanelAvoidance: (a: {
        baseRight: number; baseBottom: number; editorLeft: number | null; editorTop: number | null
      }) => { mode: string; dx: number; dy: number }
    }).resolveWordCountPanelAvoidance.bind(host)
    const args = { baseRight: 12, baseBottom: 94, editorLeft: 250, editorTop: 100 }

    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
    const open = resolve(args)
    expect(open.mode).toBe('SHIFT_LEFT')
    // 1012 (nav.right) − (800 (panel.left) − 8 (gap)) = 220
    expect(open.dx).toBe(220)
    expect(open.dy).toBe(0)

    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    const closed = resolve(args)
    expect(closed.mode).toBe('DEFAULT')
    expect(closed.dx).toBe(0)
    expect(closed.dy).toBe(0)
  })

  it('panel-open press stays on the button (no document-level close → no snap-back)', () => {
    host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} } as never)
    host.mount()
    const btn = document.querySelector('.inkchapter-doc-navigator__btn') as HTMLButtonElement
    expect(btn).toBeTruthy()
    // A hidden/disabled control never activates; enable it for the bubbling test.
    btn.disabled = false
    let docClicks = 0
    const onDocClick = (): void => { docClicks++ }
    document.addEventListener('click', onDocClick)
    try {
      btn.click()
      expect(docClicks).toBe(1) // panel closed → the press bubbles like any other
      document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
      docClicks = 0
      btn.click()
      expect(docClicks).toBe(0) // panel open → Typora's outside-click close never sees it
    } finally {
      document.removeEventListener('click', onDocClick)
    }
  })

  it('the action is committed on press and the following click is de-duplicated', () => {
    host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} } as never)
    host.mount()
    const btn = document.querySelector('.inkchapter-doc-navigator__btn') as HTMLButtonElement
    btn.disabled = false
    const spy = vi.spyOn(host as unknown as { handleScrollAction: (a: string) => void }, 'handleScrollAction')
    try {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      expect(spy).toHaveBeenCalledTimes(1)
      // The mouse click that follows the press must NOT scroll a second time
      // (it may even land on the editor after the native panel closes).
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      expect(spy).toHaveBeenCalledTimes(1)
      // Keyboard activation never produces a mousedown → runs exactly once.
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('panel-open press is executed at gesture end (after the native caret restore)', async () => {
    host = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} } as never)
    host.mount()
    const buttons = document.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-navigator__btn')
    const bottom = buttons[1]
    bottom.disabled = false
    const spy = vi.spyOn(host as unknown as { handleScrollAction: (a: string, s?: string) => void }, 'handleScrollAction')
    try {
      document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
      bottom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      // Deferred — the native close would otherwise discard the scroll.
      expect(spy).not.toHaveBeenCalled()
      // Typora closes the panel on the same press: ADMITTED, still no scroll
      // (the native caret restore has not finished yet).
      document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(spy).not.toHaveBeenCalled()
      // The physical gesture ends → exactly one execution, at the document level
      // (i.e. after Typora's own click / caret-restore handler).
      document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('GO_BOTTOM', 'BUTTON')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('WCA-9 host / CSS wiring contracts', () => {
  const hostSrc = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
  const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

  it('host uses the shared decision + the single navigator writer', () => {
    expect(hostSrc).toContain('computeWordCountPanelAvoidance(')
    expect(hostSrc).toContain('measureWordCountPanelRect(')
    expect(hostSrc).toContain('writeNavigatorWordCountAvoidance(')
  })

  it('observers stay bounded (one body-class attribute filter + one panel ResizeObserver)', () => {
    expect(hostSrc).toContain("attributeFilter: ['class']")
    expect(hostSrc).toContain("scheduleGeometrySync(open ? 'word-count-panel-open' : 'word-count-panel-close')")
    expect(hostSrc).toContain("scheduleGeometrySync('word-count-panel-resize')")
    // No polling / no fixed-delay stability guess for this feature.
    expect(hostSrc).not.toContain('setInterval(')
  })

  it('CSS hides ONLY the navigator for the panel-scoped marker', () => {
    expect(scss).toContain(".inkchapter-doc-navigator[data-ink-wc-avoid='hidden']")
    expect(scss).toContain('data-ink-wc-avoid')
    // The native footer widgets are never targeted for hiding by InkChapter.
    expect(scss).not.toMatch(/#footer-word-count[^-\w][^{]*\{[^}]*display\s*:\s*none/)
  })

  it('navigator buttons never steal the editor focus on press', () => {
    // Both buttons share ONE press handler, and that handler default-prevents
    // the mousedown before it can move focus (or the caret).
    expect(hostSrc).toContain("bindNavigatorButton(topBtn, 'GO_TOP')")
    expect(hostSrc).toContain("bindNavigatorButton(bottomBtn, 'GO_BOTTOM')")
    expect(hostSrc).toMatch(/addEventListener\('mousedown'[\s\S]{0,240}?ev\.preventDefault\(\)/)
  })
})
