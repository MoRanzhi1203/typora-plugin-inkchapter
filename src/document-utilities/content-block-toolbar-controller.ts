/**
 * 内容块工具栏 — V3 控制器。
 *
 * V3 结构（参考 CSDN 代码块）：
 *   [代码题注（墨章题注，文档内容，第一行）]
 *   [语言栏（块内顶部）：语言徽标 + 真实语言 + 行数 | 复制完整代码]
 *   [代码正文（可预览式折叠）]
 *   [折叠条（块外下方）：展开剩余 N 行 / 收起至预览]
 *
 * 约束（与 V1/V2 相同，不放松）：
 * - 只挂到既有 Overlay 根（`[data-inkchapter-utility-root]`），绝不插入 #write；
 * - 定位复用宿主几何调度；不新增 ResizeObserver / MutationObserver / 轮询；
 * - 折叠只改可视投影（属性 + CSS 变量），不改 Markdown / CodeMirror 模型 / Undo；
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
/** 可折叠块标记：为该 PRE 预留底部折叠带（纯视觉，不改 Markdown）。 */
export const CODE_FOLDABLE_ATTR = 'data-inkchapter-code-foldable'
export const CODE_FOLD_ATTR = 'data-inkchapter-code-folded'
export const CODE_FOLD_SUMMARY_ATTR = 'data-inkchapter-fold-summary'
/** 语言栏存在标记（CSS 用它为代码块预留顶部内边距）。 */
export const CODE_LANGBAR_ATTR = 'data-inkchapter-langbar'
/** 折叠预览行数（5 | 10）。 */
export const CODE_FOLD_PREVIEW_ATTR = 'data-inkchapter-fold-preview'
/** 折叠预览高度（CSS 变量，作用在 `.CodeMirror` 上）。 */
export const CODE_FOLD_HEIGHT_VAR = '--ink-fold-preview-height'
export const FOLD_BAR_CLASS = 'inkchapter-code-foldbar'

const LANGBAR_HEIGHT_PX = 30
const FOLDBAR_HEIGHT_PX = 28
/** 折叠条在底部折叠带内的上/下留白（带高见 CSS `--ink-fold-band`）。 */
const FOLDBAR_INSET_PX = 4
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
  /** V3 — 折叠预览行数（5 | 10）。 */
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
  foldBar: HTMLDivElement
  foldBtn: HTMLButtonElement
  folded: boolean
  previewLines: number
  totalLines: number
  lastLeft: number
  lastTop: number
  lastFoldTop: number
  shownAudited: boolean
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

function rectTuple(rect: DOMRect): [number, number, number, number] {
  return [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ]
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

  /** 每次既有 geometry pass 调用（无新增调度器）。 */
  syncGeometry(): void {
    if (this.disposed || !this.mounted) return
    const root = this.boundRoot
    if (!root) return

    const previewLines = this.previewLines()
    const fences = Array.from(root.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR))
    const seen = new Set<string>()
    const viewportW = window.innerWidth || root.ownerDocument?.documentElement?.clientWidth || 0
    const viewportH = window.innerHeight || root.ownerDocument?.documentElement?.clientHeight || 0

    for (const fence of fences) {
      const target = resolveContentBlockTargetFromElement(fence, root)
      if (!target || target.kind !== 'code') continue
      seen.add(target.key)
      if (this.views.size >= MAX_VIEWS && !this.views.has(target.key)) continue

      const rect = fence.getBoundingClientRect()
      const onScreen = rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < viewportH && rect.right > 0 && rect.left < viewportW
      if (!onScreen || !isTargetRenderable(fence)) {
        const existing = this.views.get(target.key)
        if (existing) this.hideView(existing)
        continue
      }

      const view = this.ensureView(target)
      // 先同步内容（语言 / 行数 / 折叠态 / 折叠带），重新测量后再布局：
      // 折叠带通过 padding 预留空间，必须在同一帧内计入 rect，否则折叠条会压住代码。
      this.syncViewContent(view, target, previewLines)
      this.layoutView(view, fence.getBoundingClientRect(), previewLines)
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
  }

  /**
   * 既有 scroll 监听驱动：V3 不再隐藏语言栏，而是同帧重定位
   * （折叠条与语言栏都随内容移动），保持滚动后稳定。
   */
  onEditorScroll(): void {
    if (this.disposed || this.views.size === 0) return
    this.dropImageBar()
    if (this.scrollRaf !== null) return
    try {
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null
        this.syncGeometry()
      })
    } catch {
      this.scrollRaf = null
      this.syncGeometry()
    }
  }

  isVisible(): boolean {
    return this.imageVisible || Array.from(this.views.values()).some(v => v.bar.style.display !== 'none')
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
    if (existing && existing.fence === target.element) return existing

    const doc = this.root.ownerDocument ?? document
    const bar = doc.createElement('div')
    bar.className = `${CONTENT_TOOLBAR_CLASS} ${CONTENT_TOOLBAR_CLASS}--langbar`
    bar.setAttribute(CONTENT_TOOLBAR_ATTR, 'true')
    bar.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', '代码块语言与复制')
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
    copyBtn.setAttribute('aria-label', '复制完整代码')
    copyBtn.setAttribute('title', '复制完整代码')
    copyBtn.innerHTML = iconSvg('copy', `${CONTENT_TOOLBAR_CLASS}__icon`)
    bar.append(badge, lang, lines, copyBtn)

    const foldBar = doc.createElement('div')
    foldBar.className = FOLD_BAR_CLASS
    foldBar.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    foldBar.setAttribute('contenteditable', 'false')
    foldBar.setAttribute('data-block-key', target.key)
    foldBar.style.display = 'none'
    const foldBtn = doc.createElement('button')
    foldBtn.type = 'button'
    foldBtn.className = `${FOLD_BAR_CLASS}__btn`
    foldBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    foldBar.appendChild(foldBtn)

    this.root.append(bar, foldBar)
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
      foldBar,
      foldBtn,
      folded: false,
      previewLines: DEFAULT_PREVIEW_LINES,
      totalLines: 0,
      lastLeft: Number.NaN,
      lastTop: Number.NaN,
      lastFoldTop: Number.NaN,
      shownAudited: false,
    }

    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      void this.copyCode(view)
    })
    foldBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      this.toggleFold(view)
    })

    target.element.setAttribute(CODE_LANGBAR_ATTR, 'true')
    this.views.set(target.key, view)
    return view
  }

  private destroyView(view: CodeBlockView): void {
    view.fence.removeAttribute(CODE_LANGBAR_ATTR)
    view.fence.removeAttribute(CODE_FOLDABLE_ATTR)
    view.bar.remove()
    view.foldBar.remove()
    const timer = this.resetTimers.get(view.copyBtn)
    if (timer !== undefined) window.clearTimeout(timer)
    this.resetTimers.delete(view.copyBtn)
  }

  private hideView(view: CodeBlockView): void {
    view.bar.style.display = 'none'
    view.foldBar.style.display = 'none'
  }

  // ── 布局 ───────────────────────────────────────────────────

  private layoutView(view: CodeBlockView, rect: DOMRect, previewLines: number): void {
    const left = Math.round(rect.left)
    const top = Math.round(rect.top)
    const width = Math.max(60, Math.round(rect.width))

    const bar = view.bar
    bar.style.display = ''
    bar.style.left = `${left}px`
    bar.style.top = `${top}px`
    bar.style.width = `${width}px`
    bar.style.height = `${LANGBAR_HEIGHT_PX}px`

    const showFoldBar = view.totalLines > previewLines
    // 折叠条落在 PRE 的底部折叠带内（带由 syncViewContent 提前写入）。
    const foldTop = Math.round(rect.bottom - FOLDBAR_HEIGHT_PX - FOLDBAR_INSET_PX)
    view.foldBar.style.display = showFoldBar ? '' : 'none'
    if (showFoldBar) {
      view.foldBar.style.left = `${left}px`
      view.foldBar.style.top = `${foldTop}px`
      view.foldBar.style.width = `${width}px`
      view.foldBar.style.height = `${FOLDBAR_HEIGHT_PX}px`
    }

    if (!view.shownAudited) {
      view.shownAudited = true
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-SHOW', {
        blockKey: view.key,
        kind: 'code',
        mode: 'langbar',
        anchorRect: rectTuple(rect),
        toolbarRect: [left, top, width, LANGBAR_HEIGHT_PX],
        foldBarRect: showFoldBar ? [left, foldTop, width, FOLDBAR_HEIGHT_PX] : null,
        belowCaptionLine: top - Math.round(rect.top),
        insideAnchorRight: Math.round(rect.right) - (left + width),
        insideAnchorBottom: Math.round(rect.bottom) - top,
        captionLabel: view.fence.getAttribute('data-inkchapter-caption-label'),
        buttonCount: 1,
      })
      view.lastLeft = left
      view.lastTop = top
      view.lastFoldTop = foldTop
      return
    }

    if (view.lastLeft !== left || view.lastTop !== top || (showFoldBar && view.lastFoldTop !== foldTop)) {
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-REPOSITION', {
        blockKey: view.key,
        from: [view.lastLeft, view.lastTop],
        to: [left, top],
        anchorRect: rectTuple(rect),
        foldBarRect: showFoldBar ? [left, foldTop, width, FOLDBAR_HEIGHT_PX] : null,
      })
      view.lastLeft = left
      view.lastTop = top
      view.lastFoldTop = foldTop
    }
  }

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
    // 折叠带必须在测量 rect 之前落到 PRE 上，否则底部内边距不会计入本次布局。
    if (total > previewLines) view.fence.setAttribute(CODE_FOLDABLE_ATTR, 'true')
    else view.fence.removeAttribute(CODE_FOLDABLE_ATTR)
    this.syncFoldButton(view)
  }

  // ── 折叠（预览式） ─────────────────────────────────────────

  private applyFoldProjection(view: CodeBlockView, previewLines: number): void {
    const lineHeight = this.measureLineHeight(view.fence)
    const height = Math.max(24, Math.round(previewLines * lineHeight + 6))
    view.fence.classList.add(CODE_FOLD_CLASS)
    view.fence.setAttribute(CODE_FOLD_ATTR, 'true')
    view.fence.setAttribute(CODE_FOLD_PREVIEW_ATTR, String(previewLines))
    view.fence.setAttribute(CODE_FOLD_SUMMARY_ATTR, `已折叠 · ${previewLines} 行`)
    view.fence.style.setProperty(CODE_FOLD_HEIGHT_VAR, `${height}px`)
  }

  private clearFoldProjection(view: CodeBlockView): void {
    view.folded = false
    view.fence.classList.remove(CODE_FOLD_CLASS)
    view.fence.removeAttribute(CODE_FOLD_ATTR)
    view.fence.removeAttribute(CODE_FOLD_PREVIEW_ATTR)
    view.fence.removeAttribute(CODE_FOLD_SUMMARY_ATTR)
    view.fence.style.removeProperty(CODE_FOLD_HEIGHT_VAR)
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
    const remaining = Math.max(0, view.totalLines - view.previewLines)
    // 折叠态提示“展开剩余 N 行”，展开态提示“收起至预览”。
    const label = view.folded ? `展开剩余 ${remaining} 行` : '收起至预览'
    const signature = `${view.folded}|${label}`
    if (view.foldBtn.getAttribute('data-signature') === signature) return
    view.foldBtn.setAttribute('data-signature', signature)
    view.foldBtn.setAttribute('aria-expanded', view.folded ? 'false' : 'true')
    view.foldBtn.setAttribute('title', label)
    view.foldBtn.innerHTML = `${view.folded
      ? iconSvg('chevron-down', `${FOLD_BAR_CLASS}__icon`)
      : iconSvg('chevron-up', `${FOLD_BAR_CLASS}__icon`)}<span>${label}</span>`
  }

  private toggleFold(view: CodeBlockView): void {
    if (view.totalLines <= view.previewLines) {
      this.setCopyState(view, 'idle')
      return
    }
    if (view.folded) {
      this.session.clearFold(view.key)
      this.clearFoldProjection(view)
      this.syncFoldButton(view)
      this.opts.onLayoutInvalidated('content-block-unfold')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
        decision: 'PASS',
        reason: 'UNFOLDED:PREVIEW_TOGGLE',
        blockKey: view.key,
      })
      this.syncGeometry()
      return
    }

    const caretInside = this.selectionInside(view.fence)
    const recentlyFocused = this.lastFocusedKey === view.key
    if (caretInside || recentlyFocused) {
      view.foldBtn.classList.add('is-error')
      view.foldBtn.setAttribute('title', '光标位于该代码块内，无法折叠')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
        decision: 'BLOCKED',
        reason: 'CARET_OR_SELECTION_INSIDE',
        caretInsideNow: caretInside,
        recentlyFocused,
        blockKey: view.key,
      })
      const timer = window.setTimeout(() => {
        view.foldBtn.classList.remove('is-error')
        this.syncFoldButton(view)
      }, FEEDBACK_RESET_MS)
      this.resetTimers.set(view.foldBtn, timer)
      return
    }

    this.session.setFold({ key: view.key, lineCount: view.totalLines, documentKey: null })
    view.folded = true
    this.applyFoldProjection(view, view.previewLines)
    this.syncFoldButton(view)
    this.opts.onLayoutInvalidated('content-block-fold')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
      decision: 'PASS',
      reason: 'FOLDED_PREVIEW',
      previewLines: view.previewLines,
      totalLines: view.totalLines,
      blockKey: view.key,
    })
    this.syncGeometry()
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
      btn.setAttribute('title', '复制完整代码')
      btn.setAttribute('aria-label', '复制完整代码')
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
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    this.lastFocusedKey = target && target.kind === 'code' ? target.key : null
    if (!target || target.kind !== 'code') return
    const view = this.views.get(target.key)
    if (view?.folded) {
      // 折叠块获得焦点 → 自动展开，避免输入落进不可见区域。
      this.session.clearFold(view.key)
      this.clearFoldProjection(view)
      this.syncFoldButton(view)
      this.opts.onLayoutInvalidated('content-block-unfold')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
        decision: 'PASS',
        reason: 'UNFOLDED:FOCUS_ENTERED_FOLDED_BLOCK',
        blockKey: view.key,
      })
    }
    this.syncGeometry()
  }

  private handlePointerDown(ev: Event): void {
    if (this.session.size === 0) return
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (!target || target.kind !== 'code') return
    const view = this.views.get(target.key)
    if (view?.folded) {
      this.session.clearFold(view.key)
      this.clearFoldProjection(view)
      this.syncFoldButton(view)
      this.opts.onLayoutInvalidated('content-block-unfold')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-FOLD', {
        decision: 'PASS',
        reason: 'UNFOLDED:POINTER_DOWN_ON_FOLDED_BLOCK',
        blockKey: view.key,
      })
    }
  }

  /** 按钮按下不转移焦点：编辑器光标/选区不被浮层改写。 */
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
