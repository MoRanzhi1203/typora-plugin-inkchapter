// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IMAGE_DOWNLOAD_MENU_KEY,
  IMAGE_DOWNLOAD_MENU_LABEL,
  ImageContextMenuDownload,
} from './image-context-menu-download'

function buildDom(input: { dataSrc?: string; src?: string; withImage?: boolean } = {}): {
  menu: HTMLElement
  img: HTMLImageElement | null
} {
  document.body.innerHTML = ''
  const write = document.createElement('div')
  write.id = 'write'
  document.body.appendChild(write)

  let img: HTMLImageElement | null = null
  if (input.withImage !== false) {
    const wrapper = document.createElement('span')
    wrapper.className = 'md-image'
    if (input.dataSrc) wrapper.setAttribute('data-src', input.dataSrc)
    img = document.createElement('img')
    img.setAttribute('src', input.src ?? 'file:///D:/assets/a.png')
    wrapper.appendChild(img)
    write.appendChild(wrapper)
  }

  const menu = document.createElement('ul')
  menu.id = 'user-context-menu'
  menu.className = 'context-menu'
  menu.innerHTML = [
    `<li data-key="upload-img"><a role="menuitem">上传图片</a></li>`,
    `<li data-key="delete-img"><a role="menuitem">删除图片</a></li>`,
  ].join('')
  document.body.appendChild(menu)
  return { menu, img }
}

function menuItem(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)
}

function rightClick(target: Element): void {
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

describe('ImageContextMenuDownload', () => {
  let controller: ImageContextMenuDownload

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    controller?.dispose()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('injects one download item into the native menu for a remote image', () => {
    const { menu, img } = buildDom({ dataSrc: 'https://example.test/a.png' })
    controller = new ImageContextMenuDownload({ download: () => undefined })
    controller.start()

    rightClick(img!)
    vi.runAllTimers()

    const item = menuItem()
    expect(item).not.toBeNull()
    expect(item!.textContent).toBe(IMAGE_DOWNLOAD_MENU_LABEL)
    expect(menu.querySelectorAll(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)).toHaveLength(1)
    // 原生菜单项保持不变，且下载项排在上传项之前。
    expect(menu.querySelectorAll('li')).toHaveLength(3)
    expect(menu.firstElementChild?.getAttribute('data-key')).toBe(IMAGE_DOWNLOAD_MENU_KEY)
    expect(menu.querySelector('li[data-key="upload-img"]')).not.toBeNull()
  })

  it('injects into the visible Windows native context menu', () => {
    const { img } = buildDom({ dataSrc: 'https://example.test/a.png' })
    document.getElementById('user-context-menu')?.remove()
    const native = document.createElement('ul')
    native.id = 'context-menu'
    native.className = 'dropdown-menu context-menu show'
    native.innerHTML = [
      `<li data-group="image" data-key="upload-img"><a role="menuitem">上传图片</a></li>`,
      `<li data-group="image" data-key="delete-img"><a role="menuitem">删除图片</a></li>`,
    ].join('')
    document.body.appendChild(native)
    controller = new ImageContextMenuDownload({ download: () => undefined })
    controller.start()

    rightClick(img!)
    vi.runAllTimers()

    const item = native.querySelector<HTMLElement>(`li[data-key="${IMAGE_DOWNLOAD_MENU_KEY}"]`)
    expect(item).not.toBeNull()
    expect(item!.getAttribute('data-group')).toBe('image')
    expect(native.querySelectorAll('li')).toHaveLength(3)
    expect(native.firstElementChild?.getAttribute('data-key')).toBe(IMAGE_DOWNLOAD_MENU_KEY)
  })

  it('does not inject for local images', () => {
    const { menu, img } = buildDom({ dataSrc: 'assets/images/a.png' })
    controller = new ImageContextMenuDownload({ download: () => undefined })
    controller.start()

    rightClick(img!)
    vi.runAllTimers()

    expect(menuItem()).toBeNull()
    expect(menu.querySelectorAll('li')).toHaveLength(2)
  })

  it('removes a stale item when a later context menu is not for a remote image', () => {
    const { img } = buildDom({ dataSrc: 'https://example.test/a.png' })
    controller = new ImageContextMenuDownload({ download: () => undefined })
    controller.start()

    rightClick(img!)
    vi.runAllTimers()
    expect(menuItem()).not.toBeNull()

    rightClick(document.body)
    vi.runAllTimers()
    expect(menuItem()).toBeNull()
  })

  it('invokes the callback with the right-clicked image and hides the menu', () => {
    const { menu, img } = buildDom({ dataSrc: 'https://example.test/a.png' })
    menu.classList.add('show')
    const downloads: HTMLImageElement[] = []
    controller = new ImageContextMenuDownload({ download: image => downloads.push(image) })
    controller.start()

    rightClick(img!)
    vi.runAllTimers()
    menuItem()!.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(downloads).toEqual([img])
    expect(menu.classList.contains('show')).toBe(false)
  })

  it('stops listening and cleans the item after dispose', () => {
    const { img } = buildDom({ dataSrc: 'https://example.test/a.png' })
    controller = new ImageContextMenuDownload({ download: () => undefined })
    controller.start()
    rightClick(img!)
    vi.runAllTimers()
    expect(menuItem()).not.toBeNull()

    controller.dispose()
    vi.runAllTimers()

    expect(menuItem()).toBeNull()
    rightClick(img!)
    vi.runAllTimers()
    expect(menuItem()).toBeNull()
  })
})
