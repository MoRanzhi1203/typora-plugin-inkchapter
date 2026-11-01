/**
 * 内容块工具栏 — 剪贴板适配器。
 *
 * 本文件是唯一允许访问 Typora / Electron 剪贴板能力的边界：
 * - 代码文本：Typora CodeMirror 队列（只读）→ 不触碰 `innerText`；
 * - 文本写入：`UserOp.setClipboard` / `navigator.clipboard.writeText`，
 *   并在可用时通过 Electron `clipboard.readText()` 回读校验；
 * - 图片写入：Electron `nativeImage` + `clipboard.writeImage`（Typora 原生
 *   `copyImage` 的同一通道），回读校验；无 Electron 时退回画布栅格化 + Web Clipboard。
 *
 * 绝不把“图片复制失败”降级为复制链接。
 */

import * as path from 'path'
import {
  isAnimatedGif,
  planImageCopy,
  resolveImageResource,
  type ImageCopyStrategy,
  type ResolvedImageResource,
} from '../document-utilities/content-block-toolbar-image-resource'

// ── 最小结构类型（不引入 Electron 依赖） ─────────────────────────────────

export interface TyporaCodeMirrorLike {
  getValue(): string
}

export interface TyporaEditorLike {
  fences?: { queue?: Record<string, TyporaCodeMirrorLike | undefined> }
  UserOp?: {
    setClipboard?: (
      html: string | null,
      markhtml: string | null,
      text: string,
      shouldClear?: boolean,
    ) => void
  }
}

export interface ElectronNativeImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
}

export interface ElectronClipboardLike {
  writeImage(image: ElectronNativeImageLike): void
  readImage(): ElectronNativeImageLike
  readText(): string
}

export interface ElectronNativeImageFactoryLike {
  createFromPath(filePath: string): ElectronNativeImageLike
  createFromBuffer(buffer: Uint8Array): ElectronNativeImageLike
  createFromDataURL(dataUrl: string): ElectronNativeImageLike
}

export interface ElectronLike {
  clipboard?: ElectronClipboardLike
  nativeImage?: ElectronNativeImageFactoryLike
}

export interface NavigatorClipboardLike {
  writeText?(text: string): Promise<void>
  write?(items: unknown[]): Promise<void>
}

export interface ContentBlockClipboardDeps {
  getEditor: () => TyporaEditorLike | null
  getElectron: () => ElectronLike | null
  /** 当前文档目录（相对图片路径的解析基准）。 */
  getDocumentDirectory: () => string | null
  /** 测试注入点；默认读取 `navigator.clipboard`。 */
  getNavigatorClipboard?: () => NavigatorClipboardLike | null
  /** 测试注入点；默认画布栅格化。 */
  rasterize?: (img: HTMLImageElement) => Promise<string>
}

// ── 结果类型 ────────────────────────────────────────────────────────────

export type ClipboardFailureReason =
  | 'NO_CODE_MIRROR_INSTANCE'
  | 'NO_MARKDOWN_SOURCE'
  | 'CLIPBOARD_UNAVAILABLE'
  | 'CLIPBOARD_WRITE_FAILED'
  | 'CLIPBOARD_VERIFY_FAILED'
  | 'IMAGE_ELEMENT_MISSING'
  | 'IMAGE_NOT_LOADED'
  | 'RESOURCE_UNRESOLVED'
  | 'REMOTE_FETCH_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'CANVAS_TAINTED'
  | 'CANVAS_UNAVAILABLE'
  | 'CLIPBOARD_ITEM_UNAVAILABLE'
  | 'UNKNOWN_ERROR'

export interface TextCopyResult {
  ok: boolean
  /** 是否经过真实回读校验。 */
  verified: boolean
  reason: ClipboardFailureReason | null
}

export interface ImageCopyResult {
  ok: boolean
  verified: boolean
  strategy: ImageCopyStrategy | 'clipboard-item' | 'none'
  reason: ClipboardFailureReason | null
  width: number | null
  height: number | null
  /** 复制语义说明（GIF 首帧 / SVG 栅格化 / 重编码 PNG）。 */
  note: string | null
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * 回读比较：Windows 剪贴板常常在文本末尾追加一个系统换行，
 * 这属于平台规范化，不构成内容差异。除此之外必须逐字符相同。
 */
function clipboardTextMatches(readBack: string, written: string): boolean {
  const a = normalizeNewlines(readBack)
  const b = normalizeNewlines(written)
  return a === b || a === `${b}\n`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// ── 代码源文本 ──────────────────────────────────────────────────────────

/**
 * 读取规范围栏的真实源文本。
 * 只使用 `editor.fences.queue[cid].getValue()`；没有实例时返回 null，
 * 由调用方回退到 Markdown 围栏解析（绝不使用渲染 DOM 的 innerText）。
 */
export function readCodeSourceFromCodeMirror(
  fence: HTMLElement,
  editor: TyporaEditorLike | null,
): string | null {
  const cid = fence.getAttribute?.('cid') ?? ''
  if (!cid || !editor?.fences?.queue) return null
  const cm = editor.fences.queue[cid]
  if (!cm || typeof cm.getValue !== 'function') return null
  try {
    return cm.getValue()
  } catch {
    return null
  }
}

// ── 文本写入 ────────────────────────────────────────────────────────────

/** 写入纯文本；成功必须来自真实写调用（必要时回读校验）。 */
export async function writePlainText(
  text: string,
  deps: ContentBlockClipboardDeps,
): Promise<TextCopyResult> {
  const editor = deps.getEditor()
  const electron = deps.getElectron()

  // 1) Typora 官方通道（与编辑器复制一致）。
  let wrote = false
  try {
    const setClipboard = editor?.UserOp?.setClipboard
    if (typeof setClipboard === 'function') {
      setClipboard.call(editor?.UserOp, null, null, text, true)
      wrote = true
    }
  } catch {
    wrote = false
  }

  // 2) 浏览器通道（返回真实 Promise 结果）。
  if (!wrote) {
    const clipboard = deps.getNavigatorClipboard?.() ?? readNavigatorClipboard()
    try {
      if (!clipboard?.writeText) {
        return { ok: false, verified: false, reason: 'CLIPBOARD_UNAVAILABLE' }
      }
      await clipboard.writeText(text)
      wrote = true
    } catch {
      return { ok: false, verified: false, reason: 'CLIPBOARD_WRITE_FAILED' }
    }
  }

  // 3) 回读校验（Electron 可用时）；Windows 剪贴板会把 \n 规范化为 \r\n。
  try {
    const readText = electron?.clipboard?.readText
    if (typeof readText === 'function') {
      const readBack = readText.call(electron?.clipboard)
      if (typeof readBack === 'string') {
        const same = clipboardTextMatches(readBack, text)
        return { ok: same, verified: true, reason: same ? null : 'CLIPBOARD_VERIFY_FAILED' }
      }
    }
  } catch {
    // 回读失败不改变写入结论，只标记未校验。
  }
  return { ok: wrote, verified: false, reason: wrote ? null : 'CLIPBOARD_WRITE_FAILED' }
}

function readNavigatorClipboard(): NavigatorClipboardLike | null {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: NavigatorClipboardLike } }).navigator
    return nav?.clipboard ?? null
  } catch {
    return null
  }
}

// ── 画布栅格化 ──────────────────────────────────────────────────────────

/**
 * 把已加载的 `<img>` 栅格化为 PNG data URL。
 * 跨域图片会导致 canvas 污染 → 明确抛出 CANVAS_TAINTED，绝不伪装成功。
 */
export async function rasterizeImageElement(img: HTMLImageElement): Promise<string> {
  const width = img.naturalWidth || 0
  const height = img.naturalHeight || 0
  if (width <= 0 || height <= 0) throw new Error('IMAGE_NOT_LOADED')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  ctx.drawImage(img, 0, 0, width, height)
  // 污染画布在此抛出 SecurityError
  return canvas.toDataURL('image/png')
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

interface ClipboardItemCtor {
  new (items: Record<string, Blob>): unknown
}

function getClipboardItemCtor(): ClipboardItemCtor | null {
  const ctor = (globalThis as { ClipboardItem?: unknown }).ClipboardItem
  return typeof ctor === 'function' ? (ctor as ClipboardItemCtor) : null
}

// ── 图片复制 ────────────────────────────────────────────────────────────

export interface CopyImageOptions {
  /** 已加载的图片元素（用于画布回退与尺寸校验）。 */
  img: HTMLImageElement | null
}

async function tryElectronImage(
  resource: ResolvedImageResource | null,
  strategy: ImageCopyStrategy,
  electron: ElectronLike,
): Promise<{ image: ElectronNativeImageLike | null; reason: ClipboardFailureReason | null }> {
  const factory = electron.nativeImage
  if (!factory) return { image: null, reason: 'IMAGE_DECODE_FAILED' }
  try {
    if (strategy === 'native-path' && resource?.absolutePath) {
      const image = factory.createFromPath(resource.absolutePath)
      return image && !image.isEmpty() ? { image, reason: null } : { image: null, reason: 'IMAGE_DECODE_FAILED' }
    }
    if (strategy === 'native-data-url' && resource) {
      const image = factory.createFromDataURL(resource.value)
      return image && !image.isEmpty() ? { image, reason: null } : { image: null, reason: 'IMAGE_DECODE_FAILED' }
    }
    if (strategy === 'native-buffer' && resource) {
      const response = await fetch(resource.value)
      if (!response.ok) return { image: null, reason: 'REMOTE_FETCH_FAILED' }
      const buffer = new Uint8Array(await response.arrayBuffer())
      const image = factory.createFromBuffer(buffer)
      return image && !image.isEmpty() ? { image, reason: null } : { image: null, reason: 'IMAGE_DECODE_FAILED' }
    }
  } catch (error) {
    const message = errorMessage(error)
    return { image: null, reason: message === 'IMAGE_NOT_LOADED' ? 'IMAGE_NOT_LOADED' : 'IMAGE_DECODE_FAILED' }
  }
  return { image: null, reason: 'IMAGE_DECODE_FAILED' }
}

/** 复制图片像素到系统剪贴板（真实图像数据）。 */
export async function copyImageToClipboard(
  img: HTMLImageElement | null,
  deps: ContentBlockClipboardDeps,
): Promise<ImageCopyResult> {
  const rasterize = deps.rasterize ?? rasterizeImageElement
  const fail = (reason: ClipboardFailureReason, strategy: ImageCopyStrategy | 'clipboard-item' | 'none', error?: unknown): ImageCopyResult => ({
    ok: false,
    verified: false,
    strategy,
    reason,
    width: null,
    height: null,
    note: error == null ? null : errorMessage(error).slice(0, 200),
  })

  if (!img) return fail('IMAGE_ELEMENT_MISSING', 'none')

  const baseDir = deps.getDocumentDirectory()
  const dataSrc = img.closest?.('.md-image')?.getAttribute('data-src') ?? null
  const resource = resolveImageResource({
    src: img.getAttribute('src'),
    dataSrc,
    baseDir,
  })
  const electron = deps.getElectron()
  const plan = planImageCopy(resource, electron != null)
  const note = isAnimatedGif(resource)
    ? 'GIF 仅复制首帧（PNG）'
    : resource?.kind === 'data'
      ? 'data URL 原始数据'
      : null

  // 1) Electron 原生通道（本机路径/远程/data URL）。
  if (electron?.clipboard && plan.strategy !== 'dom-raster') {
    const attempt = await tryElectronImage(resource, plan.strategy, electron)
    if (attempt.image) {
      try {
        electron.clipboard.writeImage(attempt.image)
        const readBack = electron.clipboard.readImage()
        const size = readBack && !readBack.isEmpty() ? readBack.getSize() : null
        if (size && size.width > 0 && size.height > 0) {
          return {
            ok: true,
            verified: true,
            strategy: plan.strategy,
            reason: null,
            width: size.width,
            height: size.height,
            note,
          }
        }
        return fail('CLIPBOARD_VERIFY_FAILED', plan.strategy)
      } catch (error) {
        return fail('CLIPBOARD_WRITE_FAILED', plan.strategy, error)
      }
    }
    // 原生解码失败 → 继续尝试画布栅格化（不假报成功）。
  }

  // 2) 画布栅格化 → PNG。
  if (!img.isConnected) return fail('IMAGE_ELEMENT_MISSING', 'dom-raster')
  if ((img.naturalWidth || 0) <= 0 || (img.naturalHeight || 0) <= 0) {
    return fail('IMAGE_NOT_LOADED', 'dom-raster')
  }
  let dataUrl: string
  try {
    dataUrl = await rasterize(img)
  } catch (error) {
    const message = errorMessage(error)
    if (message.includes('IMAGE_NOT_LOADED')) return fail('IMAGE_NOT_LOADED', 'dom-raster')
    if (message.includes('CANVAS_UNAVAILABLE')) return fail('CANVAS_UNAVAILABLE', 'dom-raster')
    return fail('CANVAS_TAINTED', 'dom-raster', error)
  }

  // 2a) Electron 存在但原生路径失败 → 用栅格化结果交给 nativeImage。
  if (electron?.clipboard && electron.nativeImage) {
    try {
      const image = electron.nativeImage.createFromDataURL(dataUrl)
      if (image && !image.isEmpty()) {
        electron.clipboard.writeImage(image)
        const readBack = electron.clipboard.readImage()
        const size = readBack && !readBack.isEmpty() ? readBack.getSize() : null
        if (size && size.width > 0 && size.height > 0) {
          return {
            ok: true,
            verified: true,
            strategy: 'native-data-url',
            reason: null,
            width: size.width,
            height: size.height,
            note: note ?? '栅格化为 PNG',
          }
        }
      }
    } catch {
      // 继续尝试 Web Clipboard
    }
  }

  // 2b) Web Clipboard（无 Electron 或原生通道不可用）。
  const clipboard = deps.getNavigatorClipboard?.() ?? readNavigatorClipboard()
  const ctor = getClipboardItemCtor()
  if (!clipboard?.write || !ctor) return fail('CLIPBOARD_ITEM_UNAVAILABLE', 'clipboard-item')
  try {
    const blob = dataUrlToBlob(dataUrl)
    await clipboard.write([new ctor({ 'image/png': blob })])
    return {
      ok: true,
      verified: false,
      strategy: 'clipboard-item',
      reason: null,
      width: img.naturalWidth,
      height: img.naturalHeight,
      note: note ?? '栅格化为 PNG',
    }
  } catch (error) {
    return fail('CLIPBOARD_WRITE_FAILED', 'clipboard-item', error)
  }
}

/** 当前文档目录（图片相对路径解析基准）。 */
export function documentDirectoryOf(activeFilePath: string | null): string | null {
  if (!activeFilePath) return null
  try {
    return path.dirname(activeFilePath)
  } catch {
    return null
  }
}

/** 创建生产环境适配器。 */
export function createContentBlockClipboard(deps: {
  getEditor: () => TyporaEditorLike | null
  getElectron: () => ElectronLike | null
  getActiveFilePath: () => string | null
}): {
  readCodeSource: (fence: HTMLElement) => string | null
  copyText: (text: string) => Promise<TextCopyResult>
  copyImage: (img: HTMLImageElement | null) => Promise<ImageCopyResult>
} {
  const resolved: ContentBlockClipboardDeps = {
    getEditor: deps.getEditor,
    getElectron: deps.getElectron,
    getDocumentDirectory: () => documentDirectoryOf(deps.getActiveFilePath()),
  }
  return {
    readCodeSource: (fence) => readCodeSourceFromCodeMirror(fence, deps.getEditor()),
    copyText: (text) => writePlainText(text, resolved),
    copyImage: (img) => copyImageToClipboard(img, resolved),
  }
}
