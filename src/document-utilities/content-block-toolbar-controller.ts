/**
 * 内容块工具栏 — V3 稳定性修复版控制器。
 *
 * 结构（参考 CSDN 代码块）：
 *   [代码题注（墨章题注，文档内容，第一行）]
 *   [语言栏（PRE 内部顶部，随块原生滚动）]
 *     左：语言徽标 + 真实语言 + 逻辑行数
 *     右：复制图标 + 折叠/展开图标（可折叠时才显示）
 *   [代码正文（预览式折叠）]
 *
 * 关键约束：
 * - 语言栏挂在 `pre.md-fences` 内部（不是 #write 的独立浮层），与代码块共享原生滚动坐标系，
 *   滚动期间零定位计算、零滞后；绝不插入 CodeMirror 的可编辑模型。
 * - 图片工具栏仍复用既有 Overlay 根（悬停单实例），不新增观察器/轮询。
 * - 折叠只改可视投影（属性 + CSS 变量），不改 Markdown / CodeMirror 模型 / Undo。
 * - 复制永远复制完整源码，与折叠状态无关。
 */

import {
  CODE_BLOCK_SELECTOR,
  countCodeLines,
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
/** 语言栏存在标记（CSS 用它为代码块预留顶部内边距）。 */
export const CODE_LANGBAR_ATTR = 'data-inkchapter-langbar'
/** 折叠预览行数（5 | 10）。 */
export const CODE_FOLD_PREVIEW_ATTR = 'data-inkchapter-fold-preview'
/** 折叠预览高度（CSS 变量，作用在 `.CodeMirror` 上）。 */
export const CODE_FOLD_HEIGHT_VAR = '--ink-fold-preview-height'

const DEFAULT_PREVIEW_LINES = 10
const FEEDBACK_RESET_MS = 1600
const MAX_VIEWS = 80

type ButtonState = 'idle' | 'loading' | 'success' | 'error'

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
  /** 折叠预览行数（5 | 10）。 */
  getPreviewLines?: () => 5 | 10
}

interface CodeBlockView {
  key: string
  fence: HTMLElement
  bar: HTMLDivElement
  badge: HTMLSpanElement
  lang: HTMLSpanElement
  lines: HTMLSpanElement
  copyBtn: HTMLButtonElement
  foldBtn: HTMLButtonElement
  folded: boolean
  previewLines: number
  totalLines: number
  shownAudited: boolean
  /** 语言栏顶边 - PRE 顶边的基线（首帧采样）；滚动期间漂移必须为 0。 */
  syncBaselinePx: number | null
  /** 本次真实按钮操作的唯一 id（pointerdown 生成，click/状态/视觉审计共用）。 */
  actionId: string | null
  /** 已处理的 actionId：同一 actionId 只允许一次状态转换。 */
  handledActionId: string | null
}

interface CaretSnapshot {
  activeTag: string | null
  activeClass: string | null
  activeInFence: boolean
  activeIsFoldButton: boolean
  anchorInFence: boolean
  anchorLineIndex: number | null
  caretLine: number | null
  caretCh: number | null
  caretSource: 'none' | 'range' | 'cm'
  hiddenByPreview: boolean | null
  selectionType: string | null
}

const LANG_BADGES: Array<[RegExp, string, string]> = [
  [/^(javascript|js|jsx|mjs|cjs)$/i, 'JS', 'JavaScript'],
  [/^(typescript|ts|tsx)$/i, 'TS', 'TypeScript'],
  [/^(python|py)$/i, 'PY', 'Python'],
  [/^(java)$/i, 'JAVA', 'Java'],
  [/^(c)$/i, 'C', 'C'],
  [/^(cpp|c\+\+|cxx|h|hpp)$/i, 'C++', 'C++'],
  [/^(csharp|cs|c#)$/i, 'C#', 'C#'],
  [/^(go|golang)$/i, 'GO', 'Go'],
  [/^(rust|rs)$/i, 'RS', 'Rust'],
  [/^(php)$/i, 'PHP', 'PHP'],
  [/^(ruby|rb)$/i, 'RB', 'Ruby'],
  [/^(kotlin|kt)$/i, 'KT', 'Kotlin'],
  [/^(swift)$/i, 'SW', 'Swift'],
  [/^(sql|mysql|postgres|sqlite)$/i, 'SQL', 'SQL'],
  [/^(bash|sh|shell|zsh|powershell|ps1|bat|cmd)$/i, 'SH', 'Shell'],
  [/^(json|json5)$/i, '{}', 'JSON'],
  [/^(html|htm|xml|svg)$/i, '</>', 'HTML'],
  [/^(css|scss|sass|less)$/i, 'CSS', 'CSS'],
  [/^(yaml|yml)$/i, 'YML', 'YAML'],
  [/^(markdown|md|mdx)$/i, 'MD', 'Markdown'],
  [/^(text|txt|plaintext|console|log)$/i, 'TXT', '纯文本'],
]

function resolveLanguage(fence: HTMLElement): string {
  const attr = fence.getAttribute('lang') || fence.getAttribute('data-lang') || ''
  if (attr.trim() !== '') return attr.trim()
  const cls = String(fence.className || '')
  const m = /(?:^|\s)language-([A-Za-z0-9_+#.-]+)/.exec(cls)
  return m ? m[1] : ''
}

function languagePresentation(language: string): { badge: string; label: string } {
  if (!language) return { badge: 'TXT', label: '纯文本' }
  for (const [re, badge, label] of LANG_BADGES) {
    if (re.test(language)) return { badge, label }
  }
  const upper = language.toUpperCase()
  return { badge: upper.slice(0, 3), label: language }
}

function iconSvg(name: string, cls: string): string {
  const body = name === 'copy'
    ? '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>'
      + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>'
    : name === 'chevron-down'
      ? '<polyline points="6 9 12 15 18 9"></polyline>'
      : name === 'chevron-up'
        ? '<polyline points="18 15 12 9 6 15"></polyline>'
        : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>'
          + '<circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
  return `<svg class="${cls}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

export class ContentBlockToolbarController {
  private readonly views = new Map<string, CodeBlockView>()
  private readonly session = new ContentBlockToolbarSession()
  private readonly imageBar: HTMLDivElement
  private readonly imageBtn: HTMLButtonElement

  private mounted = false
  private disposed = false
  private boundRoot: HTMLElement | null = null
  private lastFocusedKey: string | null = null
  private imageTarget: ContentBlockTarget | null = null
  private imageVisible = false
  private imageHideTimer: number | null = null
  private scrollRaf: number | null = null
  private lastViewportW = 0
  private actionSeq = 0
  private resetTimers = new Map<HTMLElement, number>()

  private readonly onPointerOver: (ev: Event) => void
  private readonly onPointerOut: (ev: Event) => void
  private readonly onFocusIn: (ev: Event) => void
  private readonly onFocusOut: () => void
  private readonly onPointerDown: (ev: Event) => void

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ContentBlockToolbarOptions,
  ) {
    const doc = root.ownerDocument ?? document

    // 图片：保留 V1 的悬停单实例工具栏（不常驻，不遮挡图片）。
    this.imageBar = doc.createElement('div')
    this.imageBar.className = `${CONTENT_TOOLBAR_CLASS} ${CONTENT_TOOLBAR_CLASS}--image`
    this.imageBar.setAttribute(CONTENT_TOOLBAR_ATTR, 'true')
    this.imageBar.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageBar.setAttribute('role', 'toolbar')
    this.imageBar.setAttribute('aria-label', '图片快捷操作')
    this.imageBar.setAttribute('contenteditable', 'false')
    this.imageBar.style.display = 'none'
    this.imageBtn = doc.createElement('button')
    this.imageBtn.type = 'button'
    this.imageBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn`
    this.imageBtn.setAttribute('data-action', 'copy-image')
    this.imageBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageBtn.setAttribute('aria-label', '复制图片')
    this.imageBtn.setAttribute('title', '复制图片')
    this.imageBtn.innerHTML = iconSvg('image', `${CONTENT_TOOLBAR_CLASS}__icon`)
    this.imageBar.appendChild(this.imageBtn)
    this.bindButtonFocusGuard(this.imageBtn)
    this.imageBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      void this.copyImage()
    })

    this.onPointerOver = (ev) => this.handlePointerOver(ev)
    this.onPointerOut = (ev) => this.handlePointerOut(ev)
    this.onFocusIn = (ev) => this.handleFocusIn(ev)
    this.onFocusOut = () => this.dropImageBar()
    this.onPointerDown = (ev) => this.handlePointerDown(ev)
  }

  // ── 生命周期 ───────────────────────────────────────────────

  mount(): void {
    if (this.mounted || this.disposed) return
    this.mounted = true
    this.root.appendChild(this.imageBar)
    this.attachSurface()
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
    this.cancelImageHide()
    if (this.scrollRaf !== null) {
      try { cancelAnimationFrame(this.scrollRaf) } catch { /* noop */ }
      this.scrollRaf = null
    }
    for (const id of this.resetTimers.values()) window.clearTimeout(id)
    this.resetTimers.clear()
    for (const view of this.views.values()) this.destroyView(view)
    this.views.clear()
    this.imageBar.remove()
  }

  /** 文档切换：清空折叠状态与全部视图。 */
  resetForDocument(reason: string): void {
    for (const view of this.views.values()) {
      this.clearFoldProjection(view)
      this.destroyView(view)
    }
    this.views.clear()
    this.session.reset()
    this.lastFocusedKey = null
    this.imageTarget = null
    this.imageVisible = false
    this.imageBar.style.display = 'none'
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-SESSION-RESET', { reason })
  }

  // ── 宿主接入：几何 / 滚动 ──────────────────────────────────

  /**
   * 既有 geometry pass 调用（无新增调度器）。
   * 语言栏是 PRE 的子节点，不需要任何坐标计算；这里只同步内容与折叠态。
   */
  syncGeometry(): void {
    if (this.disposed || !this.mounted) return
    const root = this.boundRoot
    if (!root) return

    const previewLines = this.previewLines()
    const fences = Array.from(root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))
    const seen = new Set<string>()

    for (const fence of fences) {
      const target = resolveContentBlockTargetFromElement(fence, root)
      if (!target || target.kind !== 'code') continue
      seen.add(target.key)
      if (this.views.size >= MAX_VIEWS && !this.views.has(target.key)) continue
      if (!isTargetRenderable(fence)) continue

      const view = this.ensureView(target)
      this.syncViewContent(view, target, previewLines)
      this.auditShownOnce(view)
    }

    // 清理：块已不存在 / 已不是代码块。
    for (const [key, view] of Array.from(this.views.entries())) {
      if (!seen.has(key)) {
        this.clearFoldProjection(view)
        this.destroyView(view)
        this.views.delete(key)
      }
    }
    const removed = this.session.retain(seen)
    if (removed.length > 0) {
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD-RETIRED', { removedCount: removed.length })
    }
    this.auditViewportLayout()
  }

  /**
   * 既有 scroll 监听驱动：语言栏与代码块同属一个滚动坐标系，
   * 这里不做任何重定位；仅关闭图片浮层并按帧采样“语言栏顶边 - 代码块顶边”的偏差。
   */
  onEditorScroll(): void {
    if (this.disposed) return
    this.dropImageBar()
    if (this.views.size === 0 || !this.opts.emitAudit) return
    if (this.scrollRaf !== null) return
    try {
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null
        this.auditScrollSync()
      })
    } catch {
      this.scrollRaf = null
      this.auditScrollSync()
    }
  }

  isVisible(): boolean {
    return this.imageVisible || this.views.size > 0
  }

  getActiveKey(): string | null {
    return this.imageTarget?.key ?? this.lastFocusedKey
  }

  getFoldKeys(): string[] {
    return this.session.entries().map(e => e.key)
  }

  // ── 视图生命周期 ───────────────────────────────────────────

  private ensureView(target: ContentBlockTarget): CodeBlockView {
    const existing = this.views.get(target.key)
    if (existing) {
      if (existing.fence === target.element) {
        // Typora 可能重建 PRE 的子节点；掉线时重新挂回（仍不进入 CodeMirror）。
        if (!existing.bar.isConnected) existing.fence.appendChild(existing.bar)
        return existing
      }
      this.clearFoldProjection(existing)
      this.destroyView(existing)
      this.views.delete(target.key)
    }

    const doc = this.root.ownerDocument ?? document
    const bar = doc.createElement('div')
    bar.className = `${CONTENT_TOOLBAR_CLASS} ${CONTENT_TOOLBAR_CLASS}--langbar`
    bar.setAttribute(CONTENT_TOOLBAR_ATTR, 'true')
    bar.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', '代码块语言与操作')
    bar.setAttribute('contenteditable', 'false')
    bar.setAttribute('data-block-key', target.key)

    const badge = doc.createElement('span')
    badge.className = `${CONTENT_TOOLBAR_CLASS}__badge`
    const lang = doc.createElement('span')
    lang.className = `${CONTENT_TOOLBAR_CLASS}__lang`
    const lines = doc.createElement('span')
    lines.className = `${CONTENT_TOOLBAR_CLASS}__lines`
    const copyBtn = doc.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn ${CONTENT_TOOLBAR_CLASS}__btn--copy`
    copyBtn.setAttribute('data-action', 'copy-code')
    copyBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    copyBtn.setAttribute('aria-label', '复制代码')
    copyBtn.setAttribute('title', '复制代码')
    copyBtn.innerHTML = iconSvg('copy', `${CONTENT_TOOLBAR_CLASS}__icon`)
    const foldBtn = doc.createElement('button')
    foldBtn.type = 'button'
    foldBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn ${CONTENT_TOOLBAR_CLASS}__btn--fold`
    foldBtn.setAttribute('data-action', 'toggle-fold')
    foldBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    foldBtn.setAttribute('aria-label', '收起至预览')
    foldBtn.setAttribute('title', '收起至预览')
    foldBtn.style.display = 'none'
    bar.append(badge, lang, lines, copyBtn, foldBtn)

    this.bindButtonFocusGuard(copyBtn)
    this.bindButtonFocusGuard(foldBtn)

    const view: CodeBlockView = {
      key: target.key,
      fence: target.element,
      bar,
      badge,
      lang,
      lines,
      copyBtn,
      foldBtn,
      folded: false,
      previewLines: DEFAULT_PREVIEW_LINES,
      totalLines: 0,
      shownAudited: false,
      syncBaselinePx: null,
      actionId: null,
      handledActionId: null,
    }

    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      void this.copyCode(view)
    })
    foldBtn.addEventListener('pointerdown', (ev) => {
      const actionId = `fold-${++this.actionSeq}-${view.key}`
      view.actionId = actionId
      this.auditFoldPointerHit(view, ev, actionId)
    })
    foldBtn.addEventListener('pointerup', (ev) => {
      this.opts.emitAudit?.('FOLD-POINTER-UP', {
        actionId: view.actionId,
        blockKey: view.key,
        detail: ev.detail,
        isTrusted: ev.isTrusted,
        targetTag: (ev.target as Element | null)?.tagName ?? null,
        path: this.eventPathSummary(ev),
        caret: this.caretSnapshot(view),
      })
    })
    foldBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const actionId = view.actionId
      const caret = this.caretSnapshot(view)
      this.opts.emitAudit?.('FOLD-CLICK-DISPATCH', {
        actionId,
        blockKey: view.key,
        detail: ev.detail,
        isTrusted: ev.isTrusted,
        folded: view.folded,
        totalLines: view.totalLines,
        previewLines: view.previewLines,
        caretInside: this.selectionInside(view.fence),
        caret,
        path: this.eventPathSummary(ev),
        toolbarConnected: view.bar.isConnected && view.foldBtn.isConnected,
        fenceIsCurrent: view.fence.isConnected && view.fence === target.element,
      })
      this.toggleFold(view, actionId)
    })

    target.element.setAttribute(CODE_LANGBAR_ATTR, 'true')
    target.element.appendChild(bar)
    this.views.set(target.key, view)
    return view
  }

  private destroyView(view: CodeBlockView): void {
    view.fence.removeAttribute(CODE_LANGBAR_ATTR)
    view.bar.remove()
    for (const btn of [view.copyBtn, view.foldBtn]) {
      const timer = this.resetTimers.get(btn)
      if (timer !== undefined) window.clearTimeout(timer)
      this.resetTimers.delete(btn)
    }
  }

  // ── 展示审计（每块一次） ───────────────────────────────────

  private auditShownOnce(view: CodeBlockView): void {
    if (view.shownAudited) return
    view.shownAudited = true
    const fenceRect = view.fence.getBoundingClientRect()
    const barRect = view.bar.getBoundingClientRect()
    const buttons = Array.from(view.bar.querySelectorAll('button'))
    let preOverflow = ''
    try { preOverflow = getComputedStyle(view.fence).overflow } catch { preOverflow = '' }
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-SHOW', {
      blockKey: view.key,
      kind: 'code',
      mode: 'langbar-in-fence',
      anchorRect: rectTuple(fenceRect),
      toolbarRect: rectTuple(barRect),
      copyRect: rectTuple(view.copyBtn.getBoundingClientRect()),
      foldRect: rectTuple(view.foldBtn.getBoundingClientRect()),
      barChildren: view.bar.children.length,
      captionLabel: view.fence.getAttribute('data-inkchapter-caption-label'),
      foldable: view.totalLines > view.previewLines,
      totalLines: view.totalLines,
      previewLines: view.previewLines,
      buttonCount: buttons.length,
      preOverflow,
      dpr: window.devicePixelRatio || 1,
    })
  }

  /**
   * 视口宽度变化（窗口缩放 / 侧栏拖拽）时输出一次真实布局：
   * 证明语言栏 left/right 由 CSS 驱动而非旧坐标，且没有被裁到视口外。
   */
  private auditViewportLayout(): void {
    const vw = window.innerWidth || 0
    if (vw === this.lastViewportW) return
    this.lastViewportW = vw
    const entries: Array<{ key: string; bar: [number, number, number, number]; fence: [number, number, number, number] }> = []
    let clipped = 0
    for (const view of this.views.values()) {
      if (!view.bar.isConnected) continue
      const barRect = view.bar.getBoundingClientRect()
      const fenceRect = view.fence.getBoundingClientRect()
      if (barRect.right > vw + 1) clipped++
      if (entries.length < 6) {
        entries.push({ key: view.key, bar: rectTuple(barRect), fence: rectTuple(fenceRect) })
      }
    }
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-LAYOUT', {
      viewportW: vw,
      dpr: window.devicePixelRatio || 1,
      blocks: this.views.size,
      clipped,
      entries,
    })
  }

  /** 滚动采样：语言栏与 PRE 同属一个滚动坐标系，相对位移漂移应恒为 0。 */
  private auditScrollSync(): void {
    if (this.disposed || this.views.size === 0) return
    const vh = window.innerHeight || 0
    let blocks = 0
    let maxDrift = 0
    let maxDelta = 0
    let worst: string | null = null
    for (const view of this.views.values()) {
      if (!view.bar.isConnected) continue
      const fr = view.fence.getBoundingClientRect()
      if (fr.bottom <= 0 || fr.top >= vh) continue
      const br = view.bar.getBoundingClientRect()
      const delta = br.top - fr.top
      if (view.syncBaselinePx === null) view.syncBaselinePx = delta
      const drift = Math.abs(delta - view.syncBaselinePx)
      blocks++
      if (drift > maxDrift) { maxDrift = drift; worst = view.key }
      if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta)
    }
    if (blocks === 0) return
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-SCROLL-SYNC', {
      blocks,
      maxDriftPx: Math.round(maxDrift * 100) / 100,
      maxDeltaPx: Math.round(maxDelta * 100) / 100,
      worstBlock: worst,
      dpr: window.devicePixelRatio || 1,
    })
  }

  // ── 内容同步 ───────────────────────────────────────────────

  private syncViewContent(view: CodeBlockView, target: ContentBlockTarget, previewLines: number): void {
    const language = resolveLanguage(target.element)
    const presentation = languagePresentation(language)
    if (view.badge.textContent !== presentation.badge) view.badge.textContent = presentation.badge
    if (view.lang.textContent !== presentation.label) view.lang.textContent = presentation.label

    const text = this.readCodeText(target)
    const total = text != null ? countCodeLines(text) : this.countRenderedLines(target.element)
    view.totalLines = total
    view.previewLines = previewLines
    const linesLabel = `${total} 行`
    if (view.lines.textContent !== linesLabel) view.lines.textContent = linesLabel

    const folded = this.session.isFolded(target.key) && total > previewLines
    if (folded !== view.folded) {
      view.folded = folded
      if (folded) this.applyFoldProjection(view, previewLines)
      else this.clearFoldProjection(view)
    } else if (folded) {
      this.applyFoldProjection(view, previewLines)
    }
    this.syncFoldButton(view)
  }

  // ── 折叠（预览式） ─────────────────────────────────────────

  /** 精确显示前 N 个逻辑行：优先使用真实行元素的像素范围，避免裁断半行。 */
  private computePreviewHeight(fence: HTMLElement, previewLines: number): { height: number; source: string } {
    try {
      const lines = fence.querySelectorAll<HTMLElement>('.CodeMirror-line')
      if (previewLines > 0 && lines.length >= previewLines) {
        const first = lines[0].getBoundingClientRect()
        const nth = lines[previewLines - 1].getBoundingClientRect()
        const h = Math.ceil(nth.bottom - first.top)
        if (h > 0) return { height: h, source: 'line-rects' }
      }
    } catch { /* fall through */ }
    const lh = this.measureLineHeight(fence)
    return { height: Math.max(24, Math.ceil(lh * previewLines)), source: 'line-height' }
  }

  private applyFoldProjection(view: CodeBlockView, previewLines: number): void {
    const { height, source } = this.computePreviewHeight(view.fence, previewLines)
    view.fence.classList.add(CODE_FOLD_CLASS)
    view.fence.setAttribute(CODE_FOLD_ATTR, 'true')
    view.fence.setAttribute(CODE_FOLD_PREVIEW_ATTR, String(previewLines))
    view.fence.setAttribute(CODE_FOLD_SUMMARY_ATTR, `已折叠 · ${previewLines} 行`)
    const next = `${height}px`
    const previous = view.fence.style.getPropertyValue(CODE_FOLD_HEIGHT_VAR)
    view.fence.style.setProperty(CODE_FOLD_HEIGHT_VAR, next)
    if (previous === next) return
    this.opts.emitAudit?.('FOLD-DOM-COMMIT', {
      actionId: view.actionId,
      blockKey: view.key,
      folded: true,
      previewLines,
      previewHeight: height,
      heightSource: source,
      foldAttr: true,
      previewAttr: previewLines,
      heightVar: next,
    })
  }

  private clearFoldProjection(view: CodeBlockView): void {
    const hadProjection = view.fence.hasAttribute(CODE_FOLD_ATTR)
    view.folded = false
    view.fence.classList.remove(CODE_FOLD_CLASS)
    view.fence.removeAttribute(CODE_FOLD_ATTR)
    view.fence.removeAttribute(CODE_FOLD_PREVIEW_ATTR)
    view.fence.removeAttribute(CODE_FOLD_SUMMARY_ATTR)
    view.fence.style.removeProperty(CODE_FOLD_HEIGHT_VAR)
    if (!hadProjection) return
    this.opts.emitAudit?.('FOLD-DOM-COMMIT', {
      actionId: view.actionId,
      blockKey: view.key,
      folded: false,
      previewLines: view.previewLines,
      previewHeight: null,
      heightSource: null,
      foldAttr: false,
      previewAttr: null,
      heightVar: null,
    })
  }

  private measureLineHeight(fence: HTMLElement): number {
    try {
      const line = fence.querySelector('.CodeMirror-line') as HTMLElement | null
      if (line) {
        const h = line.getBoundingClientRect().height
        if (h > 0) return h
      }
      const cs = getComputedStyle(fence)
      const lh = Number.parseFloat(cs.lineHeight)
      if (Number.isFinite(lh) && lh > 0) return lh
    } catch { /* fall through */ }
    return 20
  }

  private syncFoldButton(view: CodeBlockView): void {
    const foldable = view.totalLines > view.previewLines
    view.foldBtn.style.display = foldable ? '' : 'none'
    if (!foldable) return
    const label = view.folded ? '展开全部代码' : `收起至前 ${view.previewLines} 行`
    const signature = `${view.folded}|${label}`
    view.foldBtn.setAttribute('aria-expanded', view.folded ? 'false' : 'true')
    if (view.foldBtn.getAttribute('data-signature') === signature) return
    view.foldBtn.setAttribute('data-signature', signature)
    view.foldBtn.setAttribute('title', label)
    view.foldBtn.setAttribute('aria-label', label)
    view.foldBtn.innerHTML = iconSvg(
      view.folded ? 'chevron-down' : 'chevron-up',
      `${CONTENT_TOOLBAR_CLASS}__icon`,
    )
  }

  private toggleFold(view: CodeBlockView, actionId: string | null): void {
    if (view.totalLines <= view.previewLines) {
      this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
        actionId, blockKey: view.key, from: view.folded ? 'folded' : 'expanded', to: 'unchanged',
        decision: 'IGNORED', reason: 'NOT_FOLDABLE',
      })
      return
    }
    // 同一次真实点击只允许一次状态转换（防止重复 click / 双击产生反向切换）。
    if (actionId && view.handledActionId === actionId) {
      this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
        actionId, blockKey: view.key, from: view.folded ? 'folded' : 'expanded',
        to: view.folded ? 'folded' : 'expanded',
        decision: 'IGNORED', reason: 'DUPLICATE_ACTION',
      })
      return
    }
    view.handledActionId = actionId

    if (view.folded) {
      this.setCollapsed(view, false, actionId, 'UNFOLDED:PREVIEW_TOGGLE')
      return
    }

    const caret = this.caretSnapshot(view)
    if (caret.hiddenByPreview === true) {
      // 真实 DOM 选区落在将被隐藏的行内：保持既有安全策略（拒绝并反馈）。
      if (caret.anchorInFence === true) {
        this.rejectFoldForHiddenCaret(view, actionId, caret)
        return
      }
      // CodeMirror 文本域光标（Typora 代码编辑的常规形态）：折叠前把光标钳制到
      // 最后一个可见逻辑行。这样折叠不再依赖尾部空行/光标位置，也不会留下不可见光标。
      if (caret.activeInFence === true) {
        const clamp = this.clampCaretToPreview(view, view.previewLines, caret)
        this.opts.emitAudit?.('FOLD-CARET-CLAMPED', {
          actionId, blockKey: view.key,
          previewLines: view.previewLines, totalLines: view.totalLines,
          fromLine: caret.caretLine, toLine: clamp.toLine, toCh: clamp.toCh,
          source: clamp.source, moved: clamp.moved,
        })
        if (!clamp.moved) {
          this.rejectFoldForHiddenCaret(view, actionId, caret)
          return
        }
      }
    }

    this.setCollapsed(view, true, actionId, 'FOLDED_PREVIEW')
  }

  /**
   * 折叠前把 CodeMirror 文本域光标钳制到最后一个可见逻辑行（只改光标，不改文本）。
   *
   * 背景：预览折叠只保留前 N 行。用户刚在代码块末尾追加空行时，光标位于折叠后
   * 不可见的尾部；旧实现直接拒绝折叠，于是“末尾空行”表现为折叠失效。
   */
  private clampCaretToPreview(
    view: CodeBlockView,
    previewLines: number,
    caret: CaretSnapshot,
  ): { moved: boolean; toLine: number | null; toCh: number | null; source: string } {
    if (previewLines <= 0) return { moved: false, toLine: null, toCh: null, source: 'none' }
    try {
      type CmCursor = { line: number; ch: number }
      type CmLike = {
        getCursor?: (end?: string) => CmCursor | null
        getLine?: (line: number) => string | null
        setCursor?: (pos: CmCursor) => void
      }
      const wrapper = view.fence.querySelector('.CodeMirror') as
        (HTMLElement & { CodeMirror?: CmLike }) | null
      const cm = wrapper?.CodeMirror
      if (!cm || typeof cm.setCursor !== 'function') {
        return { moved: false, toLine: null, toCh: null, source: 'unavailable' }
      }
      const cursor = cm.getCursor?.('head') ?? null
      const fromLine = cursor && typeof cursor.line === 'number' ? cursor.line : caret.caretLine
      if (fromLine == null || fromLine < previewLines) {
        return { moved: false, toLine: fromLine ?? null, toCh: null, source: 'already-visible' }
      }
      const toLine = previewLines - 1
      const lineText = typeof cm.getLine === 'function' ? (cm.getLine(toLine) ?? '') : ''
      const toCh = Math.min(caret.caretCh ?? 0, lineText.length)
      cm.setCursor({ line: toLine, ch: toCh })
      return { moved: true, toLine, toCh, source: 'cm' }
    } catch {
      return { moved: false, toLine: null, toCh: null, source: 'error' }
    }
  }

  /** 明确拒绝折叠并给出短暂反馈（不吞掉操作）。 */
  private rejectFoldForHiddenCaret(
    view: CodeBlockView,
    actionId: string | null,
    caret: CaretSnapshot,
  ): void {
    view.foldBtn.classList.add('is-error')
    view.foldBtn.setAttribute('title', `光标位于第 ${(caret.caretLine ?? 0) + 1} 行，超出预览范围，无法折叠`)
    this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
      actionId, blockKey: view.key, from: 'expanded', to: 'expanded',
      decision: 'BLOCKED', reason: 'CARET_IN_HIDDEN_PREVIEW',
      caretInsideNow: this.selectionInside(view.fence), caret,
    })
    const timer = window.setTimeout(() => {
      view.foldBtn.classList.remove('is-error')
      this.syncFoldButton(view)
    }, FEEDBACK_RESET_MS)
    this.resetTimers.set(view.foldBtn, timer)
  }

  /**
   * 诊断定位前展开目标代码块（唯一状态写入者；只展开，绝不 toggle）。
   *
   * 文档检测栏的 `block-node`（code）定位在滚动/高亮之前调用：折叠态下目标行
   * 被裁剪，必须先安全展开，定位才会落到真实几何位置。
   */
  expandFoldedBlockForLocate(element: HTMLElement): boolean {
    if (this.disposed || !element) return false
    for (const view of this.views.values()) {
      if (view.fence !== element && !view.fence.contains(element)) continue
      if (!view.folded) return false
      return this.setCollapsed(view, false, null, 'UNFOLDED:DIAGNOSTIC_LOCATE')
    }
    return false
  }

  /**
   * 唯一折叠状态写入者：目标状态明确（true/false），不再“盲目 toggle”。
   * 所有调用（按钮、自动展开）都必须经过这里，避免多处状态互相覆盖。
   */
  private setCollapsed(
    view: CodeBlockView,
    collapsed: boolean,
    actionId: string | null,
    reason: string,
  ): boolean {
    if (this.disposed || view.folded === collapsed) {
      this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
        actionId, blockKey: view.key,
        from: view.folded ? 'folded' : 'expanded',
        to: view.folded ? 'folded' : 'expanded',
        decision: 'IGNORED', reason: 'ALREADY_IN_TARGET_STATE',
      })
      return false
    }
    if (collapsed) {
      this.session.setFold({ key: view.key, lineCount: view.totalLines, documentKey: null })
      view.folded = true
      this.applyFoldProjection(view, view.previewLines)
    } else {
      this.session.clearFold(view.key)
      this.clearFoldProjection(view)
    }
    this.syncFoldButton(view)
    this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
      actionId, blockKey: view.key,
      from: collapsed ? 'expanded' : 'folded',
      to: collapsed ? 'folded' : 'expanded',
      decision: 'PASS', reason,
      previewLines: view.previewLines, totalLines: view.totalLines,
      foldedKeys: this.session.entries().map(e => e.key),
    })
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
      decision: 'PASS', reason,
      previewLines: view.previewLines, totalLines: view.totalLines, blockKey: view.key,
    })
    this.opts.onLayoutInvalidated(collapsed ? 'content-block-fold' : 'content-block-unfold')
    this.scheduleVisualVerify(view, actionId)
    return true
  }

  /** 下一帧与下下帧各回读一次真实渲染结果，用于检测视觉提交后是否被回滚。 */
  private scheduleVisualVerify(view: CodeBlockView, actionId: string | null = null): void {
    const id = actionId ?? view.actionId
    try {
      requestAnimationFrame(() => {
        this.emitVisualVerify(view, 1, id)
        requestAnimationFrame(() => this.emitVisualVerify(view, 2, id))
      })
    } catch {
      this.emitVisualVerify(view, 1, id)
    }
  }

  private emitVisualVerify(view: CodeBlockView, frame: number, actionId: string | null): void {
    if (this.disposed || !view.fence.isConnected) return
    const fence = view.fence
    const cm = fence.querySelector('.CodeMirror') as HTMLElement | null
    const fenceRect = fence.getBoundingClientRect()
    const lines = fence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    let fullyVisibleLines = 0
    let cmClientHeight: number | null = null
    let cmScrollHeight: number | null = null
    let cmMaxHeight: string | null = null
    if (cm) {
      cmClientHeight = Math.round(cm.clientHeight)
      cmScrollHeight = Math.round(cm.scrollHeight)
      try { cmMaxHeight = getComputedStyle(cm).maxHeight } catch { cmMaxHeight = null }
      const cmRect = cm.getBoundingClientRect()
      for (const line of lines) {
        const r = line.getBoundingClientRect()
        if (r.top >= cmRect.top - 1 && r.bottom <= cmRect.bottom + 1) fullyVisibleLines++
      }
    }
    this.opts.emitAudit?.('FOLD-VISUAL-VERIFY', {
      actionId,
      frame,
      blockKey: view.key,
      folded: view.folded,
      previewLines: view.previewLines,
      totalLines: view.totalLines,
      fenceHeight: Math.round(fenceRect.height),
      fenceWidth: Math.round(fenceRect.width),
      barRect: rectTuple(view.bar.getBoundingClientRect()),
      copyRect: rectTuple(view.copyBtn.getBoundingClientRect()),
      foldRect: rectTuple(view.foldBtn.getBoundingClientRect()),
      cmClientHeight,
      cmScrollHeight,
      cmMaxHeight,
      fullyVisibleLines,
      renderedLines: lines.length,
      caretInside: this.selectionInside(fence),
      dpr: window.devicePixelRatio || 1,
    })
  }

  private auditFoldPointerHit(view: CodeBlockView, ev: PointerEvent, actionId: string): void {
    const btn = view.foldBtn
    const rect = btn.getBoundingClientRect()
    let hit: Element | null = null
    try { hit = document.elementFromPoint(ev.clientX, ev.clientY) } catch { hit = null }
    const hitKey = hit instanceof Element
      ? hit.closest('[data-block-key]')?.getAttribute('data-block-key') ?? null
      : null
    this.opts.emitAudit?.('FOLD-POINTER-HIT', {
      actionId,
      blockKey: view.key,
      pointerType: ev.pointerType ?? null,
      button: ev.button,
      detail: ev.detail,
      isTrusted: ev.isTrusted,
      client: [Math.round(ev.clientX), Math.round(ev.clientY)],
      rect: rectTuple(rect),
      hitSelf: !!hit && (hit === btn || btn.contains(hit)),
      hitTag: hit ? hit.tagName : null,
      hitClass: hit instanceof HTMLElement ? String(hit.className || '') : null,
      hitBlockKey: hitKey,
      path: this.eventPathSummary(ev),
      toolbarConnected: view.bar.isConnected && btn.isConnected,
      fenceConnected: view.fence.isConnected,
      fenceIsCurrent: view.fence.getAttribute('cid') === view.key.split(':').pop(),
      caret: this.caretSnapshot(view),
      dpr: window.devicePixelRatio || 1,
    })
  }

  private eventPathSummary(ev: Event): string[] {
    try {
      return ev.composedPath().slice(0, 8).map((node) => {
        if (!(node instanceof Element)) {
          return node instanceof Node ? String(node.nodeName) : 'window'
        }
        const cls = String(node.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        const key = node.getAttribute('data-block-key')
        return `${node.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${key ? `[${key}]` : ''}`
      })
    } catch {
      return []
    }
  }

  /**
   * 光标/选区快照：优先用 Range 所在逻辑行，其次用 CodeMirror wrapper 上的
   * `CodeMirror` 实例（CM5 公开挂载点）读取 cursor；用于判断折叠是否会隐藏光标。
   */
  private caretSnapshot(view: CodeBlockView): CaretSnapshot {
    const fence = view.fence
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const result: CaretSnapshot = {
      activeTag: active?.tagName ?? null,
      activeClass: active ? String(active.className || '').slice(0, 80) : null,
      activeInFence: !!active && fence.contains(active),
      activeIsFoldButton: active === view.foldBtn,
      anchorInFence: false,
      anchorLineIndex: null,
      caretLine: null,
      caretCh: null,
      caretSource: 'none',
      hiddenByPreview: null,
      selectionType: null,
    }
    try {
      const selection = window.getSelection()
      result.selectionType = selection?.type ?? null
      const anchor = selection?.anchorNode ?? null
      if (anchor instanceof Node && fence.contains(anchor)) {
        result.anchorInFence = true
        const host = anchor instanceof Element ? anchor : anchor.parentElement
        const line = host?.closest('.CodeMirror-line') as HTMLElement | null
        if (line) {
          const index = Array.from(fence.querySelectorAll('.CodeMirror-line')).indexOf(line)
          if (index >= 0) {
            result.anchorLineIndex = index
            result.caretLine = index
            result.caretSource = 'range'
          }
        }
      }
    } catch { /* noop */ }

    if (result.caretLine === null) {
      try {
        type CmCursor = { line: number; ch: number }
        type CmLike = { getCursor?: (end?: string) => CmCursor | null }
        const wrapper = fence.querySelector('.CodeMirror') as
          (HTMLElement & { CodeMirror?: CmLike }) | null
        const cursor = wrapper?.CodeMirror?.getCursor?.('head') ?? null
        if (cursor && typeof cursor.line === 'number') {
          result.caretLine = cursor.line
          result.caretCh = cursor.ch ?? null
          result.caretSource = 'cm'
        }
      } catch { /* noop */ }
    }

    if (result.caretLine !== null) {
      result.hiddenByPreview = result.caretLine >= view.previewLines
    }
    return result
  }

  private countRenderedLines(fence: HTMLElement): number {
    const rendered = fence.querySelectorAll('.CodeMirror-line').length
    return rendered > 0 ? rendered : 1
  }

  // ── 复制 ───────────────────────────────────────────────────

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

  private async copyCode(view: CodeBlockView): Promise<void> {
    this.setCopyState(view, 'loading')
    try {
      const text = this.readCodeText({ kind: 'code', element: view.fence, block: view.fence, key: view.key, cid: view.fence.getAttribute('cid') })
      if (text == null) {
        this.setCopyState(view, 'error', '无法读取代码源文本')
        this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
          decision: 'FAIL', reason: 'SOURCE_UNAVAILABLE', blockKey: view.key,
        })
        return
      }
      const result = await this.opts.actions.copyText(text)
      if (result.ok) {
        this.setCopyState(view, 'success', result.verified ? '已复制（已校验）' : '已复制')
      } else {
        this.setCopyState(view, 'error', `复制失败：${result.reason ?? 'UNKNOWN'}`)
      }
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
        decision: result.ok ? 'PASS' : 'FAIL',
        reason: result.reason ?? null,
        verified: result.verified === true,
        charCount: text.length,
        lineCount: countCodeLines(text),
        folded: view.folded,
        blockKey: view.key,
      })
    } catch (error) {
      this.setCopyState(view, 'error', '复制失败')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-CODE', {
        decision: 'FAIL', reason: 'THREW', message: String(error), blockKey: view.key,
      })
    }
  }

  private setCopyState(view: CodeBlockView, state: ButtonState, message?: string): void {
    const btn = view.copyBtn
    btn.classList.toggle('is-loading', state === 'loading')
    btn.classList.toggle('is-success', state === 'success')
    btn.classList.toggle('is-error', state === 'error')
    btn.disabled = state === 'loading'
    if (message) {
      btn.setAttribute('title', message)
      btn.setAttribute('aria-label', message)
    }
    const previous = this.resetTimers.get(btn)
    if (previous !== undefined) window.clearTimeout(previous)
    if (state === 'idle') return
    const timer = window.setTimeout(() => {
      this.resetTimers.delete(btn)
      btn.classList.remove('is-loading', 'is-success', 'is-error')
      btn.disabled = false
      btn.setAttribute('title', '复制代码')
      btn.setAttribute('aria-label', '复制代码')
    }, FEEDBACK_RESET_MS)
    this.resetTimers.set(btn, timer)
  }

  // ── 图片（保留 V1 行为） ───────────────────────────────────

  private async copyImage(): Promise<void> {
    const target = this.imageTarget
    if (!target) return
    const btn = this.imageBtn
    btn.classList.add('is-loading')
    btn.disabled = true
    try {
      const result = await this.opts.actions.copyImage(target.element as HTMLImageElement)
      btn.classList.toggle('is-success', result.ok)
      btn.classList.toggle('is-error', !result.ok)
      btn.setAttribute('title', result.ok
        ? (result.verified ? '已复制图片（已校验）' : '已复制图片')
        : `复制图片失败：${result.reason ?? 'UNKNOWN'}`)
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: result.ok ? 'PASS' : 'FAIL',
        reason: result.reason ?? null,
        verified: result.verified === true,
        note: result.note ?? null,
        blockKey: target.key,
      })
    } catch (error) {
      btn.classList.remove('is-success')
      btn.classList.add('is-error')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: 'FAIL', reason: 'THREW', message: String(error), blockKey: target.key,
      })
    } finally {
      btn.disabled = false
      const timer = window.setTimeout(() => {
        btn.classList.remove('is-loading', 'is-success', 'is-error')
        btn.setAttribute('title', '复制图片')
      }, FEEDBACK_RESET_MS)
      this.resetTimers.set(btn, timer)
    }
  }

  private showImageBar(target: ContentBlockTarget): void {
    this.imageTarget = target
    const rect = target.element.getBoundingClientRect()
    const barW = this.imageBar.offsetWidth || 32
    const barH = this.imageBar.offsetHeight || 30
    const small = rect.width < 140 || rect.height < 64
    const left = Math.round(rect.right - barW - 8)
    const top = Math.round(small ? rect.top - barH - 8 : rect.top + 8)
    this.imageBar.style.display = ''
    this.imageBar.style.left = `${Math.max(4, left)}px`
    this.imageBar.style.top = `${Math.max(4, top)}px`
    this.imageVisible = true
  }

  private dropImageBar(): void {
    if (this.imageHideTimer !== null) {
      window.clearTimeout(this.imageHideTimer)
      this.imageHideTimer = null
    }
    if (!this.imageVisible) return
    this.imageVisible = false
    this.imageTarget = null
    this.imageBar.style.display = 'none'
  }

  private scheduleImageHide(): void {
    if (!this.imageVisible) return
    this.cancelImageHide()
    this.imageHideTimer = window.setTimeout(() => {
      this.imageHideTimer = null
      this.dropImageBar()
    }, 180)
  }

  private cancelImageHide(): void {
    if (this.imageHideTimer !== null) {
      window.clearTimeout(this.imageHideTimer)
      this.imageHideTimer = null
    }
  }

  // ── 事件 ───────────────────────────────────────────────────

  private attachSurface(): void {
    this.detachSurface()
    const root = this.opts.getEditorRoot()
    if (!root) return
    this.boundRoot = root
    root.addEventListener('pointerover', this.onPointerOver, { passive: true } as AddEventListenerOptions)
    root.addEventListener('pointerout', this.onPointerOut, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusin', this.onFocusIn, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusout', this.onFocusOut, { passive: true } as AddEventListenerOptions)
    root.addEventListener('pointerdown', this.onPointerDown, { passive: true, capture: true } as AddEventListenerOptions)
  }

  private detachSurface(): void {
    const root = this.boundRoot
    if (root) {
      root.removeEventListener('pointerover', this.onPointerOver)
      root.removeEventListener('pointerout', this.onPointerOut)
      root.removeEventListener('focusin', this.onFocusIn)
      root.removeEventListener('focusout', this.onFocusOut)
      root.removeEventListener('pointerdown', this.onPointerDown, true)
    }
    this.boundRoot = null
  }

  private handlePointerOver(ev: Event): void {
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    this.cancelImageHide()
    if (!target) return
    if (target.kind === 'image') this.showImageBar(target)
  }

  private handlePointerOut(ev: Event): void {
    if (!this.imageVisible) return
    const related = (ev as PointerEvent).relatedTarget
    if (related instanceof Node) {
      if (this.imageBar.contains(related)) return
      if (this.imageTarget?.block.contains(related)) return
    }
    this.scheduleImageHide()
  }

  private handleFocusIn(ev: Event): void {
    // 工具栏自身的焦点不属于“进入代码块”：不得据此阻断折叠或触发自动展开。
    if (ev.target instanceof Element && ev.target.closest(`[${CONTENT_TOOLBAR_ATTR}]`)) return
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    this.lastFocusedKey = target && target.kind === 'code' ? target.key : null
    if (!target || target.kind !== 'code') return
    const view = this.views.get(target.key)
    if (view?.folded) {
      // 只有“焦点落点会让光标/选区不可见”时才自动展开。窗口重新激活时 Typora 会
      // 把焦点还给代码文本域；若光标仍在预览可见行内，保持折叠，避免折叠被无关
      // 的 focus 事件悄悄反向展开（表现为“折叠时灵时不灵”）。
      const caret = this.caretSnapshot(view)
      if (caret.hiddenByPreview !== false) {
        this.setCollapsed(view, false, null, 'UNFOLDED:FOCUS_ENTERED_FOLDED_BLOCK')
      } else {
        this.opts.emitAudit?.('FOLD-FOCUS-KEPT', {
          blockKey: view.key, previewLines: view.previewLines, caret,
        })
      }
    }
    this.syncGeometry()
  }

  private handlePointerDown(ev: Event): void {
    // 工具栏按钮上的按下不属于“进入代码块”，不得触发自动展开或光标迁移。
    if (ev.target instanceof Element && ev.target.closest(`[${CONTENT_TOOLBAR_ATTR}]`)) return
    if (this.session.size === 0) return
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (!target || target.kind !== 'code') return
    const view = this.views.get(target.key)
    if (view?.folded) {
      this.setCollapsed(view, false, null, 'UNFOLDED:POINTER_DOWN_ON_FOLDED_BLOCK')
    }
  }

  /** 按钮按下不转移焦点：编辑器光标/选区不被工具栏改写。 */
  private bindButtonFocusGuard(btn: HTMLElement): void {
    const keep = (ev: Event): void => { ev.preventDefault() }
    btn.addEventListener('pointerdown', keep)
    btn.addEventListener('mousedown', keep)
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

  private previewLines(): number {
    try {
      const value = this.opts.getPreviewLines?.()
      return value === 5 ? 5 : DEFAULT_PREVIEW_LINES
    } catch {
      return DEFAULT_PREVIEW_LINES
    }
  }
}

function rectTuple(rect: DOMRect): [number, number, number, number] {
  return [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ]
}
