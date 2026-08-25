/**
 * Heading Structure Mode — authoritative structure resolution.
 *
 * Replaces the legacy `showLevelOneNumber` boolean with explicit
 * `strict` / `loose` mode semantics.
 *
 * Strict mode:
 *   H1 = unique document title, not numbered.
 *   Numbering starts at physical H2.
 *   Requires exactly 1 H1 (validated, not enforced).
 *
 * Loose mode:
 *   H1 = normal first-level heading, participates in numbering.
 *   Unlimited H1 count.
 */

import type { HeadingLevel } from './heading-types'

export type HeadingStructureMode = 'strict' | 'loose'

export interface ResolvedHeadingStructure {
  mode: HeadingStructureMode
  /** Derived: whether H1 should display a number. */
  showLevelOneNumber: boolean
  /** Physical level where numbering starts (1 in loose, 2 in strict). */
  numberingRootPhysicalLevel: HeadingLevel
  /** Default level to select in the format content editor when no level is selected. */
  defaultEditablePhysicalLevel: HeadingLevel
  /** Whether the structure requires exactly 1 H1. */
  requiresSingleH1: boolean
}

export interface HeadingStructureValidation {
  mode: HeadingStructureMode
  h1Count: number
  state: HeadingStructureValidationState
}

export type HeadingStructureValidationState = 'valid' | 'missing-title' | 'multiple-h1'

/** Raw settings pick needed for structure resolution. */
interface StructureSettings {
  headingStructureMode?: HeadingStructureMode
  showLevelOneNumber?: boolean
}

/**
 * Resolve the authoritative heading structure from settings.
 *
 * Priority:
 * 1. `headingStructureMode` if present and valid
 * 2. Legacy `showLevelOneNumber` fallback: true→loose, false→strict
 * 3. Default: strict
 */
export function resolveHeadingStructure(
  settings: StructureSettings,
): ResolvedHeadingStructure {
  let mode: HeadingStructureMode

  if (settings.headingStructureMode === 'strict' || settings.headingStructureMode === 'loose') {
    mode = settings.headingStructureMode
  } else if (settings.showLevelOneNumber === true) {
    mode = 'loose'
  } else {
    mode = 'strict'
  }

  return buildResolved(mode)
}

function buildResolved(mode: HeadingStructureMode): ResolvedHeadingStructure {
  if (mode === 'strict') {
    return {
      mode: 'strict',
      showLevelOneNumber: false,
      numberingRootPhysicalLevel: 2,
      defaultEditablePhysicalLevel: 2,
      requiresSingleH1: true,
    }
  }
  return {
    mode: 'loose',
    showLevelOneNumber: true,
    numberingRootPhysicalLevel: 1,
    defaultEditablePhysicalLevel: 1,
    requiresSingleH1: false,
  }
}

/** Convenience: resolve just the mode string. */
export function resolveHeadingStructureMode(
  settings: StructureSettings,
): HeadingStructureMode {
  return resolveHeadingStructure(settings).mode
}

/** Convenience: is the resolved mode strict? */
export function isStrictHeadingStructure(settings: StructureSettings): boolean {
  return resolveHeadingStructure(settings).mode === 'strict'
}

/**
 * Derive the legacy mirror fields for a structure mode.
 * `headingStructureMode` is the SINGLE authority; `showLevelOneNumber` is a
 * compatibility mirror ONLY (mode always wins).
 */
export function deriveModeMirror(
  mode: HeadingStructureMode,
): { headingStructureMode: HeadingStructureMode; showLevelOneNumber: boolean } {
  return { headingStructureMode: mode, showLevelOneNumber: mode === 'loose' }
}

// ── Style slot model ──────────────────────────────────

/** Style slot index: 1-5 are shared, 6 is loose-only extension. */
export type StyleSlot = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Resolve which style slot a physical heading maps to.
 *
 * strict: H1→null, H2→1, H3→2, H4→3, H5→4, H6→5
 * loose:  H1→1, H2→2, H3→3, H4→4, H5→5, H6→6
 */
export function resolveStyleSlot(
  mode: HeadingStructureMode,
  physicalLevel: HeadingLevel,
): StyleSlot | null {
  if (mode === 'strict') {
    if (physicalLevel === 1) return null
    return (physicalLevel - 1) as StyleSlot
  }
  return physicalLevel as StyleSlot
}

/**
 * Reverse mapping: given a style slot index, return the physical heading level
 * that the slot maps to in the given mode.
 *
 * strict: S1→H2, S2→H3, S3→H4, S4→H5, S5→H6
 * loose:  S1→H1, S2→H2, ..., S6→H6
 * Returns null for S6 in strict mode.
 */
export function resolvePhysicalHeadingForStyleSlot(
  mode: HeadingStructureMode,
  slot: StyleSlot,
): HeadingLevel | null {
  if (mode === 'strict') {
    if (slot === 6) return null // S6 not used in strict
    return (slot + 1) as HeadingLevel
  }
  return slot as HeadingLevel
}

/** Validate heading structure for a document. */
export function validateHeadingStructure(
  headings: ReadonlyArray<{ level: number }>,
  mode: HeadingStructureMode,
): HeadingStructureValidation {
  if (mode === 'loose') {
    return { mode, h1Count: 0, state: 'valid' }
  }

  const h1Count = headings.filter(h => h.level === 1).length

  if (h1Count === 0) {
    return { mode, h1Count: 0, state: 'missing-title' }
  }
  if (h1Count >= 2) {
    return { mode, h1Count, state: 'multiple-h1' }
  }
  return { mode, h1Count: 1, state: 'valid' }
}
