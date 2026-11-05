/**
 * 墨章「界面 / 文件夹树」设置页。
 *
 * 这些开关只控制墨章自己的增强：原生 Typora 文件树 / 大纲的 DOM 与状态永不被改写，
 * 社区框架自身的配置也永不被写入。
 */
import { SettingTab } from '@typora-community-plugin/core'
import type { InkChapterUiSettings } from './settings-model'
import { preserveSettingsScroll } from './settings-scroll'

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
    preserveSettingsScroll(this.containerEl, () => {
      this.containerEl.classList.add('inkchapter-settings', 'inkchapter-settings-ui')
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

    this.addSettingTitle('内容块工具栏')
    this.addSetting(s => {
      s.addName('代码块折叠预览行数')
      s.addDescription(
        '只对超过该行数的代码块生效（短代码始终完整显示）。折叠后保留代码高亮与缩进，'
        + '底部保留 20px 渐隐；顶部语言栏右侧的折叠按钮可随时展开全部或收起至预览。复制始终复制完整代码。',
      )
      s.addSelect(sel => {
        sel.add(new Option('预览 10 行（默认）', '10'))
        sel.add(new Option('预览 5 行', '5'))
        sel.value = String(ui.codeBlockPreviewLines)
        sel.onchange = () => this.patch({
          codeBlockPreviewLines: sel.value === '5' ? 5 : 10,
        })
      })
    })
    this.checkbox(
      '编辑代码时自动展开',
      '开启：在折叠代码块内修改文本（输入字符、空格 / Tab、删除、粘贴）时，自动完整展开。'
        + '关闭：折叠状态下编辑不会自动展开，只能通过顶部展开按钮或文档检测栏定位展开。'
        + '仅点击、选中或移动光标始终不会改变折叠状态。',
      ui.codeBlockAutoExpandOnEdit,
      v => this.patch({ codeBlockAutoExpandOnEdit: v }),
    )

    this.addSettingTitle('界面')
    this.checkbox(
      '使用社区框架的左侧 Ribbon',
      '默认关闭 = 保持 Typora 原生侧栏（原生「文件 / 搜索 / 大纲」切页栏，文件夹树与大纲为原生外观）。'
        + '打开 = 改用社区框架的左侧竖条按钮。框架自身配置不会被改写。',
      ui.ribbon,
      v => this.patch({ ribbon: v }),
    )
    })
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
