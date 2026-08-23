/**
 * Object Semantic Scope Identity (Phase 7R.3.7)
 *
 * ONE shared scope identity consumed by all four object kinds
 * (Figure / Table / Formula / Code). It pairs the visible ordinals
 * (chapterOrdinal / sectionOrdinal) with the STRUCTURAL identities that
 * actually define counter grouping:
 *
 *   - strictBoundaryIdentity        (canonical H1 boundary)
 *   - structuralChapterIdentity     (canonical H2 chapter)
 *   - structuralSectionIdentity     (canonical H3 section)
 *
 * Visible numbering uses ordinals. Counter grouping uses structural
 * identities. Two H1 boundaries that both expose chapterOrdinal=1 /
 * sectionOrdinal=1 must therefore produce DIFFERENT scope keys.
 *
 * STRICT scopeKey:
 *   GLOBAL  = objectKind + strictBoundaryIdentity + GLOBAL
 *   CHAPTER = objectKind + strictBoundaryIdentity + structuralChapterIdentity
 *   SECTION = objectKind + strictBoundaryIdentity
 *             + structuralChapterIdentity + structuralSectionIdentity
 *
 * Loose mode keeps the previous ordinal-based grouping (strictBoundaryIdentity
 * is null and no boundary exists).
 *
 * Pure functions only — no DOM, no audit, no runtime state.
 */

import type { CaptionScope } from './semantic-heading-types'

export type ObjectStructureMode = 'strict' | 'loose'

export interface ObjectSemanticScopeIdentity {
  mode: ObjectStructureMode
  /** Canonical strict H1 boundary identity (null in loose / before first H1). */
  boundaryIdentity: string | null
  effectiveScope: CaptionScope
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
  chapterOrdinal: number | null
  sectionOrdinal: number | null
}

export interface ObjectScopeIdentityInput {
  mode: ObjectStructureMode
  strictBoundaryIdentity: string | null
  effectiveScope: CaptionScope
  structuralChapterIdentity: string | null
  structuralSectionIdentity: string | null
  chapterOrdinal: number | null
  sectionOrdinal: number | null
}

/** Build the canonical shared scope identity (validates nothing; pure). */
export function buildObjectSemanticScopeIdentity(input: ObjectScopeIdentityInput): ObjectSemanticScopeIdentity {
  return {
    mode: input.mode,
    boundaryIdentity: input.strictBoundaryIdentity,
    effectiveScope: input.effectiveScope,
    structuralChapterIdentity: input.structuralChapterIdentity,
    structuralSectionIdentity: input.structuralSectionIdentity,
    chapterOrdinal: input.chapterOrdinal,
    sectionOrdinal: input.sectionOrdinal,
  }
}

/**
 * Canonical scope KEY for counter grouping.
 *
 * STRICT mode groups by boundary + structural identities — NEVER by visible
 * ordinal alone. `boundaryIdentity=null` (before the first H1) is still a
 * distinct group from any boundary-local group.
 *
 * LOOSE mode keeps the previous ordinal-based key so existing loose behavior
 * (document-wide chapter/section sequences without boundaries) is unchanged.
 */
export function objectScopeKey(kind: string, identity: ObjectSemanticScopeIdentity): string {
  if (identity.mode === 'strict') {
    const b = identity.boundaryIdentity ?? 'no-boundary'
    switch (identity.effectiveScope) {
      case 'global': return `${kind}:${b}:GLOBAL`
      case 'chapter': return `${kind}:${b}:${identity.structuralChapterIdentity ?? 'no-chapter'}`
      case 'section':
        return `${kind}:${b}:${identity.structuralChapterIdentity ?? 'no-chapter'}.${identity.structuralSectionIdentity ?? 'no-section'}`
    }
  }
  switch (identity.effectiveScope) {
    case 'global': return `${kind}:global`
    case 'chapter': return `${kind}:chapter:${identity.chapterOrdinal ?? 0}`
    case 'section': return `${kind}:section:${identity.chapterOrdinal ?? 0}.${identity.sectionOrdinal ?? 0}`
  }
}
