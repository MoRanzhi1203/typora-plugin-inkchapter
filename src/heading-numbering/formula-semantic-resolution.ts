/**
 * Formula Semantic Resolution (Phase 7R.3.6-G)
 *
 * Explicit per-host resolution contract for a canonical Formula host:
 *
 *   BOUND                       → heading bound, section (and chapter) resolved
 *   LEGITIMATE_CHAPTER_FALLBACK → heading bound, chapter resolved, no section
 *                                 in the strict structure (H2 without H3, or
 *                                 H4 under H2 with missing H3)
 *   LEGITIMATE_GLOBAL_FALLBACK  → heading exists but is uncounted (document
 *                                 title), or the Formula is genuinely before
 *                                 the first counted chapter
 *   TRANSIENT_UNRESOLVED        → the heading/binding context was transiently
 *                                 incoherent — MUST be deferred, NEVER treated
 *                                 as a GLOBAL fallback (Phase 7R.3.6 §22)
 *
 * Pure functions only — no DOM, no audit. Testable in jsdom-free unit tests.
 */

import type { SemanticHeadingNumberState } from './semantic-heading-types'

export type FormulaTransientUnresolvedReason =
  | 'EDITOR_STRUCTURE_EPOCH_CHANGED'
  | 'ROOT_GENERATION_CHANGED'
  | 'TARGET_DISCONNECTED'
  | 'HEADING_BINDING_GENERATION_MISMATCH'
  | 'SNAPSHOT_BINDING_REVISION_MISMATCH'
  | 'CANONICAL_HOST_SET_TRANSIENT'
  | 'OTHER_TRANSIENT_INCOHERENCE'

export type FormulaSemanticResolution =
  | {
      decision: 'BOUND'
      headingStableIdentity: string
      chapterOrdinal: number | null
      sectionOrdinal: number | null
    }
  | {
      decision: 'LEGITIMATE_CHAPTER_FALLBACK'
      headingStableIdentity: string
      chapterOrdinal: number
      sectionOrdinal: null
    }
  | {
      decision: 'LEGITIMATE_GLOBAL_FALLBACK'
      headingStableIdentity: string | null
      chapterOrdinal: null
      sectionOrdinal: null
    }
  | {
      decision: 'TRANSIENT_UNRESOLVED'
      reason: FormulaTransientUnresolvedReason
    }

/** Batch-resolver "unbound" reasons that indicate a genuinely-before-first-heading Formula. */
export const LEGITIMATE_GLOBAL_UNBOUND_REASONS = new Set<string>(['NO_PRECEDING_HEADING', 'TARGET_BEFORE_FIRST_HEADING'])

/**
 * Map a batch-resolver unbound reason onto a transient-unresolved reason.
 * Any unbound state that is NOT the genuine "before first heading" case is
 * transient incoherence and must never be projected as GLOBAL.
 */
export function mapUnboundReasonToTransient(reason: string): FormulaTransientUnresolvedReason {
  switch (reason) {
    case 'TARGET_DISCONNECTED': return 'TARGET_DISCONNECTED'
    case 'ROOT_MISMATCH':
    case 'NO_EDITOR_ROOT': return 'ROOT_GENERATION_CHANGED'
    case 'HEADING_DISCONNECTED':
    case 'COMPARE_DISCONNECTED':
    case 'HEADING_BINDING_GENERATION_MISMATCH': return 'HEADING_BINDING_GENERATION_MISMATCH'
    case 'SNAPSHOT_BINDING_REVISION_MISMATCH': return 'SNAPSHOT_BINDING_REVISION_MISMATCH'
    case 'CANDIDATE_IDENTITY_MISSING':
    case 'NO_BINDINGS':
    case 'DOCUMENT_KEY_MISMATCH':
    case 'NO_SNAPSHOT':
    case 'NO_ACTIVE_DOCUMENT':
    case 'CANONICAL_HOST_SET_TRANSIENT': return 'CANONICAL_HOST_SET_TRANSIENT'
    default: return 'OTHER_TRANSIENT_INCOHERENCE'
  }
}

/**
 * Classify a Formula semantic resolution from a batch-resolver outcome:
 *   - bound=true → derive BOUND / LEGITIMATE_CHAPTER_FALLBACK /
 *     LEGITIMATE_GLOBAL_FALLBACK from the canonical semantic state ordinals.
 *   - bound=false → LEGITIMATE_GLOBAL_FALLBACK ONLY when the unbound reason is
 *     the genuine "before first heading"; everything else is TRANSIENT_UNRESOLVED.
 */
export function classifyFormulaSemanticResolution(
  bound: boolean,
  unboundReason: string | null,
  headingStableIdentity: string | null,
  semanticState: SemanticHeadingNumberState | null,
): FormulaSemanticResolution {
  if (!bound) {
    if (headingStableIdentity === null && semanticState === null && LEGITIMATE_GLOBAL_UNBOUND_REASONS.has(unboundReason ?? '')) {
      return { decision: 'LEGITIMATE_GLOBAL_FALLBACK', headingStableIdentity: null, chapterOrdinal: null, sectionOrdinal: null }
    }
    return { decision: 'TRANSIENT_UNRESOLVED', reason: mapUnboundReasonToTransient(unboundReason ?? 'OTHER_TRANSIENT_INCOHERENCE') }
  }
  if (!semanticState) {
    return { decision: 'TRANSIENT_UNRESOLVED', reason: 'SNAPSHOT_BINDING_REVISION_MISMATCH' }
  }
  const identity = headingStableIdentity ?? semanticState.stableIdentity
  if (semanticState.sectionOrdinal != null) {
    return { decision: 'BOUND', headingStableIdentity: identity, chapterOrdinal: semanticState.chapterOrdinal, sectionOrdinal: semanticState.sectionOrdinal }
  }
  if (semanticState.chapterOrdinal != null) {
    return { decision: 'LEGITIMATE_CHAPTER_FALLBACK', headingStableIdentity: identity, chapterOrdinal: semanticState.chapterOrdinal, sectionOrdinal: null }
  }
  // Heading bound but uncounted (e.g. document-title H1) → legitimately global.
  return { decision: 'LEGITIMATE_GLOBAL_FALLBACK', headingStableIdentity: identity, chapterOrdinal: null, sectionOrdinal: null }
}

/** Planner context consumed by planFormulaSemanticNumbers for a LEGITIMATE resolution. */
export function resolutionToFormulaContext(res: FormulaSemanticResolution): { chapterOrdinal: number | null; sectionOrdinal: number | null } | null {
  if (res.decision === 'TRANSIENT_UNRESOLVED') return null
  return { chapterOrdinal: res.chapterOrdinal, sectionOrdinal: res.sectionOrdinal }
}

/** Whether a resolution is usable for Formula planning (not transient). */
export function isResolvedFormulaSemantic(res: FormulaSemanticResolution): boolean {
  return res.decision !== 'TRANSIENT_UNRESOLVED'
}
