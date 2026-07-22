import type { NumberFormatSegment } from './heading-types'

/**
 * Move a segment from fromIndex to targetIndexAfterRemoval.
 * targetIndexAfterRemoval: the index in the array AFTER removing the dragged item.
 */
export function moveSegmentToResolvedIndex(
  segments: readonly NumberFormatSegment[],
  fromIndex: number,
  targetIndexAfterRemoval: number,
): NumberFormatSegment[] {
  if (fromIndex < 0 || fromIndex >= segments.length) return [...segments]

  const result: NumberFormatSegment[] = []
  // Copy all items except the dragged one
  for (let i = 0; i < segments.length; i++) {
    if (i !== fromIndex) result.push(segments[i])
  }

  // Clamp target to valid range
  const target = Math.max(0, Math.min(targetIndexAfterRemoval, result.length))

  // Insert the dragged item at target position
  result.splice(target, 0, segments[fromIndex])
  return result
}

/**
 * Calculate the drop index from a Y position relative to a container of chip elements.
 * Each chip has a known height; the drop position is determined by which chip
 * the pointer is over and whether the pointer is above or below the center.
 */
export function computeDropIndexAfterRemoval(
  containerEl: HTMLElement,
  clientY: number,
  draggedIndex: number,
): number {
  const chips = containerEl.children
  if (chips.length === 0) return 0

  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i] as HTMLElement
    const rect = chip.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) {
      // Drop before this chip
      const idx = i < draggedIndex ? i : i - 1
      return Math.max(0, idx)
    }
  }
  // Drop at end
  return chips.length - 1
}
