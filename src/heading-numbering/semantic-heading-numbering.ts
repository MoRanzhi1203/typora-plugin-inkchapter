/**
 * Canonical Semantic Heading Counter Engine — the missing shared authority that
 * numbers headings by semantic EFFECTIVE DEPTH, not physical H level.
 *
 * This is the fix for the previously proven SEMANTIC_ORDINAL_AUTHORITY_GAP:
 * physical `counters[level-1]` cannot represent heterogeneous loose roots
 * (e.g. `H2→H3` then `H1→H3`) or same-chapter heterogeneous section levels
 * (e.g. `H1→H3→H2`). Semantic counters keyed by effective depth can.
 *
 * This lives INSIDE the heading-numbering boundary. It shares stable identity,
 * override map, counter policy and start values with the physical engine, but
 * produces a SEPARATE parallel state. It never parses DOM numbers, visible
 * labels or sidebar text.
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
 * Deeper depths reset when a shallower depth changes (hierarchical semantic
 * model). `startAt` per depth is supplied explicitly (see `resolveSemanticStartAt`).
 *
 * Shared counting policy:
 * - `overrideMap` marks a heading unnumbered;
 * - `counterPolicy` decides skip (no consume) vs consume (consume, hidden);
 * - document-title never consumes the chapter sequence.
 */
export function computeSemanticHeadingNumbers(
  headings: readonly PhysicalHeading[],
  mode: HeadingStructureMode,
  options: SemanticCounterOptions,
): SemanticHeadingNumberState[] {
  const { startAt, sourceRevision, overrideMap, counterPolicy = 'skip' } = options
  const roles = resolveSemanticRoles(headings, mode)

  // counters[i] = running counter for effective depth i+1.
  const counters: number[] = []
  for (let i = 0; i < 6; i++) {
    counters[i] = clamp(startAt[i] ?? 1, 1, 999) - 1
  }

  return roles.map(role => {
    const depth = role.effectiveDepth

    if (role.semanticRole === 'document-title' || depth < 1) {
      return {
        stableIdentity: role.stableIdentity,
        physicalLevel: role.physicalLevel,
        effectiveDepth: depth,
        semanticRole: role.semanticRole,
        semanticPath: [],
        logicalOrdinal: null,
        chapterOrdinal: null,
        sectionOrdinal: null,
        sourceRevision,
        counted: false,
        countingReason: 'DOCUMENT_TITLE',
      }
    }

    const isUnnumbered = overrideMap?.get(role.stableIdentity) === 'unnumbered'
    if (isUnnumbered && counterPolicy === 'skip') {
      return {
        stableIdentity: role.stableIdentity,
        physicalLevel: role.physicalLevel,
        effectiveDepth: depth,
        semanticRole: role.semanticRole,
        semanticPath: [],
        logicalOrdinal: null,
        chapterOrdinal: null,
        sectionOrdinal: null,
        sourceRevision,
        counted: false,
        countingReason: 'UNNUMBERED_SKIP',
      }
    }

    // Consume a sequence position at this depth.
    counters[depth - 1]++
    // Reset deeper depths.
    for (let i = depth; i < counters.length; i++) {
      counters[i] = clamp(startAt[i] ?? 1, 1, 999) - 1
    }

    const semanticPath = counters.slice(0, depth)
    return {
      stableIdentity: role.stableIdentity,
      physicalLevel: role.physicalLevel,
      effectiveDepth: depth,
      semanticRole: role.semanticRole,
      semanticPath,
      logicalOrdinal: semanticPath[depth - 1] ?? null,
      chapterOrdinal: semanticPath[0] > 0 ? semanticPath[0] : null,
      sectionOrdinal: semanticPath.length >= 2 && semanticPath[1] > 0 ? semanticPath[1] : null,
      sourceRevision,
      counted: true,
      countingReason: isUnnumbered && counterPolicy === 'consume' ? 'UNNUMBERED_CONSUME' : 'COUNTED',
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
