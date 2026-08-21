/**
 * Heading Semantic Resolver — authoritative strict/loose mapping from physical
 * heading levels to semantic ROLES + effective depth.
 *
 * IMPORTANT: this module only interprets roles. It does NOT compute chapter /
 * section ordinals — those come from the canonical semantic counter engine in
 * `semantic-heading-numbering.ts`.
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
  physicalLevel: HeadingLevel
  effectiveDepth: number
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
  if (mode === 'strict') {
    return headings.map(h => {
      const effectiveDepth = h.level - 1
      return {
        stableIdentity: h.key,
        physicalLevel: h.level,
        semanticRole: roleFromEffectiveDepth(effectiveDepth),
        effectiveDepth,
      }
    })
  }

  // Loose: path-local effective depth from ancestor stack.
  const stack: StackEntry[] = []
  return headings.map(h => {
    while (stack.length > 0 && stack[stack.length - 1].physicalLevel >= h.level) {
      stack.pop()
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null
    const effectiveDepth = parent ? parent.effectiveDepth + 1 : 1
    stack.push({ physicalLevel: h.level, effectiveDepth })
    return {
      stableIdentity: h.key,
      physicalLevel: h.level,
      semanticRole: roleFromEffectiveDepth(effectiveDepth),
      effectiveDepth,
    }
  })
}
