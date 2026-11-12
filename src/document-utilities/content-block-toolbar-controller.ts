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
import { codeContentSignature, codeFenceOrdinal, lookupFenceSource } from './content-block-toolbar-code-source'
import { ContentBlockToolbarSession } from './content-block-toolbar-session'
import { buildImageActions, type ImageActionAvailability } from './content-block-toolbar-image-actions'
import {
  clipEditorRect,
  computeImageToolbarPlacement,
} from './content-block-toolbar-image-placement'

export const CONTENT_TOOLBAR_CLASS = 'inkchapter-content-toolbar'
export const CONTENT_TOOLBAR_ATTR = 'data-inkchapter-content-toolbar'
/** 图片操作条的稳定锚点：Typora 的 `.md-image` 包裹层（无则退回业务块）。 */
export const IMAGE_ANCHOR_CLASS = 'inkchapter-image-actions-anchor'
/** 图片被点击/选中时保持操作条可见。 */
export const IMAGE_SELECTED_CLASS = 'inkchapter-image-actions-selected'
/** 操作条可见状态（CSS 与测试共用）。 */
export const IMAGE_BAR_VISIBLE_ATTR = 'data-visible'
export const CODE_FOLD_CLASS = 'inkchapter-code-folded'
export const CODE_FOLD_ATTR = 'data-inkchapter-code-folded'
export const CODE_FOLD_SUMMARY_ATTR = 'data-inkchapter-fold-summary'
/** 语言栏存在标记（CSS 用它为代码块预留顶部内边距）。 */
export const CODE_LANGBAR_ATTR = 'data-inkchapter-langbar'

/** 节点本身是不是一个已渲染的代码块 PRE。 */
function isCodeFenceNode(node: Node): boolean {
  return node.nodeType === 1 && (node as HTMLElement).matches(CODE_BLOCK_SELECTOR)
}

/** 节点是不是本插件自己的语言栏（被 Typora 重建 PRE 时判定为“需要补挂”）。 */
function isOwnToolbarNode(node: Node): boolean {
  return node.nodeType === 1 && (node as HTMLElement).classList.contains(CONTENT_TOOLBAR_CLASS)
}
/** 折叠预览行数（5 | 10）。 */
export const CODE_FOLD_PREVIEW_ATTR = 'data-inkchapter-fold-preview'
/**
 * 可折叠标记（显示顶部/底边折叠入口）。
 * 仅用于「下方题注避让」这类展示层选择器，不参与折叠状态判定。
 */
export const CODE_FOLD_CONTROL_ATTR = 'data-inkchapter-fold-control'
/** 折叠预览高度（CSS 变量，作用在 `.CodeMirror` 上）。 */
export const CODE_FOLD_HEIGHT_VAR = '--ink-fold-preview-height'
/**
 * 折叠后仍存在“预览区之外”的诊断时置为 `true`。
 * 用于底部细色带提示，不显示数量、不占用语言栏空间。
 */
export const CODE_FOLD_DIAG_ATTR = 'data-inkchapter-fold-diag'

const DEFAULT_PREVIEW_LINES = 10
const FEEDBACK_RESET_MS = 1600
const MAX_VIEWS = 80
/** jsdom / 隐藏态下测不到 offsetWidth 时的保守尺寸。 */
const IMAGE_BAR_FALLBACK_WIDTH = 64
const IMAGE_BAR_FALLBACK_HEIGHT = 32

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

export type ImageAssetMenuDestination = 'project' | 'library' | 'offline' | 'custom'

/** 图片资产扩展动作（图名 + 下载）；缺省时保持原有复制菜单。 */
export interface ContentBlockToolbarImageAssetActions {
  /** 当前图片是否已有图名；null 表示无法解析。 */
  getFigureNameState?: (img: HTMLImageElement) => { named: boolean } | null
  /** 打开图名设置/编辑/清除；返回 false 表示目标不可用。 */
  requestFigureName?: (img: HTMLImageElement, mode: 'set' | 'edit' | 'clear') => boolean
  /** 当前可用的下载目标；用于决定菜单项显隐。 */
  downloadTargets?: () => ImageAssetMenuDestination[]
  /** 执行下载；replaceReference 仅在用户显式选择时传 true。 */
  download?: (input: {
    img: HTMLImageElement
    url: string
    destination: ImageAssetMenuDestination
    replaceReference: boolean
  }) => Promise<{ ok: boolean; message: string }>
}

export interface ContentBlockToolbarOptions {
  getEditorRoot: () => HTMLElement | null
  getMarkdown: () => string | null
  actions: ContentBlockToolbarActions
  imageAssetActions?: ContentBlockToolbarImageAssetActions
  /** 折叠导致布局变化 → 交由既有几何调度刷新。 */
  onLayoutInvalidated: (reason: string) => void
  emitAudit?: (event: string, payload: Record<string, unknown>) => void
  /** 折叠预览行数（5 | 10）。 */
  getPreviewLines?: () => 5 | 10
  /** 折叠代码块内的文本真正变化时（输入 / 空格 / Tab / 删除 / 粘贴 /
   * 程序化替换），是否自动完整展开。
   * 默认 `true`；关闭后只能通过顶部展开按钮或诊断定位展开。
   * 纯点击、选中、光标移动不改变折叠状态。
   */
  getAutoExpandOnEdit?: () => boolean
  /** 当前文档目录：用于把图片相对路径解析为“复制本地路径”的绝对路径。 */
  getDocumentDir?: () => string | null
  /**
   * 代码块只读行级标记（按围栏序号）。空行区段用行号侧标记，全角标点用文本下划线。
   * 只使用 CodeMirror 公开 API，不插入文本、不改文档模型。
   */
  getBlockDiagnosticMarks?: (ordinal: number) => CodeDiagnosticMark[]
}

/** 只读诊断标记（行/列 1 基）。 */
export interface CodeDiagnosticMark {
  ruleId: string
  severity: 'error' | 'warning' | 'hint'
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  /** 空行区段：逐行加行号侧标记；否则对文本范围加下划线。 */
  blank: boolean
  /**
   * 生成该诊断时的代码内容签名（CodeMirror 源文本）。显示层只允许绘制与
   * 当前 CM 内容签名一致的标记；缺省表示提供方无版本信息（兼容旧调用）。
   */
  contentSignature?: string
}

/** CodeMirror 5 的公开装饰能力子集（缺失即安全跳过）。 */
interface CodeMirrorDecorateLike {
  markText?: (
    from: { line: number; ch: number },
    to: { line: number; ch: number },
    opts: { className: string },
  ) => { clear(): void } | null
  addLineClass?: (line: number, where: string, cls: string) => unknown
  removeLineClass?: (lineOrHandle: unknown, where: string, cls: string) => void
  getLine?: (line: number) => string | null
  lineCount?: () => number
  getValue?: () => string
  on?: (event: string, handler: () => void) => void
  off?: (event: string, handler: () => void) => void
}

const DIAG_BLANK_CLASS = 'inkchapter-code-diag-blank'
const DIAG_RANGE_CLASS = 'inkchapter-code-diag-range'
const DIAG_HINT_CLASS = 'inkchapter-code-diag-hint'

interface CodeBlockView {
  key: string
  fence: HTMLElement
  bar: HTMLDivElement
  badge: HTMLSpanElement
  lang: HTMLSpanElement
  lines: HTMLSpanElement
  /** 当前围栏在编辑器根内的序号（诊断标记用）。 */
  ordinal: number | null
  copyBtn: HTMLButtonElement
  foldBtn: HTMLButtonElement
  /**
   * 底边中央的折叠控制（与顶部语言栏按钮同属一个折叠状态）。
   * 挂在 PRE 内部、绝对定位，不参与布局，也不进入 CodeMirror 模型。
   */
  bottomBtn: HTMLButtonElement
  /** 底边控制的一次性几何审计是否已发出。 */
  bottomAudited: boolean
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
  /** 已应用的诊断标记签名（相同则不重复写入，避免 DOM 抖动）。 */
  diagMarkSignature: string
  /** 可清理的 CodeMirror 文本标记句柄。 */
  diagMarks: Array<{ clear(): void }>
  /** 已添加的行号侧标记（按 addLineClass 返回的句柄移除；行索引会漂移）。 */
  diagLineClasses: Array<{ handle: unknown; cls: string }>
  /** 标记所属的 CodeMirror 实例（实例重建后旧句柄不再可用）。 */
  diagMarkCm: object | null
  /** `diagChangeHandler` 注册在哪个 CM 实例上（实例重建后必须重新注册）。 */
  diagChangeCm: object | null
  /** CM 内容变化监听（内容一变立即作废旧标记，等待新快照）。 */
  diagChangeHandler: (() => void) | null
  /** 当前诊断是否存在“折叠预览区之外”的行（决定底部提示色带）。 */
  diagHiddenBeyondPreview: boolean
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
    : name === 'more'
      ? '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"></path>'
      : name === 'chevron-down'
        ? '<polyline points="6 9 12 15 18 9"></polyline>'
        : name === 'chevron-up'
          ? '<polyline points="18 15 12 9 6 15"></polyline>'
          : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>'
            + '<circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
  return `<svg class="${cls}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** 把剪贴板/资源错误码翻译成可理解的中文。 */
export function imageCopyFailureText(reason: string | null | undefined): string {
  switch (reason) {
    case 'IMAGE_ELEMENT_MISSING': return '未找到图片元素'
    case 'IMAGE_NOT_LOADED': return '图片尚未加载完成'
    case 'RESOURCE_UNRESOLVED': return '无法解析图片地址'
    case 'REMOTE_FETCH_FAILED': return '远程图片下载失败'
    case 'IMAGE_DECODE_FAILED': return '图片解码失败'
    case 'CANVAS_TAINTED': return '远程图片受跨域限制'
    case 'CANVAS_UNAVAILABLE': return '当前环境无法绘制图片'
    case 'CLIPBOARD_UNAVAILABLE': return '剪贴板不可用'
    case 'CLIPBOARD_WRITE_FAILED': return '剪贴板写入失败'
    case 'CLIPBOARD_VERIFY_FAILED': return '剪贴板校验失败'
    case 'CLIPBOARD_ITEM_UNAVAILABLE': return '当前环境不支持图片剪贴板'
    case 'UNKNOWN_ERROR': return '未知错误'
    default: return reason ? String(reason) : '未知错误'
  }
}

/** 图片加载失败：已完成加载但没有任何像素。 */
export function isImageLoadFailed(img: HTMLImageElement | null): boolean {
  if (!img) return false
  return img.complete === true && (img.naturalWidth === 0 || img.naturalHeight === 0)
}

export class ContentBlockToolbarController {
  private readonly views = new Map<string, CodeBlockView>()
  private readonly session = new ContentBlockToolbarSession()
  private readonly imageBar: HTMLDivElement
  private readonly imageBtn: HTMLButtonElement
  private readonly imageMoreBtn: HTMLButtonElement
  private readonly imageFeedback: HTMLSpanElement
  private readonly imageMenu: HTMLDivElement

  private mounted = false
  private disposed = false
  private boundRoot: HTMLElement | null = null
  private lastFocusedKey: string | null = null
  private imageTarget: ContentBlockTarget | null = null
  private imageVisible = false
  private imageSelected = false
  private imageActions: ImageActionAvailability = { localPath: null, remoteUrl: null, markdown: null }
  private imageFigureNamed = false
  private imageAnchorEl: HTMLElement | null = null
  private imageOrdinal = -1
  private imageAlt = ''
  private imageMenuOpen = false
  private imageHideTimer: number | null = null
  private imageFeedbackTimer: number | null = null
  private watchedImage: HTMLImageElement | null = null
  private imageSizeHandler: (() => void) | null = null
  private scrollRaf: number | null = null
  private imagePositionRaf: number | null = null
  private lastViewportW = 0
  private actionSeq = 0
  private resetTimers = new Map<HTMLElement, number>()
  /** CodeMirror 实例代次：实例被重建时让诊断标记签名失效。 */
  private readonly cmGenerations = new WeakMap<object, number>()
  private cmGenerationSeq = 0
  /** 代码块被 Typora 重建时，在同一帧内把语言栏挂回去（避免“消失后重现”）。 */
  private fenceObserver: MutationObserver | null = null
  private immediateSyncScheduled = false

  private readonly onPointerOver: (ev: Event) => void
  private readonly onPointerOut: (ev: Event) => void
  private readonly onImageBarPointerEnter: (ev: Event) => void
  private readonly onImageBarPointerOver: (ev: Event) => void
  private readonly onImageBarPointerLeave: (ev: Event) => void
  private readonly onPointerDown: (ev: Event) => void
  private readonly onFocusIn: (ev: Event) => void
  private readonly onFocusOut: (ev: Event) => void

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ContentBlockToolbarOptions,
  ) {
    const doc = root.ownerDocument ?? document

    // 图片：单实例操作条，挂在插件 overlay 根（`document.body` 下），绝不进入 `#write`，
    // 因此不会被 Typora 的 Markdown 序列化带进正文。
    this.imageBar = doc.createElement('div')
    this.imageBar.className = `${CONTENT_TOOLBAR_CLASS} ${CONTENT_TOOLBAR_CLASS}--image`
    this.imageBar.setAttribute(CONTENT_TOOLBAR_ATTR, 'true')
    this.imageBar.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageBar.setAttribute('role', 'toolbar')
    this.imageBar.setAttribute('aria-label', '图片快捷操作')
    this.imageBar.setAttribute('contenteditable', 'false')
    this.imageBar.setAttribute(IMAGE_BAR_VISIBLE_ATTR, 'false')
    this.imageBtn = doc.createElement('button')
    this.imageBtn.type = 'button'
    this.imageBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn ${CONTENT_TOOLBAR_CLASS}__btn--image-copy`
    this.imageBtn.setAttribute('data-action', 'copy-image')
    this.imageBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageBtn.setAttribute('aria-label', '复制图片')
    this.imageBtn.setAttribute('title', '复制图片')
    this.imageBtn.innerHTML = iconSvg('copy', `${CONTENT_TOOLBAR_CLASS}__icon`)
    this.imageBar.appendChild(this.imageBtn)
    this.bindButtonFocusGuard(this.imageBtn)
    this.imageBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      void this.copyImage()
    })

    this.imageFeedback = doc.createElement('span')
    this.imageFeedback.className = `${CONTENT_TOOLBAR_CLASS}__feedback`
    this.imageFeedback.setAttribute('role', 'status')
    this.imageFeedback.setAttribute('aria-live', 'polite')
    this.imageBar.appendChild(this.imageFeedback)

    this.imageMoreBtn = doc.createElement('button')
    this.imageMoreBtn.type = 'button'
    this.imageMoreBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn ${CONTENT_TOOLBAR_CLASS}__btn--image-more`
    this.imageMoreBtn.setAttribute('data-action', 'more-image-actions')
    this.imageMoreBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageMoreBtn.setAttribute('aria-label', '更多图片操作')
    this.imageMoreBtn.setAttribute('title', '更多图片操作')
    this.imageMoreBtn.setAttribute('aria-haspopup', 'menu')
    this.imageMoreBtn.setAttribute('aria-expanded', 'false')
    this.imageMoreBtn.hidden = true
    this.imageMoreBtn.innerHTML = iconSvg('more', `${CONTENT_TOOLBAR_CLASS}__icon`)
    this.imageBar.appendChild(this.imageMoreBtn)
    this.bindButtonFocusGuard(this.imageMoreBtn)
    this.imageMoreBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      this.toggleImageMenu()
    })

    this.imageMenu = doc.createElement('div')
    this.imageMenu.className = `${CONTENT_TOOLBAR_CLASS}__menu`
    this.imageMenu.setAttribute('role', 'menu')
    this.imageMenu.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    this.imageMenu.setAttribute('contenteditable', 'false')
    this.imageMenu.hidden = true
    this.imageBar.appendChild(this.imageMenu)
    // overlay 根在 #write 之外：图片与操作条之间还隔着 7px 空隙，
    // 从图片移向操作条时编辑器先收到 pointerout 并启动隐藏计时，
    // 而操作条自身的 pointerover 不会冒泡到编辑器根。因此必须给操作条
    // 独立绑定进入事件取消隐藏，否则把鼠标移到按钮上时面板会消失。
    this.onImageBarPointerEnter = () => this.cancelImageHide()
    this.onImageBarPointerOver = () => this.cancelImageHide()
    this.onImageBarPointerLeave = (ev) => this.handleImageBarPointerLeave(ev)
    this.imageBar.addEventListener('pointerenter', this.onImageBarPointerEnter)
    this.imageBar.addEventListener('pointerover', this.onImageBarPointerOver)
    this.imageBar.addEventListener('pointerleave', this.onImageBarPointerLeave)

    this.onPointerOver = (ev) => this.handlePointerOver(ev)
    this.onPointerOut = (ev) => this.handlePointerOut(ev)
    this.onPointerDown = (ev) => this.handlePointerDown(ev)
    this.onFocusIn = (ev) => this.handleFocusIn(ev)
    this.onFocusOut = (ev) => this.handleFocusOut(ev)
  }

  // ── 生命周期 ───────────────────────────────────────────────

  mount(): void {
    if (this.mounted || this.disposed) return
    this.mounted = true
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
    this.imageBar.removeEventListener('pointerenter', this.onImageBarPointerEnter)
    this.imageBar.removeEventListener('pointerover', this.onImageBarPointerOver)
    this.imageBar.removeEventListener('pointerleave', this.onImageBarPointerLeave)
    this.cancelImageHide()
    this.clearImageFeedback()
    this.closeImageMenu()
    this.releaseImageAnchor()
    if (this.scrollRaf !== null) {
      try { cancelAnimationFrame(this.scrollRaf) } catch { /* noop */ }
      this.scrollRaf = null
    }
    if (this.imagePositionRaf !== null) {
      try { cancelAnimationFrame(this.imagePositionRaf) } catch { /* noop */ }
      this.imagePositionRaf = null
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
    this.imageSelected = false
    this.clearImageFeedback()
    this.closeImageMenu()
    this.releaseImageAnchor()
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

    this.syncFenceViews()

    // 窗口/侧栏宽度变化后复用同一几何 pass 重新定位图片操作条（无新增观察器）。
    if (this.imageVisible && this.imageTarget) this.positionImageBar()
    this.auditViewportLayout()
  }

  /**
   * 语言栏视图同步（唯一入口）。既由几何 pass 调用，也由代码块结构变更的
   * 微任务调用，因此语言栏与代码块在同一帧出现。
   */
  private syncFenceViews(): void {
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
  }

  /**
   * 代码块结构变更：Typora 重建 PRE 或重新挂载 CodeMirror 时，语言栏被一并移除。
   * 在同一个微任务里补回，避免出现“消失 → 20–40ms 后重现”的空窗。
   * 只对「代码块节点增删」或「我们自己的语言栏被移除」响应，输入型变更不触发。
   */
  private onFenceStructureMutated(records: readonly MutationRecord[]): void {
    if (this.disposed || !this.mounted) return
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (isCodeFenceNode(node)) {
          this.scheduleImmediateFenceSync()
          return
        }
      }
      for (const node of Array.from(record.removedNodes)) {
        if (isCodeFenceNode(node) || isOwnToolbarNode(node)) {
          this.scheduleImmediateFenceSync()
          return
        }
      }
    }
  }

  private scheduleImmediateFenceSync(): void {
    if (this.immediateSyncScheduled) return
    this.immediateSyncScheduled = true
    const flush = (): void => {
      this.immediateSyncScheduled = false
      if (this.disposed || !this.mounted) return
      this.syncFenceViews()
    }
    try { queueMicrotask(flush) } catch { flush() }
  }

  /**
   * 既有 scroll 监听驱动：语言栏与代码块同属一个滚动坐标系，
   * 这里不做任何重定位；仅关闭图片浮层并按帧采样“语言栏顶边 - 代码块顶边”的偏差。
   */
  onEditorScroll(): void {
    if (this.disposed) return
    if (!this.imageSelected) this.dropImageBar()
    else if (this.imageVisible && this.imageTarget) this.scheduleImagePosition()
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
        // The rebuilt CM may have dropped our marks: force a re-apply.
        if (!existing.bar.isConnected) {
          existing.fence.appendChild(existing.bar)
          existing.fence.appendChild(existing.bottomBtn)
          this.clearDiagnosticMarks(existing)
        }
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

    // 底边中央的折叠控制：与顶部按钮同源状态，独立入口。
    const bottomBtn = doc.createElement('button')
    bottomBtn.type = 'button'
    bottomBtn.className = `${CONTENT_TOOLBAR_CLASS}__btn ${CONTENT_TOOLBAR_CLASS}__btn--fold-bottom`
    bottomBtn.setAttribute('data-action', 'toggle-fold-bottom')
    bottomBtn.setAttribute('data-inkchapter-ui-root', 'document-utilities')
    bottomBtn.setAttribute('data-block-key', target.key)
    bottomBtn.setAttribute('aria-label', '收起至预览')
    bottomBtn.setAttribute('title', '收起至预览')
    bottomBtn.style.display = 'none'

    this.bindButtonFocusGuard(copyBtn)
    this.bindButtonFocusGuard(foldBtn)
    this.bindButtonFocusGuard(bottomBtn)

    const view: CodeBlockView = {
      key: target.key,
      fence: target.element,
      bar,
      badge,
      lang,
      lines,
      ordinal: null,
      copyBtn,
      foldBtn,
      bottomBtn,
      bottomAudited: false,
      folded: false,
      previewLines: DEFAULT_PREVIEW_LINES,
      totalLines: 0,
      shownAudited: false,
      syncBaselinePx: null,
      actionId: null,
      handledActionId: null,
      diagMarkSignature: '',
      diagMarks: [],
      diagLineClasses: [],
      diagMarkCm: null,
      diagChangeCm: null,
      diagChangeHandler: null,
      diagHiddenBeyondPreview: false,
    }

    copyBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      void this.copyCode(view)
    })
    this.bindFoldControl(view, foldBtn, 'top', target.element)
    this.bindFoldControl(view, bottomBtn, 'bottom', target.element)

    target.element.setAttribute(CODE_LANGBAR_ATTR, 'true')
    target.element.append(bar, bottomBtn)
    this.views.set(target.key, view)
    return view
  }

  /**
   * 顶部语言栏按钮与底边箭头共用的折叠入口。
   *
   * 两个按钮只产生各自的 actionId，状态仍然只由 `toggleFold` → `setCollapsed`
   * 写入；不存在第二套折叠状态。`source` 仅用于审计区分入口。
   */
  private bindFoldControl(
    view: CodeBlockView,
    btn: HTMLButtonElement,
    source: 'top' | 'bottom',
    fenceElement: HTMLElement,
  ): void {
    const suffix = source === 'bottom' ? 'fold-bottom' : 'fold'
    const keyboardSuffix = source === 'bottom' ? 'fold-kb-bottom' : 'fold-kb'
    btn.addEventListener('pointerdown', (ev) => {
      const actionId = `${suffix}-${++this.actionSeq}-${view.key}`
      view.actionId = actionId
      this.auditFoldPointerHit(view, ev, actionId, btn, source)
    })
    btn.addEventListener('pointerup', (ev) => {
      this.opts.emitAudit?.('FOLD-POINTER-UP', {
        actionId: view.actionId,
        blockKey: view.key,
        source,
        detail: ev.detail,
        isTrusted: ev.isTrusted,
        targetTag: (ev.target as Element | null)?.tagName ?? null,
        path: this.eventPathSummary(ev),
        caret: this.caretSnapshot(view),
      })
    })
    btn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      // Keyboard / assistive-technology activation has no pointerdown. It must
      // get a FRESH action id, otherwise it reuses the previous mouse action and
      // is permanently rejected as DUPLICATE_ACTION.
      let actionId = view.actionId
      if (ev.detail === 0) {
        actionId = `${keyboardSuffix}-${++this.actionSeq}-${view.key}`
        view.actionId = actionId
      }
      const caret = this.caretSnapshot(view)
      this.opts.emitAudit?.('FOLD-CLICK-DISPATCH', {
        actionId,
        blockKey: view.key,
        source,
        detail: ev.detail,
        isTrusted: ev.isTrusted,
        folded: view.folded,
        totalLines: view.totalLines,
        previewLines: view.previewLines,
        caretInside: this.selectionInside(view.fence),
        caret,
        path: this.eventPathSummary(ev),
        toolbarConnected: view.bar.isConnected && btn.isConnected,
        fenceIsCurrent: view.fence.isConnected && view.fence === fenceElement,
      })
      this.toggleFold(view, actionId)
    })
  }

  private destroyView(view: CodeBlockView): void {
    this.unbindDiagnosticChange(view)
    this.clearDiagnosticMarks(view)
    view.fence.removeAttribute(CODE_FOLD_DIAG_ATTR)
    view.fence.removeAttribute(CODE_LANGBAR_ATTR)
    view.fence.removeAttribute(CODE_FOLD_CONTROL_ATTR)
    view.bar.remove()
    view.bottomBtn.remove()
    for (const btn of [view.copyBtn, view.foldBtn, view.bottomBtn]) {
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
      bottomRect: rectTuple(view.bottomBtn.getBoundingClientRect()),
      barChildren: view.bar.children.length,
      captionLabel: view.fence.getAttribute('data-inkchapter-caption-label'),
      captionPosition: view.fence.getAttribute('data-inkchapter-caption-position'),
      foldable: view.totalLines > view.previewLines,
      totalLines: view.totalLines,
      previewLines: view.previewLines,
      buttonCount: buttons.length,
      preOverflow,
      dpr: window.devicePixelRatio || 1,
    })
    this.auditBottomControlOnce(view)
  }

  /**
   * 底边折叠箭头的一次性几何审计：证明它只出现在可折叠块、命中区 ≥28×28、
   * 不进入布局，并且不覆盖代码行与后续内容（用真实矩形相交计算，不做推测）。
   */
  private auditBottomControlOnce(view: CodeBlockView): void {
    if (view.bottomAudited) return
    view.bottomAudited = true
    const foldable = view.totalLines > view.previewLines
    const btn = view.bottomBtn
    const icon = btn.querySelector(`.${CONTENT_TOOLBAR_CLASS}__icon`) as HTMLElement | null
    const lines = view.fence.querySelectorAll<HTMLElement>('.CodeMirror-line')
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : null
    const next = view.fence.nextElementSibling as HTMLElement | null
    const buttonRect = rectTuple(btn.getBoundingClientRect())
    const iconRect = icon ? rectTuple(icon.getBoundingClientRect()) : null
    const lastLineRect = lastLine ? rectTuple(lastLine.getBoundingClientRect()) : null
    const nextRect = next ? rectTuple(next.getBoundingClientRect()) : null
    this.opts.emitAudit?.('FOLD-BOTTOM-CONTROL', {
      blockKey: view.key,
      foldable,
      visible: foldable && btn.style.display !== 'none',
      /** 同一 PRE 内的底边按钮数量；重渲染后必须恒为 1（无旧按钮残留）。 */
      bottomButtonCount: view.fence.querySelectorAll('[data-action="toggle-fold-bottom"]').length,
      fenceRect: rectTuple(view.fence.getBoundingClientRect()),
      buttonRect,
      iconRect,
      lastLineRect,
      nextTag: next ? next.tagName.toLowerCase() : null,
      nextRect,
      overlapLastLinePx: rectOverlapPx(buttonRect, lastLineRect),
      overlapNextPx: rectOverlapPx(buttonRect, nextRect),
      iconOverlapLastLinePx: rectOverlapPx(iconRect, lastLineRect),
      iconOverlapNextPx: rectOverlapPx(iconRect, nextRect),
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
    const entries: Array<{
      key: string
      bar: [number, number, number, number]
      fence: [number, number, number, number]
      bottom: [number, number, number, number]
    }> = []
    let clipped = 0
    for (const view of this.views.values()) {
      if (!view.bar.isConnected) continue
      const barRect = view.bar.getBoundingClientRect()
      const fenceRect = view.fence.getBoundingClientRect()
      if (barRect.right > vw + 1) clipped++
      if (entries.length < 6) {
        entries.push({
          key: view.key,
          bar: rectTuple(barRect),
          fence: rectTuple(fenceRect),
          bottom: rectTuple(view.bottomBtn.getBoundingClientRect()),
        })
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
    this.syncDiagnosticMarks(view, target.element)

    const folded = this.session.isFolded(target.key) && total > previewLines
    if (folded !== view.folded) {
      view.folded = folded
      if (folded) {
        // Keep the session in lockstep with the projection (content grew back).
        this.session.setFold({ key: view.key, lineCount: total, documentKey: null })
        this.applyFoldProjection(view, previewLines)
      } else {
        // No longer foldable: clear the user's fold intent instead of keeping a
        // phantom session entry that would re-fold when the block grows again.
        this.session.clearFold(view.key)
        this.clearFoldProjection(view)
      }
    } else if (folded) {
      this.applyFoldProjection(view, previewLines)
    }
    this.syncFoldControls(view)
  }

  // ── 折叠（预览式） ─────────────────────────────────────────

  /** 诊断快照提交后刷新行级标记（签名相同则跳过，避免 DOM 抖动）。 */
  refreshDiagnosticMarks(): void {
    if (this.disposed) return
    for (const view of this.views.values()) {
      if (!view.fence.isConnected) continue
      this.syncDiagnosticMarks(view, view.fence)
    }
  }

  private codeMirrorOf(element: HTMLElement): CodeMirrorDecorateLike | null {
    try {
      const wrapper = element.querySelector('.CodeMirror') as
        (HTMLElement & { CodeMirror?: CodeMirrorDecorateLike }) | null
      return wrapper?.CodeMirror ?? null
    } catch {
      return null
    }
  }

  /** 稳定的 CM 实例代次（第一次见到的实例分配新 id）。 */
  private cmGeneration(cm: object): number {
    let id = this.cmGenerations.get(cm)
    if (id == null) {
      id = ++this.cmGenerationSeq
      this.cmGenerations.set(cm, id)
    }
    return id
  }

  /**
   * CM 内容变化 → 立即作废当前标记。
   *
   * 诊断快照是异步提交的；在两次提交之间用户可能继续编辑。此时旧标记的
   * 行范围已不再对应新内容，必须在变化的第一时间清除，等下一次快照重新绘制，
   * 绝不允许“旧诊断盖在新内容上”。
   */
  private bindDiagnosticChange(view: CodeBlockView, cm: CodeMirrorDecorateLike): void {
    // The handler must be re-registered whenever the CM INSTANCE changes; the
    // mark-owning instance (`diagMarkCm`) is not proof that a listener exists.
    if (view.diagChangeHandler != null && view.diagChangeCm === cm) return
    this.unbindDiagnosticChange(view)
    view.diagChangeCm = cm
    if (typeof cm.on !== 'function') return
    const handler = (): void => {
      if (this.disposed) return
      this.clearDiagnosticMarks(view)
      this.handleFoldedCodeTextChange(view)
    }
    try {
      cm.on('change', handler)
      view.diagChangeHandler = handler
    } catch {
      view.diagChangeHandler = null
    }
  }

  private unbindDiagnosticChange(view: CodeBlockView): void {
    const cm = view.diagChangeCm
    const handler = view.diagChangeHandler
    if (cm != null && handler != null) {
      const decorate = cm as CodeMirrorDecorateLike
      if (typeof decorate.off === 'function') {
        try { decorate.off('change', handler) } catch { /* noop */ }
      }
    }
    view.diagChangeHandler = null
    view.diagChangeCm = null
  }

  /**
   * 折叠态下的“真实文本修改” → 完整展开。
   *
   * 只由 CodeMirror 的 `change` 事件驱动：插入/删除/空格/Tab/粘贴/程序化替换
   * 都会触发；纯点击、选中、光标移动不会触发。开关关闭时保持折叠。
   */
  private handleFoldedCodeTextChange(view: CodeBlockView): void {
    if (!view.folded) return
    const enabled = this.autoExpandOnEdit()
    this.opts.emitAudit?.('FOLD-AUTO-EXPAND-DECISION', {
      blockKey: view.key,
      source: 'CODE_TEXT_CHANGED',
      setting: enabled,
      previewLines: view.previewLines,
      decision: enabled ? 'EXPAND' : 'KEEP_FOLDED',
    })
    if (!enabled) return
    const actionId = `edit-expand-${++this.actionSeq}-${view.key}`
    view.actionId = actionId
    this.setCollapsed(view, false, actionId, 'UNFOLDED:CODE_TEXT_CHANGED')
  }

  private clearDiagnosticMarks(view: CodeBlockView): void {
    // Remove line classes through the HANDLE returned by addLineClass. A line
    // INDEX drifts as soon as text is inserted/deleted, which used to leave the
    // old "yellow" run stuck on an unrelated line (the reported desync).
    const cm = view.diagMarkCm as CodeMirrorDecorateLike | null
    if (cm && typeof cm.removeLineClass === 'function') {
      for (const entry of view.diagLineClasses) {
        try { cm.removeLineClass(entry.handle, 'gutter', entry.cls) } catch { /* noop */ }
      }
    }
    for (const handle of view.diagMarks) {
      try { handle.clear() } catch { /* noop */ }
    }
    view.diagMarks = []
    view.diagLineClasses = []
    view.diagMarkSignature = ''
  }

  /**
   * 只读行级标记：空行区段加行号侧标记（不覆盖代码文本），全角标点等文本范围
   * 加下划线。只用 CodeMirror 公开 API；任何缺失/异常都安全跳过。
   *
   * VERSION GATE — 提供方附带 `contentSignature` 时，只有与当前 CM 源文本签名
   * 一致的标记才会被绘制，旧快照的异步结果绝不会落到新内容上。
   */
  private syncDiagnosticMarks(view: CodeBlockView, element: HTMLElement): void {
    const provider = this.opts.getBlockDiagnosticMarks
    if (!provider) return
    const root = this.boundRoot ?? this.opts.getEditorRoot()
    const ordinal = root ? codeFenceOrdinal(element, root) : -1
    view.ordinal = ordinal >= 0 ? ordinal : null
    const cm = this.codeMirrorOf(element)
    if (!cm) {
      this.clearDiagnosticMarks(view)
      return
    }
    if (view.diagMarkCm !== cm) {
      // CM rebuilt: old handles belong to a detached instance.
      this.clearDiagnosticMarks(view)
      view.diagMarkCm = cm
    }
    this.bindDiagnosticChange(view, cm)

    const rawMarks = ordinal >= 0 ? provider(ordinal) : []
    const liveSignature = this.readLiveContentSignature(cm)
    const marks = liveSignature == null
      ? rawMarks
      : rawMarks.filter(m => m.contentSignature == null || m.contentSignature === liveSignature)
    // A folded preview shows only the first N lines; diagnostics beyond that
    // boundary are clipped by CSS (they are NOT removed from the model). Track
    // the fact so the fold can surface a lightweight boundary hint.
    view.diagHiddenBeyondPreview = marks.some(m => m.endLine > view.previewLines)
    this.syncFoldDiagnosticIndicator(view)
    const signature = `${this.cmGeneration(cm)}|${liveSignature ?? 'no-live-sig'}|${marks
      .map(m => `${m.ruleId}:${m.severity}:${m.startLine}:${m.startColumn}:${m.endLine}:${m.endColumn}`)
      .join('|')}`
    if (view.diagMarkSignature === signature) return
    this.clearDiagnosticMarks(view)
    view.diagMarkCm = cm
    if (marks.length === 0) return
    if (typeof cm.markText !== 'function' || typeof cm.addLineClass !== 'function') return
    const lineCount = typeof cm.lineCount === 'function' ? cm.lineCount() : 0
    if (lineCount <= 0) return
    try {
      for (const mark of marks) {
        if (mark.blank) {
          const from = Math.max(0, Math.min(lineCount - 1, mark.startLine - 1))
          const to = Math.max(from, Math.min(lineCount - 1, mark.endLine - 1))
          for (let line = from; line <= to; line++) {
            const handle = cm.addLineClass(line, 'gutter', DIAG_BLANK_CLASS)
            view.diagLineClasses.push({ handle: handle ?? line, cls: DIAG_BLANK_CLASS })
          }
          continue
        }
        const fromLine = mark.startLine - 1
        const endLine = mark.endLine - 1
        if (fromLine < 0 || endLine < 0 || fromLine >= lineCount || endLine >= lineCount) continue
        const fromText = typeof cm.getLine === 'function' ? (cm.getLine(fromLine) ?? '') : ''
        const endText = typeof cm.getLine === 'function' ? (cm.getLine(endLine) ?? '') : ''
        const fromCh = Math.max(0, Math.min(fromText.length, mark.startColumn - 1))
        const toCh = Math.max(0, Math.min(endText.length, mark.endColumn - 1))
        if (fromLine === endLine && toCh <= fromCh) continue
        const className = mark.severity === 'hint' ? `${DIAG_RANGE_CLASS} ${DIAG_HINT_CLASS}` : DIAG_RANGE_CLASS
        const handle = cm.markText({ line: fromLine, ch: fromCh }, { line: endLine, ch: toCh }, { className })
        if (handle) view.diagMarks.push(handle)
      }
      view.diagMarkSignature = signature
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-DIAG-MARKS', {
        blockKey: view.key,
        ordinal: view.ordinal,
        textMarks: view.diagMarks.length,
        lineClasses: view.diagLineClasses.length,
        contentSignature: liveSignature,
      })
    } catch {
      this.clearDiagnosticMarks(view)
    }
  }

  /** 当前 CM 源文本的内容签名；无 `getValue` 时返回 null（不做版本约束）。 */
  private readLiveContentSignature(cm: CodeMirrorDecorateLike): string | null {
    if (typeof cm.getValue !== 'function') return null
    try {
      const value = cm.getValue()
      return typeof value === 'string' ? codeContentSignature(value) : null
    } catch {
      return null
    }
  }

  /**
   * 折叠 + 预览区之外仍有诊断 → 在 PRE 上标记一个“下面还有诊断”的轻量提示。
   * 不显示数量、不占语言栏空间、不改变任何诊断事实。
   */
  private syncFoldDiagnosticIndicator(view: CodeBlockView): void {
    if (view.folded && view.diagHiddenBeyondPreview) {
      view.fence.setAttribute(CODE_FOLD_DIAG_ATTR, 'true')
    } else {
      view.fence.removeAttribute(CODE_FOLD_DIAG_ATTR)
    }
  }

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
    this.syncFoldDiagnosticIndicator(view)
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
    this.syncFoldDiagnosticIndicator(view)
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

  /**
   * 顶部语言栏按钮 + 底边箭头共用一个折叠状态，必须同时刷新：
   * 显隐（仅可折叠块显示）、aria-expanded、tooltip 与箭头方向。
   */
  private syncFoldControls(view: CodeBlockView): void {
    const foldable = view.totalLines > view.previewLines
    const label = view.folded ? '展开全部代码' : `收起至前 ${view.previewLines} 行`
    const signature = `${view.folded}|${label}`
    if (foldable) view.fence.setAttribute(CODE_FOLD_CONTROL_ATTR, 'true')
    else view.fence.removeAttribute(CODE_FOLD_CONTROL_ATTR)
    for (const btn of [view.foldBtn, view.bottomBtn]) {
      btn.style.display = foldable ? '' : 'none'
      if (!foldable) continue
      btn.setAttribute('aria-expanded', view.folded ? 'false' : 'true')
      if (btn.getAttribute('data-signature') === signature) continue
      btn.setAttribute('data-signature', signature)
      btn.setAttribute('title', label)
      btn.setAttribute('aria-label', label)
      btn.innerHTML = iconSvg(
        view.folded ? 'chevron-down' : 'chevron-up',
        `${CONTENT_TOOLBAR_CLASS}__icon`,
      )
    }
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
    const blockedLabel = `光标位于第 ${(caret.caretLine ?? 0) + 1} 行，超出预览范围，无法折叠`
    for (const btn of [view.foldBtn, view.bottomBtn]) {
      btn.classList.add('is-error')
      btn.setAttribute('title', blockedLabel)
    }
    this.opts.emitAudit?.('FOLD-STATE-TRANSITION', {
      actionId, blockKey: view.key, from: 'expanded', to: 'expanded',
      decision: 'BLOCKED', reason: 'CARET_IN_HIDDEN_PREVIEW',
      caretInsideNow: this.selectionInside(view.fence), caret,
    })
    for (const btn of [view.foldBtn, view.bottomBtn]) {
      const timer = window.setTimeout(() => {
        btn.classList.remove('is-error')
        this.syncFoldControls(view)
      }, FEEDBACK_RESET_MS)
      this.resetTimers.set(btn, timer)
    }
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
    this.syncFoldControls(view)
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
    const lastLineRect = lines.length > 0
      ? rectTuple(lines[lines.length - 1].getBoundingClientRect())
      : null
    const bottomIcon = view.bottomBtn.querySelector(`.${CONTENT_TOOLBAR_CLASS}__icon`)
    const bottomIconRect = bottomIcon ? rectTuple(bottomIcon.getBoundingClientRect()) : null
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
      bottomRect: rectTuple(view.bottomBtn.getBoundingClientRect()),
      bottomVisible: view.bottomBtn.style.display !== 'none' && view.bottomBtn.isConnected,
      bottomIconRect,
      lastLineRect,
      iconOverlapLastLinePx: rectOverlapPx(bottomIconRect, lastLineRect),
      cmClientHeight,
      cmScrollHeight,
      cmMaxHeight,
      fullyVisibleLines,
      renderedLines: lines.length,
      caretInside: this.selectionInside(fence),
      dpr: window.devicePixelRatio || 1,
    })
  }

  private auditFoldPointerHit(
    view: CodeBlockView,
    ev: PointerEvent,
    actionId: string,
    btn: HTMLButtonElement,
    source: 'top' | 'bottom',
  ): void {
    const rect = btn.getBoundingClientRect()
    let hit: Element | null = null
    try { hit = document.elementFromPoint(ev.clientX, ev.clientY) } catch { hit = null }
    const hitKey = hit instanceof Element
      ? hit.closest('[data-block-key]')?.getAttribute('data-block-key') ?? null
      : null
    this.opts.emitAudit?.('FOLD-POINTER-HIT', {
      actionId,
      blockKey: view.key,
      source,
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
      activeIsFoldButton: active === view.foldBtn || active === view.bottomBtn,
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

  // ── 图片操作条（绑定图片容器，默认隐藏） ──────────────────────

  private async copyImage(): Promise<void> {
    const target = this.imageTarget
    if (!target) return
    const img = target.element as HTMLImageElement
    if (isImageLoadFailed(img)) {
      this.showImageFeedback('error', '图片加载失败，无法复制')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: 'FAIL', reason: 'IMAGE_LOAD_FAILED', blockKey: target.key,
      })
      return
    }
    const btn = this.imageBtn
    btn.classList.add('is-loading')
    btn.disabled = true
    try {
      const result = await this.opts.actions.copyImage(img)
      if (result.ok) {
        this.showImageFeedback('success', '已复制图片')
        btn.classList.remove('is-error')
        btn.classList.add('is-success')
        btn.setAttribute('title', result.verified ? '已复制图片（已校验）' : '已复制图片')
      } else {
        const message = imageCopyFailureText(result.reason)
        this.showImageFeedback('error', `复制失败：${message}`)
        btn.classList.remove('is-success')
        btn.classList.add('is-error')
        btn.setAttribute('title', `复制图片失败：${message}`)
      }
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: result.ok ? 'PASS' : 'FAIL',
        reason: result.reason ?? null,
        verified: result.verified === true,
        note: result.note ?? null,
        blockKey: target.key,
      })
    } catch (error) {
      this.showImageFeedback('error', '复制失败：未知错误')
      btn.classList.remove('is-success')
      btn.classList.add('is-error')
      this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-COPY-IMAGE', {
        decision: 'FAIL', reason: 'THREW', message: String(error), blockKey: target.key,
      })
    } finally {
      btn.disabled = false
      const timer = window.setTimeout(() => {
        btn.classList.remove('is-loading', 'is-success', 'is-error')
        this.updateImageButtonTitle()
      }, FEEDBACK_RESET_MS)
      this.resetTimers.set(btn, timer)
    }
  }

  /** 操作条锚点：优先 Typora 的 `.md-image`（宽度贴合图片），否则退回业务块。 */
  private resolveImageAnchor(target: ContentBlockTarget): HTMLElement {
    const img = target.element
    const wrapper = img.closest<HTMLElement>('.md-image')
    return wrapper ?? target.block ?? img
  }

  private allBusinessImages(): HTMLImageElement[] {
    const root = this.boundRoot ?? this.opts.getEditorRoot()
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLImageElement>('img'))
      .filter(img => img.closest('[data-inkchapter-ui-root]') == null)
  }

  private rememberImageIdentity(img: HTMLImageElement): void {
    this.imageOrdinal = this.allBusinessImages().indexOf(img)
    this.imageAlt = img.getAttribute('alt') ?? ''
  }

  /**
   * 上传后 Typora 会替换图片节点。优先按规范块 key 找替代节点，其次按
   * 文档内图片序号 + alt 找回；找到后继续使用同一个 overlay 操作条。
   */
  private rebindDisconnectedImage(oldTarget: ContentBlockTarget): boolean {
    const root = this.boundRoot ?? this.opts.getEditorRoot()
    if (!root) return false
    const images = this.allBusinessImages()
    let replacement: HTMLImageElement | null = null
    for (const img of images) {
      const target = resolveContentBlockTargetFromElement(img, root)
      if (target?.kind === 'image' && target.key === oldTarget.key) {
        replacement = img
        break
      }
    }
    if (!replacement && this.imageOrdinal >= 0) {
      const candidate = images[this.imageOrdinal]
      if (candidate && (!this.imageAlt || (candidate.getAttribute('alt') ?? '') === this.imageAlt)) {
        replacement = candidate
      }
    }
    if (!replacement) return false
    const target = resolveContentBlockTargetFromElement(replacement, root)
    if (!target || target.kind !== 'image') return false

    const anchor = this.resolveImageAnchor(target)
    if (this.imageAnchorEl && this.imageAnchorEl !== anchor) {
      this.imageAnchorEl.classList.remove(IMAGE_ANCHOR_CLASS, IMAGE_SELECTED_CLASS)
    }
    this.imageAnchorEl = anchor
    anchor.classList.add(IMAGE_ANCHOR_CLASS)
    if (this.imageSelected) anchor.classList.add(IMAGE_SELECTED_CLASS)
    this.imageTarget = target
    this.rememberImageIdentity(replacement)
    if (this.imageBar.parentElement !== this.root) this.root.appendChild(this.imageBar)
    this.updateImageActions()
    this.updateImageBarState(replacement)
    this.watchImageSize(replacement)
    this.positionImageBar()
    this.imageBar.setAttribute(IMAGE_BAR_VISIBLE_ATTR, 'true')
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-IMAGE-REBOUND', {
      reason: 'DISCONNECTED_IMAGE_REPLACED',
      keyMatched: target.key === oldTarget.key,
    })
    return true
  }

  private showImageBar(target: ContentBlockTarget): void {
    const anchor = this.resolveImageAnchor(target)
    if (this.imageAnchorEl !== anchor) {
      this.releaseImageAnchor()
      this.imageAnchorEl = anchor
      anchor.classList.add(IMAGE_ANCHOR_CLASS)
    }
    // P0: 操作条/菜单必须挂在插件 overlay 根，绝不能进入 Typora 可编辑图片段落。
    // overlay 根是 position:fixed 全视口层，left/top 使用视口坐标。
    if (this.imageBar.parentElement !== this.root) this.root.appendChild(this.imageBar)
    this.imageTarget = target
    this.imageVisible = true
    this.rememberImageIdentity(target.element as HTMLImageElement)
    this.updateImageActions()
    this.updateImageBarState(target.element as HTMLImageElement)
    this.watchImageSize(target.element as HTMLImageElement)
    // 先按图片真实边界定位，再显示，避免出现“先显示在块右侧再跳回”的闪烁。
    this.positionImageBar()
    this.imageBar.setAttribute(IMAGE_BAR_VISIBLE_ATTR, 'true')
  }

  /**
   * 以**实际图片矩形**为参照，写入 overlay 根内的 left/top。
   * overlay 根是 position:fixed;inset:0 的全视口层，因此 left/top 即视口坐标；
   * 滚动时由 onEditorScroll 以单帧 rAF 重新定位，不使用轮询。
   */
  private positionImageBar(): void {
    const target = this.imageTarget
    const anchor = this.imageAnchorEl
    if (!target || !anchor || !this.imageBar.isConnected) return
    const img = target.element as HTMLImageElement
    if (!img.isConnected) {
      // 上传成功会重建图片节点：先按稳定身份找替代节点并继续显示，
      // 找不到替代节点才隐藏，避免“上传完成后工具栏消失”。
      if (this.rebindDisconnectedImage(target)) return
      this.dropImageBar()
      return
    }
    const imageRect = img.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const rootRect = this.root.getBoundingClientRect()
    const root = this.opts.getEditorRoot()
    const rawEditor = root?.getBoundingClientRect() ?? anchorRect
    const viewportWidth = window.innerWidth || rawEditor.right || 1024
    const viewportHeight = window.innerHeight || rawEditor.bottom || 768
    const placement = computeImageToolbarPlacement({
      imageRect,
      // overlay 根作为定位坐标系；其 left/top 通常为 0，但仍按真实矩形换算。
      anchorRect: {
        left: rootRect.left,
        top: rootRect.top,
        right: rootRect.right,
        bottom: rootRect.bottom,
        width: rootRect.width,
        height: rootRect.height,
      },
      editorRect: clipEditorRect(rawEditor, viewportWidth, viewportHeight),
      barWidth: this.imageBar.offsetWidth || IMAGE_BAR_FALLBACK_WIDTH,
      barHeight: this.imageBar.offsetHeight || IMAGE_BAR_FALLBACK_HEIGHT,
    })
    this.imageBar.setAttribute('data-placement', placement.mode)
    this.imageBar.style.left = `${placement.left}px`
    this.imageBar.style.top = `${placement.top}px`
    // 运行时定位取证：以视口坐标记录“图片边缘 → 操作条边缘”的真实间距。
    // 每次定位只读一次几何（非滚动路径、非轮询）。
    const barRect = this.imageBar.getBoundingClientRect()
    const measuredGap = placement.mode === 'right'
      ? barRect.left - imageRect.right
      : placement.mode === 'left'
        ? imageRect.left - barRect.right
        : null
    this.opts.emitAudit?.('CONTENT-BLOCK-TOOLBAR-IMAGE-PLACEMENT', {
      mode: placement.mode,
      gap: placement.gap,
      measuredGapPx: measuredGap === null ? null : Math.round(measuredGap * 10) / 10,
      topDeltaPx: Math.round((barRect.top - imageRect.top) * 10) / 10,
      imageWidth: Math.round(imageRect.width),
      blockWidth: Math.round(anchorRect.width),
      barWidth: Math.round(barRect.width),
    })
  }

  /** 图片异步加载完成后尺寸会变化：只监听这一次 load/error，不做轮询。 */
  private watchImageSize(img: HTMLImageElement): void {
    if (this.watchedImage === img) return
    this.unwatchImageSize()
    this.watchedImage = img
    this.imageSizeHandler = () => {
      if (this.disposed || this.imageTarget?.element !== img) return
      this.updateImageBarState(img)
      this.positionImageBar()
    }
    img.addEventListener('load', this.imageSizeHandler)
    img.addEventListener('error', this.imageSizeHandler)
  }

  private unwatchImageSize(): void {
    const img = this.watchedImage
    const handler = this.imageSizeHandler
    if (img && handler) {
      img.removeEventListener('load', handler)
      img.removeEventListener('error', handler)
    }
    this.watchedImage = null
    this.imageSizeHandler = null
  }

  /** 计算当前图片可用的“更多操作”，没有资源的项不渲染。 */
  private updateImageActions(): void {
    const target = this.imageTarget
    if (!target) {
      this.imageActions = { localPath: null, remoteUrl: null, markdown: null }
      this.imageMoreBtn.hidden = true
      return
    }
    const img = target.element as HTMLImageElement
    const wrapper = img.closest<HTMLElement>('.md-image')
    const meta = wrapper?.querySelector<HTMLElement>('.md-meta')?.textContent ?? null
    let baseDir: string | null = null
    try {
      baseDir = this.opts.getDocumentDir?.() ?? null
    } catch {
      baseDir = null
    }
    this.imageActions = buildImageActions({
      src: img.getAttribute('src'),
      dataSrc: wrapper?.getAttribute('data-src') ?? null,
      alt: img.getAttribute('alt') ?? meta,
      baseDir,
    })
    this.imageFigureNamed = false
    try {
      this.imageFigureNamed = this.opts.imageAssetActions?.getFigureNameState?.(img)?.named === true
    } catch {
      this.imageFigureNamed = false
    }
    const canDownload = !!this.imageActions.remoteUrl && !!this.opts.imageAssetActions?.download
    const canName = !!this.opts.imageAssetActions?.requestFigureName
    this.imageMoreBtn.hidden = !(this.imageActions.localPath
      || this.imageActions.remoteUrl
      || this.imageActions.markdown
      || canDownload
      || canName)
    if (this.imageMoreBtn.hidden) this.closeImageMenu()
  }

  private updateImageBarState(img: HTMLImageElement): void {
    const failed = isImageLoadFailed(img)
    this.imageBtn.disabled = failed
    this.imageBtn.setAttribute('aria-disabled', failed ? 'true' : 'false')
    this.imageBtn.classList.toggle('is-error', failed)
    this.imageBtn.setAttribute('title', failed ? '图片加载失败，无法复制原图' : '复制图片')
    this.imageBtn.setAttribute('aria-label', failed ? '图片加载失败，无法复制原图' : '复制图片')
    if (this.imageMoreBtn.hidden) this.closeImageMenu()
  }

  private updateImageButtonTitle(): void {
    const img = this.imageTarget?.element as HTMLImageElement | undefined
    if (img && isImageLoadFailed(img)) {
      this.imageBtn.setAttribute('title', '图片加载失败，无法复制原图')
      return
    }
    this.imageBtn.setAttribute('title', '复制图片')
  }

  private showImageFeedback(kind: 'success' | 'error', text: string): void {
    if (this.imageFeedbackTimer !== null) {
      window.clearTimeout(this.imageFeedbackTimer)
      this.imageFeedbackTimer = null
    }
    this.imageFeedback.textContent = text
    this.imageFeedback.classList.toggle('is-success', kind === 'success')
    this.imageFeedback.classList.toggle('is-error', kind === 'error')
    this.imageBar.setAttribute('data-feedback', kind)
    // 反馈文字会改变按钮条宽度，重新按图片边界校正位置。
    this.positionImageBar()
    this.imageFeedbackTimer = window.setTimeout(() => {
      this.imageFeedbackTimer = null
      this.clearImageFeedback()
    }, FEEDBACK_RESET_MS)
  }

  private clearImageFeedback(): void {
    if (this.imageFeedbackTimer !== null) {
      window.clearTimeout(this.imageFeedbackTimer)
      this.imageFeedbackTimer = null
    }
    this.imageFeedback.textContent = ''
    this.imageFeedback.classList.remove('is-success', 'is-error')
    this.imageBar.removeAttribute('data-feedback')
    this.positionImageBar()
  }

  private toggleImageMenu(): void {
    if (this.imageMenuOpen) this.closeImageMenu()
    else this.openImageMenu()
  }

  private openImageMenu(): void {
    const actions = this.imageActions
    this.imageMenu.textContent = ''
    const addItem = (label: string, run: () => Promise<void>): void => {
      const item = (this.imageBar.ownerDocument ?? document).createElement('button')
      item.type = 'button'
      item.className = `${CONTENT_TOOLBAR_CLASS}__menu-item`
      item.setAttribute('role', 'menuitem')
      item.textContent = label
      this.bindButtonFocusGuard(item)
      item.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        this.closeImageMenu()
        void run()
      })
      this.imageMenu.appendChild(item)
    }
    const assetActions = this.opts.imageAssetActions
    const img = this.imageTarget?.element as HTMLImageElement | undefined
    if (assetActions?.requestFigureName && img) {
      if (this.imageFigureNamed) {
        addItem('编辑图名…', async () => {
          if (!assetActions.requestFigureName!(img, 'edit')) this.showImageFeedback('error', '无法定位当前图片的图名')
        })
        addItem('清除图名', async () => {
          if (!assetActions.requestFigureName!(img, 'clear')) this.showImageFeedback('error', '当前图片没有可清除的图名')
        })
      } else {
        addItem('设置图名…', async () => {
          if (!assetActions.requestFigureName!(img, 'set')) this.showImageFeedback('error', '无法定位当前图片')
        })
      }
    }
    if (assetActions?.download && actions.remoteUrl && img) {
      const targets = assetActions.downloadTargets?.() ?? ['project']
      const run = async (
        destination: ImageAssetMenuDestination,
        replaceReference: boolean,
        successText: string,
      ): Promise<void> => {
        const result = await assetActions.download!({
          img,
          url: actions.remoteUrl as string,
          destination,
          replaceReference,
        })
        this.showImageFeedback(result.ok ? 'success' : 'error', result.ok ? successText : result.message)
      }
      if (targets.includes('project')) {
        addItem('下载图片', () => run('project', false, '图片已下载'))
        addItem('下载并替换为本地引用', () => run('project', true, '已下载并替换为本地引用'))
      }
      if (targets.includes('library')) {
        addItem('下载到全局图库', () => run('library', false, '已下载到全局图库'))
      }
      if (targets.includes('offline')) {
        addItem('下载到离线区', () => run('offline', false, '已下载到离线区'))
      }
      if (targets.includes('custom')) {
        addItem('选择目录下载…', () => run('custom', false, '图片已下载'))
      }
    }
    if (actions.localPath) {
      addItem('复制本地路径', () => this.copyImageText('本地路径', actions.localPath as string))
    }
    if (actions.remoteUrl) {
      addItem('复制云端链接', () => this.copyImageText('云端链接', actions.remoteUrl as string))
    }
    if (actions.markdown) {
      addItem('复制 Markdown 引用', () => this.copyImageText('Markdown 引用', actions.markdown as string))
    }
    if (this.imageMenu.childElementCount === 0) {
      this.closeImageMenu()
      return
    }
    this.imageMenuOpen = true
    this.imageMenu.hidden = false
    this.imageMoreBtn.setAttribute('aria-expanded', 'true')
  }

  private closeImageMenu(): void {
    this.imageMenuOpen = false
    this.imageMenu.hidden = true
    this.imageMoreBtn.setAttribute('aria-expanded', 'false')
  }

  private async copyImageText(label: string, text: string): Promise<void> {
    try {
      const result = await this.opts.actions.copyText(text)
      if (result.ok) {
        this.showImageFeedback('success', `已复制${label}`)
      } else {
        this.showImageFeedback('error', `复制${label}失败：${imageCopyFailureText(result.reason)}`)
      }
    } catch {
      this.showImageFeedback('error', `复制${label}失败：未知错误`)
    }
  }

  private dropImageBar(): void {
    if (this.imageHideTimer !== null) {
      window.clearTimeout(this.imageHideTimer)
      this.imageHideTimer = null
    }
    if (this.imagePositionRaf !== null) {
      try { cancelAnimationFrame(this.imagePositionRaf) } catch { /* noop */ }
      this.imagePositionRaf = null
    }
    this.closeImageMenu()
    if (!this.imageVisible && !this.imageAnchorEl) return
    this.imageVisible = false
    this.imageTarget = null
    this.imageBar.setAttribute(IMAGE_BAR_VISIBLE_ATTR, 'false')
    if (!this.imageSelected) this.releaseImageAnchor()
  }

  /** 从当前图片容器移除操作条与锚点类；图片本身不受影响。 */
  private releaseImageAnchor(): void {
    this.unwatchImageSize()
    const anchor = this.imageAnchorEl
    this.imageAnchorEl = null
    this.imageOrdinal = -1
    this.imageAlt = ''
    if (!anchor) {
      this.imageBar.remove()
      return
    }
    anchor.classList.remove(IMAGE_ANCHOR_CLASS, IMAGE_SELECTED_CLASS)
    // 操作条属于插件 overlay 根：隐藏时移除，重新显示时再挂回根；
    // 任何情况下都不把 UI 放回文档流。
    this.imageBar.remove()
  }

  private clearSelectedImageAnchors(): void {
    this.imageSelected = false
    const root = this.boundRoot
    if (!root) return
    root.querySelectorAll<HTMLElement>(`.${IMAGE_ANCHOR_CLASS}.${IMAGE_SELECTED_CLASS}`)
      .forEach(el => el.classList.remove(IMAGE_SELECTED_CLASS))
  }

  private scheduleImageHide(): void {
    if (!this.imageVisible || this.imageSelected) return
    // Typora 上传期间会给图片加 md-on-uploading / 上传遮罩；此时鼠标可能
    // 被遮罩接管而触发 pointerout。上传结束前不得隐藏，否则鼠标未移动
    // 就再也没有 pointerover 把工具栏重新显示出来。
    if (this.isBoundImageUploading()) return
    this.cancelImageHide()
    this.imageHideTimer = window.setTimeout(() => {
      this.imageHideTimer = null
      this.dropImageBar()
    }, 180)
  }

  private isBoundImageUploading(): boolean {
    const img = this.imageTarget?.element as HTMLImageElement | undefined
    const wrapper = img?.closest<HTMLElement>('.md-image')
    if (!wrapper) return false
    return wrapper.classList.contains('md-on-uploading')
      || wrapper.querySelector('.md-image-uploading-mask-wrapper') != null
  }

  /** 滚动时只做一帧重新定位，跟随图片可视锚点；不轮询、不新增观察器。 */
  private scheduleImagePosition(): void {
    if (this.imagePositionRaf !== null) return
    try {
      this.imagePositionRaf = requestAnimationFrame(() => {
        this.imagePositionRaf = null
        if (!this.disposed && this.imageVisible && this.imageTarget) this.positionImageBar()
      })
    } catch {
      this.imagePositionRaf = null
      this.positionImageBar()
    }
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
    root.addEventListener('pointerdown', this.onPointerDown, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusin', this.onFocusIn, { passive: true } as AddEventListenerOptions)
    root.addEventListener('focusout', this.onFocusOut, { passive: true } as AddEventListenerOptions)
    // 语言栏是代码块 PRE 的子节点：Typora 重建代码块（整篇 reload / 重新挂载
    // CodeMirror）会把它一起带走，而宿主几何 pass 要晚 20–40ms 才补回来。这段空窗
    // 就是用户看到的“TXT 纯文本 1 行”消失又出现。用同一个微任务同步补齐。
    const view = root.ownerDocument?.defaultView ?? null
    const ObserverCtor = view?.MutationObserver ?? null
    if (ObserverCtor) {
      this.fenceObserver = new ObserverCtor((records) => this.onFenceStructureMutated(records))
      this.fenceObserver.observe(root, { childList: true, subtree: true })
    }
  }

  private detachSurface(): void {
    if (this.fenceObserver) {
      this.fenceObserver.disconnect()
      this.fenceObserver = null
    }
    this.immediateSyncScheduled = false
    const root = this.boundRoot
    if (root) {
      root.removeEventListener('pointerover', this.onPointerOver)
      root.removeEventListener('pointerout', this.onPointerOut)
      root.removeEventListener('pointerdown', this.onPointerDown)
      root.removeEventListener('focusin', this.onFocusIn)
      root.removeEventListener('focusout', this.onFocusOut)
    }
    this.boundRoot = null
  }

  private handlePointerOver(ev: Event): void {
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (!target) return
    if (target.kind === 'image') {
      this.cancelImageHide()
      this.showImageBar(target)
      return
    }
    // 进入正文/代码块不等于进入图片区域：不得取消隐藏计时，
    // 否则鼠标移到图片旁边的文字上时操作条会一直残留。
  }

  private handlePointerOut(ev: Event): void {
    if (!this.imageVisible) return
    const related = (ev as PointerEvent).relatedTarget
    // 只要指针仍在「图片 + 操作面板」整体区域内（包括图片到面板之间的空隙），
    // 就不启动隐藏。
    if (related instanceof Node && this.isWithinImageHoverArea(related)) return
    if (this.imageSelected) return
    this.scheduleImageHide()
  }

  /** 操作面板自身移出：只有离开「图片 + 面板」整体区域才隐藏。 */
  private handleImageBarPointerLeave(ev: Event): void {
    if (!this.imageVisible || this.imageSelected) return
    const related = (ev as PointerEvent).relatedTarget
    if (related instanceof Node && this.isWithinImageHoverArea(related)) return
    this.scheduleImageHide()
  }

  /** 指针是否仍在「图片 + 操作面板」整体区域内。 */
  private isWithinImageHoverArea(node: Node): boolean {
    if (this.imageBar.contains(node)) return true
    const target = this.imageTarget
    if (!target) return false
    if (target.element.contains(node)) return true
    return target.block.contains(node)
  }

  private handlePointerDown(ev: Event): void {
    if (ev.target instanceof Element && ev.target.closest(`[${CONTENT_TOOLBAR_ATTR}]`)) return
    const target = resolveContentBlockTarget(ev.target, this.boundRoot)
    if (target?.kind === 'image') {
      this.clearSelectedImageAnchors()
      const anchor = this.resolveImageAnchor(target)
      anchor.classList.add(IMAGE_ANCHOR_CLASS, IMAGE_SELECTED_CLASS)
      this.imageSelected = true
      this.showImageBar(target)
      return
    }
    if (this.imageSelected) {
      this.clearSelectedImageAnchors()
      this.dropImageBar()
    }
  }

  private handleFocusOut(ev: Event): void {
    if (this.imageSelected) return
    const related = (ev as FocusEvent).relatedTarget
    if (related instanceof Node && this.imageBar.contains(related)) return
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
      // 新版交互：纯焦点 / 光标定位 / 选中都不展开。只有真实文本修改
      // （CodeMirror `change`）才触发自动展开。关闭开关时若光标确实位于
      // 隐藏行，仅把光标钳制到可见行，避免“看不见的可编辑光标”。
      const caret = this.caretSnapshot(view)
      const enabled = this.autoExpandOnEdit()
      if (!enabled && caret.hiddenByPreview === true) {
        const clamp = this.clampCaretToPreview(view, view.previewLines, caret)
        this.opts.emitAudit?.('FOLD-FOCUS-KEPT', {
          blockKey: view.key,
          previewLines: view.previewLines,
          caret,
          autoExpand: enabled,
          caretClamped: clamp.moved,
        })
      } else {
        this.opts.emitAudit?.('FOLD-FOCUS-KEPT', {
          blockKey: view.key, previewLines: view.previewLines, caret, autoExpand: enabled,
        })
      }
    }
    this.syncGeometry()
  }

  /** 自动展开开关（默认 true）。 */
  private autoExpandOnEdit(): boolean {
    try {
      const read = this.opts.getAutoExpandOnEdit
      return read ? read() !== false : true
    } catch {
      return true
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

/** 两个 `[left, top, width, height]` 矩形的相交尺寸（px）；无交集返回 `[0, 0]`。 */
function rectOverlapPx(
  a: [number, number, number, number] | null,
  b: [number, number, number, number] | null,
): [number, number] | null {
  if (!a || !b) return null
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return [Math.max(0, Math.round(w)), Math.max(0, Math.round(h))]
}
