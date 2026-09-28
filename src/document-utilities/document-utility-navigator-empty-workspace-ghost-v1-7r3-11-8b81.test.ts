// @vitest-environment jsdom
/**
 * Phase 7R.3.11.8B.12 — Navigator Empty-Workspace Ghost-Control V1 closure.
 *
 * Hard gates proven here (pure + host DOM):
 *   EMPTY / documentKey=null / Untitled+0-chars / canonicalFrame WAITING
 *     → hidden (reason NO_ACTIVE_DOCUMENT / CANONICAL_FRAME_NOT_READY)
 *   non-scrollable ACTIVE → hidden / NOT_SCROLLABLE
 *   initial mount → hidden-by-default
 *   ACTIVE(visible) → EMPTY/Untitled → immediate hidden + stale geometry clear
 *   no safe placement (gutter+inset unavailable, geometry known) → hidden
 *   visible navigator mode ∈ {gutter, inset}; never `left`
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  decideNavigatorEligibilityPure,
  decideNavigatorPresentation,
  DocumentUtilityOverlayHost,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number }

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

interface Ws { active: boolean; file: string | null; key: string | null; md: string }
function makeContext(ws: () => Ws): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => ws().file,
      getDocumentKey: () => ws().key,
      getMarkdown: () => ws().md,
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => ws().active,
  }
}

function makeShell(rect: Rect, scrollHeight: number, clientHeight: number): HTMLElement {
  const shell = document.createElement('div')
  shell.style.cssText = 'position:relative;overflow-y:auto;'
  Object.defineProperty(shell, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(shell, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(shell, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(shell, 'scrollTop', { configurable: true, value: 0, writable: true })
  const write = document.createElement('div')
  write.id = 'write'
  write.setAttribute('contenteditable', 'true')
  shell.appendChild(write)
  document.body.appendChild(shell)
  return shell
}

const shellRect: Rect = { top: 100, right: 1400, bottom: 900, left: 200, width: 1200, height: 800 }

let activeWs: Ws

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  activeWs = { active: true, file: '/vault/doc.md', key: 'doc:key', md: '# 标题\n\n正文' }
})

function navEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.inkchapter-doc-navigator')
}

// ── Pure eligibility ───────────────────────────────────
describe('NAV-EMPTY / NAV-GEOMETRY — decideNavigatorEligibilityPure', () => {
  it('NAV-EMPTY-1: presenceState=EMPTY + documentKey=null → hidden / NO_ACTIVE_DOCUMENT', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'EMPTY', hasActiveDocument: false, documentKey: null, rootConnected: true, emptyUntitled: true, canonicalReady: false, realLayout: true })
    expect(r.eligible).toBe(false)
    expect(r.reason).toBe('NO_ACTIVE_DOCUMENT')
  })

  it('NAV-EMPTY-2: Untitled + 0 chars (active leaf present but empty) → hidden', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'UNKNOWN', hasActiveDocument: true, documentKey: 'doc:untitled', rootConnected: true, emptyUntitled: true, canonicalReady: true, realLayout: true })
    expect(r.eligible).toBe(false)
    expect(r.reason).toBe('NO_ACTIVE_DOCUMENT')
  })

  it('NAV-EMPTY-3: activeLeafPath empty → hidden', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'EMPTY', hasActiveDocument: false, documentKey: null, rootConnected: null, emptyUntitled: true, canonicalReady: false, realLayout: true })
    expect(r.eligible).toBe(false)
    expect(r.reason).toBe('NO_ACTIVE_DOCUMENT')
  })

  it('NAV-EMPTY-4: canonicalFrame=WAITING (real layout) → hidden / CANONICAL_FRAME_NOT_READY', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'ACTIVE', hasActiveDocument: true, documentKey: 'doc:key', rootConnected: true, emptyUntitled: false, canonicalReady: false, realLayout: true })
    expect(r.eligible).toBe(false)
    expect(r.reason).toBe('CANONICAL_FRAME_NOT_READY')
  })

  it('NAV-GEOMETRY-1: ACTIVE + scrollable but canonical frame unknown → hidden', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'ACTIVE', hasActiveDocument: true, documentKey: 'doc:key', rootConnected: true, emptyUntitled: false, canonicalReady: false, realLayout: true })
    expect(r.eligible).toBe(false)
  })

  it('ACTIVE + canonical READY (real) → eligible / ACTIVE', () => {
    const r = decideNavigatorEligibilityPure({ presenceState: 'ACTIVE', hasActiveDocument: true, documentKey: 'doc:key', rootConnected: true, emptyUntitled: false, canonicalReady: true, realLayout: true })
    expect(r.eligible).toBe(true)
    expect(r.reason).toBe('ACTIVE')
  })
})

// ── Pure placement (no left fallback) ──────────────────
describe('NAV-PLACEMENT / NAV-GEOMETRY — decideNavigatorPresentation', () => {
  it('NAV-GEOMETRY-2: gutter unavailable + inset unavailable + geometry known → hidden / NO_SAFE_PLACEMENT', () => {
    const r = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: false, geometryKnown: true })
    expect(r.presentation).toBe('hidden')
    expect(r.reason).toBe('NO_SAFE_PLACEMENT')
  })

  it('NAV-PLACEMENT-1: gutter available → gutter; else inset available → inset; never left', () => {
    const g = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: true, insetCandidateValid: false, geometryKnown: true })
    expect(g.presentation).toBe('gutter')
    const i = decideNavigatorPresentation({ scrollable: true, gutterCandidateValid: false, insetCandidateValid: true, geometryKnown: true })
    expect(i.presentation).toBe('inset')
    for (const mode of [g.presentation, i.presentation]) expect(['gutter', 'inset', 'hidden']).toContain(mode)
  })
})

// ── Host DOM lifecycle ─────────────────────────────────
describe('NAV-MOUNT / NAV-NONSCROLL / NAV-TRANSITION — host DOM', () => {
  it('NAV-MOUNT-1/2: mount before any active-doc reconcile → navigator hidden-by-default; NAV-MOUNT-3 navigatorCount<=1', () => {
    activeWs = { active: false, file: null, key: null, md: '' }
    makeShell(shellRect, 0, 300)
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const nav = navEl()
    expect(nav).not.toBeNull()
    expect(nav!.hidden).toBe(true)
    expect(nav!.dataset.rail).toBe('hidden')
    expect(document.querySelectorAll('.inkchapter-doc-navigator').length).toBeLessThanOrEqual(1)
  })

  it('NAV-NONSCROLL-1: ACTIVE + documentKey exists + not scrollable → hidden', () => {
    makeShell(shellRect, 300, 300) // scrollHeight === clientHeight
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    expect(navEl()!.hidden).toBe(true)
    expect(navEl()!.dataset.rail).toBe('hidden')
  })

  it('long scrollable doc → navigator visible on the right rail (mode ∈ {gutter, inset})', () => {
    makeShell(shellRect, 2000, 300)
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const nav = navEl()!
    expect(nav.hidden).toBe(false)
    expect(['gutter', 'inset']).toContain(nav.dataset.rail)
    // Left / bottom-left geometry is never applied.
    expect(nav.style.left).toBe('')
  })

  it('NAV-TRANSITION-1: ACTIVE visible → EMPTY → immediate hidden + stale geometry cleared', () => {
    makeShell(shellRect, 2000, 300)
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const nav = navEl()!
    expect(nav.hidden).toBe(false)
    // ACTIVE → EMPTY: workspace loses its leaf (null key/path + ctx false).
    activeWs = { active: false, file: null, key: null, md: '' }
    h.bindDocument()
    expect(nav.hidden).toBe(true)
    expect(nav.dataset.rail).toBe('hidden')
    expect(nav.style.left).toBe('')
    expect(nav.style.right).toBe('')
    expect(nav.style.top).toBe('')
    expect(nav.style.bottom).toBe('')
  })

  it('NAV-TRANSITION-2: ACTIVE visible → NO_ACTIVE_DOCUMENT (leaf lost) → immediate hidden', () => {
    makeShell(shellRect, 2000, 300)
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const nav = navEl()!
    expect(nav.hidden).toBe(false)
    activeWs = { active: false, file: '/vault/closed.md', key: null, md: '' }
    h.bindDocument()
    expect(nav.hidden).toBe(true)
  })

  it('NAV-TRANSITION-3: ACTIVE visible → Untitled → hidden with no stale placement residue', () => {
    makeShell(shellRect, 2000, 300)
    const h = new DocumentUtilityOverlayHost({ ctx: makeContext(() => activeWs), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const nav = navEl()!
    expect(nav.hidden).toBe(false)
    activeWs = { active: true, file: '', key: 'doc:untitled', md: '' }
    h.bindDocument()
    expect(nav.hidden).toBe(true)
    expect(nav.dataset.rail).toBe('hidden')
    expect(nav.style.right).toBe('')
  })
})
