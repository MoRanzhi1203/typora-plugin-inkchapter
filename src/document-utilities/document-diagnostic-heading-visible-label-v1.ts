/**
 * Heading Visible Label Coverage V1 — the ONE runtime audit + hard-gate authority
 * for the heading diagnostic VISUAL coverage.
 *
 * §1/§2 — the THREE authorities this module observes (it never re-implements them):
 *
 *   Semantic Identity  -> `resolveHeadingSourceSemanticsPolicy` (SOURCE_TITLE_ONLY)
 *   Scroll Anchor      -> the canonical heading BLOCK element
 *   Visual Coverage    -> `resolveHeadingVisualCoveragePolicy` (VISIBLE_HEADING_LABEL)
 *
 * The module contains NO resolver: it only classifies REAL runtime facts and keeps
 * the gate/coverage counters, so a second "visible label resolver" can never grow
 * out of the audit surface (§3 DUPLICATE_HEADING_VISIBLE_LABEL_RESOLVER_COUNT=0).
 */

/** §20 — the per-diagnostic visible-label coverage audit. */
export const HEADING_VISIBLE_LABEL_COVERAGE_AUDIT_EVENT = 'HEADING-VISIBLE-LABEL-COVERAGE-AUDIT'

/** §20 — the dynamic renumber / numbering-style-switch audit. */
export const HEADING_VISIBLE_LABEL_RENUMBER_AUDIT_EVENT = 'HEADING-VISIBLE-LABEL-RENUMBER-AUDIT'

/** §5 — the rendered number STYLE of a visible prefix (never a source property). */
export type HeadingNumberStyle = 'none' | 'chinese' | 'decimal' | 'roman' | 'multi-level' | 'other'

const CHINESE_NUMBER_RE = /^[〇零一二三四五六七八九十百千万]+[、.]?$/
const DECIMAL_NUMBER_RE = /^\d+(\.\d+)*[.、)]?$/
const ROMAN_NUMBER_RE = /^[IVXLCDM]+[.、)]?$/

/**
 * §5/§16 — classify the RENDERED number prefix. This is presentation-only: the
 * classification never feeds an identity, a diagnosticId or a source range.
 */
export function classifyHeadingNumberStyle(numberPrefix: string | null | undefined): HeadingNumberStyle {
  const raw = String(numberPrefix ?? '').trim()
  if (raw === '') return 'none'
  // a multi-level decimal (`2.3.1`) is its own case: the spec calls it out explicitly
  if (/^\d+(\.\d+){2,}[.、)]?$/.test(raw)) return 'multi-level'
  if (CHINESE_NUMBER_RE.test(raw)) return 'chinese'
  if (DECIMAL_NUMBER_RE.test(raw)) return 'decimal'
  if (ROMAN_NUMBER_RE.test(raw)) return 'roman'
  return 'other'
}

/** §20 — the REAL facts of ONE heading diagnostic's visible label. */
export interface HeadingVisibleLabelCoverageFacts {
  documentKey: string | null
  diagnosticId: string
  diagnosticCode: string
  headingStableIdentity: string
  headingLevel: string | null

  /** §1 — the SOURCE title text (`## 小节` -> `小节`); never the auto number. */
  canonicalSourceText: string
  /** §1 — the rendered number prefix the user sees (`一、` / `1.1` / `II`). */
  generatedNumberPrefix: string | null
  /** §1 — the heading title text node the user sees. */
  visibleTitleText: string

  /** §1/§2 — the two layers must DISAGREE about the number, by design. */
  sourceIdentityIncludesNumbering: boolean
  visualCoverageIncludesNumbering: boolean
  visualCoverageIncludesTitle: boolean

  /** §14 — the chip must be present in the DOM but OUTSIDE the coverage. */
  reasonChipPresent: boolean
  reasonChipIncludedInCoverage: boolean

  /** §7/§8 — 1 semantic heading target may render as N visual fragments. */
  semanticTargetCount: number
  visualFragmentCount: number

  /** §7/§27 — text-tightness / unrelated-UI guards. */
  coverageSpansUnrelatedBlock: boolean
  coverageIncludesUnrelatedUi: boolean
  /** §1 — the anchor must stay the canonical heading block, never a decoration. */
  scrollAnchorIsCanonicalHeadingBlock: boolean
}

export interface HeadingVisibleLabelCoverageDecision {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
}

/**
 * §1/§2/§7/§14/§19 — the ONE decision function for the visible-label coverage. It
 * encodes the invariants the FINAL_DECISION depends on:
 *
 *   - the auto number NEVER enters the source identity (§1)
 *   - the VISUAL coverage ALWAYS includes the rendered number prefix when the
 *     heading carries one (§1/§10)
 *   - the VISUAL coverage ALWAYS includes the title text (§1)
 *   - the reason chip is NEVER inside the coverage (§14)
 *   - the anchor stays the canonical heading block (§1)
 *   - the coverage is text-tight, never a block wash (§7/§27)
 *   - visual fragments may EXCEED the semantic target count (multiline), never
 *     replace it: the semantic count stays the number of heading targets (§8)
 */
export function evaluateHeadingVisibleLabelCoverage(
  facts: HeadingVisibleLabelCoverageFacts,
): HeadingVisibleLabelCoverageDecision {
  const failed: string[] = []
  const hasNumber = String(facts.generatedNumberPrefix ?? '').trim() !== ''
  if (facts.sourceIdentityIncludesNumbering) failed.push('AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY')
  if (hasNumber && !facts.visualCoverageIncludesNumbering) failed.push('MISSING_NUMBER_PREFIX')
  if (!facts.visualCoverageIncludesTitle) failed.push('MISSING_TITLE_TEXT')
  if (facts.reasonChipPresent && facts.reasonChipIncludedInCoverage) failed.push('REASON_CHIP_INCLUDED')
  if (!facts.scrollAnchorIsCanonicalHeadingBlock) failed.push('SCROLL_ANCHOR_NOT_HEADING_BLOCK')
  if (facts.coverageSpansUnrelatedBlock) failed.push('COVERAGE_SPANS_UNRELATED_BLOCK')
  if (facts.coverageIncludesUnrelatedUi) failed.push('COVERAGE_INCLUDES_UNRELATED_UI')
  if (facts.semanticTargetCount < 1) failed.push('SEMANTIC_TARGET_MISSING')
  if (facts.visualFragmentCount < 1) failed.push('VISUAL_FRAGMENT_MISSING')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'VISIBLE_HEADING_LABEL_COVERAGE_CLOSED' : failed.join(','),
    failedChecks: failed,
  }
}

/** §15/§16/§20 — the REAL facts of a renumber / style-switch transition. */
export interface HeadingVisibleLabelRenumberFacts {
  diagnosticIdBefore: string
  diagnosticIdAfter: string
  headingStableIdentityBefore: string
  headingStableIdentityAfter: string
  canonicalSourceTextBefore: string
  canonicalSourceTextAfter: string
  numberPrefixBefore: string | null
  numberPrefixAfter: string | null
  visualCoverageBefore: string
  visualCoverageAfter: string
  /** §15 — active visual fragments still carrying the PREVIOUS number prefix. */
  staleFragmentCount: number
}

/**
 * §15/§16 — a renumber (or a numbering-style switch) may ONLY refresh the visible
 * coverage. The identity must not move, and no stale prefix fragment may survive.
 */
export function evaluateHeadingVisibleLabelRenumber(
  facts: HeadingVisibleLabelRenumberFacts,
): HeadingVisibleLabelCoverageDecision & { prefixRefreshed: boolean } {
  const failed: string[] = []
  if (facts.diagnosticIdBefore !== facts.diagnosticIdAfter) failed.push('DIAGNOSTIC_ID_CHANGED_ONLY_BY_AUTO_NUMBER')
  if (facts.headingStableIdentityBefore !== facts.headingStableIdentityAfter) failed.push('HEADING_SOURCE_IDENTITY_CHANGED_ONLY_BY_RENUMBER')
  if (facts.canonicalSourceTextBefore !== facts.canonicalSourceTextAfter) failed.push('CANONICAL_SOURCE_TEXT_CHANGED_ONLY_BY_RENUMBER')
  if (facts.staleFragmentCount !== 0) failed.push('STALE_HEADING_NUMBERING_ACTIVE_FRAGMENT')
  const prefixChanged = String(facts.numberPrefixBefore ?? '') !== String(facts.numberPrefixAfter ?? '')
  const prefixRefreshed = prefixChanged
    && facts.visualCoverageAfter !== facts.visualCoverageBefore
    && facts.visualCoverageAfter.includes(String(facts.numberPrefixAfter ?? '').trim())
  // §15 — a prefix transition whose visible coverage never moved is the stale
  // coverage the spec forbids: the label must repaint, not keep the old prefix.
  if (prefixChanged && facts.visualCoverageAfter === facts.visualCoverageBefore) {
    failed.push('VISIBLE_COVERAGE_NOT_REFRESHED')
  }
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'VISIBLE_HEADING_LABEL_RENUMBER_CLOSED' : failed.join(','),
    failedChecks: failed,
    prefixRefreshed,
  }
}

// ── §23 — the hard gates ────────────────────────────────────────────────────

export const HEADING_VISIBLE_LABEL_V1_GATE_KEYS = [
  'autoNumberPrefixEnteredSemanticIdentity',
  'headingScrollAnchorChangedToNumberingFragment',
  'diagnosticIdChangedOnlyByAutoNumberStyle',
  'headingSourceIdentityChangedOnlyByRenumber',
  'duplicateHeadingVisibleLabelResolver',
  'numberingFragmentCountedAsSemanticTarget',
  'emptyHeadingAutoNumberTreatedAsSourceText',
  'autoNumberPrefixMaskedDuplicateHeadingText',
  'autoNumberPrefixReportedAsManualNumber',
  'headingReasonChipIncludedInActiveCoverage',
  'staleHeadingNumberingActiveFragment',
  'headingVisibleLabelPollingRefresh',
  'headingActiveCoverageMissingNumberPrefix',
  'headingActiveCoverageMissingTitleText',
  'headingActiveCoverageIncludedUnrelatedUi',
  'headingActiveCoverageSpansUnrelatedBlock',
  'drawerViewportRegression',
  'targetGroupRegression',
  'toolbarSeveritySummaryRegression',
  'unrequestedHeadingNumberingBehaviorChange',
  'unrequestedDiagnosticColorChange',
  'unrelatedProductionFileChange',
] as const

export type HeadingVisibleLabelV1GateKey = typeof HEADING_VISIBLE_LABEL_V1_GATE_KEYS[number]

export const HEADING_VISIBLE_LABEL_V1_GATE_LABELS: Readonly<Record<HeadingVisibleLabelV1GateKey, string>> = {
  autoNumberPrefixEnteredSemanticIdentity: 'AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY_COUNT',
  headingScrollAnchorChangedToNumberingFragment: 'HEADING_SCROLL_ANCHOR_CHANGED_TO_NUMBERING_FRAGMENT_COUNT',
  diagnosticIdChangedOnlyByAutoNumberStyle: 'DIAGNOSTIC_ID_CHANGED_ONLY_BY_AUTO_NUMBER_STYLE_COUNT',
  headingSourceIdentityChangedOnlyByRenumber: 'HEADING_SOURCE_IDENTITY_CHANGED_ONLY_BY_RENUMBER_COUNT',
  duplicateHeadingVisibleLabelResolver: 'DUPLICATE_HEADING_VISIBLE_LABEL_RESOLVER_COUNT',
  numberingFragmentCountedAsSemanticTarget: 'NUMBERING_FRAGMENT_COUNTED_AS_SEMANTIC_TARGET_COUNT',
  emptyHeadingAutoNumberTreatedAsSourceText: 'EMPTY_HEADING_AUTO_NUMBER_TREATED_AS_SOURCE_TEXT_COUNT',
  autoNumberPrefixMaskedDuplicateHeadingText: 'AUTO_NUMBER_PREFIX_MASKED_DUPLICATE_HEADING_TEXT_COUNT',
  autoNumberPrefixReportedAsManualNumber: 'AUTO_NUMBER_PREFIX_REPORTED_AS_MANUAL_NUMBER_COUNT',
  headingReasonChipIncludedInActiveCoverage: 'HEADING_REASON_CHIP_INCLUDED_IN_ACTIVE_COVERAGE_COUNT',
  staleHeadingNumberingActiveFragment: 'STALE_HEADING_NUMBERING_ACTIVE_FRAGMENT_COUNT',
  headingVisibleLabelPollingRefresh: 'HEADING_VISIBLE_LABEL_POLLING_REFRESH_COUNT',
  headingActiveCoverageMissingNumberPrefix: 'HEADING_ACTIVE_COVERAGE_MISSING_NUMBER_PREFIX_COUNT',
  headingActiveCoverageMissingTitleText: 'HEADING_ACTIVE_COVERAGE_MISSING_TITLE_TEXT_COUNT',
  headingActiveCoverageIncludedUnrelatedUi: 'HEADING_ACTIVE_COVERAGE_INCLUDED_UNRELATED_UI_COUNT',
  headingActiveCoverageSpansUnrelatedBlock: 'HEADING_ACTIVE_COVERAGE_SPANS_UNRELATED_BLOCK_COUNT',
  drawerViewportRegression: 'DRAWER_VIEWPORT_REGRESSION_COUNT',
  targetGroupRegression: 'TARGET_GROUP_REGRESSION_COUNT',
  toolbarSeveritySummaryRegression: 'TOOLBAR_SEVERITY_SUMMARY_REGRESSION_COUNT',
  unrequestedHeadingNumberingBehaviorChange: 'UNREQUESTED_HEADING_NUMBERING_BEHAVIOR_CHANGE_COUNT',
  unrequestedDiagnosticColorChange: 'UNREQUESTED_DIAGNOSTIC_COLOR_CHANGE_COUNT',
  unrelatedProductionFileChange: 'UNRELATED_PRODUCTION_FILE_CHANGE_COUNT',
}

export type HeadingVisibleLabelV1Counters = Record<HeadingVisibleLabelV1GateKey, number>

export function createHeadingVisibleLabelV1Counters(): HeadingVisibleLabelV1Counters {
  return HEADING_VISIBLE_LABEL_V1_GATE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingVisibleLabelV1Counters)
}

export function formatHeadingVisibleLabelV1GateReport(
  counters: Readonly<HeadingVisibleLabelV1Counters>,
): string[] {
  return HEADING_VISIBLE_LABEL_V1_GATE_KEYS.map(key => `${HEADING_VISIBLE_LABEL_V1_GATE_LABELS[key]}=${counters[key] ?? 0}`)
}

export function evaluateHeadingVisibleLabelV1Gates(
  counters: Readonly<HeadingVisibleLabelV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: HeadingVisibleLabelV1GateKey[] } {
  const failedChecks = HEADING_VISIBLE_LABEL_V1_GATE_KEYS.filter(key => (counters[key] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

/** §23 — fold ONE failed coverage decision into its gate counters (never a guess). */
export function applyHeadingVisibleLabelCoverageFailure(
  counters: HeadingVisibleLabelV1Counters,
  failedChecks: readonly string[],
): void {
  for (const check of failedChecks) {
    switch (check) {
      case 'AUTO_NUMBER_PREFIX_ENTERED_SEMANTIC_IDENTITY':
        counters.autoNumberPrefixEnteredSemanticIdentity++
        break
      case 'MISSING_NUMBER_PREFIX':
        counters.headingActiveCoverageMissingNumberPrefix++
        break
      case 'MISSING_TITLE_TEXT':
        counters.headingActiveCoverageMissingTitleText++
        break
      case 'REASON_CHIP_INCLUDED':
        counters.headingReasonChipIncludedInActiveCoverage++
        break
      case 'SCROLL_ANCHOR_NOT_HEADING_BLOCK':
        counters.headingScrollAnchorChangedToNumberingFragment++
        break
      case 'COVERAGE_SPANS_UNRELATED_BLOCK':
        counters.headingActiveCoverageSpansUnrelatedBlock++
        break
      case 'COVERAGE_INCLUDES_UNRELATED_UI':
        counters.headingActiveCoverageIncludedUnrelatedUi++
        break
      default:
        break
    }
  }
}

/** §23 — fold ONE failed renumber decision into its gate counters. */
export function applyHeadingVisibleLabelRenumberFailure(
  counters: HeadingVisibleLabelV1Counters,
  failedChecks: readonly string[],
): void {
  for (const check of failedChecks) {
    switch (check) {
      case 'DIAGNOSTIC_ID_CHANGED_ONLY_BY_AUTO_NUMBER':
        counters.diagnosticIdChangedOnlyByAutoNumberStyle++
        break
      case 'HEADING_SOURCE_IDENTITY_CHANGED_ONLY_BY_RENUMBER':
      case 'CANONICAL_SOURCE_TEXT_CHANGED_ONLY_BY_RENUMBER':
        counters.headingSourceIdentityChangedOnlyByRenumber++
        break
      case 'STALE_HEADING_NUMBERING_ACTIVE_FRAGMENT':
        counters.staleHeadingNumberingActiveFragment++
        break
      case 'VISIBLE_COVERAGE_NOT_REFRESHED':
        counters.headingVisibleLabelPollingRefresh++
        break
      default:
        break
    }
  }
}

// ── §24 — the positive coverage (the gates must be PROVEN exercised) ────────

export const HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS = [
  'visibleLabelWithNumber',
  'chineseNumberActiveCoverage',
  'decimalNumberActiveCoverage',
  'romanNumberActiveCoverage',
  'multilineVisibleLabel',
  'dynamicRenumberVisualRefresh',
  'h1NumberingToggleVisualRefresh',
] as const

export type HeadingVisibleLabelV1CoverageKey = typeof HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS[number]

export const HEADING_VISIBLE_LABEL_V1_COVERAGE_LABELS: Readonly<Record<HeadingVisibleLabelV1CoverageKey, string>> = {
  visibleLabelWithNumber: 'HEADING_VISIBLE_LABEL_WITH_NUMBER_RUNTIME_COUNT',
  chineseNumberActiveCoverage: 'CHINESE_NUMBER_ACTIVE_COVERAGE_RUNTIME_COUNT',
  decimalNumberActiveCoverage: 'DECIMAL_NUMBER_ACTIVE_COVERAGE_RUNTIME_COUNT',
  romanNumberActiveCoverage: 'ROMAN_NUMBER_ACTIVE_COVERAGE_RUNTIME_COUNT',
  multilineVisibleLabel: 'MULTILINE_HEADING_VISIBLE_LABEL_RUNTIME_COUNT',
  dynamicRenumberVisualRefresh: 'DYNAMIC_RENUMBER_VISUAL_REFRESH_RUNTIME_COUNT',
  h1NumberingToggleVisualRefresh: 'H1_NUMBERING_TOGGLE_VISUAL_REFRESH_RUNTIME_COUNT',
}

/** §24 — the minimum each positive-coverage counter must reach. */
export const HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS: Readonly<Record<HeadingVisibleLabelV1CoverageKey, number>> = {
  visibleLabelWithNumber: 4,
  chineseNumberActiveCoverage: 1,
  decimalNumberActiveCoverage: 1,
  romanNumberActiveCoverage: 1,
  multilineVisibleLabel: 1,
  dynamicRenumberVisualRefresh: 2,
  h1NumberingToggleVisualRefresh: 1,
}

export type HeadingVisibleLabelV1Coverage = Record<HeadingVisibleLabelV1CoverageKey, number>

export function createHeadingVisibleLabelV1Coverage(): HeadingVisibleLabelV1Coverage {
  return HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as HeadingVisibleLabelV1Coverage)
}

/** §24 — note ONE real active visible-label coverage observation. */
export function noteHeadingVisibleLabelCoverage(
  coverage: HeadingVisibleLabelV1Coverage,
  input: { numberPrefix: string | null; visualFragmentCount: number },
): void {
  const style = classifyHeadingNumberStyle(input.numberPrefix)
  if (style !== 'none') coverage.visibleLabelWithNumber++
  if (input.visualFragmentCount > 1) coverage.multilineVisibleLabel++
  if (style === 'chinese') coverage.chineseNumberActiveCoverage++
  if (style === 'decimal') coverage.decimalNumberActiveCoverage++
  if (style === 'roman') coverage.romanNumberActiveCoverage++
}

export function formatHeadingVisibleLabelV1CoverageReport(
  coverage: Readonly<HeadingVisibleLabelV1Coverage>,
): string[] {
  return HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS.map(key =>
    `${HEADING_VISIBLE_LABEL_V1_COVERAGE_LABELS[key]}=${coverage[key] ?? 0}/${HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS[key]}`)
}

/** §24 — the positive coverage is CLOSED only when every minimum is reached. */
export function evaluateHeadingVisibleLabelV1Coverage(
  coverage: Readonly<HeadingVisibleLabelV1Coverage>,
): { decision: 'PASS' | 'FAIL'; unmet: HeadingVisibleLabelV1CoverageKey[] } {
  const unmet = HEADING_VISIBLE_LABEL_V1_COVERAGE_KEYS.filter(key =>
    (coverage[key] ?? 0) < HEADING_VISIBLE_LABEL_V1_COVERAGE_MINIMUMS[key])
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}
