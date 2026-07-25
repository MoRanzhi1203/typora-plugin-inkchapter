import type { PluginSettings } from '@typora-community-plugin/core'
import { Notice } from '@typora-community-plugin/core'
import type { InkChapterSettings } from '../settings/settings-model'
import type {
  HeadingNumberingSettings,
  HeadingSnapshot,
  RenderedHeadingState,
  RefreshReason,
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  MultilevelFormatSegment,
  MultilevelFormatVariants,
  ContextualFormatVariants,
  MaxHeadingLevel,
  HeadingLevelRangeSettings,
  DocumentHeadingLevelOverride,
} from './heading-types'
import { resolveEffectiveMaxLevel, clampMaxLevel } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { updateActiveFormatVariant, updateActiveMultilevelFormatVariant, updateActiveContextualFormatVariant, diagnoseHeadingChain } from './numbering-engine'
import { decimalHierarchicalFormatter } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import { migrateSettings } from './config-migration'
import { getPresetLevels, getPresetPreview } from './presets'
import { scanHeadingsForRange, convertHeadingsToBold, type HeadingScanResult, type RangeReduceAction } from './level-range-utils'
import { HeadingLevelRangeEnforcer, type EnforcerCallbacks } from './heading-level-range-enforcer'
import { HeadingOverrideStore } from './heading-override-store'
import type { HeadingOverrideMap } from './numbering-engine'
import { OutlineNumberingController } from './outline-numbering-controller'
import * as logger from '../core/logger'
import { recordRuntimeAudit, snapshotHeadingCollection, snapshotNumberingEngine, snapshotApplyDiff, snapshotConfigSource, type NumberingEngineEntry, type ApplyDiffEntry } from './runtime-audit'

const TAIL_REFRESH_MS = 60
const FOCUS_TAIL_MS = 50

export interface ServiceContext {
  readonly settings: PluginSettings<InkChapterSettings>
  onWorkspaceEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  onEditorEvent: <K extends string>(event: K, listener: (...args: never[]) => void) => () => void
  registerDisposable: (fn: () => void) => void
  /** Optional: get the currently open file path (for document-level overrides). */
  getActiveFilePath?: () => string | null
  /** Optional: get the raw markdown content of the current editor. */
  getMarkdown?: () => string
  /** Optional: replace editor content with undo support. */
  reloadContent?: (markdown: string) => void
}

/** Reasons that mandate a force refresh (skip dirty check entirely). */
const FORCE_REFRESH_REASONS: Set<RefreshReason> = new Set([
  'toggle', 'manual', 'initial-load', 'focus-in', 'decoration-repair',
  'file-open', 'active-leaf-change',
])

/**
 * Convert contextual format variants back to multilevel format variants.
 * This keeps the two models in sync for backward compatibility.
 */
function contextualToMultilevelVariants(
  contextual: ContextualFormatVariants,
): MultilevelFormatVariants {
  const convert = (segs: readonly import('./heading-types').ContextualFormatSegment[]): MultilevelFormatSegment[] =>
    segs.map(seg => {
      if (seg.type === 'literal') return { type: 'literal', value: seg.value }
      return { type: 'level-template-reference', level: seg.level }
    })
  return {
    withLevelOne: convert(contextual.withLevelOne),
    withoutLevelOne: convert(contextual.withoutLevelOne),
  }
}

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

  // Render version: incremented on document switch to cancel stale async ops
  private renderVersion = 0

  // Level Range Enforcer
  private levelRangeEnforcer!: HeadingLevelRangeEnforcer
  /** Cache of last effective max level for change detection. */
  private lastEffectiveMaxLevel: HeadingLevel = 6

  // Override Store
  private overrideStore: HeadingOverrideStore | null = null

  // Outline Numbering
  private outlineController: OutlineNumberingController

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter
    this.numberingSettings = this.readNormalizedSettings()

    // Build enforcer callbacks
    const enforcerCallbacks: EnforcerCallbacks = {
      getEffectiveMaxLevel: () => this.getEffectiveMaxLevel(),
      getMarkdown: () => this.ctx.getMarkdown?.() ?? '',
      reloadContent: (md: string) => this.ctx.reloadContent?.(md),
      showNotice: (msg: string) => Notice.info(msg),
    }
    this.levelRangeEnforcer = new HeadingLevelRangeEnforcer(enforcerCallbacks)
    this.lastEffectiveMaxLevel = this.getEffectiveMaxLevel()

    // Outline numbering controller
    this.outlineController = new OutlineNumberingController()
    this.outlineController.start()

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

  /**
   * Update the active contextual format variant for a level (schemaVersion >= 8).
   */
  updateActiveContextualFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').ContextualFormatSegment[]): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }

    const currentStyle = this.numberingSettings.levels[level]
    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      level,
      this.numberingSettings.showLevelOneNumber,
      nextFormat,
    )

    // Sync multilevelFormatVariants from contextual for backward compat
    updated.multilevelFormatVariants = contextualToMultilevelVariants(updated.contextualFormatVariants)

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

  /**
   * Update a single segment's appearance within the active contextual format.
   */
  updateContextualSegment(
    lv: HeadingLevel,
    segmentId: string,
    patch: Partial<import('./heading-types').LevelReferenceAppearance>,
  ): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }

    const currentStyle = this.numberingSettings.levels[lv]
    const active = currentStyle.contextualFormatVariants
    if (!active) return

    const showL1 = this.numberingSettings.showLevelOneNumber
    const fmt = lv === 1 ? active.withLevelOne : (showL1 ? active.withLevelOne : active.withoutLevelOne)

    const nextFmt = fmt.map(seg => {
      if (seg.type === 'level-reference' && seg.id === segmentId) {
        return {
          ...seg,
          appearance: { ...seg.appearance, ...patch },
        }
      }
      return seg
    })

    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      lv,
      showL1,
      nextFmt,
    )

    // Sync multilevelFormatVariants for backward compat
    updated.multilevelFormatVariants = contextualToMultilevelVariants(updated.contextualFormatVariants)

    this.numberingSettings.levels = {
      ...this.numberingSettings.levels,
      [lv]: updated,
    }
    this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
    this.ctx.settings.set('headingNumbering', { ...this.numberingSettings })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active multilevel format variant for a level (two-layer model).
   */
  updateActiveMultilevelFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').MultilevelFormatSegment[]): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }

    const currentStyle = this.numberingSettings.levels[level]
    const updated = updateActiveMultilevelFormatVariant(
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

  /**
   * Update a level's number template (tokenStyle, prefix, suffix).
   */
  updateLevelTemplate(level: HeadingLevel, patch: Partial<import('./heading-types').HeadingLevelNumberTemplate>): void {
    if (this.numberingSettings.preset !== 'custom') {
      this.numberingSettings.customDefinition = { ...this.numberingSettings.levels }
      this.numberingSettings.preset = 'custom'
      this.numberingSettings.levels = { ...this.numberingSettings.levels }
    }

    const currentStyle = this.numberingSettings.levels[level]
    const currentTemplate = currentStyle.levelTemplate
    const updatedTemplate = { ...currentTemplate, ...patch }
    // Also sync legacy tokenStyle for backward compat
    const updatedStyle = {
      ...currentStyle,
      levelTemplate: updatedTemplate,
      tokenStyle: patch.tokenStyle ?? currentStyle.tokenStyle,
    }

    this.numberingSettings.levels = {
      ...this.numberingSettings.levels,
      [level]: updatedStyle,
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

  // ── Level range ──────────────────────────────────────

  /** Get the current level range settings from plugin config. */
  getLevelRangeSettings(): HeadingLevelRangeSettings {
    const raw = this.ctx.settings.get('levelRange')
    if (!raw) return { defaultMaxLevel: 6, documentOverrides: {} }
    return {
      defaultMaxLevel: clampMaxLevel(raw.defaultMaxLevel),
      documentOverrides: raw.documentOverrides ?? {},
    }
  }

  /** Resolve the effective max level for the currently open document. */
  getEffectiveMaxLevel(): HeadingLevel {
    const rangeSettings = this.getLevelRangeSettings()
    const docPath = this.getActiveFilePath()
    return resolveEffectiveMaxLevel(rangeSettings, docPath)
  }

  /** Get the path of the currently active file, or null if none. */
  getActiveFilePath(): string | null {
    return this.ctx.getActiveFilePath?.() ?? null
  }

  /** Get a short document key for audit logging. */
  private getDocKey(): string {
    return this.getActiveFilePath()?.split(/[\\/]/).slice(-1)[0]?.slice(0, 30) ?? 'unknown'
  }

  // ── Heading override store ───────────────────────

  /** Get or create the override store for the current document. */
  getOverrideStore(): HeadingOverrideStore | null {
    const docPath = this.getActiveFilePath()
    if (!docPath) return null

    if (!this.overrideStore || this.overrideStore.toDocumentOverrides().documentKey !== docPath) {
      // Load persisted overrides or create new store
      const overrides = this.loadPersistedOverrides(docPath)
      this.overrideStore = new HeadingOverrideStore(docPath, overrides)
    }
    return this.overrideStore
  }

  /** Load persisted overrides from plugin settings. */
  private loadPersistedOverrides(docPath: string): Record<string, import('./heading-types').HeadingNumberingOverride> | undefined {
    try {
      const raw = this.ctx.settings.get('headingNumbering') as any
      return raw?._overrides as Record<string, import('./heading-types').HeadingNumberingOverride> | undefined
    } catch {
      return undefined
    }
  }

  /** Persist overrides to plugin settings. */
  persistOverrides(): void {
    if (!this.overrideStore) return
    const overrides = this.overrideStore.getAllOverrides()
    const current = this.ctx.settings.get('headingNumbering')
    if (current) {
      ;(current as any)._overrides = overrides
      this.ctx.settings.set('headingNumbering', { ...current })
    }
  }

  /** Build override map for the numbering engine from the store. */
  private buildOverrideMap(headings: readonly import('./heading-types').HeadingDescriptor[]): import('./numbering-engine').HeadingOverrideMap | undefined {
    const store = this.getOverrideStore()
    if (!store) return undefined

    const map = new Map<string, 'numbered' | 'unnumbered'>()
    const nameSettings = this.getSpecialNumberingSettings().nameSettings
    const showL1 = this.numberingSettings.showLevelOneNumber

    for (const h of headings) {
      const parentInfo = this.buildParentStructure(headings, h)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        h.level,
        parentInfo,
        h.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      const resolved = store.resolveMode(
        h.level, fp, this.getParentFingerprints(headings, h, store),
        h.text,
        nameSettings.candidates.filter(c => c.enabled),
        nameSettings.matchMode,
        showL1 ?? false,
      )
      if (resolved.mode !== 'inherit') {
        map.set(h.key, resolved.mode)
      }
    }

    return map
  }

  private buildParentStructure(
    headings: readonly import('./heading-types').HeadingDescriptor[],
    current: import('./heading-types').HeadingDescriptor,
  ): import('./heading-override-store').ParentStructure {
    let parentLine: string | null = null
    const ancestorLevels: import('./heading-types').HeadingLevel[] = []
    let foundLevel = current.level

    for (let i = headings.indexOf(current) - 1; i >= 0; i--) {
      const h = headings[i]
      if (h.level < foundLevel) {
        if (!parentLine) parentLine = h.key
        ancestorLevels.unshift(h.level)
        foundLevel = h.level
        if (h.level === 1) break
      }
    }

    return { parentLine, ancestorLevels }
  }

  private getParentFingerprints(
    headings: readonly import('./heading-types').HeadingDescriptor[],
    current: import('./heading-types').HeadingDescriptor,
    store: HeadingOverrideStore,
  ): string[] {
    const fps: string[] = []
    let foundLevel = current.level
    for (let i = headings.indexOf(current) - 1; i >= 0; i--) {
      const h = headings[i]
      if (h.level < foundLevel) {
        const parentInfo = this.buildParentStructure(headings, h)
        const fp = HeadingOverrideStore.fingerprint(
          store.toDocumentOverrides().documentKey,
          h.level, parentInfo,
          h.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
        )
        fps.push(fp)
        foundLevel = h.level
        if (h.level === 1) break
      }
    }
    return fps
  }

  /** Get the special numbering settings. */
  getSpecialNumberingSettings(): import('./heading-types').SpecialHeadingNumberingSettings {
    try {
      const raw = this.ctx.settings.get('specialNumbering' as any) as any
      const result = raw ?? { unnumberedCounterPolicy: 'skip' as const, nameSettings: { enabled: false, candidates: [], matchMode: 'trim' as const, matchAction: 'prompt' as const } }
      // Completely remove name-based unnumbering
      if (result.nameSettings) {
        result.nameSettings.enabled = false
        result.nameSettings.candidates = []
      }
      return result
    } catch {
      return { unnumberedCounterPolicy: 'skip', nameSettings: { enabled: false, candidates: [], matchMode: 'trim', matchAction: 'prompt' } }
    }
  }

  // ── Command implementations ──────────────────────

  /** Get the heading element at the current cursor position. */
  private getCurrentHeadingElement(): HTMLHeadingElement | null {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return null
    const node = sel.getRangeAt(0).startContainer
    if (node instanceof Element) {
      return node.closest('h1, h2, h3, h4, h5, h6')
    }
    return node.parentElement?.closest('h1, h2, h3, h4, h5, h6') ?? null
  }

  /** Get the key of the heading at the current cursor position. */
  private getCurrentHeadingKey(): string | null {
    const el = this.getCurrentHeadingElement()
    if (!el) return null
    return `${el.tagName}-${el.getAttribute('data-line') ?? ''}-${el.id ?? ''}`
  }

  /** Set override for the heading at cursor position. */
  setCurrentHeadingOverride(mode: 'inherit' | 'numbered' | 'unnumbered'): void {
    const store = this.getOverrideStore()
    if (!store) {
      Notice.info('未检测到打开的文档')
      return
    }
    const el = this.getCurrentHeadingElement()
    if (!el) {
      Notice.info('请将光标置于标题中')
      return
    }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const heading = headings.find(h => h.key === key)
    if (!heading) return

    const parentInfo = this.buildParentStructure(headings, heading)
    const fp = HeadingOverrideStore.fingerprint(
      store.toDocumentOverrides().documentKey,
      heading.level,
      parentInfo,
      heading.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
    )

    if (mode === 'inherit') {
      store.removeOverride(fp)
    } else {
      store.setOverride(fp, mode, 'self', 'manual')
    }
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const labels = { inherit: '恢复继承', numbered: '启用编号', unnumbered: '取消编号' }
    Notice.info(`当前标题：已${labels[mode]}`)
  }

  /** Batch override from current heading to end of siblings. */
  batchOverrideFromCurrent(mode: 'numbered' | 'unnumbered'): void {
    const store = this.getOverrideStore()
    if (!store) { Notice.info('未检测到打开的文档'); return }
    const el = this.getCurrentHeadingElement()
    if (!el) { Notice.info('请将光标置于标题中'); return }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const idx = headings.findIndex(h => h.key === key)
    if (idx < 0) return

    const current = headings[idx]
    const siblings = headings.slice(idx).filter(h => h.level === current.level)
    const fps: string[] = []
    for (const sib of siblings) {
      const parentInfo = this.buildParentStructure(headings, sib)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        sib.level, parentInfo,
        sib.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      fps.push(fp)
    }

    store.batchSetOverrides(fps, mode, 'self', 'batch')
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const action = mode === 'unnumbered' ? '停止' : '启用'
    Notice.info(`已对当前标题及后续 ${siblings.length - 1} 个同级标题${action}编号`)
  }

  /** Set subtree override. */
  setSubtreeOverride(mode: 'unnumbered' | 'inherit'): void {
    const store = this.getOverrideStore()
    if (!store) { Notice.info('未检测到打开的文档'); return }
    const el = this.getCurrentHeadingElement()
    if (!el) { Notice.info('请将光标置于标题中'); return }
    const headings = this.adapter.collectHeadings()
    const key = this.getCurrentHeadingKey()
    const idx = headings.findIndex(h => h.key === key)
    if (idx < 0) return

    const current = headings[idx]

    if (mode === 'inherit') {
      // Remove subtree override
      const parentInfo = this.buildParentStructure(headings, current)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        current.level, parentInfo,
        current.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      store.removeOverride(fp)
    } else {
      const parentInfo = this.buildParentStructure(headings, current)
      const fp = HeadingOverrideStore.fingerprint(
        store.toDocumentOverrides().documentKey,
        current.level, parentInfo,
        current.text.replace(/[\s\u00A0]+/g, '').slice(0, 60),
      )
      store.setOverride(fp, mode, 'subtree', 'manual')
    }

    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()

    const label = mode === 'unnumbered' ? '已取消当前标题及其下级编号' : '已恢复当前标题及其下级继承'
    Notice.info(label)
  }

  /** Clear all overrides for current document. */
  clearDocumentOverrides(): void {
    const store = this.getOverrideStore()
    if (!store) return
    store.clearAll()
    this.persistOverrides()
    this.lastSnapshot = null
    this.flushRefresh()
  }

  /** Run outline diagnostic probe. */
  runOutlineProbe(callback: (log: string) => void): void {
    this.outlineController.runProbe(callback)
  }

  /** Manual outline sync with diagnostic output. */
  manualOutlineSync(callback: (log: string) => void): { rootFound: boolean; bodyHeadingCount: number; outlineItemCount: number; matchedCount: number; matchedByIdx: number; attributeApplied: number; unmatchedCount: number } | null {
    return this.outlineController.manualSync(callback)
  }

  /** Set the global default max heading level. */
  setDefaultMaxLevel(maxLevel: MaxHeadingLevel): void {
    const rangeSettings = this.getLevelRangeSettings()
    rangeSettings.defaultMaxLevel = maxLevel
    this.ctx.settings.set('levelRange', { ...rangeSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Set a per-document override for the given file path. */
  setDocumentOverride(docPath: string, override: DocumentHeadingLevelOverride): void {
    const rangeSettings = this.getLevelRangeSettings()
    rangeSettings.documentOverrides = {
      ...rangeSettings.documentOverrides,
      [docPath]: override,
    }
    this.ctx.settings.set('levelRange', { ...rangeSettings })
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Remove a per-document override. */
  removeDocumentOverride(docPath: string): void {
    const rangeSettings = this.getLevelRangeSettings()
    if (rangeSettings.documentOverrides[docPath]) {
      delete rangeSettings.documentOverrides[docPath]
      rangeSettings.documentOverrides = { ...rangeSettings.documentOverrides }
      this.ctx.settings.set('levelRange', { ...rangeSettings })
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.levelRangeEnforcer.resetNotices()
    this.updateLastEffectiveMaxLevel()
    this.flushRefresh()
  }

  /** Track effective max level changes. */
  private updateLastEffectiveMaxLevel(): void {
    this.lastEffectiveMaxLevel = this.getEffectiveMaxLevel()
  }

  /**
   * Scan the current document for headings and identify out-of-range ones.
   * Uses editor.getMarkdown() for text-based parsing.
   * @param maxLevel Optional max level override. Defaults to current effective max.
   */
  scanDocumentHeadings(maxLevel?: number): HeadingScanResult {
    const ml = maxLevel ?? this.getEffectiveMaxLevel()
    const md = this.ctx.getMarkdown?.() ?? ''
    return scanHeadingsForRange(md, ml)
  }

  /**
   * Count headings by level in the current document.
   * Returns a record mapping each level (1-6) to the count.
   */
  countHeadingsByLevel(): Record<number, number> {
    const scan = this.scanDocumentHeadings(6) // scan ALL headings
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (const h of scan.allHeadings) {
      if (h.level >= 1 && h.level <= 6) {
        counts[h.level]++
      }
    }
    return counts
  }

  /** Count out-of-range headings for the current effective max level. */
  countOutOfRangeHeadings(): number {
    return this.scanDocumentHeadings().outOfRange.length
  }

  /**
   * Convert out-of-range headings to bold paragraphs with undo support.
   * Returns true if conversion was performed.
   */
  convertOutOfRangeHeadings(): boolean {
    const scan = this.scanDocumentHeadings()
    if (scan.outOfRange.length === 0) return false

    const md = this.ctx.getMarkdown?.() ?? ''
    const newMd = convertHeadingsToBold(md, scan.outOfRange)
    if (newMd === md) return false

    this.ctx.reloadContent?.(newMd)
    return true
  }

  dispose(): void {
    this.cancelPending()
    this.disconnectObserver()
    this.adapter.clearNumbering()
    this.store.dispose()
    this.levelRangeEnforcer.dispose()
    this.outlineController.stop()
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

    recordRuntimeAudit('doRefresh:start', {
      documentKey: this.getDocKey(),
      renderVersion: this.renderVersion,
      refreshReason: reason,
    })

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
      snapshotHeadingCollection(headings)
      if (headings.length === 0) {
        this.adapter.clearNumbering()
        this.renderedStates = null
        recordRuntimeAudit('doRefresh:end', { headingCount: 0 })
        return
      }

      // Snapshot config before computation
      snapshotConfigSource('pre-compute', {
        showLevelOneNumber: this.numberingSettings.showLevelOneNumber,
        preset: this.numberingSettings.preset,
        maxDepth: this.numberingSettings.maxDepth,
        levels: Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map(lv => [
            lv,
            {
              enabled: this.numberingSettings.levels[lv as HeadingLevel]?.enabled ?? false,
              cVarWith: this.numberingSettings.levels[lv as HeadingLevel]?.contextualFormatVariants?.withLevelOne?.length ?? 0,
              cVarWithout: this.numberingSettings.levels[lv as HeadingLevel]?.contextualFormatVariants?.withoutLevelOne?.length ?? 0,
            },
          ]),
        ),
      })

      // Apply effective max level from level range settings
      const effectiveMax = this.getEffectiveMaxLevel()
      this.numberingSettings.maxDepth = effectiveMax

      // Build override map from store
      const overrideMap = this.buildOverrideMap(headings)

      // Get counter policy
      const specialSettings = this.getSpecialNumberingSettings()
      const counterPolicy = specialSettings.unnumberedCounterPolicy

      const numbered = computeHeadingNumbering(headings, this.numberingSettings, overrideMap, counterPolicy)
      const labels = decimalHierarchicalFormatter.format(numbered, this.numberingSettings)

      // ── Quick diagnostic: print heading keys + override map ──
      const h2Keys = headings.filter(h => h.level === 2).map(h => h.key)
      const ovEntries = overrideMap ? Array.from(overrideMap.entries()) : []
      console.log('[InkChapter DIAG] H2 keys:', h2Keys)
      console.log('[InkChapter DIAG] overrideMap size:', ovEntries.length, 'entries:', ovEntries.slice(0, 10).map(([k, v]) => `${k}=${v}`))
      console.log('[InkChapter DIAG] H2 labels:', numbered.filter(h => h.level === 2).map(h => ({ text: h.text.slice(0, 20), label: h.label, counters: h.counters })))

      // Snapshot numbering engine per-heading output
      const engineEntries: NumberingEngineEntry[] = numbered.map((h, i) => {
        const style = this.numberingSettings.levels[h.level as HeadingLevel]
        const enabledLvls = [1, 2, 3, 4, 5, 6].filter(
          lv => lv === 1 ? this.numberingSettings.showLevelOneNumber : (this.numberingSettings.levels[lv as HeadingLevel]?.enabled ?? false),
        ) as number[]
        const depth = enabledLvls.indexOf(h.level) >= 0 ? enabledLvls.indexOf(h.level) + 1 : null
        return {
          headingIndex: i,
          actualLevel: h.level,
          styleLevelUsed: h.level,
          styleEnabled: style?.enabled ?? false,
          visibleDepth: depth,
          enabledLevels: enabledLvls,
          activeCounters: h.counters as number[],
          selectedVariant: h.level === 1 ? 'withLevelOne' : (!this.numberingSettings.showLevelOneNumber ? 'withoutLevelOne' : 'withLevelOne'),
          variantSegmentCount: 0,
          generatedLabel: h.label,
          textPreview: h.text.slice(0, 40),
        }
      })
      snapshotNumberingEngine(this.numberingSettings, engineEntries)

      const diff = this.adapter.applyNumberingDiff(labels)
      this.renderedStates = this.adapter.buildRenderedStates(labels)

      // Snapshot apply-diff
      const headingEls = this.adapter.getEditorRoot()?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? []
      const diffEntries: ApplyDiffEntry[] = []
      let di = 0; for (const el of Array.from(headingEls).slice(0, 20)) {
        diffEntries.push({
          domIndex: di, domKey: el.tagName + '-' + (el.getAttribute('data-line') ?? ''), tagName: el.tagName,
          parsedLevel: parseInt(el.tagName.charAt(1)), textPreview: (el.textContent ?? '').slice(0, 40),
          labelIndex: di, incomingLabel: di < labels.length ? labels[di] : 'N/A',
          previousAttr: el.getAttribute('data-inkchapter-heading-number'),
          action: di < labels.length ? (labels[di] ? 'update' : 'skip-empty') : 'skip-empty',
          nextAttr: null as string | null,
        });
        di++
      }
      snapshotApplyDiff(labels, diffEntries, labels.length, headingEls.length)

      // Sync outline sidebar numbering
      this.outlineController.syncAfterRefresh(headings, labels)

      // Output H2 diagnostic in dev mode (first load only)
      if (reason === 'initial-load' || reason === 'file-open') {
        try { diagnoseHeadingChain(headings, this.numberingSettings) } catch { /* silent */ }
      }

      this.logRefresh(reason, headings.length, diff, startTime)
      recordRuntimeAudit('doRefresh:end', {
        headingCount: headings.length,
        labelCount: labels.length,
        refreshReason: reason,
        renderVersion: this.renderVersion,
      })
    } catch (e) {
      logger.error('标题编号刷新失败', e)
      recordRuntimeAudit('doRefresh:error', { details: { error: String(e) } })
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
    this.attachPasteListener(root)
    this.attachKeydownListener(root)
  }

  private connectObserver(root: HTMLElement): void {
    this.disconnectObserver()

    this.mutationObserver = new MutationObserver((mutations) => {
      let foundNewHeading = false

      for (const m of mutations) {
        // Check added nodes
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i]
          if (node instanceof HTMLElement) {
            if (this.isHeadingOrContainsHeading(node)) {
              this.requestRefresh('editor-mutation')
              foundNewHeading = true
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

      // Post-hoc enforcement: check for out-of-range headings created by Typora
      if (foundNewHeading) {
        this.levelRangeEnforcer.enforceAfterMutation()
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

  // ── Paste handling ──────────────────────────────────────

  private attachPasteListener(root: HTMLElement): void {
    const onPaste = (): void => {
      // Delay to let Typora process the paste first
      setTimeout(() => {
        this.levelRangeEnforcer.enforceAfterPaste()
        this.requestRefresh('editor-mutation')
      }, 50)
    }
    root.addEventListener('paste', onPaste, { passive: true })
    this.store.add(() => root.removeEventListener('paste', onPaste))
  }

  // ── Demotion interception ──────────────────────────────

  /**
   * Listen for Tab key (heading demotion) to block level changes
   * that would exceed the effective max level.
   */
  private attachKeydownListener(root: HTMLElement): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || e.shiftKey) return // Only Tab (demotion), not Shift+Tab

      // Check if cursor is inside a heading
      const sel = window.getSelection()
      if (!sel?.rangeCount) return
      const node = sel.getRangeAt(0).startContainer
      const heading = node instanceof Element
        ? node.closest('h1, h2, h3, h4, h5, h6')
        : node.parentElement?.closest('h1, h2, h3, h4, h5, h6')
      if (!heading) return

      const currentLevel = parseInt(heading.tagName.charAt(1), 10)
      if (isNaN(currentLevel)) return

      const result = this.levelRangeEnforcer.checkDemotion(currentLevel)
      if (!result.allowed && result.blockedLevel != null) {
        e.preventDefault()
        e.stopPropagation()
        this.levelRangeEnforcer.showDemotionBlockedNotice(result.blockedLevel)
      }
    }

    root.addEventListener('keydown', onKeyDown, true)
    this.store.add(() => root.removeEventListener('keydown', onKeyDown, true))
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
        recordRuntimeAudit('editor:load', { documentKey: this.getDocKey() })
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

    // File open — cancel stale state, reinit outline, schedule refresh
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        const version = ++this.renderVersion
        this.outlineController.setDocumentKey(this.getDocKey())
        recordRuntimeAudit('file:open:received', { documentKey: this.getDocKey(), renderVersion: version })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.reinitialize()
        setTimeout(() => {
          if (version !== this.renderVersion) {
            recordRuntimeAudit('file:open:timeout-abort', { renderVersion: this.renderVersion, expectedVersion: version })
            return
          }
          recordRuntimeAudit('file:open:timeout-start', { renderVersion: version })
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

    // Active leaf change — bump version, reinit outline
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        ++this.renderVersion
        this.outlineController.setDocumentKey(this.getDocKey())
        recordRuntimeAudit('active-leaf:change', { documentKey: this.getDocKey(), renderVersion: this.renderVersion })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.reinitialize()
        this.requestRefresh('active-leaf-change')
        this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
      }),
    )

    ctx.registerDisposable(() => this.dispose())
  }
}
