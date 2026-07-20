import './style.scss'
import { Notice, Plugin } from '@typora-community-plugin/core'


export default class extends Plugin {

  onload() {
    this.registerCommand({
      id: 'inkchapter.check-status',
      title: '检查插件状态',
      scope: 'global',
      callback: () => Notice.info('墨章 InkChapter 已正常加载'),
    })

    console.log('[InkChapter] 插件已加载')
  }

  onunload() {
    console.log('[InkChapter] 插件已卸载')
  }
}
