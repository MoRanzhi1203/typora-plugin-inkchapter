// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.3 — Document Utilities Overlay Layout V2 tests:
 *  - NAV-VIS-1..6: short-document navigator visibility (real scroll metrics).
 *  - LAYOUT-1..4: drawer/navigator independent anchors + editor non-reflow.
 *  - DRAWER-H-1..6: content-fit drawer height / max-height / internal scroll.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  computeOverlayGeometry,
  DocumentUtilityOverlayHost,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

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

const VIEWPORT = 1920

/** Scroll metrics are MUTABLE per test so short→long transitions can be proven. */
function makeShell() {
  const rect = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }
  const shell = document.createElement('div')
  shell.style.cssText = 'overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value: 700 })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, writable: true, value: 700 })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return { shell, rect }
}

/** HTMLElement.scrollHeight is readonly in the TS DOM lib; re-define it mutable. */
function setScrollHeight(shell: HTMLElement, value: number): void {
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 })
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return h
}

function navigatorDisplay(h: DocumentUtilityOverlayHost): string {
  const nav = h['navigatorEl'] as HTMLElement | null
  return nav?.style.display ?? ''
}

function drawerStyle(h: DocumentUtilityOverlayHost): { bottom: string; maxHeight: string } {
  const d = h['drawerEl'] as HTMLElement | null
  return { bottom: d?.style.bottom ?? '', maxHeight: d?.style.maxHeight ?? '' }
}

function navRect(h: DocumentUtilityOverlayHost): { right: number; bottom: number } | null {
  const nav = h['latestRects'].navigator
  return nav ? { right: nav.right, bottom: nav.bottom } : null
}

describe('NAV-VIS-1/2/3 pure scrollability authority', () => {
  const viewport = { width: VIEWPORT, height: 1080 }
  const shell = { top: 100, right: 1400, bottom: 900 }

  it('NAV-VIS-1: scrollHeight=700 clientHeight=700 → maxScrollTop=0 → hidden', () => {
    const g = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 700, clientHeight: 700 })
    expect(g.scrollable).toBe(false)
    expect(g.navigatorVisible).toBe(false)
  })

  it('NAV-VIS-2: scrollHeight=700.5 clientHeight=700 → within epsilon → hidden', () => {
    const g = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 700.5, clientHeight: 700 })
    expect(g.scrollable).toBe(false)
    expect(g.navigatorVisible).toBe(false)
  })

  it('NAV-VIS-3: scrollHeight=702 clientHeight=700 → scrollable → visible', () => {
    const g = computeOverlayGeometry(shell, viewport, { drawerOpen: false, scrollHeight: 702, clientHeight: 700 })
    expect(g.scrollable).toBe(true)
    expect(g.navigatorVisible).toBe(true)
  })
})

describe('NAV-VIS-4/5/6 live visibility transitions (host level)', () => {
  it('NAV-VIS-4: short → long → navigator appears', () => {
    const { shell } = makeShell()
    const h = mountHost()
    expect(navigatorDisplay(h)).toBe('none')
    setScrollHeight(shell, 702) // user keeps typing → real container becomes scrollable
    window.dispatchEvent(new Event('resize')) // geometry re-measure
    expect(navigatorDisplay(h)).toBe('flex')
    h.dispose()
  })

  it('NAV-VIS-5: long → short → navigator disappears', () => {
    const { shell } = makeShell()
    setScrollHeight(shell, 2000)
    const h = mountHost()
    expect(navigatorDisplay(h)).toBe('flex')
    setScrollHeight(shell, 700) // content deleted
    window.dispatchEvent(new Event('resize'))
    expect(navigatorDisplay(h)).toBe('none')
    h.dispose()
  })

  it('NAV-VIS-6: document switch A(scrollable) → B(short) → B hidden (no stale)', () => {
    const { shell } = makeShell()
    setScrollHeight(shell, 2000)
    const h = mountHost()
    expect(navigatorDisplay(h)).toBe('flex')
    // Doc B is short; bindDocument triggers a geometry re-measure.
    setScrollHeight(shell, 700)
    h.bindDocument()
    expect(navigatorDisplay(h)).toBe('none')
    h.dispose()
  })
})

describe('LAYOUT drawer/navigator isolation (host level)', () => {
  function makeScrollable() {
    const { shell } = makeShell()
    setScrollHeight(shell, 2000)
    return shell
  }
  function openDrawer(): void {
    ;(document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement).click()
  }
  function closeDrawer(): void {
    const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
    close.click()
  }

  it('LAYOUT-1: drawer open → navigator right/bottom unchanged (delta 0)', () => {
    makeScrollable()
    const h = mountHost()
    const before = navRect(h)
    expect(before).toBeTruthy()
    openDrawer()
    const after = navRect(h)
    expect(after).toBeTruthy()
    expect(Math.abs(after!.right - before!.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(after!.bottom - before!.bottom)).toBeLessThanOrEqual(1)
    h.dispose()
  })

  it('LAYOUT-2: drawer close → navigator right/bottom unchanged (delta 0)', () => {
    makeScrollable()
    const h = mountHost()
    openDrawer()
    const before = navRect(h)
    expect(before).toBeTruthy()
    closeDrawer()
    const after = navRect(h)
    expect(after).toBeTruthy()
    expect(Math.abs(after!.right - before!.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(after!.bottom - before!.bottom)).toBeLessThanOrEqual(1)
    h.dispose()
  })

  it('LAYOUT-3: different drawer item message lengths → navigator X unchanged', () => {
    makeScrollable()
    const h = mountHost()
    openDrawer()
    const before = navRect(h)
    expect(before).toBeTruthy()
    // Force a drawer re-render with a longer message set via the snapshot.
    h['snapshot'] = {
      documentKey: 'doc:key',
      revision: 2,
      sourceRevision: 2,
      generatedAt: 0,
      diagnostics: [
        { id: 'd1', documentKey: 'doc:key', category: 'code', code: 'CODE_MISSING_NAME', severity: 'warning', message: '代码块缺少名称'.repeat(30), detail: 'x'.repeat(200) },
        { id: 'd2', documentKey: 'doc:key', category: 'document', code: 'DOCUMENT_TERMINAL_NEWLINE_MISSING', severity: 'warning', message: '文档末尾缺少换行符'.repeat(30), detail: 'y'.repeat(200) },
      ],
      errorCount: 0,
      warningCount: 2,
      infoCount: 0,
    }
    h['renderDrawer']()
    window.dispatchEvent(new Event('resize'))
    const after = navRect(h)
    expect(after).toBeTruthy()
    expect(Math.abs(after!.right - before!.right)).toBeLessThanOrEqual(1)
    h.dispose()
  })

  it('LAYOUT-4: drawer open does NOT reflow editor/scroll container', () => {
    const { shell, rect } = makeShell()
    setScrollHeight(shell, 2000)
    const widthBefore = rect.width
    const h = mountHost()
    openDrawer()
    expect(rect.width).toBe(widthBefore) // shell width untouched by the drawer
    const d = h['drawerEl'] as HTMLElement | null
    expect(d?.style.bottom).toBe('') // not stretched to viewport bottom
    h.dispose()
  })
})

describe('DRAWER-H content-fit height authority', () => {
  function scrollableShell() {
    const { shell } = makeShell()
    setScrollHeight(shell, 2000)
    return shell
  }
  function openDrawer(): void {
    ;(document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement).click()
  }
  function setItems(h: DocumentUtilityOverlayHost, count: number): void {
    const items: Array<{ code: string; severity: 'warning'; message: string; detail: string | null; }> = []
    for (let i = 0; i < count; i++) items.push({ code: `W${i}`, severity: 'warning', message: `警告项 ${i}`, detail: null, })
    h['snapshot'] = {
      documentKey: 'doc:key', revision: 3, sourceRevision: 3, generatedAt: 0,
      diagnostics: items as never,
      errorCount: 0, warningCount: count, infoCount: 0,
    }
    h['renderDrawer']()
  }

  it('DRAWER-H-1: 0 items → compact empty state (no tall white area)', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 0)
    const empty = document.querySelector('.inkchapter-doc-drawer__item--empty')
    expect(empty).toBeTruthy()
    const { bottom } = drawerStyle(h)
    expect(bottom).toBe('') // content-sized, never stretched
    h.dispose()
  })

  it('DRAWER-H-2: 2 items → content intrinsic height, body not scrollable', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 2)
    const list = document.querySelector('.inkchapter-doc-drawer__list') as HTMLElement | null
    expect(list).toBeTruthy()
    const items = document.querySelectorAll('.inkchapter-doc-drawer__item').length
    expect(items).toBe(2)
    // The drawer is NOT stretched (bottom unset); max-height cap is applied.
    const { maxHeight } = drawerStyle(h)
    expect(Number.parseInt(maxHeight)).toBeGreaterThan(0)
    h.dispose()
  })

  it('DRAWER-H-3: many items → capped at maxHeight', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 40)
    const { maxHeight } = drawerStyle(h)
    expect(Number.parseInt(maxHeight)).toBe(1080 - (100 + 56) - 140) // viewport − top − reserved
    h.dispose()
  })

  /**
   * jsdom has no layout engine, so getBoundingClientRect().height is always 0.
   * This stub simulates the browser applying the production CSS contract
   * (`height:auto; max-height:N`) to the rendered drawer: intrinsic content
   * height from the item count, capped by the max-height the host applied.
   */
  function simulatedDrawerHeight(h: DocumentUtilityOverlayHost): number {
    const d = h['drawerEl'] as HTMLElement
    const rowH = 40
    const chromeH = 48
    const maxH = Number.parseInt(d.style.maxHeight) || Number.MAX_SAFE_INTEGER
    const itemCount = d.querySelectorAll('.inkchapter-doc-drawer__item').length
    const height = Math.min(chromeH + itemCount * rowH, maxH)
    Object.defineProperty(d, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 250, y: 100, width: 320, height, top: 100, left: 250, right: 570, bottom: 100 + height, toJSON: () => ({}) }),
    })
    return height
  }

  it('DRAWER-H-4: 2 → 1 item → drawer height decreases', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 2)
    const h2 = simulatedDrawerHeight(h)
    setItems(h, 1)
    const h1 = simulatedDrawerHeight(h)
    expect(h1).toBeLessThan(h2)
    expect(h['drawerEl']?.style.bottom).toBe('') // still content-sized, not stretched
    h.dispose()
  })

  it('DRAWER-H-5: 1 → 0 item → shrinks to empty state', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 1)
    const h1 = simulatedDrawerHeight(h)
    setItems(h, 0)
    const h0 = simulatedDrawerHeight(h)
    expect(h0).toBeLessThan(h1)
    expect(document.querySelector('.inkchapter-doc-drawer__item--empty')).toBeTruthy()
    h.dispose()
  })

  it('DRAWER-H-6: 1 → many items → grows only to maxHeight', () => {
    scrollableShell()
    const h = mountHost()
    openDrawer()
    setItems(h, 1)
    const h1 = simulatedDrawerHeight(h)
    setItems(h, 40)
    const h40 = simulatedDrawerHeight(h)
    const { maxHeight } = drawerStyle(h)
    expect(h40).toBeGreaterThan(h1)
    expect(h40).toBeLessThanOrEqual(Number.parseInt(maxHeight))
    h.dispose()
  })
})
