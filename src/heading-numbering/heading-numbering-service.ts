import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings, HeadingSnapshot, RefreshReason } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { decimalHierarchicalFormatter } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import * as logger from '../core/logger'

const TAIL_REFRESH_MS = 60

export interface ServiceContext {
  readonly settings: PluginSettings<InkChapterSettings>
  onWorkspaceEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onEditorEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable: (fn: () => void) => void
}

/**
 * Optimized heading numbering service.
 *
 * Key improvements:
 * - Native input/compositionend for fast trigger (before framework 400ms)
 * - RAF-based scheduler (max 1 per frame, no fixed debounce)
 * - Short tail refresh (60ms) for DOM changes after input
 * - Heading snapshot dirty check: skip recompute if structure unchanged
 * - Diff-based DOM updates: only change what actually changed
 * - Framework edit event kept as compatibility fallback (no extra debounce)
 */
export class HeadingNumberingService {
  private numberingSettings: HeadingNumberingSettings
  private adapter: HeadingDomAdapter
  private store: DisposableStore
  private ctx: ServiceContext

  // Scheduler state
  private rafId: ReturnType<typeof requestAnimationFrame> | null = null
  private tailTimer: ReturnType<typeof setTimeout> | null = null
  private pendingReason: RefreshReason = 'editor-input'
  private pending = false

  // Dirty check state
  private lastSnapshot: HeadingSnapshot[] | null = null
  private isInComposition = false

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter
    this.numberingSettings = { ...ctx.settings.get('headingNumbering') }
    this.store = new DisposableStore()

    this.initAdapter()
    this.registerFastEvents()
    this.registerFrameworkEvents()
    this.requestRefresh('initial-load')
  }

  /** Toggle numbering on/off. Saves state. */
  toggle(): void {
    this.numberingSettings.enabled = !this.numberingSettings.enabled
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    if (this.numberingSettings.enabled) {
      this.lastSnapshot = null // force full refresh
      this.requestRefresh('toggle')
    } else {
      this.adapter.clearNumbering()
    }

    logger.info(`标题编号已${this.numberingSettings.enabled ? '开启' : '关闭'}`)
  }

  /** Force renumbering. */
  renumber(): void {
    if (!this.numberingSettings.enabled) {
      this.numberingSettings.enabled = true
      this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    }
    this.lastSnapshot = null
    this.flushRefresh()
    logger.info('标题已重新编号')
  }

  /** Clean up all resources. */
  dispose(): void {
    this.cancelPending()
    this.adapter.clearNumbering()
    this.store.dispose()
  }

  // ── Scheduler ──────────────────────────────────────────

  /** Request a refresh, merged via RAF. Overrides pending reason priority. */
  private requestRefresh(reason: RefreshReason): void {
    if (this.rafId !== null) {
      return // already scheduled in this frame
    }
    this.pendingReason = reason
    this.pending = true
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.doRefresh(this.pendingReason)
      this.scheduleTail()
    })
  }

  /** Flush immediately (skips RAF). */
  private flushRefresh(): void {
    this.cancelPending()
    this.doRefresh('manual')
  }

  /** Schedule a single tail refresh for deferred DOM updates. */
  private scheduleTail(): void {
    if (this.tailTimer !== null) {
      clearTimeout(this.tailTimer)
    }
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null
      this.doRefresh('tail-refresh')
    }, TAIL_REFRESH_MS)
  }

  /** Cancel all pending refresh tasks. */
  private cancelPending(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.tailTimer !== null) {
      clearTimeout(this.tailTimer)
      this.tailTimer = null
    }
    this.pending = false
  }

  // ── Core refresh ───────────────────────────────────────

  /** Execute a full refresh cycle with dirty check. */
  private doRefresh(reason: RefreshReason): void {
    if (!this.numberingSettings.enabled) {
      return
    }

    const startTime = performance.now()

    try {
      const root = this.adapter.detectEditorRoot()
      if (!root) {
        return
      }
      this.adapter.setEditorRoot(root)

      // Dirty check: skip if heading structure unchanged
      const snapshot = this.adapter.createHeadingSnapshot()
      if (
        this.lastSnapshot &&
        reason !== 'toggle' &&
        reason !== 'manual' &&
        reason !== 'initial-load' &&
        !this.adapter.hasStructureChanged(this.lastSnapshot, snapshot)
      ) {
        this.lastSnapshot = snapshot
        return
      }
      this.lastSnapshot = snapshot

      const headings = this.adapter.collectHeadings()
      if (headings.length === 0) {
        this.adapter.clearNumbering()
        return
      }

      const numbered = computeHeadingNumbering(headings, this.numberingSettings)
      const labels = decimalHierarchicalFormatter.format(numbered, this.numberingSettings)
      this.adapter.applyNumberingDiff(labels)

      // Debug perf log
      const duration = performance.now() - startTime
      if (this.ctx.settings.get('debug')) {
        logger.debug(
          `Heading refresh reason=${reason} headings=${headings.length} duration=${duration.toFixed(1)}ms`,
        )
      }
    } catch (e) {
      logger.error('标题编号刷新失败', e)
    }
  }

  // ── Editor binding ─────────────────────────────────────

  /** Initialize adapter with current editor root. */
  private initAdapter(): void {
    const area = this.adapter.detectEditorRoot()
    if (area) {
      this.adapter.setEditorRoot(area)
    }
  }

  /**
   * Bind/unbind fast native events on the editor root.
   * Called on document switch to move bindings to the new editor.
   */
  private bindEditorRoot(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) {
      return
    }

    // input: instant trigger for heading text/level changes
    const onInput = (): void => {
      if (!this.isInComposition) {
        this.requestRefresh('editor-input')
      }
    }
    root.addEventListener('input', onInput, { passive: true })
    this.store.add(() => root.removeEventListener('input', onInput))

    // compositionend: flush after IME composition
    const onCompositionEnd = (): void => {
      this.isInComposition = false
      this.requestRefresh('composition-end')
    }
    root.addEventListener('compositionend', onCompositionEnd)
    this.store.add(() => root.removeEventListener('compositionend', onCompositionEnd))

    const onCompositionStart = (): void => {
      this.isInComposition = true
    }
    root.addEventListener('compositionstart', onCompositionStart)
    this.store.add(() => root.removeEventListener('compositionstart', onCompositionStart))
  }

  // ── Event registration ─────────────────────────────────

  /** Register fast native input events. */
  private registerFastEvents(): void {
    // Bind on initial load
    const root = this.adapter.detectEditorRoot()
    if (root) {
      this.adapter.setEditorRoot(root)
      this.bindEditorRoot()
    }
  }

  /** Register framework events as compatibility fallback. */
  private registerFrameworkEvents(): void {
    const { ctx } = this

    // Editor DOM load: bind fast events + immediate refresh
    this.store.add(
      ctx.onEditorEvent('load', (editorEl: unknown) => {
        if (editorEl instanceof HTMLElement) {
          this.adapter.setEditorRoot(editorEl)
          this.lastSnapshot = null
          this.bindEditorRoot()
          // No fixed delay: queueMicrotask → RAF → refresh
          queueMicrotask(() => {
            this.requestRefresh('initial-load')
          })
        }
      }),
    )

    // Framework edit as fallback (no extra debounce)
    this.store.add(
      ctx.onEditorEvent('edit', () => {
        this.requestRefresh('framework-edit')
      }),
    )

    // File open: detect new editor root
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        this.lastSnapshot = null
        setTimeout(() => {
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('file-open')
        }, 0) // no fixed 100ms, just next tick
      }),
    )

    // Active leaf change
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        this.lastSnapshot = null
        this.requestRefresh('active-leaf-change')
      }),
    )

    // Auto-cleanup via plugin
    ctx.registerDisposable(() => this.dispose())
  }
}
