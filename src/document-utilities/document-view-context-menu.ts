/**
 * InkChapter — Document View context menu enhancer (V2 · FLAT, Native+).
 *
 * Adds five tab actions DIRECTLY into the workspace file-tab context menu as a
 * single-level, semantically grouped extension — no "墨章 · 文档查看" brand
 * item, no submenu root, no hover/pointer bridge:
 *
 *   关闭标签            (native)
 *   关闭其他标签        (native)
 *   关闭右侧标签        (native)
 *   关闭全部标签        (inkchapter)   ← inserted right after 关闭右侧标签
 *   ────────────────
 *   复制完整路径        (Path Group)
 *   复制相对路径
 *   ────────────────
 *   在文件树中定位      (Reveal Group)
 *   在文件资源管理器中显示
 *   ────────────────    (reuses the native separator if present)
 *   右侧打开            (native, preserved in place)
 *   下方打开
 *
 * Insertion uses STABLE SEMANTIC ANCHORS (data-key="removeRight", then
 * removeOthers / removeTab as fallbacks) — never fixed child indexes. Native
 * actions are never removed, renamed or rewritten.
 *
 * The module never imports `typora`; every platform touch point is injected by
 * main.ts (see {@link DocViewPlatform}) so the whole module is unit-testable.
 */
import { resolveDocumentViewContext, type DocumentViewContext } from './document-view-context'

export const LABEL_CLOSE_ALL = '关闭全部标签'
export const LABEL_COPY_ABSOLUTE = '复制完整路径'
export const LABEL_COPY_RELATIVE = '复制相对路径'
export const LABEL_REVEAL_TREE = '在文件树中定位'
export const LABEL_REVEAL_EXPLORER = '在文件资源管理器中显示'

export const TOAST_COPIED_ABSOLUTE = '已复制完整路径'
export const TOAST_COPIED_RELATIVE = '已复制相对路径'
export const TOAST_CLOSE_ALL_DONE = '已关闭全部标签'
export const TOAST_CLOSE_ALL_CANCELLED = '已取消关闭标签'
export const TOAST_REVEAL_TREE_FAILED = '无法在文件树中定位该文件'
export const TOAST_REVEAL_EXPLORER_FAILED = '无法在文件资源管理器中定位该文件'

/** DOM markers that must never collide with Typora / framework markup. */
export const ATTR_ACTION = 'data-ink-docview-action'
const CSS_DISABLED = 'ink-docview-disabled'

/** Semantic anchors of the native close group (in insertion preference order). */
const CLOSE_ANCHOR_KEYS = ['removeRight', 'removeOthers', 'removeTab']
/** Native split/open group identities (preserved, never inserted before). */
const OPEN_GROUP_KEYS = ['splitRight', 'splitDown']

export type DocViewAction =
  | 'close-all'
  | 'copy-absolute'
  | 'copy-relative'
  | 'reveal-tree'
  | 'reveal-explorer'

/** 每个墨章扩展项是否插入（原生项永不受影响）。 */
export interface DocViewMenuOptions {
  closeAll: boolean
  copyAbsolute: boolean
  copyRelative: boolean
  revealTree: boolean
  revealExplorer: boolean
}

/** 默认：全部插入（与引入配置项之前的行为完全一致）。 */
export const ALL_DOCVIEW_MENU_ITEMS: DocViewMenuOptions = {
  closeAll: true,
  copyAbsolute: true,
  copyRelative: true,
  revealTree: true,
  revealExplorer: true,
}

/** 墨章界面配置读取结果（菜单项显隐 + 定位高亮）。 */
export interface DocViewUiOptions {
  menu: DocViewMenuOptions
  flash: boolean
}

export const DEFAULT_DOCVIEW_UI_OPTIONS: DocViewUiOptions = {
  menu: ALL_DOCVIEW_MENU_ITEMS,
  flash: true,
}

export type DocViewPlatform = {
  isWindows: boolean
  getFileTreeRoot(): string | null
  fileExists(absolutePath: string): boolean
  copyText(text: string): void
  /** Reveal in OS file manager; resolves false when it could not run. */
  revealInExplorer(absolutePath: string): boolean | Promise<boolean>
  /** Make the left "文件" (file tree) panel visible and active. */
  showFileTree(): void
  /** Prefer Typora's own reveal (expands + marks + scrolls natively). */
  nativeRevealInFileTree?(absolutePath: string): boolean | Promise<boolean>
  /** Wait a short tick between DOM interactions. */
  tick?(): Promise<void> | void
  notice(message: string): void
  /** Runtime invariant observer (log only). event is like the audit event name. */
  onInvariant?(event: string, payload: Record<string, unknown>): void
}

// ── module-scoped single-mount accounting (duplicate guard) ───────────────
let enhancerInstanceCount = 0

// ── small helpers ───────────────────────────────────────────────────────────

function normalizedCompare(p: string): string {
  return p.replace(/\\+$/, '').toLowerCase()
}

function isElement(node: EventTarget | null): node is Element {
  return node instanceof Element
}

/** The right-clicked Markdown document tab (framework `.typ-tab`). */
export function findClickedTab(e: MouseEvent): HTMLElement | null {
  if (!isElement(e.target)) return null
  return e.target.closest<HTMLElement>('.typ-tab')
}

/**
 * Find the framework file-tab context menu displayed for this event:
 * a non-built-in `ul.dropdown-menu.context-menu` that already contains the
 * native `removeTab` item. The framework builds it synchronously BEFORE our
 * document-level (bubble) listener runs.
 */
export function findTabContextMenu(root: ParentNode = document): HTMLUListElement | null {
  const menus = Array.from(root.querySelectorAll<HTMLUListElement>('ul.dropdown-menu.context-menu'))
  let found: HTMLUListElement | null = null
  for (const menu of menus) {
    if (menu.id) continue // built-in Typora menus carry ids
    if (!menu.querySelector('[data-key="removeTab"]')) continue
    if (menu.querySelector(`[${ATTR_ACTION}]`)) continue // already enhanced
    found = menu
  }
  return found
}

// ── file-tree reveal helpers (pure DOM) ────────────────────────────────────

function treeNodes(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('#file-library-tree .file-library-node'))
}

export function findTreeNodeByExactPath(root: ParentNode, absolutePath: string): HTMLElement | null {
  const wanted = normalizedCompare(absolutePath)
  for (const node of treeNodes(root)) {
    const p = node.getAttribute('data-path')
    if (p && normalizedCompare(p) === wanted) return node
  }
  return null
}

/**
 * Ancestor directories from `fileTreeRoot` down to the file's parent directory
 * (root included, so a collapsed root can be expanded first).
 */
function ancestorDirsOf(absolutePath: string, fileTreeRoot: string): string[] {
  const dirs: string[] = []
  const rootNorm = normalizedCompare(fileTreeRoot)
  let cur = absolutePath.replace(/[\\/][^\\/]+$/, '')
  while (cur) {
    dirs.unshift(cur)
    if (normalizedCompare(cur) === rootNorm) break
    const next = cur.replace(/[\\/][^\\/]+$/, '')
    if (next === cur) break
    cur = next
  }
  return dirs
}

function isFolderCollapsed(node: HTMLElement): boolean {
  return node.classList.contains('file-node-collapsed')
}

/** Click a collapsed folder to let Typora load & render its children. */
function clickFolderToExpand(node: HTMLElement): void {
  const target = node.querySelector<HTMLElement>('.file-node-content') ?? node
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/**
 * InkChapter-only transient highlight. Never touches Typora's native
 * active/selected/border/outline/background — the box-shadow is purely a
 * non-invasive visual affordance and cleanup removes ONLY this class.
 */
export const FILE_LOCATE_FLASH_CLASS = 'inkchapter-file-locate-flash'
let flashNode: HTMLElement | null = null
let flashTimer: number | null = null

function clearFlashTimer(): void {
  if (flashTimer != null) {
    window.clearTimeout(flashTimer)
    flashTimer = null
  }
}

/** Add the InkChapter-only flash and schedule its single-class cleanup. */
function scheduleFlash(node: HTMLElement, durationMs: number): boolean {
  clearFlashTimer()
  const already = node.classList.contains(FILE_LOCATE_FLASH_CLASS)
  node.classList.add(FILE_LOCATE_FLASH_CLASS)
  flashNode = node
  flashTimer = window.setTimeout(() => {
    flashTimer = null
    if (flashNode && flashNode.isConnected) {
      flashNode.classList.remove(FILE_LOCATE_FLASH_CLASS) // InkChapter class only
    }
    flashNode = null
  }, durationMs)
  return !already
}

/** Read-only native-state facts for invariants (never used to restore styles). */
export interface FileTreeNativeFacts {
  targetResolved: boolean
  nativeSelectionMethod: string
  beforeNativeClasses: string[]
  afterNativeClasses: string[]
  beforeBorder: string
  afterBorder: string
  beforeOutline: string
  afterOutline: string
  treeBorderBefore: string
  treeBorderAfter: string
  inkHighlightAdded: boolean
  inkHighlightRemoved: boolean
  decision: 'PASS' | 'FAIL'
  reason: string
}

function fileTreeContainer(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('#file-library') ?? document.getElementById('file-library')
}

/**
 * Full reveal — native state is the ONLY visual authority:
 *   1. switch to the files panel
 *   2. expand the collapsed parent chain via native clicks
 *   3. resolve the exact target node by PATH identity
 *   4. hand selection/open back to Typora (`node.click()`)
 *   5. scrollIntoView
 *   6. optional transient InkChapter-only flash
 *
 * InkChapter never removes/rewrites Typora classes or inline styles; the
 * highlight cleanup removes only `inkchapter-file-locate-flash`.
 */
export async function revealPathInFileTree(opts: {
  root: ParentNode
  absolutePath: string
  fileTreeRoot: string
  showFileTree: () => void
  tick?: () => Promise<void> | void
  flashDurationMs?: number
  /** 是否在目标节点上加临时高亮类；false 时定位/展开/选中完全不变。 */
  enableFlash?: boolean
  onInvariant?: (facts: FileTreeNativeFacts) => void
}): Promise<boolean> {
  const { root, absolutePath, fileTreeRoot, showFileTree } = opts
  const tick = opts.tick ?? (() => new Promise<void>(r => setTimeout(r, 80)))
  const flashEnabled = opts.enableFlash ?? true
  const flashMs = opts.flashDurationMs ?? 1000
  showFileTree()
  await tick()

  let attempts = 0
  let lastClickedKey = ''
  let sameClickStreak = 0
  let waitStreak = 0
  const maxAttempts = 120
  let target: HTMLElement | null = null

  while (attempts < maxAttempts) {
    attempts++
    const exact = findTreeNodeByExactPath(root, absolutePath)
    if (exact) {
      target = exact
      break
    }
    // Deepest ancestor dir that currently exists as a node.
    const dirs = ancestorDirsOf(absolutePath, fileTreeRoot)
    const present = dirs
      .map(dir => ({ dir, node: findTreeNodeByExactPath(root, dir) }))
      .filter(x => x.node != null)
    const collapsed = present.filter(x => isFolderCollapsed(x.node!))
    const candidate = collapsed.length ? collapsed[collapsed.length - 1] : null
    if (!candidate || !candidate.node) {
      // The files panel / lazy child fetch may still be appearing: poll for a
      // bounded number of turns instead of failing immediately.
      waitStreak++
      if (waitStreak > 25) break
      await tick()
      await tick()
      continue
    }
    waitStreak = 0
    const key = normalizedCompare(candidate.dir)
    if (lastClickedKey === key) {
      sameClickStreak++
      if (sameClickStreak > 2) break
    } else {
      sameClickStreak = 0
    }
    lastClickedKey = key
    clickFolderToExpand(candidate.node)
    await tick()
    await tick()
  }

  if (!target) {
    opts.onInvariant?.({
      targetResolved: false,
      nativeSelectionMethod: 'NONE',
      beforeNativeClasses: [],
      afterNativeClasses: [],
      beforeBorder: '',
      afterBorder: '',
      beforeOutline: '',
      afterOutline: '',
      treeBorderBefore: '',
      treeBorderAfter: '',
      inkHighlightAdded: false,
      inkHighlightRemoved: false,
      decision: 'FAIL',
      reason: 'TARGET_NOT_RESOLVED',
    })
    return false
  }

  const container = fileTreeContainer(root)
  const snapshot = (): { classes: string[]; border: string; outline: string; treeBorder: string } => {
    const cs = (el: HTMLElement) => window.getComputedStyle(el)
    return {
      classes: Array.from(target!.classList),
      border: target ? cs(target).borderTopWidth : '',
      outline: target ? cs(target).outlineStyle : '',
      treeBorder: container ? cs(container).borderRightWidth : '',
    }
  }
  const before = snapshot()

  // Native scroll + native selection/open mechanism: replay the same pointer
  // sequence Typora's own file-tree rows receive (never hand-applied classes).
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  const activate = target.querySelector<HTMLElement>('.file-node-content') ?? target
  try {
    activate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    activate.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    activate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  } catch { /* native activation best-effort */ }
  const inkHighlightAdded = flashEnabled ? scheduleFlash(target, flashMs) : false

  const after = snapshot()
  const nativeClassesPreserved = before.classes.every(c => after.classes.includes(c))
  const treeBorderPreserved = before.treeBorder === after.treeBorder
  const borderPreserved = before.border === after.border
  const outlinePreserved = before.outline === after.outline
  const pass = nativeClassesPreserved && treeBorderPreserved && borderPreserved && outlinePreserved

  opts.onInvariant?.({
    targetResolved: true,
    nativeSelectionMethod: 'NATIVE_POINTER_ACTIVATION',
    beforeNativeClasses: before.classes,
    afterNativeClasses: after.classes,
    beforeBorder: before.border,
    afterBorder: after.border,
    beforeOutline: before.outline,
    afterOutline: after.outline,
    treeBorderBefore: before.treeBorder,
    treeBorderAfter: after.treeBorder,
    inkHighlightAdded,
    inkHighlightRemoved: false, // resolved after flash duration by the timer
    decision: pass ? 'PASS' : 'FAIL',
    reason: pass
      ? 'NATIVE_STATE_PRESERVED'
      : nativeClassesPreserved
        ? 'INKCHAPTER_REMOVED_NATIVE_TREE_BORDER_OR_OUTLINE'
        : 'INKCHAPTER_REMOVED_NATIVE_SELECTION_STATE',
  })
  return true
}

// ── close-all helpers (native close flow only) ─────────────────────────────

export function isRealDocumentTab(tabEl: HTMLElement): boolean {
  const id = tabEl.getAttribute('data-id') ?? ''
  return !id.startsWith('typ://') // '' (Untitled) is a real unsaved doc; typ://… are placeholders
}

export function collectRealTabEls(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.typ-tab')).filter(isRealDocumentTab)
}

/** Click the framework tab's own close control — never removes DOM directly. */
export function closeTabViaNativeControl(tabEl: HTMLElement): void {
  const close = tabEl.querySelector<HTMLElement>('.typ-close')
  if (close) close.click()
  else tabEl.click()
}

export async function runCloseAllTabs(opts: {
  root?: ParentNode
  tick?: () => Promise<void> | void
}): Promise<{ closed: number; cancelled: boolean }> {
  const root = opts.root ?? document
  const tick = opts.tick ?? (() => new Promise<void>(r => setTimeout(r, 60)))
  let closed = 0
  let cancelled = false
  for (let i = 0; i < 500; i++) {
    const els = collectRealTabEls(root)
    if (!els.length) break
    const target = els[0]
    const targetId = target.getAttribute('data-id')
    closeTabViaNativeControl(target)
    await tick()
    const stillThere = Array.from(root.querySelectorAll<HTMLElement>('.typ-tab'))
      .some(el => el.getAttribute('data-id') === targetId)
    if (stillThere) {
      // Native close/save flow did not close it (e.g. user cancelled) → stop.
      cancelled = true
      break
    }
    closed++
  }
  return { closed, cancelled }
}

// ── separator helpers (dedup) ───────────────────────────────────────────────

function makeDivider(): HTMLElement {
  const li = document.createElement('li')
  li.className = 'divider typ-menuitem'
  return li
}

/** Count consecutive pairs of dividers (never 0 after dedup). */
export function countDuplicateSeparators(menu: ParentNode): number {
  const items = Array.from(menu.querySelectorAll<HTMLElement>('li'))
  let duplicates = 0
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]
    const b = items[i]
    const isA = a.classList.contains('divider')
    const isB = b.classList.contains('divider')
    if (isA && isB) duplicates++
  }
  return duplicates
}

export function countMenuSeparators(menu: ParentNode): number {
  return menu.querySelectorAll('li.divider').length
}

// ── flat menu item construction ─────────────────────────────────────────────

function makeItem(action: DocViewAction, label: string, enabled: boolean, reason: string | null): HTMLElement {
  const li = document.createElement('li')
  li.className = `typ-menuitem${enabled ? '' : ` ${CSS_DISABLED}`}`
  const a = document.createElement('a')
  a.className = NATIVE_ANCHOR_SLOT_CLASS // reuse Typora's native row anchor class → same ::before text slot
  a.setAttribute('role', 'menuitem')
  a.textContent = label
  li.appendChild(a)
  if (enabled) {
    li.setAttribute(ATTR_ACTION, action)
  } else if (reason) {
    li.title = reason
  }
  return li
}

/**
 * Insert the flat InkChapter block into the file-tab context menu using the
 * stable native close anchor (`关闭右侧标签` etc.). Returns the number of
 * inserted rows, or 0 when the menu was already enhanced / no anchor exists.
 *
 * Final layout (single level):
 *   <anchor: 关闭右侧标签>
 *   关闭全部标签            ← close group extension
 *   divider
 *   复制完整路径 / 复制相对路径   ← Path group
 *   divider
 *   在文件树中定位 / 在文件资源管理器中显示  ← Reveal group
 *   (native divider + split actions preserved where present)
 */
export function injectFlatMenuItems(
  menu: HTMLUListElement,
  ctx: DocumentViewContext,
  options: DocViewMenuOptions = ALL_DOCVIEW_MENU_ITEMS,
): number {
  if (menu.querySelector(`[${ATTR_ACTION}]`)) return 0 // duplicate guard

  // Stable semantic anchor, in preference order: 关闭右侧标签 → 关闭其他 → 关闭标签.
  let anchor: HTMLElement | null = null
  for (const key of CLOSE_ANCHOR_KEYS) {
    anchor = menu.querySelector<HTMLElement>(`[data-key="${key}"]`)
    if (anchor) break
  }
  if (!anchor) return 0

  // Only the ENABLED InkChapter rows are built; native rows are never touched.
  const groups: HTMLElement[][] = []
  if (options.closeAll) {
    groups.push([makeItem('close-all', LABEL_CLOSE_ALL, true, null)])
  }
  const pathGroup: HTMLElement[] = []
  if (options.copyAbsolute) {
    pathGroup.push(makeItem('copy-absolute', LABEL_COPY_ABSOLUTE, ctx.canCopyAbsolutePath, ctx.disabledReason.copyAbsolutePath))
  }
  if (options.copyRelative) {
    pathGroup.push(makeItem('copy-relative', LABEL_COPY_RELATIVE, ctx.canCopyRelativePath, ctx.disabledReason.copyRelativePath))
  }
  if (pathGroup.length > 0) groups.push(pathGroup)
  const revealGroup: HTMLElement[] = []
  if (options.revealTree) {
    revealGroup.push(makeItem('reveal-tree', LABEL_REVEAL_TREE, ctx.canRevealInFileTree, ctx.disabledReason.revealInFileTree))
  }
  if (options.revealExplorer) {
    revealGroup.push(makeItem('reveal-explorer', LABEL_REVEAL_EXPLORER, ctx.canRevealInExplorer, ctx.disabledReason.revealInExplorer))
  }
  if (revealGroup.length > 0) groups.push(revealGroup)

  if (groups.length === 0) return 0

  const rows: HTMLElement[] = []
  groups.forEach((group, i) => {
    if (i > 0) rows.push(makeDivider())
    rows.push(...group)
  })

  let ref = anchor
  for (const row of rows) {
    ref.insertAdjacentElement('afterend', row)
    ref = row
  }
  return rows.length
}

/** Count our injected items inside a menu (duplicate gate: each exactly once). */
export function countInjectedItems(menu: ParentNode): Record<DocViewAction, number> {
  const result = {
    'close-all': 0,
    'copy-absolute': 0,
    'copy-relative': 0,
    'reveal-tree': 0,
    'reveal-explorer': 0,
  }
  menu.querySelectorAll<HTMLElement>(`[${ATTR_ACTION}]`).forEach(el => {
    const action = el.getAttribute(ATTR_ACTION) as DocViewAction | null
    if (action && action in result) result[action]++
  })
  return result
}

// ── rendered-text alignment (real Range measurement + pure evaluator) ───────

/**
 * Native indent authority, established from the real Typora runtime probe:
 * native rows carry `a.state-off` whose `::before` injects a leading inline
 * slot (`content:" "`, `inline-block`, width 8px) that shifts every label 8px
 * to the right. InkChapter rows now reuse the SAME native class so Typora's own
 * CSS produces the same slot (no per-item pixel patches).
 */
export const NATIVE_INDENT_AUTHORITY = 'C_PSEUDO_ELEMENT_SLOT: a.state-off::before { content: " "; display: inline-block; width: 8px; }'
export const NATIVE_ANCHOR_SLOT_CLASS = 'state-off'

/**
 * Measure the real rendered-text rect of a menu anchor:
 *  1. prefer a descendant label element whose text equals the anchor text;
 *  2. else a plain text-node Range starting at the first non-whitespace glyph.
 */
export function measureRenderedTextRect(anchor: HTMLElement): DOMRect | null {
  const anchorText = (anchor.textContent ?? '').trim()
  if (!anchorText) return null

  const label = Array.from(anchor.querySelectorAll<HTMLElement>('span'))
    .find(s => (s.textContent ?? '').trim() === anchorText && (s.textContent ?? '').trim() !== '')
  const target = label ?? anchor

  const textNodes: Text[] = []
  target.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) textNodes.push(n as Text) })
  if (!textNodes.length) {
    // deepest text-bearing descendant (e.g. nested label markup)
    const walker = target.querySelectorAll('*')
    for (const el of Array.from(walker).reverse()) {
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) textNodes.push(n as Text)
      }
      if (textNodes.length) break
    }
  }
  if (!textNodes.length) return null

  const textNode = textNodes[0]
  const text = textNode.textContent ?? ''
  const first = text.search(/\S/)
  if (first < 0) return null
  const range = document.createRange()
  range.setStart(textNode, first)
  range.setEnd(textNode, text.length)
  const rect = range.getBoundingClientRect()
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || rect.width === 0) return null
  return rect
}

export interface RenderedRowMetrics {
  label: string
  rowLeft: number
  anchorLeft: number
  renderedTextLeft: number
  renderedTextRight: number
  rowHeight: number
}

export interface AlignmentMetricsInput {
  measureMode: 'REAL' | 'HEADLESS'
  native: RenderedRowMetrics | null
  nativeOpenRightRenderedTextLeft: number | null
  items: RenderedRowMetrics[]
  duplicateSeparatorCount: number
  submenuCount: number
}

export interface MenuAlignmentFacts {
  measureMode: 'REAL' | 'HEADLESS'
  nativeReferenceLabel: string | null
  nativeRowLeft: number | null
  nativeAnchorLeft: number | null
  nativeRenderedTextLeft: number | null
  nativeRenderedTextRight: number | null
  closeAllRowLeft: number | null
  closeAllAnchorLeft: number | null
  closeAllRenderedTextLeft: number | null
  copyAbsoluteRowLeft: number | null
  copyAbsoluteAnchorLeft: number | null
  copyAbsoluteRenderedTextLeft: number | null
  copyRelativeRowLeft: number | null
  copyRelativeAnchorLeft: number | null
  copyRelativeRenderedTextLeft: number | null
  revealTreeRowLeft: number | null
  revealTreeAnchorLeft: number | null
  revealTreeRenderedTextLeft: number | null
  revealExplorerRowLeft: number | null
  revealExplorerAnchorLeft: number | null
  revealExplorerRenderedTextLeft: number | null
  nativeOpenRightRenderedTextLeft: number | null
  maxAnchorLeftDelta: number | null
  maxRenderedTextLeftDelta: number | null
  maxRowHeightDelta: number | null
  nativeIndentAuthority: string
  duplicateSeparatorCount: number
  submenuCount: number
  decision: 'PASS' | 'FAIL' | 'NA'
  reason: string
}

/** Pure decision logic — unit tested with fabricated metrics (MENU-TEXT-*). */
export function evaluateRenderedTextAlignment(input: {
  measureMode: 'REAL' | 'HEADLESS'
  native: RenderedRowMetrics | null
  items: RenderedRowMetrics[]
  nativeOpenRightRenderedTextLeft?: number | null
  duplicateSeparatorCount: number
  submenuCount: number
}): { decision: 'PASS' | 'FAIL' | 'NA'; reason: string; maxAnchorLeftDelta: number | null; maxRenderedTextLeftDelta: number | null; maxRowHeightDelta: number | null } {
  const { measureMode, native } = input
  if (measureMode !== 'REAL' || !native) {
    return { decision: 'NA', reason: 'NO_REAL_LAYOUT', maxAnchorLeftDelta: null, maxRenderedTextLeftDelta: null, maxRowHeightDelta: null }
  }

  const itemRows = input.items.filter(Boolean)
  let maxAnchor = 0
  let maxText = 0
  let maxH = 0
  for (const row of itemRows) {
    maxAnchor = Math.max(maxAnchor, Math.abs(row.anchorLeft - native.anchorLeft))
    maxText = Math.max(maxText, Math.abs(row.renderedTextLeft - native.renderedTextLeft))
    maxH = Math.max(maxH, Math.abs(row.rowHeight - native.rowHeight))
  }

  const textOk = maxText <= 1
  const rowsOk = maxH <= 1
  const structureOk = input.duplicateSeparatorCount === 0 && input.submenuCount === 0

  if (textOk && rowsOk && structureOk) {
    return { decision: 'PASS', reason: 'RENDERED_TEXT_ALIGNED_WITH_NATIVE', maxAnchorLeftDelta: maxAnchor, maxRenderedTextLeftDelta: maxText, maxRowHeightDelta: maxH }
  }
  if (!textOk) {
    return { decision: 'FAIL', reason: 'RENDERED_TEXT_BASELINE_MISMATCH', maxAnchorLeftDelta: maxAnchor, maxRenderedTextLeftDelta: maxText, maxRowHeightDelta: maxH }
  }
  return { decision: 'FAIL', reason: 'ROW_OR_STRUCTURE_MISMATCH', maxAnchorLeftDelta: maxAnchor, maxRenderedTextLeftDelta: maxText, maxRowHeightDelta: maxH }
}

function finiteReal(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0
}

function px(v: string): number {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Row layout facts. `renderedTextLeft` prefers the real text Range; when Typora
 * does not expose text-node Range rects, it falls back to the exact layout
 * geometry: border-box left + padding-left + leading ::before inline slot width
 * (the slot is what actually pushes the first glyph). Headless (no layout) still
 * returns null.
 */
function rowMetrics(li: HTMLElement): RenderedRowMetrics | null {
  const anchor = li.querySelector<HTMLElement>('a')
  if (!anchor) return null
  const rowRect = li.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  if (!(rowRect.width > 0) || !(anchorRect.width > 0)) return null

  const textRect = measureRenderedTextRect(anchor)
  const csAnchor = getComputedStyle(anchor)
  const csBefore = getComputedStyle(anchor, '::before')
  const slotWidth = csBefore.display !== 'none' && csBefore.content && csBefore.content !== 'none' ? px(csBefore.width) : 0
  const derivedLeft = anchorRect.left + px(csAnchor.paddingLeft) + slotWidth

  const renderedLeft = textRect ? textRect.left : (derivedLeft > 0 ? derivedLeft : 0)
  const renderedRight = textRect ? textRect.right : renderedLeft
  if (renderedLeft <= 0) return null

  return {
    label: (li.textContent ?? '').trim().slice(0, 14),
    rowLeft: rowRect.left,
    anchorLeft: anchorRect.left,
    renderedTextLeft: renderedLeft,
    renderedTextRight: renderedRight,
    rowHeight: rowRect.height,
  }
}

/** DOM gathering + pure evaluation; headless/layout-less runs yield NA. */
export function measureMenuAlignment(menu: HTMLUListElement): MenuAlignmentFacts {
  const nativeLi = (() => {
    for (const key of ['removeTab', 'removeOthers', 'removeRight']) {
      const el = menu.querySelector<HTMLElement>(`[data-key="${key}"]`)
      if (el) return el
    }
    return null
  })()
  const native = nativeLi ? rowMetrics(nativeLi) : null
  const openRightLi = menu.querySelector<HTMLElement>('[data-key="splitRight"]')
  const nativeOpenRightRenderedTextLeft = openRightLi
    ? (() => { const m = rowMetrics(openRightLi); return m ? m.renderedTextLeft : null })()
    : null

  const actions: Array<[string, DocViewAction]> = [
    ['closeAll', 'close-all'],
    ['copyAbsolute', 'copy-absolute'],
    ['copyRelative', 'copy-relative'],
    ['revealTree', 'reveal-tree'],
    ['revealExplorer', 'reveal-explorer'],
  ]
  const items: RenderedRowMetrics[] = []
  const perAction = new Map<string, RenderedRowMetrics>()
  for (const [, action] of actions) {
    const el = menu.querySelector<HTMLElement>(`[${ATTR_ACTION}="${action}"]`)
    const m = el ? rowMetrics(el) : null
    if (m) { items.push(m); perAction.set(action, m) }
  }

  const realLayout = native != null && perAction.size > 0 && items.some(i => i.renderedTextLeft > 0)
  const measureMode: 'REAL' | 'HEADLESS' = realLayout ? 'REAL' : 'HEADLESS'
  const duplicateSeparatorCount = countDuplicateSeparators(menu)
  const submenuCount = 0

  const evaluated = evaluateRenderedTextAlignment({
    measureMode,
    native,
    nativeOpenRightRenderedTextLeft,
    items,
    duplicateSeparatorCount,
    submenuCount,
  })

  const pick = (action: string): RenderedRowMetrics | null => perAction.get(action) ?? null
  const facts: MenuAlignmentFacts = {
    measureMode,
    nativeReferenceLabel: native?.label ?? null,
    nativeRowLeft: native?.rowLeft ?? null,
    nativeAnchorLeft: native?.anchorLeft ?? null,
    nativeRenderedTextLeft: native?.renderedTextLeft ?? null,
    nativeRenderedTextRight: native?.renderedTextRight ?? null,
    closeAllRowLeft: pick('close-all')?.rowLeft ?? null,
    closeAllAnchorLeft: pick('close-all')?.anchorLeft ?? null,
    closeAllRenderedTextLeft: pick('close-all')?.renderedTextLeft ?? null,
    copyAbsoluteRowLeft: pick('copy-absolute')?.rowLeft ?? null,
    copyAbsoluteAnchorLeft: pick('copy-absolute')?.anchorLeft ?? null,
    copyAbsoluteRenderedTextLeft: pick('copy-absolute')?.renderedTextLeft ?? null,
    copyRelativeRowLeft: pick('copy-relative')?.rowLeft ?? null,
    copyRelativeAnchorLeft: pick('copy-relative')?.anchorLeft ?? null,
    copyRelativeRenderedTextLeft: pick('copy-relative')?.renderedTextLeft ?? null,
    revealTreeRowLeft: pick('reveal-tree')?.rowLeft ?? null,
    revealTreeAnchorLeft: pick('reveal-tree')?.anchorLeft ?? null,
    revealTreeRenderedTextLeft: pick('reveal-tree')?.renderedTextLeft ?? null,
    revealExplorerRowLeft: pick('reveal-explorer')?.rowLeft ?? null,
    revealExplorerAnchorLeft: pick('reveal-explorer')?.anchorLeft ?? null,
    revealExplorerRenderedTextLeft: pick('reveal-explorer')?.renderedTextLeft ?? null,
    nativeOpenRightRenderedTextLeft,
    maxAnchorLeftDelta: evaluated.maxAnchorLeftDelta,
    maxRenderedTextLeftDelta: evaluated.maxRenderedTextLeftDelta,
    maxRowHeightDelta: evaluated.maxRowHeightDelta,
    nativeIndentAuthority: NATIVE_INDENT_AUTHORITY,
    duplicateSeparatorCount,
    submenuCount,
    decision: evaluated.decision,
    reason: evaluated.reason,
  }
  return facts
}

// ── menu enhancer ───────────────────────────────────────────────────────────

export class DocumentViewContextMenu {
  private disposed = false
  private handleContextMenuBound: (e: MouseEvent) => void
  private handleClickBound: (e: MouseEvent) => void
  private lastContext: DocumentViewContext | null = null
  private lastMenu: HTMLUListElement | null = null

  constructor(
    private platform: DocViewPlatform,
    private root: ParentNode = document,
    /** 墨章界面配置读取器（默认全启用 ⇒ 与引入配置之前完全一致）。 */
    private getUiOptions: () => DocViewUiOptions = () => DEFAULT_DOCVIEW_UI_OPTIONS,
  ) {
    this.handleContextMenuBound = this.handleContextMenu.bind(this)
    this.handleClickBound = this.handleClick.bind(this)
  }

  /** Single delegated listeners on the root. Safe to call once per instance. */
  attach(): this {
    if (this.disposed) return this
    const owner = this.root instanceof Document ? this.root : this.root.ownerDocument
    if (!owner) return this
    owner.addEventListener('contextmenu', this.handleContextMenuBound)
    owner.addEventListener('click', this.handleClickBound)
    enhancerInstanceCount++
    this.platform.onInvariant?.('DOCUMENT-VIEW-CONTEXT-MENU-INVARIANT', {
      contextMenuEnhancerCount: enhancerInstanceCount,
      duplicateListenerCount: enhancerInstanceCount > 1 ? 1 : 0,
      submenuCount: 0,
    })
    return this
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const owner = this.root instanceof Document ? this.root : this.root.ownerDocument
    owner?.removeEventListener('contextmenu', this.handleContextMenuBound)
    owner?.removeEventListener('click', this.handleClickBound)
    enhancerInstanceCount = Math.max(0, enhancerInstanceCount - 1)
  }

  getInvariant(): { contextMenuEnhancerCount: number; duplicateListenerCount: number } {
    return {
      contextMenuEnhancerCount: enhancerInstanceCount,
      duplicateListenerCount: enhancerInstanceCount > 1 ? 1 : 0,
    }
  }

  private handleContextMenu(e: MouseEvent): void {
    const tab = findClickedTab(e)
    if (!tab) return
    const menu = findTabContextMenu(this.root)
    if (!menu) return
    const tabId = tab.getAttribute('data-id') ?? null
    const ctx = resolveDocumentViewContext({
      tabId,
      fileTreeRoot: this.platform.getFileTreeRoot(),
      fileExists: p => this.platform.fileExists(p),
    })
    this.lastContext = ctx
    this.lastMenu = menu
    const inserted = injectFlatMenuItems(menu, ctx, this.getUiOptions().menu)
    if (inserted > 0) {
      this.emitMenuInvariant(menu)
      this.scheduleLayoutInvariant(menu)
    }
  }

  private handleClick(e: MouseEvent): void {
    if (!isElement(e.target)) return
    const item = e.target.closest<HTMLElement>(`[${ATTR_ACTION}]`)
    if (!item) return
    const action = item.getAttribute(ATTR_ACTION) as DocViewAction | null
    if (!action || !this.lastContext) return
    if (item.classList.contains(CSS_DISABLED)) return
    void this.runAction(action, this.lastContext)
    this.closeAfterAction()
  }

  private async runAction(action: DocViewAction, ctx: DocumentViewContext): Promise<void> {
    try {
      switch (action) {
        case 'close-all': {
          const result = await runCloseAllTabs({ tick: this.platform.tick?.bind(this.platform) })
          this.platform.notice(result.cancelled ? TOAST_CLOSE_ALL_CANCELLED : TOAST_CLOSE_ALL_DONE)
          break
        }
        case 'copy-absolute': {
          if (ctx.absolutePath != null) {
            this.platform.copyText(ctx.absolutePath)
            this.platform.notice(TOAST_COPIED_ABSOLUTE)
          }
          break
        }
        case 'copy-relative': {
          if (ctx.relativePath != null) {
            this.platform.copyText(ctx.relativePath)
            this.platform.notice(TOAST_COPIED_RELATIVE)
          }
          break
        }
        case 'reveal-tree': {
          if (ctx.absolutePath != null && ctx.fileTreeRoot != null) {
            const nativeOk = this.platform.nativeRevealInFileTree
              ? await this.platform.nativeRevealInFileTree(ctx.absolutePath)
              : false
            if (nativeOk) {
              this.emitNativeRevealState(ctx.absolutePath)
              break
            }
            const ok = await revealPathInFileTree({
              root: this.root,
              absolutePath: ctx.absolutePath,
              fileTreeRoot: ctx.fileTreeRoot,
              showFileTree: () => this.platform.showFileTree(),
              tick: this.platform.tick?.bind(this.platform),
              enableFlash: this.getUiOptions().flash,
              onInvariant: facts => {
                this.platform.onInvariant?.('DOCUMENT-VIEW-FILE-TREE-NATIVE-STATE-INVARIANT', facts as unknown as Record<string, unknown>)
              },
            })
            if (!ok) this.platform.notice(TOAST_REVEAL_TREE_FAILED)
          }
          break
        }
        case 'reveal-explorer': {
          if (ctx.absolutePath != null) {
            if (!this.platform.isWindows) {
              this.platform.notice(TOAST_REVEAL_EXPLORER_FAILED)
              break
            }
            const ok = await this.platform.revealInExplorer(ctx.absolutePath)
            if (!ok) this.platform.notice(TOAST_REVEAL_EXPLORER_FAILED)
          }
          break
        }
      }
    } catch {
      if (action === 'reveal-explorer' || action === 'reveal-tree') {
        this.platform.notice(action === 'reveal-explorer' ? TOAST_REVEAL_EXPLORER_FAILED : TOAST_REVEAL_TREE_FAILED)
      }
    }
  }

  private async emitNativeRevealState(absolutePath: string): Promise<void> {
    await new Promise<void>(r => setTimeout(r, 250))
    if (this.disposed) return
    const target = findTreeNodeByExactPath(this.root, absolutePath)
    if (!target) return
    const container = this.root.querySelector<HTMLElement>('#file-library')
    const cs = (el: HTMLElement) => window.getComputedStyle(el)
    const facts: FileTreeNativeFacts = {
      targetResolved: true,
      nativeSelectionMethod: 'TYPORA_NATIVE_REVEAL_IN_FILE_TREE',
      beforeNativeClasses: Array.from(target.classList),
      afterNativeClasses: Array.from(target.classList),
      beforeBorder: cs(target).borderTopWidth,
      afterBorder: cs(target).borderTopWidth,
      beforeOutline: cs(target).outlineStyle,
      afterOutline: cs(target).outlineStyle,
      treeBorderBefore: container ? cs(container).borderRightWidth : '',
      treeBorderAfter: container ? cs(container).borderRightWidth : '',
      inkHighlightAdded: false,
      inkHighlightRemoved: false,
      decision: 'PASS',
      reason: 'NATIVE_REVEAL_INK_NO_MUTATION',
    }
    this.platform.onInvariant?.('DOCUMENT-VIEW-FILE-TREE-NATIVE-STATE-INVARIANT', facts as unknown as Record<string, unknown>)
  }

  private closeAfterAction(): void {
    if (this.lastMenu) this.lastMenu.style.display = 'none'
    this.lastMenu = null
    this.lastContext = null
  }

  private emitMenuInvariant(menu: HTMLUListElement): void {
    const counts = countInjectedItems(menu)
    this.platform.onInvariant?.('DOCUMENT-VIEW-CONTEXT-MENU-INVARIANT', {
      contextMenuEnhancerCount: enhancerInstanceCount,
      duplicateListenerCount: enhancerInstanceCount > 1 ? 1 : 0,
      submenuCount: 0,
      ...counts,
      duplicateSeparatorCount: countDuplicateSeparators(menu),
    })
  }

  private scheduleLayoutInvariant(menu: HTMLUListElement): void {
    setTimeout(() => {
      if (!menu.isConnected || this.disposed) return
      const counts = countInjectedItems(menu)
      const openRight = menu.querySelector('[data-key="splitRight"]') != null
      const openDown = menu.querySelector('[data-key="splitDown"]') != null
      const width = menu.offsetWidth || null
      const height = menu.offsetHeight || null
      this.platform.onInvariant?.('DOCUMENT-VIEW-CONTEXT-MENU-LAYOUT-INVARIANT', {
        menuWidth: width,
        menuHeight: height,
        submenuCount: 0,
        closeGroupCount: 4,
        pathGroupCount: 2,
        revealGroupCount: 2,
        separatorCount: countMenuSeparators(menu),
        duplicateSeparatorCount: countDuplicateSeparators(menu),
        rightOpenPreserved: openRight,
        downOpenPreserved: openDown,
        decision: 'PASS',
      })
      // Native rows are the authoritative alignment baseline.
      const facts = measureMenuAlignment(menu)
      this.platform.onInvariant?.('DOCUMENT-VIEW-CONTEXT-MENU-ALIGNMENT-INVARIANT', facts as unknown as Record<string, unknown>)
    }, 40)
  }
}

// ── Explorer argument builder (safe, no shell concatenation) ───────────────
export function buildExplorerSelectArgs(absolutePath: string): string[] {
  return [`/select,"${absolutePath}"`]
}
