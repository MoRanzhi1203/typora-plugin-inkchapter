/**
 * 内容块工具栏 — 悬停/聚焦浮层控制器。
 *
 * 约束（见 ARCHITECTURE-AUDIT.md）：
 * - 只挂到既有 Overlay 根（`[data-inkchapter-utility-root]`），绝不插入 `#write`；
 * - 定位复用宿主几何调度（宿主在每次 geometry pass / scroll 时调用本控制器）；
 * - 不新建 ResizeObserver / MutationObserver / 定时轮询；
 * - 折叠只做可视投影（class + data 属性），不改 CodeMirror 模型与 Markdown。
 */

import {
  CODE_BLOCK_SELECTOR,
  countCodeLines,
  foldSummary,
  isTargetRenderable,
  resolveContentBlockTarget,
  resolveContentBlockTargetFromElement,
  type ContentBlockTarget,
} from './content-block-toolbar-target'
import { codeFenceOrdinal, lookupFenceSource } from './content-block-toolbar-code-source'
import { ContentBlockToolbarSession } from './content-block-toolbar-session'

export const CONTENT_TOOLBAR_CLASS = 'inkchapter-content-toolbar'
export const CONTENT_TOOLBAR_ATTR = 'data-inkchapter-content-toolbar'
export const CODE_FOLD_CLASS = 'inkchapter-code-folded'
export const CODE_FOLD_ATTR = 'data-inkchapter-code-folded'
export const CODE_FOLD_SUMMARY_ATTR = 'data-inkchapter-fold-summary'

const HIDE_DELAY_MS = 180
const FEEDBACK_RESET_MS = 1600
const INSET_PX = 8
const SMALL_IMAGE_WIDTH = 140
const SMALL_IMAGE_HEIGHT = 64
const MAX_FOLD_ENTRIES = 200

type ButtonState = 'idle' | 'loading' | 'success' | 'error'
type ActionName = 'copy-code' | 'toggle-fold' | 'copy-image'

export interface ContentBlockToolbarCopyResult {
  ok: boolean
  verified?: boolean
  reason?: string | null
  note?: string | null
}

export interface ContentBlockToolbarActions {
  /** Typora CodeMirror 源文本；null 表示需要回退到 Markdown 解析。 */
  readCodeSource: (fence: HTMLElement) => string | null
  copyText: (text: string) => Promise<ContentBlockToolbarCopyResult>
  copyImage: (img: HTMLImageElement | null) => Promise<ContentBlockToolbarCopyResult>
}

export interface ContentBlockToolbarOptions {
  getEditorRoot: () => HTMLElement | null
  getMarkdown: () => string | null
  actions: ContentBlockToolbarActions
  /** 折叠导致布局变化 → 交由既有几何调度刷新。 */
  onLayoutInvalidated: (reason: string) => void
  emitAudit?: (event: string, payload: Record<string, unknown>) => void
}

const INK_ICONS: Record<string, string> = {
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>' +
    '<circle cx="8.5" cy="8.5" r="1.5"></circle>' +
    '<polyline points="21 15 16 10 5 21"></polyline>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"></polyline>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
  check: '<polyline points="20 6 9 17 4 12"></polyline>',
  alert: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
}

function iconSvg(name: string, cls = 'inkchapter-content-toolbar__icon'): string {
  const body = INK_ICONS[name] ?? ''
  return (
    `<svg class="${cls}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  )
}

export class ContentBlockToolbarController {
  private readonly wrapper: HTMLDivElement
  private readonly buttons: Record<ActionName, HTMLButtonElement>
  private readonly statusEl: HTMLSpanElement
  private readonly session = new ContentBlockToolbarSession()

  private mounted = false
  private disposed = false
  private boundRoot: HTMLElement | null = null
  private active: ContentBlockTarget | null = null
  private visible = false
  private hideTimer: number | null = null
  private buttonResetTimers = new Map<ActionName, number>()
  private busy = false
  private selectionRaf: number | null = null
  /**
   * 工具栏显示瞬间，目标代码块是否持有光标/选区。
   * Typora 会在点击浮层时先改变焦点上下文，因此必须在“显示时”记录，
   * 否则折叠安全门禁在真实 GUI 中永远不会触发。
   */
  private caretInsideAtShow = false
  /**
   * 最近获得焦点的代码块身份。Typora 在浮层按钮按下时会先移动焦点上下文，
   * 因此“当前是否仍在编辑”必须用一个不随按钮点击丢失的记录来判断。
   */
  private focusedBlockKey: string | null = null
  /** 已提交的工具栏位置（用于重定位取证：窗口/侧栏/布局变化后必须更新）。 */
  private lastPosition: { key: string; left: number; top: number } | null = null
  private readonly onSurfacePointerOver: (ev: Event) => void
  private readonly onSurfacePointerOut: (ev: Event) => void
  private readonly onSurfaceFocusIn: (ev: Event) => void
  private readonly onSurfaceFocusOut: (ev: Event) => void
  private readonly onSurfacePointerDown: (ev: Event) => void
  private readonly onDocumentSelectionChange: () => void

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ContentBlockToolbarOptions,
  ) {
    const doc = root.ownerDocument ?? document
    this.wrapper = doc.createElement('div')
    this.wrapper.className = CONTENT_TOOLBAR_CLASS
    this.wrapper.setAttribute(CONTENT_TOOLBAR_ATTR, 'true')
    this.wrapper.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.wrapper.setAttribute('role', 'toolbar')
    this.wrapper.setAttribute('aria-label', '内容块快捷操作')
    this.wrapper.setAttribute('contenteditable', 'false')
    this.wrapper.style.display = 'none'

    this.buttons = {
      'copy-code': this.buildButton('copy-code', 'copy', '复制代码'),
      'toggle-fold': this.buildButton('toggle-fold', 'chevron-up', '折叠代码'),
      'copy-image': this.buildButton('copy-image', 'image', '复制图片'),
    }
    this.wrapper.append(this.buttons['copy-code'], this.buttons['toggle-fold'], this.buttons['copy-image'])

    this.statusEl = doc.createElement('span')
    this.statusEl.className = 'inkchapter-content-toolbar__status'
    this.statusEl.setAttribute('role', 'status')
    this.statusEl.setAttribute('aria-live', 'polite')
    this.wrapper.appendChild(this.statusEl)

    // 按钮按下时阻止焦点转移：编辑器保持焦点，Typora 原生光标/选区不被改写。
    const keepFocus = (ev: Event): void => { ev.preventDefault() }
    for (const btn of Object.values(this.buttons)) {
      btn.addEventListener('pointerdown', keepFocus)
      btn.addEventListener('mousedown', keepFocus)
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        void this.runAction(btn.getAttribute('data-action') as ActionName)
      })
    }
    this.wrapper.addEventListener('pointerenter', () => this.cancelHide())
    this.wrapper.addEventListener('pointerleave', () => this.scheduleHide())
    this.wrapper.addEventListener('focusin', () => this.cancelHide())
    this.wrapper.addEventListener('focusout', () => this.scheduleHide())

    this.onSurfacePointerOver = (ev) => this.handlePointerOver(ev)
    this.onSurfacePointerOut = (ev) => this.handlePointerOut(ev)
    this.onSurfaceFocusIn = (ev) => this.handleFocusIn(ev)
    this.onSurfaceFocusOut = () => this.scheduleHide()
    this.onSurfacePointerDown = (ev) => this.handleSurfacePointerDown(ev)
    this.onDocumentSelectionChange = () => this.handleSelectionChange()
  }

  // ── 生命周期 ───────────────────────────────────────────────

  mount(): void {
    if (this.mounted || this.disposed) return
    this.mounted = true
    this.root.appendChild(this.wrapper)
    this.attachSurface()
    const doc = this.root.ownerDocument ?? document
    doc.addEventListener('selectionchange', this.onDocumentSelectionChange, { passive: true } as AddEventListenerOptions)
  }

  /** 文档切换后重新绑定编辑面（旧 #write 已被替换）。 */
  rebindEditorSurface(): void {
    if (!this.mounted || this.disposed) return
    this.attachSurface()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mounted = false
    this.detachSurface()
    this.clearHideTimer()
    for (const id of this.buttonResetTimers.values()) window.clearTimeout(id)
    this.buttonResetTimers.clear()
    if (this.selectionRaf !== null) {
      try { cancelAnimationFrame(this.selectionRaf) } catch { /* noop */ }
      this.selectionRaf = null
    }
    const doc = this.root.ownerDocument ?? document
    doc.removeEventListener('selectionchange', this.onDocumentSelectionChange)
    this.wrapper.remove()
  }

  /** 文档切换：清空折叠状态并隐藏（旧 DOM 已随文档失效）。 */
  resetForDocument(reason: string): void {
    const root = this.boundRoot
    if (root) {
      for (const entry of this.session.entries()) {
        const el = this.findFenceByKey(entry.key, root)
        if (el) this.removeFoldPresentation(el)
      }
    }
    this.session.reset()
    this.focusedBlockKey = null
    this.active = null
    this.hide('DOCUMENT_SWITCH')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-SESSION-RESET', { reason })
  }

  // ── 宿主接入：几何 / 滚动 ──────────────────────────────────

  /** 每次既有 geometry pass 调用（无新增调度器）。 */
  syncGeometry(): void {
    if (this.disposed || !this.mounted) return
    this.reapplyFolds()
    if (!this.active) return
    if (!this.active.element.isConnected) {
      this.hide('ANCHOR_DETACHED')
      return
    }
    if (!this.visible) return
    if (!this.position()) this.hide('ANCHOR_NOT_RENDERABLE')
  }

  /** 由既有的唯一 scroll 监听器驱动：滚动后立即隐藏，绝不留下陈旧浮层。 */
  onEditorScroll(): void {
    if (!this.visible) return
    this.hide('EDITOR_SCROLL')
  }

  isVisible(): boolean {
    return this.visible
  }

  getActiveKey(): string | null {
    return this.active?.key ?? null
  }

  getFoldKeys(): string[] {
    return this.session.entries().map((e) => e.key)
  }

  // ── 事件绑定 ───────────────────────────────────────────────

  private attachSurface(): void {
    this.detachSurface()
    const root = this.opts.getEditorRoot()
    if (!root) return
    this.boundRoot = root
    const capture = { passive: true, capture: true } as AddEventListenerOptions
    root.addEventListener('pointerover', this.onSurfacePointerOver, { passive: true } as AddEventListenerOptions)
    root.addEventListener('pointerout', this.onSurfacePointerOut, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusin', this.onSurfaceFocusIn, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusout', this.onSurfaceFocusOut, { passive: true } as AddEventListenerOptions)
    root.addEventListener('pointerdown', this.onSurfacePointerDown, capture)
  }

  private detachSurface(): void {
    const root = this.boundRoot
    if (root) {
      root.removeEventListener('pointerover', this.onSurfacePointerOver)
      root.removeEventListener('pointerout', this.onSurfacePointerOut)
      root.removeEventListener('focusin', this.onSurfaceFocusIn)
      root.removeEventListener('focusout', this.onSurfaceFocusOut)
      root.removeEventListener('pointerdown', this.onSurfacePointerDown, true)
    }
    this.boundRoot = null
  }

  private handlePointerOver(ev: Event): void {
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (!target) return
    this.cancelHide()
    if (this.active && this.active.key === target.key && this.visible) {
      // 同一块的重复悬停：刷新“光标是否在其中”的快照，避免陈旧判断。
      this.caretInsideAtShow = target.kind === 'code' && this.selectionInside(target.element)
      return
    }
    this.show(target)
  }

  private handlePointerOut(ev: Event): void {
    if (!this.active) return
    const related = (ev as PointerEvent).relatedTarget
    if (related instanceof Node) {
      if (this.wrapper.contains(related)) return
      if (this.active.block.contains(related)) return
    }
    this.scheduleHide()
  }

  private handleFocusIn(ev: Event): void {
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    // 记录“最近编辑中的代码块”；焦点移到正文/表格等即清除。
    this.focusedBlockKey = target && target.kind === 'code' ? target.key : null
    if (!target) return
    // 折叠块获得焦点 → 必须先展开，避免输入落入不可见代码。
    if (target.kind === 'code' && this.isFoldedElement(target.element, target.key)) {
      this.unfold(target, 'FOCUS_ENTERED_FOLDED_BLOCK')
    }
    this.cancelHide()
    this.show(target)
  }

  private handleSurfacePointerDown(ev: Event): void {
    if (this.session.size === 0) return
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (!target || target.kind !== 'code') return
    if (this.isFoldedElement(target.element, target.key)) {
      this.unfold(target, 'POINTER_DOWN_ON_FOLDED_BLOCK')
    }
  }

  private handleSelectionChange(): void {
    if (this.session.size === 0) return
    if (this.selectionRaf !== null) return
    try {
      this.selectionRaf = requestAnimationFrame(() => {
        this.selectionRaf = null
        this.expandFoldedBlockContainingSelection()
      })
    } catch {
      this.selectionRaf = null
    }
  }

  private expandFoldedBlockContainingSelection(): void {
    const root = this.boundRoot
    if (!root || this.session.size === 0) return
    const anchor = (() => {
      try { return window.getSelection()?.anchorNode ?? null } catch { return null }
    })()
    if (!anchor) return
    const fence = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest?.<HTMLElement>(CODE_BLOCK_SELECTOR)
    if (!fence) return
    const key = this.keyOf(fence, root)
    if (!key || !this.session.isFolded(key)) return
    const target = resolveContentBlockTargetFromElement(fence, root)
    if (target) this.unfold(target, 'SELECTION_ENTERED_FOLDED_BLOCK')
  }

  // ── 显示 / 隐藏 / 定位 ─────────────────────────────────────

  private show(target: ContentBlockTarget): void {
    if (this.disposed) return
    this.active = target
    this.cancelHide()
    this.caretInsideAtShow = target.kind === 'code' && this.selectionInside(target.element)
    this.applyKind(target.kind)
    this.syncFoldButton(target)
    this.wrapper.style.display = ''
    this.visible = true
    if (!this.position()) {
      this.hide('ANCHOR_NOT_RENDERABLE')
      return
    }
    this.emitShowAudit(target)
  }

  /**
   * 几何取证（只读测量）：锚点 / 工具栏矩形与题注安全距离。
   * 用于证明工具栏落在代码主体右上角、不覆盖题注与语言工具条。
   */
  private emitShowAudit(target: ContentBlockTarget): void {
    if (!this.opts.emitAudit) return
    try {
      const anchor = target.element.getBoundingClientRect()
      const toolbar = this.wrapper.getBoundingClientRect()
      this.opts.emitAudit('CONTENT-BLOCK-TOOLBAR-SHOW', {
        blockKey: target.key,
        kind: target.kind,
        anchorRect: rectTuple(anchor),
        toolbarRect: rectTuple(toolbar),
        /** 工具栏顶边 ≥ 代码主体顶边 ⇒ 不进入题注所在的 ::before 区域。 */
        belowCaptionLine: Math.round(toolbar.top - anchor.top),
        insideAnchorRight: Math.round(anchor.right - toolbar.right),
        insideAnchorBottom: Math.round(anchor.bottom - toolbar.bottom),
        captionLabel: target.kind === 'code'
          ? target.element.getAttribute('data-inkchapter-caption-label')
          : null,
        buttonCount: this.wrapper.querySelectorAll('button:not([hidden])').length,
      })
    } catch { /* 取证失败不影响交互 */ }
  }

  private hide(reason: string): void {
    if (!this.visible && this.wrapper.style.display === 'none') {
      this.active = null
      return
    }
    this.visible = false
    this.active = null
    this.lastPosition = null
    this.wrapper.style.display = 'none'
    this.wrapper.style.removeProperty('left')
    this.wrapper.style.removeProperty('top')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-HIDDEN', { reason })
  }

  private scheduleHide(): void {
    if (!this.visible) return
    this.clearHideTimer()
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null
      const focused = document.activeElement
      if (focused instanceof Node && this.wrapper.contains(focused)) return
      this.hide('POINTER_LEFT')
    }, HIDE_DELAY_MS)
  }

  private cancelHide(): void {
    this.clearHideTimer()
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  /** 计算并写入视口坐标；返回 false 表示目标不可见（应隐藏）。 */
  private position(): boolean {
    const target = this.active
    if (!target) return false
    if (!isTargetRenderable(target.element)) return false
    const rect = target.element.getBoundingClientRect()
    const viewportW = window.innerWidth || documentElementWidth(this.root)
    const viewportH = window.innerHeight || documentElementHeight(this.root)
    if (rect.bottom <= 0 || rect.top >= viewportH || rect.right <= 0 || rect.left >= viewportW) return false

    const toolbarW = this.wrapper.offsetWidth || 76
    const toolbarH = this.wrapper.offsetHeight || 28
    let top: number
    let left: number
    if (target.kind === 'code') {
      top = rect.top + INSET_PX
      left = rect.right - toolbarW - INSET_PX
    } else {
      const small = rect.width < SMALL_IMAGE_WIDTH || rect.height < SMALL_IMAGE_HEIGHT
      top = small ? rect.top - toolbarH - INSET_PX : rect.top + INSET_PX
      left = rect.right - toolbarW - INSET_PX
    }
    left = Math.max(4, Math.min(left, viewportW - toolbarW - 4))
    top = Math.max(4, Math.min(top, viewportH - toolbarH - 4))
    // 窄代码块：避免工具栏越过块左边界压住正文起首。
    if (target.kind === 'code' && left < rect.left + 4) left = rect.left + 4
    this.wrapper.style.left = `${Math.round(left)}px`
    this.wrapper.style.top = `${Math.round(top)}px`
    this.emitRepositionAudit(target, rect, Math.round(left), Math.round(top))
    return true
  }

  /** 布局变化（窗口缩放 / 侧栏 / 抽屉）后的重定位取证；首次显示由 SHOW 覆盖。 */
  private emitRepositionAudit(
    target: ContentBlockTarget,
    anchorRect: DOMRect,
    left: number,
    top: number,
  ): void {
    const previous = this.lastPosition
    this.lastPosition = { key: target.key, left, top }
    if (!previous || previous.key !== target.key) return
    if (Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5) return
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-REPOSITION', {
      blockKey: target.key,
      from: [previous.left, previous.top],
      to: [left, top],
      anchorRect: rectTuple(anchorRect),
    })
  }

  private applyKind(kind: 'code' | 'image'): void {
    const codeVisible = kind === 'code'
    this.buttons['copy-code'].hidden = !codeVisible
    this.buttons['toggle-fold'].hidden = !codeVisible
    this.buttons['copy-image'].hidden = codeVisible
    this.wrapper.setAttribute('data-block-kind', kind)
    this.wrapper.setAttribute('aria-label', codeVisible ? '代码块快捷操作' : '图片快捷操作')
  }

  // ── 动作 ───────────────────────────────────────────────────

  private async runAction(action: ActionName): Promise<void> {
    const target = this.active
    if (!target || this.busy) return
    if (action === 'copy-image') {
      if (target.kind !== 'image') return
      await this.copyImage(target)
      return
    }
    if (target.kind !== 'code') return
    if (action === 'copy-code') {
      await this.copyCode(target)
      return
    }
    this.toggleFold(target)
  }

  private readCodeText(target: ContentBlockTarget): string | null {
    const direct = this.opts.actions.readCodeSource(target.element)
    if (direct != null) return direct
    const root = this.boundRoot ?? this.opts.getEditorRoot()
    const markdown = this.opts.getMarkdown()
    if (!root || markdown == null) return null
    const ordinal = codeFenceOrdinal(target.element, root)
    if (ordinal < 0) return null
    const lookup = lookupFenceSource(markdown, ordinal)
    return lookup.found ? lookup.text : null
  }

  private async copyCode(target: ContentBlockTarget): Promise<void> {
    this.busy = true
    this.setButtonState('copy-code', 'loading')
    try {
      const text = this.readCodeText(target)
      if (text == null) {
        this.setButtonState('copy-code', 'error', '无法读取代码源文本')
        this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
          decision: 'FAIL', reason: 'SOURCE_UNAVAILABLE', blockKey: target.key,
        })
        return
      }
      const result = await this.opts.actions.copyText(text)
      if (result.ok) {
        this.setButtonState('copy-code', 'success', result.verified ? '已复制（已校验）' : '已复制')
      } else {
        this.setButtonState('copy-code', 'error', `复制失败：${result.reason ?? 'UNKNOWN'}`)
      }
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
        decision: result.ok ? 'PASS' : 'FAIL',
        reason: result.reason ?? null,
        verified: result.verified === true,
        charCount: text.length,
        lineCount: countCodeLines(text),
        blockKey: target.key,
      })
    } catch (error) {
      this.setButtonState('copy-code', 'error', '复制失败')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
        decision: 'FAIL', reason: 'THREW', message: String(error), blockKey: target.key,
      })
    } finally {
      this.busy = false
    }
  }

  private async copyImage(target: ContentBlockTarget): Promise<void> {
    this.busy = true
    this.setButtonState('copy-image', 'loading')
    try {
      const img = target.element as HTMLImageElement
      const result = await this.opts.actions.copyImage(img)
      if (result.ok) {
        this.setButtonState('copy-image', 'success', result.verified ? '已复制图片（已校验）' : '已复制图片')
      } else {
        this.setButtonState('copy-image', 'error', `复制图片失败：${result.reason ?? 'UNKNOWN'}`)
      }
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: result.ok ? 'PASS' : 'FAIL',
        reason: result.reason ?? null,
        verified: result.verified === true,
        note: result.note ?? null,
        blockKey: target.key,
      })
    } catch (error) {
      this.setButtonState('copy-image', 'error', '复制图片失败')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: 'FAIL', reason: 'THREW', message: String(error), blockKey: target.key,
      })
    } finally {
      this.busy = false
    }
  }

  // ── 折叠 ───────────────────────────────────────────────────

  private toggleFold(target: ContentBlockTarget): void {
    if (this.session.isFolded(target.key)) {
      this.unfold(target, 'USER_TOGGLE')
      return
    }
    if (this.session.size >= MAX_FOLD_ENTRIES) {
      this.setButtonState('toggle-fold', 'error', '折叠数量已达上限')
      return
    }
    // 安全门禁：当前（或工具栏显示瞬间 / 最近聚焦）光标在该代码块内时禁止折叠。
    const caretInsideNow = this.selectionInside(target.element)
    const caretInsideAtShow = this.active?.key === target.key && this.caretInsideAtShow
    const recentlyFocused = this.focusedBlockKey === target.key
    if (caretInsideNow || caretInsideAtShow || recentlyFocused) {
      this.setButtonState('toggle-fold', 'error', '光标位于该代码块内，无法折叠')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
        decision: 'BLOCKED',
        reason: 'CARET_OR_SELECTION_INSIDE',
        caretInsideNow,
        caretInsideAtShow,
        recentlyFocused,
        blockKey: target.key,
      })
      return
    }
    const text = this.readCodeText(target)
    const lineCount = text != null ? countCodeLines(text) : this.countRenderedLines(target.element)
    this.session.setFold({
      key: target.key,
      lineCount,
      documentKey: null,
    })
    this.applyFoldPresentation(target.element, lineCount)
    this.syncFoldButton(target)
    this.opts.onLayoutInvalidated('content-block-fold')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
      decision: 'PASS', reason: 'FOLDED', lineCount, caretInsideNow, caretInsideAtShow, blockKey: target.key,
    })
  }

  private unfold(target: ContentBlockTarget, reason: string): void {
    if (!this.session.isFolded(target.key)) return
    this.session.clearFold(target.key)
    this.removeFoldPresentation(target.element)
    this.syncFoldButton(target)
    this.opts.onLayoutInvalidated('content-block-unfold')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
      decision: 'PASS', reason: `UNFOLDED:${reason}`, blockKey: target.key,
    })
    if (this.visible) this.position()
  }

  private selectionInside(fence: HTMLElement): boolean {
    try {
      const active = document.activeElement
      if (active instanceof Node && fence.contains(active)) return true
      const selection = window.getSelection()
      const anchor = selection?.anchorNode ?? null
      if (anchor instanceof Node && fence.contains(anchor)) return true
      const focus = selection?.focusNode ?? null
      if (focus instanceof Node && fence.contains(focus)) return true
    } catch {
      return false
    }
    return false
  }

  private applyFoldPresentation(fence: HTMLElement, lineCount: number): void {
    // class 作为 JS 状态；属性同时驱动 CSS（避免出现裸 .md-fences 全局规则）。
    fence.classList.add(CODE_FOLD_CLASS)
    fence.setAttribute(CODE_FOLD_ATTR, 'true')
    fence.setAttribute(CODE_FOLD_SUMMARY_ATTR, foldSummary(lineCount))
  }

  private removeFoldPresentation(fence: HTMLElement): void {
    fence.classList.remove(CODE_FOLD_CLASS)
    fence.removeAttribute(CODE_FOLD_ATTR)
    fence.removeAttribute(CODE_FOLD_SUMMARY_ATTR)
  }

  private isFoldedElement(fence: HTMLElement, key: string | null): boolean {
    if (key && this.session.isFolded(key)) return true
    return fence.hasAttribute(CODE_FOLD_ATTR) || fence.classList.contains(CODE_FOLD_CLASS)
  }

  private countRenderedLines(fence: HTMLElement): number {
    const rendered = fence.querySelectorAll('.CodeMirror-line').length
    return rendered > 0 ? rendered : 1
  }

  private syncFoldButton(target: ContentBlockTarget): void {
    const btn = this.buttons['toggle-fold']
    const folded = this.session.isFolded(target.key)
    btn.setAttribute('data-action', 'toggle-fold')
    btn.innerHTML = iconSvg(folded ? 'chevron-down' : 'chevron-up')
    const label = folded ? '展开代码' : '折叠代码'
    btn.setAttribute('aria-label', label)
    btn.setAttribute('title', label)
    btn.setAttribute('aria-pressed', folded ? 'true' : 'false')
  }

  /** 代码块被 Typora 重建时按规范身份重新贴回折叠投影。 */
  private reapplyFolds(): void {
    if (this.session.size === 0) return
    const root = this.boundRoot
    if (!root) return
    const activeKeys = new Set<string>()
    for (const fence of Array.from(root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))) {
      const key = this.keyOf(fence, root)
      if (!key) continue
      activeKeys.add(key)
      const entry = this.session.getFold(key)
      if (!entry) continue
      if (!fence.hasAttribute(CODE_FOLD_ATTR)) {
        this.applyFoldPresentation(fence, entry.lineCount)
        this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD-REAPPLIED', { blockKey: key })
      } else if (!fence.getAttribute(CODE_FOLD_SUMMARY_ATTR)) {
        fence.setAttribute(CODE_FOLD_SUMMARY_ATTR, foldSummary(entry.lineCount))
      }
    }
    const removed = this.session.retain(activeKeys)
    if (removed.length > 0) {
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD-RETIRED', { removedCount: removed.length })
    }
  }

  private findFenceByKey(key: string, root: HTMLElement): HTMLElement | null {
    for (const fence of Array.from(root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))) {
      if (this.keyOf(fence, root) === key) return fence
    }
    return null
  }

  private keyOf(fence: HTMLElement, root: HTMLElement): string | null {
    return resolveContentBlockTargetFromElement(fence, root)?.key ?? null
  }

  // ── 按钮 ───────────────────────────────────────────────────

  private buildButton(action: ActionName, icon: string, label: string): HTMLButtonElement {
    const doc = this.root.ownerDocument ?? document
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = `inkchapter-content-toolbar__btn inkchapter-content-toolbar__btn--${action}`
    btn.setAttribute('data-action', action)
    btn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    btn.setAttribute('aria-label', label)
    btn.setAttribute('title', label)
    btn.innerHTML = iconSvg(icon)
    return btn
  }

  private setButtonState(action: ActionName, state: ButtonState, message?: string): void {
    const btn = this.buttons[action]
    btn.classList.toggle('is-loading', state === 'loading')
    btn.classList.toggle('is-success', state === 'success')
    btn.classList.toggle('is-error', state === 'error')
    btn.disabled = state === 'loading'
    if (message) {
      btn.setAttribute('title', message)
      btn.setAttribute('aria-label', message)
      this.statusEl.textContent = message
    }
    const previous = this.buttonResetTimers.get(action)
    if (previous !== undefined) window.clearTimeout(previous)
    if (state === 'idle') return
    const timer = window.setTimeout(() => {
      this.buttonResetTimers.delete(action)
      this.resetButton(action)
    }, FEEDBACK_RESET_MS)
    this.buttonResetTimers.set(action, timer)
  }

  private resetButton(action: ActionName): void {
    const btn = this.buttons[action]
    btn.classList.remove('is-loading', 'is-success', 'is-error')
    btn.disabled = false
    if (action === 'toggle-fold') {
      if (this.active) this.syncFoldButton(this.active)
      return
    }
    const label = action === 'copy-code' ? '复制代码' : '复制图片'
    btn.setAttribute('title', label)
    btn.setAttribute('aria-label', label)
  }
}

function documentElementWidth(root: HTMLElement): number {
  return root.ownerDocument?.documentElement?.clientWidth ?? 0
}

function documentElementHeight(root: HTMLElement): number {
  return root.ownerDocument?.documentElement?.clientHeight ?? 0
}

/** 视口矩形 → 可序列化的整数元组（x, y, width, height）。 */
function rectTuple(rect: DOMRect): [number, number, number, number] {
  return [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ]
}
