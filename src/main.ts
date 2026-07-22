import './style.scss'
import { Notice, Plugin, PluginSettings } from '@typora-community-plugin/core'
import type { InkChapterSettings } from './settings/settings-model'
import { DEFAULT_SETTINGS } from './settings/default-settings'
import { HeadingNumberingService } from './heading-numbering/heading-numbering-service'
import type { ServiceContext } from './heading-numbering/heading-numbering-service'
import { HeadingDomAdapter } from './infrastructure/heading-dom-adapter'
import { HeadingNumberingSettingTab } from './settings/heading-numbering-setting-tab'


export default class extends Plugin<InkChapterSettings> {

  private numberingService?: HeadingNumberingService

  onload() {
    // Register settings (must succeed for plugin to function)
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

    // Init heading numbering (safe: service is optional)
    try {
      const adapter = new HeadingDomAdapter()
      this.numberingService = new HeadingNumberingService(ctx, adapter)
    } catch (e) {
      console.error('[InkChapter] 标题编号服务初始化失败，编号功能不可用', e)
      Notice.error('墨章：标题编号服务初始化失败，编号功能暂不可用')
    }

    // Register settings tab
    if (this.numberingService) {
      try {
        this.registerSettingTab(
          new HeadingNumberingSettingTab(this.settings, this.numberingService),
        )
      } catch (e) {
        console.error('[InkChapter] 设置页面注册失败', e)
        Notice.error('墨章：设置页面加载失败，但插件主体仍可用')
      }
    }

    // ── Commands (always registered, even if service failed) ──

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

    // Toggle level-one heading numbering
    this.registerCommand({
      id: 'inkchapter.heading.toggle-level-one',
      title: '墨章：切换一级标题编号',
      scope: 'global',
      callback: () => {
        this.numberingService?.toggleLevelOneNumber()
        const current = this.settings.get('headingNumbering')
        Notice.info(`一级标题编号：已${current?.showLevelOneNumber ? '开启' : '关闭'}`)
      },
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
