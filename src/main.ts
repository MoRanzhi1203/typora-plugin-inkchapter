import './style.scss'
import { Plugin } from '@typora-community-plugin/core'


export default class extends Plugin {

  onload() {
    this.registerCommand({
      id: 'about',
      title: '关于墨章',
      scope: 'global',
      showInCommandPanel: true,
      callback: () => alert('墨章 InkChapter v0.1.0\nTypora 写作增强插件'),
    })

    console.log('[墨章 InkChapter] 插件已加载')
  }

  onunload() {
    console.log('[墨章 InkChapter] 插件已卸载')
  }
}
