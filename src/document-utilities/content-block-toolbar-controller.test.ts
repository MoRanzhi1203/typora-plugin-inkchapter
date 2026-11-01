// @vitest-environment jsdom
/**
 * 内容块工具栏 V3 — 语言栏 / 预览折叠 / 图片复制 控制器测试。
 * 只使用 jsdom + 既有 overlay 根，不启动 Typora。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CODE_FOLD_ATTR,
  CODE_FOLD_HEIGHT_VAR,
  CODE_FOLD_PREVIEW_ATTR,
  CODE_FOLD_SUMMARY_ATTR,
  CODE_FOLDABLE_ATTR,
  CODE_LANGBAR_ATTR,
  CONTENT_TOOLBAR_CLASS,
  ContentBlockToolbarController,
  FOLD_BAR_CLASS,
} from './content-block-toolbar-controller'
import { ContentBlockToolbarSession } from './content-block-toolbar-session'

const LONG_CODE = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`).join('\n')
const SHORT_CODE = 'const a = 1\nconst b = 2\nconsole.log(a + b)'

function stubRect(el: Element, left: number, top: number, width: number, height: number): void {
  const rect = {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect
  el.getBoundingClientRect = () => rect
}

interface Harness {
  write: HTMLElement
  overlay: HTMLElement
  longFence: HTMLElement
  shortFence: HTMLElement
  img: HTMLImageElement
  controller: ContentBlockToolbarController
  bars: () => HTMLElement[]
  barFor: (cid: string) => HTMLElement | null
  foldBarFor: (cid: string) => HTMLElement | null
  copyBtnFor: (cid: string) => HTMLButtonElement | null
  foldBtnFor: (cid: string) => HTMLButtonElement | null
  copyText: ReturnType<typeof vi.fn>
  copyImage: ReturnType<typeof vi.fn>
  onLayoutInvalidated: ReturnType<typeof vi.fn>
  audits: Array<{ event: string; payload: Record<string, unknown> }>
  setPreviewLines: (n: 5 | 10) => void
}

function createHarness(overrides: { source?: (cid: string) => string | null } = {}): Harness {
  document.body.innerHTML = `
    <div data-inkchapter-utility-root="true" id="overlay-root"></div>
    <div id="write">
      <pre class="md-fences" cid="long" lang="javascript" data-inkchapter-caption-label="代码 1-1"><div class="CodeMirror"><div class="CodeMirror-line"><span>code</span></div></div></pre>
      <pre class="md-fences" cid="short" lang="python"><div class="CodeMirror"><div class="CodeMirror-line"><span>code</span></div></div></pre>
      <p cid="p1"><span class="md-image" data-src="./a.png"><img id="img1" src="file:///D:/a.png"></span></p>
    </div>`
  const overlay = document.getElementById('overlay-root') as HTMLElement
  const write = document.getElementById('write') as HTMLElement
  const longFence = write.querySelector('pre.md-fences') as HTMLElement
  const shortFence = write.querySelectorAll('pre.md-fences')[1] as HTMLElement
  const img = document.getElementById('img1') as HTMLImageElement
  stubRect(longFence, 100, 100, 400, 420)
  stubRect(shortFence, 100, 560, 400, 90)
  stubRect(img, 200, 700, 400, 150)

  const source = overrides.source ?? ((cid: string) => (cid === 'long' ? LONG_CODE : SHORT_CODE))
  const copyText = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const copyImage = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const onLayoutInvalidated = vi.fn()
  const audits: Array<{ event: string; payload: Record<string, unknown> }> = []
  let previewLines: 5 | 10 = 10

  const controller = new ContentBlockToolbarController(overlay, {
    getEditorRoot: () => document.getElementById('write') as HTMLElement | null,
    getMarkdown: () => null,
    actions: {
      readCodeSource: (fence) => source(fence.getAttribute('cid') ?? ''),
      copyText,
      copyImage,
    },
    onLayoutInvalidated,
    emitAudit: (event, payload) => audits.push({ event, payload }),
    getPreviewLines: () => previewLines,
  })
  controller.mount()
  controller.syncGeometry()

  const barFor = (cid: string): HTMLElement | null =>
    overlay.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--langbar[data-block-key="code:cid:${cid}"]`)
  const foldBarFor = (cid: string): HTMLElement | null =>
    overlay.querySelector<HTMLElement>(`.${FOLD_BAR_CLASS}[data-block-key="code:cid:${cid}"]`)

  return {
    write,
    overlay,
    longFence,
    shortFence,
    img,
    controller,
    bars: () => Array.from(overlay.querySelectorAll<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--langbar`)),
    barFor,
    foldBarFor,
    copyBtnFor: (cid) => barFor(cid)?.querySelector<HTMLButtonElement>('[data-action="copy-code"]') ?? null,
    foldBtnFor: (cid) => foldBarFor(cid)?.querySelector<HTMLButtonElement>('button') ?? null,
    copyText,
    copyImage,
    onLayoutInvalidated,
    audits,
    setPreviewLines: (n) => { previewLines = n },
  }
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

describe('V3 langbar mount', () => {
  it('creates one language bar per visible code block and none inside #write', () => {
    harness = createHarness()
    expect(harness.bars()).toHaveLength(2)
    expect(harness.write.querySelector(`.${CONTENT_TOOLBAR_CLASS}`)).toBeNull()
    expect(harness.longFence.getAttribute(CODE_LANGBAR_ATTR)).toBe('true')
  })

  it('renders language badge, real language, line count and a copy button', () => {
    harness = createHarness()
    const bar = harness.barFor('long')!
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__badge`)?.textContent).toBe('JS')
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lang`)?.textContent).toBe('JavaScript')
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lines`)?.textContent).toBe('20 行')
    expect(harness.copyBtnFor('long')?.getAttribute('aria-label')).toBe('复制完整代码')
    expect(harness.barFor('short')!.querySelector(`.${CONTENT_TOOLBAR_CLASS}__badge`)?.textContent).toBe('PY')
  })

  it('anchors the language bar to the code body top and the fold bar inside the bottom band', () => {
    harness = createHarness()
    const bar = harness.barFor('long')!
    expect(bar.style.left).toBe('100px')
    expect(bar.style.top).toBe('100px')
    expect(bar.style.width).toBe('400px')
    expect(bar.style.height).toBe('30px')
    const foldBar = harness.foldBarFor('long')!
    expect(foldBar.style.top).toBe('488px')
    expect(foldBar.style.display).not.toBe('none')
  })

  it('never renders a fold bar for short code', () => {
    harness = createHarness()
    expect(harness.foldBarFor('short')!.style.display).toBe('none')
  })

  it('emits a geometry audit that proves the bar sits below the caption line', () => {
    harness = createHarness()
    const show = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-SHOW')
    expect(show?.payload).toMatchObject({
      kind: 'code',
      mode: 'langbar',
      blockKey: 'code:cid:long',
      captionLabel: '代码 1-1',
      buttonCount: 1,
    })
    expect(show?.payload.belowCaptionLine).toBe(0)
    expect(show?.payload.insideAnchorRight).toBe(0)
  })

  it('repositions every bar on layout changes', () => {
    harness = createHarness()
    stubRect(harness.longFence, 40, 100, 400, 420)
    harness.controller.syncGeometry()
    expect(harness.barFor('long')!.style.left).toBe('40px')
    const reposition = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-REPOSITION')
    expect(reposition?.payload).toMatchObject({ from: [100, 100], to: [40, 100] })
  })

  it('dispose removes every bar and the image toolbar', () => {
    harness = createHarness()
    harness.controller.dispose()
    expect(harness.overlay.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}`)).toHaveLength(0)
    expect(harness.overlay.querySelectorAll(`.${FOLD_BAR_CLASS}`)).toHaveLength(0)
  })
})

describe('V3 preview folding', () => {
  it('reserves an in-block fold band and keeps the fold bar inside the fence', () => {
    harness = createHarness()
    expect(harness.longFence.getAttribute(CODE_FOLDABLE_ATTR)).toBe('true')
    expect(harness.shortFence.hasAttribute(CODE_FOLDABLE_ATTR)).toBe(false)
    const foldBar = harness.foldBarFor('long')!
    // rect = top 100 / height 420 → bottom 520；折叠条在带内（bottom - 28 - 4）。
    expect(foldBar.style.top).toBe('488px')
    expect(foldBar.style.display).not.toBe('none')
  })

  it('folds 20 lines to the first 10 and keeps the code DOM intact', () => {
    harness = createHarness()
    const before = harness.longFence.innerHTML
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    expect(harness.longFence.getAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe('10')
    expect(harness.longFence.getAttribute(CODE_FOLD_SUMMARY_ATTR)).toBe('已折叠 · 10 行')
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).toMatch(/px$/)
    expect(harness.longFence.innerHTML).toBe(before)
    expect(harness.onLayoutInvalidated).toHaveBeenCalledWith('content-block-fold')
    expect(harness.foldBtnFor('long')!.textContent).toContain('展开剩余 10 行')
    const audit = harness.audits.find(
      (a) => a.event === 'CONTENT-BLOCK-TOOLBAR-FOLD' && a.payload.reason === 'FOLDED_PREVIEW',
    )
    expect(audit?.payload).toMatchObject({ previewLines: 10, totalLines: 20 })
  })

  it('switches to 5 preview lines when the setting changes', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    const height10 = harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)
    harness.setPreviewLines(5)
    harness.controller.syncGeometry()
    expect(harness.longFence.getAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe('5')
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).not.toBe(height10)
  })

  it('expands back through the same bar', () => {
    harness = createHarness()
    const btn = () => harness!.foldBtnFor('long')!
    btn().click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    btn().click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    expect(harness.longFence.hasAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe(false)
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).toBe('')
    expect(btn().textContent).toContain('收起至预览')
    expect(harness.onLayoutInvalidated).toHaveBeenLastCalledWith('content-block-unfold')
  })

  it('refuses to fold while the caret is inside the block', () => {
    harness = createHarness()
    const line = harness.longFence.querySelector('.CodeMirror-line') as HTMLElement
    line.tabIndex = 0
    line.focus()
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    const blocked = harness.audits.find(
      (a) => a.event === 'CONTENT-BLOCK-TOOLBAR-FOLD' && a.payload.decision === 'BLOCKED',
    )
    expect(blocked?.payload).toMatchObject({ reason: 'CARET_OR_SELECTION_INSIDE', recentlyFocused: true })
  })

  it('auto-expands when a folded block gains focus', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const line = harness.longFence.querySelector('.CodeMirror-line') as HTMLElement
    line.tabIndex = 0
    line.focus()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    expect(harness.controller.getFoldKeys()).toEqual([])
  })

  it('re-applies the projection after Typora re-renders the fence', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    harness.longFence.removeAttribute(CODE_FOLD_ATTR)
    harness.longFence.removeAttribute(CODE_FOLD_PREVIEW_ATTR)
    harness.longFence.style.removeProperty(CODE_FOLD_HEIGHT_VAR)
    harness.controller.syncGeometry()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    expect(harness.longFence.getAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe('10')
  })

  it('drops fold state and views on document switch', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    harness.controller.resetForDocument('FILE_OPEN')
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    expect(harness.controller.getFoldKeys()).toEqual([])
    expect(harness.overlay.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toHaveLength(0)
  })
})

describe('V3 copy', () => {
  it('copies the full source while folded (never the preview)', async () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    harness.copyBtnFor('long')!.click()
    await flushMicrotasks()
    expect(harness.copyText).toHaveBeenCalledWith(LONG_CODE)
    const audit = harness.audits.find((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-COPY-CODE')
    expect(audit?.payload).toMatchObject({ decision: 'PASS', verified: true, lineCount: 20, folded: true })
  })

  it('reports a real clipboard failure without claiming success', async () => {
    harness = createHarness()
    harness.copyText.mockResolvedValueOnce({ ok: false, verified: false, reason: 'CLIPBOARD_WRITE_FAILED' })
    harness.copyBtnFor('long')!.click()
    await flushMicrotasks()
    const btn = harness.copyBtnFor('long')!
    expect(btn.classList.contains('is-error')).toBe(true)
    expect(btn.getAttribute('title')).toContain('CLIPBOARD_WRITE_FAILED')
  })

  it('reports failure when the source text cannot be read', async () => {
    harness = createHarness({ source: () => null })
    harness.copyBtnFor('long')!.click()
    await flushMicrotasks()
    expect(harness.copyText).not.toHaveBeenCalled()
    expect(harness.copyBtnFor('long')!.classList.contains('is-error')).toBe(true)
  })
})

describe('V3 image toolbar (unchanged behaviour)', () => {
  it('shows only the copy-image button when hovering an image', () => {
    harness = createHarness()
    harness.img.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    const bar = harness.overlay.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--image`)!
    expect(bar.style.display).not.toBe('none')
    expect(bar.querySelectorAll('button')).toHaveLength(1)
    expect(bar.querySelector('button')!.getAttribute('data-action')).toBe('copy-image')
  })

  it('copies the real image element through the adapter', async () => {
    harness = createHarness()
    harness.img.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    harness.overlay.querySelector<HTMLButtonElement>(`.${CONTENT_TOOLBAR_CLASS}--image button`)!.click()
    await flushMicrotasks()
    expect(harness.copyImage).toHaveBeenCalledTimes(1)
    expect(harness.copyImage.mock.calls[0][0]).toBe(harness.img)
  })

  it('hides the image toolbar after the pointer leaves', () => {
    harness = createHarness()
    harness.img.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    harness.img.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    vi.advanceTimersByTime(220)
    const bar = harness.overlay.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--image`)!
    expect(bar.style.display).toBe('none')
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
