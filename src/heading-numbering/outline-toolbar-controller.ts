/**
 * Outline Toolbar Controller v2 — injects quick controls into Typora's native outline sidebar.
 *
 * v2 changes:
 * 1. DOM diagnostic dump on start/reinit to help debug real DOM structure
 * 2. Visibility-verified host finding (non-zero rect, not hidden)
 * 3. Retry mechanism (up to 10 attempts, 200ms intervals)
 * 4. Unique container with data-inkchapter-outline-actions attribute
 * 5. Native collapse/expand via real button click events (not CSS class manipulation)
 * 6. Observer on stable sidebar host, not guessing toolbar selectors
 *
 * Controls:
 * 1. Toggle heading numbering (on/off, synced with settings 'enabled')
 * 2. Collapse/expand all outline items (native click on expand toggles)
 * 3. Toggle first-level heading numbering (on/off, synced with 'showLevelOneNumber')
 */

import { clearFileTreeNumberingAttributes } from './outline-numbering-adapter'

export interface OutlineToolbarCallbacks {
  isNumberingEnabled: () => boolean
  toggleNumbering: () => void
  isShowLevelOne: () => boolean
  toggleLevelOneNumber: () => void
  /** Write diagnostic data to a file. Called on start/reinit with DOM structure info. */
  writeDiagnosticFile?: (filename: string, data: string) => void
}

const ACTIONS_ATTR = 'data-inkchapter-outline-actions'
const BTN_CLASS = 'inkchapter-outline-action'
const BTN_ACTIVE = 'inkchapter-outline-action--active'
const BUILD_MARKER = 'inkchapter-outline-toolbar-v2'

const MAX_RETRIES = 10
const RETRY_INTERVAL_MS = 200

/** Write diagnostic DOM information for debugging. */
function dumpOutlineDiagnostics(): Record<string, unknown> {
  const diagnostic: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    buildMarker: BUILD_MARKER,
  }

  // Scan for sidebar-related elements
  const sidebarEls: Array<Record<string, unknown>> = []
  const candidateSelectors = [
    '#typora-sidebar', '.typora-sidebar', '.sidebar-content', '#sidebar-content',
    '.info-panel-tab-wrapper', '#info-panel-tab-wrapper',
    '[data-action="switch-outline"]', '[data-type="outline"]',
    '.outline-content', '#outline-content', '.outline-panel',
    '.outline-item', '.outline-item-wrapper',
    '.sidebar-tabs', '.typora-sidebar-tabs',
    '.file-list', '#file-library', '.file-library',
    '#outline-panel', '#outline',
    `[${ACTIONS_ATTR}]`,
  ]
  for (const sel of candidateSelectors) {
    const els = document.querySelectorAll(sel)
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement
      const rect = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      sidebarEls.push({
        selector: sel,
        index: i,
        tagName: el.tagName,
        id: el.id || '',
        className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 80) : '',
        rect: { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        isConnected: el.isConnected,
        childCount: el.childElementCount,
      })
    }
  }
  diagnostic.sidebarElements = sidebarEls

  // Find visible outline content (skip hidden TOC panel)
  let outlineContent: Element | null = null
  const ocCandidates = document.querySelectorAll('#outline-content, .outline-content, #outline-panel, .outline-panel')
  for (let i = 0; i < ocCandidates.length; i++) {
    const el = ocCandidates[i] as HTMLElement
    const cr = el.getBoundingClientRect()
    if (cr.width > 0 && cr.height > 0 && el.id !== 'toc-content') {
      outlineContent = el
      break
    }
  }
  // Fallback: accept any non-zero outline content
  if (!outlineContent) {
    for (let i = 0; i < ocCandidates.length; i++) {
      const el = ocCandidates[i] as HTMLElement
      const cr = el.getBoundingClientRect()
      if (cr.width > 0 && cr.height > 0) {
        outlineContent = el
        break
      }
    }
  }
  if (outlineContent) {
    const rect = outlineContent.getBoundingClientRect()
    const cs = getComputedStyle(outlineContent)
    diagnostic.outlineContent = {
      tagName: (outlineContent as HTMLElement).tagName,
      id: (outlineContent as HTMLElement).id,
      className: (outlineContent as HTMLElement).className?.slice?.(0, 80) || '',
      rect: { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) },
      display: cs.display,
      visibility: cs.visibility,
      parentTag: (outlineContent.parentElement as HTMLElement)?.tagName || '',
      parentId: (outlineContent.parentElement as HTMLElement)?.id || '',
      parentClass: (outlineContent.parentElement as HTMLElement)?.className?.slice?.(0, 80) || '',
    }

    // Get first few outline items
    const items = outlineContent.querySelectorAll('.outline-item, .outline-item-wrapper, [data-depth]')
    const itemDetails: Array<Record<string, unknown>> = []
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const item = items[i] as HTMLElement
      const ir = item.getBoundingClientRect()
      const expandBtn = item.querySelector('button, [role="button"], .outline-item-toggle, [data-action="toggle"], [aria-expanded]')
      itemDetails.push({
        index: i,
        tagName: item.tagName,
        className: item.className?.slice?.(0, 60) || '',
        rect: { w: Math.round(ir.width), h: Math.round(ir.height) },
        hasExpandButton: !!expandBtn,
        expandBtnTag: expandBtn?.tagName || '',
        expandBtnClass: (expandBtn as HTMLElement)?.className?.slice?.(0, 40) || '',
        ariaExpanded: (expandBtn as HTMLElement)?.getAttribute?.('aria-expanded') || null,
        dataDepth: item.getAttribute('data-depth'),
        textPreview: (item.textContent || '').slice(0, 50),
        children: Array.from(item.children).slice(0, 3).map(ch => ({
          tag: ch.tagName,
          cls: (ch as HTMLElement).className?.slice?.(0, 40) || '',
          text: (ch.textContent || '').slice(0, 30),
        })),
      })
    }
    diagnostic.outlineItems = itemDetails
    diagnostic.outlineItemCount = items.length

    // Also scan wrapper LI elements
    const wrappers = outlineContent.querySelectorAll('.outline-item-wrapper')
    const wrapperDetails: Array<Record<string, unknown>> = []
    for (let i = 0; i < Math.min(wrappers.length, 5); i++) {
      const w = wrappers[i] as HTMLElement
      const wr = w.getBoundingClientRect()
      // Check for clickable elements
      const allClickable = w.querySelectorAll('*')
      const clickableInfo: string[] = []
      for (let j = 0; j < Math.min(allClickable.length, 5); j++) {
        const c = allClickable[j] as HTMLElement
        clickableInfo.push(`${c.tagName}.${c.className?.split?.(' ')?.[0] || ''}[aria-expanded=${c.getAttribute('aria-expanded')}]`)
      }
      wrapperDetails.push({
        index: i,
        tagName: w.tagName,
        className: w.className?.slice?.(0, 60) || '',
        rect: { w: Math.round(wr.width), h: Math.round(wr.height) },
        childCount: w.childElementCount,
        children: Array.from(w.children).map(ch => ({
          tag: ch.tagName,
          cls: (ch as HTMLElement).className?.slice?.(0, 40) || '',
          text: (ch.textContent || '').slice(0, 40),
        })),
        clickableDescendants: clickableInfo,
      })
    }
    diagnostic.outlineWrappers = wrapperDetails
  }

  // Write to file if in test vault
  try {
    // Find the vault root by looking for .typora directory
    const scripts = document.querySelectorAll('script[src*="main.js"]')
    for (const s of Array.from(scripts)) {
      const src = (s as HTMLScriptElement).src
      if (src.includes('inkchapter') && src.includes('.typora')) {
        const vaultMatch = src.match(/(.+)\\.typora\\plugins\\dist\\main\.js/)
        if (vaultMatch) {
          diagnostic.vaultRoot = vaultMatch[1]
          break
        }
      }
    }
  } catch { /* ignore */ }

  // Check our controls container
  const ourContainers = document.querySelectorAll(`[${ACTIONS_ATTR}]`)
  diagnostic.controlsContainerCount = ourContainers.length
  if (ourContainers.length > 0) {
    const c = ourContainers[0] as HTMLElement
    const cr = c.getBoundingClientRect()
    const cs = getComputedStyle(c)
    diagnostic.controlsContainer = {
      tagName: c.tagName,
      className: c.className?.slice?.(0, 80) || '',
      rect: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.x), y: Math.round(cr.y) },
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      parentTag: c.parentElement?.tagName || '',
      parentId: c.parentElement?.id || '',
      parentClass: c.parentElement?.className?.slice?.(0, 80) || '',
      childCount: c.childElementCount,
    }
    // List button states
    const btns = c.querySelectorAll('button')
    const btnStates: Array<Record<string, unknown>> = []
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i] as HTMLButtonElement
      const br = b.getBoundingClientRect()
      btnStates.push({
        text: b.textContent,
        title: b.title,
        ariaPressed: b.getAttribute('aria-pressed'),
        disabled: b.disabled,
        rect: { w: Math.round(br.width), h: Math.round(br.height), x: Math.round(br.x), y: Math.round(br.y) },
      })
    }
    diagnostic.controlsButtons = btnStates
  }

  return diagnostic
}

export class OutlineToolbarController {
  private observer: MutationObserver | null = null
  private sidebarHostObserver: MutationObserver | null = null
  private callbacks: OutlineToolbarCallbacks
  private injected = false
  private disposed = false
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(callbacks: OutlineToolbarCallbacks) {
    this.callbacks = callbacks
  }

  start(): void {
    if (this.disposed) return
    console.log(`[InkChapter] toolbar start  build=${BUILD_MARKER}`)

    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()

    // Dump DOM diagnostics AFTER injection attempt
    const diag = dumpOutlineDiagnostics()
    this.writeDiag(diag)
  }

  stop(): void {
    this.disposed = true
    this.cancelRetry()
    this.removeControls()
    this.detachObserver()
    this.detachSidebarHostObserver()
  }

  reinitialize(): void {
    if (this.disposed) return
    this.cancelRetry()
    this.retryCount = 0
    this.detachObserver()
    this.detachSidebarHostObserver()
    this.removeControls()

    this.tryInjectWithRetry()
    this.bindSidebarHostObserver()

    const diag = dumpOutlineDiagnostics()
    this.writeDiag(diag)
  }

  /** Write diagnostic data via callback if available. */
  private writeDiag(diag: Record<string, unknown>): void {
    try {
      const json = JSON.stringify(diag, null, 2)
      console.log('[InkChapter DIAGNOSTIC]', json)
      if (this.callbacks.writeDiagnosticFile) {
        this.callbacks.writeDiagnosticFile('inkchapter-outline-dom-dump.json', json)
      }
    } catch { /* ignore */ }
  }

  // ── Retry mechanism ─────────────────────────────

  private tryInjectWithRetry(): void {
    this.cancelRetry()
    const success = this.tryInjectOnce()
    if (success) {
      this.retryCount = 0
      return
    }
    if (this.retryCount >= MAX_RETRIES) {
      console.log(`[InkChapter] toolbar: max retries (${MAX_RETRIES}) reached, giving up`)
      return
    }
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.disposed) return
      this.tryInjectWithRetry()
    }, RETRY_INTERVAL_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  // ── Injection ──────────────────────────────────────

  private tryInjectOnce(): boolean {
    if (this.injected) {
      // Verify existing container is still in DOM and visible
      const existing = document.querySelector(`[${ACTIONS_ATTR}]`)
      if (existing) {
        const cr = existing.getBoundingClientRect()
        if (cr.width > 0 && cr.height > 0) return true
        // Container exists but not visible — remove and re-inject
        existing.remove()
        this.injected = false
      } else {
        this.injected = false
      }
    }

    // Clean up any orphaned containers
    this.removeControls()

    const mountPoint = this.findVisibleMountPoint()
    if (!mountPoint) return false

    this.injectControlsAt(mountPoint)
    this.injected = true
    return true
  }

  /**
   * Find the best visible mount point for the controls container.
   * Priority:
   * 1. The tab bar below "文件/大纲" tabs (info-panel-tab-wrapper parent or similar)
   * 2. The visible outline content container (prepend before outline list)
   * 3. Any visible outline panel
   */
  private findVisibleMountPoint(): HTMLElement | null {
    // Strategy 1: Insert below the tab bar
    // In Typora 1.6.x, the sidebar has a tab bar with "文件" and "大纲" buttons
    const tabBar = this.findVisibleTabBar()
    if (tabBar) {
      // Check if there's already a sibling container below the tab bar
      // The tab bar is usually inside a container; insert after that container
      const tabBarParent = tabBar.parentElement
      if (tabBarParent) {
        // Insert after tab bar parent (the tab wrapper)
        return tabBarParent
      }
    }

    // Strategy 2: Find the visible outline content container
    const outlineContent = this.findVisibleOutlineContent()
    if (outlineContent) {
      return outlineContent
    }

    // Strategy 3: Any visible outline panel
    const selectors = [
      '#outline-content', '.outline-content',
      '#outline-panel', '.outline-panel',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el?.isConnected) {
        const cr = el.getBoundingClientRect()
        // Allow hidden panels (they may become visible later)
        return el
      }
    }

    return null
  }

  private findVisibleTabBar(): HTMLElement | null {
    const selectors = [
      '.info-panel-tab-wrapper',
      '#info-panel-tab-wrapper',
      '.typora-sidebar-tabs',
      '.sidebar-tabs',
      '[role="tablist"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el?.isConnected) continue
      const cr = el.getBoundingClientRect()
      if (cr.width > 0 && cr.height > 0) {
        const cs = getComputedStyle(el)
        if (cs.display !== 'none' && cs.visibility !== 'hidden') {
          return el
        }
      }
    }
    return null
  }

  private findVisibleOutlineContent(): HTMLElement | null {
    const selectors = [
      '#outline-content', '.outline-content',
      '#outline-panel', '.outline-panel',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el?.isConnected) continue
      const cr = el.getBoundingClientRect()
      if (cr.width > 0 && cr.height > 0) {
        const cs = getComputedStyle(el)
        if (cs.display !== 'none' && cs.visibility !== 'hidden') {
          return el
        }
      }
    }
    return null
  }

  // ── Render ─────────────────────────────────────────

  private injectControlsAt(mountPoint: HTMLElement): void {
    // Check if this mount point already has our container
    if (mountPoint.querySelector(`[${ACTIONS_ATTR}]`)) return

    // Check if the mount point is the tab bar parent (insert after it)
    const tabBar = this.findVisibleTabBar()
    const isTabBarParent = tabBar && mountPoint === tabBar.parentElement

    const container = document.createElement('div')
    container.setAttribute(ACTIONS_ATTR, 'true')
    container.className = 'inkchapter-outline-actions'

    // 1. Numbering toggle
    const numBtn = this.createActionBtn(
      'N',
      '在文档中显示标题编号',
      () => { this.callbacks.toggleNumbering(); this.updateAllButtonStates() },
      this.callbacks.isNumberingEnabled(),
    )
    container.appendChild(numBtn)

    // 2. Collapse / expand all
    const collapseBtn = this.createActionBtn(
      '⊟',
      '折叠所有标题',
      () => this.handleCollapseExpand(collapseBtn),
      false,
    )
    container.appendChild(collapseBtn)

    // 3. H1 numbering toggle
    const enabled = this.callbacks.isNumberingEnabled()
    const h1Btn = this.createActionBtn(
      '1',
      '显示第一级标题编号',
      () => {
        if (!this.callbacks.isNumberingEnabled()) return
        this.callbacks.toggleLevelOneNumber()
        this.updateAllButtonStates()
      },
      this.callbacks.isShowLevelOne(),
    )
    container.appendChild(h1Btn)

    // Store refs for state update
    ;(container as any).__numBtn = numBtn
    ;(container as any).__collapseBtn = collapseBtn
    ;(container as any).__h1Btn = h1Btn

    if (isTabBarParent && tabBar) {
      // Insert after the tab bar element
      if (tabBar.nextSibling) {
        mountPoint.insertBefore(container, tabBar.nextSibling)
      } else {
        mountPoint.appendChild(container)
      }
    } else {
      // Prepend to outline content (before the outline list)
      if (mountPoint.firstChild) {
        mountPoint.insertBefore(container, mountPoint.firstChild)
      } else {
        mountPoint.appendChild(container)
      }
    }

    // Apply initial states
    this.updateAllButtonStates()
  }

  private createActionBtn(icon: string, title: string, onClick: () => void, active: boolean): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = BTN_CLASS
    btn.textContent = icon
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.setAttribute('aria-pressed', String(active))
    if (active) btn.classList.add(BTN_ACTIVE)

    btn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    }

    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        btn.click()
      }
    }

    return btn
  }

  // ── State update ───────────────────────────────────

  updateAllButtonStates(): void {
    const enabled = this.callbacks.isNumberingEnabled()
    const showL1 = this.callbacks.isShowLevelOne()

    const containers = document.querySelectorAll(`[${ACTIONS_ATTR}]`)
    containers.forEach(container => {
      const numBtn = (container as any).__numBtn as HTMLButtonElement | undefined
      const h1Btn = (container as any).__h1Btn as HTMLButtonElement | undefined

      if (numBtn) {
        numBtn.setAttribute('aria-pressed', String(enabled))
        numBtn.classList.toggle(BTN_ACTIVE, enabled)
      }

      if (h1Btn) {
        const h1Active = enabled && showL1
        h1Btn.setAttribute('aria-pressed', String(h1Active))
        h1Btn.classList.toggle(BTN_ACTIVE, h1Active)
        if (!enabled) {
          h1Btn.disabled = true
          h1Btn.setAttribute('aria-disabled', 'true')
        } else {
          h1Btn.disabled = false
          h1Btn.removeAttribute('aria-disabled')
        }
      }
    })
  }

  // ── Collapse / Expand (native click) ───────────────

  /**
   * Collapse or expand all outline items by clicking their native expand/collapse toggles.
   * Does NOT modify CSS classes directly — triggers real DOM events.
   *
   * Typora 1.6.x structure:
   *   LI.outline-item-wrapper
   *     DIV.outline-item
   *       SPAN.outline-expander  ← the clickable toggle
   *       SPAN.outline-label
   *     UL.outline-children
   */
  private handleCollapseExpand(btn: HTMLButtonElement): void {
    const outlineRoot = this.findVisibleOutlineContent()
    if (!outlineRoot) return

    // Find all outline-item-wrapper LI elements
    const wrappers = outlineRoot.querySelectorAll('.outline-item-wrapper') as NodeListOf<HTMLElement>
    if (wrappers.length === 0) return

    // Collect expandable items with their state
    let anyExpanded = false
    const items: Array<{ expander: HTMLElement; depth: number; isExpanded: boolean }> = []

    for (let i = 0; i < wrappers.length; i++) {
      const wrapper = wrappers[i]
      const expander = wrapper.querySelector('.outline-expander') as HTMLElement | null
      if (!expander) continue

      const childrenUl = wrapper.querySelector('.outline-children') as HTMLElement | null
      // An item is expandable if it has visible child LI elements
      const hasChildren = childrenUl ? childrenUl.querySelectorAll('.outline-item-wrapper').length > 0 : false
      if (!hasChildren) continue

      // Depth from class: outline-h1, outline-h2, etc.
      const depthMatch = wrapper.className.match(/outline-h(\d)/)
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0

      // Check if expanded: children UL is visible (display is not 'none')
      const cs = childrenUl ? getComputedStyle(childrenUl) : null
      const isExpanded = cs ? cs.display !== 'none' : false

      if (isExpanded) anyExpanded = true
      items.push({ expander, depth, isExpanded })
    }

    if (items.length === 0) return

    if (anyExpanded) {
      // Collapse all expanded items: deepest first
      const toCollapse = items
        .filter(ei => ei.isExpanded)
        .sort((a, b) => b.depth - a.depth)

      for (const ei of toCollapse) {
        this.safeClick(ei.expander)
      }

      btn.textContent = '⊞'
      btn.title = '展开所有标题'
      btn.setAttribute('aria-pressed', 'false')
    } else {
      // Expand all collapsed items: shallowest first
      const toExpand = items
        .filter(ei => !ei.isExpanded)
        .sort((a, b) => a.depth - b.depth)

      for (const ei of toExpand) {
        this.safeClick(ei.expander)
      }

      btn.textContent = '⊟'
      btn.title = '折叠所有标题'
      btn.setAttribute('aria-pressed', 'true')
    }
  }

  /**
   * Find the native expand/collapse toggle within an outline item.
   * For Typora 1.6.7, this is SPAN.outline-expander inside DIV.outline-item.
   */
  private findExpandToggle(item: HTMLElement): HTMLElement | null {
    // Primary: SPAN.outline-expander (Typora 1.6.x)
    const expander = item.querySelector('.outline-expander') as HTMLElement | null
    if (expander) return expander

    // Fallbacks for other Typora versions
    const ariaToggle = item.querySelector('[aria-expanded]') as HTMLElement | null
    if (ariaToggle) return ariaToggle

    const button = item.querySelector('button') as HTMLElement | null
    if (button) return button

    const roleBtn = item.querySelector('[role="button"]') as HTMLElement | null
    if (roleBtn) return roleBtn

    return null
  }

  /** Safely trigger a click event on an element. */
  private safeClick(el: HTMLElement): void {
    try {
      el.click()
    } catch {
      // Fallback: dispatch a MouseEvent
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      } catch { /* ignore */ }
    }
  }

  // ── Removal ────────────────────────────────────────

  private removeControls(): void {
    document.querySelectorAll(`[${ACTIONS_ATTR}]`).forEach(el => el.remove())
    this.injected = false
  }

  // ── Observer (stable sidebar host) ────────────────

  /**
   * Observe the stable sidebar parent for DOM mutations.
   * When the outline content is added/removed or becomes visible,
   * re-inject the controls.
   */
  private bindSidebarHostObserver(): void {
    this.detachSidebarHostObserver()

    const host = this.findSidebarHost()
    if (!host) return

    this.sidebarHostObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              if (node.id === 'outline-content' ||
                  node.classList.contains('outline-content') ||
                  node.classList.contains('outline-panel') ||
                  node.querySelector('#outline-content, .outline-content, .outline-panel')) {
                // Outline DOM was added — re-inject controls
                this.injected = false
                this.retryCount = 0
                this.tryInjectWithRetry()
                clearFileTreeNumberingAttributes()
                return
              }
            }
          }
          // If our controls disappeared, re-inject
          if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
            this.injected = false
            this.retryCount = 0
            this.tryInjectWithRetry()
          }
        }

        // Attribute changes: visibility/style toggles
        if (m.type === 'attributes') {
          const target = m.target as HTMLElement
          if (target.id === 'outline-content' ||
              target.classList.contains('outline-content') ||
              target.classList.contains('outline-panel')) {
            // Outline panel visibility changed — re-inject if needed
            if (!document.querySelector(`[${ACTIONS_ATTR}]`)) {
              this.injected = false
              this.retryCount = 0
              this.tryInjectWithRetry()
            }
          }
        }
      }

      // Always clean up file tree pollution
      clearFileTreeNumberingAttributes()
    })

    this.sidebarHostObserver.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    console.log(`[InkChapter] toolbar: sidebar host observer bound to ${host.tagName}#${host.id || '?'}`)
  }

  private detachSidebarHostObserver(): void {
    if (this.sidebarHostObserver) {
      this.sidebarHostObserver.disconnect()
      this.sidebarHostObserver = null
    }
  }

  private findSidebarHost(): HTMLElement | null {
    const selectors = [
      '#typora-sidebar',
      '.typora-sidebar',
      '.sidebar-content',
      '#sidebar-content',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el?.isConnected) return el
    }
    return null
  }

  // ── Observer (legacy, kept for backwards compat) ──

  private bindObserver(): void {
    this.detachObserver()
    // Legacy observer no longer primary; sidebarHostObserver handles mutations
  }

  private detachObserver(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  }
}
