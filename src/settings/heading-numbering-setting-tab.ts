import { SettingTab } from '@typora-community-plugin/core'
import type { PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings-model'
import type { HeadingNumberingService } from '../heading-numbering/heading-numbering-service'

export class HeadingNumberingSettingTab extends SettingTab {
  get name(): string {
    return '标题编号'
  }

  constructor(
    private settings: PluginSettings<InkChapterSettings>,
    private numberingService: HeadingNumberingService,
  ) {
    super()
    this.render()
  }

  private render(): void {
    const { settings } = this

    this.addSetting((setting) => {
      setting.addName('一级标题显示编号')
      setting.addDescription('关闭时一级标题不显示编号，二级标题从 1 开始。')
      setting.addCheckbox((checkbox) => {
        const headingSettings = settings.get('headingNumbering')
        checkbox.checked = headingSettings?.showLevelOneNumber ?? false
        checkbox.onclick = () => {
          const current = { ...settings.get('headingNumbering') }
          current.showLevelOneNumber = checkbox.checked
          settings.set('headingNumbering', current)
        }
      })
    })
  }
}
