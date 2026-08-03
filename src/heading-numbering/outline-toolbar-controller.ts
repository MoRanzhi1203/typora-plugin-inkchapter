/**
 * Outline Toolbar Controller v3 — single menu-trigger approach.
 *
 * v3 changes from v2:
 * 1. Removed the 3 bare inline buttons (N, ⊟/⊞, 1) that competed with native tab bar layout.
 * 2. Single "大纲操作" (⋯) trigger button in an independent row below the tab bar.
 * 3. Dropdown menu with full Chinese text and checkmark indicators.
 * 4. Menu items share state with settings page via callbacks.
 * 5. Collapse/expand clicks native SPAN.outline-expander (not CSS class manipulation).
 * 6. Proper menu lifecycle: open/close on click, Escape, outside click, tab switch, doc switch.
 *
 * Controls (via menu):
 * 1. 在文档中显示标题编号 (toggle, synced with settings 'enabled')
 * 2. 显示第一级标题编号 (toggle, synced with 'showLevelOneNumber')
 * 3. 折叠所有标题 / 展开所有标题 (native click on outline-expander)
 */

import { clearFileTreeNumberingAttributes } from './outline-numbering-adapter'

export interface OutlineToolbarCallbacks {
  isNumberingEnabled: () => boolean
  toggleNumbering: () => void
  isShowLevelOne: () => boolean
  toggleLevelOneNumber: () => void
  writeDiagnosticFile?: (filename: string, data: string) => void
}

const ACTIONS_ATTR = 'data-inkchapter-outline-actions'
const BUILD_MARKER = 'inkchapter-outline-toolbar-v3-menu'

const MAX_RETRIES = 10
const RETRY_INTERVAL_MS = 200

// ── DOM diagnostic ───────────────────────────────────

function dumpOutlineDiagnostics(controlsContainer: HTMLElement | null): Record<string, unknown> {
  const diagnostic: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    buildMarker: BUILD_MARKER,
  }

  // Tab bar rect
  const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
  if (tabBar) {
    const tr = tabBar.getBoundingClientRect()
    diagnostic.tabBar = {
      rect: { w: Math.round(tr.width), h: Math.round(tr.height), x: Math.round(tr.x), y: Math.round(tr.y) },
      bottom: Math.round(tr.bottom),
      childCount: tabBar.childElementCount,
    }
  }

  // Outline tab button
  const outlineTabBtn = document.querySelector('[data-action="switch-outline"]') as HTMLElement | null
        || document.querySelector('.info-panel-tab-wrapper [data-type="outline"]') as HTMLElement | null
  if (outlineTabBtn) {
    const or = outlineTabBtn.getBoundingClientRect()
    diagnostic.outlineTabBtn = {
      tagName: outlineTabBtn.tagName,
      rect: { w: Math.round(or.width), h: Math.round(or.height), x: Math.round(or.x), y: Math.round(or.y) },
      bottom: Math.round(or.bottom),
      text: outlineTabBtn.textContent?.trim() || '',
    }
  }

  // Controls container
  if (controlsContainer) {
    const cr = controlsContainer.getBoundingClientRect()
    diagnostic.controlsRow = {
      tagName: controlsContainer.tagName,
      rect: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.x), y: Math.round(cr.y) },
      top: Math.round(cr.top),
      bottom: Math.round(cr.bottom),
      display: getComputedStyle(controlsContainer).display,
      parentTag: controlsContainer.parentElement?.tagName || '',
      parentId: controlsContainer.parentElement?.id || '',
      parentChildCount: controlsContainer.parentElement?.childElementCount ?? 0,
    }

    // Overlap check
    if (tabBar) {
      const tr = tabBar.getBoundingClientRect()
      diagnostic.overlapCheck = {
        tabBarBottom: Math.round(tr.bottom),
        controlsRowTop: Math.round(cr.top),
        gap: Math.round(cr.top - tr.bottom),
        noOverlap: cr.top >= tr.bottom,
      }
    }
    if (outlineTabBtn) {
      const or = outlineTabBtn.getBoundingClientRect()
      diagnostic.outlineTabOverlap = {
        outlineTabRight: Math.round(or.right),
        outlineTabBottom: Math.round(or.bottom),
        controlsRowLeft: Math.round(cr.left),
        controlsRowTop: Math.round(cr.top),
        horizontalGap: Math.round(cr.left - or.right),
        verticalGap: Math.round(cr.top - or.bottom),
      }
    }
  }

  // Visible outline content
  const ocCandidates = document.querySelectorAll('#outline-content, .outline-content')
  for (let i = 0; i < ocCandidates.length; i++) {
    const el = ocCandidates[i] as HTMLElement
    const cr = el.getBoundingClientRect()
    if (cr.width > 0 && cr.height > 0 && el.id !== 'toc-content') {
      diagnostic.visibleOutlineContent = {
        id: el.id,
        rect: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.x), y: Math.round(cr.y) },
      }
      break
    }
  }

  // Container count
  diagnostic.actionsContainerCount = document.querySelectorAll(`[${ACTIONS_ATTR}]`).length

  return diagnostic
}

// ── Menu portal ─────────────────────────────────────

const MENU_CLASS = 'inkchapter-outline-menu'
const MENU_ITEM_CLASS = 'inkchapter-outline-menu-item'
const MENU_DIVIDER_CLASS = 'inkchapter-outline-menu-divider'

interface MenuItem {
  type: 'checkbox' | 'action' | 'divider'
  label?: string
  checked?: boolean
  disabled?: boolean
  action?: () => void
}

export class OutlineToolbarController {
  private observer: MutationObserver | null = null
  private callbacks: OutlineToolbarCallbacks
  private injected = false
  private disposed = false
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  // Menu state
  private menuEl: HTMLElement | null = null
  private triggerBtn: HTMLButtonElement | null = null
  private menuOpen = false
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(callbacks: OutlineToolbarCallbacks) {
    this.callbacks = callbacks
  }

  start(): void {
    if (this.disposed) return
    console.log(`[InkChapter] toolbar start  build=${BUILD_MARKER}`)
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
  }

  stop(): void {
    this.disposed = true
    this.cancelRetry()
    this.closeMenu('dispose')
    this.removeControls()
    this.detachObserver()
  }

  reinitialize(): void {
    if (this.disposed) return
    this.cancelRetry()
    this.retryCount = 0
    this.closeMenu('reinitialize')
    this.detachObserver()
    this.removeControls()
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
  }

  /** Refresh menu item states from callbacks. */
  updateAllButtonStates(): void {
    // Menu is re-rendered on open, so no-op for closed state.
    // If menu is open, re-render it.
    if (this.menuOpen) {
      this.closeMenu('state-update')
    }
  }

  // ── Retry mechanism ─────────────────────────────

  private tryInjectWithRetry(): void {
    this.cancelRetry()
    if (this.tryInjectOnce()) {
      this.retryCount = 0
      return
    }
    if (this.retryCount >= MAX_RETRIES) {
      console.log(`[InkChapter] toolbar: max retries (${MAX_RETRIES}) reached`)
      return
    }
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.disposed) this.tryInjectWithRetry()
    }, RETRY_INTERVAL_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  // ── Injection ──────────────────────────────────────

  private tryInjectOnce(): boolean {
    if (this.injected) {
      const existing = document.querySelector(`[${ACTIONS_ATTR}]`)
      if (existing) {
        const cr = existing.getBoundingClientRect()
        if (cr.width > 0 && cr.height > 0) return true
        existing.remove()
        this.injected = false
      } else {
        this.injected = false
      }
    }

    this.removeControls()

    // Find the tab bar to insert after
    const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
    if (!tabBar?.isConnected) return false

    const sidebar = tabBar.parentElement
    if (!sidebar) return false

    // Check if we already have a container
    if (sidebar.querySelector(`[${ACTIONS_ATTR}]`)) return false

    // Create the command row
    const row = document.createElement('div')
    row.className = 'inkchapter-outline-command-row'
    row.setAttribute(ACTIONS_ATTR, 'true')

    // Create the trigger button
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'inkchapter-outline-menu-trigger'
    btn.textContent = '⋯'
    btn.title = '大纲操作'
    btn.setAttribute('aria-label', '大纲操作')
    btn.setAttribute('aria-haspopup', 'menu')
    btn.setAttribute('aria-expanded', 'false')
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation()
      this.toggleMenu(btn)
    }
    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation()
        this.toggleMenu(btn)
      } else if (e.key === 'ArrowDown' && this.menuOpen) {
        e.preventDefault()
        this.focusMenuItem(0)
      }
    }
    row.appendChild(btn)
    this.triggerBtn = btn

    // Insert after tab bar (before sidebar-content)
    if (tabBar.nextSibling) {
      sidebar.insertBefore(row, tabBar.nextSibling)
    } else {
      sidebar.appendChild(row)
    }

    this.injected = true

    // Write diagnostic
    const diag = dumpOutlineDiagnostics(row)
    this.writeDiag(diag)

    return true
  }

  // ── Menu ────────────────────────────────────────────

  private toggleMenu(btn: HTMLButtonElement): void {
    if (this.menuOpen) {
      this.closeMenu('toggle')
    } else {
      this.openMenu(btn)
    }
  }

  private openMenu(btn: HTMLButtonElement): void {
    if (this.menuOpen) return
    this.menuOpen = true
    btn.setAttribute('aria-expanded', 'true')

    // Remove any stale menu
    this.removeMenuElement()

    const menu = this.buildMenu()
    document.body.appendChild(menu)
    this.menuEl = menu

    // Position menu relative to trigger button
    this.positionMenu(menu, btn)

    // Register global listeners
    this.registerMenuListeners()

    // Focus first item
    requestAnimationFrame(() => this.focusMenuItem(0))
  }

  closeMenu(reason: string): void {
    if (!this.menuOpen) return
    this.menuOpen = false
    if (this.triggerBtn) {
      this.triggerBtn.setAttribute('aria-expanded', 'false')
    }
    this.removeMenuElement()
    this.unregisterMenuListeners()
    // Return focus to trigger
    this.triggerBtn?.focus()
  }

  private buildMenu(): HTMLElement {
    const menu = document.createElement('div')
    menu.className = MENU_CLASS
    menu.role = 'menu'
    menu.setAttribute('aria-label', '大纲操作')

    const enabled = this.callbacks.isNumberingEnabled()
    const showL1 = this.callbacks.isShowLevelOne()

    const items: MenuItem[] = [
      {
        type: 'checkbox',
        label: '在文档中显示标题编号',
        checked: enabled,
        action: () => this.callbacks.toggleNumbering(),
      },
      {
        type: 'checkbox',
        label: '显示第一级标题编号',
        checked: enabled && showL1,
        disabled: !enabled,
        action: () => {
          if (!enabled) return
          this.callbacks.toggleLevelOneNumber()
        },
      },
      { type: 'divider' },
      {
        type: 'action',
        label: this.getCollapseLabel(),
        action: () => this.handleCollapseExpand(),
      },
    ]

    for (const item of items) {
      if (item.type === 'divider') {
        const div = document.createElement('div')
        div.className = MENU_DIVIDER_CLASS
        div.setAttribute('role', 'separator')
        menu.appendChild(div)
      } else {
        const el = document.createElement('div')
        el.className = MENU_ITEM_CLASS
        el.role = item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'
        el.tabIndex = -1
        if (item.type === 'checkbox') {
          el.setAttribute('aria-checked', String(item.checked ?? false))
          el.textContent = (item.checked ? '✓ ' : '  ') + (item.label || '')
        } else {
          el.textContent = item.label || ''
        }
        if (item.disabled) {
          el.classList.add('inkchapter-outline-menu-item--disabled')
          el.setAttribute('aria-disabled', 'true')
        }
        if (item.action && !item.disabled) {
          el.onclick = (e) => {
            e.preventDefault(); e.stopPropagation()
            item.action!()
            this.closeMenu('action')
          }
          el.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); e.stopPropagation()
              item.action!()
              this.closeMenu('action')
            }
          }
          el.onmouseenter = () => {
            menu.querySelectorAll(`.${MENU_ITEM_CLASS}`).forEach(mi => mi.classList.remove('focused'))
            el.classList.add('focused')
          }
        }
        menu.appendChild(el)
      }
    }

    return menu
  }

  private getCollapseLabel(): string {
    const outlineRoot = document.querySelector('#outline-content') as HTMLElement | null
    if (!outlineRoot) return '折叠所有标题'

    const wrappers = outlineRoot.querySelectorAll('.outline-item-wrapper')
    let anyExpanded = false
    for (let i = 0; i < wrappers.length; i++) {
      const childrenUl = wrappers[i].querySelector('.outline-children') as HTMLElement | null
      if (childrenUl) {
        const cs = getComputedStyle(childrenUl)
        if (cs.display !== 'none' && childrenUl.querySelectorAll('.outline-item-wrapper').length > 0) {
          anyExpanded = true
          break
        }
      }
    }
    return anyExpanded ? '折叠所有标题' : '展开所有标题'
  }

  private positionMenu(menu: HTMLElement, btn: HTMLButtonElement): void {
    const btnRect = btn.getBoundingClientRect()
    const menuWidth = 240

    // Position below the trigger, right-aligned
    let left = btnRect.right - menuWidth
    let top = btnRect.bottom + 4

    // Keep within viewport
    if (left < 4) left = 4
    if (left + menuWidth > window.innerWidth - 4) {
      left = window.innerWidth - menuWidth - 4
    }

    // If menu would go below viewport, position above trigger
    const estimatedHeight = 130 // approximate
    if (top + estimatedHeight > window.innerHeight) {
      top = btnRect.top - estimatedHeight - 4
    }

    menu.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      min-width: ${menuWidth}px;
      max-width: ${menuWidth}px;
      z-index: 10001;
    `
  }

  private focusMenuItem(index: number): void {
    if (!this.menuEl) return
    const items = this.menuEl.querySelectorAll(`.${MENU_ITEM_CLASS}:not(.${MENU_ITEM_CLASS}--disabled)`)
    if (items.length === 0) return
    const idx = Math.max(0, Math.min(index, items.length - 1))
    ;(items[idx] as HTMLElement).focus()
    this.menuEl.querySelectorAll(`.${MENU_ITEM_CLASS}`).forEach(mi => mi.classList.remove('focused'))
    items[idx].classList.add('focused')
  }

  private handleMenuKeyDown(e: KeyboardEvent): void {
    if (!this.menuEl) return
    const items = Array.from(this.menuEl.querySelectorAll(`.${MENU_ITEM_CLASS}:not(.${MENU_ITEM_CLASS}--disabled)`))
    if (items.length === 0) return
    const currentIdx = items.indexOf(document.activeElement as Element)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        this.focusMenuItem(currentIdx < 0 ? 0 : currentIdx + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        this.focusMenuItem(currentIdx < 0 ? items.length - 1 : currentIdx - 1)
        break
      case 'Escape':
        e.preventDefault(); e.stopPropagation()
        this.closeMenu('escape')
        break
    }
  }

  private removeMenuElement(): void {
    if (this.menuEl) {
      this.menuEl.remove()
      this.menuEl = null
    }
  }

  private registerMenuListeners(): void {
    this.unregisterMenuListeners()

    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.menuOpen) return
      const target = e.target as HTMLElement
      if (this.menuEl && !this.menuEl.contains(target) && target !== this.triggerBtn) {
        this.closeMenu('outside-click')
      }
    }
    document.addEventListener('click', this.outsideClickHandler, true)

    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.menuOpen) {
        this.closeMenu('escape')
      }
    }
    document.addEventListener('keydown', this.escapeHandler, true)
  }

  private unregisterMenuListeners(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler, true)
      this.outsideClickHandler = null
    }
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true)
      this.escapeHandler = null
    }
  }

  // ── Collapse / Expand (native click) ───────────────

  /**
   * Collapse or expand all outline items by clicking SPAN.outline-expander.
   * Typora 1.6.7 structure:
   *   LI.outline-item-wrapper
   *     DIV.outline-item > SPAN.outline-expander (clickable)
   *     UL.outline-children
   */
  private handleCollapseExpand(): void {
    const outlineRoot = document.querySelector('#outline-content') as HTMLElement | null
    if (!outlineRoot) return

    const wrappers = outlineRoot.querySelectorAll('.outline-item-wrapper')
    if (wrappers.length === 0) return

    let anyExpanded = false
    const items: Array<{ expander: HTMLElement; depth: number; isExpanded: boolean }> = []

    for (let i = 0; i < wrappers.length; i++) {
      const wrapper = wrappers[i] as HTMLElement
      const expander = wrapper.querySelector('.outline-expander') as HTMLElement | null
      if (!expander) continue

      const childrenUl = wrapper.querySelector('.outline-children') as HTMLElement | null
      const hasChildren = childrenUl ? childrenUl.querySelectorAll('.outline-item-wrapper').length > 0 : false
      if (!hasChildren) continue

      const depthMatch = wrapper.className.match(/outline-h(\d)/)
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0

      const cs = childrenUl ? getComputedStyle(childrenUl) : null
      const isExpanded = cs ? cs.display !== 'none' : false

      if (isExpanded) anyExpanded = true
      items.push({ expander, depth, isExpanded })
    }

    if (items.length === 0) return

    if (anyExpanded) {
      const toCollapse = items.filter(ei => ei.isExpanded).sort((a, b) => b.depth - a.depth)
      for (const ei of toCollapse) { this.safeClick(ei.expander) }
    } else {
      const toExpand = items.filter(ei => !ei.isExpanded).sort((a, b) => a.depth - b.depth)
      for (const ei of toExpand) { this.safeClick(ei.expander) }
    }
  }

  private safeClick(el: HTMLElement): void {
    try { el.click() } catch { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) } catch { /* ignore */ } }
  }

  // ── Diagnostic ─────────────────────────────────────

  private writeDiag(diag: Record<string, unknown>): void {
    try {
      const json = JSON.stringify(diag, null, 2)
      console.log('[InkChapter DIAGNOSTIC v3]', json)
      if (this.callbacks.writeDiagnosticFile) {
        this.callbacks.writeDiagnosticFile('inkchapter-outline-dom-dump.json', json)
      }
    } catch { /* ignore */ }
  }

  // ── Removal ────────────────────────────────────────

  private removeControls(): void {
    document.querySelectorAll(`[${ACTIONS_ATTR}]`).forEach(el => el.remove())
    this.injected = false
    this.triggerBtn = null
  }

  // ── Observer ───────────────────────────────────────

  private observerRoot: HTMLElement | null = null

  private bindSidebarHostObserver(): void {
    this.detachObserver()

    const sidebar = document.querySelector('#typora-sidebar') as HTMLElement | null
    if (!sidebar?.isConnected) return

    this.observerRoot = sidebar

    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              if (node.id === 'outline-content' || node.classList.contains('outline-content')) {
                if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
                  this.injected = false; this.retryCount = 0; this.tryInjectWithRetry()
                }
                clearFileTreeNumberingAttributes()
                return
              }
            }
          }
          if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
            this.injected = false; this.retryCount = 0; this.tryInjectWithRetry()
          }
        }

        if (m.type === 'attributes') {
          const target = m.target as HTMLElement
          if (target.id === 'outline-content' || target.classList.contains('outline-content')) {
            if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
              this.injected = false; this.retryCount = 0; this.tryInjectWithRetry()
            }
          }
        }
      }
      clearFileTreeNumberingAttributes()
    })

    this.observer.observe(sidebar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }

  private detachObserver(): void {
    if (this.observer) { this.observer.disconnect(); this.observer = null }
    this.observerRoot = null
  }
}
