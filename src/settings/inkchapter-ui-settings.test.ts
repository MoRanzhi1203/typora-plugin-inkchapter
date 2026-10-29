// @vitest-environment jsdom
/**
 * 界面 / 文件夹树 配置项测试：
 *  - resolveUiSettings 的默认值补齐（纯函数）
 *  - 标签右键菜单扩展项的显隐（原生项永不受影响）
 *  - 文件树定位高亮开关（关闭时定位不变、只少一个临时类）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_UI_SETTINGS, resolveUiSettings } from './default-settings'
import {
  ALL_DOCVIEW_MENU_ITEMS,
  ATTR_ACTION,
  FILE_LOCATE_FLASH_CLASS,
  injectFlatMenuItems,
  revealPathInFileTree,
} from '../document-utilities/document-view-context-menu'
import { resolveDocumentViewContext } from '../document-utilities/document-view-context'

beforeEach(() => {
  document.body.innerHTML = ''
  Element.prototype.scrollIntoView = vi.fn()
})

const ROOT = 'D:\\vault'

function context() {
  return resolveDocumentViewContext({ tabId: `${ROOT}\\a.md`, fileTreeRoot: ROOT, fileExists: () => true })
}

function buildMenu(): HTMLUListElement {
  const menu = document.createElement('ul')
  menu.className = 'dropdown-menu context-menu'
  menu.innerHTML = '<li data-key="removeTab"><a>关闭标签</a></li><li data-key="removeRight"><a>关闭右侧标签</a></li>'
  document.body.appendChild(menu)
  return menu
}

describe('UI-SETTINGS — resolveUiSettings', () => {
  it('missing / empty config → defaults', () => {
    expect(resolveUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS)
    expect(resolveUiSettings(null)).toEqual(DEFAULT_UI_SETTINGS)
    expect(resolveUiSettings({})).toEqual(DEFAULT_UI_SETTINGS)
  })

  it('defaults keep the NATIVE Typora sidebar (framework ribbon off) in any folder', () => {
    expect(DEFAULT_UI_SETTINGS.ribbon).toBe(false)
    expect(resolveUiSettings({}).ribbon).toBe(false)
  })

  it('ships the native-sidebar fallback CSS (hide framework ribbon, zero its layout width)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
    expect(css).toMatch(/body\.inkchapter-ribbon-hidden\s*\{[\s\S]{0,80}--typ-ribbon-width:\s*0px\s*!important/)
    expect(css).toMatch(/body\.inkchapter-ribbon-hidden \.typ-ribbon\s*\{[\s\S]{0,60}display:\s*none\s*!important/)
  })

  it('partial config keeps defaults for the rest', () => {
    const r = resolveUiSettings({ ribbon: false, docViewMenu: { revealTree: false } as never })
    expect(r.ribbon).toBe(false)
    expect(r.docViewMenu.revealTree).toBe(false)
    expect(r.docViewMenu.closeAll).toBe(true)
    expect(r.fileTreeLocateFlash).toBe(true)
    expect(r.emptyWorkspaceCreate).toBe(true)
  })

  it('non-boolean values fall back to defaults', () => {
    const r = resolveUiSettings({ fileTreeLocateFlash: 'yes' as never, emptyWorkspaceCreate: 1 as never })
    expect(r.fileTreeLocateFlash).toBe(true)
    expect(r.emptyWorkspaceCreate).toBe(true)
  })
})

describe('UI-MENU — 文档查看菜单项显隐', () => {
  it('default (all enabled) → 5 rows + 2 dividers', () => {
    const menu = buildMenu()
    const inserted = injectFlatMenuItems(menu, context())
    expect(inserted).toBe(7)
    expect(menu.querySelectorAll(`[${ATTR_ACTION}]`)).toHaveLength(5)
    expect(menu.querySelectorAll('li.divider')).toHaveLength(2)
  })

  it('reveal group disabled → no reveal rows, native rows untouched', () => {
    const menu = buildMenu()
    const inserted = injectFlatMenuItems(menu, context(), {
      ...ALL_DOCVIEW_MENU_ITEMS,
      revealTree: false,
      revealExplorer: false,
    })
    expect(inserted).toBe(4) // close-all + divider + 2 path rows
    expect(menu.querySelector(`[${ATTR_ACTION}="reveal-tree"]`)).toBeNull()
    expect(menu.querySelector(`[${ATTR_ACTION}="reveal-explorer"]`)).toBeNull()
    expect(menu.querySelector('[data-key="removeTab"]')).not.toBeNull()
    expect(menu.querySelector('[data-key="removeRight"]')).not.toBeNull()
  })

  it('only one item enabled → no dangling divider', () => {
    const menu = buildMenu()
    const inserted = injectFlatMenuItems(menu, context(), {
      closeAll: false,
      copyAbsolute: false,
      copyRelative: false,
      revealTree: true,
      revealExplorer: false,
    })
    expect(inserted).toBe(1)
    expect(menu.querySelectorAll('li.divider')).toHaveLength(0)
  })

  it('all disabled → nothing injected', () => {
    const menu = buildMenu()
    const inserted = injectFlatMenuItems(menu, context(), {
      closeAll: false,
      copyAbsolute: false,
      copyRelative: false,
      revealTree: false,
      revealExplorer: false,
    })
    expect(inserted).toBe(0)
    expect(menu.querySelectorAll(`[${ATTR_ACTION}]`)).toHaveLength(0)
  })
})

describe('UI-FLASH — 文件树定位高亮开关', () => {
  function buildTree(vault: string, children: string[]): void {
    const library = document.createElement('div')
    library.id = 'file-library'
    library.innerHTML = '<div id="file-library-tree"></div>'
    document.body.appendChild(library)
    const tree = document.getElementById('file-library-tree')!
    for (const p of [vault, ...children]) {
      const node = document.createElement('div')
      node.className = 'file-library-node file-tree-node'
      node.setAttribute('data-path', p)
      node.innerHTML = '<div class="file-node-content"></div>'
      tree.appendChild(node)
    }
  }

  function reveal(enableFlash?: boolean): Promise<boolean> {
    return revealPathInFileTree({
      root: document,
      absolutePath: `${ROOT}\\a.md`,
      fileTreeRoot: ROOT,
      showFileTree: () => {},
      tick: async () => {},
      flashDurationMs: 50,
      ...(enableFlash != null ? { enableFlash } : {}),
    })
  }

  it('enabled (default) → flash class added', async () => {
    buildTree(ROOT, [`${ROOT}\\a.md`])
    await reveal()
    expect(document.querySelectorAll(`.${FILE_LOCATE_FLASH_CLASS}`).length).toBe(1)
  })

  it('disabled → no flash class, reveal still succeeds', async () => {
    buildTree(ROOT, [`${ROOT}\\a.md`])
    const ok = await reveal(false)
    expect(ok).toBe(true)
    expect(document.querySelectorAll(`.${FILE_LOCATE_FLASH_CLASS}`).length).toBe(0)
  })
})
