import { SettingTab } from '@typora-community-plugin/core'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings-model'
import type {
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingPreset,
  NumberTokenStyle,
} from '../heading-numbering/heading-types'
import { HEADING_LEVELS } from '../heading-numbering/heading-types'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'
import { PRESET_LIST } from '../heading-numbering/presets'
import { formatToken, isValidTokenStyle } from '../heading-numbering/token-formatter'

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

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  private previewEl: HTMLElement | null = null
  private customContainer: HTMLElement | null = null

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
    this.render()
  }

  private get headingSettings() {
    return this.numberingService.getCurrentSettings()
  }

  private render(): void {
    const s = this.headingSettings

    // ── Section: Basic ──────────────────────────────
    this.addSettingTitle('基础设置')

    // Enable toggle
    this.addSetting((setting) => {
      setting.addName('启用标题编号')
      setting.addDescription('开启后自动为标题添加编号')
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

    // Show level one toggle
    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时一级标题不显示编号，二级标题从 1 开始')
      setting.addCheckbox((cb) => {
        cb.checked = s.showLevelOneNumber
        cb.onclick = () => {
          const current = { ...this.settings.get('headingNumbering') }
          current.showLevelOneNumber = cb.checked
          this.settings.set('headingNumbering', current)
          this.refreshUI()
        }
      })
    })

    // Preset selector
    this.addSetting((setting) => {
      setting.addName('编号样式预设')
      setting.addDescription('选择预设编号格式')
      setting.addSelect((select) => {
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
          const presetVal = select.value as HeadingNumberingPreset
          if (presetVal === 'custom') {
            const current = { ...this.settings.get('headingNumbering') }
            current.preset = 'custom'
            this.settings.set('headingNumbering', current)
            this.numberingService.applyPreset('custom')
          } else {
            this.numberingService.applyPreset(presetVal)
          }
          this.refreshUI()
        }
      })
    })

    // ── Live Preview ────────────────────────────────
    this.addSettingTitle('实时预览')
    this.addSetting((setting) => {
      setting.addName('预览')
      setting.addDescription(() => {
        this.previewEl = el('div', 'inkchapter-preview')
        return this.previewEl
      })
    })
    this.updatePreview()

    // ── Custom Settings ─────────────────────────────
    this.customContainer = el('div')
    this.containerEl.appendChild(this.customContainer)
    this.renderCustomSection(s.preset === 'custom')
  }

  private updatePreview(): void {
    if (!this.previewEl) return
    this.previewEl.textContent = ''

    const s = this.headingSettings
    const skipH1 = !s.showLevelOneNumber

    for (const lv of HEADING_LEVELS) {
      if (skipH1 && lv === 1) continue
      const style = s.levels[lv]
      if (!style?.enabled) continue

      const row = el('div', 'inkchapter-preview-row', this.previewEl)
      const label = el('span', 'inkchapter-preview-label', row)
      label.textContent = `H${lv}: `
      const token = el('span', 'inkchapter-preview-token', row)
      token.textContent = this.computePreviewToken(lv, style)
    }
  }

  private computePreviewToken(level: HeadingLevel, style: HeadingLevelStyle): string {
    const sampleNums: Record<HeadingLevel, number> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }
    const token = formatToken(sampleNums[level], style.tokenStyle)
    if (style.includeParents) {
      const parts: string[] = []
      for (let i = 1; i <= level; i++) {
        const lv = i as HeadingLevel
        parts.push(formatToken(sampleNums[lv], style.tokenStyle))
      }
      return parts.map((p) => style.prefix + p + style.suffix).join(style.separator)
    }
    return style.prefix + token + style.suffix
  }

  private renderCustomSection(visible: boolean): void {
    if (!this.customContainer) return
    while (this.customContainer.firstChild) {
      this.customContainer.removeChild(this.customContainer.firstChild)
    }
    if (!visible) return

    const h3 = el('h3', undefined, this.customContainer)
    h3.textContent = '自定义设置'

    const s = this.headingSettings

    for (const lv of HEADING_LEVELS) {
      const style = s.levels[lv]
      if (!style) continue

      const section = el('div', 'inkchapter-custom-level', this.customContainer)
      const header = el('h4', undefined, section)
      header.textContent = `H${lv} 级别设置`
      header.style.cursor = 'pointer'

      const body = el('div', 'inkchapter-custom-body', section)

      this.addInlineCheckbox(body, '显示编号', style.enabled, (checked) => {
        this.numberingService.updateLevelStyle(lv, { enabled: checked })
        this.updatePreview()
      })

      this.addInlineSelect(body, '编号类型', TOKEN_STYLE_LABELS, style.tokenStyle, (val) => {
        if (isValidTokenStyle(val)) {
          this.numberingService.updateLevelStyle(lv, { tokenStyle: val })
          this.updatePreview()
        }
      })

      this.addInlineCheckbox(body, '包含上级编号', style.includeParents, (checked) => {
        this.numberingService.updateLevelStyle(lv, { includeParents: checked })
        this.updatePreview()
      })

      this.addInlineText(body, '前缀', style.prefix, (val) => {
        this.numberingService.updateLevelStyle(lv, { prefix: sanitizeInput(val) })
        this.updatePreview()
      })

      this.addInlineText(body, '后缀', style.suffix, (val) => {
        this.numberingService.updateLevelStyle(lv, { suffix: sanitizeInput(val) })
        this.updatePreview()
      })

      this.addInlineText(body, '分隔符', style.separator, (val) => {
        this.numberingService.updateLevelStyle(lv, { separator: sanitizeInput(val, 3) })
        this.updatePreview()
      })

      header.onclick = () => {
        body.style.display = body.style.display === 'none' ? '' : 'none'
      }
    }
  }

  // ── Inline UI helpers ────────────────────────────

  private addInlineCheckbox(
    container: HTMLElement, label: string, checked: boolean,
    onChange: (checked: boolean) => void,
  ): void {
    const row = el('div', 'inkchapter-inline-row', container)
    const span = el('span', 'inkchapter-inline-label', row)
    span.textContent = label
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    cb.onchange = () => onChange(cb.checked)
    row.appendChild(cb)
  }

  private addInlineSelect(
    container: HTMLElement, label: string, options: Record<string, string>,
    value: string, onChange: (val: string) => void,
  ): void {
    const row = el('div', 'inkchapter-inline-row', container)
    const span = el('span', 'inkchapter-inline-label', row)
    span.textContent = label
    const select = document.createElement('select')
    for (const [optVal, optLabel] of Object.entries(options)) {
      const opt = document.createElement('option')
      opt.value = optVal
      opt.textContent = optLabel
      opt.selected = optVal === value
      select.appendChild(opt)
    }
    select.onchange = () => onChange(select.value)
    row.appendChild(select)
  }

  private addInlineText(
    container: HTMLElement, label: string, value: string,
    onChange: (val: string) => void,
  ): void {
    const row = el('div', 'inkchapter-inline-row', container)
    const span = el('span', 'inkchapter-inline-label', row)
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.style.width = '120px'
    let timer: ReturnType<typeof setTimeout> | null = null
    input.oninput = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => onChange(input.value), 300)
    }
    row.appendChild(input)
  }

  private refreshUI(): void {
    this.updatePreview()
    const s = this.headingSettings
    this.renderCustomSection(s.preset === 'custom')
  }
}

// ── Native DOM helpers ─────────────────────────────

function el(tag: string, cls?: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (parent) parent.appendChild(e)
  return e
}

function sanitizeInput(val: string, maxLen = 10): string {
  return val
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s/g, '')
    .slice(0, maxLen)
}
