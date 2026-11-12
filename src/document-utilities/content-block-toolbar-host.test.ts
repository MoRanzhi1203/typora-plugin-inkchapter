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
  CODE_LANGBAR_ATTR,
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
  it('mounts one language bar per code block inside each fence (never in the overlay root)', async () => {
    mountHost()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const root = document.querySelector(rootSelector) as HTMLElement
    const write = document.getElementById('write') as HTMLElement
    const fence = write.querySelector('pre.md-fences') as HTMLElement
    // V3 stability：语言栏挂在 PRE 内部，与代码块共享原生滚动坐标系。
    expect(root.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toHaveLength(0)
    // P0：图片操作条默认不常驻；悬停后挂到插件 overlay 根，绝不进入图片段落。
    expect(root.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--image`)).toHaveLength(0)
    const img = write.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    const imageBar = root.querySelector(`.${CONTENT_TOOLBAR_CLASS}--image`)
    expect(imageBar).toBeTruthy()
    expect(img.closest('.md-image')!.querySelector(`.${CONTENT_TOOLBAR_CLASS}--image`)).toBeNull()
    expect(write.textContent).not.toContain('复制本地路径')
    expect(fence.querySelector(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toBeTruthy()
    expect(fence.querySelector('.CodeMirror')!.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
  })

  it('re-attaches the language bar in the SAME microtask when Typora rebuilds the fence body', async () => {
    mountHost()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const fence = document.getElementById('write')!.querySelector('pre.md-fences') as HTMLElement
    const barSelector = `.${CONTENT_TOOLBAR_CLASS}--langbar`
    expect(fence.querySelector(barSelector)).toBeTruthy()

    // Typora 重新挂载 CodeMirror 时会清空 PRE 的子节点，语言栏随之消失。
    fence.innerHTML = '<div class="CodeMirror"><pre class="CodeMirror-line"><span>x</span></pre></div>'
    expect(fence.querySelector(barSelector)).toBeNull()

    // 必须在同一帧（微任务）内补回，而不是等下一次几何 pass（原先会空窗 20–40ms）。
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(fence.querySelector(barSelector)).toBeTruthy()
    expect(fence.getAttribute(CODE_LANGBAR_ATTR)).toBe('true')
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
  it('keeps the language bar inside the fence across an editor scroll (no inline position)', async () => {
    mountHost()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const fence = document.querySelector('pre.md-fences') as HTMLElement
    const bar = fence.querySelector(`.${CONTENT_TOOLBAR_CLASS}--langbar`) as HTMLElement
    expect(bar).toBeTruthy()
    expect(bar.style.display).not.toBe('none')
    ;(document.getElementById('scroll-host') as HTMLElement).dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    // 语言栏是 PRE 的子节点：滚动不隐藏、不重定位、不产生 inline 坐标。
    expect(bar.isConnected).toBe(true)
    expect(bar.parentElement).toBe(fence)
    expect(bar.style.top).toBe('')
    expect(bar.style.left).toBe('')
  })

  it('resets code-block views on document switch', async () => {
    mountHost()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const fence = document.querySelector('pre.md-fences') as HTMLElement
    expect(fence.getAttribute(CODE_LANGBAR_ATTR)).toBe('true')
    host!.bindDocument()
    expect(fence.hasAttribute(CODE_LANGBAR_ATTR)).toBe(false)
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toHaveLength(0)
  })

  it('removes the toolbar element on dispose', () => {
    mountHost()
    host!.dispose()
    expect(document.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
    host = null
  })
})
