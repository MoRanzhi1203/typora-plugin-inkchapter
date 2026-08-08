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
  UnnumberedCounterPolicy,
  NumberTokenStyle,
} from './heading-types'
import { HEADING_LEVELS, generateStableId } from './heading-types'
import { formatToken } from './token-formatter'

/**
 * Build strict-mode effective levels with ref levels shifted by +1.
 * S1 (levels[1]) → effective H2, S2 (levels[2]) → effective H3, etc.
 * All level-reference segments have their `level` field incremented by 1
 * so that they read from the correct physical counter index.
 *
 * IMPORTANT: This does NOT copy or modify persisted data.
 * It creates a new runtime object that shares sub-structures where possible.
 */
export function buildStrictEffectiveLevels(
  levels: Record<HeadingLevel, HeadingLevelStyle>,
): Record<HeadingLevel, HeadingLevelStyle> {
  const dummyTitle: HeadingLevelStyle = {
    enabled: false,
    tokenStyle: 'arabic',
    includeParents: false,
    prefix: '',
    suffix: '',
    separator: '',
    startAt: 1,
    restartAfterLevel: null,
    formatVariants: { withLevelOne: [], withoutLevelOne: [] },
    levelTemplate: { tokenStyle: 'arabic', prefix: '', suffix: '' },
    multilevelFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    contextualFormatVariants: { withLevelOne: [], withoutLevelOne: [] },
    numberTitleSpacing: 'none',
  }

  function shiftRefLevel(style: HeadingLevelStyle): HeadingLevelStyle {
    const shift = (lv: HeadingLevel): HeadingLevel =>
      (lv + 1) as HeadingLevel

    const shiftContextual = (segments: readonly ContextualFormatSegment[]): ContextualFormatSegment[] =>
      segments.map(s => s.type === 'level-reference'
        ? { ...s, level: shift(s.level) }
        : { ...s })

    const shiftMultilevel = (segments: readonly MultilevelFormatSegment[]): MultilevelFormatSegment[] =>
      segments.map(s => s.type === 'level-template-reference'
        ? { ...s, level: shift(s.level) }
        : { ...s })

    return {
      ...style,
      contextualFormatVariants: {
        withLevelOne: shiftContextual(style.contextualFormatVariants.withLevelOne),
        withoutLevelOne: shiftContextual(style.contextualFormatVariants.withoutLevelOne),
      },
      multilevelFormatVariants: {
        withLevelOne: shiftMultilevel(style.multilevelFormatVariants.withLevelOne),
        withoutLevelOne: shiftMultilevel(style.multilevelFormatVariants.withoutLevelOne),
      },
      formatVariants: {
        withLevelOne: shiftMultilevel(style.formatVariants.withLevelOne as any) as any,
        withoutLevelOne: shiftMultilevel(style.formatVariants.withoutLevelOne as any) as any,
      },
    }
  }

  return {
    1: dummyTitle,
    2: shiftRefLevel(levels[1]),
    3: shiftRefLevel(levels[2]),
    4: shiftRefLevel(levels[3]),
    5: shiftRefLevel(levels[4]),
    6: shiftRefLevel(levels[5]),
  }
}

/**
 * Compute the enabled heading levels based on current settings.
 * When showLevelOneNumber is false, H1 is excluded from enabled set.
 * Individual levelStyle.enabled flags can also exclude specific levels.
 */
export function getEnabledHeadingLevels(
  levels: Record<HeadingLevel, HeadingLevelStyle>,
  showLevelOneNumber: boolean,
): HeadingLevel[] {
  return HEADING_LEVELS.filter(lv => {
    if (lv === 1 && !showLevelOneNumber) return false
    const style = levels[lv]
    if (!style) return false
    return style.enabled
  })
}

/**
 * Map actual heading level to visible numbering depth (1-based).
 * Returns null if the level is not enabled for numbering.
 *
 * Example when H1 is off (showLevelOneNumber=false):
 *   getNumberingDepth(1, [...]) === null
 *   getNumberingDepth(2, [...]) === 1
 *   getNumberingDepth(3, [...]) === 2
 */
export function getNumberingDepth(
  actualLevel: HeadingLevel,
  enabledLevels: readonly HeadingLevel[],
): number | null {
  const index = enabledLevels.indexOf(actualLevel)
  return index >= 0 ? index + 1 : null
}

/**
 * Info about heading numbering mode passed to the engine.
 * Each heading maps to 'numbered' or 'unnumbered'.
 * undefined entries are treated as 'numbered' (default).
 */
export type HeadingOverrideMap = Map<string, 'numbered' | 'unnumbered'>

/**
 * Pure function: compute hierarchical heading numbering with per-level styling.
 *
 * Supports per-heading override: unnumbered headings can skip counter or
 * consume-and-hide. Parent references for unnumbered ancestors are omitted.
 *
 * @param headings - Flat list of heading descriptors from DOM
 * @param settings - Numbering settings
 * @param overrideMap - Optional per-heading override mode (key = heading key)
 * @param counterPolicy - Policy for unnumbered headings (default: 'skip')
 */
export function computeHeadingNumbering(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
  overrideMap?: HeadingOverrideMap,
  counterPolicy?: UnnumberedCounterPolicy,
): NumberedHeading[] {
  const counters: number[] = [0, 0, 0, 0, 0, 0]
  // Use structure resolver for authoritative H1 visibility
  const structure = (settings as any)._resolvedStructure
    || (settings.headingStructureMode
      ? { showLevelOneNumber: settings.headingStructureMode === 'loose' }
      : { showLevelOneNumber: settings.showLevelOneNumber })
  const isStrict = !structure.showLevelOneNumber
  const skipH1 = isStrict

  // ── Build effective levels using shared style slot model ──
  const rawLevels = settings.levels
  const effectiveLevels: Record<HeadingLevel, HeadingLevelStyle> = isStrict
    ? buildStrictEffectiveLevels(rawLevels)
    : rawLevels

  const levelStyles: Record<HeadingLevel, HeadingLevelStyle> = effectiveLevels

  // Initialize counters with startAt - 1 (uses effective levels)
  for (let i = 0; i < 6; i++) {
    const lv = (i + 1) as HeadingLevel
    const style = levelStyles[lv]
    if (style) {
      counters[i] = clamp(style.startAt, 1, 999) - 1
    }
  }
  const policy = counterPolicy ?? 'skip'

  return headings
    .filter((h) => h.level <= settings.maxDepth)
    .map((h) => {
      const idx = h.level - 1
      const style = levelStyles[h.level]

      // ── Check per-heading override ──────────────────
      const overrideMode = overrideMap?.get(h.key)
      const isUnnumbered = overrideMode === 'unnumbered'
      const shouldSkipCount = isUnnumbered && policy === 'skip'
      const shouldConsumeCount = isUnnumbered && policy === 'consume'

      // ── restartAfterLevel ──────────────────────────
      if (style?.restartAfterLevel != null) {
        // no-op; handled below
      }

      // Increment current level (skip for unnumbered+skip)
      if (!shouldSkipCount) {
        counters[idx]++
      } else {
        // Still need a placeholder for parent omission detection
        counters[idx] = 0
      }

      // Reset deeper levels
      if (!shouldSkipCount) {
        for (let i = idx + 1; i < 6; i++) {
          const deeperStyle = levelStyles[(i + 1) as HeadingLevel]
          if (deeperStyle?.restartAfterLevel != null && deeperStyle.restartAfterLevel <= h.level) {
            counters[i] = clamp(deeperStyle.startAt, 1, 999) - 1
          } else if (deeperStyle?.restartAfterLevel == null) {
            // no-op: null = continuous
          } else {
            if (deeperStyle.restartAfterLevel >= h.level) {
              counters[i] = clamp(deeperStyle.startAt, 1, 999) - 1
            }
          }
        }
      }

      // Build full active counters
      const activeCounters: number[] = counters.slice(0, idx + 1)
      for (let i = 0; i < idx; i++) {
        if (counters[i] < 1) activeCounters[i] = 0
      }

      // Unnumbered: no label
      if (isUnnumbered) {
        return { ...h, counters: [...activeCounters], label: '', labelGap: 'none' }
      }

      // H1 completely hidden when showLevelOneNumber is false
      if (skipH1 && idx === 0) {
        return { ...h, counters: [...activeCounters], label: '', labelGap: 'none' }
      }

      // Loose H6: check if S6 is configured
      if (!isStrict && h.level === 6) {
        if (!settings.s6Configured) {
          // S6 not configured → native H6, return no label
          return { ...h, counters: [...activeCounters], label: '', labelGap: 'none' }
        }
      }

      // Build unnumbered-set for parent omission
      const unnumberedSet = buildUnnumberedSet(headings, 0, headings.indexOf(h), overrideMap, policy)

      const label = buildLabel(activeCounters, levelStyles, skipH1, idx, h.level, unnumberedSet)

      // ── Compute labelGap from the heading's own numberTitleSpacing ──
      const gapSetting = style?.numberTitleSpacing ?? 'space'
      const labelGap = label !== '' && gapSetting === 'space' ? 'space' : 'none'

      return { ...h, counters: [...activeCounters], label, labelGap }
    })
}

function buildLabel(
  activeCounters: number[],
  levelStyles: Record<HeadingLevel, HeadingLevelStyle>,
  skipH1: boolean,
  currentIdx: number,
  headingLevel: HeadingLevel,
  unnumberedSet?: Set<HeadingLevel>,
): string {
  // Style lookup by actual heading level — H2→H2 config, H3→H3 config
  const style = levelStyles[headingLevel]
  if (!style || !style.enabled) return ''

  // ── New contextual model (schemaVersion >= 8) ───
  // Slot model: effective levels already have correct variant data.
  // Always use withLevelOne since strict mode effective levels are pre-shifted.
  const contextualVariant = style.contextualFormatVariants.withLevelOne
  if (contextualVariant && contextualVariant.length > 0) {
    return buildLabelFromContextualFormat(activeCounters, headingLevel, contextualVariant, skipH1, unnumberedSet)
  }

  // ── New two-layer model (schemaVersion >= 7) ──────
  const multilevelVariant = style.multilevelFormatVariants.withLevelOne
  if (multilevelVariant && multilevelVariant.length > 0) {
    return buildLabelFromMultilevelFormat(activeCounters, levelStyles, skipH1, headingLevel)
  }

  // ── Legacy format-based label (schemaVersion < 7) ─
  if (style.contextualFormatVariants) {
    return ''
  }

  const activeVariant = style.formatVariants.withLevelOne
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
      if (unnumberedSet?.has(actualLv)) continue
      const tokenStyle = st.tokenStyle
      const token = formatToken(activeCounters[i], tokenStyle)
      parts.push(st.prefix + token + st.suffix)
    }
    return parts.join(style.separator)
  }

  const token = formatToken(activeCounters[currentIdx], style.tokenStyle)
  return style.prefix + token + style.suffix
}

/**
 * Build a set of heading levels that are unnumbered (for parent omission).
 * Looks backward from current heading to find unnumbered ancestors whose
 * counters are 0 (indicating they were skipped).
 */
function buildUnnumberedSet(
  headings: readonly HeadingDescriptor[],
  startIdx: number,
  currentIdx: number,
  overrideMap?: HeadingOverrideMap,
  _counterPolicy?: UnnumberedCounterPolicy,
): Set<HeadingLevel> {
  const set = new Set<HeadingLevel>()
  if (!overrideMap) return set

  // Collect ancestors of the current heading
  const ancestorLevels: HeadingLevel[] = []
  let foundLevel = 0
  for (let i = currentIdx; i >= 0; i--) {
    const h = headings[i]
    if (h.level <= foundLevel || foundLevel === 0) {
      if (h.level < foundLevel || (foundLevel === 0 && i < currentIdx)) {
        ancestorLevels.unshift(h.level)
        foundLevel = h.level
        if (h.level === 1) break
      }
    }
  }

  // Check each ancestor for unnumbered override
  for (const h of headings.slice(0, currentIdx + 1)) {
    const mode = overrideMap.get(h.key)
    if (mode === 'unnumbered') {
      set.add(h.level)
    }
  }

  return set
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
  unnumberedSet?: Set<HeadingLevel>,
): string {
  // Filter hidden levels (H1 when skipH1) and unnumbered parent references.
  // IMPORTANT: only hide levels STRICTLY BELOW headingLevel — the heading's own
  // level reference must never be hidden by unnumbered siblings at the same level.
  const hidden = new Set<HeadingLevel>()
  if (skipH1) hidden.add(1 as HeadingLevel)
  if (unnumberedSet) {
    for (const lv of unnumberedSet) {
      if (lv < headingLevel) hidden.add(lv)
    }
  }
  // Filter out level-references to hidden levels
  let effective = format.filter(s => s.type === 'literal' || !hidden.has(s.level))

  // Clean up orphaned separators: if a literal is now adjacent to another
  // literal or at start/end of remaining segments, remove it if it looks
  // like a pure separator (e.g., ".", "-", "/", " ").
  effective = cleanOrphanSeparators(effective)

  return renderContextualFormat(effective, activeCounters)
}

/**
 * Remove orphaned separator literals that are now adjacent to
 * other literals or at the start/end of the segment list (due to
 * omitted level-references).
 */
function cleanOrphanSeparators(
  segments: readonly ContextualFormatSegment[],
): ContextualFormatSegment[] {
  if (segments.length <= 1) return [...segments]

  const result = [...segments]
  const SEPARATOR_PATTERN = /^[\.\-\/，,、：:·\s]+$/

  for (let i = result.length - 1; i >= 0; i--) {
    const seg = result[i]
    if (seg.type !== 'literal') continue
    if (!SEPARATOR_PATTERN.test(seg.value)) continue

    const prev = i > 0 ? result[i - 1] : null
    const next = i < result.length - 1 ? result[i + 1] : null

    // Orphaned at start or end
    if (!prev || !next) {
      result.splice(i, 1)
      continue
    }

    // Both neighbors are now literals (levels were removed)
    if (prev.type === 'literal' && next.type === 'literal') {
      // Merge adjacent literals
      result[i - 1] = { ...prev, value: prev.value + seg.value + next.value }
      result.splice(i, 2)
      continue
    }

    // Only one side is literal and the other was a level-reference that got removed
    // → this separator is now adjacent to just one literal
    if (prev.type === 'literal' || next.type === 'literal') {
      // Keep it only if it's meaningful between the literal and the remaining ref
      // For simplicity, remove pure separators between literal and ref
      continue
    }
  }

  return result.filter(s => s.type === 'level-reference' || s.value.length > 0)
}

// ── Contextual format variant helpers ───────────────

/**
 * Ensure the format contains a level-reference for the given editing level.
 * Returns a new array; does not mutate the input.
 * If the current level exists, returns the format unchanged.
 * If absent, appends a new ref with the level's current tokenStyle.
 */
export function ensureCurrentLevelSegment(
  level: HeadingLevel,
  segments: readonly ContextualFormatSegment[],
  currentTokenStyle: NumberTokenStyle,
): ContextualFormatSegment[] {
  const hasOwnRef = segments.some(
    s => s.type === 'level-reference' && s.level === level,
  )
  if (hasOwnRef) return [...segments]
  return [
    ...segments,
    {
      id: generateStableId(),
      type: 'level-reference' as const,
      level,
      appearance: { tokenStyle: currentTokenStyle, prefix: '', suffix: '' },
    },
  ]
}

// ──

/**
 * Strip H1 level-references from a contextual format segment array.
 * Removes H1 references and adjacent separator literals, then cleans
 * leading/trailing separators. Falls back to the heading's own level reference
 * if all references are stripped (e.g., custom format only referenced H1).
 */
function stripContextualLevelOneRefs(
  format: readonly ContextualFormatSegment[],
  headingLevel: HeadingLevel,
): ContextualFormatSegment[] {
  if (format.length === 0) return []

  const SEP = new Set(['.', '-', '_', '、', '，', ',', ':', '：', '/', '\\', '·', ' '])
  const isSep = (v: string) => [...v.trim()].every(c => SEP.has(c)) || v.trim() === ''

  const result: ContextualFormatSegment[] = []
  for (let i = 0; i < format.length; i++) {
    const seg = format[i]
    if (seg.type === 'level-reference' && seg.level === 1) {
      // Remove H1 reference and adjacent separator
      if (result.length > 0 && result[result.length - 1].type === 'literal') {
        const last = result[result.length - 1]
        if (isSep((last as { type: 'literal'; value: string }).value)) result.pop()
      }
      while (i + 1 < format.length && format[i + 1].type === 'literal') {
        if (!isSep((format[i + 1] as { type: 'literal'; value: string }).value)) break
        i++
      }
      continue
    }
    result.push({ ...seg })
  }

  // Clean leading/trailing separator literals
  while (result.length > 0 && result[0].type === 'literal' && isSep((result[0] as { type: 'literal'; value: string }).value) && (result[0] as { type: 'literal'; value: string }).value.trim() !== '') {
    result.shift()
  }
  // Also remove empty literals at start
  while (result.length > 0 && result[0].type === 'literal' && (result[0] as { type: 'literal'; value: string }).value.trim() === '') {
    result.shift()
  }
  while (result.length > 0 && result[result.length - 1].type === 'literal') {
    const last = result[result.length - 1] as { type: 'literal'; value: string }
    if (!isSep(last.value) && last.value.trim() !== '') break
    result.pop()
  }

  // Merge adjacent literals
  const merged: ContextualFormatSegment[] = []
  for (const seg of result) {
    if (seg.type === 'literal' && merged.length > 0 && merged[merged.length - 1].type === 'literal') {
      (merged[merged.length - 1] as { type: 'literal'; value: string }).value +=
        (seg as { type: 'literal'; value: string }).value
    } else {
      merged.push({ ...seg })
    }
  }

  // Ensure at least one level-reference exists: use heading's own level as anchor
  const hasOwnRef = merged.some(s => s.type === 'level-reference' && s.level === headingLevel)
  if (!hasOwnRef && merged.length > 0) {
    // Check if any level-reference exists at all
    const anyRef = merged.find(s => s.type === 'level-reference')
    if (!anyRef) {
      merged.push({
        id: 'auto-' + Date.now(),
        type: 'level-reference',
        level: headingLevel,
        appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
      })
    } else {
      // Other level-refs exist but current level is missing — add it at end
      merged.push({
        id: 'auto-' + Date.now(),
        type: 'level-reference',
        level: headingLevel,
        appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
      })
    }
  }
  // If completely empty, add heading's own ref
  if (merged.length === 0) {
    merged.push({
      id: 'auto-' + Date.now(),
      type: 'level-reference',
      level: headingLevel,
      appearance: { tokenStyle: 'arabic', prefix: '', suffix: '' },
    })
  }

  return merged
}

/**
 * Get the active contextual format variant for the current H1 visibility.
 * When withoutLevelOne is empty (e.g., custom edits only touched withLevelOne),
 * it's dynamically derived from withLevelOne by stripping H1 references.
 * This prevents H2-H6 from showing no label or wrong configs when H1 is off.
 */
export function getActiveContextualFormatVariant(
  style: HeadingLevelStyle,
  showLevelOneNumber: boolean,
  level: HeadingLevel,
): readonly ContextualFormatSegment[] {
  const variants = style.contextualFormatVariants
  if (!variants) return []
  if (level === 1) return variants.withLevelOne
  if (showLevelOneNumber) return variants.withLevelOne
  // When H1 is hidden: prefer withoutLevelOne, but fall back to
  // deriving from withLevelOne if withoutLevelOne is empty (e.g.,
  // user only edited format while H1 was visible).
  if (variants.withoutLevelOne.length > 0) return variants.withoutLevelOne
  // Derive withoutLevelOne by stripping H1 references from withLevelOne
  return stripContextualLevelOneRefs(variants.withLevelOne, level)
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
  for (let lv = start; lv <= currentLevel; lv++) {
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
  for (let lv = start; lv <= currentLevel; lv++) {
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
 * Runtime diagnostic: output first 6 headings' structure to console.table.
 * Shows actualLevel, enabled, visibleDepth, styleLevel, label for each heading.
 * Helpful for tracing where H2 numbering breaks in the processing chain.
 */
export function diagnoseHeadingChain(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
): void {
  const result = computeHeadingNumbering(headings, settings)
  const enabledLevels = getEnabledHeadingLevels(settings.levels, settings.showLevelOneNumber ?? false)

  const table = result.slice(0, Math.min(6, result.length)).map(h => {
    const depth = getNumberingDepth(h.level as HeadingLevel, enabledLevels)
    return {
      text: h.text.slice(0, 30),
      actualLevel: h.level,
      enabled: settings.levels[h.level as HeadingLevel]?.enabled ?? false,
      visibleDepth: depth,
      styleLevel: h.level,
      label: h.label,
    }
  })

  console.group('[InkChapter] Heading diagnostic')
  console.table(table)
  console.log('enabledLevels:', enabledLevels)
  console.log('showLevelOneNumber:', settings.showLevelOneNumber)
  console.groupEnd()
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
