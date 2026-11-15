/**
 * Typora 内部操作适配器
 *
 * 所有对 Typora DOM 和内部 API 的直接访问必须集中在本文件中，
 * 业务模块不得直接散布 DOM 选择器或 Typora 内部调用。
 */

/** 已插入但尚未挂载 CodeMirror 的代码块。 */
const PENDING_FENCE_SELECTOR = 'pre.md-fences.mock-cm'

/**
 * Typora 1.6.7 的真实撤销栈形状（来源：`D:\Typora\resources\appsrc\window\frame.js`）。
 *
 * - `File.editor.undo` 是 UndoManager 实例，`undo()` / `redo()` 是它的原型方法，
 *   也是 Edit→Undo/Redo 与 Ctrl+Z / Ctrl+Y 最终调用的同一入口；
 * - `undo.UndoManager.commandStack` 是注册过的命令栈（`File.reloadContent` 会
 *   注册一条 tag 为 `reload` 的命令），`index` 为当前游标。
 *
 * 这些访问只用于验收/证据读取，不改写文档。
 */
export interface TyporaUndoApi {
  undo?: {
    undo?: (event?: unknown) => unknown
    redo?: (event?: unknown) => unknown
    /** UndoManager internals (shape differs between 1.6.x builds). */
    commandStack?: unknown[]
    index?: number
    UndoManager?: { commandStack?: unknown[]; index?: number }
    /** Documented-by-code snapshot accessor on the SAME instance. */
    storeToJson?: () => { index?: number; commandStackJson?: string }
  }
}

export interface TyporaUndoResult {
  ok: boolean
  reason?: string
}

function invokeUndoEntry(
  api: TyporaUndoApi | null | undefined,
  entry: 'undo' | 'redo',
): TyporaUndoResult {
  const fn = api?.undo?.[entry]
  if (typeof fn !== 'function') return { ok: false, reason: 'UNDO_API_UNAVAILABLE' }
  try {
    fn.call(api?.undo, undefined)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'UNDO_THREW' }
  }
}

/** 调用 Typora 自身的撤销命令（与 Ctrl+Z / 菜单 Undo 同一条命令栈）。 */
export function invokeEditorUndo(api: TyporaUndoApi | null | undefined): TyporaUndoResult {
  return invokeUndoEntry(api, 'undo')
}

/** 调用 Typora 自身的重做命令（与 Ctrl+Y / 菜单 Redo 同一条命令栈）。 */
export function invokeEditorRedo(api: TyporaUndoApi | null | undefined): TyporaUndoResult {
  return invokeUndoEntry(api, 'redo')
}

/** 撤销栈长度（null = 不可读）。只读证据。 */
export function readEditorUndoStackLength(api: TyporaUndoApi | null | undefined): number | null {
  const undo = api?.undo
  if (undo == null) return null
  // Real Typora 1.6.7 exposes the stack on the UndoManager INSTANCE itself
  // (verified by a runtime acceptance run: `undo.UndoManager` is undefined).
  if (Array.isArray(undo.commandStack)) return undo.commandStack.length
  if (Array.isArray(undo.UndoManager?.commandStack)) return undo.UndoManager.commandStack.length
  if (typeof undo.storeToJson === 'function') {
    try {
      const snapshot = undo.storeToJson.call(undo)
      const parsed = JSON.parse(snapshot?.commandStackJson ?? '[]') as unknown
      return Array.isArray(parsed) ? parsed.length : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * 本适配器真正依赖的 Typora 能力（由调用方注入 `editor`，便于单测）。
 */
export interface TyporaFenceApi {
  writingArea?: HTMLElement | null
  fences?: { addCodeBlock?: (cid: string) => unknown }
}

function writingArea(api: TyporaFenceApi): HTMLElement | null {
  const area = api.writingArea as HTMLElement | null | undefined
  return area && area.isConnected !== false ? area : null
}

/**
 * 同步挂载 `#write` 内所有待挂载的代码块（`pre.md-fences.mock-cm`）。
 *
 * `editor.fences.addCodeBlock(cid)` 是社区类型定义中的文档化 API；失败时保持
 * 原状，Typora 自己的延迟挂载仍是兜底路径。
 *
 * @returns 本次成功挂载的数量
 */
function mountPendingFences(api: TyporaFenceApi, root: HTMLElement): number {
  const addCodeBlock = api.fences?.addCodeBlock
  if (typeof addCodeBlock !== 'function') return 0
  let mounted = 0
  const pending = Array.from(root.querySelectorAll<HTMLElement>(PENDING_FENCE_SELECTOR))
  for (const fence of pending) {
    if (fence.querySelector('.CodeMirror')) continue
    const cid = fence.getAttribute('cid')
    if (!cid) continue
    try {
      addCodeBlock.call(api.fences, cid)
      mounted++
    } catch {
      /* 交给 Typora 的延迟挂载 */
    }
  }
  return mounted
}

/**
 * 整篇 reload 后立刻把代码块的 CodeMirror 挂上去，避免出现“空代码块”帧。
 *
 * 背景（真实取证 `runtime/gui-acceptance/snap-X.json`）：Typora 收到
 * `File.reloadContent` 后先把区块渲染为 `pre.md-fences.mock-cm`（只有纯文本、
 * 没有行内编号），CodeMirror 要到后续任务才挂载。中间会有一帧被绘制，
 * 用户看到的就是代码块行内编号（以及代码本身）闪一下。
 *
 * 本函数在代码块插入的同一个任务里同步挂载，使 reload 后的第一帧就是最终形态。
 * 调用方须在 `File.reloadContent(...)` 之后立即调用。
 *
 * @returns 取消函数（正常情况会自动在挂载成功或超时后解除观察）
 */
export function mountPendingFencesSynchronously(api: TyporaFenceApi, windowMs = 1500): () => void {
  const root = writingArea(api)
  if (!root) return () => {}

  let stopped = false
  const observer = new MutationObserver(() => {
    if (stopped) return
    if (mountPendingFences(api, root) > 0) stop()
  })
  const timer: ReturnType<typeof setTimeout> = setTimeout(stop, windowMs)

  function stop(): void {
    if (stopped) return
    stopped = true
    observer.disconnect()
    clearTimeout(timer)
  }

  observer.observe(root, { childList: true, subtree: true })
  if (mountPendingFences(api, root) > 0) stop()
  return stop
}
