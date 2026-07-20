import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingNumberingSettings,
  NumberedHeading,
} from './heading-types'
import { formatToken } from './token-formatter'

/**
 * Pure function: compute hierarchical heading numbering with per-level styling.
 *
 * Rules:
 * 1. Process headings in input order.
 * 2. When a heading of level L is encountered:
 *    - Increment the counter at level L.
 *    - Reset all deeper level counters to 0.
 * 3. When showLevelOneNumber is false, H1 acts as chapter boundary only (empty label).
 * 4. Per-level styles (preset or custom) control token formatting and label assembly.
 * 5. Skipped levels fill with 0 placeholders.
 * 6. Headings beyond maxDepth are excluded.
 * 7. Input objects are never mutated.
 */
export function computeHeadingNumbering(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
): NumberedHeading[] {
  const counters: number[] = [0, 0, 0, 0, 0, 0]
  const skipH1 = !settings.showLevelOneNumber
  const levelStyles = settings.levels

  return headings
    .filter((h) => h.level <= settings.maxDepth)
    .map((h) => {
      const idx = h.level - 1

      // Increment and reset deeper counters
      counters[idx]++
      for (let i = idx + 1; i < 6; i++) counters[i] = 0

      // Build full active counters (including skipped levels as 0)
      const activeCounters: number[] = counters.slice(0, idx + 1)
      for (let i = 0; i < idx; i++) {
        if (counters[i] === 0) activeCounters[i] = 0
      }

      // H1 completely hidden when showLevelOneNumber is false
      if (skipH1 && idx === 0) {
        return { ...h, counters: [...activeCounters], label: '' }
      }

      // Build label based on per-level style
      const label = buildLabel(activeCounters, levelStyles, skipH1, idx, h.level)

      return { ...h, counters: [...activeCounters], label }
    })
}

function buildLabel(
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, import('./heading-types').HeadingLevelStyle>,
  skipH1: boolean,
  currentIdx: number,
  headingLevel: HeadingLevel,
): string {
  const style = levelStyles[headingLevel]
  if (!style || !style.enabled) return ''

  const startIdx = skipH1 ? 1 : 0

  if (style.includeParents) {
    // Build concatenated label from startIdx to currentIdx.
    // When H1 is hidden (skipH1=true), shift style indices so that
    // the first visible position (i=1) inherits H1's tokenStyle.
    const parts: string[] = []
    for (let i = startIdx; i <= currentIdx; i++) {
      const styleIdx = skipH1 ? i : i + 1
      const lv = styleIdx as HeadingLevel
      const st = levelStyles[lv]
      if (!st || !st.enabled) continue
      const token = formatToken(activeCounters[i], st.tokenStyle)
      parts.push(st.prefix + token + st.suffix)
    }
    return parts.join(style.separator)
  }

  // Non-parent: only the current level's token with its own prefix/suffix
  const token = formatToken(activeCounters[currentIdx], style.tokenStyle)
  return style.prefix + token + style.suffix
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
