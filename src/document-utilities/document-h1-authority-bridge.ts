/**
 * Phase 7R.3.11.8B.1 — CanonicalHeadingFrame → Diagnostics H1 authority bridge.
 *
 * ONE normalization boundary that maps the PRODUCTION CanonicalHeadingFrame
 * into diagnostics facts WITHOUT inventing a fake flat shape. The real level
 * lives at `entry.semanticState.physicalLevel` (NOT `entry.physicalLevel`).
 *
 * FAIL-CLOSED semantics (never treat an unknown level as "not an H1"):
 *   frame = null                     → WAIT   FRAME_NOT_READY
 *   frame.documentKey != active      → WAIT   DOCUMENT_MISMATCH
 *   any entry level missing/out-of-range → INVALID (STRICT-SINGLE-H1 must WAIT,
 *                                        popup=0 — never fall back to h1Count=0)
 *   frame ready + all levels valid   → READY  (empty frame ⇒ h1Facts=[] is a
 *                                        REAL zero-H1 document)
 */
import type { CanonicalHeadingFrame } from '../heading-numbering/canonical-heading-frame'

export type DiagnosticCanonicalHeadingAuthorityState = 'WAIT' | 'INVALID' | 'READY'

export type DiagnosticCanonicalHeadingAuthorityReason =
  | 'FRAME_NOT_READY'
  | 'DOCUMENT_MISMATCH'
  | 'PHYSICAL_LEVEL_MISSING'
  | 'PHYSICAL_LEVEL_OUT_OF_RANGE'
  | 'ENTRY_SHAPE_INVALID'
  | 'READY'

/** Normalized canonical heading fact (production-backed, never invented). */
export interface DiagnosticCanonicalHeadingFact {
  stableIdentity: string
  element: HTMLElement | null
  physicalLevel: number
}

export interface DiagnosticCanonicalHeadingAuthorityResult {
  state: DiagnosticCanonicalHeadingAuthorityState
  reason: DiagnosticCanonicalHeadingAuthorityReason
  documentKey: string | null
  framePresent: boolean
  frameDocumentKey: string | null
  semanticRevision: number
  frameGeneration: number
  canonicalEntryCount: number
  mappedEntryCount: number
  invalidEntryCount: number
  physicalLevels: number[]
  h1Facts: readonly DiagnosticCanonicalHeadingFact[]
  h1Count: number
  h1StableIdentities: string[]
}

/** True when the production physical level is a valid heading level (1..6). */
function isValidPhysicalLevel(level: unknown): level is number {
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6
}

export function mapCanonicalHeadingFrameForDiagnostics(
  frame: CanonicalHeadingFrame | null,
  activeDocumentKey: string | null,
): DiagnosticCanonicalHeadingAuthorityResult {
  const base = {
    state: 'WAIT' as const,
    reason: 'FRAME_NOT_READY' as const,
    documentKey: activeDocumentKey,
    framePresent: frame !== null,
    frameDocumentKey: frame?.documentKey ?? null,
    semanticRevision: frame?.semanticRevision ?? 0,
    frameGeneration: frame?.frameGeneration ?? 0,
    canonicalEntryCount: frame?.entries.length ?? 0,
    mappedEntryCount: 0,
    invalidEntryCount: 0,
    physicalLevels: [],
    h1Facts: [],
    h1Count: 0,
    h1StableIdentities: [],
  } satisfies DiagnosticCanonicalHeadingAuthorityResult

  if (!frame) {
    return { ...base, state: 'WAIT', reason: 'FRAME_NOT_READY' }
  }
  if (!activeDocumentKey || (frame.documentKey && frame.documentKey !== activeDocumentKey)) {
    return { ...base, state: 'WAIT', reason: 'DOCUMENT_MISMATCH' }
  }

  const headings: DiagnosticCanonicalHeadingFact[] = []
  const h1Facts: DiagnosticCanonicalHeadingFact[] = []
  const physicalLevels: number[] = []
  let invalidEntryCount = 0
  let invalidReason: DiagnosticCanonicalHeadingAuthorityReason | null = null

  for (const entry of frame.entries) {
    const level = entry.semanticState?.physicalLevel
    if (!isValidPhysicalLevel(level)) {
      invalidEntryCount++
      if (!invalidReason) {
        invalidReason = level === undefined || level === null
          ? 'PHYSICAL_LEVEL_MISSING'
          : 'PHYSICAL_LEVEL_OUT_OF_RANGE'
      }
      continue
    }
    const fact: DiagnosticCanonicalHeadingFact = {
      stableIdentity: entry.stableIdentity,
      element: entry.element ?? null,
      physicalLevel: level,
    }
    headings.push(fact)
    physicalLevels.push(level)
    if (level === 1) h1Facts.push(fact)
  }

  if (invalidEntryCount > 0) {
    return {
      ...base,
      state: 'INVALID',
      reason: invalidReason ?? 'ENTRY_SHAPE_INVALID',
      mappedEntryCount: headings.length,
      invalidEntryCount,
      physicalLevels,
      h1Facts,
      h1Count: h1Facts.length,
      h1StableIdentities: h1Facts.map(f => f.stableIdentity),
    }
  }

  return {
    ...base,
    state: 'READY',
    reason: 'READY',
    mappedEntryCount: headings.length,
    invalidEntryCount: 0,
    physicalLevels,
    h1Facts,
    h1Count: h1Facts.length,
    h1StableIdentities: h1Facts.map(f => f.stableIdentity),
  }
}
