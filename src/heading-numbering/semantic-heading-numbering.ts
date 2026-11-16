/**
 * Canonical Semantic Heading Counter Engine — the shared authority that numbers
 * headings by semantic EFFECTIVE DEPTH, not physical H level.
 *
 * This is the fix for the previously proven SEMANTIC_ORDINAL_AUTHORITY_GAP:
 * physical `counters[level-1]` cannot represent heterogeneous loose roots or
 * same-chapter heterogeneous section levels. Semantic counters keyed by
 * effective depth can.
 *
 * This lives INSIDE the heading-numbering boundary. It shares stable identity,
 * override map, counter policy and start values with the physical engine, but
 * produces a SEPARATE parallel state. It never parses DOM numbers, visible
 * labels or sidebar text.
 *
 * Two independent notions are maintained per heading:
 *   - STRUCTURAL role + ancestry (from `resolveSemanticRoles`), never lost when
 *     a heading is unnumbered + skip;
 *   - COUNTED ordinal state (semanticPath / chapterOrdinal / sectionOrdinal),
 *     which is null for an unnumbered + skip heading and its own level.
 */

import type { UnnumberedCounterPolicy, HeadingNumberingSettings } from './heading-types'
import type { HeadingOverrideMap } from './numbering-engine'
import { computeHeadingNumbering } from './numbering-engine'
import { resolveSemanticRoles } from './semantic-heading-resolver'
import type {
  HeadingLevel,
  HeadingStructureMode,
  PhysicalHeading,
  SemanticHeadingNumberState,
} from './semantic-heading-types'

export interface SemanticCounterOptions {
  /** Start value per effective depth. Index 0 = depth 1 (chapter), 1 = section, ... */
  startAt: readonly number[]
  /**
   * R12: start value per PHYSICAL heading level (index 0 = H1). Drives the
   * canonical physical path used by object numbering scopes. When omitted all
   * physical levels start at 1.
   */
  physicalStartAt?: readonly number[]
  /**
   * R12 — canonical PHYSICAL display path per heading key, produced by
   * `computePhysicalHeadingPaths()` from the SAME physical numbering engine the
   * heading display consumes. When present it is authoritative; the internal
   * simplified counters are only a fallback for callers without a settings
   * context (legacy tests).
   */
  physicalPathsByKey?: ReadonlyMap<string, readonly (number | null)[]>
  sourceRevision: number
  overrideMap?: HeadingOverrideMap
  counterPolicy?: UnnumberedCounterPolicy
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n) || n < min) return min
  if (n > max) return max
  return n
}

/**
 * Compute canonical semantic heading numbers in document order.
 *
 * Semantic counters are keyed by effective depth:
 *   depth 1 = chapter, depth 2 = section, depth 3 = subsection, >=4 = item.
 * Deeper depths reset when a shallower heading appears (structural hierarchy).
 *
 * Count policy:
 * - document-title: never consumes the chapter sequence.
 * - unnumbered + skip: keeps structural role/ancestry, does NOT consume its own
 *   ordinal, and descendants do NOT gain a counted ordinal from it.
 * - unnumbered + consume: consumes its own ordinal (descendants inherit it) but
 *   is hidden.
 */
export function computeSemanticHeadingNumbers(
  headings: readonly PhysicalHeading[],
  mode: HeadingStructureMode,
  options: SemanticCounterOptions,
): SemanticHeadingNumberState[] {
  const { startAt, sourceRevision, overrideMap, counterPolicy = 'skip', physicalStartAt, physicalPathsByKey } = options
  const roles = resolveSemanticRoles(headings, mode)

  // nextOrdinal[i] = next ordinal to assign at effective depth i+1.
  const nextOrdinal: number[] = []
  for (let i = 0; i < 6; i++) {
    nextOrdinal[i] = clamp(startAt[i] ?? 1, 1, 999)
  }
  // currentCounted[i] = current counted ordinal at effective depth i+1 (null = none).
  const currentCounted: Array<number | null> = [null, null, null, null, null, null]

  // R12: PHYSICAL H1–H6 counters, independent from the semantic depth counters.
  // They never drive heading display; they only expose "what physical heading
  // path is this heading under" to object numbering scopes.
  const nextPhysical: number[] = []
  const currentPhysical: Array<number | null> = [null, null, null, null, null, null]
  const resetPhysical = (from: number): void => {
    for (let i = from; i < 6; i++) {
      nextPhysical[i] = clamp(physicalStartAt?.[i] ?? 1, 1, 999)
      currentPhysical[i] = null
    }
  }
  resetPhysical(0)

  return roles.map(role => {
    const depth = role.effectiveDepth
    const isTitle = role.semanticRole === 'document-title' || depth < 1

    if (isTitle) {
      for (let i = 0; i < 6; i++) {
        nextOrdinal[i] = clamp(startAt[i] ?? 1, 1, 999)
        currentCounted[i] = null
      }
      // A strict H1 document title is a numbering boundary, not a path level.
      resetPhysical(0)
      return {
        stableIdentity: role.stableIdentity,
        physicalLevel: role.physicalLevel,
        effectiveDepth: depth,
        semanticRole: role.semanticRole,
        structuralParentIdentity: role.structuralParentIdentity,
        structuralChapterIdentity: role.structuralChapterIdentity,
        structuralSectionIdentity: role.structuralSectionIdentity,
        strictBoundaryIdentity: role.strictBoundaryIdentity,
        strictBoundaryOrdinal: role.strictBoundaryOrdinal,
        ordinalByDepth: [],
        displayCountedPath: [],
        physicalPathByLevel: physicalPathsByKey?.get(role.stableIdentity) ?? [...currentPhysical],
        physicalPathCanonical: physicalPathsByKey != null,
        logicalOrdinal: null,
        chapterOrdinal: null,
        sectionOrdinal: null,
        sourceRevision,
        counted: false,
        countingReason: 'DOCUMENT_TITLE',
      }
    }

    const isUnnumbered = overrideMap?.get(role.stableIdentity) === 'unnumbered'
    const isSkip = isUnnumbered && counterPolicy === 'skip'

    let ownOrdinal: number | null
    let countingReason: string

    if (isSkip) {
      ownOrdinal = null
      countingReason = 'UNNUMBERED_SKIP'
      currentCounted[depth - 1] = null
    } else {
      ownOrdinal = nextOrdinal[depth - 1]
      nextOrdinal[depth - 1]++
      currentCounted[depth - 1] = ownOrdinal
      countingReason = isUnnumbered ? 'UNNUMBERED_CONSUME' : 'COUNTED'
    }

    // A new structural heading at this depth starts a fresh deeper sequence.
    for (let i = depth; i < 6; i++) {
      nextOrdinal[i] = clamp(startAt[i] ?? 1, 1, 999)
      currentCounted[i] = null
    }

    // R12: consume the PHYSICAL counter of this heading's own physical level.
    // Unnumbered+skip keeps a null slot (the level is structural, not counted).
    const physicalIndex = role.physicalLevel - 1
    if (isSkip) {
      currentPhysical[physicalIndex] = null
    } else {
      currentPhysical[physicalIndex] = nextPhysical[physicalIndex]
      nextPhysical[physicalIndex]++
    }
    resetPhysical(role.physicalLevel)

    const ordinalByDepth = currentCounted.slice(0, depth)
    const displayCountedPath = ordinalByDepth.filter((v): v is number => v !== null)

    return {
      stableIdentity: role.stableIdentity,
      physicalLevel: role.physicalLevel,
      effectiveDepth: depth,
      semanticRole: role.semanticRole,
      structuralParentIdentity: role.structuralParentIdentity,
      structuralChapterIdentity: role.structuralChapterIdentity,
      structuralSectionIdentity: role.structuralSectionIdentity,
      strictBoundaryIdentity: role.strictBoundaryIdentity,
      strictBoundaryOrdinal: role.strictBoundaryOrdinal,
      ordinalByDepth,
      displayCountedPath,
      physicalPathByLevel: physicalPathsByKey?.get(role.stableIdentity) ?? [...currentPhysical],
      physicalPathCanonical: physicalPathsByKey != null,
      logicalOrdinal: ownOrdinal,
      chapterOrdinal: ordinalByDepth[0] ?? null,
      sectionOrdinal: ordinalByDepth[1] ?? null,
      sourceRevision,
      counted: ownOrdinal !== null,
      countingReason,
    }
  })
}

/**
 * R12 — canonical PHYSICAL display path per heading key.
 *
 * The path is taken from the SAME `computeHeadingNumbering()` counters that
 * produce the visible heading label, so object numbering can never invent a
 * section number that the heading display does not use (custom `startAt`,
 * `restartAfterLevel: null`, disabled levels, skipped levels, unnumbered
 * ancestors).
 *
 * Rules:
 *   - strict H1 (document title) is a boundary, never a path component;
 *   - a level whose style is disabled / outside maxDepth / loose-H6
 *     unconfigured never contributes a component;
 *   - an unnumbered heading never contributes its own component, and its
 *     level is omitted from descendants (matching parent omission);
 *   - strict mode truncates the path at the FIRST missing intermediate level
 *     (the display engine suppresses zero-filled paths entirely).
 *
 * Loose mode keeps the dense visible path (no zero-fill suppression), matching
 * its display behavior.
 */
export function computePhysicalHeadingPaths(
  headings: readonly PhysicalHeading[],
  settings: HeadingNumberingSettings,
  mode: HeadingStructureMode,
  overrideMap?: HeadingOverrideMap,
  counterPolicy: UnnumberedCounterPolicy = 'skip',
): Map<string, (number | null)[]> {
  const numbered = computeHeadingNumbering(headings, settings, overrideMap, counterPolicy)
  const countersByKey = new Map(numbered.map(n => [n.key, n.counters]))
  const visible = physicalLevelVisibility(settings, mode)

  const paths = new Map<string, (number | null)[]>()
  const unnumberedLevels = new Set<number>()

  for (const heading of headings) {
    const level = heading.level
    // A heading at level L ends the unnumbered marker of L and every deeper level.
    for (const marked of [...unnumberedLevels]) {
      if (marked >= level) unnumberedLevels.delete(marked)
    }

    const path: Array<number | null> = [null, null, null, null, null, null]
    const counters = countersByKey.get(heading.key)
    const isUnnumbered = overrideMap?.get(heading.key) === 'unnumbered'

    if (counters) {
      for (let lv = 1; lv <= level; lv++) {
        if (!visible[lv - 1]) continue
        if (unnumberedLevels.has(lv)) continue
        const counter = counters[lv - 1] ?? 0
        if (counter >= 1) path[lv - 1] = counter
      }
      if (isUnnumbered) path[level - 1] = null

      if (mode === 'strict') {
        // Strict display suppresses a number entirely when an intermediate
        // component is missing; keep only the prefix before the first gap.
        for (let lv = 2; lv <= level; lv++) {
          if (!visible[lv - 1]) continue
          if (path[lv - 1] == null) {
            for (let deeper = lv - 1; deeper < 6; deeper++) path[deeper] = null
            break
          }
        }
      }
    }

    if (isUnnumbered) unnumberedLevels.add(level)
    paths.set(heading.key, path)
  }

  return paths
}

/** Physical level → whether it contributes to the visible heading number. */
function physicalLevelVisibility(
  settings: HeadingNumberingSettings,
  mode: HeadingStructureMode,
): boolean[] {
  const visible: boolean[] = [false, false, false, false, false, false]
  for (let lv = 1; lv <= 6; lv++) {
    if (lv > settings.maxDepth) continue
    if (mode === 'strict' && lv === 1) continue
    if (mode === 'loose' && lv === 6 && !settings.s6Configured) continue
    // Strict H2-H6 consume the shifted slot levels[1..5].
    const slot = (mode === 'strict' ? lv - 1 : lv) as HeadingLevel
    if (slot < 1) continue
    visible[lv - 1] = settings.levels[slot]?.enabled !== false
  }
  return visible
}

/**
 * R12: derive semantic start values from heading-numbering settings.
 *
 * Mapping decision (documented, deterministic):
 *   - strict: semantic depth D inherits physical level D+1 (chapter→H2,
 *     section→H3, subsection→H4, ...).
 *   - loose:  semantic depth D inherits physical level D (chapter→H1,
 *     section→H2, subsection→H3, ...).
 *
 * For heterogeneous loose roots (e.g. a Chapter expressed as H2), the semantic
 * Chapter still inherits the STANDARD loose chapter level (H1) start value,
 * not the physical heading's own level. A per-branch physical-level-dependent
 * start is not defined and is not silently invented.
 */
export function resolveSemanticStartAt(
  settings: HeadingNumberingSettings,
  mode: HeadingStructureMode,
): number[] {
  const startAt: number[] = []
  for (let depth = 1; depth <= 6; depth++) {
    const physicalLevel = (mode === 'strict' ? Math.min(depth + 1, 6) : depth) as HeadingLevel
    startAt[depth - 1] = settings.levels[physicalLevel]?.startAt ?? 1
  }
  return startAt
}

/**
 * R12: derive PHYSICAL H1–H6 start values from heading-numbering settings.
 * Index 0 = H1. Strict mode still reads the physical H1 slot, but the H1
 * document title never consumes it.
 */
export function resolvePhysicalStartAt(settings: HeadingNumberingSettings): number[] {
  const startAt: number[] = []
  for (let level = 1; level <= 6; level++) {
    startAt[level - 1] = settings.levels[level as HeadingLevel]?.startAt ?? 1
  }
  return startAt
}
