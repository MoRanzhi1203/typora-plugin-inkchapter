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
import { resolveHeadingStructure, resolveStyleSlot } from './heading-structure'
import type { HeadingStructureMode } from './heading-structure'
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
  refreshParagraphIndentStyles,
  applyParagraphIndent,
  getCurrentParagraphElement,
  isInExcludedContext,
  canTriggerIndentShortcut,
  isCursorAtEnd,
  setParagraphIndentMode,
  getParagraphIndentMode,
  probeInlineParagraphCommand,
  writeBlockProbeDiagnostic,
  classifyEditorMutation,
  resolveCurrentBlockFromSelection,
  resolvePreviousBlock,
  isContentBlock,
  isCaretAtLogicalStartOfParagraph,
  resolveCurrentBodyParagraph,
  shouldConsumeBackspaceForIndentRemoval,
  resolveParagraphShortcutCandidate,
  applyEffectiveParagraphIndent,
  resolveEffectiveParagraphIndent,
  isAfterDisplayMath,
  getUserVisibleParagraphText,
  readParagraphIndentCommand,
  isCaretAtTokenEnd,
  isIndentShortcutEditingToken,
  type InlineCommandResult,
  type BackspaceIndentCommandContext,
} from './paragraph-indent-manager'
import {
  loadParagraphLayout,
  saveParagraphLayout,
  createParagraphAnchor,
  resolveParagraphAnchor,
  updateParagraphAnchor,
  collectContentParagraphs,
  migrateLegacyIndentMarkers,
  type ParagraphIndentOverrideRecord,
} from './paragraph-layout-store'
import {
  activateNormalEnterTrace,
  deactivateNormalEnterTrace,
  getTraceState,
  safeTrace,
  traceT1_AfterNormalEnter,
  traceT2_MutationRecords,
  traceT3_Classifier,
  traceT4_RequestRefresh,
  traceT5_DoRefresh,
  traceT6_Rehydrate,
  traceT7_RefreshStyles,
  traceT8_FinalState,
  identifyElement,
  identifyNode,
  summarizeElement,
  summarizeSelection,
  getComputedIndent,
  type T0Data,
  type T2Record,
  type T6Data,
} from './normal-enter-trace'
import {
  activateForensic,
  deactivateForensic,
  isForensicActive,
  safeForensic,
  captureParagraphState,
  captureParentChain,
  captureSelectionState,
  captureMatchedCSSRules,
  writeForensicEntry,
  FORENSIC_BUILD_MARKER,
} from './paragraph-indent-forensic'
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

// ── Enter Indent Transaction ───────────────────────────────

interface EnterIndentTransaction {
  id: string
  startedAt: number
  paragraph: HTMLElement
  token: '..' | '。。'
  paragraphCountBefore: number
  state: 'created' | 'token-consumed' | 'semantic-written' | 'visual-applied' | 'caret-restored' | 'committed' | 'closed'
  suppressNativeInsertParagraph: boolean
  semanticWritten: boolean
  sidecarWritten: boolean
  tokenConsumed: boolean
  traceData: Record<string, unknown>
}

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
  /** Optional: replace editor content preserving undo history (for shortcut commands). */
  reloadContentPreservingUndo?: (markdown: string) => void
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
  private pendingReasons = new Set<RefreshReason>()

  // State
  private lastSnapshot: HeadingSnapshot[] | null = null
  private renderedStates: RenderedHeadingState[] | null = null
  private renderedGaps: string[] | null = null
  private isInComposition = false
  private mutationObserver: MutationObserver | null = null

  // Paragraph command mutation: epoch counter for dedupe
  private paragraphMutationEpoch = 0
  /** Suppress paragraph command detection during plugin-authored reloads. */
  private suppressParagraphCommandDetection = false

  // ── Enter Indent Transaction — single owner, single transaction per Enter ──
  private activeEnterTransaction: EnterIndentTransaction | null = null
  private enterTxnSeq = 0

  // ── In-memory Override Registry ──────────────────────
  // Mirrors sidecar records but updates immediately (no debounce for reads).
  // Source of truth for rehydration; sidecar is the persistent copy.
  private inMemoryOverrides = new Map<string, ParagraphIndentOverrideRecord[]>()

  // ── Normal Enter Trace (P0 diagnostic, dev only) ────
  // Stores T0 snapshot from the PREVIOUS doRefresh for cross-event comparison.
  private lastTraceSnapshot: T0Data | null = null
  private traceDoRefreshCount = 0

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
      isShowLevelOne: () => {
        const structure = resolveHeadingStructure(this.s)
        return structure.showLevelOneNumber
      },
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

  // ── Format version sync ──────────────────────────

  /** Sync the applied format version in the document override to match the library version. */
  syncDocumentFormatVersion(docKey: string, formatId: string, newVersion: number): void {
    const override = this.scopeStore.documentOverrides[docKey]
    const docSource = override?.formatSource
    if (!docSource || docSource.type !== 'custom' || docSource.formatId !== formatId) return

    this.scopeStore = {
      ...this.scopeStore,
      documentOverrides: {
        ...this.scopeStore.documentOverrides,
        [docKey]: {
          ...override,
          updatedAt: Date.now(),
          formatSource: {
            type: 'custom' as const,
            formatId: docSource.formatId,
            version: newVersion,
          },
        },
      },
    }
    this.persistScopeStore(this.scopeStore)
  }

  /** Sync the global default applied format version to match the library version. */
  syncGlobalDefaultFormatVersion(formatId: string, newVersion: number): void {
    const gSource = (this.scopeStore.globalDefault as any).formatSource as import('./heading-types').NumberingFormatSource | undefined
    if (!gSource || gSource.type !== 'custom' || gSource.formatId !== formatId) return

    this.scopeStore = {
      ...this.scopeStore,
      globalDefault: {
        ...this.scopeStore.globalDefault,
        formatSource: {
          type: 'custom' as const,
          formatId: gSource.formatId,
          version: newVersion,
        },
      } as any,
    }
    this.persistScopeStore(this.scopeStore)
  }

  // ── Paragraph layout ─────────────────────────────

  /** Get the effective paragraph layout settings for the current document. */
  getParagraphLayoutSettings(): import('./heading-types').ParagraphLayoutSettings {
    // Hard defaults — ensure indentShortcutEnabled is never undefined.
    // undefined globalParagraphLayout in persisted stores must not resolve to false.
    const defaults: import('./heading-types').ParagraphLayoutSettings = {
      defaultIndent: 'flush',
      flushAfterDisplayMath: true,
      indentShortcutEnabled: true,
    }
    const docKey = this.getDocumentKey()
    if (docKey) {
      const override = this.scopeStore.documentOverrides[docKey]
      if (override?.paragraphLayout) {
        // Document explicit override merges with defaults
        return { ...defaults, ...override.paragraphLayout }
      }
    }
    // Global merges with defaults — handles undefined globalParagraphLayout
    return { ...defaults, ...this.scopeStore.globalParagraphLayout }
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
    // Preserve the current scope's structure mode — format must not change it
    const currentMode = this.resolveScopeStructureMode(scope, documentKey)

    const snapshot: HeadingNumberingSettings = {
      enabled: format.settings.enabled,
      headingStructureMode: currentMode,
      showLevelOneNumber: currentMode === 'loose',
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
    // Preserve the current scope's structure mode — preset must not change it
    const currentMode = this.resolveScopeStructureMode(scope, documentKey)

    const levels = getPresetLevels(presetId as HeadingNumberingPreset)
    const snapshot: HeadingNumberingSettings = {
      enabled: true,
      headingStructureMode: currentMode,
      showLevelOneNumber: currentMode === 'loose',
      preset: presetId as HeadingNumberingPreset,
      maxDepth: 6,
      levels,
      customDefinition: levels,
    }
    const formatSource: NumberingFormatSource = { type: 'built-in', presetId }
    this.saveHeadingNumberingScoped(scope, documentKey, snapshot, formatSource)
  }

  /** Resolve the effective structure mode for a given scope. */
  private resolveScopeStructureMode(
    scope: HeadingSettingsScope,
    documentKey: string | null,
  ): import('./heading-structure').HeadingStructureMode {
    if (scope === 'document' && documentKey) {
      const override = this.scopeStore.documentOverrides[documentKey]
      if (override?.settings.headingStructureMode) {
        return override.settings.headingStructureMode
      }
    }
    return this.scopeStore.globalDefault.headingStructureMode ?? 'strict'
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

  /** Toggle heading structure mode from outline toolbar — always document scope. */
  private toggleLevelOneFromToolbar(): void {
    const s = this.s
    const currentMode = s.headingStructureMode ?? (s.showLevelOneNumber ? 'loose' : 'strict')
    const newMode: import('./heading-structure').HeadingStructureMode = currentMode === 'strict' ? 'loose' : 'strict'
    s.headingStructureMode = newMode
    s.showLevelOneNumber = newMode === 'loose'
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

  /** Set whether level-one heading shows numbering. @deprecated Use setHeadingStructureMode instead. */
  setShowLevelOneNumber(enabled: boolean): void {
    if (this.s.showLevelOneNumber === enabled) return
    const s = this.s
    s.headingStructureMode = enabled ? 'loose' : 'strict'
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
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveFormatVariant(
      currentStyle,
      level,
      showL1,
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
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveContextualFormatVariant(
      currentStyle,
      level,
      showL1,
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

    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
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
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber
    const updated = updateActiveMultilevelFormatVariant(
      currentStyle,
      level,
      showL1,
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
    const showL1 = resolveHeadingStructure(this.s).showLevelOneNumber

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

  /** Priority order for refresh reasons (higher = more important). */
  private static readonly REASON_PRIORITY: Record<string, number> = {
    'paragraph-command-mutation': 10,
    'editor-mutation': 8,
    'editor-input': 6,
    'composition-end': 5,
    'framework-edit': 5,
    'editor-keyup': 3,
    'editor-click': 3,
    'focus-in': 2,
    'decoration-repair': 1,
    'tail-refresh': 1,
  }

  private requestRefresh(reason: RefreshReason): void {
    this.pendingReasons.add(reason)

    // Dedupe: if already scheduled, just accumulate — don't schedule another RAF
    if (this.rafId !== null) return

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null

      // Snapshot and clear pending reasons
      const reasons = new Set(this.pendingReasons)
      this.pendingReasons.clear()

      this.doRefreshWithReasons(reasons)
    })
  }

  /** Compute primary reason and paragraph command flag, then call doRefresh. */
  private doRefreshWithReasons(reasons: Set<RefreshReason>): void {
    if (reasons.size === 0) return

    const hasParagraphCommandMutation = reasons.has('paragraph-command-mutation')

    // Compute primary reason with priority
    let primaryReason: RefreshReason = 'editor-input'
    let maxPriority = -1
    for (const r of reasons) {
      const p = HeadingNumberingService.REASON_PRIORITY[r] ?? 0
      if (p > maxPriority) {
        maxPriority = p
        primaryReason = r
      }
    }

    // ── Trace: T4 RequestRefresh (fail-open) ──
    safeTrace(() => {
      traceT4_RequestRefresh({
        reasonsBeforeAdd: Array.from(reasons).filter(r => r !== primaryReason),
        reasonAdded: primaryReason,
        reasonsAfterAdd: Array.from(reasons),
        rafAlreadyPending: false, // RAF callback is executing now
        primaryReason,
        hasParagraphMutation: hasParagraphCommandMutation,
      })
    })

    this.doRefresh(primaryReason, { hasParagraphCommandMutation })
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

  private doRefresh(reason: RefreshReason, flags?: { hasParagraphCommandMutation?: boolean }): void {
    const startTime = performance.now()
    const hasParagraphCommand = flags?.hasParagraphCommandMutation ?? false

    recordRuntimeAudit('doRefresh:start', {
      documentKey: this.getDocKey(),
      renderVersion: this.renderVersion,
      refreshReason: reason,
      hasParagraphCommand,
    })

    try {
      const root = this.adapter.detectEditorRoot()
      if (!root) return
      this.adapter.setEditorRoot(root)

      // ── Trace: T5 doRefresh (fail-open) ──
      this.traceDoRefreshCount++
      safeTrace(() => {
        traceT5_DoRefresh({
          doRefreshCount: this.traceDoRefreshCount,
          primaryReason: reason,
          allPendingReasons: hasParagraphCommand ? [reason, 'paragraph-command-mutation'] : [reason],
          editorRootDetected: true,
          documentKey: this.getDocumentKey(),
          willCallRehydrate: true,
          willCallRefreshStyles: true,
        })
      })

      // Apply heading layouts (always, independent of numbering state)
      this.applyHeadingLayouts()

      // ── Rehydrate explicit paragraph overrides before layout refresh ──
      // Normal Enter / paragraph split destroys HTMLElement identity.
      // Rehydrate force-indent from in-memory registry BEFORE refreshParagraphIndentStyles
      // so explicit overrides survive DOM rebuild.
      this.rehydrateParagraphIndentOverrides(root)

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
            // Also check gaps — Typora may strip data-inkchapter-heading-gap on Enter
            if (this.renderedGaps && !this.adapter.areGapsValid(this.renderedGaps)) {
              this.adapter.applyLabelGaps(this.renderedGaps)
            }
            this.lastSnapshot = snapshot
            return // Everything is fine, skip
          }
          // Structure same but decoration lost → repair only (node replaced)
          const diff = this.adapter.repairDecoration(this.renderedStates)
          this.renderedStates = this.adapter.buildRenderedStates(
            this.renderedStates.map(s => s.label),
          )
          // Also re-apply gaps after repair
          if (this.renderedGaps) {
            this.adapter.applyLabelGaps(this.renderedGaps)
          }
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
        this.renderedGaps = null
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
      this.renderedGaps = [...gaps]

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

      // ── Trace: save T0 snapshot for next cycle + record T8 ──
      this.captureTraceEndOfDoRefresh(root)
    } catch (e) {
      logger.error('标题编号刷新失败', e)
      recordRuntimeAudit('doRefresh:error', { details: { error: String(e) } })
    }
  }

  // ── Heading layout ─────────────────────────────────────

  /** Apply heading layout to the editor (independent of numbering state). */
  private applyHeadingLayouts(): void {
    const layouts = this.getEffectiveHeadingLayouts()
    if (!layouts) {
      this.adapter.clearHeadingLayouts()
      return
    }
    // Apply slot-mapped layouts for the current mode
    const structure = resolveHeadingStructure(this.s)
    const effectiveLayouts = buildEffectiveLayouts(layouts, structure.mode)
    this.adapter.applyHeadingLayouts(effectiveLayouts)
  }

  /** Apply paragraph indent styles to the editor DOM. */
  private refreshParagraphIndents(): void {
    const root = this.adapter.getEditorRoot()
    if (!root) return
    const settings = this.getParagraphLayoutSettings()

    // ── Trace: T7 before ──
    let t7Target: HTMLElement | null = null
    let t7BeforeClass: string | null = null
    let t7BeforeData: string | null = null
    safeTrace(() => {
      const contentParas = root.querySelectorAll<HTMLParagraphElement>('p')
      for (const p of contentParas) {
        if (p.classList.contains('inkchapter-paragraph-effective-indent-2')) {
          t7Target = p
          break
        }
      }
      if (t7Target) {
        t7BeforeClass = t7Target.className ? String(t7Target.className) : null
        t7BeforeData = t7Target.getAttribute('data-inkchapter-indent-mode')
      }
    })

    // Business: always execute (never inside trace wrapper)
    refreshParagraphIndentStyles(root, settings, this.isInComposition)

    // ── Trace: T7 after ──
    safeTrace(() => {
      if (!t7Target) return
      const afterClass = t7Target.className ? String(t7Target.className) : null
      const afterData = t7Target.getAttribute('data-inkchapter-indent-mode')
      traceT7_RefreshStyles({
        targetElement: summarizeElement(t7Target),
        beforeClass: t7BeforeClass,
        beforeDataMode: t7BeforeData,
        afterClass,
        afterDataMode: afterData,
        didRendererClear: (t7BeforeClass?.includes('inkchapter-paragraph-effective-indent-2') ?? false) && !(afterClass?.includes('inkchapter-paragraph-effective-indent-2') ?? false),
      })
    })
  }

  /**
   * SOLE COMMIT OWNER: keydown Enter capture starts the transaction.
   *
   * Only keydown can identify token, create transaction, consume token,
   * write semantic/sidecar, project visual, and restore caret.
   * beforeinput(insertParagraph) must NOT commit — only suppress native split.
   */
  private tryStartEnterIndentTransaction(event: KeyboardEvent, root: HTMLElement): void {
    if (event.key !== 'Enter') return
    if (this.isInComposition || event.isComposing) return

    const settings = this.getParagraphLayoutSettings()
    if (!settings.indentShortcutEnabled) return

    if (this.activeEnterTransaction) return // one transaction at a time

    const sel = window.getSelection()
    if (!sel?.rangeCount || !sel.isCollapsed) return

    const paragraph = resolveCurrentBodyParagraph(root)
    if (!paragraph) return

    const token = readParagraphIndentCommand(paragraph)
    if (!token) return
    if (!isCaretAtTokenEnd(paragraph, 2)) return

    // ── Create transaction, lock paragraph ──
    const txnId = 'txn-' + (++this.enterTxnSeq) + '-' + Date.now()
    const txn: EnterIndentTransaction = {
      id: txnId,
      startedAt: performance.now(),
      paragraph,
      token,
      paragraphCountBefore: root ? collectContentParagraphs(root).length : -1,
      state: 'created',
      suppressNativeInsertParagraph: false,
      semanticWritten: false,
      sidecarWritten: false,
      tokenConsumed: false,
      traceData: { txnId, event: 'keydown', key: 'Enter', token, paraCountBefore: root ? collectContentParagraphs(root).length : -1, beforeinput_suppressed: false },
    }
    this.activeEnterTransaction = txn

    // ── Sync commit ──
    this.commitEnterIndentTransactionSync(txn, event)
  }

  /** Synchronous atomic commit — all steps in one call stack. */
  private commitEnterIndentTransactionSync(txn: EnterIndentTransaction, event: Event): void {
    const para = txn.paragraph
    const root = this.adapter.getEditorRoot()
    txn.traceData['T0_paraCountBefore'] = txn.paragraphCountBefore
    txn.traceData['T0_paraTag'] = para.tagName

    // consume Enter
    event.preventDefault()
    event.stopPropagation()
    txn.traceData['preventDefault'] = true
    txn.state = 'token-consumed'

    // consume token
    this.clearParagraphToken(para, txn.token)
    txn.tokenConsumed = true
    txn.traceData['tokenConsumed'] = true
    txn.traceData['DOMtextAfter'] = getUserVisibleParagraphText(para)

    // semantic FORCE_INDENT
    setParagraphIndentMode(para, 'force-indent')
    txn.semanticWritten = true
    txn.state = 'semantic-written'

    // sidecar exactly once
    this.applyParagraphIndentOverrideToSidecar(para, 'force-indent')
    txn.sidecarWritten = true
    txn.traceData['sidecarWriteCount'] = 1

    // visual projection
    const settings = this.getParagraphLayoutSettings()
    const structural = { isFormulaContinuation: settings.flushAfterDisplayMath ? isAfterDisplayMath(para) : false }
    const effective = resolveEffectiveParagraphIndent('force-indent', settings.defaultIndent, structural)
    applyEffectiveParagraphIndent(para, effective)
    txn.state = 'visual-applied'
    txn.traceData['computedIndent'] = window.getComputedStyle(para).textIndent

    // caret restore
    this.placeCaretInParagraph(para)
    txn.state = 'caret-restored'

    // mark committed, suppress native insertParagraph going forward
    txn.state = 'committed'
    txn.suppressNativeInsertParagraph = true
    txn.traceData['stopReason'] = 'commit completed'
    txn.traceData['T0'] = 'commit sync end'

    console.info(`[InkChapter] ${txn.id} committed: token=${txn.token} state=${txn.state}`)

    // Schedule T0-T4 stability snapshots + close
    this.scheduleTransactionStabilitySnapshots(txn)
  }

  /** T0-T4 stability verification, then close transaction. */
  private scheduleTransactionStabilitySnapshots(txn: EnterIndentTransaction): void {
    const snap = (label: string) => {
      if (txn.state === 'closed') return
      const para = txn.paragraph
      const root = this.adapter.getEditorRoot()
      const data: Record<string, unknown> = {
        txnId: txn.id, label,
        paraCount: root ? collectContentParagraphs(root).length : -1,
        DOMtext: getUserVisibleParagraphText(para),
        semantic: getParagraphIndentMode(para),
        computedIndent: window.getComputedStyle(para).textIndent,
        caretInPara: window.getSelection()?.rangeCount ? para.contains(window.getSelection()!.getRangeAt(0).startContainer) : false,
        txnState: txn.state,
      }
      data['tokenGone'] = data['DOMtext'] === ''
      data['sameParagraphCount'] = data['paraCount'] === txn.paragraphCountBefore
      txn.traceData[label] = data
      console.info(`[InkChapter] ${txn.id} ${label}: tokenGone=${data['tokenGone']} countMatch=${data['sameParagraphCount']}`)
    }

    // T0 = sync end (already captured)
    // T1 = microtask
    queueMicrotask(() => { snap('T1_microtask') })
    // T2 = next RAF
    requestAnimationFrame(() => { snap('T2_RAF') })
    // T3 = 50ms
    setTimeout(() => { snap('T3_50ms') }, 50)
    // T4 = 150ms → close
    setTimeout(() => {
      snap('T4_150ms')
      this.flushEnterRaceTrace(txn)
      this.activeEnterTransaction = null
      txn.state = 'closed'
    }, 150)
  }

  /** Append one JSONL line to race trace file. */
  private flushEnterRaceTrace(txn: EnterIndentTransaction): void {
    try {
      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const vaultRoot = (this.ctx as any).vaultRoot ??
        (this.ctx.settings as any).getVaultRoot?.() ?? ''
      const tracePath = path.join(
        vaultRoot || path.dirname(this.getActiveFilePath() || ''),
        '.typora',
        'inkchapter-enter-race-trace.jsonl',
      )
      fs.appendFileSync(tracePath, JSON.stringify(txn.traceData) + '\n', 'utf8')
    } catch { /* fail-open */ }
  }

  /**
   * Immediate local projection for the current paragraph.
   *
   * Computes effective visual indent (semantic → structural → effective) and
   * applies it synchronously, BEFORE the next RAF refresh.
   * Only touches the current paragraph — no full document scan.
   *
   * NO shortcut candidate logic — token text is ordinary text until Enter submit.
   */
  private projectCurrentParagraphLocally(root: HTMLElement): void {
    const block = resolveCurrentBlockFromSelection(root)
    if (!block || block.tagName !== 'P') return
    if (!isContentBlock(block)) return
    if (isInExcludedContext(block)) return

    // ── Active transaction guard: never overwrite FORCE_INDENT ──
    const txn = this.activeEnterTransaction
    if (txn && txn.paragraph === block && txn.state === 'committed') {
      return // transaction owns this paragraph — keep its FORCE_INDENT
    }

    const settings = this.getParagraphLayoutSettings()

    const semantic = getParagraphIndentMode(block)

    const structuralContext = {
      isFormulaContinuation: settings.flushAfterDisplayMath
        ? isAfterDisplayMath(block)
        : false,
    }

    // Transient editing visual: suppress if paragraph belongs to active transaction
    let isEditingToken = false
    if (!txn || txn.paragraph !== block) {
      isEditingToken = isIndentShortcutEditingToken(block, settings.indentShortcutEnabled)
    }

    const effective = resolveEffectiveParagraphIndent(
      semantic,
      settings.defaultIndent,
      structuralContext,
      { isShortcutEditingToken: isEditingToken },
    )

    applyEffectiveParagraphIndent(block, effective)
  }

  /**
   * Clear the command token from a paragraph by modifying only the text node.
   *
   * Must preserve Typora's inline DOM structure (<span>, etc.).
   * Does NOT use execCommand (unreliable in Typora).
   * Does NOT use textContent= replacement (destroys inline spans).
   *
   * Instead: finds the exact text node containing the token and
   * replaces the token substring within that text node only.
   */
  private clearParagraphToken(paragraph: HTMLElement, token: '..' | '。。'): void {
    // Find the text node containing the token
    const textNode = findTextNodeContaining(paragraph, token)
    if (!textNode) return

    const content = textNode.textContent ?? ''
    const idx = content.indexOf(token)
    if (idx < 0) return

    // Replace token within the text node — preserves all DOM structure
    textNode.textContent = content.slice(0, idx) + content.slice(idx + token.length)
  }

  /** Place caret at the start of a paragraph, handling empty/BR/text node. */
  private placeCaretInParagraph(paragraph: HTMLElement): void {
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()

    // Find first text node or BR
    const firstChild = paragraph.firstChild
    if (firstChild?.nodeType === Node.TEXT_NODE) {
      range.setStart(firstChild, 0)
    } else if (firstChild?.nodeName === 'BR') {
      range.setStartBefore(firstChild)
    } else {
      range.setStart(paragraph, 0)
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /**
   * Unified entry point: apply paragraph indent override.
   * Handles both runtime semantic state and sidecar persistence.
   * Used by both shortcut and manual command.
   */
  applyParagraphIndentOverride(
    paragraph: HTMLElement,
    mode: 'force-indent' | 'force-flush' | 'auto',
  ): void {
    setParagraphIndentMode(paragraph, mode)
    const root = this.adapter.detectEditorRoot()
    if (root) {
      refreshParagraphIndentStyles(root, this.getParagraphLayoutSettings())
    }
    this.applyParagraphIndentOverrideToSidecar(paragraph, mode)
  }

  private applyParagraphIndentOverrideToSidecar(
    paragraph: HTMLElement,
    _mode: 'force-indent' | 'force-flush' | 'auto',
  ): void {
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    if (!docKey) return
    const root = this.adapter.getEditorRoot()
    if (!root) return
    const allParas = collectContentParagraphs(root)
    const paraIndex = allParas.indexOf(paragraph)
    if (paraIndex < 0) return
    const anchor = createParagraphAnchor(paraIndex, allParas)
    const isTemporary = !paragraph.textContent?.trim()
    const overrides = this.inMemoryOverrides.get(docKey) ?? []

    // Try to find existing record by anchor resolution (textHash-based match preferred)
    const existing = overrides.find(o => resolveParagraphAnchor(o.anchor, allParas)?.index === paraIndex)

    if (_mode === 'auto') {
      if (existing) {
        const clean = overrides.filter(o => o !== existing)
        this.inMemoryOverrides.set(docKey, clean)
        this.scheduleSidecarWrite(docKey, docPath, clean)
      }
      return
    }

    // Update existing record or create new one (maintain stable record id)
    if (existing) {
      existing.mode = _mode
      existing.anchor = anchor
      existing.temporary = isTemporary
    } else {
      overrides.push({ id: `indent-${Date.now()}-${overrides.length}`, mode: _mode, anchor, temporary: isTemporary })
    }
    this.inMemoryOverrides.set(docKey, [...overrides])
    this.scheduleSidecarWrite(docKey, docPath, overrides)
  }

  private sidecarWriteTimer: ReturnType<typeof setTimeout> | null = null
  private sidecarWritePending: { docKey: string; docPath: string; overrides: ParagraphIndentOverrideRecord[] } | null = null

  private scheduleSidecarWrite(docKey: string, docPath: string, overrides: ParagraphIndentOverrideRecord[]): void {
    this.sidecarWritePending = { docKey, docPath, overrides }
    if (this.sidecarWriteTimer !== null) clearTimeout(this.sidecarWriteTimer)
    this.sidecarWriteTimer = setTimeout(() => {
      this.sidecarWriteTimer = null
      const pending = this.sidecarWritePending
      if (pending) {
        this.sidecarWritePending = null
        saveParagraphLayout(pending.docKey, pending.docPath, pending.overrides)
      }
    }, 200)
  }

  /** Flush pending sidecar writes (call before document switch). */
  private flushSidecarWrite(): void {
    if (this.sidecarWriteTimer !== null) {
      clearTimeout(this.sidecarWriteTimer)
      this.sidecarWriteTimer = null
    }
    const pending = this.sidecarWritePending
    if (pending) {
      this.sidecarWritePending = null
      saveParagraphLayout(pending.docKey, pending.docPath, pending.overrides)
    }
  }

  // ── Normal Enter Trace: T0 snapshot + T8 final ──────────

  /**
   * Save T0 snapshot (for next cycle's comparison) and record T8 final state.
   * Called at the end of every doRefresh when trace is active.
   */
  private captureTraceEndOfDoRefresh(root: HTMLElement): void {
    if (!getTraceState().active) return

    safeTrace(() => {
      const docKey = this.getDocumentKey()

      // ── T8: Final visual state ──
      let t8Target: HTMLElement | null = null
      // With WeakMap-based identity, we look for the element that has the trace ID
      // stored in the WeakMap (not DOM dataset). For now, find any force-indent paragraph.
      const allParas = collectContentParagraphs(root)
      for (const p of allParas) {
        if (p.classList.contains('inkchapter-paragraph-effective-indent-2')) {
          t8Target = p
          break
        }
      }
      traceT8_FinalState({
        targetElement: summarizeElement(t8Target),
        targetClass: t8Target?.className ? String(t8Target.className) : null,
        targetDataMode: t8Target?.getAttribute('data-inkchapter-indent-mode') ?? null,
        computedTextIndent: t8Target ? getComputedIndent(t8Target) : 'no-target',
        selectionCurrentBlock: summarizeElement(resolveCurrentBlockFromSelection(root)),
      })

      // ── Save T0 snapshot for next cycle ──
      let aPara: HTMLElement | null = null
      let aOrdinal = -1
      let aPrev: HTMLElement | null = null
      let aNext: HTMLElement | null = null
      for (let i = 0; i < allParas.length; i++) {
        if (allParas[i].classList.contains('inkchapter-paragraph-effective-indent-2')) {
          aPara = allParas[i]
          aOrdinal = i
          aPrev = i > 0 ? allParas[i - 1] : null
          aNext = i < allParas.length - 1 ? allParas[i + 1] : null
          // WeakMap identity — no DOM mutation
          break
        }
      }

      const overrides = this.inMemoryOverrides.get(docKey ?? '') ?? []
      let targetOverride: ParagraphIndentOverrideRecord | null = null
      if (aPara) {
        targetOverride = overrides.find(o => {
          const r = resolveParagraphAnchor(o.anchor, allParas)
          return r?.index === aOrdinal
        }) ?? null
      }

      this.lastTraceSnapshot = {
        documentKey: docKey,
        editorRootIdentity: identifyNode(root),
        aElement: summarizeElement(aPara),
        aOrdinal,
        aPreviousBlockSummary: summarizeElement(aPrev),
        aNextBlockSummary: summarizeElement(aNext),
        aTextNormalized: aPara?.textContent?.trim() ?? '',
        selection: summarizeSelection(),
        overrideRecordId: targetOverride?.id ?? null,
        overrideMode: targetOverride?.mode ?? null,
        overrideTemporary: targetOverride?.temporary ?? null,
        overrideAnchor: targetOverride?.anchor ? {
          textHash: targetOverride.anchor.textHash ?? null,
          lastKnownOrdinal: targetOverride.anchor.lastKnownOrdinal,
          occurrence: targetOverride.anchor.occurrence ?? null,
        } : null,
        inMemoryOverrideCount: overrides.length,
        sidecarWritePending: this.sidecarWritePending !== null,
      }
    })
  }

  /**
   * Rehydrate explicit force-indent overrides from in-memory registry.
   * Called before every refreshParagraphIndentStyles so that explicit
   * overrides survive Normal Enter / paragraph split / DOM rebuild.
   *
   * Also promotes temporary anchors (empty paragraph) to stable anchors
   * when the user has typed text, and triggers a debounced sidecar write
   * to persist stable anchors for save/reopen round-trip.
   */
  private rehydrateParagraphIndentOverrides(root: HTMLElement): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const overrides = this.inMemoryOverrides.get(docKey)
    if (!overrides || overrides.length === 0) return

    const allParas = collectContentParagraphs(root)
    if (allParas.length === 0) return

    let dirty = false
    let promotionHappened = false
    let promotionTextHash: string | null = null

    // First, promote temporary anchors if text has been typed
    for (const o of overrides) {
      if (!o.temporary || o.mode !== 'force-indent') continue
      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (resolved) {
        const para = allParas[resolved.index]
        if (para && para.textContent?.trim()) {
          // Text entered — promote to stable anchor
          const newAnchor = createParagraphAnchor(resolved.index, allParas)
          o.anchor = newAnchor
          o.temporary = false
          dirty = true
          promotionHappened = true
          promotionTextHash = newAnchor.textHash ?? null
        }
      }
    }

    // Rehydrate: set semantic state on matching DOM elements
    let traceTarget: {
      o: ParagraphIndentOverrideRecord
      resolved: { index: number } | null
      para: HTMLElement | null
      beforeClass: string | null
      beforeData: string | null
      afterClass: string | null
      afterData: string | null
    } | null = null

    for (const o of overrides) {
      if (o.mode !== 'force-indent' && o.mode !== 'force-flush') continue
      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (resolved) {
        const para = allParas[resolved.index]
        const beforeClass = para?.className ? String(para.className) : null
        const beforeData = para?.getAttribute('data-inkchapter-indent-mode') ?? null
        if (para && para.getAttribute('data-inkchapter-indent-mode') !== o.mode) {
          setParagraphIndentMode(para, o.mode)
        }
        const afterClass = para?.className ? String(para.className) : null
        const afterData = para?.getAttribute('data-inkchapter-indent-mode') ?? null
        // Capture first force-indent override for T6 trace
        if (!traceTarget) {
          traceTarget = { o, resolved, para, beforeClass, beforeData, afterClass, afterData }
        }
        // Auto-repair anchor (refresh ordinals/neighbors after DOM changes)
        if (resolved.index >= 0 && resolved.index < allParas.length) {
          updateParagraphAnchor(o.anchor, resolved.index, allParas)
          dirty = true
        }
      }
    }

    // ── Trace: T6 Rehydrate ──
    if (getTraceState().active && traceTarget) {
      safeTrace(() => {
      const rt = traceTarget
      const resolvedEl = rt.para
      let resolveResult: T6Data['resolveResult'] = 'other'
      if (rt.resolved && resolvedEl) {
        // Compare with last T0 snapshot's A element identity (WeakMap-based)
        const lastA = this.lastTraceSnapshot?.aElement
        if (lastA) {
          const currentTraceId = identifyNode(resolvedEl)
          const lastTraceId = (lastA as any).traceId as string | undefined
          if (currentTraceId && lastTraceId && currentTraceId === lastTraceId) resolveResult = 'A'
          else resolveResult = 'Aprime'
        } else {
          resolveResult = 'other'
        }
      } else {
        resolveResult = 'null'
      }
      traceT6_Rehydrate({
        overrideCount: overrides.length,
        targetRecordId: rt.o.id,
        targetRecordMode: rt.o.mode,
        targetRecordTemporary: rt.o.temporary ?? false,
        targetRecordAnchor: {
          textHash: rt.o.anchor.textHash ?? null,
          lastKnownOrdinal: rt.o.anchor.lastKnownOrdinal,
          occurrence: rt.o.anchor.occurrence ?? null,
        },
        candidateParagraphCount: allParas.length,
        resolveResult,
        resolvedElement: summarizeElement(resolvedEl),
        resolvedText: resolvedEl?.textContent?.slice(0, 80) ?? null,
        resolvedOrdinal: rt.resolved?.index ?? null,
        beforeApplyClass: rt.beforeClass,
        beforeApplyData: rt.beforeData,
        afterApplyClass: rt.afterClass,
        afterApplyData: rt.afterData,
        promotionHappened,
        promotionAnchorTextHash: promotionTextHash,
      })
      }) // safeTrace end
    }

    // Persist promoted/repaired anchors to sidecar (debounced)
    if (dirty) {
      this.scheduleSidecarWrite(docKey, docPath, [...overrides])
    }
  }

  /** Reconstruct runtime force-indent projections from sidecar metadata. */
  reconstructParagraphOverridesFromSidecar(): void {
    const docKey = this.getDocumentKey()
    if (!docKey) return

    const data = loadParagraphLayout(docKey)
    if (!data || data.paragraphOverrides.length === 0) {
      this.inMemoryOverrides.set(docKey, [])
      return
    }

    // Populate in-memory registry from sidecar
    this.inMemoryOverrides.set(docKey, data.paragraphOverrides.map(o => ({ ...o })))

    const root = this.adapter.detectEditorRoot()
    if (!root) return

    const allParas = collectContentParagraphs(root)

    // First, run legacy migration if markers exist in Markdown
    this.migrateLegacyMarkersIfPresent()

    for (const override of data.paragraphOverrides) {
      if (override.mode !== 'force-indent' && override.mode !== 'force-flush') continue
      const resolved = resolveParagraphAnchor(override.anchor, allParas)
      if (resolved) {
        const para = allParas[resolved.index]
        if (para) {
          setParagraphIndentMode(para, override.mode)
          // Auto-repair anchor
          const updated = updateParagraphAnchor(override.anchor, resolved.index, allParas)
          override.anchor = updated
          override.temporary = !para.textContent?.trim()
        }
      }
    }

    // Save repaired anchors
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    saveParagraphLayout(docKey, docPath, data.paragraphOverrides)
  }

  /** Migrate legacy HTML comment markers to sidecar if present. */
  private migrateLegacyMarkersIfPresent(): void {
    const markdown = this.ctx.getMarkdown?.()
    if (!markdown) return

    const { cleanMarkdown, overrides, migrated } = migrateLegacyIndentMarkers(markdown)
    if (!migrated) return

    // Merge with existing sidecar
    const docKey = this.getDocumentKey()
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    if (!docKey) return

    const existing = loadParagraphLayout(docKey)
    const existingOverrides = existing?.paragraphOverrides ?? []
    const merged = [...existingOverrides, ...overrides]
    saveParagraphLayout(docKey, docPath, merged)

    // Reload with clean Markdown (no markers)
    this.suppressParagraphCommandDetection = true
    try {
      if (this.ctx.reloadContentPreservingUndo) {
        this.ctx.reloadContentPreservingUndo(cleanMarkdown)
      } else if (this.ctx.reloadContent) {
        this.ctx.reloadContent(cleanMarkdown)
      }
    } finally {
      this.suppressParagraphCommandDetection = false
    }

    console.info(`[InkChapter] Migrated ${overrides.length} legacy marker(s) to sidecar`)
  }

  // ── Manual Semantic Diagnostic Command ──────────────────

  /**
   * Force-indent the paragraph at the current selection.
   *
   * This is a diagnostic entry point that completely bypasses the
   * shortcut producer (mutation observer, command token, Enter).
   * It directly tests: selection → resolveBlock → semantic setter → layout.
   *
   * If this command works but .. + Enter doesn't, the problem is
   * in the shortcut producer chain, not the semantic/render layer.
   *
   * Supports three modes via `setParagraphIndentMode`:
   *   'force-indent' | 'force-flush' | 'auto'
   */
  forceIndentCurrentParagraph(mode: 'force-indent' | 'force-flush' | 'auto' = 'force-indent'): boolean {
    const root = this.adapter.detectEditorRoot()
    if (!root) return false

    const block = resolveCurrentBlockFromSelection(root)
    if (!block) return false

    if (!isContentBlock(block)) return false

    // Use unified entry point — handles both runtime semantic and sidecar persistence
    this.applyParagraphIndentOverride(block, mode)

    return true
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

    const structure = resolveHeadingStructure(this.s)
    const slot = resolveStyleSlot(structure.mode, level)
    if (slot === null) return // strict H1 has no slot
    const levelKey = `h${slot}`
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
      // ── Trace: T1 + T2 (fail-open: never blocks classifier) ──
      safeTrace(() => {
        const lastA = this.lastTraceSnapshot
        let oldAEl: HTMLElement | null = null
        if (lastA?.aElement) {
          const traceId = (lastA.aElement as any).traceId as string | undefined
          // Note: since trace identity is now WeakMap-based (no DOM dataset),
          // querySelector by [data-inkchapter-trace-id] will return null.
          // This is expected behavior — identity tracking is observer-external.
          if (traceId) {
            oldAEl = root.querySelector(`[data-inkchapter-trace-id="${traceId}"]`) as HTMLElement | null
          }
        }
        const caretBlock = resolveCurrentBlockFromSelection(root)
        let domModel = 'unknown'
        if (oldAEl && oldAEl.isConnected) domModel = 'D1-A-retained'
        else if (lastA?.aTextNormalized && !oldAEl) domModel = 'D2-A-replaced'
        else domModel = 'D5-other'
        traceT1_AfterNormalEnter({
          oldAIsConnected: oldAEl?.isConnected ?? false,
          oldAIdentityLabel: oldAEl ? (identifyNode(oldAEl) ?? null) : null,
          oldAElement: summarizeElement(oldAEl),
          selection: summarizeSelection(),
          caretBlock: summarizeElement(caretBlock),
          previousBlock: summarizeElement(caretBlock ? resolvePreviousBlock(caretBlock as HTMLElement, root) : null),
          domModel,
        })

        const t2Records: T2Record[] = mutations.map(m => ({
          type: m.type,
          targetTag: (m.target instanceof Element) ? m.target.tagName : m.target.nodeName,
          targetClass: (m.target instanceof HTMLElement) ? String(m.target.className).slice(0, 80) : undefined,
          targetIdentity: identifyNode(m.target),
          addedCount: m.addedNodes.length,
          addedSummaries: Array.from(m.addedNodes).slice(0, 5).map(n =>
            n instanceof HTMLElement ? { tag: n.tagName, text: n.textContent?.slice(0, 40) ?? '', class: n.className ? String(n.className).slice(0, 60) : undefined } : { type: n.nodeName }),
          removedCount: m.removedNodes.length,
          removedSummaries: Array.from(m.removedNodes).slice(0, 5).map(n =>
            n instanceof HTMLElement ? { tag: n.tagName, text: n.textContent?.slice(0, 40) ?? '', class: n.className ? String(n.className).slice(0, 60) : undefined } : { type: n.nodeName }),
        }))
        traceT2_MutationRecords(t2Records)
      })

      // ── Use classifier to determine mutation type ──
      const classification = classifyEditorMutation(mutations, root, {
        suppressParagraphDetection: this.suppressParagraphCommandDetection,
      })

      // ── Trace: T3 Classifier (fail-open) ──
      safeTrace(() => {
        traceT3_Classifier({
          headingMutation: classification.headingMutation,
          paragraphCommandCandidate: classification.paragraphCommandCandidate,
          largeBatch: classification.largeBatch,
          suppressed: this.suppressParagraphCommandDetection,
          paragraphMutationEpoch: this.paragraphMutationEpoch,
          didRequestRefresh: classification.headingMutation || (classification.paragraphCommandCandidate && !classification.largeBatch),
          refreshReason: classification.headingMutation ? 'editor-mutation' :
            (classification.paragraphCommandCandidate && !classification.largeBatch) ? 'paragraph-command-mutation' : null,
        })
      })

      // Heading structural change → editor-mutation
      if (classification.headingMutation) {
        this.requestRefresh('editor-mutation')
      }

      // Small paragraph structural change → paragraph-command-mutation
      // Only when not suppressed (plugin-authored reloads) and not large batch
      if (classification.paragraphCommandCandidate && !classification.largeBatch) {
        this.paragraphMutationEpoch++
        this.requestRefresh('paragraph-command-mutation')
      }

      // Post-hoc enforcement: check for out-of-range headings
      if (classification.headingMutation) {
        // Check added nodes for new headings that need enforcement
        for (const m of mutations) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i]
            if (node instanceof HTMLElement && this.isHeadingOrContainsHeading(node)) {
              this.levelRangeEnforcer.enforceAfterMutation()
              break
            }
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

  /** Indent shortcut: MutationObserver on editor root for childList changes. */
  private indentObserver: MutationObserver | null = null

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

    // ── Current-Line Transform: keydown = sole commit owner ──
    // Only keydown can identify token, create transaction, and commit.
    const onEnterCommand = (e: KeyboardEvent): void => {
      this.tryStartEnterIndentTransaction(e, root)
    }
    root.addEventListener('keydown', onEnterCommand, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onEnterCommand, true))

    // beforeinput(insertParagraph) — suppress-only, NEVER commits
    const onBeforeInputInsertParagraph = (e: InputEvent): void => {
      if (e.inputType !== 'insertParagraph') return
      const txn = this.activeEnterTransaction
      if (!txn) return // no active transaction → native
      if (txn.suppressNativeInsertParagraph) {
        e.preventDefault()
        e.stopPropagation()
        txn.traceData['beforeinput_suppressed'] = true
      }
    }
    root.addEventListener('beforeinput', onBeforeInputInsertParagraph)
    this.editorRootDisposables.add(() => root.removeEventListener('beforeinput', onBeforeInputInsertParagraph))

    // ── Backspace Indent Removal: pre-delete interception ──
    // FORCE_INDENT + caret@logical-start + Backspace → FORCE_FLUSH
    // Must intercept BEFORE Typora processes the Backspace (delete/merge).
    const onBackspaceCommand = (e: KeyboardEvent): void => {
      if (e.key !== 'Backspace') return

      const settings = this.getParagraphLayoutSettings()

      const ctx = shouldConsumeBackspaceForIndentRemoval(
        root,
        settings,
        this.isInComposition || e.isComposing,
      )

      // Not our concern — let Typora handle natively
      if (!ctx || !ctx.caretAtLogicalStart) return

      // ── Consume Backspace, apply force-flush ──
      e.preventDefault()
      e.stopPropagation()

      console.info('[InkChapter] Backspace reverse command: force-indent → force-flush')

      this.applyParagraphIndentOverride(ctx.paragraph, 'force-flush')

      // Restore caret at logical start of the same paragraph
      this.placeCaretInParagraph(ctx.paragraph)
    }
    root.addEventListener('keydown', onBackspaceCommand, true)
    this.editorRootDisposables.add(() => root.removeEventListener('keydown', onBackspaceCommand, true))

    // ── Forensic: beforeinput recording (passive, no mutation) ──
    const onBeforeInput = (e: InputEvent): void => {
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        state.candidate = 'beforeinput'
        const prospective = (block.textContent ?? '') + (e.data ?? '')
        writeForensicEntry('T0_beforeinput', {
          eventType: e.inputType,
          eventData: e.data,
          isComposing: e.isComposing,
          currentTextContent: block.textContent,
          prospectiveText: prospective,
          paragraphState: state,
          selection: captureSelectionState(block),
        })
      })
    }
    root.addEventListener('beforeinput', onBeforeInput, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('beforeinput', onBeforeInput))

    // input
    const onInput = (): void => {
      // ── Forensic: T1 after native insertion, before projection ──
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        const settings = this.getParagraphLayoutSettings()
        const semantic = getParagraphIndentMode(block)
        const userVisible = getUserVisibleParagraphText(block)
        const token = readParagraphIndentCommand(block)
        state.semantic = semantic
        state.candidate = token ? 'exact-token' : 'none'
        state.documentDefault = settings.defaultIndent
        writeForensicEntry('T1_after_native_insertion', {
          rawTextContent: block.textContent,
          userVisibleText: userVisible,
          indentCommandToken: token,
          semantic,
          settingsDefault: settings.defaultIndent,
          isComposing: this.isInComposition,
          paragraphState: state,
          parentChain: captureParentChain(block),
          matchedCSS: captureMatchedCSSRules(block, 'text-indent'),
        })
      })

      // Immediate local projection for current paragraph (no candidate logic)
      this.projectCurrentParagraphLocally(root)

      // ── Forensic: T2 after local projection ──
      safeForensic(() => {
        const block = resolveCurrentBlockFromSelection(root)
        if (!block || block.tagName !== 'P') return
        const state = captureParagraphState(block)
        writeForensicEntry('T2_after_local_projection', {
          paragraphState: state,
          localProjectionCalled: true,
          localTargetIsP: block.tagName === 'P',
          localTargetId: (block as HTMLElement).dataset ? undefined : undefined,
        })
      })

      if (!this.isInComposition) this.requestRefresh('editor-input')

      // ── Forensic: T6 next RAF ──
      safeForensic(() => {
        requestAnimationFrame(() => {
          safeForensic(() => {
            const block = resolveCurrentBlockFromSelection(root)
            if (!block || block.tagName !== 'P') return
            writeForensicEntry('T6_next_RAF', {
              paragraphState: captureParagraphState(block),
            })
          })
        })
      })

      // ── Forensic: T7 100ms final ──
      safeForensic(() => {
        setTimeout(() => {
          safeForensic(() => {
            const block = resolveCurrentBlockFromSelection(root)
            if (!block || block.tagName !== 'P') return
            const state = captureParagraphState(block)
            const settings = this.getParagraphLayoutSettings()
            const indentToken = readParagraphIndentCommand(block)
            state.candidate = indentToken ? 'exact-token' : 'none'
            state.semantic = getParagraphIndentMode(block)
            state.documentDefault = settings.defaultIndent
            writeForensicEntry('T7_final_100ms', {
              paragraphState: state,
              parentChain: captureParentChain(block),
              matchedCSS: captureMatchedCSSRules(block, 'text-indent'),
              selection: captureSelectionState(block),
              SEMANTIC: state.semantic,
              INDENT_TOKEN: indentToken,
              DEFAULT: state.documentDefault,
              COMPUTED_TEXT_INDENT: state.computedTextIndent,
              COMPUTED_MARGIN_LEFT: state.computedMarginLeft,
              VISUAL_OFFSET_PX: state.visualOffsetPx,
            })
          })
        }, 100)
      })
    }
    root.addEventListener('input', onInput, { passive: true })
    this.editorRootDisposables.add(() => root.removeEventListener('input', onInput))

    // composition
    const onCompositionEnd = (): void => {
      this.isInComposition = false
      // Immediate local projection after composition ends
      this.projectCurrentParagraphLocally(root)
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

    // ── Indent shortcut: DISABLED (R31) ──
    // The old standalone MutationObserver approach has been retired in favor
    // of the pipeline-integrated probe in probeAndConsumeIndentShortcut(),
    // which hooks into the proven input→requestRefresh→doRefresh pipeline.
    // this.bindIndentCommandObserver(root)
  }

  /** Bind MutationObserver to detect and process indent shortcut commands. */
  private bindIndentCommandObserver(root: HTMLElement): void {
    // Ensure no duplicate observer
    if (this.indentObserver) {
      this.indentObserver.disconnect()
      this.indentObserver = null
    }

    const settings = this.getParagraphLayoutSettings()
    if (!settings.indentShortcutEnabled) return

    // Recursion guard: prevent observer callback from triggering itself
    let observerActive = false

    const observer = new MutationObserver((mutations: MutationRecord[]) => {
      if (observerActive) return
      observerActive = true
      try {
        this.processIndentCommandMutations(mutations, root)
      } finally {
        observerActive = false
      }
    })

    observer.observe(root, {
      childList: true,
      subtree: true,
    })

    this.indentObserver = observer
    this.editorRootDisposables?.add(() => {
      observer.disconnect()
      if (this.indentObserver === observer) this.indentObserver = null
    })
  }

  /** Process childList mutations to detect indent command pattern. */
  private processIndentCommandMutations(mutations: MutationRecord[], root: HTMLElement): void {
    const settings = this.getParagraphLayoutSettings()
    if (!settings.indentShortcutEnabled) return

    // Accumulate added paragraphs (may be multiple in one batch)
    const addedParagraphs: HTMLParagraphElement[] = []

    for (const mutation of mutations) {
      // Skip large mutations (paste, document load)
      if (mutation.addedNodes.length > 20) continue

      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i]
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'P') {
          addedParagraphs.push(node as HTMLParagraphElement)
        }
      }
    }

    if (addedParagraphs.length === 0) return
    // Only process small-scale edits (not paste/document load)
    if (addedParagraphs.length > 5) return

    for (const newPara of addedParagraphs) {
      // Guard: new paragraph must be inside editor root
      if (!root.contains(newPara)) continue

      // Guard: must be a plain paragraph (not in heading/list/code context)
      if (isInExcludedContext(newPara)) continue

      // Guard: must have a previous sibling that is also a paragraph
      const prevSibling = newPara.previousElementSibling
      if (!prevSibling || prevSibling.tagName !== 'P') continue

      // Guard: previous sibling must contain exactly ".." or "。。"
      const prevText = (prevSibling.textContent ?? '').trim()
      if (prevText !== '..' && prevText !== '。。') continue

      // Guard: previous sibling must be in a valid context (not code, heading, etc.)
      if (isInExcludedContext(prevSibling)) continue

      // Guard: previous sibling must not have other inline content
      // (already handled by prevText check: only ".." or "。。")

      // Guard: caret/selection should be in the new paragraph
      const sel = window.getSelection()
      if (sel?.rangeCount && sel.getRangeAt(0).startContainer) {
        const selNode = sel.getRangeAt(0).startContainer
        if (!newPara.contains(selNode)) {
          // Selection not in new paragraph — skip this mutation
          continue
        }
      }

      // ── Command recognized: consume marker paragraph, force-indent target ──
      prevSibling.remove()

      // Apply force-indent to the new paragraph
      applyParagraphIndent(newPara, '2em')

      // One command per mutation batch is sufficient
      this.requestRefresh('editor-input')
      break
    }
  }

  /** Detach editor root listeners (called on root change). */
  private unbindEditorRoot(): void {
    if (this.editorRootDisposables) {
      this.editorRootDisposables.dispose()
      this.editorRootDisposables = null
    }
    if (this.indentObserver) {
      this.indentObserver.disconnect()
      this.indentObserver = null
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
        this.flushSidecarWrite()
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
          // Reconstruct paragraph indent overrides from sidecar after DOM settles
          setTimeout(() => this.reconstructParagraphOverridesFromSidecar(), 100)
          // Normal Enter Trace: OFF by default. Enable via window.__INKCHAPTER_NORMAL_ENTER_TRACE__
          // Forensic Probe: OFF by default. Enable via window.__INKCHAPTER_PARAGRAPH_FORENSIC__
          // Then call window.__inkchapter_activate_forensic__() from DevTools to activate.
          ;(window as any).__inkchapter_activate_forensic__ = () => activateForensic()
          setTimeout(() => activateForensic(), 200)
          // Single-dot diagnostic: call __inkchapter_diagnose_single_dot__() from DevTools
          ;(window as any).__inkchapter_diagnose_single_dot__ = () => {
            const rt = this.adapter.getEditorRoot()
            if (!rt) return 'no editor root'
            const p = resolveCurrentBodyParagraph(rt)
            if (!p) return 'no current paragraph'
            const settings = this.getParagraphLayoutSettings()
            return {
              SINGLE_DOT_UI_SETTING: settings.defaultIndent,
              SINGLE_DOT_RESOLVED_DEFAULT: resolveEffectiveParagraphIndent('auto', settings.defaultIndent),
              SINGLE_DOT_SEMANTIC: getParagraphIndentMode(p),
              SINGLE_DOT_COMPUTED_TEXT_INDENT: window.getComputedStyle(p).textIndent,
              SINGLE_DOT_RAW_TEXT: p.textContent,
              SINGLE_DOT_VISIBLE_TEXT: getUserVisibleParagraphText(p),
              SINGLE_DOT_EFFECTIVE_CLASS_INDENT: p.classList.contains('inkchapter-paragraph-effective-indent-2'),
              SINGLE_DOT_EFFECTIVE_CLASS_FLUSH: p.classList.contains('inkchapter-paragraph-effective-flush'),
            }
          }
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
        this.flushSidecarWrite()
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
          // Reconstruct sidecar overrides
          setTimeout(() => this.reconstructParagraphOverridesFromSidecar(), 120)
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

/**
 * Build effective heading layouts by remapping physical level → style slot.
 * Returns a HeadingLayoutSettings with h1-h6 keys filled from the slot data.
 * Does not modify the source layout object.
 */
function buildEffectiveLayouts(
  sourceLayouts: import('./heading-types').HeadingLayoutSettings,
  mode: import('./heading-structure').HeadingStructureMode,
): import('./heading-types').HeadingLayoutSettings {
  const defaultLayout: import('./heading-types').HeadingLayoutConfig = { textAlign: 'left', firstLineIndentEm: 0 }
  if (mode === 'loose') {
    // Loose: physical = slot, no remapping needed
    return sourceLayouts
  }
  // Strict: H1=title(native), H2→S1(h1), H3→S2(h2), ..., H6→S5(h5)
  return {
    h1: defaultLayout,
    h2: sourceLayouts.h1 ?? defaultLayout,
    h3: sourceLayouts.h2 ?? defaultLayout,
    h4: sourceLayouts.h3 ?? defaultLayout,
    h5: sourceLayouts.h4 ?? defaultLayout,
    h6: sourceLayouts.h5 ?? defaultLayout,
  }
}

/** Find the text node within an element that contains a given substring. */
function findTextNodeContaining(el: HTMLElement, substr: string): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.textContent?.includes(substr)) return node
  }
  return null
}
