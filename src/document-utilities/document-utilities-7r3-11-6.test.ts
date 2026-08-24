// @vitest-environment jsdom
/**
 * Phase 7R.3.11.6 — drawer close navigator restore tests (NAV-RESTORE-*,
 * NAV-PLACEMENT-*). Verifies the navigator right offset follows the LIVE
 * drawer state through one geometry transaction, including rapid toggles,
 * resize, document switch, and pending-rAF collisions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  evaluateNavigatorPlacement,
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

/** Mutable shell rect so tests can simulate resize / document switch. */
function makeShell() {
  const rect = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }
  const shell = document.createElement('div')
  shell.style.cssText = 'overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => rect })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return { shell, rect }
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

function navRight(h: DocumentUtilityOverlayHost): string {
  const nav = h['navigatorEl'] as HTMLElement | null
  return nav?.style.right ?? ''
}

function openDrawer(h: DocumentUtilityOverlayHost): void {
  const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
  diag.click()
}

function closeDrawer(h: DocumentUtilityOverlayHost): void {
  const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
  close.click()
}

describe('NAV-RESTORE-1 basic open/close round trip', () => {
  it('normal → avoidance → normal → avoidance → normal (verifies actual style)', () => {
    makeShell()
    const h = mountHost()
    expect(navRight(h)).toBe('548px') // 520 + 28
    openDrawer(h)
    expect(navRight(h)).toBe('908px') // 520 + 12 + 360 + 16
    closeDrawer(h)
    expect(navRight(h)).toBe('548px')
    openDrawer(h)
    expect(navRight(h)).toBe('908px')
    closeDrawer(h)
    expect(navRight(h)).toBe('548px')
  })
})

describe('NAV-RESTORE-2 open → resize → close', () => {
  it('close restores to the NEW shell right, not the pre-resize offset', () => {
    const { rect } = makeShell()
    const h = mountHost()
    openDrawer(h)
    expect(navRight(h)).toBe('908px')
    // DevTools-style resize: shell right narrows from 1400 → 1300.
    rect.right = 1300
    rect.width = 1050
    window.dispatchEvent(new Event('resize'))
    expect(navRight(h)).toBe('1008px') // open avoidance for new shell: 620+12+360+16
    closeDrawer(h)
    expect(navRight(h)).toBe('648px') // normal for new shell: 620+28
  })
})

describe('NAV-RESTORE-3 open → document switch → close', () => {
  it('close uses the current (doc B) editor shell geometry', () => {
    const { rect } = makeShell()
    const h = mountHost()
    openDrawer(h)
    expect(navRight(h)).toBe('908px')
    // Document switch to a narrower shell.
    rect.right = 1300
    rect.width = 1050
    h.bindDocument()
    expect(navRight(h)).toBe('1008px') // still open, new shell avoidance
    closeDrawer(h)
    expect(navRight(h)).toBe('648px') // normal for doc B shell
  })
})

describe('NAV-RESTORE-4 pending rAF collision keeps drawer-close', () => {
  it('resize-observer pending + drawer close → final navRight is normal', () => {
    makeShell()
    const captured: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { captured.push(cb as () => void); return 1 }) as typeof requestAnimationFrame)
    const h = mountHost()
    captured.shift()?.() // flush mount
    window.dispatchEvent(new Event('resize')) // schedules (pending)
    closeDrawer(h) // adds drawer-close to the pending set
    captured.shift()?.() // flush: drawerOpen=false live → normal
    expect(navRight(h)).toBe('548px')
  })
})

describe('NAV-RESTORE-5 rapid toggle in one frame', () => {
  it('open/close/open/close ends at normal, never stuck at avoidance', () => {
    makeShell()
    const captured: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { captured.push(cb as () => void); return 1 }) as typeof requestAnimationFrame)
    const h = mountHost()
    captured.shift()?.() // flush mount (normal)
    openDrawer(h)
    closeDrawer(h)
    openDrawer(h)
    closeDrawer(h)
    captured.shift()?.() // flush: live drawerOpen=false → normal
    expect(navRight(h)).toBe('548px')
  })
})

describe('NAV-RESTORE-6 geometry NO_OP sees navigatorRight change', () => {
  it('close after open commits a write (noop=false)', () => {
    makeShell()
    const h = mountHost()
    openDrawer(h)
    const beforeClose = h.getGeometryCounters().writeCount
    closeDrawer(h)
    const afterClose = h.getGeometryCounters().writeCount
    expect(afterClose).toBe(beforeClose + 1)
    expect(navRight(h)).toBe('548px')
  })
})

describe('NAV-PLACEMENT-1/2/3 pure placement evaluation', () => {
  const viewport = { width: VIEWPORT, height: 1080 }
  const shell = { left: 250, top: 100, right: 1400, bottom: 900, width: 1150, height: 800 }

  it('drawer closed at normal position → PASS', () => {
    const r = evaluateNavigatorPlacement({
      drawerOpen: false,
      navigatorRect: { left: 1372 - 38, top: 800, right: 1372, bottom: 866, width: 38, height: 66 },
      shellRect: shell,
      viewport,
      tolerancePx: 3,
    })
    expect(r.expectedRight).toBe(548)
    expect(r.rightDelta).toBeLessThanOrEqual(3)
    expect(r.decision).toBe('PASS')
  })

  it('drawer open at avoidance position → PASS with gap >= 12', () => {
    const r = evaluateNavigatorPlacement({
      drawerOpen: true,
      navigatorRect: { left: 1012 - 38, top: 800, right: 1012, bottom: 866, width: 38, height: 66 },
      shellRect: shell,
      viewport,
      tolerancePx: 3,
    })
    expect(r.expectedRight).toBe(908)
    expect(r.rightDelta).toBeLessThanOrEqual(3)
    expect(r.gapPx).toBeGreaterThanOrEqual(12)
    expect(r.decision).toBe('PASS')
  })

  it('drawer closed but navigator still at avoidance → NAVIGATOR_STALE_DRAWER_OFFSET', () => {
    const r = evaluateNavigatorPlacement({
      drawerOpen: false,
      navigatorRect: { left: 1012 - 38, top: 800, right: 1012, bottom: 866, width: 38, height: 66 },
      shellRect: shell,
      viewport,
      tolerancePx: 3,
    })
    expect(r.expectedRight).toBe(548)
    expect(r.actualRight).toBe(908)
    expect(r.decision).toBe('NAVIGATOR_STALE_DRAWER_OFFSET')
  })
})
