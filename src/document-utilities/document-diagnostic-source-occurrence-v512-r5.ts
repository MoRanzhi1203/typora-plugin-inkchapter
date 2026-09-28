/**
 * V5.12-R5 — Duplicate Occurrence / Source-Range Authority (pure contract).
 *
 * THE DEFECT (proved by runtime + code):
 *   two `![](same.png)` occurrences get a per-occurrence `occurrenceIndex` and
 *   distinct `sourceStart/sourceEnd`, but the SOURCE RANGE IDENTITY is dropped
 *   before the inline Range build, so the resolver falls back to the FIRST text
 *   match — the second diagnostic highlights the FIRST `same.png`.
 *
 *   ROOT_R5_1 = DUPLICATE_DESTINATION_RANGE_SELECTION_FALLS_BACK_TO_FIRST_TEXT_MATCH
 *   ROOT_R5_2 = SOURCE_START_END_OR_SOURCE_RANGE_IDENTITY_IS_DROPPED_BEFORE_INLINE_RANGE_BUILD
 *   ROOT_R5_3 = PRECISE_TEXT_PREFIX_IS_USED_AS_RANGE_IDENTITY_FOR_DUPLICATE_RESOURCE
 *   ROOT_R5_4 = RESOLVED_OCCURRENCE_INDEX_IS_NOT_DERIVED_FROM_THE_ACTUAL_RESOLVED_SOURCE_RANGE
 *   ROOT_R5_5 = VERIFY_INVARIANT_CAN_PASS_BY_REUSING_EXPECTED_METADATA_AS_RESOLVED_FACT
 *   ROOT_R5_6 = COMMIT_GATE_DOES_NOT_REQUIRE_DUPLICATE_OCCURRENCES_TO_HAVE_DISTINCT_SOURCE_RANGE_IDENTITIES
 *   ROOT_R5_7 = SOURCE_RANGE_IDENTITY_IS_NULL_FOR_RESOURCE_SOURCE_RANGE_DIAGNOSTICS
 *
 * The ONE new authority is the SOURCE OCCURRENCE IDENTITY — never a DOM node,
 * never a viewport rect, never a scroll offset. No DOM access, no host state.
 */

export const SOURCE_OCCURRENCE_AUTHORITY_AUDIT_EVENT =
  'DOCUMENT-DIAGNOSTIC-SOURCE-OCCURRENCE-AUTHORITY-AUDIT'

/** §8.3 — the explicit failure when a duplicate cannot be disambiguated. */
export const AMBIGUOUS_DUPLICATE_INLINE_RANGE_REASON = 'AMBIGUOUS_DUPLICATE_INLINE_RANGE'
/** §13 — two source occurrences collapsed onto one visual range. */
export const DUPLICATE_OCCURRENCES_COLLAPSED_TO_SAME_RANGE_REASON =
  'DUPLICATE_OCCURRENCES_COLLAPSED_TO_SAME_RANGE'

export type SourceResourceKind = 'image' | 'link'

/**
 * §4.2 — every source resource occurrence carries a stable, verifiable identity.
 * `startColumn/endColumn` are derived from the Markdown SOURCE (line start),
 * computed once and carried — never inferred from the DOM.
 */
export interface SourceOccurrenceDescriptor {
  documentKey: string | null
  sourceRevision: number | null

  resourceKind: SourceResourceKind
  rawDestination: string
  canonicalDestination: string

  occurrenceIndex: number

  sourceStart: number
  sourceEnd: number

  startLine: number
  endLine: number
  startColumn: number
  endColumn: number

  rawToken?: string
  rawLine?: string
  sourceFingerprint?: string
  /** Ordinal among source occurrences sharing the SAME normalized raw line. */
  rawLineOrdinal?: number
  /** Ordinal among same-line occurrences of the same canonical destination. */
  occurrenceWithinLine?: number
}

/** §6 — the occurrence GROUP authority: resourceKind + canonicalDestination. */
export function sourceOccurrenceGroupKey(kind: SourceResourceKind, canonicalDestination: string): string {
  return `${kind}\u0000${canonicalDestination}`
}

/** §4.2 — the stable identity (never DOM / viewport / scroll). */
export function buildSourceRangeIdentity(input: {
  documentKey?: string | null
  sourceRevision?: number | null
  resourceKind: SourceResourceKind
  canonicalDestination: string
  sourceStart: number
  sourceEnd: number
  occurrenceIndex: number
}): string {
  return [
    input.documentKey ?? '',
    input.sourceRevision == null ? 'r-' : `r${input.sourceRevision}`,
    input.resourceKind,
    input.canonicalDestination,
    `${input.sourceStart}`,
    `${input.sourceEnd}`,
    `o${input.occurrenceIndex}`,
  ].join('|')
}

/** §5 — columns are computed ONCE from the Markdown source (never from the DOM). */
export function computeSourceColumns(markdown: string, sourceStart: number, sourceEnd: number): {
  startColumn: number
  endColumn: number
} {
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, sourceStart - 1)) + 1
  const endLineStart = markdown.lastIndexOf('\n', Math.max(0, sourceEnd - 1)) + 1
  return {
    startColumn: Math.max(0, sourceStart - lineStart),
    endColumn: Math.max(0, sourceEnd - endLineStart),
  }
}

/** Every offset of `token` inside `text` (document order) — the ONE token matcher. */
export function findTokenOffsets(text: string, token: string): number[] {
  if (!token) return []
  const out: number[] = []
  let from = 0
  for (;;) {
    const idx = text.indexOf(token, from)
    if (idx < 0) break
    out.push(idx)
    from = idx + token.length
  }
  return out
}

/**
 * §8.2 — select the `occurrenceWithinAnchor`-th token match. NEVER a silent
 * first-match fallback: an out-of-range ordinal returns null.
 */
export function selectOccurrenceOffset(
  text: string,
  token: string,
  occurrenceWithinAnchor: number,
): { offset: number; matchCount: number } | null {
  const offsets = findTokenOffsets(text, token)
  if (offsets.length === 0) return null
  if (occurrenceWithinAnchor < 0 || occurrenceWithinAnchor >= offsets.length) return null
  return { offset: offsets[occurrenceWithinAnchor], matchCount: offsets.length }
}

/** §12 — the R5 hard-gate counters. */
export const SOURCE_OCCURRENCE_V512R5_GATE_KEYS = [
  'sourceRangeIdentityNullOnDuplicate',
  'occurrenceExpectedResolvedMismatch',
  'occurrenceResolvedIndexNull',
  'sourceRangeExpectedResolvedIdentityMismatch',
  'sourceRangeExpectedResolvedOffsetMismatch',
  'duplicateDestinationSameSourceRangeIdentity',
  'duplicateDestinationSameSourceRange',
  'ambiguousDuplicateInlineRangeCommit',
  'duplicateOccurrenceFirstMatchFallback',
  'resourceVerifyExpectedFactReusedAsResolved',
  'resourceFinalCommitWithOccurrenceGateFail',
] as const

export type SourceOccurrenceV512R5GateKey = typeof SOURCE_OCCURRENCE_V512R5_GATE_KEYS[number]

export const SOURCE_OCCURRENCE_V512R5_GATE_LABELS: Record<SourceOccurrenceV512R5GateKey, string> = {
  sourceRangeIdentityNullOnDuplicate: 'SOURCE_RANGE_IDENTITY_NULL_ON_DUPLICATE_COUNT',
  occurrenceExpectedResolvedMismatch: 'OCCURRENCE_EXPECTED_RESOLVED_MISMATCH_COUNT',
  occurrenceResolvedIndexNull: 'OCCURRENCE_RESOLVED_INDEX_NULL_COUNT',
  sourceRangeExpectedResolvedIdentityMismatch: 'SOURCE_RANGE_EXPECTED_RESOLVED_IDENTITY_MISMATCH_COUNT',
  sourceRangeExpectedResolvedOffsetMismatch: 'SOURCE_RANGE_EXPECTED_RESOLVED_OFFSET_MISMATCH_COUNT',
  duplicateDestinationSameSourceRangeIdentity: 'DUPLICATE_DESTINATION_SAME_SOURCE_RANGE_IDENTITY_COUNT',
  duplicateDestinationSameSourceRange: 'DUPLICATE_DESTINATION_SAME_SOURCE_RANGE_COUNT',
  ambiguousDuplicateInlineRangeCommit: 'AMBIGUOUS_DUPLICATE_INLINE_RANGE_COMMIT_COUNT',
  duplicateOccurrenceFirstMatchFallback: 'DUPLICATE_OCCURRENCE_FIRST_MATCH_FALLBACK_COUNT',
  resourceVerifyExpectedFactReusedAsResolved: 'RESOURCE_VERIFY_EXPECTED_FACT_REUSED_AS_RESOLVED_COUNT',
  resourceFinalCommitWithOccurrenceGateFail: 'RESOURCE_FINAL_COMMIT_WITH_OCCURRENCE_GATE_FAIL_COUNT',
}

export function createSourceOccurrenceV512R5Counters(): Record<SourceOccurrenceV512R5GateKey, number> {
  const out = {} as Record<SourceOccurrenceV512R5GateKey, number>
  for (const key of SOURCE_OCCURRENCE_V512R5_GATE_KEYS) out[key] = 0
  return out
}

export function formatSourceOccurrenceV512R5GateReport(
  counters: Readonly<Record<SourceOccurrenceV512R5GateKey, number>>,
): string[] {
  return SOURCE_OCCURRENCE_V512R5_GATE_KEYS.map(
    key => `${SOURCE_OCCURRENCE_V512R5_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateSourceOccurrenceV512R5Gates(
  counters: Readonly<Record<SourceOccurrenceV512R5GateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = SOURCE_OCCURRENCE_V512R5_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failing: failing.map(k => SOURCE_OCCURRENCE_V512R5_GATE_LABELS[k]),
  }
}

export interface SourceOccurrenceAuthorityInput {
  /** 1 = single occurrence (the duplicate-only requirements never apply). */
  duplicateGroupSize: number
  resourceKind: SourceResourceKind
  expectedOccurrenceIndex: number | null
  resolvedOccurrenceIndex: number | null
  expectedSourceRangeIdentity: string | null
  resolvedSourceRangeIdentity: string | null
  expectedSourceStart: number | null
  expectedSourceEnd: number | null
  resolvedSourceStart: number | null
  resolvedSourceEnd: number | null
  /** §8.3 — the token matched more than once without a verifiable nth fact. */
  ambiguousFirstMatchFallback: boolean
  /** §13 — the sibling occurrence of the SAME group resolved to the same range. */
  sameRangeAsSiblingOccurrence: boolean
  /** §13 — the sibling carries the SAME source range identity (source-side). */
  sameIdentityAsSiblingOccurrence: boolean
}

export interface SourceOccurrenceAuthorityDecision {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
  /** §12 — only these may enter the R4 coordinate gate. */
  mayProceedToCoordinateGate: boolean
}

/**
 * §12 — the SOURCE OCCURRENCE gate. It runs BEFORE the R4 coordinate gate: a
 * perfect document-space rect on the WRONG token is still a failure.
 */
export function evaluateSourceOccurrenceAuthority(
  input: SourceOccurrenceAuthorityInput,
): SourceOccurrenceAuthorityDecision {
  const failed: string[] = []
  if (input.ambiguousFirstMatchFallback) failed.push('DUPLICATE_OCCURRENCE_FIRST_MATCH_FALLBACK')
  if (input.duplicateGroupSize > 1) {
    // §12 — the duplicate-only requirements.
    if (input.expectedOccurrenceIndex == null || input.resolvedOccurrenceIndex == null) {
      failed.push('OCCURRENCE_RESOLVED_INDEX_NULL')
    } else if (input.expectedOccurrenceIndex !== input.resolvedOccurrenceIndex) {
      failed.push('OCCURRENCE_EXPECTED_RESOLVED_MISMATCH')
    }
    if (input.expectedSourceRangeIdentity == null || input.resolvedSourceRangeIdentity == null) {
      failed.push('SOURCE_RANGE_IDENTITY_NULL_ON_DUPLICATE')
    } else if (input.expectedSourceRangeIdentity !== input.resolvedSourceRangeIdentity) {
      failed.push('SOURCE_RANGE_EXPECTED_RESOLVED_IDENTITY_MISMATCH')
    }
    if (
      input.expectedSourceStart == null || input.expectedSourceEnd == null
      || input.resolvedSourceStart == null || input.resolvedSourceEnd == null
      || input.expectedSourceStart !== input.resolvedSourceStart
      || input.expectedSourceEnd !== input.resolvedSourceEnd
    ) {
      failed.push('SOURCE_RANGE_EXPECTED_RESOLVED_OFFSET_MISMATCH')
    }
    if (input.sameIdentityAsSiblingOccurrence) failed.push('DUPLICATE_DESTINATION_SAME_SOURCE_RANGE_IDENTITY')
    if (input.sameRangeAsSiblingOccurrence) failed.push('DUPLICATE_DESTINATION_SAME_SOURCE_RANGE')
  }
  if (failed.length === 0) {
    return {
      decision: 'PASS',
      reason: 'SOURCE_OCCURRENCE_IDENTITY_OK',
      failedChecks: [],
      mayProceedToCoordinateGate: true,
    }
  }
  return {
    decision: 'FAIL',
    reason: failed.join(','),
    failedChecks: failed,
    mayProceedToCoordinateGate: false,
  }
}

/** §12 — map one failed check to its counter key. */
export function sourceOccurrenceGateKeyForCheck(check: string): SourceOccurrenceV512R5GateKey | null {
  switch (check) {
    case 'OCCURRENCE_RESOLVED_INDEX_NULL':
      return 'occurrenceResolvedIndexNull'
    case 'OCCURRENCE_EXPECTED_RESOLVED_MISMATCH':
      return 'occurrenceExpectedResolvedMismatch'
    case 'SOURCE_RANGE_IDENTITY_NULL_ON_DUPLICATE':
      return 'sourceRangeIdentityNullOnDuplicate'
    case 'SOURCE_RANGE_EXPECTED_RESOLVED_IDENTITY_MISMATCH':
      return 'sourceRangeExpectedResolvedIdentityMismatch'
    case 'SOURCE_RANGE_EXPECTED_RESOLVED_OFFSET_MISMATCH':
      return 'sourceRangeExpectedResolvedOffsetMismatch'
    case 'DUPLICATE_DESTINATION_SAME_SOURCE_RANGE_IDENTITY':
      return 'duplicateDestinationSameSourceRangeIdentity'
    case 'DUPLICATE_DESTINATION_SAME_SOURCE_RANGE':
      return 'duplicateDestinationSameSourceRange'
    case 'DUPLICATE_OCCURRENCE_FIRST_MATCH_FALLBACK':
      return 'duplicateOccurrenceFirstMatchFallback'
    default:
      return null
  }
}
