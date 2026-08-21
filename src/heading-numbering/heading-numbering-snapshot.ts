/**
 * Heading Numbering Snapshot — the atomic authority boundary that publishes, in
 * one revision, BOTH the physical numbered headings AND the canonical semantic
 * heading states, computed from the SAME source inputs.
 *
 * This is the fix for authority ownership: the revision is allocated INSIDE
 * this boundary (previousRevision + 1), so a caller cannot inject an arbitrary
 * `sourceRevision` that pretends to match a different physical snapshot.
 *
 * The future Caption system consumes `snapshot.semantic`; it must NOT
 * independently rerun semantic numbering from a different document state.
 */

import type {
  HeadingDescriptor,
  HeadingNumberingSettings,
  NumberedHeading,
  UnnumberedCounterPolicy,
} from './heading-types'
import { computeHeadingNumbering, type HeadingOverrideMap } from './numbering-engine'
import { resolveHeadingStructure } from './heading-structure'
import { computeSemanticHeadingNumbers, resolveSemanticStartAt } from './semantic-heading-numbering'
import type { HeadingStructureMode, SemanticHeadingNumberState } from './semantic-heading-types'

export interface HeadingNumberingSnapshot {
  /** Monotonic revision allocated by this authority (previousRevision + 1). */
  revision: number
  structureMode: HeadingStructureMode
  /** The FULL source heading descriptors (unfiltered by maxDepth). */
  headings: readonly HeadingDescriptor[]
  /** Physical numbered headings (filtered by maxDepth, for display). */
  physical: readonly NumberedHeading[]
  /** Canonical semantic heading states (full structural tree, all depths). */
  semantic: readonly SemanticHeadingNumberState[]
}

/**
 * Compute one atomic physical + semantic heading numbering snapshot.
 *
 * Policy invariants:
 * - physical and semantic share the same heading descriptors, settings,
 *   override map and counter policy;
 * - revision = previousRevision + 1, and every semantic.sourceRevision equals it;
 * - `maxDepth` only filters the physical display list (semantic keeps the full
 *   structural tree).
 */
export function computeHeadingNumberingSnapshot(
  headings: readonly HeadingDescriptor[],
  settings: HeadingNumberingSettings,
  overrideMap?: HeadingOverrideMap,
  counterPolicy?: UnnumberedCounterPolicy,
  previousRevision?: number,
): HeadingNumberingSnapshot {
  const revision = (previousRevision ?? 0) + 1
  const structureMode = resolveHeadingStructure(settings).mode

  const physical = computeHeadingNumbering(headings, settings, overrideMap, counterPolicy)
  const semantic = computeSemanticHeadingNumbers(headings, structureMode, {
    startAt: resolveSemanticStartAt(settings, structureMode),
    sourceRevision: revision,
    overrideMap,
    counterPolicy,
  })

  return { revision, structureMode, headings, physical, semantic }
}
