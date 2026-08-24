// @vitest-environment jsdom
/**
 * Phase 7R.3.11.3 — Runtime interaction closure tests (INTERACTION-*) and
 * ResizeObserver attribution / log-reduction tests (RESIZE-*, LOGGING-1).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  classifyResizeSource,
  computeOcclusionRatio,
  DocumentUtilityOverlayHost,
  UTILITY_ROOT_IDENTITY_ATTR,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'

const rootIdentity = `[${UTILITY_ROOT_IDENTITY_ATTR}="true"]`

function fakeContext(key: string | null = 'doc:key'): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => (key ? '/vault/doc.md' : null),
      getDocumentKey: () => key,
      getMarkdown: () => '# 标题\n\n正文',
      isStrictMode: () => true,
      vaultRoot: '/vault',
      getCanonicalDuplicateIdentities: () => [],
      getCaptionDuplicateNames: () => [],
    },
    hasActiveDocument: () => key != null,
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
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as typeof requestAnimationFrame)
  host = null
})

afterEach(() => {
  host?.dispose()
  host = null
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({ ctx: fakeContext(), providers: fakeProviders(), onBindDocument: () => {} })
  h.mount()
  host = h
  return h
}

describe('INTERACTION-1 drawer open/close', () => {
  it('open → visible; close → hidden; root count unchanged; #write untouched', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.innerHTML = '<h1>标题</h1>'
    document.body.appendChild(write)
    const h = mountHost()
    const before = write.innerHTML
    const rootsBefore = document.querySelectorAll(rootIdentity).length
    const diag = document.querySelector('.inkchapter-doc-toolbar__btn--diag') as HTMLButtonElement
    diag.click()
    const drawer = document.querySelector('.inkchapter-doc-drawer') as HTMLElement
    expect(drawer.getAttribute('style')).toContain('display: flex')
    expect(document.querySelectorAll(rootIdentity)).toHaveLength(rootsBefore)
    expect(write.innerHTML).toBe(before)
    const close = Array.from(document.querySelectorAll('.inkchapter-doc-drawer__action')).find(b => b.textContent === '关闭') as HTMLButtonElement
    close.click()
    expect(drawer.getAttribute('style')).toContain('display: none')
    expect(write.innerHTML).toBe(before)
    expect(document.querySelectorAll(rootIdentity)).toHaveLength(rootsBefore)
    expect(h.getBcrEmitCount()).toBeGreaterThanOrEqual(3) // mount + open + close
  })
})

describe('INTERACTION-2 lock blocks edits, allows selection/copy/scroll, unlock restores', () => {
  it('locked blocks typing/backspace/delete/enter/paste/cut/drop/composition', () => {
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    document.body.appendChild(write)
    const h = mountHost()
    const lockBtn = document.querySelector('.inkchapter-doc-toolbar__btn--lock') as HTMLButtonElement
    lockBtn.click()
    expect(lockBtn.textContent).toBe('已锁定')

    const beforeInput = (inputType: string): Event => {
      const e = new Event('beforeinput', { bubbles: true, cancelable: true }) as Event & { inputType: string }
      ;(e as unknown as { inputType: string }).inputType = inputType
      write.dispatchEvent(e)
      return e
    }
    const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    const generic = (t: string): Event => new Event(t, { bubbles: true, cancelable: true })

    expect(beforeInput('insertText').defaultPrevented).toBe(true)
    expect(beforeInput('insertCompositionText').defaultPrevented).toBe(true) // IME
    const backspace = key('Backspace')
    write.dispatchEvent(backspace)
    expect(backspace.defaultPrevented).toBe(true)
    const del = key('Delete')
    write.dispatchEvent(del)
    expect(del.defaultPrevented).toBe(true)
    const enter = key('Enter')
    write.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    for (const t of ['paste', 'cut', 'drop']) {
      const e = generic(t)
      write.dispatchEvent(e)
      expect(e.defaultPrevented, t).toBe(true)
    }

    // Allowed: copy / select-all.
    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    write.dispatchEvent(copy)
    expect(copy.defaultPrevented).toBe(false)
    // No pointer-events:none on the editor.
    expect(write.style.pointerEvents).not.toBe('none')

    // Unlock restores.
    lockBtn.click()
    expect(lockBtn.textContent).toBe('编辑')
    expect(beforeInput('insertText').defaultPrevented).toBe(false)
  })
})

describe('INTERACTION-4 document switch keeps counts stable', () => {
  it('A → B → A: root/toolbar/navigator stay 1, drawer <= 1', () => {
    // Provide a scroll container so the utility ResizeObserver is created.
    const shell = document.createElement('div')
    shell.style.cssText = 'overflow-y:auto;'
    const write = document.createElement('div')
    write.id = 'write'
    write.setAttribute('contenteditable', 'true')
    shell.appendChild(write)
    document.body.appendChild(shell)
    const h = mountHost()
    h.bindDocument()
    h.bindDocument()
    expect(document.querySelectorAll(rootIdentity)).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
    // One resize observer instance.
    expect((h as unknown as { resizeObserver: ResizeObserver | null }).resizeObserver).not.toBeNull()
  })
})

describe('RESIZE-1 coalesced geometry sync', () => {
  it('10 window resize notifications → one schedule per frame burst', () => {
    const captured: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { captured.push(cb as () => void); return 1 }) as typeof requestAnimationFrame)
    mountHost()
    captured.shift()?.() // flush mount sync
    const before = host!.getGeometryCounters()
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('resize'))
    const after = host!.getGeometryCounters()
    expect(after.scheduleCount - before.scheduleCount).toBe(1)
    captured.shift()?.()
  })
})

describe('RESIZE-2 unchanged geometry → noop, no write', () => {
  it('identical geometry increments noopCount and keeps writeCount', () => {
    const h = mountHost()
    const before = h.getGeometryCounters()
    h.bindDocument() // schedules a geometry sync with identical geometry
    const after = h.getGeometryCounters()
    expect(after.noopCount).toBeGreaterThan(before.noopCount)
    expect(after.writeCount).toBe(before.writeCount)
  })
})

describe('RESIZE-3/4 resize source classification', () => {
  it('viewport width change → EXTERNAL_LAYOUT_RESIZE, never feedback', () => {
    expect(classifyResizeSource({ viewportWidthChanged: true, msSinceUtilityWrite: 5, feedbackWindowMs: 80 })).toBe('EXTERNAL_LAYOUT_RESIZE')
    expect(classifyResizeSource({ viewportWidthChanged: true, msSinceUtilityWrite: null, feedbackWindowMs: 80 })).toBe('EXTERNAL_LAYOUT_RESIZE')
  })

  it('write → callback with no viewport change → UTILITY_FEEDBACK_LOOP', () => {
    expect(classifyResizeSource({ viewportWidthChanged: false, msSinceUtilityWrite: 3, feedbackWindowMs: 80 })).toBe('UTILITY_FEEDBACK_LOOP')
  })

  it('callback far from a write → INDETERMINATE', () => {
    expect(classifyResizeSource({ viewportWidthChanged: false, msSinceUtilityWrite: 500, feedbackWindowMs: 80 })).toBe('INDETERMINATE')
    expect(classifyResizeSource({ viewportWidthChanged: false, msSinceUtilityWrite: null, feedbackWindowMs: 80 })).toBe('INDETERMINATE')
  })
})

describe('LOGGING-1 BCR log reduction during continuous resize', () => {
  it('20 resize events → full BCR emits <= 2 (mount + settled summary)', () => {
    vi.useFakeTimers()
    const h = mountHost()
    const afterMount = h.getBcrEmitCount()
    // Continuous resize burst — geometry unchanged (no shell), so no writes.
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200) // settle debounce
    const afterBurst = h.getBcrEmitCount()
    expect(afterBurst - afterMount).toBeLessThanOrEqual(2)
    vi.useRealTimers()
  })

  it('resize summary counters are exposed', () => {
    const h = mountHost()
    window.dispatchEvent(new Event('resize'))
    const c = h.getGeometryCounters()
    expect(c.windowResizeEventCount).toBeGreaterThanOrEqual(1)
    expect(c.executionCount).toBeGreaterThanOrEqual(1)
  })
})

describe('occlusion is computed against writeRect', () => {
  it('small toolbar/navigator barely overlap a wide #write', () => {
    const write = { left: 250, top: 100, right: 1450, bottom: 800 }
    const toolbar = { left: 1260, top: 112, right: 1426, bottom: 160 }
    expect(computeOcclusionRatio(toolbar, write)).toBeLessThan(0.1)
  })
})
