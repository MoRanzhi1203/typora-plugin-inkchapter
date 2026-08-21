/**
 * Caption Scope Resolver (Phase 2) — maps a requested scope plus the resolved
 * chapter/section ordinals into an effective scope, with the allowed degrade
 * chain:
 *
 *   SECTION -> CHAPTER -> GLOBAL
 *   CHAPTER -> GLOBAL
 *
 * Degradation only changes the effective scope; it never changes the numbering
 * style. It is allowed in BOTH strict and loose mode — the strict/loose
 * difference is how heading structure is interpreted, not whether degradation
 * is permitted.
 */

import type { CaptionScope } from './semantic-heading-types'

export interface ResolvedCaptionScope {
  requestedScope: CaptionScope
  effectiveScope: CaptionScope
  chapter: number | null
  section: number | null
  degraded: boolean
  resolutionReason: string
}

export function resolveCaptionScope(
  requestedScope: CaptionScope,
  chapter: number | null,
  section: number | null,
): ResolvedCaptionScope {
  if (requestedScope === 'global') {
    return {
      requestedScope,
      effectiveScope: 'global',
      chapter: null,
      section: null,
      degraded: false,
      resolutionReason: 'GLOBAL_REQUESTED',
    }
  }

  if (requestedScope === 'chapter') {
    if (chapter != null) {
      return {
        requestedScope,
        effectiveScope: 'chapter',
        chapter,
        section: null,
        degraded: false,
        resolutionReason: 'CHAPTER_RESOLVED',
      }
    }
    return {
      requestedScope,
      effectiveScope: 'global',
      chapter: null,
      section: null,
      degraded: true,
      resolutionReason: 'CHAPTER_TO_GLOBAL',
    }
  }

  // requestedScope === 'section'
  if (chapter != null && section != null) {
    return {
      requestedScope,
      effectiveScope: 'section',
      chapter,
      section,
      degraded: false,
      resolutionReason: 'SECTION_RESOLVED',
    }
  }
  if (chapter != null) {
    return {
      requestedScope,
      effectiveScope: 'chapter',
      chapter,
      section: null,
      degraded: true,
      resolutionReason: 'SECTION_TO_CHAPTER',
    }
  }
  return {
    requestedScope,
    effectiveScope: 'global',
    chapter: null,
    section: null,
    degraded: true,
    resolutionReason: 'SECTION_TO_GLOBAL',
  }
}
