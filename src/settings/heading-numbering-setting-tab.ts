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
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS, generateStableId, clampMaxLevel, BUILT_IN_PRESET_IDS } from '../heading-numbering/heading-types'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'
import type { NumberFormatSegment } from '../heading-numbering/heading-types'
import { deepCloneSettings } from '../heading-numbering/heading-numbering-scope-store'
import { Notice } from '@typora-community-plugin/core'
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

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private previewEl: HTMLElement | null = null
  private miniPreviewEls: Map<number, HTMLElement> = new Map()
  private expandedLevel: HeadingLevel | null = null
  private selectEl: HTMLSelectElement | null = null
  private selectedSegmentId: string | null = null

  // ── H1 sync ──────────────────────────────────────
  private globalH1Toggle: HTMLInputElement | null = null
  private syncingLevelOneUi = false
  private unsubSettings: (() => void) | null = null

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

  // ── Format library state ─────────────────────────
  /** Cached format library from settings. */
  private formatLibrary: FormatLibrary = { version: 1, formats: [], preferences: { hiddenBuiltInPresetIds: [], customFormatOrder: [] } }
  /** Currently selected format ID for editing (null = scope draft). */
  private selectedFormatId: string | null = null
  /** Draft of the format being edited. */
  private formatDraft: CustomNumberingFormat | null = null
  /** Currently open card menu state. null if closed. */
  private openMenuState: OpenFormatMenuState | null = null
  private menuCleanups: Array<() => void> = []
  /** Whether the management panel is open. */
  private managePanelOpen = false

  // ── Layout collapse & selection states ──────────
  /** Whether the custom format editor section is expanded. */
  private editorExpanded = false
  /** Whether the heading range section is expanded. */
  private headingRangeExpanded = false
  /** Currently selected card key (preset key or format id) for the format summary. */
  private selectedCardKey: string | null = null
  /** Whether the selected card is a system preset (true) or user format (false). */
  private selectedCardIsPreset = false
  /** Active tab in the custom editor */
  private customEditorTab: 'composition' | 'label' | 'behavior' = 'composition'

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
  ) {
    super()
  }

  onshow(): void {
    this.cancelDrag()
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild)
    }
    // Subscribe to external settings changes (F1 commands, etc.)
    if (!this.unsubSettings) {
      this.unsubSettings = this.numberingService.onSettingsChanged(() => {
        this.syncFromExternalChange()
      })
    }
    // Initialize draft state from persisted settings
    this.initRangeDraft()
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
    }
    this.cancelDrag('settings-changed')
    this.onshow()
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

  /** Get the applied format version from the document override (for update detection). */
  private getAppliedFormatVersion(): number | undefined {
    const scopeStore = this.numberingService.getScopeStore()
    const docKey = this.numberingService.getDocumentKey()
    if (!docKey) return undefined
    const docOverride = scopeStore.documentOverrides[docKey]
    // Check if there's a saved version; default to 0 for migrated data without version
    return (docOverride?.formatSource as any)?._version as number | undefined
  }

  /** Determine the card state for a given format card. */
  private getCardState(key: string, isPreset: boolean):
    { applied: boolean; isGlobalDefault: boolean; inheritsGlobal: boolean; hasUpdate: boolean; appliedVersion?: number }
  {
    const info = this.getAppliedFormatInfo()
    
    // Check if this card is the current document's applied format
    let applied = false
    let inheritsGlobal = false
    let hasUpdate = false
    
    if (isPreset && info.source?.type === 'built-in' && info.source.presetId === key) {
      applied = true
      inheritsGlobal = info.inheritsGlobal
    } else if (!isPreset && info.source?.type === 'custom' && info.source.formatId === key) {
      applied = true
      inheritsGlobal = info.inheritsGlobal
      // Check for template update
      const appliedVersion = this.getAppliedFormatVersion()
      hasUpdate = hasFormatUpdate(this.formatLibrary, key, appliedVersion ?? 0)
    }
    
    // Check if this card is the global default
    const scopeStore = this.numberingService.getScopeStore()
    const gSource = (scopeStore.globalDefault as any).formatSource as NumberingFormatSource | undefined
    let isGlobalDefault = false
    if (isPreset && gSource?.type === 'built-in' && gSource.presetId === key) {
      isGlobalDefault = true
    } else if (!isPreset && gSource?.type === 'custom' && gSource.formatId === key) {
      isGlobalDefault = true
    }
    
    return { applied, isGlobalDefault, inheritsGlobal, hasUpdate }
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

    // Load format library
    this.formatLibrary = this.numberingService.getFormatLibrary()
    this.formatLibrary = migrateFormatLibrary(this.formatLibrary)

    // Menu portal layer
    let menuLayer = this.containerEl.querySelector('.inkchapter-menu-layer') as HTMLElement | null
    if (!menuLayer) {
      menuLayer = document.createElement('div')
      menuLayer.className = 'inkchapter-menu-layer'
      menuLayer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:200;'
      this.containerEl.appendChild(menuLayer)
    }

    // 1. Document scope section (compact info bar)
    this.renderScopeBar(s)

    // 2. Basic settings (compact grid: enable + H1 toggle)
    this.renderCompactBasicSettings(s)

    // 3. Format library (presets grid + user formats grid)
    this.renderFormatLibraryUnified(s)

    // 4. Current format summary (selected format info + operations)
    this.renderCurrentFormatSummary(s)

    // 5. Custom format editor (COLLAPSED by default, expand on edit/new)
    this.renderCustomEditorCollapsible(s)

    // 6. Heading range (COLLAPSED by default)
    this.renderHeadingRangeCollapsible()

    // 7. Heading layout (alignment + indent per level)
    this.renderHeadingLayoutSection()

    // 8. Bottom sticky action bar [Cancel Changes] [Save & Apply]
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

    for (const item of numbered) {
      const lv = item.level as HeadingLevel
      const style = s.levels[lv]
      if (!style?.enabled) continue

      if (!s.showLevelOneNumber && lv === 1) {
        const row = el('div', 'inkchapter-preview-row', this.previewEl)
        const label = el('span', 'inkchapter-preview-label', row)
        label.textContent = `H${lv} `
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = '一级标题示例'
        continue
      }

      const row = el('div', 'inkchapter-preview-row', this.previewEl)
      const label = el('span', 'inkchapter-preview-label', row)
      label.textContent = `H${lv} `
      const token = el('span', 'inkchapter-preview-token', row)
      token.textContent = item.label || `（无编号）`
    }
  }

  // ── UI helpers ───────────────────────────────────

  private refreshUI(): void {
    this.updatePreview()
  }

  private handlePresetSelect(preset: HeadingNumberingPreset): void {
    this.cancelDrag()
    this.selectedFormatId = null
    this.formatDraft = null
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
          const ls = s.levels[lv]
          if (!ls) continue
          const soloSeg: ContextualFormatSegment = {
            id: generateStableId(),
            type: 'level-reference',
            level: lv,
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
    this.numberingService.applyPresetToScope(presetId, targetScope, docKey)
    this.headingDraft = null
    this.headingDraftOriginal = null
    this.selectedFormatId = null
    this.formatDraft = null
    this.selectedCardKey = presetId
    this.selectedCardIsPreset = true
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
    this.numberingService.applyFormatToScope(format, targetScope, docKey)
    this.headingDraft = null
    this.headingDraftOriginal = null
    this.selectedFormatId = null
    this.formatDraft = null
    this.selectedCardKey = format.id
    this.selectedCardIsPreset = false
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
      const previewLines = getFormatPreview(format, 3)
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
    this.editorExpanded = true
    // Create heading settings from format (deep clone levels to avoid mutations)
    this.selectedFormatId = format.id
    this.formatDraft = { ...format }
    // Deep clone settings via deepCloneSettings to prevent shared references
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
    // Don't switch headingScope when editing a format
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
      saveBtn.onclick = () => this.saveFormatDraft()

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

  private saveFormatDraft(): void {
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
    this.formatDraft = updated

    // If the edited format was applied to current document, update the snapshot version
    const editScopeStore = this.numberingService.getScopeStore()
    const editDocKey = this.numberingService.getDocumentKey()
    if (editDocKey && editScopeStore.documentOverrides[editDocKey]?.formatSource?.type === 'custom' 
        && editScopeStore.documentOverrides[editDocKey].formatSource?.formatId === this.selectedFormatId) {
      // Re-apply to bump the version in the override
      this.numberingService.applyFormatToScope(updated, 'document', editDocKey)
    }

    Notice.info(`格式 "${updated.name}" 已保存`)
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
    this.selectedFormatId = null
    this.formatDraft = null
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

  // ── Level range UI ──────────────────────────────

  private renderLevelRangeSection(): void {
    const d = this.rangeDraft // Use draft, not persisted state
    const rangeSettings = this.numberingService.getLevelRangeSettings()
    const docPath = this.numberingService.getActiveFilePath()
    const effectiveMax = this.numberingService.getEffectiveMaxLevel()

    // ═══════════════════════════════════════════════
    // Global default range (with 确定/取消 buttons)
    // ═══════════════════════════════════════════════
    this.addSetting((setting) => {
      setting.addName('全局默认范围')
      setting.addDescription('新文档默认的有效标题级数范围。降低后不影响已有文档的标题，仅新文档生效。修改后点击确定生效。')

      const row = el('div', 'inkchapter-levelrange-global')
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;'
      setting.containerEl.appendChild(row)

      const select = document.createElement('select')
      select.style.minWidth = '140px'
      for (const max of [2, 3, 4, 5, 6] as const) {
        const opt = document.createElement('option')
        opt.value = String(max)
        opt.textContent = `H1 – H${max}`
        opt.selected = max === d.globalMaxLevel
        select.appendChild(opt)
      }
      row.appendChild(select)

      select.onchange = () => {
        d.globalMaxLevel = parseInt(select.value, 10) as MaxHeadingLevel
        this.markGlobalDirty()
      }

      const confirmBtn = el('button', 'inkchapter-btn', row) as HTMLButtonElement
      confirmBtn.textContent = '确定'
      confirmBtn.disabled = !d.globalDirty
      confirmBtn.onclick = () => this.handleGlobalConfirm(d)

      const cancelBtn = el('button', 'inkchapter-btn', row) as HTMLButtonElement
      cancelBtn.textContent = '取消'
      cancelBtn.disabled = !d.globalDirty
      cancelBtn.onclick = () => this.handleGlobalCancel(select)
    })

    // ═══════════════════════════════════════════════
    // Current document range
    // ═══════════════════════════════════════════════
    if (docPath) {
      // Mode buttons (also part of draft)
      this.addSetting((setting) => {
        setting.addName('当前文档')
        setting.addDescription(`当前生效范围：H1 – H${effectiveMax}。可独立设置以覆盖全局。修改后点击确定生效。`)

        const btnRow = el('div', 'inkchapter-levelrange-btnrow')
        setting.containerEl.appendChild(btnRow)

        const inheritBtn = el('button', 'inkchapter-btn', btnRow)
        inheritBtn.textContent = '继承全局'
        inheritBtn.style.marginRight = '8px'
        if (d.documentMode === 'inherit') inheritBtn.classList.add('inkchapter-btn--active')
        inheritBtn.onclick = () => {
          if (d.documentMode === 'inherit') return
          d.documentMode = 'inherit'
          d.documentMaxLevel = d.globalMaxLevel
          this.markDocumentDirty()
        }

        const customBtn = el('button', 'inkchapter-btn', btnRow)
        customBtn.textContent = '独立设置'
        if (d.documentMode === 'custom') customBtn.classList.add('inkchapter-btn--active')
        customBtn.onclick = () => {
          if (d.documentMode === 'custom') return
          d.documentMode = 'custom'
          d.documentMaxLevel = clampMaxLevel(effectiveMax) as MaxHeadingLevel
          this.markDocumentDirty()
        }
      })

      // Document-level range selector (always visible, read-only when inherit)
      this.addSetting((setting) => {
        setting.addName('当前文档范围')
        setting.addDescription(
          d.documentMode === 'inherit'
            ? `继承全局：H1 – H${d.globalMaxLevel}`
            : '独立设置后仅影响当前文档，不改变全局默认。',
        )

        const dd = el('div', 'inkchapter-doc-override-controls')
        setting.containerEl.appendChild(dd)

        const docSelect = document.createElement('select')
        docSelect.style.minWidth = '140px'
        for (const max of [2, 3, 4, 5, 6] as const) {
          const opt = document.createElement('option')
          opt.value = String(max)
          opt.textContent = `H1 – H${max}`
          opt.selected = max === (d.documentMode === 'inherit' ? d.globalMaxLevel : d.documentMaxLevel)
          docSelect.appendChild(opt)
        }
        if (d.documentMode === 'inherit') docSelect.disabled = true
        dd.appendChild(docSelect)

        docSelect.onchange = () => {
          if (d.documentMode === 'inherit') return
          d.documentMaxLevel = parseInt(docSelect.value, 10) as MaxHeadingLevel
          this.markDocumentDirty()
        }

        const confirmBtn = el('button', 'inkchapter-btn', dd) as HTMLButtonElement
        confirmBtn.textContent = '确定'
        confirmBtn.style.marginLeft = '8px'
        confirmBtn.disabled = !d.documentDirty
        confirmBtn.onclick = () => this.handleDocumentConfirm(docPath, d)

        const cancelBtn = el('button', 'inkchapter-btn', dd) as HTMLButtonElement
        cancelBtn.textContent = '取消'
        cancelBtn.disabled = !d.documentDirty
        cancelBtn.onclick = () => this.handleDocumentCancel(docSelect)
      })
    } else {
      this.addSetting((setting) => {
        setting.addName('当前文档')
        setting.addDescription('未检测到打开的文档。打开 Markdown 文件后可设置文档独立范围。')
      })
    }

    // Heading counts display
    if (docPath) {
      try {
        const counts = this.numberingService.countHeadingsByLevel()
        const outOfRangeCount = this.numberingService.countOutOfRangeHeadings()
        const hasHeadings = Object.values(counts).some((c: number) => c > 0)
        if (hasHeadings) {
          this.addSetting((setting: any) => {
            setting.addName('当前文档标题统计')
            setting.addDescription((descDiv: HTMLElement) => {
              const parts: string[] = []
              for (const lv of [1, 2, 3, 4, 5, 6] as const) {
                if (counts[lv] > 0) parts.push('H' + lv + '\uFF1A' + counts[lv])
              }
              const statEl = el('span', undefined, descDiv)
              statEl.style.cssText = 'font-size:13px;color:var(--text-muted);'
              statEl.textContent = parts.join('  ')
              if (outOfRangeCount > 0 && effectiveMax < 6) {
                const orEl = el('span', undefined, descDiv)
                orEl.style.cssText = 'display:block;margin-top:4px;color:#e67e22;font-size:13px;'
                orEl.textContent = '超出范围\uFF1A' + outOfRangeCount
              }
            })
          })
        }
      } catch { /* ignore */ }
    }

    // Effective level display
    if (effectiveMax < 6) {
      this.addSetting((setting) => {
        setting.addName('级别状态')
        setting.addDescription((descDiv) => {
          for (const lv of [1, 2, 3, 4, 5, 6] as const) {
            const tag = el('span', 'inkchapter-level-range-tag', descDiv)
            tag.textContent = lv > effectiveMax ? `级别${lv} 超出范围` : `级别${lv}`
            if (lv > effectiveMax) tag.classList.add('inkchapter-level-range-tag--out')
            descDiv.appendChild(tag)
            if (lv < 6) descDiv.appendChild(document.createTextNode(' '))
          }
        })
      })
    }
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

  private renderHeadingLayoutSection(): void {
    const layouts = this.numberingService.getEffectiveHeadingLayouts()
    const scope = this.headingScope
    const isGlobal = scope === 'global'

    this.addSetting((setting) => {
      setting.addName('标题排版')
      setting.addDescription(
        isGlobal
          ? '设置 H1～H6 各级标题的对齐与缩进（全局默认，新文档继承此设置）'
          : '设置 H1～H6 各级标题的对齐与缩进（当前文档）'
      )
    })

    const container = el('div')
    container.style.cssText = 'margin-top:8px;'

    const levels: Array<{ key: string; label: string }> = [
      { key: 'h1', label: 'H1' },
      { key: 'h2', label: 'H2' },
      { key: 'h3', label: 'H3' },
      { key: 'h4', label: 'H4' },
      { key: 'h5', label: 'H5' },
      { key: 'h6', label: 'H6' },
    ]

    for (const { key, label } of levels) {
      const row = el('div')
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;'

      const levelLabel = el('span')
      levelLabel.textContent = label
      levelLabel.style.cssText = 'font-weight:600;min-width:24px;font-size:13px;'
      row.appendChild(levelLabel)

      const lvKey = key as keyof import('../heading-numbering/heading-types').HeadingLayoutSettings
      const current = layouts?.[lvKey] ?? { textAlign: 'left' as const, firstLineIndentEm: 0 }

      type Mode = 'left' | 'indent-2' | 'center' | 'right'
      const currentMode: Mode = current.textAlign === 'left' && current.firstLineIndentEm >= 2
        ? 'indent-2' : current.textAlign as Mode

      const options: Array<{ mode: Mode; label: string }> = [
        { mode: 'left', label: '居左' },
        { mode: 'indent-2', label: '缩进2字符' },
        { mode: 'center', label: '居中' },
        { mode: 'right', label: '居右' },
      ]

      const btnGroup = el('div')
      btnGroup.style.cssText = 'display:flex;gap:0;border:1px solid var(--window-border,#ccc);border-radius:4px;overflow:hidden;'

      for (const opt of options) {
        const btn = el('button') as HTMLButtonElement
        btn.textContent = opt.label
        btn.style.cssText = [
          'padding:3px 10px',
          'border:none',
          'border-right:1px solid var(--window-border,#ccc)',
          'background:transparent',
          'color:var(--text-muted,#666)',
          'font-size:12px',
          'cursor:pointer',
          'transition:background 0.15s,color 0.15s',
          'white-space:nowrap',
        ].join(';')

        if (opt.mode === currentMode) {
          btn.style.background = 'var(--text-accent,#07a)'
          btn.style.color = '#fff'
          btn.style.fontWeight = '600'
        }

        // Remove right border from last button
        if (opt === options[options.length - 1]) {
          btn.style.borderRight = 'none'
        }

        btn.onclick = () => {
          let newConfig: import('../heading-numbering/heading-types').HeadingLayoutConfig
          switch (opt.mode) {
            case 'left':
              newConfig = { textAlign: 'left', firstLineIndentEm: 0 }
              break
            case 'indent-2':
              newConfig = { textAlign: 'left', firstLineIndentEm: 2 }
              break
            case 'center':
              newConfig = { textAlign: 'center', firstLineIndentEm: 0 }
              break
            case 'right':
              newConfig = { textAlign: 'right', firstLineIndentEm: 0 }
              break
          }
          const lv = parseInt(label.charAt(1), 10) as import('../heading-numbering/heading-types').HeadingLevel
          this.numberingService.setHeadingLayout(lv, newConfig)
          this.rerender()
        }

        btnGroup.appendChild(btn)
      }

      row.appendChild(btnGroup)
      container.appendChild(row)
    }

    // Action buttons row
    const actionsRow = el('div')
    actionsRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;'

    const applyToSubsequentBtn = el('button', 'inkchapter-btn') as HTMLButtonElement
    applyToSubsequentBtn.textContent = '应用到后续级别'
    applyToSubsequentBtn.title = '将当前级别的排版设置复制到所有更高级别'
    applyToSubsequentBtn.onclick = () => {
      const activeLevel = this.findActiveLayoutLevel()
      if (activeLevel) {
        this.numberingService.applyLayoutToSubsequentLevels(activeLevel)
        this.rerender()
      } else {
        Notice.info('请先选择某个级别的排版方案')
      }
    }
    actionsRow.appendChild(applyToSubsequentBtn)

    const resetAllBtn = el('button', 'inkchapter-btn') as HTMLButtonElement
    resetAllBtn.textContent = '全部恢复默认'
    resetAllBtn.title = '将所有标题排版恢复为居左不缩进'
    resetAllBtn.onclick = () => {
      this.numberingService.resetAllHeadingLayouts()
      this.rerender()
    }
    actionsRow.appendChild(resetAllBtn)

    container.appendChild(actionsRow)
    this.containerEl.appendChild(container)
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

    // Get active multilevel format
    const activeFmt = getActiveMultilevelFormatVariant(style, s.showLevelOneNumber, lv)

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
        const cur = getActiveMultilevelFormatVariant(style, s.showLevelOneNumber, lv)
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
    const availRefs = getAvailableMultilevelReferenceLevels(lv, s.showLevelOneNumber)
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
      const cur = getActiveMultilevelFormatVariant(style, s.showLevelOneNumber, lv)
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
    const availRefs = getAvailableContextualReferenceLevels(lv, s.showLevelOneNumber, activeFmt)
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
        opt.textContent = `[H${refLv}: ${tplPreview}]`
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
  ): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    const tplPreview = `${seg.appearance.prefix}${getSampleToken(seg.appearance.tokenStyle)}${seg.appearance.suffix}`
    chip.textContent = `[H${seg.level}:${tplPreview}]`
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
    } else {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' ×'
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

    const close = el('span', 'inkchapter-format-chip-close', chip)
    close.textContent = ' ×'
    close.onclick = (e) => {
      e.stopPropagation()
      const newFmt = activeFmt.filter(s => s.id !== seg.id)
      this.updateDraftContextualFormat(lv, newFmt)
      this.onshow()
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
    levelDisplay.textContent = `H${selectedSeg.level}`
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
    const before = [...getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    const hiddenLevels = new Set<HeadingLevel>()
    if (!s.showLevelOneNumber) hiddenLevels.add(1 as HeadingLevel)

    const after = normalizeContextualFormatAfterDrag(moved, lv, hiddenLevels, style.tokenStyle)

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
    const before = [...getActiveMultilevelFormatVariant(style, s.showLevelOneNumber, lv)]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    const hiddenLevels = new Set<HeadingLevel>()
    if (!s.showLevelOneNumber) hiddenLevels.add(1 as HeadingLevel)

    const after = normalizeMultilevelFormatAfterDrag(moved, lv, hiddenLevels)

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

      if (!s.showLevelOneNumber && lv === 1) {
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

  // ── Scope bar & confirm/cancel ──────────────────

  private ensureDraft(): void {
    if (this.headingDraft) return
    this.headingDraftOriginal = this.numberingService.getEffectiveSettings()
    this.headingDraft = deepCloneSettings(this.headingDraftOriginal)
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
    const currentStyle = s.levels[lv]
    // Ensure current level reference is present before updating
    const ensuredFormat = ensureCurrentLevelSegment(lv, nextFormat, currentStyle.tokenStyle)
    const updated = updateActiveContextualFormatVariant(
      currentStyle, lv, s.showLevelOneNumber, ensuredFormat,
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
    s.levels = { ...s.levels, [lv]: updated }
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
    const currentStyle = s.levels[lv]
    const updated = updateActiveMultilevelFormatVariant(
      currentStyle, lv, s.showLevelOneNumber, nextFormat,
    )
    s.levels = { ...s.levels, [lv]: updated }
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
    const currentStyle = s.levels[lv]
    const showL1 = s.showLevelOneNumber
    const activeFmt = getActiveContextualFormatVariant(currentStyle, showL1, lv)
    const nextFmt = activeFmt.map(seg => {
      if (seg.type === 'level-reference' && seg.id === segmentId) {
        return { ...seg, appearance: { ...seg.appearance, ...patch } }
      }
      return seg
    })

    const updated = updateActiveContextualFormatVariant(currentStyle, lv, showL1, nextFmt)
    // Sync multilevelFormatVariants for backward compat
    updated.multilevelFormatVariants = {
      withLevelOne: updated.contextualFormatVariants.withLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
      withoutLevelOne: updated.contextualFormatVariants.withoutLevelOne.map(seg =>
        seg.type === 'literal' ? { type: 'literal' as const, value: seg.value } : { type: 'level-template-reference' as const, level: seg.level }
      ),
    }
    s.levels = { ...s.levels, [lv]: updated }
  }

  private rerender(): void {
    // Re-render the entire page to reflect draft changes
    this.cancelDrag('draft-change')
    this.onshow()
  }

  /**
   * Ensure every level in Custom mode has a current-level segment.
   * If a level's contextualFormatVariants is empty, initialize it with
   * a single current-level reference using the level's own tokenStyle.
   * No parent references or separators are added automatically.
   */
  private ensureAllLevelsHaveCurrentSegment(s: HeadingNumberingSettings): void {
    for (const lv of HEADING_LEVELS) {
      const ls = s.levels[lv]
      if (!ls) continue
      // Check specifically for current-level reference, not any reference.
      // Preset formats (e.g. [H1].[H2].[H3]) contain level-references but
      // we need to ensure the CURRENT level's own ref is present.
      const hasOwnWith = ls.contextualFormatVariants?.withLevelOne?.some(
        seg => seg.type === 'level-reference' && seg.level === lv,
      )
      const hasOwnWithout = ls.contextualFormatVariants?.withoutLevelOne?.some(
        seg => seg.type === 'level-reference' && seg.level === lv,
      )
      const soloSeg: ContextualFormatSegment = {
        id: generateStableId(),
        type: 'level-reference',
        level: lv,
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

  private renderScopeBar(s: HeadingNumberingSettings): void {
    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()
    const source = this.numberingService.getSettingsSource()

    const bar = el('div', 'inkchapter-scope-bar--compact', this.containerEl)

    // ── Row 1: Document info ──────────────────────────
    const docInfoRow = el('div', 'inkchapter-scope-info', bar)

    const docEl = el('span', 'inkchapter-scope-doc', docInfoRow)
    const filename = docPath ? (docPath.split(/[/\\]/).pop() ?? docPath) : null
    docEl.textContent = filename ? `当前文档：${filename}` : '未打开文档'
    if (docPath) {
      docEl.title = docPath
    }

    const statusEl = el('span', 'inkchapter-scope-status', docInfoRow)
    statusEl.textContent = source === 'document' ? '状态：使用文档独立设置' : '状态：继承全局默认'

    // ── Row 2: Scope radio + restore button ────────────
    const scopeRow = el('div', 'inkchapter-scope-radios', bar)

    // Left group: scope label + radios
    const radioGroup = el('div', 'inkchapter-scope-radio-group', scopeRow)
    const scopeLabel = el('span', 'inkchapter-scope-radio-label', radioGroup)
    scopeLabel.textContent = '作用范围：'

    const buildRadio = (value: HeadingSettingsScope, label: string, disabled: boolean) => {
      const lbl = el('label', '', radioGroup)
      if (disabled) lbl.style.opacity = '0.5'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'heading-scope-compact'
      radio.value = value
      radio.checked = this.headingScope === value
      radio.disabled = disabled
      radio.onchange = () => {
        if (this.headingScope === value) return
        this.headingScope = value
        const newSettings = value === 'global'
          ? this.numberingService.getScopeStore().globalDefault
          : this.numberingService.getEffectiveSettings()
        this.headingDraft = deepCloneSettings(newSettings)
        this.headingDraftOriginal = deepCloneSettings(newSettings)
        this.rerender()
      }
      lbl.appendChild(radio)
      const span = document.createElement('span')
      span.textContent = label
      lbl.appendChild(span)
      return lbl
    }

    radioGroup.appendChild(buildRadio('document', '当前文档', !docPath))
    radioGroup.appendChild(buildRadio('global', '全局默认', false))

    // Right: Restore inherit button
    if (source === 'document') {
      const restoreBtn = el('button', 'inkchapter-btn inkchapter-btn--small', scopeRow)
      restoreBtn.textContent = '恢复继承'
      restoreBtn.title = '恢复继承全局默认设置'
      restoreBtn.onclick = () => {
        this.numberingService.restoreInheritGlobal(docKey ?? '')
        this.headingDraft = null
        this.headingDraftOriginal = null
        this.rerender()
        Notice.info('已恢复继承全局默认')
      }
    }
  }

  /** Compact two-column grid for enable + H1 toggle. */
  private renderCompactBasicSettings(s: HeadingNumberingSettings): void {
    const grid = el('div', 'inkchapter-basic-settings-grid', this.containerEl)

    // Enable toggle
    const enableItem = el('div', 'inkchapter-basic-setting-item', grid)
    const enableLabel = el('label', '', enableItem)
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

    // H1 toggle
    const h1Item = el('div', 'inkchapter-basic-setting-item', grid)
    const h1Label = el('label', '', h1Item)
    const h1Cb = document.createElement('input')
    h1Cb.type = 'checkbox'
    this.globalH1Toggle = h1Cb
    h1Cb.checked = s.showLevelOneNumber
    h1Cb.disabled = !s.enabled
    if (!s.enabled) h1Label.style.opacity = '0.4'
    h1Cb.onclick = () => {
      if (this.syncingLevelOneUi) return
      this.ensureDraft()
      this.headingDraft!.showLevelOneNumber = h1Cb.checked
      this.syncLevelOneControls(h1Cb.checked)
      this.rerender()
    }
    h1Label.appendChild(h1Cb)
    h1Label.appendChild(document.createTextNode(' 一级标题显示编号'))
  }

  // ── Unified format library grid ──────────────────

  private renderFormatLibraryUnified(s: HeadingNumberingSettings): void {
    // Title row
    const titleRow = el('div', 'inkchapter-format-library-title-row', this.containerEl)
    const title = el('span', 'inkchapter-format-library-title', titleRow)
    title.textContent = '编号格式库'
    const manageBtn = el('button', 'inkchapter-btn inkchapter-btn--small', titleRow)
    manageBtn.textContent = '管理格式库'
    manageBtn.onclick = () => {
      this.cancelDrag()
      this.managePanelOpen = !this.managePanelOpen
      this.rerender()
    }

    // Management panel
    if (this.managePanelOpen) {
      this.renderManageLibraryPanel()
    }

    const grid = el('div', 'inkchapter-format-grid', this.containerEl)

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

    // User formats (ordered)
    const orderedFormats = getOrderedCustomFormats(this.formatLibrary)
    for (const format of orderedFormats) {
      const previewLines = getFormatPreview(format, 3)
      const cardState = this.getCardState(format.id, false)
      const cardEl = this.buildFormatCard(
        grid, format.id, format.name, format.description || '', previewLines, false,
        () => this.handleFormatCardApply(format),
        cardState,
      )
      if (this.isCardSelected(format.id, false)) {
        cardEl.classList.add('inkchapter-format-card--selected')
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
    cardState: { applied: boolean; isGlobalDefault: boolean; inheritsGlobal: boolean; hasUpdate: boolean },
  ): HTMLElement {
    const cardEl = el('div', 'inkchapter-format-card', grid)
    cardEl.setAttribute('tabindex', '0')

    // ── Header: title row → meta row (badge only) ──
    const header = el('div', 'inkchapter-format-card-header', cardEl)
    
    // Title row (pr for absolute button)
    const titleRow = el('div', 'inkchapter-format-card-title-row', header)
    const cardName = el('span', 'inkchapter-format-card-title', titleRow)
    cardName.textContent = name
    
    // Meta row: status badge (left) only
    const metaRow = el('div', 'inkchapter-format-card-meta-row', header)
    const badgeWrap = el('span', 'inkchapter-format-card-badge-wrap', metaRow)
    
    if (cardState.applied && cardState.isGlobalDefault) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--global-default', badgeWrap)
      badge.textContent = '全局默认'
    } else if (cardState.applied && cardState.inheritsGlobal) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--inherit', badgeWrap)
      badge.textContent = '继承全局'
    } else if (cardState.applied && cardState.hasUpdate) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--update', badgeWrap)
      badge.textContent = '有更新'
    } else if (cardState.applied) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--applied', badgeWrap)
      badge.textContent = '当前文档'
    } else if (cardState.isGlobalDefault) {
      const badge = el('span', 'inkchapter-format-card-badge inkchapter-format-card-badge--global-default', badgeWrap)
      badge.textContent = '全局默认'
    }
    
    // "⋯" menu trigger — fixed to card top-right via absolute positioning
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

    // Apply button with context-aware state
    const actions = el('div', 'inkchapter-format-card-actions', cardEl)
    const applyBtn = el('button', 'inkchapter-btn', actions) as HTMLButtonElement
    
    let btnText = '应用'
    let btnDisabled = false
    
    if (cardState.applied || cardState.inheritsGlobal) {
      // Current document uses this format
      if (cardState.hasUpdate) {
        btnText = '应用更新'
      } else {
        btnText = '已应用'
        btnDisabled = true
      }
    } else if (cardState.isGlobalDefault && !cardState.applied) {
      btnText = '已设为默认'
      btnDisabled = true
    } else if (this.headingScope === 'global' && !cardState.applied) {
      btnText = '设为默认'
    }
    
    applyBtn.textContent = btnText
    applyBtn.disabled = btnDisabled
    if (btnDisabled) {
      applyBtn.classList.add('inkchapter-btn--disabled')
      applyBtn.style.cssText = 'opacity:0.6;cursor:default;'
    }
    applyBtn.onclick = (e) => {
      e.stopPropagation()
      if (btnDisabled) return // Double safety
      this.cancelDrag()
      if (cardState.hasUpdate) {
        // Apply update: re-apply the format with current template
        if (isPreset) {
          this.applyPresetToScope(key)
        } else {
          const fmt = this.formatLibrary.formats.find(f => f.id === key)
          if (fmt) this.applyFormatToScope(fmt)
        }
      } else if (this.headingScope === 'global' && !cardState.applied) {
        if (isPreset) {
          this.applyPresetToScope(key, 'global')
        } else {
          const fmt = this.formatLibrary.formats.find(f => f.id === key)
          if (fmt) this.applyFormatToScope(fmt, 'global')
        }
      } else {
        onApply()
      }
    }

    // Click card to select (only for preview, never changes applied state)
    cardEl.onclick = () => {
      this.cancelDrag()
      this.closeMenu()
      this.selectedCardKey = key
      this.selectedCardIsPreset = isPreset
      this.rerender()
    }
    cardEl.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.cancelDrag()
        this.closeMenu()
        this.selectedCardKey = key
        this.selectedCardIsPreset = isPreset
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

  private renderManageLibraryPanel(): void {
    const panel = el('div', 'inkchapter-manage-panel', this.containerEl)
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
    // Check if this format is global default
    const scopeStore = this.numberingService.getScopeStore()
    const isGlobalDefault = scopeStore.globalDefault.preset === 'custom'
      && scopeStore.globalDefault.levels === format.settings.levels

    if (isGlobalDefault) {
      this.showDeleteGlobalDefaultConfirm(format)
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
      this.formatDraft = null
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
      this.formatDraft = null
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

  // ── Collapsible custom editor ────────────────────

  private renderCustomEditorCollapsible(s: HeadingNumberingSettings): void {
    const isEditing = this.selectedFormatId !== null || s.preset === 'custom'

    const section = el('div', 'inkchapter-collapsible-section', this.containerEl)
    if (!this.editorExpanded) {
      section.classList.add('inkchapter-collapsed')
    } else {
      section.classList.add('inkchapter-expanded')
    }

    // Header
    const header = el('div', 'inkchapter-collapsible-header', section)
    header.setAttribute('tabindex', '0')
    const title = el('span', 'inkchapter-collapsible-title', header)
    title.textContent = '自定义格式编辑器'
    const arrow = el('span', 'inkchapter-collapsible-arrow', header)
    arrow.textContent = '▼'

    header.onclick = () => {
      this.editorExpanded = !this.editorExpanded
      if (this.editorExpanded && isEditing) {
        this.ensureDraft()
        this.ensureAllLevelsHaveCurrentSegment(this.headingDraft!)
      }
      this.rerender()
    }
    header.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click() }
    }

    const body = el('div', 'inkchapter-collapsible-body', section)
    if (!this.editorExpanded) return

    if (!isEditing) {
      const hint = el('div', '', body)
      hint.textContent = '选择一个系统预设或自定义格式后，点击"编辑格式"开始编辑。也可以点击"+ 新建格式"创建新格式。'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:16px;'
      return
    }

    this.ensureDraft()
    const draft = this.headingDraft!
    this.ensureAllLevelsHaveCurrentSegment(draft)

    // Editing header
    this.renderEditorEditHeader(body, s, draft)

    // H1-H6 level tabs
    this.renderLevelTabs(body, s, draft)

    // Editor tab bar (composition / label / behavior)
    const tabBar = el('div', 'inkchapter-editor-tab-bar', body)
    const tabs: { key: 'composition' | 'label' | 'behavior'; label: string }[] = [
      { key: 'composition', label: '多级组合格式' },
      { key: 'label', label: '序号标签设置' },
      { key: 'behavior', label: '当前级行为' },
    ]
    for (const t of tabs) {
      const tabBtn = el('div', 'inkchapter-editor-tab', tabBar)
      tabBtn.textContent = t.label
      tabBtn.setAttribute('tabindex', '0')
      if (this.customEditorTab === t.key) tabBtn.classList.add('inkchapter-editor-tab--active')
      tabBtn.onclick = () => {
        this.customEditorTab = t.key
        this.rerender()
      }
      tabBtn.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tabBtn.click() }
      }
    }

    // Dual-column: editor + preview
    const dualCol = el('div', 'inkchapter-editor-dual-col', body)
    const editorCol = el('div', 'inkchapter-editor-main', dualCol)

    // Render only the active tab content
    if (this.expandedLevel != null) {
      const lv = this.expandedLevel
      const style = draft.levels[lv]
      if (style) {
        const isH1Disabled = lv === 1 && !s.showLevelOneNumber
        if (!isH1Disabled || this.customEditorTab === 'behavior') {
          if (this.customEditorTab === 'composition') {
            this.renderCompositionTabContent(editorCol, lv, style, s)
          } else if (this.customEditorTab === 'label') {
            this.renderLabelTabContent(editorCol, lv, style, s)
          } else {
            this.renderBehaviorTabContent(editorCol, lv, style, s)
          }
        } else {
          const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorCol)
          h1Notice.textContent = 'H1 编号已关闭'
          h1Notice.classList.add('inkchapter-h1-visibility--disabled')
        }
      }
    } else {
      const hint = el('div', 'inkchapter-token-select-hint', editorCol)
      hint.textContent = '请从上方 H1-H6 标签中选择一个级别进行编辑'
      hint.style.cssText = 'color:var(--text-muted,#888);font-size:13px;text-align:center;padding:16px;'
    }

    // Preview column (sticky)
    const previewCol = el('div', 'inkchapter-editor-preview-col', dualCol)
    const previewSticky = el('div', 'inkchapter-editor-preview-sticky', previewCol)
    const previewTitle = el('div', '', previewSticky)
    previewTitle.textContent = '实时预览'
    previewTitle.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-muted,#666);'
    this.previewEl = el('div', 'inkchapter-preview', previewSticky)
    this.updatePreview()
    this.miniPreviewEls.clear()
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
      saveBtn.onclick = () => this.saveFormatDraft()

      const saveAsBtn = el('button', 'inkchapter-btn', header)
      saveAsBtn.textContent = '另存为'
      saveAsBtn.onclick = () => this.saveFormatAs()

      const cancelBtn = el('button', 'inkchapter-btn', header)
      cancelBtn.textContent = '取消编辑'
      cancelBtn.onclick = () => {
        this.editorExpanded = false
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
        this.editorExpanded = false
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
    const h1Visible = s.showLevelOneNumber
    const effectiveMax = this.numberingService.getEffectiveMaxLevel()

    for (const lv of HEADING_LEVELS) {
      const tab = el('div', 'inkchapter-level-tab', tabs)
      tab.textContent = `H${lv}`
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
  ): void {
    let activeFmt = getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)
    if (!activeFmt || activeFmt.length === 0) {
      const soloSeg: ContextualFormatSegment = {
        id: generateStableId(),
        type: 'level-reference',
        level: lv,
        appearance: { tokenStyle: style.tokenStyle, prefix: '', suffix: '' },
      }
      style.contextualFormatVariants = {
        withLevelOne: [{ ...soloSeg, id: generateStableId() }],
        withoutLevelOne: lv === 1 ? [] : [{ ...soloSeg, id: generateStableId() }],
      }
      activeFmt = getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)
    }

    if (!this.selectedSegmentId && activeFmt) {
      const curSeg = activeFmt.find(seg => seg.type === 'level-reference' && seg.level === lv)
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

      this.setupContextualDragDelegation(fmtEl, lv, style, activeFmt)

      for (let i = 0; i < activeFmt.length; i++) {
        const seg = activeFmt[i]
        if (seg.type === 'level-reference') {
          this.renderContextualLevelRefChip(fmtEl, i, seg, lv, activeFmt, s)
        } else {
          this.renderContextualLiteralChip(fmtEl, i, seg, lv, activeFmt)
        }
      }

      // Insert toolbar: level references only (text/separator moved to label tab prefix/suffix)
      const insertRow = el('div', 'inkchapter-format-insert-row', container)
      insertRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;'

      // Reference level selector
      const refSelect = el('select', undefined, insertRow) as HTMLSelectElement
      refSelect.style.cssText = 'min-width:80px;'

      const availRefs = getAvailableContextualReferenceLevels(lv, s.showLevelOneNumber, activeFmt)
      if (availRefs.length === 0) {
        const opt = document.createElement('option'); opt.value = ''; opt.textContent = '无可用'; opt.disabled = true; refSelect.appendChild(opt)
      } else {
        for (const refLv of availRefs) {
          // Allow re-adding current level ref if it was removed
          if (activeFmt.some(s => s.type === 'level-reference' && s.level === refLv)) continue
          const opt = document.createElement('option'); opt.value = String(refLv);
          opt.textContent = `H${refLv}`
          refSelect.appendChild(opt)
        }
      }

      // Add reference button
      const insertBtn = el('button', 'inkchapter-format-insert-btn', insertRow) as HTMLButtonElement
      insertBtn.textContent = '添加引用'
      insertBtn.style.cssText = 'flex-shrink:0;'
      insertBtn.disabled = refSelect.options.length === 0 || (refSelect.options.length === 1 && refSelect.options[0].disabled)

      insertBtn.onclick = () => {
        const refLv = Number(refSelect.value) as HeadingLevel
        if (!refLv || refLv < 1 || refLv > 6) return
        const cur = getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)
        if (cur.some(s => s.type === 'level-reference' && s.level === refLv)) return
        const refStyle2 = s.levels[refLv]
        const defaultAppearance = refStyle2?.levelTemplate
          ? { tokenStyle: refStyle2.levelTemplate.tokenStyle, prefix: refStyle2.levelTemplate.prefix ?? '', suffix: refStyle2.levelTemplate.suffix ?? '' }
          : { tokenStyle: 'arabic' as NumberTokenStyle, prefix: '', suffix: '' }
        const newFmt = [...cur, { id: generateStableId(), type: 'level-reference' as const, level: refLv, appearance: { ...defaultAppearance } }]
        this.updateDraftContextualFormat(lv, newFmt)
        this.onshow()
        queueMicrotask(() => this.updatePreview())
      }

      // Hint text
      const hint = el('span', '', insertRow)
      hint.textContent = '固定文字和分隔符请在「序号标签设置」中配置前缀/后缀'
      hint.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin-left:4px;'
    }
  }

  private renderLabelTabContent(
    container: HTMLElement,
    lv: HeadingLevel,
    style: HeadingLevelStyle,
    s: HeadingNumberingSettings,
  ): void {
    const activeFmt = getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)

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
    form.style.cssText = 'display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px 14px;align-items:center;'

    if (selectedSeg.type === 'literal') {
      this.addLabelFormRow(form, '文字内容', () => {
        const input = document.createElement('input')
        input.type = 'text'; input.value = selectedSeg.value; input.placeholder = '输入文字'
        input.style.cssText = 'width:100%;padding:4px 6px;'
        input.onblur = () => {
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
      span.textContent = `H${selectedSeg.level}`; span.style.cssText = 'font-weight:600;'
      return span
    })

    // Token style
    this.addLabelFormRow(form, '编号样式', () => {
      const select = document.createElement('select')
      select.style.cssText = 'width:100%;padding:4px 6px;'
      for (const opt of TOKEN_STYLE_LABELS) {
        const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label; o.selected = opt.value === selectedSeg.appearance.tokenStyle
        select.appendChild(o)
      }
      select.onchange = () => { this.updateDraftContextualSegment(lv, selectedSeg.id, { tokenStyle: select.value as NumberTokenStyle }); this.onshow() }
      return select
    })

    // Prefix
    this.addLabelFormRow(form, '前缀', () => {
      const input = document.createElement('input')
      input.type = 'text'; input.value = selectedSeg.appearance.prefix; input.placeholder = '例如：第'
      input.style.cssText = 'width:100%;padding:4px 6px;'
      input.onblur = () => { this.updateDraftContextualSegment(lv, selectedSeg.id, { prefix: sanitizeTemplateString(input.value) }); this.onshow() }
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur() }
      return input
    })

    // Suffix
    this.addLabelFormRow(form, '后缀', () => {
      const input = document.createElement('input')
      input.type = 'text'; input.value = selectedSeg.appearance.suffix; input.placeholder = '例如：章'
      input.style.cssText = 'width:100%;padding:4px 6px;'
      input.onblur = () => { this.updateDraftContextualSegment(lv, selectedSeg.id, { suffix: sanitizeTemplateString(input.value) }); this.onshow() }
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
  ): void {
    const isH1Disabled = lv === 1 && !s.showLevelOneNumber

    // Compact grid form
    const form = el('div', 'inkchapter-behavior-form', container)
    form.style.cssText = 'display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 14px;align-items:center;'

    if (lv > 1) {
      // Enable toggle
      const cbRow = el('div', '', form)
      cbRow.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;gap:6px;'
      const cb = document.createElement('input')
      cb.type = 'checkbox'; cb.checked = style.enabled
      cb.onchange = () => { this.numberingService.updateLevelStyle(lv, { enabled: cb.checked }); this.onshow() }
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
    startInput.style.cssText = 'width:80px;padding:4px 6px;'
    startInput.onblur = () => {
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
      const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = '不重启（连续编号）'; noneOpt.selected = style.restartAfterLevel === null
      restartSelect.appendChild(noneOpt)
      for (let i = 1; i < lv; i++) {
        const opt = document.createElement('option'); opt.value = String(i); opt.textContent = `在 H${i} 后重新开始`; opt.selected = style.restartAfterLevel === i
        restartSelect.appendChild(opt)
      }
      restartSelect.onchange = () => {
        const parsed = restartSelect.value === '' ? null : Number(restartSelect.value) as HeadingLevel
        this.numberingService.updateLevelStyle(lv, { restartAfterLevel: parsed } as any); this.onshow()
      }
      form.appendChild(restartSelect)
    }
  }

  // ── Collapsible heading range ────────────────────

  private renderHeadingRangeCollapsible(): void {
    const section = el('div', 'inkchapter-collapsible-section', this.containerEl)
    if (!this.headingRangeExpanded) {
      section.classList.add('inkchapter-collapsed')
    } else {
      section.classList.add('inkchapter-expanded')
    }

    const header = el('div', 'inkchapter-collapsible-header', section)
    header.setAttribute('tabindex', '0')
    const title = el('span', 'inkchapter-collapsible-title', header)
    title.textContent = '标题有效级数范围'

    const arrow = el('span', 'inkchapter-collapsible-arrow', header)
    arrow.textContent = '▼'

    header.onclick = () => {
      this.headingRangeExpanded = !this.headingRangeExpanded
      this.rerender()
    }
    header.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        header.click()
      }
    }

    const body = el('div', 'inkchapter-collapsible-body', section)

    if (!this.headingRangeExpanded) return

    // Reuse existing level range rendering
    this.renderLevelRangeSectionInto(body)
  }

  /** Render level range content into a given container. */
  private renderLevelRangeSectionInto(container: HTMLElement): void {
    // Capture current child count; render into containerEl; move new children to target
    const beforeCount = this.containerEl.childNodes.length
    this.renderLevelRangeSection()
    // Move newly appended children (after beforeCount) into the target container
    const children = Array.from(this.containerEl.childNodes)
    for (let i = beforeCount; i < children.length; i++) {
      container.appendChild(children[i])
    }
  }

  // ── Bottom sticky action bar ─────────────────────

  private renderBottomActionBar(): void {
    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()

    const bar = el('div', 'inkchapter-settings-actions', this.containerEl)

    const cancelBtn = el('button', 'inkchapter-btn', bar)
    cancelBtn.textContent = '取消更改'
    cancelBtn.onclick = () => {
      if (this.headingDraft) {
        this.headingDraft = null
        this.headingDraftOriginal = null
        this.editorExpanded = false
        this.selectedFormatId = null
        this.formatDraft = null
        this.rerender()
        Notice.info('更改已取消')
      }
    }

    const saveBtn = el('button', 'inkchapter-btn inkchapter-btn--primary', bar)
    saveBtn.textContent = '保存并应用'
    saveBtn.onclick = () => {
      // Save format draft if editing
      if (this.selectedFormatId && this.formatDraft && this.headingDraft) {
        this.saveFormatDraft()
      }
      // Save scope draft if any
      if (this.headingDraft) {
        const scope = this.headingScope
        const key = scope === 'document' ? (docKey ?? null) : null
        this.numberingService.saveHeadingNumberingScoped(scope, key, deepCloneSettings(this.headingDraft))
        this.headingDraft = null
        this.headingDraftOriginal = null
      }
      this.editorExpanded = false
      this.selectedFormatId = null
      this.formatDraft = null
      this.rerender()
      Notice.info('设置已保存')
    }
  }
}

// ── Native DOM helpers ─────────────────────────────

function el(tag: string, cls?: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (parent) parent.appendChild(e)
  return e
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
