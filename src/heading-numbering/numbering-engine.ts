import type {
  HeadingDescriptor,
  HeadingLevel,
  HeadingLevelStyle,
  HeadingNumberingSettings,
  NumberedHeading,
  NumberFormatSegment,
  HeadingFormatVariants,
  MultilevelFormatSegment,
  MultilevelFormatVariants,
  HeadingLevelNumberTemplate,
  ContextualFormatSegment,
  ContextualFormatVariants,
} from './heading-types'
import { formatToken } from './token-formatter'

/**
 * Pure function: compute hierarchical heading numbering with per-level styling.
 *
 * Advanced rules (schemaVersion >= 3):
 * - startAt: counter begins at (startAt - 1), first occurrence yields startAt.
 * - restartAfterLevel: when a heading at level <= restartAfterLevel appears,
 *   reset this level's counter (to startAt - 1). null = continuous across document.
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

  // ── New contextual model (schemaVersion >= 8) ───
  const contextualVariant = getActiveContextualFormatVariant(style, !skipH1, headingLevel)
  if (contextualVariant && contextualVariant.length > 0) {
    return buildLabelFromContextualFormat(activeCounters, headingLevel, contextualVariant, skipH1)
  }

  // ── New two-layer model (schemaVersion >= 7) ──────
  const multilevelVariant = getActiveMultilevelFormatVariant(style, !skipH1, headingLevel)
  if (multilevelVariant && multilevelVariant.length > 0) {
    return buildLabelFromMultilevelFormat(activeCounters, levelStyles, skipH1, headingLevel)
  }

  // ── Legacy format-based label (schemaVersion < 7) ─
  const activeVariant = getActiveFormatVariant(style, !skipH1, headingLevel)
  if (activeVariant && activeVariant.length > 0) {
    return buildLabelFromFormat(activeCounters, levelStyles, skipH1, headingLevel, style)
  }

  // ── Legacy includeParents/prefix/suffix/separator ─
  const startIdx = skipH1 ? 1 : 0

  if (style.includeParents) {
    const parts: string[] = []
    for (let i = startIdx; i <= currentIdx; i++) {
      const actualLv = (i + 1) as HeadingLevel
      const st = levelStyles[actualLv]
      if (!st || !st.enabled) continue

      const tokenStyle = st.tokenStyle
      const token = formatToken(activeCounters[i], tokenStyle)
      parts.push(st.prefix + token + st.suffix)
    }
    return parts.join(style.separator)
  }

  const token = formatToken(activeCounters[currentIdx], style.tokenStyle)
  return style.prefix + token + style.suffix
}

// ── New two-layer render functions (schemaVersion >= 7) ──

/**
 * Render a single level's number template.
 * Returns prefix + formattedToken + suffix for the given level and counter.
 */
export function renderLevelTemplate(
  level: HeadingLevel,
  counter: number,
  template: HeadingLevelNumberTemplate,
): string {
  const token = formatToken(counter, template.tokenStyle)
  return template.prefix + token + template.suffix
}

/**
 * Render a complete multilevel format array into a label string.
 * Iterates segments, outputting literals directly and resolving
 * level-template-references by reading the referenced level's template
 * and using its counter.
 */
export function renderMultilevelFormat(
  format: readonly MultilevelFormatSegment[],
  counters: readonly number[],
  templates: Record<HeadingLevel, HeadingLevelNumberTemplate>,
): string {
  const parts: string[] = []
  for (const seg of format) {
    if (seg.type === 'literal') {
      parts.push(seg.value)
    } else {
      const refLv = seg.level
      const refIdx = refLv - 1
      if (refIdx < 0 || refIdx >= counters.length) continue
      const tpl = templates[refLv]
      if (!tpl) continue
      parts.push(renderLevelTemplate(refLv, counters[refIdx], tpl))
    }
  }
  return parts.join('')
}

/**
 * Build the label for a heading using the two-layer multilevel format model.
 */
function buildLabelFromMultilevelFormat(
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, HeadingLevelStyle>,
  skipH1: boolean,
  headingLevel: HeadingLevel,
): string {
  const style = levelStyles[headingLevel]
  if (!style) return ''

  // Get the active multilevel format variant
  const activeFormat = getActiveMultilevelFormatVariant(style, !skipH1, headingLevel)
  const effectiveFormat = getEffectiveMultilevelFormat(activeFormat, skipH1, headingLevel)

  // Build templates map from all level styles
  const templates: Record<HeadingLevel, HeadingLevelNumberTemplate> = {} as any
  for (let i = 0; i < 6; i++) {
    const lv = (i + 1) as HeadingLevel
    const ls = levelStyles[lv]
    templates[lv] = ls?.levelTemplate ?? { tokenStyle: ls?.tokenStyle ?? 'arabic', prefix: '', suffix: '' }
  }

  return renderMultilevelFormat(effectiveFormat, activeCounters, templates)
}

// ── Contextual rendering (schemaVersion >= 8) ────────

/**
 * Render a single contextual level-reference segment.
 * Uses the segment's own appearance (tokenStyle/prefix/suffix),
 * NOT the referenced level's global template.
 */
export function renderContextualLevelReference(
  segment: { level: HeadingLevel; appearance: { tokenStyle: import('./heading-types').NumberTokenStyle; prefix: string; suffix: string } },
  counter: number,
): string {
  const token = formatToken(counter, segment.appearance.tokenStyle)
  return segment.appearance.prefix + token + segment.appearance.suffix
}

/**
 * Render a complete contextual format array into a label string.
 * Iterates segments, outputting literals directly and resolving
 * level-references using each segment's own appearance.
 */
export function renderContextualFormat(
  segments: readonly ContextualFormatSegment[],
  counters: readonly number[],
): string {
  const parts: string[] = []
  for (const seg of segments) {
    if (seg.type === 'literal') {
      parts.push(seg.value)
    } else {
      const refLv = seg.level
      const refIdx = refLv - 1
      if (refIdx < 0 || refIdx >= counters.length) continue
      parts.push(renderContextualLevelReference(seg, counters[refIdx]))
    }
  }
  return parts.join('')
}

/**
 * Build the label for a heading using the contextual format model.
 */
function buildLabelFromContextualFormat(
  activeCounters: number[],
  headingLevel: HeadingLevel,
  format: readonly ContextualFormatSegment[],
  skipH1: boolean,
): string {
  // Filter hidden levels
  const hidden = new Set<HeadingLevel>()
  if (skipH1) hidden.add(1 as HeadingLevel)
  const effective = format.filter(s => s.type === 'literal' || !hidden.has(s.level))

  return renderContextualFormat(effective, activeCounters)
}

// ── Contextual format variant helpers ───────────────

/**
 * Get the active contextual format variant for the current H1 visibility.
 */
export function getActiveContextualFormatVariant(
  style: HeadingLevelStyle,
  showLevelOneNumber: boolean,
  level: HeadingLevel,
): readonly ContextualFormatSegment[] {
  const variants = style.contextualFormatVariants
  if (!variants) return []
  if (level === 1) return variants.withLevelOne
  return showLevelOneNumber ? variants.withLevelOne : variants.withoutLevelOne
}

/**
 * Update the active contextual format variant.
 */
export function updateActiveContextualFormatVariant(
  style: HeadingLevelStyle,
  level: HeadingLevel,
  showLevelOneNumber: boolean,
  nextFormat: readonly ContextualFormatSegment[],
): HeadingLevelStyle {
  if (level === 1) {
    return {
      ...style,
      contextualFormatVariants: {
        ...style.contextualFormatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  if (showLevelOneNumber) {
    return {
      ...style,
      contextualFormatVariants: {
        ...style.contextualFormatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  return {
    ...style,
    contextualFormatVariants: {
      ...style.contextualFormatVariants,
      withoutLevelOne: [...nextFormat],
    },
  }
}

// ── Contextual format: available reference levels ────

/**
 * Get available reference levels for the contextual insert dropdown.
 * Only levels that are not yet present in the format.
 */
export function getAvailableContextualReferenceLevels(
  currentLevel: HeadingLevel,
  showLevelOneNumber: boolean,
  activeFormat: readonly ContextualFormatSegment[],
): HeadingLevel[] {
  const result: HeadingLevel[] = []
  const start = showLevelOneNumber ? 1 : 2
  const usedLevels = new Set<HeadingLevel>()
  for (const seg of activeFormat) {
    if (seg.type === 'level-reference') usedLevels.add(seg.level)
  }
  for (let lv = start; lv < currentLevel; lv++) {
    const hl = lv as HeadingLevel
    if (!usedLevels.has(hl)) result.push(hl)
  }
  return result
}

// ── Multilevel format variant helpers ─────────────────

/**
 * Get the active multilevel format variant for the current H1 visibility.
 */
export function getActiveMultilevelFormatVariant(
  style: HeadingLevelStyle,
  showLevelOneNumber: boolean,
  level: HeadingLevel,
): readonly MultilevelFormatSegment[] {
  if (level === 1) {
    return style.multilevelFormatVariants.withLevelOne
  }
  return showLevelOneNumber
    ? style.multilevelFormatVariants.withLevelOne
    : style.multilevelFormatVariants.withoutLevelOne
}

/**
 * Update the active multilevel format variant.
 */
export function updateActiveMultilevelFormatVariant(
  style: HeadingLevelStyle,
  level: HeadingLevel,
  showLevelOneNumber: boolean,
  nextFormat: readonly MultilevelFormatSegment[],
): HeadingLevelStyle {
  if (level === 1) {
    return {
      ...style,
      multilevelFormatVariants: {
        ...style.multilevelFormatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  if (showLevelOneNumber) {
    return {
      ...style,
      multilevelFormatVariants: {
        ...style.multilevelFormatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  return {
    ...style,
    multilevelFormatVariants: {
      ...style.multilevelFormatVariants,
      withoutLevelOne: [...nextFormat],
    },
  }
}

/**
 * Strip hidden level-template-references and orphaned separator literals.
 */
export function stripHiddenMultilevelReferences(
  format: readonly MultilevelFormatSegment[],
  hiddenLevels: ReadonlySet<HeadingLevel>,
  currentLevel: HeadingLevel,
): MultilevelFormatSegment[] {
  if (hiddenLevels.size === 0) return [...format]

  const result: MultilevelFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-template-reference' && hiddenLevels.has(seg.level)) {
      // Remove hidden reference and adjacent separator literals
      if (result.length > 0) {
        const last = result[result.length - 1]
        if (last.type === 'literal' && isMultilevelSeparatorLiteral(last)) {
          result.pop()
        }
      }
      while (i + 1 < format.length && format[i + 1].type === 'literal' && isMultilevelSeparatorLiteral(format[i + 1])) {
        i++
      }
      continue
    }
    result.push(seg)
  }

  // Clean leading/trailing separators
  while (result.length > 0 && result[0].type === 'literal' && isMultilevelSeparatorLiteral(result[0])) {
    result.shift()
  }
  while (result.length > 0 && result[result.length - 1].type === 'literal' && isMultilevelSeparatorLiteral(result[result.length - 1])) {
    result.pop()
  }

  // Merge adjacent literals
  const merged: MultilevelFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      const last = merged[merged.length - 1] as { type: 'literal'; value: string }
      last.value += seg.value
    } else {
      merged.push({ ...seg })
    }
  }

  // Ensure current level reference exists
  if (!merged.some(s => s.type === 'level-template-reference' && s.level === currentLevel)) {
    merged.push({ type: 'level-template-reference', level: currentLevel })
  }

  return merged.length > 0 ? merged : [{ type: 'level-template-reference', level: currentLevel }]
}

function isMultilevelSeparatorLiteral(seg: MultilevelFormatSegment): boolean {
  if (seg.type !== 'literal') return false
  const val = seg.value.trim()
  if (val === '') return true
  return [...val].every(c => SEPARATOR_CHARS.has(c))
}

/**
 * Get effective multilevel format, stripping hidden level references.
 */
export function getEffectiveMultilevelFormat(
  format: readonly MultilevelFormatSegment[],
  skipH1: boolean,
  currentLevel: HeadingLevel,
): MultilevelFormatSegment[] {
  const hidden = new Set<HeadingLevel>()
  if (skipH1) hidden.add(1 as HeadingLevel)
  return stripHiddenMultilevelReferences(format, hidden, currentLevel)
}

// ── Multilevel available reference levels ────────────

/**
 * Get available reference levels for the multilevel insert dropdown.
 * Returns only levels strictly before currentLevel.
 * Hides H1 when showLevelOneNumber is false.
 */
export function getAvailableMultilevelReferenceLevels(
  currentLevel: HeadingLevel,
  showLevelOneNumber: boolean,
): HeadingLevel[] {
  const result: HeadingLevel[] = []
  const start = showLevelOneNumber ? 1 : 2
  for (let lv = start; lv < currentLevel; lv++) {
    result.push(lv as HeadingLevel)
  }
  return result
}

function buildLabelFromFormat(
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, HeadingLevelStyle>,
  skipH1: boolean,
  headingLevel: HeadingLevel,
  style: HeadingLevelStyle,
): string {
  // Get active format variant for current H1 visibility
  const activeFormat = getActiveFormatVariant(style, !skipH1, headingLevel)
  // Safety: still strip hidden refs as defense-in-depth
  const effectiveFormat = getEffectiveFormatForLevel(activeFormat, skipH1, headingLevel)
  return evaluateFormat(effectiveFormat, activeCounters, levelStyles, headingLevel, style)
}

// ── Format variant helpers ─────────────────────────────

/**
 * Get the active format variant for the current H1 visibility state.
 * - H1 always returns withLevelOne
 * - H2-H6: withLevelOne when H1 visible, withoutLevelOne when H1 hidden
 */
export function getActiveFormatVariant(
  style: HeadingLevelStyle,
  showLevelOneNumber: boolean,
  level: HeadingLevel,
): readonly NumberFormatSegment[] {
  if (level === 1) {
    return style.formatVariants.withLevelOne
  }
  return showLevelOneNumber
    ? style.formatVariants.withLevelOne
    : style.formatVariants.withoutLevelOne
}

/**
 * Update the active format variant, keeping the other variant untouched.
 * Returns a new style object with the updated variant.
 */
export function updateActiveFormatVariant(
  style: HeadingLevelStyle,
  level: HeadingLevel,
  showLevelOneNumber: boolean,
  nextFormat: readonly NumberFormatSegment[],
): HeadingLevelStyle {
  if (level === 1) {
    return {
      ...style,
      formatVariants: {
        ...style.formatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  if (showLevelOneNumber) {
    return {
      ...style,
      formatVariants: {
        ...style.formatVariants,
        withLevelOne: [...nextFormat],
      },
    }
  }
  return {
    ...style,
    formatVariants: {
      ...style.formatVariants,
      withoutLevelOne: [...nextFormat],
    },
  }
}

/** Evaluate a pre-processed format array into a label string. */
function evaluateFormat(
  format: readonly NumberFormatSegment[],
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, HeadingLevelStyle>,
  headingLevel: HeadingLevel,
  style: HeadingLevelStyle,
): string {
  const parts: string[] = []
  for (const seg of format) {
    if (seg.type === 'literal') {
      parts.push(seg.value)
    } else {
      const refLv = seg.level
      const refIdx = refLv - 1
      if (refIdx < 0 || refIdx >= activeCounters.length) continue
      const refStyle = levelStyles[refLv]
      if (!refStyle) continue
      const tokenStyle = refStyle.tokenStyle
      const token = formatToken(activeCounters[refIdx], tokenStyle)
      parts.push(token)
    }
  }
  return parts.join('')
}

/** Separator-only characters that are orphaned when between-level references are removed. */
const SEPARATOR_CHARS = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])

function isSeparatorLiteral(seg: NumberFormatSegment): boolean {
  if (seg.type !== 'literal') return false
  const val = seg.value.trim()
  if (val === '') return true
  return [...val].every(c => SEPARATOR_CHARS.has(c))
}

/**
 * Strip hidden level references and orphaned separator literals from a format array.
 * When H1 is hidden:
 *   [L1].[L2]      → [L2]
 *   [L1]-[L2]      → [L2]
 *   [L1].[L2].[L3] → [L2].[L3]
 *   [L2].[L1]      → [L2]
 *   [L1]text[L2]   → text[L2]
 *   text[L1].[L2]  → text[L2]
 */
export function stripHiddenLevelReferences(
  format: readonly NumberFormatSegment[],
  hiddenLevels: ReadonlySet<HeadingLevel>,
  currentLevel: HeadingLevel,
): NumberFormatSegment[] {
  if (hiddenLevels.size === 0) return [...format]

  const result: NumberFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-reference' && hiddenLevels.has(seg.level)) {
      // Remove this hidden reference
      // Also remove adjacent separator literals
      // Check previous: if last non-empty result item is a separator, remove it
      if (result.length > 0) {
        const last = result[result.length - 1]
        if (last.type === 'literal' && isSeparatorLiteral(last)) {
          result.pop()
        }
      }
      // Check next: skip adjacent separator literals
      while (i + 1 < format.length && format[i + 1].type === 'literal' && isSeparatorLiteral(format[i + 1]) && !isNonSeparatorLiteral(format[i + 1])) {
        i++ // skip next separator
      }
      continue
    }
    result.push(seg)
  }

  // Clean leading/trailing separators
  while (result.length > 0 && result[0].type === 'literal' && isSeparatorLiteral(result[0]) && !isNonSeparatorLiteral(result[0])) {
    result.shift()
  }
  while (result.length > 0 && result[result.length - 1].type === 'literal' && isSeparatorLiteral(result[result.length - 1]) && !isNonSeparatorLiteral(result[result.length - 1])) {
    result.pop()
  }

  // Merge adjacent literals
  const merged: NumberFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      const last = merged[merged.length - 1] as { type: 'literal'; value: string }
      last.value += seg.value
    } else {
      merged.push({ ...seg })
    }
  }

  // Ensure current level reference exists at least once
  if (!merged.some(s => s.type === 'level-reference' && s.level === currentLevel)) {
    merged.push({ type: 'level-reference', level: currentLevel })
  }

  return merged.length > 0 ? merged : [{ type: 'level-reference', level: currentLevel }]
}

function isNonSeparatorLiteral(seg: NumberFormatSegment): boolean {
  if (seg.type !== 'literal') return false
  return !isSeparatorLiteral(seg) && seg.value.trim().length > 0
}

/**
 * Get the effective format for a level, stripping hidden references.
 * Used by both the numbering engine and the settings UI.
 */
export function getEffectiveFormatForLevel(
  format: readonly NumberFormatSegment[],
  skipH1: boolean,
  currentLevel: HeadingLevel,
): NumberFormatSegment[] {
  const hidden = new Set<HeadingLevel>()
  if (skipH1) hidden.add(1 as HeadingLevel)
  return stripHiddenLevelReferences(format, hidden, currentLevel)
}

/**
 * Get the available reference levels for the insert dropdown.
 * Returns only levels strictly before currentLevel (not including self).
 * Hides H1 when showLevelOneNumber is false.
 *
 * Examples:
 *   showLevelOneNumber=true:  H2→[1], H3→[1,2], H4→[1,2,3]
 *   showLevelOneNumber=false: H2→[],   H3→[2],   H4→[2,3]
 */
export function getAvailableReferenceLevels(
  currentLevel: HeadingLevel,
  showLevelOneNumber: boolean,
): HeadingLevel[] {
  const result: HeadingLevel[] = []
  const start = showLevelOneNumber ? 1 : 2
  for (let lv = start; lv < currentLevel; lv++) {
    result.push(lv as HeadingLevel)
  }
  return result
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
