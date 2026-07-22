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
import { PRESET_LIST, PRESETS } from '../heading-numbering/presets'
import { computeHeadingNumbering } from '../heading-numbering/numbering-engine'

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

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private previewEl: HTMLElement | null = null
  private miniPreviewEls: Map<number, HTMLElement> = new Map()
  private expandedLevel: HeadingLevel | null = null
  private selectEl: HTMLSelectElement | null = null

  constructor(
    private settings: PluginSettings<InkChapterSettings>,
    private numberingService: HeadingNumberingService,
  ) {
    super()
  }

  onshow(): void {
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
      // H1 skipped when showLevelOneNumber is off
      if (!s.showLevelOneNumber && lv === 1) continue

      const style = s.levels[lv]
      if (!style?.enabled) continue

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
    this.numberingService.applyPreset(preset)
    // Sync dropdown
    if (this.selectEl) {
      this.selectEl.value = preset
    }
    // Re-render (rebuilds cards highlight + custom panels)
    this.onshow()
  }

  /** Render fold panels for all 6 heading levels. */
  private renderCustomPanels(s: HeadingNumberingSettings): void {
    const panelContainer = el('div', 'inkchapter-custom-panels')
    this.containerEl.appendChild(panelContainer)

    // ── H1 panel (no independent enabled toggle) ────
    this.renderSingleLevelPanel(1, s, panelContainer, true)

    // ── H2-H6 panels ────────────────────────────────
    for (let i = 2; i <= 6; i++) {
      this.renderSingleLevelPanel(i as HeadingLevel, s, panelContainer, false)
    }

    // ── Reset all button ────────────────────────────
    const resetAllRow = el('div', 'inkchapter-reset-row', this.containerEl)
    const resetBtn = document.createElement('button')
    resetBtn.textContent = '恢复全部自定义设置'
    resetBtn.className = 'inkchapter-reset-all-btn'
    resetBtn.onclick = () => {
      if (confirm('确定要将所有自定义级别恢复为默认值吗？此操作不可撤销。')) {
        this.numberingService.resetAllCustomLevels()
        this.onshow()
      }
    }
    resetAllRow.appendChild(resetBtn)
  }

  private renderSingleLevelPanel(
    lv: HeadingLevel,
    s: HeadingNumberingSettings,
    container: HTMLElement,
    isH1: boolean,
  ): void {
    const style = s.levels[lv]
    if (!style) return

    const panel = el('div', 'inkchapter-custom-panel', container)
    const isExpanded = this.expandedLevel === lv

    // ── Header (always visible) ─────────────────────
    const header = el('div', 'inkchapter-custom-panel-header', panel)
    header.setAttribute('tabindex', '0')
    header.onclick = () => {
      this.expandedLevel = this.expandedLevel === lv ? null : lv
      this.onshow()
    }
    header.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.expandedLevel = this.expandedLevel === lv ? null : lv
        this.onshow()
      }
    }

    // Summary line
    const summary = el('span', 'inkchapter-custom-panel-summary', header)
    const miniLabel = this.computeMiniPreview(lv, s)
    summary.textContent = `H${lv}${miniLabel ? '  ' + miniLabel : ''}`

    const arrow = el('span', 'inkchapter-custom-panel-arrow', header)
    arrow.textContent = isExpanded ? '▾' : '▸'

    if (!isExpanded) return

    // ── Body (expanded) ─────────────────────────────
    const body = el('div', 'inkchapter-custom-panel-body', panel)

    // H1 notice
    if (isH1) {
      const h1Notice = el('div', 'inkchapter-custom-h1-notice', body)
      h1Notice.textContent = 'H1 是否显示编号由上方「一级标题显示编号」控制。'
    }

    if (!isH1) {
      // Enabled checkbox (H2-H6 only)
      this.addCustomCheckbox(body, '启用本级编号', style.enabled, (checked) => {
        this.numberingService.updateLevelStyle(lv, { enabled: checked })
        this.refreshUI()
        this.updateMiniPreview(lv)
      })
    }

    // Token style select
    this.addCustomSelect(body, '当前级编号样式', TOKEN_STYLE_LABELS, style.tokenStyle, (val) => {
      if (typeof val === 'string') {
        this.numberingService.updateLevelStyle(lv, { tokenStyle: val as NumberTokenStyle })
        this.refreshUI()
        this.updateMiniPreview(lv)
      }
    })

    // Include parents checkbox
    this.addCustomCheckbox(body, '包含父级编号', style.includeParents, (checked) => {
      this.numberingService.updateLevelStyle(lv, { includeParents: checked })
      this.refreshUI()
      this.updateMiniPreview(lv)
    })

    // Prefix / Separator / Suffix
    this.addCustomText(body, '前缀', style.prefix, (val) => {
      this.numberingService.updateLevelStyle(lv, { prefix: sanitize(val) })
      this.refreshUI()
      this.updateMiniPreview(lv)
    })

    this.addCustomText(body, '分隔符', style.separator, (val) => {
      this.numberingService.updateLevelStyle(lv, { separator: sanitize(val) })
      this.refreshUI()
      this.updateMiniPreview(lv)
    })

    this.addCustomText(body, '后缀', style.suffix, (val) => {
      this.numberingService.updateLevelStyle(lv, { suffix: sanitize(val) })
      this.refreshUI()
      this.updateMiniPreview(lv)
    })

    // Mini preview
    const miniRow = el('div', 'inkchapter-custom-mini-row', body)
    const miniLabel2 = el('span', 'inkchapter-custom-mini-label', miniRow)
    miniLabel2.textContent = '本级预览：'
    const miniPreview = el('span', 'inkchapter-custom-mini-preview', miniRow)
    miniPreview.textContent = this.computeMiniPreview(lv, s)
    this.miniPreviewEls.set(lv, miniPreview)

    // Reset button
    const resetRow = el('div', 'inkchapter-custom-reset-row', body)
    const resetBtn = document.createElement('button')
    resetBtn.textContent = `恢复 H${lv} 默认值`
    resetBtn.className = 'inkchapter-reset-level-btn'
    resetBtn.onclick = () => {
      this.numberingService.resetLevelStyle(lv)
      this.refreshUI()
      this.updateMiniPreview(lv)
    }
    resetRow.appendChild(resetBtn)
  }

  /** Get a preview label for a single level using the unified engine. */
  private computeMiniPreview(lv: HeadingLevel, s: HeadingNumberingSettings): string {
    if (!s?.levels) return ''
    if (!s.enabled) return '（已关闭）'
    if (lv === 1 && !s.showLevelOneNumber) return '（已隐藏）'

    // Use the unified engine with a single synthetic heading
    const single: HeadingDescriptor[] = [{ key: `mini-h${lv}`, level: lv, text: '' }]
    const numbered = computeHeadingNumbering(single, s)
    const item = numbered.find((h) => h.level === lv)
    return item?.label || ''
  }

  private updateMiniPreview(lv: HeadingLevel): void {
    const el = this.miniPreviewEls.get(lv)
    if (!el) return
    const s = this.headingSettings
    el.textContent = this.computeMiniPreview(lv, s)
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
