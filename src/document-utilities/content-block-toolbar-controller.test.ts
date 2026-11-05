// @vitest-environment jsdom
/**
 * 内容块工具栏 V3 稳定性修复 — 语言栏（PRE 内部）/ 顶部折叠按钮 / 精确预览高度。
 * 只使用 jsdom + 既有 overlay 根，不启动 Typora。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CODE_FOLD_ATTR,
  CODE_FOLD_CONTROL_ATTR,
  CODE_FOLD_DIAG_ATTR,
  CODE_FOLD_HEIGHT_VAR,
  CODE_FOLD_PREVIEW_ATTR,
  CODE_FOLD_SUMMARY_ATTR,
  CODE_LANGBAR_ATTR,
  CONTENT_TOOLBAR_CLASS,
  IMAGE_ANCHOR_CLASS,
  IMAGE_BAR_VISIBLE_ATTR,
  IMAGE_SELECTED_CLASS,
  ContentBlockToolbarController,
  imageCopyFailureText,
  type CodeDiagnosticMark,
} from './content-block-toolbar-controller'
import { ContentBlockToolbarSession } from './content-block-toolbar-session'
import { codeContentSignature } from './content-block-toolbar-code-source'

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
  bottomBtnFor: (cid: string) => HTMLButtonElement | null
  copyText: ReturnType<typeof vi.fn>
  copyImage: ReturnType<typeof vi.fn>
  onLayoutInvalidated: ReturnType<typeof vi.fn>
  audits: Array<{ event: string; payload: Record<string, unknown> }>
  setPreviewLines: (n: 5 | 10) => void
  setAutoExpandOnEdit: (value: boolean) => void
  setBlockDiagnosticMarks: (fn: ((ordinal: number) => CodeDiagnosticMark[]) | null) => void
  stubBarRect: (cid: string, left: number, top: number, width: number) => void
}

function createHarness(overrides: {
  source?: (cid: string) => string | null
  documentDir?: string | null
  imageAssetActions?: import('./content-block-toolbar-controller').ContentBlockToolbarImageAssetActions
} = {}): Harness {
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
  let autoExpandOnEdit = true
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
    getAutoExpandOnEdit: () => autoExpandOnEdit,
    getDocumentDir: () => overrides.documentDir ?? null,
    imageAssetActions: overrides.imageAssetActions,
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
    bottomBtnFor: (cid) => (cid === 'long' ? longFence : shortFence)
      .querySelector<HTMLButtonElement>('[data-action="toggle-fold-bottom"]'),
    copyText,
    copyImage,
    onLayoutInvalidated,
    audits,
    setPreviewLines: (n) => { previewLines = n },
    setAutoExpandOnEdit: (value) => { autoExpandOnEdit = value },
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

function pointerDown(x = 120, y = 150): MouseEvent {
  return new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  })
}

let harness: Harness | null = null

beforeEach(() => {
  vi.useFakeTimers()
  window.getSelection()?.removeAllRanges()
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

  it('keeps folding when focus returns with a hidden caret (no text change)', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const hiddenLine = lines[14]
    hiddenLine.tabIndex = 0
    placeCaret(hiddenLine)
    hiddenLine.focus()
    harness.controller.syncGeometry()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
  })

  it('never renders a diagnostic count badge in the language bar (removed)', () => {
    harness = createHarness()
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB002', severity: 'warning', startLine: 18, startColumn: 1, endLine: 20, endColumn: 1, blank: true },
    ] : []))
    harness.controller.syncGeometry()
    const bar = harness.barFor('long')!
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__diag`)).toBeNull()
    // 语言栏保留：语言图标 / 语言 / 行数 / 复制 / 折叠。
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__badge`)).toBeTruthy()
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lang`)).toBeTruthy()
    expect(bar.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lines`)).toBeTruthy()
    expect(harness.copyBtnFor('long')).toBeTruthy()
    expect(harness.foldBtnFor('long')).toBeTruthy()
  })

  it('applies gutter marks and text marks, and removes line classes by base handle', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const addedHandles: unknown[] = []
    const addLineClass = vi.fn(() => {
      const handle = { lineHandle: addedHandles.length }
      addedHandles.push(handle)
      return handle
    })
    const removedBy: unknown[] = []
    const removeLineClass = vi.fn((lineOrHandle: unknown) => { removedBy.push(lineOrHandle) })
    const clear = vi.fn()
    const markText = vi.fn(() => ({ clear }))
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
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
    // 空行标记只落在行号侧（gutter），不铺满代码行。
    expect(addLineClass).toHaveBeenCalledWith(17, 'gutter', 'inkchapter-code-diag-blank')
    expect(markText).toHaveBeenCalledWith(
      { line: 1, ch: 4 },
      { line: 1, ch: 5 },
      { className: 'inkchapter-code-diag-range' },
    )
    // 相同签名不重复写入（避免 DOM 抖动）。
    harness.controller.refreshDiagnosticMarks()
    expect(addLineClass).toHaveBeenCalledTimes(3)
    expect(markText).toHaveBeenCalledTimes(1)
    // 诊断消失 → 用 addLineClass 返回的句柄精确移除（索引漂移也不会残留）。
    harness.setBlockDiagnosticMarks(() => [])
    harness.controller.refreshDiagnosticMarks()
    expect(removeLineClass).toHaveBeenCalledTimes(3)
    expect(removedBy).toEqual(addedHandles)
    expect(removedBy.every(v => typeof v === 'object')).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('skips marks produced from a different code content version', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const addLineClass = vi.fn(() => ({ handle: true }))
    const markText = vi.fn(() => ({ clear: vi.fn() }))
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass,
      removeLineClass: vi.fn(),
      markText,
    }
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      {
        ruleId: 'CB002', severity: 'warning', startLine: 18, startColumn: 1, endLine: 20, endColumn: 1, blank: true,
        contentSignature: codeContentSignature('stale code'),
      },
    ] : []))
    harness.controller.syncGeometry()
    // 旧内容版本的诊断绝不落到当前内容上。
    expect(addLineClass).not.toHaveBeenCalled()
    // 内容版本一致时正常绘制。
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      {
        ruleId: 'CB002', severity: 'warning', startLine: 18, startColumn: 1, endLine: 20, endColumn: 1, blank: true,
        contentSignature: codeContentSignature(LONG_CODE),
      },
    ] : []))
    harness.controller.refreshDiagnosticMarks()
    expect(addLineClass).toHaveBeenCalledTimes(3)
  })

  it('clears marks immediately when the CodeMirror content changes', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const removeLineClass = vi.fn()
    const handlers: Array<() => void> = []
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass,
      markText: vi.fn(() => ({ clear: vi.fn() })),
      on: (_event: string, handler: () => void) => { handlers.push(handler) },
      off: vi.fn(),
    }
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB002', severity: 'warning', startLine: 18, startColumn: 1, endLine: 20, endColumn: 1, blank: true },
    ] : []))
    harness.controller.syncGeometry()
    expect(handlers).toHaveLength(1)
    handlers[0]()
    // 内容变化 → 旧标记立即撤销，不等待下一次诊断快照。
    expect(removeLineClass).toHaveBeenCalledTimes(3)
  })

  it('keeps a lightweight folded hint when diagnostics stay below the preview', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass: vi.fn(),
      markText: vi.fn(() => ({ clear: vi.fn() })),
    }
    // 预览 10 行；诊断位于第 15–16 行（折叠后不可见）。
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB002', severity: 'warning', startLine: 15, startColumn: 1, endLine: 16, endColumn: 1, blank: true },
    ] : []))
    harness.controller.refreshDiagnosticMarks()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    expect(harness.longFence.getAttribute(CODE_FOLD_DIAG_ATTR)).toBe('true')

    // 诊断全部回到预览区（1–3 行）→ 提示色带撤销。
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB001', severity: 'warning', startLine: 2, startColumn: 1, endLine: 3, endColumn: 1, blank: true },
    ] : []))
    harness.controller.refreshDiagnosticMarks()
    expect(harness.longFence.getAttribute(CODE_FOLD_DIAG_ATTR)).toBeNull()

    // 展开 → 即使仍有预览外诊断，也不显示折叠提示。
    harness.setBlockDiagnosticMarks((ordinal) => (ordinal === 0 ? [
      { ruleId: 'CB002', severity: 'warning', startLine: 15, startColumn: 1, endLine: 16, endColumn: 1, blank: true },
    ] : []))
    harness.controller.refreshDiagnosticMarks()
    expect(harness.longFence.getAttribute(CODE_FOLD_DIAG_ATTR)).toBe('true')
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBeNull()
    expect(harness.longFence.getAttribute(CODE_FOLD_DIAG_ATTR)).toBeNull()
  })

  it('re-registers the change listener when the CodeMirror instance is rebuilt', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const on1 = vi.fn()
    const off1 = vi.fn()
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass: vi.fn(),
      markText: vi.fn(() => ({ clear: vi.fn() })),
      on: on1,
      off: off1,
    }
    harness.controller.syncGeometry()
    expect(on1).toHaveBeenCalledTimes(1)

    // Typora 重建 CodeMirror 实例：新实例必须重新注册监听。
    const on2 = vi.fn()
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass: vi.fn(),
      markText: vi.fn(() => ({ clear: vi.fn() })),
      on: on2,
      off: vi.fn(),
    }
    harness.controller.syncGeometry()
    expect(on2).toHaveBeenCalledTimes(1)
    expect(off1).toHaveBeenCalledTimes(1)
  })

  it('accepts keyboard activation after a mouse click (fresh action id)', () => {
    harness = createHarness()
    const btn = harness.foldBtnFor('long')!
    btn.dispatchEvent(new Event('pointerdown'))
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    // Keyboard / AT activation: click with detail 0, no pointerdown.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
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

  it('never expands on pointer clicks alone (text / gutter / background)', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')

    // 纯点击可见代码文字：保持折叠（只有文本修改才展开）。
    lines[2].querySelector('span')!.dispatchEvent(pointerDown())
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)

    // 行号区。
    const gutter = document.createElement('div')
    gutter.className = 'CodeMirror-gutter-wrapper'
    gutter.innerHTML = '<div class="CodeMirror-linenumber">1</div>'
    lines[0].appendChild(gutter)
    gutter.dispatchEvent(pointerDown())
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)

    // 行容器空白背景。
    lines[0].dispatchEvent(pointerDown())
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)

    // 工具栏。
    harness.barFor('long')!.querySelector(`.${CONTENT_TOOLBAR_CLASS}__lines`)!
      .dispatchEvent(pointerDown())
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)

    // 从未产生任何自动展开决策。
    expect(harness.audits.some(a => a.event === 'FOLD-AUTO-EXPAND-DECISION')).toBe(false)
  })

  it('expands when the code text changes while folded', () => {
    harness = createHarness()
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const handlers: Array<() => void> = []
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass: vi.fn(),
      markText: vi.fn(() => ({ clear: vi.fn() })),
      on: (_event: string, handler: () => void) => { handlers.push(handler) },
      off: vi.fn(),
    }
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    expect(handlers).toHaveLength(1)

    // 文本修改（插入 / 删除 / 空格 / Tab 都会触发 CM change）。
    handlers[0]()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    const decision = harness.audits.filter(a => a.event === 'FOLD-AUTO-EXPAND-DECISION').pop()
    expect(decision?.payload).toMatchObject({
      source: 'CODE_TEXT_CHANGED',
      setting: true,
      decision: 'EXPAND',
    })
  })

  it('keeps folding on text change when auto-expand-on-edit is disabled', () => {
    harness = createHarness()
    harness.setAutoExpandOnEdit(false)
    const cmEl = harness.longFence.querySelector('.CodeMirror') as HTMLElement
    const handlers: Array<() => void> = []
    ;(cmEl as unknown as { CodeMirror: unknown }).CodeMirror = {
      lineCount: () => 20,
      getLine: () => 'const x = 1',
      getValue: () => LONG_CODE,
      addLineClass: vi.fn(() => ({ handle: true })),
      removeLineClass: vi.fn(),
      markText: vi.fn(() => ({ clear: vi.fn() })),
      on: (_event: string, handler: () => void) => { handlers.push(handler) },
      off: vi.fn(),
    }
    harness.controller.syncGeometry()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    handlers[0]()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const decision = harness.audits.filter(a => a.event === 'FOLD-AUTO-EXPAND-DECISION').pop()
    expect(decision?.payload).toMatchObject({
      source: 'CODE_TEXT_CHANGED',
      setting: false,
      decision: 'KEEP_FOLDED',
    })
  })

  it('does not auto-expand a folded block on plain focus without a hidden caret', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    const line = harness.longFence.querySelector('.CodeMirror-line') as HTMLElement
    line.tabIndex = 0
    line.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
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

  it('keeps folding when focus lands on a hidden caret line (no text change)', () => {
    harness = createHarness()
    harness.foldBtnFor('long')!.click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    const lines = harness.longFence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const hiddenText = lines[15].querySelector('span')!.firstChild as Text
    const range = document.createRange()
    range.setStart(hiddenText, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    lines[15].tabIndex = 0
    lines[15].focus()
    // 纯光标定位/选中不展开。
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(true)
    expect(harness.controller.getFoldKeys()).toHaveLength(1)
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

describe('V3 bottom fold control (mirrors the top bar)', () => {
  it('renders the bottom chevron only for foldable code', () => {
    harness = createHarness()
    const long = harness.bottomBtnFor('long')!
    const short = harness.bottomBtnFor('short')!
    expect(long.style.display).toBe('')
    expect(short.style.display).toBe('none')
    expect(long.closest('pre.md-fences')).toBe(harness.longFence)
    expect(harness.longFence.getAttribute(CODE_FOLD_CONTROL_ATTR)).toBe('true')
    expect(harness.shortFence.hasAttribute(CODE_FOLD_CONTROL_ATTR)).toBe(false)
  })

  it('folds and unfolds through the bottom chevron and keeps both entries in sync', () => {
    harness = createHarness()
    const bottom = () => harness!.bottomBtnFor('long')!
    const top = () => harness!.foldBtnFor('long')!
    bottom().click()
    expect(harness.longFence.getAttribute(CODE_FOLD_ATTR)).toBe('true')
    for (const btn of [top(), bottom()]) {
      expect(btn.getAttribute('title')).toBe('展开全部代码')
      expect(btn.getAttribute('aria-expanded')).toBe('false')
    }
    bottom().click()
    expect(harness.longFence.hasAttribute(CODE_FOLD_ATTR)).toBe(false)
    for (const btn of [top(), bottom()]) {
      expect(btn.getAttribute('title')).toBe('收起至前 10 行')
      expect(btn.getAttribute('aria-expanded')).toBe('true')
    }
  })

  it('keeps one state when alternating top and bottom entries (20 clicks)', () => {
    harness = createHarness()
    const states: boolean[] = []
    for (let i = 0; i < 20; i++) {
      const btn = i % 2 === 0 ? harness.bottomBtnFor('long')! : harness.foldBtnFor('long')!
      btn.click()
      states.push(harness.longFence.hasAttribute(CODE_FOLD_ATTR))
    }
    expect(states).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0))
    const passes = harness.audits.filter(
      (a) => a.event === 'FOLD-STATE-TRANSITION' && a.payload.decision === 'PASS',
    )
    expect(passes).toHaveLength(20)
    const ids = passes.map((a) => String(a.payload.actionId))
    expect(new Set(ids).size).toBe(20)
    expect(ids.filter((id) => id.startsWith('fold-kb-bottom-'))).toHaveLength(10)
    expect(ids.filter((id) => id.startsWith('fold-kb-') && !id.startsWith('fold-kb-bottom-'))).toHaveLength(10)
  })

  it('never auto-expands when the bottom chevron is clicked (no text change)', () => {
    harness = createHarness()
    harness.bottomBtnFor('long')!.click()
    harness.bottomBtnFor('long')!.click()
    expect(harness.audits.some((a) => a.event === 'FOLD-AUTO-EXPAND-DECISION')).toBe(false)
  })

  it('hides the bottom chevron when the code is no longer foldable', () => {
    harness = createHarness({ source: () => 'const a = 1' })
    expect(harness.bottomBtnFor('long')!.style.display).toBe('none')
    expect(harness.longFence.hasAttribute(CODE_FOLD_CONTROL_ATTR)).toBe(false)
  })

  it('emits one geometry audit describing the bottom control', () => {
    harness = createHarness()
    const audit = harness.audits.find((a) => a.event === 'FOLD-BOTTOM-CONTROL')
    expect(audit?.payload).toMatchObject({
      blockKey: 'code:cid:long',
      foldable: true,
      visible: true,
      nextTag: 'pre',
      bottomButtonCount: 1,
    })
    expect(audit?.payload).toHaveProperty('buttonRect')
    expect(audit?.payload).toHaveProperty('iconRect')
    expect(audit?.payload).toHaveProperty('overlapNextPx')
    const shortAudit = harness.audits.find(
      (a) => a.event === 'FOLD-BOTTOM-CONTROL' && a.payload.blockKey === 'code:cid:short',
    )
    expect(shortAudit?.payload).toMatchObject({ foldable: false, visible: false })
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

describe('V3 image toolbar (container-bound)', () => {
  const imageBar = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}--image`)
  const hover = (img: HTMLElement): void => {
    img.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  }
  const leave = (img: HTMLElement, relatedTarget: EventTarget | null = null): void => {
    img.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget }))
  }

  it('binds the bar to the plugin overlay root, never inside the editable image block', () => {
    harness = createHarness()
    hover(harness.img)
    const bar = imageBar()!
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    expect(bar.parentElement).toBe(harness.overlay)
    expect(harness.overlay.contains(bar)).toBe(true)
    expect(wrapper.contains(bar)).toBe(false)
    expect(wrapper.classList.contains(IMAGE_ANCHOR_CLASS)).toBe(true)
    expect(bar.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
    expect(bar.querySelector('[data-action="copy-image"]')).toBeTruthy()
    expect(bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.hidden).toBe(false)
  })

  it('keeps toolbar/menu text out of editable document content', () => {
    harness = createHarness()
    hover(harness.img)
    const bar = imageBar()!
    bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.click()
    expect(harness.overlay.textContent).toContain('复制本地路径')
    expect(harness.write.textContent).not.toContain('复制本地路径')
    expect(harness.write.textContent).not.toContain('复制 Markdown 引用')
    expect(harness.write.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--image`)).toHaveLength(0)
    expect(harness.write.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}__menu`)).toHaveLength(0)
  })

  it('rebinds to a rebuilt image node without duplicating the bar', () => {
    harness = createHarness()
    hover(harness.img)
    const oldWrapper = harness.img.closest<HTMLElement>('.md-image')!
    const parent = oldWrapper.parentElement!
    const replacement = oldWrapper.cloneNode(true) as HTMLElement
    parent.replaceChild(replacement, oldWrapper)
    const newImg = replacement.querySelector('img') as HTMLImageElement
    stubRect(newImg, 200, 700, 200, 150)
    hover(newImg)
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--image`)).toHaveLength(1)
    expect(imageBar()!.parentElement).toBe(harness.overlay)
    expect(harness.write.textContent).not.toContain('复制本地路径')
  })

  it('positions the bar against the real image edge, not the block width', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    // 内容块宽 400，居中图片宽 200（图片右侧留白 100）。
    stubRect(harness.write, 100, 0, 400, 800)
    stubRect(wrapper, 100, 700, 400, 150)
    stubRect(harness.img, 200, 700, 200, 150)
    hover(harness.img)
    const bar = imageBar()!
    expect(bar.getAttribute('data-placement')).toBe('right')
    // 图片右边 (x=400) + 7px → overlay 根的视口坐标 407。
    expect(bar.style.left).toBe('407px')
    expect(bar.style.top).toBe('700px')
    expect(bar.style.right).toBe('')
    // 定位不得改变图片尺寸/居中布局。
    expect(harness.img.style.width).toBe('')
    expect(wrapper.style.width).toBe('')
  })

  it('flips to the left when the right side has no room', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    stubRect(harness.write, 100, 0, 400, 800)
    stubRect(wrapper, 100, 700, 400, 150)
    stubRect(harness.img, 400, 700, 100, 150)
    hover(harness.img)
    const bar = imageBar()!
    expect(bar.getAttribute('data-placement')).toBe('left')
    // 图片左边 400 - 7 - 64 = 329（视口坐标）。
    expect(bar.style.left).toBe('329px')
    expect(bar.style.top).toBe('700px')
  })

  it('falls back to the image inner corner when both sides are tight', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    stubRect(harness.write, 100, 0, 400, 800)
    stubRect(wrapper, 100, 700, 400, 150)
    stubRect(harness.img, 100, 700, 400, 150)
    hover(harness.img)
    const bar = imageBar()!
    expect(bar.getAttribute('data-placement')).toBe('inside')
    expect(bar.style.left).toBe('430px')
    expect(bar.style.top).toBe('706px')
  })

  it('keeps an inline image aligned to its own top edge', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    stubRect(harness.write, 100, 0, 400, 800)
    stubRect(wrapper, 100, 700, 400, 40)
    stubRect(harness.img, 120, 708, 100, 24)
    hover(harness.img)
    const bar = imageBar()!
    expect(bar.getAttribute('data-placement')).toBe('right')
    expect(bar.style.left).toBe('227px')
    expect(bar.style.top).toBe('708px')
  })

  it('repositions on geometry changes and does not drift on scroll', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    stubRect(harness.write, 100, 0, 400, 800)
    stubRect(wrapper, 100, 700, 400, 150)
    stubRect(harness.img, 300, 700, 150, 150)
    hover(harness.img)
    const bar = imageBar()!
    expect(bar.getAttribute('data-placement')).toBe('left')
    expect(bar.style.left).toBe('229px')
    expect(bar.style.top).toBe('700px')

    // 侧栏收起 / 窗口变宽：编辑区变宽后回到右侧。
    stubRect(harness.write, 100, 0, 800, 800)
    harness.controller.syncGeometry()
    expect(bar.getAttribute('data-placement')).toBe('right')
    expect(bar.style.left).toBe('457px')

    // 滚动时由单帧 rAF 重定位；未选中时按既有行为隐藏，不重复挂载。
    harness.write.dispatchEvent(new Event('scroll'))
    expect(bar.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
    expect(bar.style.left).toBe('457px')
    expect(bar.style.top).toBe('700px')
  })

  it('reuses one bar across repeated hovers', () => {
    harness = createHarness()
    hover(harness.img)
    hover(harness.img)
    hover(harness.img)
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--image`)).toHaveLength(1)
  })

  it('uses a copy icon and 28px image buttons in the stylesheet', () => {
    harness = createHarness()
    hover(harness.img)
    const btn = imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    expect(btn.querySelectorAll('rect').length).toBeGreaterThan(0)
    expect(btn.getAttribute('title')).toBe('复制图片')
  })

  it('hides after the pointer leaves the image', () => {
    harness = createHarness()
    hover(harness.img)
    leave(harness.img)
    vi.advanceTimersByTime(220)
    expect(imageBar()).toBeNull()
  })

  it('stays visible when the pointer moves onto the action bar', () => {
    harness = createHarness()
    hover(harness.img)
    const btn = imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    leave(harness.img, btn)
    vi.advanceTimersByTime(220)
    expect(imageBar()!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
  })

  it('hides after leaving the overlay action bar', () => {
    harness = createHarness()
    hover(harness.img)
    imageBar()!.dispatchEvent(new MouseEvent('pointerleave'))
    vi.advanceTimersByTime(220)
    expect(imageBar()).toBeNull()
  })

  it('keeps the bar visible when the pointer crosses the gap into the panel', () => {
    harness = createHarness()
    hover(harness.img)
    const btn = imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    // 图片与浮层操作条之间隔着 7px 空隙：离开图片时先启动了隐藏计时，
    // 随后进入操作条必须在计时到点前取消。
    leave(harness.img)
    btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(220)
    expect(imageBar()).not.toBeNull()
    expect(imageBar()!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
  })

  it('keeps the bar visible when the pointer returns from the panel to the image', () => {
    harness = createHarness()
    hover(harness.img)
    imageBar()!.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: harness.img }))
    vi.advanceTimersByTime(220)
    expect(imageBar()).not.toBeNull()
    expect(imageBar()!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
  })

  it('hides once the pointer moves from the image onto adjacent text', () => {
    harness = createHarness()
    hover(harness.img)
    leave(harness.img, harness.write)
    harness.write.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(220)
    expect(imageBar()).toBeNull()
  })

  it('keeps the panel clickable after the pointer crosses the gap', async () => {
    harness = createHarness()
    hover(harness.img)
    const btn = imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    leave(harness.img)
    btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(220)
    btn.click()
    await flushMicrotasks()
    expect(harness.copyImage).toHaveBeenCalledTimes(1)
    expect(harness.copyImage.mock.calls[0][0]).toBe(harness.img)
  })

  it('drops the bar when the bound image is removed', () => {
    harness = createHarness()
    hover(harness.img)
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    wrapper.remove()
    harness.controller.syncGeometry()
    expect(imageBar()).toBeNull()
    expect(harness.write.textContent).not.toContain('复制本地路径')
  })

  it('keeps the bar visible while the image is uploading', () => {
    harness = createHarness()
    hover(harness.img)
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    wrapper.classList.add('md-on-uploading')
    leave(harness.img)
    vi.advanceTimersByTime(220)
    expect(imageBar()).not.toBeNull()
    expect(imageBar()!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')

    wrapper.classList.remove('md-on-uploading')
    leave(harness.img)
    vi.advanceTimersByTime(220)
    expect(imageBar()).toBeNull()
  })

  it('keeps the bar visible when upload replaces the image node', () => {
    harness = createHarness()
    hover(harness.img)
    const oldWrapper = harness.img.closest<HTMLElement>('.md-image')!
    const parent = oldWrapper.parentElement!
    const replacement = oldWrapper.cloneNode(true) as HTMLElement
    const newImg = replacement.querySelector('img') as HTMLImageElement
    newImg.setAttribute('src', 'https://cdn.example.test/uploaded.png')
    replacement.setAttribute('data-src', 'https://cdn.example.test/uploaded.png')
    parent.replaceChild(replacement, oldWrapper)
    stubRect(newImg, 200, 700, 200, 150)

    // 上传完成后鼠标不一定再次移动：几何 pass 必须把操作条重绑到新节点。
    harness.controller.syncGeometry()

    const bar = imageBar()
    expect(bar).not.toBeNull()
    expect(bar!.parentElement).toBe(harness.overlay)
    expect(bar!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')
    expect(replacement.classList.contains(IMAGE_ANCHOR_CLASS)).toBe(true)
    expect(document.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}--image`)).toHaveLength(1)
    expect(harness.write.textContent).not.toContain('复制本地路径')
  })

  it('keeps the bar visible for a selected image until another click', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    harness.img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(wrapper.classList.contains(IMAGE_SELECTED_CLASS)).toBe(true)
    leave(harness.img)
    vi.advanceTimersByTime(220)
    expect(imageBar()!.getAttribute(IMAGE_BAR_VISIBLE_ATTR)).toBe('true')

    harness.write.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(wrapper.classList.contains(IMAGE_SELECTED_CLASS)).toBe(false)
    expect(imageBar()).toBeNull()
  })

  it('copies the real image element and shows a short success feedback', async () => {
    harness = createHarness()
    hover(harness.img)
    imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!.click()
    await flushMicrotasks()
    expect(harness.copyImage).toHaveBeenCalledTimes(1)
    expect(harness.copyImage.mock.calls[0][0]).toBe(harness.img)
    const feedback = imageBar()!.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}__feedback`)!
    expect(feedback.textContent).toBe('已复制图片')
    expect(feedback.classList.contains('is-success')).toBe(true)
  })

  it('reports a readable clipboard failure instead of silent fallback', async () => {
    harness = createHarness()
    harness.copyImage.mockResolvedValueOnce({ ok: false, verified: false, reason: 'CLIPBOARD_WRITE_FAILED' })
    hover(harness.img)
    imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!.click()
    await flushMicrotasks()
    const bar = imageBar()!
    expect(bar.querySelector<HTMLElement>(`.${CONTENT_TOOLBAR_CLASS}__feedback`)!.textContent)
      .toBe('复制失败：剪贴板写入失败')
    expect(bar.querySelector('[data-action="copy-image"]')!.classList.contains('is-error')).toBe(true)
  })

  it('disables copying when the image failed to load', async () => {
    harness = createHarness()
    Object.defineProperty(harness.img, 'complete', { configurable: true, value: true })
    Object.defineProperty(harness.img, 'naturalWidth', { configurable: true, value: 0 })
    Object.defineProperty(harness.img, 'naturalHeight', { configurable: true, value: 0 })
    hover(harness.img)
    const btn = imageBar()!.querySelector<HTMLButtonElement>('[data-action="copy-image"]')!
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('图片加载失败，无法复制原图')
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushMicrotasks()
    expect(harness.copyImage).not.toHaveBeenCalled()
  })

  it('offers only actions backed by real resources', () => {
    harness = createHarness({ documentDir: 'D:\\vault' })
    hover(harness.img)
    const bar = imageBar()!
    bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.click()
    const labels = Array.from(bar.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}__menu-item`))
      .map(el => el.textContent)
    expect(labels).toEqual(['复制本地路径', '复制 Markdown 引用'])
  })

  it('adds figure naming and download actions for remote images', async () => {
    const download = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const requestFigureName = vi.fn(() => true)
    harness = createHarness({
      imageAssetActions: {
        getFigureNameState: () => ({ named: false }),
        requestFigureName,
        downloadTargets: () => ['project', 'library', 'offline', 'custom'],
        download,
      },
    })
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    wrapper.setAttribute('data-src', 'https://cdn.example.test/a.png')
    harness.img.setAttribute('src', 'https://cdn.example.test/a.png')
    hover(harness.img)
    const bar = imageBar()!
    bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.click()
    const labels = Array.from(bar.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}__menu-item`))
      .map(el => el.textContent)
    expect(labels).toEqual(expect.arrayContaining([
      '设置图名…',
      '下载图片',
      '下载并替换为本地引用',
      '下载到全局图库',
      '下载到离线区',
      '选择目录下载…',
    ]))

    const button = Array.from(bar.querySelectorAll<HTMLButtonElement>(`.${CONTENT_TOOLBAR_CLASS}__menu-item`))
      .find(el => el.textContent === '下载图片')!
    button.click()
    await flushMicrotasks()
    expect(download).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.test/a.png',
      destination: 'project',
      replaceReference: false,
    }))
  })

  it('offers figure naming but no download for local-only images', () => {
    harness = createHarness({
      imageAssetActions: {
        getFigureNameState: () => ({ named: true }),
        requestFigureName: () => true,
        download: async () => ({ ok: true, message: 'ok' }),
      },
    })
    hover(harness.img)
    const bar = imageBar()!
    bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.click()
    const labels = Array.from(bar.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}__menu-item`))
      .map(el => el.textContent)
    expect(labels).toEqual(expect.arrayContaining(['编辑图名…', '清除图名']))
    expect(labels).not.toContain('下载图片')
  })

  it('shows a cloud-link action for remote images', () => {
    harness = createHarness()
    const wrapper = harness.img.closest<HTMLElement>('.md-image')!
    wrapper.setAttribute('data-src', 'https://cdn.example.test/a.png')
    harness.img.setAttribute('src', 'https://cdn.example.test/a.png')
    hover(harness.img)
    const bar = imageBar()!
    bar.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.click()
    const labels = Array.from(bar.querySelectorAll(`.${CONTENT_TOOLBAR_CLASS}__menu-item`))
      .map(el => el.textContent)
    expect(labels).toEqual(['复制云端链接', '复制 Markdown 引用'])
  })

  it('hides the more entry when no action is available', () => {
    harness = createHarness()
    harness.img.removeAttribute('src')
    harness.img.closest<HTMLElement>('.md-image')!.removeAttribute('data-src')
    hover(harness.img)
    expect(imageBar()!.querySelector<HTMLButtonElement>('[data-action="more-image-actions"]')!.hidden).toBe(true)
  })
})

describe('imageCopyFailureText', () => {
  it('translates stable failure codes and keeps unknown codes visible', () => {
    expect(imageCopyFailureText('CANVAS_TAINTED')).toBe('远程图片受跨域限制')
    expect(imageCopyFailureText('REMOTE_FETCH_FAILED')).toBe('远程图片下载失败')
    expect(imageCopyFailureText(null)).toBe('未知错误')
    expect(imageCopyFailureText('CUSTOM_CODE')).toBe('CUSTOM_CODE')
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
