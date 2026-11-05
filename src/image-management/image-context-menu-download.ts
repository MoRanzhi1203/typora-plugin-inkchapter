/**
 * 在 Typora 原生图片右键菜单中追加「下载图片」。
 *
 * 只追加一个菜单项，不替换、不重排原生菜单：
 * - 右键命中图片时记录目标，菜单渲染完成后注入；
 * - 非图片 / 本地图片不注入，并清理上一次残留项；
 * - 点击后关闭原生菜单并回调下载。
 */

import { buildImageActions } from '../document-utilities/content-block-toolbar-image-actions'

export const IMAGE_DOWNLOAD_MENU_KEY = 'inkchapter-download-image'
export const IMAGE_DOWNLOAD_MENU_LABEL = '下载并转为本地引用（墨章）'

export interface ImageContextMenuDownloadOptions {
  download: (image: HTMLImageElement) => void
  label?: string
}

function menuElement(): HTMLElement | null {
  const native = document.getElementById('context-menu')
  const custom = document.getElementById('user-context-menu')
  // Windows/Linux 图片右键使用 #context-menu；macOS/自定义菜单使用 #user-context-menu。
  if (native?.classList.contains('show')) return native
  if (custom?.classList.contains('show')) return custom
  return native ?? custom
}

function imageOf(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null
  const img = target.closest('img')
  if (!(img instanceof HTMLImageElement)) return null
  return img.closest('.md-image') ? img : null
}

function remoteUrlOf(img: HTMLImageElement): string | null {
  const wrapper = img.closest<HTMLElement>('.md-image')
  return buildImageActions({
    src: img.getAttribute('src'),
    dataSrc: wrapper?.getAttribute('data-src') ?? null,
    alt: img.getAttribute('alt'),
    baseDir: null,
  }).remoteUrl
}

export class ImageContextMenuDownload {
  private image: HTMLImageElement | null = null
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private started = false

  constructor(private readonly options: ImageContextMenuDownloadOptions) {}

  start(): void {
    if (this.started) return
    this.started = true
    document.addEventListener('contextmenu', this.onContextMenu, true)
    document.addEventListener('click', this.onClick, true)
  }

  dispose(): void {
    if (!this.started) return
    this.started = false
    document.removeEventListener('contextmenu', this.onContextMenu, true)
    document.removeEventListener('click', this.onClick, true)
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.image = null
    this.removeItem()
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    this.image = imageOf(event.target)
    // 0ms：原生菜单已写入 HTML；120ms：showCustom/定位完成后再次校正。
    this.scheduleSync(0)
    this.scheduleSync(120)
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const item = event.target.closest(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    const img = this.image
    this.image = null
    item.closest<HTMLElement>('.context-menu')?.classList.remove('show')
    if (img) this.options.download(img)
  }

  private scheduleSync(delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.syncMenu()
    }, delay)
    this.timers.add(timer)
  }

  private syncMenu(): void {
    const menu = menuElement()
    if (!menu) return
    if (!this.image || !remoteUrlOf(this.image)) {
      this.removeItem()
      return
    }
    const otherId = menu.id === 'context-menu' ? 'user-context-menu' : 'context-menu'
    document.getElementById(otherId)
      ?.querySelector(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)
      ?.remove()
    if (menu.querySelector(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)) return
    const item = this.buildItem()
    const reference = this.insertionReference(menu)
    if (reference && reference.parentElement === menu) menu.insertBefore(item, reference)
    else menu.appendChild(item)
  }

  private buildItem(): HTMLElement {
    const item = document.createElement('li')
    item.setAttribute('data-key', IMAGE_DOWNLOAD_MENU_KEY)
    item.setAttribute('data-group', 'image')
    const anchor = document.createElement('a')
    anchor.setAttribute('role', 'menuitem')
    anchor.textContent = this.options.label ?? IMAGE_DOWNLOAD_MENU_LABEL
    item.appendChild(anchor)
    return item
  }

  /** 尽量放在图片操作区（上传/删除）旁边，找不到时追加到末尾。 */
  private insertionReference(menu: HTMLElement): HTMLElement | null {
    const candidates = [
      'li[data-key="upload-img"]',
      'li[data-key="delete-img"]',
      'li[data-key="delete-img-file"]',
      'li[data-key="zoom-img"]',
    ]
    for (const selector of candidates) {
      const found = menu.querySelector<HTMLElement>(selector)
      if (found) return found
    }
    return null
  }

  private removeItem(): void {
    for (const id of ['context-menu', 'user-context-menu']) {
      document.getElementById(id)?.querySelector(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)?.remove()
    }
  }
}
