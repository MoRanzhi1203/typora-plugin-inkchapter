/**
 * V1 — Figure Diagnostic Locator Authority (pure contract).
 *
 * THE DEFECT (proved by the real runtime log):
 *   a `FIGURE_BLOCK_STRUCTURE_INVALID` click entered ACTIVATE → RESOLVING, but
 *   the location was still a `source-range`, so the inline occurrence resolver
 *   was used: `resolveDecision=UNRESOLVED /
 *   resolveReason=AMBIGUOUS_DUPLICATE_INLINE_RANGE`.
 *
 *   ROOT_1 = STRUCTURE_DIAGNOSTIC_USES_INLINE_OCCURRENCE_LOCATOR
 *   ROOT_2 = SOURCE_BLOCK_IDENTITY_IS_NOT_BOUND_TO_A_DOM_OWNING_BLOCK
 *   ROOT_3 = DOM_OWNING_BLOCK_IDENTITY_IS_the_unresolvable_`dom-block:p:na`
 *   ROOT_4 = STRUCTURE_LOCATE_ENTERS_INLINE_OCCURRENCE_DISAMBIGUATION
 *   ROOT_5 = FIGURE_WARNING_IDENTITY_IS_ONLY_THE_DESTINATION
 *   ROOT_6 = THE_GATE_ONLY_PROVES_LOCATION_METADATA_EXISTS (a false PASS)
 *
 * This module owns the ONE locator split:
 *
 *   block-level  → `source-block`      (Locator A, the whole owning block)
 *   occurrence   → `figure-occurrence` (Locator B, ONE verified image token)
 *
 * plus the identity builders, the runtime audit contract and the RUNTIME hard
 * gates. Pure: no DOM access, no host state.
 */
import type { DiagnosticLocation } from './diagnostics-types'

// ── Audit events ─────────────────────────────────────────

/** §26 — the ONE figure locator audit (locator kind + runtime resolve facts). */
export const FIGURE_DIAGNOSTIC_LOCATOR_AUDIT = 'FIGURE-DIAGNOSTIC-LOCATOR-AUDIT'
/** §27 — the Source ↔ DOM owning-block binding audit. */
export const FIGURE_SOURCE_DOM_BLOCK_BINDING_AUDIT = 'FIGURE-SOURCE-DOM-BLOCK-BINDING-AUDIT'

// ── Locator classification (§3/§15/§17) ──────────────────

export type FigureDiagnosticLocatorKind = 'source-block' | 'figure-occurrence' | 'source-range' | 'other'

/**
 * The ONE locator decision per rule. Structure rules are BLOCK-level, images
 * naming / existence rules are OCCURRENCE-level, everything else keeps the
 * generic inline `source-range` locator.
 */
export function figureDiagnosticLocatorKindForRule(code: string): FigureDiagnosticLocatorKind {
  if (code === 'FIGURE_BLOCK_STRUCTURE_INVALID') return 'source-block'
  if (code === 'FIGURE_MISSING_NAME' || code === 'FIGURE_LOCAL_IMAGE_MISSING') return 'figure-occurrence'
  return 'other'
}

/** True when this code is an image rule that must NEVER use the inline resolver. */
export function isBlockLevelFigureRule(code: string): boolean {
  return code === 'FIGURE_BLOCK_STRUCTURE_INVALID'
}

/** True when the location must never fall back to the inline duplicate resolver. */
export function locationMustNotUseInlineResolver(location: DiagnosticLocation | null | undefined): boolean {
  return location?.kind === 'source-block' || location?.kind === 'figure-occurrence'
}

// ── Identity builders (§6/§9/§11) ────────────────────────

/** `src-block:<startLine>` — the Markdown owning-block identity. */
export function buildSourceBlockIdentity(startLine: number): string {
  return `src-block:${Math.max(0, Math.floor(startLine))}`
}

/**
 * §7/§9 — the Source-side identity of ONE owning block. It carries the document
 * key, the source revision, the absolute span AND the block ordinal so two
 * byte-identical blocks (`before ![](same.png)` twice) stay distinguishable —
 * raw block text alone is never an identity.
 */
export function buildSourceBlockBindingKey(input: {
  documentKey: string | null
  sourceRevision: number | null
  sourceBlockIdentity: string
  sourceBlockOrdinal: number
  sourceStart: number
  sourceEnd: number
}): string {
  return [
    input.documentKey ?? '',
    input.sourceRevision == null ? 'r-' : `r${input.sourceRevision}`,
    input.sourceBlockIdentity,
    `b${Math.max(0, Math.floor(input.sourceBlockOrdinal))}`,
    `${input.sourceStart}`,
    `${input.sourceEnd}`,
  ].join('|')
}

/**
 * §7 — the DOM owning-block identity. NEVER `dom-block:p:na`.
 *
 * Priority (a real runtime authority each time):
 *   1. a Typora block runtime id (`data-node-id` / `data-block-id`);
 *   2. the Typora `data-line` stamp (the block's owning source line);
 *   3. the element `id`;
 *   4. deterministic fallback: tag + DOM ordinal + structural signature.
 */
export function buildDomBlockIdentity(input: {
  tag: string
  runtimeId: string | null
  dataLine: string | null
  elementId: string | null
  /** 0-based ordinal of the block among its siblings (fallback only). */
  ordinal: number
  /** Structural signature (e.g. first image destination) for the fallback. */
  structuralSignature: string
}): string {
  const tag = input.tag.toLowerCase()
  const runtimeId = (input.runtimeId ?? '').trim()
  if (runtimeId !== '') return `dom-block:${tag}:rid:${runtimeId}`
  const dataLine = (input.dataLine ?? '').trim()
  if (dataLine !== '' && dataLine !== 'na') return `dom-block:${tag}:line:${dataLine}`
  const elementId = (input.elementId ?? '').trim()
  if (elementId !== '') return `dom-block:${tag}:id:${elementId}`
  const sig = (input.structuralSignature ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)
  return `dom-block:${tag}:ord:${Math.max(0, Math.floor(input.ordinal))}:sig:${sig}`
}

/** True when a DOM block identity is a real, resolvable identity (never `:na`). */
export function isResolvableDomBlockIdentity(identity: string | null | undefined): boolean {
  if (identity == null) return false
  if (identity.trim() === '') return false
  if (/:na$/.test(identity)) return false
  if (identity === 'dom-block:p:na') return false
  return true
}

export interface FigureOccurrenceIdentityInput {
  documentKey: string | null
  sourceRevision: number | null
  sourceBlockIdentity: string
  sourceBlockOrdinal: number
  tokenStart: number | null
  tokenEnd: number | null
  rawLineOrdinal: number
  occurrenceWithinLine: number
  destination: string
}

/** §11 — the stable identity of ONE figure occurrence (never destination-only). */
export function buildFigureOccurrenceIdentity(input: FigureOccurrenceIdentityInput): string {
  return [
    input.documentKey ?? '',
    input.sourceRevision == null ? 'r-' : `r${input.sourceRevision}`,
    input.sourceBlockIdentity,
    `b${Math.max(0, Math.floor(input.sourceBlockOrdinal))}`,
    `${input.tokenStart ?? 'n'}`,
    `${input.tokenEnd ?? 'n'}`,
    `l${Math.max(0, Math.floor(input.rawLineOrdinal))}`,
    `w${Math.max(0, Math.floor(input.occurrenceWithinLine))}`,
    input.destination,
  ].join('|')
}

/** §11/§38 — the occurrence identity is MISSING when it cannot distinguish two occurrences. */
export function figureOccurrenceIdentityIsStable(identity: {
  sourceBlockIdentity: string
  tokenStart: number | null
  rawLineOrdinal: number
  occurrenceWithinLine: number
} | null | undefined): boolean {
  if (!identity) return false
  if (identity.sourceBlockIdentity.trim() === '') return false
  if (identity.tokenStart == null) return false
  return true
}

// ── §29 — the RUNTIME hard gates (all must be 0) ─────────

export const FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS = [
  'structureRuntimeUnresolved',
  'structureAmbiguousDuplicateInlineRange',
  'structureBlockBindingMissing',
  'structureBlockBindingAmbiguous',
  'structureLocateRollback',
  'warningRuntimeUnresolved',
  'warningDuplicateDestinationAmbiguity',
  'occurrenceIdentityMissing',
  'occurrenceWrongTarget',
  'localImageMissingWithoutSourceBlockFallback',
  'runtimeLocateFalsePass',
] as const

export type FigureDiagnosticLocatorV1GateKey = typeof FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS[number]

export const FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_LABELS: Readonly<Record<FigureDiagnosticLocatorV1GateKey, string>> = {
  structureRuntimeUnresolved: 'FIGURE_STRUCTURE_RUNTIME_UNRESOLVED_COUNT',
  structureAmbiguousDuplicateInlineRange: 'FIGURE_STRUCTURE_AMBIGUOUS_DUPLICATE_INLINE_RANGE_COUNT',
  structureBlockBindingMissing: 'FIGURE_STRUCTURE_BLOCK_BINDING_MISSING_COUNT',
  structureBlockBindingAmbiguous: 'FIGURE_STRUCTURE_BLOCK_BINDING_AMBIGUOUS_COUNT',
  structureLocateRollback: 'FIGURE_STRUCTURE_LOCATE_ROLLBACK_COUNT',
  warningRuntimeUnresolved: 'FIGURE_WARNING_RUNTIME_UNRESOLVED_COUNT',
  warningDuplicateDestinationAmbiguity: 'FIGURE_WARNING_DUPLICATE_DESTINATION_AMBIGUITY_COUNT',
  occurrenceIdentityMissing: 'FIGURE_OCCURRENCE_IDENTITY_MISSING_COUNT',
  occurrenceWrongTarget: 'FIGURE_OCCURRENCE_WRONG_TARGET_COUNT',
  localImageMissingWithoutSourceBlockFallback: 'FIGURE_LOCAL_IMAGE_MISSING_WITHOUT_SOURCE_BLOCK_FALLBACK_COUNT',
  runtimeLocateFalsePass: 'FIGURE_RUNTIME_LOCATE_FALSE_PASS_COUNT',
}

export type FigureDiagnosticLocatorV1Counters = Record<FigureDiagnosticLocatorV1GateKey, number>

export function createFigureDiagnosticLocatorV1Counters(): FigureDiagnosticLocatorV1Counters {
  return FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FigureDiagnosticLocatorV1Counters)
}

export function formatFigureDiagnosticLocatorV1GateReport(
  counters: Readonly<FigureDiagnosticLocatorV1Counters>,
): string[] {
  return FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS.map(k => `${FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateFigureDiagnosticLocatorV1Gates(
  counters: Readonly<FigureDiagnosticLocatorV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: FigureDiagnosticLocatorV1GateKey[] } {
  const failedChecks = FIGURE_DIAGNOSTIC_LOCATOR_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §30 — positive runtime coverage (non-zero is REQUIRED) ──

export const FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_KEYS = [
  'structureBlockLocateRuntime',
  'missingNameOccurrenceLocateRuntime',
  'localImageMissingLocateRuntime',
  'duplicateDestinationDistinctOccurrenceLocateRuntime',
] as const

export type FigureDiagnosticLocatorV1CoverageKey = typeof FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_KEYS[number]

export const FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_LABELS: Readonly<Record<FigureDiagnosticLocatorV1CoverageKey, string>> = {
  structureBlockLocateRuntime: 'FIGURE_STRUCTURE_BLOCK_LOCATE_RUNTIME_COUNT',
  missingNameOccurrenceLocateRuntime: 'FIGURE_MISSING_NAME_OCCURRENCE_LOCATE_RUNTIME_COUNT',
  localImageMissingLocateRuntime: 'FIGURE_LOCAL_IMAGE_MISSING_LOCATE_RUNTIME_COUNT',
  duplicateDestinationDistinctOccurrenceLocateRuntime: 'DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_LOCATE_RUNTIME_COUNT',
}

export type FigureDiagnosticLocatorV1CoverageCounters = Record<FigureDiagnosticLocatorV1CoverageKey, number>

export function createFigureDiagnosticLocatorV1CoverageCounters(): FigureDiagnosticLocatorV1CoverageCounters {
  return FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FigureDiagnosticLocatorV1CoverageCounters)
}

export function formatFigureDiagnosticLocatorV1CoverageReport(
  counters: Readonly<FigureDiagnosticLocatorV1CoverageCounters>,
): string[] {
  return FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_KEYS.map(k => `${FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

/**
 * §30 — the coverage requirement: every positive counter must reach its
 * minimum, otherwise a document that never exercises the path could look PASS.
 */
export const FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_MINIMUMS: Readonly<Record<FigureDiagnosticLocatorV1CoverageKey, number>> = {
  structureBlockLocateRuntime: 1,
  missingNameOccurrenceLocateRuntime: 1,
  localImageMissingLocateRuntime: 1,
  duplicateDestinationDistinctOccurrenceLocateRuntime: 2,
}

export function evaluateFigureDiagnosticLocatorV1Coverage(
  counters: Readonly<FigureDiagnosticLocatorV1CoverageCounters>,
  minimums: Readonly<Record<FigureDiagnosticLocatorV1CoverageKey, number>> = FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: FigureDiagnosticLocatorV1CoverageKey[] } {
  const unmet = FIGURE_DIAGNOSTIC_LOCATOR_V1_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}

// ── §31/§32 — LOCATE vs CLEANUP closure separation ────────

export type LocateDecision = 'PASS' | 'FAIL' | 'N/A'
export type CleanupClosureDecision = 'PASS' | 'FAIL' | 'N/A'

/**
 * §32 — the FEATURE locate decision. A PASS requires resolution + scroll +
 * highlight. `resolveDecision === 'UNRESOLVED'` is ALWAYS FAIL, even when the
 * cleanup closure passed.
 */
export function computeLocateDecision(input: {
  resolveDecision: string
  scrollDecision: string
  highlightDecision: string
  finalDecision: string
}): LocateDecision {
  if (input.resolveDecision !== 'RESOLVED') return 'FAIL'
  if (input.scrollDecision === 'FAIL' || input.highlightDecision === 'FAIL') return 'FAIL'
  if (input.finalDecision.startsWith('FAIL')) return 'FAIL'
  return 'PASS'
}

/**
 * §31 — the cleanup closure decision is INDEPENDENT of the locate decision.
 * A clean rollback must never be reported as a locate PASS.
 */
export function computeCleanupClosureDecision(input: {
  rollbackCompleted: boolean
  rollbackFillRemoved: boolean
  rollbackLeaseReleased: boolean
  rollbackMarkerRemoved: boolean
  rollbackTransactionClosed: boolean
}): CleanupClosureDecision {
  const ok = input.rollbackCompleted
    && input.rollbackFillRemoved
    && input.rollbackLeaseReleased
    && input.rollbackMarkerRemoved
    && input.rollbackTransactionClosed
  return ok ? 'PASS' : 'FAIL'
}

/**
 * §32/§51D — the FEATURE decision. A cleanup PASS must never mask a locate
 * FAIL; the two are reported separately and the feature fails on either.
 */
export function computeFeatureLocateDecision(
  locate: LocateDecision,
  cleanup: CleanupClosureDecision,
): 'PASS' | 'FAIL' {
  return locate === 'PASS' && cleanup !== 'FAIL' ? 'PASS' : 'FAIL'
}
