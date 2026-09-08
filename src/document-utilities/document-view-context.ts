/**
 * InkChapter — Document View context & path semantics (pure).
 *
 * Single source of truth for the "墨章 · 文档查看" tab actions:
 *  - absolute path of the RIGHT-CLICKED tab (never the active doc).
 *  - relative path semantics: RELATIVE_PATH_BASE = CURRENT_FILE_TREE_ROOT.
 *  - saved / inside-root / no-root / outside-root / unsaved guards.
 *
 * All path math is deliberately performed with Node `path.win32` so that a
 * Markdown document opened in Typora on Windows is handled deterministically
 * (drive letters, backslashes, sibling-prefix containment like `vault` vs
 * `vault2`), independent of the host OS where the unit tests run.
 *
 * The module is pure (no DOM / fs / typora imports) so every rule is unit
 * testable (DOCVIEW-*, PATH-*).
 */
import * as path from 'path'

/** Deterministic Windows path semantics (drive letters, backslashes). */
const winpath = path.win32

/** "打开/新建但尚未保存" tab ids (empty Untitled or framework virtual ids). */
export function isUnsavedTabId(tabId: string | null | undefined): boolean {
  if (!tabId) return true
  if (tabId.startsWith('typ://')) return true
  return false
}

/**
 * A tab id is a REAL saved file path when it looks like an absolute path and is
 * not one of the framework's virtual ids.
 */
export function looksLikeSavedFilePath(tabId: string | null | undefined): boolean {
  if (!tabId) return false
  if (isUnsavedTabId(tabId)) return false
  return winpath.isAbsolute(tabId)
}

/**
 * Compute `target` relative to `root`, both as Windows paths.
 * Returns `null` when `target` is NOT inside `root` (never yields `../..`).
 */
export function computeRelativeInsideRoot(root: string, target: string): string | null {
  if (!root || !target) return null
  const rel = winpath.relative(root, target)
  if (rel === '') return null // target == root (a folder, not a document)
  if (rel === '..') return null
  if (rel.startsWith(`..${winpath.sep}`)) return null
  if (winpath.isAbsolute(rel)) return null
  return rel
}

/**
 * Sibling-prefix-safe containment (PATH-4). `C:\work\vault2\a.md` must NOT be
 * considered inside `C:\work\vault`.
 */
export function isPathInsideRoot(root: string, target: string): boolean {
  return computeRelativeInsideRoot(root, target) != null
}

/** Relative path copied to the clipboard always uses `/`. */
export function normalizeRelativeForClipboard(rel: string): string {
  return rel.replace(/\\/g, '/')
}

/** CSS attribute selector safe escaping for `[data-path="…"]` lookups. */
export function escapeCssAttrQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export interface DocumentViewContextInput {
  /** `data-id` of the right-clicked tab element. */
  tabId: string | null
  /** Currently opened file tree root (vault / mount folder). Null in single-file mode. */
  fileTreeRoot: string | null
  /** Whether the file really exists on disk (fs). */
  fileExists: (absolutePath: string) => boolean
}

export interface DocumentViewContext {
  targetTabId: string | null
  /** Absolute path of the right-clicked tab when it is a real saved file. */
  absolutePath: string | null
  /** Current file tree root (CURRENT_FILE_TREE_ROOT). */
  fileTreeRoot: string | null
  isSavedDocument: boolean
  isInsideFileTreeRoot: boolean
  /** `/`-normalized relative path; non-null only when inside the root. */
  relativePath: string | null

  canCloseAllTabs: boolean
  canCopyAbsolutePath: boolean
  canCopyRelativePath: boolean
  canRevealInFileTree: boolean
  canRevealInExplorer: boolean

  /** Human reason used for the disabled menu item tooltip. */
  disabledReason: {
    copyAbsolutePath: string | null
    copyRelativePath: string | null
    revealInFileTree: string | null
    revealInExplorer: string | null
  }
}

export const REASON_UNSAVED = '当前文档尚未保存'
export const REASON_OUTSIDE_ROOT = '当前文档不在已打开的文件目录中'
export const REASON_NO_ROOT = '未打开文件夹'
export const REASON_FILE_MISSING = '文件不存在'

/**
 * Resolve the unified document-view context consumed by EVERY menu action, so
 * no action re-reads the DOM on its own.
 */
export function resolveDocumentViewContext(input: DocumentViewContextInput): DocumentViewContext {
  const tabId = input.tabId ?? null
  const fileTreeRoot = input.fileTreeRoot ?? null

  const isSavedDocument = looksLikeSavedFilePath(tabId)
  const absolutePath = isSavedDocument ? tabId : null

  const insideRoot = absolutePath != null && fileTreeRoot != null
    ? isPathInsideRoot(fileTreeRoot, absolutePath)
    : false

  const rel = absolutePath != null && fileTreeRoot != null
    ? computeRelativeInsideRoot(fileTreeRoot, absolutePath)
    : null
  const relativePath = rel != null ? normalizeRelativeForClipboard(rel) : null

  const exists = absolutePath != null ? input.fileExists(absolutePath) : false

  const reason = (): { copyAbsolutePath: string | null; copyRelativePath: string | null; revealInFileTree: string | null; revealInExplorer: string | null } => {
    if (!isSavedDocument) {
      return {
        copyAbsolutePath: REASON_UNSAVED,
        copyRelativePath: REASON_UNSAVED,
        revealInFileTree: REASON_UNSAVED,
        revealInExplorer: REASON_UNSAVED,
      }
    }
    if (absolutePath == null || !exists) {
      return {
        copyAbsolutePath: null,
        copyRelativePath: null,
        revealInFileTree: REASON_FILE_MISSING,
        revealInExplorer: REASON_FILE_MISSING,
      }
    }
    if (!fileTreeRoot) {
      return {
        copyAbsolutePath: null,
        copyRelativePath: REASON_NO_ROOT,
        revealInFileTree: REASON_NO_ROOT,
        revealInExplorer: null,
      }
    }
    if (!insideRoot) {
      return {
        copyAbsolutePath: null,
        copyRelativePath: REASON_OUTSIDE_ROOT,
        revealInFileTree: REASON_OUTSIDE_ROOT,
        revealInExplorer: null,
      }
    }
    return {
      copyAbsolutePath: null,
      copyRelativePath: null,
      revealInFileTree: null,
      revealInExplorer: null,
    }
  }

  const r = reason()
  return {
    targetTabId: tabId,
    absolutePath,
    fileTreeRoot,
    isSavedDocument,
    isInsideFileTreeRoot: insideRoot,
    relativePath,
    canCloseAllTabs: true,
    canCopyAbsolutePath: isSavedDocument,
    canCopyRelativePath: absolutePath != null && fileTreeRoot != null && insideRoot,
    canRevealInFileTree: absolutePath != null && fileTreeRoot != null && insideRoot && exists,
    canRevealInExplorer: absolutePath != null && exists,
    disabledReason: r,
  }
}
