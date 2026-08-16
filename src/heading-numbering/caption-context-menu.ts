/**
 * Caption Context Menu — right-click entry point for Caption System V1 naming.
 *
 * Event-chain guarantee:
 * - The menu and its items are marked with data-inkchapter-ui.
 * - Outside pointerdown close uses event.composedPath() so a click INSIDE the
 *   menu never closes it before the item action runs.
 * - The naming target snapshot is frozen at resolve time; the item action uses
 *   that frozen snapshot (never event.target / selection / activeElement).
 * - The action executes once (guarded) on click, then closes the menu.
 */

import type { CaptionService, CaptionNamingTarget } from './caption-service'
import type { CaptionTargetType } from './caption-system'
import { CAPTION_TYPE_CONFIG } from './caption-system'
import { promptCaptionTitle } from './caption-dialog'

const MENU_CLASS = 'inkchapter-caption-menu'
const MENU_ITEM_CLASS = 'inkchapter-caption-menu__item'

export interface CaptionMenuLabels {
  set: string
  edit: string
  clear: string
}

export function captionMenuLabels(type: CaptionTargetType): CaptionMenuLabels {
  if (type === 'table') return { set: '设置表名…', edit: '编辑表名…', clear: '清除表名' }
  if (type === 'figure') return { set: '设置图名…', edit: '编辑图名…', clear: '清除图名' }
  return { set: '设置代码片段名称…', edit: '编辑代码片段名称…', clear: '清除代码片段名称' }
}

function typeLabel(type: CaptionTargetType): string {
  if (type === 'table') return '表名'
  if (type === 'figure') return '图名'
  return '代码片段名'
}

export class CaptionContextMenu {
  private currentMenu: HTMLElement | null = null
  private activeTarget: CaptionNamingTarget | null = null
  private disposers: Array<() => void> = []
  private actionConsumed = false

  constructor(private service: CaptionService) {}

  attach(getRoot: () => HTMLElement | null): () => void {
    const handler = (e: MouseEvent) => {
      // Caption branch first: if the event path touches an InkChapter caption,
      // resolve via its owner map (not the nearest img/table/code).
      const captionEl = this.findCaptionFromPath(e)
      let target: CaptionNamingTarget | null
      if (captionEl) {
        target = this.service.resolveCaptionOwner(captionEl)
      } else {
        const el = e.target as Element | null
        target = el ? this.service.resolveCaptionNamingTarget(el) : null
      }
      if (!target) return

      e.preventDefault()
      e.stopPropagation()
      this.close()
      this.activeTarget = target
      this.actionConsumed = false
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

  private findCaptionFromPath(e: Event): HTMLElement | null {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : []
    for (const node of path) {
      if (node instanceof HTMLElement && node.matches('[data-inkchapter-caption]')) return node
    }
    const target = e.target
    if (target instanceof Element) {
      return target.closest('[data-inkchapter-caption]') as HTMLElement | null
    }
    return null
  }

  dispose(): void {
    this.close()
    for (const d of this.disposers) { try { d() } catch { /* ignore */ } }
    this.disposers = []
  }

  private openMenu(x: number, y: number, target: CaptionNamingTarget): void {
    const menu = document.createElement('div')
    menu.className = MENU_CLASS
    menu.setAttribute('data-inkchapter-caption-menu', 'true')
    menu.setAttribute('data-inkchapter-ui', 'true')
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    // Internal pointerdown must never bubble out and close the menu.
    menu.addEventListener('pointerdown', (e) => e.stopPropagation())
    menu.addEventListener('mousedown', (e) => e.stopPropagation())

    const labels = captionMenuLabels(target.type)

    const items: Array<{ label: string; action: () => void }> = []
    if (target.currentName) {
      items.push({ label: labels.edit, action: () => void this.editName(target) })
      items.push({ label: labels.clear, action: () => this.clearName(target) })
    } else {
      items.push({ label: labels.set, action: () => void this.setName(target) })
    }

    for (const item of items) {
      const el = document.createElement('div')
      el.className = MENU_ITEM_CLASS
      el.setAttribute('data-inkchapter-ui', 'true')
      el.textContent = item.label

      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        this.logItemEvent('NAME-MENU-ITEM-POINTERDOWN', e, target)
      })
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation()
        this.logItemEvent('NAME-MENU-ITEM-MOUSEDOWN', e, target)
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        this.logItemEvent('NAME-MENU-ITEM-CLICK', e, target)
        if (this.actionConsumed) return
        this.actionConsumed = true
        this.close()
        item.action()
      })
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    this.currentMenu = menu

    const rect = menu.getBoundingClientRect()
    const activeEl = document.activeElement
    console.info(
      `[InkChapter Caption] NAME-MENU-OPEN type=${target.type} runtimeKey=${target.runtimeKey} ` +
      `number=${target.currentNumber} hasName=${!!target.currentName} ` +
      `menuConnected=${menu.isConnected} menuParent=${menu.parentElement ? menu.parentElement.tagName : 'null'} ` +
      `menuRect=${Math.round(rect.width)}x${Math.round(rect.height)} ` +
      `activeElement=${activeEl ? activeEl.tagName : 'null'} decision=OPENED`,
    )

    // Outside pointerdown closes the menu only when NOT inside the menu tree.
    const onDocPointerDown = (e: Event) => {
      if (this.currentMenu && e.composedPath && e.composedPath().includes(this.currentMenu)) return
      this.close()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    this.menuDocCloseHandler = onDocPointerDown
  }

  private menuDocCloseHandler: ((e: Event) => void) | null = null

  private logItemEvent(logName: string, e: Event, target: CaptionNamingTarget): void {
    console.info(
      `[InkChapter Caption] ${logName} type=${target.type} runtimeKey=${target.runtimeKey} ` +
      `eventPhase=${e.eventPhase} defaultPrevented=${e.defaultPrevented} ` +
      `target=${(e.target as Element | null)?.tagName ?? 'null'} ` +
      `currentTarget=${(e.currentTarget as Element | null)?.tagName ?? 'null'} ` +
      `menuConnected=${this.currentMenu ? this.currentMenu.isConnected : false} decision=RECEIVED`,
    )
  }

  private async setName(target: CaptionNamingTarget): Promise<void> {
    if (!this.validateBeforeDialog(target)) return
    this.emitDialogOpenRequest(target, 'set')
    const prefix = CAPTION_TYPE_CONFIG[target.type].prefix
    const currentLabel = `${prefix} ${target.currentNumber}`
    const title = await promptCaptionTitle({
      typeLabel: `设置${typeLabel(target.type)}`,
      currentLabel,
    })
    if (title === null) return
    if (target.type === 'figure') {
      console.info(
        `[InkChapter Caption] FAW stage=FAW2 decision=PASS reason=DIALOG_CONFIRMED ` +
        `type=figure runtimeKey=${target.runtimeKey} newName=${JSON.stringify(title.trim())}`,
      )
    }
    const trimmed = title.trim()
    if (trimmed === '') return
    this.service.setCaption(target.type, target.target, trimmed)
  }

  private async editName(target: CaptionNamingTarget): Promise<void> {
    if (!this.validateBeforeDialog(target)) return
    this.emitDialogOpenRequest(target, 'edit')
    const prefix = CAPTION_TYPE_CONFIG[target.type].prefix
    const currentLabel = `${prefix} ${target.currentNumber}`
    const title = await promptCaptionTitle({
      typeLabel: `编辑${typeLabel(target.type)}`,
      currentLabel,
      initialTitle: target.currentName ?? '',
    })
    if (title === null) return
    if (target.type === 'figure') {
      console.info(
        `[InkChapter Caption] FAW stage=FAW2 decision=PASS reason=DIALOG_CONFIRMED ` +
        `type=figure runtimeKey=${target.runtimeKey} newName=${JSON.stringify(title.trim())}`,
      )
    }
    const trimmed = title.trim()
    if (trimmed === '') {
      this.service.clearCaptionName(target.type, target.target)
      return
    }
    if (target.type === 'figure') {
      this.service.setCaption('figure', target.target, trimmed)
    } else if (target.recordId) {
      this.service.editCaption(target.recordId, trimmed)
    } else {
      this.service.setCaption(target.type, target.target, trimmed)
    }
  }

  private clearName(target: CaptionNamingTarget): void {
    if (!this.validateBeforeDialog(target)) return
    this.service.clearCaptionName(target.type, target.target)
  }

  /** Snapshot must still point at a live target in the same document. */
  private validateBeforeDialog(target: CaptionNamingTarget): boolean {
    if (!this.service.isNamingTargetValid(target)) {
      console.info(
        `[InkChapter Caption] NAME-DIALOG-OPEN-REQUEST type=${target.type} runtimeKey=${target.runtimeKey} ` +
        `decision=BLOCK reason=TARGET_STALE_BEFORE_DIALOG`,
      )
      return false
    }
    return true
  }

  private emitDialogOpenRequest(target: CaptionNamingTarget, action: 'set' | 'edit'): void {
    console.info(
      `[InkChapter Caption] NAME-DIALOG-OPEN-REQUEST type=${target.type} runtimeKey=${target.runtimeKey} ` +
      `number=${target.currentNumber} action=${action} decision=REQUESTED`,
    )
  }

  private close(): void {
    if (this.currentMenu) {
      console.info('[InkChapter Caption] NAME-MENU-CLOSE decision=CLOSED')
    }
    if (this.menuDocCloseHandler) {
      document.removeEventListener('pointerdown', this.menuDocCloseHandler, true)
      this.menuDocCloseHandler = null
    }
    this.currentMenu?.remove()
    this.currentMenu = null
  }
}
