/**
 * Unified semantic numbering model — shared pure types.
 *
 * Two distinct authorities live in the heading-numbering boundary:
 *
 *   1. PHYSICAL heading numbering (NumberedHeading.counters[]) — remains the
 *      sole authority for visible heading display. Never reinterpreted here.
 *   2. CANONICAL SEMANTIC heading numbering (SemanticHeadingNumberState[]) —
 *      a parallel authority keyed by effective depth, produced inside the
 *      heading-numbering boundary. It is the future source for Caption /
 *      Formula / Code numbering.
 *
 * The semantic layer NEVER parses DOM numbers, visible labels, or sidebar text.
 */

export type HeadingStructureMode = 'strict' | 'loose'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export type SemanticHeadingRole =
  | 'document-title'
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'item'

export interface PhysicalHeading {
  /** Stable structural identity (never derived from rendered text). */
  key: string
  level: HeadingLevel
  text: string
}

/**
 * Role interpretation of a physical heading. This carries NO ordinal value;
 * ordinals are computed separately by the canonical semantic counter engine.
 */
export interface SemanticRoleAssignment {
  stableIdentity: string
  physicalLevel: HeadingLevel
  semanticRole: SemanticHeadingRole
  /**
   * 1 = chapter, 2 = section, 3 = subsection, >=4 = item.
   * In strict mode effectiveDepth is fixed (H1=0, H2=1, H3=2, ...).
   * In loose mode effectiveDepth is path-local (branch-local compression).
   */
  effectiveDepth: number
}

/**
 * Canonical semantic heading number state, produced by
 * `computeSemanticHeadingNumbers` inside the heading-numbering authority.
 *
 * `semanticPath` is the main authority: `[chapter]`, `[chapter, section]`,
 * `[chapter, section, subsection]`, ... The Caption layer will only need
 * `semanticPath[0]` (chapter) and `semanticPath[1]` (section).
 */
export interface SemanticHeadingNumberState {
  stableIdentity: string
  physicalLevel: HeadingLevel
  effectiveDepth: number
  semanticRole: SemanticHeadingRole
  semanticPath: readonly number[]
  logicalOrdinal: number | null
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  sourceRevision: number
  /** Whether this heading consumed a semantic sequence position. */
  counted: boolean
  /** Why the heading was counted / skipped (diagnostic only). */
  countingReason: string
}

/** Object numbering scope requested by configuration. */
export type CaptionScope = 'global' | 'chapter' | 'section'

export type NumberingStyle = 'dot' | 'dash'

export type CaptionObjectKind = 'figure' | 'table' | 'formula' | 'code'
