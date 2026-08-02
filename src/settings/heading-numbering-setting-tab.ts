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
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS, generateStableId, clampMaxLevel } from '../heading-numbering/heading-types'
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
  { key: 'decimal-hierarchical', name: '十进制层级', desc: '阿拉伯数字层级编号', previewLines: ['1', '1.1', '1.1.1'] },
  { key: 'chinese-chapter', name: '中文章节', desc: '章节标题格式', previewLines: ['第一章', '第一节', '一、'] },
  { key: 'chinese-outline', name: '中文大纲', desc: '中文大纲格式', previewLines: ['一、', '（一）', '1.'] },
  { key: 'roman-hierarchical', name: '罗马数字', desc: '大写罗马数字层级', previewLines: ['I', 'I.I', 'I.I.I'] },
  { key: 'custom', name: '自定义', desc: '按 H1-H6 分别配置', previewLines: [] },
]

const DRAG_THRESHOLD = 4
const DEBUG_DRAG = false

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
   * Called when settings change externally (F1 command, service API, etc.).
   * Re-syncs the UI without re-rendering the entire page.
   */
  private syncFromExternalChange(): void {
    const s = this.headingSettings
    this.syncLevelOneControls(s.showLevelOneNumber)
    // Re-render to reflect H1 panel state
    this.cancelDrag('settings-changed')
    this.onshow()
  }

  private get headingSettings() {
    // Return draft if active, otherwise effective settings
    if (this.headingDraft) return this.headingDraft
    return this.numberingService.getEffectiveSettings()
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

    // ── Scope selection bar ──────────────────────────
    this.renderScopeBar(s)

    // ── Section: Basic ──────────────────────────────
    this.addSettingTitle('基础设置')

    // Enable toggle (总开关)
    this.addSetting((setting) => {
      setting.addName('启用标题编号')
      setting.addDescription('开启后自动为标题添加编号。关闭后文档和预览均不显示编号，不清空预设。')
      setting.addCheckbox((cb) => {
        cb.checked = s.enabled
        cb.onclick = () => {
          this.ensureDraft()
          this.headingDraft!.enabled = cb.checked
          this.rerender()
        }
      })
    })

    // Show level one toggle
    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时 H1 不显示编号，H2 从 1 开始计数，不暴露隐藏的 H1 编号路径。')
      setting.addCheckbox((cb) => {
        this.globalH1Toggle = cb
        cb.checked = s.showLevelOneNumber
        cb.onclick = () => {
          if (this.syncingLevelOneUi) return
          this.ensureDraft()
          this.headingDraft!.showLevelOneNumber = cb.checked
          this.syncLevelOneControls(cb.checked)
          this.rerender()
        }
      })
    })

    // ── Preset cards ──────────────────────────────
    const cardsContainer = el('div', 'inkchapter-preset-cards')
    this.containerEl.appendChild(cardsContainer)

    for (const card of PRESET_CARDS) {
      const cardEl = el('div', 'inkchapter-preset-card', cardsContainer)
      if (card.key === s.preset) cardEl.classList.add('inkchapter-preset-card--selected')
      cardEl.setAttribute('tabindex', '0')
      cardEl.setAttribute('role', 'radio')
      cardEl.setAttribute('aria-checked', String(card.key === s.preset))

      const cardName = el('div', 'inkchapter-preset-card-name', cardEl)
      cardName.textContent = card.name
      const cardDesc = el('div', 'inkchapter-preset-card-desc', cardEl)
      cardDesc.textContent = card.desc
      if (card.previewLines.length > 0) {
        const cardPreview = el('div', 'inkchapter-preset-card-preview', cardEl)
        for (const line of card.previewLines) {
          const lineEl = el('div', 'inkchapter-preset-card-preview-line', cardPreview)
          lineEl.textContent = line
        }
      }

      cardEl.onclick = () => this.handlePresetSelect(card.key)
      cardEl.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.handlePresetSelect(card.key) }
      }
    }

    // Preset dropdown (compact/backup, synced with cards)
    this.addSetting((setting) => {
      setting.addName('编号样式预设')
      setting.addDescription('选择预设编号格式，切换后立即更新文档和预览。')
      setting.addSelect((select) => {
        this.selectEl = select
        for (const preset of PRESET_LIST) {
          const opt = document.createElement('option')
          opt.value = preset.key
          opt.textContent = preset.name
          opt.selected = preset.key === s.preset
          select.appendChild(opt)
        }
        const customOpt = document.createElement('option')
        customOpt.value = 'custom'
        customOpt.textContent = '自定义'
        customOpt.selected = s.preset === 'custom'
        select.appendChild(customOpt)

        select.onchange = () => {
          this.handlePresetSelect(select.value as HeadingNumberingPreset)
        }
      })
    })

    // ── Level range ────────────────────────────────
    this.addSettingTitle('标题有效级数范围')
    this.renderLevelRangeSection()

    // ── Live Preview ────────────────────────────────
    this.addSettingTitle('实时预览')
    this.previewEl = el('div', 'inkchapter-preview')
    this.addSetting((setting) => {
      setting.addName('预览')
      setting.addDescription((descDiv) => {
        descDiv.appendChild(this.previewEl!)
      })
    })
    this.updatePreview()

    // ── Custom section (fold panels for H1-H6) ────
    if (s.preset === 'custom') {
      // Ensure draft exists and all levels have current-level segments.
      // This must happen before renderCustomPanels so both editor and preview
      // read from the same (fixed) draft.
      this.ensureDraft()
      const draft = this.headingDraft!
      this.ensureAllLevelsHaveCurrentSegment(draft)
      // Re-render preview with fixed draft
      this.updatePreview()
      this.miniPreviewEls.clear()
      this.addSettingTitle('自定义设置')
      this.renderCustomPanels(draft)
    } else {
      this.miniPreviewEls.clear()
    }
  }

  // ── Preview ─────────────────────────────────────

  private updatePreview(): void {
    if (!this.previewEl) return
    this.previewEl.textContent = ''

    const s = this.headingSettings
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

  // ── Custom panels (Two-stage: template → composition) ──

  private renderCustomPanels(s: HeadingNumberingSettings): void {
    const h1Visible = s.showLevelOneNumber

    // ── Two-column layout ──────────────────────────
    const layout = el('div', 'inkchapter-editor-layout')
    this.containerEl.appendChild(layout)

    // Left: level list
    const leftCol = el('div', 'inkchapter-editor-left', layout)
    const levelTitle = el('div', 'inkchapter-editor-level-title', leftCol)
    levelTitle.textContent = '级别'

    for (const lv of HEADING_LEVELS) {
      const lvBtn = el('div', 'inkchapter-editor-level-btn', leftCol)
      lvBtn.textContent = `级别${lv}`
      lvBtn.setAttribute('tabindex', '0')
      if (this.expandedLevel === lv) lvBtn.classList.add('inkchapter-editor-level-btn--selected')

      if (lv === 1 && !h1Visible) {
        lvBtn.classList.add('is-h1-numbering-disabled')
        const statusTag = el('span', 'inkchapter-level-status-tag', lvBtn)
        statusTag.textContent = '已关闭'
        lvBtn.setAttribute('aria-disabled', 'true')
      }

      // Out-of-range level display
      const effectiveMax = this.numberingService.getEffectiveMaxLevel()
      if (lv > effectiveMax) {
        lvBtn.classList.add('is-h1-numbering-disabled')
        const statusTag = el('span', 'inkchapter-level-status-tag', lvBtn)
        statusTag.textContent = '超出范围'
        lvBtn.setAttribute('aria-disabled', 'true')
        // Disable click for out-of-range levels
        lvBtn.onclick = () => {
          // no-op: out-of-range levels cannot be expanded
        }
        continue
      }

      lvBtn.onclick = () => {
        this.expandedLevel = this.expandedLevel === lv ? null : lv
        this.onshow()
      }
    }

    // Right: full preview
    const rightCol = el('div', 'inkchapter-editor-right', layout)
    const previewTitle = el('div', 'inkchapter-editor-preview-title', rightCol)
    previewTitle.textContent = '多级编号预览'
    const fullPreview = el('div', 'inkchapter-preview', rightCol)
    this.renderFullPreviewInContainer(s, fullPreview)

    // ── Bottom: two-stage format editor ─────────────
    if (this.expandedLevel != null) {
      const lv = this.expandedLevel
      const style = s.levels[lv]
      if (!style) return

      const isH1Disabled = lv === 1 && !h1Visible

      const editorSection = el('div', 'inkchapter-editor-bottom')
      this.containerEl.appendChild(editorSection)

      // H1 visibility status (read-only)
      if (lv === 1) {
        const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorSection)
        h1Notice.textContent = h1Visible ? 'H1 编号当前已开启' : 'H1 编号当前已关闭'
        h1Notice.setAttribute('aria-live', 'polite')
        if (h1Visible) {
          h1Notice.classList.add('inkchapter-h1-visibility--enabled')
        } else {
          h1Notice.classList.add('inkchapter-h1-visibility--disabled')
        }
        const h1SubNotice = el('div', 'inkchapter-custom-h1-subnotice', editorSection)
        h1SubNotice.textContent = '由上方「一级标题显示编号」控制'
      }

      // Mode indicator for H2-H6
      if (lv > 1) {
        const modeEl = el('div', 'inkchapter-custom-h1-subnotice', editorSection)
        modeEl.textContent = h1Visible
          ? '正在编辑：一级标题编号开启时的格式'
          : '正在编辑：一级标题编号关闭时的格式'
        const noteEl = el('div', 'inkchapter-custom-h1-subnotice', editorSection)
        noteEl.textContent = '两种格式分别保存，切换后不会相互覆盖。'
      }

      // ═══ Stage 1: Multilevel composition (contextual model) ═══
      if (!isH1Disabled) {
        let activeFmt = getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv)
        if (!activeFmt || activeFmt.length === 0) {
          // Format not initialized — repair it now with current-level-only format.
          // Do NOT fall back to the old multilevel model; that would show
          // stale preset data (e.g. [H1].[H2].[H3]) instead of just [H3].
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
        // Default select current level tag
        if (!this.selectedSegmentId) {
          const curSeg = activeFmt?.find(s => s.type === 'level-reference' && s.level === lv)
          if (curSeg) this.selectedSegmentId = curSeg.id
        }
        if (activeFmt && activeFmt.length > 0) {
          this.renderContextualCompositionEditor(editorSection, lv, style, s, activeFmt)
        }
      }

      // ═══ Stage 2: Current level behavior ═══
      this.renderLevelBehaviorSettings(editorSection, lv, style, isH1Disabled,
        (getActiveContextualFormatVariant(style, s.showLevelOneNumber, lv) || []) as readonly MultilevelFormatSegment[])
    }
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

    // ── Property panel for selected segment ───────
    this.renderContextualPropertyPanel(section, lv, activeFmt, s)

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
    const scopeSection = el('div', 'inkchapter-scope-bar', this.containerEl)
    scopeSection.style.cssText = 'margin:8px 0;padding:12px;background:#f5f5f5;border-radius:6px;border:1px solid #ddd;'

    // Document path
    const docPath = this.numberingService.getActiveFilePath()
    const docKey = this.numberingService.getDocumentKey()
    const pathEl = el('div', 'inkchapter-scope-path', scopeSection)
    pathEl.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;'
    pathEl.textContent = docPath ? `当前文档：${docKey ?? docPath}` : '未打开文档'

    // Source status
    const source = this.numberingService.getSettingsSource()
    const statusEl = el('div', 'inkchapter-scope-status', scopeSection)
    statusEl.style.cssText = 'font-size:12px;color:#888;margin-bottom:10px;'
    statusEl.textContent = source === 'document' ? '当前状态：使用文档独立设置' : '当前状态：继承全局默认'

    // Scope radio buttons
    const scopeRow = el('div', 'inkchapter-scope-row', scopeSection)
    scopeRow.style.cssText = 'display:flex;gap:16px;align-items:center;'
    const scopeLabel = el('span', '', scopeRow)
    scopeLabel.textContent = '作用范围：'
    scopeLabel.style.cssText = 'font-weight:600;font-size:13px;'

    const buildRadio = (value: HeadingSettingsScope, label: string, disabled: boolean) => {
      const radioRow = el('label', '', scopeRow)
      radioRow.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:4px;'
      if (disabled) radioRow.style.opacity = '0.5'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'heading-scope'
      radio.value = value
      radio.checked = this.headingScope === value
      radio.disabled = disabled
      radio.onchange = () => {
        if (this.headingScope === value) return
        this.headingScope = value
        // Reset draft when switching scope
        const newSettings = value === 'global'
          ? this.numberingService.getScopeStore().globalDefault
          : this.numberingService.getEffectiveSettings()
        this.headingDraft = deepCloneSettings(newSettings)
        this.headingDraftOriginal = deepCloneSettings(newSettings)
        this.rerender()
      }
      radioRow.appendChild(radio)
      const span = document.createElement('span')
      span.textContent = label
      span.style.fontSize = '13px'
      radioRow.appendChild(span)
      return radioRow
    }

    scopeRow.appendChild(buildRadio('document', '当前文档', !docPath))
    scopeRow.appendChild(buildRadio('global', '全局默认', false))

    if (!docPath) {
      const hintEl = el('div', '', scopeSection)
      hintEl.style.cssText = 'font-size:11px;color:#999;margin-top:4px;'
      hintEl.textContent = '未打开 MD 文件时，"当前文档"不可用。'
    }

    // Restore inherit button
    if (source === 'document') {
      const restoreBtn = el('button', '', scopeSection)
      restoreBtn.textContent = '恢复继承全局默认'
      restoreBtn.style.cssText = 'margin-top:8px;padding:4px 12px;font-size:12px;cursor:pointer;'
      restoreBtn.onclick = () => {
        this.numberingService.restoreInheritGlobal(docKey ?? '')
        this.headingDraft = null
        this.headingDraftOriginal = null
        this.rerender()
        Notice.info('已恢复继承全局默认')
      }
    }

    // Scope hint
    const hintEl = el('div', '', scopeSection)
    hintEl.style.cssText = 'font-size:11px;color:#666;margin-top:6px;'
    if (this.headingScope === 'global') {
      hintEl.textContent = '该修改将影响所有尚未设置独立编号样式的文档。已有独立设置的文档不会被覆盖。'
    } else {
      hintEl.textContent = '仅影响当前文档，不会改变其他文档的编号样式。'
    }

    // Confirm / Cancel buttons
    const actionRow = el('div', 'inkchapter-scope-actions', this.containerEl)
    actionRow.style.cssText = 'display:flex;gap:8px;margin:12px 0;padding:0 0 16px 0;'

    const confirmBtn = el('button', '', actionRow)
    confirmBtn.textContent = '确定'
    confirmBtn.style.cssText = 'padding:8px 24px;font-size:14px;font-weight:600;background:#0078d4;color:#fff;border:none;border-radius:4px;cursor:pointer;'
    confirmBtn.onclick = () => {
      if (!this.headingDraft) {
        Notice.info('没有需要保存的更改')
        return
      }
      const scope = this.headingScope
      const key = scope === 'document' ? (docKey ?? null) : null
      this.numberingService.saveHeadingNumberingScoped(scope, key, deepCloneSettings(this.headingDraft))
      this.headingDraft = null
      this.headingDraftOriginal = null
      this.rerender()
      Notice.info(scope === 'global' ? '全局默认设置已保存' : '当前文档设置已保存')
    }

    const cancelBtn = el('button', '', actionRow)
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText = 'padding:8px 24px;font-size:14px;background:#e0e0e0;color:#333;border:none;border-radius:4px;cursor:pointer;'
    cancelBtn.onclick = () => {
      if (this.headingDraft) {
        this.headingDraft = null
        this.headingDraftOriginal = null
        this.rerender()
        Notice.info('更改已取消')
      }
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
