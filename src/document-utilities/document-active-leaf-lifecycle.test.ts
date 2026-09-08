// @vitest-environment jsdom
/**
 * TAB-TOGGLE-1..5 + host LAST-TAB-9/12 — real active-leaf lifecycle wiring.
 *
 * The overlay host reacts SYNCHRONOUSLY to the active-leaf transition:
 *  - path=""  → immediate EMPTY suppression (drawer closed, projection cleared),
 *               which HARD-VETOES a still-stale hasActiveDocument=true.
 *  - path=doc → automatic restore (no click / scroll / resize).
 *  - one lifecycle subscription only; dispose removes it; repeated toggles keep
 *    a single toolbar (no duplicate mount).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost, type ActiveLeafTransitionReason } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

interface PresenceModel {
  leafKnown: boolean
  leafPath: string | null
  file: string | null
  key: string | null
}

function makeModel(init: Partial<PresenceModel> = {}): PresenceModel {
  return { leafKnown: true, leafPath: 'README.md', file: 'README.md', key: 'README.md', ...init }
}

function makeCtx(model: PresenceModel): DocumentUtilitiesContext {
  const getFile = (): string | null => model.file
  return {
    authority: {
      getActiveLeafState: () => ({ leafStateKnown: model.leafKnown, leafPath: model.leafPath }),
      getActiveFilePath: getFile,
      getDocumentKey: () => model.key,
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => false,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    // STALE hasActiveDocument — the very false positive of the root cause:
    // the ctx still says active while the leaf already turned empty.
    hasActiveDocument: () => getFile() != null && model.key != null,
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

function captureLifecycle(): {
  onTransition: (r: ActiveLeafTransitionReason) => void
  options: { onActiveLeafLifecycle: (cb: (r: ActiveLeafTransitionReason) => void) => () => void }
  dispose: () => void
  subscribeCount: () => number
} {
  let current: ((r: ActiveLeafTransitionReason) => void) | null = null
  let count = 0
  const options = {
    onActiveLeafLifecycle: (cb: (r: ActiveLeafTransitionReason) => void) => {
      current = cb
      count++
      return () => { current = null }
    },
  }
  return {
    onTransition: (r) => current?.(r),
    options,
    dispose: () => { current = null },
    subscribeCount: () => count,
  }
}

let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  host = null
})

function toolbarEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.inkchapter-doc-toolbar')
  if (!el) throw new Error('toolbar not mounted')
  return el
}

function problemsControlEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.inkchapter-problems-control')
  if (!el) throw new Error('problems control not mounted')
  return el
}

describe('TAB-TOGGLE-1..5 — host reacts synchronously to real tab:toggle', () => {
  it('TAB-TOGGLE-1 path="" triggers the NO-ACTIVE transition immediately (stale ctx still true)', () => {
    const model = makeModel()
    const ctx = makeCtx(model)
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    const toolbar = toolbarEl()
    // Active doc mounted → toolbar visible.
    expect(toolbar.hidden).toBe(false)

    // REAL close-last-tab: the active leaf path becomes "" but the legacy
    // activeFile/documentKey (and ctx.hasActiveDocument) are still README.
    model.leafKnown = true
    model.leafPath = ''
    model.file = 'README.md'
    model.key = 'README.md'
    expect(ctx.hasActiveDocument()).toBe(true) // stale ctx — root cause precondition
    lc.onTransition('TAB_TOGGLE')

    expect(toolbar.hidden).toBe(true)
    expect(toolbar.dataset.presentation).toBe('suppressed')
    expect(problemsControlEl().childElementCount).toBe(0) // projection cleared
  })

  it('TAB-TOGGLE-2 path=README triggers the automatic restore transition', () => {
    const model = makeModel({ leafPath: '', leafKnown: true })
    const ctx = makeCtx(model)
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    const toolbar = toolbarEl()

    // Start empty → suppressed.
    lc.onTransition('ACTIVE_LEAF_CHANGE')
    expect(toolbar.hidden).toBe(true)

    // Reopen README (file tree) — no user click in the editor required.
    model.leafKnown = true
    model.leafPath = 'README.md'
    model.file = 'README.md'
    model.key = 'README.md'
    lc.onTransition('TAB_TOGGLE')

    expect(toolbar.hidden).toBe(false)
    expect(toolbar.dataset.presentation).toBe('full')
  })

  it('TAB-TOGGLE-3 no duplicate lifecycle listener', () => {
    const model = makeModel()
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx: makeCtx(model), providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    expect(lc.subscribeCount()).toBe(1)
  })

  it('TAB-TOGGLE-4 unmount removes the listener', () => {
    const model = makeModel()
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx: makeCtx(model), providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    h.dispose()
    host = null
    // The host released the lifecycle subscription on dispose.
    lc.onTransition('TAB_TOGGLE') // must be a no-op (host disposed)
    expect(document.querySelector('.inkchapter-doc-toolbar')).toBeNull()
  })

  it('TAB-TOGGLE-5 repeated toggle is stable (single mount, deterministic hide/show)', () => {
    const model = makeModel()
    const ctx = makeCtx(model)
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    const toolbar = toolbarEl()

    const setEmpty = (): void => { model.leafPath = ''; model.file = 'README.md'; model.key = 'README.md' }
    const setActive = (): void => { model.leafPath = 'README.md'; model.file = 'README.md'; model.key = 'README.md' }

    for (let i = 0; i < 4; i++) {
      setEmpty(); lc.onTransition('TAB_TOGGLE')
      expect(toolbar.hidden).toBe(true)
      expect(document.querySelectorAll('.inkchapter-doc-toolbar').length).toBe(1)
      setActive(); lc.onTransition('ACTIVE_LEAF_CHANGE')
      expect(toolbar.hidden).toBe(false)
      expect(document.querySelectorAll('.inkchapter-doc-toolbar').length).toBe(1)
    }
  })
})

describe('LAST-TAB-9/12 (host) — empty transition cleans drawer & projection; repeated cycles stay single-mount', () => {
  it('LAST-TAB-9 leaf="" closes the diagnostics drawer and clears projection', () => {
    const model = makeModel()
    const ctx = makeCtx(model)
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h
    const toolbar = toolbarEl()
    const drawer = document.querySelector<HTMLElement>('.inkchapter-doc-drawer')
    expect(drawer).toBeTruthy()

    // Open the drawer from the toolbar diagnostics control.
    const openBtn = problemsControlEl().querySelector<HTMLButtonElement>('button')
    expect(openBtn).toBeTruthy()
    openBtn!.click()
    expect(drawer!.style.display).toBe('flex')

    // Close the last tab → leaf empty → drawer must close + projection cleared.
    model.leafPath = ''
    model.file = 'README.md'
    model.key = 'README.md'
    lc.onTransition('TAB_TOGGLE')
    expect(drawer!.style.display).toBe('none')
    expect(toolbar.hidden).toBe(true)
    expect(problemsControlEl().childElementCount).toBe(0)
  })

  it('LAST-TAB-12 repeated close/reopen keeps exactly one toolbar (no duplicate mount)', () => {
    const model = makeModel()
    const ctx = makeCtx(model)
    const lc = captureLifecycle()
    const h = new DocumentUtilityOverlayHost({ ctx, providers: fakeProviders(), onBindDocument: () => {}, ...lc.options })
    h.mount()
    host = h

    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) { model.leafPath = ''; lc.onTransition('TAB_TOGGLE') }
      else { model.leafPath = 'README.md'; lc.onTransition('ACTIVE_LEAF_CHANGE') }
      expect(document.querySelectorAll('.inkchapter-doc-toolbar').length).toBe(1)
      expect(document.querySelectorAll('[data-inkchapter-utility-root="true"]').length).toBe(1)
    }
  })
})
