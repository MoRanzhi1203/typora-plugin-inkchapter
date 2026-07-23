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
  formatSegmentsToString,
} from '../heading-numbering/format-drag-utils'
import type { DragState } from '../heading-numbering/format-drag-utils'
import { computeHeadingNumbering, getAvailableReferenceLevels, getEffectiveFormatForLevel } from '../heading-numbering/numbering-engine'
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

const DRAG_THRESHOLD = 4 // px, Euclidean distance to start dragging
const DEBUG_DRAG = false // Set true for verbose drag logs

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private previewEl: HTMLElement | null = null
  private miniPreviewEls: Map<number, HTMLElement> = new Map()
  private expandedLevel: HeadingLevel | null = null
  private selectEl: HTMLSelectElement | null = null

  // ── Pointer-based drag state ──────────────────────
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

  /** Clean up drag state when settings tab is closed. */
  onhide(): void {
    this.cancelDrag()
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

    // Show level one toggle (H1 开关)
    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时 H1 不显示编号，H2 从 1 开始计数，不暴露隐藏的 H1 编号路径。')
      setting.addCheckbox((cb) => {
        cb.checked = s.showLevelOneNumber
        cb.onclick = () => {
          const current = { ...this.settings.get('headingNumbering') }
          current.showLevelOneNumber = cb.checked
          this.settings.set('headingNumbering', current)
          this.numberingService.setShowLevelOneNumber(cb.checked)
          this.refreshUI()
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
    // Create preview element BEFORE addDescription so updatePreview can use it
    this.previewEl = el('div', 'inkchapter-preview')
    this.addSetting((setting) => {
      setting.addName('预览')
      setting.addDescription((descDiv) => {
        descDiv.appendChild(this.previewEl!)
      })
    })
    // Now previewEl is already set, safe to update
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

  // ── Preview (unified formatter: uses same engine as document) ──

  private updatePreview(): void {
    if (!this.previewEl) return
    this.previewEl.textContent = ''

    const s = this.headingSettings
    if (!s?.levels) return

    if (!s.enabled) {
      // Total switch off: show disabled message
      const disabledMsg = el('div', 'inkchapter-preview-disabled', this.previewEl)
      disabledMsg.textContent = '标题编号当前已关闭'
      // Also show sample H1-H6 without numbers
      for (const lv of HEADING_LEVELS) {
        const row = el('div', 'inkchapter-preview-row', this.previewEl)
        const label = el('span', 'inkchapter-preview-label', row)
        label.textContent = `H${lv} `
        const token = el('span', 'inkchapter-preview-token', row)
        token.textContent = `${lv}级标题示例`
      }
      return
    }

    // Generate synthetic headings [H1, H2, ..., H6] to feed the document engine
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

      // H1 hidden: keep row but without number
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

  /** Shared by card click and dropdown change. */
  private handlePresetSelect(preset: HeadingNumberingPreset): void {
    this.cancelDrag()
    this.numberingService.applyPreset(preset)
    // Sync dropdown
    if (this.selectEl) {
      this.selectEl.value = preset
    }
    // Re-render (rebuilds cards highlight + custom panels)
    this.onshow()
  }

  /** Render Word-style editor: left level list + right preview + bottom format editor. */
  private renderCustomPanels(s: HeadingNumberingSettings): void {
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

      const editorSection = el('div', 'inkchapter-editor-bottom')
      this.containerEl.appendChild(editorSection)

      // H1 notice
      if (lv === 1) {
        const h1Notice = el('div', 'inkchapter-custom-h1-notice', editorSection)
        h1Notice.textContent = s.showLevelOneNumber
          ? 'H1 是否显示编号由上方「一级标题显示编号」控制。'
          : '当前编号已隐藏'
      }

      // Format editor header
      const fmtHeader = el('div', 'inkchapter-format-header', editorSection)
      fmtHeader.textContent = `H${lv} 编号格式`

      // ── Format tags with insert slots ─────────────
      const fmtContainer = el('div', 'inkchapter-format-container', editorSection)
      const fmtEl = el('div', 'inkchapter-format-chips', fmtContainer)

      // ── Container-level pointer delegation ──────────
      this.setupDragDelegation(fmtEl, lv, style)

      // Insert slot at start
      this.renderInsertSlot(fmtEl, 0, lv, style)

      for (let i = 0; i < style.format.length; i++) {
        const seg = style.format[i]
        if (seg.type === 'level-reference') {
          this.renderLevelRefChip(fmtEl, i, seg, lv, style)
        } else {
          this.renderLiteralChip(fmtEl, i, seg, lv, style)
        }
        // Insert slot after each segment
        this.renderInsertSlot(fmtEl, i + 1, lv, style)
      }

      // ── Insert controls ───────────────────────────
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
          const newFmt = [...style.format, { type: 'literal' as const, value: sanitize(val) }]
          this.numberingService.updateLevelStyle(lv, { format: newFmt } as any)
          this.onshow()
        }
      }
      // Put both in a wrapper
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
        const newFmt = [...style.format, { type: 'level-reference' as const, level: refLv }]
        this.numberingService.updateLevelStyle(lv, { format: newFmt } as any)
        this.onshow()
      }

      // ── Current level settings ────────────────────
      const settingsSection = el('div', 'inkchapter-editor-settings', editorSection)
      const settingsTitle = el('div', 'inkchapter-format-header', settingsSection)
      settingsTitle.textContent = '当前级设置'

      if (lv > 1) {
        this.addCustomCheckbox(settingsSection, '启用本级编号', style.enabled, (checked) => {
          this.numberingService.updateLevelStyle(lv, { enabled: checked })
          this.onshow()
        })
      }

      this.addCustomSelect(settingsSection, '编号样式', TOKEN_STYLE_LABELS, style.tokenStyle, (val) => {
        this.numberingService.updateLevelStyle(lv, { tokenStyle: val as NumberTokenStyle })
        this.onshow()
      })

      this.addCustomNumber(settingsSection, '起始编号', style.startAt, 1, 999, (val) => {
        this.numberingService.updateLevelStyle(lv, { startAt: val })
        this.onshow()
      })

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
      })

      // Format summary (uses effective format so hidden references don't appear)
      const summary = el('div', 'inkchapter-advanced-summary', settingsSection)
      const effFmt = getEffectiveFormatForLevel(style.format, !s.showLevelOneNumber, lv)
      summary.textContent = formatSummary(effFmt, style.tokenStyle)
    }
  }

  // ── Drag: container delegation ───────────────────

  /**
   * Set up pointer-event-based drag on the format chips container.
   * Uses event delegation: one pointerdown on the container,
   * document-level pointermove/pointerup/pointercancel during drag.
   */
  private setupDragDelegation(
    fmtEl: HTMLElement,
    lv: HeadingLevel,
    style: import('../heading-numbering/heading-types').HeadingLevelStyle,
  ): void {
    // Store level/style on container for access during drag callbacks
    ;(fmtEl as any).__dragLevel = lv
    ;(fmtEl as any).__dragStyle = style

    fmtEl.addEventListener('pointerdown', (e: PointerEvent) => {
      // Only primary button
      if (e.button !== 0) return

      // Exclude close buttons and insert slots
      const target = e.target as HTMLElement
      if (target.closest('.inkchapter-format-chip-close')) return
      if (target.closest('.inkchapter-format-slot')) return
      if (target.closest('input, select, button')) return

      // Find the chip that was clicked
      const chip = target.closest('[data-format-index]') as HTMLElement | null
      if (!chip) return

      const idx = Number(chip.getAttribute('data-format-index'))
      if (isNaN(idx) || idx < 0) return

      e.preventDefault()
      this.onDragStart(fmtEl, idx, e.clientX, e.clientY)
    })

    // Escape key handler (on container or window)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.dragState) {
        this.cancelDrag('Escape')
      }
    }
    fmtEl.addEventListener('keydown', onKey)
  }

  // ── Drag: pointer lifecycle ──────────────────────

  private onDragStart(container: HTMLElement, idx: number, clientX: number, clientY: number): void {
    if (this.dragState) this.cancelDrag('re-drag')

    const lv = (container as any).__dragLevel as HeadingLevel
    const style = (container as any).__dragStyle as import('../heading-numbering/heading-types').HeadingLevelStyle

    this.dragState = createDragState(idx, clientX, clientY)

    // Register document-level listeners
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

    // Not yet dragging — check threshold
    if (!ds.isDragging) {
      const dist = Math.hypot(clientX - ds.startX, clientY - ds.startY)
      if (dist < DRAG_THRESHOLD) return
      ds.isDragging = true

      // Add visual state
      container.style.userSelect = 'none'
      container.style.cursor = 'grabbing'
      const chip = container.querySelector(`[data-format-index="${ds.draggingIndex}"]`) as HTMLElement | null
      if (chip) {
        chip.classList.add('inkchapter-format-chip--dragging')
      }

      if (DEBUG_DRAG) console.log('[Drag] threshold passed, dragging=' + ds.draggingIndex)
    }

    // RAF throttle
    if (ds.rafId !== null) return
    ds.rafId = requestAnimationFrame(() => {
      ds.rafId = null
      if (!this.dragState) return

      const target = calculateTargetIndexAfterRemoval(
        container,
        clientX,
        clientY,
        ds.draggingIndex,
      )
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
      // Was just a click, no movement
      this.cancelDrag('no-move')
      return
    }

    const before = [...style.format]
    const draggingIdx = ds.draggingIndex
    const targetIdx = ds.targetIndexAfterRemoval

    // No-op if same position
    if (targetIdx === draggingIdx) {
      this.cancelDrag('same-position')
      return
    }

    // ── Commit the move ────────────────────────────
    const moved = moveSegmentToResolvedIndex(before, draggingIdx, targetIdx)

    // Build hidden levels set
    const s = this.headingSettings
    const hiddenLevels = new Set<HeadingLevel>()
    if (!s.showLevelOneNumber) hiddenLevels.add(1 as HeadingLevel)

    const after = normalizeFormatAfterDrag(moved, lv, hiddenLevels)

    if (DEBUG_DRAG) {
      const remaining = before.filter((_, i) => i !== draggingIdx)
      const log = createDebugLog(draggingIdx, remaining, targetIdx, before, after, true)
      console.log('[Drag] commit', log)
    }

    // Clean up drag state first (before re-render destroys DOM)
    this.cancelDrag('commit')

    // Persist via service — this will update editor and settings
    this.numberingService.updateLevelStyle(lv, { format: after } as any)
    // Re-render format editor
    this.onshow()
  }

  // ── Drag: cancel ─────────────────────────────────

  private cancelDrag(reason?: string): void {
    if (!this.dragState) return
    const ds = this.dragState

    if (DEBUG_DRAG && reason) console.log('[Drag] cancel reason=' + reason)

    // Cancel RAF
    if (ds.rafId !== null) {
      cancelAnimationFrame(ds.rafId)
      ds.rafId = null
    }

    // Remove drag visual classes (container may not exist anymore)
    const containers = this.containerEl.querySelectorAll('.inkchapter-format-chips')
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i] as HTMLElement
      c.style.userSelect = ''
      c.style.cursor = ''
      const draggingChip = c.querySelector('.inkchapter-format-chip--dragging') as HTMLElement | null
      if (draggingChip) draggingChip.classList.remove('inkchapter-format-chip--dragging')
    }

    // Remove drop indicators
    const indicators = this.containerEl.querySelectorAll('.inkchapter-format-drop-indicator')
    for (let i = 0; i < indicators.length; i++) {
      indicators[i].remove()
    }

    // Remove document listeners
    for (const fn of ds.cleanupFns) {
      try { fn() } catch { /* ignore */ }
    }

    this.dragState = null
  }

  // ── Drag: visual indicator ───────────────────────

  private updateDropIndicator(container: HTMLElement, targetIndexAfterRemoval: number): void {
    // Remove existing indicator
    const existing = container.querySelectorAll('.inkchapter-format-drop-indicator')
    for (let i = 0; i < existing.length; i++) existing[i].remove()

    // Insert a vertical bar indicator at the correct position
    // targetIndexAfterRemoval is the position in the remaining array
    // We insert the indicator element into the container's DOM flow at the right place
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
      // After the last remaining chip
      const last = remaining[remaining.length - 1]
      last.insertAdjacentElement('afterend', indicator)
    } else {
      // Before remaining[targetIndexAfterRemoval]
      remaining[targetIndexAfterRemoval].insertAdjacentElement('beforebegin', indicator)
    }
  }

  // ── Chip rendering ─────────────────────────────

  private renderInsertSlot(fmtEl: HTMLElement, insertIdx: number, lv: HeadingLevel, style: import('../heading-numbering/heading-types').HeadingLevelStyle): void {
    const slot = el('div', 'inkchapter-format-slot', fmtEl)
    slot.setAttribute('data-insert-index', String(insertIdx))
    slot.onclick = (e) => {
      e.stopPropagation()
      const action = prompt('输入要插入的文字 (或留空取消):')
      if (action) {
        const newFmt = [...style.format]
        newFmt.splice(insertIdx, 0, { type: 'literal' as const, value: sanitize(action) })
        this.numberingService.updateLevelStyle(lv, { format: newFmt } as any)
        this.onshow()
      }
    }
  }

  private renderLevelRefChip(fmtEl: HTMLElement, idx: number, seg: { type: 'level-reference'; level: number }, lv: HeadingLevel, style: import('../heading-numbering/heading-types').HeadingLevelStyle): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = `[级别${seg.level}]`
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'level-reference')
    chip.setAttribute('data-segment-level', String(seg.level))

    // Close button (hidden for current-level chip)
    if (seg.level !== lv) {
      const close = el('span', 'inkchapter-format-chip-close', chip)
      close.textContent = ' ×'
      close.onclick = (e) => {
        e.stopPropagation()
        const newFmt = style.format.filter((_, i) => i !== idx)
        this.numberingService.updateLevelStyle(lv, { format: newFmt } as any)
        this.onshow()
      }
    }
  }

  private renderLiteralChip(fmtEl: HTMLElement, idx: number, seg: { type: 'literal'; value: string }, lv: HeadingLevel, style: import('../heading-numbering/heading-types').HeadingLevelStyle): void {
    const chip = el('div', 'inkchapter-format-chip', fmtEl)
    chip.textContent = seg.value || '(空)'
    chip.setAttribute('data-format-index', String(idx))
    chip.setAttribute('data-segment-type', 'literal')

    const close = el('span', 'inkchapter-format-chip-close', chip)
    close.textContent = ' ×'
    close.onclick = (e) => {
      e.stopPropagation()
      const newFmt = style.format.filter((_, i) => i !== idx)
      this.numberingService.updateLevelStyle(lv, { format: newFmt } as any)
      this.onshow()
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

      // H1 hidden: keep row but without number
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
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    cb.onchange = () => onChange(cb.checked)
    row.appendChild(cb)
  }

  private addCustomSelect(
    container: HTMLElement, label: string,
    options: { value: string; label: string }[],
    value: string, onChange: (val: string) => void,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const select = document.createElement('select')
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

  private addCustomText(
    container: HTMLElement, label: string, value: string,
    onChange: (val: string) => void,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.style.width = '80px'
    let timer: ReturnType<typeof setTimeout> | null = null
    input.oninput = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => onChange(input.value), 300)
    }
    row.appendChild(input)
  }

  private addCustomNumber(
    container: HTMLElement, label: string, value: number,
    min: number, max: number,
    onChange: (val: number) => void,
  ): void {
    const row = el('div', 'inkchapter-custom-row', container)
    const span = el('span', 'inkchapter-custom-col-label', row)
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(value)
    input.min = String(min)
    input.max = String(max)
    input.style.width = '80px'
    // Apply only on blur/Enter, not on every keystroke
    input.onblur = () => {
      const n = parseInt(input.value, 10)
      if (!isNaN(n) && n >= min && n <= max) {
        onChange(n)
      } else {
        // Reset to current valid value
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

function buildAdvancedSummary(style: HeadingLevelStyle): string {
  const parts: string[] = []
  if (style.startAt !== 1) parts.push(`起始编号=${style.startAt}`)
  if (style.restartAfterLevel != null) parts.push(`在 H${style.restartAfterLevel} 后重启`)
  else parts.push('全文连续编号')
  if (style.legalStyle) parts.push('父级阿拉伯数字')
  return parts.join(' · ')
}

function formatSummary(format: readonly NumberFormatSegment[], tokenStyle?: string): string {
  if (!format || format.length === 0) return '（默认格式）'
  const parts = format.map(seg => {
    if (seg.type === 'literal') return seg.value || '(空)'
    return `[L${seg.level}]`
  })
  return parts.join('') + (tokenStyle ? ` · ${tokenStyle}` : '')
}
