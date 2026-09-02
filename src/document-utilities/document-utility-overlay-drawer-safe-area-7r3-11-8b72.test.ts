// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.7.2 — Diagnostics Panel Bottom Safe Area tests.
 *
 * The drawer may only grow down to `viewport − drawerTop − reserve` where the
 * reserve derives from the REAL navigator box (navBottom + measured height +
 * safe gap). The fixed 140px estimate is gone for measured callers.
 *
 *   SAFE-1 pure reserve formula (measured / hidden / unmeasured)
 *   SAFE-2 host: drawer maxHeight uses the real navigator height
 *   SAFE-3 host: small viewport → navigator temporarily hidden (panel stays usable)
 *   SAFE-4 host: open → close restores the navigator (layout recovery)
 *   SAFE-5 host: navigator position never moves when the drawer opens
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  computeDrawerBottomReserve,
  DocumentUtilityOverlayHost,
  DRAWER_NAV_SAFE_GAP_PX,
  MIN_DRAWER_USABLE_HEIGHT_PX,
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

const VIEWPORT_W = 1920
const NAV_HEIGHT = 66

/** Shell rect overridable per test. */
function makeShell(opts: { top?: number; bottom?: number; right?: number } = {}) {
  const rect = {
    left: 250,
    top: opts.top ?? 100,
    right: opts.right ?? 1400,
    bottom: opts.bottom ?? 900,
    width: 1150,
    height: (opts.bottom ?? 900) - (opts.top ?? 100),
  }
  const shell = document.createElement('div')
  shell.style.cssText = 'overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, writable: true, value: 2000 })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, writable: true, value: 700 })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return { shell, rect }
}

/**
 * jsdom has no layout engine: give the navigator a REAL box via a prototype
 * stub (height 66px like production). Every other element keeps 0×0.
 */
function stubNavigatorBox() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('inkchapter-doc-navigator')) {
      const bottom = 94
      const top = 1080 - bottom - NAV_HEIGHT // 920
      return {
        x: 1800, y: top, width: 40, height: NAV_HEIGHT,
        top, left: 1800, right: 1840, bottom: top + NAV_HEIGHT,
        toJSON: () => ({}),
      } as DOMRect
    }
    return {
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
    } as DOMRect
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_W })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 })
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  return h
}

function openDrawer(): void {
  ;(document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement).click()
}

function closeDrawer(): void {
  const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
  close.click()
}

function drawerStyle(h: DocumentUtilityOverlayHost): { maxHeight: string } {
  const d = h['drawerEl'] as HTMLElement | null
  return { maxHeight: d?.style.maxHeight ?? '' }
}

function navigatorDisplay(h: DocumentUtilityOverlayHost): string {
  const nav = h['navigatorEl'] as HTMLElement | null
  return nav?.style.display ?? ''
}

describe('SAFE-1: pure reserve formula', () => {
  it('measured navigator → reserve = navBottom + real height + safe gap', () => {
    expect(computeDrawerBottomReserve({ navBottom: 94.4, navigatorVisible: true, navigatorHeightPx: 66, bottomGap: 30.4 }))
      .toBeCloseTo(94.4 + 66 + DRAWER_NAV_SAFE_GAP_PX)
  })

  it('hidden navigator → only shell bottom gap + padding reserved', () => {
    expect(computeDrawerBottomReserve({ navBottom: 94.4, navigatorVisible: false, navigatorHeightPx: 66, bottomGap: 30.4 }))
      .toBeCloseTo(30.4 + 16 + DRAWER_NAV_SAFE_GAP_PX)
  })

  it('visible navigator before first measurement → hidden-branch reserve (never a guess)', () => {
    expect(computeDrawerBottomReserve({ navBottom: 94.4, navigatorVisible: true, navigatorHeightPx: null, bottomGap: 30.4 }))
      .toBeCloseTo(30.4 + 16 + DRAWER_NAV_SAFE_GAP_PX)
  })
})

describe('SAFE-2/3/4/5: host-level safe area', () => {
  it('SAFE-2: drawer maxHeight derives from the REAL navigator height', () => {
    makeShell()
    stubNavigatorBox()
    const h = mountHost()
    // First geometry pass (drawer closed) refreshes the height cache.
    expect(h['lastNavigatorHeightPx']).toBe(NAV_HEIGHT)
    openDrawer()
    // navBottom = bottomGap(180) + 64 = 244; reserve = 244 + 66 + 12 = 322
    // drawerTop = 100 + 56 = 156 → maxHeight = 1080 − 156 − 322 = 602
    expect(drawerStyle(h).maxHeight).toBe('602px')
    expect(navigatorDisplay(h)).toBe('flex')
    h.dispose()
  })

  it('SAFE-3: tiny viewport → navigator temporarily hidden, panel stays usable', () => {
    makeShell()
    stubNavigatorBox()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    const h = mountHost()
    expect(h['lastNavigatorHeightPx']).toBe(NAV_HEIGHT)
    openDrawer()
    // navBottom = bottomGap(0) + 64 = 64; reserve = 64 + 66 + 12 = 142
    // drawerTop = 156 → maxHeight = 300 − 156 − 142 = 2 < MIN_USABLE → suppress
    expect(navigatorDisplay(h)).toBe('none')
    // Suppressed reserve = 0 + 16 + 12 = 28 → maxHeight = 300 − 156 − 28 = 116
    const maxH = Number.parseInt(drawerStyle(h).maxHeight)
    expect(maxH).toBeGreaterThanOrEqual(MIN_DRAWER_USABLE_HEIGHT_PX)
    expect(maxH).toBe(116)
    h.dispose()
  })

  it('SAFE-4: closing the drawer restores the navigator (layout recovery)', () => {
    makeShell()
    stubNavigatorBox()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    const h = mountHost()
    openDrawer()
    expect(navigatorDisplay(h)).toBe('none')
    closeDrawer()
    expect(navigatorDisplay(h)).toBe('flex')
    h.dispose()
  })

  it('SAFE-5: navigator right/bottom never move when the drawer opens', () => {
    makeShell()
    stubNavigatorBox()
    const h = mountHost()
    const before = h['latestRects'].navigator
    expect(before).toBeTruthy()
    openDrawer()
    const after = h['latestRects'].navigator
    expect(after).toBeTruthy()
    expect(Math.abs(after!.right - before!.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(after!.bottom - before!.bottom)).toBeLessThanOrEqual(1)
    h.dispose()
  })

  it('SAFE-6: measured maxHeight keeps the drawer above the navigator top', () => {
    makeShell()
    stubNavigatorBox()
    const h = mountHost()
    openDrawer()
    // drawerTop = 156; maxHeight = 602 → drawer bottom = 758.
    // Production navigator zone: navBottom = bottomGap(180) + 64 = 244,
    // navigatorTop = 1080 − 244 − 66 = 770 → 758 + 12 ≤ 770 (gap respected).
    const maxH = Number.parseInt(drawerStyle(h).maxHeight)
    const drawerBottom = 156 + maxH
    const navBottom = 180 + 64
    const navigatorTop = 1080 - navBottom - NAV_HEIGHT
    expect(drawerBottom + DRAWER_NAV_SAFE_GAP_PX).toBeLessThanOrEqual(navigatorTop)
    h.dispose()
  })
})
