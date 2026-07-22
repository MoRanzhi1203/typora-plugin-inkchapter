import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingSettings,
  NumberedHeading,
} from './heading-types'
import { formatToken } from './token-formatter'

/**
 * Pure function: compute hierarchical heading numbering with per-level styling.
 *
 * Advanced rules (schemaVersion >= 3):
 * - startAt: counter begins at (startAt - 1), first occurrence yields startAt.
 * - restartAfterLevel: when a heading at level <= restartAfterLevel appears,
 *   reset this level's counter (to startAt - 1). null = continuous across document.
 * - legalStyle: parent-level tokens converted to arabic; current level keeps its style.
 * - H1 still acts as chapter boundary for H2 restart even when showLevelOneNumber=false.
 */
export function computeHeadingNumbering(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
): NumberedHeading[] {
  const counters: number[] = [0, 0, 0, 0, 0, 0]
  const skipH1 = !settings.showLevelOneNumber
  const levelStyles = settings.levels

  // Initialize counters with startAt - 1
  for (let i = 0; i < 6; i++) {
    const lv = (i + 1) as HeadingLevel
    const style = levelStyles[lv]
    if (style) {
      counters[i] = clamp(style.startAt, 1, 999) - 1
    }
  }

  return headings
    .filter((h) => h.level <= settings.maxDepth)
    .map((h) => {
      const idx = h.level - 1
      const style = levelStyles[h.level]

      // ── restartAfterLevel ──────────────────────────
      // Check if any parent level (up to restartAfterLevel) triggered a restart
      if (style?.restartAfterLevel != null) {
        const restartIdx = style.restartAfterLevel - 1
        // Previous headings at restartAfterLevel or higher restart this counter
        // (This is handled by resetting lower counters when higher ones increment,
        // but for null parents we need to NOT reset them.)
        // The current logic already resets deeper counters on increment.
        // For restartAfterLevel, we need to ensure counters between restartIdx+1..idx
        // get reset. The existing logic does this automatically via the for loop below.
        // However for null, we need to ONLY increment without resetting.
        // We handle this below.
      }

      // Increment current level
      counters[idx]++

      // Reset deeper levels ONLY if their restartAfterLevel covers this level
      // Default: deeper levels reset (restartAfterLevel defaults to parent)
      // If a deeper level has restartAfterLevel=null, we still reset it here
      // because the increment of a higher level always triggers the standard behavior.
      // Levels with restartAfterLevel < this level also reset.
      for (let i = idx + 1; i < 6; i++) {
        const deeperStyle = levelStyles[(i + 1) as HeadingLevel]
        if (deeperStyle?.restartAfterLevel != null && deeperStyle.restartAfterLevel <= h.level) {
          counters[i] = clamp(deeperStyle.startAt, 1, 999) - 1
        } else if (deeperStyle?.restartAfterLevel == null) {
          // null = do NOT restart, leave counter as-is
        } else {
          // restartAfterLevel > h.level: do not restart yet
          // But the standard behavior says deeper levels always reset.
          // With restartAfterLevel, we only reset if the incrementing level
          // is <= restartAfterLevel (or higher in hierarchy).
          // If deeper level has restartAfterLevel=3 and we incremented H4 (level 4),
          // don't reset because 3 < 4.
          if (deeperStyle.restartAfterLevel >= h.level) {
            counters[i] = clamp(deeperStyle.startAt, 1, 999) - 1
          }
        }
      }

      // Build full active counters
      const activeCounters: number[] = counters.slice(0, idx + 1)
      for (let i = 0; i < idx; i++) {
        if (counters[i] < 1) activeCounters[i] = 0
      }

      // H1 completely hidden when showLevelOneNumber is false
      if (skipH1 && idx === 0) {
        return { ...h, counters: [...activeCounters], label: '' }
      }

      const label = buildLabel(activeCounters, levelStyles, skipH1, idx, h.level)

      return { ...h, counters: [...activeCounters], label }
    })
}

function buildLabel(
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, HeadingLevelStyle>,
  skipH1: boolean,
  currentIdx: number,
  headingLevel: HeadingLevel,
): string {
  const style = levelStyles[headingLevel]
  if (!style || !style.enabled) return ''

  const startIdx = skipH1 ? 1 : 0

  if (style.includeParents) {
    const parts: string[] = []
    for (let i = startIdx; i <= currentIdx; i++) {
      // actualLv: the real heading level this counter position represents
      const actualLv = (i + 1) as HeadingLevel
      const st = levelStyles[actualLv]
      if (!st || !st.enabled) continue

      // legalStyle: parent levels use arabic, current level keeps its own style
      const isParent = i < currentIdx
      const tokenStyle = (style.legalStyle && isParent) ? 'arabic' : st.tokenStyle

      const token = formatToken(activeCounters[i], tokenStyle)
      parts.push(st.prefix + token + st.suffix)
    }
    return parts.join(style.separator)
  }

  const token = formatToken(activeCounters[currentIdx], style.tokenStyle)
  return style.prefix + token + style.suffix
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n) || n < min) return min
  if (n > max) return max
  return n
}

/**
 * Compute only the label string for a single heading in context.
 */
export function computeHeadingNumberingLabel(
  heading: HeadingDescriptor,
  settings: HeadingNumberingSettings,
  allHeadings: readonly HeadingDescriptor[],
): string | null {
  const results = computeHeadingNumbering(allHeadings, settings)
  const match = results.find((r) => r.key === heading.key)
  return match ? match.label : null
}

export function isValidHeadingLevel(n: number): n is HeadingLevel {
  return Number.isInteger(n) && n >= 1 && n <= 6
}
