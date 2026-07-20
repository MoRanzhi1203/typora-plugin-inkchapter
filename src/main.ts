import './style.scss'
import { Notice, Plugin, PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings/settings-model'
import { DEFAULT_SETTINGS } from './settings/default-settings'
import { HeadingNumberingService } from './heading-numbering/heading-numbering-service'
import type { ServiceContext } from './heading-numbering/heading-numbering-service'
import { HeadingDomAdapter } from './infrastructure/heading-dom-adapter'


export default class extends Plugin<InkChapterSettings> {

  private numberingService?: HeadingNumberingService

  onload() {
    // Register settings
    this.registerSettings(
      new PluginSettings(this.app, this.manifest, {
        version: 1,
      }),
    )
    this.settings.setDefault(DEFAULT_SETTINGS)

    // Build service context (exposes only needed APIs, avoids protected access)
    const ctx: ServiceContext = {
      settings: this.settings,
      onWorkspaceEvent: (event, listener) => {
        const dispose = this.app.workspace.on(event as never, listener as never)
        this.register(dispose)
        return dispose
      },
      onEditorEvent: (event, listener) => {
        const dispose = this.app.features.markdownEditor.on(event as never, listener as never)
        this.register(dispose)
        return dispose
      },
      registerDisposable: (fn) => this.register(fn),
    }

    // Init heading numbering
    const adapter = new HeadingDomAdapter()
    this.numberingService = new HeadingNumberingService(ctx, adapter)

    // Status check command
    this.registerCommand({
      id: 'inkchapter.check-status',
      title: '检查插件状态',
      scope: 'global',
      callback: () => Notice.info('墨章 InkChapter 已正常加载'),
    })

    // Toggle heading numbering
    this.registerCommand({
      id: 'inkchapter.heading.toggle',
      title: '启用/关闭标题编号',
      scope: 'global',
      callback: () => this.numberingService?.toggle(),
    })

    // Renumber headings
    this.registerCommand({
      id: 'inkchapter.heading.renumber',
      title: '重新编号标题',
      scope: 'global',
      callback: () => this.numberingService?.renumber(),
    })

    console.log('[InkChapter] 插件已加载')
  }

  onunload() {
    if (this.numberingService) {
      this.numberingService.dispose()
      this.numberingService = undefined
    }
    console.log('[InkChapter] 插件已卸载')
  }
}
