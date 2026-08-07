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
  HeadingSettingsScope,
  SaveHeadingSettingsRequest,
  DocumentNumberingContext,
  HeadingNumberingScopeStore,
  FormatLibrary,
  CustomNumberingFormat,
  NumberingFormatSource,
} from './heading-types'
import { resolveEffectiveMaxLevel, clampMaxLevel } from './heading-types'
import { computeHeadingNumbering } from './numbering-engine'
import { updateActiveFormatVariant, updateActiveMultilevelFormatVariant, updateActiveContextualFormatVariant, diagnoseHeadingChain } from './numbering-engine'
import { decimalHierarchicalFormatter, extractLabelGaps } from './numbering-formatter'
import { HeadingDomAdapter } from '../infrastructure/heading-dom-adapter'
import { DisposableStore } from '../utils/disposable-store'
import { migrateSettings } from './config-migration'
import { getPresetLevels, getPresetPreview } from './presets'
import { scanHeadingsForRange, convertHeadingsToBold, type HeadingScanResult, type RangeReduceAction } from './level-range-utils'
import { HeadingLevelRangeEnforcer, type EnforcerCallbacks } from './heading-level-range-enforcer'
import { HeadingOverrideStore } from './heading-override-store'
import type { HeadingOverrideMap } from './numbering-engine'
import { OutlineNumberingController } from './outline-numbering-controller'
import { OutlineToolbarController } from './outline-toolbar-controller'
import type { OutlineToolbarCallbacks } from './outline-toolbar-controller'
import * as logger from '../core/logger'
import { recordRuntimeAudit, snapshotHeadingCollection, snapshotNumberingEngine, snapshotApplyDiff, snapshotConfigSource, type NumberingEngineEntry, type ApplyDiffEntry } from './runtime-audit'
import {
  injectShortcutMarkerInMarkdown,
  focusNewIndentParagraph,
  refreshParagraphIndentStyles,
  getCurrentParagraphElement,
  isInExcludedContext,
  isCursorAtEnd,
} from './paragraph-indent-manager'
import {
  generateDocumentKey,
  deepCloneSettings,
  resolveEffectiveSettings,
  saveHeadingSettings,
  removeDocumentOverride,
  hasDocumentOverride,
  migrateHeadingNumberingToScopeStore,
  getDefaultHeadingNumberingSettings,
  saveLayoutOverrides,
  hasLayoutOverrides,
} from './heading-numbering-scope-store'

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
  /** Optional: write diagnostic data to a file (for DOM structure debugging). */
  writeDiagnosticFile?: (filename: string, data: string) => void
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

  // Scope store: authoritative source for heading numbering settings
  private scopeStore: HeadingNumberingScopeStore

  // Current document context: resolved effective settings for active document
  private docContext: DocumentNumberingContext

  // Settings revision: bumped on save to invalidate caches
  private settingsRevision = 0

  // Level Range Enforcer
  private levelRangeEnforcer!: HeadingLevelRangeEnforcer
  private lastEffectiveMaxLevel: HeadingLevel = 6

  // Override Store
  private overrideStore: HeadingOverrideStore | null = null

  // Outline Numbering
  private outlineController: OutlineNumberingController
  // Outline Toolbar
  private outlineToolbar: OutlineToolbarController

  // Editor root binding guard
  private boundEditorRoot: HTMLElement | null = null
  private editorRootDisposables: DisposableStore | null = null

  // Timer handles for cleanup
  private pasteListenerTimer: ReturnType<typeof setTimeout> | null = null
  private fileOpenRetryTimer: ReturnType<typeof setTimeout> | null = null

  // Disposed flag
  private disposed = false

  constructor(ctx: ServiceContext, adapter: HeadingDomAdapter) {
    this.ctx = ctx
    this.adapter = adapter

    // Initialize scope store (with migration from old format)
    this.scopeStore = this.initScopeStore()

    // Resolve effective settings for current document
    const docKey = this.getDocumentKey()
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey)

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

    // Outline toolbar controller
    const toolbarCallbacks: OutlineToolbarCallbacks = {
      isNumberingEnabled: () => this.s.enabled,
      toggleNumbering: () => this.toggleNumberingFromToolbar(),
      isShowLevelOne: () => this.s.showLevelOneNumber ?? false,
      toggleLevelOneNumber: () => this.toggleLevelOneFromToolbar(),
      writeDiagnosticFile: (filename, data) => {
        this.ctx.writeDiagnosticFile?.(filename, data)
      },
      getHeadings: () => this.outlineController.getCachedHeadings(),
    }
    this.outlineToolbar = new OutlineToolbarController(toolbarCallbacks)
    this.outlineToolbar.start()

    this.store = new DisposableStore()

    this.initAdapter()
    this.setupMutationObserver()
    this.registerEvents()
    this.registerSettingsListener()
    this.requestRefresh('initial-load')
  }

  /** Initialize scope store: try reading new format, fall back to migration. */
  private initScopeStore(): HeadingNumberingScopeStore {
    const raw = this.ctx.settings.get('headingNumberingScopes' as any) as any
    if (raw?.schemaVersion && raw.globalDefault) {
      console.info('[InkChapter] Using headingNumberingScopes')
      return raw as HeadingNumberingScopeStore
    }

    // Try migration from old headingNumbering
    // Access plugin raw data via settings.get on the legacy key
    const oldSettings = this.ctx.settings.get('headingNumbering' as any) as any
    if (oldSettings?.preset || oldSettings?.levels) {
      const migResult = migrateHeadingNumberingToScopeStore(
        { headingNumbering: oldSettings },
      )
      if (migResult.migrated) {
        console.info('[InkChapter] Migrated headingNumbering → headingNumberingScopes')
        this.persistScopeStore(migResult.store)
      }
      return migResult.store
    }

    // No existing data — use fresh default store
    console.info('[InkChapter] No existing heading numbering data, using defaults')
    return {
      schemaVersion: 1,
      globalDefault: getDefaultHeadingNumberingSettings(),
      documentOverrides: {},
      globalParagraphLayout: { defaultIndent: 'flush', flushAfterDisplayMath: true, indentShortcutEnabled: true },
    }
  }

  /** Persist the scope store to plugin settings. */
  private persistScopeStore(store: HeadingNumberingScopeStore): void {
    this.scopeStore = store
    this.ctx.settings.set('headingNumberingScopes' as any, store as any)
  }

  /** Get the current scope store (for settings tab read). */
  getScopeStore(): HeadingNumberingScopeStore {
    return this.scopeStore
  }

  /** Get the current effective settings (for settings tab read). */
  getEffectiveSettings(): HeadingNumberingSettings {
    return deepCloneSettings(this.docContext.effectiveSettings)
  }

  /** Get current settings source ('global' or 'document'). */
  getSettingsSource(): 'global' | 'document' {
    return this.docContext.source
  }

  /** Save heading numbering with explicit scope. */
  saveHeadingNumberingScoped(
    scope: HeadingSettingsScope,
    documentKey: string | null,
    settings: HeadingNumberingSettings,
    formatSource?: NumberingFormatSource,
  ): void {
    const req: SaveHeadingSettingsRequest = {
      scope,
      documentKey,
      settings,
    }
    if (formatSource) {
      req.formatSource = formatSource
    }
    const newStore = saveHeadingSettings(this.scopeStore, req)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload document context if current document is affected
    const currentKey = this.getDocumentKey()
    if (scope === 'global' || documentKey === currentKey) {
      const wasEnabled = this.docContext.effectiveSettings.enabled
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey)
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      // When numbering was turned off, doRefresh returns early.
      // Must explicitly clear body and outline numbering.
      if (wasEnabled && !this.s.enabled) {
        this.adapter.clearNumbering()
        this.outlineController.clearOutlineNumbering()
      }
      this.flushRefresh()
    }
  }

  /** Remove document override and restore inherit global. */
  restoreInheritGlobal(documentKey: string): void {
    const newStore = removeDocumentOverride(this.scopeStore, documentKey)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload current document context
    const currentKey = this.getDocumentKey()
    if (currentKey === documentKey) {
      const wasEnabled = this.docContext.effectiveSettings.enabled
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey)
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      if (wasEnabled && !this.s.enabled) {
        this.adapter.clearNumbering()
        this.outlineController.clearOutlineNumbering()
      }
      this.flushRefresh()
    }
  }

  /** Check if current document has a custom override. */
  hasCurrentDocumentOverride(): boolean {
    return hasDocumentOverride(this.scopeStore, this.getDocumentKey())
  }

  /** Check if current document has any layout overrides (alignment, indent, gap). */
  hasDocumentLayoutOverrides(): boolean {
    return hasLayoutOverrides(this.scopeStore, this.getDocumentKey())
  }

  // ── Paragraph layout ─────────────────────────────

  /** Get the effective paragraph layout settings for the current document. */
  getParagraphLayoutSettings(): import('./heading-types').ParagraphLayoutSettings {
    const docKey = this.getDocumentKey()
    if (docKey) {
      const override = this.scopeStore.documentOverrides[docKey]
      if (override?.paragraphLayout) {
        return { ...override.paragraphLayout }
      }
    }
    return { ...this.scopeStore.globalParagraphLayout }
  }

  /** Save paragraph layout settings. */
  saveParagraphLayoutSettings(
    scope: 'global' | 'document',
    settings: import('./heading-types').ParagraphLayoutSettings,
  ): void {
    if (scope === 'global') {
      this.scopeStore = {
        ...this.scopeStore,
        globalParagraphLayout: { ...settings },
      }
    } else {
      const docKey = this.getDocumentKey()
      if (!docKey) return
      const existing = this.scopeStore.documentOverrides[docKey]
      this.scopeStore = {
        ...this.scopeStore,
        documentOverrides: {
          ...this.scopeStore.documentOverrides,
          [docKey]: {
            updatedAt: Date.now(),
            settings: existing?.settings ?? this.scopeStore.globalDefault,
            formatSource: existing?.formatSource,
            layoutOverrides: existing?.layoutOverrides,
            paragraphLayout: { ...settings },
          },
        },
      }
    }
    this.persistScopeStore(this.scopeStore)
    this.flushRefresh()
  }

  /** Restore paragraph layout to inherit global default. */
  restoreParagraphLayoutInheritance(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return
    const existing = this.scopeStore.documentOverrides[docKey]
    if (!existing) return

    const { paragraphLayout: _, ...rest } = existing
    if (Object.keys(rest).length <= 2) {
      // Only settings/formatSource remain — remove entire override
      this.scopeStore = removeDocumentOverride(this.scopeStore, docKey)
    } else {
      this.scopeStore = {
        ...this.scopeStore,
        documentOverrides: {
          ...this.scopeStore.documentOverrides,
          [docKey]: rest as import('./heading-types').HeadingNumberingDocumentOverride,
        },
      }
    }
    this.persistScopeStore(this.scopeStore)
    this.flushRefresh()
  }

  // ── Template update acknowledgement ──────────────

  /**
   * Get the last acknowledged template version for a document+format pair.
   * Returns undefined if never acknowledged.
   */
  getAcknowledgedTemplateVersion(docKey: string | null, formatId: string): number | undefined {
    if (!docKey) return undefined
    const acks = this.loadAcknowledgements()
    const ackKey = `${docKey}::${formatId}`
    return acks[ackKey]
  }

  /**
   * Record that the user has acknowledged a template update for this document+format+version.
   */
  acknowledgeTemplateUpdate(docKey: string | null, formatId: string, templateVersion: number): void {
    if (!docKey) return
    const acks = this.loadAcknowledgements()
    const ackKey = `${docKey}::${formatId}`
    acks[ackKey] = templateVersion
    this.ctx.settings.set('acknowledgedTemplateUpdates' as any, acks as any)
  }

  /** Load all acknowledged template update records. */
  private loadAcknowledgements(): Record<string, number> {
    const raw = this.ctx.settings.get('acknowledgedTemplateUpdates' as any) as Record<string, number> | undefined
    return raw ?? {}
  }

  /**
   * Check whether a template update notice is still pending (not yet acknowledged).
   * Returns true only when the template version was never acknowledged for this doc+format.
   */
  isTemplateUpdatePending(docKey: string | null, formatId: string, templateVersion: number): boolean {
    const ack = this.getAcknowledgedTemplateVersion(docKey, formatId)
    if (ack === undefined) return true  // never acknowledged
    return ack < templateVersion  // new version, not yet acknowledged
  }

  // ── Format library ───────────────────────────────

  /** Get the user-managed format library from plugin settings. */
  getFormatLibrary(): FormatLibrary {
    const raw = this.ctx.settings.get('formatLibrary' as any) as FormatLibrary | undefined
    if (raw?.version && Array.isArray(raw.formats)) {
      // If the raw data lacks preferences, add defaults (inline migration)
      if (!raw.preferences) {
        return {
          version: raw.version,
          formats: raw.formats,
          preferences: {
            hiddenBuiltInPresetIds: [],
            customFormatOrder: raw.formats.map(f => f.id),
          },
        }
      }
      // Sanitize hidden preset IDs
      const validIds = new Set(['decimal-hierarchical', 'chinese-chapter', 'chinese-outline', 'roman-hierarchical'])
      const sanitized: string[] = []
      const seen = new Set<string>()
      for (const id of raw.preferences.hiddenBuiltInPresetIds ?? []) {
        if (validIds.has(id) && !seen.has(id)) {
          sanitized.push(id)
          seen.add(id)
        }
      }
      return {
        ...raw,
        preferences: {
          hiddenBuiltInPresetIds: sanitized as any,
          customFormatOrder: raw.preferences.customFormatOrder ?? raw.formats.map(f => f.id),
        },
      }
    }
    return { version: 1, formats: [], preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] } }
  }

  /** Save the format library to plugin settings. */
  saveFormatLibrary(library: FormatLibrary): void {
    this.ctx.settings.set('formatLibrary' as any, library as any)
  }

  /**
   * Apply a format to the specified scope.
   * Deep-clones the format's settings into a snapshot in the scope store.
   * Editing or deleting the format later does NOT affect the snapshot.
   * Preserves existing document-level layout overrides.
   */
  applyFormatToScope(
    format: CustomNumberingFormat,
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): void {
    const snapshot: HeadingNumberingSettings = {
      enabled: format.settings.enabled,
      showLevelOneNumber: format.settings.showLevelOneNumber,
      preset: 'custom',
      maxDepth: format.settings.maxDepth,
      levels: format.settings.levels,
      customDefinition: format.settings.levels,
    }
    const formatSource: NumberingFormatSource = { type: 'custom', formatId: format.id, version: format.version ?? 1 }

    // Preserve existing layout overrides when re-applying format to document scope
    const existingLo = documentKey
      ? this.scopeStore.documentOverrides[documentKey]?.layoutOverrides
      : undefined

    // Save the settings with formatSource first
    this.saveHeadingNumberingScoped(scope, documentKey, snapshot, formatSource)

    // If document had layout overrides, restore them after the format re-apply
    if (existingLo && documentKey) {
      const newStore = saveLayoutOverrides(this.scopeStore, documentKey, existingLo)
      this.persistScopeStore(newStore)
    }

    // Reload document context if current document is affected
    const currentKey = this.getDocumentKey()
    if (scope === 'global' || documentKey === currentKey) {
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey)
      this.docContext.settingsRevision = this.settingsRevision
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      this.flushRefresh()
    }
  }

  /**
   * Apply a built-in preset to the specified scope.
   */
  applyPresetToScope(
    presetId: string,
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): void {
    const levels = getPresetLevels(presetId as HeadingNumberingPreset)
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      showLevelOneNumber: false,
      preset: presetId as HeadingNumberingPreset,
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const formatSource: NumberingFormatSource = { type: 'built-in', presetId }
    this.saveHeadingNumberingScoped(scope, documentKey, snapshot, formatSource)
  }

  // ── Convenience accessor for effective settings ──
  private get s(): HeadingNumberingSettings {
    return this.docContext.effectiveSettings
  }

  /** Generate vault-relative document key for the current file. */
  getDocumentKey(): string | null {
    const filePath = this.ctx.getActiveFilePath?.() ?? null
    if (!filePath) return null
    // Use the vault root from Typora community plugin API
    const vaultRoot = (this.ctx as any).vaultRoot ??
      (this.ctx.settings as any).getVaultRoot?.() ??
      (filePath.split(/[\\/]/).slice(0, -1).join('/'))
    return generateDocumentKey(filePath, typeof vaultRoot === 'string' ? vaultRoot : filePath.split(/[\\/]/).slice(0, -1).join('/'))
  }

  /** Get the path of the currently active file, or null if none. */
  getActiveFilePath(): string | null {
    return this.ctx.getActiveFilePath?.() ?? null
  }

  /** Get a short document key for audit logging. */
  private getDocKey(): string {
    return this.getActiveFilePath()?.split(/[\\/]/).slice(-1)[0]?.slice(0, 30) ?? 'unknown'
  }

  /** Load document context when switching documents. */
  private loadDocumentContext(): void {
    const oldKey = this.docContext?.documentKey ?? null
    const docKey = this.getDocumentKey()
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey)
    this.docContext.settingsRevision = this.settingsRevision
    // [Diagnostic] Document change log — remove after verification
    const docPath = this.getActiveFilePath()
    const override = docKey ? this.scopeStore.documentOverrides[docKey] : undefined
    const fs = override?.formatSource
    console.log('[InkChapter ServiceDocSwitch] path=' + (docPath ?? '(none)')
      + ' oldKey=' + (oldKey ?? '(none)')
      + ' newKey=' + (docKey ?? '(none)')
      + ' formatSource=' + JSON.stringify(fs ?? null)
      + ' preset=' + this.s.preset
      + ' showLevelOne=' + this.s.showLevelOneNumber)
    // Notify document change listeners when document key changes
    if (docKey !== oldKey) {
      this.notifyDocumentChanged(docKey, oldKey)
    }
  }

  private documentChangeListeners: Array<(newKey: string | null, oldKey: string | null) => void> = []

  /** Subscribe to document changes (file switch). Returns unsubscribe function. */
  onDocumentChanged(listener: (newKey: string | null, oldKey: string | null) => void): () => void {
    this.documentChangeListeners.push(listener)
    return () => {
      const idx = this.documentChangeListeners.indexOf(listener)
      if (idx >= 0) this.documentChangeListeners.splice(idx, 1)
    }
  }

  private notifyDocumentChanged(newKey: string | null, oldKey: string | null): void {
    for (const listener of this.documentChangeListeners) {
      try { listener(newKey, oldKey) } catch (e) { logger.error('文档切换监听器异常', e) }
    }
  }

  toggle(): void {
    const s = this.s
    s.enabled = !s.enabled
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)

    if (s.enabled) {
      this.lastSnapshot = null
      this.renderedStates = null
      this.requestRefresh('toggle')
    } else {
      this.adapter.clearNumbering()
      this.outlineController.clearOutlineNumbering()
    }
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
    logger.info(`标题编号已${s.enabled ? '开启' : '关闭'}`)
  }

  /** Toggle numbering from outline toolbar — always document scope. */
  private toggleNumberingFromToolbar(): void {
    const s = this.s
    s.enabled = !s.enabled
    // Always save to current document (not global)
    const docKey = this.getDocumentKey()
    if (docKey) {
      this.saveHeadingNumberingScoped('document', docKey, { ...s })
    } else {
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }

    if (s.enabled) {
      this.lastSnapshot = null
      this.renderedStates = null
      this.flushRefresh()
    } else {
      this.adapter.clearNumbering()
      this.outlineController.clearOutlineNumbering()
    }
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
  }

  /** Toggle H1 numbering from outline toolbar — always document scope. */
  private toggleLevelOneFromToolbar(): void {
    const s = this.s
    s.showLevelOneNumber = !(s.showLevelOneNumber ?? false)
    const docKey = this.getDocumentKey()
    if (docKey) {
      this.saveHeadingNumberingScoped('document', docKey, { ...s })
    } else {
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
  }

  renumber(): void {
    const s = this.s
    if (!s.enabled) {
      s.enabled = true
      this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    }
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('标题已重新编号')
  }

  /** Toggle level-one heading numbering on/off. */
  toggleLevelOneNumber(): void {
    this.setShowLevelOneNumber(!(this.s.showLevelOneNumber ?? false))
  }

  /** Set whether level-one heading shows numbering. */
  setShowLevelOneNumber(enabled: boolean): void {
    if (this.s.showLevelOneNumber === enabled) return
    const s = this.s
    s.showLevelOneNumber = enabled
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    this.outlineToolbar.updateAllButtonStates()
    this.notifySettingsListeners()
    logger.info(`一级标题编号已${enabled ? '开启' : '关闭'}`)
  }

  /** Apply a preset and update numbering immediately. */
  applyPreset(preset: HeadingNumberingPreset): void {
    const s = this.s
    if (preset === 'custom') {
      s.preset = 'custom'
      if (s.customDefinition) {
        s.levels = { ...s.customDefinition }
      }
    } else {
      if (s.preset === 'custom') {
        s.customDefinition = { ...s.levels }
      }
      s.preset = preset
      s.levels = { ...getPresetLevels(preset) }
    }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info(`编号预设已切换为：${preset}`)
  }

  /** Update a single level's style. Automatically switches preset to 'custom'. */
  updateLevelStyle(level: HeadingLevel, patch: Partial<HeadingLevelStyle>): void {
    const s = this.s
    if (s.preset !== 'custom') {
      s.customDefinition = { ...s.levels }
      s.preset = 'custom'
      s.levels = { ...s.levels }
    }
    s.levels = { ...s.levels, [level]: { ...s.levels[level], ...patch } }
    s.customDefinition = { ...s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), s)
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active format variant for a level.
   * Automatically writes to withLevelOne or withoutLevelOne based on current H1 state.
   */
  updateActiveFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').NumberFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const updated = updateActiveFormatVariant(
      currentStyle,
      level,
      this.s.showLevelOneNumber,
      nextFormat,
    )

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active contextual format variant for a level (schemaVersion >= 8).
   */
  updateActiveContextualFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').ContextualFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      level,
      this.s.showLevelOneNumber,
      nextFormat,
    )

    // Sync multilevelFormatVariants from contextual for backward compat
    updated.multilevelFormatVariants = contextualToMultilevelVariants(updated.contextualFormatVariants)

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

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
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[lv]
    const active = currentStyle.contextualFormatVariants
    if (!active) return

    const showL1 = this.s.showLevelOneNumber
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

    this.s.levels = {
      ...this.s.levels,
      [lv]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update the active multilevel format variant for a level (two-layer model).
   */
  updateActiveMultilevelFormat(level: HeadingLevel, nextFormat: readonly import('./heading-types').MultilevelFormatSegment[]): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const updated = updateActiveMultilevelFormatVariant(
      currentStyle,
      level,
      this.s.showLevelOneNumber,
      nextFormat,
    )

    this.s.levels = {
      ...this.s.levels,
      [level]: updated,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /**
   * Update a level's number template (tokenStyle, prefix, suffix).
   */
  updateLevelTemplate(level: HeadingLevel, patch: Partial<import('./heading-types').HeadingLevelNumberTemplate>): void {
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
      this.s.levels = { ...this.s.levels }
    }

    const currentStyle = this.s.levels[level]
    const currentTemplate = currentStyle.levelTemplate
    const updatedTemplate = { ...currentTemplate, ...patch }
    // Also sync legacy tokenStyle for backward compat
    const updatedStyle = {
      ...currentStyle,
      levelTemplate: updatedTemplate,
      tokenStyle: patch.tokenStyle ?? currentStyle.tokenStyle,
    }

    this.s.levels = {
      ...this.s.levels,
      [level]: updatedStyle,
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })

    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset a single level to defaults. */
  resetLevelStyle(level: HeadingLevel): void {
    const defaults = getPresetLevels('custom')
    // Ensure we're in custom mode
    if (this.s.preset !== 'custom') {
      this.s.customDefinition = { ...this.s.levels }
      this.s.preset = 'custom'
    }
    const defaultStyle = defaults[level]
    this.s.levels = {
      ...this.s.levels,
      [level]: { ...defaultStyle },
    }
    this.s.customDefinition = { ...this.s.levels }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
  }

  /** Reset all custom levels to defaults. */
  resetAllCustomLevels(): void {
    const defaults = getPresetLevels('custom')
    this.s.preset = 'custom'
    this.s.levels = { ...defaults }
    this.s.customDefinition = { ...defaults }
    this.saveHeadingNumberingScoped(this.docContext.source, this.getDocumentKey(), { ...this.s })
    this.lastSnapshot = null
    this.renderedStates = null
    this.flushRefresh()
    logger.info('自定义设置已恢复为默认值')
  }

  /** Get the current numbering settings (for UI reading). */
  getCurrentSettings(): HeadingNumberingSettings {
    return { ...this.s }
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
    const snapshot = { ...this.s }
    for (const listener of this.settingsListeners) {
      try { listener(snapshot) } catch (e) { logger.error('设置变化监听器异常', e) }
    }
  }

  /** Generate a preview of the current preset/levels. */
  getPreview(): Record<HeadingLevel, string> {
    return getPresetPreview(this.s.preset)
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
    const docKey = this.getDocumentKey()
    const docPath = this.getActiveFilePath()
    return resolveEffectiveMaxLevel(rangeSettings, docKey ?? docPath)
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
      const store = this.scopeStore
      const docOverride = store.documentOverrides[docPath]
      return (docOverride?.settings as any)?._overrides as Record<string, import('./heading-types').HeadingNumberingOverride> | undefined
    } catch {
      return undefined
    }
  }

  /** Persist overrides to plugin settings. */
  persistOverrides(): void {
    if (!this.overrideStore) return
    const overrides = this.overrideStore.getAllOverrides()
    const docKey = this.getDocumentKey()
    if (!docKey) return
    // Save overrides within the document override settings
    const s = this.s
    ;(s as any)._overrides = overrides
    this.saveHeadingNumberingScoped(this.docContext.source, docKey, s)
  }

  /** Build override map for the numbering engine from the store. */
  private buildOverrideMap(headings: readonly import('./heading-types').HeadingDescriptor[]): import('./numbering-engine').HeadingOverrideMap | undefined {
    const store = this.getOverrideStore()
    if (!store) return undefined

    const map = new Map<string, 'numbered' | 'unnumbered'>()
    const nameSettings = this.getSpecialNumberingSettings().nameSettings
    const showL1 = this.s.showLevelOneNumber

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

  /** Run full DOM diagnostic dump (for manual command). */
  dumpOutlineDOM(): void {
    this.outlineController.dumpDOM()
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
    this.disposed = true
    this.cancelPending()
    this.disconnectObserver()
    this.unbindEditorRoot()
    this.adapter.clearNumbering()
    this.store.dispose()
    this.levelRangeEnforcer.dispose()
    this.outlineController.stop()
    this.outlineToolbar.stop()
    if (this.pasteListenerTimer !== null) { clearTimeout(this.pasteListenerTimer); this.pasteListenerTimer = null }
    if (this.fileOpenRetryTimer !== null) { clearTimeout(this.fileOpenRetryTimer); this.fileOpenRetryTimer = null }
  }

  // ── Settings sync ──────────────────────────────────────

  /** Listen for external settings changes (e.g. from settings UI) and sync local state. */
  private registerSettingsListener(): void {
    const dispose = this.ctx.settings.onChange('headingNumbering', (_key: unknown, value: HeadingNumberingSettings) => {
      // Legacy listener: migrate and reload from scope store
      if (!this.scopeStore.schemaVersion) {
        const migResult = migrateHeadingNumberingToScopeStore({ headingNumbering: value })
        if (migResult.migrated) {
          this.persistScopeStore(migResult.store)
        }
      }
      this.loadDocumentContext()
      this.lastSnapshot = null
      this.renderedStates = null
      this.outlineToolbar.updateAllButtonStates()
      this.flushRefresh()
      this.notifySettingsListeners()
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
    const expectedVersion = this.renderVersion
    const expectedDocKey = this.getDocumentKey()
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null
      // Guard: skip if version or document changed since scheduling
      if (expectedVersion !== this.renderVersion) return
      if (expectedDocKey !== this.getDocumentKey()) return
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

      // Apply heading layouts (always, independent of numbering state)
      this.applyHeadingLayouts()

      // Apply paragraph indent styles (always)
      this.refreshParagraphIndents()

      // Numbering: skip if disabled
      if (!this.s.enabled) return

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
        showLevelOneNumber: this.s.showLevelOneNumber,
        preset: this.s.preset,
        maxDepth: this.s.maxDepth,
        levels: Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map(lv => [
            lv,
            {
              enabled: this.s.levels[lv as HeadingLevel]?.enabled ?? false,
              cVarWith: this.s.levels[lv as HeadingLevel]?.contextualFormatVariants?.withLevelOne?.length ?? 0,
              cVarWithout: this.s.levels[lv as HeadingLevel]?.contextualFormatVariants?.withoutLevelOne?.length ?? 0,
            },
          ]),
        ),
      })

      // Apply effective max level from level range settings
      const effectiveMax = this.getEffectiveMaxLevel()
      this.s.maxDepth = effectiveMax

      // Build override map from store
      const overrideMap = this.buildOverrideMap(headings)

      // Get counter policy
      const specialSettings = this.getSpecialNumberingSettings()
      const counterPolicy = specialSettings.unnumberedCounterPolicy

      const numbered = computeHeadingNumbering(headings, this.s, overrideMap, counterPolicy)
      const labels = decimalHierarchicalFormatter.format(numbered, this.s)

      // Snapshot numbering engine per-heading output
      const engineEntries: NumberingEngineEntry[] = numbered.map((h, i) => {
        const style = this.s.levels[h.level as HeadingLevel]
        const enabledLvls = [1, 2, 3, 4, 5, 6].filter(
          lv => lv === 1 ? this.s.showLevelOneNumber : (this.s.levels[lv as HeadingLevel]?.enabled ?? false),
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
          selectedVariant: h.level === 1 ? 'withLevelOne' : (!this.s.showLevelOneNumber ? 'withoutLevelOne' : 'withLevelOne'),
          variantSegmentCount: 0,
          generatedLabel: h.label,
          textPreview: h.text.slice(0, 40),
        }
      })
      snapshotNumberingEngine(this.s, engineEntries)

      const diff = this.adapter.applyNumberingDiff(labels)
      this.renderedStates = this.adapter.buildRenderedStates(labels)

      // Apply per-heading label gaps (number-to-title spacing)
      const gaps = extractLabelGaps(numbered)
      this.adapter.applyLabelGaps(gaps)

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
      this.outlineController.syncAfterRefresh(headings, labels, gaps)

      // Output H2 diagnostic in dev mode (first load only)
      if (reason === 'initial-load' || reason === 'file-open') {
        try { diagnoseHeadingChain(headings, this.s) } catch { /* silent */ }
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

  // ── Heading layout ─────────────────────────────────────

  /** Apply heading layout to the editor (independent of numbering state). */
  private applyHeadingLayouts(): void {
    const layouts = this.getEffectiveHeadingLayouts()
    if (layouts) {
      this.adapter.applyHeadingLayouts(layouts)
    } else {
      this.adapter.clearHeadingLayouts()
    }
  }

  /** Apply paragraph indent styles to the editor DOM. */
  private refreshParagraphIndents(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return
    const settings = this.getParagraphLayoutSettings()
    refreshParagraphIndentStyles(root, settings)
  }

  /** Get the effective heading layouts for the current document. */
  getEffectiveHeadingLayouts(): import('./heading-types').HeadingLayoutSettings | undefined {
    const settings = this.docContext.effectiveSettings
    return settings.headingLayouts
  }

  /**
   * Save heading layout for the specified scope and level.
   * Automatically clears firstLineIndentEm when textAlign is center or right.
   * Saves to document-level layoutOverrides, preserving formatSource identity.
   */
  setHeadingLayout(
    level: import('./heading-types').HeadingLevel,
    config: import('./heading-types').HeadingLayoutConfig,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const currentLayouts = existingLo?.headingLayouts ? { ...existingLo.headingLayouts } : {}
    const currentGap = existingLo?.numberTitleSpacing ? { ...existingLo.numberTitleSpacing } : {}

    // Auto-clear indent when center or right
    const effectiveConfig = config.textAlign !== 'left'
      ? { ...config, firstLineIndentEm: 0 }
      : { ...config }

    const levelKey = `h${level}`
    currentLayouts[levelKey] = effectiveConfig

    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayouts: currentLayouts,
      numberTitleSpacing: currentGap,
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)

    // Immediately apply the effective layouts
    const effectiveLayouts = this.getEffectiveHeadingLayouts()
    if (effectiveLayouts) {
      this.adapter.applyHeadingLayouts(effectiveLayouts)
    }
  }

  /** Copy layout from one level to all subsequent levels. */
  applyLayoutToSubsequentLevels(
    fromLevel: import('./heading-types').HeadingLevel,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const currentLayouts = existingLo?.headingLayouts ? { ...existingLo.headingLayouts } : {}
    const currentGap = existingLo?.numberTitleSpacing ? { ...existingLo.numberTitleSpacing } : {}
    const fromKey = `h${fromLevel}`
    const source = currentLayouts[fromKey] ?? { textAlign: 'left' as const, firstLineIndentEm: 0 }

    for (const lv of [fromLevel + 1, fromLevel + 2, fromLevel + 3, fromLevel + 4, fromLevel + 5, fromLevel + 6] as import('./heading-types').HeadingLevel[]) {
      if (lv > 6) break
      const key = `h${lv}`
      currentLayouts[key] = { ...source }
    }

    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayouts: currentLayouts,
      numberTitleSpacing: currentGap,
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)

    const effectiveLayouts = this.getEffectiveHeadingLayouts()
    if (effectiveLayouts) {
      this.adapter.applyHeadingLayouts(effectiveLayouts)
    }
  }

  /** Reset all heading layouts to defaults (clear document layout overrides). */
  resetAllHeadingLayouts(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, undefined)
    this.persistScopeStore(newStore)

    // Immediately clear layouts from DOM
    this.adapter.clearHeadingLayouts()
  }

  /**
   * Reset layout overrides for the current document, restoring template defaults.
   * Does NOT affect formatSource — the format remains "applied".
   */
  resetLayoutOverrides(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, undefined)
    this.persistScopeStore(newStore)

    // Reload context so effective settings reflect cleared overrides
    this.docContext = resolveEffectiveSettings(this.scopeStore, docKey)
    this.docContext.settingsRevision = this.settingsRevision
    this.adapter.clearHeadingLayouts()
  }

  /**
   * Save number-title spacing overrides to layoutOverrides.
   * Preserves existing headingLayouts and formatSource.
   */
  saveNumberTitleSpacingToLayout(
    gaps: Partial<Record<import('./heading-types').HeadingLevel, import('./heading-types').NumberTitleSpacing>>,
  ): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const store = this.scopeStore
    const existingLo = store.documentOverrides[docKey]?.layoutOverrides
    const layoutOverrides: import('./heading-types').DocumentLayoutOverrides = {
      headingLayouts: existingLo?.headingLayouts ? { ...existingLo.headingLayouts } : undefined,
      numberTitleSpacing: { ...gaps },
    }

    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)
  }

  /**
   * Save complete layout overrides from the settings tab draft.
   * Persists to layoutOverrides and applies to DOM.
   * Preserves formatSource, formatId/presetId, and version.
   */
  saveLayoutOverridesFromDraft(
    docKey: string,
    layoutOverrides: import('./heading-types').DocumentLayoutOverrides,
  ): void {
    const newStore = saveLayoutOverrides(this.scopeStore, docKey, layoutOverrides)
    this.persistScopeStore(newStore)
    this.settingsRevision++

    // Reload document context so effective settings reflect new layout overrides
    const currentKey = this.getDocumentKey()
    if (currentKey === docKey) {
      this.docContext = resolveEffectiveSettings(this.scopeStore, currentKey)
      this.docContext.settingsRevision = this.settingsRevision
      // Apply layouts to DOM immediately
      const effectiveLayouts = this.getEffectiveHeadingLayouts()
      if (effectiveLayouts) {
        this.adapter.applyHeadingLayouts(effectiveLayouts)
      }
    }
  }

  private defaultLayouts(): import('./heading-types').HeadingLayoutSettings {
    const def: import('./heading-types').HeadingLayoutConfig = {
      textAlign: 'left',
      firstLineIndentEm: 0,
    }
    return { h1: { ...def }, h2: { ...def }, h3: { ...def }, h4: { ...def }, h5: { ...def }, h6: { ...def } }
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
      if (this.pasteListenerTimer !== null) clearTimeout(this.pasteListenerTimer)
      // Delay to let Typora process the paste first
      this.pasteListenerTimer = setTimeout(() => {
        this.pasteListenerTimer = null
        if (this.disposed) return
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

  /** Handle paragraph indent shortcut: .. / 。。 + Enter → force-indent-2 paragraph. */
  private handleParagraphIndentShortcut(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return

    // Guard: must not be in composition (IME)
    if (this.isInComposition) return

    // Guard: shortcut must be enabled
    const settings = this.getParagraphLayoutSettings()
    if (!settings.indentShortcutEnabled) return

    // Guard: must be in a valid context (not in code, math, list, quote, table, footnote)
    if (!isCursorAtEnd()) return

    const paragraph = getCurrentParagraphElement()
    if (!paragraph) return
    if (isInExcludedContext(paragraph)) return

    // Guard: content must be exactly ".." or "。。"
    const text = paragraph.textContent?.trim() ?? ''
    if (text !== '..' && text !== '。。') {

      return
    }

    e.preventDefault()
    e.stopPropagation()

    // Get Markdown source and inject the indent marker
    const md = this.ctx.getMarkdown?.() ?? ''
    const newMd = injectShortcutMarkerInMarkdown(md)
    if (!newMd) return

    // Reload content with the marker injected
    this.ctx.reloadContent?.(newMd)

    // After reload, find and focus the new paragraph
    // Use microtask to ensure DOM is updated
    queueMicrotask(() => {
      const root = this.adapter.detectEditorRoot()
      if (root) {
        focusNewIndentParagraph(root)
      }
      this.requestRefresh('editor-input')
    })
  }

  // ── Editor binding ─────────────────────────────────────

  private initAdapter(): void {
    const area = this.adapter.detectEditorRoot()
    if (area) this.adapter.setEditorRoot(area)
  }

  private bindEditorRoot(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return

    // Guard: skip if already bound to the same root element
    if (this.boundEditorRoot === root) return

    // Dispose old editor-specific listeners before binding to new root
    if (this.editorRootDisposables) {
      this.editorRootDisposables.dispose()
    }
    this.editorRootDisposables = new DisposableStore()
    this.boundEditorRoot = root

    // input
    const onInput = (): void => {
      if (!this.isInComposition) this.requestRefresh('editor-input')
    }
    root.addEventListener('input', onInput, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('input', onInput))

    // composition
    const onCompositionEnd = (): void => {
      this.isInComposition = false
      this.requestRefresh('composition-end')
    }
    root.addEventListener('compositionend', onCompositionEnd)
    this.editorRootDisposables.add(() => root.removeEventListener('compositionend', onCompositionEnd))

    const onCompositionStart = (): void => { this.isInComposition = true }
    root.addEventListener('compositionstart', onCompositionStart)
    this.editorRootDisposables.add(() => root.removeEventListener('compositionstart', onCompositionStart))

    // focusin
    const onFocusIn = (): void => {
      this.requestRefresh('focus-in')
      this.scheduleTail('decoration-repair', FOCUS_TAIL_MS)
    }
    root.addEventListener('focusin', onFocusIn)
    this.editorRootDisposables.add(() => root.removeEventListener('focusin', onFocusIn))

    // click
    const onClick = (): void => {
      this.requestRefresh('editor-click')
    }
    root.addEventListener('click', onClick, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('click', onClick))

    // keyup
    const onKeyUp = (): void => {
      this.requestRefresh('editor-keyup')
    }
    root.addEventListener('keyup', onKeyUp, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('keyup', onKeyUp))

    // Paragraph indent shortcut: .. / 。。 + Enter → force-indent-2
    const onEnterKey = (e: KeyboardEvent): void => {
      this.handleParagraphIndentShortcut(e)
    }
    root.addEventListener('keydown', onEnterKey, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onEnterKey, true))
  }

  /** Detach editor root listeners (called on root change). */
  private unbindEditorRoot(): void {
    if (this.editorRootDisposables) {
      this.editorRootDisposables.dispose()
      this.editorRootDisposables = null
    }
    this.boundEditorRoot = null
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
        this.loadDocumentContext()
        const docKey = this.getDocumentKey()
        recordRuntimeAudit('editor:load', { documentKey: docKey ?? 'none', settingsSource: this.docContext.source })
        if (editorEl instanceof HTMLElement) {
          this.adapter.setEditorRoot(editorEl)
          this.lastSnapshot = null
          this.renderedStates = null
          this.connectObserver(editorEl)
          this.bindEditorRoot()
          this.outlineController.setDocumentKey(docKey ?? '')
          this.outlineToolbar.reinitialize()
          this.outlineToolbar.setDocumentKey(docKey ?? '')
          queueMicrotask(() => this.requestRefresh('initial-load'))
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        }
      }),
    )

    // Framework edit (fallback)
    this.store.add(
      ctx.onEditorEvent('edit', () => this.requestRefresh('framework-edit')),
    )

    // File open — load document context, bump version, reinit outline
    this.store.add(
      ctx.onWorkspaceEvent('file:open', () => {
        const version = ++this.renderVersion
        this.loadDocumentContext()
        const newDocKey = this.getDocumentKey()
        recordRuntimeAudit('file:open:received', {
          documentKey: newDocKey ?? 'none',
          settingsSource: this.docContext.source,
          renderVersion: version,
        })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.bumpRenderVersion()
        this.outlineController.reinitialize()
        this.outlineToolbar.reinitialize()
        this.outlineToolbar.setDocumentKey(newDocKey ?? '')
        this.overrideStore = null // Invalidate override store for new doc
        queueMicrotask(() => {
          if (version !== this.renderVersion) { return }
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('file-open')
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        })
        if (this.fileOpenRetryTimer !== null) clearTimeout(this.fileOpenRetryTimer)
        this.fileOpenRetryTimer = setTimeout(() => {
          this.fileOpenRetryTimer = null
          if (this.disposed) return
          if (version !== this.renderVersion) return
          const area = this.adapter.detectEditorRoot()
          if (area && (!this.lastSnapshot || this.lastSnapshot.length === 0)) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
            this.requestRefresh('file-open')
          }
        }, 100)
      }),
    )

    // Active leaf change — load document context, bump version, reinit outline, rebind observer + editor root
    this.store.add(
      ctx.onWorkspaceEvent('active-leaf:change', () => {
        const version = ++this.renderVersion
        this.loadDocumentContext()
        const newDocKey = this.getDocumentKey()
        recordRuntimeAudit('active-leaf:change', {
          documentKey: newDocKey ?? 'none',
          settingsSource: this.docContext.source,
          renderVersion: version,
        })
        this.lastSnapshot = null
        this.renderedStates = null
        this.outlineController.bumpRenderVersion()
        this.outlineController.reinitialize()
        this.outlineToolbar.reinitialize()
        this.outlineToolbar.setDocumentKey(newDocKey ?? '')
        this.overrideStore = null
        queueMicrotask(() => {
          if (version !== this.renderVersion) { return }
          const area = this.adapter.detectEditorRoot()
          if (area) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
          }
          this.requestRefresh('active-leaf-change')
          this.scheduleTail('decoration-repair', TAIL_REFRESH_MS)
        })
        setTimeout(() => {
          if (version !== this.renderVersion) return
          const area = this.adapter.detectEditorRoot()
          if (area && (!this.lastSnapshot || this.lastSnapshot.length === 0)) {
            this.adapter.setEditorRoot(area)
            this.connectObserver(area)
            this.bindEditorRoot()
            this.requestRefresh('active-leaf-change')
          }
        }, 100)
      }),
    )

    ctx.registerDisposable(() => this.dispose())
  }
}
