/**
 * Typora 内部操作适配器
 *
 * 所有对 Typora DOM 和内部 API 的直接访问必须集中在本文件中，
 * 业务模块不得直接散布 DOM 选择器或 Typora 内部调用。
 */

/** 已插入但尚未挂载 CodeMirror 的代码块。 */
const PENDING_FENCE_SELECTOR = 'pre.md-fences.mock-cm'

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
