/**
 * Outline Toolbar Controller v5 — Panel-aware mount with visibility detection.
 *
 * v5 changes from v4:
 * 1. Command row is a sibling of .info-panel-tab-wrapper, injected after it.
 * 2. Visibility gated by isOutlinePanelActive() — hidden when "文件" tab is active.
 * 3. Tab click listener + MutationObserver for real active-state detection.
 * 4. Menu closes immediately on tab switch to "文件".
 * 5. Container dedup: at most 1 [data-inkchapter-outline-actions] in the DOM.
 * 6. No modification to native tab text, width, underline, or click area.
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
const BUILD_MARKER = 'inkchapter-outline-toolbar-v5.1-compact-row'

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

function mapOutlineLevels(root: HTMLElement, headings: readonly HeadingDescriptor[]): number {
  const wrappers = root.querySelectorAll('.outline-item-wrapper')
  let matched = 0

  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i] as HTMLElement
    let level = 0
    if (i < headings.length) {
      level = headings[i].level
    } else {
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
  const diagnostic: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    buildMarker: BUILD_MARKER,
    isOutlinePanelActive: isOutlinePanelActive(),
  }

  const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
  if (tabBar) {
    const tr = tabBar.getBoundingClientRect()
    diagnostic.tabBar = {
      rect: { w: Math.round(tr.width), h: Math.round(tr.height), x: Math.round(tr.x), y: Math.round(tr.y) },
      bottom: Math.round(tr.bottom),
    }
    // Record tab states
    const tabs = tabBar.querySelectorAll('.info-panel-tab')
    const tabStates: Record<string, string> = {}
    tabs.forEach(t => {
      const el = t as HTMLElement
      tabStates[el.textContent?.trim() || '?'] = el.classList.contains('active') ? 'active' : 'inactive'
    })
    diagnostic.tabStates = tabStates
  }

  if (controlsContainer) {
    const cr = controlsContainer.getBoundingClientRect()
    const cs = getComputedStyle(controlsContainer)
    diagnostic.controlsRow = {
      rect: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.x), y: Math.round(cr.y) },
      display: cs.display,
      visibility: cs.visibility,
    }
    if (tabBar) {
      const tr = tabBar.getBoundingClientRect()
      diagnostic.overlapCheck = {
        tabBarBottom: Math.round(tr.bottom),
        controlsRowTop: Math.round(cr.top),
        noOverlap: cr.top >= tr.bottom,
      }
    }
  }

  // Check parent structure
  if (controlsContainer?.parentElement) {
    const parent = controlsContainer.parentElement
    diagnostic.parentElement = {
      tagName: parent.tagName,
      id: parent.id || '',
      className: parent.className || '',
      isSiblingOfTabBar: parent === tabBar?.parentElement,
    }
  }

  diagnostic.actionsContainerCount = document.querySelectorAll(`[${ACTIONS_ATTR}]`).length

  // Outline content state
  const oc = document.querySelector('#outline-content') as HTMLElement | null
  if (oc) {
    const ocr = oc.getBoundingClientRect()
    const ocs = getComputedStyle(oc)
    diagnostic.outlineContent = {
      visible: ocr.width > 0 && ocr.height > 0,
      display: ocs.display,
      rect: { w: Math.round(ocr.width), h: Math.round(ocr.height) },
    }
  }

  // File library state
  const fl = document.querySelector('#file-library') as HTMLElement | null
  if (fl) {
    const flr = fl.getBoundingClientRect()
    const fls = getComputedStyle(fl)
    diagnostic.fileLibrary = {
      visible: flr.width > 0 && flr.height > 0,
      display: fls.display,
      rect: { w: Math.round(flr.width), h: Math.round(flr.height) },
    }
  }

  return diagnostic
}

// ── Panel active detection ──────────────────────────

/**
 * Determine whether the outline panel is the currently active tab.
 * Uses multiple signals: tab active class + outline-content visibility.
 */
function isOutlinePanelActive(): boolean {
  // Method 1: Check tab active state
  const tabs = document.querySelectorAll('.info-panel-tab')
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i] as HTMLElement
    if (tab.classList.contains('active') && (tab.textContent?.includes('大纲') || tab.textContent?.includes('Outline'))) {
      return true
    }
  }

  // Method 2: Check outline-content visibility
  const oc = document.querySelector('#outline-content') as HTMLElement | null
  if (oc) {
    const r = oc.getBoundingClientRect()
    const cs = getComputedStyle(oc)
    if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
      return true
    }
  }

  return false
}

/**
 * Determine whether the file panel is currently active.
 */
function isFilePanelActive(): boolean {
  const tabs = document.querySelectorAll('.info-panel-tab')
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i] as HTMLElement
    if (tab.classList.contains('active') && (tab.textContent?.includes('文件') || tab.textContent?.includes('File'))) {
      return true
    }
  }

  const fl = document.querySelector('#file-library') as HTMLElement | null
  if (fl) {
    const r = fl.getBoundingClientRect()
    const cs = getComputedStyle(fl)
    if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
      return true
    }
  }

  return false
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

  // v5: tab click listener reference
  private tabClickHandler: ((e: Event) => void) | null = null
  // v5: track last known panel state to avoid redundant updates
  private lastOutlineActive: boolean | null = null

  constructor(callbacks: OutlineToolbarCallbacks) {
    this.callbacks = callbacks
    ;(window as any).__inkchapterTestOutlineCollapse = () => this.runtimeCollapseTest()
    // Expose diagnostic for runtime verification
    ;(window as any).__inkchapterOutlineDiagnostics = () => {
      const row = document.querySelector(`[${ACTIONS_ATTR}]`) as HTMLElement | null
      return dumpOutlineDiagnostics(row)
    }
  }

  start(): void {
    if (this.disposed) return
    console.log(`[InkChapter] toolbar start  build=${BUILD_MARKER}`)
    this.bindTabClickListeners()
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
    // Initial visibility sync
    this.updateVisibility()
  }

  stop(): void {
    this.disposed = true
    this.removeCollapseFilter()
    this.removeControls()
    this.closeMenu('dispose')
    this.cancelRetry()
    this.detachObserver()
    this.unbindTabClickListeners()
    delete (window as any).__inkchapterTestOutlineCollapse
    delete (window as any).__inkchapterOutlineDiagnostics
  }

  reinitialize(): void {
    if (this.disposed) return
    this.cancelRetry()
    this.retryCount = 0
    this.closeMenu('reinitialize')
    this.detachObserver()
    this.removeControls()
    this.removeCollapseFilter()
    this.bindTabClickListeners()
    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()
    this.restoreCollapseState()
    this.updateVisibility()
  }

  updateAllButtonStates(): void {
    if (this.menuOpen) this.closeMenu('state-update')
    this.updateVisibility()
  }

  setDocumentKey(key: string): void {
    this.currentDocKey = key
    this.restoreCollapseState()
    this.updateVisibility()
  }

  // ── v5: Tab click listeners ──────────────────────

  private bindTabClickListeners(): void {
    this.unbindTabClickListeners()
    this.tabClickHandler = (e: Event) => {
      const target = e.target as HTMLElement
      // Check if a tab was clicked
      const tab = target.closest('.info-panel-tab') as HTMLElement | null
      if (tab) {
        // Wait for Typora to update active state, then sync
        setTimeout(() => this.handleTabSwitch(), 50)
      }
    }
    // Use capture phase so we get the event before other handlers
    document.addEventListener('click', this.tabClickHandler, true)
  }

  private unbindTabClickListeners(): void {
    if (this.tabClickHandler) {
      document.removeEventListener('click', this.tabClickHandler, true)
      this.tabClickHandler = null
    }
  }

  /** Handle tab switch: update visibility, close menu if needed. */
  private handleTabSwitch(): void {
    const outlineActive = isOutlinePanelActive()

    // If switching to file panel and menu is open, close it
    if (!outlineActive && this.menuOpen) {
      this.closeMenu('tab-switch-to-file')
    }

    this.updateVisibility()
  }

  // ── v5: Visibility management ────────────────────

  /** Show/hide the command row based on active panel. */
  private updateVisibility(): void {
    const row = document.querySelector(`[${ACTIONS_ATTR}]`) as HTMLElement | null
    if (!row) return

    const outlineActive = isOutlinePanelActive()
    const fileActive = isFilePanelActive()

    // Avoid redundant updates
    if (this.lastOutlineActive === outlineActive && row.hidden === !outlineActive) return
    this.lastOutlineActive = outlineActive

    if (outlineActive) {
      row.hidden = false
      row.removeAttribute('aria-hidden')
    } else if (fileActive) {
      row.hidden = true
      row.setAttribute('aria-hidden', 'true')
    } else {
      // Neither panel clearly active — use safe fallback
      row.hidden = true
      row.setAttribute('aria-hidden', 'true')
    }

    // If hidden and menu is open, close it
    if (row.hidden && this.menuOpen) {
      this.closeMenu('visibility-hidden')
    }
  }

  // ── Retry ─────────────────────────────────────────

  private tryInjectWithRetry(): void {
    this.cancelRetry()
    if (this.tryInjectOnce()) { this.retryCount = 0; return }
    if (this.retryCount >= MAX_RETRIES) return
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.disposed) this.tryInjectWithRetry()
    }, RETRY_INTERVAL_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  // ── v5: Injection with panel awareness ────────────

  private tryInjectOnce(): boolean {
    if (this.injected) {
      const existing = document.querySelector(`[${ACTIONS_ATTR}]`)
      if (existing) {
        const cr = existing.getBoundingClientRect()
        if (cr.width > 0 && cr.height > 0) {
          this.updateVisibility()
          return true
        }
        existing.remove()
        this.injected = false
      } else {
        this.injected = false
      }
    }

    this.removeControls()

    // Find the tab bar — this is the stable anchor
    const tabBar = document.querySelector('.info-panel-tab-wrapper') as HTMLElement | null
    if (!tabBar?.isConnected) return false

    const sidebar = tabBar.parentElement
    if (!sidebar) return false

    // Dedup: remove any existing row
    if (sidebar.querySelector(`[${ACTIONS_ATTR}]`)) return false

    // Create the command row as a sibling of the tab bar
    const row = document.createElement('div')
    row.className = 'inkchapter-outline-command-row'
    row.setAttribute(ACTIONS_ATTR, 'true')

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'inkchapter-outline-menu-trigger'
    btn.textContent = '⋯'
    btn.title = '大纲操作'
    btn.setAttribute('aria-label', '大纲操作')
    btn.setAttribute('aria-haspopup', 'menu')
    btn.setAttribute('aria-expanded', 'false')
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleMenu(btn) }
    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); this.toggleMenu(btn)
      } else if (e.key === 'ArrowDown' && this.menuOpen) {
        e.preventDefault(); this.focusMenuItem(0)
      }
    }
    row.appendChild(btn)
    this.triggerBtn = btn

    // Insert after tab bar (as sibling in sidebar)
    if (tabBar.nextSibling) {
      sidebar.insertBefore(row, tabBar.nextSibling)
    } else {
      sidebar.appendChild(row)
    }

    this.injected = true

    // Apply visibility based on active panel
    this.updateVisibility()

    this.writeDiag(dumpOutlineDiagnostics(row))
    return true
  }

  // ── Menu ────────────────────────────────────────────

  private toggleMenu(btn: HTMLButtonElement): void {
    if (this.menuOpen) this.closeMenu('toggle')
    else this.openMenu(btn)
  }

  private openMenu(btn: HTMLButtonElement): void {
    if (this.menuOpen) return
    this.menuOpen = true
    btn.setAttribute('aria-expanded', 'true')
    this.removeMenuElement()
    const menu = this.buildMenu()
    document.body.appendChild(menu)
    this.menuEl = menu
    this.positionMenu(menu, btn)
    this.registerMenuListeners()
    requestAnimationFrame(() => this.focusMenuItem(0))
  }

  closeMenu(reason: string): void {
    if (!this.menuOpen) return
    this.menuOpen = false
    if (this.triggerBtn) this.triggerBtn.setAttribute('aria-expanded', 'false')
    this.removeMenuElement()
    this.unregisterMenuListeners()
    if (this.triggerBtn && reason !== 'dispose') this.triggerBtn.focus()
  }

  private buildMenu(): HTMLElement {
    const menu = document.createElement('div')
    menu.className = MENU_CLASS
    menu.role = 'menu'
    menu.setAttribute('aria-label', '大纲操作')

    const enabled = this.callbacks.isNumberingEnabled()
    const showL1 = this.callbacks.isShowLevelOne()

    const items: MenuItem[] = [
      { type: 'checkbox', label: '在文档中显示标题编号', checked: enabled, action: () => this.callbacks.toggleNumbering() },
      { type: 'action', label: enabled ? (showL1 ? '切换为严格模式' : '切换为宽松模式') : '标题结构（需先启用编号）', disabled: !enabled, action: () => { if (!enabled) return; this.callbacks.toggleLevelOneNumber() } },
      { type: 'divider' },
      { type: 'action', label: this.getCollapseLabel(), action: () => { this.executeCollapseExpand() } },
    ]

    for (const item of items) {
      if (item.type === 'divider') {
        const d = document.createElement('div')
        d.className = MENU_DIVIDER_CLASS
        d.setAttribute('role', 'separator')
        menu.appendChild(d)
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
          el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); item.action!() }
          el.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); item.action!() }
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
    const state = getOrCreateCollapseState(this.currentDocKey)
    return state.collapseDepth !== null ? '展开所有标题' : '折叠所有标题'
  }

  private positionMenu(menu: HTMLElement, btn: HTMLButtonElement): void {
    const br = btn.getBoundingClientRect()
    const mw = 240
    let left = br.right - mw
    if (left < 4) left = 4
    if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4
    let top = br.bottom + 4
    if (top + 130 > window.innerHeight) top = br.top - 130 - 4
    menu.style.cssText = `position:fixed;left:${left}px;top:${top}px;min-width:${mw}px;max-width:${mw}px;z-index:10001;`
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

  private removeMenuElement(): void {
    if (this.menuEl) { this.menuEl.remove(); this.menuEl = null }
  }

  private registerMenuListeners(): void {
    this.unregisterMenuListeners()
    this.outsideClickHandler = (e) => {
      if (this.menuOpen && this.menuEl && !this.menuEl.contains(e.target as HTMLElement) && e.target !== this.triggerBtn) {
        this.closeMenu('outside-click')
      }
    }
    document.addEventListener('click', this.outsideClickHandler, true)
    this.escapeHandler = (e) => {
      if (e.key === 'Escape' && this.menuOpen) this.closeMenu('escape')
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

  // ── Collapse / Expand (CSS-based depth filter) ────

  private executeCollapseExpand(): void {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    if (!root) return

    const showL1 = this.callbacks.isShowLevelOne()
    const state = getOrCreateCollapseState(this.currentDocKey)
    state.clickCount++
    state.lastCommand = 'collapse-expand'

    if (state.collapseDepth !== null) {
      this.removeCollapseFilter()
      state.collapseDepth = null
    } else {
      // Use resolved structure: strict→root H2, loose→root H1
      const targetDepth = showL1 ? 1 : 2
      const headings = this.callbacks.getHeadings?.() ?? []
      mapOutlineLevels(root, headings)
      this.applyCollapseFilter(root, targetDepth)
      state.collapseDepth = targetDepth
    }

    const visibleByLevel = countVisibleByLevel(root)
    this.writeRuntimeEvidence(state, showL1, root, visibleByLevel)
    this.closeMenu('action')
  }

  private applyCollapseFilter(root: HTMLElement, depth: number): void {
    root.classList.remove('inkchapter-collapse-to-h1', 'inkchapter-collapse-to-h2')
    root.classList.add(depth === 1 ? 'inkchapter-collapse-to-h1' : 'inkchapter-collapse-to-h2')
    root.setAttribute('data-inkchapter-collapse-depth', String(depth))
  }

  private removeCollapseFilter(): void {
    const root = document.querySelector('#outline-content') as HTMLElement | null
    if (root) {
      root.classList.remove('inkchapter-collapse-to-h1', 'inkchapter-collapse-to-h2')
      root.removeAttribute('data-inkchapter-collapse-depth')
    }
  }

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

  private writeRuntimeEvidence(
    state: CollapseState,
    showL1: boolean,
    root: HTMLElement,
    visibleByLevel: Record<number, number>,
  ): void {
    const evidence = {
      clickCount: state.clickCount,
      lastCommand: state.lastCommand,
      documentKey: this.currentDocKey,
      showLevelOneNumber: showL1,
      headingStructureMode: showL1 ? 'loose' : 'strict',
      numberingRootPhysicalLevel: showL1 ? 1 : 2,
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
      headingStructureMode: showL1 ? 'loose' : 'strict',
      documentKey: this.currentDocKey,
      numberingRootPhysicalLevel: showL1 ? 1 : 2,
      headingModelCount: headings.length,
      outlineItemCount: root?.querySelectorAll('.outline-item-wrapper').length ?? 0,
      before: {
        visibleByLevel: before,
        totalItems: root?.querySelectorAll('.outline-item-wrapper').length ?? 0,
      },
    }

    const targetDepth = showL1 ? 1 : 2
    this.applyCollapseFilter(root!, targetDepth)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    result.afterCollapse = { visibleByLevel: countVisibleByLevel(root!) }

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
    try {
      this.callbacks.writeDiagnosticFile?.('inkchapter-outline-dom-dump.json', JSON.stringify(diag, null, 2))
    } catch { /* ignore */ }
  }

  // ── Removal ────────────────────────────────────────

  private removeControls(): void {
    document.querySelectorAll(`[${ACTIONS_ATTR}]`).forEach(el => el.remove())
    this.injected = false
    this.triggerBtn = null
  }

  // ── v5: Sidebar host observer with tab state detection ──

  private observerRoot: HTMLElement | null = null

  private bindSidebarHostObserver(): void {
    this.detachObserver()
    const sidebar = document.querySelector('#typora-sidebar') as HTMLElement | null
    if (!sidebar?.isConnected) return
    this.observerRoot = sidebar

    this.observer = new MutationObserver((mutations) => {
      let needsInject = false
      let needsVisibilityUpdate = false

      for (const m of mutations) {
        if (m.type === 'attributes') {
          // Detect tab state changes (active class or style on tab elements)
          const target = m.target as HTMLElement
          if (target.classList?.contains('info-panel-tab') || target.closest?.('.info-panel-tab-wrapper')) {
            if (m.attributeName === 'class' || m.attributeName === 'style') {
              needsVisibilityUpdate = true
            }
          }
        }

        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              if (node.id === 'outline-content' || node.classList.contains('outline-content')) {
                if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
                  needsInject = true
                }
                setTimeout(() => this.restoreCollapseState(), 100)
                clearFileTreeNumberingAttributes()
              }
              // Detect tab bar insertion
              if (node.classList.contains('info-panel-tab-wrapper') || node.querySelector('.info-panel-tab-wrapper')) {
                needsVisibilityUpdate = true
                if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
                  needsInject = true
                }
              }
            }
          }

          // Check if our row was removed (DOM rebuild)
          if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
            needsInject = true
          }

          clearFileTreeNumberingAttributes()
        }
      }

      if (needsInject) {
        this.injected = false
        this.retryCount = 0
        this.tryInjectWithRetry()
      }

      if (needsVisibilityUpdate) {
        this.updateVisibility()
      }
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
