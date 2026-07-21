import { SettingTab } from '@typora-community-plugin/core'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings-model'
import type {
  HeadingLevel,
  HeadingLevelDefinition,
  HeadingLevelPosition,
  HeadingNumberingSettings,
  NumberFormatSegment,
  NumberTokenStyle,
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS } from '../heading-numbering/heading-types'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'
import {
  PRESET_LIST,
  deepCloneLevels,
  formatSegmentsToString,
  buildCustomDefault,
  normalizeFormatSegments,
} from '../heading-numbering/presets'
import { formatToken, isValidTokenStyle } from '../heading-numbering/token-formatter'
import { getAvailableReferenceLevels } from '../heading-numbering/numbering-engine'

// ── Constants ────────────────────────────────────────────

const TOKEN_STYLE_LABELS: Record<NumberTokenStyle, string> = {
  'arabic': '阿拉伯数字 (1, 2, 3)',
  'chinese': '中文数字 (一, 二, 三)',
  'chinese-financial': '中文大写 (壹, 贰, 叁)',
  'roman-upper': '大写罗马 (I, II, III)',
  'roman-lower': '小写罗马 (i, ii, iii)',
  'alpha-upper': '大写字母 (A, B, C)',
  'alpha-lower': '小写字母 (a, b, c)',
  'circled': '圆圈数字 (①, ②, ③)',
}

const CSS_PREFIX = 'inkchapter-mll'

const RESTART_LABELS: Record<string, string> = {
  'null': '不重新开始',
  '1': '在级别 1 之后重新开始',
  '2': '在级别 2 之后重新开始',
  '3': '在级别 3 之后重新开始',
  '4': '在级别 4 之后重新开始',
  '5': '在级别 5 之后重新开始',
  '6': '在级别 6 之后重新开始',
}

const ALIGNMENT_LABELS: Record<string, string> = {
  'left': '左对齐',
  'center': '居中',
  'right': '右对齐',
}

const FOLLOW_LABELS: Record<string, string> = {
  'tab': '制表符 (Tab)',
  'space': '空格',
  'nothing': '不添加',
}

// ── Helper ───────────────────────────────────────────────

function el(tag: string, cls?: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (parent) parent.appendChild(e)
  return e
}

// ── SettingTab ───────────────────────────────────────────

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private readonly settings: PluginSettings<InkChapterSettings>
  private readonly numberingService: HeadingNumberingService

  private selectedLevel: HeadingLevel = 1
  private presetCardsContainer: HTMLElement | null = null
  private levelSelectorPanel: HTMLElement | null = null
  private formatEditorContainer: HTMLElement | null = null
  private levelSettingsContainer: HTMLElement | null = null
  private positionContainer: HTMLElement | null = null
  private previewContainer: HTMLElement | null = null
  private actionsContainer: HTMLElement | null = null
  private insertIndex: number = 0
  private selectedSegmentIndex: number | null = null
  private customPanel: HTMLElement | null = null

  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSettings: HeadingNumberingSettings | null = null

  constructor(
    settings: PluginSettings<InkChapterSettings>,
    numberingService: HeadingNumberingService,
  ) {
    super()
    this.settings = settings
    this.numberingService = numberingService
  }

  // ── Lifecycle ──────────────────────────────────────────

  onshow(): void {
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild)
    }
    this.render()
  }

  onhide(): void {
    this.flushPendingSave()
  }

  // ── State ──────────────────────────────────────────────

  private get headingNumbering(): HeadingNumberingSettings {
    return this.settings.get('headingNumbering')
  }

  private get currentDefs(): Record<HeadingLevel, HeadingLevelDefinition> {
    return this.headingNumbering.customDefinition.levels
  }

  private getCurrentDef(level: HeadingLevel): HeadingLevelDefinition {
    return this.currentDefs[level]
  }

  // ── Persistence ────────────────────────────────────────

  private scheduleSave(settings: HeadingNumberingSettings): void {
    this.pendingSettings = settings
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const s = this.pendingSettings
      this.pendingSettings = null
      if (s) {
        this.settings.set('headingNumbering', s)
      }
    }, 200)
  }

  private flushPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.pendingSettings) {
      this.settings.set('headingNumbering', this.pendingSettings)
      this.pendingSettings = null
    }
  }

  // ── Render ─────────────────────────────────────────────

  private render(): void {
    const s = this.headingNumbering

    // ── Section: Enable toggle ───────────────────────────
    this.addSettingTitle('基础设置')

    this.addSetting((setting) => {
      setting.addName('启用标题编号')
      setting.addDescription('开启后自动为标题添加编号')
      setting.addCheckbox((cb) => {
        cb.checked = s.enabled
        cb.onclick = () => {
          this.numberingService.toggle()
          this.render()
        }
      })
    })

    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时一级标题不显示编号，二级标题从 1 开始')
      setting.addCheckbox((cb) => {
        cb.checked = s.showLevelOneNumber
        cb.onclick = () => {
          const wasEnabled = this.headingNumbering.showLevelOneNumber
          this.numberingService.setShowLevelOneNumber(cb.checked)
          // When H1 is toggled off, clean [级别1] refs from H2-H6
          if (wasEnabled && !cb.checked) {
            this.cleanHiddenLevelRefs()
          }
          // Update default formats when H1 vis changes
          if (!cb.checked && this.headingNumbering.preset === 'custom') {
            this.syncDefaultFormatsForVisibility(false)
          }
          this.render()
        }
      })
    })

    // ── Section: Preset Cards ────────────────────────────
    this.addSettingTitle('编号样式预设')

    const presetGrid = el('div', `${CSS_PREFIX}-preset-grid`)
    this.containerEl.appendChild(presetGrid)
    this.presetCardsContainer = presetGrid
    this.renderPresetCards()

    // ── Section: Custom Multilevel Editor ─────────────────
    // Always show the custom editor when preset is 'custom' or to edit custom settings
    this.customPanel = el('div', `${CSS_PREFIX}-custom-panel`)
    this.customPanel.style.display = s.preset === 'custom' ? '' : 'none'
    this.containerEl.appendChild(this.customPanel)

    if (s.preset === 'custom') {
      this.renderCustomEditor()
    }

    // ── Full Preview ─────────────────────────────────────
    this.addSettingTitle('实时预览')

    this.addSetting((setting) => {
      setting.addName('编号预览')
      setting.addDescription((container) => {
        this.previewContainer = container
        this.renderFullPreview()
      })
    })

    // ── Actions ──────────────────────────────────────────
    this.addSettingTitle('操作')

    this.addSetting((setting) => {
      setting.addName('恢复默认')
      setting.addDescription('将所有级别设置恢复为十进制层级默认值')
      setting.addButton((btn) => {
        btn.textContent = '恢复全部默认'
        btn.onclick = () => {
          if (confirm('确定要将所有自定义编号设置恢复为默认值吗？此操作不可撤销。')) {
            this.restoreAllDefaults()
          }
        }
      })
    })
  }

  // ── Preset Cards ───────────────────────────────────────

  private renderPresetCards(): void {
    const container = this.presetCardsContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const s = this.headingNumbering

    for (const preset of PRESET_LIST) {
      const card = el('div', `${CSS_PREFIX}-preset-card`, container)
      if (preset.key === s.preset) {
        card.classList.add(`${CSS_PREFIX}-preset-card--active`)
      }

      const header = el('div', `${CSS_PREFIX}-preset-card-header`, card)
      const nameEl = el('span', `${CSS_PREFIX}-preset-card-name`, header)
      nameEl.textContent = preset.name

      // Show preview numbers
      const previewRow = el('div', `${CSS_PREFIX}-preset-card-preview`, card)
      for (const lv of HEADING_LEVELS) {
        const label = preset.preview[lv]
        if (!label) continue
        const previewItem = el('span', `${CSS_PREFIX}-preset-card-preview-item`, previewRow)
        previewItem.textContent = label
      }

      const desc = el('div', `${CSS_PREFIX}-preset-card-desc`, card)
      desc.textContent = preset.description

      card.addEventListener('click', () => {
        this.numberingService.applyPreset(preset.key)
        this.render()
      })
    }

    // Custom card
    const customCard = el('div', `${CSS_PREFIX}-preset-card`, container)
    if (s.preset === 'custom') {
      customCard.classList.add(`${CSS_PREFIX}-preset-card--active`)
    }

    const customHeader = el('div', `${CSS_PREFIX}-preset-card-header`, customCard)
    const customName = el('span', `${CSS_PREFIX}-preset-card-name`, customHeader)
    customName.textContent = '自定义'

    const customDesc = el('div', `${CSS_PREFIX}-preset-card-desc`, customCard)
    customDesc.textContent = '自由定义每个级别的编号格式、样式与位置'

    customCard.addEventListener('click', () => {
      this.numberingService.applyPreset('custom')
      this.render()
    })
  }

  // ── Custom Editor ──────────────────────────────────────

  private renderCustomEditor(): void {
    const panel = this.customPanel
    if (!panel) return
    while (panel.firstChild) panel.removeChild(panel.firstChild)

    // ── Top row: Level Selector + Full Preview ───────────
    const topRow = el('div', `${CSS_PREFIX}-top-row`, panel)

    // Level Selector (left column)
    const levelPanel = el('div', `${CSS_PREFIX}-level-selector`, topRow)
    this.levelSelectorPanel = levelPanel
    this.renderLevelSelector()

    // Full Preview (right column)
    const previewPanel = el('div', `${CSS_PREFIX}-preview-panel`, topRow)
    this.renderFullMultilevelPreview(previewPanel)

    // ── Format Editor ────────────────────────────────────
    const formatSection = el('div', `${CSS_PREFIX}-section`, panel)
    const formatTitle = el('div', `${CSS_PREFIX}-section-title`, formatSection)
    formatTitle.textContent = '编号格式'
    this.formatEditorContainer = el('div', `${CSS_PREFIX}-format-editor`, formatSection)
    this.renderFormatEditor()

    // ── Level Settings ───────────────────────────────────
    const settingsSection = el('div', `${CSS_PREFIX}-section`, panel)
    const settingsTitle = el('div', `${CSS_PREFIX}-section-title`, settingsSection)
    settingsTitle.textContent = '当前级别设置'
    this.levelSettingsContainer = el('div', `${CSS_PREFIX}-level-settings`, settingsSection)
    this.renderLevelSettings()

    // ── Position Settings (collapsible) ──────────────────
    const posSection = el('div', `${CSS_PREFIX}-section`, panel)
    this.positionContainer = el('div', `${CSS_PREFIX}-position-settings`, posSection)
    this.renderPositionSettings()

    // ── Per-level actions ────────────────────────────────
    this.actionsContainer = el('div', `${CSS_PREFIX}-actions`, panel)
    this.renderActions()
  }

  // ── Level Selector ─────────────────────────────────────

  private renderLevelSelector(): void {
    const container = this.levelSelectorPanel
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const skipH1 = !this.headingNumbering.showLevelOneNumber

    const title = el('div', `${CSS_PREFIX}-level-selector-title`, container)
    title.textContent = '选择级别'

    const listbox = el('div', `${CSS_PREFIX}-level-listbox`, container)
    listbox.setAttribute('role', 'listbox')
    listbox.setAttribute('aria-label', '选择要修改的标题级别')
    listbox.tabIndex = 0

    for (const lv of HEADING_LEVELS) {
      const option = el('div', `${CSS_PREFIX}-level-option`, listbox)
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', lv === this.selectedLevel ? 'true' : 'false')
      option.dataset.level = String(lv)

      if (lv === this.selectedLevel) {
        option.classList.add(`${CSS_PREFIX}-level-option--active`)
      }

      const label = el('span', `${CSS_PREFIX}-level-option-label`, option)
      label.textContent = `级别 ${lv}`

      if (skipH1 && lv === 1) {
        const badge = el('span', `${CSS_PREFIX}-level-option-badge`, option)
        badge.textContent = '已关闭'
      }

      option.addEventListener('click', () => {
        this.selectLevel(lv)
      })
    }

    listbox.addEventListener('keydown', (e) => {
      const idx = HEADING_LEVELS.indexOf(this.selectedLevel)
      if (e.key === 'ArrowDown' && idx < HEADING_LEVELS.length - 1) {
        e.preventDefault()
        this.selectLevel(HEADING_LEVELS[idx + 1])
      } else if (e.key === 'ArrowUp' && idx > 0) {
        e.preventDefault()
        this.selectLevel(HEADING_LEVELS[idx - 1])
      }
    })
  }

  private selectLevel(level: HeadingLevel): void {
    this.selectedLevel = level
    this.insertIndex = this.currentDefs[level]?.format?.length ?? 0
    this.selectedSegmentIndex = null
    this.renderLevelSelector()
    this.renderFormatEditor()
    this.renderLevelSettings()
    this.renderPositionSettings()
    this.renderActions()
  }

  // ── Format Editor ──────────────────────────────────────

  private renderFormatEditor(): void {
    const container = this.formatEditorContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const skipH1 = !this.headingNumbering.showLevelOneNumber
    const def = this.getCurrentDef(this.selectedLevel)
    const isH1Disabled = skipH1 && this.selectedLevel === 1

    // Readonly format string display
    const formatStr = formatSegmentsToString(def.format)

    const displayRow = el('div', `${CSS_PREFIX}-format-display`, container)
    const displayLabel = el('span', `${CSS_PREFIX}-format-display-label`, displayRow)
    displayLabel.textContent = '格式：'
    const displayValue = el('span', `${CSS_PREFIX}-format-display-value`, displayRow)
    displayValue.textContent = formatStr || '(空)'

    if (isH1Disabled) {
      const hint = el('div', `${CSS_PREFIX}-format-hint`, container)
      hint.textContent = '一级标题编号已关闭，无法编辑格式。'
      hint.style.color = '#999'
      hint.style.fontStyle = 'italic'
      return
    }

    // Segments list with insert slots
    const segmentsList = el('div', `${CSS_PREFIX}-format-segments`, container)
    this.renderFormatSegments(segmentsList, def)

    // Insert controls
    const insertRow = el('div', `${CSS_PREFIX}-format-insert-row`, container)

    // Insert literal
    const literalInput = document.createElement('input')
    literalInput.type = 'text'
    literalInput.placeholder = '输入文字...'
    literalInput.style.width = '100px'
    literalInput.style.marginRight = '8px'

    const addLiteralBtn = document.createElement('button')
    addLiteralBtn.textContent = '插入文字'
    addLiteralBtn.onclick = () => {
      const val = literalInput.value
      if (val.length === 0) return
      this.insertAt({ type: 'literal' as const, value: val })
      literalInput.value = ''
    }

    insertRow.appendChild(literalInput)
    insertRow.appendChild(addLiteralBtn)

    // Insert level reference dropdown
    const insertRefRow = el('div', `${CSS_PREFIX}-format-insert-row`, container)
    const refLabel = el('span', undefined, insertRefRow)
    refLabel.textContent = '插入级别引用：'

    const refSelect = document.createElement('select')
    // Use shared getAvailableReferenceLevels that respects hidden levels
    const presentRefLevels = new Set(
      def.format
        .filter(s => s.type === 'level-reference')
        .map(s => (s as { type: 'level-reference'; level: HeadingLevel }).level),
    )
    const availableLevels = getAvailableReferenceLevels(
      this.selectedLevel,
      this.headingNumbering,
    ).filter(l => !presentRefLevels.has(l))
    if (availableLevels.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = this.selectedLevel > 1 ? '无可用上级级别' : '无可用级别'
      opt.disabled = true
      refSelect.appendChild(opt)
    } else {
      for (const lv of availableLevels) {
        const opt = document.createElement('option')
        opt.value = String(lv)
        opt.textContent = `级别 ${lv}`
        refSelect.appendChild(opt)
      }
      refSelect.style.marginLeft = '8px'
      refSelect.style.marginRight = '8px'

      const addRefBtn = document.createElement('button')
      addRefBtn.textContent = '添加'
      addRefBtn.onclick = () => {
        const lv = Number(refSelect.value) as HeadingLevel
        if (lv >= 1 && lv < this.selectedLevel) {
          this.insertAt({ type: 'level-reference' as const, level: lv })
        }
      }
      insertRefRow.appendChild(refSelect)
      insertRefRow.appendChild(addRefBtn)
    }

    // Selected segment controls
    if (this.selectedSegmentIndex !== null) {
      const selRow = el('div', `${CSS_PREFIX}-format-selected-controls`, container)
      selRow.style.marginTop = '8px'

      const selSeg = def.format[this.selectedSegmentIndex]
      const selLabel = el('span', undefined, selRow)
      selLabel.textContent = '选中: '
      const selValue = el('span', undefined, selRow)
      selValue.style.fontFamily = 'monospace'
      selValue.style.padding = '2px 6px'
      selValue.style.borderRadius = '3px'
      selValue.style.background = '#e8f0fe'
      if (selSeg.type === 'level-reference') {
        selValue.textContent = `级别${selSeg.level}`
      } else {
        selValue.textContent = `"${selSeg.value}"`
      }

      const isCurrentLevelToken =
        selSeg.type === 'level-reference' && selSeg.level === this.selectedLevel

      const moveLeftBtn = document.createElement('button')
      moveLeftBtn.textContent = '← 左移'
      moveLeftBtn.style.marginLeft = '8px'
      moveLeftBtn.disabled = this.selectedSegmentIndex === 0
      moveLeftBtn.onclick = () => {
        this.moveSegment(this.selectedSegmentIndex!, this.selectedSegmentIndex! - 1)
      }
      selRow.appendChild(moveLeftBtn)

      const moveRightBtn = document.createElement('button')
      moveRightBtn.textContent = '右移 →'
      moveRightBtn.style.marginLeft = '4px'
      moveRightBtn.disabled = this.selectedSegmentIndex === def.format.length - 1
      moveRightBtn.onclick = () => {
        this.moveSegment(this.selectedSegmentIndex!, this.selectedSegmentIndex! + 1)
      }
      selRow.appendChild(moveRightBtn)

      if (!isCurrentLevelToken) {
        const delBtn = document.createElement('button')
        delBtn.textContent = '删除'
        delBtn.style.marginLeft = '8px'
        delBtn.style.color = '#d00'
        delBtn.onclick = () => {
          this.deleteSegment(this.selectedSegmentIndex!)
        }
        selRow.appendChild(delBtn)
      } else {
        const hint = el('span', undefined, selRow)
        hint.textContent = ' (当前级不能删除，但可以移动)'
        hint.style.color = '#999'
        hint.style.fontSize = '12px'
        hint.style.marginLeft = '4px'
      }
    }

    // Keyboard handling on the format editor container
    container.tabIndex = 0
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.selectedSegmentIndex = null
        this.renderFormatEditor()
        this.renderFullPreview()
        return
      }
      if (this.selectedSegmentIndex === null) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const seg = def.format[this.selectedSegmentIndex]
        const isCurrentToken =
          seg.type === 'level-reference' && seg.level === this.selectedLevel
        if (!isCurrentToken) {
          this.deleteSegment(this.selectedSegmentIndex)
        }
        return
      }

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        if (this.selectedSegmentIndex > 0) {
          this.moveSegment(this.selectedSegmentIndex, this.selectedSegmentIndex - 1)
        }
        return
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        if (this.selectedSegmentIndex < def.format.length - 1) {
          this.moveSegment(this.selectedSegmentIndex, this.selectedSegmentIndex + 1)
        }
        return
      }
    })
  }

  private renderFormatSegments(container: HTMLElement, def: HeadingLevelDefinition): void {
    container.style.display = 'flex'
    container.style.flexWrap = 'wrap'
    container.style.gap = '4px'
    container.style.alignItems = 'center'
    container.style.marginBottom = '8px'

    const segments = def.format

    if (segments.length === 0) {
      // Still show an insert slot for empty format
      const slot = el('div', `${CSS_PREFIX}-format-insert-slot`, container)
      if (this.insertIndex === 0) {
        slot.classList.add(`${CSS_PREFIX}-format-insert-slot--active`)
      }
      slot.textContent = '+'
      slot.style.cursor = 'pointer'
      slot.addEventListener('click', () => {
        this.insertIndex = 0
        this.renderFormatEditor()
        this.renderFullPreview()
      })
      slot.addEventListener('dragover', (e) => { e.preventDefault() })
      slot.addEventListener('drop', (e) => {
        e.preventDefault()
        const dragIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '')
        if (!isNaN(dragIdx) && dragIdx >= 0 && dragIdx < segments.length) {
          this.moveSegment(dragIdx, 0)
        }
      })
      return
    }

    for (let i = 0; i <= segments.length; i++) {
      // Insert slot before each segment (and after last)
      if (i <= segments.length) {
        const slot = el('div', `${CSS_PREFIX}-format-insert-slot`, container)
        slot.dataset.slotIndex = String(i)
        slot.textContent = '+'
        slot.style.cursor = 'pointer'
        if (this.insertIndex === i) {
          slot.classList.add(`${CSS_PREFIX}-format-insert-slot--active`)
        }
        const slotPos = i
        slot.addEventListener('click', () => {
          this.insertIndex = slotPos
          this.renderFormatEditor()
          this.renderFullPreview()
        })
        slot.addEventListener('dragover', (e) => { e.preventDefault() })
        slot.addEventListener('drop', (e) => {
          e.preventDefault()
          const dragIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '')
          if (!isNaN(dragIdx) && dragIdx >= 0 && dragIdx < segments.length) {
            this.moveSegment(dragIdx, slotPos)
          }
        })
      }

      // Render the segment chip (skip for the last iteration which only adds the trailing slot)
      if (i >= segments.length) continue

      const seg = segments[i]
      const isCurrentLevel = seg.type === 'level-reference' && seg.level === this.selectedLevel
      const isParentRef = seg.type === 'level-reference' && seg.level < this.selectedLevel
      const isSelected = this.selectedSegmentIndex === i

      if (seg.type === 'level-reference') {
        const chip = el('span', `${CSS_PREFIX}-format-chip`, container)
        chip.textContent = `级别${seg.level}`
        chip.title = `标题 ${seg.level} 编号引用`
        chip.style.display = 'inline-block'
        chip.style.padding = '2px 8px'
        chip.style.borderRadius = '3px'
        chip.style.background = isCurrentLevel ? '#e8f0fe' : '#e8e8e8'
        chip.style.border = isSelected
          ? '2px solid #4a90d9'
          : `1px solid ${isCurrentLevel ? '#4a90d9' : '#ccc'}`
        chip.style.fontSize = '13px'
        chip.style.fontFamily = 'monospace'
        chip.style.cursor = 'pointer'
        chip.draggable = true

        if (isSelected) {
          chip.classList.add(`${CSS_PREFIX}-format-chip--selected`)
        }

        chip.addEventListener('click', () => {
          this.selectedSegmentIndex = i
          this.insertIndex = this.currentDefs[this.selectedLevel]?.format?.length ?? 0
          this.renderFormatEditor()
        })

        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', String(i))
        })
        chip.addEventListener('dragover', (e) => { e.preventDefault() })
        chip.addEventListener('drop', (e) => {
          e.preventDefault()
          const dragIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '')
          if (!isNaN(dragIdx) && dragIdx !== i && dragIdx >= 0 && dragIdx < segments.length) {
            this.moveSegment(dragIdx, i)
          }
        })

        if (isCurrentLevel) {
          // Current-level token: show dimmed "×" (not clickable)
          const delSpan = document.createElement('span')
          delSpan.textContent = ' ×'
          delSpan.style.color = '#bbb'
          delSpan.style.cursor = 'default'
          delSpan.title = '当前级别引用不可删除'
          chip.appendChild(delSpan)
        } else if (isParentRef) {
          // Parent-level token: clickable "×" delete
          const delBtn = document.createElement('span')
          delBtn.textContent = ' ×'
          delBtn.style.cursor = 'pointer'
          delBtn.style.color = '#999'
          delBtn.title = '删除此引用'
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            this.deleteSegment(i)
          })
          chip.appendChild(delBtn)
        }
      } else {
        // literal segment
        const chip = el('span', `${CSS_PREFIX}-format-chip-literal`, container)
        chip.style.display = 'inline-block'
        chip.style.padding = '2px 8px'
        chip.style.borderRadius = '3px'
        chip.style.background = '#fff3cd'
        chip.style.border = isSelected ? '2px solid #4a90d9' : '1px solid #ffc107'
        chip.style.fontSize = '13px'
        chip.style.fontFamily = 'monospace'
        chip.style.cursor = 'pointer'
        chip.draggable = true

        if (isSelected) {
          chip.classList.add(`${CSS_PREFIX}-format-chip--selected`)
        }

        chip.addEventListener('click', (e) => {
          // Don't trigger if clicking delete button
          if ((e.target as HTMLElement).closest('[data-delete]')) return
          this.selectedSegmentIndex = i
          this.insertIndex = this.currentDefs[this.selectedLevel]?.format?.length ?? 0
          this.renderFormatEditor()
        })

        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', String(i))
        })
        chip.addEventListener('dragover', (e) => { e.preventDefault() })
        chip.addEventListener('drop', (e) => {
          e.preventDefault()
          const dragIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '')
          if (!isNaN(dragIdx) && dragIdx !== i && dragIdx >= 0 && dragIdx < segments.length) {
            this.moveSegment(dragIdx, i)
          }
        })

        const textSpan = el('span', undefined, chip)
        textSpan.textContent = seg.value
        textSpan.style.cursor = 'pointer'
        textSpan.addEventListener('click', (e2) => {
          e2.stopPropagation()
          const input = document.createElement('input')
          input.type = 'text'
          input.value = seg.value
          input.style.width = '40px'
          input.style.fontSize = '13px'
          input.style.fontFamily = 'monospace'
          input.style.padding = '0 2px'
          input.style.border = '1px solid #4a90d9'
          input.style.borderRadius = '2px'

          while (chip.firstChild) chip.removeChild(chip.firstChild)
          chip.appendChild(input)
          input.focus()
          input.select()

          const commitEdit = () => {
            const newVal = input.value
            if (newVal.length === 0) {
              this.deleteSegment(i)
            } else {
              const newSegments = [...this.getCurrentDef(this.selectedLevel).format]
              ;(newSegments[i] as { type: 'literal'; value: string }).value = newVal
              this.applyFormatChange([...newSegments])
            }
          }

          input.addEventListener('blur', commitEdit)
          input.addEventListener('keydown', (e3) => {
            if (e3.key === 'Enter') {
              input.removeEventListener('blur', commitEdit)
              commitEdit()
            }
          })
        })

        // Delete button for literal
        const delBtn = document.createElement('span')
        delBtn.setAttribute('data-delete', 'true')
        delBtn.textContent = ' ×'
        delBtn.style.cursor = 'pointer'
        delBtn.style.color = '#999'
        delBtn.style.marginLeft = '2px'
        delBtn.title = '删除此文字'
        delBtn.addEventListener('click', (e2) => {
          e2.stopPropagation()
          this.deleteSegment(i)
        })
        chip.appendChild(delBtn)
      }
    }
  }

  private applyFormatChange(newSegments: readonly NumberFormatSegment[]): void {
    // Compute hidden levels from current settings
    const s = this.headingNumbering
    const hiddenLevels = new Set<HeadingLevel>()
    if (!s.showLevelOneNumber) hiddenLevels.add(1)
    // Also add any disabled levels
    for (const lv of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
      if (!s.customDefinition.levels[lv]?.enabled) hiddenLevels.add(lv)
    }

    // Normalize: removes hidden/future/duplicate refs, ensures self-ref exists,
    // cleans orphans, merges literals, sorts canonical formats ascending.
    const normalized = normalizeFormatSegments(
      newSegments,
      this.selectedLevel,
      hiddenLevels,
    )

    // Validate
    const error = this.validateSegments(normalized)
    if (error) {
      if (this.formatEditorContainer) {
        const errEl = el('div', `${CSS_PREFIX}-format-error`, this.formatEditorContainer)
        errEl.textContent = error
        errEl.style.color = '#d00'
        errEl.style.fontSize = '12px'
        errEl.style.marginTop = '4px'
      }
      return
    }

    this.numberingService.updateLevelStyle(this.selectedLevel, {
      format: normalized,
    })

    this.renderFormatEditor()
    this.renderFullPreview()
  }

  private validateSegments(segments: readonly NumberFormatSegment[]): string | null {
    // Current-level ref exists exactly once
    const selfRefs = segments.filter(
      s => s.type === 'level-reference' && s.level === this.selectedLevel,
    )
    if (selfRefs.length === 0) {
      return '格式必须包含当前级别的编号引用'
    }
    if (selfRefs.length > 1) {
      return '当前级别的编号引用出现多次'
    }

    // No refs to levels > selectedLevel
    const futureRefs = segments.filter(
      s => s.type === 'level-reference' && s.level > this.selectedLevel,
    )
    if (futureRefs.length > 0) {
      return '不能引用更高级别的编号'
    }

    // No refs to hidden/disabled levels
    for (const s of segments) {
      if (s.type === 'level-reference' && s.level !== this.selectedLevel) {
        const def2 = this.headingNumbering.customDefinition.levels[s.level]
        if (!def2 || !def2.enabled) {
          return `级别 ${s.level} 已禁用，不能在格式中引用`
        }
        if (s.level === 1 && !this.headingNumbering.showLevelOneNumber) {
          return `级别 1 当前已关闭，不能在后续级别中引用`
        }
      }
    }

    // No duplicate level refs
    const seenLevels = new Set<HeadingLevel>()
    for (const s of segments) {
      if (s.type === 'level-reference') {
        if (seenLevels.has(s.level)) {
          return `级别 ${s.level} 的引用重复出现`
        }
        seenLevels.add(s.level)
      }
    }

    // Literal values don't contain newlines or HTML tags
    for (const s of segments) {
      if (s.type === 'literal') {
        if (s.value.includes('\n') || s.value.includes('\r')) {
          return '文字段不能包含换行符'
        }
        if (/<[^>]+>/.test(s.value)) {
          return '文字段不能包含 HTML 标签'
        }
      }
    }

    // No refs to hidden/disabled levels
    const settings = this.headingNumbering
    for (const s of segments) {
      if (s.type === 'level-reference' && s.level !== this.selectedLevel) {
        const def = settings.customDefinition.levels[s.level]
        if (!def || !def.enabled) {
          return `级别 ${s.level} 已禁用，不能在格式中引用`
        }
        if (s.level === 1 && !settings.showLevelOneNumber) {
          return `级别 1 当前已关闭，不能在后续级别中引用`
        }
      }
    }

    return null
  }

  private insertAt(segment: NumberFormatSegment): void {
    const def = this.getCurrentDef(this.selectedLevel)
    const format = [...def.format]
    format.splice(this.insertIndex, 0, segment)
    this.applyFormatChange(format)
    this.insertIndex = this.insertIndex + 1
  }

  private moveSegment(fromIndex: number, toIndex: number): void {
    const def = this.getCurrentDef(this.selectedLevel)
    const format = [...def.format]
    const [seg] = format.splice(fromIndex, 1)
    format.splice(toIndex, 0, seg)
    this.applyFormatChange(format)
    this.selectedSegmentIndex = toIndex
  }

  private deleteSegment(index: number): void {
    const def = this.getCurrentDef(this.selectedLevel)
    const seg = def.format[index]
    if (seg && seg.type === 'level-reference' && seg.level === this.selectedLevel) {
      return // Cannot delete current-level token
    }
    const newSegments = def.format.filter((_, i) => i !== index)
    this.applyFormatChange(newSegments)
    this.selectedSegmentIndex = null
  }

  // ── Level Settings ─────────────────────────────────────

  private renderLevelSettings(): void {
    const container = this.levelSettingsContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const def = this.getCurrentDef(this.selectedLevel)

    // Number style
    const styleRow = el('div', `${CSS_PREFIX}-setting-row`, container)
    const styleLabel = el('span', `${CSS_PREFIX}-setting-label`, styleRow)
    styleLabel.textContent = '编号样式：'
    const styleSelect = document.createElement('select')
    for (const [val, label] of Object.entries(TOKEN_STYLE_LABELS)) {
      const opt = document.createElement('option')
      opt.value = val
      opt.textContent = label
      opt.selected = val === def.numberStyle
      styleSelect.appendChild(opt)
    }
    styleSelect.onchange = () => {
      if (isValidTokenStyle(styleSelect.value)) {
        this.applyLevelChange({ numberStyle: styleSelect.value })
      }
    }
    styleRow.appendChild(styleSelect)

    // Start at
    const startRow = el('div', `${CSS_PREFIX}-setting-row`, container)
    const startLabel = el('span', `${CSS_PREFIX}-setting-label`, startRow)
    startLabel.textContent = '起始值：'
    const startInput = document.createElement('input')
    startInput.type = 'number'
    startInput.min = '1'
    startInput.max = '9999'
    startInput.value = String(def.startAt)
    startInput.style.width = '70px'
    startInput.onchange = () => {
      const val = Math.max(1, Math.min(9999, parseInt(startInput.value) || 1))
      startInput.value = String(val)
      this.applyLevelChange({ startAt: val })
    }
    startRow.appendChild(startInput)

    // Restart after level
    const restartRow = el('div', `${CSS_PREFIX}-setting-row`, container)
    const restartLabel = el('span', `${CSS_PREFIX}-setting-label`, restartRow)
    restartLabel.textContent = '重新开始编号：'
    const restartSelect = document.createElement('select')
    const nullOpt = document.createElement('option')
    nullOpt.value = 'null'
    nullOpt.textContent = RESTART_LABELS['null']
    nullOpt.selected = def.restartAfterLevel === null
    restartSelect.appendChild(nullOpt)

    for (const lv of HEADING_LEVELS) {
      if (lv >= this.selectedLevel) continue // can only restart after parent levels
      const opt = document.createElement('option')
      opt.value = String(lv)
      opt.textContent = RESTART_LABELS[String(lv)]
      opt.selected = def.restartAfterLevel === lv
      restartSelect.appendChild(opt)
    }
    restartSelect.onchange = () => {
      const val = restartSelect.value === 'null' ? null : (Number(restartSelect.value) as HeadingLevel)
      this.applyLevelChange({ restartAfterLevel: val })
    }
    restartRow.appendChild(restartSelect)

    // Include level references from
    const includeRow = el('div', `${CSS_PREFIX}-setting-row`, container)
    const includeLabel = el('span', `${CSS_PREFIX}-setting-label`, includeRow)
    includeLabel.textContent = '包含的级别编号来自：'

    const parentLevelsInFormat = def.format
      .filter(s => s.type === 'level-reference' && s.level < this.selectedLevel)
      .map(s => (s as { type: 'level-reference'; level: HeadingLevel }).level)

    const includeSelect = document.createElement('select')
    const nullIncludeOpt = document.createElement('option')
    nullIncludeOpt.value = ''
    nullIncludeOpt.textContent = '-- 添加上级引用 --'
    nullIncludeOpt.disabled = true
    nullIncludeOpt.selected = true
    includeSelect.appendChild(nullIncludeOpt)

    for (const lv of HEADING_LEVELS) {
      if (lv >= this.selectedLevel) continue
      const alreadyInFormat = parentLevelsInFormat.includes(lv)
      const opt = document.createElement('option')
      opt.value = String(lv)
      opt.textContent = alreadyInFormat ? `✓ 级别 ${lv}（已包含）` : `级别 ${lv}`
      includeSelect.appendChild(opt)
    }

    includeSelect.onchange = () => {
      const lv = Number(includeSelect.value) as HeadingLevel
      if (lv >= 1 && lv < this.selectedLevel && !parentLevelsInFormat.includes(lv)) {
        this.insertAt({ type: 'level-reference' as const, level: lv })
      }
      includeSelect.value = ''
    }
    includeRow.appendChild(includeSelect)

    // Show current parent references
    if (parentLevelsInFormat.length > 0) {
      const parentsDisplay = el('div', `${CSS_PREFIX}-setting-row`, container)
      const parentsLabel = el('span', `${CSS_PREFIX}-setting-label`, parentsDisplay)
      parentsLabel.textContent = '当前包含上级：'
      const parentsText = el('span', undefined, parentsDisplay)
      parentsText.textContent = parentLevelsInFormat.map(l => `级别${l}`).join('、')
      parentsText.style.color = '#666'
    }

    // Legal style
    const legalRow = el('div', `${CSS_PREFIX}-setting-row`, container)
    const legalLabel = el('label', undefined, legalRow)
    legalLabel.style.display = 'flex'
    legalLabel.style.alignItems = 'center'
    legalLabel.style.gap = '6px'
    legalLabel.style.cursor = 'pointer'

    const legalCheckbox = document.createElement('input')
    legalCheckbox.type = 'checkbox'
    legalCheckbox.checked = def.legalStyle
    legalCheckbox.onchange = () => {
      this.applyLevelChange({ legalStyle: legalCheckbox.checked })
    }
    legalLabel.appendChild(legalCheckbox)

    const legalText = el('span', undefined, legalLabel)
    legalText.textContent = '正规样式编号 (Legal Style)'
    legalRow.appendChild(legalLabel)

    const legalDesc = el('div', `${CSS_PREFIX}-setting-desc`, container)
    legalDesc.textContent = '开启后，上级编号引用将强制使用阿拉伯数字，不受上级编号样式影响。'
  }

  private applyLevelChange(patch: Partial<HeadingLevelDefinition>): void {
    this.numberingService.updateLevelStyle(this.selectedLevel, patch)
    this.renderLevelSettings()
    this.renderFormatEditor()
    this.renderPositionSettings()
    this.renderFullPreview()
  }

  // ── Position Settings ──────────────────────────────────

  private renderPositionSettings(): void {
    const container = this.positionContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const details = document.createElement('details')
    details.style.marginTop = '12px'
    container.appendChild(details)

    const summary = document.createElement('summary')
    summary.textContent = '高级位置设置'
    summary.style.cursor = 'pointer'
    summary.style.fontWeight = '600'
    summary.style.marginBottom = '8px'
    details.appendChild(summary)

    const body = el('div', `${CSS_PREFIX}-position-body`, details)

    const def = this.getCurrentDef(this.selectedLevel)
    const pos = def.position

    // Alignment
    const alignRow = el('div', `${CSS_PREFIX}-setting-row`, body)
    const alignLabel = el('span', `${CSS_PREFIX}-setting-label`, alignRow)
    alignLabel.textContent = '对齐方式：'
    const alignSelect = document.createElement('select')
    for (const [val, label] of Object.entries(ALIGNMENT_LABELS)) {
      const opt = document.createElement('option')
      opt.value = val
      opt.textContent = label
      opt.selected = val === pos.alignment
      alignSelect.appendChild(opt)
    }
    alignSelect.onchange = () => {
      this.applyPositionChange({ alignment: alignSelect.value as HeadingLevelPosition['alignment'] })
    }
    alignRow.appendChild(alignSelect)

    // Aligned at
    const alignedRow = el('div', `${CSS_PREFIX}-setting-row`, body)
    const alignedLabel = el('span', `${CSS_PREFIX}-setting-label`, alignedRow)
    alignedLabel.textContent = '对齐位置 (em)：'
    const alignedInput = document.createElement('input')
    alignedInput.type = 'number'
    alignedInput.step = '0.5'
    alignedInput.min = '0'
    alignedInput.max = '20'
    alignedInput.value = String(pos.alignedAtEm)
    alignedInput.style.width = '70px'
    alignedInput.onchange = () => {
      const val = Math.max(0, Math.min(20, parseFloat(alignedInput.value) || 0))
      alignedInput.value = String(val)
      this.applyPositionChange({ alignedAtEm: val })
    }
    alignedRow.appendChild(alignedInput)

    // Text indent
    const indentRow = el('div', `${CSS_PREFIX}-setting-row`, body)
    const indentLabel = el('span', `${CSS_PREFIX}-setting-label`, indentRow)
    indentLabel.textContent = '文字缩进 (em)：'
    const indentInput = document.createElement('input')
    indentInput.type = 'number'
    indentInput.step = '0.5'
    indentInput.min = '0'
    indentInput.max = '20'
    indentInput.value = String(pos.textIndentAtEm)
    indentInput.style.width = '70px'
    indentInput.onchange = () => {
      const val = Math.max(0, Math.min(20, parseFloat(indentInput.value) || 0))
      indentInput.value = String(val)
      this.applyPositionChange({ textIndentAtEm: val })
    }
    indentRow.appendChild(indentInput)

    // Follow with
    const followRow = el('div', `${CSS_PREFIX}-setting-row`, body)
    const followLabel = el('span', `${CSS_PREFIX}-setting-label`, followRow)
    followLabel.textContent = '编号之后：'
    const followSelect = document.createElement('select')
    for (const [val, label] of Object.entries(FOLLOW_LABELS)) {
      const opt = document.createElement('option')
      opt.value = val
      opt.textContent = label
      opt.selected = val === pos.followWith
      followSelect.appendChild(opt)
    }
    followSelect.onchange = () => {
      this.applyPositionChange({ followWith: followSelect.value as HeadingLevelPosition['followWith'] })
    }
    followRow.appendChild(followSelect)

    // Tab stop at (only relevant when followWith is 'tab')
    const tabRow = el('div', `${CSS_PREFIX}-setting-row`, body)
    const tabLabel = el('span', `${CSS_PREFIX}-setting-label`, tabRow)
    tabLabel.textContent = '制表位位置 (em)：'
    const tabInput = document.createElement('input')
    tabInput.type = 'number'
    tabInput.step = '0.5'
    tabInput.min = '0'
    tabInput.max = '20'
    tabInput.value = pos.tabStopAtEm != null ? String(pos.tabStopAtEm) : ''
    tabInput.placeholder = '不设置'
    tabInput.style.width = '70px'
    if (pos.followWith !== 'tab') {
      tabInput.disabled = true
      tabInput.style.opacity = '0.5'
    }
    followSelect.addEventListener('change', () => {
      if (followSelect.value === 'tab') {
        tabInput.disabled = false
        tabInput.style.opacity = ''
      } else {
        tabInput.disabled = true
        tabInput.style.opacity = '0.5'
      }
    })
    tabInput.onchange = () => {
      const val = tabInput.value === '' ? null : Math.max(0, Math.min(20, parseFloat(tabInput.value) || 0))
      this.applyPositionChange({ tabStopAtEm: val })
    }
    tabRow.appendChild(tabInput)
  }

  private applyPositionChange(patch: Partial<HeadingLevelPosition>): void {
    const def = this.getCurrentDef(this.selectedLevel)
    const newPos = { ...def.position, ...patch }
    this.applyLevelChange({ position: newPos })
  }

  // ── Full Preview ───────────────────────────────────────

  private renderFullMultilevelPreview(container: HTMLElement): void {
    while (container.firstChild) container.removeChild(container.firstChild)

    const title = el('div', `${CSS_PREFIX}-preview-title`, container)
    title.textContent = '多级编号预览'

    const defs = this.currentDefs
    const skipH1 = !this.headingNumbering.showLevelOneNumber
    const sampleCounters = [1, 1, 1, 1, 1, 1]

    for (const lv of HEADING_LEVELS) {
      if (skipH1 && lv === 1) continue

      const def = defs[lv]
      if (!def || !def.enabled) continue

      const row = el('div', `${CSS_PREFIX}-preview-row`, container)
      row.dataset.level = String(lv)
      if (lv === this.selectedLevel) {
        row.classList.add(`${CSS_PREFIX}-preview-row--active`)
      }

      // Compute label from segments
      const label = def.format
        .map(seg => {
          if (seg.type === 'literal') return seg.value
          // level reference: resolve style
          if (seg.level === lv) {
            return formatToken(sampleCounters[seg.level - 1], def.numberStyle)
          }
          // parent reference
          if (seg.level < lv) {
            const resolvedStyle: NumberTokenStyle = def.legalStyle ? 'arabic' : (defs[seg.level]?.numberStyle ?? 'arabic')
            return formatToken(sampleCounters[seg.level - 1], resolvedStyle)
          }
          return formatToken(sampleCounters[seg.level - 1], 'arabic')
        })
        .join('')

      const levelBadge = el('span', `${CSS_PREFIX}-preview-level-badge`, row)
      levelBadge.textContent = `H${lv}`

      const labelEl = el('span', `${CSS_PREFIX}-preview-label-text`, row)
      labelEl.textContent = label || '(无编号)'
    }
  }

  private renderFullPreview(): void {
    const container = this.previewContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const defs = this.currentDefs
    const skipH1 = !this.headingNumbering.showLevelOneNumber
    const sampleCounters = [1, 1, 1, 1, 1, 1]

    const list = el('div', `${CSS_PREFIX}-full-preview`, container)

    for (const lv of HEADING_LEVELS) {
      if (skipH1 && lv === 1) continue

      const def = defs[lv]
      if (!def || !def.enabled) continue

      const row = el('div', `${CSS_PREFIX}-full-preview-row`, list)
      row.dataset.level = String(lv)
      if (lv === this.selectedLevel) {
        row.classList.add(`${CSS_PREFIX}-full-preview-row--active`)
      }

      // Compute label from segments
      const label = def.format
        .map(seg => {
          if (seg.type === 'literal') return seg.value
          if (seg.level === lv) {
            return formatToken(sampleCounters[seg.level - 1], def.numberStyle)
          }
          if (seg.level < lv) {
            const resolvedStyle: NumberTokenStyle = def.legalStyle ? 'arabic' : (defs[seg.level]?.numberStyle ?? 'arabic')
            return formatToken(sampleCounters[seg.level - 1], resolvedStyle)
          }
          return formatToken(sampleCounters[seg.level - 1], 'arabic')
        })
        .join('')

      const levelBadge = el('span', `${CSS_PREFIX}-full-preview-badge`, row)
      levelBadge.textContent = `H${lv}`

      const labelEl = el('span', `${CSS_PREFIX}-full-preview-label`, row)
      labelEl.textContent = label || '(无编号)'

      const sampleText = el('span', `${CSS_PREFIX}-full-preview-text`, row)
      sampleText.textContent = `${['一级', '二级', '三级', '四级', '五级', '六级'][lv - 1]}标题`

      if (lv === this.selectedLevel) {
        const currentTag = el('span', `${CSS_PREFIX}-full-preview-tag`, row)
        currentTag.textContent = '← 当前编辑'
      }
    }
  }

  // ── Actions ────────────────────────────────────────────

  private renderActions(): void {
    const container = this.actionsContainer
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)

    const restoreBtn = document.createElement('button')
    restoreBtn.textContent = '恢复本级默认'
    restoreBtn.onclick = () => {
      const defaultDefs = buildCustomDefault()
      const defaultDef = defaultDefs[this.selectedLevel]
      this.numberingService.updateLevelStyle(this.selectedLevel, defaultDef)
      this.renderCustomEditor()
      this.renderFullPreview()
    }
    container.appendChild(restoreBtn)

    // Copy preset to custom button
    const copyBtn = document.createElement('button')
    copyBtn.textContent = '复制当前预设为自定义'
    copyBtn.style.marginLeft = '8px'
    copyBtn.onclick = () => {
      const s = this.headingNumbering
      if (s.preset === 'custom') return // already custom

      const newSettings: HeadingNumberingSettings = {
        ...s,
        preset: 'custom',
        customDefinition: {
          levels: deepCloneLevels(s.customDefinition.levels),
        },
      }
      this.numberingService.applySettings(newSettings)
      this.render()
    }
    container.appendChild(copyBtn)
  }

  private restoreAllDefaults(): void {
    const defaultDefs = buildCustomDefault()
    const s = this.headingNumbering
    const newSettings: HeadingNumberingSettings = {
      ...s,
      enabled: true,
      showLevelOneNumber: true,
      preset: 'custom',
      customDefinition: { levels: defaultDefs },
    }
    this.numberingService.applySettings(newSettings)
    this.render()
  }

  private cleanHiddenLevelRefs(): void {
    const s = this.headingNumbering
    const currentLevels = s.customDefinition.levels
    const newLevels = deepCloneLevels(currentLevels)
    const hiddenLevels = new Set<HeadingLevel>([1])
    let changed = false

    for (const lv of [2, 3, 4, 5, 6] as HeadingLevel[]) {
      const def = newLevels[lv]
      const oldFormat = def.format
      const newFormat = normalizeFormatSegments(oldFormat, lv, hiddenLevels)
      if (JSON.stringify(newFormat) !== JSON.stringify(oldFormat)) {
        changed = true
        newLevels[lv] = { ...def, format: newFormat }
      }
    }

    if (changed) {
      this.numberingService.applySettings({
        ...s,
        customDefinition: { levels: newLevels },
      })
    }
  }

  private syncDefaultFormatsForVisibility(_showLevelOneNumber: boolean): void {
    // cleanHiddenLevelRefs already handles everything via normalizeFormatSegments
  }
}
