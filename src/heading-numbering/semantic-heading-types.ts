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
 * A semantic heading carries BOTH:
 *   - structural ancestry (parent / chapter / section identity), which exists
 *     regardless of whether the heading consumes a number;
 *   - counted ordinal state (semanticPath / chapterOrdinal / sectionOrdinal),
 *     which is null when the heading is unnumbered + skip.
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
 * Role interpretation of a physical heading. Carries NO counted ordinal value;
 * ordinals are computed separately by the canonical semantic counter engine.
 *
 * Structural identities are computed here (from the ancestor stack) and are
 * INDEPENDENT of counting — an unnumbered/skip heading still has a parent /
 * chapter / section.
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
  structuralParentIdentity: string | null
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
}

/**
 * Canonical semantic heading number state, produced by
 * `computeSemanticHeadingNumbers` inside the heading-numbering authority.
 *
 * `ordinalByDepth` is the CANONICAL position-preserving counted path:
 *   index 0 = Chapter, index 1 = Section, index 2 = Subsection, ...
 * A skipped level keeps its `null` slot (never filtered away).
 * `chapterOrdinal` / `sectionOrdinal` are convenience projections of these
 * canonical slots, not an independent authority.
 *
 * `displayCountedPath` is a dense (null-filtered) path kept ONLY for debug /
 * display; no canonical consumer may treat its indices as Chapter/Section.
 */
export interface SemanticHeadingNumberState {
  stableIdentity: string
  physicalLevel: HeadingLevel
  effectiveDepth: number
  semanticRole: SemanticHeadingRole
  structuralParentIdentity: string | null
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
  ordinalByDepth: readonly (number | null)[]
  displayCountedPath: readonly number[]
  logicalOrdinal: number | null
  chapterOrdinal: number | null
  sectionOrdinal: number | null
  /** Whether this heading consumed a semantic sequence position. */
  counted: boolean
  /** Why the heading was counted / skipped (diagnostic only). */
  countingReason: string
  sourceRevision: number
}

/** Object numbering scope requested by configuration. */
export type CaptionScope = 'global' | 'chapter' | 'section'

export type NumberingStyle = 'dot' | 'dash'

export type CaptionObjectKind = 'figure' | 'table' | 'formula' | 'code'
