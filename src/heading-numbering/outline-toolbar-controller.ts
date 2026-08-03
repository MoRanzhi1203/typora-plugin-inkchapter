/**
 * Outline Toolbar Controller v4 — CSS-based depth filter for collapse.
 *
 * v4 changes from v3:
 * 1. Abandoned native expander click approach (React synthetic events block it).
 * 2. CSS-based depth filtering: add collapse class to outline root, CSS rules
 *    show/hide items beyond target depth.
 * 3. Outline items mapped to heading model levels via data-inkchapter-heading-level.
 * 4. Per-document collapseDepth state (not persisted to format settings).
 * 5. "展开所有标题" only removes the collapse class, preserves native expand state.
 * 6. Runtime click evidence written to JSON file.
 */

import { clearFileTreeNumberingAttributes } from './outline-numbering-adapter'
import type { HeadingDescriptor } from './heading-types'

export interface OutlineToolbarCallbacks {
  isNumberingEnabled: () => boolean
  toggleNumbering: () => void
  isShowLevelOne: () => boolean
  toggleLevelOneNumber: () => void
  writeDiagnosticFile?: (filename: string, data: string) => void
  getHeadings?: () => readonly HeadingDescriptor[]
}

const ACTIONS_ATTR = 'data-inkchapter-outline-actions'
const BUILD_MARKER = 'inkchapter-outline-toolbar-v4-depth-filter'

const MAX_RETRIES = 10
const RETRY_INTERVAL_MS = 200

// ── Collapse state ──────────────────────────────────

interface CollapseState {
  collapseDepth: number | null // 1, 2, or null (expanded)
  lastCommand: string
  clickCount: number
}

const collapseStateByDocument: Record<string, CollapseState> = {}

function getOrCreateCollapseState(docKey: string): CollapseState {
  if (!collapseStateByDocument[docKey]) {
    collapseStateByDocument[docKey] = { collapseDepth: null, lastCommand: '', clickCount: 0 }
  }
  return collapseStateByDocument[docKey]
}

// ── Level mapping ───────────────────────────────────

/**
 * Map outline DOM items to heading model levels.
 * Uses the cached headings from the outline controller, matching by document order.
 */
function mapOutlineLevels(root: HTMLElement, headings: readonly HeadingDescriptor[]): number {
  const wrappers = root.querySelectorAll('.outline-item-wrapper')
  let matched = 0

  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i] as HTMLElement
    // Try to match by document order first
    let level = 0
    if (i < headings.length) {
      level = headings[i].level
    } else {
      // Fallback: use outline-h{N} class
      const dm = w.className.match(/outline-h(\d)/)
      level = dm ? parseInt(dm[1], 10) : 0
    }
    if (level > 0 && level <= 6) {
      w.setAttribute('data-inkchapter-heading-level', String(level))
      w.classList.add(`inkchapter-outline-level-${level}`)
      matched++
    }
  }
  return matched
}

/** Count visible outline items by level. */
function countVisibleByLevel(root: HTMLElement): Record<number, number> {
  const counts: Record<number, number> = {}
  const wrappers = root.querySelectorAll('.outline-item-wrapper')
  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i] as HTMLElement
    const cr = w.getBoundingClientRect()
    if (cr.height === 0) continue
    const lvAttr = w.getAttribute('data-inkchapter-heading-level')
    const level = lvAttr ? parseInt(lvAttr, 10) : 0
    if (level > 0) {
      counts[level] = (counts[level] || 0) + 1
    }
  }
  return counts
}

// ── DOM diagnostic ───────────────────────────────────

function dumpOutlineDiagnostics(controlsContainer: HTMLElement | null): Record<string, unknown> {
  const diagnostic: Record<string, unknown> = { timestamp: new Date().toISOString(), buildMarker: BUILD_MARKER }
  const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
  if (tabBar) {
    const tr = tabBar.getBoundingClientRect()
    diagnostic.tabBar = { rect: { w: Math.round(tr.width), h: Math.round(tr.height), x: Math.round(tr.x), y: Math.round(tr.y) }, bottom: Math.round(tr.bottom) }
  }
  if (controlsContainer) {
    const cr = controlsContainer.getBoundingClientRect()
    diagnostic.controlsRow = { rect: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.x), y: Math.round(cr.y) }, display: getComputedStyle(controlsContainer).display }
    if (tabBar) { const tr = tabBar.getBoundingClientRect(); diagnostic.overlapCheck = { tabBarBottom: Math.round(tr.bottom), controlsRowTop: Math.round(cr.top), noOverlap: cr.top >= tr.bottom } }
  }
  diagnostic.actionsContainerCount = document.querySelectorAll(`[${ACTIONS_ATTR}]`).length
  return diagnostic
}

// ── Menu types ──────────────────────────────────────

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

// ── Controller ──────────────────────────────────────

export class OutlineToolbarController {
  private observer: MutationObserver | null = null
  private callbacks: OutlineToolbarCallbacks
  private injected = false
  private disposed = false
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  private menuEl: HTMLElement | null = null
  private triggerBtn: HTMLButtonElement | null = null
  private menuOpen = false
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null

  private currentDocKey = ''
  private collapseRunning = false

  constructor(callbacks: OutlineToolbarCallbacks) {
    this.callbacks = callbacks
    ;(window as any).__inkchapterTestOutlineCollapse = () => this.runtimeCollapseTest()
  }

  start(): void {
    if (this.disposed) return
    console.log(`[InkChapter] toolbar start  build=${BUILD_MARKER}`)
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
  }

  stop(): void {
    this.disposed = true
    this.removeCollapseFilter()
    this.removeControls()
    this.closeMenu('dispose')
    this.cancelRetry()
    this.detachObserver()
    delete (window as any).__inkchapterTestOutlineCollapse
  }

  reinitialize(): void {
    if (this.disposed) return
    this.cancelRetry()
    this.retryCount = 0
    this.closeMenu('reinitialize')
    this.detachObserver()
    this.removeControls()
    this.removeCollapseFilter()
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
    // Restore collapse state for new document
    this.restoreCollapseState()
  }

  updateAllButtonStates(): void { if (this.menuOpen) this.closeMenu('state-update') }

  /** Called on document switch to set new key and restore state. */
  setDocumentKey(key: string): void {
    this.currentDocKey = key
    this.restoreCollapseState()
  }

  // ── Retry ─────────────────────────────────────────

  private tryInjectWithRetry(): void {
    this.cancelRetry()
    if (this.tryInjectOnce()) { this.retryCount = 0; return }
    if (this.retryCount >= MAX_RETRIES) return
    this.retryCount++
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.disposed) this.tryInjectWithRetry() }, RETRY_INTERVAL_MS)
  }
  private cancelRetry(): void { if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null } }

  // ── Injection ──────────────────────────────────────

  private tryInjectOnce(): boolean {
    if (this.injected) {
      const existing = document.querySelector(`[${ACTIONS_ATTR}]`)
      if (existing) { const cr = existing.getBoundingClientRect(); if (cr.width > 0 && cr.height > 0) return true; existing.remove(); this.injected = false }
      else { this.injected = false }
    }
    this.removeControls()
    const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
    if (!tabBar?.isConnected) return false
    const sidebar = tabBar.parentElement; if (!sidebar) return false
    if (sidebar.querySelector(`[${ACTIONS_ATTR}]`)) return false

    const row = document.createElement('div'); row.className = 'inkchapter-outline-command-row'; row.setAttribute(ACTIONS_ATTR, 'true')
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'inkchapter-outline-menu-trigger'
    btn.textContent = '⋯'; btn.title = '大纲操作'; btn.setAttribute('aria-label', '大纲操作'); btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false')
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleMenu(btn) }
    btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.toggleMenu(btn) } else if (e.key === 'ArrowDown' && this.menuOpen) { e.preventDefault(); this.focusMenuItem(0) } }
    row.appendChild(btn); this.triggerBtn = btn
    if (tabBar.nextSibling) sidebar.insertBefore(row, tabBar.nextSibling); else sidebar.appendChild(row)
    this.injected = true
    this.writeDiag(dumpOutlineDiagnostics(row))
    return true
  }

  // ── Menu ────────────────────────────────────────────

  private toggleMenu(btn: HTMLButtonElement): void { if (this.menuOpen) this.closeMenu('toggle'); else this.openMenu(btn) }
  private openMenu(btn: HTMLButtonElement): void {
    if (this.menuOpen) return; this.menuOpen = true; btn.setAttribute('aria-expanded', 'true')
    this.removeMenuElement(); const menu = this.buildMenu(); document.body.appendChild(menu); this.menuEl = menu
    this.positionMenu(menu, btn); this.registerMenuListeners(); requestAnimationFrame(() => this.focusMenuItem(0))
  }
  closeMenu(reason: string): void {
    if (!this.menuOpen) return; this.menuOpen = false
    if (this.triggerBtn) this.triggerBtn.setAttribute('aria-expanded', 'false')
    this.removeMenuElement(); this.unregisterMenuListeners(); this.triggerBtn?.focus()
  }

  private buildMenu(): HTMLElement {
    const menu = document.createElement('div'); menu.className = MENU_CLASS; menu.role = 'menu'; menu.setAttribute('aria-label', '大纲操作')
    const enabled = this.callbacks.isNumberingEnabled(); const showL1 = this.callbacks.isShowLevelOne()
    const items: MenuItem[] = [
      { type: 'checkbox', label: '在文档中显示标题编号', checked: enabled, action: () => this.callbacks.toggleNumbering() },
      { type: 'checkbox', label: '显示第一级标题编号', checked: enabled && showL1, disabled: !enabled, action: () => { if (!enabled) return; this.callbacks.toggleLevelOneNumber() } },
      { type: 'divider' },
      { type: 'action', label: this.getCollapseLabel(), action: () => { this.executeCollapseExpand() } },
    ]
    for (const item of items) {
      if (item.type === 'divider') { const d = document.createElement('div'); d.className = MENU_DIVIDER_CLASS; d.setAttribute('role', 'separator'); menu.appendChild(d) }
      else {
        const el = document.createElement('div'); el.className = MENU_ITEM_CLASS; el.role = item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'; el.tabIndex = -1
        if (item.type === 'checkbox') { el.setAttribute('aria-checked', String(item.checked ?? false)); el.textContent = (item.checked ? '✓ ' : '  ') + (item.label || '') }
        else el.textContent = item.label || ''
        if (item.disabled) { el.classList.add('inkchapter-outline-menu-item--disabled'); el.setAttribute('aria-disabled', 'true') }
        if (item.action && !item.disabled) {
          el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); item.action!() }
          el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); item.action!() } }
          el.onmouseenter = () => { menu.querySelectorAll(`.${MENU_ITEM_CLASS}`).forEach(mi => mi.classList.remove('focused')); el.classList.add('focused') }
        }
        menu.appendChild(el)
      }
    }
    return menu
  }

  private getCollapseLabel(): string {
    const state = getOrCreateCollapseState(this.currentDocKey)
    return state.collapseDepth !== null ? '展开所有标题' : '折叠所有标题'
  }

  private positionMenu(menu: HTMLElement, btn: HTMLButtonElement): void {
    const br = btn.getBoundingClientRect(); const mw = 240
    let left = br.right - mw; if (left < 4) left = 4; if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4
    let top = br.bottom + 4; if (top + 130 > window.innerHeight) top = br.top - 130 - 4
    menu.style.cssText = `position:fixed;left:${left}px;top:${top}px;min-width:${mw}px;max-width:${mw}px;z-index:10001;`
  }

  private focusMenuItem(index: number): void {
    if (!this.menuEl) return; const items = this.menuEl.querySelectorAll(`.${MENU_ITEM_CLASS}:not(.${MENU_ITEM_CLASS}--disabled)`)
    if (items.length === 0) return; const idx = Math.max(0, Math.min(index, items.length - 1))
    ;(items[idx] as HTMLElement).focus(); this.menuEl.querySelectorAll(`.${MENU_ITEM_CLASS}`).forEach(mi => mi.classList.remove('focused')); items[idx].classList.add('focused')
  }

  private removeMenuElement(): void { if (this.menuEl) { this.menuEl.remove(); this.menuEl = null } }

  private registerMenuListeners(): void {
    this.unregisterMenuListeners()
    this.outsideClickHandler = (e) => { if (this.menuOpen && this.menuEl && !this.menuEl.contains(e.target as HTMLElement) && e.target !== this.triggerBtn) this.closeMenu('outside-click') }
    document.addEventListener('click', this.outsideClickHandler, true)
    this.escapeHandler = (e) => { if (e.key === 'Escape' && this.menuOpen) this.closeMenu('escape') }
    document.addEventListener('keydown', this.escapeHandler, true)
  }
  private unregisterMenuListeners(): void {
    if (this.outsideClickHandler) { document.removeEventListener('click', this.outsideClickHandler, true); this.outsideClickHandler = null }
    if (this.escapeHandler) { document.removeEventListener('keydown', this.escapeHandler, true); this.escapeHandler = null }
  }

  // ── Collapse / Expand (CSS-based depth filter) ────

  private executeCollapseExpand(): void {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    if (!root) return

    const showL1 = this.callbacks.isShowLevelOne()
    const state = getOrCreateCollapseState(this.currentDocKey)
    state.clickCount++
    state.lastCommand = 'collapse-expand'

    if (state.collapseDepth !== null) {
      // Currently collapsed → expand
      this.removeCollapseFilter()
      state.collapseDepth = null
    } else {
      // Currently expanded → collapse
      const targetDepth = showL1 ? 1 : 2
      // Map levels from heading model
      const headings = this.callbacks.getHeadings?.() ?? []
      mapOutlineLevels(root, headings)

      this.applyCollapseFilter(root, targetDepth)
      state.collapseDepth = targetDepth
    }

    // Write runtime evidence
    const visibleByLevel = countVisibleByLevel(root)
    this.writeRuntimeEvidence(state, showL1, root, visibleByLevel)

    // Update menu
    this.closeMenu('action')
  }

  /** Apply collapse CSS class to outline root. */
  private applyCollapseFilter(root: HTMLElement, depth: number): void {
    // Remove old collapse classes
    root.classList.remove('inkchapter-collapse-to-h1', 'inkchapter-collapse-to-h2')
    // Add new collapse class
    root.classList.add(depth === 1 ? 'inkchapter-collapse-to-h1' : 'inkchapter-collapse-to-h2')
    root.setAttribute('data-inkchapter-collapse-depth', String(depth))
  }

  /** Remove collapse filter, restoring all items. */
  private removeCollapseFilter(): void {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    if (root) {
      root.classList.remove('inkchapter-collapse-to-h1', 'inkchapter-collapse-to-h2')
      root.removeAttribute('data-inkchapter-collapse-depth')
    }
  }

  /** Restore collapse state after document switch or DOM rebuild. */
  private restoreCollapseState(): void {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    if (!root) return
    const state = getOrCreateCollapseState(this.currentDocKey)
    if (state.collapseDepth !== null) {
      const headings = this.callbacks.getHeadings?.() ?? []
      mapOutlineLevels(root, headings)
      this.applyCollapseFilter(root, state.collapseDepth)
    }
  }

  // ── Runtime evidence ───────────────────────────────

  private writeRuntimeEvidence(state: CollapseState, showL1: boolean, root: HTMLElement, visibleByLevel: Record<number, number>): void {
    const evidence = {
      clickCount: state.clickCount,
      lastCommand: state.lastCommand,
      documentKey: this.currentDocKey,
      showLevelOneNumber: showL1,
      targetDepth: showL1 ? 1 : 2,
      collapseDepth: state.collapseDepth,
      itemCount: root.querySelectorAll('.outline-item-wrapper').length,
      visibleByLevel,
      timestamp: new Date().toISOString(),
    }
    const json = JSON.stringify(evidence, null, 2)
    console.log('[InkChapter COLLAPSE-EVIDENCE]', json)
    this.callbacks.writeDiagnosticFile?.('inkchapter-outline-collapse-runtime.json', json)
  }

  // ── Diagnostic test (exposed on window) ────────────

  private async runtimeCollapseTest(): Promise<Record<string, unknown>> {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    const showL1 = this.callbacks.isShowLevelOne()
    const headings = this.callbacks.getHeadings?.() ?? []
    mapOutlineLevels(root!, headings)
    const before = countVisibleByLevel(root!)

    const result: Record<string, unknown> = {
      showLevelOneNumber: showL1,
      documentKey: this.currentDocKey,
      headingModelCount: headings.length,
      outlineItemCount: root?.querySelectorAll('.outline-item-wrapper').length ?? 0,
      before: { visibleByLevel: before, totalItems: root?.querySelectorAll('.outline-item-wrapper').length ?? 0 },
    }

    // Collapse
    const targetDepth = showL1 ? 1 : 2
    this.applyCollapseFilter(root!, targetDepth)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    result.afterCollapse = { visibleByLevel: countVisibleByLevel(root!) }

    // Expand
    this.removeCollapseFilter()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    result.afterExpand = { visibleByLevel: countVisibleByLevel(root!) }

    const json = JSON.stringify(result, null, 2)
    console.log('[InkChapter COLLAPSE-TEST]', json)
    this.callbacks.writeDiagnosticFile?.('inkchapter-outline-collapse-test.json', json)
    return result
  }

  // ── Diagnostic ─────────────────────────────────────

  private writeDiag(diag: Record<string, unknown>): void {
    try { this.callbacks.writeDiagnosticFile?.('inkchapter-outline-dom-dump.json', JSON.stringify(diag, null, 2)) } catch { /* ignore */ }
  }

  // ── Removal ────────────────────────────────────────

  private removeControls(): void { document.querySelectorAll(`[${ACTIONS_ATTR}]`).forEach(el => el.remove()); this.injected = false; this.triggerBtn = null }

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
            if (node instanceof HTMLElement && (node.id === 'outline-content' || node.classList.contains('outline-content'))) {
              if (!document.querySelector(`[${ACTIONS_ATTR}]`)) { this.injected = false; this.retryCount = 0; this.tryInjectWithRetry() }
              // Outline content was added → restore collapse state
              setTimeout(() => this.restoreCollapseState(), 100)
              clearFileTreeNumberingAttributes(); return
            }
          }
          if (!document.querySelector(`[${ACTIONS_ATTR}]`)) { this.injected = false; this.retryCount = 0; this.tryInjectWithRetry() }
        }
      }
      clearFileTreeNumberingAttributes()
    })
    this.observer.observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  }
  private detachObserver(): void { if (this.observer) { this.observer.disconnect(); this.observer = null }; this.observerRoot = null }
}
