// @vitest-environment jsdom
/**
 * WC-R2 — one gesture, one navigator intent.
 *
 * The open word-count panel + displaced navigator bug: the SAME press that hit
 * the navigator also made Typora close the panel and restore the caret scroll.
 * A replay from the panel-close callback (one rAF) raced with that restore and
 * the scroll was discarded. These tests pin the replacement contract:
 *
 *  - a press only RECORDS an intent;
 *  - the single execution happens at physical gesture end (document click /
 *    pointerup fallback / keyboard activation);
 *  - pointerdown + mousedown + click + pointerup never duplicate the action;
 *  - cancel / document-switch / root swap / dispose discard the intent;
 *  - the navigator is not interactive in the HIDE avoidance state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  NavigatorIntentMachine,
  NAV_GESTURE_INTENT_TTL_MS,
} from './document-navigator-intent'
import { DocumentUtilityOverlayHost } from './document-utility-overlay-host'
import {
  NAV_WORD_COUNT_AVOID_ATTR,
  WORD_COUNT_PANEL_OPEN_CLASS,
} from './document-utility-word-count-avoidance'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'

type HostInternals = {
  handleScrollAction: (action: 'GO_TOP' | 'GO_BOTTOM', source?: string) => void
  cancelNavigatorGesture: (reason: string) => void
  cancelScrollOperation: (decision: string) => void
}

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

describe('WC-T intent machine (pure)', () => {
  it('WC-T01 one press → one intent; panel close only admits it', () => {
    const m = new NavigatorIntentMachine()
    const g = m.begin({ action: 'GO_BOTTOM', documentKey: 'd1', container: null, panelOpen: true, now: 100 })
    expect(g.phase).toBe('PRESSED')
    expect(g.panelOpenAtPress).toBe(true)
    expect(m.onPanelClosed()).toBe(true)
    expect(m.current?.phase).toBe('ADMITTED')
    const taken = m.take({ now: 101, documentKey: 'd1' })
    expect(taken?.action).toBe('GO_BOTTOM')
    expect(m.current?.phase).toBe('APPLIED')
    // A second take (e.g. mousedown + click) never duplicates the intent.
    expect(m.take({ now: 102, documentKey: 'd1' })).toBeNull()
    m.complete()
    expect(m.current).toBeNull()
  })

  it('WC-T02 an expired intent is cancelled, never executed', () => {
    const m = new NavigatorIntentMachine()
    m.begin({ action: 'GO_TOP', documentKey: 'd1', container: null, panelOpen: true, now: 0 })
    expect(m.take({ now: NAV_GESTURE_INTENT_TTL_MS + 1, documentKey: 'd1' })).toBeNull()
    expect(m.current).toBeNull()
  })

  it('WC-T04 rapid presses are one intent PER gesture (no accidental dedup)', () => {
    const m = new NavigatorIntentMachine()
    m.begin({ action: 'GO_TOP', documentKey: 'd1', container: null, panelOpen: false, now: 0 })
    expect(m.take({ now: 1, documentKey: 'd1' })?.action).toBe('GO_TOP')
    m.complete()
    m.begin({ action: 'GO_BOTTOM', documentKey: 'd1', container: null, panelOpen: false, now: 2 })
    expect(m.take({ now: 3, documentKey: 'd1' })?.action).toBe('GO_BOTTOM')
  })

  it('WC-T06 a cancelled gesture can never be taken', () => {
    const m = new NavigatorIntentMachine()
    m.begin({ action: 'GO_TOP', documentKey: 'd1', container: null, panelOpen: true, now: 0 })
    expect(m.cancel('POINTER_CANCEL')?.cancelReason).toBe('POINTER_CANCEL')
    expect(m.take({ now: 1, documentKey: 'd1' })).toBeNull()
    expect(m.current).toBeNull()
  })

  it('WC-T08 another document key discards the intent (no retargeting)', () => {
    const m = new NavigatorIntentMachine()
    m.begin({ action: 'GO_TOP', documentKey: 'd1', container: null, panelOpen: true, now: 0 })
    expect(m.take({ now: 1, documentKey: 'd2' })).toBeNull()
    expect(m.current).toBeNull()
  })

  it('WC-T07 a new press supersedes an unfinished one (never merged)', () => {
    const m = new NavigatorIntentMachine()
    m.begin({ action: 'GO_TOP', documentKey: 'd1', container: null, panelOpen: true, now: 0 })
    const second = m.begin({ action: 'GO_BOTTOM', documentKey: 'd1', container: null, panelOpen: true, now: 1 })
    expect(second.id).toBe(2)
    expect(m.current?.action).toBe('GO_BOTTOM')
    expect(m.current?.phase).toBe('PRESSED')
  })
})

describe('WC-T host gesture wiring', () => {
  let host: DocumentUtilityOverlayHost | null = null
  let docKey = 'doc:key'

  function fakeContext(): DocumentUtilitiesContext {
    return {
      authority: {
        getActiveFilePath: () => '/vault/doc.md',
        getDocumentKey: () => docKey,
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

  function internals(): HostInternals {
    return host as unknown as HostInternals
  }

  function mountHost(): void {
    host = new DocumentUtilityOverlayHost({
      ctx: fakeContext(),
      providers: fakeProviders(),
      onBindDocument: () => {},
    } as never)
    host.mount()
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.inkchapter-doc-navigator__btn'))
  }

  function nav(): HTMLElement {
    return document.querySelector('.inkchapter-doc-navigator') as HTMLElement
  }

  /** Make the real scroll container measurable + implement scrollTo in jsdom. */
  function makeScrollable(): HTMLElement {
    const shell = document.getElementById('write')?.parentElement as HTMLElement
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 600 })
    shell.scrollTop = 500
    shell.scrollTo = ((opts: ScrollToOptions | number) => {
      const top = typeof opts === 'number' ? opts : (opts.top ?? 0)
      shell.scrollTop = Math.max(0, Math.min(top, 1400))
    }) as unknown as typeof shell.scrollTo
    return shell
  }

  beforeEach(() => {
    docKey = 'doc:key'
    document.body.innerHTML = ''
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver)
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)

    const panel = document.createElement('ul')
    panel.id = 'footer-word-count-info'
    panel.className = 'dropdown-menu'
    panel.textContent = '字符数 11'
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

  it('WC-T01 panel-open press executes once at gesture end, not on panel close', async () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    // pointerdown + mousedown + click all belong to ONE intent: nothing yet.
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(spy).not.toHaveBeenCalled()

    // Typora closes the panel during the same press.
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    await tick()
    expect(spy).not.toHaveBeenCalled() // admitted, not executed

    // The physical gesture ends at the document level, AFTER Typora's handlers.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('GO_BOTTOM', 'BUTTON')

    // A click that also reaches the original button never duplicates it.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('WC-T02 a button that unmounts before click still executes once', () => {
    mountHost()
    const btn = buttons()[0]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    btn.remove()
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('GO_TOP', 'BUTTON')
  })

  it('WC-T03 panel-closed navigation is unchanged (press runs, click deduped)', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(spy).toHaveBeenCalledTimes(1)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('WC-T04 rapid legitimate gestures = one intent each', () => {
    mountHost()
    const [top, bottom] = buttons()
    top.disabled = false
    bottom.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')

    top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    top.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    bottom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    bottom.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 'GO_TOP', 'BUTTON')
    expect(spy).toHaveBeenNthCalledWith(2, 'GO_BOTTOM', 'BUTTON')
  })

  it('WC-T05 keyboard Enter/Space (click detail 0) runs exactly once', () => {
    mountHost()
    const [top, bottom] = buttons()
    top.disabled = false
    bottom.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')

    top.click() // jsdom click ⇒ detail 0 (keyboard activation shape)
    bottom.click()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 'GO_TOP', 'BUTTON')
    expect(spy).toHaveBeenNthCalledWith(2, 'GO_BOTTOM', 'BUTTON')
  })

  it('WC-T06 pointercancel cancels the deferred intent', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    btn.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('WC-T06 Escape cancels the deferred intent and releases listeners', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('WC-T06 dispose cancels the deferred intent', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    host?.dispose()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('WC-T07 popup close + resize during the gesture leaves no stuck state', async () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    window.dispatchEvent(new Event('resize'))
    await tick()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).toHaveBeenCalledTimes(1)
    // A later click (no gesture in flight) does nothing.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('WC-T08 document switch discards the pending request', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    docKey = 'doc:other'
    host?.bindDocument()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('WC-T08 editor-root replacement discards the old request', () => {
    mountHost()
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')
    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    // Swap the whole editor root (fresh container identity).
    document.body.innerHTML = ''
    const shell = document.createElement('div')
    shell.style.cssText = 'position:relative;overflow-y:auto;'
    const write = document.createElement('div')
    write.id = 'write'
    shell.appendChild(write)
    document.body.appendChild(shell)

    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('WC-T09 the scroll really moves, in both directions (no call-only PASS)', () => {
    mountHost()
    const shell = makeScrollable()
    const [top, bottom] = buttons()
    top.disabled = false
    bottom.disabled = false

    expect(shell.scrollTop).toBe(500)
    bottom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(shell.scrollTop).toBe(1400) // real bottom (scrollHeight − clientHeight)

    top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(shell.scrollTop).toBe(0) // reverse restoration
    internals().cancelScrollOperation('SUPERSEDED')
  })

  it('WC-T10 never writes document text or mutates the native panel', () => {
    mountHost()
    const panel = document.getElementById('footer-word-count-info') as HTMLElement
    const beforePanel = panel.outerHTML
    const beforeBodyText = document.body.textContent
    const btn = buttons()[1]
    btn.disabled = false

    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.body.classList.remove(WORD_COUNT_PANEL_OPEN_CLASS)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(panel.outerHTML).toBe(beforePanel)
    expect(document.body.textContent).toBe(beforeBodyText)

    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(src).not.toContain('setInterval(')
  })

  it('WC-T11 HIDE state is not interactive (no gesture is admitted)', () => {
    mountHost()
    const navEl = nav()
    // The panel-scoped HIDE state hides the whole navigator AND marks it.
    navEl.setAttribute(NAV_WORD_COUNT_AVOID_ATTR, 'hidden')
    navEl.hidden = true
    const btn = buttons()[1]
    btn.disabled = false
    const spy = vi.spyOn(internals(), 'handleScrollAction')

    document.body.classList.add(WORD_COUNT_PANEL_OPEN_CLASS)
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(spy).not.toHaveBeenCalled()
  })
})
