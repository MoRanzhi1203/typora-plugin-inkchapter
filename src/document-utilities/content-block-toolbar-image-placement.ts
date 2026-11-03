/**
 * 图片工具栏定位（纯函数）。
 *
 * 以**实际图片可视边界**为参照，而不是内容块宽度：
 * - 优先图片右侧外侧（水平间距 6–8px，顶部对齐）；
 * - 右侧空间不足时放左侧外侧；
 * - 两侧都不足时放到图片内侧右上角；
 * - 所有坐标都是相对锚点容器（`.md-image`）的局部坐标，不写视口坐标。
 *
 * 调用方只在悬停/选中/几何变化时计算，不使用轮询或 MutationObserver。
 */

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type ImageToolbarPlacementMode = 'right' | 'left' | 'inside'

export interface ImageToolbarPlacementInput {
  imageRect: RectLike
  anchorRect: RectLike
  /** 可见编辑区（已按视口裁剪）。 */
  editorRect: RectLike
  barWidth: number
  barHeight: number
  /** 与图片边缘的水平间距，默认 7px。 */
  gap?: number
  /** 内侧模式的内边距，默认 6px。 */
  inset?: number
}

export interface ImageToolbarPlacement {
  /** 相对锚点容器左上角的局部坐标。 */
  left: number
  top: number
  mode: ImageToolbarPlacementMode
  /** 右/左模式为图片边缘到按钮的实际水平间距；inside 为内侧边距。 */
  gap: number
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function rectWidth(rect: RectLike): number {
  return Number.isFinite(rect.width) ? rect.width : rect.right - rect.left
}

function rectHeight(rect: RectLike): number {
  return Number.isFinite(rect.height) ? rect.height : rect.bottom - rect.top
}

/** 把编辑区裁剪到当前视口，避免把工具栏放到不可见区域。 */
export function clipEditorRect(rect: RectLike, viewportWidth: number, viewportHeight: number): RectLike {
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(viewportWidth, rect.right)
  const bottom = Math.min(viewportHeight, rect.bottom)
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export function computeImageToolbarPlacement(input: ImageToolbarPlacementInput): ImageToolbarPlacement {
  const gap = Math.max(0, input.gap ?? 7)
  const inset = Math.max(0, input.inset ?? 6)
  const barWidth = Math.max(1, input.barWidth)
  const barHeight = Math.max(1, input.barHeight)

  const imageLeft = input.imageRect.left - input.anchorRect.left
  const imageTop = input.imageRect.top - input.anchorRect.top
  const imageRight = input.imageRect.right - input.anchorRect.left
  const imageBottom = input.imageRect.bottom - input.anchorRect.top

  // 垂直方向与图片顶部对齐；图片可能略高于段落行盒，这里只做非负保护。
  const top = Math.max(0, imageTop)

  // 可见区域换算成锚点局部坐标。操作条允许溢出锚点宽度：
  // Typora 某些主题会把 `.md-image` 收紧到图片宽度，右侧仍可能有余量。
  const visibleLeft = Math.max(0, input.editorRect.left - input.anchorRect.left)
  const visibleRight = Math.max(0, input.editorRect.right - input.anchorRect.left)

  const rightCandidate = imageRight + gap
  if (rightCandidate + barWidth <= visibleRight) {
    return { left: rightCandidate, top, mode: 'right', gap }
  }

  const leftCandidate = imageLeft - gap - barWidth
  if (leftCandidate >= visibleLeft) {
    return { left: leftCandidate, top, mode: 'left', gap }
  }

  // 两侧都不足：贴到图片内侧右上角，仍以图片边界为参照。
  const insideLeft = clamp(
    imageRight - barWidth - inset,
    Math.max(0, imageLeft + 2),
    Math.max(0, imageRight - barWidth - 2),
  )
  const insideTop = clamp(
    imageTop + inset,
    Math.max(0, imageTop),
    Math.max(0, imageBottom - barHeight - 2),
  )
  return { left: insideLeft, top: insideTop, mode: 'inside', gap: inset }
}
