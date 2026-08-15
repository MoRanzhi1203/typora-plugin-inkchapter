/**
 * Caption Context Menu — right-click entry point for Caption System V1.
 *
 * Resolves the right-clicked element to a whole table/figure/code target, then
 * offers 设置/编辑/删除 actions via a DOM menu (works in jsdom and Typora).
 *
 * Typora's native `bridge.callSync("contextMenu.setItems", ...)` is macOS-only
 * and not reachable in the sandbox; the DOM menu is the cross-platform V1 path.
 */

import type { CaptionService } from './caption-service'
import type { CaptionTarget } from './caption-dom-adapter'
import type { CaptionTargetType } from './caption-system'
import { CAPTION_TYPE_CONFIG } from './caption-system'
import { promptCaptionTitle, captionTypeLabel } from './caption-dialog'

const MENU_CLASS = 'inkchapter-caption-menu'
const MENU_ITEM_CLASS = 'inkchapter-caption-menu__item'

export interface CaptionMenuLabels {
  set: string
  edit: string
  remove: string
}

export function captionMenuLabels(type: CaptionTargetType): CaptionMenuLabels {
  if (type === 'table') return { set: '设置表名', edit: '编辑表名', remove: '删除表名' }
  if (type === 'figure') return { set: '设置图名', edit: '编辑图名', remove: '删除图名' }
  return { set: '设置代码片段名', edit: '编辑代码片段名', remove: '删除代码片段名' }
}

export class CaptionContextMenu {
  private currentMenu: HTMLElement | null = null
  private activeTarget: CaptionTarget | null = null
  private disposers: Array<() => void> = []

  constructor(private service: CaptionService) {}

  attach(getRoot: () => HTMLElement | null): () => void {
    const handler = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (!el) return
      const target = this.service.resolveTargetForElement(el)
      if (!target) return

      e.preventDefault()
      e.stopPropagation()
      this.close()
      this.activeTarget = target
      this.openMenu(e.clientX, e.clientY, target)
    }

    const root = getRoot()
    if (root) root.addEventListener('contextmenu', handler as EventListener)
    const dispose = () => {
      const r = getRoot()
      if (r) r.removeEventListener('contextmenu', handler as EventListener)
    }
    this.disposers.push(dispose)
    return dispose
  }

  dispose(): void {
    this.close()
    for (const d of this.disposers) { try { d() } catch { /* ignore */ } }
    this.disposers = []
  }

  private openMenu(x: number, y: number, target: CaptionTarget): void {
    const menu = document.createElement('div')
    menu.className = MENU_CLASS
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    const labels = captionMenuLabels(target.type)
    const existing = this.service.getCaptionForTarget(target)

    const items: Array<{ label: string; action: () => void }> = []
    if (existing) {
      items.push({ label: labels.edit, action: () => void this.editCaption(target, existing.captionId) })
      items.push({ label: labels.remove, action: () => this.service.deleteCaption(existing.captionId) })
    } else {
      items.push({ label: labels.set, action: () => void this.setCaption(target) })
    }

    for (const item of items) {
      const el = document.createElement('div')
      el.className = MENU_ITEM_CLASS
      el.textContent = item.label
      el.addEventListener('click', () => {
        this.close()
        item.action()
      })
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    this.currentMenu = menu

    setTimeout(() => {
      document.addEventListener('mousedown', () => this.close(), { once: true })
    }, 0)
  }

  private async setCaption(target: CaptionTarget): Promise<void> {
    const type = target.type
    const numberHint = this.service.getTypeCaptionCount(type) + 1
    const prefix = CAPTION_TYPE_CONFIG[type].prefix
    const title = await promptCaptionTitle({
      typeLabel: captionTypeLabel(type),
      getPreview: (t) => `${prefix} ${numberHint}  ${t}`.trimEnd(),
    })
    if (title !== null && title !== '') {
      this.service.setCaption(type, target, title)
    }
  }

  private async editCaption(target: CaptionTarget, captionId: string): Promise<void> {
    const type = target.type
    const record = this.service.getCaptionById(captionId)
    const number = this.service.getResolvedNumber(captionId) ?? (this.service.getTypeCaptionCount(type))
    const prefix = CAPTION_TYPE_CONFIG[type].prefix
    const title = await promptCaptionTitle({
      typeLabel: captionTypeLabel(type),
      initialTitle: record?.title ?? '',
      getPreview: (t) => `${prefix} ${number}  ${t}`.trimEnd(),
    })
    if (title !== null && title !== '') {
      this.service.editCaption(captionId, title)
    }
  }

  private close(): void {
    this.currentMenu?.remove()
    this.currentMenu = null
  }
}
