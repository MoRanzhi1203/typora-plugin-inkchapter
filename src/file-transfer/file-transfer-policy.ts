/**
 * 文件树拖放策略 —— 纯函数，无 DOM / 无 Typora / 无 Electron 依赖。
 *
 * 负责回答四类问题：
 *   1. 这次拖放是不是「从 Windows 资源管理器拖入的外部文件」；
 *   2. 落点目录是不是当前 vault 之内（目录越界拒绝）；
 *   3. 哪些扩展名允许导入（只允许 .md / .markdown）；
 *   4. 拖出当前文档时是否需要提示「未保存修改不会写入拖出的副本」。
 *
 * 所有判断都可单测；真正的文件复制在 FileCopyService 中完成。
 */
import * as path from 'path'

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const

const CASE_INSENSITIVE_FS = process.platform === 'win32'

/** 用于路径比较的规范化形式（仅用于比较，不用于写盘）。 */
export function canonicalPathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/[\\/]+$/, '')
  return CASE_INSENSITIVE_FS ? resolved.toLowerCase() : resolved
}

export function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return canonicalPathForCompare(a) === canonicalPathForCompare(b)
}

/**
 * candidate 是否位于 root 之内（含 root 本身）。
 * 使用 path.relative 而不是字符串前缀，避免 `D:\vault2` 被误判为 `D:\vault` 的子路径。
 */
export function isPathInsideRoot(root: string | null | undefined, candidate: string | null | undefined): boolean {
  if (!root || !candidate) return false
  const rootResolved = path.resolve(root)
  const candidateResolved = path.resolve(candidate)
  const relative = path.relative(
    CASE_INSENSITIVE_FS ? rootResolved.toLowerCase() : rootResolved,
    CASE_INSENSITIVE_FS ? candidateResolved.toLowerCase() : candidateResolved,
  )
  if (relative === '') return true
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function isMarkdownPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  const ext = path.extname(filePath).toLowerCase()
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Chromium 从资源管理器拖入文件时，`DataTransfer.types` 一定包含 `"Files"`；
 * Typora 文件树内部拖动只写入 `"file"` / `"text/plain"`，不会包含 `"Files"`。
 */
export function isExternalFileDrag(types: readonly string[] | null | undefined): boolean {
  if (!types) return false
  return types.some(type => String(type) === 'Files')
}

export function isInternalFileTreeDrag(types: readonly string[] | null | undefined): boolean {
  if (!types) return false
  const list = types.map(String)
  return !list.includes('Files') && (list.includes('file') || list.includes('text/plain'))
}

/** 把 `file:///D:/a/b.md` 转换为本地路径；失败返回 null。 */
export function fileUriToPath(uri: string): string | null {
  const trimmed = uri.trim()
  if (!/^file:/i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    let pathname = decodeURIComponent(url.pathname)
    if (CASE_INSENSITIVE_FS) {
      pathname = pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\')
    }
    return pathname || null
  } catch {
    return null
  }
}

export interface DroppedPathSource {
  files?: ArrayLike<unknown> | null
  getData?: (format: string) => string
}

/**
 * 从 drop 事件同步提取源文件路径。
 * Electron 的 `File.path` 是首选；若不可用（例如合成事件），退回 `text/uri-list`。
 */
export function collectDroppedFilePaths(source: DroppedPathSource | null | undefined): string[] {
  if (!source) return []
  const paths: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | null | undefined): void => {
    if (!raw) return
    const value = raw.trim()
    if (!value) return
    const key = canonicalPathForCompare(value)
    if (seen.has(key)) return
    seen.add(key)
    paths.push(value)
  }

  if (source.files) {
    const count = source.files.length ?? 0
    for (let i = 0; i < count; i++) {
      const file = source.files[i] as { path?: unknown } | null | undefined
      const raw = file?.path
      if (typeof raw === 'string') push(raw)
    }
  }

  if (paths.length === 0 && typeof source.getData === 'function') {
    let uriList = ''
    try {
      uriList = source.getData('text/uri-list') || ''
    } catch {
      uriList = ''
    }
    for (const line of uriList.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      push(fileUriToPath(line))
    }
  }

  return paths
}

/**
 * 解析 drop 落点目录：
 *   - 目录节点 → 该目录；
 *   - 文件节点 → 其父目录；
 *   - 根节点 / 树空白 → vault 根目录。
 * 返回值 null 表示路径无效或越出 vault。
 */
export function resolveDropDirectory(
  nodePath: string | null | undefined,
  isDirectory: boolean,
  vaultRoot: string | null | undefined,
): string | null {
  if (!vaultRoot) return null
  if (!nodePath) return path.resolve(vaultRoot)
  const directory = isDirectory ? nodePath : path.dirname(nodePath)
  if (!isPathInsideRoot(vaultRoot, directory)) return null
  return directory
}

/** 仅当拖出的是当前已修改文档时提示：磁盘副本不含未保存修改。 */
export function shouldWarnStaleDragOut(
  activeDocumentPath: string | null | undefined,
  draggedPath: string | null | undefined,
  activeDocumentModified: boolean,
): boolean {
  return activeDocumentModified && isSamePath(activeDocumentPath, draggedPath)
}

/** 同名冲突的候选文件名：`note.md` → `note (2).md`。 */
export function uniqueFileName(fileName: string, index: number): string {
  if (index <= 1) return fileName
  const ext = path.extname(fileName)
  const stem = ext ? fileName.slice(0, fileName.length - ext.length) : fileName
  return `${stem} (${index})${ext}`
}
