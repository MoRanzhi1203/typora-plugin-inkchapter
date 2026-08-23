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
  const { startAt, sourceRevision, overrideMap, counterPolicy = 'skip' } = options
  const roles = resolveSemanticRoles(headings, mode)

  // nextOrdinal[i] = next ordinal to assign at effective depth i+1.
  const nextOrdinal: number[] = []
  for (let i = 0; i < 6; i++) {
    nextOrdinal[i] = clamp(startAt[i] ?? 1, 1, 999)
  }
  // currentCounted[i] = current counted ordinal at effective depth i+1 (null = none).
  const currentCounted: Array<number | null> = [null, null, null, null, null, null]

  return roles.map(role => {
    const depth = role.effectiveDepth
    const isTitle = role.semanticRole === 'document-title' || depth < 1

    if (isTitle) {
      for (let i = 0; i < 6; i++) {
        nextOrdinal[i] = clamp(startAt[i] ?? 1, 1, 999)
        currentCounted[i] = null
      }
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
 * Derive semantic start values from heading-numbering settings.
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
