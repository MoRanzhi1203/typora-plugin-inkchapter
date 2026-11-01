// @vitest-environment jsdom
/**
 * 内容块工具栏 ↔ Overlay 宿主集成测试。
 * 验证：单一 overlay 根、绝不进入 #write、滚动隐藏、文档切换清理、释放。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DocumentUtilityOverlayHost,
} from './document-utility-overlay-host'
import type { DocumentDiagnosticsProviders } from './document-diagnostics-authority'
import type { DocumentUtilitiesContext } from './document-utilities-context'
import {
  CODE_FOLD_CLASS,
  CONTENT_TOOLBAR_CLASS,
} from './content-block-toolbar-controller'

function fakeContext(overrides: Partial<DocumentUtilitiesContext['authority']> = {}): DocumentUtilitiesContext {
  return {
    authority: {
      getActiveFilePath: () => 'D:/vault/doc.md',
      getDocumentKey: () => 'doc:key',
      getMarkdown: () => '# 标题\n\n```js\nconst a = 1\n```\n',
      isStrictMode: () => true,
      vaultRoot: 'D:/vault',
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

function stubRect(el: Element, left: number, top: number, width: number, height: number): void {
  const rect = {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect
  el.getBoundingClientRect = () => rect
}

let host: DocumentUtilityOverlayHost | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  document.body.innerHTML = '<div id="scroll-host"><div id="write"></div></div>'
  const write = document.getElementById('write') as HTMLElement
  write.innerHTML =
    '<pre class="md-fences" cid="c1"><div class="CodeMirror"><pre class="CodeMirror-line"><span id="l1">x</span></pre></div></pre>' +
    '<p cid="p1"><span class="md-image" data-src="./a.png"><img id="img1" src="file:///D:/a.png"></span></p>'
  stubRect(write.querySelector('pre.md-fences')!, 100, 100, 400, 120)
  stubRect(document.getElementById('img1')!, 200, 300, 400, 200)
  host = null
})

afterEach(() => {
  host?.dispose()
  host = null
  document.body.innerHTML = ''
})

function mountHost(): DocumentUtilityOverlayHost {
  const h = new DocumentUtilityOverlayHost({
    ctx: fakeContext(),
    providers: fakeProviders(),
    onBindDocument: () => {},
    contentBlockToolbar: {
      actions: {
        readCodeSource: () => 'const a = 1',
        copyText: async () => ({ ok: true, verified: true, reason: null }),
        copyImage: async () => ({ ok: true, verified: true, reason: null }),
      },
      getMarkdown: () => '# t\n\n```js\nconst a = 1\n```\n',
    },
  })
  h.mount()
  host = h
  return h
}

const rootSelector = '[data-inkchapter-utility-root="true"]'

describe('CONTENT-TOOLBAR-HOST mount', () => {
  it('mounts one toolbar inside the existing overlay root, never inside #write', () => {
    mountHost()
    const root = document.querySelector(rootSelector) as HTMLElement
    const write = document.getElementById('write') as HTMLElement
    expect(root.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}`)).toHaveLength(1)
    expect(write.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
  })

  it('keeps existing overlay surfaces intact (single root / toolbar / navigator / drawer)', () => {
    mountHost()
    expect(document.querySelectorAll(rootSelector)).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-toolbar')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-navigator')).toHaveLength(1)
    expect(document.querySelectorAll('.inkchapter-doc-drawer')).toHaveLength(1)
  })

  it('does not mount the toolbar when the option is absent', () => {
    const h = new DocumentUtilityOverlayHost({
      ctx: fakeContext(),
      providers: fakeProviders(),
      onBindDocument: () => {},
    })
    h.mount()
    host = h
    expect(document.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
  })
})

describe('CONTENT-TOOLBAR-HOST interaction', () => {
  it('shows on hover and hides on editor scroll (single existing listener)', () => {
    mountHost()
    const fence = document.querySelector('pre.md-fences')!
    fence.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    const toolbar = document.querySelector(`.${CONTENT_TOOLBAR_CLASS}`) as HTMLElement
    expect(toolbar.style.display).not.toBe('none')
    ;(document.getElementById('scroll-host') as HTMLElement).dispatchEvent(new Event('scroll'))
    expect(toolbar.style.display).toBe('none')
  })

  it('drops the fold projection on document switch', () => {
    mountHost()
    const fence = document.querySelector('pre.md-fences') as HTMLElement
    fence.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    const foldBtn = document.querySelector('[data-action="toggle-fold"]') as HTMLButtonElement
    foldBtn.click()
    expect(fence.classList.contains(CODE_FOLD_CLASS)).toBe(true)
    host!.bindDocument()
    expect(fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
  })

  it('removes the toolbar element on dispose', () => {
    mountHost()
    host!.dispose()
    expect(document.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
    host = null
  })
})
