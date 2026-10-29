/**
 * 墨章「界面 / 文件夹树」设置页。
 *
 * 这些开关只控制墨章自己的增强：原生 Typora 文件树 / 大纲的 DOM 与状态永不被改写，
 * 社区框架自身的配置也永不被写入。
 */
import { SettingTab } from '@typora-community-plugin/core'
import type { InkChapterUiSettings } from './settings-model'

/** 设置页与运行时之间的唯一接口（读取 = 已按默认值补齐的配置）。 */
export interface InkChapterUiSettingTabHost {
  read(): InkChapterUiSettings
  /** 整体写回（调用方负责持久化并立即应用到运行时）。 */
  write(next: InkChapterUiSettings): void
}

export class InkChapterUiSettingTab extends SettingTab {
  get name(): string {
    return '墨章 · 界面'
  }

  constructor(private host: InkChapterUiSettingTabHost) {
    super()
  }

  onshow(): void {
    this.render()
  }

  private render(): void {
    while (this.containerEl.firstChild) this.containerEl.removeChild(this.containerEl.firstChild)
    const ui = this.host.read()

    this.addSettingTitle('文件夹树')
    this.checkbox(
      '定位时闪一下高亮',
      '标签右键菜单「在文件树中定位」成功后在目标节点短暂高亮。只加墨章临时类，不改动原生选中/边框/展开。',
      ui.fileTreeLocateFlash,
      v => this.patch({ fileTreeLocateFlash: v }),
    )
    this.checkbox(
      '空工作区双击新建 Markdown',
      '未打开任何文档时，在空白编辑区双击创建并打开一个「未命名.md」。关闭后双击不再创建。',
      ui.emptyWorkspaceCreate,
      v => this.patch({ emptyWorkspaceCreate: v }),
    )

    this.addSettingTitle('标签右键菜单（墨章扩展项）')
    this.checkbox('关闭全部标签', '原生菜单项永不受影响。', ui.docViewMenu.closeAll, v => this.patchMenu('closeAll', v))
    this.checkbox('复制完整路径', '', ui.docViewMenu.copyAbsolute, v => this.patchMenu('copyAbsolute', v))
    this.checkbox('复制相对路径', '相对路径以当前文件树根为基准。', ui.docViewMenu.copyRelative, v => this.patchMenu('copyRelative', v))
    this.checkbox('在文件树中定位', '', ui.docViewMenu.revealTree, v => this.patchMenu('revealTree', v))
    this.checkbox('在文件资源管理器中显示', '仅 Windows 平台可用。', ui.docViewMenu.revealExplorer, v => this.patchMenu('revealExplorer', v))

    this.addSettingTitle('界面')
    this.checkbox(
      '使用社区框架的左侧 Ribbon',
      '默认关闭 = 保持 Typora 原生侧栏（原生「文件 / 搜索 / 大纲」切页栏，文件夹树与大纲为原生外观）。'
        + '打开 = 改用社区框架的左侧竖条按钮。框架自身配置不会被改写。',
      ui.ribbon,
      v => this.patch({ ribbon: v }),
    )
  }

  private checkbox(name: string, description: string, checked: boolean, onChange: (value: boolean) => void): void {
    this.addSetting(s => {
      s.addName(name)
      if (description) s.addDescription(description)
      s.addCheckbox(cb => {
        cb.checked = checked
        cb.onchange = () => onChange(cb.checked)
      })
    })
  }

  private patch(patch: Partial<InkChapterUiSettings>): void {
    this.host.write({ ...this.host.read(), ...patch })
  }

  private patchMenu(key: keyof InkChapterUiSettings['docViewMenu'], value: boolean): void {
    const current = this.host.read()
    this.host.write({ ...current, docViewMenu: { ...current.docViewMenu, [key]: value } })
  }
}
