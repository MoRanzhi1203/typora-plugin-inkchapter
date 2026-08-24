// @vitest-environment jsdom
/**
 * Phase 7R.3.11 — Document Utility Overlay Host tests (UI-OVERLAY-*) and
 * Diagnostic Locator (DIAG-8).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentUtilityOverlayHost, UTILITY_UI_ROOT_ATTR, UTILITY_UI_ROOT_VALUE } from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { DocumentDiagnosticLocator, DIAGNOSTIC_HIGHLIGHT_CLASS } from './document-diagnostic-locator'

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
    const closeBtn = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
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
