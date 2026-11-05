/**
 * V5.0 — 图片设置页「三级作用域」UI 契约（源码级）。
 *
 * 框架的 `SettingTab` 运行时入口只在 Typora 宿主中存在（包本身没有 main），
 * 因此这里锁定设置页与作用域 store 之间的接线契约；作用域解析本身由
 * `image-scope-settings.test.ts` / `image-document-scope-service.test.ts` 做真实执行测试。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(process.cwd(), 'src/settings/image-management-setting-tab.ts'),
  'utf8',
)

describe('IMAGE-SETTINGS-SCOPE contract', () => {
  it('renders a dedicated three-level scope section', () => {
    expect(source).toContain("addSettingTitle('生效范围（全局 → 文件夹 → 当前文档）')")
    expect(source).toContain('renderScopeSection')
    expect(source).toContain('inkchapter-scope-panel')
    expect(source).toContain('inkchapter-scope-row')
    expect(source).toContain('inkchapter-scope-origin')
  })

  it('exposes all overridable fields in the document scope form', () => {
    expect(source).toContain("addRow('文档资源目录'")
    expect(source).toContain("addRow('引用模式'")
    expect(source).toContain("addRow('上传服务'")
    expect(source).toContain("addRow('插入本地图后自动上传'")
    expect(source).toContain("addRow('插入远程图后自动本地化'")
    expect(source).toContain("addRow('图片命名策略'")
  })

  it('writes through the host scope API instead of local-only state', () => {
    expect(source).toContain('this.host.setDocumentScope(next)')
    expect(source).toContain('this.host.setFolderScope(overrides)')
    expect(source).toContain('this.host.clearDocumentScope()')
    expect(source).toContain('this.host.clearFolderScope()')
    expect(source).toContain('this.host.getScopeContext()')
  })

  it('preserves scroll position across full-page rebuilds', () => {
    expect(source).toContain('preserveSettingsScroll(this.containerEl')
    expect(source).toContain("this.containerEl.classList.add('inkchapter-settings'")
  })

  it('shows the inherited origin for every field instead of a bare value', () => {
    expect(source).toContain('scopeOriginLabel')
    expect(source).toContain("'覆盖：当前文档'")
    expect(source).toContain("'继承：当前文件夹'")
    expect(source).toContain("'继承：全局默认'")
  })
})
