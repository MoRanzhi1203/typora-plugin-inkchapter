/**
 * Outline Numbering Controller v4 — event-driven, no polling.
 *
 * Key changes from v3:
 * 1. Stable sidebar parent container observer (not per-document outline root)
 * 2. First-frame sync from cache — no setTimeout-based retry for normal path
 * 3. Click listener on sidebar tabs to catch outline activation (capture phase)
 * 4. Document-switch immediately applies cached numbering if outline DOM exists
 */

import {
  findOutlineRoot,
  findOutlineTextElements,
  matchHeadingsToOutline,
  applyNumberingAttributes,
  clearAllNumberingAttributes,
  clearFileTreeNumberingAttributes,
  quickSyncOutline,
  fullSyncOutline,
  runOutlineProbe,
  cleanupV2Spans,
  type SyncResult,
} from './outline-numbering-adapter'
import type { HeadingDescriptor, HeadingLevel } from './heading-types'
import { recordRuntimeAudit } from './runtime-audit'

interface OutlineNumberCache {
  documentKey: string
  revision: number
  headings: readonly HeadingDescriptor[]
  labels: readonly string[]
}

/**
 * Stable sidebar parent container selectors.
 * These are containers that persist across sidebar tab switches —
 * when the outline tab activates, Typora inserts #outline-content
 * as a child. We observe this parent so we catch the insertion
 * without polling.
 */
const SIDEBAR_HOST_SELECTORS = [
  '#typora-sidebar',            // Typora sidebar root
  '.typora-sidebar',            // alternative class
  '.sidebar-content',           // sidebar content area
  '#sidebar-content',           // sidebar content area (id)
]

export class OutlineNumberingController {
  private observer: MutationObserver | null = null
  private observerRoot: HTMLElement | null = null
  private sidebarHostObserver: MutationObserver | null = null
  private rafId: number | null = null
  private isObserverActive = false
  private isWriting = false
  private cache: OutlineNumberCache = { documentKey: '', revision: 0, headings: [], labels: [] }
  private currentDocumentKey = ''

  start(): void {
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
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
  }

  /**
   * Reinitialize for a new document: detach old, find new outline root.
   * Marks cache as stale — do NOT apply old cache to new document.
   */
  reinitialize(): void {
    recordRuntimeAudit('outline:reinitialize')
    this.currentDocumentKey = ''  // invalidate cache
    this.detachObserver()
    this.reattachObserver()
    clearFileTreeNumberingAttributes()
  }

  /** Set current document key (called from service on file switch). */
  setDocumentKey(key: string): void {
    this.currentDocumentKey = key
  }

  /** Sync after heading refresh (called from doRefresh). */
  syncAfterRefresh(
    headings: readonly HeadingDescriptor[],
    labels: readonly string[],
  ): void {
    this.cache = {
      documentKey: this.currentDocumentKey,
      revision: this.cache.revision + 1,
      headings,
      labels,
    }
    recordRuntimeAudit('outline:cache-updated', {
      headingCount: headings.length,
      labelCount: labels.length,
      details: {
        firstLabels: labels.slice(0, 5),
        documentKey: this.currentDocumentKey,
        revision: this.cache.revision,
      },
    })

    // Clear any accidental file tree pollution immediately
    clearFileTreeNumberingAttributes()

    // If outline DOM exists and cache is for current document, sync
    this.applyOutlineFromCache()
  }

  /** Full sync with diagnostic output (for manual command). */
  manualSync(callback: (log: string) => void): SyncResult {
    return fullSyncOutline(this.cache.headings, this.cache.labels, callback)
  }

  /** Run diagnostic probe (for manual command). */
  runProbe(callback: (log: string) => void): void {
    const result = runOutlineProbe(callback)
    if (result) {
      callback('[InkChapter:outline-probe] probeVisible=待用户确认')
    }
  }

  // ── Sidebar host observer (stable, persists across tab switches) ──

  /** Observe the stable sidebar parent for outline DOM insertion. */
  private bindSidebarHostObserver(): void {
    this.detachSidebarHostObserver()
    const host = this.findSidebarHost()
    recordRuntimeAudit('outline:host-observer-bind', {
      details: {
        sidebarHostFound: !!host,
        matchedSelector: host ? (host.id || host.className?.split(' ')[0]) : 'none',
        tagName: host?.tagName ?? 'N/A',
        isConnected: host?.isConnected ?? false,
        observerBound: !!host,
      },
    })
    if (!host) return

    this.sidebarHostObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement) {
              // Check if outline content was inserted
              if (node.id === 'outline-content' ||
                  node.classList.contains('outline-content') ||
                  node.classList.contains('outline-panel') ||
                  node.querySelector('#outline-content, .outline-content, .outline-panel')) {
                // Outline DOM just appeared — bind observer and apply cached numbers
                recordRuntimeAudit('outline:host-mutation', { details: { nodeTag: node.tagName, nodeId: node.id, nodeClass: node.className } })
                this.reattachObserver()
                this.applyOutlineFromCache()
                return
              }
            }
          }
        }
      }
    })

    this.sidebarHostObserver.observe(host, { childList: true, subtree: true })
  }

  private detachSidebarHostObserver(): void {
    if (this.sidebarHostObserver) {
      this.sidebarHostObserver.disconnect()
      this.sidebarHostObserver = null
    }
  }

  /** Find the stable sidebar parent container in current Typora DOM. */
  private findSidebarHost(): HTMLElement | null {
    for (const sel of SIDEBAR_HOST_SELECTORS) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.offsetParent !== null) return el
    }
    return null
  }

  // ── Sidebar mode click listener (capture phase) ──

  /** Listen for clicks on sidebar tabs to catch outline activation. */
  private bindSidebarModeClickListener(): void {
    const handler = (e: Event): void => {
      const target = e.target as HTMLElement | null
      if (!target) return

      // Typora sidebar tabs: look for outline/contents tab activation
      const isOutlineTab = target.matches('[data-action="switch-outline"], [data-type="outline"]') ||
                           target.closest('[data-action="switch-outline"], [data-type="outline"]') !== null ||
                           (target.classList.contains('outline') && target.closest('.typora-sidebar-tabs, .sidebar-tabs') !== null)

      if (isOutlineTab) {
        // Outline tab activated — bind observer + apply cache in microtask
        recordRuntimeAudit('outline:tab-click', { details: { targetTag: target.tagName, targetClass: target.className } })
        queueMicrotask(() => {
          this.reattachObserver()
          this.applyOutlineFromCache()
        })
      }
    }

    document.addEventListener('click', handler, true)
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

  // ── Apply cached numbering to outline (called when outline appears) ──

  /**
   * Apply cached heading labels to the outline immediately.
   * Called when outline DOM first appears or after sidebar tab activation.
   * Guarded against self-trigger loops via isWriting flag.
   */
  private applyOutlineFromCache(): void {
    if (this.isWriting) return
    // Do NOT apply if cache belongs to a different document
    if (this.cache.documentKey !== this.currentDocumentKey) {
      recordRuntimeAudit('outline:apply-blocked-wrong-doc', {
        details: { cacheKey: this.cache.documentKey, currentKey: this.currentDocumentKey },
      })
      return
    }
    if (this.cache.headings.length === 0) {
      recordRuntimeAudit('outline:apply-skip-empty')
      return
    }

    recordRuntimeAudit('outline:apply-start', {
      headingCount: this.cache.headings.length,
      labelCount: this.cache.labels.length,
      details: { documentKey: this.cache.documentKey, revision: this.cache.revision },
    })
    this.scheduleSync(() => {
      if (this.isWriting) return
      this.isWriting = true
      try {
        const result = quickSyncOutline(this.cache.headings, this.cache.labels)
        recordRuntimeAudit('outline:apply-end', {
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
    const root = findOutlineRoot()
    if (!root) {
      recordRuntimeAudit('outline:root-missing')
      return
    }
    recordRuntimeAudit('outline:root-found', {
      details: { rootTag: root.tagName, rootId: root.id, rootClass: root.className, rootConnected: root.isConnected },
    })

    this.observerRoot = root
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          // Ignore changes from our own data-attribute writes
          if (m.target instanceof HTMLElement && m.target.hasAttribute('data-inkchapter-number')) continue

          this.scheduleSync(() => {
            if (this.cache.headings.length > 0) {
              quickSyncOutline(this.cache.headings, this.cache.labels)
            }
          })
          break
        }
      }
    })

    this.observer.observe(root, { childList: true, subtree: true })
    this.isObserverActive = true

    // Immediately sync if we have cached data for current document
    if (this.cache.headings.length > 0 && this.cache.documentKey === this.currentDocumentKey) {
      this.applyOutlineFromCache()
    }
  }

  private detachObserver(): void {
    if (this.observer) { this.observer.disconnect(); this.observer = null }
    this.observerRoot = null
    this.isObserverActive = false
  }

  // ── RAF scheduler (single-frame debounce) ────────

  private scheduleSync(fn: () => void): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      try { fn() } catch { /* silent */ }
    })
  }
}
