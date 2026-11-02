// @vitest-environment jsdom
/**
 * 内容块工具栏 V3 稳定性修复 — 语言栏（PRE 内部）/ 顶部折叠按钮 / 精确预览高度。
 * 只使用 jsdom + 既有 overlay 根，不启动 Typora。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CODE_FOLD_ATTR,
  CODE_FOLD_HEIGHT_VAR,
  CODE_FOLD_PREVIEW_ATTR,
  CODE_FOLD_SUMMARY_ATTR,
  CODE_LANGBAR_ATTR,
  CONTENT_TOOLBAR_CLASS,
  ContentBlockToolbarController,
  type CodeDiagnosticMark,
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

/** 给 CodeMirror 的每一行建立真实像素位置（20px/行），用于验证“不裁断半行”。 */
function stubLines(fence: HTMLElement, lineCount: number, startTop: number, lineHeight = 20): void {
  const lines = fence.querySelectorAll<HTMLElement>('.CodeMirror-line')
  lines.forEach((line, i) => {
    stubRect(line, 100, startTop + i * lineHeight, 400, lineHeight)
  })
  expect(lines.length).toBe(lineCount)
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
  copyBtnFor: (cid: string) => HTMLButtonElement | null
  foldBtnFor: (cid: string) => HTMLButtonElement | null
  diagFor: (cid: string) => HTMLElement | null
  copyText: ReturnType<typeof vi.fn>
  copyImage: ReturnType<typeof vi.fn>
  onLayoutInvalidated: ReturnType<typeof vi.fn>
  audits: Array<{ event: string; payload: Record<string, unknown> }>
  setPreviewLines: (n: 5 | 10) => void
  setBlockDiagnostics: (fn: ((ordinal: number) => { error: number; warning: number; hint: number } | null) | null) => void
  setBlockDiagnosticMarks: (fn: ((ordinal: number) => CodeDiagnosticMark[]) | null) => void
  stubBarRect: (cid: string, left: number, top: number, width: number) => void
}

function createHarness(overrides: { source?: (cid: string) => string | null } = {}): Harness {
  const longLines = Array.from({ length: 20 }, () => '<div class="CodeMirror-line"><span>code</span></div>').join('')
  const shortLines = Array.from({ length: 3 }, () => '<div class="CodeMirror-line"><span>code</span></div>').join('')
  document.body.innerHTML = `
    <div data-inkchapter-utility-root="true" id="overlay-root"></div>
    <div id="write">
      <pre class="md-fences" cid="long" lang="javascript" data-inkchapter-caption-label="代码 1-1"><div class="CodeMirror">${longLines}</div></pre>
      <pre class="md-fences" cid="short" lang="python"><div class="CodeMirror">${shortLines}</div></pre>
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
  stubLines(longFence, 20, 134)
  stubLines(shortFence, 3, 594)

  const source = overrides.source ?? ((cid: string) => (cid === 'long' ? LONG_CODE : SHORT_CODE))
  const copyText = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const copyImage = vi.fn(async () => ({ ok: true, verified: true, reason: null }))
  const onLayoutInvalidated = vi.fn()
  const audits: Array<{ event: string; payload: Record<string, unknown> }> = []
  let previewLines: 5 | 10 = 10
  let blockDiagnostics: ((ordinal: number) => { error: number; warning: number; hint: number } | null) | null = null
  let blockDiagnosticMarks: ((ordinal: number) => CodeDiagnosticMark[]) | null = null

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
    getBlockDiagnostics: (ordinal) => blockDiagnostics?.(ordinal) ?? null,
    getBlockDiagnosticMarks: (ordinal) => blockDiagnosticMarks?.(ordinal) ?? [],
  })
  controller.mount()
  controller.syncGeometry()

  const barFor = (cid: string): HTMLElement | null =>
    overlay.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--langbar[data-block-key="code:cid:${cid}"]`)
      ?? document.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--langbar[data-block-key="code:cid:${cid}"]`)

  return {
    write,
    overlay,
    longFence,
    shortFence,
    img,
    controller,
    bars: () => Array.from(document.querySelectorAll<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--langbar`)),
    barFor,
    copyBtnFor: (cid) => barFor(cid)?.querySelector<HTMLButtonElement>('[data-action="copy-code"]') ?? null,
    foldBtnFor: (cid) => barFor(cid)?.querySelector<HTMLButtonElement>('[data-action="toggle-fold"]') ?? null,
    diagFor: (cid) => barFor(cid)?.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}__diag`) ?? null,
    copyText,
    copyImage,
    onLayoutInvalidated,
    audits,
    setPreviewLines: (n) => { previewLines = n },
    setBlockDiagnostics: (fn) => { blockDiagnostics = fn },
    setBlockDiagnosticMarks: (fn) => { blockDiagnosticMarks = fn },
    stubBarRect: (cid, left, top, width) => {
      const bar = barFor(cid)
      if (bar) stubRect(bar, left, top, width, 30)
    },
  }
}

/** 把真实 DOM Range 放进指定代码行，模拟 Typora 编辑器内的光标行。 */
function placeCaret(line: HTMLElement): void {
  const host = line.firstChild ?? line
  const range = document.createRange()
  if (host.nodeType === Node.TEXT_NODE) range.setStart(host, 0)
  else range.setStart(line, 0)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
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

describe('V3 langbar mount (inside the fence)', () => {
  it('creates one bar per code block inside each PRE, never in the overlay root', () => {
    harness = createHarness()
    expect(harness.bars()).toHaveLength(2)
    expect(harness.overlay.querySelector(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toBeNull()
    expect(harness.longFence.querySelector(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toBeTruthy()
    expect(harness.longFence.getAttribute(CODE_LANGBAR_ATTR)).toBe('true')
  })

  it('renders badge, real language, line count, copy and fold buttons', () => {
    harness = createHarness()
    const bar = harness.barFor('long')!
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__badge`)?.textContent).toBe('JS')
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lang`)?.textContent).toBe('JavaScript')
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lines`)?.textContent).toBe('20 行')
    expect(harness.copyBtnFor('long')?.getAttribute('title')).toBe('复制代码')
    expect(harness.foldBtnFor('long')?.style.display).not.toBe('none')
    expect(harness.barFor('short')!.querySelector(`.${CONTENT_TOOLBAR_CLASS}__badge`)?.textContent).toBe('PY')
  })

  it('never positions the bar with inline coordinates (native scroll coordinate system)', () => {
    harness = createHarness()
    const bar = harness.barFor('long')!
    expect(bar.style.left).toBe('')
    expect(bar.style.top).toBe('')
    expect(bar.style.width).toBe('')
  })

  it('hides the fold button for short code', () => {
    harness = createHarness()
    expect(harness.foldBtnFor('short')!.style.display).toBe('none')
  })

  it('emits a show audit once, without any reposition chasing', () => {
    harness = createHarness()
    const show = harness.audits.filter((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-SHOW')
    expect(show).toHaveLength(2)
    expect(show[0].payload).toMatchObject({
      mode: 'langbar-in-fence',
      blockKey: 'code:cid:long',
      captionLabel: '代码 1-1',
      foldable: true,
      buttonCount: 2,
    })
    stubRect(harness.longFence, 40, 100, 400, 420)
    harness.controller.syncGeometry()
    expect(harness.audits.filter((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-REPOSITION')).toHaveLength(0)
  })

  it('re-attaches the bar if the fence loses it on re-render', () => {
    harness = createHarness()
    const bar = harness.barFor('long')!
    bar.remove()
    harness.controller.syncGeometry()
    expect(harness.longFence.querySelector(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toBeTruthy()
  })

  it('dispose removes bars from fences and the image toolbar from the overlay', () => {
    harness = createHarness()
    harness.controller.dispose()
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toHaveLength(0)
    expect(harness.overlay.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}`)).toHaveLength(0)
    harness = null
  })
})

describe('V3 preview folding (top-bar control)', () => {
  it('folds to exactly the first 10 lines without touching the CodeMirror DOM', () => {
    harness = createHarness()
    const before = harness.longFence.querySelector('.CodeMirror')!.innerHTML
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    expect(harness.longFence.getAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe('10')
    expect(harness.longFence.getAttribute(CODE_FOLD_SUMMARY_ATTR)).toBe('已折叠 · 10 行')
    // 20px/行 × 10 行 = 200px，来自真实行元素而非固定留白。
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).toBe('200px')
    expect(harness.longFence.querySelector('.CodeMirror')!.innerHTML).toBe(before)
    expect(harness.onLayoutInvalidated).toHaveBeenCalledWith('content-block-fold')
    expect(harness.foldBtnFor('long')!.getAttribute('title')).toBe('展开全部代码')
  })

  it('emits the staged fold audits (dispatch → transition → dom commit → visual verify)', () => {
    harness = createHarness()
    harness.stubBarRect('long', 100, 100, 400)
    harness.foldBtnFor('long')!.click()
    vi.advanceTimersByTime(20)
    const events = harness.audits.map((a) => a.event)
    expect(events).toContain('FOLD-CLICK-DISPATCH')
    expect(events).toContain('FOLD-STATE-TRANSITION')
    expect(events).toContain('FOLD-DOM-COMMIT')
    expect(events).toContain('FOLD-VISUAL-VERIFY')
    const transition = harness.audits.find((a) => a.event === 'FOLD-STATE-TRANSITION')
    expect(transition?.payload).toMatchObject({ from: 'expanded', to: 'folded', decision: 'PASS' })
    const commit = harness.audits.find((a) => a.event === 'FOLD-DOM-COMMIT')
    expect(commit?.payload).toMatchObject({ folded: true, previewLines: 10, previewHeight: 200 })
  })

  it('switches to 5 preview lines and halves the preview height', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    harness.setPreviewLines(5)
    harness.controller.syncGeometry()
    expect(harness.longFence.getAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe('5')
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).toBe('100px')
    expect(harness.foldBtnFor('long')!.getAttribute('title')).toBe('展开全部代码')
  })

  it('expands back through the same top-bar button and restores natural height', () => {
    harness = createHarness()
    const btn = () => harness!.foldBtnFor('long')!
    btn().click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    btn().click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    expect(harness.longFence.hasAttribute(CODE_FOLD_PREVIEW_ATTR)).toBe(false)
    expect(harness.longFence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)).toBe('')
    expect(btn().getAttribute('title')).toBe('收起至前 10 行')
    expect(harness.onLayoutInvalidated).toHaveBeenLastCalledWith('content-block-unfold')
    const last = harness.audits.filter((a) => a.event === 'FOLD-STATE-TRANSITION').pop()
    expect(last?.payload).toMatchObject({ from: 'folded', to: 'expanded', decision: 'PASS' })
  })

  it('allows folding while the caret is on a visible line (no intermittent refusal)', () => {
    harness = createHarness()
    const line = harness.longFence.querySelector('.CodeMirror-line') as HTMLElement
    line.tabIndex = 0
    line.focus()
    placeCaret(line)
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const transition = harness.audits.filter((a) => a.event === 'FOLD-STATE-TRANSITION').pop()
    expect(transition?.payload).toMatchObject({ from: 'expanded', to: 'folded', decision: 'PASS' })
  })

  it('refuses only when folding would hide the caret line', () => {
    harness = createHarness()
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const hiddenLine = lines[14]
    hiddenLine.tabIndex = 0
    hiddenLine.focus()
    placeCaret(hiddenLine)
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    const blocked = harness.audits.find(
      (a) => a.event === 'FOLD-STATE-TRANSITION' && a.payload.decision === 'BLOCKED',
    )
    expect(blocked?.payload).toMatchObject({
      reason: 'CARET_IN_HIDDEN_PREVIEW',
      caret: { caretLine: 14, hiddenByPreview: true },
    })
  })

  it('folds after clamping a CodeMirror caret that would be hidden (trailing blank lines)', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const setCursor = vi.fn()
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      getCursor: () => ({ line: 16, ch: 2 }),
      getLine: () => 'const v9 = 9',
      setCursor,
    }
    const textarea = document.createElement('textarea')
    cmEl.appendChild(textarea)
    textarea.focus()
    window.getSelection()?.removeAllRanges()
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    expect(setCursor).toHaveBeenCalledWith({ line: 9, ch: 2 })
    const clamped = harness.audits.find((a) => a.event === 'FOLD-CARET-CLAMPED')
    expect(clamped?.payload).toMatchObject({
      previewLines: 10, fromLine: 16, toLine: 9, moved: true, source: 'cm',
    })
    const transition = harness.audits.filter((a) => a.event === 'FOLD-STATE-TRANSITION').pop()
    expect(transition?.payload).toMatchObject({ from: 'expanded', to: 'folded', decision: 'PASS' })
  })

  it('keeps a folded block when focus returns with a visible caret (window re-activation)', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const visibleLine = lines[3]
    visibleLine.tabIndex = 0
    placeCaret(visibleLine)
    visibleLine.focus()
    harness.controller.syncGeometry()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    expect(harness.audits.some((a) => a.event === 'FOLD-FOCUS-KEPT')).toBe(true)
  })

  it('auto-expands when focus returns with a hidden caret', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const hiddenLine = lines[14]
    hiddenLine.tabIndex = 0
    placeCaret(hiddenLine)
    hiddenLine.focus()
    harness.controller.syncGeometry()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
  })

  it('shows a compact per-block diagnostic count only when diagnostics exist', () => {
    harness = createHarness()
    harness.setBlockDiagnostics((ordinal) => (
      ordinal === 0 ? { error: 0, warning: 2, hint: 1 } : null
    ))
    harness.controller.syncGeometry()
    const longDiag = harness.diagFor('long')!
    expect(longDiag).toBeTruthy()
    expect(longDiag.textContent).toBe('3')
    expect(longDiag.style.display).not.toBe('none')
    expect(longDiag.classList.contains('is-warning')).toBe(true)
    expect(longDiag.getAttribute('title')).toContain('3 个问题')
    // 无诊断的块不显示徽标（不占位、不挤掉语言/行数）。
    expect(harness.diagFor('short')!.style.display).toBe('none')
    // 快照变化后 refresh 即可更新，无需重新布局。
    harness.setBlockDiagnostics((ordinal) => (
      ordinal === 0 ? { error: 1, warning: 0, hint: 0 } : null
    ))
    harness.controller.refreshDiagnosticBadges()
    expect(longDiag.textContent).toBe('1')
    expect(longDiag.classList.contains('is-error')).toBe(true)
    // 诊断消失 → 隐藏。
    harness.setBlockDiagnostics(() => null)
    harness.controller.refreshDiagnosticBadges()
    expect(longDiag.style.display).toBe('none')
  })

  it('applies read-only line classes and text marks, then clears them', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const addLineClass = vi.fn()
    const removeLineClass = vi.fn()
    const clear = vi.fn()
    const markText = vi.fn(() => ({ clear }))
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      addLineClass,
      removeLineClass,
      markText,
    }
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB002', severity: 'warning', startLine: 18, startColumn: 1, endLine: 20, endColumn: 1, blank: true },
      { ruleId: 'CB101', severity: 'warning', startLine: 2, startColumn: 5, endLine: 2, endColumn: 6, blank: false },
    ] : []))
    harness.controller.syncGeometry()
    expect(addLineClass).toHaveBeenCalledTimes(3)
    expect(markText).toHaveBeenCalledWith(
      { line: 1, ch: 4 },
      { line: 1, ch: 5 },
      { className: 'inkchapter-code-diag-range' },
    )
    // 相同签名不重复写入（避免 DOM 抖动）。
    harness.controller.refreshDiagnosticMarks()
    expect(addLineClass).toHaveBeenCalledTimes(3)
    expect(markText).toHaveBeenCalledTimes(1)
    // 诊断消失 → 精确移除行类并清空文本标记。
    harness.setBlockDiagnosticMarks(() => [])
    harness.controller.refreshDiagnosticMarks()
    expect(removeLineClass).toHaveBeenCalledTimes(3)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('expands a folded block before diagnostic locate (never toggles)', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    expect(harness.controller.expandFoldedBlockForLocate(harness.longFence)).toBe(true)
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    const last = harness.audits.filter((a) => a.event === 'FOLD-STATE-TRANSITION').pop()
    expect(last?.payload).toMatchObject({
      from: 'folded', to: 'expanded', decision: 'PASS', reason: 'UNFOLDED:DIAGNOSTIC_LOCATE',
    })
    // 已展开时再次定位请求不得反向折叠。
    expect(harness.controller.expandFoldedBlockForLocate(harness.longFence)).toBe(false)
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    // 非目标元素不产生任何状态变化。
    expect(harness.controller.expandFoldedBlockForLocate(harness.shortFence)).toBe(false)
  })

  it('allows folding when the caret line cannot be resolved (no range / no CM)', () => {
    harness = createHarness()
    const line = harness.longFence.querySelector('.CodeMirror-line') as HTMLElement
    line.tabIndex = 0
    line.focus()
    window.getSelection()?.removeAllRanges()
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const dispatch = harness.audits.find((a) => a.event === 'FOLD-CLICK-DISPATCH')
    expect(dispatch?.payload.caret).toMatchObject({ caretSource: 'none', hiddenByPreview: null })
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
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--langbar`)).toHaveLength(0)
  })
})

describe('V3 scroll synchronisation', () => {
  it('reports zero relative drift while the fence and bar scroll together', () => {
    harness = createHarness()
    harness.stubBarRect('long', 100, 100, 400)
    harness.stubBarRect('short', 100, 560, 400)
    harness.controller.onEditorScroll()
    vi.advanceTimersByTime(20)
    const first = harness.audits.filter((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-SCROLL-SYNC').pop()
    expect(first?.payload).toMatchObject({ blocks: 2, maxDriftPx: 0 })

    // 模拟滚动：代码块与语言栏同步上移 260px（共享滚动坐标系）。
    stubRect(harness.longFence, 100, -160, 400, 420)
    stubRect(harness.shortFence, 100, 300, 400, 90)
    harness.stubBarRect('long', 100, -160, 400)
    harness.stubBarRect('short', 100, 300, 400)
    harness.controller.onEditorScroll()
    vi.advanceTimersByTime(20)
    const second = harness.audits.filter((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-SCROLL-SYNC').pop()
    expect(second?.payload).toMatchObject({ blocks: 2, maxDriftPx: 0 })
    expect(harness.audits.filter((a) => a.event === 'CONTENT-BLOCK-TOOLBAR-REPOSITION')).toHaveLength(0)
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
