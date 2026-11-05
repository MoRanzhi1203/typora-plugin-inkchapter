/**
 * 设置页滚动保持（V5.0）。
 *
 * 三个设置页（标题编号 / 界面 / 图片）都会在字段变更后重建 DOM。
 * 重建本身是必要的，但如果不恢复滚动位置，长页面会瞬间跳回顶部，
 * 看起来像“重复渲染 / 页面在抖”。
 *
 * 这里统一找到真正的滚动容器（设置面板通常是某个祖先或自身），
 * 在重建前后保存 / 恢复 scrollTop，并保留用户正在编辑的输入焦点。
 */

export interface SettingsScrollSnapshot {
  element: HTMLElement | null
  top: number
  /** 重建前拥有焦点的元素标识（用于尽力恢复）。 */
  activeSelector: string | null
}

function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false
  try {
    const style = window.getComputedStyle(el)
    return style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll'
  } catch {
    return false
  }
}

/** 从设置容器向上找到真正可滚动的祖先；找不到时返回容器自身。 */
export function findSettingsScrollContainer(containerEl: HTMLElement): HTMLElement {
  let node: HTMLElement | null = containerEl
  while (node != null) {
    if (isScrollable(node)) return node
    node = node.parentElement
  }
  return containerEl
}

function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function selectorFor(el: Element | null): string | null {
  if (!el || !(el instanceof HTMLElement)) return null
  if (el.id) return `#${escapeSelector(el.id)}`
  const name = el.getAttribute('data-setting-key') ?? el.getAttribute('name')
  if (name) return `[data-setting-key="${escapeSelector(name)}"], [name="${escapeSelector(name)}"]`
  return null
}

export function captureSettingsScroll(containerEl: HTMLElement): SettingsScrollSnapshot {
  const element = findSettingsScrollContainer(containerEl)
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return {
    element,
    top: element.scrollTop,
    activeSelector: active && containerEl.contains(active) ? selectorFor(active) : null,
  }
}

export function restoreSettingsScroll(snapshot: SettingsScrollSnapshot): void {
  const element = snapshot.element
  if (!element) return
  // 同步恢复一次，再在下一帧恢复一次：某些框架会在 onshow 后再做一次布局。
  element.scrollTop = snapshot.top
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (element.isConnected) element.scrollTop = snapshot.top
    })
  }
  if (snapshot.activeSelector) {
    try {
      const target = document.querySelector<HTMLElement>(snapshot.activeSelector)
      if (target && target.isConnected) target.focus({ preventScroll: true })
    } catch { /* 选择器失效时忽略 */ }
  }
}

/** 包住一次重建：保存 → 执行 → 恢复。 */
export function preserveSettingsScroll<T>(containerEl: HTMLElement, rebuild: () => T): T {
  const snapshot = captureSettingsScroll(containerEl)
  const result = rebuild()
  restoreSettingsScroll(snapshot)
  return result
}
