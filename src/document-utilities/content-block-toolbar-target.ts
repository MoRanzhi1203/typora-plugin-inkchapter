/**
 * 内容块工具栏 — 规范目标解析（只读）。
 *
 * 代码块规范宿主只有 `pre.md-fences`（与题注/诊断权威一致），图片的规范业务块
 * 为 `img.closest('p, figure') ?? img`。本模块只做判定与身份计算，不写 DOM、
 * 不触发任何布局或选择变更。
 *
 * 身份阶梯（与 `buildDomBlockIdentity` 同构）：cid → data-line → ordinal+签名。
 * 绝不使用题注的 `data-inkchapter-caption-target-key`（内容哈希，正文一变即失效）。
 */

export const CODE_BLOCK_SELECTOR = 'pre.md-fences'
export const IMAGE_SELECTOR = 'img'

/** 代码块内部/数学块内部不允许作为目标。 */
const CODE_REJECTED_ANCESTORS = '.md-math-block, .CodeMirror, [data-inkchapter-ui-root]'
/** 代码/表格/数学块内的图片不是业务图片目标；插件浮层内同理。 */
const IMAGE_REJECTED_ANCESTORS = 'pre, code, .md-codeblock, table, .md-math-block, [data-inkchapter-ui-root]'

export type ContentBlockKind = 'code' | 'image'

export interface ContentBlockTarget {
  kind: ContentBlockKind
  /** 工具栏几何锚点：代码 = 围栏本身；图片 = IMG 可见像素盒。 */
  element: HTMLElement
  /** 业务宿主块：代码 = 围栏；图片 = p/figure/img。 */
  block: HTMLElement
  /** 会话级稳定身份。 */
  key: string
  /** Typora 块 cid（存在时）。 */
  cid: string | null
}

function asElement(node: EventTarget | null): Element | null {
  const el = node as Element | null
  return el != null && typeof el.closest === 'function' ? el : null
}

function isWithin(element: Element, root: Element): boolean {
  try {
    return root === element || root.contains(element)
  } catch {
    return false
  }
}

/** FNV-1a 32bit，仅用于同序号回退签名，不作为业务身份。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16)
}

function contentSignature(kind: ContentBlockKind, element: HTMLElement): string {
  if (kind === 'image') return fnv1a(element.getAttribute('src') ?? '')
  return fnv1a((element.textContent ?? '').trim())
}

/** 计算内容块会话身份（cid 优先，其次 data-line，最后序号+签名）。 */
export function contentBlockKey(
  kind: ContentBlockKind,
  element: HTMLElement,
  editorRoot: HTMLElement,
): string {
  const cidHolder: Element = kind === 'code' ? element : (element.closest('[cid]') ?? element)
  const cid = cidHolder.getAttribute('cid')
  if (cid) return `${kind}:cid:${cid}`
  const lineHolder: Element = kind === 'code' ? element : (element.closest('[data-line]') ?? element)
  const line = lineHolder.getAttribute('data-line')
  if (line && line !== 'na') return `${kind}:line:${line}`
  const selector = kind === 'code' ? CODE_BLOCK_SELECTOR : IMAGE_SELECTOR
  let ordinal = -1
  try {
    ordinal = Array.from(editorRoot.querySelectorAll<HTMLElement>(selector)).indexOf(element)
  } catch {
    ordinal = -1
  }
  return `${kind}:ord:${ordinal}:sig:${contentSignature(kind, element)}`
}

function toCodeTarget(fence: HTMLElement, editorRoot: HTMLElement): ContentBlockTarget {
  return {
    kind: 'code',
    element: fence,
    block: fence,
    key: contentBlockKey('code', fence, editorRoot),
    cid: fence.getAttribute('cid'),
  }
}

function toImageTarget(img: HTMLElement, editorRoot: HTMLElement): ContentBlockTarget {
  const block = img.closest<HTMLElement>('figure, p') ?? img
  return {
    kind: 'image',
    element: img,
    block,
    key: contentBlockKey('image', img, editorRoot),
    cid: img.closest('[cid]')?.getAttribute('cid') ?? null,
  }
}

/**
 * 由事件目标解析唯一规范内容块。不在编辑器根内、位于插件浮层内、或属于
 * 代码/表格/数学块内部的图片一律返回 null。
 */
export function resolveContentBlockTarget(
  node: EventTarget | null,
  editorRoot: HTMLElement | null,
): ContentBlockTarget | null {
  if (!editorRoot) return null
  const el = asElement(node)
  if (!el) return null
  if (!isWithin(el, editorRoot)) return null

  // 图片优先：代码/表格/数学块内部的图片不是业务图片目标（也不退化为代码目标）。
  const img = el.closest<HTMLElement>('img')
  if (img) {
    if (img.closest(IMAGE_REJECTED_ANCESTORS) || !isWithin(img, editorRoot)) return null
    return toImageTarget(img, editorRoot)
  }

  const fence = el.closest<HTMLElement>(CODE_BLOCK_SELECTOR)
  if (fence && !fence.closest(CODE_REJECTED_ANCESTORS) && isWithin(fence, editorRoot)) {
    return toCodeTarget(fence, editorRoot)
  }
  return null
}

/** 由已持有的块元素反解规范目标（例如重新应用折叠状态时）。 */
export function resolveContentBlockTargetFromElement(
  element: HTMLElement,
  editorRoot: HTMLElement,
): ContentBlockTarget | null {
  if (!isWithin(element, editorRoot)) return null
  if (element.matches?.(CODE_BLOCK_SELECTOR)) return toCodeTarget(element, editorRoot)
  if (element.tagName === 'IMG') return toImageTarget(element, editorRoot)
  return null
}

/** 代码行数（与 CodeMirror 文本一致：空文本 = 0 行）。 */
export function countCodeLines(text: string | null | undefined): number {
  if (text == null || text === '') return 0
  return text.split('\n').length
}

/** 折叠占位摘要。 */
export function foldSummary(lineCount: number): string {
  return `已折叠 · ${lineCount} 行`
}

/** 目标元素当前是否仍挂在文档中且尺寸可用。 */
export function isTargetRenderable(element: HTMLElement): boolean {
  try {
    if (!element.isConnected) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  } catch {
    return false
  }
}
