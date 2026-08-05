/**
 * Outline Numbering Controller v5 — relaxed root detection, host observer with attributes.
 *
 * Key changes from v4:
 * 1. reinitialize() no longer clears currentDocumentKey — caller manages key lifecycle
 * 2. syncAfterRefresh() always applies numbering via relaxed (hidden-panel) root finder
 * 3. Host observer watches attributes (style/class) to catch hidden→visible transitions
 * 4. Event chain logging with structured data (seq, time, documentKey, renderVersion, ...)
 * 5. Root identity tracking to prevent duplicate observer binding
 * 6. RenderVersion guard to cancel stale sync operations
 */

import {
  findOutlineRoot,
  findOutlineRootRelaxed,
  clearAllNumberingAttributes,
  clearFileTreeNumberingAttributes,
  quickSyncOutline,
  fullSyncOutline,
  runOutlineProbe,
  dumpOutlineDOM,
  cleanupV2Spans,
  syncOutlineNumberBoldStyle,
  clearOutlineNumberBoldStyle,
  isApplyingOutlineBoldStyle,
  type SyncResult,
} from './outline-numbering-adapter'
import type { HeadingDescriptor } from './heading-types'
import { recordRuntimeAudit } from './runtime-audit'

interface OutlineNumberCache {
  documentKey: string
  revision: number
  headings: readonly HeadingDescriptor[]
  labels: readonly string[]
  labelGaps: readonly string[]
}

/** Event chain entry for structured logging. */
interface EventChainEntry {
  seq: number
  time: number
  event: string
  documentKey: string
  renderVersion: number
  cacheRevision: number
  outlineRootExists: boolean
  outlineRootSelector: string | null
  headingCount: number
  labelCount: number
  matchedCount: number
  appliedCount: number
}

const SIDEBAR_HOST_SELECTORS = [
  '#typora-sidebar',
  '.typora-sidebar',
  '.sidebar-content',
  '#sidebar-content',
]

/** Build marker for diagnostics. */
const CONTROLLER_BUILD_MARKER = 'inkchapter-outline-controller-v5-relaxed-root'

/** Set to false to silence event chain debug logs in production. */
const EVT_DEBUG = false
const EVT_LOG = (...args: unknown[]) => { if (EVT_DEBUG) console.log(...args) }

export class OutlineNumberingController {
  private observer: MutationObserver | null = null
  private observerRoot: HTMLElement | null = null
  private sidebarHostObserver: MutationObserver | null = null
  private rafId: number | null = null
  private isObserverActive = false
  private isWriting = false
  private cache: OutlineNumberCache = { documentKey: '', revision: 0, headings: [], labels: [], labelGaps: [] }
  private currentDocumentKey = ''
  private renderVersion = 0

  // Diagnostic counters
  private observerBindCount = 0
  private observerDisconnectCount = 0
  private eventSeq = 0

  // Click handler reference for cleanup
  private sidebarModeClickHandler: ((e: Event) => void) | null = null

  start(): void {
    EVT_LOG(`[InkChapter OUTLINE] controller start  build=${CONTROLLER_BUILD_MARKER}`)
    this.bindSidebarHostObserver()
    this.reattachObserver()
    this.bindSidebarModeClickListener()
    this.dumpSidebarTabButton()
    cleanupV2Spans()
    clearFileTreeNumberingAttributes()
  }

  stop(): void {
    this.detachObserver()
    this.detachSidebarHostObserver()
    this.detachSidebarModeClickListener()
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
    clearOutlineNumberBoldStyle()
  }

  /** Clear all outline numbering without stopping the controller. */
  clearOutlineNumbering(): void {
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
    clearOutlineNumberBoldStyle()
    this.cache = { documentKey: '', revision: 0, headings: [], labels: [], labelGaps: [] }
  }

  /** Get cached headings for level mapping (used by collapse depth filter). */
  getCachedHeadings(): readonly HeadingDescriptor[] {
    return this.cache.headings
  }

  /**
   * Reinitialize for a new document: detach old observer, find new outline root.
   * Does NOT clear currentDocumentKey — the caller must call setDocumentKey()
   * BEFORE or AFTER reinitialize() to set the correct key.
   * Cache is NOT applied here (caller ensures new cache is generated first).
   */
  reinitialize(): void {
    this.recordEvent('outline:reinitialize', {
      headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
    })
    this.detachObserver()
    // Try to reattach to current outline root (may be null if panel hidden)
    this.reattachObserver()
    clearFileTreeNumberingAttributes()
  }

  /** Set current document key and bump render version. */
  setDocumentKey(key: string): void {
    this.currentDocumentKey = key
  }

  /** Bump render version (called on document switch). */
  bumpRenderVersion(): void {
    this.renderVersion++
  }

  /** Get current render version for stale-op detection. */
  private getRenderVersion(): number {
    return this.renderVersion
  }

  /**
   * Sync after heading refresh — ALWAYS tries to apply numbering.
   * Uses relaxed root finder so that numbering is pre-applied to hidden panels.
   * The documentKey guard prevents applying old-document cache to new document.
   */
  syncAfterRefresh(
    headings: readonly HeadingDescriptor[],
    labels: readonly string[],
    labelGaps?: readonly string[],
  ): void {
    const capturedVersion = this.getRenderVersion()
    const capturedDocKey = this.currentDocumentKey

    // Generate new cache with current document identity
    this.cache = {
      documentKey: capturedDocKey,
      revision: this.cache.revision + 1,
      headings,
      labels,
      labelGaps: labelGaps ?? [],
    }

    this.recordEvent('outline:cache-updated', {
      headingCount: headings.length,
      labelCount: labels.length,
      matchedCount: 0,
      appliedCount: 0,
    })

    // Clear any accidental file tree pollution immediately
    clearFileTreeNumberingAttributes()

    // Always attempt to apply — uses relaxed root finder for hidden panels
    this.applyOutlineFromCache(capturedVersion)
  }

  /** Full sync with diagnostic output (for manual command). */
  manualSync(callback: (log: string) => void): SyncResult {
    return fullSyncOutline(this.cache.headings, this.cache.labels, callback, this.cache.labelGaps)
  }

  /** Run diagnostic probe (for manual command). */
  runProbe(callback: (log: string) => void): void {
    const result = runOutlineProbe(callback)
    if (result) {
      callback('[InkChapter:outline-probe] probeVisible=待用户确认')
    }
  }

  /** Run full DOM diagnostic dump (for manual command). */
  dumpDOM(): void {
    dumpOutlineDOM()
  }

  // ── Sidebar host observer (stable, persists across tab switches) ──

  /** Observe the stable sidebar parent for outline DOM insertion AND attribute changes. */
  private bindSidebarHostObserver(): void {
    this.detachSidebarHostObserver()
    const host = this.findSidebarHost()
    this.recordEvent('outline:host-observer-bind', {
      headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
    })
    if (!host) {
      EVT_LOG('[InkChapter OUTLINE] sidebarHostObserver: host not found, retrying with relaxed search')
      const hostRelaxed = this.findSidebarHostRelaxed()
      if (hostRelaxed && hostRelaxed.isConnected) {
        EVT_LOG(`[InkChapter OUTLINE] sidebarHostObserver: bound to relaxed host ${hostRelaxed.tagName}#${hostRelaxed.id||'?'}`)
        this.observeHost(hostRelaxed)
        return
      }
      EVT_LOG('[InkChapter OUTLINE] sidebarHostObserver: no host found (visible or relaxed)')
      return
    }
    EVT_LOG(`[InkChapter OUTLINE] sidebarHostObserver: bound to ${host.tagName}#${host.id||'?'}.${host.className||'?'}`)
    this.observeHost(host)
  }

  private observeHost(host: HTMLElement): void {
    this.sidebarHostObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // childList: outline content inserted/removed
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              if (node.id === 'outline-content' ||
                  node.classList.contains('outline-content') ||
                  node.classList.contains('outline-panel') ||
                  node.querySelector('#outline-content, .outline-content, .outline-panel')) {
                this.recordEvent('outline:host-mutation-childlist', {
                  headingCount: this.cache.headings.length,
                  labelCount: this.cache.labels.length,
                  matchedCount: 0, appliedCount: 0,
                })
                this.reattachObserver()
                this.applyOutlineFromCache(this.getRenderVersion())
                return
              }
            }
          }
        }

        // attributes: style/class changes may indicate visibility toggle
        if (m.type === 'attributes') {
          const target = m.target as HTMLElement
          const attrName = m.attributeName
          // If an outline content container's style or class changed, recheck
          if (target.id === 'outline-content' ||
              target.classList.contains('outline-content') ||
              target.classList.contains('outline-panel') ||
              target.querySelector('#outline-content, .outline-content, .outline-panel')) {
            this.recordEvent('outline:host-mutation-attributes', {
              headingCount: this.cache.headings.length,
              labelCount: this.cache.labels.length,
              matchedCount: 0, appliedCount: 0,
            })
            // The outline panel became visible (or hidden) — rebind and apply
            this.reattachObserver()
            this.applyOutlineFromCache(this.getRenderVersion())
            return
          }
        }
      }
    })

    this.sidebarHostObserver.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }

  private detachSidebarHostObserver(): void {
    if (this.sidebarHostObserver) {
      this.sidebarHostObserver.disconnect()
      this.sidebarHostObserver = null
    }
  }

  /** Find the stable sidebar parent container (visible). */
  private findSidebarHost(): HTMLElement | null {
    for (const sel of SIDEBAR_HOST_SELECTORS) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.isConnected && el.offsetParent !== null) return el
    }
    return null
  }

  /** Find the stable sidebar parent container (allows hidden). */
  private findSidebarHostRelaxed(): HTMLElement | null {
    for (const sel of SIDEBAR_HOST_SELECTORS) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.isConnected) return el
    }
    return null
  }

  // ── Sidebar mode click listener (capture phase, secondary only) ──

  /** Listen for clicks on sidebar tabs to catch outline activation. */
  private bindSidebarModeClickListener(): void {
    // Guard: don't bind if already bound
    if (this.sidebarModeClickHandler) return

    this.sidebarModeClickHandler = (e: Event): void => {
      const target = e.target as HTMLElement | null
      if (!target) return

      const isOutlineTab = target.matches('[data-action="switch-outline"], [data-type="outline"]') ||
                           target.closest('[data-action="switch-outline"], [data-type="outline"]') !== null ||
                           (target.classList.contains('outline') && target.closest('.typora-sidebar-tabs, .sidebar-tabs') !== null)

      if (isOutlineTab) {
        this.recordEvent('outline:tab-click', {
          headingCount: this.cache.headings.length,
          labelCount: this.cache.labels.length,
          matchedCount: 0, appliedCount: 0,
        })
        queueMicrotask(() => {
          this.reattachObserver()
          this.applyOutlineFromCache(this.getRenderVersion())
        })
      }
    }

    document.addEventListener('click', this.sidebarModeClickHandler, true)
  }

  private detachSidebarModeClickListener(): void {
    if (this.sidebarModeClickHandler) {
      document.removeEventListener('click', this.sidebarModeClickHandler, true)
      this.sidebarModeClickHandler = null
    }
  }

  /** Dump sidebar tab button DOM for selector verification. */
  private dumpSidebarTabButton(): void {
    const tabs = document.querySelectorAll('[data-action], [data-type], .typora-sidebar-tabs *, .sidebar-tabs *')
    const found: Array<Record<string, unknown>> = []
    for (const t of Array.from(tabs).slice(0, 6)) {
      const el = t as HTMLElement
      if (el.offsetParent === null) continue
      found.push({
        tagName: el.tagName,
        id: el.id,
        className: el.className?.split(' ').slice(0, 3).join(' '),
        dataAction: el.getAttribute('data-action'),
        dataType: el.getAttribute('data-type'),
        outerHTML: el.outerHTML.slice(0, 200),
      })
    }
    if (found.length > 0) {
      recordRuntimeAudit('sidebar-tab-scan', { details: { tabs: found } })
    }
  }

  // ── Apply cached numbering to outline ──────────────

  /**
   * Apply cached heading labels to the outline.
   * Tries visible root first, then relaxed (hidden) root.
   * DocumentKey guard prevents old-document cache from being applied.
   * RenderVersion guard cancels stale operations.
   */
  private applyOutlineFromCache(expectedVersion: number): void {
    if (this.isWriting) return

    // RenderVersion guard: skip if version has changed since scheduling
    if (expectedVersion !== this.getRenderVersion()) {
      this.recordEvent('outline:apply-stale-version', {
        headingCount: this.cache.headings.length,
        labelCount: this.cache.labels.length,
        matchedCount: 0, appliedCount: 0,
      })
      return
    }

    // DocumentKey guard: do NOT apply old-document cache to new document
    if (this.cache.documentKey !== this.currentDocumentKey && this.currentDocumentKey !== '') {
      this.recordEvent('outline:apply-blocked-wrong-doc', {
        headingCount: this.cache.headings.length,
        labelCount: this.cache.labels.length,
        matchedCount: 0, appliedCount: 0,
      })
      return
    }

    if (this.cache.headings.length === 0) {
      this.recordEvent('outline:apply-skip-empty', {
        headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
      })
      return
    }

    this.recordEvent('outline:apply-start', {
      headingCount: this.cache.headings.length,
      labelCount: this.cache.labels.length,
      matchedCount: 0, appliedCount: 0,
    })

    this.scheduleSync(() => {
      if (this.isWriting) return
      if (expectedVersion !== this.getRenderVersion()) return

      this.isWriting = true
      try {
        const result = quickSyncOutline(this.cache.headings, this.cache.labels, this.cache.labelGaps)
        const headingCount = this.cache.headings.length
        const labelCount = this.cache.labels.length
        EVT_LOG(`[InkChapter OUTLINE] apply result: matched=${result.matched} applied=${result.applied} headings=${headingCount} labels=${labelCount}`)
        this.recordEvent('outline:apply-end', {
          headingCount,
          labelCount,
          matchedCount: result.matched,
          appliedCount: result.applied,
        })
      } finally {
        this.isWriting = false
      }
    })
  }

  // ── Observer ──────────────────────────────────────

  private reattachObserver(): void {
    this.detachObserver()

    // Check if old root is still connected — if not, we need a fresh find
    if (this.observerRoot && !this.observerRoot.isConnected) {
      this.observerRoot = null
    }

    const root = findOutlineRoot()
    if (!root) {
      EVT_LOG('[InkChapter OUTLINE] reattachObserver: visible root not found')
      this.recordEvent('outline:reattach-no-root', {
        headingCount: 0, labelCount: 0, matchedCount: 0, appliedCount: 0,
      })
      return
    }

    // Prevent duplicate binding: skip if same root already observed
    if (this.observerRoot === root && this.isObserverActive) {
      EVT_LOG('[InkChapter OUTLINE] reattachObserver: already bound, skipping')
      return
    }

    EVT_LOG(`[InkChapter OUTLINE] reattachObserver: root=${root.tagName}#${root.id||'?'}.${root.className||'?'} connected=${root.isConnected}`)
    this.observerBindCount++
    this.recordEvent('outline:observer-bind', {
      headingCount: this.cache.headings.length,
      labelCount: this.cache.labels.length,
      matchedCount: 0, appliedCount: 0,
    })

    this.observerRoot = root
    this.observer = new MutationObserver((mutations) => {
      let hasChildListChange = false
      let hasClassChange = false

      for (const m of mutations) {
        // ── childList: outline items added/removed ──
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          if (m.target instanceof HTMLElement && m.target.hasAttribute('data-inkchapter-number')) continue
          hasChildListChange = true
        }

        // ── attributes: class changes (e.g. .active moving) ──
        if (!hasChildListChange && m.type === 'attributes' && m.attributeName === 'class') {
          // Skip if we are currently applying bold style (prevent observer loop)
          if (isApplyingOutlineBoldStyle) continue

          const target = m.target as HTMLElement
          if (!root.contains(target)) continue

          // Skip our own BOLD_CLASS changes on numbered elements
          if (target.hasAttribute('data-inkchapter-number')) {
            const oldClass = m.oldValue ?? ''
            const newClass = target.className ?? ''
            const oldHasBold = oldClass.includes('inkchapter-outline-number-bold')
            const newHasBold = newClass.includes('inkchapter-outline-number-bold')
            if (oldHasBold !== newHasBold) continue
          }

          hasClassChange = true
        }
      }

      // Class-only change: just re-sync bold style (lighter than full re-sync)
      if (hasClassChange && !hasChildListChange) {
        this.scheduleSync(() => {
          syncOutlineNumberBoldStyle()
        })
        return
      }

      // Child list change: full re-sync (which includes bold sync)
      if (hasChildListChange) {
        this.scheduleSync(() => {
          if (this.cache.headings.length > 0) {
            quickSyncOutline(this.cache.headings, this.cache.labels, this.cache.labelGaps)
          }
        })
      }
    })

    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    })
    this.isObserverActive = true

    // Immediately sync if we have cached data for current document
    if (this.cache.headings.length > 0 && this.cache.documentKey === this.currentDocumentKey) {
      this.applyOutlineFromCache(this.getRenderVersion())
    }
  }

  private detachObserver(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
      this.observerDisconnectCount++
    }
    this.observerRoot = null
    this.isObserverActive = false
  }

  // ── RAF scheduler (single-frame debounce) ────────

  private scheduleSync(fn: () => void): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      try { fn() } catch (e) { console.error('[InkChapter OUTLINE] scheduleSync failed', e) }
    })
  }

  // ── Event chain logging ──────────────────────────

  /** Record a structured event for the event chain audit. */
  private recordEvent(
    event: string,
    counts: {
      headingCount: number
      labelCount: number
      matchedCount: number
      appliedCount: number
    },
  ): void {
    this.eventSeq++
    const root = findOutlineRoot()
    const rootRelaxed = root ? root : findOutlineRootRelaxed()

    const entry: EventChainEntry = {
      seq: this.eventSeq,
      time: performance.now(),
      event,
      documentKey: this.currentDocumentKey || '(empty)',
      renderVersion: this.renderVersion,
      cacheRevision: this.cache.revision,
      outlineRootExists: root !== null || rootRelaxed !== null,
      outlineRootSelector: root
        ? `${root.tagName}#${root.id || '?'}.${(root.className || '?').split(' ')[0]}`
        : rootRelaxed
          ? `[relaxed]${rootRelaxed.tagName}#${rootRelaxed.id || '?'}`
          : null,
      headingCount: counts.headingCount,
      labelCount: counts.labelCount,
      matchedCount: counts.matchedCount,
      appliedCount: counts.appliedCount,
    }

    recordRuntimeAudit(event, {
      headingCount: counts.headingCount,
      labelCount: counts.labelCount,
      matchedCount: counts.matchedCount,
      appliedCount: counts.appliedCount,
      documentKey: entry.documentKey,
      renderVersion: entry.renderVersion,
      details: entry as unknown as Record<string, unknown>,
    })

    // Log to console for real-time debugging
    const rootStatus = entry.outlineRootExists
      ? `root=${entry.outlineRootSelector}`
      : 'root=NONE'
    EVT_LOG(
      `[InkChapter EVT] seq=${entry.seq} time=${entry.time.toFixed(0)} ${event} ` +
      `doc=${entry.documentKey.slice(0, 20)} rv=${entry.renderVersion} cr=${entry.cacheRevision} ` +
      `${rootStatus} h=${entry.headingCount} l=${entry.labelCount} ` +
      `m=${entry.matchedCount} a=${entry.appliedCount}`,
    )
  }

  /** Dump event chain summary to console. */
  dumpEventChain(): void {
    EVT_LOG(`[InkChapter OUTLINE] observerBindCount=${this.observerBindCount} observerDisconnectCount=${this.observerDisconnectCount}`)
  }
}
