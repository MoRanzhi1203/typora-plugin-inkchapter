// @vitest-environment jsdom
/**
 * V2 FLAT context menu tests — MENU-FLAT-* plus the existing functional suites
 * (Clipboard / TREE / EXPLORER / CLOSEALL).
 *
 * Verifies the "墨章 · 文档查看 >" second level is GONE and the five actions sit
 * directly inside the native context menu, grouped by semantics:
 *
 *   [关闭标签][关闭其他标签][关闭右侧标签] [关闭全部标签]   Close group
 *   ─────────────────────────────────────────────
 *   复制完整路径 / 复制相对路径                          Path group
 *   ─────────────────────────────────────────────
 *   在文件树中定位 / 在文件资源管理器中显示              Reveal group
 *   ───────────────────────────────────────────── (native separator reused)
 *   右侧打开 / 下方打开                                native Open group
 *
 * Insertion is anchor-based (data-key of the native close actions) — never
 * fixed child indexes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DocumentViewContextMenu,
  findTabContextMenu,
  findTreeNodeByExactPath,
  revealPathInFileTree,
  runCloseAllTabs,
  closeTabViaNativeControl,
  collectRealTabEls,
  buildExplorerSelectArgs,
  countInjectedItems,
  countDuplicateSeparators,
  countMenuSeparators,
  injectFlatMenuItems,
  evaluateRenderedTextAlignment,
  NATIVE_ANCHOR_SLOT_CLASS,
  NATIVE_INDENT_AUTHORITY,
  LABEL_CLOSE_ALL,
  LABEL_COPY_ABSOLUTE,
  LABEL_COPY_RELATIVE,
  LABEL_REVEAL_TREE,
  LABEL_REVEAL_EXPLORER,
  TOAST_COPIED_ABSOLUTE,
  TOAST_COPIED_RELATIVE,
  TOAST_REVEAL_EXPLORER_FAILED,
  ATTR_ACTION,
  type DocViewPlatform,
} from './document-view-context-menu'
import {
  resolveDocumentViewContext,
  REASON_UNSAVED,
  REASON_OUTSIDE_ROOT,
  REASON_NO_ROOT,
} from './document-view-context'

const ROOT = 'D:\\vault'

// ── helpers ──────────────────────────────────────────────────────────────────
let createdEnhancers: DocumentViewContextMenu[] = []

function basePlatform(over: Partial<DocViewPlatform> = {}): DocViewPlatform {
  return {
    isWindows: true,
    getFileTreeRoot: () => ROOT,
    fileExists: () => true,
    copyText: vi.fn(),
    revealInExplorer: vi.fn(async () => true),
    showFileTree: vi.fn(),
    notice: vi.fn(),
    onInvariant: vi.fn(),
    tick: async () => {},
    ...over,
  }
}

type NativeMenuKind = 'with-open-group' | 'close-only'

/** HTML for a native framework-style tab context menu. */
function nativeMenuHTML(kind: NativeMenuKind = 'with-open-group'): string {
  const parts = [
    '<li class="typ-menuitem" data-key="removeTab"><a>关闭标签</a></li>',
    '<li class="typ-menuitem" data-key="removeOthers"><a>关闭其他标签</a></li>',
    '<li class="typ-menuitem" data-key="removeRight"><a>关闭右侧标签</a></li>',
  ]
  if (kind === 'with-open-group') {
    parts.push(
      '<li class="divider typ-menuitem"></li>',
      '<li class="typ-menuitem" data-key="splitRight"><a>右侧打开</a></li>',
      '<li class="typ-menuitem" data-key="splitDown"><a>下方打开</a></li>',
    )
  }
  return parts.join('')
}

/** Native framework-style tab context menu (close group + optional open group). */
function buildNativeMenu(kind: NativeMenuKind = 'with-open-group'): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.className = 'dropdown-menu context-menu'
  ul.innerHTML = nativeMenuHTML(kind)
  document.body.appendChild(ul)
  return ul
}

function buildTab(path: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'typ-tab'
  el.setAttribute('data-id', path)
  el.innerHTML = `<span class="typ-file-basename">x</span><i class="typ-icon typ-close"></i>`
  document.body.appendChild(el)
  return el
}

/** Rack whose native close click removes the tab (mirrors framework close). */
function makeRack(opts: { refusePath?: string | null } = {}): { rack: HTMLDivElement; removed: () => number } {
  const rack = document.createElement('div')
  rack.id = 'tab-rack'
  document.body.prepend(rack)
  let removedCount = 0
  const refusePath = opts.refusePath ?? null
  rack.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.typ-tab')
    if (!tab) return
    if (!(e.target as HTMLElement).closest('.typ-close')) return
    if (refusePath != null && tab.getAttribute('data-id') === refusePath) return // native prompt cancelled
    tab.remove()
    removedCount++
  })
  return { rack, removed: () => removedCount }
}

function mountEnhancer(platform: DocViewPlatform): DocumentViewContextMenu {
  const enhancer = new DocumentViewContextMenu(platform)
  enhancer.attach()
  createdEnhancers.push(enhancer)
  return enhancer
}

/** Right-click a tab (flat injection) and return the enhanced native menu. */
function openTabMenu(path: string, platform: DocViewPlatform, kind: NativeMenuKind = 'with-open-group'): HTMLUListElement {
  const menu = buildNativeMenu(kind)
  mountEnhancer(platform)
  const tab = buildTab(path)
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  void menu
  return document.querySelector<HTMLUListElement>('ul.dropdown-menu.context-menu')!
}

function actionLi(menu: HTMLUListElement, action: string): HTMLElement {
  return menu.querySelector<HTMLElement>(`[${ATTR_ACTION}="${action}"]`)!
}

function textLi(menu: HTMLUListElement, text: string): HTMLElement {
  return Array.from(menu.querySelectorAll<HTMLElement>('li')).find(li => (li.textContent ?? '') === text)!
}

beforeEach(() => {
  document.body.innerHTML = ''
  Element.prototype.scrollIntoView = vi.fn()
  createdEnhancers = []
})

afterEach(() => {
  for (const enhancer of createdEnhancers) enhancer.dispose()
  createdEnhancers = []
  vi.restoreAllMocks()
})

// ── MENU-FLAT ────────────────────────────────────────────────────────────────
describe('MENU-FLAT-1..10 flat native+ layout', () => {
  it('FLAT-1/2 no InkChapter submenu and no brand item', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    expect(menu.querySelector('[data-ink-docview-submenu]')).toBeNull()
    expect(document.querySelectorAll('[data-ink-docview-submenu]')).toHaveLength(0)
    expect(menu.textContent).not.toContain('墨章 · 文档查看')
    expect(menu.textContent).not.toContain('InkChapter')
    expect(menu.textContent).not.toContain('墨章功能')
    expect(platform.onInvariant).toHaveBeenCalledWith(
      'DOCUMENT-VIEW-CONTEXT-MENU-INVARIANT',
      expect.objectContaining({ submenuCount: 0, contextMenuEnhancerCount: 1, duplicateListenerCount: 0 }),
    )
  })

  it('FLAT-3 关闭全部标签 sits immediately after 关闭右侧标签 (same close group)', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const closeRight = menu.querySelector<HTMLElement>('[data-key="removeRight"]')!
    const next = closeRight.nextElementSibling as HTMLElement
    expect(next.getAttribute(ATTR_ACTION)).toBe('close-all')
    expect(next.textContent).toBe(LABEL_CLOSE_ALL)
    expect(next.classList.contains('divider')).toBe(false)
    expect(menu.textContent?.indexOf('关闭右侧标签')! < menu.textContent!.indexOf('关闭全部标签')!).toBe(true)
  })

  it('FLAT-4/5 flat row order: close group → path group → reveal group', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\runtime\\a.md`, platform)
    const text = Array.from(menu.querySelectorAll<HTMLElement>('li'))
      .filter(li => !li.classList.contains('divider'))
      .map(li => li.textContent ?? '')
    expect(text).toEqual([
      '关闭标签', '关闭其他标签', '关闭右侧标签', LABEL_CLOSE_ALL,
      LABEL_COPY_ABSOLUTE, LABEL_COPY_RELATIVE,
      LABEL_REVEAL_TREE, LABEL_REVEAL_EXPLORER,
      '右侧打开', '下方打开',
    ])
  })

  it('FLAT-6/7 native open group preserved in place after the reveal group', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const revealExp = textLi(menu, LABEL_REVEAL_EXPLORER)
    const right = menu.querySelector<HTMLElement>('[data-key="splitRight"]')!
    const down = menu.querySelector<HTMLElement>('[data-key="splitDown"]')!
    // Native items untouched (still present with their keys + labels)
    expect(right.textContent).toBe('右侧打开')
    expect(down.textContent).toBe('下方打开')
    expect(right.compareDocumentPosition(revealExp) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // One separator between reveal group and open group (reused native divider)
    const between = ((): HTMLElement | null => {
      let node = revealExp.nextElementSibling
      while (node && node !== right) {
        if ((node as HTMLElement).classList.contains('divider')) return node as HTMLElement
        node = node.nextElementSibling
      }
      return null
    })()
    expect(between).toBeTruthy()
  })

  it('FLAT-8 no duplicate separators', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    expect(countDuplicateSeparators(menu)).toBe(0)
    expect(countMenuSeparators(menu)).toBe(3)
  })

  it('FLAT-9 repeated open never duplicates items or separators', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const tab = document.querySelector<HTMLElement>('.typ-tab')!
    // first re-open on a cleared (rebuilt) menu — framework empties & rebuilds
    menu.innerHTML = nativeMenuHTML('with-open-group')
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const counts = countInjectedItems(menu)
    expect(counts).toEqual({ 'close-all': 1, 'copy-absolute': 1, 'copy-relative': 1, 'reveal-tree': 1, 'reveal-explorer': 1 })
    expect(countDuplicateSeparators(menu)).toBe(0)
  })

  it('FLAT-9b direct inject is idempotent on the same menu', () => {
    const menu = buildNativeMenu('close-only')
    const ctx = resolveDocumentViewContext({ tabId: `${ROOT}\\a.md`, fileTreeRoot: ROOT, fileExists: () => true })
    const first = injectFlatMenuItems(menu, ctx)
    const second = injectFlatMenuItems(menu, ctx)
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(0)
    expect(countInjectedItems(menu)['close-all']).toBe(1)
  })

  it('FLAT-10 the RIGHT-CLICKED (non-active) tab stays the target', () => {
    const copyText = vi.fn()
    const platform = basePlatform({ copyText })
    const menu = openTabMenu('D:\\vault\\sub\\A.md', platform)
    const tabA = document.querySelector<HTMLElement>('.typ-tab')!
    tabA.classList.remove('active') // simulate a non-active right-clicked tab
    const tabB = buildTab('D:\\vault\\B.md')
    tabB.classList.add('active')
    actionLi(menu, 'copy-absolute').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(copyText).toHaveBeenCalledWith('D:\\vault\\sub\\A.md')
  })
})

// ── disabled states (flat) ─────────────────────────────────────────────────
describe('disabled states stay correct on the flat rows', () => {
  it('unsaved tab → path/reveal rows disabled with 尚未保存 reason', () => {
    const platform = basePlatform()
    const menu = openTabMenu('', platform)
    const copyAbs = textLi(menu, LABEL_COPY_ABSOLUTE)
    const copyRel = textLi(menu, LABEL_COPY_RELATIVE)
    const revealTree = textLi(menu, LABEL_REVEAL_TREE)
    expect(copyAbs.classList.contains('ink-docview-disabled')).toBe(true)
    expect(copyAbs.title).toBe(REASON_UNSAVED)
    expect(copyRel.classList.contains('ink-docview-disabled')).toBe(true)
    expect(revealTree.classList.contains('ink-docview-disabled')).toBe(true)
    // close-all unaffected
    expect(actionLi(menu, 'close-all')).toBeTruthy()
  })

  it('no file-tree root → relative/tree disabled; absolute/explorer enabled', () => {
    const platform = basePlatform({ getFileTreeRoot: () => null })
    const menu = openTabMenu('D:\\single\\a.md', platform)
    expect(textLi(menu, LABEL_COPY_RELATIVE).title).toBe(REASON_NO_ROOT)
    expect(textLi(menu, LABEL_REVEAL_TREE).title).toBe(REASON_NO_ROOT)
    expect(actionLi(menu, 'copy-absolute')).toBeTruthy()
    expect(actionLi(menu, 'reveal-explorer')).toBeTruthy()
  })

  it('outside-root file → relative/tree disabled; absolute/explorer enabled', () => {
    const platform = basePlatform()
    const menu = openTabMenu('D:\\other\\a.md', platform)
    expect(actionLi(menu, 'copy-absolute')).toBeTruthy()
    expect(actionLi(menu, 'reveal-explorer')).toBeTruthy()
    expect(textLi(menu, LABEL_COPY_RELATIVE).classList.contains('ink-docview-disabled')).toBe(true)
    expect(textLi(menu, LABEL_COPY_RELATIVE).title).toBe(REASON_OUTSIDE_ROOT)
    expect(textLi(menu, LABEL_REVEAL_TREE).title).toBe(REASON_OUTSIDE_ROOT)
  })

  it('no global contextmenu pollution: right-click outside a tab does nothing', () => {
    const platform = basePlatform()
    const menu = buildNativeMenu()
    mountEnhancer(platform)
    const spy = vi.spyOn(MouseEvent.prototype, 'preventDefault')
    const bodyDiv = document.createElement('div')
    bodyDiv.textContent = 'body'
    document.body.appendChild(bodyDiv)
    bodyDiv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(menu.querySelector(`[${ATTR_ACTION}]`)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

// ── Clipboard (flat copy actions) ───────────────────────────────────────────
describe('Clipboard — 复制完整路径 / 复制相对路径', () => {
  it('复制完整路径 copies the RIGHT-CLICKED tab absolute path', () => {
    const copyText = vi.fn()
    const notice = vi.fn()
    const menu = openTabMenu('D:\\other-doc\\a.md', basePlatform({ copyText, notice }))
    actionLi(menu, 'copy-absolute').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(copyText).toHaveBeenCalledWith('D:\\other-doc\\a.md')
    expect(notice).toHaveBeenCalledWith(TOAST_COPIED_ABSOLUTE)
  })

  it('复制相对路径 copies root-relative path with / separators', () => {
    const copyText = vi.fn()
    const notice = vi.fn()
    const menu = openTabMenu(`${ROOT}\\runtime\\smoke\\Document-Test.md`, basePlatform({ copyText, notice }))
    actionLi(menu, 'copy-relative').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(copyText).toHaveBeenCalledWith('runtime/smoke/Document-Test.md')
    expect(notice).toHaveBeenCalledWith(TOAST_COPIED_RELATIVE)
  })

  it('after an action the transient menu is closed', () => {
    const copyText = vi.fn()
    const menu = openTabMenu(`${ROOT}\\a.md`, basePlatform({ copyText }))
    actionLi(menu, 'copy-absolute').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(menu.style.display).toBe('none')
  })
})

// ── TREE ────────────────────────────────────────────────────────────────────
describe('TREE reveal in file tree (native-state safe)', () => {
  type DirTree = Record<string, string[]>

  function buildTree(dirTree: DirTree, vault: string): void {
    const library = document.createElement('div')
    library.id = 'file-library'
    library.innerHTML = '<div id="file-library-tree"></div>'
    document.body.appendChild(library)
    const tree = document.getElementById('file-library-tree')!
    const renderNode = (path: string, isDir: boolean): HTMLElement => {
      const node = document.createElement('div')
      node.className = `file-library-node file-tree-node ${isDir ? 'file-node-collapsed' : ''}`
      node.setAttribute('data-path', path)
      node.innerHTML = `<div class="file-node-content"></div><div class="file-node-children"></div>`
      tree.appendChild(node)
      if (isDir) {
        node.addEventListener('click', () => {
          node.classList.remove('file-node-collapsed')
          node.classList.add('file-node-expanded')
          ;(dirTree[path] ?? []).forEach(p => tree.appendChild(renderNode(p, dirTree[p] != null)))
        })
      } else {
        // Native file activation: Typora adds its own active state on open.
        node.addEventListener('click', () => node.classList.add('active'))
      }
      return node
    }
    renderNode(vault, true)
  }

  function runReveal(target: string, vault: string, extra: Partial<{ tick: () => Promise<void>; flashDurationMs: number; onInvariant: (f: unknown) => void }> = {}): Promise<boolean> {
    return revealPathInFileTree({
      root: document,
      absolutePath: target,
      fileTreeRoot: vault,
      showFileTree: () => {},
      tick: extra.tick ?? (async () => {}),
      ...(extra.flashDurationMs != null ? { flashDurationMs: extra.flashDurationMs } : {}),
      ...(extra.onInvariant ? { onInvariant: extra.onInvariant as never } : {}),
    })
  }

  it('expands parent chain via path identity, scrolls & hands selection to native click', async () => {
    const vault = 'D:\\vault'
    const target = 'D:\\vault\\a\\b\\deep.md'
    const tree: DirTree = {
      'D:\\vault': ['D:\\vault\\a'],
      'D:\\vault\\a': ['D:\\vault\\a\\b'],
      'D:\\vault\\a\\b': ['D:\\vault\\a\\b\\deep.md'],
    }
    buildTree(tree, vault)
    const ok = await runReveal(target, vault)
    expect(ok).toBe(true)
    const fileNode = findTreeNodeByExactPath(document, target)
    expect(fileNode).toBeTruthy()
    expect(fileNode!.scrollIntoView).toHaveBeenCalled()
    // native click (Typora) applied its own activation — InkChapter did not.
    expect(fileNode!.classList.contains('active')).toBe(true)
    expect(fileNode!.classList.contains('inkchapter-file-locate-flash')).toBe(true)
    expect(findTreeNodeByExactPath(document, 'D:\\vault\\x\\deep.md')).toBeNull()
  })

  it('returns false when the file cannot be found (bounded, no crash)', async () => {
    const vault = 'D:\\vault'
    buildTree({ 'D:\\vault': ['D:\\vault\\a'] }, vault)
    const ok = await runReveal('D:\\vault\\missing.md', vault)
    expect(ok).toBe(false)
  })
})

// ── TREE-NATIVE ─────────────────────────────────────────────────────────────
describe('TREE-NATIVE-1..10 native file-tree state is never touched by InkChapter', () => {
  type DirTree = Record<string, string[]>

  function buildTree(dirTree: DirTree, vault: string, containerStyle = ''): void {
    const library = document.createElement('div')
    library.id = 'file-library'
    if (containerStyle) library.setAttribute('style', containerStyle)
    library.innerHTML = '<div id="file-library-tree"></div>'
    document.body.appendChild(library)
    const tree = document.getElementById('file-library-tree')!
    const renderNode = (path: string, isDir: boolean): HTMLElement => {
      const node = document.createElement('div')
      node.className = `file-library-node file-tree-node ${isDir ? 'file-node-collapsed' : ''}`
      node.setAttribute('data-path', path)
      node.innerHTML = `<div class="file-node-content"></div><div class="file-node-children"></div>`
      tree.appendChild(node)
      if (isDir) {
        node.addEventListener('click', () => {
          node.classList.remove('file-node-collapsed')
          node.classList.add('file-node-expanded')
          ;(dirTree[path] ?? []).forEach(p => tree.appendChild(renderNode(p, dirTree[p] != null)))
        })
      } else {
        node.addEventListener('click', () => node.classList.add('active'))
      }
      return node
    }
    renderNode(vault, true)
  }

  const chain: DirTree = {
    'D:\\vault': ['D:\\vault\\a', 'D:\\vault\\zdir'],
    'D:\\vault\\a': ['D:\\vault\\a\\deep.md'],
    'D:\\vault\\zdir': ['D:\\vault\\zdir\\doc.md'],
  }

  function runReveal(target: string, vault: string, extra: Partial<{ flashDurationMs: number }> = {}): Promise<boolean> {
    return revealPathInFileTree({
      root: document,
      absolutePath: target,
      fileTreeRoot: vault,
      showFileTree: () => {},
      tick: async () => {},
      ...(extra.flashDurationMs != null ? { flashDurationMs: extra.flashDurationMs } : {}),
    })
  }

  /** Expand the root folder so its direct children exist in the DOM. */
  function expandRoot(): void {
    expandDir('D:\\vault')
  }

  /** Click a folder node (path attribute escaped for CSS selectors). */
  function expandDir(p: string): void {
    const sel = `[data-path="${p.replace(/\\/g, '\\\\')}"]`
    document.querySelector<HTMLElement>(sel)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }

  function nodeByPath(p: string): HTMLElement {
    const sel = `[data-path="${p.replace(/\\/g, '\\\\')}"]`
    const el = document.querySelector<HTMLElement>(sel)
    expect(el, `node ${p}`).toBeTruthy()
    return el!
  }

  it('TREE-NATIVE-1/2 reveal never removes another node native active/selected', async () => {
    buildTree(chain, 'D:\\vault')
    expandRoot()
    const sibling = nodeByPath('D:\\vault\\zdir')
    sibling.classList.add('active', 'selected')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    // sibling dir keeps native classes (InkChapter never removed them)
    expect(sibling.classList.contains('active')).toBe(true)
    expect(sibling.classList.contains('selected')).toBe(true)
  })

  it('TREE-NATIVE-3 reveal does not clear target inline border', async () => {
    buildTree(chain, 'D:\\vault')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    const target = nodeByPath('D:\\vault\\a\\deep.md')
    target.style.borderTop = '1px solid red' // emulate native border source
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    expect(target.style.borderTopWidth).toBe('1px')
    expect(target.getAttribute('style')).toContain('border-top')
  })

  it('TREE-NATIVE-4 reveal does not clear target outline', async () => {
    buildTree(chain, 'D:\\vault')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    const target = nodeByPath('D:\\vault\\a\\deep.md')
    target.style.outlineStyle = 'solid'
    target.style.outlineWidth = '2px'
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    expect(target.style.outlineStyle).toBe('solid')
    expect(target.style.outlineWidth).toBe('2px')
  })

  it('TREE-NATIVE-5 reveal does not clear file-tree container right border', async () => {
    buildTree(chain, 'D:\\vault', 'border-right: 1px solid #ccc;')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    const container = document.getElementById('file-library')!
    expect(container.getAttribute('style')).toContain('border-right: 1px solid')
    expect(container.style.borderRightWidth).toBe('1px')
  })

  it('TREE-NATIVE-6 highlight only adds the InkChapter flash class', async () => {
    buildTree(chain, 'D:\\vault')
    // first reveal lets native activation settle, then its flash is cleaned
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    await new Promise(r => setTimeout(r, 25))
    const target = nodeByPath('D:\\vault\\a\\deep.md')
    const base = new Set(target.classList)
    // second reveal: the ONLY delta may be the InkChapter flash class
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 100 })
    expect(target.classList.contains('inkchapter-file-locate-flash')).toBe(true)
    const added = Array.from(target.classList).filter(c => !base.has(c))
    expect(added).toEqual(['inkchapter-file-locate-flash'])
  })

  it('TREE-NATIVE-7 highlight cleanup removes ONLY the InkChapter class', async () => {
    buildTree(chain, 'D:\\vault')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    const target = nodeByPath('D:\\vault\\a\\deep.md')
    target.classList.add('selected') // pretend native also marked it
    target.style.borderTop = '1px solid green'
    await new Promise(r => setTimeout(r, 25))
    expect(target.classList.contains('inkchapter-file-locate-flash')).toBe(false)
    expect(target.classList.contains('active')).toBe(true) // native activation kept
    expect(target.classList.contains('selected')).toBe(true) // untouched
    expect(target.style.borderTopWidth).toBe('1px')
  })

  it('TREE-NATIVE-8 repeated reveal keeps native state', async () => {
    buildTree(chain, 'D:\\vault')
    expandRoot()
    const sibling = nodeByPath('D:\\vault\\zdir')
    sibling.classList.add('selected')
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    await runReveal('D:\\vault\\a\\deep.md', 'D:\\vault', { flashDurationMs: 5 })
    await new Promise(r => setTimeout(r, 25))
    const target = nodeByPath('D:\\vault\\a\\deep.md')
    expect(target.classList.contains('inkchapter-file-locate-flash')).toBe(false)
    expect(target.classList.contains('active')).toBe(true)
    expect(sibling.classList.contains('selected')).toBe(true)
  })

  it('TREE-NATIVE-9 duplicate basename resolves by path identity only', async () => {
    buildTree({
      'D:\\vault': ['D:\\vault\\p1', 'D:\\vault\\p2'],
      'D:\\vault\\p1': ['D:\\vault\\p1\\doc.md'],
      'D:\\vault\\p2': ['D:\\vault\\p2\\doc.md'],
    }, 'D:\\vault')
    expandRoot()
    await runReveal('D:\\vault\\p1\\doc.md', 'D:\\vault', { flashDurationMs: 5 })
    // expand the sibling folder too so both same-basename files exist in DOM
    expandDir('D:\\vault\\p2')
    await new Promise(r => setTimeout(r, 0))
    const one = nodeByPath('D:\\vault\\p1\\doc.md')
    const two = nodeByPath('D:\\vault\\p2\\doc.md')
    expect(one.classList.contains('active')).toBe(true)
    expect(one.classList.contains('inkchapter-file-locate-flash')).toBe(false) // cleaned
    expect(two.classList.contains('active')).toBe(false) // never touched
    expect(two.classList.contains('inkchapter-file-locate-flash')).toBe(false)
  })

  it('TREE-NATIVE-10 reveal keeps container/native styling intact (outline→files)', async () => {
    buildTree(chain, 'D:\\vault', 'border-right: 1px solid #ccc; background: rgb(255,255,255);')
    const container = document.getElementById('file-library')!
    const classesBefore = Array.from(container.classList)
    const showFileTree = vi.fn()
    const ok = await revealPathInFileTree({
      root: document,
      absolutePath: 'D:\\vault\\a\\deep.md',
      fileTreeRoot: 'D:\\vault',
      showFileTree,
      tick: async () => {},
      flashDurationMs: 5,
    })
    expect(showFileTree).toHaveBeenCalled()
    expect(ok).toBe(true)
    expect(container.getAttribute('style')).toContain('border-right: 1px solid')
    expect(container.getAttribute('style')).toContain('background: rgb(255,255,255)')
    expect(Array.from(container.classList)).toEqual(classesBefore)
  })
})

// ── MENU-ALIGN ──────────────────────────────────────────────────────────────
describe('MENU-ALIGN-1..8 rows align to the native menu baseline', () => {
  const readSource = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')

  it('MENU-ALIGN-1 InkChapter rows use the identical native li.typ-menuitem > a structure', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const ours = Array.from(menu.querySelectorAll<HTMLElement>(`[${ATTR_ACTION}]`))
    expect(ours.length).toBe(5)
    for (const li of ours) {
      expect(li.tagName).toBe('LI')
      expect(li.classList.contains('typ-menuitem')).toBe(true)
      expect(li.children.length).toBe(1)
      const a = li.firstElementChild!
      expect(a.tagName).toBe('A')
      expect(a.getAttribute('role')).toBe('menuitem')
      expect(a.children.length).toBe(0) // pure text, no wrappers/icons
    }
  })

  it('MENU-ALIGN-2 no extra wrapper elements anywhere inside our rows', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    for (const li of Array.from(menu.querySelectorAll<HTMLElement>(`[${ATTR_ACTION}]`))) {
      expect(li.querySelectorAll('div,span,button')).toHaveLength(0)
    }
  })

  it('MENU-ALIGN-3/4 no custom text-indent / fixed widths in InkChapter menu CSS', () => {
    // compare against declarations only (comments may legitimately name the rules)
    const cssClean = readSource().replace(/\/\*[\s\S]*?\*\//g, '')
    const start = cssClean.indexOf('.ink-docview-disabled')
    const tabBlock = cssClean.indexOf('.typ-workspace-root .typ-workspace-tabs')
    const inkTail = cssClean.slice(start, tabBlock > start ? tabBlock : undefined)
    expect(inkTail).not.toMatch(/text-indent/)
    expect(inkTail).not.toMatch(/padding-(left|right)/)
    expect(inkTail).not.toMatch(/margin-(left|right)/)
    expect(inkTail).not.toMatch(/min-width/)
    expect(inkTail).not.toMatch(/width\s*:\s*(280|300|320)px/)
    expect(inkTail).not.toMatch(/translateX|transform:/)
  })

  it('MENU-ALIGN-5 native divider element is reused (no custom hr/border divs)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-view-context-menu.ts'), 'utf8')
    const divider = source.match(/function makeDivider[\s\S]*?\n}/)
    expect(divider).toBeTruthy()
    expect(divider![0]).toContain("'divider typ-menuitem'")
    // no custom divider node types introduced
    expect(source).not.toMatch(/<hr|<div class="[^"]*divider/i)
  })

  it('MENU-ALIGN-6 no duplicate separator (flat menu)', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    expect(countDuplicateSeparators(menu)).toBe(0)
  })

  it('MENU-ALIGN-7 row order unchanged', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const keys = Array.from(menu.querySelectorAll<HTMLElement>('li[data-key]')).map(el => el.getAttribute('data-key'))
    expect(keys.slice(0, 3)).toEqual(['removeTab', 'removeOthers', 'removeRight'])
    expect(keys).toContain('splitRight')
    expect(keys).toContain('splitDown')
  })

  it('MENU-ALIGN-8 no submenu regression', () => {
    const platform = basePlatform()
    openTabMenu(`${ROOT}\\a.md`, platform)
    expect(document.querySelectorAll('[data-ink-docview-submenu]')).toHaveLength(0)
    expect(document.querySelectorAll('.inkchapter-file-locate-flash')).toHaveLength(0)
  })
})

// ── EXPLORER ────────────────────────────────────────────────────────────────
describe('EXPLORER reveal in Explorer', () => {
  it('builds a safe /select argument (no shell string concat)', () => {
    const args = buildExplorerSelectArgs('D:\\folder with 空格\\文件 名.md')
    expect(args).toHaveLength(1)
    expect(args[0].startsWith('/select,')).toBe(true)
    expect(args[0]).toContain('文件 名.md')
    expect(args[0].endsWith('"')).toBe(true)
  })

  it('在文件资源管理器中显示 calls the platform reveal with the absolute path', async () => {
    const revealInExplorer = vi.fn(async () => true)
    const menu = openTabMenu('D:\\vault\\runtime\\a 文件.md', basePlatform({ revealInExplorer }))
    actionLi(menu, 'reveal-explorer').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(revealInExplorer).toHaveBeenCalledWith('D:\\vault\\runtime\\a 文件.md')
  })

  it('failure → 无法在文件资源管理器中定位该文件 notice', async () => {
    const revealInExplorer = vi.fn(async () => false)
    const notice = vi.fn()
    const menu = openTabMenu('D:\\vault\\a.md', basePlatform({ revealInExplorer, notice }))
    actionLi(menu, 'reveal-explorer').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(notice).toHaveBeenCalledWith(TOAST_REVEAL_EXPLORER_FAILED)
  })

  it('unsaved tab → explorer action disabled', () => {
    const platform = basePlatform()
    const menu = openTabMenu('', platform)
    const li = textLi(menu, LABEL_REVEAL_EXPLORER)
    expect(li.hasAttribute(ATTR_ACTION)).toBe(false)
    expect(li.classList.contains('ink-docview-disabled')).toBe(true)
  })
})

// ── CLOSE ALL ───────────────────────────────────────────────────────────────
describe('CLOSEALL close-all tabs', () => {
  it('multiple saved tabs are closed through the native close control', async () => {
    const { rack, removed } = makeRack()
    ;['a.md', 'b.md', 'c.md'].forEach(p => rack.appendChild(buildTab(`${ROOT}\\${p}`)))
    expect(removed()).toBe(0)
    const result = await runCloseAllTabs({ tick: async () => {} })
    expect(result.closed).toBe(3)
    expect(result.cancelled).toBe(false)
    expect(removed()).toBe(3)
    expect(collectRealTabEls(document)).toHaveLength(0)
  })

  it('an unsaved (Untitled, data-id="") tab is also closed by the same flow', async () => {
    const { rack, removed } = makeRack()
    rack.appendChild(buildTab(''))
    const result = await runCloseAllTabs({ tick: async () => {} })
    expect(result.cancelled).toBe(false)
    expect(removed()).toBe(1)
  })

  it('placeholder typ:// tabs are never touched (framework empty leaf)', async () => {
    const { rack } = makeRack()
    rack.appendChild(buildTab(`${ROOT}\\a.md`))
    rack.appendChild(buildTab('typ://core.empty'))
    const result = await runCloseAllTabs({ tick: async () => {} })
    expect(result.closed).toBe(1)
    expect(document.querySelectorAll('.typ-tab')).toHaveLength(1)
  })

  it('cancel (tab stays after native close attempt) stops the remaining sequence', async () => {
    const { rack } = makeRack({ refusePath: `${ROOT}\\b.md` })
    rack.appendChild(buildTab(`${ROOT}\\a.md`))
    rack.appendChild(buildTab(`${ROOT}\\b.md`))
    const result = await runCloseAllTabs({ tick: async () => {} })
    expect(result.closed).toBe(1)
    expect(result.cancelled).toBe(true)
    expect(document.querySelectorAll('.typ-tab')).toHaveLength(1)
    expect(document.querySelector('.typ-tab')!.getAttribute('data-id')).toBe(`${ROOT}\\b.md`)
  })

  it('no direct tab DOM removal exists in the close-all path (native click only)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-view-context-menu.ts'), 'utf8')
    const m = source.match(/function closeTabViaNativeControl[\s\S]*?\n}/)
    expect(m).toBeTruthy()
    expect(m![0]).toMatch(/\.click\(\)/)
    expect(m![0]).not.toMatch(/\.remove\(/)
  })

  it('关闭全部标签 menu action closes everything and notices', async () => {
    const notice = vi.fn()
    const platform = basePlatform({ notice })
    const { rack } = makeRack()
    rack.appendChild(buildTab(`${ROOT}\\a.md`))
    rack.appendChild(buildTab(`${ROOT}\\b.md`))
    const menu = buildNativeMenu('with-open-group')
    mountEnhancer(platform)
    const tab = rack.querySelector<HTMLElement>('.typ-tab')!
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    actionLi(menu, 'close-all').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(document.querySelectorAll('.typ-tab')).toHaveLength(0)
    expect(notice).toHaveBeenCalledWith('已关闭全部标签')
  })
})

// ── finders / misc ──────────────────────────────────────────────────────────
describe('finder guards', () => {
  it('findTabContextMenu ignores built-in menus (with ids)', () => {
    buildNativeMenu()
    const builtin = document.createElement('ul')
    builtin.id = 'context-menu'
    builtin.className = 'dropdown-menu context-menu'
    builtin.innerHTML = '<li data-key="removeTab"></li>'
    document.body.appendChild(builtin)
    const found = findTabContextMenu(document)
    expect(found).toBeTruthy()
    expect(found!.id).not.toBe('context-menu')
    expect(found!.id).not.toBe('file-menu')
  })

  it('close-only menu (single tab) still receives the flat block without open group', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform, 'close-only')
    const counts = countInjectedItems(menu)
    expect(counts).toEqual({ 'close-all': 1, 'copy-absolute': 1, 'copy-relative': 1, 'reveal-tree': 1, 'reveal-explorer': 1 })
    expect(menu.querySelector('[data-key="splitRight"]')).toBeNull()
    // exactly the two InkChapter separators → no consecutive dividers
    expect(countMenuSeparators(menu)).toBe(2)
    expect(countDuplicateSeparators(menu)).toBe(0)
  })

  it('no submenu markers or leftover group element survive anywhere', () => {
    const platform = basePlatform()
    openTabMenu(`${ROOT}\\a.md`, platform)
    expect(document.querySelectorAll('[data-ink-docview-submenu]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-ink-docview-group]')).toHaveLength(0)
  })
})

// ── MENU-TEXT ───────────────────────────────────────────────────────────────
describe('MENU-TEXT-1..8 rendered-text baseline (pure evaluator + structural)', () => {
  const row = (anchorLeft: number, renderedTextLeft: number, rowHeight = 28): {
    label: string; rowLeft: number; anchorLeft: number; renderedTextLeft: number; renderedTextRight: number; rowHeight: number
  } => ({ label: 'x', rowLeft: anchorLeft, anchorLeft, renderedTextLeft, renderedTextRight: renderedTextLeft + 60, rowHeight })

  it('MENU-TEXT-1 anchor equal / rendered text mismatch → FAIL (false-positive gate)', () => {
    const out = evaluateRenderedTextAlignment({
      measureMode: 'REAL',
      native: row(30, 42),
      items: [row(30, 30)],
      duplicateSeparatorCount: 0,
      submenuCount: 0,
    })
    expect(out.maxAnchorLeftDelta).toBe(0)
    expect(out.maxRenderedTextLeftDelta).toBe(12)
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('RENDERED_TEXT_BASELINE_MISMATCH')
  })

  it('MENU-TEXT-2 rendered text delta 0 → PASS', () => {
    const out = evaluateRenderedTextAlignment({
      measureMode: 'REAL',
      native: row(30, 42),
      items: [row(30, 42), row(30, 42)],
      duplicateSeparatorCount: 0,
      submenuCount: 0,
    })
    expect(out.maxRenderedTextLeftDelta).toBe(0)
    expect(out.decision).toBe('PASS')
    expect(out.reason).toBe('RENDERED_TEXT_ALIGNED_WITH_NATIVE')
  })

  it('MENU-TEXT-3 rendered text delta 1px → PASS', () => {
    const out = evaluateRenderedTextAlignment({
      measureMode: 'REAL',
      native: row(30, 42),
      items: [row(30, 41), row(30, 43)],
      duplicateSeparatorCount: 0,
      submenuCount: 0,
    })
    expect(out.maxRenderedTextLeftDelta).toBe(1)
    expect(out.decision).toBe('PASS')
  })

  it('MENU-TEXT-4 rendered text delta >1 → FAIL', () => {
    const out = evaluateRenderedTextAlignment({
      measureMode: 'REAL',
      native: row(30, 42),
      items: [row(30, 44.5)],
      duplicateSeparatorCount: 0,
      submenuCount: 0,
    })
    expect(out.maxRenderedTextLeftDelta).toBe(2.5)
    expect(out.decision).toBe('FAIL')
    expect(out.reason).toBe('RENDERED_TEXT_BASELINE_MISMATCH')
  })

  it('MENU-TEXT-5 no real layout → NA / NO_REAL_LAYOUT (never 0==0 PASS)', () => {
    const out = evaluateRenderedTextAlignment({
      measureMode: 'HEADLESS',
      native: row(0, 0),
      items: [row(0, 0)],
      duplicateSeparatorCount: 0,
      submenuCount: 0,
    })
    expect(out.decision).toBe('NA')
    expect(out.reason).toBe('NO_REAL_LAYOUT')
    expect(out.maxRenderedTextLeftDelta).toBeNull()
  })

  it('MENU-TEXT-6 native/ink share the same semantic anchor slot (state-off)', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const native = menu.querySelector<HTMLElement>('[data-key="removeTab"] a')!
    const ink = menu.querySelector<HTMLElement>('[data-ink-docview-action="close-all"] a')!
    expect(native.tagName).toBe('A')
    expect(ink.tagName).toBe('A')
    expect(ink.className).toBe(NATIVE_ANCHOR_SLOT_CLASS)
    expect(NATIVE_INDENT_AUTHORITY).toContain('state-off')
    expect(ink.getAttribute('role')).toBe('menuitem')
  })

  it('MENU-TEXT-7 no per-item pixel patch (no inline styles / no per-item offsets)', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    for (const li of Array.from(menu.querySelectorAll<HTMLElement>(`[${ATTR_ACTION}]`))) {
      const a = li.querySelector<HTMLElement>('a')!
      expect(a.getAttribute('style')).toBeNull()
      expect(li.getAttribute('style')).toBeNull()
      expect(a.classList.contains('inkchapter-pad')).toBe(false)
    }
    const source = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-view-context-menu.ts'), 'utf8')
    expect(source).not.toMatch(/translateX/)
    expect(source).not.toMatch(/\.style\.(padding|margin)Left|setAttribute\(['"]style/)
    expect(source).not.toMatch(/padding-left\s*:\s*\d|margin-left\s*:\s*\d/)
  })

  it('MENU-TEXT-8 no fake native command data-key on InkChapter rows', () => {
    const platform = basePlatform()
    const menu = openTabMenu(`${ROOT}\\a.md`, platform)
    const nativeKeys = new Set(['removeTab', 'removeOthers', 'removeRight', 'splitRight', 'splitDown'])
    for (const li of Array.from(menu.querySelectorAll<HTMLElement>(`[${ATTR_ACTION}]`))) {
      const key = li.getAttribute('data-key')
      expect(key).toBeNull()
      expect(nativeKeys.has(key ?? '')).toBe(false)
    }
    const source = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-view-context-menu.ts'), 'utf8')
    expect(source).not.toMatch(/setAttribute\(['"]data-key['"]/)
    expect(source).not.toMatch(/dataset\.key\s*=\s*['"](removeTab|removeOthers|removeRight|splitRight|splitDown)['"]/)
  })
})
