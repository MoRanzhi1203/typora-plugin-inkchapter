/**
 * V5.12-R4 — Inline Document-Space Coordinate Authority (pure contract).
 *
 * ROOT_R4_1 = EXACT_INLINE_FRAGMENT_NOT_COMMITTED_TO_DOCUMENT_SPACE
 * ROOT_R4_2 = INLINE_AND_BLOCK_VISUALS_USE_DIFFERENT_COORDINATE_NORMALIZATION
 * ROOT_R4_3 = PROGRAMMATIC_SCROLL_OFFSET_IS_DUPLICATED_OR_OMITTED
 *             IN INLINE VIEWPORT_TO_DOCUMENT_LOCAL CONVERSION
 * ROOT_R4_4 = PRE_SCROLL_INLINE_GEOMETRY_IS_NOT_EXPLICITLY_INVALIDATED
 *             WHEN LOCATOR WRITES SCROLL
 * ROOT_R4_5 = DOCUMENT_LOCAL_INLINE_RECTS_ARE_EMPTY
 *             WHILE INLINE VISUAL IS REPORTED COMMITTED
 * ROOT_R4_6 = GEOMETRY_GATE_CHECKS FRAGMENT COUNT / SIZE / COVERAGE
 *             BUT DOES NOT CHECK EXPECTED RANGE RECT VS ACTUAL PAINT RECT POSITION
 * ROOT_R4_7 = INLINE VISUAL MAY HAVE A PRIVATE / LEGACY VIEWPORT-SPACE RENDER PATH
 *             BYPASSING THE SHARED DOCUMENT-SPACE CARRIER
 *
 * The ONE coordinate authority is the document host rect:
 *
 *   local = viewport - documentHostRect        (never +/- scrollTop)
 *
 * No DOM access, no host state.
 */

export const INLINE_COORDINATE_AUTHORITY_AUDIT_EVENT =
  'DOCUMENT-DIAGNOSTIC-INLINE-COORDINATE-AUTHORITY-AUDIT'

/** §11 — position-drift acceptance band. */
export const INLINE_POSITION_DRIFT_PREFERRED_PX = 1
export const INLINE_POSITION_DRIFT_HARD_PX = 1.5

/** §13/§14 — the single normalizer identity (never a second, parallel one). */
export const INLINE_COORDINATE_NORMALIZER_ID = 'DOCUMENT_HOST_RECT'

export interface InlineRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** §6 — a derived rect is ALWAYS fully rebuilt (never `{...old, top}`). */
export function makeInlineRect(input: { left: number; top: number; right: number; bottom: number }): InlineRect {
  const left = Number(input.left)
  const top = Number(input.top)
  const right = Math.max(left, Number(input.right))
  const bottom = Math.max(top, Number(input.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * §12 — the INVERSE of the shared normalizer, used ONLY for audit: it proves the
 * committed document-local rect reprojects onto the expected viewport rect.
 * A repeated/omitted scrollTop compensation becomes directly visible here.
 */
export function projectDocumentLocalRectToViewport(input: {
  localRect: InlineRect | null
  documentHostRect: { left: number; top: number } | null
}): InlineRect | null {
  const { localRect, documentHostRect } = input
  if (!localRect || !documentHostRect) return null
  const left = localRect.left + Number(documentHostRect.left)
  const top = localRect.top + Number(documentHostRect.top)
  const right = localRect.right + Number(documentHostRect.left)
  const bottom = localRect.bottom + Number(documentHostRect.top)
  if (![left, top, right, bottom].every(Number.isFinite)) return null
  return makeInlineRect({ left, top, right, bottom })
}

export interface InlinePositionDrift {
  expectedFragmentCount: number
  actualFragmentCount: number
  comparedFragmentCount: number
  countMismatch: boolean
  maxDeltaLeft: number
  maxDeltaTop: number
  maxDeltaRight: number
  maxDeltaBottom: number
  maxPositionDrift: number
  ok: boolean
}

/**
 * §11 — per-fragment position consistency. Both inputs MUST already be in the
 * SAME coordinate space (never mix local and viewport).
 */
export function measureInlineFragmentPositionDrift(input: {
  expectedViewport: readonly InlineRect[]
  actualViewport: readonly InlineRect[]
  tolerancePx?: number
}): InlinePositionDrift {
  const tolerance = input.tolerancePx ?? INLINE_POSITION_DRIFT_HARD_PX
  const expected = input.expectedViewport
  const actual = input.actualViewport
  const compared = Math.min(expected.length, actual.length)
  let maxDeltaLeft = 0
  let maxDeltaTop = 0
  let maxDeltaRight = 0
  let maxDeltaBottom = 0
  for (let i = 0; i < compared; i++) {
    const e = expected[i]
    const a = actual[i]
    maxDeltaLeft = Math.max(maxDeltaLeft, Math.abs(a.left - e.left))
    maxDeltaTop = Math.max(maxDeltaTop, Math.abs(a.top - e.top))
    maxDeltaRight = Math.max(maxDeltaRight, Math.abs(a.right - e.right))
    maxDeltaBottom = Math.max(maxDeltaBottom, Math.abs(a.bottom - e.bottom))
  }
  const maxPositionDrift = Math.max(maxDeltaLeft, maxDeltaTop, maxDeltaRight, maxDeltaBottom)
  const countMismatch = expected.length !== actual.length
  return {
    expectedFragmentCount: expected.length,
    actualFragmentCount: actual.length,
    comparedFragmentCount: compared,
    countMismatch,
    maxDeltaLeft,
    maxDeltaTop,
    maxDeltaRight,
    maxDeltaBottom,
    maxPositionDrift,
    ok: compared > 0 && !countMismatch && maxPositionDrift <= tolerance,
  }
}

export interface InlineCoordinateAuthorityInput {
  /** Only an `inline` target with an EXACT source range is asserted here. */
  kindIsInline: boolean
  exactInlinePresent: boolean
  documentLocalFragmentCount: number
  meaningfulFragmentCount: number
  actualPaintedFragmentCount: number
  maxPositionDriftPx: number | null
  scrollWriteCount: number
  preScrollGeometryInvalidated: boolean
  postScrollGeometryFresh: boolean
  manualScrollOffsetApplied: boolean
  privateViewportRenderPath: boolean
  reprojectedDriftPx: number | null
}

export interface InlineCoordinateAuthorityDecision {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
}

/**
 * §9/§11/§14/§25 — the inline coordinate authority gate. Every failure here must
 * block the terminal COMMIT (coverage alone can never prove the position).
 */
export function evaluateInlineCoordinateAuthority(
  input: InlineCoordinateAuthorityInput,
): InlineCoordinateAuthorityDecision {
  if (!input.kindIsInline || !input.exactInlinePresent) {
    return { decision: 'PASS', reason: 'NOT_APPLICABLE', failedChecks: [] }
  }
  const failed: string[] = []
  if (input.documentLocalFragmentCount < 1) failed.push('INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS')
  if (input.documentLocalFragmentCount !== input.meaningfulFragmentCount) {
    failed.push('INLINE_VIEWPORT_LOCAL_FRAGMENT_COUNT_MISMATCH')
  }
  if (input.actualPaintedFragmentCount !== input.meaningfulFragmentCount) {
    failed.push('INLINE_LOCAL_PAINTED_FRAGMENT_COUNT_MISMATCH')
  }
  if (input.scrollWriteCount > 0 && !input.preScrollGeometryInvalidated) {
    failed.push('INLINE_STALE_PRE_SCROLL_GEOMETRY')
  }
  if (input.scrollWriteCount > 0 && !input.postScrollGeometryFresh) {
    failed.push('INLINE_POST_SCROLL_GEOMETRY_NOT_FRESH')
  }
  if (input.manualScrollOffsetApplied) failed.push('INLINE_MANUAL_SCROLL_OFFSET_APPLIED')
  if (input.privateViewportRenderPath) failed.push('INLINE_PRIVATE_VIEWPORT_RENDER_PATH')
  // §11 — a null drift means "not measurable" (headless); never a fake PASS.
  if (input.maxPositionDriftPx != null && !(input.maxPositionDriftPx <= INLINE_POSITION_DRIFT_HARD_PX)) {
    failed.push('INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX')
  }
  if (input.reprojectedDriftPx != null && !(input.reprojectedDriftPx <= INLINE_POSITION_DRIFT_HARD_PX)) {
    failed.push('INLINE_REPROJECTED_VIEWPORT_DRIFT_GT_1_5PX')
  }
  if (failed.length === 0) return { decision: 'PASS', reason: 'INLINE_DOCUMENT_SPACE_OK', failedChecks: [] }
  return { decision: 'FAIL', reason: failed.join(','), failedChecks: failed }
}

/** §24 — the V5.12-R4 inline hard-gate counters. */
export const INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS = [
  'inlineCommittedWithEmptyDocumentLocalRects',
  'inlineStalePreScrollGeometryCommit',
  'inlineExpectedActualPositionDriftGt1_5px',
  'inlineManualScrollOffsetApplied',
  'inlinePrivateViewportRenderPath',
  'inlineCoordinateNormalizerDivergence',
  'inlineViewportLocalFragmentCountMismatch',
  'inlineLocalPaintedFragmentCountMismatch',
  'inlineReprojectedViewportDriftGt1_5px',
] as const

export type InlineDocumentSpaceV512R4GateKey = typeof INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS[number]

export const INLINE_DOCUMENT_SPACE_V512R4_GATE_LABELS: Record<InlineDocumentSpaceV512R4GateKey, string> = {
  inlineCommittedWithEmptyDocumentLocalRects: 'INLINE_COMMITTED_WITH_EMPTY_DOCUMENT_LOCAL_RECTS_COUNT',
  inlineStalePreScrollGeometryCommit: 'INLINE_STALE_PRE_SCROLL_GEOMETRY_COMMIT_COUNT',
  inlineExpectedActualPositionDriftGt1_5px: 'INLINE_EXPECTED_ACTUAL_POSITION_DRIFT_GT_1_5PX_COUNT',
  inlineManualScrollOffsetApplied: 'INLINE_MANUAL_SCROLL_OFFSET_APPLIED_COUNT',
  inlinePrivateViewportRenderPath: 'INLINE_PRIVATE_VIEWPORT_RENDER_PATH_COUNT',
  inlineCoordinateNormalizerDivergence: 'INLINE_COORDINATE_NORMALIZER_DIVERGENCE_COUNT',
  inlineViewportLocalFragmentCountMismatch: 'INLINE_VIEWPORT_LOCAL_FRAGMENT_COUNT_MISMATCH',
  inlineLocalPaintedFragmentCountMismatch: 'INLINE_LOCAL_PAINTED_FRAGMENT_COUNT_MISMATCH',
  inlineReprojectedViewportDriftGt1_5px: 'INLINE_REPROJECTED_VIEWPORT_DRIFT_GT_1_5PX_COUNT',
}

export function createInlineDocumentSpaceV512R4Counters(): Record<InlineDocumentSpaceV512R4GateKey, number> {
  const out = {} as Record<InlineDocumentSpaceV512R4GateKey, number>
  for (const key of INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS) out[key] = 0
  return out
}

export function formatInlineDocumentSpaceGateReport(
  counters: Readonly<Record<InlineDocumentSpaceV512R4GateKey, number>>,
): string[] {
  return INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS.map(
    key => `${INLINE_DOCUMENT_SPACE_V512R4_GATE_LABELS[key]}=${counters[key] ?? 0}`,
  )
}

export function evaluateInlineDocumentSpaceGates(
  counters: Readonly<Record<InlineDocumentSpaceV512R4GateKey, number>>,
): { decision: 'PASS' | 'FAIL'; failing: string[] } {
  const failing = INLINE_DOCUMENT_SPACE_V512R4_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return {
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failing: failing.map(k => INLINE_DOCUMENT_SPACE_V512R4_GATE_LABELS[k]),
  }
}
