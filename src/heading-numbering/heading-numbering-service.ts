import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type {
  HeadingLevel,
  HeadingLevelDefinition,
  HeadingNumberingPreset,
  HeadingNumberingSettings,
  HeadingSnapshot,
  RenderedHeadingState,
  RefreshReason,
} from './heading-types'
import { HEADING_LEVELS } from './heading-types'
import { computeHeadingNumbering, getAvailableReferenceLevels } from './numbering-engine'
import { decimalHierarchicalFormatter } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import { migrateSettings } from './config-migration'
import { getPresetLevels, getPresetPreview, deepCloneLevels, normalizeFormatSegments } from './presets'
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

  /** Read settings, apply config migration, normalize all formats, and persist. */
  private readNormalizedSettings(): HeadingNumberingSettings {
    const raw = this.ctx.settings.get('headingNumbering')
    const migrated = migrateSettings(raw)
    let changed = false

    // Compute hidden levels
    const hiddenLevels = new Set<HeadingLevel>()
    if (!migrated.showLevelOneNumber) hiddenLevels.add(1)

    // Normalize all level formats on startup (fixes old corrupted formats)
    const normalizedLevels = deepCloneLevels(migrated.customDefinition.levels)
    for (const lv of HEADING_LEVELS) {
      const oldFormat = normalizedLevels[lv].format
      const newFormat = normalizeFormatSegments(oldFormat, lv, hiddenLevels)
      if (JSON.stringify(newFormat) !== JSON.stringify(oldFormat)) {
        changed = true
        normalizedLevels[lv] = { ...normalizedLevels[lv], format: newFormat }
      }
    }

    if (changed) {
      migrated.customDefinition = { levels: normalizedLevels }
      this.ctx.settings.set('headingNumbering', migrated)
    } else if (!raw || !raw.preset || !raw.customDefinition) {
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

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()

    logger.info(`一级标题编号已${enabled ? '开启' : '关闭'}`)
  }

  /** Apply a preset and update numbering immediately. */
  applyPreset(preset: HeadingNumberingPreset): void {
    if (preset === 'custom') {
      this.numberingSettings.preset = 'custom'
    } else {
      this.numberingSettings.preset = preset
      this.numberingSettings.customDefinition = {
        levels: getPresetLevels(preset),
      }
    }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info(`编号预设已切换为：${preset}`)
  }

  /** Update a single level's definition. Automatically switches preset to 'custom'. */
  updateLevelStyle(level: HeadingLevel, patch: Partial<HeadingLevelDefinition>): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.preset = 'custom'
      // Copy current preset levels as custom base
      this.numberingSettings.customDefinition = {
        levels: deepCloneLevels(this.numberingSettings.customDefinition.levels),
      }
    }
    const currentLevels = this.numberingSettings.customDefinition.levels
    this.numberingSettings.customDefinition = {
      levels: {
        ...currentLevels,
        [level]: { ...currentLevels[level], ...patch },
      },
    }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Get the current numbering settings (for UI reading). */
  getCurrentSettings(): HeadingNumberingSettings {
    return { ...this.numberingSettings }
  }

  /** Apply a complete settings object (used by copy-to-custom, restore-defaults). */
  applySettings(settings: HeadingNumberingSettings): void {
    this.numberingSettings = { ...settings }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
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
      this.numberingSettings = migrateSettings(value as unknown as Record<string, unknown>)

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
    if (this.rafId !== null) return
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
        if (!this.adapter.hasStructureChanged(this.lastSnapshot, snapshot)) {
          if (this.adapter.isRenderedStateValid(this.renderedStates)) {
            this.lastSnapshot = snapshot
            return
          }
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
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i]
          if (node instanceof HTMLElement) {
            if (this.isHeadingOrContainsHeading(node)) {
              this.requestRefresh('editor-mutation')
              return
            }
          }
        }

        for (let i = 0; i < m.removedNodes.length; i++) {
          const node = m.removedNodes[i]
          if (node instanceof HTMLElement) {
            if (this.isHeadingOrContainsHeading(node)) {
              this.requestRefresh('editor-mutation')
              return
            }
          }
        }

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

    // focusin
    const onFocusIn = (): void => {
      this.requestRefresh('focus-in')
      this.scheduleTail('decoration-repair', FOCUS_TAIL_MS)
    }
    root.addEventListener('focusin', onFocusIn)
    this.store.add(() => root.removeEventListener('focusin', onFocusIn))

    // click
    const onClick = (): void => {
      this.requestRefresh('editor-click')
    }
    root.addEventListener('click', onClick, { passive: true })
    this.store.add(() => root.removeEventListener('click', onClick))

    // keyup
    const onKeyUp = (): void => {
      this.requestRefresh('editor-keyup')
    }
    root.addEventListener('keyup', onKeyUp, { passive: true })
    this.store.add(() => root.removeEventListener('keyup', onKeyUp))
  }

  // ── Event registration ─────────────────────────────────

  private registerEvents(): void {
    const { ctx } = this

    const root = this.adapter.detectEditorRoot()
    if (root) {
      this.adapter.setEditorRoot(root)
      this.bindEditorRoot()
    }

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

    this.store.add(
      ctx.onEditorEvent('edit', () => this.requestRefresh('framework-edit')),
    )

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
