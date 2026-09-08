/**
 * Empty Workspace UX V1 — EMPTY / New-tab placeholder close suppression +
 * blank-workspace double-click Markdown creation.
 *
 * Authority: this module consumes the EXISTING `ActiveDocumentPresence` three
 * state (ACTIVE / EMPTY / UNKNOWN) — it NEVER creates a second
 * isNewTab / isNoFile / isEmptyScreen string-based vocabulary.
 *
 *  - EMPTY placeholder tab ("New tab") is NOT a closeable document:
 *    closeEligible=false → InkChapter marker `data-ink-empty-placeholder="true"`
 *    → scoped CSS folds the close slot (`display:none`). Hover / focus never
 *    reveal an ×. Real Markdown tabs are never touched.
 *  - While EMPTY, a scoped `dblclick` on the editor content surface creates
 *    exactly ONE new `.md` file (exclusive create, unique 未命名 name) inside
 *    the resolved file-tree directory, then opens it through the injected
 *    platform open-file API (never a simulated menu click). A transaction guard
 *    (IDLE → CREATING → OPENING → COMPLETE → IDLE) prevents duplicates.
 *
 * Pure functions below are DOM/fs free; the controller is the single DOM writer
 * and single listener owner.
 */
import { join } from 'path'

export const EMPTY_PLACEHOLDER_ATTR = 'data-ink-empty-placeholder'
export const EMPTY_DEFAULT_BASE_NAME = '未命名'
export const EMPTY_FILE_EXT = '.md'
export const EMPTY_NAME_COLLISION_MAX = 200

export type EmptyWorkspaceTxnState = 'IDLE' | 'CREATING' | 'OPENING' | 'COMPLETE'
export type EmptyCreateDecisionReason =
  | 'CREATED_AND_OPENED'
  | 'FILE_CREATED_OPEN_FAILED'
  | 'CREATE_FAILED'
  | 'REJECT_NO_FILE_TREE_ROOT'
  | 'REJECT_PRESENCE_NOT_EMPTY'
  | 'REJECT_NOT_LEFT'
  | 'REJECT_DETAIL'
  | 'REJECT_STALE_SURFACE'
  | 'REJECT_SURFACE_MISMATCH'
  | 'REJECT_BUTTON_NOT_LEFT'
  | 'REJECT_INTERACTIVE_TARGET'
  | 'IGNORE_TXN_BUSY'

// ── Transaction guard ───────────────────────────────────────────────────────
export class EmptyCreateTransactionGuard {
  state: EmptyWorkspaceTxnState = 'IDLE'

  canStart(): boolean {
    return this.state === 'IDLE'
  }

  startCreate(): boolean {
    if (this.state !== 'IDLE') return false
    this.state = 'CREATING'
    return true
  }

  toOpening(): void {
    this.state = 'OPENING'
  }

  toComplete(): void {
    this.state = 'COMPLETE'
  }

  reset(): void {
    this.state = 'IDLE'
  }
}

// ── Pure: create directory resolution (§11/§12) ────────────────────────────
export interface FileTreeSelectionFacts {
  root: string | null
  selectedPath: string | null
  selectedKind: 'directory' | 'file' | null
}

export type EmptyCreateDirectoryResolution =
  | { kind: 'directory'; directory: string; basis: 'SELECTED_DIRECTORY' | 'SELECTED_FILE_PARENT' | 'FILE_TREE_ROOT' }
  | { kind: 'reject'; reason: 'NO_FILE_TREE_ROOT' }

/** Hard-coded paths are forbidden. Only the injected file-tree facts decide. */
export function resolveEmptyWorkspaceCreateDirectory(f: FileTreeSelectionFacts): EmptyCreateDirectoryResolution {
  if (!f.root || f.root === '') return { kind: 'reject', reason: 'NO_FILE_TREE_ROOT' }
  if (f.selectedPath && f.selectedPath !== '') {
    if (f.selectedKind === 'directory') {
      return { kind: 'directory', directory: f.selectedPath, basis: 'SELECTED_DIRECTORY' }
    }
    if (f.selectedKind === 'file') {
      return { kind: 'directory', directory: dirnameSafe(f.selectedPath), basis: 'SELECTED_FILE_PARENT' }
    }
  }
  return { kind: 'directory', directory: f.root, basis: 'FILE_TREE_ROOT' }
}

function dirnameSafe(p: string): string {
  const i = p.lastIndexOf('/')
  const j = p.lastIndexOf('\\')
  const k = Math.max(i, j)
  if (k <= 0) return p
  return p.slice(0, k)
}

// ── Pure: unique Markdown file name (§13) ───────────────────────────────────
export interface ResolvedEmptyMarkdownName {
  fileName: string
  absolutePath: string
  collisionIndex: number
}

/** 未命名.md → 未命名 2.md → 未命名 3.md … (never returns an existing path). */
export function resolveUncollidedMarkdownName(
  exists: (absolutePath: string) => boolean,
  directory: string,
  base: string = EMPTY_DEFAULT_BASE_NAME,
  ext: string = EMPTY_FILE_EXT,
): ResolvedEmptyMarkdownName {
  for (let collisionIndex = 0; collisionIndex < EMPTY_NAME_COLLISION_MAX; collisionIndex++) {
    const fileName = collisionIndex === 0 ? `${base}${ext}` : `${base} ${collisionIndex + 1}${ext}`
    const absolutePath = join(directory, fileName)
    if (!exists(absolutePath)) return { fileName, absolutePath, collisionIndex }
  }
  // Last resort: keep increasing is impossible within bound — use a timestamped
  // name so we NEVER overwrite an existing file.
  const fileName = `${base} ${Date.now()}${ext}`
  return { fileName, absolutePath: join(directory, fileName), collisionIndex: EMPTY_NAME_COLLISION_MAX }
}

// ── Pure: double-click intent gate (§9/§10) ─────────────────────────────────
/**
 * Interactive target/ancestor gate (V3 — REAL interactive controls only).
 * Walk from the target up to `boundary` (inclusive). Returns true ONLY when the
 * click landed on an actual control: a/button/input/textarea/select/option/
 * [role=button]/menu/menuitem/shortcut-entry. A generic `contenteditable`
 * ancestor is NOT a control — the EMPTY view surface itself (or the container
 * that hosts it) may legitimately sit inside an editable-looking wrapper, so a
 * plain contenteditable attribute must never veto the whole surface.
 */
export function isInteractiveDoubleClickTarget(
  target: EventTarget | null,
  boundary: Element | null,
  _contentEditableBoundaryAllowed = true,
): boolean {
  if (!(target instanceof Element)) return false
  let el: Element | null = target
  while (el && el !== boundary) {
    if (el.matches?.('a,button,input,textarea,select,option,[role="button"],menu,menuitem')) return true
    el = el.parentElement
  }
  if (el === boundary && boundary) {
    if (boundary.matches?.('a,button,input,textarea,select,option,[role="button"],menu,menuitem')) return true
  }
  return false
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
const TAB_STRIPS_SELECTOR = '.typ-workspace-tabs .typ-tab, .typ-workspace-tab-header .typ-tab'

/** EMPTY placeholder tab identity: active native tab whose identity is NOT a
 *  real saved file (data-id missing or a `typ://` framework/empty id). Never
 *  depends on the visible "New tab" text. */
export function isEmptyPlaceholderTab(el: Element | null): boolean {
  if (!el || !el.classList.contains('active')) return false
  const id = el.getAttribute('data-id')
  if (id && id !== '' && !id.startsWith('typ://')) return false
  return true
}

/**
 * Single writer for the EMPTY placeholder marker. presence empty:
 *  - add `data-ink-empty-placeholder="true"` to the ACTIVE empty tab only,
 *  - mark its × as aria-hidden + non-focusable (closeEligible=false).
 * presence active/unknown: remove every InkChapter marker it previously wrote.
 * Real document tabs never get the marker (their data-id is a real path).
 */
export function applyEmptyPlaceholderTabState(root: ParentNode, empty: boolean): { markerApplied: boolean; tabFound: boolean } {
  const tabs = Array.from(root.querySelectorAll<HTMLElement>(TAB_STRIPS_SELECTOR))
  let tabFound = false
  let markerApplied = false
  for (const tab of tabs) {
    const shouldMark = empty && isEmptyPlaceholderTab(tab)
    if (shouldMark) tabFound = true
    if (shouldMark) {
      tab.setAttribute(EMPTY_PLACEHOLDER_ATTR, 'true')
      const close = tab.querySelector<HTMLElement>('.typ-icon.typ-close')
      if (close) {
        close.setAttribute('aria-hidden', 'true')
        close.setAttribute('tabindex', '-1')
      }
      markerApplied = true
    } else if (tab.hasAttribute(EMPTY_PLACEHOLDER_ATTR)) {
      tab.removeAttribute(EMPTY_PLACEHOLDER_ATTR)
      const close = tab.querySelector<HTMLElement>('.typ-icon.typ-close')
      if (close) {
        close.removeAttribute('aria-hidden')
        close.removeAttribute('tabindex')
      }
    }
  }
  return { tabFound, markerApplied }
}

export function findEmptyPlaceholderMarkedTabs(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.typ-tab[${EMPTY_PLACEHOLDER_ATTR}="true"]`))
}

// ── File-tree selection DOM read (read-only; data-path identity, no text) ───
export interface RawFileTreeSelection {
  path: string | null
}

const FILE_TREE_SELECTOR =
  '#file-library-tree .file-library-node.selected, #file-library-tree .file-library-node.active,' +
  '#file-library .file-library-node.selected, #file-library .file-library-node.active,' +
  '#typora-sidebar .file-library-node.selected, #typora-sidebar .file-library-node.active'

export function readFileTreeSelectionPath(root: ParentNode = document): string | null {
  const el = root.querySelector<HTMLElement>(FILE_TREE_SELECTOR)
  if (!el) return null
  const p = el.getAttribute('data-path')
  return p && p !== '' ? p : null
}
