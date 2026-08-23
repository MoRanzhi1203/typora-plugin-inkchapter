/**
 * Heading Semantic Resolver — authoritative strict/loose mapping from physical
 * heading levels to semantic ROLES + effective depth + structural ancestry.
 *
 * IMPORTANT: this module only interprets roles and structural ancestry. It does
 * NOT compute chapter / section ordinals — those come from the canonical
 * semantic counter engine in `semantic-heading-numbering.ts`.
 *
 * Strict mode (fixed physical mapping, no compression):
 *   H1 = document-title (effectiveDepth 0)
 *   H2 = chapter (effectiveDepth 1)
 *   H3 = section (effectiveDepth 2)
 *   H4 = subsection (effectiveDepth 3)
 *   H5/H6 = item (effectiveDepth 4/5)
 *
 * Loose mode (path-local / branch-local effective depth with compression):
 *   effective depth is derived from the current heading ancestry stack, NOT
 *   from the set of distinct levels present in the whole document.
 *
 * Structural ancestry (parent / chapter / section identity) is computed from
 * the semantic ancestor stack and is independent of counting.
 */

import type {
  HeadingLevel,
  HeadingStructureMode,
  PhysicalHeading,
  SemanticHeadingRole,
  SemanticRoleAssignment,
} from './semantic-heading-types'

/** Map an effective depth to a semantic role (shared by strict and loose). */
export function roleFromEffectiveDepth(depth: number): SemanticHeadingRole {
  if (depth <= 0) return 'document-title'
  if (depth === 1) return 'chapter'
  if (depth === 2) return 'section'
  if (depth === 3) return 'subsection'
  return 'item'
}

interface StackEntry {
  identity: string
  physicalLevel: HeadingLevel
  effectiveDepth: number
  semanticRole: SemanticHeadingRole
}

/**
 * Resolve semantic roles for physical headings in document order.
 *
 * - strict: effectiveDepth = physicalLevel - 1 (fixed, no compression).
 * - loose: path-local effective depth via ancestor stack.
 */
export function resolveSemanticRoles(
  headings: readonly PhysicalHeading[],
  mode: HeadingStructureMode,
): SemanticRoleAssignment[] {
  // Semantic ancestor stack (document-title is excluded from structural ancestry).
  const stack: StackEntry[] = []
  // Phase 7R.3.7: canonical strict H1 numbering boundary (nearest preceding H1).
  let currentBoundaryIdentity: string | null = null
  let currentBoundaryOrdinal = 0

  return headings.map(h => {
    const isTitle = mode === 'strict' && h.level === 1

    if (isTitle) {
      stack.length = 0
      currentBoundaryOrdinal++
      currentBoundaryIdentity = h.key
      return {
        stableIdentity: h.key,
        physicalLevel: h.level,
        semanticRole: 'document-title',
        effectiveDepth: 0,
        structuralParentIdentity: null,
        structuralChapterIdentity: null,
        structuralSectionIdentity: null,
        strictBoundaryIdentity: currentBoundaryIdentity,
        strictBoundaryOrdinal: currentBoundaryOrdinal,
      }
    }

    while (stack.length > 0 && stack[stack.length - 1].physicalLevel >= h.level) {
      stack.pop()
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null
    const effectiveDepth = mode === 'strict'
      ? h.level - 1
      : (parent ? parent.effectiveDepth + 1 : 1)
    const role = roleFromEffectiveDepth(effectiveDepth)

    const chapterAncestor = stack.find(e => e.semanticRole === 'chapter') ?? null
    const sectionAncestor = stack.find(e => e.semanticRole === 'section') ?? null

    stack.push({ identity: h.key, physicalLevel: h.level, effectiveDepth, semanticRole: role })

    return {
      stableIdentity: h.key,
      physicalLevel: h.level,
      semanticRole: role,
      effectiveDepth,
      structuralParentIdentity: parent?.identity ?? null,
      structuralChapterIdentity: chapterAncestor?.identity ?? null,
      structuralSectionIdentity: sectionAncestor?.identity ?? null,
      // Phase 7R.3.7: strict mode inherits the current H1 boundary; loose mode
      // never uses boundaries (strictBoundaryIdentity stays null).
      strictBoundaryIdentity: mode === 'strict' ? currentBoundaryIdentity : null,
      strictBoundaryOrdinal: mode === 'strict' ? currentBoundaryOrdinal : null,
    }
  })
}
