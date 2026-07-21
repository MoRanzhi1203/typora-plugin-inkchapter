import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingLevelDefinition,
  HeadingNumberingSettings,
  NumberedHeading,
  NumberTokenStyle,
} from './heading-types'
import { formatToken } from './token-formatter'

// ── Constants ────────────────────────────────────────────

/** Literal separators that can become orphaned when a level-reference is skipped. */
const ORPHAN_SEPARATOR_REGEX = /^[.\/、-]$/

/** Characters that only serve as separators between level references. */
const SEPARATOR_ONLY_REGEX = /^[.\-_、，:\：\/\\·\s]+$/

// ── Visibility helpers ───────────────────────────────────

/**
 * Check whether a heading level is currently visible (shows numbering).
 * Level 1 is hidden when showLevelOneNumber is false.
 * A level whose enabled flag is false is also hidden.
 */
export function isLevelVisible(
  level: HeadingLevel,
  settings: Pick<HeadingNumberingSettings, 'showLevelOneNumber' | 'customDefinition'>,
): boolean {
  if (level === 1 && !settings.showLevelOneNumber) return false
  const def = settings.customDefinition.levels[level]
  if (!def || !def.enabled) return false
  return true
}

/**
 * Get available parent reference levels for a given current level.
 * Excludes: future levels, current level itself, hidden levels, disabled levels.
 * Always returns sorted ascending.
 */
export function getAvailableReferenceLevels(
  currentLevel: HeadingLevel,
  settings: Pick<HeadingNumberingSettings, 'showLevelOneNumber' | 'customDefinition'>,
): HeadingLevel[] {
  const result: HeadingLevel[] = []
  for (const lv of [1, 2, 3, 4, 5, 6] as HeadingLevel[]) {
    if (lv >= currentLevel) break
    if (isLevelVisible(lv, settings)) {
      result.push(lv)
    }
  }
  return result
}

// ── Public API ───────────────────────────────────────────

export function isValidHeadingLevel(n: number): n is HeadingLevel {
  return Number.isInteger(n) && n >= 1 && n <= 6
}

/**
 * Pure function: compute hierarchical heading numbering using segment-based
 * per-level definitions (Word-style multilevel list format).
 *
 * Rules:
 * 1. Process headings in input order.
 * 2. When a heading of level L is encountered:
 *    - Increment the counter at level L (respecting startAt).
 *    - Reset all deeper level counters to their startAt-1 baseline.
 * 3. restartAfterLevel: when a heading at level R appears, any level whose
 *    restartAfterLevel === R gets its counter reset to startAt.
 * 4. When showLevelOneNumber is false, H1 gets an empty label but still
 *    participates in counting and restart-after logic.
 * 5. When H1 is hidden, orphan separator literals adjacent to the skipped
 *    H1 reference are removed from descendant labels.
 * 6. Each heading's label is assembled by iterating its level definition's
 *    format segments:
 *    - literals: output directly
 *    - level-references: format the referenced counter
 *      - self-reference → use current level's numberStyle
 *      - parent reference  → legalStyle ? 'arabic' : parent's numberStyle
 * 7. Headings beyond maxDepth are excluded.
 * 8. Input objects are never mutated.
 */
export function computeHeadingNumbering(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
): NumberedHeading[] {
  if (!settings.enabled) {
    return headings
      .filter((h) => h.level <= settings.maxDepth)
      .map((h) => ({ ...h, counters: [], label: '' }))
  }

  const defs = settings.customDefinition.levels
  const skipH1 = !settings.showLevelOneNumber

  // Initialize counters to (startAt - 1) so first increment lands on startAt
  const counters: number[] = [0, 0, 0, 0, 0, 0]
  for (let lv = 1; lv <= 6; lv++) {
    const def = defs[lv as HeadingLevel]
    counters[lv - 1] = (def?.startAt ?? 1) - 1
  }

  return headings
    .filter((h) => h.level <= settings.maxDepth)
    .map((h) => {
      const idx = h.level - 1

      // Increment current level counter
      counters[idx]++

      // Reset deeper counters (and apply restartAfterLevel)
      for (let i = idx + 1; i < 6; i++) {
        const deeperLevel = (i + 1) as HeadingLevel
        const deeperDef = defs[deeperLevel]
        if (deeperDef && deeperDef.restartAfterLevel === h.level) {
          // Restart: reset to startAt-1 so next increment lands on startAt
          counters[i] = deeperDef.startAt - 1
        } else {
          counters[i] = (deeperDef?.startAt ?? 1) - 1
        }
      }

      const def = defs[h.level]
      const label = buildLabelFromSegments(counters, def, defs, skipH1, h.level)

      return { ...h, counters: [...counters.slice(0, idx + 1)], label }
    })
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

// ── Label assembly ───────────────────────────────────────

function buildLabelFromSegments(
  counters: number[],
  def: HeadingLevelDefinition | undefined,
  defs: Record<HeadingLevel, HeadingLevelDefinition>,
  skipH1: boolean,
  currentLevel: HeadingLevel,
): string {
  if (!def || !def.enabled) return ''

  // H1 completely hidden when showLevelOneNumber is false
  if (skipH1 && currentLevel === 1) return ''

  const format = def.format
  const parts: string[] = []

  for (let i = 0; i < format.length; i++) {
    const seg = format[i]

    if (seg.type === 'level-reference') {
      // Defensive: skip any hidden/invisible level reference in descendant formats
      // (not just H1 — any level whose enabled is false or showLevelOneNumber hides level 1)
      const settingsForVisibility = {
        showLevelOneNumber: skipH1 ? false : true,
        customDefinition: { levels: defs },
      }
      if (seg.level !== currentLevel && !isLevelVisible(seg.level, settingsForVisibility)) {
        // Remove trailing orphan separator from already-processed parts
        removeTrailingOrphanSeparator(parts)
        // Skip an immediately following orphan separator literal
        if (
          i + 1 < format.length &&
          format[i + 1].type === 'literal' &&
          ORPHAN_SEPARATOR_REGEX.test((format[i + 1] as { type: 'literal'; value: string }).value)
        ) {
          i++ // skip the orphan separator
        }
        continue
      }

      const style = resolveNumberStyle(seg.level, currentLevel, def, defs)
      parts.push(formatToken(counters[seg.level - 1], style))
    } else {
      // literal segment — output as-is
      parts.push(seg.value)
    }
  }

  // Clean any leading orphan separator (edge case: all initial refs were skipped)
  while (parts.length > 0 && ORPHAN_SEPARATOR_REGEX.test(parts[0])) {
    parts.shift()
  }

  return parts.join('')
}

// ── Number style resolution ──────────────────────────────

function resolveNumberStyle(
  refLevel: HeadingLevel,
  currentLevel: HeadingLevel,
  currentDef: HeadingLevelDefinition,
  defs: Record<HeadingLevel, HeadingLevelDefinition>,
): NumberTokenStyle {
  // Self-reference: use the current level's own numberStyle
  if (refLevel === currentLevel) {
    return currentDef.numberStyle
  }

  // Parent reference (refLevel < currentLevel)
  if (refLevel < currentLevel) {
    // Legal-style: force parent references to Arabic numerals
    if (currentDef.legalStyle) {
      return 'arabic'
    }
    // Otherwise use the referenced level's own numberStyle
    const refDef = defs[refLevel]
    return refDef?.numberStyle ?? 'arabic'
  }

  // Deeper reference (refLevel > currentLevel) — unusual but handle gracefully
  const refDef = defs[refLevel]
  return refDef?.numberStyle ?? 'arabic'
}

// ── Orphan separator helpers ─────────────────────────────

function removeTrailingOrphanSeparator(parts: string[]): void {
  if (parts.length === 0) return
  const last = parts[parts.length - 1]
  if (ORPHAN_SEPARATOR_REGEX.test(last)) {
    parts.pop()
  }
}
