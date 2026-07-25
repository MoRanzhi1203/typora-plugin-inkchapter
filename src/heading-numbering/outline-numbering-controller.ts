/**
 * Outline Numbering Controller v3 — simplified lifecycle manager.
 *
 * Uses data-inkchapter-number attribute + CSS ::before (not span insertion).
 * Supports index-based matching when ID matching fails.
 * MutationObserver only on the real outline root (found at runtime).
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

/** Max retries for waiting for outline DOM to appear (each step ~100ms). */
const MAX_OUTLINE_RETRIES = 20
const RETRY_INTERVAL_MS = 100

export class OutlineNumberingController {
  private observer: MutationObserver | null = null
  private observerRoot: HTMLElement | null = null
  private rafId: number | null = null
  private isObserverActive = false
  private lastLabels: readonly string[] = []
  private lastHeadings: readonly { level: HeadingLevel; text: string }[] = []
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  start(): void {
    this.reattachObserver()
    cleanupV2Spans()
    clearFileTreeNumberingAttributes()
  }

  stop(): void {
    this.detachObserver()
    this.cancelRetry()
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    const root = findOutlineRoot()
    clearAllNumberingAttributes(root)
    clearFileTreeNumberingAttributes()
  }

  /**
   * Reinitialize for a new document: clear stale state, find new outline root,
   * re-attach observer, and clean file tree.
   */
  reinitialize(): void {
    this.detachObserver()
    this.cancelRetry()
    this.retryCount = 0
    clearFileTreeNumberingAttributes()
    this.reattachObserver()
  }

  /** Sync after heading refresh (called from doRefresh). */
  syncAfterRefresh(
    headings: readonly HeadingDescriptor[],
    labels: readonly string[],
  ): void {
    this.lastHeadings = headings
    this.lastLabels = labels

    // Clear any accidental file tree pollution immediately
    clearFileTreeNumberingAttributes()

    this.scheduleSync(() => {
      const result = quickSyncOutline(headings, labels)
      // If outline DOM not ready, schedule retries
      if (result.matched === 0 && headings.length > 0) {
        this.scheduleRetry()
      } else {
        this.cancelRetry()
        this.retryCount = 0
        // Observer re-attach if root found but observer not active
        if (!this.isObserverActive) {
          this.reattachObserver()
        }
      }
    })
  }

  /** Full sync with diagnostic output (for manual command). */
  manualSync(callback: (log: string) => void): SyncResult {
    return fullSyncOutline(this.lastHeadings, this.lastLabels, callback)
  }

  /** Run diagnostic probe (for manual command). */
  runProbe(callback: (log: string) => void): void {
    const result = runOutlineProbe(callback)
    if (result) {
      callback('[InkChapter:outline-probe] probeVisible=待用户确认')
    }
  }

  // ── Observer ──────────────────────────────────────

  private reattachObserver(): void {
    this.detachObserver()
    const root = findOutlineRoot()
    if (!root) return

    this.observerRoot = root
    this.observer = new MutationObserver((mutations) => {
      // Check for childList changes (outline rebuild)
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          // Ignore changes from our own data-attribute writes
          if (m.target instanceof HTMLElement && m.target.hasAttribute('data-inkchapter-number')) continue

          this.scheduleSync(() => {
            // Re-apply last known labels
            if (this.lastHeadings.length > 0) {
              quickSyncOutline(this.lastHeadings, this.lastLabels)
            }
          })
          break
        }
      }
    })

    this.observer.observe(root, { childList: true, subtree: true })
    this.isObserverActive = true
  }

  private detachObserver(): void {
    if (this.observer) { this.observer.disconnect(); this.observer = null }
    this.observerRoot = null
    this.isObserverActive = false
  }

  private scheduleSync(fn: () => void): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      try { fn() } catch { /* silent */ }
    })
  }

  private scheduleRetry(): void {
    if (this.retryCount >= MAX_OUTLINE_RETRIES) return
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      clearFileTreeNumberingAttributes()
      const result = quickSyncOutline(this.lastHeadings, this.lastLabels)
      if (result.matched === 0 && this.lastHeadings.length > 0) {
        this.scheduleRetry()
      } else {
        this.retryCount = 0
        if (!this.isObserverActive) this.reattachObserver()
      }
    }, RETRY_INTERVAL_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.retryCount = 0
  }
}
