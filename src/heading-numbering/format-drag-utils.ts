import type { NumberFormatSegment, MultilevelFormatSegment, HeadingLevel } from './heading-types'

// ── Drag state ────────────────────────────────────────────

export interface DragState {
  draggingIndex: number
  startX: number
  startY: number
  isDragging: boolean
  targetIndexAfterRemoval: number
  rafId: ReturnType<typeof requestAnimationFrame> | null
  ghostEl: HTMLElement | null
  indicatorEl: HTMLElement | null
  cleanupFns: Array<() => void>
}

export function createDragState(draggingIndex: number, startX: number, startY: number): DragState {
  return {
    draggingIndex,
    startX,
    startY,
    isDragging: false,
    targetIndexAfterRemoval: draggingIndex,
    rafId: null,
    ghostEl: null,
    indicatorEl: null,
    cleanupFns: [],
  }
}

// ── Pure move function ────────────────────────────────────

/**
 * Move a segment from `fromIndex` to `targetIndexAfterRemoval`.
 *
 * `targetIndexAfterRemoval`: the index at which the dragged item should
 * appear in the array AFTER removing it.
 *
 * Examples:
 *   [A,B,C], fromIndex=0, target=0 → [A,B,C]   (no move)
 *   [A,B,C], fromIndex=0, target=2 → [B,C,A]   (first → last)
 *   [A,B,C], fromIndex=2, target=0 → [C,A,B]   (last → first)
 *   [A,B,C], fromIndex=0, target=1 → [B,A,C]   (first → middle)
 *   [A,B,C], fromIndex=1, target=2 → [A,C,B]   (middle → end)
 */
export function moveSegmentToResolvedIndex<T>(
  items: readonly T[],
  fromIndex: number,
  targetIndexAfterRemoval: number,
): T[] {
  // Guard: illegal indices return unchanged copy
  if (fromIndex < 0 || fromIndex >= items.length) return [...items]

  const next: T[] = []
  // Copy all except dragged item
  for (let i = 0; i < items.length; i++) {
    if (i !== fromIndex) next.push(items[i])
  }

  // Clamp target to valid range [0, next.length]
  const target = Math.max(0, Math.min(targetIndexAfterRemoval, next.length))

  // Insert at target position
  next.splice(target, 0, items[fromIndex])
  return next
}

// ── Geometry-based target calculation ─────────────────────

/**
 * Calculate targetIndexAfterRemoval from pointer position.
 *
 * Iterates over the remaining chips (excluding the dragged one),
 * computes their horizontal center, and returns the insertion index
 * in the reduced array.
 *
 * Supports multi-row (wrapped) layouts by finding the nearest row
 * based on clientY, then computing X-based position within that row.
 */
export function calculateTargetIndexAfterRemoval(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  draggedIndex: number,
): number {
  // Collect chips that are NOT the dragged one
  const allChips = container.querySelectorAll<HTMLElement>('[data-format-index]')
  const remaining: Array<{ el: HTMLElement; rect: DOMRect }> = []

  for (let i = 0; i < allChips.length; i++) {
    const chip = allChips[i]
    const idx = Number(chip.getAttribute('data-format-index'))
    if (idx === draggedIndex) continue
    remaining.push({ el: chip, rect: chip.getBoundingClientRect() })
  }

  if (remaining.length === 0) return 0

  // Group by row (Y-bucket)
  const rows: Array<Array<{ el: HTMLElement; rect: DOMRect }>> = []
  const rowThreshold = 8 // px tolerance for same row

  for (const chip of remaining) {
    let added = false
    for (const row of rows) {
      const rowTop = row[0].rect.top
      if (Math.abs(chip.rect.top - rowTop) < rowThreshold) {
        row.push(chip)
        added = true
        break
      }
    }
    if (!added) rows.push([chip])
  }

  // Find nearest row
  let bestRow = rows[0]
  let bestRowDist = Infinity
  for (const row of rows) {
    const rowMidY = (row[0].rect.top + row[row.length - 1].rect.bottom) / 2
    const dist = Math.abs(clientY - rowMidY)
    if (dist < bestRowDist) {
      bestRowDist = dist
      bestRow = row
    }
  }

  // Within best row, find insertion point based on X
  // targetIndexAfterRemoval is the index in the remaining array
  for (let i = 0; i < bestRow.length; i++) {
    const centerX = bestRow[i].rect.left + bestRow[i].rect.width / 2
    if (clientX < centerX) {
      // Find this chip's global position in remaining array
      return findGlobalIndex(remaining, bestRow[i].el)
    }
  }

  // After last chip in row → position after the last chip of this row
  const lastChip = bestRow[bestRow.length - 1].el
  const lastGlobalIdx = findGlobalIndex(remaining, lastChip)
  return lastGlobalIdx + 1
}

function findGlobalIndex(
  remaining: Array<{ el: HTMLElement; rect: DOMRect }>,
  chip: HTMLElement,
): number {
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].el === chip) return i
  }
  return remaining.length
}

/** Normalize after drag for multilevel format segments. */
export function normalizeMultilevelFormatAfterDrag(
  format: readonly MultilevelFormatSegment[],
  currentLevel: HeadingLevel,
  hiddenLevels: ReadonlySet<HeadingLevel>,
): MultilevelFormatSegment[] {
  const cleaned: MultilevelFormatSegment[] = []
  const seenLevels = new Set<number>()

  for (const seg of format) {
    if (seg.type === 'level-template-reference') {
      if (hiddenLevels.has(seg.level)) continue
      if (seg.level > currentLevel) continue
      if (seenLevels.has(seg.level)) continue
      seenLevels.add(seg.level)
      cleaned.push(seg)
    } else {
      const trimmed = seg.value.trim()
      if (trimmed.length === 0) continue
      const last = cleaned[cleaned.length - 1]
      if (last?.type === 'literal') {
        last.value += trimmed
      } else {
        cleaned.push({ type: 'literal', value: trimmed })
      }
    }
  }

  // Ensure current level template reference exists exactly once
  if (!cleaned.some(s => s.type === 'level-template-reference' && s.level === currentLevel)) {
    cleaned.push({ type: 'level-template-reference', level: currentLevel })
  }

  return cleaned
}

// ── Normalize after drag ──────────────────────────────────

/**
 * Normalize format after drag commit. Only minimal cleanup:
 * - Remove empty literal segments
 * - Merge adjacent literal segments
 * - Ensure current level reference exists exactly once
 * - Remove duplicate level references (keep first)
 * - Remove future/hidden level references
 */
export function normalizeFormatAfterDrag(
  format: readonly NumberFormatSegment[],
  currentLevel: HeadingLevel,
  hiddenLevels: ReadonlySet<HeadingLevel>,
): NumberFormatSegment[] {
  const cleaned: NumberFormatSegment[] = []
  const seenLevels = new Set<number>()

  for (const seg of format) {
    if (seg.type === 'level-reference') {
      // Skip hidden levels
      if (hiddenLevels.has(seg.level)) continue
      // Skip future levels
      if (seg.level > currentLevel) continue
      // Skip duplicates (keep first)
      if (seenLevels.has(seg.level)) continue
      seenLevels.add(seg.level)
      cleaned.push(seg)
    } else {
      // Skip empty literals
      const trimmed = seg.value.trim()
      if (trimmed.length === 0) continue

      // Merge with previous literal
      const last = cleaned[cleaned.length - 1]
      if (last?.type === 'literal') {
        last.value += trimmed
      } else {
        cleaned.push({ type: 'literal', value: trimmed })
      }
    }
  }

  // Ensure current level reference exists exactly once
  if (!cleaned.some(s => s.type === 'level-reference' && s.level === currentLevel)) {
    cleaned.push({ type: 'level-reference', level: currentLevel })
  }

  return cleaned
}

// ── Debug log helper ──────────────────────────────────────

export interface DragDebugLog {
  draggingIndex: number
  remainingOrder: string[]
  targetIndexAfterRemoval: number
  before: string[]
  after: string[]
  commit: boolean
  cancelReason?: string
}

export function formatSegmentsToString(fmt: readonly NumberFormatSegment[]): string[] {
  return fmt.map(s => s.type === 'level-reference' ? `[L${s.level}]` : s.value || '(空)')
}

export function multilevelFormatSegmentsToString(fmt: readonly MultilevelFormatSegment[]): string[] {
  return fmt.map(s => s.type === 'level-template-reference' ? `[H${s.level}模板]` : s.value || '(空)')
}

export function createDebugLog(
  draggingIndex: number,
  remaining: readonly NumberFormatSegment[],
  targetIndexAfterRemoval: number,
  before: readonly NumberFormatSegment[],
  after: readonly NumberFormatSegment[],
  commit: boolean,
  cancelReason?: string,
): DragDebugLog {
  return {
    draggingIndex,
    remainingOrder: formatSegmentsToString(remaining),
    targetIndexAfterRemoval,
    before: formatSegmentsToString(before),
    after: formatSegmentsToString(after),
    commit,
    cancelReason,
  }
}
