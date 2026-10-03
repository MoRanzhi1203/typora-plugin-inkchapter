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

/**
 * §2 (Heading Visible Label Coverage V1) — the SOURCE semantics of a heading
 * diagnostic: what the diagnostic is ABOUT.
 *
 * The auto number is a PRESENTATION artifact of the heading numbering service; it
 * is NOT part of the Markdown source, so it can never enter the source identity /
 * canonical heading text / duplicate-title semantics.
 *
 *   SOURCE_TITLE_ONLY = the source title text alone (\`## 小节\` -> \`小节\`)
 *   SOURCE_RANGE      = a real Markdown-token / source-range problem
 */
export type HeadingSourceSemanticsPolicy = 'SOURCE_TITLE_ONLY' | 'SOURCE_RANGE'

/**
 * §1/§2 — the VISUAL coverage of a heading diagnostic: what the user SEES.
 *
 *   VISIBLE_HEADING_LABEL = the FULL visible heading label
 *                           = generated number prefix + heading title text
 *   SOURCE_RANGE          = a source-range marker (no heading label is painted)
 */
export type HeadingVisualCoveragePolicy = 'VISIBLE_HEADING_LABEL' | 'SOURCE_RANGE'

/**
 * §4/§5/§6 — the mask-level coverage policy consumed by the body PASSIVE / ACTIVE
 * surface and the outline projection. The VISUAL policy IS
 * \`HeadingVisualCoveragePolicy\`; \`TITLE_ONLY\` remains the SOURCE-layer mask
 * (never selected for a heading diagnostic's geometry).
 */
export type HeadingDiagnosticCoveragePolicy = 'TITLE_ONLY' | 'VISIBLE_HEADING_LABEL' | 'SOURCE_RANGE'

/**
 * §1/§2/§3 — the ONE VISUAL coverage resolver. Every diagnostic that paints a
 * heading MUST resolve here (never a per-rule numbering special case).
 *
 * TITLE_V1_1 = R6.1 bound the coverage to the diagnostic's SOURCE semantics, so a
 *   numbered heading with a duplicate/empty diagnostic painted \`一、[小节]\` — the
 *   auto number was treated as "not part of what the user sees". It IS part of what
 *   the user sees; it is only excluded from the source IDENTITY.
 * TITLE_V1_2 = the coverage is therefore decided by "is there a visible heading
 *   label to paint" (always yes), never by the diagnostic's source semantics. The
 *   source semantic layer keeps its own policy so the two can never be conflated
 *   again (§2 SOURCE_TITLE_ONLY vs VISIBLE_HEADING_LABEL).
 */
export function resolveHeadingVisualCoveragePolicy(input: {
  code: string
  category?: string | null
}): HeadingVisualCoveragePolicy {
  const code = String(input.code ?? '')
  // §6 — a real Markdown-token / local source range problem stays a source range.
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return 'SOURCE_RANGE'
  // §5/§10 — every other heading-scoped diagnostic paints the user's REAL visible
  // heading label: the generated number prefix + the title text (degrading to the
  // title alone when the heading carries no number decoration).
  return 'VISIBLE_HEADING_LABEL'
}

/**
 * §2 — the ONE SOURCE-semantics resolver (source identity / semantic matching /
 * duplicate-title detection). It NEVER sees the auto number.
 */
export function resolveHeadingSourceSemanticsPolicy(input: {
  code: string
  category?: string | null
}): HeadingSourceSemanticsPolicy {
  const code = String(input.code ?? '')
  if (code.startsWith('LATENT_ATX_HEADING_MARKER')) return 'SOURCE_RANGE'
  return 'SOURCE_TITLE_ONLY'
}

/**
 * §3 — the host-facing entry point. It is the VISUAL policy (the visible heading
 * label): the body PASSIVE fill and the body ACTIVE emphasis both consume it, so
 * they can never disagree about whether the number is part of the coverage.
 */
export function resolveHeadingDiagnosticCoveragePolicy(input: {
  code: string
  category?: string | null
}): HeadingDiagnosticCoveragePolicy {
  return resolveHeadingVisualCoveragePolicy(input)
}

/** §7 — the mask a policy yields for a given heading. */
export function coverageMaskForPolicy(
  policy: HeadingDiagnosticCoveragePolicy,
  input: { hasNumberDecoration: boolean },
): HeadingCoverageMask {
  if (policy === 'VISIBLE_HEADING_LABEL') {
    return input.hasNumberDecoration ? HEADING_COVERAGE_NUMBERED : HEADING_COVERAGE_UNNUMBERED
  }
  // TITLE_ONLY (the SOURCE-layer mask) and SOURCE_RANGE never include the
  // numbering decoration: the source identity has no access to it.
  return HEADING_COVERAGE_UNNUMBERED
}

/**
 * V1 §3/§10 — the DOCUMENT-level diagnostics whose visual target IS a heading.
 * They consume the SAME visible-label authority as the HEADING_ / STRICT_ prefixed
 * codes (and so will SECTION_EMPTY / SECTION_ONLY_SUBHEADINGS).
 */
const DOCUMENT_LEVEL_HEADING_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'DOCUMENT_HEADING_ONLY_NO_BODY',
  'DOCUMENT_HEADINGS_ONLY_NO_BODY',
  'SECTION_EMPTY',
  'SECTION_ONLY_SUBHEADINGS',
])

/** §25 — every code whose coverage policy is DECLARED above (never fallen through). */
const EXPLICITLY_MAPPED_HEADING_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'HEADING_DUPLICATE_TEXT',
  'HEADING_DUPLICATE_IDENTITY',
  'HEADING_LEVEL_GAP',
  'HEADING_EMPTY_TEXT',
  // Heading Auto-Number Conflict V1 §26 — a heading-scoped ERROR whose ACTIVE
  // visual consumes the SAME VISIBLE_HEADING_LABEL coverage as every other
  // heading diagnostic (so it is explicitly mapped, never a fall-through).
  'HEADING_AUTO_NUMBER_CONFLICT',
  'STRICT_SINGLE_H1_NO_H1',
  'STRICT_SINGLE_H1_MULTIPLE_H1',
  ...[...DOCUMENT_LEVEL_HEADING_DIAGNOSTIC_CODES],
])

export function isKnownHeadingDiagnosticCode(code: string): boolean {
  const c = String(code ?? '')
  if (DOCUMENT_LEVEL_HEADING_DIAGNOSTIC_CODES.has(c)) return true
  return c.startsWith('HEADING_') || c.startsWith('STRICT_') || c.startsWith('LATENT_ATX_')
}

/**
 * §25 — the KNOWN_HEADING_DIAGNOSTIC_WITHOUT_COVERAGE_POLICY gate predicate. A
 * heading diagnostic reaching the resolver's DEFAULT branch has no declared
 * semantics and must be caught, never silently annotated.
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
  return coverageMaskForPolicy('VISIBLE_HEADING_LABEL', input)
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

/**
 * §1/§2/§20 — the VISIBLE heading label TEXT the user reads: the generated number
 * prefix + the heading title text. The reason chip and every other injected node
 * are NEVER part of it. This is the TEXT twin of the geometric coverage mask, so
 * an audit can prove that SOURCE and VISUAL disagree about the number exactly once.
 *
 * §7 — the number/gap rendering already carries its own separator (`一、`), and the
 * `space` gap mode contributes one space between `1.1` and the title.
 */
export function visibleHeadingLabelText(input: {
  numberPrefix: string | null
  titleText: string
  gapMode?: 'space' | 'none'
}): string {
  const prefix = String(input.numberPrefix ?? '').trim()
  const title = String(input.titleText ?? '')
  if (prefix === '') return title
  if (title === '') return prefix
  return (input.gapMode === 'space' ? `${prefix} ` : prefix) + title
}

/**
 * §1/§2/§11/§12 — the SOURCE-identity guard: does the source text carry the AUTO
 * number prefix? It must never do so — the number is a presentation artifact, and
 * `一、方法` / `二、方法` must still be the duplicate source title `方法`.
 */
export function sourceSemanticsIncludesAutoNumber(input: {
  sourceText: string
  numberPrefix: string | null
}): boolean {
  const prefix = String(input.numberPrefix ?? '').trim()
  if (prefix === '') return false
  const source = String(input.sourceText ?? '')
  const compact = (s: string) => s.replace(/\s+/g, '')
  return compact(source).startsWith(compact(prefix))
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
  // §7 — the VISUAL policy decides the mask (VISIBLE_HEADING_LABEL consumes the
  // numbering decoration; SOURCE_RANGE never does). The number/gap rects stay in
  // the snapshot as the RETENTION authority (§12) even for a policy that does not
  // paint them, so the two layers can never silently diverge.
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
