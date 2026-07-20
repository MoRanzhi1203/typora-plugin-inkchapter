import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingNumberingSettings,
  NumberedHeading,
} from './heading-types'

/**
 * Pure function: compute hierarchical heading numbering.
 *
 * Rules:
 * 1. Process headings in input order.
 * 2. When a heading of level L is encountered:
 *    - Increment the counter at level L.
 *    - Reset all deeper level counters to 0.
 * 3. Numbering keeps only levels up to the current heading's depth.
 * 4. Skipped levels fill with 0 placeholders (e.g. H1→H3 produces "1.0.1").
 * 5. Headings beyond maxDepth are excluded from numbering.
 * 6. Empty input returns empty array.
 * 7. Input objects are never mutated.
 */
export function computeHeadingNumbering(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
): NumberedHeading[] {
  const counters: number[] = [0, 0, 0, 0, 0, 0] // index 0 = H1, index 5 = H6
  const skipH1 = !settings.showLevelOneNumber

  return headings
    .filter((h) => h.level <= settings.maxDepth)
    .map((h) => {
      const idx = h.level - 1 // 0-based index for H1

      // Increment current level
      counters[idx]++

      // Reset all deeper levels
      for (let i = idx + 1; i < 6; i++) {
        counters[i] = 0
      }

      // Build counters array up to current level
      const activeCounters: number[] = counters.slice(0, idx + 1)

      // Fill skipped levels with 0
      for (let i = 0; i < idx; i++) {
        if (counters[i] === 0) {
          activeCounters[i] = 0
        }
      }

      // Derive visible counters and label based on showLevelOneNumber setting
      let visibleCounters: number[]
      if (skipH1 && idx === 0) {
        // H1 disabled: chapter boundary only, no visible numbering
        visibleCounters = []
      } else if (skipH1) {
        // H2+: omit the H1 counter level
        visibleCounters = activeCounters.slice(1)
      } else {
        visibleCounters = [...activeCounters]
      }

      const label = visibleCounters.length > 0
        ? visibleCounters.join(settings.separator) + settings.suffix
        : ''

      return {
        ...h,
        counters: [...activeCounters],
        label,
      }
    })
}

/**
 * Compute only the label string for a single heading in context.
 * Used for incremental updates when only one heading changes.
 * Not used in MVP; reserved for future optimization.
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

/**
 * Check if a heading level is valid.
 */
export function isValidHeadingLevel(n: number): n is HeadingLevel {
  return Number.isInteger(n) && n >= 1 && n <= 6
}
