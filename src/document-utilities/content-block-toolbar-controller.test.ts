// @vitest-environment jsdom
/**
 * 内容块工具栏 — 控制器（悬停/复制/折叠/清理）测试。
 * 只使用 jsdom + 既有 overlay 根，不启动 Typora。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CODE_FOLD_ATTR,
  CODE_FOLD_CLASS,
  CODE_FOLD_SUMMARY_ATTR,
  CONTENT_TOOLBAR_CLASS,
  ContentBlockToolbarController,
} from './content-block-toolbar-controller'
import { ContentBlockToolbarSession } from './content-block-toolbar-session'

interface RectInput {
  left: number
  top: number
  width: number
  height: number
}

function stubRect(el: Element, input: RectInput): void {
  const rect = {
    left: input.left,
    top: input.top,
    right: input.left + input.width,
    bottom: input.top + input.height,
    width: input.width,
    height: input.height,
    x: input.left,
    y: input.top,
    toJSON: () => ({}),
  } as DOMRect
  el.getBoundingClientRect = () => rect
}

interface Harness {
  write: HTMLElement
  overlay: HTMLElement
  fence: HTMLElement
  img: HTMLImageElement
  controller: ContentBlockToolbarController
  toolbar: () => HTMLElement | null
  copyText: ReturnType<typeof vi.fn>
  copyImage: ReturnType<typeof vi.fn>
  readCodeSource: ReturnType<typeof vi.fn>
  onLayoutInvalidated: ReturnType<typeof vi.fn>
  audits: Array<{ event: string; payload: Record<string, unknown> }>
}

function createHarness(overrides: { sourceText?: string | null; markdown?: string | null } = {}): Harness {
  document.body.innerHTML = `
    <div data-inkchapter-utility-root="true" id="overlay-root"></div>
    <div id="write">
      <pre class="md-fences" cid="c1"><div class="CodeMirror"><pre class="CodeMirror-line"><span id="line1">x</span></pre></div></pre>
      <p cid="p1"><span class="md-image" data-src="./a.png"><img id="img1" src="file:///D:/a.png"></span></p>
    </div>`
  const overlay = document.getElementById('overlay-root') as HTMLElement
  const write = document.getElementById('write') as HTMLElement
  const fence = write.querySelector('pre.md-fences') as HTMLElement
  const img = document.getElementById('img1') as HTMLImageElement
  stubRect(fence, { left: 100, top: 100, width: 400, height: 120 })
  stubRect(img, { left: 200, top: 300, width: 400, height: 200 })

  const sourceText = overrides.sourceText === undefined ? 'line1\nline2' : overrides.sourceText
  const copyText = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const copyImage = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const readCodeSource = vi.fn(() => sourceText)
  const onLayoutInvalidated = vi.fn()
  const audits: Array<{ event: string; payload: Record<string, unknown> }> = []

  const controller = new ContentBlockToolbarController(overlay, {
    getEditorRoot: () => document.getElementById('write') as HTMLElement | null,
    getMarkdown: () => (overrides.markdown === undefined ? '```\nfrom-markdown\n```' : overrides.markdown),
    actions: { readCodeSource, copyText, copyImage },
    onLayoutInvalidated,
    emitAudit: (event, payload) => audits.push({ event, payload }),
  })
  controller.mount()

  return {
    write,
    overlay,
    fence,
    img,
    controller,
    toolbar: () => overlay.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}`),
    copyText,
    copyImage,
    readCodeSource,
    onLayoutInvalidated,
    audits,
  }
}

function hover(target: Element): void {
  target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

let harness: Harness | null = null

beforeEach(() => {
  vi.useFakeTimers()
  harness = null
})

afterEach(() => {
  harness?.controller.dispose()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('CONTENT-TOOLBAR-CONTROLLER mount', () => {
  it('mounts exactly one toolbar inside the existing overlay root, never inside #write', () => {
    harness = createHarness()
    const toolbar = harness.toolbar()!
    expect(toolbar).toBeTruthy()
    expect(harness.overlay.contains(toolbar)).toBe(true)
    expect(harness.write.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
    expect(harness.overlay.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}`)).toHaveLength(1)
    expect(toolbar.getAttribute('data-inkchapter-ui-root')).toBe('document-utilities')
    expect(toolbar.style.display).toBe('none')
  })

  it('dispose removes the node and stops listening', () => {
    harness = createHarness()
    harness.controller.dispose()
    expect(harness.overlay.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
    hover(harness.fence)
    expect(harness.toolbar()).toBeNull()
  })
})

describe('CONTENT-TOOLBAR-CONTROLLER code block visibility', () => {
  it('shows copy + fold at the fence top-right on hover', () => {
    harness = createHarness()
    hover(harness.fence)
    const toolbar = harness.toolbar()!
    expect(toolbar.style.display).not.toBe('none')
    expect(toolbar.getAttribute('data-block-kind')).toBe('code')
    expect(toolbar.querySelector<HTMLElement>('[data-action="copy-code"]')!.hidden).toBe(false)
    expect(toolbar.querySelector<HTMLElement>('[data-action="toggle-fold"]')!.hidden).toBe(false)
    expect(toolbar.querySelector<HTMLElement>('[data-action="copy-image"]')!.hidden).toBe(true)
    // 500 - 76(default width) - 8 = 416 ; 100 + 8 = 108
    expect(toolbar.style.left).toBe('416px')
    expect(toolbar.style.top).toBe('108px')
  })

  it('hides on editor scroll so no stale toolbar floats', () => {
    harness = createHarness()
    hover(harness.fence)
    expect(harness.controller.isVisible()).toBe(true)
    harness.controller.onEditorScroll()
    expect(harness.controller.isVisible()).toBe(false)
    expect(harness.toolbar()!.style.display).toBe('none')
  })

  it('hides after the pointer leaves with a grace delay', () => {
    harness = createHarness()
    hover(harness.fence)
    harness.fence.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    expect(harness.controller.isVisible()).toBe(true)
    vi.advanceTimersByTime(200)
    expect(harness.controller.isVisible()).toBe(false)
  })

  it('emits a geometry audit for the shown target (caption clearance evidence)', () => {
    harness = createHarness()
    hover(harness.fence)
    const show = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-SHOW')
    expect(show?.payload).toMatchObject({ kind: 'code', blockKey: 'code:cid:c1', buttonCount: 2 })
    expect(Array.isArray(show?.payload.anchorRect)).toBe(true)
    expect(Array.isArray(show?.payload.toolbarRect)).toBe(true)
    expect(typeof show?.payload.belowCaptionLine).toBe('number')
  })

  it('honours geometry changes when the anchor scrolls out of the viewport', () => {
    harness = createHarness()
    hover(harness.fence)
    stubRect(harness.fence, { left: 100, top: 900, width: 400, height: 120 })
    harness.controller.syncGeometry()
    expect(harness.controller.isVisible()).toBe(false)
  })

  it('repositions the visible toolbar after a layout change (window/sidebar)', () => {
    harness = createHarness()
    hover(harness.fence)
    expect(harness.toolbar()!.style.left).toBe('416px')
    // 布局变化：代码块整体左移（例如侧栏显示 / 窗口变窄）。
    stubRect(harness.fence, { left: 40, top: 100, width: 400, height: 120 })
    harness.controller.syncGeometry()
    expect(harness.controller.isVisible()).toBe(true)
    expect(harness.toolbar()!.style.left).toBe('356px')
    const reposition = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-REPOSITION')
    expect(reposition?.payload).toMatchObject({ from: [416, 108], to: [356, 108] })
  })
})

describe('CONTENT-TOOLBAR-CONTROLLER image block visibility', () => {
  it('shows only the image button anchored inside the image pixels', () => {
    harness = createHarness()
    hover(harness.img)
    const toolbar = harness.toolbar()!
    expect(toolbar.getAttribute('data-block-kind')).toBe('image')
    expect(toolbar.querySelector<HTMLElement>('[data-action="copy-image"]')!.hidden).toBe(false)
    expect(toolbar.querySelector<HTMLElement>('[data-action="copy-code"]')!.hidden).toBe(true)
    expect(toolbar.querySelector<HTMLElement>('[data-action="toggle-fold"]')!.hidden).toBe(true)
    // 600 - 76 - 8 = 516 ; 300 + 8 = 308
    expect(toolbar.style.left).toBe('516px')
    expect(toolbar.style.top).toBe('308px')
  })

  it('places the toolbar outside a small image instead of covering it', () => {
    harness = createHarness()
    stubRect(harness.img, { left: 200, top: 300, width: 60, height: 40 })
    hover(harness.img)
    const toolbar = harness.toolbar()!
    // 300 - 28(default height) - 8 = 264
    expect(toolbar.style.top).toBe('264px')
  })
})

describe('CONTENT-TOOLBAR-CONTROLLER copy code', () => {
  it('copies the CodeMirror source text verbatim and reports verified success', async () => {
    harness = createHarness({ sourceText: '  indented\n\nlast' })
    hover(harness.fence)
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="copy-code"]')!
    btn.click()
    await flushMicrotasks()
    expect(harness.copyText).toHaveBeenCalledWith('  indented\n\nlast')
    expect(btn.classList.contains('is-success')).toBe(true)
    expect(btn.getAttribute('title')).toBe('已复制（已校验）')
    const audit = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-COPY-CODE')
    expect(audit?.payload).toMatchObject({ decision: 'PASS', verified: true, lineCount: 3 })
  })

  it('falls back to the Markdown fence when no CodeMirror instance exists', async () => {
    harness = createHarness({ sourceText: null })
    hover(harness.fence)
    harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="copy-code"]')!.click()
    await flushMicrotasks()
    expect(harness.copyText).toHaveBeenCalledWith('from-markdown')
  })

  it('reports a real failure without claiming success', async () => {
    harness = createHarness()
    harness.copyText.mockResolvedValueOnce({ ok: false, verified: false, reason: 'CLIPBOARD_WRITE_FAILED' })
    hover(harness.fence)
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="copy-code"]')!
    btn.click()
    await flushMicrotasks()
    expect(btn.classList.contains('is-success')).toBe(false)
    expect(btn.classList.contains('is-error')).toBe(true)
    expect(btn.getAttribute('title')).toContain('CLIPBOARD_WRITE_FAILED')
  })

  it('reports failure when the source text cannot be read at all', async () => {
    harness = createHarness({ sourceText: null, markdown: null })
    hover(harness.fence)
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="copy-code"]')!
    btn.click()
    await flushMicrotasks()
    expect(harness.copyText).not.toHaveBeenCalled()
    expect(btn.classList.contains('is-error')).toBe(true)
  })
})

describe('CONTENT-TOOLBAR-CONTROLLER copy image', () => {
  it('passes the real image element to the clipboard adapter', async () => {
    harness = createHarness()
    hover(harness.img)
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    btn.click()
    await flushMicrotasks()
    expect(harness.copyImage).toHaveBeenCalledTimes(1)
    expect(harness.copyImage.mock.calls[0][0]).toBe(harness.img)
    expect(btn.classList.contains('is-success')).toBe(true)
  })
})

describe('CONTENT-TOOLBAR-CONTROLLER folding', () => {
  it('folds without touching the code DOM and notifies the existing geometry scheduler', () => {
    harness = createHarness()
    const before = harness.fence.innerHTML
    hover(harness.fence)
    harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!.click()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(true)
    expect(harness.fence.getAttribute(CODE_FOLD_SUMMARY_ATTR)).toBe('已折叠 · 2 行')
    expect(harness.fence.innerHTML).toBe(before)
    expect(harness.onLayoutInvalidated).toHaveBeenCalledWith('content-block-fold')
    expect(harness.controller.getFoldKeys()).toEqual(['code:cid:c1'])
    const foldBtn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!
    expect(foldBtn.getAttribute('aria-pressed')).toBe('true')
    expect(foldBtn.getAttribute('title')).toBe('展开代码')
  })

  it('expands again through the same button', () => {
    harness = createHarness()
    hover(harness.fence)
    const btn = () => harness!.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!
    btn().click()
    btn().click()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
    expect(harness.fence.hasAttribute(CODE_FOLD_SUMMARY_ATTR)).toBe(false)
    expect(harness.controller.getFoldKeys()).toEqual([])
    expect(harness.onLayoutInvalidated).toHaveBeenLastCalledWith('content-block-unfold')
  })

  it('refuses to fold while the caret or a selection is inside the block', () => {
    harness = createHarness()
    const line = document.getElementById('line1') as HTMLElement
    line.tabIndex = 0
    line.focus()
    hover(harness.fence)
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!
    btn.click()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
    expect(btn.classList.contains('is-error')).toBe(true)
    expect(btn.getAttribute('title')).toContain('光标位于该代码块内')
  })

  it('refuses to fold when the caret was inside at show time even if focus moved away on click', () => {
    // 真实 GUI：点击浮层按钮时 Typora 会先改变焦点上下文，
    // 因此必须使用“最近编辑中的代码块”记录，而不是点击瞬间的 activeElement。
    harness = createHarness()
    const line = document.getElementById('line1') as HTMLElement
    line.tabIndex = 0
    line.focus()
    hover(harness.fence)
    line.blur()
    window.getSelection()?.removeAllRanges()
    const btn = harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!
    btn.click()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
    const blocked = harness.audits.find(
      (a) => a.event === 'CONTENT-BLOCK-TOOLBAR-FOLD' && a.payload.decision === 'BLOCKED',
    )
    expect(blocked?.payload).toMatchObject({
      reason: 'CARET_OR_SELECTION_INSIDE',
      caretInsideNow: false,
      recentlyFocused: true,
    })
  })

  it('expands automatically when a folded block gains focus', () => {
    harness = createHarness()
    hover(harness.fence)
    harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!.click()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(true)
    const line = document.getElementById('line1') as HTMLElement
    line.tabIndex = 0
    line.focus()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
    expect(harness.controller.getFoldKeys()).toEqual([])
  })

  it('re-applies the fold projection after Typora re-renders the fence', () => {
    harness = createHarness()
    hover(harness.fence)
    harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!.click()
    expect(harness.fence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    // Typora 重建围栏：新节点不带 class/属性，但 cid 不变。
    harness.fence.className = 'md-fences'
    harness.fence.removeAttribute(CODE_FOLD_ATTR)
    harness.fence.removeAttribute(CODE_FOLD_SUMMARY_ATTR)
    harness.controller.syncGeometry()
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(true)
    expect(harness.fence.getAttribute(CODE_FOLD_SUMMARY_ATTR)).toBe('已折叠 · 2 行')
  })

  it('drops fold state on document switch and removes the projection', () => {
    harness = createHarness()
    hover(harness.fence)
    harness.toolbar()!.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]')!.click()
    harness.controller.resetForDocument('FILE_OPEN')
    expect(harness.fence.classList.contains(CODE_FOLD_CLASS)).toBe(false)
    expect(harness.controller.getFoldKeys()).toEqual([])
    expect(harness.controller.isVisible()).toBe(false)
  })
})

describe('CONTENT-TOOLBAR-SESSION', () => {
  it('retires entries whose canonical block disappeared', () => {
    const session = new ContentBlockToolbarSession()
    session.setFold({ key: 'code:cid:a', lineCount: 3, documentKey: null })
    session.setFold({ key: 'code:cid:b', lineCount: 5, documentKey: null })
    expect(session.retain(new Set(['code:cid:a']))).toEqual(['code:cid:b'])
    expect(session.entries().map((e) => e.key)).toEqual(['code:cid:a'])
    session.reset()
    expect(session.size).toBe(0)
  })
})
