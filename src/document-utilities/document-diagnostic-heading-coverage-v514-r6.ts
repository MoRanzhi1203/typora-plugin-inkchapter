/**
 * V5.14-R6 — Heading Diagnostic SEMANTIC COVERAGE (one model for body + outline).
 *
 * ROOT_R6_1 = the left OUTLINE, the body PASSIVE marker and the body ACTIVE marker
 *   used three DIFFERENT coverage rules for the same numbered heading.
 * ROOT_R6_2 = the body PASSIVE text geometry came from `Range.getClientRects()`,
 *   which can NOT see the CSS-generated numbering decoration (`::before` fed by
 *   `data-inkchapter-heading-number`), so `2.1 第一节` was painted as `第一节`.
 * ROOT_R6_3 = the ACTIVE locate path rebuilt a DIFFERENT target rect than the
 *   passive visual (it prepended the number rect the passive pass never had).
 * ROOT_R6_4 = the outline projection had no shared semantic coverage mask.
 * ROOT_R6_5 = NUMBER and GAP were not first-class parts of the diagnostic target.
 *
 * The ONE model:
 *   numbered heading   -> NUMBER | GAP | TITLE
 *   unnumbered heading -> TITLE
 *   reason chip        -> NEVER part of the coverage
 *
 * Body PASSIVE and body ACTIVE consume the SAME `HeadingDiagnosticTargetSnapshot`;
 * the OUTLINE consumes the same `coverageMask` but reprojects it into its own DOM
 * coordinate space (rects are never copied across coordinate spaces).
 *
 * Pure contract: no DOM, no host state.
 */

/** §4 — the coverage parts. A bitmask keeps the intended union explicit. */
export const HeadingCoveragePart = {
  NONE: 0,
  NUMBER: 1 << 0,
  GAP: 1 << 1,
  TITLE: 1 << 2,
} as const

export type HeadingCoverageMask = number

export const HEADING_COVERAGE_NUMBERED: HeadingCoverageMask =
  HeadingCoveragePart.NUMBER | HeadingCoveragePart.GAP | HeadingCoveragePart.TITLE
export const HEADING_COVERAGE_UNNUMBERED: HeadingCoverageMask = HeadingCoveragePart.TITLE

export function coverageMaskHas(mask: HeadingCoverageMask, part: number): boolean {
  return (mask & part) !== 0
}

/** §4/§5/§6 — the coverage SEMANTICS of a heading diagnostic. */
export type HeadingDiagnosticCoveragePolicy = 'TITLE_ONLY' | 'FULL_VISIBLE_HEADING' | 'SOURCE_RANGE'

/**
 * V5.14-R6.1 §3/§7 — the ONE policy resolver. The COVERAGE is decided by the
 * DiagnosticCode (its SEMANTICS), never by "does this heading have a number".
 *
 * ROOT_R6_1_1 = R6 gave every heading diagnostic one global NUMBER|GAP|TITLE mask.
 * ROOT_R6_1_2 = the duplicate-title diagnostic therefore included the numbering
 *   decoration, although the duplication is about the TITLE TEXT only.
 * ROOT_R6_1_3 = the coverage was bound to the heading TYPE instead of the
 *   diagnostic semantics.
 */
export function resolveHeadingDiagnosticCoveragePolicy(input: {
  code: string
  category?: string | null
}): HeadingDiagnosticCoveragePolicy {
  const code = String(input.code ?? '')
  // §4 — the duplicated thing is the TITLE TEXT, never the auto number.
  if (code === 'HEADING_DUPLICATE_TEXT' || code === 'HEADING_DUPLICATE_IDENTITY') return 'TITLE_ONLY'
  // §6 — a real Markdown-token / local source range problem stays a source range.
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return 'SOURCE_RANGE'
  // §5 — "the STRUCTURAL STATE of this heading node is wrong" → the whole visible
  // heading (which degrades to TITLE when the numbering is off).
  if (code === 'HEADING_LEVEL_GAP') return 'FULL_VISIBLE_HEADING'
  if (code.startsWith('STRICT_FIRST_H1_')) return 'FULL_VISIBLE_HEADING'
  if (code === 'STRICT_SINGLE_H1_NO_H1' || code === 'STRICT_SINGLE_H1_MULTIPLE_H1') return 'FULL_VISIBLE_HEADING'
  // The remaining heading-scoped diagnostics annotate the heading TEXT they name.
  if (code === 'HEADING_EMPTY_TEXT') return 'TITLE_ONLY'
  return 'TITLE_ONLY'
}

/** §7 — the mask a policy yields for a given heading. */
export function coverageMaskForPolicy(
  policy: HeadingDiagnosticCoveragePolicy,
  input: { hasNumberDecoration: boolean },
): HeadingCoverageMask {
  if (policy === 'FULL_VISIBLE_HEADING') {
    return input.hasNumberDecoration ? HEADING_COVERAGE_NUMBERED : HEADING_COVERAGE_UNNUMBERED
  }
  // TITLE_ONLY and SOURCE_RANGE never include the numbering decoration.
  return HEADING_COVERAGE_UNNUMBERED
}

/** §25 — every code whose coverage policy is DECLARED above (never fallen through). */
const EXPLICITLY_MAPPED_HEADING_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'HEADING_DUPLICATE_TEXT',
  'HEADING_DUPLICATE_IDENTITY',
  'HEADING_LEVEL_GAP',
  'HEADING_EMPTY_TEXT',
  'STRICT_SINGLE_H1_NO_H1',
  'STRICT_SINGLE_H1_MULTIPLE_H1',
])

export function isKnownHeadingDiagnosticCode(code: string): boolean {
  const c = String(code ?? '')
  return c.startsWith('HEADING_') || c.startsWith('STRICT_') || c.startsWith('LATENT_ATX_')
}

/**
 * §25 — the KNOWN_HEADING_DIAGNOSTIC_WITHOUT_COVERAGE_POLICY gate predicate. A
 * heading diagnostic reaching the resolver's DEFAULT branch has no declared
 * semantics and must be caught, never silently annotated as TITLE_ONLY.
 */
export function isExplicitlyMappedHeadingDiagnosticCode(code: string): boolean {
  const c = String(code ?? '')
  if (EXPLICITLY_MAPPED_HEADING_DIAGNOSTIC_CODES.has(c)) return true
  if (c.startsWith('LATENT_ATX_HEADING_MARKER')) return true
  if (c.startsWith('STRICT_FIRST_H1_')) return true
  return false
}

/** §5/§21 — the mask a heading (not a diagnostic) inherits for the PASSIVE fill. */
export function expectedHeadingCoverageMask(input: { hasNumberDecoration: boolean }): HeadingCoverageMask {
  return coverageMaskForPolicy('FULL_VISIBLE_HEADING', input)
}

/** §11/§18 — the union of several policies (the heading-level passive fill). */
export function unionCoverageMasks(masks: readonly HeadingCoverageMask[]): HeadingCoverageMask {
  return masks.reduce((acc, m) => acc | m, 0)
}

export function formatCoverageMask(mask: HeadingCoverageMask): string {
  const parts: string[] = []
  if (coverageMaskHas(mask, HeadingCoveragePart.NUMBER)) parts.push('NUMBER')
  if (coverageMaskHas(mask, HeadingCoveragePart.GAP)) parts.push('GAP')
  if (coverageMaskHas(mask, HeadingCoveragePart.TITLE)) parts.push('TITLE')
  return parts.length > 0 ? parts.join('|') : 'NONE'
}

/** §27 — a rect snapshot with the hard invariant right = left + width. */
export interface CoverageRectSnapshot {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** §27 — the ONLY rect factory: edges in, all six fields derived. */
export function makeCoverageRect(input: { left: number; top: number; right: number; bottom: number }): CoverageRectSnapshot {
  const left = Number(input.left)
  const top = Number(input.top)
  const right = Math.max(left, Number(input.right))
  const bottom = Math.max(top, Number(input.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** §27 — verify the invariant (never spread a stale width/height). */
export function coverageRectInvariantHolds(rect: CoverageRectSnapshot, tolerancePx = 0.001): boolean {
  return Math.abs(rect.width - (rect.right - rect.left)) <= tolerancePx
    && Math.abs(rect.height - (rect.bottom - rect.top)) <= tolerancePx
}

/** §5/§11 — the ONE body snapshot every body visual consumes. */
export interface HeadingDiagnosticTargetSnapshot {
  /** §11/§18 — the diagnostic this snapshot belongs to (one policy per diagnostic). */
  diagnosticId: string
  stableIdentity: string
  layoutEpoch: number
  geometryGeneration: number

  /** §11 — the SEMANTICS-derived policy (never derived from the heading type). */
  coveragePolicy: HeadingDiagnosticCoveragePolicy
  coverageMask: HeadingCoverageMask

  numberRect: CoverageRectSnapshot | null
  gapRect: CoverageRectSnapshot | null
  titleRects: CoverageRectSnapshot[]

  /** NUMBER | GAP | TITLE only — never a reason chip, never a block-width rect. */
  semanticFragmentRects: CoverageRectSnapshot[]
  /** Scroll / centre / occlusion ONLY. Never the paint geometry. */
  semanticUnionRect: CoverageRectSnapshot

  reasonChipRect: CoverageRectSnapshot | null
  reasonChipExcluded: boolean
}

/**
 * §9/§10/§11 — split the measured `[blockLeft, titleLeft]` decoration band into
 * the NUMBER rect and the GAP rect.
 *
 * `numberTextWidthPx` is a REAL measured advance of the rendered number label (a
 * hidden same-font probe), never a character-count guess. When it is unknown the
 * band stays ONE continuous rect (NUMBER covering the whole band) — the coverage
 * never shows a hole (§11 NUMBER_GAP_VISUAL_DISCONTINUITY_COUNT=0).
 */
export function splitNumberAndGapRects(input: {
  decorationBand: CoverageRectSnapshot | null
  numberTextWidthPx: number | null
  gapMode: 'space' | 'none'
}): { numberRect: CoverageRectSnapshot | null; gapRect: CoverageRectSnapshot | null } {
  const band = input.decorationBand
  if (!band || band.width <= 0) return { numberRect: null, gapRect: null }
  const measured = input.numberTextWidthPx
  const hasMeasured = measured != null && Number.isFinite(measured) && measured > 0 && measured <= band.width
  if (input.gapMode !== 'space' || !hasMeasured) {
    // no gap part: the whole band is the NUMBER region (continuous paint).
    return { numberRect: band, gapRect: null }
  }
  const numberRight = Math.min(band.right, band.left + measured)
  return {
    numberRect: makeCoverageRect({ left: band.left, top: band.top, right: numberRight, bottom: band.bottom }),
    gapRect: makeCoverageRect({ left: numberRight, top: band.top, right: band.right, bottom: band.bottom }),
  }
}

export interface HeadingCoverageInput {
  diagnosticId: string
  coveragePolicy: HeadingDiagnosticCoveragePolicy
  stableIdentity: string
  layoutEpoch: number
  geometryGeneration: number
  hasNumberDecoration: boolean
  numberRect: CoverageRectSnapshot | null
  gapRect: CoverageRectSnapshot | null
  titleRects: readonly CoverageRectSnapshot[]
  reasonChipRect?: CoverageRectSnapshot | null
}

/** §5/§13 — the semantic fragments: the first visible line merges NUMBER|GAP|TITLE. */
export function buildSemanticFragmentRects(input: {
  coverageMask: HeadingCoverageMask
  numberRect: CoverageRectSnapshot | null
  gapRect: CoverageRectSnapshot | null
  titleRects: readonly CoverageRectSnapshot[]
}): CoverageRectSnapshot[] {
  const titles = [...input.titleRects].filter(r => r.width > 0 || r.height > 0)
  const includeNumber = coverageMaskHas(input.coverageMask, HeadingCoveragePart.NUMBER)
  const includeGap = coverageMaskHas(input.coverageMask, HeadingCoveragePart.GAP)
  const includeTitle = coverageMaskHas(input.coverageMask, HeadingCoveragePart.TITLE)
  const decoration: CoverageRectSnapshot[] = []
  if (includeNumber && input.numberRect) decoration.push(input.numberRect)
  if (includeGap && input.gapRect) decoration.push(input.gapRect)
  if (!includeTitle || titles.length === 0) {
    // §21 — numbering off (or no measurable title): the decoration band is the target.
    return decoration
  }
  const firstLine = titles[0]
  const firstParts = [...decoration, firstLine]
  const first = mergeCoverageRectsOnFirstLine(firstParts)
  const rest = titles.slice(1)
  return first ? [first, ...rest] : rest
}

/** §11/§13 — merge the parts of ONE visual line (never across lines). */
export function mergeCoverageRectsOnFirstLine(rects: readonly CoverageRectSnapshot[]): CoverageRectSnapshot | null {
  const usable = rects.filter(r => r.width > 0 || r.height > 0)
  if (usable.length === 0) return null
  let left = usable[0].left
  let right = usable[0].right
  let top = usable[0].top
  let bottom = usable[0].bottom
  for (const r of usable.slice(1)) {
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  return makeCoverageRect({ left, top, right, bottom })
}

/** §13 — the union is for scroll / centre / occlusion ONLY, never for painting. */
export function coverageUnionRect(rects: readonly CoverageRectSnapshot[]): CoverageRectSnapshot | null {
  return mergeCoverageRectsOnFirstLine(rects)
}

/**
 * §14 — the reason chip must NEVER be inside the semantic fragments. This is the
 * single predicate the audit + the gates use.
 */
export function reasonChipExcludedFromCoverage(input: {
  reasonChipRect: CoverageRectSnapshot | null
  semanticFragmentRects: readonly CoverageRectSnapshot[]
}): boolean {
  const chip = input.reasonChipRect
  if (!chip) return true
  for (const f of input.semanticFragmentRects) {
    const left = Math.max(chip.left, f.left)
    const right = Math.min(chip.right, f.right)
    const top = Math.max(chip.top, f.top)
    const bottom = Math.min(chip.bottom, f.bottom)
    if (right - left > 0.5 && bottom - top > 0.5) return false
  }
  return true
}

/** §5/§11 — build the ONE immutable snapshot for ONE diagnostic. */
export function buildHeadingDiagnosticTargetSnapshot(input: HeadingCoverageInput): HeadingDiagnosticTargetSnapshot {
  // §7 — the POLICY decides the mask; the numbering decoration only refines
  // FULL_VISIBLE_HEADING. TITLE_ONLY keeps the number/gap rects in the snapshot
  // (§12: the authority is never deleted) but NEVER puts them in the fragments.
  const coverageMask = coverageMaskForPolicy(input.coveragePolicy, {
    hasNumberDecoration: input.hasNumberDecoration,
  })
  const numberRect = input.numberRect ?? null
  const gapRect = input.gapRect ?? null
  const titleRects = coverageMaskHas(coverageMask, HeadingCoveragePart.TITLE) ? [...input.titleRects] : []
  const semanticFragmentRects = buildSemanticFragmentRects({ coverageMask, numberRect, gapRect, titleRects })
  const union = coverageUnionRect(semanticFragmentRects) ?? makeCoverageRect({ left: 0, top: 0, right: 0, bottom: 0 })
  const reasonChipRect = input.reasonChipRect ?? null
  return {
    diagnosticId: input.diagnosticId,
    stableIdentity: input.stableIdentity,
    layoutEpoch: input.layoutEpoch,
    geometryGeneration: input.geometryGeneration,
    coveragePolicy: input.coveragePolicy,
    coverageMask,
    numberRect,
    gapRect,
    titleRects,
    semanticFragmentRects,
    semanticUnionRect: union,
    reasonChipRect,
    reasonChipExcluded: reasonChipExcludedFromCoverage({ reasonChipRect, semanticFragmentRects }),
  }
}

// ── §7 — body PASSIVE / ACTIVE consistency ──────────────────────────────────

export interface PassiveActiveCoverageComparison {
  maxRectDeltaPx: number
  fragmentCountEqual: boolean
  coverageMaskEqual: boolean
  numberIncludedEqual: boolean
  gapIncludedEqual: boolean
  titleIncludedEqual: boolean
}

function rectDelta(a: CoverageRectSnapshot | null, b: CoverageRectSnapshot | null): number {
  if (!a || !b) return a === b ? 0 : Number.POSITIVE_INFINITY
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.right - b.right),
    Math.abs(a.top - b.top),
    Math.abs(a.bottom - b.bottom),
  )
}

/** §7 — the same diagnosticId + stableIdentity + layoutEpoch must give the same rects. */
export function comparePassiveActiveCoverage(
  passive: HeadingDiagnosticTargetSnapshot,
  active: HeadingDiagnosticTargetSnapshot | null,
): PassiveActiveCoverageComparison {
  if (!active) {
    return {
      maxRectDeltaPx: 0,
      fragmentCountEqual: true,
      coverageMaskEqual: true,
      numberIncludedEqual: true,
      gapIncludedEqual: true,
      titleIncludedEqual: true,
    }
  }
  let maxDelta = 0
  const n = Math.max(passive.semanticFragmentRects.length, active.semanticFragmentRects.length)
  for (let i = 0; i < n; i++) {
    const delta = rectDelta(passive.semanticFragmentRects[i] ?? null, active.semanticFragmentRects[i] ?? null)
    if (delta > maxDelta) maxDelta = delta
  }
  return {
    maxRectDeltaPx: maxDelta,
    fragmentCountEqual: passive.semanticFragmentRects.length === active.semanticFragmentRects.length,
    coverageMaskEqual: passive.coverageMask === active.coverageMask,
    numberIncludedEqual: (passive.numberRect != null) === (active.numberRect != null),
    gapIncludedEqual: (passive.gapRect != null) === (active.gapRect != null),
    titleIncludedEqual: passive.titleRects.length === active.titleRects.length,
  }
}

export const PASSIVE_ACTIVE_RECT_TOLERANCE_PX_V514R6 = 1

/**
 * §12 — a coverage that used the heading BLOCK rect as the paint geometry. The
 * signature is a fragment whose FOUR edges equal the block's (a legitimately
 * full-width title LINE differs in `top`/`bottom` on a multi-line heading, and in
 * `left` when the heading is numbered).
 */
export function coverageUsesFullBlockFallback(input: {
  semanticFragmentRects: readonly CoverageRectSnapshot[]
  headingBlockRect: CoverageRectSnapshot | null
  tolerancePx?: number
}): boolean {
  const block = input.headingBlockRect
  if (!block || block.width <= 0) return false
  const tolerance = input.tolerancePx ?? 1
  return input.semanticFragmentRects.some(f =>
    Math.abs(f.left - block.left) <= tolerance
    && Math.abs(f.right - block.right) <= tolerance
    && Math.abs(f.top - block.top) <= tolerance
    && Math.abs(f.bottom - block.bottom) <= tolerance)
}

// ── §29 — the V5.14-R6 hard gates (all must be 0) ────────────────────────────

export const HEADING_COVERAGE_V514R6_GATE_KEYS = [
  // §25 — policy-aware gates (R6.1 supersedes the R6 "every numbered heading must
  // include the number" rules)
  'bodyPassiveActiveCoverageMaskMismatch',
  'bodyPassiveActiveTargetRectMismatch',
  'bodyPassiveActiveFragmentCountMismatch',
  'bodyPassiveActivePolicyMismatch',
  'bodyOutlineSemanticCoverageMismatch',
  'bodyOutlinePolicyMismatch',
  'fullVisibleHeadingNumberOmitted',
  'fullVisibleHeadingGapOmitted',
  'duplicateHeadingNonTitleCoverage',
  'duplicateHeadingNumberIncluded',
  'duplicateHeadingGapIncluded',
  'knownHeadingDiagnosticWithoutCoveragePolicy',
  'reasonChipIncludedInHeadingTarget',
  'outlineReasonChip',
  'headingBlockFullWidthFallback',
  'numberGapVisualDiscontinuity',
  'staleHeadingPolicyAfterDiagnosticChange',
  'staleHeadingGeometryAfterPolicyChange',
  'staleHeadingCoverageAfterNumberChange',
  'staleHeadingCoverageAfterGapChange',
  'staleHeadingCoverageAfterTextEdit',
  'staleRectInvariant',
] as const

export type HeadingCoverageV514R6GateKey = typeof HEADING_COVERAGE_V514R6_GATE_KEYS[number]

export const HEADING_COVERAGE_V514R6_GATE_LABELS: Readonly<Record<HeadingCoverageV514R6GateKey, string>> = {
  bodyPassiveActiveCoverageMaskMismatch: 'BODY_PASSIVE_ACTIVE_COVERAGE_MASK_MISMATCH_COUNT',
  bodyPassiveActiveTargetRectMismatch: 'BODY_PASSIVE_ACTIVE_TARGET_RECT_MISMATCH_COUNT',
  bodyPassiveActiveFragmentCountMismatch: 'BODY_PASSIVE_ACTIVE_FRAGMENT_COUNT_MISMATCH_COUNT',
  bodyPassiveActivePolicyMismatch: 'BODY_PASSIVE_ACTIVE_POLICY_MISMATCH_COUNT',
  bodyOutlineSemanticCoverageMismatch: 'BODY_OUTLINE_SEMANTIC_COVERAGE_MISMATCH_COUNT',
  bodyOutlinePolicyMismatch: 'BODY_OUTLINE_POLICY_MISMATCH_COUNT',
  fullVisibleHeadingNumberOmitted: 'FULL_VISIBLE_HEADING_NUMBER_OMITTED_COUNT',
  fullVisibleHeadingGapOmitted: 'FULL_VISIBLE_HEADING_GAP_OMITTED_COUNT',
  duplicateHeadingNonTitleCoverage: 'DUPLICATE_HEADING_NON_TITLE_COVERAGE_COUNT',
  duplicateHeadingNumberIncluded: 'DUPLICATE_HEADING_NUMBER_INCLUDED_COUNT',
  duplicateHeadingGapIncluded: 'DUPLICATE_HEADING_GAP_INCLUDED_COUNT',
  knownHeadingDiagnosticWithoutCoveragePolicy: 'KNOWN_HEADING_DIAGNOSTIC_WITHOUT_COVERAGE_POLICY_COUNT',
  reasonChipIncludedInHeadingTarget: 'REASON_CHIP_INCLUDED_IN_HEADING_TARGET_COUNT',
  outlineReasonChip: 'OUTLINE_REASON_CHIP_COUNT',
  headingBlockFullWidthFallback: 'HEADING_BLOCK_FULL_WIDTH_FALLBACK_COUNT',
  numberGapVisualDiscontinuity: 'NUMBER_GAP_VISUAL_DISCONTINUITY_COUNT',
  staleHeadingPolicyAfterDiagnosticChange: 'STALE_HEADING_POLICY_AFTER_DIAGNOSTIC_CHANGE_COUNT',
  staleHeadingGeometryAfterPolicyChange: 'STALE_HEADING_GEOMETRY_AFTER_POLICY_CHANGE_COUNT',
  staleHeadingCoverageAfterNumberChange: 'STALE_HEADING_COVERAGE_AFTER_NUMBER_CHANGE_COUNT',
  staleHeadingCoverageAfterGapChange: 'STALE_HEADING_COVERAGE_AFTER_GAP_CHANGE_COUNT',
  staleHeadingCoverageAfterTextEdit: 'STALE_HEADING_COVERAGE_AFTER_TEXT_EDIT_COUNT',
  staleRectInvariant: 'STALE_RECT_INVARIANT_COUNT',
}

export type HeadingCoverageV514R6Counters = Record<HeadingCoverageV514R6GateKey, number>

export function createHeadingCoverageV514R6Counters(): HeadingCoverageV514R6Counters {
  return HEADING_COVERAGE_V514R6_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingCoverageV514R6Counters)
}

export function formatHeadingCoverageV514R6GateReport(
  counters: Readonly<HeadingCoverageV514R6Counters>,
): string[] {
  return HEADING_COVERAGE_V514R6_GATE_KEYS.map(key => `${HEADING_COVERAGE_V514R6_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateHeadingCoverageV514R6Gates(
  counters: Readonly<HeadingCoverageV514R6Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingCoverageV514R6GateKey[] } {
  const failedChecks = HEADING_COVERAGE_V514R6_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §28 — the ONE heading-coverage runtime audit. */
export const DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-COVERAGE-AUDIT'

/**
 * §24 — the V5.14-R6.1 per-diagnostic COVERAGE POLICY audit. It records the
 * DiagnosticCode -> policy decision and the three surfaces (body passive / body
 * active / outline) that must share it.
 */
export const DOCUMENT_DIAGNOSTIC_HEADING_COVERAGE_POLICY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTIC-HEADING-COVERAGE-POLICY-AUDIT'
