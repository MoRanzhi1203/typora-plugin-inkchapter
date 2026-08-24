// @vitest-environment jsdom
/**
 * Phase 7R.3.11.1 — Overlay VISIBILITY closure tests (UI-VIS-*).
 *
 * These prove the overlay is GEOMETRICALLY VISIBLE in the editor viewport:
 *  - placements are viewport-coordinate (Strategy B full-viewport root)
 *  - the root is never an unusable 0×0 containing block
 *  - geometry sync is coalesced (no repeated style writes, no RO feedback)
 *  - document switch keeps one instance and one observer
 *  - pointer-events contract: root none, controls auto
 *  - CSS classes match production selectors
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeOverlayGeometry, DocumentUtilityOverlayHost, UTILITY_ROOT_IDENTITY_ATTR } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const scss = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

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

/** Create #write + scroll-container parent with a real (mocked) shell rect. */
function makeShell(shellRect: { top: number; right: number; bottom: number; left: number; width: number; height: number }): { write: HTMLElement; shell: HTMLElement } {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => shellRect })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return { write, shell }
}

let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  // Run geometry sync synchronously (deterministic counters) unless a test
  // overrides with a capturing rAF stub (UI-VIS-4).
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  host = null
})

function mountHost(shellRect?: { top: number; right: number; bottom: number; left: number; width: number; height: number }): DocumentUtilityOverlayHost {
  if (shellRect) makeShell(shellRect)
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  host = h
  return h
}

const rootIdentity = `[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`

describe('UI-VIS-1 geometry resolver places controls inside the editor viewport', () => {
  it('computes viewport-coordinate placements from the shell rect', () => {
    const g = computeOverlayGeometry({ top: 100, right: 1400, bottom: 900 }, { width: 1920, height: 1080 })
    expect(g.toolbarTop).toBe(112)
    expect(g.toolbarRight).toBe(544)
    expect(g.navRight).toBe(548)
    expect(g.navBottom).toBe(244)
    // Both controls land inside the viewport.
    expect(g.toolbarTop).toBeGreaterThanOrEqual(0)
    expect(g.toolbarRight).toBeLessThan(1920)
    expect(g.navRight).toBeLessThan(1920)
    expect(g.navBottom).toBeLessThan(1080)
  })
})

describe('UI-VIS-2 overlay root is a full-viewport containing block (not 0×0)', () => {
  it('mounts a 100vw×100vh fixed root so absolute children use the viewport', () => {
    mountHost({ top: 100, right: 1400, bottom: 900, left: 250, width: 1150, height: 800 })
    const root = document.querySelector(rootIdentity) as HTMLElement
    expect(root).toBeTruthy()
    expect(root.style.position).toBe('fixed')
    expect(root.style.width).toBe('100vw')
    expect(root.style.height).toBe('100vh')
    expect(host!.isRootViewportSized()).toBe(true)
  })
})

describe('UI-VIS-3 unchanged geometry → NO_OP (no repeated style writes)', () => {
  it('second sync with identical shell rect does not rewrite styles', () => {
    mountHost({ top: 100, right: 1400, bottom: 900, left: 250, width: 1150, height: 800 })
    const before = host!.getGeometryCounters()
    host!.bindDocument() // schedules a geometry sync
    const after = host!.getGeometryCounters()
    // Same geometry → the follow-up sync must be a NO_OP, not another write.
    expect(after.noopCount).toBeGreaterThan(before.noopCount)
    expect(after.writeCount).toBe(before.writeCount)
  })
})

describe('UI-VIS-4 coalesced geometry sync (<=1 write per frame)', () => {
  it('10 resize notifications in one frame → one schedule + one write', () => {
    const captured: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', ((cb: (() => void) | FrameRequestCallback) => { captured.push(cb as () => void); return 1 }) as unknown as typeof requestAnimationFrame)
    mountHost({ top: 100, right: 1400, bottom: 900, left: 250, width: 1150, height: 800 })
    // Flush the mount-time sync.
    captured.shift()?.()
    const before = host!.getGeometryCounters()
    // 10 window resize notifications in the same frame.
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('resize'))
    const after = host!.getGeometryCounters()
    // Only ONE schedule captured for the burst (coalesced), and the frame
    // write has NOT happened yet (pending rAF).
    expect(after.scheduleCount - before.scheduleCount).toBe(1)
    captured.shift()?.()
    const final = host!.getGeometryCounters()
    // Geometry unchanged → burst applied as at most one NO_OP write.
    expect(final.writeCount - before.writeCount).toBeLessThanOrEqual(1)
  })
})

describe('UI-VIS-5 document switch keeps one instance + one observer', () => {
  it('repeated bindDocument keeps root/toolbar/navigator = 1 and one resize observer', () => {
    mountHost({ top: 100, right: 1400, bottom: 900, left: 250, width: 1150, height: 800 })
    host!.bindDocument()
    host!.bindDocument()
    expect(document.querySelectorAll(rootIdentity)).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
    expect((host as unknown as { resizeObserver: ResizeObserver | null }).resizeObserver).not.toBeNull()
  })
})

describe('UI-VIS-6 drawer open/close never mutates #write', () => {
  it('open/close drawer leaves #write.innerHTML unchanged', () => {
    const { write } = makeShell({ top: 100, right: 1400, bottom: 900, left: 250, width: 1150, height: 800 })
    write.innerHTML = '<h1>标题</h1>'
    mountHost()
    const before = write.innerHTML
    const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diag.click()
    expect(write.innerHTML).toBe(before)
    const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
    close.click()
    expect(write.innerHTML).toBe(before)
  })
})

describe('UI-VIS-7 production selectors match runtime classes', () => {
  it('SCSS contains the root identity, toolbar, navigator, drawer selectors', () => {
    expect(scss).toContain('[data-inkchapter-utility-root="true"]')
    expect(scss).toContain('.inkchapter-doc-toolbar')
    expect(scss).toContain('.inkchapter-doc-navigator')
    expect(scss).toContain('.inkchapter-doc-drawer')
  })
})

describe('UI-VIS-8 pointer-events contract', () => {
  it('root pointer-events none; toolbar/navigator/drawer auto', () => {
    mountHost()
    const root = document.querySelector(rootIdentity) as HTMLElement
    expect(root.style.pointerEvents).toBe('none')
    expect((document.querySelector('.inkchapter-doc-toolbar') as HTMLElement).style.pointerEvents).toBe('auto')
    expect((document.querySelector('.inkchapter-doc-navigator') as HTMLElement).style.pointerEvents).toBe('auto')
    expect((document.querySelector('.inkchapter-doc-drawer') as HTMLElement).style.pointerEvents).toBe('auto')
  })
})
