import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type { HeadingNumberingSettings } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { decimalHierarchicalFormatter } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import * as logger from '../core/logger'

const DEBOUNCE_MS = 200

export interface ServiceContext {
  readonly settings: PluginSettings<InkChapterSettings>
  onWorkspaceEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onEditorEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable: (fn: () => void) => void
}

/**
 * Heading numbering service.
 *
 * Listens to editor and workspace events to trigger renumbering.
 * Delegates DOM operations to HeadingDomAdapter.
 */
export class HeadingNumberingService {
  private numberingSettings: HeadingNumberingSettings
  private adapter: HeadingDomAdapter
  private store: DisposableStore
  private ctx: ServiceContext
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter
    this.numberingSettings = { ...ctx.settings.get('headingNumbering') }
    this.store = new DisposableStore()

    this.initAdapter()
    this.registerEvents()
    this.refreshIfEnabled()
  }

  /** Toggle numbering on/off. Saves state to settings. */
  toggle(): void {
    this.numberingSettings.enabled = !this.numberingSettings.enabled
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    if (this.numberingSettings.enabled) {
      this.refresh()
    } else {
      this.adapter.removeNumbering()
    }

    logger.info(`标题编号已${this.numberingSettings.enabled ? '开启' : '关闭'}`)
  }

  /** Force renumbering from current headings. */
  renumber(): void {
    if (!this.numberingSettings.enabled) {
      this.numberingSettings.enabled = true
      this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    }
    this.refresh()
    logger.info('标题已重新编号')
  }

  /** Clean up all resources. */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.adapter.removeNumbering()
    this.store.dispose()
  }

  /** Schedule a deferred refresh. */
  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.refreshIfEnabled()
    }, DEBOUNCE_MS)
  }

  /** Refresh if numbering is enabled. */
  private refreshIfEnabled(): void {
    if (this.numberingSettings.enabled) {
      this.refresh()
    }
  }

  /** Full refresh cycle: scan headings, compute, apply. */
  private refresh(): void {
    try {
      this.adapter.detectWritingArea()
      const headings = this.adapter.getHeadings()

      if (headings.length === 0) {
        this.adapter.removeNumbering()
        return
      }

      const numbered = computeHeadingNumbering(headings, this.numberingSettings)
      const labels = decimalHierarchicalFormatter.format(numbered, this.numberingSettings)
      this.adapter.refreshNumbering(labels)
    } catch (e) {
      logger.error('标题编号刷新失败', e)
    }
  }

  /** Initialize the adapter's writing area reference. */
  private initAdapter(): void {
    const area = this.adapter.detectWritingArea()
    if (area) {
      this.adapter.setWritingArea(area)
    }
  }

  /** Register editor and workspace event listeners. */
  private registerEvents(): void {
    const { ctx } = this

    // File open / switch
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        setTimeout(() => {
          const area = this.adapter.detectWritingArea()
          if (area) {
            this.adapter.setWritingArea(area)
          }
          this.refreshIfEnabled()
        }, 100)
      }),
    )

    // Active leaf change
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        this.scheduleRefresh()
      }),
    )

    // Editor content change
    this.store.add(
      ctx.onEditorEvent('edit', () => {
        this.scheduleRefresh()
      }),
    )

    // Editor DOM load
    this.store.add(
      ctx.onEditorEvent('load', (editorEl: unknown) => {
        if (editorEl instanceof HTMLElement) {
          this.adapter.setWritingArea(editorEl)
        }
        this.refreshIfEnabled()
      }),
    )

    // Register with plugin for auto-cleanup
    ctx.registerDisposable(() => this.dispose())
  }
}
