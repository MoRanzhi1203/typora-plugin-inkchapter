/**
 * 文件树拖放适配器 —— 只在 Typora 原生文件树（`#file-library-tree`）区域生效。
 *
 * 为什么必须“截获”拖入：
 *   Typora 原生文件树对外部文件的 drop 走 `copyOrMoveFiles()` → `fs-extra.rename`，
 *   即**移动源文件**（确认框文案为 “Are you sure you want to move ...?”）。
 *   本适配器在 document 捕获阶段先于 Typora 的委托处理器处理外部文件 drop，
 *   改为调用 FileCopyService 做真实复制，并阻止事件继续冒泡到原生的移动逻辑。
 *
 * 为什么不能影响拖出：
 *   文件树节点的 dragstart 由 Typora 自己发送 Electron `ondragstart`（原生 OS 拖拽）。
 *   本适配器只**观察** dragstart（未保存告警 / 符号链接告警），绝不 preventDefault、
 *   不 stopPropagation、不改 dataTransfer —— 原生拖出链路保持原样。
 *
 * 编辑器正文（`#write`）与搜索/列表视图不属于 `#file-library-tree`，因此完全不被拦截。
 */
import * as path from 'path'
import type { CopyBatchResult, CopyReason } from './file-copy-service'
import {
  collectDroppedFilePaths,
  isExternalFileDrag,
  resolveDropDirectory,
} from './file-transfer-policy'

export const FILE_TREE_ROOT_SELECTOR = '#file-library-tree'
export const FILE_TREE_NODE_SELECTOR = '.file-library-node[data-path]'
export const FILE_TREE_DRAG_CONTENT_SELECTOR = '.file-node-content'
export const FILE_DROP_TARGET_CLASS = 'ink-file-drop-target'

const MAX_FAILURE_DETAIL_ITEMS = 3
/** 内部拖拽标记的最长存活时间：超过则视为上一次拖拽残留。 */
const INTERNAL_DRAG_TTL_MS = 15_000

export type FileTransferNoticeLevel = 'info' | 'warning' | 'error'

export interface DragOutObservation {
  path: string
  isDirectory: boolean
}

/** 外部拖入在进入复制前做出的决策（用于运行时审计，不参与业务逻辑）。 */
export interface DropDecisionObservation {
  phase: 'internal' | 'busy' | 'invalid-target' | 'no-sources' | 'started'
  processing: boolean
  sourcesCount: number
  targetDirectory: string | null
}

export interface FileTreeDragHost {
  document: Document
  /** 当前打开的文件夹（vault 根）。 */
  getVaultRoot(): string | null
  /** 真实复制（FileCopyService.copyBatch 的绑定包装）。 */
  copy(sources: string[], destinationDir: string): Promise<CopyBatchResult>
  /** 复制完成后增量刷新文件树（不得整体重绘 / 折叠用户已展开的节点）。 */
  refreshTree(destinationDir: string, copiedFiles: string[]): void
  notify(message: string, level?: FileTransferNoticeLevel): void
  /** dragstart 观察（只读，不允许阻止原生拖出）。 */
  onDragOutObserved?(observation: DragOutObservation): void
  /** 拖入决策观察（只读，用于审计 busy/目标无效等分支）。 */
  onDropDecided?(observation: DropDecisionObservation): void
}

interface AdapterRegistry {
  current: FileTreeDragAdapter | null
}

/**
 * 跨插件重载仍然有效的单实例注册表（Electron 渲染进程内一个 document 只有一个
 * 文件树）。插件热重载 / 切换 vault 后若旧实例未正常 onunload，新实例会先释放
 * 旧监听器，避免 drop/dragstart 被重复处理。
 */
function adapterRegistry(): AdapterRegistry {
  const scope = globalThis as unknown as { __INKCHAPTER_FILE_TREE_DRAG_ADAPTER__?: AdapterRegistry }
  return (scope.__INKCHAPTER_FILE_TREE_DRAG_ADAPTER__ ??= { current: null })
}

export interface FileTreeDragInvariant {
  attached: boolean
  processing: boolean
  externalDropCount: number
  copiedCount: number
  failedCount: number
  lastDestination: string | null
  highlighted: boolean
  internalDragActive: boolean
}

interface DropTarget {
  directory: string | null
  element: Element
}

function asElement(target: EventTarget | null): Element | null {
  if (!target) return null
  const candidate = target as Element
  return candidate.nodeType === 1 && typeof candidate.closest === 'function' ? candidate : null
}

function dataTransferTypes(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer || !dataTransfer.types) return []
  return Array.from(dataTransfer.types as ArrayLike<string>)
}

const REASON_TEXT: Record<CopyReason, string> = {
  INVALID_SOURCE: '源路径无效',
  SOURCE_MISSING: '源文件不存在',
  SOURCE_NOT_FILE: '源路径不是普通文件',
  SOURCE_SYMLINK_REJECTED: '不支持符号链接',
  UNSUPPORTED_EXTENSION: '仅支持 .md / .markdown',
  NO_DESTINATION: '没有可用的目标目录',
  DESTINATION_MISSING: '目标目录不存在',
  DESTINATION_NOT_DIRECTORY: '目标不是文件夹',
  DESTINATION_SYMLINK_REJECTED: '目标目录是符号链接，已拒绝',
  DESTINATION_OUTSIDE_VAULT: '目标目录越出当前文件夹',
  SAME_FILE: '源文件与目标文件相同',
  CONFLICT_SKIPPED: '同名文件已跳过',
  CONFLICT_DIRECTORY: '同名位置是文件夹，无法覆盖',
  DESTINATION_EXISTS_AS_SYMLINK: '同名目标是符号链接，已拒绝覆盖',
  COPY_FAILED: '复制失败',
  COPY_SIZE_MISMATCH: '复制后大小不一致',
}

export function describeCopyFailure(reason: CopyReason | undefined, detail?: string): string {
  const base = reason ? REASON_TEXT[reason] : '复制失败'
  return detail ? `${base}（${detail}）` : base
}

export class FileTreeDragAdapter {

  private attached = false
  private processing = false
  /**
   * 当前拖拽是否由文件树节点自身发起（即 Typora 内部拖放）。
   *
   * 为什么不能只看 `dataTransfer.types`：真实运行中，Typora 内部拖放与 Explorer
   * 外部拖入的 `types` 都只有 `["Files"]`，无法区分。若把内部拖放当成外部导入，
   * 用户原本的「树内移动」会变成「复制」，源文件被保留、目标多出副本。
   * 因此必须记录拖拽来源；拖出窗口（dragleave 且 relatedTarget 为空）或 dragend
   * 时清除，避免拖出后残留状态影响后续外部拖入。
   */
  private internalDragActive = false
  /** 内部 dragstart 的时间戳，用于兜底清理未收到 dragend/drop 的残留标记。 */
  private internalDragStartedAt = 0
  private highlighted: Element | null = null
  private externalDropCount = 0
  private copiedCount = 0
  private failedCount = 0
  private lastDestination: string | null = null

  constructor(private readonly host: FileTreeDragHost) { }

  attach(): boolean {
    if (this.attached) return false
    const doc = this.host.document
    if (!doc) return false
    const registry = adapterRegistry()
    if (registry.current && registry.current !== this) {
      try { registry.current.dispose() } catch { /* 旧实例释放失败不阻断新实例 */ }
    }
    registry.current = this
    doc.addEventListener('dragenter', this.onDragEnter, true)
    doc.addEventListener('dragover', this.onDragOver, true)
    doc.addEventListener('dragleave', this.onDragLeave, true)
    doc.addEventListener('drop', this.onDrop, true)
    doc.addEventListener('dragstart', this.onDragStart, true)
    doc.addEventListener('dragend', this.onDragEnd, true)
    // 兜底：拖拽未以 dragend/drop 正常结束时（例如指针移出窗口后被外部程序接管），
    // 下一次外部拖入的 dragover 会因 internalDragActive 残留而不再 preventDefault，
    // 导致 drop 根本不触发（表现为拖入无反应、busy 提示也不出现）。
    doc.addEventListener('mouseup', this.onDragLifecycleEnd, true)
    doc.addEventListener('visibilitychange', this.onVisibilityChange, true)
    doc.defaultView?.addEventListener('blur', this.onWindowBlur)
    this.attached = true
    return true
  }

  dispose(): void {
    if (!this.attached) return
    const doc = this.host.document
    doc.removeEventListener('dragenter', this.onDragEnter, true)
    doc.removeEventListener('dragover', this.onDragOver, true)
    doc.removeEventListener('dragleave', this.onDragLeave, true)
    doc.removeEventListener('drop', this.onDrop, true)
    doc.removeEventListener('dragstart', this.onDragStart, true)
    doc.removeEventListener('dragend', this.onDragEnd, true)
    doc.removeEventListener('mouseup', this.onDragLifecycleEnd, true)
    doc.removeEventListener('visibilitychange', this.onVisibilityChange, true)
    doc.defaultView?.removeEventListener('blur', this.onWindowBlur)
    this.clearHighlight()
    this.attached = false
    this.processing = false
    this.clearInternalDrag()
    const registry = adapterRegistry()
    if (registry.current === this) registry.current = null
  }

  getInvariant(): FileTreeDragInvariant {
    return {
      attached: this.attached,
      processing: this.processing,
      externalDropCount: this.externalDropCount,
      copiedCount: this.copiedCount,
      failedCount: this.failedCount,
      lastDestination: this.lastDestination,
      highlighted: this.highlighted !== null,
      internalDragActive: this.internalDragActive,
    }
  }

  private onDragEnter = (event: DragEvent): void => {
    if (!this.isExternalTreeDrag(event)) return
    event.preventDefault()
    this.setDropEffectCopy(event)
    if (this.processing) return
    const target = this.resolveDropTarget(event)
    if (target?.directory) this.setHighlight(target.element)
  }

  private onDragOver = (event: DragEvent): void => {
    if (!this.isExternalTreeDrag(event)) return
    // 允许 drop，并把 OS 光标标记为「复制」；同时阻止 Typora 文档级
    // `dragover` 把 dropEffect 改回 "none"（那会导致 drop 被取消）。
    event.preventDefault()
    event.stopPropagation()
    this.setDropEffectCopy(event)
  }

  private onDragLeave = (event: DragEvent): void => {
    if (!this.isTreeEvent(event)) return
    const related = event.relatedTarget as Node | null
    if (related === null) {
      // 拖出窗口（外部或拖出到 Explorer/桌面）：本次拖拽结束，清除内部拖拽标记，
      // 否则下一次从 Explorer 拖入会被误判成内部拖放。
      this.clearInternalDrag()
    }
    if (related && this.treeContains(related)) return
    this.clearHighlight()
  }

  /** 鼠标释放 / 窗口失焦 / 页面隐藏都意味着拖拽生命周期已结束。 */
  private onDragLifecycleEnd = (): void => {
    this.clearInternalDrag()
  }

  private onWindowBlur = (): void => {
    this.clearInternalDrag()
  }

  private onVisibilityChange = (): void => {
    if (this.host.document.hidden) this.clearInternalDrag()
  }

  private onDrop = (event: DragEvent): void => {
    if (this.hasActiveInternalDrag()) {
      // 文件树内部拖放：交还 Typora 原生移动逻辑，不 preventDefault、不复制。
      this.clearInternalDrag()
      this.recordDropDecision('internal', 0, null)
      return
    }
    if (!this.isExternalTreeDrag(event)) return
    // 捕获阶段先于 Typora 的 `copyOrMoveFiles`，阻止原生「移动」分支。
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const sources = collectDroppedFilePaths(event.dataTransfer)
    if (this.processing) {
      this.host.notify('墨章：上一批文件仍在导入，请稍候', 'info')
      this.recordDropDecision('busy', sources.length, null)
      return
    }

    const target = this.resolveDropTarget(event)
    this.clearHighlight()
    if (!target || !target.directory) {
      this.host.notify('墨章：目标文件夹不可用或越出当前打开的文件夹', 'error')
      this.recordDropDecision('invalid-target', sources.length, null)
      return
    }

    if (sources.length === 0) {
      this.host.notify('墨章：未检测到本地文件路径（仅支持从资源管理器拖入文件）', 'warning')
      this.recordDropDecision('no-sources', 0, target.directory)
      return
    }

    this.processing = true
    this.externalDropCount++
    this.recordDropDecision('started', sources.length, target.directory)
    void this.runImport(sources, target.directory)
  }

  private onDragStart = (event: DragEvent): void => {
    if (!this.attached) return
    // 任何新的 dragstart 都先清除上一次拖拽的来源标记。
    this.clearInternalDrag()
    const element = asElement(event.target)
    if (!element) return
    const tree = element.closest(FILE_TREE_ROOT_SELECTOR)
    if (!tree) return
    // 真实 Typora 的 dragstart 目标可能是节点内的任意后代（标题文本、图标等），
    // 不能要求必须命中 .file-node-content；直接取最近的带 data-path 节点即可。
    const node = element.closest(FILE_TREE_NODE_SELECTOR)
    if (!node || !tree.contains(node)) return
    const sourcePath = node.getAttribute('data-path')
    if (!sourcePath) return
    this.internalDragActive = true
    this.internalDragStartedAt = Date.now()
    const observation: DragOutObservation = {
      path: sourcePath,
      isDirectory: node.getAttribute('data-is-directory') === 'true',
    }
    // 延后到原生 dragstart / IPC 之后再观察：lstat 若遇到慢速网络盘也不会拖住
    // Typora 的系统拖拽启动。
    const view = this.host.document.defaultView
    const run = (): void => {
      try { this.host.onDragOutObserved?.(observation) } catch { /* 绝不影响原生拖出 */ }
    }
    if (view) view.setTimeout(run, 0)
    else run()
  }

  private onDragEnd = (): void => {
    this.clearInternalDrag()
    this.clearHighlight()
  }

  private clearInternalDrag(): void {
    this.internalDragActive = false
    this.internalDragStartedAt = 0
  }

  /**
   * 内部拖拽标记是否仍然有效。
   *
   * 真实 Typora 在“树内 dragstart → 拖到窗口外/外部程序”时并不保证触发 dragend
   * 或 dragleave(relatedTarget=null)。若标记残留，后续外部拖入的 dragover 不会
   * 被 preventDefault，浏览器直接拒绝 drop —— 表现为拖入完全无反应，busy 提示
   * 也不会出现。除 mouseup / blur / visibilitychange 兜底外，再加时间上限自愈。
   */
  private hasActiveInternalDrag(): boolean {
    if (!this.internalDragActive) return false
    if (this.internalDragStartedAt > 0 && Date.now() - this.internalDragStartedAt > INTERNAL_DRAG_TTL_MS) {
      this.clearInternalDrag()
      return false
    }
    return true
  }

  private recordDropDecision(
    phase: DropDecisionObservation['phase'],
    sourcesCount: number,
    targetDirectory: string | null,
  ): void {
    try {
      this.host.onDropDecided?.({
        phase,
        processing: this.processing,
        sourcesCount,
        targetDirectory,
      })
    } catch { /* 审计失败绝不影响拖放 */ }
  }

  private async runImport(sources: string[], destinationDir: string): Promise<void> {
    try {
      const result = await this.host.copy(sources, destinationDir)
      this.copiedCount += result.copiedCount
      this.failedCount += result.failedCount
      this.lastDestination = destinationDir
      const copiedFiles = result.entries
        .filter(entry => entry.status === 'copied' && entry.destination)
        .map(entry => entry.destination as string)
      if (copiedFiles.length > 0) {
        this.host.refreshTree(destinationDir, copiedFiles)
      }
      this.host.notify(this.summaryFor(result, destinationDir), this.noticeLevelFor(result))
      const detail = this.failureDetailFor(result)
      if (detail) this.host.notify(detail, 'warning')
    } catch (error) {
      this.failedCount += sources.length
      this.host.notify(
        `墨章：导入失败 —— ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    } finally {
      this.processing = false
    }
  }

  private summaryFor(result: CopyBatchResult, destinationDir: string): string {
    const folder = path.basename(destinationDir) || destinationDir
    const parts: string[] = [`已复制 ${result.copiedCount} 个文件到「${folder}」`]
    if (result.conflictCount > 0) parts.push(`${result.conflictCount} 个同名文件已自动重命名`)
    if (result.skippedCount > 0) parts.push(`${result.skippedCount} 个已跳过`)
    if (result.failedCount > 0) parts.push(`${result.failedCount} 个失败`)
    return `墨章：${parts.join('，')}`
  }

  private noticeLevelFor(result: CopyBatchResult): FileTransferNoticeLevel {
    if (result.failedCount > 0) return result.copiedCount > 0 ? 'warning' : 'error'
    return 'info'
  }

  private failureDetailFor(result: CopyBatchResult): string | null {
    const failures = result.entries.filter(entry => entry.status === 'failed')
    if (failures.length === 0) return null
    const lines = failures
      .slice(0, MAX_FAILURE_DETAIL_ITEMS)
      .map(entry => `${path.basename(entry.source)}：${describeCopyFailure(entry.reason, entry.detail)}`)
    if (failures.length > MAX_FAILURE_DETAIL_ITEMS) {
      lines.push(`等 ${failures.length} 个文件`)
    }
    return `墨章：${lines.join('；')}`
  }

  private isExternalTreeDrag(event: DragEvent): boolean {
    if (!this.attached) return false
    // Typora 内部拖放与外部拖入的 dataTransfer.types 都是 ["Files"]，
    // 只能依靠 dragstart 来源区分；内部拖放必须完全放行给原生移动逻辑。
    if (this.hasActiveInternalDrag()) return false
    if (!this.isTreeEvent(event)) return false
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return false
    return isExternalFileDrag(dataTransferTypes(dataTransfer))
  }

  private isTreeEvent(event: DragEvent): boolean {
    const element = asElement(event.target)
    return !!element && !!element.closest(FILE_TREE_ROOT_SELECTOR)
  }

  private treeContains(node: Node): boolean {
    const element = asElement(node)
    if (!element) return false
    return !!element.closest(FILE_TREE_ROOT_SELECTOR)
  }

  private resolveDropTarget(event: DragEvent): DropTarget | null {
    const element = asElement(event.target)
    if (!element) return null
    const tree = element.closest(FILE_TREE_ROOT_SELECTOR)
    if (!tree) return null
    const vaultRoot = this.host.getVaultRoot()
    const node = element.closest(FILE_TREE_NODE_SELECTOR)
    if (node && tree.contains(node)) {
      const nodePath = node.getAttribute('data-path')
      const isDirectory = node.getAttribute('data-is-directory') === 'true'
      // 落在文件上时实际写入其父目录；高亮父目录而不是文件本身，避免误导。
      const parentNode = isDirectory ? node : node.parentElement?.closest(FILE_TREE_NODE_SELECTOR)
      return {
        directory: resolveDropDirectory(nodePath, isDirectory, vaultRoot),
        element: parentNode && tree.contains(parentNode) ? parentNode : node,
      }
    }
    return {
      directory: resolveDropDirectory(null, true, vaultRoot),
      element: tree,
    }
  }

  private setDropEffectCopy(event: DragEvent): void {
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    } catch { /* 某些合成事件可能只读，忽略 */ }
  }

  private setHighlight(element: Element): void {
    if (this.highlighted === element) return
    this.clearHighlight()
    element.classList.add(FILE_DROP_TARGET_CLASS)
    this.highlighted = element
  }

  private clearHighlight(): void {
    if (!this.highlighted) return
    this.highlighted.classList.remove(FILE_DROP_TARGET_CLASS)
    this.highlighted = null
  }
}
