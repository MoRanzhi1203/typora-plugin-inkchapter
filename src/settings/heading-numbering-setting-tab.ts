import { SettingTab } from '@typora-community-plugin/core'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings-model'
import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingDescriptor,
  HeadingNumberingPreset,
  HeadingNumberingSettings,
  NumberTokenStyle,
  MultilevelFormatSegment,
  ContextualFormatSegment,
  MaxHeadingLevel,
  HeadingSettingsScope,
  CustomNumberingFormat,
  FormatLibrary,
  NumberingFormatSource,
  FormatBasedOn,
  BuiltInPresetId,
  HeadingNumberingDocumentOverride,
  NumberTitleSpacing,
  ParagraphLayoutSettings,
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS, generateStableId, clampMaxLevel, BUILT_IN_PRESET_IDS } from '../heading-numbering/heading-types'
import { resolveHeadingStructure, resolveStyleSlot, resolvePhysicalHeadingForStyleSlot, validateHeadingStructure } from '../heading-numbering/heading-structure'
import type { HeadingStructureMode, StyleSlot } from '../heading-numbering/heading-structure'
import { emitRuntimeAudit } from '../runtime/forensic-log-sink'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'
import type { NumberFormatSegment } from '../heading-numbering/heading-types'
import { deepCloneSettings } from '../heading-numbering/heading-numbering-scope-store'
import { resolveEffectiveParagraphIndent } from '../heading-numbering/paragraph-indent-manager'
import { Notice } from '@typora-community-plugin/core'
import type { CaptionService } from '../heading-numbering/caption-service'
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings, type CaptionTargetType } from '../heading-numbering/caption-system'
import {
  DEFAULT_OBJECT_NUMBERING_CONFIG,
  validateNumberTemplate,
  type ObjectNumberingConfig,
  type ObjectNumberingType,
  type ObjectPosition,
} from '../heading-numbering/object-numbering-engine'
import { migrateObjectNumberingConfig } from '../heading-numbering/object-numbering-settings'
import {
  buildPresetPreview,
  getPublicPresetOptions,
  type ObjectNumberingPreset,
} from '../heading-numbering/object-numbering-presets'
import {
  moveSegmentToResolvedIndex,
  calculateTargetIndexAfterRemoval,
  normalizeFormatAfterDrag,
  normalizeMultilevelFormatAfterDrag,
  normalizeContextualFormatAfterDrag,
  createDragState,
  createDebugLog,
} from '../heading-numbering/format-drag-utils'
import type { DragState } from '../heading-numbering/format-drag-utils'
import {
  computeHeadingNumbering,
  getAvailableReferenceLevels,
  getEffectiveFormatForLevel,
  getActiveFormatVariant,
  getActiveMultilevelFormatVariant,
  getAvailableMultilevelReferenceLevels,
  getActiveContextualFormatVariant,
  getAvailableContextualReferenceLevels,
  renderLevelTemplate,
  renderMultilevelFormat,
  renderContextualLevelReference,
  renderContextualFormat,
  updateActiveContextualFormatVariant,
  updateActiveMultilevelFormatVariant,
  ensureCurrentLevelSegment,
} from '../heading-numbering/numbering-engine'
import { PRESET_LIST, getPresetLevels } from '../heading-numbering/presets'
import {
  getFormatPreview,
  generateFormatId,
  createFormat,
  copyFormat,
  renameFormat,
  validateFormatName,
  deleteFormat,
  addFormatToLibrary,
  updateFormatInLibrary,
  findFormat,
  hideBuiltInPreset,
  showBuiltInPreset,
  isBuiltInPresetHidden,
  getVisibleBuiltInPresets,
  restoreBuiltInPresets,
  areAllBuiltInPresetsVisible,
  resetFormatLibrary as resetLibrary,
  getOrderedCustomFormats,
  migrateFormatLibrary,
  hasFormatUpdate,
  getFormatVersion,
} from '../heading-numbering/format-library'
import type { AppliedFormatInfo } from '../heading-numbering/format-library'
import {
  builtInFormatRef,
  customFormatRef,
  findFormatReferences,
  resolveDocumentFormatBinding,
  resolveDocumentFormatState,
  resolveFormatBadges,
  resolveGlobalDefaultFormatRef,
  type ResolvedDocumentFormat,
} from '../heading-numbering/document-format-binding'

/** Heading layout draft — independent of numbering draft and persisted state. */
interface HeadingLayoutDraft {
  headingLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig>
  numberTitleSpacing: Record<import('../heading-numbering/heading-types').HeadingLevel, import('../heading-numbering/heading-types').NumberTitleSpacing>
}

const TOKEN_STYLE_LABELS: { value: NumberTokenStyle; label: string; group?: string }[] = [
  { value: 'arabic', label: '阿拉伯数字 (1, 2, 3)', group: '数字' },
  { value: 'fullwidth-arabic', label: '全角阿拉伯数字 (１, ２, ３)', group: '数字' },
  { value: 'chinese', label: '中文数字 (一, 二, 三)', group: '数字' },
  { value: 'chinese-financial', label: '大写中文数字 (壹, 贰, 叁)', group: '数字' },
  { value: 'circled', label: '带圈数字 (①, ②, ③)', group: '数字' },
  { value: 'alpha-upper', label: '大写字母 (A, B, C)', group: '字母' },
  { value: 'alpha-lower', label: '小写字母 (a, b, c)', group: '字母' },
  { value: 'upper-greek', label: '大写希腊字母 (Α, Β, Γ)', group: '字母' },
  { value: 'lower-greek', label: '小写希腊字母 (α, β, γ)', group: '字母' },
  { value: 'heavenly-stems', label: '天干 (甲, 乙, 丙)', group: '传统序列' },
  { value: 'earthly-branches', label: '地支 (子, 丑, 寅)', group: '传统序列' },
  { value: 'roman-upper', label: '大写罗马 (I, II, III)', group: '罗马数字' },
  { value: 'roman-lower', label: '小写罗马 (i, ii, iii)', group: '罗马数字' },
]

const PRESET_CARDS: { key: HeadingNumberingPreset; name: string; desc: string; previewLines: string[] }[] = [
  { key: 'decimal-hierarchical', name: '十进制层级', desc: '通用阿拉伯数字多级编号', previewLines: ['1', '1.1', '1.1.1'] },
  { key: 'chinese-chapter', name: '中文章节', desc: '章、节与中文条目结构', previewLines: ['第一章', '第一节', '一、'] },
  { key: 'chinese-outline', name: '党政公文（四级）', desc: '党政机关公文常用四级结构', previewLines: ['一、', '（一）', '1.'] },
  { key: 'academic-paper', name: '学术论文', desc: '章标题与十进制层级结合', previewLines: ['第一章', '1.1', '1.1.1'] },
  { key: 'chapter-section-clause', name: '章—节—条款', desc: '章节、节次与条款结构', previewLines: ['第1章', '第1节', '第1条'] },
  { key: 'appendix-hierarchical', name: '附录层级', desc: '附录及补充材料编号', previewLines: ['附录A', 'A.1', 'A.1.1'] },
  { key: 'roman-hierarchical', name: '全罗马层级', desc: '所有层级均使用大写罗马数字', previewLines: ['I', 'I.I', 'I.I.I'] },
  { key: 'roman-mixed', name: '罗马混合层级', desc: '首级罗马、后级阿拉伯', previewLines: ['I', 'I.1', 'I.1.1'] },
  { key: 'letter-mixed', name: '字母混合层级', desc: '字母、数字与小写罗马混合', previewLines: ['A', 'A.1', 'A.1.a'] },
]

const DRAG_THRESHOLD = 4
const DEBUG_DRAG = false

interface OpenFormatMenuState {
  formatType: 'built-in' | 'custom'
  formatId: string
  formatName: string
  triggerElement: HTMLElement
}

function getLevelLabel(physicalLevel: number, mode: HeadingStructureMode): string {
  if (physicalLevel === 1 && mode === 'strict') return 'H1 · 文档题目'
  return `H${physicalLevel}`
}

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private previewEl: HTMLElement | null = null
  private miniPreviewEls: Map<number, HTMLElement> = new Map()
  private expandedLevel: HeadingLevel | null = null
  private selectEl: HTMLSelectElement | null = null
  private selectedSegmentId: string | null = null

  /** Get the default level to select when first viewing a format. */
  private getDefaultEditableLevel(s: HeadingNumberingSettings): HeadingLevel {
    const structure = this.resolveStructureFromDraft(s)
    const numberingRoot = structure.numberingRootPhysicalLevel
    // Find the first enabled level starting from the numbering root
    for (const lv of HEADING_LEVELS) {
      const slotLv = this.resolveSlotLevel(lv)
      if (slotLv === null) continue // strict H1: no slot
      const ls = s.levels[slotLv]
      if (ls?.enabled) return lv
    }
    return numberingRoot
  }

  /** Resolve the effective heading structure from draft or effective settings. */
  private resolveStructureFromDraft(s: HeadingNumberingSettings): import('../heading-numbering/heading-structure').ResolvedHeadingStructure {
    return resolveHeadingStructure(s)
  }

  /** Get H1 structure validation for the current document. */
  private getStructureValidation(s: HeadingNumberingSettings): import('../heading-numbering/heading-structure').HeadingStructureValidation | null {
    try {
      const root = document.getElementById('write')
      if (!root) return null
      const h1Elements = root.querySelectorAll('h1')
      const headings = Array.from(h1Elements).map(() => ({ level: 1 }))
      // Also count H2-H6 for full heading set
      for (let lv = 2; lv <= 6; lv++) {
        const els = root.querySelectorAll(`h${lv}`)
        headings.push(...Array.from(els).map(() => ({ level: lv })))
      }
      const structure = resolveHeadingStructure(s)
      return validateHeadingStructure(headings, structure.mode)
    } catch { return null }
  }

  // ── H1 sync ──────────────────────────────────────
  private globalH1Toggle: HTMLInputElement | null = null
  private syncingLevelOneUi = false
  private unsubSettings: (() => void) | null = null
  private unsubDocument: (() => void) | null = null
  private unsubStrictFirstH1: (() => void) | null = null

  // ── Drag ─────────────────────────────────────────
  private dragState: DragState | null = null

  // ── Level range draft state ──────────────────────
  /** In-memory draft for the level range UI. Never persisted until user clicks 确定. */
  private rangeDraft: {
    globalMaxLevel: MaxHeadingLevel
    documentMode: 'inherit' | 'custom'
    documentMaxLevel: MaxHeadingLevel
    globalDirty: boolean
    documentDirty: boolean
  } = { globalMaxLevel: 6, documentMode: 'inherit', documentMaxLevel: 6, globalDirty: false, documentDirty: false }

  // ── Heading numbering scope & draft ──────────────
  private headingScope: HeadingSettingsScope = 'document'
  private headingDraft: HeadingNumberingSettings | null = null
  private headingDraftOriginal: HeadingNumberingSettings | null = null

  // ── Heading layout draft (independent of numbering draft) ──
  /** Current in-memory layout draft. null = no unsaved changes. */
  private headingLayoutDraft: HeadingLayoutDraft | null = null
  /** Deep-cloned snapshot of the persisted layout state. Used for dirty detection and cancel. */
  private savedLayoutDraft: HeadingLayoutDraft | null = null

  // ── Format library state ─────────────────────────
  /** Cached format library from settings. */
  private formatLibrary: FormatLibrary = { version: 1, formats: [], preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] } }
  /** Currently selected format ID for editing/viewing (null = scope draft). */
  private selectedFormatId: string | null = null
  /** Type of currently selected format: 'built-in' (system) or 'custom' (user). */
  private selectedFormatType: 'built-in' | 'custom' | null = null
  /** Draft of the format being edited. */
  private formatDraft: CustomNumberingFormat | null = null
  /** Saved baseline of the format being edited (for dirty detection). */
  private savedFormatBaseline: CustomNumberingFormat | null = null
  /** Currently open card menu state. null if closed. */
  private openMenuState: OpenFormatMenuState | null = null
  private menuCleanups: Array<() => void> = []
  /** Whether the management panel is open. */
  private managePanelOpen = false

  // ── Layout collapse & selection states ──────────
  /** Currently selected card key (preset key or format id) for the format summary. */
  private selectedCardKey: string | null = null
  /** Whether the selected card is a system preset (true) or user format (false). */
  private selectedCardIsPreset = false
  private selectedLayoutLevel: HeadingLevel | null = null

  // ── Paragraph layout draft ───────────────────────
  private paragraphLayoutDraft: ParagraphLayoutSettings | null = null
  private savedParagraphLayoutBaseline: ParagraphLayoutSettings | null = null
  private paragraphLayoutScope: 'global' | 'document' = 'global'

  /** Initialize the draft from persisted settings. */
  private initRangeDraft(): void {
    const rangeSettings = this.numberingService.getLevelRangeSettings()
    const docPath = this.numberingService.getActiveFilePath()
    const docOverride = docPath ? rangeSettings.documentOverrides[docPath] : undefined

    this.rangeDraft = {
      globalMaxLevel: rangeSettings.defaultMaxLevel,
      documentMode: docOverride?.mode ?? 'inherit',
      documentMaxLevel: docOverride?.maxLevel ?? rangeSettings.defaultMaxLevel,
      globalDirty: false,
      documentDirty: false,
    }
  }

  /** Mark global section as dirty and enable its buttons. */
  private markGlobalDirty(): void {
    this.rangeDraft.globalDirty = true
    this.updateRangeButtons()
  }

  /** Mark document section as dirty and enable its buttons. */
  private markDocumentDirty(): void {
    this.rangeDraft.documentDirty = true
    this.updateRangeButtons()
  }

  /** Revert global draft to persisted state. */
  private revertGlobalDraft(): void {
    const rangeSettings = this.numberingService.getLevelRangeSettings()
    this.rangeDraft.globalMaxLevel = rangeSettings.defaultMaxLevel
    this.rangeDraft.globalDirty = false
  }

  /** Revert document draft to persisted state. */
  private revertDocumentDraft(): void {
    const rangeSettings = this.numberingService.getLevelRangeSettings()
    const docPath = this.numberingService.getActiveFilePath()
    const docOverride = docPath ? rangeSettings.documentOverrides[docPath] : undefined
    this.rangeDraft.documentMode = docOverride?.mode ?? 'inherit'
    this.rangeDraft.documentMaxLevel = docOverride?.maxLevel ?? rangeSettings.defaultMaxLevel
    this.rangeDraft.documentDirty = false
  }

  /** Re-render just the range buttons (for dirty state changes). */
  private updateRangeButtons(): void {
    // Re-render the level range section to refresh button states
    // We skip full onshow to avoid losing other UI state
    const sectionEl = this.containerEl.querySelector('.inkchapter-levelrange-global')
    if (!sectionEl) return
    // Re-render by removing and re-appending
    this.containerEl.innerHTML = ''
    this.render()
  }

  constructor(
    private settings: PluginSettings<InkChapterSettings>,
    private numberingService: HeadingNumberingService,
    private captionService?: CaptionService,
  ) {
    super()
  }

  // ── Caption settings draft state ──────────────────
  private captionDraft: CaptionSettings | null = null
  private savedCaptionBaseline: CaptionSettings | null = null
  private captionFormulaDraft: ObjectNumberingConfig | null = null
  private savedCaptionFormulaBaseline: ObjectNumberingConfig | null = null

  onshow(): void {
    this.cancelDrag()
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild)
    }
    // Clear layout draft so it re-reads from persisted state
    this.headingLayoutDraft = null
    this.savedLayoutDraft = null
    // Clear paragraph layout draft
    this.paragraphLayoutDraft = null
    this.savedParagraphLayoutBaseline = null
    // Auto-select the currently applied format on page open (system or custom)
    if (!this.selectedFormatId) {
      const info = this.getAppliedFormatInfo()
      if (info.source?.type === 'built-in' && info.source.presetId) {
        this.selectedFormatId = info.source.presetId
        this.selectedFormatType = 'built-in'
        this.formatDraft = null
        this.savedFormatBaseline = null
        this.selectedCardKey = info.source.presetId
        this.selectedCardIsPreset = true
        this.loadPresetForViewing(info.source.presetId)
      } else if (info.source?.type === 'custom' && info.formatId) {
        const format = this.numberingService.getFormatLibrary().formats.find(f => f.id === info.formatId)
        if (format) {
          this.selectedCardKey = info.formatId
          this.selectedCardIsPreset = false
          this.initializeFormatEditor(format)
        }
      }
    }
    // Subscribe to external settings changes (F1 commands, etc.)
    if (!this.unsubSettings) {
      this.unsubSettings = this.numberingService.onSettingsChanged(() => {
        this.syncFromExternalChange()
      })
    }
    // Subscribe to document changes (file switch) to refresh card states
    if (!this.unsubDocument) {
      this.unsubDocument = this.numberingService.onDocumentChanged(() => {
        this.handleDocumentSwitch()
      })
    }
    // Subscribe to STRICT-FIRST-H1 runtime state changes for auto-refresh
    if (!this.unsubStrictFirstH1) {
      this.unsubStrictFirstH1 = this.numberingService.onStrictFirstH1Changed(() => {
        this.rerender()
      })
    }
    // Initialize draft state from persisted settings
    this.initRangeDraft()
    this.initCaptionDraft()
    try {
      this.render()
    } catch (e) {
      console.error('[InkChapter] SettingTab render 失败:', e)
      const errEl = document.createElement('div')
      errEl.style.cssText = 'padding:16px;color:#e00;'
      errEl.textContent = '[错误] 设置页面渲染失败: ' + (e instanceof Error ? e.message : String(e))
      this.containerEl.appendChild(errEl)
    }
  }

  onhide(): void {
    this.closeMenu()
    this.cancelDrag()
    if (this.unsubSettings) {
      this.unsubSettings()
      this.unsubSettings = null
    }
    if (this.unsubDocument) {
      this.unsubDocument()
      this.unsubDocument = null
    }
    if (this.unsubStrictFirstH1) {
      this.unsubStrictFirstH1()
      this.unsubStrictFirstH1 = null
    }
  }

  // ── H1 visibility: unified entry point ───────────

  /**
   * Apply level-one numbering visibility change from any source.
   * This is the single entry point for all H1 toggle operations.
   */
  private async applyLevelOneVisibility(
    enabled: boolean,
    source: 'global-toggle' | 'h1-panel' | 'command' | 'settings-load',
  ): Promise<void> {
    const s = this.headingSettings
    if (s.showLevelOneNumber === enabled) return // no-op

    // Cancel any active drag on H1 tags
    this.cancelDrag('h1-visibility-changed')

    // Persist via service (single write)
    this.numberingService.setShowLevelOneNumber(enabled)

    // Sync UI controls
    this.syncLevelOneControls(enabled)

    // Update preview and document
    this.refreshUI()
  }

  /** Sync both checkboxes and UI state without triggering events. */
  private syncLevelOneControls(enabled: boolean): void {
    this.syncingLevelOneUi = true
    try {
      if (this.globalH1Toggle) {
        this.globalH1Toggle.checked = enabled
      }
    } finally {
      this.syncingLevelOneUi = false
    }
  }

  /**
   * Called when settings change externally (menu toggle, F1 command, etc.).
   * Updates the draft (if any) with external changes, then re-renders the UI.
   */
  private syncFromExternalChange(): void {
    const effective = this.numberingService.getEffectiveSettings()
    if (this.headingDraft) {
      // Merge external toggle changes into draft without losing other edits
      this.headingDraft.enabled = effective.enabled
      this.headingDraft.showLevelOneNumber = effective.showLevelOneNumber
      this.headingDraft.headingStructureMode = effective.headingStructureMode
    }
    this.cancelDrag('settings-changed')
    this.onshow()
  }

  /**
   * Called when the active document changes (file switch).
   * Clears all document-specific state and re-renders for the new document.
   */
  private handleDocumentSwitch(): void {
    this.cancelDrag('document-switch')
    // Clear all document-specific draft state — new document means new settings
    this.headingDraft = null
    this.headingDraftOriginal = null
    this.formatDraft = null
    this.savedFormatBaseline = null
    this.selectedFormatId = null
    this.selectedFormatType = null
    this.headingLayoutDraft = null
    this.savedLayoutDraft = null
    this.selectedSegmentId = null
    // Reset card selection
    this.selectedCardKey = null
    this.selectedCardIsPreset = false
    // Re-init range draft for new document
    this.initRangeDraft()
    // Auto-select the new document's applied format
    const info = this.getAppliedFormatInfo()
    // [Diagnostic] Document switch log — remove after verification
    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()
    console.log('[InkChapter DocSwitch] path=' + (docPath ?? '(none)')
      + ' docKey=' + (docKey ?? '(none)')
      + ' formatSource=' + JSON.stringify(info.source)
      + ' inheritsGlobal=' + info.inheritsGlobal)
    if (info.source?.type === 'built-in' && info.source.presetId) {
      this.selectedFormatId = info.source.presetId
      this.selectedFormatType = 'built-in'
      this.formatDraft = null
      this.savedFormatBaseline = null
      this.selectedCardKey = info.source.presetId
      this.selectedCardIsPreset = true
      this.loadPresetForViewing(info.source.presetId)
    } else if (info.source?.type === 'custom' && info.formatId) {
      const format = this.numberingService.getFormatLibrary().formats.find(f => f.id === info.formatId)
      if (format) {
        this.selectedCardKey = info.formatId
        this.selectedCardIsPreset = false
        this.initializeFormatEditor(format)
      }
    }
    this.rerender()
  }

  private get headingSettings() {
    // Return draft if active, otherwise effective settings
    if (this.headingDraft) return this.headingDraft
    return this.numberingService.getEffectiveSettings()
  }

  /** Get the applied format info for the current document scope (what format the document actually uses). */
  private getAppliedFormatInfo(): AppliedFormatInfo {
    const scopeStore = this.numberingService.getScopeStore()
    const docKey = this.numberingService.getDocumentKey()
    
    if (!docKey) {
      // No document open — inherit global
      const gSource = (scopeStore.globalDefault as any).formatSource as NumberingFormatSource | undefined
      return {
        source: gSource ?? null,
        formatId: gSource?.type === 'custom' ? gSource.formatId : null,
        inheritsGlobal: true,
      }
    }
    
    const docOverride = scopeStore.documentOverrides[docKey]
    if (docOverride?.formatSource) {
      const src = docOverride.formatSource
      const info: AppliedFormatInfo = {
        source: src,
        formatId: src.type === 'custom' ? src.formatId : null,
        inheritsGlobal: false,
      }
      return info
    }
    
    // No document override — inherits global
    const gSource = (scopeStore.globalDefault as any).formatSource as NumberingFormatSource | undefined
    return {
      source: gSource ?? null,
      formatId: gSource?.type === 'custom' ? gSource.formatId : null,
      inheritsGlobal: true,
    }
  }

  /** Unified resolved document format state (single source for badges/buttons/top card). */
  private getResolvedDocumentFormat(): ResolvedDocumentFormat {
    const scopeStore = this.numberingService.getScopeStore()
    const docKey = this.numberingService.getDocumentKey()
    const binding = resolveDocumentFormatBinding(scopeStore, docKey)
    const globalDefaultFormatId = resolveGlobalDefaultFormatRef(scopeStore)
    return resolveDocumentFormatState(binding, globalDefaultFormatId)
  }

  /** Resolve a format reference key to its human-readable display name. */
  private formatRefDisplayName(ref: string | null): string {
    if (!ref) return '未设置'
    if (ref.startsWith('preset:')) {
      const presetId = ref.slice('preset:'.length)
      const preset = PRESET_CARDS.find(c => c.key === presetId)
      return preset ? preset.name : presetId
    }
    if (ref.startsWith('format:')) {
      const formatId = ref.slice('format:'.length)
      const fmt = this.formatLibrary.formats.find(f => f.id === formatId)
      return fmt ? fmt.name : formatId
    }
    return ref
  }

  /** Get the applied format version from the document override (for update detection). */
  private getAppliedFormatVersion(): number | undefined {
    const scopeStore = this.numberingService.getScopeStore()
    const docKey = this.numberingService.getDocumentKey()
    if (!docKey) return undefined
    const docOverride = scopeStore.documentOverrides[docKey]
    const source = docOverride?.formatSource
    return source?.type === 'custom' ? source.version : undefined
  }

  /** Determine the card state for a given format card. */
  private getCardState(key: string, isPreset: boolean):
    { applied: boolean; effective: boolean; currentDocument: boolean; isGlobalDefault: boolean; inheritsGlobal: boolean;
      /** Business state: template version > source version (for "应用更新" button). Independent of notice. */
      templateVersionNewer: boolean;
      /** Notice state: un-acknowledged template update (for one-time "有更新" notification). */
      pendingUpdateNotice: boolean;
      templateVersion?: number; sourceVersion?: number;
    }
  {
    const resolved = this.getResolvedDocumentFormat()
    const ref = isPreset ? builtInFormatRef(key) : customFormatRef(key)
    const badges = resolveFormatBadges(resolved, ref)

    const effective = badges.effective
    const currentDocument = badges.currentDocument
    const isGlobalDefault = badges.globalDefault
    const inheritsGlobal = resolved.mode === 'inherit'

    let templateVersionNewer = false
    let pendingUpdateNotice = false
    let templateVersion: number | undefined
    let sourceVersion: number | undefined

    // Template update check only applies to a custom format explicitly bound to
    // the current document (override). Inherited/global-default sources are
    // handled at the global scope and must not trigger a per-document update.
    if (!isPreset && currentDocument) {
      templateVersion = getFormatVersion(this.formatLibrary, key)
      sourceVersion = this.getAppliedFormatVersion()
      templateVersionNewer = (sourceVersion ?? 0) < (templateVersion ?? 0)

      if (templateVersionNewer) {
        const docKey = this.numberingService.getDocumentKey()
        pendingUpdateNotice = this.numberingService.isTemplateUpdatePending(docKey, key, templateVersion!)
      }
    }

    // `applied` is kept as a backward-compatible alias for `effective`.
    return { applied: effective, effective, currentDocument, isGlobalDefault, inheritsGlobal, templateVersionNewer, pendingUpdateNotice, templateVersion, sourceVersion }
  }

  /** Check if a card is the currently selected one for preview. */
  private isCardSelected(key: string, isPreset: boolean): boolean {
    return this.selectedCardKey === key && this.selectedCardIsPreset === isPreset
  }

  private render(): void {
    const s = this.headingSettings
    if (!s?.levels) {
      const errEl = document.createElement('div')
      errEl.style.cssText = 'padding:16px;color:#e00;'
      errEl.textContent = '[错误] 标题编号配置数据异常，请尝试重置设置'
      this.containerEl.appendChild(errEl)
      return
    }

    this.formatLibrary = this.numberingService.getFormatLibrary()
    this.formatLibrary = migrateFormatLibrary(this.formatLibrary)

    // Menu portal layer
    let menuLayer = this.containerEl.querySelector('.inkchapter-menu-layer') as HTMLElement | null
    if (!menuLayer) {
      menuLayer = document.createElement('div')
      menuLayer.className = 'inkchapter-menu-layer'
      menuLayer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:200;overflow:visible;'
      this.containerEl.appendChild(menuLayer)
    }

    // === A. Scope Card (current scope + basic settings) ===
    this.renderScopeCard(s)

    // === B. Format Library Card ===
    this.renderFormatLibraryCard(s)

    // === C. Format Content Settings Card (editor + spacing) ===
    this.renderCustomEditorCard(s)

    // === D. Document-level Advanced Settings Card ===
    this.renderAdvancedSettingsCard(s)

    // === E. Caption & Object Numbering Card ===
    this.renderCaptionCard()

    // === Bottom sticky action bar ===
    this.renderBottomActionBar()
  }

  // ── Preview ─────────────────────────────────────

  private updatePreview(): void {
    // Re-acquire preview element since DOM may have been rebuilt after onshow()
    const previewDom = this.containerEl.querySelector('.inkchapter-preview') as HTMLElement | null
    if (previewDom) this.previewEl = previewDom
    if (!this.previewEl) return
    this.previewEl.textContent = ''

    // Always use the draft if editing, otherwise the effective settings
    const s = this.headingDraft ?? this.numberingService.getEffectiveSettings()
    if (!s?.levels) return

    if (!s.enabled) {
      const disabledMsg = el('div', 'inkchapter-preview-disabled', this.previewEl)
      disabledMsg.textContent = '标题编号当前已关闭'
      for (const lv of HEADING_LEVELS) {
        const row = el('div', 'inkchapter-preview-row', this.previewEl)
        const label = el('span', 'inkchapter-preview-label', row)
        label.textContent = `H${lv} `
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = `${lv}级标题示例`
      }
      return
    }

    const syntheticHeadings: HeadingDescriptor[] = HEADING_LEVELS.map((lv) => ({
      key: `preview-h${lv}`,
      level: lv,
      text: `${lv}级标题示例`,
    }))

    const numbered = computeHeadingNumbering(syntheticHeadings, s)

    // Always render all H1-H6 rows. Strict H1 is visible but unnumbered.
    const structure = resolveHeadingStructure(s)
    for (const lv of HEADING_LEVELS) {
      const item = numbered.find(h => h.level === lv)
      const row = el('div', 'inkchapter-preview-row', this.previewEl)
      const label = el('span', 'inkchapter-preview-label', row)
      label.textContent = `H${lv} `

      // strict H1: document title, no number
      if (!structure.showLevelOneNumber && lv === 1) {
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = '文档题目示例'
        continue
      }

      // loose H6 unconfigured: native/original
      if (structure.showLevelOneNumber && lv === 6 && !s.s6Configured) {
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = '未自定义'
        continue
      }

      const token = el('span', 'inkchapter-preview-token', row)
      token.textContent = item?.label || `（无编号）`
    }
  }

  // ── UI helpers ───────────────────────────────────

  private refreshUI(): void {
    this.updatePreview()
  }

  private handlePresetSelect(preset: HeadingNumberingPreset): void {
    this.cancelDrag()
    this.selectedFormatId = null
    this.selectedFormatType = null
    this.formatDraft = null
    this.savedFormatBaseline = null
    this.ensureDraft()
    const s = this.headingDraft!
    if (preset === 'custom') {
      const isFirstTime = !s.customDefinition || Object.keys(s.customDefinition).length === 0
      if (isFirstTime) {
        // First time entering Custom: reset all levels to current-level-only format.
        // We must explicitly clear contextualFormatVariants first because
        // ensureAllLevelsHaveCurrentSegment only adds when missing — but
        // preset formats already contain multi-level references (e.g. [H1].[H2].[H3])
        // which would pass the "any ref exists" check and keep old multi-level data.
        for (const lv of HEADING_LEVELS) {
          const slotLv = this.resolveSlotLevel(lv)
          if (slotLv === null) continue // strict H1: no slot
          const ls = s.levels[slotLv]
          if (!ls) continue
          const soloSeg: ContextualFormatSegment = {
            id: generateStableId(),
            type: 'level-reference',
            level: slotLv,
            appearance: { tokenStyle: ls.tokenStyle, prefix: '', suffix: '' },
          }
          ls.contextualFormatVariants = {
            withLevelOne: [{ ...soloSeg, id: generateStableId() }],
            withoutLevelOne: lv === 1 ? [] : [{ ...soloSeg, id: generateStableId() }],
          }
        }
        s.customDefinition = deepCloneSettings(s).levels
      } else {
        // Restore from previous customization
        s.levels = deepCloneSettings({ ...s, levels: s.customDefinition! }).levels
        // Safety: ensure restored levels also have current-level segments
        this.ensureAllLevelsHaveCurrentSegment(s)
      }
      s.preset = 'custom'
    } else {
      if (s.preset === 'custom') {
        s.customDefinition = deepCloneSettings(s).levels
      }
      s.preset = preset
      s.levels = { ...getPresetLevels(preset) }
    }
    if (this.selectEl) {
      this.selectEl.value = preset
    }
    this.onshow()
  }

  // ── Format library: apply preset to scope ───────

  private applyPresetToScope(presetId: string, scope?: HeadingSettingsScope): void {
    const targetScope = scope ?? this.headingScope
    const docKey = targetScope === 'document'
      ? (this.numberingService.getDocumentKey() ?? null)
      : null
    // [Diagnostic] Global default apply log
    console.log('[InkChapter GlobalDefaultApply] scope=' + targetScope
      + ' docKey=' + (docKey ?? 'null')
      + ' presetId=' + presetId
      + ' type=built-in')
    this.numberingService.applyPresetToScope(presetId, targetScope, docKey)
    this.headingDraft = null
    this.headingDraftOriginal = null
    // Sync selectedFormatRef to the applied format and load content
    this.selectedFormatId = presetId
    this.selectedFormatType = 'built-in'
    this.formatDraft = null
    this.savedFormatBaseline = null
    this.selectedCardKey = presetId
    this.selectedCardIsPreset = true
    this.loadPresetForViewing(presetId)
    this.rerender()
    Notice.info(
      targetScope === 'global'
        ? `预设已设为全局默认`
        : '预设已应用到当前文档',
    )
  }

  // ── Format library: apply custom format to scope ─

  private applyFormatToScope(format: CustomNumberingFormat, scope?: HeadingSettingsScope): void {
    const targetScope = scope ?? this.headingScope
    const docKey = targetScope === 'document'
      ? (this.numberingService.getDocumentKey() ?? null)
      : null
    // [Diagnostic] Global default apply log (custom format)
    console.log('[InkChapter GlobalDefaultApply] scope=' + targetScope
      + ' docKey=' + (docKey ?? 'null')
      + ' formatId=' + format.id
      + ' formatName=' + format.name
      + ' version=' + (format.version ?? 'N/A')
      + ' type=custom')
    this.numberingService.applyFormatToScope(format, targetScope, docKey)
    // Sync selectedFormatRef to the applied format and load content
    this.selectedCardKey = format.id
    this.selectedCardIsPreset = false
    this.initializeFormatEditor(format)
    this.rerender()
    Notice.info(
      targetScope === 'global'
        ? `格式 "${format.name}" 已设为全局默认`
        : `格式 "${format.name}" 已应用到当前文档`,
    )
  }

  // ── Format library: render user format cards ─────

  private renderFormatLibrarySection(s: HeadingNumberingSettings): void {
    const lib = this.formatLibrary

    for (const format of lib.formats) {
      const cardContainer = el('div', 'inkchapter-format-card-wrap')
      this.containerEl.appendChild(cardContainer)

      const cardEl = el('div', 'inkchapter-format-card', cardContainer)
      if (this.selectedFormatId === format.id) {
        cardEl.classList.add('inkchapter-format-card--selected')
      }

      const header = el('div', 'inkchapter-format-card-header', cardEl)
      const nameEl = el('span', 'inkchapter-format-card-name', header)
      nameEl.textContent = format.name
      const descEl = el('div', 'inkchapter-format-card-desc', cardEl)
      descEl.textContent = format.description || '（无描述）'

      // Preview lines (3 levels)
      const previewLines = getFormatPreview(format, 3, format.settings.showLevelOneNumber)
      if (previewLines.length > 0) {
        const previewDiv = el('div', 'inkchapter-format-card-preview', cardEl)
        for (const line of previewLines) {
          const lineEl = el('div', 'inkchapter-format-card-preview-line', previewDiv)
          lineEl.textContent = line
        }
      }

      // Based-on info
      const basedOnInfo = el('div', 'inkchapter-format-card-basedon', cardEl)
      basedOnInfo.textContent = format.basedOn.type === 'built-in'
        ? `基于系统预设创建`
        : format.basedOn.type === 'custom'
          ? '基于其他自定义格式创建'
          : '空白格式'

      // Action buttons
      const actions = el('div', 'inkchapter-format-card-actions', cardEl)

      const applyBtn = el('button', 'inkchapter-btn inkchapter-btn--small', actions)
      applyBtn.textContent = '应用'
      applyBtn.title = '应用此格式到当前作用范围'
      applyBtn.onclick = (e) => {
        e.stopPropagation()
        this.applyFormatToScope(format)
      }

      const globalBtn = el('button', 'inkchapter-btn inkchapter-btn--small', actions)
      globalBtn.textContent = '设为默认'
      globalBtn.title = '将此格式设为全局默认'
      globalBtn.onclick = (e) => {
        e.stopPropagation()
        this.applyFormatToScope(format, 'global')
      }

      const editBtn = el('button', 'inkchapter-btn inkchapter-btn--small', actions)
      editBtn.textContent = '编辑'
      editBtn.title = '编辑此格式'
      editBtn.onclick = (e) => {
        e.stopPropagation()
        this.startEditingFormat(format)
      }

      const copyBtn = el('button', 'inkchapter-btn inkchapter-btn--small', actions)
      copyBtn.textContent = '复制'
      copyBtn.title = '复制此格式'
      copyBtn.onclick = (e) => {
        e.stopPropagation()
        this.copyUserFormat(format)
      }

      const renameBtn = el('button', 'inkchapter-btn inkchapter-btn--small', actions)
      renameBtn.textContent = '重命名'
      renameBtn.title = '重命名此格式'
      renameBtn.onclick = (e) => {
        e.stopPropagation()
        this.renameUserFormat(format)
      }

      const deleteBtn = el('button', 'inkchapter-btn inkchapter-btn--small inkchapter-btn--danger', actions)
      deleteBtn.textContent = '删除'
      deleteBtn.title = '删除此格式'
      deleteBtn.onclick = (e) => {
        e.stopPropagation()
        this.deleteUserFormat(format)
      }

      // Click card to select this format for editing
      cardEl.onclick = () => {
        this.cancelDrag()
        this.startEditingFormat(format)
      }
    }

    // "+ New format" button
    const addRow = el('div', 'inkchapter-format-add-row')
    this.containerEl.appendChild(addRow)
    const addBtn = el('button', 'inkchapter-btn inkchapter-btn--primary', addRow)
    addBtn.textContent = '+ 新建格式'
    addBtn.style.cssText = 'padding:8px 20px;font-size:14px;'
    addBtn.onclick = () => {
      this.showCreateFormatDialog()
    }
  }

  // ── Format library: start editing a format ───────

  private startEditingFormat(format: CustomNumberingFormat): void {
    this.cancelDrag()
    this.initializeFormatEditor(format)
    this.rerender()
  }

  /** 
   * Initialize the format editor with a custom format's data.
   * Sets selectedFormatId, formatDraft, savedFormatBaseline, headingDraft, and headingDraftOriginal.
   * Normalizes both draft and original so they compare equal (no false dirty).
   */
  private initializeFormatEditor(format: CustomNumberingFormat): void {
    this.selectedFormatId = format.id
    this.selectedFormatType = 'custom'
    this.formatDraft = { ...format }
    this.savedFormatBaseline = { ...format }
    // Deep clone settings for the working draft
    const clonedSettings = deepCloneSettings({
      enabled: format.settings.enabled,
      showLevelOneNumber: format.settings.showLevelOneNumber,
      preset: 'custom' as const,
      maxDepth: format.settings.maxDepth,
      levels: format.settings.levels,
      customDefinition: format.settings.levels,
    } as any)
    this.headingDraft = clonedSettings
    this.headingDraftOriginal = deepCloneSettings(clonedSettings)
    // Normalize both so contextualFormatVariants defaults don't show as dirty
    this.ensureAllLevelsHaveCurrentSegment(this.headingDraft)
    this.ensureAllLevelsHaveCurrentSegment(this.headingDraftOriginal)
    // Auto-select default level based on H1 enabled state
    this.expandedLevel = this.getDefaultEditableLevel(this.headingDraft)
    // Don't switch headingScope when editing a format
  }

  /**
   * Load a system preset's levels into headingDraft for read-only viewing.
   * Does NOT set formatDraft — system presets cannot be edited in place.
   */
  private loadPresetForViewing(presetKey: string): void {
    const preset = presetKey as HeadingNumberingPreset
    const presetLevels = getPresetLevels(preset)
    const clonedSettings = deepCloneSettings({
      enabled: true,
      showLevelOneNumber: this.headingSettings.showLevelOneNumber,
      preset: preset,
      maxDepth: 6,
      levels: presetLevels,
    } as any)
    this.headingDraft = clonedSettings
    this.headingDraftOriginal = deepCloneSettings(clonedSettings)
    this.ensureAllLevelsHaveCurrentSegment(this.headingDraft)
    this.ensureAllLevelsHaveCurrentSegment(this.headingDraftOriginal)
    // Auto-select default level based on H1 enabled state
    this.expandedLevel = this.getDefaultEditableLevel(this.headingDraft)
  }

  /** Copy the currently viewed system preset as a new custom format. */
  private copySystemPresetToCustom(): void {
    if (this.selectedFormatType !== 'built-in' || !this.selectedFormatId || !this.headingDraft) return
    const presetMeta = PRESET_CARDS.find(c => c.key === this.selectedFormatId)
    const baseName = presetMeta ? `${presetMeta.name}（副本）` : '系统格式副本'
    const newName = prompt('请输入新格式名称:', baseName)
    if (!newName || !newName.trim()) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) { Notice.info(error); return }

    const newFormat = createFormat(
      newName.trim(),
      `从系统格式「${presetMeta?.name ?? this.selectedFormatId}」复制`,
      { type: 'built-in', presetId: this.selectedFormatId },
      this.headingDraft.levels,
    )
    newFormat.settings.showLevelOneNumber = this.headingDraft.showLevelOneNumber
    newFormat.settings.enabled = this.headingDraft.enabled
    newFormat.settings.maxDepth = this.headingDraft.maxDepth

    const newLib = addFormatToLibrary(this.formatLibrary, newFormat)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    Notice.info(`已复制为自定义格式 "${newFormat.name}"`)
    // Switch to editing the new custom format
    this.initializeFormatEditor(newFormat)
    this.selectedCardKey = newFormat.id
    this.selectedCardIsPreset = false
    this.rerender()
  }

  // ── Format library: editing header ───────────────

  private renderEditingHeader(s: HeadingNumberingSettings): void {
    const editBar = el('div', 'inkchapter-edit-bar')
    editBar.style.cssText = 'margin:12px 0;padding:8px 12px;background:#f0f7ff;border-radius:6px;border:1px solid #b3d8ff;display:flex;align-items:center;gap:8px;flex-wrap:wrap;'

    if (this.selectedFormatId && this.formatDraft) {
      // Editing a library format
      const label = el('span', '', editBar)
      label.textContent = `正在编辑: ${this.formatDraft.name}`
      label.style.cssText = 'font-weight:600;margin-right:8px;'

      const saveBtn = el('button', 'inkchapter-btn', editBar)
      saveBtn.textContent = '保存'
      saveBtn.onclick = () => { this.saveFormatDraft(); this.rerender() }

      const saveAsBtn = el('button', 'inkchapter-btn', editBar)
      saveAsBtn.textContent = '另存为'
      saveAsBtn.onclick = () => this.saveFormatAs()

      const renameBtn = el('button', 'inkchapter-btn', editBar)
      renameBtn.textContent = '重命名'
      renameBtn.onclick = () => this.renameCurrentFormat()

      const deleteBtn = el('button', 'inkchapter-btn inkchapter-btn--danger', editBar)
      deleteBtn.textContent = '删除'
      deleteBtn.onclick = () => this.deleteCurrentFormat()

      const cancelBtn = el('button', 'inkchapter-btn', editBar)
      cancelBtn.textContent = '取消'
      cancelBtn.onclick = () => this.cancelFormatEditing()
    } else {
      // Editing scope draft (custom)
      const label = el('span', '', editBar)
      label.textContent = '自定义设置'
      label.style.cssText = 'font-weight:600;margin-right:8px;'

      const saveAsBtn = el('button', 'inkchapter-btn', editBar)
      saveAsBtn.textContent = '保存为新格式'
      saveAsBtn.onclick = () => this.saveCurrentAsFormat()
    }

    this.containerEl.appendChild(editBar)
  }

  // ── Format library: create format dialog ─────────

  private showCreateFormatDialog(basePreset?: string): void {
    // Remove any existing dialog
    const existing = document.querySelector('.inkchapter-dialog-overlay')
    if (existing) existing.remove()

    const overlay = el('div', 'inkchapter-dialog-overlay')
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:400px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = '新建自定义格式'

    const body = el('div', 'inkchapter-dialog-body', dialog)

    // Name input
    const nameRow = el('div', '', body)
    nameRow.style.cssText = 'margin-bottom:12px;'
    const nameLabel = el('span', '', nameRow)
    nameLabel.textContent = '格式名称: '
    nameLabel.style.cssText = 'font-weight:600;'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.placeholder = '输入格式名称（1-30字符）'
    nameInput.style.cssText = 'width:100%;margin-top:4px;padding:6px 8px;'
    nameInput.maxLength = 30
    nameRow.appendChild(nameInput)

    // Description input
    const descRow = el('div', '', body)
    descRow.style.cssText = 'margin-bottom:12px;'
    const descLabel = el('span', '', descRow)
    descLabel.textContent = '描述: '
    descLabel.style.cssText = 'font-weight:600;'
    const descInput = document.createElement('input')
    descInput.type = 'text'
    descInput.placeholder = '可选：输入格式描述'
    descInput.style.cssText = 'width:100%;margin-top:4px;padding:6px 8px;'
    descInput.maxLength = 200
    descRow.appendChild(descInput)

    // Based on selection
    const basedRow = el('div', '', body)
    basedRow.style.cssText = 'margin-bottom:16px;'
    const basedLabel = el('div', '', basedRow)
    basedLabel.textContent = '基于:'
    basedLabel.style.cssText = 'font-weight:600;margin-bottom:6px;'

    const radioGroup = el('div', '', basedRow)
    radioGroup.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'

    const presetOptions: { value: string; label: string }[] = [
      { value: 'decimal-hierarchical', label: '十进制层级' },
      { value: 'chinese-chapter', label: '中文章节' },
      { value: 'chinese-outline', label: '中文大纲' },
      { value: 'roman-hierarchical', label: '罗马数字' },
      { value: 'blank', label: '空白' },
    ]

    let selectedBase = basePreset ?? 'decimal-hierarchical'
    const radios: HTMLInputElement[] = []

    for (const opt of presetOptions) {
      const label = el('label', '', radioGroup)
      label.style.cssText = 'cursor:pointer;font-size:13px;'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'format-base'
      radio.value = opt.value
      radio.checked = opt.value === selectedBase
      radio.onchange = () => { selectedBase = opt.value }
      label.appendChild(radio)
      label.appendChild(document.createTextNode(' ' + opt.label))
      radios.push(radio)
    }

    // Error message
    const errorEl = el('div', '', body)
    errorEl.style.cssText = 'color:#e00;font-size:12px;min-height:16px;margin-top:4px;'

    // Buttons
    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)

    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()

    const createBtn = el('button', 'inkchapter-btn inkchapter-btn--primary', btnRow)
    createBtn.textContent = '创建'
    createBtn.onclick = () => {
      const name = nameInput.value.trim()
      const error = validateFormatName(name, this.formatLibrary)
      if (error) {
        errorEl.textContent = error
        return
      }

      let basedOn: FormatBasedOn
      let levels

      if (selectedBase === 'blank') {
        basedOn = { type: 'blank' }
        // Start with simple current-level-only formats
        levels = {} as Record<HeadingLevel, HeadingLevelStyle>
        for (const lv of HEADING_LEVELS) {
          const soloSeg: ContextualFormatSegment = {
            id: generateStableId(),
            type: 'level-reference',
            level: lv,
            appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
          }
          levels[lv] = {
            enabled: true,
            tokenStyle: 'arabic',
            includeParents: false,
            prefix: '',
            suffix: '',
            separator: '.',
            startAt: 1,
            restartAfterLevel: lv === 1 ? null : (lv - 1) as HeadingLevel,
            formatVariants: { withLevelOne: [], withoutLevelOne: [] },
            levelTemplate: { tokenStyle: 'arabic', prefix: '', suffix: '' },
            multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
            contextualFormatVariants: {
              withLevelOne: [{ ...soloSeg, id: generateStableId() }],
              withoutLevelOne: lv === 1 ? [] : [{ ...soloSeg, id: generateStableId() }],
            },
          }
        }
      } else {
        basedOn = { type: 'built-in', presetId: selectedBase }
        levels = getPresetLevels(selectedBase as HeadingNumberingPreset)
      }

      const newFormat = createFormat(name, descInput.value.trim(), basedOn, levels)
      const newLib = addFormatToLibrary(this.formatLibrary, newFormat)
      this.numberingService.saveFormatLibrary(newLib)
      this.formatLibrary = newLib

      overlay.remove()
      // Start editing the new format
      this.startEditingFormat(newFormat)
      Notice.info(`格式 "${name}" 已创建`)
    }

    document.body.appendChild(overlay)
    // Focus the name input
    setTimeout(() => nameInput.focus(), 50)
  }

  // ── Format library: save / save-as / rename / delete ─

  private saveFormatDraft(suppressToast = false): void {
    if (!this.selectedFormatId || !this.formatDraft || !this.headingDraft) return

    const updated: CustomNumberingFormat = {
      ...this.formatDraft,
      updatedAt: Date.now(),
      settings: {
        levels: this.headingDraft.levels,
        showLevelOneNumber: this.headingDraft.showLevelOneNumber,
        enabled: this.headingDraft.enabled,
        maxDepth: this.headingDraft.maxDepth,
      },
    }

    const newLib = updateFormatInLibrary(this.formatLibrary, updated)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib

    // Read the saved format from the library to get the new version
    const savedFmt = newLib.formats.find(f => f.id === updated.id)
    const newVersion = savedFmt?.version ?? 0

    // Acknowledge the template update so it doesn't show "有可用更新" toast
    const docKey = this.numberingService.getDocumentKey()
    if (docKey && savedFmt) {
      this.numberingService.acknowledgeTemplateUpdate(docKey, savedFmt.id, newVersion)
    }

    // Sync applied scope version: if this format IS the currently applied format or global default,
    // update the scope store's formatSource.version so "应用更新" doesn't appear immediately.
    const formatId = updated.id
    const scopeStore = this.numberingService.getScopeStore()

    // Check and update document-scope applied version
    if (docKey) {
      const docOverride = scopeStore.documentOverrides[docKey]
      const docSource = docOverride?.formatSource
      if (docSource?.type === 'custom' && docSource.formatId === formatId) {
        this.numberingService.syncDocumentFormatVersion(docKey, formatId, newVersion)
      }
    }

    // Check and update global default applied version
    const gSource = (scopeStore.globalDefault as any).formatSource as NumberingFormatSource | undefined
    if (gSource?.type === 'custom' && gSource.formatId === formatId) {
      this.numberingService.syncGlobalDefaultFormatVersion(formatId, newVersion)
    }

    // Update draft with library version so formatDirty stays false
    this.formatDraft = { ...updated, version: newVersion }
    this.savedFormatBaseline = { ...updated, version: newVersion }

    // Refresh the heading draft baseline so dirty=false reflects the just-saved
    // version (prevents "有未保存的更改" lingering right after save).
    this.headingDraftOriginal = deepCloneSettings(this.headingDraft)

    // Publish the change down the live chain: effective settings → runtime → outline.
    this.numberingService.notifyFormatLibraryChanged(formatId)

    if (!suppressToast) {
      Notice.info(`格式 "${updated.name}" 已保存`)
    }
  }

  private saveFormatAs(): void {
    if (!this.formatDraft || !this.headingDraft) return

    const newName = prompt('请输入新格式名称:', this.formatDraft.name + ' (副本)')
    if (!newName || !newName.trim()) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) {
      Notice.info(error)
      return
    }

    const newFormat = copyFormat(this.formatDraft, newName.trim())
    newFormat.settings = {
      levels: this.headingDraft.levels,
      showLevelOneNumber: this.headingDraft.showLevelOneNumber,
      enabled: this.headingDraft.enabled,
      maxDepth: this.headingDraft.maxDepth,
    }

    const newLib = addFormatToLibrary(this.formatLibrary, newFormat)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    Notice.info(`格式已另存为 "${newFormat.name}"`)
  }

  private saveCurrentAsFormat(): void {
    if (!this.headingDraft) return

    const newName = prompt('请输入新格式名称:', '我的自定义格式')
    if (!newName || !newName.trim()) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) {
      Notice.info(error)
      return
    }

    const newFormat = createFormat(
      newName.trim(),
      '从当前自定义设置保存',
      { type: 'blank' },
      this.headingDraft.levels,
    )
    newFormat.settings.showLevelOneNumber = this.headingDraft.showLevelOneNumber
    newFormat.settings.enabled = this.headingDraft.enabled
    newFormat.settings.maxDepth = this.headingDraft.maxDepth

    const newLib = addFormatToLibrary(this.formatLibrary, newFormat)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    Notice.info(`格式 "${newFormat.name}" 已创建`)
    // Start editing the new format
    this.startEditingFormat(newFormat)
  }

  private renameCurrentFormat(): void {
    if (!this.selectedFormatId || !this.formatDraft) return

    const newName = prompt('请输入新名称:', this.formatDraft.name)
    if (!newName || !newName.trim() || newName.trim() === this.formatDraft.name) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) {
      Notice.info(error)
      return
    }

    const renamed = renameFormat(this.formatDraft, newName.trim())
    const newLib = updateFormatInLibrary(this.formatLibrary, renamed)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    this.formatDraft = renamed
    this.selectedFormatId = renamed.id
    Notice.info(`格式已重命名为 "${renamed.name}"`)
    this.rerender()
  }

  private deleteCurrentFormat(): void {
    if (!this.selectedFormatId || !this.formatDraft) return
    this.showDeleteFormatConfirm(this.formatDraft)
  }

  private cancelFormatEditing(): void {
    // Restore from the Format Library's LATEST saved definition (never a stale
    // applied snapshot or an old in-memory baseline object reference).
    if (this.selectedFormatId) {
      const lib = this.numberingService.getFormatLibrary()
      const latest = lib.formats.find(f => f.id === this.selectedFormatId)
      if (latest) {
        this.formatDraft = { ...latest }
        this.savedFormatBaseline = { ...latest }
        const fmtSettings = deepCloneSettings({
          enabled: latest.settings.enabled,
          showLevelOneNumber: latest.settings.showLevelOneNumber,
          preset: 'custom' as const,
          maxDepth: latest.settings.maxDepth,
          levels: latest.settings.levels,
          customDefinition: latest.settings.levels,
        } as any)
        this.headingDraft = fmtSettings
        this.headingDraftOriginal = deepCloneSettings(fmtSettings)
        this.ensureAllLevelsHaveCurrentSegment(this.headingDraft)
        this.ensureAllLevelsHaveCurrentSegment(this.headingDraftOriginal)
        this.rerender()
        return
      }
    }

    // No editable format (scope draft) or the format was deleted — clear.
    this.selectedFormatId = null
    this.selectedFormatType = null
    this.formatDraft = null
    this.savedFormatBaseline = null
    this.headingDraft = null
    this.headingDraftOriginal = null
    this.rerender()
  }

  private copyUserFormat(format: CustomNumberingFormat): void {
    const newName = prompt('请输入副本名称:', format.name + ' (副本)')
    if (!newName || !newName.trim()) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) {
      Notice.info(error)
      return
    }

    const newFormat = copyFormat(format, newName.trim())
    const newLib = addFormatToLibrary(this.formatLibrary, newFormat)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    Notice.info(`格式已复制为 "${newFormat.name}"`)
    this.rerender()
  }

  private renameUserFormat(format: CustomNumberingFormat): void {
    const newName = prompt('请输入新名称:', format.name)
    if (!newName || !newName.trim() || newName.trim() === format.name) return
    const error = validateFormatName(newName.trim(), this.formatLibrary)
    if (error) {
      Notice.info(error)
      return
    }

    const renamed = renameFormat(format, newName.trim())
    const newLib = updateFormatInLibrary(this.formatLibrary, renamed)
    this.numberingService.saveFormatLibrary(newLib)
    this.formatLibrary = newLib
    Notice.info(`格式已重命名为 "${renamed.name}"`)
    this.rerender()
  }

  private deleteUserFormat(format: CustomNumberingFormat): void {
    this.showDeleteFormatConfirm(format)
  }


  // ── Global confirm/cancel ────────────────────────

  private handleGlobalConfirm(d: typeof this.rangeDraft): void {
    const newMax = d.globalMaxLevel
    this.numberingService.setDefaultMaxLevel(newMax)
    d.globalDirty = false
    this.onshow()
  }

  private handleGlobalCancel(select: HTMLSelectElement): void {
    this.revertGlobalDraft()
    select.value = String(this.rangeDraft.globalMaxLevel)
    this.updateRangeButtons()
  }

  // ── Document confirm/cancel ──────────────────────

  private handleDocumentConfirm(
    docPath: string,
    d: typeof this.rangeDraft,
  ): void {
    if (d.documentMode === 'inherit') {
      const rangeSettings = this.numberingService.getLevelRangeSettings()
      const globalMax = rangeSettings.defaultMaxLevel
      const currentEffective = this.numberingService.getEffectiveMaxLevel()

      if (globalMax < currentEffective) {
        const scan = this.numberingService.scanDocumentHeadings(globalMax)
        if (scan.outOfRange.length > 0) {
          // Show dialog; draft committed only if user chooses an action
          this.showRangeReduceDialog(
            docPath, globalMax, scan.outOfRange, 'inherit',
            () => { d.documentDirty = false; this.onshow() },
          )
          return
        }
      }

      this.numberingService.setDocumentOverride(docPath, { mode: 'inherit' })
      d.documentDirty = false
      this.onshow()
      return
    }

    // Custom mode
    const newMax = d.documentMaxLevel
    const scan = this.numberingService.scanDocumentHeadings(newMax)

    if (scan.outOfRange.length > 0) {
      this.showRangeReduceDialog(
        docPath, newMax, scan.outOfRange, 'custom',
        () => { d.documentDirty = false; this.onshow() },
      )
      return
    }

    this.numberingService.setDocumentOverride(docPath, { mode: 'custom', maxLevel: newMax })
    d.documentDirty = false
    this.onshow()
  }

  private handleDocumentCancel(select: HTMLSelectElement): void {
    this.revertDocumentDraft()
    select.value = String(this.rangeDraft.documentMaxLevel)
    this.updateRangeButtons()
  }

  // ── Old methods (now unused, but handleDocumentLevelChange kept for reference) ──
  // handleDocumentLevelChange and handleInheritGlobal are replaced by the draft flow above.

  // ── Three-option dialog ──────────────────────────

  private showRangeReduceDialog(
    docPath: string,
    newMax: 2 | 3 | 4 | 5 | 6,
    outOfRangeHeadings: import('../heading-numbering/level-range-utils').ParsedHeading[],
    targetMode: 'custom' | 'inherit' = 'custom',
    onCommitted?: () => void,
  ): void {
    // Remove existing dialog if any
    const existing = document.querySelector('.inkchapter-dialog-overlay')
    if (existing) existing.remove()

    const overlay = el('div', 'inkchapter-dialog-overlay')
    const dialog = el('div', 'inkchapter-dialog', overlay)

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = '检测到超出范围的标题'

    const body = el('div', 'inkchapter-dialog-body', dialog)
    const previewList = outOfRangeHeadings.slice(0, 5)
    body.innerHTML = `
      <p>当前文档有 <strong>${outOfRangeHeadings.length}</strong> 个标题超出 H${newMax} 范围：</p>
      <ul>${previewList.map(h => `<li>H${h.level} - ${escapeHtml(h.text.slice(0, 40))}${h.text.length > 40 ? '...' : ''}</li>`).join('')}</ul>
      ${outOfRangeHeadings.length > 5 ? `<p>...等 ${outOfRangeHeadings.length - 5} 个</p>` : ''}
    `

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)

    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消变更'
    cancelBtn.title = '不提交设置，保留当前草稿以便继续调整'
    cancelBtn.onclick = () => overlay.remove()

    const limitBtn = el('button', 'inkchapter-btn', btnRow)
    limitBtn.textContent = '仅限制后续'
    limitBtn.title = '保存范围，现有标题保持不变，后续操作最多创建对应级别'
    limitBtn.onclick = () => {
      overlay.remove()
      if (targetMode === 'inherit') {
        this.numberingService.setDocumentOverride(docPath, { mode: 'inherit' })
      } else {
        this.numberingService.setDocumentOverride(docPath, { mode: 'custom', maxLevel: newMax })
      }
      onCommitted?.()
    }

    const convertBtn = el('button', 'inkchapter-btn inkchapter-btn--danger', btnRow)
    convertBtn.textContent = '转换超范围标题'
    convertBtn.title = '将超出范围的标题转为加粗段落，支持 Ctrl+Z 撤销'
    convertBtn.onclick = () => {
      overlay.remove()
      if (targetMode === 'inherit') {
        this.numberingService.setDocumentOverride(docPath, { mode: 'inherit' })
      } else {
        this.numberingService.setDocumentOverride(docPath, { mode: 'custom', maxLevel: newMax })
      }
      const converted = this.numberingService.convertOutOfRangeHeadings()
      if (converted) {
        console.log(`[InkChapter] 已将 ${outOfRangeHeadings.length} 个超出范围标题转为加粗段落`)
      }
      onCommitted?.()
    }

    document.body.appendChild(overlay)
  }

  // ── Heading layout UI ────────────────────────────

  private renderHeadingLayoutSection(container: HTMLElement): void {
    // Ensure layout draft is initialized (reads from persisted state)
    const draft = this.ensureLayoutDraft()
    const s = this.headingSettings

    // Compute real numbering preview labels for each level
    const sampleTitles: Record<number, string> = { 1: '概述', 2: '研究背景', 3: '研究内容', 4: '数据来源', 5: '模块设计', 6: '补充说明' }
    let previewLabels: Record<number, string> = {}
    let previewGapCharsByNum: Record<number, string> = {}
    try {
      const sampleHeadings: HeadingDescriptor[] = HEADING_LEVELS.map(lv => ({
        key: `layout-prev-h${lv}`,
        level: lv,
        text: sampleTitles[lv] || '标题',
      }))
      const result = computeHeadingNumbering(sampleHeadings, s)
      for (const r of result) {
        previewLabels[r.level] = r.label
        previewGapCharsByNum[r.level] = r.labelGap === 'space' ? ' ' : ''
      }
    } catch {
      for (const lv of HEADING_LEVELS) { previewLabels[lv] = `H${lv}`; previewGapCharsByNum[lv] = '' }
    }

    const section = el('div', 'inkchapter-heading-layout-section', container)

    // ── Header row with batch menu ──
    const headerRow = el('div', 'inkchapter-heading-layout-header', section)
    const headerLeft = el('div', '', headerRow)
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;'
    const title = el('span', '', headerLeft)
    title.textContent = '标题排版'
    title.style.cssText = 'font-weight:600;font-size:14px;'
    const desc = el('span', '', headerLeft)
    desc.textContent = 'H1–H6 对齐、缩进、间距配置'
    desc.style.cssText = 'font-size:12px;color:var(--text-muted,#888);'

    // Batch menu
    const batchWrap = el('div', '', headerRow)
    batchWrap.style.cssText = 'position:relative;'
    const batchBtn = el('button', 'inkchapter-btn inkchapter-btn--small', batchWrap)
    batchBtn.textContent = '批量设置 ▾'
    batchBtn.onclick = () => {
      this.openLayoutBatchMenu(batchWrap)
    }

    // Restore default layout button (resets draft to defaults, does NOT persist)
    const hasPersistedOverrides = this.numberingService.hasDocumentLayoutOverrides()
    const showRestoreBtn = hasPersistedOverrides || this.hasLayoutDirty()
    if (showRestoreBtn) {
      const restoreDefaultBtn = el('button', 'inkchapter-btn inkchapter-btn--small', headerRow)
      restoreDefaultBtn.textContent = '恢复默认排版'
      restoreDefaultBtn.title = '清除排版覆盖，恢复格式默认排版（需点击保存并应用生效）'
      restoreDefaultBtn.style.cssText = 'color:#e67e22;'
      restoreDefaultBtn.onclick = () => {
        // Reset draft to factory defaults — does NOT persist, just marks dirty
        this.headingLayoutDraft = this.defaultLayoutDraft()
        this.rerender()
      }
    }

    // ── Workspace: matrix + preview ──
    const workspace = el('div', 'inkchapter-heading-layout-workspace', section)

    // Left: settings matrix
    const matrix = el('div', 'inkchapter-heading-layout-matrix', workspace)

    // Matrix header
    const mHeader = el('div', 'inkchapter-layout-matrix-header', matrix)
    ;['级别', '对齐方式', '首行缩进', '标题间距'].forEach(t => { const s = el('span','',mHeader); s.textContent = t })

    const levels: Array<{ key: string; label: string }> = [
      { key: 'h1', label: 'H1' }, { key: 'h2', label: 'H2' }, { key: 'h3', label: 'H3' },
      { key: 'h4', label: 'H4' }, { key: 'h5', label: 'H5' }, { key: 'h6', label: 'H6' },
    ]

    for (const { key, label } of levels) {
      const lvNum = parseInt(label.charAt(1), 10) as HeadingLevel
      const current = draft.headingLayouts[key] ?? this.defaultLayoutConfig()
      const currentGap = draft.numberTitleSpacing[lvNum] ?? 'space'
      const hasIndent = current.firstLineIndentEm >= 2
      const isCenterOrRight = current.textAlign === 'center' || current.textAlign === 'right'
      const isSelected = this.selectedLayoutLevel === lvNum

      const row = el('div', 'inkchapter-layout-matrix-row', matrix)
      if (isSelected) row.classList.add('inkchapter-layout-matrix-row--selected')

      // Click row to select level (UI only, does not affect draft)
      row.onclick = () => {
        this.selectedLayoutLevel = this.selectedLayoutLevel === lvNum ? null : lvNum
        this.rerender()
      }

      const levelLabel = el('span', 'inkchapter-layout-matrix-level', row)
      levelLabel.textContent = label

      // Alignment: [左] [中] [右] — immutable updates on draft
      const alignGroup = el('div', 'inkchapter-layout-matrix-align', row)
      for (const opt of [{ m: 'left', lbl: '左' }, { m: 'center', lbl: '中' }, { m: 'right', lbl: '右' }]) {
        const btn = el('button') as HTMLButtonElement
        btn.textContent = opt.lbl
        btn.classList.add('inkchapter-layout-matrix-btn')
        if (opt.m === current.textAlign) btn.classList.add('inkchapter-layout-matrix-btn--active')
        btn.onclick = (e) => {
          e.stopPropagation()
          // Immutable update: new draft object, new headingLayouts, new level config
          this.headingLayoutDraft = {
            headingLayouts: {
              ...draft.headingLayouts,
              [key]: { textAlign: opt.m as 'left' | 'center' | 'right', firstLineIndentEm: (opt.m !== 'left' ? 0 : draft.headingLayouts[key]?.firstLineIndentEm ?? 0) },
            },
            numberTitleSpacing: { ...draft.numberTitleSpacing },
          }
          this.rerender()
        }
        alignGroup.appendChild(btn)
      }

      // Indent: [无] [2字符] — immutable updates on draft
      const indentGroup = el('div', 'inkchapter-layout-matrix-indent', row)
      for (const opt of [{ v: 0, lbl: '无' }, { v: 2, lbl: '2字符' }]) {
        const btn = el('button') as HTMLButtonElement
        btn.textContent = opt.lbl
        btn.classList.add('inkchapter-layout-matrix-btn')
        const isActive = (opt.v === 0 && !hasIndent) || (opt.v === 2 && hasIndent)
        if (isActive) btn.classList.add('inkchapter-layout-matrix-btn--active')
        if (opt.v === 2 && isCenterOrRight) { btn.disabled = true; btn.title = '首行缩进仅对居左有效' }
        btn.onclick = (e) => {
          e.stopPropagation()
          if (opt.v === 2 && isCenterOrRight) return
          const newAlign = opt.v === 2 ? 'left' as const : current.textAlign
          this.headingLayoutDraft = {
            headingLayouts: {
              ...draft.headingLayouts,
              [key]: { textAlign: newAlign, firstLineIndentEm: opt.v },
            },
            numberTitleSpacing: { ...draft.numberTitleSpacing },
          }
          this.rerender()
        }
        indentGroup.appendChild(btn)
      }

      // Gap: [无间距] [一个空格] — immutable updates on draft
      // H1 gap is locked to 'none' in strict mode (H1 not numbered)
      const gapGroup = el('div', 'inkchapter-layout-matrix-gap', row)
      const h1GapLocked = lvNum === 1 && !resolveHeadingStructure(s).showLevelOneNumber
      const effectiveGap = h1GapLocked ? 'none' : currentGap
      for (const opt of [{ v: 'none', lbl: '无间距' }, { v: 'space', lbl: '一个空格' }]) {
        const btn = el('button') as HTMLButtonElement
        btn.textContent = opt.lbl
        btn.classList.add('inkchapter-layout-matrix-btn')
        if (effectiveGap === opt.v) btn.classList.add('inkchapter-layout-matrix-btn--active')
        if (h1GapLocked) {
          btn.disabled = true
          btn.setAttribute('aria-disabled', 'true')
          btn.title = '一级标题编号已关闭，标题间距固定为无间距'
          btn.style.opacity = '0.5'
          btn.style.cursor = 'not-allowed'
          btn.onclick = (e) => { e.stopPropagation() } // no-op
        } else {
          btn.onclick = (e) => {
            e.stopPropagation()
            const newSpacing = { ...draft.numberTitleSpacing, [lvNum]: opt.v as NumberTitleSpacing }
            this.headingLayoutDraft = {
              headingLayouts: { ...draft.headingLayouts },
              numberTitleSpacing: newSpacing,
            }
            this.rerender()
          }
        }
        gapGroup.appendChild(btn)
      }
    }

    // Right: document preview (reads from draft, NOT from persisted state)
    const preview = el('div', 'inkchapter-heading-layout-document-preview', workspace)
    const previewTitle = el('div', 'inkchapter-layout-document-preview-title', preview)
    previewTitle.textContent = '整页预览'

    const previewPage = el('div', 'inkchapter-layout-document-preview-page', preview)

    for (const { key, label } of levels) {
      const lvNum = parseInt(label.charAt(1), 10) as HeadingLevel
      const current = draft.headingLayouts[key] ?? this.defaultLayoutConfig()
      const rawGap = draft.numberTitleSpacing[lvNum] ?? 'space'
      // H1 gap is locked to 'none' in strict mode (H1 not numbered)
      const currentGap = (lvNum === 1 && !resolveHeadingStructure(s).showLevelOneNumber) ? 'none' : rawGap
      const hasIndent = current.firstLineIndentEm >= 2
      const numberLabel = previewLabels[lvNum] || ''
      const gapChar = currentGap === 'space' ? ' ' : ''
      const isSelected = this.selectedLayoutLevel === lvNum

      const pline = el('div', 'inkchapter-layout-document-preview-line', previewPage)
      pline.setAttribute('data-level', String(lvNum))
      pline.setAttribute('data-align', current.textAlign)
      if (hasIndent) pline.setAttribute('data-indent', '2em')
      if (isSelected) pline.classList.add('inkchapter-layout-document-preview-line--selected')

      if (numberLabel) {
        const numSpan = el('span', 'inkchapter-layout-document-preview-number', pline)
        numSpan.textContent = numberLabel
        const gapSpan = el('span', '', pline)
        gapSpan.textContent = gapChar
        const titleSpan = el('span', 'inkchapter-layout-document-preview-title', pline)
        titleSpan.textContent = sampleTitles[lvNum] || '标题'
      } else {
        pline.textContent = sampleTitles[lvNum] || '标题'
      }
    }

    // ── Bottom sticky action bar ──
    const actionBar = el('div', 'inkchapter-heading-layout-actionbar', section)
    const isDirty = this.hasLayoutDirty()
    const statusEl = el('span', '', actionBar)
    statusEl.textContent = isDirty ? '● 有未保存的更改' : '已保存'
    statusEl.style.cssText = `font-size:12px;${isDirty ? 'color:#e67e22;' : 'color:var(--text-muted,#888);'}`

    const actionsRight = el('div', '', actionBar)
    actionsRight.style.cssText = 'display:flex;gap:8px;'

    // Cancel: revert draft to saved state
    const cancelBtn = el('button', 'inkchapter-btn', actionsRight) as HTMLButtonElement
    cancelBtn.textContent = '取消更改'
    if (!isDirty) cancelBtn.disabled = true
    cancelBtn.onclick = () => {
      if (this.savedLayoutDraft) {
        this.headingLayoutDraft = deepCloneLayoutDraft(this.savedLayoutDraft)
        this.rerender()
      }
    }

    // Save: persist draft to layoutOverrides, preserving formatSource
    const saveBtn = el('button', 'inkchapter-btn inkchapter-btn--primary', actionsRight)
    saveBtn.textContent = '保存并应用'
    if (!isDirty) saveBtn.classList.add('inkchapter-btn--disabled')
    saveBtn.onclick = () => {
      const docKey = this.numberingService.getDocumentKey()
      if (!docKey || !this.headingLayoutDraft) return

      const d = this.headingLayoutDraft
      const mode = resolveHeadingStructure(this.headingSettings).mode

      // Preserve the OTHER mode's layout, update only the current mode.
      const existingByMode = this.numberingService.getScopeStore()
        .documentOverrides[docKey]?.layoutOverrides?.headingLayoutsByMode
      const headingLayoutsByMode = { ...(existingByMode ?? {}) } as Record<string, Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig>>
      headingLayoutsByMode[mode] = { ...d.headingLayouts }

      // Build layoutOverrides from draft (per-mode physical H1-H6, no level shift)
      const layoutOverrides: import('../heading-numbering/heading-types').DocumentLayoutOverrides = {
        headingLayoutsByMode: headingLayoutsByMode as import('../heading-numbering/heading-types').DocumentLayoutOverrides['headingLayoutsByMode'],
        numberTitleSpacing: { ...d.numberTitleSpacing },
      }

      // Persist via service (preserves formatSource, only touches layoutOverrides)
      this.numberingService.saveLayoutOverridesFromDraft(docKey, layoutOverrides)

      // Update saved snapshot to reflect persisted state
      this.savedLayoutDraft = deepCloneLayoutDraft(d)
      // Clear headingLayoutDraft so re-render shows no dirty state
      this.headingLayoutDraft = null

      // Also clear numbering draft state if it was set (dirty from gap edits via old path)
      this.headingDraft = null
      this.headingDraftOriginal = null
      this.selectedFormatId = null
      this.selectedFormatType = null
      this.formatDraft = null
      this.savedFormatBaseline = null

      this.rerender()
      Notice.info('当前文档排版已保存')
    }
  }

  // ── Batch menu ──
  private openLayoutBatchMenu(anchorEl: HTMLElement): void {
    this.closeMenu()
    const draft = this.headingLayoutDraft ?? this.ensureLayoutDraft()

    const menu = document.createElement('div')
    menu.className = 'inkchapter-menu-overlay'
    menu.style.position = 'absolute'
    menu.style.top = '100%'
    menu.style.right = '0'
    menu.style.width = '220px'
    menu.style.zIndex = '2000'
    menu.style.pointerEvents = 'auto'
    anchorEl.appendChild(menu)

    const items: Array<{ label: string; action: () => void; disabled?: boolean }> = [
      { label: '全部左对齐', action: () => {
        const newLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig> = {}
        for (let lv = 1; lv <= 6; lv++) { newLayouts[`h${lv}`] = { textAlign: 'left' as const, firstLineIndentEm: 0 } }
        this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: { ...draft.numberTitleSpacing } }
        this.rerender()
      }},
      { label: '全部居中', action: () => {
        const newLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig> = {}
        for (let lv = 1; lv <= 6; lv++) { newLayouts[`h${lv}`] = { textAlign: 'center' as const, firstLineIndentEm: 0 } }
        this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: { ...draft.numberTitleSpacing } }
        this.rerender()
      }},
      { label: '全部右对齐', action: () => {
        const newLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig> = {}
        for (let lv = 1; lv <= 6; lv++) { newLayouts[`h${lv}`] = { textAlign: 'right' as const, firstLineIndentEm: 0 } }
        this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: { ...draft.numberTitleSpacing } }
        this.rerender()
      }},
      { label: '全部无缩进', action: () => {
        const newLayouts = { ...draft.headingLayouts }
        for (let lv = 1; lv <= 6; lv++) {
          const k = `h${lv}`
          newLayouts[k] = { textAlign: newLayouts[k]?.textAlign ?? 'left', firstLineIndentEm: 0 }
        }
        this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: { ...draft.numberTitleSpacing } }
        this.rerender()
      }},
      { label: '全部缩进2字符', action: () => {
        const newLayouts = { ...draft.headingLayouts }
        for (let lv = 1; lv <= 6; lv++) {
          const k = `h${lv}`
          newLayouts[k] = { textAlign: 'left' as const, firstLineIndentEm: 2 }
        }
        this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: { ...draft.numberTitleSpacing } }
        this.rerender()
      }},
      { label: '全部无间距', action: () => {
        const newSpacing = {} as Record<import('../heading-numbering/heading-types').HeadingLevel, import('../heading-numbering/heading-types').NumberTitleSpacing>
        for (let lv = 1; lv <= 6; lv++) newSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] = 'none'
        this.headingLayoutDraft = { headingLayouts: { ...draft.headingLayouts }, numberTitleSpacing: newSpacing }
        this.rerender()
      }},
      { label: '全部一个空格', action: () => {
        const newSpacing = { ...draft.numberTitleSpacing } as Record<import('../heading-numbering/heading-types').HeadingLevel, import('../heading-numbering/heading-types').NumberTitleSpacing>
        for (let lv = 1; lv <= 6; lv++) newSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] = 'space'
        // Skip H1 in strict mode — H1 gap is locked to none
        if (!resolveHeadingStructure(this.headingSettings).showLevelOneNumber) {
          newSpacing[1 as import('../heading-numbering/heading-types').HeadingLevel] = 'none'
        }
        this.headingLayoutDraft = { headingLayouts: { ...draft.headingLayouts }, numberTitleSpacing: newSpacing }
        this.rerender()
      }},
      { label: this.selectedLayoutLevel ? `应用 H${this.selectedLayoutLevel} 排版到后续级别` : '应用当前级到后续级别', action: () => {
        const al = this.selectedLayoutLevel
        if (al && al < 6) {
          const baseCfg = draft.headingLayouts[`h${al}`] ?? this.defaultLayoutConfig()
          const baseGap = draft.numberTitleSpacing[al as HeadingLevel] ?? 'space'
          const newLayouts = { ...draft.headingLayouts }
          const newSpacing = { ...draft.numberTitleSpacing }
          // When strict mode H1 is not numbered, H1 gap is locked to none — skip copying gap
          const skipGap = al === 1 && !resolveHeadingStructure(this.headingSettings).showLevelOneNumber
          for (let lv = (al + 1) as HeadingLevel; lv <= 6; lv = (lv + 1) as HeadingLevel) {
            newLayouts[`h${lv}`] = { ...baseCfg }
            if (!skipGap) { newSpacing[lv] = baseGap }
          }
          this.headingLayoutDraft = { headingLayouts: newLayouts, numberTitleSpacing: newSpacing }
          this.rerender()
        } else if (al === 6) {
          Notice.info('H6 已是最后一级')
        } else {
          Notice.info('请先在左侧点击选择某个级别')
        }
      }, disabled: !this.selectedLayoutLevel || this.selectedLayoutLevel >= 6 },
      { label: '全部恢复默认', action: () => {
        this.headingLayoutDraft = this.defaultLayoutDraft()
        this.rerender()
      }},
    ]

    for (const item of items) {
      const mi = el('div', 'inkchapter-menu-item', menu)
      mi.textContent = item.label
      if (item.disabled) mi.setAttribute('aria-disabled', 'true')
      mi.onclick = () => {
        menu.remove()
        item.action()
      }
    }

    // Close on outside click
    const closeListener = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove()
        document.removeEventListener('mousedown', closeListener)
      }
    }
    setTimeout(() => document.addEventListener('mousedown', closeListener), 0)
  }

  private findActiveLayoutLevel(): import('../heading-numbering/heading-types').HeadingLevel | null {
    const layouts = this.numberingService.getEffectiveHeadingLayouts()
    if (!layouts) return null
    // Find the first level that is not default (left, no indent)
    for (const [key, config] of Object.entries(layouts) as Array<[string, import('../heading-numbering/heading-types').HeadingLayoutConfig]>) {
      if (config.textAlign !== 'left' || config.firstLineIndentEm > 0) {
        return parseInt(key.charAt(1), 10) as import('../heading-numbering/heading-types').HeadingLevel
      }
    }
    // All are default — return H1 as the base level
    return 1
  }

  // ── Stage 2: Multilevel composition editor ───────

  private renderMultilevelCompositionEditor(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
  ): void {
    const section = el('div', 'inkchapter-composition-section', container)

    const title = el('div', 'inkchapter-format-header', section)
    title.textContent = '二、多级组合格式'

    // Get active multilevel format — use resolver for H1 visibility
    const showL1 = resolveHeadingStructure(s).showLevelOneNumber
    const activeFmt = getActiveMultilevelFormatVariant(style, showL1, lv)

    // ── Format chips container ───────────────────
    const fmtContainer = el('div', 'inkchapter-format-container', section)
    const fmtEl = el('div', 'inkchapter-format-chips', fmtContainer)

    // Setup drag delegation
    this.setupMultilevelDragDelegation(fmtEl, lv, style)

    // Render chips
    this.renderInsertSlotInline(fmtEl, 0, lv, activeFmt)

    for (let i = 0; i < activeFmt.length; i++) {
      const seg = activeFmt[i]
      if (seg.type === 'level-template-reference') {
        this.renderLevelTemplateRefChip(fmtEl, i, seg, lv, activeFmt, s)
      } else {
        this.renderLiteralChipMultilevel(fmtEl, i, seg, lv, activeFmt)
      }
      this.renderInsertSlotInline(fmtEl, i + 1, lv, activeFmt)
    }

    // ── Insert controls ──────────────────────────
    const insertRow = el('div', 'inkchapter-format-insert-row', section)

    // Insert text
    const textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.placeholder = '输入文字'
    textInput.style.width = '100px'
    textInput.className = 'inkchapter-format-text-input'
    const textBtn = el('button', 'inkchapter-format-insert-btn', insertRow)
    textBtn.textContent = '插入文字'
    textBtn.onclick = () => {
      const val = textInput.value
      if (val) {
        const cur = getActiveMultilevelFormatVariant(style, showL1, lv)
        const newFmt = [...cur, { type: 'literal' as const, value: sanitize(val) }]
        this.updateDraftMultilevelFormat(lv, newFmt)
        this.onshow()
      }
    }
    const textWrap = el('div', undefined, insertRow)
    textWrap.style.cssText = 'display:flex;align-items:center;gap:4px;'
    textWrap.appendChild(textInput)
    textWrap.appendChild(textBtn)

    // Insert level template reference
    const refWrap = el('div', undefined, insertRow)
    refWrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:12px;'
    const refSelect = el('select', undefined, refWrap) as HTMLSelectElement
    const availRefs = getAvailableMultilevelReferenceLevels(lv, showL1)
    if (availRefs.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '无可用上级级别'
      opt.disabled = true
      refSelect.appendChild(opt)
    } else {
      for (const refLv of availRefs) {
        // Don't offer levels already in the format
        const alreadyPresent = activeFmt.some(s => s.type === 'level-template-reference' && s.level === refLv)
        if (alreadyPresent) continue
        const opt = document.createElement('option')
        opt.value = String(refLv)
        const refStyle = s.levels[refLv]
        const refTpl = refStyle?.levelTemplate
        const tplPreview = refTpl ? `${refTpl.prefix}${getSampleToken(refTpl.tokenStyle)}${refTpl.suffix}` : `H${refLv}`
        opt.textContent = `[H${refLv}: ${tplPreview}]`
        refSelect.appendChild(opt)
      }
      // If all are already present, show disabled message
      if (refSelect.options.length === 0) {
        const opt = document.createElement('option')
        opt.value = ''
        opt.textContent = '已引用所有可用级别'
        opt.disabled = true
        refSelect.appendChild(opt)
      }
    }
    const refBtn = el('button', 'inkchapter-format-insert-btn', refWrap)
    refBtn.textContent = '添加'
    refBtn.onclick = () => {
      const refLv = Number(refSelect.value) as HeadingLevel
      if (!refLv || refLv < 1 || refLv > 6) return
      const cur = getActiveMultilevelFormatVariant(style, showL1, lv)
      // Don't add duplicates
      if (cur.some(s => s.type === 'level-template-reference' && s.level === refLv)) return
      const newFmt = [...cur, { type: 'level-template-reference' as const, level: refLv }]
      this.updateDraftMultilevelFormat(lv, newFmt)
      this.onshow()
    }
  }

  // ── Contextual composition editor (schemaVersion >= 8) ──

  private renderContextualCompositionEditor(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
    activeFmt: readonly ContextualFormatSegment[],
  ): void {
    const section = el('div', 'inkchapter-composition-section', container)

    const title = el('div', 'inkchapter-format-header', section)
    title.textContent = '一、多级组合格式'

    // Compute H1 visibility from resolver
    const showL1 = resolveHeadingStructure(s).showLevelOneNumber

    // Reset selection when re-rendering
    if (!activeFmt.some(seg => seg.id === this.selectedSegmentId)) {
      this.selectedSegmentId = null
    }

    // ── Format chips container ───────────────────
    const fmtContainer = el('div', 'inkchapter-format-container', section)
    const fmtEl = el('div', 'inkchapter-format-chips', fmtContainer)

    // Click on empty area to deselect
    fmtEl.addEventListener('click', (e) => {
      if (e.target === fmtEl) {
        this.selectedSegmentId = null
        this.onshow()
      }
    })

    // Setup drag delegation for contextual format
    this.setupContextualDragDelegation(fmtEl, lv, style, activeFmt)

    // Render chips
    for (let i = 0; i < activeFmt.length; i++) {
      const seg = activeFmt[i]
      if (seg.type === 'level-reference') {
        this.renderContextualLevelRefChip(fmtEl, i, seg, lv, activeFmt, s)
      } else {
        this.renderContextualLiteralChip(fmtEl, i, seg, lv, activeFmt)
      }
    }

    // ── Insert controls ──────────────────────────
    const insertRow = el('div', 'inkchapter-format-insert-row', section)

    // Insert literal text
    const textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.placeholder = '输入文字'
    textInput.style.width = '100px'
    textInput.className = 'inkchapter-format-text-input'
    const textBtn = el('button', 'inkchapter-format-insert-btn', insertRow)
    textBtn.textContent = '插入文字'
    textBtn.onclick = () => {
      const val = textInput.value
      if (val) {
        const newFmt = [...activeFmt, { id: generateStableId(), type: 'literal' as const, value: sanitize(val) }]
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
      }
    }
    const textWrap = el('div', undefined, insertRow)
    textWrap.style.cssText = 'display:flex;align-items:center;gap:4px;'
    textWrap.appendChild(textInput)
    textWrap.appendChild(textBtn)

    // Insert level reference
    const refWrap = el('div', undefined, insertRow)
    refWrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:12px;'
    const refSelect = el('select', undefined, refWrap) as HTMLSelectElement
    const availRefs = getAvailableContextualReferenceLevels(lv, showL1, activeFmt)
    if (availRefs.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '无可用上级级别'
      opt.disabled = true
      refSelect.appendChild(opt)
    } else {
      for (const refLv of availRefs) {
        const opt = document.createElement('option')
        opt.value = String(refLv)
        const refStyle = s.levels[refLv]
        const refTpl = refStyle?.levelTemplate
        const tplPreview = refTpl ? `${refTpl.prefix}${getSampleToken(refTpl.tokenStyle)}${refTpl.suffix}` : `H${refLv}`
        const displayLv = resolvePhysicalHeadingForStyleSlot(resolveHeadingStructure(s).mode, refLv as StyleSlot) ?? refLv
        opt.textContent = `[H${displayLv}: ${tplPreview}]`
        refSelect.appendChild(opt)
      }
    }
    const refBtn = el('button', 'inkchapter-format-insert-btn', refWrap)
    refBtn.textContent = '添加'
    refBtn.onclick = () => {
      const refLv = Number(refSelect.value) as HeadingLevel
      if (!refLv || refLv < 1 || refLv > 6) return
      const cur = activeFmt
      if (cur.some(s => s.type === 'level-reference' && s.level === refLv)) return
      // Deep copy default appearance from the referenced level
      const refStyle = s.levels[refLv]
      const defaultAppearance = refStyle?.levelTemplate
        ? { tokenStyle: refStyle.levelTemplate.tokenStyle, prefix: refStyle.levelTemplate.prefix ?? '', suffix: refStyle.levelTemplate.suffix ?? '' }
        : { tokenStyle: 'arabic' as NumberTokenStyle, prefix: '', suffix: '' }
      const newFmt = [...cur, {
        id: generateStableId(),
        type: 'level-reference' as const,
        level: refLv,
        appearance: { ...defaultAppearance },
      }]
      this.updateDraftContextualFormat(lv, newFmt)
      this.onshow()
    }
  }

  // ── Contextual chip rendering ────────────────────

  private renderContextualLevelRefChip(
    fmtEl: HTMLElement, idx: number,
    seg: ContextualFormatSegment & { type: 'level-reference' },
    lv: HeadingLevel,
    activeFmt: readonly ContextualFormatSegment[],
    s: HeadingNumberingSettings,
    readonlyForm = false,
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    const tplPreview = `${seg.appearance.prefix}${getSampleToken(seg.appearance.tokenStyle)}${seg.appearance.suffix}`
    const displayLevel = resolvePhysicalHeadingForStyleSlot(resolveHeadingStructure(s).mode, seg.level as StyleSlot) ?? seg.level
    chip.textContent = `[H${displayLevel}:${tplPreview}]`
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'level-reference')
    chip.setAttribute('data-segment-level', String(seg.level))
    chip.setAttribute('data-segment-id', seg.id)

    // Selected state
    if (seg.id === this.selectedSegmentId) {
      chip.classList.add('inkchapter-format-chip--selected')
    }

    // Click to select
    chip.onclick = (e) => {
      e.stopPropagation()
      this.selectedSegmentId = seg.id
      this.onshow()
    }

    // Current level ref: can drag, cannot delete
    if (seg.level === lv) {
      chip.classList.add('inkchapter-format-chip--current')
    } else if (!readonlyForm) {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' \xD7'
      close.onclick = (e) => {
        e.stopPropagation()
        // Maintain selection if removing non-selected chip
        const newFmt = activeFmt.filter(s => s.id !== seg.id)
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  private renderContextualLiteralChip(
    fmtEl: HTMLElement, idx: number,
    seg: ContextualFormatSegment & { type: 'literal' },
    lv: HeadingLevel,
    activeFmt: readonly ContextualFormatSegment[],
    readonlyForm = false,
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = seg.value || '(空)'
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'literal')
    chip.setAttribute('data-segment-id', seg.id)

    if (seg.id === this.selectedSegmentId) {
      chip.classList.add('inkchapter-format-chip--selected')
    }

    chip.onclick = (e) => {
      e.stopPropagation()
      this.selectedSegmentId = seg.id
      this.onshow()
    }

    if (!readonlyForm) {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' \xD7'
      close.onclick = (e) => {
        e.stopPropagation()
        const newFmt = activeFmt.filter(s => s.id !== seg.id)
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  // ── Contextual property panel ────────────────────

  private renderContextualPropertyPanel(
    container: HTMLElement,
    lv: HeadingLevel,
    activeFmt: readonly ContextualFormatSegment[],
    s: HeadingNumberingSettings,
  ): void {
    if (!this.selectedSegmentId) return

    const selectedSeg = activeFmt.find(seg => seg.id === this.selectedSegmentId)
    if (!selectedSeg) return

    const panel = el('div', 'inkchapter-template-section', container)
    const panelTitle = el('div', 'inkchapter-format-header', panel)
    panelTitle.textContent = '二、序号标签设置'

    if (selectedSeg.type === 'literal') {
      // Literal editing panel
      this.addCustomTextInput(panel, '文字内容', selectedSeg.value, '输入文字', (val) => {
        const newFmt = activeFmt.map(s =>
          s.id === selectedSeg.id ? { ...s, value: sanitize(val) } : s
        )
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
      })
      return
    }

    // Level reference property panel
    const refLvLabel = el('div', 'inkchapter-custom-row', panel)
    const refLvSpan = el('span', 'inkchapter-custom-col-label', refLvLabel)
    refLvSpan.textContent = '引用级别'
    const levelDisplay = el('span', undefined, refLvLabel)
    const propertyDisplayLevel = resolvePhysicalHeadingForStyleSlot(resolveHeadingStructure(s).mode, selectedSeg.level as StyleSlot) ?? selectedSeg.level
    levelDisplay.textContent = `H${propertyDisplayLevel}`
    levelDisplay.style.cssText = 'font-weight:600;'

    // Token style select
    this.addCustomSelect(panel, '编号样式', TOKEN_STYLE_LABELS, selectedSeg.appearance.tokenStyle, (val) => {
      this.updateDraftContextualSegment(lv, selectedSeg.id, { tokenStyle: val as NumberTokenStyle })
      this.onshow()
    })

    // Prefix input
    this.addCustomTextInput(panel, '前缀', selectedSeg.appearance.prefix, '例如：第', (val) => {
      this.updateDraftContextualSegment(lv, selectedSeg.id, { prefix: sanitizeTemplateString(val) })
      this.onshow()
    })

    // Suffix input
    this.addCustomTextInput(panel, '后缀', selectedSeg.appearance.suffix, '例如：章', (val) => {
      this.updateDraftContextualSegment(lv, selectedSeg.id, { suffix: sanitizeTemplateString(val) })
      this.onshow()
    })

    // Preview
    const previewRow = el('div', 'inkchapter-custom-row', panel)
    const previewLabel = el('span', 'inkchapter-custom-col-label', previewRow)
    previewLabel.textContent = '标签预览'
    const previewValue = el('span', 'inkchapter-template-preview-value', previewRow)
    previewValue.textContent = `${selectedSeg.appearance.prefix}${getSampleToken(selectedSeg.appearance.tokenStyle)}${selectedSeg.appearance.suffix}`
  }

  // ── Contextual drag delegation ───────────────────

  private setupContextualDragDelegation(
    fmtEl: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    activeFmt: readonly ContextualFormatSegment[],
  ): void {
    ;(fmtEl as any).__dragLevel = lv
    ;(fmtEl as any).__dragStyle = style
    ;(fmtEl as any).__dragFmt = activeFmt

    fmtEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('.inkchapter-format-chip-close')) return
      if (target.closest('input, select, button')) return

      const chip = target.closest('[data-format-index]') as HTMLElement | null
      if (!chip) return

      const idx = Number(chip.getAttribute('data-format-index'))
      if (isNaN(idx) || idx < 0) return

      e.preventDefault()
      this.onContextualDragStart(fmtEl, idx, e.clientX, e.clientY)
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.dragState) {
        this.cancelDrag('Escape')
      }
    }
    fmtEl.addEventListener('keydown', onKey)
  }

  private onContextualDragStart(container: HTMLElement, idx: number, clientX: number, clientY: number): void {
    if (this.dragState) this.cancelDrag('re-drag')
    this.dragState = createDragState(idx, clientX, clientY)

    const lv = (container as any).__dragLevel as HeadingLevel
    const style = (container as any).__dragStyle as HeadingLevelStyle

    const onMove = (e: PointerEvent) => this.onDragMove(container, e.clientX, e.clientY)
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      this.onContextualDragEnd(container, lv, style)
    }
    const onCancel = () => this.cancelDrag('pointercancel')

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)

    this.dragState.cleanupFns.push(
      () => document.removeEventListener('pointermove', onMove),
      () => document.removeEventListener('pointerup', onUp),
      () => document.removeEventListener('pointercancel', onCancel),
    )
  }

  private onContextualDragEnd(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
  ): void {
    if (!this.dragState) return
    const ds = this.dragState

    if (!ds.isDragging) {
      // This was a click (no drag movement) — select the clicked chip
      const chip = container.querySelector(`[data-format-index="${ds.draggingIndex}"]`) as HTMLElement | null
      if (chip) {
        const segId = chip.getAttribute('data-segment-id')
        if (segId) {
          this.selectedSegmentId = segId
          this.cancelDrag('click-select')
          this.onshow()
          return
        }
      }
      this.cancelDrag('no-move')
      return
    }

    const s = this.headingSettings
    const slotLvForDrag = this.resolveSlotLevel(lv) ?? lv
    const before = [...getActiveContextualFormatVariant(style, true, slotLvForDrag)]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    const hiddenLevels = new Set<HeadingLevel>()
    // Slot model: no hidden levels needed — refs are slot-relative

    // Use slotLvForDrag (StyleSlot) as currentLevel — NOT physical lv.
    // Segments store StyleSlot indices in .level; comparing against physical lv
    // will never find the SELF segment, causing normalize to auto-create a
    // duplicate at the wrong level (e.g. physical 4 → S4 → H5).
    const after = normalizeContextualFormatAfterDrag(moved, slotLvForDrag, hiddenLevels, style.tokenStyle)

    // Preserve selected segment id after drag
    const draggedId = before[draggingIdx]?.id
    if (draggedId && !after.some(s => s.id === draggedId)) {
      this.selectedSegmentId = draggedId
    }

    this.cancelDrag('commit')

    this.updateDraftContextualFormat(lv, after)
    this.onshow()
  }

  // ── Stage 3: Current level behavior settings ────

  private renderLevelBehaviorSettings(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    disabled: boolean,
    activeFmt: readonly MultilevelFormatSegment[],
  ): void {
    const section = el('div', 'inkchapter-template-section', container)

    const title = el('div', 'inkchapter-format-header', section)
    title.textContent = '三、当前级行为'

    // Enable toggle (skip for H1)
    if (lv > 1) {
      this.addCustomCheckbox(section, '启用本级编号', style.enabled, (checked) => {
        if (lv === 6 && this.headingDraft) { const st2 = resolveHeadingStructure(this.headingDraft); if (st2.mode === 'loose') this.headingDraft.s6Configured = true }
        this.numberingService.updateLevelStyle(lv, { enabled: checked })
        this.onshow()
      })
    }

    this.addCustomNumber(section, '起始编号', style.startAt, 1, 999, (val) => {
      this.numberingService.updateLevelStyle(lv, { startAt: val })
      this.onshow()
    }, disabled)

    if (lv > 1) {
      this.addCustomSelect(section, '在哪个上级后重新开始', buildRestartOptions(lv), String(style.restartAfterLevel ?? ''), (val) => {
        const parsed = val === '' ? null : Number(val) as HeadingLevel
        this.numberingService.updateLevelStyle(lv, { restartAfterLevel: parsed } as any)
        this.onshow()
      })
    }

    // Format summary using multilevel model
    const summary = el('div', 'inkchapter-advanced-summary', section)
    summary.textContent = multilevelFormatSummary(activeFmt, style.levelTemplate)
  }

  // ── Multilevel chip rendering ────────────────────

  private renderLevelTemplateRefChip(
    fmtEl: HTMLElement, idx: number,
    seg: { type: 'level-template-reference'; level: HeadingLevel },
    lv: HeadingLevel,
    activeFmt: readonly MultilevelFormatSegment[],
    s: HeadingNumberingSettings,
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    const refStyle = s.levels[seg.level]
    const tpl = refStyle?.levelTemplate
    const tplPreview = tpl ? `${tpl.prefix}${getSampleToken(tpl.tokenStyle)}${tpl.suffix}` : `H${seg.level}`
    chip.textContent = `[H${seg.level}:${tplPreview}]`
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'level-template-reference')
    chip.setAttribute('data-segment-level', String(seg.level))

    // Current level ref: can drag, cannot delete
    if (seg.level === lv) {
      chip.classList.add('inkchapter-format-chip--current')
    } else {
      // Parent level ref: can drag and delete
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' ×'
      close.onclick = (e) => {
        e.stopPropagation()
        const newFmt = activeFmt.filter((_, i) => i !== idx)
        this.updateDraftMultilevelFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  private renderLiteralChipMultilevel(
    fmtEl: HTMLElement, idx: number,
    seg: { type: 'literal'; value: string }, lv: HeadingLevel,
    activeFmt: readonly MultilevelFormatSegment[],
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = seg.value || '(空)'
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'literal')

    const close = el('span', 'inkchapter-format-chip-close', chip)
    close.textContent = ' ×'
    close.onclick = (e) => {
      e.stopPropagation()
      const newFmt = activeFmt.filter((_, i) => i !== idx)
      this.updateDraftMultilevelFormat(lv, newFmt)
      this.onshow()
    }
  }

  private renderInsertSlotInline(
    fmtEl: HTMLElement, insertIdx: number, lv: HeadingLevel,
    activeFmt: readonly MultilevelFormatSegment[],
  ): void {
    const slot = el('div', 'inkchapter-format-slot', fmtEl)
    slot.setAttribute('data-insert-index', String(insertIdx))
    slot.onclick = (e) => {
      e.stopPropagation()
      const action = prompt('输入要插入的文字 (或留空取消):')
      if (action) {
        const newFmt = [...activeFmt]
        newFmt.splice(insertIdx, 0, { type: 'literal' as const, value: sanitize(action) })
        this.updateDraftMultilevelFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  // ── Multilevel drag delegation ───────────────────

  private setupMultilevelDragDelegation(
    fmtEl: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
  ): void {
    ;(fmtEl as any).__dragLevel = lv
    ;(fmtEl as any).__dragStyle = style

    fmtEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return

      const target = e.target as HTMLElement
      if (target.closest('.inkchapter-format-chip-close')) return
      if (target.closest('.inkchapter-format-slot')) return
      if (target.closest('input, select, button')) return

      const chip = target.closest('[data-format-index]') as HTMLElement | null
      if (!chip) return

      const idx = Number(chip.getAttribute('data-format-index'))
      if (isNaN(idx) || idx < 0) return

      e.preventDefault()
      this.onMultilevelDragStart(fmtEl, idx, e.clientX, e.clientY)
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.dragState) {
        this.cancelDrag('Escape')
      }
    }
    fmtEl.addEventListener('keydown', onKey)
  }

  private onMultilevelDragStart(container: HTMLElement, idx: number, clientX: number, clientY: number): void {
    if (this.dragState) this.cancelDrag('re-drag')

    this.dragState = createDragState(idx, clientX, clientY)

    const lv = (container as any).__dragLevel as HeadingLevel
    const style = (container as any).__dragStyle as HeadingLevelStyle

    const onMove = (e: PointerEvent) => this.onDragMove(container, e.clientX, e.clientY)
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      this.onMultilevelDragEnd(container, lv, style)
    }
    const onCancel = () => this.cancelDrag('pointercancel')

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)

    this.dragState.cleanupFns.push(
      () => document.removeEventListener('pointermove', onMove),
      () => document.removeEventListener('pointerup', onUp),
      () => document.removeEventListener('pointercancel', onCancel),
    )
  }

  private onMultilevelDragEnd(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
  ): void {
    if (!this.dragState) return
    const ds = this.dragState

    if (!ds.isDragging) {
      this.cancelDrag('no-move')
      return
    }

    const s = this.headingSettings
    const showL1 = resolveHeadingStructure(s).showLevelOneNumber
    const before = [...getActiveMultilevelFormatVariant(style, showL1, lv)]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    const hiddenLevels = new Set<HeadingLevel>()
    // Slot model: no hidden levels needed — refs are slot-relative

    const slotLv = this.resolveSlotLevel(lv) ?? lv
    const after = normalizeMultilevelFormatAfterDrag(moved, slotLv, hiddenLevels)

    this.cancelDrag('commit')

    this.updateDraftMultilevelFormat(lv, after)
    this.onshow()
  }

  // ── Shared drag logic ──────────────────────────

  private onDragMove(container: HTMLElement, clientX: number, clientY: number): void {
    if (!this.dragState) return

    const ds = this.dragState

    if (!ds.isDragging) {
      const dist = Math.hypot(clientX - ds.startX, clientY - ds.startY)
      if (dist < DRAG_THRESHOLD) return
      ds.isDragging = true

      container.style.userSelect = 'none'
      container.style.cursor = 'grabbing'
      const chip = container.querySelector(`[data-format-index="${ds.draggingIndex}"]`) as HTMLElement | null
      if (chip) {
        chip.classList.add('inkchapter-format-chip--dragging')
      }
    }

    if (ds.rafId !== null) return
    ds.rafId = requestAnimationFrame(() => {
      ds.rafId = null
      if (!this.dragState) return

      const target = calculateTargetIndexAfterRemoval(container, clientX, clientY, ds.draggingIndex)
      ds.targetIndexAfterRemoval = target
      this.updateDropIndicator(container, target)
    })
  }

  private cancelDrag(reason?: string): void {
    if (!this.dragState) return
    const ds = this.dragState

    if (DEBUG_DRAG && reason) console.log('[Drag] cancel reason=' + reason)

    if (ds.rafId !== null) {
      cancelAnimationFrame(ds.rafId)
      ds.rafId = null
    }

    const containers = this.containerEl.querySelectorAll('.inkchapter-format-chips')
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i] as HTMLElement
      c.style.userSelect = ''
      c.style.cursor = ''
      const draggingChip = c.querySelector('.inkchapter-format-chip--dragging') as HTMLElement | null
      if (draggingChip) draggingChip.classList.remove('inkchapter-format-chip--dragging')
    }

    const indicators = this.containerEl.querySelectorAll('.inkchapter-format-drop-indicator')
    for (let i = 0; i < indicators.length; i++) {
      indicators[i].remove()
    }

    for (const fn of ds.cleanupFns) {
      try { fn() } catch { /* ignore */ }
    }

    this.dragState = null
  }

  private updateDropIndicator(container: HTMLElement, targetIndexAfterRemoval: number): void {
    const existing = container.querySelectorAll('.inkchapter-format-drop-indicator')
    for (let i = 0; i < existing.length; i++) existing[i].remove()

    const allChips = container.querySelectorAll<HTMLElement>('[data-format-index]')
    const remaining: HTMLElement[] = []
    for (let i = 0; i < allChips.length; i++) {
      if (Number(allChips[i].getAttribute('data-format-index')) !== this.dragState?.draggingIndex) {
        remaining.push(allChips[i])
      }
    }

    const indicator = document.createElement('div')
    indicator.className = 'inkchapter-format-drop-indicator'

    if (remaining.length === 0) {
      container.appendChild(indicator)
    } else if (targetIndexAfterRemoval >= remaining.length) {
      remaining[remaining.length - 1].insertAdjacentElement('afterend', indicator)
    } else {
      remaining[targetIndexAfterRemoval].insertAdjacentElement('beforebegin', indicator)
    }
  }

  // ── Chip rendering ─────────────────────────────

  private renderInsertSlot(
    fmtEl: HTMLElement, insertIdx: number, lv: HeadingLevel,
    activeFmt: readonly NumberFormatSegment[],
    disabled = false,
  ): void {
    const slot = el('div', 'inkchapter-format-slot', fmtEl)
    slot.setAttribute('data-insert-index', String(insertIdx))
    if (disabled) {
      slot.classList.add('inkchapter-format-slot--disabled')
      slot.style.pointerEvents = 'none'
      slot.style.opacity = '0.4'
      return
    }
    slot.onclick = (e) => {
      e.stopPropagation()
      const action = prompt('输入要插入的文字 (或留空取消):')
      if (action) {
        const newFmt = [...activeFmt]
        newFmt.splice(insertIdx, 0, { type: 'literal' as const, value: sanitize(action) })
        this.numberingService.updateActiveFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  private renderLevelRefChip(
    fmtEl: HTMLElement, idx: number,
    seg: { type: 'level-reference'; level: number }, lv: HeadingLevel,
    activeFmt: readonly NumberFormatSegment[],
    disabled = false,
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = `[级别${seg.level}]`
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'level-reference')
    chip.setAttribute('data-segment-level', String(seg.level))

    if (disabled) {
      chip.classList.add('inkchapter-format-chip--disabled')
    }

    if (seg.level !== lv && !disabled) {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' ×'
      close.onclick = (e) => {
        e.stopPropagation()
        const newFmt = activeFmt.filter((_, i) => i !== idx)
        this.numberingService.updateActiveFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  private renderLiteralChip(
    fmtEl: HTMLElement, idx: number,
    seg: { type: 'literal'; value: string }, lv: HeadingLevel,
    activeFmt: readonly NumberFormatSegment[],
    disabled = false,
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = seg.value || '(空)'
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'literal')

    if (disabled) {
      chip.classList.add('inkchapter-format-chip--disabled')
    }

    if (!disabled) {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' ×'
      close.onclick = (e) => {
        e.stopPropagation()
        const newFmt = activeFmt.filter((_, i) => i !== idx)
        this.numberingService.updateActiveFormat(lv, newFmt)
        this.onshow()
      }
    }
  }

  // ── Full preview ──────────────────────────────────

  private renderFullPreviewInContainer(s: HeadingNumberingSettings, container: HTMLElement): void {
    container.textContent = ''
    if (!s?.levels) return
    if (!s.enabled) {
      container.textContent = '标题编号当前已关闭'
      return
    }
    const synthetic: import('../heading-numbering/heading-types').HeadingDescriptor[] = HEADING_LEVELS.map((lv) => ({
      key: `editor-prev-h${lv}`,
      level: lv,
      text: `${lv}级标题示例`,
    }))
    const numbered = computeHeadingNumbering(synthetic, s)
    for (const item of numbered) {
      const lv = item.level as HeadingLevel

      if (!resolveHeadingStructure(s).showLevelOneNumber && lv === 1) {
        const row = el('div', 'inkchapter-preview-row', container)
        const label = el('span', 'inkchapter-preview-label', row)
        label.textContent = `H${lv} `
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = '一级标题示例'
        continue
      }

      const row = el('div', 'inkchapter-preview-row', container)
      const label = el('span', 'inkchapter-preview-label', row)
      label.textContent = `H${lv} `
      const token = el('span', 'inkchapter-preview-token', row)
      token.textContent = item.label || '（无编号）'
    }
  }

  // ── Custom panel inline helpers ──────────────────

  private addCustomCheckbox(
    container: HTMLElement, label: string, checked: boolean,
    onChange: (checked: boolean) => void,
    disabled = false,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    cb.disabled = disabled
    cb.onchange = () => onChange(cb.checked)
    row.appendChild(cb)
  }

  private addCustomTextInput(
    container: HTMLElement, label: string, value: string,
    placeholder: string,
    onChange: (val: string) => void,
    disabled = false,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.placeholder = placeholder
    input.disabled = disabled
    input.style.width = '120px'
    input.onblur = () => onChange(input.value)
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur()
    }
    row.appendChild(input)
  }

  private addCustomSelect(
    container: HTMLElement, label: string,
    options: { value: string; label: string; group?: string }[],
    value: string, onChange: (val: string) => void,
    disabled = false,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const select = document.createElement('select')
    select.disabled = disabled
    select.style.minWidth = '220px'

    // Build optgroups
    const groups = new Map<string, HTMLOptGroupElement>()
    const flatOpts: HTMLOptionElement[] = []

    for (const opt of options) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      o.selected = opt.value === value
      if (opt.group) {
        let g = groups.get(opt.group)
        if (!g) {
          g = document.createElement('optgroup')
          g.label = opt.group
          groups.set(opt.group, g)
          select.appendChild(g)
        }
        g.appendChild(o)
      } else {
        select.appendChild(o)
      }
    }
    select.onchange = () => onChange(select.value)
    row.appendChild(select)
  }

  private addCustomNumber(
    container: HTMLElement, label: string, value: number,
    min: number, max: number,
    onChange: (val: number) => void,
    disabled = false,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(value)
    input.min = String(min)
    input.max = String(max)
    input.disabled = disabled
    input.style.width = '80px'
    input.onblur = () => {
      const n = parseInt(input.value, 10)
      if (!isNaN(n) && n >= min && n <= max) {
        onChange(n)
      } else {
        input.value = String(value)
      }
    }
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur()
    }
    row.appendChild(input)
  }

  private addSpacingRadio(
    container: HTMLElement,
    value: string,
    label: string,
    currentValue: string,
    lv: HeadingLevel,
    onChange?: () => void,
  ): HTMLInputElement {
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = `inkchapter-spacing-h${lv}`
    radio.value = value
    radio.checked = currentValue === value
    radio.setAttribute('role', 'radio')
    radio.setAttribute('aria-checked', String(currentValue === value))
    radio.style.cssText = 'margin-right:4px;cursor:pointer;'
    radio.onchange = () => {
      if (radio.checked) {
        if (onChange) {
          onChange()
        } else {
          // Fallback for non-draft contexts (should not normally be reached)
          this.numberingService.updateLevelStyle(lv, { numberTitleSpacing: value as NumberTitleSpacing })
        }
        this.onshow()
      }
    }

    const wrapper = el('label', '', container)
    wrapper.style.cssText = 'display:inline-flex;align-items:center;cursor:pointer;font-size:13px;'
    wrapper.appendChild(radio)
    const text = document.createTextNode(` ${label}`)
    wrapper.appendChild(text)
    return radio
  }

  // ── Scope bar & confirm/cancel ──────────────────

  /**
   * Resolve the style slot level for a physical heading level in the current mode.
   * In strict mode: H2→1 (S1), H3→2 (S2), etc.
   * In loose mode:  physical = slot (no change).
   * Returns null for strict H1 (document title, no slot).
   */
  private resolveSlotLevel(physicalLevel: HeadingLevel): HeadingLevel | null {
    const structure = resolveHeadingStructure(this.headingSettings)
    return resolveStyleSlot(structure.mode, physicalLevel) as HeadingLevel | null
  }

  private ensureDraft(): void {
    if (this.headingDraft) return
    this.headingDraftOriginal = this.numberingService.getEffectiveSettings()
    this.headingDraft = deepCloneSettings(this.headingDraftOriginal)
  }

  // ── Layout draft (independent of numbering draft) ──

  /** Create default layout config (left, no indent). */
  private defaultLayoutConfig(): import('../heading-numbering/heading-types').HeadingLayoutConfig {
    return { textAlign: 'left', firstLineIndentEm: 0 }
  }

  /** Get default layout draft for all 6 levels. */
  private defaultLayoutDraft(): HeadingLayoutDraft {
    const headingLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig> = {}
    for (let lv = 1; lv <= 6; lv++) {
      headingLayouts[`h${lv}`] = { textAlign: 'left' as const, firstLineIndentEm: 0 }
    }
    const numberTitleSpacing = {} as Record<import('../heading-numbering/heading-types').HeadingLevel, import('../heading-numbering/heading-types').NumberTitleSpacing>
    for (let lv = 1; lv <= 6; lv++) {
      numberTitleSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] = 'space'
    }
    return { headingLayouts, numberTitleSpacing }
  }

  /** Initialize or get the layout draft from persisted state. Never returns null after first call per render cycle. */
  private ensureLayoutDraft(): HeadingLayoutDraft {
    if (this.headingLayoutDraft) return this.headingLayoutDraft

    // Build from persisted layout overrides + defaults
    const draft = this.defaultLayoutDraft()
    const store = this.numberingService.getScopeStore()
    const docKey = this.numberingService.getDocumentKey()
    const docOverride = docKey ? store.documentOverrides[docKey] : undefined
    const lo = docOverride?.layoutOverrides
    const s = this.headingSettings
    const mode = resolveHeadingStructure(s).mode

    // Apply persisted heading layouts — per-mode physical H1-H6 (no level shift).
    // Prefer headingLayoutsByMode[mode]; fall back to legacy shared headingLayouts.
    const modeLayouts = lo?.headingLayoutsByMode?.[mode] ?? lo?.headingLayouts
    if (modeLayouts) {
      for (const [key, config] of Object.entries(modeLayouts)) {
        if (config && /^h[1-6]$/.test(key)) {
          draft.headingLayouts[key] = { textAlign: config.textAlign, firstLineIndentEm: config.firstLineIndentEm }
        }
      }
    }

    // Apply persisted number title spacing
    if (lo?.numberTitleSpacing) {
      for (const [lvStr, spacing] of Object.entries(lo.numberTitleSpacing)) {
        const lv = Number(lvStr) as import('../heading-numbering/heading-types').HeadingLevel
        if (lv >= 1 && lv <= 6) {
          draft.numberTitleSpacing[lv] = spacing
        }
      }
    }

    // Normalize: in strict mode H1 gap must be locked to none
    if (!resolveHeadingStructure(s).showLevelOneNumber) {
      const h1Lv = 1 as import('../heading-numbering/heading-types').HeadingLevel
      draft.numberTitleSpacing[h1Lv] = 'none'
    }

    this.headingLayoutDraft = draft
    this.savedLayoutDraft = deepCloneLayoutDraft(draft)
    return draft
  }

  /** Check if layout draft has unsaved changes. */
  private hasLayoutDirty(): boolean {
    if (!this.headingLayoutDraft || !this.savedLayoutDraft) return false
    return !layoutDraftsEqual(this.headingLayoutDraft, this.savedLayoutDraft)
  }

  /**
   * Update the draft's contextual format for a level.
   * Does NOT persist — only modifies the in-memory draft.
   * Automatically switches the draft's preset to 'custom' if necessary.
   */
  private updateDraftContextualFormat(
    lv: HeadingLevel,
    nextFormat: readonly ContextualFormatSegment[],
  ): void {
    this.ensureDraft()
    const s = this.headingDraft!
    // Switch to custom mode if not already
    if (s.preset !== 'custom') {
      s.customDefinition = deepCloneSettings(s).levels
      s.preset = 'custom'
    }
    const slotLv = this.resolveSlotLevel(lv)
    if (slotLv === null) return // strict H1: no slot
    // First edit of loose H6 triggers S6 configured
    if (lv === 6 && resolveHeadingStructure(s).mode === 'loose') {
      s.s6Configured = true
    }
    const currentStyle = s.levels[slotLv]
    // Ensure current level reference is present before updating
    // Use slotLv (not physical lv) for slot-relative reference levels.
    const ensuredFormat = ensureCurrentLevelSegment(slotLv, nextFormat, currentStyle.tokenStyle)
    // Always write to withLevelOne in slot model — withoutLevelOne is legacy.
    const updated = updateActiveContextualFormatVariant(
      currentStyle, slotLv, true, ensuredFormat,
    )
    // Sync multilevelFormatVariants for backward compat
    updated.multilevelFormatVariants = {
      withLevelOne: updated.contextualFormatVariants.withLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
      withoutLevelOne: updated.contextualFormatVariants.withoutLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
    }
    s.levels = { ...s.levels, [slotLv]: updated }
  }

  /**
   * Update the draft's multilevel format for a level.
   * Does NOT persist — only modifies the in-memory draft.
   */
  private updateDraftMultilevelFormat(
    lv: HeadingLevel,
    nextFormat: readonly MultilevelFormatSegment[],
  ): void {
    this.ensureDraft()
    const s = this.headingDraft!
    if (s.preset !== 'custom') {
      s.customDefinition = deepCloneSettings(s).levels
      s.preset = 'custom'
    }
    const slotLv = this.resolveSlotLevel(lv)
    if (slotLv === null) return // strict H1: no slot
    // First edit of loose H6 triggers S6 configured
    if (lv === 6 && resolveHeadingStructure(s).mode === 'loose') {
      s.s6Configured = true
    }
    const currentStyle = s.levels[slotLv]
    const updated = updateActiveMultilevelFormatVariant(
      currentStyle, slotLv, true, nextFormat,
    )
    s.levels = { ...s.levels, [slotLv]: updated }
  }

  /**
   * Update a single segment's appearance properties in the draft.
   * Does NOT persist — only modifies the in-memory draft.
   */
  private updateDraftContextualSegment(
    lv: HeadingLevel,
    segmentId: string,
    patch: Partial<{ tokenStyle: NumberTokenStyle; prefix: string; suffix: string }>,
  ): void {
    this.ensureDraft()
    const s = this.headingDraft!
    if (s.preset !== 'custom') {
      s.customDefinition = deepCloneSettings(s).levels
      s.preset = 'custom'
    }
    const slotLv = this.resolveSlotLevel(lv)
    if (slotLv === null) return // strict H1: no slot
    // First edit of loose H6 triggers S6 configured
    if (lv === 6 && resolveHeadingStructure(s).mode === 'loose') {
      s.s6Configured = true
    }
    const currentStyle = s.levels[slotLv]
    // Always read/write withLevelOne in slot model.
    const activeFmt = getActiveContextualFormatVariant(currentStyle, true, slotLv)
    const nextFmt = activeFmt.map(seg => {
      if (seg.type === 'level-reference' && seg.id === segmentId) {
        return { ...seg, appearance: { ...seg.appearance, ...patch } }
      }
      return seg
    })

    const updated = updateActiveContextualFormatVariant(currentStyle, slotLv, true, nextFmt)
    // Sync multilevelFormatVariants for backward compat
    updated.multilevelFormatVariants = {
      withLevelOne: updated.contextualFormatVariants.withLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
      withoutLevelOne: updated.contextualFormatVariants.withoutLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
    }
    s.levels = { ...s.levels, [slotLv]: updated }
  }

  private rerender(): void {
    // Re-render the entire page to reflect draft changes.
    // Must NOT call onshow() — that resets layout drafts to persisted state.
    this.cancelDrag('draft-change')
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild)
    }
    try {
      this.render()
    } catch (e) {
      console.error('[InkChapter] SettingTab render 失败:', e)
    }
  }

  /**
   * Ensure every level in Custom mode has a current-level segment.
   * If a level's contextualFormatVariants is empty, initialize it with
   * a single current-level reference using the level's own tokenStyle.
   * No parent references or separators are added automatically.
   */
  private ensureAllLevelsHaveCurrentSegment(s: HeadingNumberingSettings): void {
    for (const lv of HEADING_LEVELS) {
      const slotLv = this.resolveSlotLevel(lv)
      if (slotLv === null) continue // strict H1: no slot
      const ls = s.levels[slotLv]
      if (!ls) continue
      // Check specifically for current-level reference, not any reference.
      // Preset formats (e.g. [H1].[H2].[H3]) contain level-references but
      // we need to ensure the CURRENT level's own ref is present.
      const hasOwnWith = ls.contextualFormatVariants?.withLevelOne?.some(
        seg => seg.type === 'level-reference' && seg.level === slotLv,
      )
      const hasOwnWithout = ls.contextualFormatVariants?.withoutLevelOne?.some(
        seg => seg.type === 'level-reference' && seg.level === slotLv,
      )
      const soloSeg: ContextualFormatSegment = {
        id: generateStableId(),
        type: 'level-reference',
        level: slotLv,
        appearance: { tokenStyle: ls.tokenStyle, prefix: '', suffix: '' },
      }
      if (!hasOwnWith) {
        ls.contextualFormatVariants = {
          ...(ls.contextualFormatVariants || {} as any),
          withLevelOne: [{ ...soloSeg, id: generateStableId() }],
        }
      }
      if (!hasOwnWithout && lv !== 1) {
        ls.contextualFormatVariants = {
          ...ls.contextualFormatVariants,
          withoutLevelOne: [{ ...soloSeg, id: generateStableId() }],
        }
      }
    }
  }

  private renderScopeCard(s: HeadingNumberingSettings): void {
    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()

    const card = el('div', 'inkchapter-card', this.containerEl)
    const body = el('div', 'inkchapter-card-body', card)
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px 16px;'

    // ── Row 1: Document info + format source / effective / global default ──
    const resolved = this.getResolvedDocumentFormat()
    const infoRow = el('div', 'inkchapter-scope-info-row', body)
    infoRow.style.cssText = 'display:flex;flex-direction:column;gap:2px;'
    const filename = docPath ? (docPath.split(/[/\\]/).pop() ?? docPath) : null
    const docEl = el('span', 'inkchapter-scope-doc-name', infoRow)
    docEl.textContent = filename ? `当前文档：${filename}` : '当前没有活动文档'
    if (docPath) docEl.title = docPath

    const sourceLine = el('span', '', infoRow)
    sourceLine.textContent = `格式来源：${resolved.mode === 'override' ? '当前文档独立格式' : '继承全局默认'}`
    const effectiveLine = el('span', '', infoRow)
    effectiveLine.textContent = `当前生效：${this.formatRefDisplayName(resolved.effectiveFormatId)}`
    const globalLine = el('span', '', infoRow)
    globalLine.textContent = `全局默认：${this.formatRefDisplayName(resolved.globalDefaultFormatId)}`

    // ── Row 2: Scope segmented control + restore ──
    const controlsRow = el('div', 'inkchapter-scope-controls-row', body)

    const segmented = el('div', 'inkchapter-scope-segmented', controlsRow)

    const docBtn = el('button', 'inkchapter-scope-segmented-btn', segmented) as HTMLButtonElement
    docBtn.textContent = '当前文档'
    if (this.headingScope === 'document') docBtn.classList.add('inkchapter-scope-segmented-btn--active')
    if (!docPath) docBtn.disabled = true
    docBtn.onclick = () => {
      if (this.headingScope === 'document') return
      this.headingScope = 'document'
      const newSettings = this.numberingService.getEffectiveSettings()
      this.headingDraft = deepCloneSettings(newSettings)
      this.headingDraftOriginal = deepCloneSettings(newSettings)
      this.rerender()
    }

    const globalBtn = el('button', 'inkchapter-scope-segmented-btn', segmented) as HTMLButtonElement
    globalBtn.textContent = '全局默认'
    if (this.headingScope === 'global') globalBtn.classList.add('inkchapter-scope-segmented-btn--active')
    globalBtn.onclick = () => {
      if (this.headingScope === 'global') return
      this.headingScope = 'global'
      const newSettings = this.numberingService.getScopeStore().globalDefault
      this.headingDraft = deepCloneSettings(newSettings)
      this.headingDraftOriginal = deepCloneSettings(newSettings)
      this.rerender()
    }

    // Restore button (only when the document has an explicit format override)
    if (resolved.mode === 'override') {
      const restoreBtn = el('button', 'inkchapter-scope-restore-btn', controlsRow)
      restoreBtn.textContent = '恢复继承全局默认'
      restoreBtn.title = '清除当前文档的独立格式，恢复继承全局默认'
      restoreBtn.onclick = () => {
        this.numberingService.restoreInheritGlobal(docKey ?? '')
        // [Diagnostic] Restore inheritance trace
        const afterOverride = this.numberingService.getScopeStore().documentOverrides[docKey ?? '']
        console.log('[InkChapter RestoreInheritance] docKey=' + (docKey ?? 'null')
          + ' afterOverride=' + JSON.stringify(afterOverride ?? null))
        // Clear all document-specific state and sync to global default
        this.headingDraft = null
        this.headingDraftOriginal = null
        this.selectedFormatId = null
        this.selectedFormatType = null
        this.formatDraft = null
        this.savedFormatBaseline = null
        this.headingLayoutDraft = null
        this.savedLayoutDraft = null
        this.selectedSegmentId = null
        this.selectedCardKey = null
        this.selectedCardIsPreset = false
        // Auto-select the global default format
        const info = this.getAppliedFormatInfo()
        if (info.source?.type === 'built-in' && info.source.presetId) {
          this.selectedFormatId = info.source.presetId
          this.selectedFormatType = 'built-in'
          this.selectedCardKey = info.source.presetId
          this.selectedCardIsPreset = true
          this.loadPresetForViewing(info.source.presetId)
        } else if (info.source?.type === 'custom' && info.formatId) {
          const format = this.numberingService.getFormatLibrary().formats.find(f => f.id === info.formatId)
          if (format) {
            this.selectedCardKey = info.formatId
            this.selectedCardIsPreset = false
            this.initializeFormatEditor(format)
          }
        }
        this.rerender()
        Notice.info('已恢复继承全局默认')
      }
    }

    // ── Basic checks (enable + H1 toggle) ──
    const checksRow = el('div', 'inkchapter-basic-checks', body)
    checksRow.style.cssText = 'display:flex;gap:20px;padding:4px 0 0;font-size:13px;'

    const enableLabel = el('label', '', checksRow)
    const enableCb = document.createElement('input')
    enableCb.type = 'checkbox'
    enableCb.checked = s.enabled
    enableCb.onclick = () => {
      this.ensureDraft()
      this.headingDraft!.enabled = enableCb.checked
      this.rerender()
    }
    enableLabel.appendChild(enableCb)
    enableLabel.appendChild(document.createTextNode(' 启用标题编号'))

    // ── Heading structure mode (strict / loose) ──
    const structure = this.resolveStructureFromDraft(s)
    const structureRow = el('div', '', checksRow.parentElement ?? checksRow)
    structureRow.style.cssText = 'margin-top:10px;'
    const structureLabel = el('span', '', structureRow)
    structureLabel.textContent = '标题结构'
    structureLabel.style.cssText = 'font-size:13px;font-weight:500;margin-right:8px;'

    const structureControls = el('div', '', structureRow)
    structureControls.style.cssText = 'display:flex;gap:4px;'

    const strictBtn = el('button', 'inkchapter-range-doc-seg-btn', structureControls) as HTMLButtonElement
    strictBtn.textContent = '严格模式'
    strictBtn.title = 'H1 作为唯一文档题目，不参与编号；正文编号从 H2 开始'
    if (structure.mode === 'strict') strictBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    strictBtn.onclick = () => {
      if (structure.mode === 'strict') return
      this.ensureDraft()
      this.headingDraft!.headingStructureMode = 'strict'
      this.headingDraft!.showLevelOneNumber = false
      // Bump expandedLevel from H1 to H2 if currently viewing H1
      if (this.expandedLevel === 1) this.expandedLevel = 2
      this.rerender()
    }

    const looseBtn = el('button', 'inkchapter-range-doc-seg-btn', structureControls) as HTMLButtonElement
    looseBtn.textContent = '宽松模式'
    looseBtn.title = 'H1 作为普通一级标题参与编号；H1 数量不限'
    if (structure.mode === 'loose') looseBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    looseBtn.onclick = () => {
      if (structure.mode === 'loose') return
      this.ensureDraft()
      this.headingDraft!.headingStructureMode = 'loose'
      this.headingDraft!.showLevelOneNumber = true
      this.rerender()
    }

    // Mode description
    const modeDesc = el('div', '', structureRow.parentElement ?? checksRow)
    modeDesc.style.cssText = 'font-size:12px;color:var(--text-muted,#888);margin-top:4px;'
    modeDesc.textContent = structure.mode === 'strict'
      ? '严格模式：H1 作为唯一文档题目，不参与编号；正文编号从 H2 开始。'
      : '宽松模式：H1 作为普通一级标题参与编号；H1 数量不限。'

    // ── Structure validation status (strict only) ──
    if (structure.mode === 'strict') {
      const docKey = this.numberingService.getDocumentKey()
      if (docKey) {
        try {
          const validation = this.getStructureValidation(s)
          if (validation) {
            const statusRow = el('div', '', structureRow.parentElement ?? structureRow)
            statusRow.style.cssText = 'margin-top:6px;font-size:12px;'
            if (validation.state === 'valid') {
              statusRow.style.color = 'var(--color-green,#2e7d32)'
              statusRow.textContent = `✓ 当前结构：正常 · 检测到 ${validation.h1Count} 个 H1`
            } else if (validation.state === 'missing-title') {
              statusRow.style.color = 'var(--color-orange,#e65100)'
              statusRow.textContent = '⚠ 当前结构：缺少文档题目 — 严格模式要求文档包含一个 H1'
            } else {
              statusRow.style.color = 'var(--color-orange,#e65100)'
              statusRow.textContent = `⚠ 当前结构：检测到 ${validation.h1Count} 个 H1 — 严格模式要求仅保留一个 H1`
            }
          }

          // ── STRICT-FIRST-H1 top-line: read runtime cached state (UI is a consumer) ──
          const topline = this.numberingService.getStrictFirstH1ToplineResult?.()
          const firstH1 = topline?.result ?? null
          const validationSource = topline?.source ?? 'UI_FALLBACK'

          if (firstH1 && !firstH1.passed) {
            const firstH1Row = el('div', '', structureRow.parentElement ?? structureRow)
            firstH1Row.style.cssText = 'margin-top:4px;font-size:12px;color:var(--color-red,#c62828);white-space:pre-line;'
            firstH1Row.textContent = firstH1.message
          }

          if (validationSource === 'UI_FALLBACK' && firstH1) {
            emitRuntimeAudit('STRICT-DOCUMENT-VALIDATION-TRIGGER', {
              documentKey: docKey,
              mode: 'strict',
              trigger: 'UI_FALLBACK',
              previousDecision: 'NONE',
              nextDecision: firstH1.decision,
              documentStartState: firstH1.documentStartState,
              firstLineRaw: firstH1.firstLineRaw ?? null,
              firstBlockType: firstH1.firstBlockType ?? null,
              firstHeadingLevel: firstH1.firstHeadingLevel ?? null,
              decision: firstH1.decision === 'SKIP' ? 'SKIP' : 'RUN',
              reason: firstH1.reason,
            })
          }
        } catch { /* validation best-effort */ }
      }
    }
  }

  // ── Unified format library grid ──────────────────

  private renderFormatLibraryCard(s: HeadingNumberingSettings): void {
    const card = el('div', 'inkchapter-card', this.containerEl)
    const header = el('div', 'inkchapter-card-header', card)
    const titleRow = el('div', 'inkchapter-library-title-row', header)
    const title = el('div', 'inkchapter-library-title', titleRow)
    title.textContent = '编号格式库'

    const manageBtn = el('button', 'inkchapter-library-manage-btn', titleRow)
    manageBtn.textContent = this.managePanelOpen ? '⚙ 收起管理' : '⚙ 管理格式库'
    manageBtn.onclick = () => {
      this.cancelDrag()
      this.managePanelOpen = !this.managePanelOpen
      this.rerender()
    }

    // Management panel
    if (this.managePanelOpen) {
      this.renderManageLibraryPanel(card)
    }

    const grid = el('div', 'inkchapter-format-grid', card)

    // System presets (only visible ones)
    for (const card of PRESET_CARDS) {
      if (isBuiltInPresetHidden(this.formatLibrary, card.key as BuiltInPresetId)) continue
      const cardState = this.getCardState(card.key, true)
      const cardEl = this.buildFormatCard(
        grid, card.key, card.name, card.desc, card.previewLines, true,
        () => this.handlePresetCardApply(card.key),
        cardState,
      )
      if (this.isCardSelected(card.key, true)) {
        cardEl.classList.add('inkchapter-format-card--selected')
      }
    }

    // User formats (ordered) — collect pending update notices for one-time toast
    const orderedFormats = getOrderedCustomFormats(this.formatLibrary)
    const pendingNotices: Array<{ formatName: string; formatId: string; templateVersion: number }> = []
    for (const format of orderedFormats) {
      const previewLines = getFormatPreview(format, 3, format.settings.showLevelOneNumber)
      const cardState = this.getCardState(format.id, false)
      const cardEl = this.buildFormatCard(
        grid, format.id, format.name, format.description || '', previewLines, false,
        () => this.handleFormatCardApply(format),
        cardState,
      )
      if (this.isCardSelected(format.id, false)) {
        cardEl.classList.add('inkchapter-format-card--selected')
      }
      // Collect pending template update notices
      if (cardState.pendingUpdateNotice && cardState.templateVersion) {
        pendingNotices.push({ formatName: format.name, formatId: format.id, templateVersion: cardState.templateVersion })
      }
    }

    // "+ New format" dashed card
    const addCard = el('div', 'inkchapter-format-card--add', grid)
    addCard.textContent = '+ 新建格式'
    addCard.setAttribute('tabindex', '0')
    addCard.onclick = () => {
      this.cancelDrag()
      this.showCreateFormatDialog()
    }
    addCard.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showCreateFormatDialog() }
    }

    // Empty state for user formats
    if (orderedFormats.length === 0) {
      const emptyHint = el('div', 'inkchapter-format-empty-hint', grid)
      emptyHint.textContent = '尚未创建自定义格式。'
      emptyHint.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--text-muted,#888);font-size:13px;padding:12px;'
    }

    // Show one-time toast for pending template updates, then acknowledge
    if (pendingNotices.length > 0) {
      const names = pendingNotices.map(n => `"${n.formatName}"`).join('、')
      Notice.info(`格式 ${names} 有可用更新`)
      const docKey = this.numberingService.getDocumentKey()
      if (docKey) {
        for (const n of pendingNotices) {
          this.numberingService.acknowledgeTemplateUpdate(docKey, n.formatId, n.templateVersion)
        }
      }
    }
  }

  /** Build a single format card for the unified grid. */
  private buildFormatCard(
    grid: HTMLElement,
    key: string,
    name: string,
    desc: string,
    previewLines: string[],
    isPreset: boolean,
    onApply: () => void,
    cardState: { applied: boolean; effective: boolean; currentDocument: boolean; isGlobalDefault: boolean; inheritsGlobal: boolean;
      templateVersionNewer: boolean; pendingUpdateNotice: boolean;
      templateVersion?: number; sourceVersion?: number;
    },
  ): HTMLElement {
    const cardEl = el('div', 'inkchapter-format-card', grid)
    cardEl.setAttribute('tabindex', '0')

    // ── Header: title row → meta row ──
    const header = el('div', 'inkchapter-format-card-header', cardEl)
    
    // Title row
    const titleRow = el('div', 'inkchapter-format-card-title-row', header)
    const cardName = el('span', 'inkchapter-format-card-title', titleRow)
    cardName.textContent = name
    
    // Meta row: independent status badges (not mutually exclusive)
    const metaRow = el('div', 'inkchapter-format-card-meta-row', header)
    const badgeWrap = el('span', 'inkchapter-format-card-badge-wrap', metaRow)
    badgeWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;'
    
    // "当前文档" — ONLY when this document is explicitly overridden to this format.
    if (cardState.currentDocument) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--applied', badgeWrap)
      badge.textContent = '当前文档'
    }
    
    // "全局默认" — globalDefaultFormatId === this format.
    if (cardState.isGlobalDefault) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--global-default', badgeWrap)
      badge.textContent = '全局默认'
    }

    // "当前生效" — effectiveFormatId === this format (inherit OR override).
    if (cardState.effective) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--effective', badgeWrap)
      badge.textContent = '当前生效'
    }

    // "⋯" menu trigger
    const menuBtn = el('span', 'inkchapter-format-card-menu-trigger', cardEl)
    menuBtn.textContent = '⋯'
    menuBtn.setAttribute('tabindex', '0')
    menuBtn.setAttribute('role', 'button')
    menuBtn.setAttribute('aria-label', '更多格式操作')
    menuBtn.setAttribute('aria-haspopup', 'menu')
    menuBtn.setAttribute('aria-expanded', String(this.openMenuState?.formatId === key))
    menuBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.openMenuState?.formatId === key) {
        this.closeMenu()
      } else {
        this.openMenu(key, isPreset ? 'built-in' : 'custom', name, menuBtn)
      }
    }
    menuBtn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); menuBtn.click()
      }
    }

    const cardDesc = el('div', 'inkchapter-format-card-desc', cardEl)
    cardDesc.textContent = desc || (isPreset ? '' : '（无描述）')

    if (previewLines.length > 0) {
      const previewDiv = el('div', 'inkchapter-format-card-preview', cardEl)
      for (const line of previewLines) {
        const lineEl = el('div', 'inkchapter-format-card-preview-line', previewDiv)
        lineEl.textContent = line
      }
    }

    // Apply button — separate business state from notice state
    const actions = el('div', 'inkchapter-format-card-actions', cardEl)
    const applyBtn = el('button', 'inkchapter-btn', actions) as HTMLButtonElement
    
    let btnText = '应用到当前文档'
    let btnDisabled = false
    
    if (this.headingScope === 'global') {
      // Global default scope: button only sets the global default.
      if (cardState.isGlobalDefault) {
        btnText = '当前默认'
        btnDisabled = true
      } else {
        btnText = '设为全局默认'
      }
    } else {
      // Current document scope.
      if (cardState.currentDocument) {
        // This document is explicitly bound to this format.
        if (cardState.templateVersionNewer) {
          btnText = '应用更新'
        } else {
          btnText = '当前使用'
          btnDisabled = true
        }
      } else if (cardState.inheritsGlobal && cardState.effective) {
        // Inherit mode + this is the effective (=global default) format.
        btnText = '继承中'
        btnDisabled = true
      } else {
        btnText = '应用到当前文档'
      }
    }

    applyBtn.textContent = btnText
    applyBtn.disabled = btnDisabled
    if (btnDisabled) {
      applyBtn.classList.add('inkchapter-btn--disabled')
      applyBtn.style.cssText = 'opacity:0.6;cursor:default;'
    }
    applyBtn.onclick = (e) => {
      e.stopPropagation()
      if (btnDisabled) return
      this.cancelDrag()
      if (cardState.templateVersionNewer) {
        // Apply update: re-apply the format with current template.
        if (isPreset) {
          this.applyPresetToScope(key)
        } else {
          const fmt = this.formatLibrary.formats.find(f => f.id === key)
          if (fmt) this.applyFormatToScope(fmt)
        }
      } else if (this.headingScope === 'global') {
        // Set as global default — never touches the document binding.
        if (isPreset) {
          this.applyPresetToScope(key, 'global')
        } else {
          const fmt = this.formatLibrary.formats.find(f => f.id === key)
          if (fmt) this.applyFormatToScope(fmt, 'global')
        }
      } else {
        // Apply to current document (override).
        onApply()
      }
    }

    // Click card to select AND show format content below
    cardEl.onclick = () => {
      this.cancelDrag()
      this.closeMenu()
      this.selectedCardKey = key
      this.selectedCardIsPreset = isPreset
      if (isPreset) {
        // System format: show read-only content
        this.selectedFormatId = key
        this.selectedFormatType = 'built-in'
        this.formatDraft = null
        this.savedFormatBaseline = null
        this.loadPresetForViewing(key)
      } else {
        // Custom format: load editor
        const format = this.formatLibrary.formats.find(f => f.id === key)
        if (format) {
          this.initializeFormatEditor(format)
        }
      }
      this.rerender()
    }
    cardEl.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.cancelDrag()
        this.closeMenu()
        this.selectedCardKey = key
        this.selectedCardIsPreset = isPreset
        if (isPreset) {
          this.selectedFormatId = key
          this.selectedFormatType = 'built-in'
          this.formatDraft = null
          this.savedFormatBaseline = null
          this.loadPresetForViewing(key)
        } else {
          const format = this.formatLibrary.formats.find(f => f.id === key)
          if (format) {
            this.initializeFormatEditor(format)
          }
        }
        this.rerender()
      }
    }

    return cardEl
  }

  // ── Card dropdown menu (portal-based) ────────────

  private openMenu(formatId: string, formatType: 'built-in' | 'custom', formatName: string, trigger: HTMLElement): void {
    this.closeMenu() // Close any existing
    this.openMenuState = { formatId, formatType, formatName, triggerElement: trigger }
    
    // Update aria-expanded
    trigger.setAttribute('aria-expanded', 'true')
    
    this.renderMenuPortal()
    this.bindMenuEvents()
  }

  private closeMenu(): void {
    if (!this.openMenuState) return
    // Reset aria
    this.openMenuState.triggerElement.setAttribute('aria-expanded', 'false')
    this.openMenuState = null
    
    // Remove menu DOM
    const layer = this.containerEl.querySelector('.inkchapter-menu-layer')
    if (layer) { while (layer.firstChild) layer.removeChild(layer.firstChild) }
    
    // Clean up event listeners
    this.cleanupMenuEvents()
  }

  private cleanupMenuEvents(): void {
    for (const fn of this.menuCleanups) { try { fn() } catch {} }
    this.menuCleanups = []
  }

  private bindMenuEvents(): void {
    this.cleanupMenuEvents()
    
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const menuEl = this.containerEl.querySelector('.inkchapter-menu-overlay')
      const trigger = this.openMenuState?.triggerElement
      if (menuEl?.contains(target)) return // Click inside menu
      if (trigger?.contains(target)) return // Click on trigger
      this.closeMenu()
    }
    
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.openMenuState) return
      if (e.key === 'Escape') {
        e.preventDefault()
        const trigger = this.openMenuState.triggerElement
        this.closeMenu()
        trigger?.focus()
      }
      this.handleMenuKeyboard(e)
    }
    
    const onScroll = () => { this.closeMenu() }
    
    document.addEventListener('mousedown', onDocClick, true)
    this.containerEl.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('keydown', onKeyDown, true)
    
    this.menuCleanups.push(
      () => document.removeEventListener('mousedown', onDocClick, true),
      () => this.containerEl.removeEventListener('scroll', onScroll),
      () => document.removeEventListener('keydown', onKeyDown, true),
    )
    
    // Clean on settings close
    const onHide = () => this.closeMenu()
    ;(this as any)._menuHideHandler = onHide
    const originalOnhide = this.onhide
    this.onhide = () => { this.closeMenu(); originalOnhide.call(this) }
  }

  private handleMenuKeyboard(e: KeyboardEvent): void {
    if (!this.openMenuState) return
    const items = this.containerEl.querySelectorAll('.inkchapter-menu-overlay .inkchapter-menu-item:not([aria-disabled="true"])')
    if (items.length === 0) return
    
    let idx = -1
    for (let i = 0; i < items.length; i++) {
      if (items[i] === document.activeElement) { idx = i; break }
    }
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (idx + 1) % items.length
      ;(items[next] as HTMLElement).focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (idx - 1 + items.length) % items.length
      ;(items[prev] as HTMLElement).focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      ;(items[0] as HTMLElement).focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      ;(items[items.length - 1] as HTMLElement).focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (idx >= 0) { (items[idx] as HTMLElement).click() }
    } else if (e.key === 'Tab') {
      this.closeMenu()
    }
  }

  private renderMenuPortal(): void {
    const state = this.openMenuState!
    const layer = this.containerEl.querySelector('.inkchapter-menu-layer') as HTMLElement
    if (!layer) return
    
    // Clear
    while (layer.firstChild) layer.removeChild(layer.firstChild)
    
    const overlay = el('div', 'inkchapter-menu-overlay', layer)
    overlay.setAttribute('role', 'menu')
    overlay.style.cssText = 'position:absolute;pointer-events:auto;width:180px;background:var(--background-primary,#fff);border:1px solid var(--border-primary,#ddd);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:6px 0;z-index:200;'
    
    const addSeparator = () => {
      const sep = el('div', 'inkchapter-menu-separator', overlay)
      sep.style.cssText = 'height:1px;margin:4px 0;background:var(--border-primary,#eee);'
    }
    
    const addItem = (label: string, onClick: () => void, opts?: { danger?: boolean; disabled?: boolean }) => {
      const item = el('div', 'inkchapter-menu-item', overlay) as HTMLElement
      item.setAttribute('role', 'menuitem')
      item.setAttribute('tabindex', '0')
      item.textContent = label
      if (opts?.disabled) {
        item.setAttribute('aria-disabled', 'true')
        item.style.cssText = 'padding:8px 16px;font-size:13px;white-space:nowrap;cursor:default;opacity:0.45;pointer-events:none;'
      } else {
        item.style.cssText = `padding:8px 16px;font-size:13px;white-space:nowrap;cursor:pointer;${opts?.danger ? 'color:#e00;' : ''}`
        item.onclick = (e) => { e.stopPropagation(); onClick(); this.closeMenu() }
        item.onmouseenter = () => { item.style.background = 'var(--background-modifier-hover,#f0f0f0)' }
        item.onmouseleave = () => { item.style.background = '' }
        item.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click() }
        }
      }
      return item
    }
    
    const isPreset = state.formatType === 'built-in'
    const scopeStore = this.numberingService.getScopeStore()
    const gSource = (scopeStore.globalDefault as any).formatSource as NumberingFormatSource | undefined
    const isGlobalDefault = isPreset
      ? (gSource?.type === 'built-in' && gSource.presetId === state.formatId)
      : (gSource?.type === 'custom' && gSource.formatId === state.formatId)
    
    if (isPreset) {
      // System preset menu
      if (isGlobalDefault) {
        addItem('已设为全局默认', () => {}, { disabled: true })
      } else {
        addItem('设为全局默认', () => this.applyPresetToScope(state.formatId, 'global'))
      }
      addItem('复制为自定义格式', () => this.showCreateFormatDialog(state.formatId))
      addSeparator()
      addItem('隐藏此预设', () => this.showHidePresetConfirm(state.formatId as BuiltInPresetId, state.formatName), { danger: true })
    } else {
      // User format menu
      addItem('编辑格式', () => {
        const fmt = this.formatLibrary.formats.find(f => f.id === state.formatId)
        if (fmt) this.startEditingFormat(fmt)
      })
      if (isGlobalDefault) {
        addItem('已设为全局默认', () => {}, { disabled: true })
      } else {
        addItem('设为全局默认', () => {
          const fmt = this.formatLibrary.formats.find(f => f.id === state.formatId)
          if (fmt) this.applyFormatToScope(fmt, 'global')
        })
      }
      addSeparator()
      addItem('复制格式', () => {
        const fmt = this.formatLibrary.formats.find(f => f.id === state.formatId)
        if (fmt) this.copyUserFormat(fmt)
      })
      addItem('重命名…', () => {
        const fmt = this.formatLibrary.formats.find(f => f.id === state.formatId)
        if (fmt) this.renameUserFormat(fmt)
      })
      addSeparator()
      addItem('删除格式…', () => {
        const fmt = this.formatLibrary.formats.find(f => f.id === state.formatId)
        if (fmt) this.showDeleteFormatConfirm(fmt)
      }, { danger: true })
    }
    
    // Position the menu with 4-direction auto-flip
    // Use visibility:hidden so we can measure real dimensions without flicker
    overlay.style.visibility = 'hidden'
    this.positionMenu(overlay, state.triggerElement)
    overlay.style.visibility = 'visible'
    
    // Auto-focus first item
    setTimeout(() => {
      const firstItem = overlay.querySelector('.inkchapter-menu-item:not([aria-disabled="true"])') as HTMLElement | null
      firstItem?.focus()
    }, 50)
  }

  private positionMenu(menuEl: HTMLElement, trigger: HTMLElement): void {
    const GAP = 6
    const SAFE_MARGIN = 8
    const triggerRect = trigger.getBoundingClientRect()
    
    // Measure menu dimensions (must be rendered with visibility:hidden first)
    const menuWidth = menuEl.offsetWidth || 180
    const menuHeight = menuEl.offsetHeight || 200
    
    // Get settings dialog bounds for overflow clamping (viewport coordinates)
    const settingsEl = this.containerEl.closest('.ty-setting-panel-body') as HTMLElement
      || this.containerEl.closest('[class*="setting"]') as HTMLElement
      || this.containerEl.closest('[class*="panel"]') as HTMLElement
    const panelRect = settingsEl?.getBoundingClientRect() ?? {
      top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight,
      width: window.innerWidth, height: window.innerHeight,
    }
    
    // ── Direction decision ────────────────────────
    const rightSpace = panelRect.right - triggerRect.right - SAFE_MARGIN
    const leftSpace = triggerRect.left - panelRect.left - SAFE_MARGIN
    const bottomSpace = panelRect.bottom - triggerRect.bottom - SAFE_MARGIN
    const topSpace = triggerRect.top - panelRect.top - SAFE_MARGIN
    
    const goRight = rightSpace >= menuWidth || rightSpace > leftSpace
    const goDown = bottomSpace >= menuHeight || bottomSpace > topSpace
    
    // ── Compute position in VIEWPORT coordinates ──
    let left: number
    let top: number
    
    if (goDown) {
      // Below trigger
      top = triggerRect.bottom + GAP
    } else {
      // Above trigger
      top = triggerRect.top - menuHeight - GAP
    }
    
    if (goRight) {
      // Right of trigger (align left edges)
      left = triggerRect.left
    } else {
      // Left of trigger (align right edges)
      left = triggerRect.right - menuWidth
    }
    
    // ── Clamp within panel bounds ─────────────────
    left = Math.max(panelRect.left + SAFE_MARGIN, Math.min(left, panelRect.right - menuWidth - SAFE_MARGIN))
    top = Math.max(panelRect.top + SAFE_MARGIN, Math.min(top, panelRect.bottom - menuHeight - SAFE_MARGIN))
    
    // Apply as viewport-fixed position
    menuEl.style.position = 'fixed'
    menuEl.style.left = left + 'px'
    menuEl.style.top = top + 'px'
    menuEl.style.right = 'auto'
    menuEl.style.bottom = 'auto'
  }

  private handlePresetCardApply(presetKey: string): void {
    this.applyPresetToScope(presetKey)
  }

  private handleFormatCardApply(format: CustomNumberingFormat): void {
    this.applyFormatToScope(format)
  }

  // ── Card dropdown menu ───────────────────────────

  private renderCardDropdownMenu(cardEl: HTMLElement, key: string, name: string, isPreset: boolean): void {
    const menu = el('div', 'inkchapter-format-card-menu', cardEl)
    menu.style.cssText = 'position:absolute;top:28px;right:4px;z-index:100;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#ddd);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:160px;padding:4px 0;'

    const addItem = (label: string, onClick: () => void, danger = false) => {
      const item = el('div', 'inkchapter-format-card-menu-item', menu)
      item.textContent = label
      item.style.cssText = `padding:6px 16px;cursor:pointer;font-size:13px;${danger ? 'color:#e00;' : ''}`
      item.onclick = (e) => { e.stopPropagation(); onClick() }
      item.onmouseenter = () => { item.style.background = 'var(--bg-hover,#f0f0f0)' }
      item.onmouseleave = () => { item.style.background = '' }
      return item
    }

    if (isPreset) {
      // System preset menu
      addItem('设为全局默认', () => {
        this.closeMenu()
        this.applyPresetToScope(key, 'global')
      })
      addItem('复制为自定义格式', () => {
        this.closeMenu()
        this.showCreateFormatDialog(key)
      })
      addItem('隐藏此预设', () => {
        this.closeMenu()
        this.showHidePresetConfirm(key as BuiltInPresetId, name)
      })
    } else {
      // User format menu
      addItem('编辑', () => {
        this.closeMenu()
        const fmt = this.formatLibrary.formats.find(f => f.id === key)
        if (fmt) this.startEditingFormat(fmt)
      })
      addItem('设为全局默认', () => {
        this.closeMenu()
        const fmt = this.formatLibrary.formats.find(f => f.id === key)
        if (fmt) this.applyFormatToScope(fmt, 'global')
      })
      addItem('复制', () => {
        this.closeMenu()
        const fmt = this.formatLibrary.formats.find(f => f.id === key)
        if (fmt) this.copyUserFormat(fmt)
      })
      addItem('重命名', () => {
        this.closeMenu()
        const fmt = this.formatLibrary.formats.find(f => f.id === key)
        if (fmt) this.renameUserFormat(fmt)
      })
      addItem('删除', () => {
        this.closeMenu()
        const fmt = this.formatLibrary.formats.find(f => f.id === key)
        if (fmt) this.showDeleteFormatConfirm(fmt)
      }, true)
    }
  }

  // ── Management panel ─────────────────────────────

  private renderManageLibraryPanel(parentEl?: HTMLElement): void {
    const container = parentEl ?? this.containerEl
    const panel = el('div', 'inkchapter-manage-panel', container)
    panel.style.cssText = 'margin:0 0 12px;padding:12px;background:var(--bg-secondary,#f9f9f9);border:1px solid var(--border-color,#ddd);border-radius:8px;'

    // System presets section
    const sysTitle = el('div', '', panel)
    sysTitle.textContent = '系统预设'
    sysTitle.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;'

    // List each preset with show/hide status
    for (const presetId of BUILT_IN_PRESET_IDS) {
      const meta = PRESET_CARDS.find(c => c.key === presetId)
      if (!meta) continue
      const hidden = isBuiltInPresetHidden(this.formatLibrary, presetId)
      const row = el('div', '', panel)
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;'
      const info = el('span', '', row)
      info.textContent = `${meta.name}${hidden ? ' （已隐藏）' : ''}`
      info.style.cssText = 'font-size:13px;'
      const btn = el('button', 'inkchapter-btn inkchapter-btn--small', row)
      btn.textContent = hidden ? '恢复显示' : '隐藏'
      btn.onclick = () => {
        if (hidden) {
          this.formatLibrary = showBuiltInPreset(this.formatLibrary, presetId)
        } else {
          this.formatLibrary = hideBuiltInPreset(this.formatLibrary, presetId)
        }
        this.numberingService.saveFormatLibrary(this.formatLibrary)
        this.rerender()
      }
    }

    // Restore built-in presets button
    const restoreBtn = el('button', 'inkchapter-btn', panel)
    restoreBtn.textContent = '恢复内置预设'
    restoreBtn.style.cssText = 'margin-top:8px;'
    ;(restoreBtn as HTMLButtonElement).disabled = areAllBuiltInPresetsVisible(this.formatLibrary)
    restoreBtn.onclick = () => {
      this.showConfirmDialog(
        '恢复内置预设？',
        '这将重新显示所有插件自带的编号格式，\n不会删除您的自定义格式，也不会修改现有文档。',
        '恢复',
        () => {
          this.formatLibrary = restoreBuiltInPresets(this.formatLibrary)
          this.numberingService.saveFormatLibrary(this.formatLibrary)
          this.rerender()
        },
      )
    }
    if (areAllBuiltInPresetsVisible(this.formatLibrary)) {
      const hint = el('div', '', panel)
      hint.textContent = '所有内置预设均已显示。'
      hint.style.cssText = 'font-size:12px;color:var(--text-muted,#888);margin-top:4px;'
    }

    // Divider
    const divider = el('div', '', panel)
    divider.style.cssText = 'border-top:1px solid var(--border-color,#ddd);margin:12px 0;'

    // Advanced operations
    const advTitle = el('div', '', panel)
    advTitle.textContent = '高级操作'
    advTitle.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;'

    const resetBtn = el('button', 'inkchapter-btn inkchapter-btn--danger', panel)
    resetBtn.textContent = '重置整个格式库'
    resetBtn.onclick = () => {
      this.showResetLibraryConfirm()
    }
  }

  // ── Confirmation dialogs ─────────────────────────

  private showHidePresetConfirm(presetId: BuiltInPresetId, name: string): void {
    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:380px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = `隐藏"${name}"？`

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.textContent = '隐藏后，该预设将不再显示在格式库中，\n但当前文档和全局设置不会改变。\n您可以在"管理格式库"中恢复。'

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()
    const confirmBtn = el('button', 'inkchapter-btn', btnRow)
    confirmBtn.textContent = '隐藏'
    confirmBtn.onclick = () => {
      this.formatLibrary = hideBuiltInPreset(this.formatLibrary, presetId)
      this.numberingService.saveFormatLibrary(this.formatLibrary)
      overlay.remove()
      this.rerender()
    }
  }

  private showDeleteFormatConfirm(format: CustomNumberingFormat): void {
    const scopeStore = this.numberingService.getScopeStore()
    const refs = findFormatReferences(scopeStore, customFormatRef(format.id))

    if (refs.isGlobalDefault) {
      this.showDeleteGlobalDefaultConfirm(format)
      return
    }

    if (refs.overrideDocumentKeys.length > 0) {
      this.showDeleteInUseConfirm(format, refs.overrideDocumentKeys)
      return
    }

    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:380px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = `删除自定义格式"${format.name}"？`

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.textContent = '删除后，该格式将不再出现在格式库中。\n已经应用该格式的文档将继续保留当前编号样式。'

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()
    const deleteBtn = el('button', 'inkchapter-btn inkchapter-btn--danger', btnRow)
    deleteBtn.textContent = '删除'
    deleteBtn.onclick = () => {
      this.executeDeleteFormat(format)
      overlay.remove()
    }
  }

  /** Block deletion of a format still referenced by one or more document overrides. */
  private showDeleteInUseConfirm(format: CustomNumberingFormat, documentKeys: string[]): void {
    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:420px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = `无法删除"${format.name}"`

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.textContent = `该格式仍被 ${documentKeys.length} 个文档显式使用，不能直接删除。\n请先在这些文档中「恢复继承全局默认」或改用其他格式。`

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const okBtn = el('button', 'inkchapter-btn', btnRow)
    okBtn.textContent = '知道了'
    okBtn.onclick = () => overlay.remove()
  }

  private showDeleteGlobalDefaultConfirm(format: CustomNumberingFormat): void {
    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:400px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = `"${format.name}"当前是全局默认格式。`

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.innerHTML = '<p>删除前请选择新的全局默认格式：</p>'

    const select = document.createElement('select')
    select.style.cssText = 'width:100%;padding:6px;margin:8px 0;'
    // Add visible presets
    for (const presetId of getVisibleBuiltInPresets(this.formatLibrary)) {
      const meta = PRESET_CARDS.find(c => c.key === presetId)
      if (meta) {
        const opt = document.createElement('option')
        opt.value = presetId
        opt.textContent = meta.name
        select.appendChild(opt)
      }
    }
    // Add other user formats
    for (const f of this.formatLibrary.formats) {
      if (f.id !== format.id) {
        const opt = document.createElement('option')
        opt.value = f.id
        opt.textContent = f.name
        select.appendChild(opt)
      }
    }
    body.appendChild(select)

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()
    const confirmBtn = el('button', 'inkchapter-btn', btnRow)
    confirmBtn.textContent = '替换并删除'
    confirmBtn.onclick = () => {
      const selected = select.value
      const presetMeta = PRESET_CARDS.find(c => c.key === selected)
      if (presetMeta) {
        this.numberingService.applyPresetToScope(selected, 'global', null)
      } else {
        const altFormat = this.formatLibrary.formats.find(f => f.id === selected)
        if (altFormat) {
          this.numberingService.applyFormatToScope(altFormat, 'global', null)
        }
      }
      this.executeDeleteFormat(format)
      overlay.remove()
    }
  }

  private executeDeleteFormat(format: CustomNumberingFormat): void {
    this.formatLibrary = deleteFormat(this.formatLibrary, format.id)
    this.numberingService.saveFormatLibrary(this.formatLibrary)

    if (this.selectedFormatId === format.id) {
      this.selectedFormatId = null
      this.selectedFormatType = null
      this.formatDraft = null
      this.savedFormatBaseline = null
      this.headingDraft = null
      this.headingDraftOriginal = null
    }
    if (this.selectedCardKey === format.id && !this.selectedCardIsPreset) {
      // Select next or previous or fallback
      const ordered = getOrderedCustomFormats(this.formatLibrary)
      if (ordered.length > 0) {
        this.selectedCardKey = ordered[0].id
        this.selectedCardIsPreset = false
      } else {
        this.selectedCardKey = 'decimal-hierarchical'
        this.selectedCardIsPreset = true
      }
    }
    this.closeMenu()
    Notice.info(`格式已删除`)
    this.rerender()
  }

  private showResetLibraryConfirm(): void {
    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:420px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = '重置整个格式库？'

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.innerHTML = `
      <p>此操作将：</p>
      <ul>
        <li>删除全部用户自定义格式；</li>
        <li>恢复全部插件内置预设；</li>
        <li>清除格式库隐藏和排序设置；</li>
        <li>只保留插件自带的默认格式群。</li>
      </ul>
      <p style="margin-top:8px;">已经应用到文档的格式快照不会改变。</p>
      <p style="margin-top:12px;">请输入"<strong>重置格式库</strong>"以确认：</p>
    `
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = '请输入"重置格式库"'
    input.style.cssText = 'width:100%;padding:6px 8px;margin-top:4px;'
    body.appendChild(input)

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()
    const confirmBtn = el('button', 'inkchapter-btn inkchapter-btn--danger', btnRow) as HTMLButtonElement
    confirmBtn.textContent = '确认重置'
    confirmBtn.disabled = true

    input.oninput = () => {
      confirmBtn.disabled = input.value !== '重置格式库'
    }

    confirmBtn.onclick = () => {
      if (input.value !== '重置格式库') return
      // Handle global default if set to a user format
      const scopeStore = this.numberingService.getScopeStore()
      const globalPreset = scopeStore.globalDefault.preset
      if (globalPreset === 'custom') {
        // Switch global default to decimal-hierarchical
        this.numberingService.applyPresetToScope('decimal-hierarchical', 'global', null)
      }
      // Reset library
      this.formatLibrary = resetLibrary()
      this.numberingService.saveFormatLibrary(this.formatLibrary)
      this.selectedFormatId = null
      this.selectedFormatType = null
      this.formatDraft = null
      this.savedFormatBaseline = null
      this.headingDraft = null
      this.headingDraftOriginal = null
      this.selectedCardKey = null
      this.closeMenu()
      this.managePanelOpen = false
      overlay.remove()
      Notice.info('格式库已重置')
      this.rerender()
    }

    // Focus input
    setTimeout(() => input.focus(), 50)
  }

  private showConfirmDialog(
    titleText: string,
    bodyText: string,
    confirmLabel: string,
    onConfirm: () => void,
  ): void {
    const overlay = this.showModalOverlay()
    const dialog = el('div', 'inkchapter-dialog', overlay)
    dialog.style.cssText = 'min-width:380px;'

    const title = el('div', 'inkchapter-dialog-title', dialog)
    title.textContent = titleText

    const body = el('div', 'inkchapter-dialog-body', dialog)
    body.textContent = bodyText

    const btnRow = el('div', 'inkchapter-dialog-buttons', dialog)
    const cancelBtn = el('button', 'inkchapter-btn', btnRow)
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => overlay.remove()
    const confirmBtn = el('button', 'inkchapter-btn', btnRow)
    confirmBtn.textContent = confirmLabel
    confirmBtn.onclick = () => {
      onConfirm()
      overlay.remove()
    }
  }

  private showModalOverlay(): HTMLElement {
    const existing = document.querySelector('.inkchapter-dialog-overlay')
    if (existing) existing.remove()
    const overlay = el('div', 'inkchapter-dialog-overlay')
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove()
    }
    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey) }
    }
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
    return overlay
  }

  // ── Current format summary ───────────────────────

  private renderCurrentFormatSummary(s: HeadingNumberingSettings): void {
    const summary = el('div', 'inkchapter-current-format-summary', this.containerEl)
    const info = this.getAppliedFormatInfo()

    // Info line
    const infoRow = el('div', 'inkchapter-current-info', summary)
    const label = el('span', '', infoRow)
    label.textContent = '当前格式：'
    label.style.cssText = 'font-weight:500;'
    const nameEl = el('span', 'inkchapter-current-name', infoRow)
    nameEl.textContent = this.getCurrentFormatDisplayNameV2(info)
    const typeEl = el('span', 'inkchapter-current-type', infoRow)
    
    if (info.inheritsGlobal) {
      typeEl.textContent = '（继承全局默认）'
    } else if (info.source && info.source.type === 'snapshot') {
      typeEl.textContent = '（独立快照）'
    } else if (info.source && info.source.type === 'custom') {
      const src = info.source
      const fmt = this.formatLibrary.formats.find(f => f.id === src.formatId)
      const hasUpdate = hasFormatUpdate(this.formatLibrary, src.formatId, this.getAppliedFormatVersion() ?? 0)
      typeEl.textContent = hasUpdate ? '（模板已有更新）' : '（当前文档独立设置）'
    } else if (info.source && info.source.type === 'built-in') {
      typeEl.textContent = '（当前文档独立设置）'
    } else {
      typeEl.textContent = '（自定义设置）'
    }

    // Action buttons
    const actions = el('div', 'inkchapter-current-actions', summary)

    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()

    // Apply to Doc
    const applyDocBtn = el('button', 'inkchapter-btn', actions)
    applyDocBtn.textContent = '应用到当前文档'
    applyDocBtn.setAttribute('title', '将当前格式应用到当前文档')
    ;(applyDocBtn as HTMLButtonElement).disabled = !docPath
    applyDocBtn.onclick = () => {
      this.applyCurrentToScope('document')
    }

    // Set as Global Default
    const applyGlobalBtn = el('button', 'inkchapter-btn', actions)
    applyGlobalBtn.textContent = '设为全局默认'
    applyGlobalBtn.title = '将当前格式设为全局默认'
    applyGlobalBtn.onclick = () => {
      this.applyCurrentToScope('global')
    }

    // Edit / Copy as Custom
    if (s.preset !== 'custom' || !this.selectedFormatId) {
      // System preset: show [Copy as Custom] (which also acts as edit entry)
      const copyBtn = el('button', 'inkchapter-btn', actions)
      copyBtn.textContent = '复制为自定义'
      copyBtn.title = '基于当前预设创建可编辑的自定义格式'
      copyBtn.onclick = () => {
        this.cancelDrag()
        this.showCreateFormatDialog(s.preset === 'custom' ? undefined : s.preset)
      }
    }
  }

  private getCurrentFormatDisplayName(s: HeadingNumberingSettings): string {
    if (this.selectedFormatId && this.formatDraft) {
      return this.formatDraft.name
    }
    if (this.selectedCardKey) {
      if (this.selectedCardIsPreset) {
        const preset = PRESET_CARDS.find(c => c.key === this.selectedCardKey)
        return preset ? preset.name : '系统预设'
      } else {
        const fmt = this.formatLibrary.formats.find(f => f.id === this.selectedCardKey)
        return fmt ? fmt.name : '自定义格式'
      }
    }
    // Fallback to actual active preset
    const preset = PRESET_CARDS.find(c => c.key === s.preset)
    return preset ? preset.name : '自定义'
  }

  private getCurrentFormatDisplayNameV2(info: AppliedFormatInfo): string {
    const src = info.source
    if (src && src.type === 'built-in') {
      const preset = PRESET_CARDS.find(c => c.key === src.presetId)
      return preset ? preset.name : '系统预设'
    }
    if (src && src.type === 'custom' && src.formatId) {
      const fmt = this.formatLibrary.formats.find(f => f.id === src.formatId)
      return fmt ? fmt.name : '自定义格式'
    }
    if (src && src.type === 'snapshot') {
      return '自定义设置'
    }
    // Fallback
    return '未设置'
  }

  private applyCurrentToScope(scope: HeadingSettingsScope): void {
    const s = this.headingSettings
    if (s.preset !== 'custom') {
      this.applyPresetToScope(s.preset, scope)
    } else if (this.selectedFormatId && this.formatDraft) {
      this.applyFormatToScope(this.formatDraft, scope)
    } else {
      // Apply current custom draft
      const docKey = scope === 'document'
        ? (this.numberingService.getDocumentKey() ?? null)
        : null
      this.numberingService.saveHeadingNumberingScoped(
        scope, docKey, deepCloneSettings(s),
      )
      this.headingDraft = null
      this.headingDraftOriginal = null
      this.rerender()
      Notice.info(scope === 'global' ? '全局默认设置已保存' : '当前文档设置已保存')
    }
  }

  // ── Custom editor card ───────────────────────────

  private renderCustomEditorCard(s: HeadingNumberingSettings): void {
    const card = el('div', 'inkchapter-card', this.containerEl)
    const header = el('div', 'inkchapter-card-header', card)
    const title = el('div', 'inkchapter-card-title', header)
    title.textContent = '格式内容设置'

    const body = el('div', 'inkchapter-card-body', card)

    // No format selected at all — show empty state
    if (!this.selectedFormatId) {
      const desc = el('div', 'inkchapter-card-desc', header)
      desc.textContent = '选择上方任意格式卡片以查看其编号内容'
      const hint = el('div', '', body)
      hint.textContent = '请选择一个格式卡片以查看内容。自定义格式可直接编辑，系统格式可查看复制。'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:16px;'
      return
    }

    // System format: read-only viewer
    if (this.selectedFormatType === 'built-in') {
      const desc = el('div', 'inkchapter-card-desc', header)
      desc.textContent = '系统预设格式（只读）— 查看编号组合、标签、行为与实时预览'
      this.renderSystemFormatViewer(body, s)
      return
    }

    // Custom format: editable
    const desc = el('div', 'inkchapter-card-desc', header)
    desc.textContent = '编辑当前自定义格式的编号组合、标签、行为与标题间距'

    // Ensure draft is loaded (already done by card click, but guard against edge cases)
    if (!this.headingDraft) {
      this.ensureDraft()
    }
    const draft = this.headingDraft!
    this.ensureAllLevelsHaveCurrentSegment(draft)

    // Editing header
    this.renderEditorEditHeader(body, s, draft)

    // H1-H6 level tabs
    this.renderLevelTabs(body, s, draft)

    // Editor tab bar (composition / label / behavior)
    this.renderLevelConfigPage(body, s, draft)
  }

  /** Render the system format content as read-only. */
  private renderSystemFormatViewer(body: HTMLElement, s: HeadingNumberingSettings): void {
    if (!this.headingDraft) {
      const hint = el('div', '', body)
      hint.textContent = '无法加载系统格式数据。'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:16px;'
      return
    }
    const draft = this.headingDraft
    this.ensureAllLevelsHaveCurrentSegment(draft)

    // Header with "复制为自定义格式" button
    const viewerHeader = el('div', 'inkchapter-editor-edit-header', body)
    const label = el('span', 'inkchapter-editor-edit-title', viewerHeader)
    const presetName = this.getCurrentFormatDisplayName(s)
    label.textContent = `系统格式：${presetName}（只读）`
    const copyBtn = el('button', 'inkchapter-btn', viewerHeader)
    copyBtn.textContent = '复制为自定义格式'
    copyBtn.onclick = () => {
      this.cancelDrag()
      this.copySystemPresetToCustom()
    }

    // H1-H6 level tabs (read-only — same look, just disabled inputs later)
    this.renderLevelTabs(body, s, draft)

    // Unified level config page
    this.renderLevelConfigPage(body, s, draft)
  }

  /** Render the unified level configuration page with all three sections. */
  private renderLevelConfigPage(body: HTMLElement, s: HeadingNumberingSettings, draft: HeadingNumberingSettings): void {
    const isReadonly = this.selectedFormatType === 'built-in'

    // No level selected — show hint
    if (this.expandedLevel == null) {
      const hnt = el('div', 'inkchapter-token-select-hint', body)
      hnt.textContent = '请从上方 H1-H6 标签中选择一个级别进行查看'
      hnt.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:16px;'
      return
    }

    const physicalLevel = this.expandedLevel
    const slotLv = this.resolveSlotLevel(physicalLevel)
    // strict H1: document title, no style slot
    if (slotLv === null) {
      const h1Notice = el('div', 'inkchapter-custom-h1-notice', body)
      h1Notice.textContent = 'H1 为文档题目，不参与编号'
      h1Notice.classList.add('inkchapter-h1-visibility--disabled')
      h1Notice.style.cssText = 'padding:16px;text-align:center;color:var(--text-muted,#888);'
      // H1 still has editable physical layout (alignment/indent), no numbering slot.
      this.renderLayoutConfigSection(body, physicalLevel, s)
      // Still show preview column
      const previewCol = el('div', 'inkchapter-editor-preview-col', body)
      const previewSticky = el('div', 'inkchapter-editor-preview-sticky', previewCol)
      const previewTitle = el('div', '', previewSticky)
      previewTitle.textContent = '实时预览'
      previewTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-muted,#666);'
      this.previewEl = el('div', 'inkchapter-preview', previewSticky)
      this.updatePreview()
      return
    }
    const style = draft.levels[slotLv]
    if (!style) return

    const structureResolved = resolveHeadingStructure(s)
    const isH1Disabled = physicalLevel === 1 && !structureResolved.showLevelOneNumber

    // ── S6: loose H6 configured state ──
    const isLooseH6 = structureResolved.showLevelOneNumber && physicalLevel === 6
    const s6Configured = isLooseH6 && s.s6Configured

    // Dual-column: editor sections + preview
    const dualCol = el('div', 'inkchapter-editor-dual-col', body)
    const editorCol = el('div', 'inkchapter-editor-main', dualCol)

    // ── S6 unconfigured: show placeholder ──
    if (isLooseH6 && !s6Configured) {
      const s6Notice = el('div', 'inkchapter-s6-notice', editorCol)
      s6Notice.style.cssText = 'padding:24px;text-align:center;border:1px dashed #ccc;border-radius:8px;margin:8px 0;'
      const s6Title = el('div', '', s6Notice)
      s6Title.textContent = 'H6 · 宽松模式'
      s6Title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;'
      const s6Desc = el('div', '', s6Notice)
      s6Desc.textContent = '当前使用 Typora 原始 H6 样式，未启用墨章自定义格式'
      s6Desc.style.cssText = 'color:var(--text-muted,#888);font-size:13px;margin-bottom:12px;'
      const s6EnableBtn = el('button', 'inkchapter-btn', s6Notice)
      s6EnableBtn.textContent = '启用 H6 自定义'
      s6EnableBtn.onclick = () => {
        this.ensureDraft()
        this.headingDraft!.s6Configured = true
        this.rerender()
      }
      // Preview column
      const previewCol = el('div', 'inkchapter-editor-preview-col', dualCol)
      const previewSticky = el('div', 'inkchapter-editor-preview-sticky', previewCol)
      const previewTitle = el('div', '', previewSticky)
      previewTitle.textContent = '实时预览'
      previewTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-muted,#666);'
      this.previewEl = el('div', 'inkchapter-preview', previewSticky)
      this.updatePreview()
      return
    }

    // ── S6 configured: show restore control ──
    if (isLooseH6 && s6Configured) {
      const s6Bar = el('div', '', editorCol)
      s6Bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f0f7ff;border-radius:6px;border:1px solid #b3d8ff;margin-bottom:8px;font-size:13px;'
      const s6Label = el('span', '', s6Bar)
      s6Label.textContent = '当前：已自定义'
      const s6RestoreBtn = el('button', 'inkchapter-btn', s6Bar)
      s6RestoreBtn.textContent = '恢复原始 H6'
      s6RestoreBtn.style.cssText = 'font-size:12px;'
      s6RestoreBtn.onclick = () => {
        this.ensureDraft()
        this.headingDraft!.s6Configured = false
        this.rerender()
      }
    }

    // ── Main editor sections ──

    if (isH1Disabled) {
      const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorCol)
      h1Notice.textContent = 'H1 编号已关闭'
      h1Notice.classList.add('inkchapter-h1-visibility--disabled')
      h1Notice.style.cssText = 'padding:16px;text-align:center;color:var(--text-muted,#888);'
      // Still show preview column
    } else {
      // ── ① Number Composition ──
      const compSection = el('div', 'inkchapter-config-section', editorCol)
      const compHeader = el('div', 'inkchapter-format-header', compSection)
      compHeader.textContent = '① 编号组合'
      this.renderCompositionTabContent(compSection, physicalLevel, style, s, isReadonly)

      // ── ② Sequence Label + ③ Current Level Behavior ──
      const dualRow = el('div', 'inkchapter-config-dual-row', editorCol)

      const labelCol = el('div', 'inkchapter-config-half', dualRow)
      const labelHeader = el('div', 'inkchapter-format-header', labelCol)
      labelHeader.textContent = '② 序号标签'
      this.renderLabelTabContent(labelCol, physicalLevel, style, s, isReadonly)

      const behaviorCol = el('div', 'inkchapter-config-half', dualRow)
      const behaviorHeader = el('div', 'inkchapter-format-header', behaviorCol)
      behaviorHeader.textContent = '③ 当前级行为'
      this.renderBehaviorTabContent(behaviorCol, physicalLevel, style, s, isReadonly)
    }

    // ── ④ Heading Layout ── (physical level, no style-slot shift)
    this.renderLayoutConfigSection(editorCol, physicalLevel, s)

    // Preview column
    const previewCol = el('div', 'inkchapter-editor-preview-col', dualCol)
    const previewSticky = el('div', 'inkchapter-editor-preview-sticky', previewCol)
    const previewTitle = el('div', '', previewSticky)
    previewTitle.textContent = '实时预览'
    previewTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-muted,#666);'
    this.previewEl = el('div', 'inkchapter-preview', previewSticky)
    this.updatePreview()
    this.miniPreviewEls.clear()
  }

  /**
   * ④ 标题排版 — per-level heading layout editor (physical H1-H6, no level shift).
   * Reads/writes the SAME layout draft (`headingLayoutDraft`) the editor resolver
   * applies — no second layout state. Batch menu operates on the current mode only.
   */
  private renderLayoutConfigSection(container: HTMLElement, physicalLevel: HeadingLevel, s: HeadingNumberingSettings): void {
    const section = el('div', 'inkchapter-layout-config', container)

    const header = el('div', 'inkchapter-layout-config-header', section)
    const headerText = el('span', 'inkchapter-layout-config-title', header)
    headerText.textContent = '④ 标题排版'
    const batchWrap = el('div', 'inkchapter-layout-config-batch', header)
    const batchBtn = el('button', 'inkchapter-btn inkchapter-btn--small', batchWrap) as HTMLButtonElement
    batchBtn.textContent = '批量设置 ▾'
    batchBtn.onclick = () => {
      this.openLayoutBatchMenu(batchWrap)
    }

    const draft = this.ensureLayoutDraft()
    const key = `h${physicalLevel}`
    const lvNum = physicalLevel
    const current = draft.headingLayouts[key] ?? this.defaultLayoutConfig()
    const currentGap = draft.numberTitleSpacing[lvNum] ?? 'space'
    const hasIndent = current.firstLineIndentEm >= 2
    const isCenterOrRight = current.textAlign === 'center' || current.textAlign === 'right'
    const h1GapLocked = lvNum === 1 && !resolveHeadingStructure(s).showLevelOneNumber
    const effectiveGap = h1GapLocked ? 'none' : currentGap

    const grid = el('div', 'inkchapter-layout-config-grid', section)

    const mkControl = (label: string): HTMLElement => {
      const row = el('div', 'inkchapter-layout-config-row', grid)
      const lbl = el('span', 'inkchapter-layout-config-label', row)
      lbl.textContent = label
      const controls = el('div', 'inkchapter-layout-config-controls', row)
      return controls
    }
    const mkBtn = (controls: HTMLElement, text: string, active: boolean, onClick: () => void, disabled = false): void => {
      const btn = el('button', 'inkchapter-layout-matrix-btn', controls) as HTMLButtonElement
      btn.textContent = text
      if (active) btn.classList.add('inkchapter-layout-matrix-btn--active')
      if (disabled) btn.disabled = true
      btn.onclick = onClick
    }

    // Alignment
    {
      const controls = mkControl('对齐方式')
      for (const opt of [{ m: 'left', lbl: '左' }, { m: 'center', lbl: '中' }, { m: 'right', lbl: '右' }] as const) {
        mkBtn(controls, opt.lbl, opt.m === current.textAlign, () => {
          this.headingLayoutDraft = {
            headingLayouts: {
              ...draft.headingLayouts,
              [key]: { textAlign: opt.m, firstLineIndentEm: opt.m !== 'left' ? 0 : draft.headingLayouts[key]?.firstLineIndentEm ?? 0 },
            },
            numberTitleSpacing: { ...draft.numberTitleSpacing },
          }
          this.rerender()
        })
      }
    }

    // Indent
    {
      const controls = mkControl('首行缩进')
      for (const opt of [{ v: 0, lbl: '无' }, { v: 2, lbl: '2字符' }] as const) {
        const active = (opt.v === 0 && !hasIndent) || (opt.v === 2 && hasIndent)
        mkBtn(controls, opt.lbl, active, () => {
          if (opt.v === 2 && isCenterOrRight) return
          const newAlign = opt.v === 2 ? ('left' as const) : current.textAlign
          this.headingLayoutDraft = {
            headingLayouts: { ...draft.headingLayouts, [key]: { textAlign: newAlign, firstLineIndentEm: opt.v } },
            numberTitleSpacing: { ...draft.numberTitleSpacing },
          }
          this.rerender()
        }, opt.v === 2 && isCenterOrRight)
      }
    }

    // Gap
    {
      const controls = mkControl('标题间距')
      for (const opt of [{ v: 'none', lbl: '无间距' }, { v: 'space', lbl: '一个空格' }] as const) {
        mkBtn(controls, opt.lbl, effectiveGap === opt.v, () => {
          if (h1GapLocked) return
          const newSpacing = { ...draft.numberTitleSpacing, [lvNum]: opt.v as NumberTitleSpacing }
          this.headingLayoutDraft = { headingLayouts: { ...draft.headingLayouts }, numberTitleSpacing: newSpacing }
          this.rerender()
        }, h1GapLocked)
      }
    }

    // Inline preview line — reflects the same draft the editor resolver applies.
    const previewLine = el('div', 'inkchapter-layout-config-preview', section)
    previewLine.textContent = `H${physicalLevel} 示例标题`
    previewLine.setAttribute('data-align', current.textAlign)
    if (hasIndent) previewLine.setAttribute('data-indent', '2em')
  }

  private renderEditorEditHeader(
    container: HTMLElement,
    s: HeadingNumberingSettings,
    draft: HeadingNumberingSettings,
  ): void {
    const header = el('div', 'inkchapter-editor-edit-header', container)

    if (this.selectedFormatId && this.formatDraft) {
      const label = el('span', 'inkchapter-editor-edit-title', header)
      label.textContent = `正在编辑：${this.formatDraft.name}`

      const saveBtn = el('button', 'inkchapter-btn', header)
      saveBtn.textContent = '保存格式'
      saveBtn.onclick = () => { this.saveFormatDraft(); this.rerender() }

      const saveAsBtn = el('button', 'inkchapter-btn', header)
      saveAsBtn.textContent = '另存为'
      saveAsBtn.onclick = () => this.saveFormatAs()

      const cancelBtn = el('button', 'inkchapter-btn', header)
      cancelBtn.textContent = '取消编辑'
      cancelBtn.onclick = () => {

        this.cancelFormatEditing()
      }
    } else {
      const label = el('span', 'inkchapter-editor-edit-title', header)
      label.textContent = '自定义格式编辑'

      const saveAsBtn = el('button', 'inkchapter-btn', header)
      saveAsBtn.textContent = '保存为新格式'
      saveAsBtn.onclick = () => this.saveCurrentAsFormat()

      const cancelBtn = el('button', 'inkchapter-btn', header)
      cancelBtn.textContent = '取消编辑'
      cancelBtn.onclick = () => {

        this.rerender()
      }
    }
  }

  private renderLevelTabs(
    container: HTMLElement,
    s: HeadingNumberingSettings,
    draft: HeadingNumberingSettings,
  ): void {
    const tabs = el('div', 'inkchapter-level-tabs', container)
    const structure = resolveHeadingStructure(s)
    const h1Visible = structure.showLevelOneNumber
    const effectiveMax = this.numberingService.getEffectiveMaxLevel()

    for (const lv of HEADING_LEVELS) {
      const tab = el('div', 'inkchapter-level-tab', tabs)
      tab.textContent = getLevelLabel(lv, structure.mode)
      tab.setAttribute('tabindex', '0')

      if (this.expandedLevel === lv) {
        tab.classList.add('inkchapter-level-tab--selected')
      }

      const isDisabled = (lv === 1 && !h1Visible) || lv > effectiveMax
      if (isDisabled) {
        tab.classList.add('inkchapter-level-tab--disabled')
        if (lv === 1 && !h1Visible) {
          const tag = el('span', 'inkchapter-level-status-tag', tab)
          tag.textContent = '已关闭'
        } else if (lv > effectiveMax) {
          const tag = el('span', 'inkchapter-level-status-tag', tab)
          tag.textContent = '超出范围'
        }
        tab.onclick = () => { /* no-op */ }
        continue
      }

      tab.onclick = () => {
        this.expandedLevel = this.expandedLevel === lv ? null : lv
        this.selectedSegmentId = null
        this.rerender()
      }
    }
  }

  // ── Custom editor tab content ────────────────────

  private renderCompositionTabContent(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
    readonly = false,
  ): void {
    const showL1 = true // Slot model: always use withLevelOne
    const slotLv = this.resolveSlotLevel(lv) ?? lv
    let activeFmt = getActiveContextualFormatVariant(style, showL1, slotLv)
    if (!activeFmt || activeFmt.length === 0) {
      const soloSeg: ContextualFormatSegment = {
        id: generateStableId(),
        type: 'level-reference',
        level: slotLv,
        appearance: { tokenStyle: style.tokenStyle, prefix: '', suffix: '' },
      }
      style.contextualFormatVariants = {
        withLevelOne: [{ ...soloSeg, id: generateStableId() }],
        withoutLevelOne: slotLv === 1 ? [] : [{ ...soloSeg, id: generateStableId() }],
      }
      activeFmt = getActiveContextualFormatVariant(style, showL1, slotLv)
    }

    if (!this.selectedSegmentId && activeFmt) {
      const curSeg = activeFmt.find(seg => seg.type === 'level-reference' && seg.level === slotLv)
      if (curSeg) this.selectedSegmentId = curSeg.id
    }

    if (activeFmt && activeFmt.length > 0) {
      // Reset selection when re-rendering
      if (!activeFmt.some(seg => seg.id === this.selectedSegmentId)) {
        this.selectedSegmentId = null
      }

      // Format chips container
      const fmtContainer = el('div', 'inkchapter-format-container', container)
      const fmtEl = el('div', 'inkchapter-format-chips', fmtContainer)

      fmtEl.addEventListener('click', (e) => {
        if (e.target === fmtEl) { this.selectedSegmentId = null; this.onshow() }
      })

      if (!readonly) {
        this.setupContextualDragDelegation(fmtEl, lv, style, activeFmt)
      }

      for (let i = 0; i < activeFmt.length; i++) {
        const seg = activeFmt[i]
        if (seg.type === 'level-reference') {
          this.renderContextualLevelRefChip(fmtEl, i, seg, lv, activeFmt, s, readonly)
        } else {
          this.renderContextualLiteralChip(fmtEl, i, seg, lv, activeFmt, readonly)
        }
      }

      // Insert toolbar: level references only (text/separator moved to label tab prefix/suffix)
      const insertRow = el('div', 'inkchapter-format-insert-row', container)
      insertRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;'

      // Reference level selector
      const refSelect = el('select', undefined, insertRow) as HTMLSelectElement
      refSelect.style.cssText = 'min-width:80px;'
      if (readonly) refSelect.disabled = true

      const availRefs = getAvailableContextualReferenceLevels(slotLv, showL1, activeFmt)
      if (availRefs.length === 0) {
        const opt = document.createElement('option'); opt.value = ''; opt.textContent = '无可用'; opt.disabled = true; refSelect.appendChild(opt)
      } else {
        for (const refLv of availRefs) {
          // Allow re-adding current level ref if it was removed
          if (activeFmt.some(s => s.type === 'level-reference' && s.level === refLv)) continue
          const opt = document.createElement('option'); opt.value = String(refLv);
          const displayLv = resolvePhysicalHeadingForStyleSlot(resolveHeadingStructure(s).mode, refLv as StyleSlot) ?? refLv
          opt.textContent = `H${displayLv}`
          refSelect.appendChild(opt)
        }
      }

      // Add reference button
      const insertBtn = el('button', 'inkchapter-format-insert-btn', insertRow) as HTMLButtonElement
      insertBtn.textContent = '添加引用'
      insertBtn.style.cssText = 'flex-shrink:0;'
      insertBtn.disabled = readonly || refSelect.options.length === 0 || (refSelect.options.length === 1 && refSelect.options[0].disabled)

      insertBtn.onclick = () => {
        if (readonly) return
        const referenceSlot = Number(refSelect.value) as HeadingLevel
        if (!referenceSlot || referenceSlot < 1 || referenceSlot > 6) return
        const slotLvForInsert = this.resolveSlotLevel(lv) ?? lv
        // refLv from getAvailableContextualReferenceLevels is already StyleSlot.
        // Do NOT call resolveSlotLevel on it — that would treat S as P and reconvert.
        const cur = getActiveContextualFormatVariant(style, true, slotLvForInsert)
        if (cur.some(s => s.type === 'level-reference' && s.level === referenceSlot)) return
        const refStyle2 = s.levels[referenceSlot]
        const defaultAppearance = refStyle2?.levelTemplate
          ? { tokenStyle: refStyle2.levelTemplate.tokenStyle, prefix: refStyle2.levelTemplate.prefix ?? '', suffix: refStyle2.levelTemplate.suffix ?? '' }
          : { tokenStyle: 'arabic' as NumberTokenStyle, prefix: '', suffix: '' }
        const newFmt = [...cur, { id: generateStableId(), type: 'level-reference' as const, level: referenceSlot, appearance: { ...defaultAppearance } }]
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
        queueMicrotask(() => this.updatePreview())
      }

      // Hint text
      const hint = el('span', '', insertRow)
      hint.textContent = readonly ? '系统格式只读 — 无法修改组合' : '固定文字和分隔符请在「序号标签设置」中配置前缀/后缀'
      hint.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin-left:4px;'
    }
  }

  private renderLabelTabContent(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
    readonly = false,
  ): void {
    const showL1 = true // Slot model: always use withLevelOne
    const slotLv = this.resolveSlotLevel(lv) ?? lv
    const activeFmt = getActiveContextualFormatVariant(style, showL1, slotLv)

    if (!this.selectedSegmentId || !activeFmt) {
      const hint = el('div', 'inkchapter-token-select-hint', container)
      hint.textContent = '请在"多级组合格式"中选择一个编号片段进行编辑'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:24px;'
      return
    }

    const selectedSeg = activeFmt.find(seg => seg.id === this.selectedSegmentId)
    if (!selectedSeg) {
      this.selectedSegmentId = null
      const hint = el('div', 'inkchapter-token-select-hint', container)
      hint.textContent = '请选择上方编号片段进行编辑'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:24px;'
      return
    }

    const form = el('div', 'inkchapter-label-form', container)

    if (selectedSeg.type === 'literal') {
      this.addLabelFormRow(form, '文字内容', () => {
        const input = document.createElement('input')
        input.type = 'text'; input.value = selectedSeg.value; input.placeholder = '输入文字'
        input.style.cssText = 'width:100%;padding:4px 6px;'
        if (readonly) { input.readOnly = true; input.style.opacity = '0.6' }
        input.onblur = () => {
          if (readonly) return
          const newFmt = activeFmt.map(s => s.id === selectedSeg.id ? { ...s, value: sanitize(input.value) } : s)
          this.updateDraftContextualFormat(lv, newFmt)
          this.onshow()
        }
        return input
      })
      return
    }

    // Reference level display
    this.addLabelFormRow(form, '引用级别', () => {
      const span = document.createElement('span')
      const labelDisplayLevel = resolvePhysicalHeadingForStyleSlot(resolveHeadingStructure(s).mode, selectedSeg.level as StyleSlot) ?? selectedSeg.level
      span.textContent = `H${labelDisplayLevel}`; span.style.cssText = 'font-weight:600;'
      return span
    })

    // Token style
    this.addLabelFormRow(form, '编号样式', () => {
      const select = document.createElement('select')
      select.style.cssText = 'width:100%;padding:4px 6px;'
      if (readonly) select.disabled = true
      for (const opt of TOKEN_STYLE_LABELS) {
        const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label; o.selected = opt.value === selectedSeg.appearance.tokenStyle
        select.appendChild(o)
      }
      select.onchange = () => { if (readonly) return; this.updateDraftContextualSegment(lv, selectedSeg.id, { tokenStyle: select.value as NumberTokenStyle }); this.onshow() }
      return select
    })

    // Prefix
    this.addLabelFormRow(form, '前缀', () => {
      const input = document.createElement('input')
      input.type = 'text'; input.value = selectedSeg.appearance.prefix; input.placeholder = '例如：第'
      input.style.cssText = 'width:100%;padding:4px 6px;'
      if (readonly) { input.readOnly = true; input.style.opacity = '0.6' }
      input.onblur = () => { if (readonly) return; this.updateDraftContextualSegment(lv, selectedSeg.id, { prefix: sanitizeTemplateString(input.value) }); this.onshow() }
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur() }
      return input
    })

    // Suffix
    this.addLabelFormRow(form, '后缀', () => {
      const input = document.createElement('input')
      input.type = 'text'; input.value = selectedSeg.appearance.suffix; input.placeholder = '例如：章'
      input.style.cssText = 'width:100%;padding:4px 6px;'
      if (readonly) { input.readOnly = true; input.style.opacity = '0.6' }
      input.onblur = () => { if (readonly) return; this.updateDraftContextualSegment(lv, selectedSeg.id, { suffix: sanitizeTemplateString(input.value) }); this.onshow() }
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur() }
      return input
    })

    // Preview
    this.addLabelFormRow(form, '标签预览', () => {
      const span = document.createElement('span')
      span.style.cssText = 'font-weight:600;'
      span.textContent = `${selectedSeg.appearance.prefix}${getSampleToken(selectedSeg.appearance.tokenStyle)}${selectedSeg.appearance.suffix}`
      return span
    })
  }

  private addLabelFormRow(form: HTMLElement, label: string, createWidget: () => HTMLElement): void {
    const lbl = document.createElement('span')
    lbl.textContent = label; lbl.style.cssText = 'font-size:13px;color:var(--text-muted,#666);'
    form.appendChild(lbl)
    const widget = createWidget()
    form.appendChild(widget)
  }

  private renderBehaviorTabContent(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
    readonly = false,
  ): void {
    const isH1Disabled = lv === 1 && !resolveHeadingStructure(s).showLevelOneNumber

    // Compact grid form
    const form = el('div', 'inkchapter-behavior-form', container)

    if (lv > 1) {
      // Enable toggle
      const cbRow = el('div', '', form)
      cbRow.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;gap:6px;'
      const cb = document.createElement('input')
      cb.type = 'checkbox'; cb.checked = style.enabled
      if (readonly) cb.disabled = true
      cb.onchange = () => { if (readonly) return; if (lv === 6 && this.headingDraft) { const st = resolveHeadingStructure(this.headingDraft); if (st.mode === 'loose') this.headingDraft.s6Configured = true } this.numberingService.updateLevelStyle(lv, { enabled: cb.checked }); this.onshow() }
      cbRow.appendChild(cb)
      const cbLabel = document.createElement('span'); cbLabel.textContent = '启用本级编号'; cbLabel.style.cssText = 'font-size:13px;'
      cbRow.appendChild(cbLabel)
    }

    // Start at
    const startLabel = document.createElement('span')
    startLabel.textContent = '起始编号'; startLabel.style.cssText = 'font-size:13px;color:var(--text-muted,#666);'
    form.appendChild(startLabel)
    const startInput = document.createElement('input')
    startInput.type = 'number'; startInput.value = String(style.startAt); startInput.min = '1'; startInput.max = '999'
    startInput.style.cssText = 'padding:4px 6px;'
    if (readonly) { startInput.disabled = true; startInput.style.opacity = '0.6' }
    startInput.onblur = () => {
      if (readonly) return
      const n = parseInt(startInput.value, 10)
      if (!isNaN(n) && n >= 1 && n <= 999) { this.numberingService.updateLevelStyle(lv, { startAt: n }); this.onshow() }
      else { startInput.value = String(style.startAt) }
    }
    startInput.onkeydown = (e) => { if (e.key === 'Enter') startInput.blur() }
    form.appendChild(startInput)

    // Restart after
    if (lv > 1) {
      const restartLabel = document.createElement('span')
      restartLabel.textContent = '重新开始位置'; restartLabel.style.cssText = 'font-size:13px;color:var(--text-muted,#666);'
      form.appendChild(restartLabel)
      const restartSelect = document.createElement('select')
      restartSelect.style.cssText = 'width:100%;padding:4px 6px;'
      if (readonly) restartSelect.disabled = true
      const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '不重启（连续编号）'; noneOpt.selected = style.restartAfterLevel === null
      restartSelect.appendChild(noneOpt)
      for (let i = 1; i < lv; i++) {
        const opt = document.createElement('option'); opt.value = String(i); opt.textContent = `在 H${i} 后重新开始`; opt.selected = style.restartAfterLevel === i
        restartSelect.appendChild(opt)
      }
      restartSelect.onchange = () => {
        if (readonly) return
        const parsed = restartSelect.value === '' ? null : Number(restartSelect.value) as HeadingLevel
        this.numberingService.updateLevelStyle(lv, { restartAfterLevel: parsed } as any); this.onshow()
      }
      form.appendChild(restartSelect)
    }
  }

  // ── Advanced settings card ───────────────────────

  private renderAdvancedSettingsCard(s: HeadingNumberingSettings): void {
    const card = el('div', 'inkchapter-card', this.containerEl)
    const header = el('div', 'inkchapter-card-header', card)
    const title = el('div', 'inkchapter-card-title', header)
    title.textContent = '文档级高级设置'
    const desc = el('div', 'inkchapter-card-desc', header)
    desc.textContent = '标题有效级数范围与正文段落排版'

    const body = el('div', 'inkchapter-card-body', card)

    // Sub-section: Heading Range
    this.renderHeadingRangeSubCards(body)

    // Divider
    const divider1 = el('div', '', body)
    divider1.style.cssText = 'height:1px;background:var(--border-primary,#eee);margin:16px 0;'

    // Sub-section: Paragraph Layout
    this.renderParagraphLayoutSection(body)
  }

  // ── Heading range sub-cards ──────────────────────

  private renderHeadingRangeSubCards(container: HTMLElement): void {
    const section = el('div', 'inkchapter-range-section', container)
    const secTitle = el('div', 'inkchapter-section-title', section)
    secTitle.textContent = '标题有效级数范围'
    const secDesc = el('div', 'inkchapter-section-desc', section)
    secDesc.textContent = '设置文档中参与编号的标题级别范围'

    // ── Global default range ──
    const d = this.rangeDraft

    const globalLabel = el('div', 'inkchapter-range-setting-desc', section)
    globalLabel.textContent = '全局默认范围 — 新文档默认使用的标题级数范围'

    const globalRow = el('div', 'inkchapter-range-setting-row', section)
    const globalTag = el('span', 'inkchapter-range-setting-label', globalRow)
    globalTag.textContent = '全局默认范围'

    const globalControls = el('div', 'inkchapter-range-controls', globalRow)
    const globalSelect = document.createElement('select')
    for (const max of [2, 3, 4, 5, 6] as const) {
      const opt = document.createElement('option')
      opt.value = String(max)
      opt.textContent = `H1 – H${max}`
      opt.selected = max === d.globalMaxLevel
      globalSelect.appendChild(opt)
    }
    globalSelect.onchange = () => {
      d.globalMaxLevel = parseInt(globalSelect.value, 10) as MaxHeadingLevel
      this.markGlobalDirty()
    }
    globalControls.appendChild(globalSelect)

    const globalConfirmBtn = el('button', 'inkchapter-btn', globalControls) as HTMLButtonElement
    globalConfirmBtn.textContent = '确定'
    globalConfirmBtn.disabled = !d.globalDirty
    globalConfirmBtn.onclick = () => this.handleGlobalConfirm(d)

    const globalCancelBtn = el('button', 'inkchapter-btn', globalControls) as HTMLButtonElement
    globalCancelBtn.textContent = '取消'
    globalCancelBtn.disabled = !d.globalDirty
    globalCancelBtn.onclick = () => this.handleGlobalCancel(globalSelect)

    // ── Document range ──
    const docPath = this.numberingService.getActiveFilePath()
    const effectiveMax = this.numberingService.getEffectiveMaxLevel()

    const docLabel = el('div', 'inkchapter-range-setting-desc', section)
    docLabel.textContent = '当前文档范围 — 覆盖全局设置的文档独立范围'
    docLabel.style.marginTop = '12px'

    if (!docPath) {
      const docRow = el('div', 'inkchapter-range-setting-row', section)
      const docTag = el('span', 'inkchapter-range-setting-label', docRow)
      docTag.textContent = '当前文档'
      const status = el('span', 'inkchapter-range-setting-status', docRow)
      status.textContent = '未检测到打开的文档'
      return
    }

    const docRow = el('div', 'inkchapter-range-setting-row', section)
    const docTag = el('span', 'inkchapter-range-setting-label', docRow)
    docTag.textContent = '当前文档'

    // Mode segmented control
    const docSeg = el('div', 'inkchapter-range-doc-segmented', docRow)
    const inheritBtn = el('button', 'inkchapter-range-doc-seg-btn', docSeg) as HTMLButtonElement
    inheritBtn.textContent = '继承全局'
    if (d.documentMode === 'inherit') inheritBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    inheritBtn.onclick = () => {
      if (d.documentMode === 'inherit') return
      d.documentMode = 'inherit'
      d.documentMaxLevel = d.globalMaxLevel
      this.markDocumentDirty()
    }
    const customBtn = el('button', 'inkchapter-range-doc-seg-btn', docSeg) as HTMLButtonElement
    customBtn.textContent = '独立设置'
    if (d.documentMode === 'custom') customBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    customBtn.onclick = () => {
      if (d.documentMode === 'custom') return
      d.documentMode = 'custom'
      d.documentMaxLevel = clampMaxLevel(effectiveMax) as MaxHeadingLevel
      this.markDocumentDirty()
    }

    // Status
    const status = el('span', 'inkchapter-range-setting-status', docRow)
    status.textContent = `当前生效：H1 – H${effectiveMax}`

    // Doc range selector row
    const docSelRow = el('div', 'inkchapter-range-setting-row', section)
    const docSelLabel = el('span', 'inkchapter-range-setting-label', docSelRow)
    docSelLabel.textContent = ''

    const docControls = el('div', 'inkchapter-range-controls', docSelRow)
    const docSelect = document.createElement('select')
    for (const max of [2, 3, 4, 5, 6] as const) {
      const opt = document.createElement('option')
      opt.value = String(max)
      opt.textContent = `H1 – H${max}`
      opt.selected = max === (d.documentMode === 'inherit' ? d.globalMaxLevel : d.documentMaxLevel)
      docSelect.appendChild(opt)
    }
    if (d.documentMode === 'inherit') docSelect.disabled = true
    docSelect.onchange = () => {
      if (d.documentMode === 'inherit') return
      d.documentMaxLevel = parseInt(docSelect.value, 10) as MaxHeadingLevel
      this.markDocumentDirty()
    }
    docControls.appendChild(docSelect)

    const docConfirmBtn = el('button', 'inkchapter-btn', docControls) as HTMLButtonElement
    docConfirmBtn.textContent = '确定'
    docConfirmBtn.disabled = !d.documentDirty
    docConfirmBtn.onclick = () => this.handleDocumentConfirm(docPath, d)

    const docCancelBtn = el('button', 'inkchapter-btn', docControls) as HTMLButtonElement
    docCancelBtn.textContent = '取消'
    docCancelBtn.disabled = !d.documentDirty
    docCancelBtn.onclick = () => this.handleDocumentCancel(docSelect)

    // Heading stats - compact single line
    try {
      const counts = this.numberingService.countHeadingsByLevel()
      const outOfRangeCount = this.numberingService.countOutOfRangeHeadings()
      const hasHeadings = Object.values(counts).some((c: number) => c > 0)
      if (hasHeadings) {
        const statsRow = el('div', 'inkchapter-range-stats', section)
        const label = el('span', '', statsRow)
        label.textContent = '标题统计：'
        for (let lv = 1; lv <= 6; lv++) {
          const item = el('span', 'inkchapter-range-stat-item', statsRow)
          item.textContent = `H${lv} ${counts[lv] as number || 0}`
          if (lv < 6) {
            const dot = el('span', 'inkchapter-range-stat-dot', statsRow)
          }
        }
        if (outOfRangeCount > 0 && effectiveMax < 6) {
          const orEl = el('div', 'inkchapter-range-out-of-range', section)
          orEl.textContent = `超出范围：${outOfRangeCount} 个标题`
        }
      }
    } catch { /* ignore */ }
  }

  // ── Paragraph layout UI ──────────────────────────

  /** Initialize or get the paragraph layout draft. */
  private ensureParagraphLayoutDraft(): ParagraphLayoutSettings {
    if (!this.paragraphLayoutDraft) {
      const settings = this.numberingService.getParagraphLayoutSettings()
      this.paragraphLayoutDraft = { ...settings }
      this.savedParagraphLayoutBaseline = { ...settings }
    }
    return this.paragraphLayoutDraft
  }

  /** Check if paragraph layout draft has unsaved changes. */
  private hasParagraphLayoutDirty(): boolean {
    if (!this.paragraphLayoutDraft || !this.savedParagraphLayoutBaseline) return false
    return JSON.stringify(this.paragraphLayoutDraft) !== JSON.stringify(this.savedParagraphLayoutBaseline)
  }

  private renderParagraphLayoutSection(container: HTMLElement): void {
    const draft = this.ensureParagraphLayoutDraft()
    const docKey = this.numberingService.getDocumentKey()

    const section = el('div', 'inkchapter-para-layout-section', container)
    const secTitle = el('div', 'inkchapter-section-title', section)
    secTitle.textContent = '正文段落排版'
    const secDesc = el('div', 'inkchapter-section-desc', section)
    secDesc.textContent = '设置普通正文段落的默认首行排版和快捷输入'

    // Scope selector
    const scopeRow = el('div', 'inkchapter-range-setting-row', section)
    const scopeLabel = el('span', 'inkchapter-range-setting-label', scopeRow)
    scopeLabel.textContent = '设置范围'

    const scopeControls = el('div', 'inkchapter-range-controls', scopeRow)
    const scopeSelect = document.createElement('select')
    scopeSelect.style.cssText = 'padding:2px 6px;'
    const globalOpt = document.createElement('option')
    globalOpt.value = 'global'; globalOpt.textContent = '全局默认'; globalOpt.selected = true
    scopeSelect.appendChild(globalOpt)
    if (docKey) {
      const docOpt = document.createElement('option')
      docOpt.value = 'document'; docOpt.textContent = '当前文档'
      const hasDocOverride = this.numberingService.hasCurrentDocumentOverride()
        && this.numberingService.getScopeStore().documentOverrides[docKey]?.paragraphLayout !== undefined
      docOpt.selected = hasDocOverride
      scopeSelect.appendChild(docOpt)
    }
    const scope: 'global' | 'document' = scopeSelect.value as 'global' | 'document'
    this.paragraphLayoutScope = scope
    scopeSelect.onchange = () => {
      this.paragraphLayoutScope = scopeSelect.value as 'global' | 'document'
      this.rerender()
    }

    // ── Default indent ──
    const indentRow = el('div', 'inkchapter-range-setting-row', section)
    indentRow.style.cssText = 'margin-top:10px;'
    const indentLabel = el('span', 'inkchapter-range-setting-label', indentRow)
    indentLabel.textContent = '普通正文段落默认'

    const indentControls = el('div', 'inkchapter-range-controls', indentRow)
    const flushBtn = el('button', 'inkchapter-range-doc-seg-btn', indentControls) as HTMLButtonElement
    flushBtn.textContent = '顶格对齐'
    if (draft.defaultIndent === 'flush') flushBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    flushBtn.onclick = () => { draft.defaultIndent = 'flush'; flushBtn.classList.add('inkchapter-range-doc-seg-btn--active'); indentBtn.classList.remove('inkchapter-range-doc-seg-btn--active') }
    const indentBtn = el('button', 'inkchapter-range-doc-seg-btn', indentControls) as HTMLButtonElement
    indentBtn.textContent = '首行缩进 2 字符'
    if (draft.defaultIndent === 'indent-2') indentBtn.classList.add('inkchapter-range-doc-seg-btn--active')
    indentBtn.onclick = () => { draft.defaultIndent = 'indent-2'; indentBtn.classList.add('inkchapter-range-doc-seg-btn--active'); flushBtn.classList.remove('inkchapter-range-doc-seg-btn--active') }

    // ── Formula continuation rule ──
    const formulaRow = el('div', 'inkchapter-range-setting-row', section)
    formulaRow.style.cssText = 'margin-top:8px;'
    const formulaLabel = el('span', 'inkchapter-range-setting-label', formulaRow)
    formulaLabel.textContent = '结构规则'
    const formulaControls = el('div', 'inkchapter-range-controls', formulaRow)
    const formulaCb = document.createElement('input')
    formulaCb.type = 'checkbox'; formulaCb.checked = draft.flushAfterDisplayMath
    formulaCb.onchange = () => { draft.flushAfterDisplayMath = formulaCb.checked }
    formulaControls.appendChild(formulaCb)
    const formulaCbLabel = document.createElement('span')
    formulaCbLabel.textContent = '块级公式后的续接文本默认顶格'
    formulaCbLabel.style.cssText = 'font-size:13px;margin-left:6px;'
    formulaControls.appendChild(formulaCbLabel)

    // ── Shortcut toggle ──
    const shortcutRow = el('div', 'inkchapter-range-setting-row', section)
    shortcutRow.style.cssText = 'margin-top:8px;'
    const shortcutLabel = el('span', 'inkchapter-range-setting-label', shortcutRow)
    shortcutLabel.textContent = '快捷输入'
    const shortcutControls = el('div', 'inkchapter-range-controls', shortcutRow)
    const shortcutCb = document.createElement('input')
    shortcutCb.type = 'checkbox'; shortcutCb.checked = draft.indentShortcutEnabled
    shortcutCb.onchange = () => { draft.indentShortcutEnabled = shortcutCb.checked }
    shortcutControls.appendChild(shortcutCb)
    const shortcutCbLabel = document.createElement('span')
    shortcutCbLabel.textContent = '启用 .. / 。。 + Enter 强制首行缩进'
    shortcutCbLabel.style.cssText = 'font-size:13px;margin-left:6px;'
    shortcutControls.appendChild(shortcutCbLabel)

    // ── Preview ──
    const previewRow = el('div', 'inkchapter-para-preview', section)
    previewRow.style.cssText = 'margin-top:12px;padding:10px 12px;border:1px solid var(--border-primary,#ddd);border-radius:6px;background:var(--background-secondary,#f8f8f8);'
    const previewTitle = el('div', '', previewRow)
    previewTitle.textContent = '预览效果'
    previewTitle.style.cssText = 'font-weight:600;font-size:12px;margin-bottom:8px;color:var(--text-muted,#666);'

    // Show preview paragraphs — reuse the REAL paragraph resolver, not an inline copy.
    const previewItems = [
      {
        label: '普通新段落',
        indent: resolveEffectiveParagraphIndent('auto', draft.defaultIndent, { isFormulaContinuation: false }) === 'indent-2' ? '2em' : '0',
      },
      {
        label: '公式后的续接文本',
        indent: resolveEffectiveParagraphIndent('auto', draft.defaultIndent, { isFormulaContinuation: draft.flushAfterDisplayMath }) === 'indent-2' ? '2em' : '0',
      },
      {
        label: '强制首行缩进段落',
        indent: resolveEffectiveParagraphIndent('force-indent', draft.defaultIndent, { isFormulaContinuation: true }) === 'indent-2' ? '2em' : '0',
      },
    ]
    for (const item of previewItems) {
      const p = el('div', '', previewRow)
      p.style.cssText = `font-size:13px;line-height:1.6;text-indent:${item.indent};margin-bottom:4px;`
      p.textContent = item.label
    }

    // ── Scope action buttons ──
    const actionRow = el('div', '', section)
    actionRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;align-items:center;'

    const saveBtn = el('button', 'inkchapter-btn', actionRow) as HTMLButtonElement
    saveBtn.textContent = '保存'
    saveBtn.onclick = () => {
      const s = scopeSelect.value as 'global' | 'document'
      this.numberingService.saveParagraphLayoutSettings(s, { ...draft })
      this.savedParagraphLayoutBaseline = { ...draft }
      this.paragraphLayoutDraft = null
      this.rerender()
      Notice.info('正文段落排版已保存')
    }

    const cancelBtn = el('button', 'inkchapter-btn', actionRow) as HTMLButtonElement
    cancelBtn.textContent = '取消'
    cancelBtn.onclick = () => {
      if (this.savedParagraphLayoutBaseline) {
        this.paragraphLayoutDraft = { ...this.savedParagraphLayoutBaseline }
      } else {
        this.paragraphLayoutDraft = null
      }
      this.rerender()
    }

    // Restore inheritance (document only)
    if (docKey && scope === 'document') {
      const docOverride = this.numberingService.getScopeStore().documentOverrides[docKey]
      if (docOverride?.paragraphLayout) {
        const restoreBtn = el('button', 'inkchapter-btn', actionRow) as HTMLButtonElement
        restoreBtn.textContent = '恢复继承全局'
        restoreBtn.onclick = () => {
          this.numberingService.restoreParagraphLayoutInheritance()
          this.paragraphLayoutDraft = null
          this.savedParagraphLayoutBaseline = null
          this.rerender()
          Notice.info('已恢复继承全局设置')
        }
      }
    }
  }

  // ── Bottom sticky action bar ─────────────────────

  /** Development diagnostic: output which dirty source is causing "有未保存的更改". */
  private getDirtyBreakdown(): { source: string; dirty: boolean; detail: string }[] {
    const results: { source: string; dirty: boolean; detail: string }[] = []

    // headingDraft (numbering settings)
    const hdDirty = this.headingDraft != null && this.headingDraftOriginal != null
    results.push({ source: 'headingDraft', dirty: hdDirty, detail: hdDirty ? 'draft differs from saved' : 'OK' })

    // formatDraft (format editor) — only dirty if differs from saved baseline
    if (this.formatDraft && this.savedFormatBaseline) {
      const fdDirty = JSON.stringify(this.formatDraft) !== JSON.stringify(this.savedFormatBaseline)
      results.push({ source: 'formatDraft', dirty: fdDirty, detail: fdDirty ? 'differs from baseline' : 'OK' })
    } else {
      results.push({ source: 'formatDraft', dirty: this.formatDraft != null, detail: this.formatDraft ? 'no baseline (new format?)' : 'OK' })
    }

    // headingLayoutDraft
    if (this.headingLayoutDraft && this.savedLayoutDraft) {
      const eq = layoutDraftsEqual(this.headingLayoutDraft, this.savedLayoutDraft)
      results.push({ source: 'headingLayoutDraft', dirty: !eq, detail: !eq ? this._diffLayoutDrafts() : 'OK' })
    } else if (this.headingLayoutDraft && !this.savedLayoutDraft) {
      results.push({ source: 'headingLayoutDraft', dirty: true, detail: 'saved baseline is null' })
    } else {
      results.push({ source: 'headingLayoutDraft', dirty: false, detail: 'draft is null' })
    }

    // paragraphLayoutDraft (body paragraph layout settings) — independent dirty source
    const paraDirty = this.hasParagraphLayoutDirty()
    results.push({ source: 'paragraphLayoutDraft', dirty: paraDirty, detail: paraDirty ? 'draft differs from saved' : 'OK' })

    // range draft
    results.push({ source: 'rangeDraft(global)', dirty: this.rangeDraft.globalDirty, detail: this.rangeDraft.globalDirty ? `globalMax=${this.rangeDraft.globalMaxLevel}` : 'OK' })
    results.push({ source: 'rangeDraft(document)', dirty: this.rangeDraft.documentDirty, detail: this.rangeDraft.documentDirty ? `docMode=${this.rangeDraft.documentMode},max=${this.rangeDraft.documentMaxLevel}` : 'OK' })

    return results
  }

  private _diffLayoutDrafts(): string {
    if (!this.headingLayoutDraft || !this.savedLayoutDraft) return 'missing'
    const d = this.headingLayoutDraft
    const s = this.savedLayoutDraft
    const diffs: string[] = []
    for (const key of Object.keys(d.headingLayouts)) {
      const dc = d.headingLayouts[key]
      const sc = s.headingLayouts[key]
      if (!sc) { diffs.push(`${key}: missing in saved`); continue }
      if (dc.textAlign !== sc.textAlign) diffs.push(`${key} align: draft=${dc.textAlign} saved=${sc.textAlign}`)
      if (dc.firstLineIndentEm !== sc.firstLineIndentEm) diffs.push(`${key} indent: draft=${dc.firstLineIndentEm} saved=${sc.firstLineIndentEm}`)
    }
    for (let lv = 1; lv <= 6; lv++) {
      const dg = d.numberTitleSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] ?? 'space'
      const sg = s.numberTitleSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] ?? 'space'
      if (dg !== sg) diffs.push(`H${lv} gap: draft=${dg} saved=${sg}`)
    }
    return diffs.length > 0 ? diffs.join('; ') : 'no diffs found (but equal returned false)'
  }

  private initCaptionDraft(): void {
    const raw = this.settings.get('caption' as any) as any
    const cfg = (raw?.types ? raw : DEFAULT_CAPTION_SETTINGS) as CaptionSettings
    this.captionDraft = {
      schemaVersion: cfg.schemaVersion ?? 1,
      types: {
        table: { ...(cfg.types?.table ?? DEFAULT_CAPTION_SETTINGS.types.table) },
        figure: { ...(cfg.types?.figure ?? DEFAULT_CAPTION_SETTINGS.types.figure) },
        code: { ...(cfg.types?.code ?? DEFAULT_CAPTION_SETTINGS.types.code) },
      },
    }
    this.savedCaptionBaseline = {
      schemaVersion: this.captionDraft.schemaVersion,
      types: {
        table: { ...this.captionDraft.types.table },
        figure: { ...this.captionDraft.types.figure },
        code: { ...this.captionDraft.types.code },
      },
    }
    const rawFormula = this.settings.get('captionFormula' as any) as any
    this.captionFormulaDraft = migrateObjectNumberingConfig('formula', rawFormula)
    this.savedCaptionFormulaBaseline = { ...this.captionFormulaDraft }
  }

  private hasCaptionDirty(): boolean {
    const captionDirty = this.captionDraft != null && this.savedCaptionBaseline != null
      && JSON.stringify(this.captionDraft) !== JSON.stringify(this.savedCaptionBaseline)
    const formulaDirty = this.captionFormulaDraft != null && this.savedCaptionFormulaBaseline != null
      && JSON.stringify(this.captionFormulaDraft) !== JSON.stringify(this.savedCaptionFormulaBaseline)
    return captionDirty || formulaDirty
  }

  private saveCaptionSettings(): void {
    if (!this.captionDraft) return
    const errors = this.captionTemplateErrors()
    if (errors.length > 0) {
      Notice.error(`编号格式无效：${errors[0]}`)
      console.warn('[InkChapter Caption] SETTINGS-SAVE-BLOCKED', errors)
      return
    }
    this.settings.set('caption' as any, this.captionDraft as any)
    this.savedCaptionBaseline = {
      schemaVersion: this.captionDraft.schemaVersion,
      types: {
        table: { ...this.captionDraft.types.table },
        figure: { ...this.captionDraft.types.figure },
        code: { ...this.captionDraft.types.code },
      },
    }
    if (this.captionFormulaDraft) {
      this.settings.set('captionFormula' as any, this.captionFormulaDraft as any)
      this.savedCaptionFormulaBaseline = { ...this.captionFormulaDraft }
    }
    this.captionService?.applySettings(this.captionDraft)
    if (this.captionFormulaDraft) {
      this.captionService?.applyFormulaSettings(this.captionFormulaDraft)
    }
    console.info('[InkChapter Caption] SETTINGS-SAVE')
    emitRuntimeAudit('CAPTION-SETTINGS-SAVE', { decision: 'SAVED' })
  }

  private cancelCaptionSettings(): void {
    if (!this.savedCaptionBaseline) return
    this.captionDraft = {
      schemaVersion: this.savedCaptionBaseline.schemaVersion,
      types: {
        table: { ...this.savedCaptionBaseline.types.table },
        figure: { ...this.savedCaptionBaseline.types.figure },
        code: { ...this.savedCaptionBaseline.types.code },
      },
    }
    if (this.savedCaptionFormulaBaseline) {
      this.captionFormulaDraft = { ...this.savedCaptionFormulaBaseline }
    }
    this.render()
  }

  private renderCaptionCard(): void {
    const card = el('div', 'inkchapter-card', this.containerEl)
    const header = el('div', 'inkchapter-card-header', card)
    const title = el('div', 'inkchapter-card-title', header)
    title.textContent = '题注与对象编号'
    const desc = el('div', 'inkchapter-card-desc', header)
    desc.textContent = '表格 / 图片 / 代码块 / 公式的题注命名与独立编号'

    const body = el('div', 'inkchapter-card-body', card)
    const draft = this.captionDraft ?? DEFAULT_CAPTION_SETTINGS

    const positions2 = [
      { value: 'above' as ObjectPosition, label: '上方' },
      { value: 'below' as ObjectPosition, label: '下方' },
    ]

    this.renderNumberingGroup(body, 'table', '表格题注', () => draft.types.table, patch => {
      if (this.captionDraft) Object.assign(this.captionDraft.types.table, patch)
    }, positions2, '示例名称', false)

    this.renderNumberingGroup(body, 'figure', '图片题注', () => draft.types.figure, patch => {
      if (this.captionDraft) Object.assign(this.captionDraft.types.figure, patch)
    }, positions2, '示例图片', false)

    this.renderNumberingGroup(body, 'code', '代码块题注', () => draft.types.code, patch => {
      if (this.captionDraft) Object.assign(this.captionDraft.types.code, patch)
    }, positions2, '示例代码', false)

    // Formula group — independent ObjectNumberingConfig draft (native mode default).
    this.renderNumberingGroup(body, 'formula', '公式编号', () => this.captionFormulaDraft ?? DEFAULT_OBJECT_NUMBERING_CONFIG.formula, patch => {
      if (this.captionFormulaDraft) Object.assign(this.captionFormulaDraft, patch)
    }, [
      { value: 'above' as ObjectPosition, label: '上方' },
      { value: 'below' as ObjectPosition, label: '下方' },
      { value: 'left' as ObjectPosition, label: '左侧' },
      { value: 'right' as ObjectPosition, label: '右侧' },
    ], '', true)
  }

  private renderNumberingGroup(
    parent: HTMLElement,
    type: ObjectNumberingType,
    label: string,
    get: () => Record<string, any>,
    apply: (patch: Record<string, any>) => void,
    positionOptions: Array<{ value: ObjectPosition; label: string }>,
    sampleName: string,
    showFormulaMode: boolean,
  ): void {
    const row = el('div', 'inkchapter-caption-setting-row', parent)
    const name = el('div', 'inkchapter-caption-setting-name', row)
    name.textContent = label

    const controls = el('div', 'inkchapter-caption-setting-controls', row)

    const enabledLabel = el('label', 'inkchapter-caption-setting-control', controls)
    const enabledInput = document.createElement('input')
    enabledInput.type = 'checkbox'
    enabledInput.checked = !!get().enabled
    enabledInput.addEventListener('change', () => { apply({ enabled: enabledInput.checked }) })
    enabledLabel.appendChild(enabledInput)
    enabledLabel.appendChild(document.createTextNode(' 启用'))

    // Formula implementation mode (Typora native / InkChapter custom).
    if (showFormulaMode) {
      const modeLabel = el('label', 'inkchapter-caption-setting-control', controls)
      modeLabel.appendChild(document.createTextNode('编号实现 '))
      const modeSelect = buildSelect<'typora-native' | 'inkchapter'>([
        { value: 'typora-native', label: 'Typora 原生' },
        { value: 'inkchapter', label: '墨章自定义' },
      ], (get().formulaMode ?? 'typora-native') as 'typora-native' | 'inkchapter', 'inkchapter-caption-setting-select')
      modeSelect.addEventListener('change', () => { apply({ formulaMode: modeSelect.value }) })
      modeLabel.appendChild(modeSelect)
    }

    const positionSelect = buildSelect<ObjectPosition>(positionOptions, (get().position ?? 'above') as ObjectPosition, 'inkchapter-caption-setting-select')
    positionSelect.addEventListener('change', () => { apply({ position: positionSelect.value }) })
    controls.appendChild(positionSelect)

    const prefixInput = document.createElement('input')
    prefixInput.type = 'text'
    prefixInput.className = 'inkchapter-caption-setting-input'
    prefixInput.value = get().prefix ?? ''
    prefixInput.addEventListener('input', () => { apply({ prefix: prefixInput.value }); refreshPreview() })
    controls.appendChild(prefixInput)

    const detail = el('div', 'inkchapter-caption-setting-detail', row)
    detail.style.display = 'flex'
    detail.style.flexWrap = 'wrap'
    detail.style.gap = '8px'
    detail.style.alignItems = 'center'

    const addField = (text: string, inputEl: HTMLElement): void => {
      const wrap = el('label', 'inkchapter-caption-setting-control', detail)
      wrap.appendChild(document.createTextNode(text))
      wrap.appendChild(inputEl)
    }

    const presetSelect = buildSelect<ObjectNumberingPreset>(getPublicPresetOptions(), (get().preset ?? 'global') as ObjectNumberingPreset, 'inkchapter-caption-setting-select')
    presetSelect.addEventListener('change', () => { apply({ preset: presetSelect.value }); refreshPreview() })
    addField('编号类型 ', presetSelect)

    // 序号样式 (Arabic only in ordinary UI) is intentionally hidden.

    const startInput = document.createElement('input')
    startInput.type = 'number'
    startInput.min = '1'
    startInput.className = 'inkchapter-caption-setting-input'
    startInput.style.width = '64px'
    startInput.value = String(get().startAt ?? 1)
    startInput.addEventListener('input', () => { apply({ startAt: Math.max(1, Number(startInput.value) || 1) }); refreshPreview() })
    addField('起始编号 ', startInput)

    const minDigitsInput = document.createElement('input')
    minDigitsInput.type = 'number'
    minDigitsInput.min = '1'
    minDigitsInput.max = '6'
    minDigitsInput.className = 'inkchapter-caption-setting-input'
    minDigitsInput.style.width = '64px'
    minDigitsInput.value = String(get().minDigits ?? 1)
    minDigitsInput.addEventListener('input', () => { apply({ minDigits: Math.min(6, Math.max(1, Number(minDigitsInput.value) || 1)) }); refreshPreview() })
    addField('最小位数 ', minDigitsInput)

    const templateInput = document.createElement('input')
    templateInput.type = 'text'
    templateInput.className = 'inkchapter-caption-setting-input'
    templateInput.style.width = '120px'
    templateInput.value = get().template ?? '{n}'
    templateInput.addEventListener('input', () => { apply({ template: templateInput.value }); refreshPreview() })
    addField('编号格式 ', templateInput)

    const varHint = el('div', 'inkchapter-caption-setting-detail', row)
    varHint.textContent = '可用变量：{n} {chapter} {section}'
    varHint.style.fontSize = '11px'
    varHint.style.color = 'var(--text-muted, #888)'

    const errorEl = el('div', 'inkchapter-caption-template-error', row)
    errorEl.style.color = '#c62828'
    errorEl.style.fontSize = '12px'
    errorEl.style.minHeight = '16px'

    const previewEl = el('div', 'inkchapter-caption-setting-detail', row)
    previewEl.style.fontWeight = '600'

    const refreshPreview = (): void => {
      const cfg = migrateObjectNumberingConfig(type, get())
      const preview = buildPresetPreview(
        cfg.preset ?? 'global',
        type,
        { chapter: 2, section: 1, ordinal: 3, name: sampleName },
        cfg.startAt ?? 1,
        cfg.minDigits ?? 1,
        cfg.template,
      )
      previewEl.textContent = `预览：${preview}`
      errorEl.textContent = ''
    }
    refreshPreview()
  }

  private captionTemplateErrors(): string[] {
    const errors: string[] = []
    if (this.captionDraft) {
      for (const type of ['table', 'figure', 'code'] as const) {
        const t = this.captionDraft.types[type].template ?? '{n}'
        const v = validateNumberTemplate(t)
        if (!v.valid) errors.push(`${type}: ${v.reason}`)
      }
    }
    if (this.captionFormulaDraft) {
      const v = validateNumberTemplate(this.captionFormulaDraft.template)
      if (!v.valid) errors.push(`formula: ${v.reason}`)
    }
    return errors
  }

  private renderBottomActionBar(): void {
    const docKey = this.numberingService.getDocumentKey()

    // Development diagnostic: log dirty breakdown on first render
    const breakdown = this.getDirtyBreakdown()
    const anyDirty = breakdown.some(b => b.dirty)
    if (anyDirty) {
      console.warn('[InkChapter DirtyBreakdown] hasAnyDirty=true, sources:',
        breakdown.filter(b => b.dirty).map(b => `${b.source}=${b.detail}`))
    }

    const bar = el('div', 'inkchapter-settings-actions', this.containerEl)

    // hasDraft: only true when there are ACTUAL unsaved changes, not just initialized drafts.
    // headingDraft exists when renderCustomEditorCard initializes it for preset='custom',
    // but that does NOT mean there are unsaved changes.
    const formatDirty = this.formatDraft != null && this.savedFormatBaseline != null
      && JSON.stringify(this.formatDraft) !== JSON.stringify(this.savedFormatBaseline)
    const numberingDirty = this.headingDraft != null && this.headingDraftOriginal != null
      && JSON.stringify(this.headingDraft) !== JSON.stringify(this.headingDraftOriginal)
    const layoutDirty = this.hasLayoutDirty()
    const paragraphLayoutDirty = this.hasParagraphLayoutDirty()
    const captionDirty = this.hasCaptionDirty()
    const hasDraft = formatDirty || numberingDirty || layoutDirty || paragraphLayoutDirty || captionDirty
    if (hasDraft) {
      const hint = el('div', 'inkchapter-settings-unsaved-hint', bar)
      hint.textContent = '有未保存的更改'
    }

    // Right side: buttons
    const right = el('div', 'inkchapter-settings-actions-right', bar)

    const cancelBtn = el('button', 'inkchapter-btn', right)
    cancelBtn.textContent = '取消更改'
    cancelBtn.onclick = () => {
      let cancelled = false
      // Only cancel headingDraft if it was actually modified (not just initialized by render)
      if (this.headingDraft && this.headingDraftOriginal
          && JSON.stringify(this.headingDraft) !== JSON.stringify(this.headingDraftOriginal)) {
        // Restore format draft to baseline if editing a format
        if (this.formatDraft && this.savedFormatBaseline) {
          this.formatDraft = { ...this.savedFormatBaseline }
          const fmtSettings = deepCloneSettings({
            enabled: this.savedFormatBaseline.settings.enabled,
            showLevelOneNumber: this.savedFormatBaseline.settings.showLevelOneNumber,
            preset: 'custom' as const,
            maxDepth: this.savedFormatBaseline.settings.maxDepth,
            levels: this.savedFormatBaseline.settings.levels,
            customDefinition: this.savedFormatBaseline.settings.levels,
          } as any)
          this.headingDraft = fmtSettings
          this.headingDraftOriginal = deepCloneSettings(fmtSettings)
          this.ensureAllLevelsHaveCurrentSegment(this.headingDraft)
          this.ensureAllLevelsHaveCurrentSegment(this.headingDraftOriginal)
        } else {
          this.headingDraft = null
          this.headingDraftOriginal = null
        }
        cancelled = true
      }
      if (this.headingLayoutDraft && this.savedLayoutDraft) {
        this.headingLayoutDraft = deepCloneLayoutDraft(this.savedLayoutDraft)
        cancelled = true
      }
      if (this.paragraphLayoutDraft && this.savedParagraphLayoutBaseline) {
        this.paragraphLayoutDraft = { ...this.savedParagraphLayoutBaseline }
        cancelled = true
      }
      if (this.hasCaptionDirty()) {
        this.cancelCaptionSettings()
        cancelled = true
      }
      if (cancelled) {
        this.rerender()
        Notice.info('更改已取消')
      }
    }

    const saveBtn = el('button', 'inkchapter-btn inkchapter-btn--primary', right)
    saveBtn.textContent = '保存并应用'
    saveBtn.onclick = () => {
      // Capture view intent before any saves
      const viewIntent = {
        selectedFormatId: this.selectedFormatId,
        selectedFormatType: this.selectedFormatType,
        expandedLevel: this.expandedLevel,
      }

      // Save format draft if editing (only for custom formats)
      if (this.selectedFormatId && this.selectedFormatType === 'custom' && this.formatDraft && this.headingDraft) {
        this.saveFormatDraft(true) // suppressToast — we'll show one summary toast
      }
      // Save numbering scope draft if any (skip for system format viewing)
      if (this.headingDraft && this.selectedFormatType !== 'built-in') {
        const scope = this.headingScope
        const key = scope === 'document' ? (docKey ?? null) : null
        this.numberingService.saveHeadingNumberingScoped(scope, key, deepCloneSettings(this.headingDraft))
        this.headingDraft = null
        this.headingDraftOriginal = null
      }
      // Save layout draft if dirty
      if (this.headingLayoutDraft && docKey && this.hasLayoutDirty()) {
        const d = this.headingLayoutDraft
        const mode = resolveHeadingStructure(this.headingSettings).mode
        const existingByMode = this.numberingService.getScopeStore()
          .documentOverrides[docKey]?.layoutOverrides?.headingLayoutsByMode
        const headingLayoutsByMode = { ...(existingByMode ?? {}) } as Record<string, Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig>>
        headingLayoutsByMode[mode] = { ...d.headingLayouts }
        const layoutOverrides: import('../heading-numbering/heading-types').DocumentLayoutOverrides = {
          headingLayoutsByMode: headingLayoutsByMode as import('../heading-numbering/heading-types').DocumentLayoutOverrides['headingLayoutsByMode'],
          numberTitleSpacing: { ...d.numberTitleSpacing },
        }
        this.numberingService.saveLayoutOverridesFromDraft(docKey, layoutOverrides)
        this.savedLayoutDraft = deepCloneLayoutDraft(d)
        this.headingLayoutDraft = null
      }

      // Save paragraph layout draft if dirty (body paragraph settings).
      // Independent of headingDraft — prevents the two save buttons from
      // splitting state / silently dropping paragraph layout changes.
      if (this.paragraphLayoutDraft && this.hasParagraphLayoutDirty()) {
        this.numberingService.saveParagraphLayoutSettings(this.paragraphLayoutScope, { ...this.paragraphLayoutDraft })
        this.savedParagraphLayoutBaseline = { ...this.paragraphLayoutDraft }
        this.paragraphLayoutDraft = null
      }

      // Save caption settings if dirty (table/image/code caption enabled/position/prefix).
      if (this.hasCaptionDirty()) {
        this.saveCaptionSettings()
      }

      // Restore view intent — editor must continue showing the same format.
      // Only clear these if the view intent is no longer valid (format was deleted).
      this.selectedFormatId = viewIntent.selectedFormatId
      this.selectedFormatType = viewIntent.selectedFormatType
      this.expandedLevel = viewIntent.expandedLevel

      // If selectedFormatId is set but formatDraft was reset, reload it from library
      if (this.selectedFormatId && this.selectedFormatType === 'custom' && !this.formatDraft) {
        const fmt = this.formatLibrary.formats.find(f => f.id === this.selectedFormatId)
        if (fmt) {
          this.formatDraft = { ...fmt }
          this.savedFormatBaseline = { ...fmt }
        }
      }

      this.rerender()
      Notice.info('设置已保存并应用')
    }
  }
}

// ── Layout draft utilities ────────────────────────

function deepCloneLayoutDraft(d: HeadingLayoutDraft): HeadingLayoutDraft {
  const headingLayouts: Record<string, import('../heading-numbering/heading-types').HeadingLayoutConfig> = {}
  for (const key of Object.keys(d.headingLayouts)) {
    headingLayouts[key] = { ...d.headingLayouts[key] }
  }
  const numberTitleSpacing = { ...d.numberTitleSpacing } as Record<import('../heading-numbering/heading-types').HeadingLevel, import('../heading-numbering/heading-types').NumberTitleSpacing>
  return { headingLayouts, numberTitleSpacing }
}

function layoutDraftsEqual(a: HeadingLayoutDraft, b: HeadingLayoutDraft): boolean {
  // Compare headingLayouts
  const keysA = Object.keys(a.headingLayouts)
  const keysB = Object.keys(b.headingLayouts)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    const ca = a.headingLayouts[key]
    const cb = b.headingLayouts[key]
    if (!cb) return false
    if (ca.textAlign !== cb.textAlign || ca.firstLineIndentEm !== cb.firstLineIndentEm) return false
  }
  // Compare numberTitleSpacing
  for (let lv = 1; lv <= 6; lv++) {
    if ((a.numberTitleSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] ?? 'space')
        !== (b.numberTitleSpacing[lv as import('../heading-numbering/heading-types').HeadingLevel] ?? 'space')) return false
  }
  return true
}

// ── Native DOM helpers ─────────────────────────────

function el(tag: string, cls?: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (parent) parent.appendChild(e)
  return e
}

function buildSelect<T extends string>(options: Array<{ value: T; label: string }>, selected: T, cls: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = cls
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    select.appendChild(o)
  }
  select.value = selected
  return select
}

function sanitize(val: string): string {
  return val
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\n/g, '')
    .slice(0, 32)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeTemplateString(val: string): string {
  return val
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\n/g, '')
    .slice(0, 32)
}

/** Get a sample token string for preview purposes. */
function getSampleToken(style: NumberTokenStyle): string {
  switch (style) {
    case 'arabic': return '1'
    case 'fullwidth-arabic': return '１'
    case 'chinese': return '一'
    case 'chinese-financial': return '壹'
    case 'roman-upper': return 'I'
    case 'roman-lower': return 'i'
    case 'alpha-upper': return 'A'
    case 'alpha-lower': return 'a'
    case 'upper-greek': return 'Α'
    case 'lower-greek': return 'α'
    case 'heavenly-stems': return '甲'
    case 'earthly-branches': return '子'
    case 'circled': return '①'
    default: return '1'
  }
}

function buildRestartOptions(currentLevel: HeadingLevel): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    { value: '', label: '不重启（连续编号）' },
  ]
  for (let i = 1; i < currentLevel; i++) {
    options.push({ value: String(i), label: `在 H${i} 后重新开始` })
  }
  return options
}

function multilevelFormatSummary(format: readonly MultilevelFormatSegment[], tpl: import('../heading-numbering/heading-types').HeadingLevelNumberTemplate): string {
  if (!format || format.length === 0) return '（默认格式）'
  const parts = format.map(seg => {
    if (seg.type === 'literal') return seg.value || '(空)'
    return `[H${seg.level}模板]`
  })
  return parts.join('') + (tpl ? ` · 令牌=${tpl.tokenStyle}` : '')
}
