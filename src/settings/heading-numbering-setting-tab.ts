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
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS } from '../heading-numbering/heading-types'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'
import type { NumberFormatSegment } from '../heading-numbering/heading-types'
import {
  moveSegmentToResolvedIndex,
  calculateTargetIndexAfterRemoval,
  normalizeFormatAfterDrag,
  createDragState,
  createDebugLog,
} from '../heading-numbering/format-drag-utils'
import type { DragState } from '../heading-numbering/format-drag-utils'
import { computeHeadingNumbering, getAvailableReferenceLevels, getEffectiveFormatForLevel, getActiveFormatVariant } from '../heading-numbering/numbering-engine'
import { PRESET_LIST } from '../heading-numbering/presets'

const TOKEN_STYLE_LABELS: { value: NumberTokenStyle; label: string }[] = [
  { value: 'arabic', label: '阿拉伯数字 (1, 2, 3)' },
  { value: 'chinese', label: '中文数字 (一, 二, 三)' },
  { value: 'roman-upper', label: '大写罗马 (I, II, III)' },
  { value: 'roman-lower', label: '小写罗马 (i, ii, iii)' },
  { value: 'alpha-upper', label: '大写字母 (A, B, C)' },
  { value: 'alpha-lower', label: '小写字母 (a, b, c)' },
  { value: 'circled', label: '带圈数字 (①, ②, ③)' },
]

const PRESET_CARDS: { key: HeadingNumberingPreset; name: string; desc: string; previewLines: string[] }[] = [
  { key: 'decimal-hierarchical', name: '十进制层级', desc: '阿拉伯数字层级编号', previewLines: ['1', '1.1', '1.1.1'] },
  { key: 'chinese-chapter', name: '中文章节', desc: '章节标题格式', previewLines: ['第一章', '第一节', '一、'] },
  { key: 'chinese-outline', name: '中文大纲', desc: '中文大纲格式', previewLines: ['一、', '（一）', '1.'] },
  { key: 'roman-hierarchical', name: '罗马数字', desc: '大写罗马数字层级', previewLines: ['I', 'I.1', 'I.1.1'] },
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

  // ── H1 sync ──────────────────────────────────────
  private globalH1Toggle: HTMLInputElement | null = null
  private syncingLevelOneUi = false
  private unsubSettings: (() => void) | null = null

  // ── Drag ─────────────────────────────────────────
  private dragState: DragState | null = null

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
    return this.numberingService.getCurrentSettings()
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

    // ── Section: Basic ──────────────────────────────
    this.addSettingTitle('基础设置')

    // Enable toggle (总开关)
    this.addSetting((setting) => {
      setting.addName('启用标题编号')
      setting.addDescription('开启后自动为标题添加编号。关闭后文档和预览均不显示编号，不清空预设。')
      setting.addCheckbox((cb) => {
        cb.checked = s.enabled
        cb.onclick = () => {
          const current = this.settings.get('headingNumbering')
          current.enabled = cb.checked
          this.settings.set('headingNumbering', current)
          this.numberingService.toggle()
          this.refreshUI()
        }
      })
    })

    // Show level one toggle (global H1 switch)
    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时 H1 不显示编号，H2 从 1 开始计数，不暴露隐藏的 H1 编号路径。')
      setting.addCheckbox((cb) => {
        this.globalH1Toggle = cb
        cb.checked = s.showLevelOneNumber
        cb.onclick = () => {
          if (this.syncingLevelOneUi) return // cycle guard
          this.applyLevelOneVisibility(cb.checked, 'global-toggle')
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
      this.miniPreviewEls.clear()
      this.addSettingTitle('自定义设置')
      this.renderCustomPanels(s)
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
    this.numberingService.applyPreset(preset)
    if (this.selectEl) {
      this.selectEl.value = preset
    }
    this.onshow()
  }

  // ── Custom panels ──────────────────────────────

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

      // H1 disabled state indicator
      if (lv === 1 && !h1Visible) {
        lvBtn.classList.add('is-h1-numbering-disabled')
        const statusTag = el('span', 'inkchapter-level-status-tag', lvBtn)
        statusTag.textContent = '已关闭'
        lvBtn.setAttribute('aria-disabled', 'true')
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

    // ── Bottom: format editor (if level selected) ──
    if (this.expandedLevel != null) {
      const lv = this.expandedLevel
      const style = s.levels[lv]
      if (!style) return

      const isH1Disabled = lv === 1 && !h1Visible

      const editorSection = el('div', 'inkchapter-editor-bottom')
      this.containerEl.appendChild(editorSection)

      // H1 notice / panel checkbox
      if (lv === 1) {
        if (isH1Disabled) {
          const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorSection)
          h1Notice.textContent = 'H1 编号当前已关闭'
          const h1SubNotice = el('div', 'inkchapter-custom-h1-subnotice', editorSection)
          h1SubNotice.textContent = '由上方「一级标题显示编号」控制'
        } else {
          const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorSection)
          h1Notice.textContent = 'H1 显示编号（与上方同步）'

          // H1 panel checkbox (synced with global)
          this.addCustomCheckbox(editorSection, '显示 H1 编号', h1Visible, (checked) => {
            if (this.syncingLevelOneUi) return
            this.applyLevelOneVisibility(checked, 'h1-panel')
          })
        }
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

      // Format editor header
      const fmtHeader = el('div', 'inkchapter-format-header', editorSection)
      fmtHeader.textContent = `H${lv} 编号格式`

      // ── Format tags with insert slots ─────────────
      const fmtContainer = el('div', 'inkchapter-format-container', editorSection)
      const fmtEl = el('div', 'inkchapter-format-chips', fmtContainer)

      // Get active format variant for current H1 visibility
      const activeFmt = getActiveFormatVariant(style, s.showLevelOneNumber, lv)

      // Container-level pointer delegation (disabled for H1 when hidden)
      if (!isH1Disabled) {
        this.setupDragDelegation(fmtEl, lv, style)
      }

      // Insert slot at start
      this.renderInsertSlot(fmtEl, 0, lv, activeFmt, isH1Disabled)

      for (let i = 0; i < activeFmt.length; i++) {
        const seg = activeFmt[i]
        if (seg.type === 'level-reference') {
          this.renderLevelRefChip(fmtEl, i, seg, lv, activeFmt, isH1Disabled)
        } else {
          this.renderLiteralChip(fmtEl, i, seg, lv, activeFmt, isH1Disabled)
        }
        this.renderInsertSlot(fmtEl, i + 1, lv, activeFmt, isH1Disabled)
      }

      // ── Insert controls ───────────────────────────
      if (!isH1Disabled) {
        const insertRow = el('div', 'inkchapter-format-insert-row', editorSection)

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
            const cur = getActiveFormatVariant(style, s.showLevelOneNumber, lv)
            const newFmt = [...cur, { type: 'literal' as const, value: sanitize(val) }]
            this.numberingService.updateActiveFormat(lv, newFmt)
            this.onshow()
          }
        }
        const textWrap = el('div', undefined, insertRow)
        textWrap.style.cssText = 'display:flex;align-items:center;gap:4px;'
        textWrap.appendChild(textInput)
        textWrap.appendChild(textBtn)

        // Insert level reference
        const levelSelect = el('select', undefined, insertRow) as HTMLSelectElement
        levelSelect.style.cssText = 'margin-left:12px;'
        const availRefs = getAvailableReferenceLevels(lv, s.showLevelOneNumber)
        if (availRefs.length === 0) {
          const opt = document.createElement('option')
          opt.value = ''
          opt.textContent = '无可用上级级别'
          opt.disabled = true
          levelSelect.appendChild(opt)
        } else {
          for (const refLv of availRefs) {
            const opt = document.createElement('option')
            opt.value = String(refLv)
            opt.textContent = `[级别${refLv}]`
            levelSelect.appendChild(opt)
          }
        }
        const refBtn = el('button', 'inkchapter-format-insert-btn', insertRow)
        refBtn.textContent = '插入引用'
        refBtn.onclick = () => {
          const refLv = Number(levelSelect.value) as HeadingLevel
          if (!refLv || refLv < 1 || refLv > 6) return
          const cur = getActiveFormatVariant(style, s.showLevelOneNumber, lv)
          const newFmt = [...cur, { type: 'level-reference' as const, level: refLv }]
          this.numberingService.updateActiveFormat(lv, newFmt)
          this.onshow()
        }
      }

      // ── Current level settings ────────────────────
      const settingsSection = el('div', 'inkchapter-editor-settings', editorSection)
      const settingsTitle = el('div', 'inkchapter-format-header', settingsSection)
      settingsTitle.textContent = '当前级设置'

      // Enable toggle (skip for H1 — uses showLevelOneNumber instead)
      if (lv > 1) {
        this.addCustomCheckbox(settingsSection, '启用本级编号', style.enabled, (checked) => {
          this.numberingService.updateLevelStyle(lv, { enabled: checked })
          this.onshow()
        })
      }

      this.addCustomSelect(settingsSection, '编号样式', TOKEN_STYLE_LABELS, style.tokenStyle, (val) => {
        this.numberingService.updateLevelStyle(lv, { tokenStyle: val as NumberTokenStyle })
        this.onshow()
      }, isH1Disabled)

      this.addCustomNumber(settingsSection, '起始编号', style.startAt, 1, 999, (val) => {
        this.numberingService.updateLevelStyle(lv, { startAt: val })
        this.onshow()
      }, isH1Disabled)

      if (lv > 1) {
        this.addCustomSelect(settingsSection, '在哪个上级后重新开始', buildRestartOptions(lv), String(style.restartAfterLevel ?? ''), (val) => {
          const parsed = val === '' ? null : Number(val) as HeadingLevel
          this.numberingService.updateLevelStyle(lv, { restartAfterLevel: parsed } as any)
          this.onshow()
        })
      }

      this.addCustomCheckbox(settingsSection, '将父级编号转换为阿拉伯数字', style.legalStyle, (checked) => {
        this.numberingService.updateLevelStyle(lv, { legalStyle: checked })
        this.onshow()
      }, isH1Disabled)

      // Format summary
      const summary = el('div', 'inkchapter-advanced-summary', settingsSection)
      const effFmt = getEffectiveFormatForLevel(activeFmt, !s.showLevelOneNumber, lv)
      summary.textContent = formatSummary(effFmt, style.tokenStyle)
    }
  }

  // ── Drag: container delegation ───────────────────

  private setupDragDelegation(
    fmtEl: HTMLElement,
    lv: HeadingLevel,
    style: import('../heading-numbering/heading-types').HeadingLevelStyle,
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
      this.onDragStart(fmtEl, idx, e.clientX, e.clientY)
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.dragState) {
        this.cancelDrag('Escape')
      }
    }
    fmtEl.addEventListener('keydown', onKey)
  }

  private onDragStart(container: HTMLElement, idx: number, clientX: number, clientY: number): void {
    if (this.dragState) this.cancelDrag('re-drag')

    this.dragState = createDragState(idx, clientX, clientY)

    const lv = (container as any).__dragLevel as HeadingLevel
    const style = (container as any).__dragStyle as import('../heading-numbering/heading-types').HeadingLevelStyle

    const onMove = (e: PointerEvent) => this.onDragMove(container, e.clientX, e.clientY)
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      this.onDragEnd(container, lv, style)
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

    if (DEBUG_DRAG) console.log('[Drag] start idx=' + idx)
  }

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

      if (DEBUG_DRAG) console.log('[Drag] threshold passed, dragging=' + ds.draggingIndex)
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

  private onDragEnd(
    container: HTMLElement,
    lv: HeadingLevel,
    style: import('../heading-numbering/heading-types').HeadingLevelStyle,
  ): void {
    if (!this.dragState) return
    const ds = this.dragState

    if (!ds.isDragging) {
      this.cancelDrag('no-move')
      return
    }

    const s = this.headingSettings
    const before = [...getActiveFormatVariant(style, s.showLevelOneNumber, lv)]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    const hiddenLevels = new Set<HeadingLevel>()
    if (!s.showLevelOneNumber) hiddenLevels.add(1 as HeadingLevel)

    const after = normalizeFormatAfterDrag(moved, lv, hiddenLevels)

    if (DEBUG_DRAG) {
      const remaining = before.filter((_, i) => i !== draggingIdx)
      const log = createDebugLog(draggingIdx, remaining, targetIdx, before, after, true)
      console.log('[Drag] commit', log)
    }

    this.cancelDrag('commit')

    this.numberingService.updateActiveFormat(lv, after)
    this.onshow()
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

  private addCustomSelect(
    container: HTMLElement, label: string,
    options: { value: string; label: string }[],
    value: string, onChange: (val: string) => void,
    disabled = false,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const select = document.createElement('select')
    select.disabled = disabled
    for (const opt of options) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      o.selected = opt.value === value
      select.appendChild(o)
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
    .slice(0, 16)
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

function formatSummary(format: readonly NumberFormatSegment[], tokenStyle?: string): string {
  if (!format || format.length === 0) return '（默认格式）'
  const parts = format.map(seg => {
    if (seg.type === 'literal') return seg.value || '(空)'
    return `[L${seg.level}]`
  })
  return parts.join('') + (tokenStyle ? ` · ${tokenStyle}` : '')
}
