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
  getCurrentParagraphElement,
  isInExcludedContext,
  canTriggerIndentShortcut,
  isCursorAtEnd,
  setParagraphIndentMode,
  getParagraphIndentMode,
  writeBlockProbeDiagnostic,
  classifyEditorMutation,
  resolveCurrentBlockFromSelection,
  resolvePreviousBlock,
  isContentBlock,
  isCaretAtLogicalStartOfParagraph,
  resolveCurrentBodyParagraph,
  shouldConsumeBackspaceForIndentRemoval,
  applyEffectiveParagraphIndent,
  resolveEffectiveParagraphIndent,
  rehydrateParagraphIndentState,
  type RehydrateContext,
  evaluateRehydrateSafety,
  anchorConfidenceToRehydrateConfidence,
  resolveSafeRehydrateDecision,
  type SafeRehydrateDecision,
  RehydrateMatchStrategy,
  type RehydrateMatchProvenance,
  type CandidateRecord,
  isAfterDisplayMath,
  getUserVisibleParagraphText,
  readParagraphIndentCommand,
  isCaretAtTokenEnd,
  isIndentShortcutEditingToken,
  recordParagraphWrite,
  getLastParagraphWriter,
  getParagraphWriterHistory,
  WriterIds,
  type BackspaceIndentCommandContext,
  type RehydrateResolvedCandidate,
  type RehydrateOwnershipGroup,
  type ParagraphRehydratePlan,
  buildRehydrateOwnershipGroups,
  getElementIdentity,
  type CaretWriteResult,
  type OneShotParagraphReplacementHandoff,
  type EnterCommitSuccessFields,
} from './paragraph-indent-manager'
import {
  loadParagraphLayout,
  saveParagraphLayout,
  createParagraphAnchor,
  resolveParagraphAnchor,
  updateParagraphAnchor,
  collectContentParagraphs,
  migrateLegacyIndentMarkers,
  injectProductionVaultRoot,
  type ParagraphIndentOverrideRecord,
  type AnchorResolveResult,
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

interface PostCommitObservationSession {
  observationId: string
  txnId: string
  paragraphAtCommit: HTMLElement
  paragraphIdentityAtCommit: string
  startedAt: number
  transactionClosedAt: number
  lastKnownParagraph: HTMLElement | null
  mutationObserver: MutationObserver | null
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

  // ── Post-Commit Observation — read-only, independent of transaction lifecycle ──
  // Map-based: each transaction gets its own independent observation to T9.
  // Multiple concurrent observations coexist without overwriting each other.
  private observations = new Map<string, PostCommitObservationSession>()

  // ── P0-5: One-Shot Paragraph Replacement Handoff ────────────────
  // Replaces old PendingLogicalParagraphState (removed r54).
  // Short-lived: resolves replacement once, transfers semantic+visual,
  // never writes caret/sidecar, consumed after first resolution.
  private activeOneShotHandoff: OneShotParagraphReplacementHandoff | null = null

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

    // ── P0-1: Inject production vault root ──────────────────────────
    // Must happen before any sidecar load/write.
    this.injectVaultRoot()

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
  /** Inject production vault root before any sidecar operation. */
  private injectVaultRoot(): void {
    try {
      const filePath = this.ctx.getActiveFilePath?.()
      if (!filePath) return
      // Derive vault root: the directory containing .typora
      // For test vault: D:\...\test\vault
      const vaultCandidate = (this.ctx as any).vaultRoot ??
        (this.ctx.settings as any).getVaultRoot?.()

      if (typeof vaultCandidate === 'string' && vaultCandidate.length > 0) {
        injectProductionVaultRoot(vaultCandidate)
        console.info(`[InkChapter] SIDECAR-CONTEXT: vaultRoot=${vaultCandidate} source=plugin-config`)
        return
      }

      // Fallback: derive from active file path by searching for .typora ancestor
      const { dirname, join } = require('path') as typeof import('path')
      const { existsSync } = require('fs') as typeof import('fs')
      let dir = dirname(filePath)
      for (let i = 0; i < 5; i++) {
        if (existsSync(join(dir, '.typora'))) {
          injectProductionVaultRoot(dir)
          console.info(`[InkChapter] SIDECAR-CONTEXT: vaultRoot=${dir} storageRoot=${join(dir, '.typora', 'inkchapter', 'paragraph-layout')} source=derived-from-active-file`)
          return
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }

      console.warn(`[InkChapter] SIDECAR-CONTEXT: vaultRoot unknown — could not derive from filePath=${filePath}`)
    } catch (e) {
      console.warn('[InkChapter] SIDECAR-CONTEXT: vault root injection failed:', e)
    }
  }

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
    const preParagraphIdentity = getElementIdentity(para)
    const preParagraphConnected = para.isConnected
    txn.traceData['T0_paraCountBefore'] = txn.paragraphCountBefore
    txn.traceData['T0_paraTag'] = para.tagName

    // consume Enter
    event.preventDefault()
    event.stopPropagation()
    txn.traceData['preventDefault'] = true
    txn.state = 'token-consumed'

    // consume token — direct DOM textContent mutation
    this.clearParagraphToken(para, txn.token)
    txn.tokenConsumed = true
    txn.traceData['tokenConsumed'] = true
    txn.traceData['tokenConsumerType'] = 'direct-textNode-mutation'

    // Check if token consumer caused DOM replacement (stale element)
    const postTokenConnected = para.isConnected
    let caretTarget: HTMLElement | null = para

    if (!postTokenConnected) {
      // ── STALE-PARAGRAPH-AFTER-TOKEN-CONSUME ──
      console.info(`[InkChapter] STALE-PARAGRAPH-AFTER-TOKEN-CONSUME: txnId=${txn.id} preIdentity=${preParagraphIdentity} preConnected=true postConnected=false`)
      txn.traceData['staleDetected'] = true

      // ── One-Shot Local Replacement Resolution ──
      // Find the replacement paragraph at the same ordinal in editor root
      const currentRoot = this.adapter.getEditorRoot()
      if (currentRoot) {
        const allParas = collectContentParagraphs(currentRoot)
        const paraOrdinal = txn.paragraphCountBefore > 0
          ? Math.min(txn.paragraphCountBefore - 1, allParas.length - 1)
          : 0

        // Try to find the replacement: same ordinal, empty text (after token consumed)
        if (paraOrdinal >= 0 && paraOrdinal < allParas.length) {
          const candidate = allParas[paraOrdinal]
          const candidateText = getUserVisibleParagraphText(candidate)
          // The replacement should be empty (token consumed, no other text)
          if (candidateText === '' || candidate.textContent === '') {
            caretTarget = candidate
            txn.traceData['replacementResolved'] = true
            txn.traceData['replacementIdentity'] = getElementIdentity(candidate)
            txn.traceData['replacementOrdinal'] = paraOrdinal
            console.info(`[InkChapter] STALE-PARAGRAPH-RESOLVED: txnId=${txn.id} replacementIdentity=${getElementIdentity(candidate)} ordinal=${paraOrdinal}`)
          } else {
            txn.traceData['replacementResolved'] = false
            txn.traceData['replacementAmbiguous'] = true
          }
        }
      }
    }

    // semantic FORCE_INDENT
    setParagraphIndentMode(caretTarget, 'force-indent', WriterIds.ENTER_COMMIT_SEMANTIC)
    txn.semanticWritten = true
    txn.state = 'semantic-written'

    // SIDECAR TEMPORARILY DISABLED for empty paragraph commit.
    txn.sidecarWritten = false
    txn.traceData['sidecarWriteCount'] = 0
    txn.traceData['sidecarDisabled'] = 'empty-paragraph-persistence-paused'

    // visual projection
    const settings = this.getParagraphLayoutSettings()
    const structural = { isFormulaContinuation: settings.flushAfterDisplayMath ? isAfterDisplayMath(caretTarget) : false }
    const effective = resolveEffectiveParagraphIndent('force-indent', settings.defaultIndent, structural)
    applyEffectiveParagraphIndent(caretTarget, effective, WriterIds.ENTER_COMMIT_VISUAL)
    txn.state = 'visual-applied'
    txn.traceData['computedIndent'] = window.getComputedStyle(caretTarget).textIndent
    txn.traceData['semanticTargetIdentity'] = getElementIdentity(caretTarget)

    // caret restore — only if target is valid and connected
    const caretResult = this.placeCaretInParagraph(caretTarget)
    txn.traceData['caretWriterType'] = caretResult.method
    txn.traceData['caretTargetIdentity'] = caretResult.resolvedParagraphIdentity
    txn.traceData['caretTargetConnected'] = caretResult.targetConnected
    txn.traceData['caretWritten'] = caretResult.caretWritten
    txn.traceData['caretRealmSafe'] = caretResult.realmSafe
    if (caretResult.failReason) {
      txn.traceData['caretFailReason'] = caretResult.failReason
    }
    txn.state = 'caret-restored'

    // mark committed, suppress native insertParagraph going forward
    txn.state = 'committed'
    txn.suppressNativeInsertParagraph = true

    // Paragraph count verification
    const finalRoot = this.adapter.getEditorRoot()
    const paragraphCountAfter = finalRoot ? collectContentParagraphs(finalRoot).length : -1
    txn.traceData['paragraphCountAfter'] = paragraphCountAfter

    const tokenGone = caretTarget ? getUserVisibleParagraphText(caretTarget) === '' : false
    const semanticAfter = caretTarget ? getParagraphIndentMode(caretTarget) : 'unknown'
    const computedIndentAfter = caretTarget ? window.getComputedStyle(caretTarget).textIndent : 'unknown'

    // ── P0-4: Split success fields ──
    const successFields: EnterCommitSuccessFields = {
      tokenSuccess: txn.tokenConsumed,
      semanticSuccess: txn.semanticWritten && semanticAfter === 'force-indent',
      visualSuccess: computedIndentAfter === '32px',
      caretSuccess: caretResult.success,
      overallSuccess: false,
    }
    successFields.overallSuccess =
      successFields.tokenSuccess &&
      successFields.semanticSuccess &&
      successFields.visualSuccess &&
      successFields.caretSuccess

    txn.traceData['successFields'] = successFields
    txn.traceData['stopReason'] = 'commit completed'
    txn.traceData['T0'] = 'commit sync end'

    // ── ENTER-COMMIT-ATOMIC (r54 P0-4 split) ──
    console.info(`[InkChapter] ENTER-COMMIT-ATOMIC: txnId=${txn.id} preParagraphConnected=${preParagraphConnected} preParagraphIdentity=${preParagraphIdentity} tokenConsumerType=direct-textNode-mutation postTokenOldParagraphConnected=${postTokenConnected} tokenSuccess=${successFields.tokenSuccess} semanticSuccess=${successFields.semanticSuccess} visualSuccess=${successFields.visualSuccess} caretSuccess=${successFields.caretSuccess} overallSuccess=${successFields.overallSuccess} caretTargetConnected=${caretResult.targetConnected} caretRealmSafe=${caretResult.realmSafe} caretFailReason=${caretResult.failReason ?? 'none'} paragraphCountBefore=${txn.paragraphCountBefore} paragraphCountAfter=${paragraphCountAfter} tokenGone=${tokenGone} semanticAfter=${semanticAfter} computedIndentAfter=${computedIndentAfter}`)

    console.info(`[InkChapter] ${txn.id} committed: token=${txn.token} state=${txn.state}`)

    // ── P0-5: One-Shot Paragraph Replacement Handoff ────────────────
    // Replaces old long-lived PendingLogicalParagraphState.
    // Short-lived: only resolves replacement once, transfers semantic+visual,
    // never writes caret/sidecar, consumed after first resolution.
    const rootAfter = this.adapter.getEditorRoot()
    const allParasAfter = rootAfter ? collectContentParagraphs(rootAfter) : []
    const paraOrdinal2 = allParasAfter.indexOf(para) >= 0
      ? allParasAfter.indexOf(para)
      : txn.paragraphCountBefore > 0 ? Math.min(txn.paragraphCountBefore - 1, allParasAfter.length - 1) : 0

    this.activeOneShotHandoff = {
      handoffId: `handoff-${txn.id}`,
      sourceTxnId: txn.id,
      preElement: para,
      preOrdinal: paraOrdinal2,
      preIdentity: preParagraphIdentity,
      tokenConsumed: txn.tokenConsumed,
      semantic: 'force-indent',
      consumed: false,
      replacementResolved: false,
      replacementElement: null,
      replacementOrdinal: null,
      replacementIdentity: null,
      semanticTransferred: false,
      visualTransferred: false,
    }

    // Schedule T0-T4 transaction snapshots, then close tx at T4.
    // Post-commit observation runs independently T4→T9.
    this.scheduleTransactionStabilitySnapshots(txn)

    // Install diagnostic MutationObserver on target paragraph (read-only)
    this.installDiagnosticMutationObserver(txn)
  }

  /**
   * T0-T4 stability verification within the transaction window.
   * Transaction closes at T4_150ms.
   * PostCommitObservationSession takes over from T4_150ms to T9_2000ms.
   */
  private scheduleTransactionStabilitySnapshots(txn: EnterIndentTransaction): void {
    const snap = (label: string) => {
      if (txn.state === 'closed') return
      const para = txn.paragraph
      const root = this.adapter.getEditorRoot()
      const lastWriter = getLastParagraphWriter(para)
      const data: Record<string, unknown> = {
        txnId: txn.id, label,
        transactionActive: true,
        paraCount: root ? collectContentParagraphs(root).length : -1,
        DOMtext: getUserVisibleParagraphText(para),
        semantic: getParagraphIndentMode(para),
        computedIndent: window.getComputedStyle(para).textIndent,
        caretInPara: window.getSelection()?.rangeCount ? para.contains(window.getSelection()!.getRangeAt(0).startContainer) : false,
        effectiveClass_indent2: para.classList.contains('inkchapter-paragraph-effective-indent-2'),
        effectiveClass_flush: para.classList.contains('inkchapter-paragraph-effective-flush'),
        dataAttr: para.getAttribute('data-inkchapter-indent-mode'),
        lastWriterId: lastWriter?.writerId ?? null,
        lastWriterReason: lastWriter?.reason ?? null,
        lastWriterTime: lastWriter?.timestamp ?? null,
        txnState: txn.state,
        paragraphIsConnected: para.isConnected,
        paragraphTextContent: para.textContent?.slice(0, 80) ?? '',
        userVisibleText: getUserVisibleParagraphText(para),
      }
      data['tokenGone'] = data['DOMtext'] === ''
      data['sameParagraphCount'] = data['paraCount'] === txn.paragraphCountBefore
      txn.traceData[label] = data
      console.info(`[InkChapter] ${txn.id} ${label}: tokenGone=${data['tokenGone']} countMatch=${data['sameParagraphCount']} txActive=true`)
    }

    // T0 = sync end (already captured in commitEnterIndentTransactionSync)
    // T1 = microtask
    queueMicrotask(() => { snap('T1_microtask') })
    // T2 = next RAF
    requestAnimationFrame(() => { snap('T2_RAF') })
    // T3 = 50ms
    setTimeout(() => { snap('T3_50ms') }, 50)
    // T4 = 150ms → close transaction, start observation
    setTimeout(() => {
      snap('T4_150ms')
      const closeTime = performance.now()
      this.activeEnterTransaction = null
      txn.state = 'closed'
      console.info(`[InkChapter] ${txn.id} TRANSACTION CLOSED at ~${Math.round(closeTime - txn.startedAt)}ms`)
      
      // Start independent PostCommitObservationSession
      this.startPostCommitObservation(txn, closeTime)
    }, 150)
  }

  /** Flush race trace data to JSONL file. */
  private flushEnterRaceTrace(traceData: Record<string, unknown>): void {
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
      fs.appendFileSync(tracePath, JSON.stringify(traceData) + '\n', 'utf8')
    } catch { /* fail-open */ }
  }

  // ── Post-Commit Observation ────────────────────────────────────────
  // COMPLETELY READ-ONLY. Never modifies DOM, semantic, class, style,
  // sidecar, caret, or any business state. Only traces for diagnosis.
  //
  // Observation continues after transaction closes, up to T9=2000ms.
  // Records all paragraph state mutations including those from async
  // writers (refresh, rehydrate, settings, sidecar, etc.).

  /**
   * Start a read-only observation session that continues after transaction close.
   * Runs T4→T9 with transactionActive=false, recording all state changes.
   */
  private startPostCommitObservation(txn: EnterIndentTransaction, closedAt: number): void {
    const obs: PostCommitObservationSession = {
      observationId: `obs-${txn.id}`,
      txnId: txn.id,
      paragraphAtCommit: txn.paragraph,
      paragraphIdentityAtCommit: getElementIdentity(txn.paragraph),
      startedAt: performance.now(),
      transactionClosedAt: closedAt,
      lastKnownParagraph: txn.paragraph,
      mutationObserver: null,
      traceData: { ...txn.traceData, observationId: `obs-${txn.id}`, observationStartedAt: performance.now(), transactionClosedAt: closedAt },
    }
    this.observations.set(obs.observationId, obs)

    // Migrate diagnostic MutationObserver from transaction to observation session
    const diagnosticObserver = (txn as any)._diagnosticObserver as MutationObserver | undefined
    if (diagnosticObserver) {
      obs.mutationObserver = diagnosticObserver
      delete (txn as any)._diagnosticObserver
    }

    const snapObs = (label: string) => {
      if (!this.observations.has(obs.observationId)) return
      const para = obs.lastKnownParagraph

      // ── P0-5: Track original AND current replacement separately ──
      // When sameDOMElement=false, record original state and replacement state
      // independently. Never use disconnected old element's semantic as current state.
      let resolvedPara: HTMLElement | null = para
      let sameDOMElement = true
      const originalSemantic = para ? getParagraphIndentMode(para) : null
      const originalIsConnected = para?.isConnected ?? false

      // Re-resolve the logical paragraph if original is disconnected
      if (para && !para.isConnected) {
        sameDOMElement = false
        const root = this.adapter.getEditorRoot()
        if (root) {
          const allParas = collectContentParagraphs(root)
          // Try to find the same paragraph by identity / text
          const idAtCommit = obs.paragraphIdentityAtCommit
          for (const p of allParas) {
            if (getElementIdentity(p) === idAtCommit) {
              resolvedPara = p
              sameDOMElement = true
              obs.lastKnownParagraph = p
              break
            }
          }
          // Fallback: try ordinal-based (one-shot handoff path)
          if (!sameDOMElement && allParas.length > 0) {
            const paraOrdinal = txn.paragraphCountBefore > 0
              ? Math.min(txn.paragraphCountBefore - 1, allParas.length - 1)
              : 0
            const candidate = allParas[paraOrdinal]
            if (candidate) {
              resolvedPara = candidate
              obs.lastKnownParagraph = candidate
            }
          }
        }
      }

      const currentSemantic = resolvedPara ? getParagraphIndentMode(resolvedPara) : null
      const currentIsConnected = resolvedPara?.isConnected ?? false

      const lastWriter = resolvedPara ? getLastParagraphWriter(resolvedPara) : null
      const writerHistory = resolvedPara ? getParagraphWriterHistory(resolvedPara) : []
      const lastHighLevelWriter = writerHistory.length > 0 ? writerHistory[writerHistory.length - 1] : null

      const data: Record<string, unknown> = {
        observationId: obs.observationId,
        txnId: obs.txnId,
        label,
        transactionActive: false,
        transactionClosedAt: obs.transactionClosedAt,
        relativeMs: Math.round(performance.now() - obs.transactionClosedAt),

        // DOM identity
        sameDOMElement,
        originalIsConnected,
        originalParagraphIdentity: obs.paragraphIdentityAtCommit,
        originalSemantic,
        currentParagraphIsConnected: currentIsConnected,
        currentParagraphIdentity: resolvedPara ? getElementIdentity(resolvedPara) : null,
        currentSemantic,

        // P0-5: Clearly separate original and current — never use disconnected as current
        usingStaleSemantic: !sameDOMElement && originalSemantic !== currentSemantic,

        // State
        effectiveClass_indent2: resolvedPara?.classList.contains('inkchapter-paragraph-effective-indent-2') ?? false,
        effectiveClass_flush: resolvedPara?.classList.contains('inkchapter-paragraph-effective-flush') ?? false,
        computedTextIndent: resolvedPara ? window.getComputedStyle(resolvedPara).textIndent : null,
        dataAttr: resolvedPara?.getAttribute('data-inkchapter-indent-mode') ?? null,
        className: resolvedPara?.className ? String(resolvedPara.className).slice(0, 120) : null,

        // Text
        DOMtext: resolvedPara ? getUserVisibleParagraphText(resolvedPara) : null,
        textContent: resolvedPara?.textContent?.slice(0, 80) ?? null,
        tokenGone: resolvedPara ? getUserVisibleParagraphText(resolvedPara) === '' : null,
        paraCount: this.adapter.getEditorRoot() ? collectContentParagraphs(this.adapter.getEditorRoot()!).length : -1,
        sameParagraphCount: (this.adapter.getEditorRoot() ? collectContentParagraphs(this.adapter.getEditorRoot()!).length : -1) === txn.paragraphCountBefore,

        // Writer
        lastHighLevelWriterId: lastHighLevelWriter?.writerId ?? null,
        lastHighLevelWriterReason: lastHighLevelWriter?.reason ?? null,
        lastWriterId: lastWriter?.writerId ?? null,
        lastWriterReason: lastWriter?.reason ?? null,
        writerHistoryTail: writerHistory.slice(-5).map(w => ({ id: w.writerId, reason: w.reason, relMs: w.relativeMs })),

        // Selection
        selectionParagraphIdentity: resolvedPara && window.getSelection()?.rangeCount
          ? (resolvedPara.contains(window.getSelection()!.getRangeAt(0).startContainer) ? obs.paragraphIdentityAtCommit : 'different')
          : null,
        caretInObservedParagraph: resolvedPara && window.getSelection()?.rangeCount
          ? resolvedPara.contains(window.getSelection()!.getRangeAt(0).startContainer)
          : false,
      }
      obs.traceData[label] = data
      console.info(`[InkChapter] ${obs.observationId} ${label}: txActive=false sameDOM=${sameDOMElement} currentSemantic=${currentSemantic} indent=${data['computedTextIndent']} lastWriter=${data['lastHighLevelWriterId']}`)
    }

    // T4 = 150ms (observation starts here, already 0ms into observation)
    snapObs('T4_150ms')

    // T5 = 300ms (150ms into observation)
    setTimeout(() => { snapObs('T5_300ms') }, 150)

    // T6 = 500ms (350ms into observation)
    setTimeout(() => { snapObs('T6_500ms') }, 350)

    // T7 = 1000ms (850ms into observation)
    setTimeout(() => { snapObs('T7_1000ms') }, 850)

    // T8 = 1500ms (1350ms into observation)
    setTimeout(() => { snapObs('T8_1500ms') }, 1350)

    // T9 = 2000ms → close observation
    setTimeout(() => {
      snapObs('T9_2000ms')
      this.flushEnterRaceTrace(obs.traceData)
      // Disconnect diagnostic MutationObserver
      if (obs.mutationObserver) {
        obs.mutationObserver.disconnect()
      }
      this.observations.delete(obs.observationId)
      console.info(`[InkChapter] ${obs.observationId} OBSERVATION CLOSED at T9_2000ms`)
    }, 1850)
  }

  /**
   * Install a read-only diagnostic MutationObserver on the commit-time paragraph.
   * Listens for class, style, data-inkchapter-indent-mode, childList, characterData.
   * NEVER modifies DOM, semantic, class, style, sidecar, or caret.
   */
  private installDiagnosticMutationObserver(txn: EnterIndentTransaction): void {
    const para = txn.paragraph
    try {
      const observer = new MutationObserver((mutations) => {
        if (txn.state === 'closed' && this.observations.size === 0) return
        // Find the observation for this paragraph
        let obs: PostCommitObservationSession | null = null
        for (const o of this.observations.values()) {
          if (o.paragraphAtCommit === para || o.txnId === txn.id) {
            obs = o
            break
          }
        }
        if (!obs) return

        for (const m of mutations) {
          const record: Record<string, unknown> = {
            observationId: obs.observationId,
            txnId: obs.txnId,
            relativeMs: Math.round(performance.now() - obs.transactionClosedAt),

            mutationType: m.type,
            attributeName: m.attributeName ?? null,
            oldValue: m.oldValue ?? null,

            paragraphIdentityAtCommit: obs.paragraphIdentityAtCommit,
            currentParagraphIdentity: getElementIdentity(para),
            sameDOMElement: para.isConnected && para === obs.paragraphAtCommit,

            semantic: getParagraphIndentMode(para),
            effectiveClass_indent2: para.classList.contains('inkchapter-paragraph-effective-indent-2'),
            effectiveClass_flush: para.classList.contains('inkchapter-paragraph-effective-flush'),
            computedTextIndent: window.getComputedStyle(para).textIndent,

            textContent: para.textContent?.slice(0, 80) ?? '',
            userVisibleText: getUserVisibleParagraphText(para),

            transactionActive: this.activeEnterTransaction !== null,

            lastHighLevelWriterId: (() => {
              const h = getParagraphWriterHistory(para)
              return h.length > 0 ? h[h.length - 1].writerId : null
            })(),
            lastHighLevelWriterReason: (() => {
              const h = getParagraphWriterHistory(para)
              return h.length > 0 ? h[h.length - 1].reason : null
            })(),

            selectionParagraphIdentity: window.getSelection()?.rangeCount
              ? (para.contains(window.getSelection()!.getRangeAt(0).startContainer) ? obs.paragraphIdentityAtCommit : 'different')
              : null,
          }

          // Record new values
          if (m.type === 'attributes' && m.attributeName) {
            record['newValue'] = para.getAttribute(m.attributeName)
          }
          if (m.type === 'characterData') {
            record['newValue'] = m.target.textContent?.slice(0, 80) ?? ''
          }
          if (m.type === 'childList') {
            record['addedCount'] = m.addedNodes.length
            record['removedCount'] = m.removedNodes.length
          }

          obs.traceData[`MUT-${m.type}-${m.attributeName ?? 'data'}-${Math.round(performance.now())}`] = record
        }
      })

      observer.observe(para, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-inkchapter-indent-mode'],
        attributeOldValue: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      })

      // Store on observation session for cleanup
      // Find the observation for this transaction
      for (const o of this.observations.values()) {
        if (o.txnId === txn.id) {
          o.mutationObserver = observer
          break
        }
      }
      if (![...this.observations.values()].some(o => o.txnId === txn.id)) {
        // Observation hasn't started yet — attach to transaction for now
        ;(txn as any)._diagnosticObserver = observer
      }
    } catch {
      // fail-open — diagnostic observer must never break runtime
    }
  }

  /** Generate a stable identity key for a paragraph element. Read-only. */
  // ── P0-5: One-Shot Paragraph Replacement Handoff ──────────────────
  // Replaces old PendingLogicalParagraphState (removed r54).
  // Only resolves replacement ONCE, transfers semantic+visual, never caret/sidecar.
  // Consumed immediately after first resolution.

  /**
   * Check active one-shot handoff: if the original paragraph is disconnected,
   * find its replacement, transfer semantic+visual once, and consume the handoff.
   * Called from rehydrate path (no more than once per Enter txn).
   */
  private tryExecuteOneShotHandoff(allParagraphs: HTMLElement[]): void {
    const handoff = this.activeOneShotHandoff
    if (!handoff || handoff.consumed) return

    const original = handoff.preElement
    if (original.isConnected) return // still alive

    // Original disconnected — one-shot replacement resolution
    const paraOrdinal = handoff.preOrdinal
    if (paraOrdinal < 0 || paraOrdinal >= allParagraphs.length) return

    const replacement = allParagraphs[paraOrdinal]
    if (!replacement) return

    handoff.replacementElement = replacement
    handoff.replacementOrdinal = paraOrdinal
    handoff.replacementIdentity = getElementIdentity(replacement)
    handoff.replacementResolved = true

    // Transfer semantic + visual ONCE (never caret, never sidecar)
    const settings = this.getParagraphLayoutSettings()
    setParagraphIndentMode(replacement, handoff.semantic, 'W-ONESHOT-SEMANTIC')
    const effective = resolveEffectiveParagraphIndent(handoff.semantic, settings.defaultIndent)
    applyEffectiveParagraphIndent(replacement, effective, 'W-ONESHOT-VISUAL')
    handoff.semanticTransferred = true
    handoff.visualTransferred = true

    // Consume immediately — no more rebound
    handoff.consumed = true

    console.info(`[InkChapter] ONE-SHOT-HANDOFF: handoffId=${handoff.handoffId} original=${handoff.preIdentity} replacement=${handoff.replacementIdentity} semantic=${handoff.semantic} consumed=true`)
  }

  /** Release active one-shot handoff (document switch, explicit override). */
  private releaseOneShotHandoff(reason: string): void {
    const handoff = this.activeOneShotHandoff
    if (!handoff) return
    console.info(`[InkChapter] ONE-SHOT-HANDOFF RELEASED: ${handoff.handoffId} reason=${reason}`)
    this.activeOneShotHandoff = null
  }

  /**
   * SINGLE-DOT-TRACE: automatically record state when user types "." or "。".
   *
   * Verifies that single-dot input never creates FORCE_INDENT semantic or
   * modifies sidecar. If violation detected → HARD STOP.
   */
  private traceSingleDotIfMatch(paragraph: HTMLElement | null, settings: import('./heading-types').ParagraphLayoutSettings): void {
    if (!paragraph) return
    const visibleText = getUserVisibleParagraphText(paragraph)
    // Only trace exact single dot "。" or "."
    if (visibleText !== '。' && visibleText !== '.') return

    const docKey = this.getDocumentKey()
    const semanticBefore = getParagraphIndentMode(paragraph)
    const computedBefore = window.getComputedStyle(paragraph).textIndent
    const overrides = this.inMemoryOverrides.get(docKey ?? '') ?? []
    const sidecarCountBefore = overrides.length

    const rehydrateDecision = this.getLastRehydrateDecision()

    const trace: Record<string, unknown> = {
      type: 'SINGLE-DOT-TRACE',
      timestamp: Date.now(),
      documentKey: docKey ?? 'unknown',
      paragraphIdentity: getElementIdentity(paragraph),
      visibleText,
      semanticBefore,
      semanticAfter: semanticBefore,
      computedIndentBefore: computedBefore,
      computedIndentAfter: computedBefore,
      effectiveClassBefore: paragraph.className ? String(paragraph.className).slice(0, 120) : null,
      effectiveClassAfter: paragraph.className ? String(paragraph.className).slice(0, 120) : null,
      sidecarRecordCountBefore: sidecarCountBefore,
      sidecarRecordCountAfter: sidecarCountBefore,
      lastSemanticWriter: (() => {
        const h = getParagraphWriterHistory(paragraph)
        const lastSemantic = [...h].reverse().find(w => w.writerId.includes('SEMANTIC'))
        return lastSemantic?.writerId ?? null
      })(),
      lastVisualWriter: (() => {
        const h = getParagraphWriterHistory(paragraph)
        const lastVisual = [...h].reverse().find(w =>
          w.writerId.includes('VISUAL') || w.writerId.includes('PROJECTION') || w.writerId.includes('REFRESH')
        )
        return lastVisual?.writerId ?? null
      })(),
      writerHistoryTail: (() => {
        const h = getParagraphWriterHistory(paragraph)
        return h.slice(-5).map(w => ({ id: w.writerId, reason: w.reason, relMs: w.relativeMs }))
      })(),
      rehydrateDecisionId: rehydrateDecision?.rehydrateAttemptId ?? null,
      selectedRecordId: rehydrateDecision?.selectedRecordId ?? null,
      matchStrategy: rehydrateDecision?.matchStrategy ?? null,
      candidateCount: rehydrateDecision?.candidateCount ?? 0,
      ambiguity: rehydrateDecision?.ambiguityDetected ?? false,
      blocked: rehydrateDecision?.rehydrateBlocked ?? false,
    }

    console.info(`[InkChapter] SINGLE-DOT-TRACE: text="${visibleText}" semantic=${semanticBefore} computed=${computedBefore} sidecar=${sidecarCountBefore}`)

    // Record to observation
    const obs = this.activeEnterTransaction ? [...this.observations.values()].find(o => o.txnId === this.activeEnterTransaction?.id) : null
    if (obs) {
      obs.traceData[`SINGLE-DOT-${Date.now()}`] = trace
    }

    // HARD STOP: single dot must NEVER create FORCE_INDENT
    if (semanticBefore !== 'auto') {
      console.error(`[InkChapter] SINGLE_DOT_SEMANTIC_VIOLATION: text="${visibleText}" semantic=${semanticBefore} — HARD STOP`)
      console.error('[InkChapter] VIOLATION DETAILS:', JSON.stringify(trace, null, 2))
    }
  }

  private lastRehydrateDecisionSnapshot: RehydrateMatchProvenance | null = null

  private getLastRehydrateDecision(): RehydrateMatchProvenance | null {
    return this.lastRehydrateDecisionSnapshot
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

    applyEffectiveParagraphIndent(block, effective, WriterIds.LOCAL_PROJECTION_VISUAL)
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
  private placeCaretInParagraph(paragraph: HTMLElement): CaretWriteResult {
    const result: CaretWriteResult = {
      success: false,
      caretWritten: false,
      targetConnected: false,
      realmSafe: false,
      method: 'none',
      resolvedParagraphIdentity: null,
    }

    // ── P0-4: structured validation ──
    if (!paragraph) {
      result.failReason = 'null-target'
      return result
    }

    // ── P0-3: Realm-safe Node validation ──
    // Use ownerDocument to avoid cross-realm instanceof failures
    const ownerDoc = paragraph.ownerDocument
    if (!ownerDoc) {
      result.failReason = 'no-ownerDocument'
      console.info('[InkChapter] CARET_TARGET_INVALID: no ownerDocument (cross-realm?)')
      return result
    }

    // Validate against owner document's Node constructor
    try {
      if (!(paragraph instanceof ownerDoc.defaultView!.Node)) {
        result.failReason = 'not-a-node-in-realm'
        console.info('[InkChapter] CARET_TARGET_INVALID: paragraph is not a Node in owner document realm')
        return result
      }
    } catch {
      result.failReason = 'instanceof-check-failed'
      console.info('[InkChapter] CARET_TARGET_INVALID: instanceof check threw (cross-realm)')
      return result
    }

    result.realmSafe = true

    if (!paragraph.isConnected) {
      result.failReason = 'disconnected'
      console.info('[InkChapter] CARET_TARGET_INVALID: paragraph not connected')
      return result
    }
    result.targetConnected = true

    // ── P0-3: Use ownerDocument.createRange() ──
    try {
      const sel = ownerDoc.defaultView?.getSelection()
      if (!sel) {
        result.failReason = 'no-selection'
        return result
      }

      const range = ownerDoc.createRange()

      // Find first text node or BR
      const firstChild = paragraph.firstChild
      if (firstChild?.nodeType === ownerDoc.defaultView!.Node.TEXT_NODE) {
        range.setStart(firstChild, 0)
      } else if (firstChild?.nodeName === 'BR') {
        range.setStartBefore(firstChild)
      } else {
        range.setStart(paragraph, 0)
      }
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)

      result.caretWritten = true
      result.success = true
      result.method = 'owner-realm-range'
      result.resolvedParagraphIdentity = getElementIdentity(paragraph)
    } catch (e) {
      result.failReason = `range-error: ${e}`
      console.info('[InkChapter] CARET_WRITE_FAILED:', e)
    }

    return result
  }

  /**
   * Unified entry point: apply paragraph indent override.
   * Handles both runtime semantic state and sidecar persistence.
   * Used by both shortcut and manual command.
   */
  applyParagraphIndentOverride(
    paragraph: HTMLElement,
    mode: 'force-indent' | 'force-flush' | 'auto',
    writerId?: string,
  ): void {
    setParagraphIndentMode(paragraph, mode, writerId)
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
  private sidecarGeneration = 0

  private scheduleSidecarWrite(docKey: string, docPath: string, overrides: ParagraphIndentOverrideRecord[]): void {
    // Deep clone records + anchors for immutable snapshot.
    // Prevents 200ms debounce window mutations from corrupting the pending write.
    const snapshot = overrides.map(o => ({
      ...o,
      anchor: { ...o.anchor },
    }))
    this.sidecarWritePending = { docKey, docPath, overrides: snapshot }
    const gen = ++this.sidecarGeneration
    if (this.sidecarWriteTimer !== null) clearTimeout(this.sidecarWriteTimer)
    this.sidecarWriteTimer = setTimeout(() => {
      this.sidecarWriteTimer = null
      const pending = this.sidecarWritePending
      // Only execute if no newer generation has been scheduled
      if (pending && this.sidecarGeneration === gen) {
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

  // ── Two-Pass Rehydrate Pipeline (r53 P0-A) ──────────────────────

  /**
   * Phase 1: Resolve ALL sidecar records into candidates.
   * Phase 2: Group candidates by target paragraph ownership.
   * Phase 3: Build plan (winners + blocked groups).
   *
   * NO semantic/visual/sidecar/caret writers during Phase 1/2.
   * This eliminates the first-candidate leak where the first record
   * is applied before later records for the same paragraph are discovered.
   *
   * Shared by both rehydrateParagraphIndentOverrides and
   * reconstructParagraphOverridesFromSidecar.
   */
  private resolveParagraphOverrideRehydratePlan(
    docKey: string,
    docPath: string,
    allRecords: ParagraphIndentOverrideRecord[],
    allParas: HTMLElement[],
    source: 'rehydrate' | 'reconstruct',
  ): ParagraphRehydratePlan {
    const planId = `plan-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const resolvedCandidates: RehydrateResolvedCandidate[] = []
    let phase1WriterCount = 0

    // ── Phase 1: RESOLVE ALL — NO writers allowed ──
    // Promote temporary anchors first (same logic as before)
    let dirty = false
    for (const o of allRecords) {
      if (!o.temporary) continue
      if (o.mode !== 'force-indent' && o.mode !== 'force-flush') continue
      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (resolved) {
        const para = allParas[resolved.index]
        if (para && para.textContent?.trim()) {
          const newAnchor = createParagraphAnchor(resolved.index, allParas)
          o.anchor = newAnchor
          o.temporary = false
          dirty = true
        }
      }
    }

    // Resolve ALL explicit records
    for (const o of allRecords) {
      if (o.mode !== 'force-indent' && o.mode !== 'force-flush') continue
      const resolved = resolveParagraphAnchor(o.anchor, allParas)
      if (!resolved) continue

      const para = allParas[resolved.index]
      if (!para) continue

      const matchConfidence = anchorConfidenceToRehydrateConfidence(resolved.confidence)

      let matchStrategy: typeof RehydrateMatchStrategy[keyof typeof RehydrateMatchStrategy]
      switch (resolved.confidence) {
        case 'exact':
          matchStrategy = o.anchor.textHash ? RehydrateMatchStrategy.EXACT_ANCHOR : RehydrateMatchStrategy.INDEX_FALLBACK
          break
        case 'high':
          matchStrategy = RehydrateMatchStrategy.NORMALIZED_ANCHOR
          break
        case 'medium':
          matchStrategy = RehydrateMatchStrategy.PROXIMITY
          break
        case 'fallback':
          matchStrategy = RehydrateMatchStrategy.INDEX_FALLBACK
          break
      }

      const score = resolved.confidence === 'exact' ? 100 : resolved.confidence === 'high' ? 5 : resolved.confidence === 'medium' ? 3 : 1

      resolvedCandidates.push({
        recordId: o.id,
        recordMode: o.mode,
        record: { ...o },
        targetParagraph: para,
        targetParagraphIndex: resolved.index,
        strategy: matchStrategy,
        confidence: matchConfidence,
        score,
        candidateCountAtGroup: 0, // filled in Phase 2
      })
    }

    // ── Phase 1 invariant check ──
    if (phase1WriterCount > 0) {
      console.error(`[InkChapter] REHYDRATE_PHASE1_WRITER_VIOLATION: writers=${phase1WriterCount} — HARD FAIL`)
    }

    // ── Phase 2: GROUP OWNERSHIP ──
    const groups = buildRehydrateOwnershipGroups(resolvedCandidates)

    // Update candidateCountAtGroup for all candidates
    for (const group of groups) {
      for (const c of group.candidates) {
        c.candidateCountAtGroup = group.candidateCount
      }
    }

    // ── Phase 3: DECIDE — determine winners and blocked groups ──
    // For single-owner groups, also run match safety check
    const winners: RehydrateResolvedCandidate[] = []
    const blockedGroups: RehydrateOwnershipGroup[] = []

    for (const group of groups) {
      if (group.decision === 'block') {
        blockedGroups.push(group)
        // Log REHYDRATE-GROUP for blocked
        console.info(`[InkChapter] REHYDRATE-GROUP: target=${group.targetElementIdentity} targetIndex=${group.targetParagraphIndex} candidateRecordIds=[${group.candidateRecordIds.join(',')}] candidateModes=[${group.candidateModes.join(',')}] candidateCount=${group.candidateCount} decision=BLOCK reason=${group.reason}`)
        continue
      }

      // Single-owner: run match safety
      if (!group.winner) continue
      const winner = group.winner

      const currentSemantic = getParagraphIndentMode(winner.targetParagraph)

      const provenance: RehydrateMatchProvenance = {
        timestamp: Date.now(),
        rehydrateAttemptId: `${planId}-${winner.recordId}`,
        txnId: this.activeEnterTransaction?.id ?? null,
        observationId: null,
        targetParagraphIdentity: getElementIdentity(winner.targetParagraph),
        targetText: winner.targetParagraph.textContent?.slice(0, 80) ?? null,
        targetUserVisibleText: getUserVisibleParagraphText(winner.targetParagraph) || null,
        currentSemantic,
        candidateRecords: [],
        candidateCount: 1,
        selectedRecordId: winner.recordId,
        selectedRecordMode: winner.recordMode,
        matchStrategy: winner.strategy,
        matchConfidence: winner.confidence,
        ambiguityDetected: false,
        rehydrateBlocked: false,
      }

      const blockReason = evaluateRehydrateSafety(provenance)
      if (blockReason) {
        group.decision = 'block'
        group.reason = blockReason
        blockedGroups.push(group)
        console.info(`[InkChapter] REHYDRATE-GROUP: target=${group.targetElementIdentity} candidateCount=1 decision=BLOCK reason=${blockReason}`)
        continue
      }

      winners.push(winner)
      console.info(`[InkChapter] REHYDRATE-GROUP: target=${group.targetElementIdentity} candidateCount=1 decision=APPLY winner=${winner.recordId} mode=${winner.recordMode}`)
    }

    // ── REHYDRATE-PLAN summary ──
    console.info(`[InkChapter] REHYDRATE-PLAN: planId=${planId} documentKey=${docKey} source=${source} recordCount=${allRecords.length} resolvedCandidateCount=${resolvedCandidates.length} groupCount=${groups.length} winnerCount=${winners.length} blockedGroupCount=${blockedGroups.length} phase1WriterCount=${phase1WriterCount}`)

    return {
      planId,
      documentKey: docKey,
      allRecords,
      resolvedCandidates,
      groups,
      winners,
      blockedGroups,
      phase1WriterCount,
    }
  }

  /**
   * Phase 4: Apply safe winners from the rehydrate plan.
   * Only winners with group.length===1 + match safety pass are applied.
   * Also handles anchor repair and sidecar persistence.
   */
  private applyParagraphRehydratePlan(plan: ParagraphRehydratePlan): void {
    if (plan.winners.length === 0) return

    const root = this.adapter.getEditorRoot()
    if (!root) return
    const allParas = collectContentParagraphs(root)
    const settings = this.getParagraphLayoutSettings()

    let dirty = false

    for (const winner of plan.winners) {
      const para = winner.targetParagraph
      if (!para?.isConnected) continue

      const rehydrateCtx: RehydrateContext = {
        source: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey) ? 'rehydrate' : 'sidecar-reconstruct',
        semanticWriterId: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey)
          ? WriterIds.REHYDRATE_SEMANTIC
          : WriterIds.SIDECAR_RECONSTRUCT_SEMANTIC,
        visualWriterId: plan.allRecords === this.inMemoryOverrides.get(plan.documentKey)
          ? WriterIds.REHYDRATE_VISUAL
          : WriterIds.SIDECAR_RECONSTRUCT_VISUAL,
      }

      // Atomic rehydrate: semantic + visual in ONE synchronous call
      rehydrateParagraphIndentState(para, winner.recordMode, settings, rehydrateCtx)

      // Auto-repair anchor
      if (winner.targetParagraphIndex >= 0 && winner.targetParagraphIndex < allParas.length) {
        winner.record.anchor = updateParagraphAnchor(winner.record.anchor, winner.targetParagraphIndex, allParas)
        // Update in-memory copy
        const orig = plan.allRecords.find(r => r.id === winner.recordId)
        if (orig) {
          orig.anchor = winner.record.anchor
          orig.temporary = !para.textContent?.trim()
        }
        dirty = true
      }
    }

    // Persist repaired anchors to sidecar (debounced)
    if (dirty) {
      const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
      this.scheduleSidecarWrite(plan.documentKey, docPath, [...plan.allRecords])
    }
  }

  /**
   * Rehydrate explicit force-indent overrides from in-memory registry.
   * Called before every refreshParagraphIndentStyles so that explicit
   * overrides survive Normal Enter / paragraph split / DOM rebuild.
   *
   * Also promotes temporary anchors (empty paragraph) to stable anchors
   * when the user has typed text, and triggers a debounced sidecar write
   * to persist stable anchors for save/reopen round-trip.
   *
   * r53 P0-A: Uses two-pass pipeline — RESOLVE ALL → GROUP → DECIDE → APPLY.
   */
  private rehydrateParagraphIndentOverrides(root: HTMLElement): void {
    // ── P0-5: One-shot handoff check (replaces old Pending) ──────
    this.tryExecuteOneShotHandoff(Array.from(root.querySelectorAll('p')) as HTMLElement[])

    const docKey = this.getDocumentKey()
    if (!docKey) return
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'
    const overrides = this.inMemoryOverrides.get(docKey)
    if (!overrides || overrides.length === 0) return

    const allParas = collectContentParagraphs(root)
    if (allParas.length === 0) return

    // ── Build and apply the plan ──
    const plan = this.resolveParagraphOverrideRehydratePlan(
      docKey, docPath, overrides, allParas, 'rehydrate',
    )
    this.applyParagraphRehydratePlan(plan)
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

    // Populate in-memory registry from sidecar (deep clone)
    const loadedOverrides = data.paragraphOverrides.map(o => ({ ...o }))
    this.inMemoryOverrides.set(docKey, loadedOverrides)

    const root = this.adapter.detectEditorRoot()
    if (!root) return

    // First, run legacy migration if markers exist in Markdown
    this.migrateLegacyMarkersIfPresent()

    const allParas = collectContentParagraphs(root)
    const docPath = this.ctx.getActiveFilePath?.() ?? 'unknown'

    // ── Two-Pass Pipeline: shared with rehydrateParagraphIndentOverrides ──
    const overrides = this.inMemoryOverrides.get(docKey)!
    const plan = this.resolveParagraphOverrideRehydratePlan(
      docKey, docPath, overrides, allParas, 'reconstruct',
    )
    this.applyParagraphRehydratePlan(plan)

    // ── P0-2: Only save when dirty (winners applied or anchors repaired) ──
    // Check if any anchor changed by comparing with original loaded data
    let reconstructDirty = false
    for (const o of loadedOverrides) {
      const orig = data.paragraphOverrides.find(r => r.id === o.id)
      if (!orig) { reconstructDirty = true; break }
      if (JSON.stringify(o.anchor) !== JSON.stringify(orig.anchor)) {
        reconstructDirty = true
        break
      }
    }
    if (reconstructDirty) {
      saveParagraphLayout(docKey, docPath, loadedOverrides)
    }
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

      this.applyParagraphIndentOverride(ctx.paragraph, 'force-flush', WriterIds.BACKSPACE_SEMANTIC)

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

      // ── SINGLE-DOT-TRACE (P0 diagnostic) ──
      // Auto-trace single "." / "。" input to verify semantic stays AUTO.
      {
        const dotBlock = resolveCurrentBlockFromSelection(root)
        const dotSettings = this.getParagraphLayoutSettings()
        this.traceSingleDotIfMatch(dotBlock, dotSettings)
      }

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
