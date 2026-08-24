// @vitest-environment jsdom
/**
 * Phase 7R.3.11.5 — audit consistency / heading fixture / edit guard / scroll
 * button action focused tests (AUDIT-CONSISTENCY-*, HEADING-RUNTIME-*,
 * EDIT-GUARD-*, SCROLL-ACTION-*).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildScrollNavAudit,
  computeAuditConsistency,
  DocumentUtilityOverlayHost,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import { DocumentEditGuard } from './document-edit-guard'

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

beforeEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
})

describe('AUDIT-CONSISTENCY-1 callback count derives from RO epoch', () => {
  it('5 callbacks → epoch=5, callbackCount=5, difference=0, decision=PASS', () => {
    const c = computeAuditConsistency(5, 5)
    expect(c.difference).toBe(0)
    expect(c.decision).toBe('PASS')
    expect(c.resizeObserverCallbackCount).toBe(5)
  })

  it('derivation is structurally identical in the host counters', () => {
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    // Any state: callbackCount === epoch by construction.
    const c = h.getGeometryCounters()
    expect(c.resizeObserverCallbackCount).toBe(c.resizeObserverEpoch)
    h.dispose()
  })
})

describe('AUDIT-CONSISTENCY-2/3 external resize / rebind keep consistency', () => {
  it('window resize increments externalResizeEpoch but never diverges RO counters', () => {
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    const c = h.getGeometryCounters()
    expect(c.windowResizeEventCount).toBeGreaterThanOrEqual(2)
    expect(c.resizeObserverCallbackCount).toBe(c.resizeObserverEpoch)
    h.dispose()
  })

  it('document switch rebind keeps counter semantics consistent', () => {
    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    h.bindDocument()
    h.bindDocument()
    const c = h.getGeometryCounters()
    expect(c.resizeObserverCallbackCount).toBe(c.resizeObserverEpoch)
    h.dispose()
  })
})

describe('HEADING-RUNTIME-CONTRACT-1 fixture contains a real H2→H4', () => {
  it('fixture heading sequence has H2 directly before H4 (missing H3)', () => {
    const md = readFileSync(resolve(process.cwd(), 'test/vault/runtime/smoke/Document-Utilities-Runtime-Test.md'), 'utf8')
    const levels: number[] = []
    for (const line of md.split(/\r?\n/)) {
      const m = /^(#{1,6})\s/.exec(line)
      if (m) levels.push(m[1].length)
    }
    let gap: { prev: number; cur: number } | null = null
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) gap = { prev: levels[i - 1], cur: levels[i] }
    }
    expect(gap).not.toBeNull()
    expect(gap!.prev).toBe(2)
    expect(gap!.cur).toBe(4)
  })
})

describe('EDIT-GUARD-1/2/3 blocked/allowed matrix', () => {
  it('locked blocks insertText / paste / cut / drop; allows copy', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    const guard = new DocumentEditGuard()
    guard.lock()

    const beforeInput = (t: string): Event => {
      const e = new Event('beforeinput', { bubbles: true, cancelable: true }) as Event & { inputType: string }
      ;(e as unknown as { inputType: string }).inputType = t
      write.dispatchEvent(e)
      return e
    }
    expect(beforeInput('insertText').defaultPrevented).toBe(true)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    write.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    const cut = new Event('cut', { bubbles: true, cancelable: true })
    write.dispatchEvent(cut)
    expect(cut.defaultPrevented).toBe(true)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    write.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)

    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    write.dispatchEvent(copy)
    expect(copy.defaultPrevented).toBe(false)
    expect(write.style.pointerEvents).not.toBe('none')
    guard.dispose()
  })

  it('unlock restores editing', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    const guard = new DocumentEditGuard()
    guard.lock()
    const beforeInput = (t: string): Event => {
      const e = new Event('beforeinput', { bubbles: true, cancelable: true }) as Event & { inputType: string }
      ;(e as unknown as { inputType: string }).inputType = t
      write.dispatchEvent(e)
      return e
    }
    expect(beforeInput('insertText').defaultPrevented).toBe(true)
    guard.unlock()
    expect(beforeInput('insertText').defaultPrevented).toBe(false)
    guard.dispose()
  })
})

describe('SCROLL-ACTION-1..4 button action audit payload', () => {
  it('GO_BOTTOM from top → after=max, atBottomAfter=true, PASS', () => {
    const p = buildScrollNavAudit({ documentKey: 'doc:key', action: 'GO_BOTTOM', scrollTopBefore: 0, scrollTopAfter: 800, maxScrollTop: 800, drawerVisible: false, locked: false })
    expect(p.source).toBe('BUTTON')
    expect(p.action).toBe('GO_BOTTOM')
    expect(p.atTopBefore).toBe(true)
    expect(p.atBottomAfter).toBe(true)
    expect(p.decision).toBe('PASS')
  })

  it('GO_TOP from bottom → after=0, atTopAfter=true, PASS', () => {
    const p = buildScrollNavAudit({ documentKey: 'doc:key', action: 'GO_TOP', scrollTopBefore: 800, scrollTopAfter: 0, maxScrollTop: 800, drawerVisible: false, locked: false })
    expect(p.action).toBe('GO_TOP')
    expect(p.atBottomBefore).toBe(true)
    expect(p.atTopAfter).toBe(true)
    expect(p.decision).toBe('PASS')
  })

  it('drawer open → payload carries drawerVisible=true and still PASS', () => {
    const p = buildScrollNavAudit({ documentKey: 'doc:key', action: 'GO_BOTTOM', scrollTopBefore: 0, scrollTopAfter: 800, maxScrollTop: 800, drawerVisible: true, locked: false })
    expect(p.drawerVisible).toBe(true)
    expect(p.decision).toBe('PASS')
  })

  it('locked → payload carries locked=true and still PASS', () => {
    const p = buildScrollNavAudit({ documentKey: 'doc:key', action: 'GO_TOP', scrollTopBefore: 800, scrollTopAfter: 0, maxScrollTop: 800, drawerVisible: false, locked: true })
    expect(p.locked).toBe(true)
    expect(p.decision).toBe('PASS')
  })

  it('GO_BOTTOM not reaching bottom → FAIL', () => {
    const p = buildScrollNavAudit({ documentKey: 'doc:key', action: 'GO_BOTTOM', scrollTopBefore: 0, scrollTopAfter: 300, maxScrollTop: 800, drawerVisible: false, locked: false })
    expect(p.decision).toBe('FAIL')
  })
})

describe('host-level scroll button click reaches the real container', () => {
  it('click ↓ scrolls the container to max; click ↑ scrolls to 0', () => {
    const shell = document.createElement('div')
    shell.style.cssText = 'overflow-y:auto;'
    let scrollTop = 0
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => 200 })
    Object.defineProperty(shell, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v } })
    ;(shell as unknown as { scrollTo: unknown }).scrollTo = (opts: { top: number }) => {
      scrollTop = opts.top
      // Real scrollTo fires a scroll event → navigator state recomputes.
      shell.dispatchEvent(new Event('scroll'))
    }
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    shell.appendChild(write)
    document.body.appendChild(shell)

    const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
    h.mount()
    const navBtns = Array.from(document.querySelectorAll('.inkchapter-doc-navigator__btn')) as HTMLButtonElement[]
    const up = navBtns[0]
    const down = navBtns[1]
    expect(down.disabled).toBe(false) // at top → ↓ enabled
    down.click()
    expect(scrollTop).toBe(800) // maxScrollTop
    expect(up.disabled).toBe(false) // at bottom → ↑ enabled
    up.click()
    expect(scrollTop).toBe(0)
    h.dispose()
  })
})
