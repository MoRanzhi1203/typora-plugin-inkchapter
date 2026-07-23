import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type {
  HeadingNumberingSettings,
  HeadingSnapshot,
  RenderedHeadingState,
  RefreshReason,
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
} from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { updateActiveFormatVariant } from './numbering-engine'
import { decimalHierarchicalFormatter } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import { migrateSettings } from './config-migration'
import { getPresetLevels, getPresetPreview } from './presets'
import * as logger from '../core/logger'

const TAIL_REFRESH_MS = 60
const FOCUS_TAIL_MS = 50

export interface ServiceContext {
  readonly settings: PluginSettings<InkChapterSettings>
  onWorkspaceEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onEditorEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable: (fn: () => void) => void
}

/** Reasons that mandate a force refresh (skip dirty check entirely). */
const FORCE_REFRESH_REASONS: Set<RefreshReason> = new Set([
  'toggle', 'manual', 'initial-load', 'focus-in', 'decoration-repair',
  'file-open', 'active-leaf-change',
])

export class HeadingNumberingService {
  private numberingSettings: HeadingNumberingSettings
  private adapter: HeadingDomAdapter
  private store: DisposableStore
  private ctx: ServiceContext

  /** External listeners for settings changes (e.g. settings tab). */
  private settingsListeners: Array<(settings: HeadingNumberingSettings) => void> = []

  // Scheduler
  private rafId: ReturnType<typeof requestAnimationFrame> | null = null
  private tailTimer: ReturnType<typeof setTimeout> | null = null
  private pendingReason: RefreshReason = 'editor-input'

  // State
  private lastSnapshot: HeadingSnapshot[] | null = null
  private renderedStates: RenderedHeadingState[] | null = null
  private isInComposition = false
  private mutationObserver: MutationObserver | null = null

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter
    this.numberingSettings = this.readNormalizedSettings()
    this.store = new DisposableStore()

    this.initAdapter()
    this.setupMutationObserver()
    this.registerEvents()
    this.registerSettingsListener()
    this.requestRefresh('initial-load')
  }

  /** Read settings, apply config migration, and normalize. */
  private readNormalizedSettings(): HeadingNumberingSettings {
    const raw = this.ctx.settings.get('headingNumbering')
    const migrated = migrateSettings(raw)
    // Persist migration result if it changed
    if (!raw || !raw.preset || !raw.levels) {
      this.ctx.settings.set('headingNumbering', migrated)
    }
    return migrated
  }

  toggle(): void {
    this.numberingSettings.enabled = !this.numberingSettings.enabled
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    if (this.numberingSettings.enabled) {
      this.lastSnapshot = null
      this.renderedStates = null
      this.requestRefresh('toggle')
    } else {
      this.adapter.clearNumbering()
    }
    logger.info(`标题编号已${this.numberingSettings.enabled ? '开启' : '关闭'}`)
  }

  renumber(): void {
    if (!this.numberingSettings.enabled) {
      this.numberingSettings.enabled = true
      this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('标题已重新编号')
  }

  /** Toggle level-one heading numbering on/off. */
  toggleLevelOneNumber(): void {
    this.setShowLevelOneNumber(!(this.numberingSettings.showLevelOneNumber ?? false))
  }

  /** Set whether level-one heading shows numbering. */
  setShowLevelOneNumber(enabled: boolean): void {
    if (this.numberingSettings.showLevelOneNumber === enabled) return

    this.numberingSettings.showLevelOneNumber = enabled

    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    // Force full refresh: H1 decorations must be added/removed, H2+ labels recalculated
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()

    // Notify UI listeners
    this.notifySettingsListeners()

    logger.info(`一级标题编号已${enabled ? '开启' : '关闭'}`)
  }

  /** Apply a preset and update numbering immediately. */
  applyPreset(preset: HeadingNumberingPreset): void {
    if (preset === 'custom') {
      // Restore custom draft if available
      this.numberingSettings.preset = 'custom'
      if (this.numberingSettings.customDefinition) {
        this.numberingSettings.levels = { ...this.numberingSettings.customDefinition }
      }
      // else: keep current levels as-is (first time switching to custom)
    } else {
      // Save current custom levels as draft before switching away
      if (this.numberingSettings.preset === 'custom') {
        this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      }
      this.numberingSettings.preset = preset
      this.numberingSettings.levels = { ...getPresetLevels(preset) }
    }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info(`编号预设已切换为：${preset}`)
  }

  /** Update a single level's style. Automatically switches preset to 'custom'. */
  updateLevelStyle(level: HeadingLevel, patch: Partial<HeadingLevelStyle>): void {
    if (this.numberingSettings.preset !== 'custom') {
      // Save current preset levels as custom draft before switching
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      // Copy current preset levels as custom base
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }
    this.numberingSettings.levels = {
      ...this.numberingSettings.levels,
      [level]: { ...this.numberingSettings.levels[level], ...patch },
    }
    // Also persist to customDefinition draft
    this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active format variant for a level.
   * Automatically writes to withLevelOne or withoutLevelOne based on current H1 state.
   */
  updateActiveFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').NumberFormatSegment[]): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }

    const currentStyle = this.numberingSettings.levels[level]
    const updated = updateActiveFormatVariant(
      currentStyle,
      level,
      this.numberingSettings.showLevelOneNumber,
      nextFormat,
    )

    this.numberingSettings.levels = {
      ...this.numberingSettings.levels,
      [level]: updated,
    }
    this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset a single level to defaults. */
  resetLevelStyle(level: HeadingLevel): void {
    const defaults = getPresetLevels('custom')
    // Ensure we're in custom mode
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
    }
    const defaultStyle = defaults[level]
    this.numberingSettings.levels = {
      ...this.numberingSettings.levels,
      [level]: { ...defaultStyle },
    }
    this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset all custom levels to defaults. */
  resetAllCustomLevels(): void {
    const defaults = getPresetLevels('custom')
    this.numberingSettings.preset = 'custom'
    this.numberingSettings.levels = { ...defaults }
    this.numberingSettings.customDefinition = { ...defaults }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('自定义设置已恢复为默认值')
  }

  /** Get the current numbering settings (for UI reading). */
  getCurrentSettings(): HeadingNumberingSettings {
    return { ...this.numberingSettings }
  }

  /**
   * Subscribe to settings changes. Returns unsubscribe function.
   * Used by settings tab to react to external changes (F1 commands, etc.).
   */
  onSettingsChanged(listener: (settings: HeadingNumberingSettings) => void): () => void {
    this.settingsListeners.push(listener)
    return () => {
      const idx = this.settingsListeners.indexOf(listener)
      if (idx >= 0) this.settingsListeners.splice(idx, 1)
    }
  }

  private notifySettingsListeners(): void {
    const snapshot = { ...this.numberingSettings }
    for (const listener of this.settingsListeners) {
      try { listener(snapshot) } catch (e) { logger.error('设置变化监听器异常', e) }
    }
  }

  /** Generate a preview of the current preset/levels. */
  getPreview(): Record<HeadingLevel, string> {
    return getPresetPreview(this.numberingSettings.preset)
  }

  dispose(): void {
    this.cancelPending()
    this.disconnectObserver()
    this.adapter.clearNumbering()
    this.store.dispose()
  }

  // ── Settings sync ──────────────────────────────────────

  /** Listen for external settings changes (e.g. from settings UI) and sync local state. */
  private registerSettingsListener(): void {
    const dispose = this.ctx.settings.onChange('headingNumbering', (_key: unknown, value: HeadingNumberingSettings) => {
      const oldPreset = this.numberingSettings.preset
      const oldShow = this.numberingSettings.showLevelOneNumber

      // Apply migration and normalize
      this.numberingSettings = migrateSettings(value)

      if (oldPreset !== this.numberingSettings.preset ||
          oldShow !== this.numberingSettings.showLevelOneNumber) {
        this.lastSnapshot = null
        this.renderedStates = null
        this.flushRefresh()
      }
    })
    this.store.add(dispose)
  }

  // ── Scheduler ──────────────────────────────────────────

  private requestRefresh(reason: RefreshReason): void {
    if (this.rafId !== null) {
      return
    }
    this.pendingReason = reason
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.doRefresh(this.pendingReason)
    })
  }

  private scheduleTail(reason: RefreshReason, ms: number): void {
    if (this.tailTimer !== null) clearTimeout(this.tailTimer)
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null
      this.doRefresh(reason)
    }, ms)
  }

  private flushRefresh(): void {
    this.cancelPending()
    this.doRefresh('manual')
  }

  private cancelPending(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    if (this.tailTimer !== null) { clearTimeout(this.tailTimer); this.tailTimer = null }
  }

  // ── Core refresh ───────────────────────────────────────

  private doRefresh(reason: RefreshReason): void {
    if (!this.numberingSettings.enabled) return

    const startTime = performance.now()

    try {
      const root = this.adapter.detectEditorRoot()
      if (!root) return
      this.adapter.setEditorRoot(root)

      const snapshot = this.adapter.createHeadingSnapshot()
      const forceRefresh = FORCE_REFRESH_REASONS.has(reason)

      if (!forceRefresh && this.lastSnapshot && this.renderedStates) {
        // Structure unchanged?
        if (!this.adapter.hasStructureChanged(this.lastSnapshot, snapshot)) {
          // Full state check: element refs, class, attr
          if (this.adapter.isRenderedStateValid(this.renderedStates)) {
            this.lastSnapshot = snapshot
            return // Everything is fine, skip
          }
          // Structure same but decoration lost → repair only (node replaced)
          const diff = this.adapter.repairDecoration(this.renderedStates)
          this.renderedStates = this.adapter.buildRenderedStates(
            this.renderedStates.map(s => s.label),
          )
          this.logRefresh(reason, snapshot.length, diff, startTime)
          this.lastSnapshot = snapshot
          return
        }
      }

      // Full refresh
      this.lastSnapshot = snapshot

      const headings = this.adapter.collectHeadings()
      if (headings.length === 0) {
        this.adapter.clearNumbering()
        this.renderedStates = null
        return
      }

      const numbered = computeHeadingNumbering(headings, this.numberingSettings)
      const labels = decimalHierarchicalFormatter.format(numbered, this.numberingSettings)
      const diff = this.adapter.applyNumberingDiff(labels)
      this.renderedStates = this.adapter.buildRenderedStates(labels)

      this.logRefresh(reason, headings.length, diff, startTime)
    } catch (e) {
      logger.error('标题编号刷新失败', e)
    }
  }

  private logRefresh(reason: RefreshReason, headingCount: number, diff: { scanned: number; repaired: number; updated: number; removed: number }, startTime: number): void {
    if (!this.ctx.settings.get('debug')) return
    const duration = performance.now() - startTime
    logger.debug(
      `Heading refresh reason=${reason} headings=${headingCount} diff=s${diff.scanned}/r${diff.repaired}/u${diff.updated}/d${diff.removed} duration=${duration.toFixed(1)}ms`,
    )
  }

  // ── MutationObserver ───────────────────────────────────

  private setupMutationObserver(): void {
    const root = this.adapter.detectEditorRoot()
    if (!root) return
    this.connectObserver(root)
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // Check added nodes
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i]
          if (node instanceof HTMLElement) {
            if (this.isHeadingOrContainsHeading(node)) {
              this.requestRefresh('editor-mutation')
              return
            }
          }
        }

        // Check removed nodes
        for (let i = 0; i < m.removedNodes.length; i++) {
          const node = m.removedNodes[i]
          if (node instanceof HTMLElement) {
            if (this.isHeadingOrContainsHeading(node)) {
              this.requestRefresh('editor-mutation')
              return
            }
          }
        }

        // Check characterData (text content change) on heading ancestors
        if (m.type === 'characterData' && m.target.parentElement) {
          const ancestor = m.target.parentElement.closest('h1, h2, h3, h4, h5, h6')
          if (ancestor && root.contains(ancestor)) {
            this.requestRefresh('editor-mutation')
            return
          }
        }
      }
    })

    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    this.store.add(() => this.disconnectObserver())
  }

  private disconnectObserver(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
  }

  private isHeadingOrContainsHeading(el: HTMLElement): boolean {
    const tag = el.tagName
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      return true
    }
    return el.querySelector('h1, h2, h3, h4, h5, h6') !== null
  }

  // ── Editor binding ─────────────────────────────────────

  private initAdapter(): void {
    const area = this.adapter.detectEditorRoot()
    if (area) this.adapter.setEditorRoot(area)
  }

  private bindEditorRoot(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return

    // input
    const onInput = (): void => {
      if (!this.isInComposition) this.requestRefresh('editor-input')
    }
    root.addEventListener('input', onInput, { passive: true })
    this.store.add(() => root.removeEventListener('input', onInput))

    // composition
    const onCompositionEnd = (): void => {
      this.isInComposition = false
      this.requestRefresh('composition-end')
    }
    root.addEventListener('compositionend', onCompositionEnd)
    this.store.add(() => root.removeEventListener('compositionend', onCompositionEnd))

    const onCompositionStart = (): void => { this.isInComposition = true }
    root.addEventListener('compositionstart', onCompositionStart)
    this.store.add(() => root.removeEventListener('compositionstart', onCompositionStart))

    // focusin: capture heading edit mode → force re-verify next frame
    const onFocusIn = (): void => {
      this.requestRefresh('focus-in')
      this.scheduleTail('decoration-repair', FOCUS_TAIL_MS)
    }
    root.addEventListener('focusin', onFocusIn)
    this.store.add(() => root.removeEventListener('focusin', onFocusIn))

    // click: mouse move cursor
    const onClick = (): void => {
      this.requestRefresh('editor-click')
    }
    root.addEventListener('click', onClick, { passive: true })
    this.store.add(() => root.removeEventListener('click', onClick))

    // keyup: keyboard navigation / undo/redo / heading shortcuts
    const onKeyUp = (): void => {
      this.requestRefresh('editor-keyup')
    }
    root.addEventListener('keyup', onKeyUp, { passive: true })
    this.store.add(() => root.removeEventListener('keyup', onKeyUp))
  }

  // ── Event registration ─────────────────────────────────

  private registerEvents(): void {
    const { ctx } = this

    // Initial bind
    const root = this.adapter.detectEditorRoot()
    if (root) {
      this.adapter.setEditorRoot(root)
      this.bindEditorRoot()
    }

    // Editor DOM load
    this.store.add(
      ctx.onEditorEvent('load', (editorEl: unknown) => {
        if (editorEl instanceof HTMLElement) {
          this.adapter.setEditorRoot(editorEl)
          this.lastSnapshot = null
          this.renderedStates = null
          this.connectObserver(editorEl)
          this.bindEditorRoot()
          queueMicrotask(() => this.requestRefresh('initial-load'))
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        }
      }),
    )

    // Framework edit (fallback)
    this.store.add(
      ctx.onEditorEvent('edit', () => this.requestRefresh('framework-edit')),
    )

    // File open
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        this.lastSnapshot = null
        this.renderedStates = null
        setTimeout(() => {
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('file-open')
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        }, 0)
      }),
    )

    // Active leaf change
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        this.lastSnapshot = null
        this.renderedStates = null
        this.requestRefresh('active-leaf-change')
        this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
      }),
    )

    ctx.registerDisposable(() => this.dispose())
  }
}
