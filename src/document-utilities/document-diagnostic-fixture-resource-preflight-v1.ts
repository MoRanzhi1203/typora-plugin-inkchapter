/**
 * V1 — Figure Diagnostic Fixture Resource Closure (pure contract).
 *
 * THE DEFECT (proved by the real runtime):
 *   `Figure-Diagnostic-Locator-V1-Test.md` referenced `a.png` / `b.png` /
 *   `same.png`, all of which do NOT exist in the vault. Every "rendered image"
 *   Case had therefore degraded into a broken-image / source-token /
 *   source-block-fallback case, so the runtime could never prove a REAL
 *   `<img>` occurrence locate.
 *
 *   ROOT_F1 = FIXTURE_PIXEL_BASELINE_IS_A_BROKEN_IMAGE
 *   ROOT_F2 = VISIBLE_FIXTURE_CASE_HAS_NO_RENDERED_IMG
 *   ROOT_F3 = EXPECTED_MISSING_POLICY_IS_IMPLICIT (any missing was tolerated)
 *   ROOT_F4 = FALLBACK_LOCATE_IS_COUNTED_AS_RENDERED_OCCURRENCE
 *   ROOT_F5 = EXISTENCE_ALONE_IS_ACCEPTED (no IMG DOM / decode proof)
 *
 * This module owns:
 *   - the fixture resource MANIFEST (expected-visible vs expected-missing);
 *   - the resource PREFLIGHT decision;
 *   - the resource hard gates + the runtime coverage gates.
 *
 * Pure: no DOM access, no filesystem access, no host state.
 */

// ── Audit contracts (§18/§19) ─────────────────────────────

export const FIGURE_DIAGNOSTIC_FIXTURE_RESOURCE_PREFLIGHT = 'FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-PREFLIGHT'
export const FIGURE_DIAGNOSTIC_FIXTURE_RESOURCE_AUDIT = 'FIGURE-DIAGNOSTIC-FIXTURE-RESOURCE-AUDIT'

// ── The fixture manifest (§4/§17) ─────────────────────────

/** Fixture document, relative to the vault root (POSIX). */
export const FIGURE_LOCATOR_V1_FIXTURE_RELATIVE_PATH =
  'runtime/smoke/Figure-Diagnostic-Locator-V1-Test.md'
/** The dedicated, self-contained asset directory (relative to the vault root). */
export const FIGURE_LOCATOR_V1_ASSET_DIR =
  'runtime/smoke/assets/figure-diagnostic-locator-v1'
/** The dedicated visible assets that MUST exist and decode. */
export const FIGURE_LOCATOR_V1_VISIBLE_ASSETS = [
  'a-visible.png',
  'b-visible.png',
  'repeated-visible.png',
] as const

/**
 * §17 — the ONE explicit expected-missing allowlist. Every other local image
 * reference in the V1 fixture is EXPECTED_VISIBLE. There is no third state.
 */
export const EXPECTED_MISSING_FIGURE_RESOURCES: ReadonlySet<string> = new Set([
  'missing-local-image.png',
])

/** §43 — legacy bare paths that must never reappear in the V1 fixture. */
export const LEGACY_NONEXISTENT_FIXTURE_PATHS: ReadonlySet<string> = new Set([
  'a.png',
  'b.png',
  'same.png',
])

export type FixtureResourceExpectedState = 'VISIBLE' | 'MISSING'

export interface FixtureImageReference {
  /** `S1` / `S3` / `W1` … (derived from the `## Case …` heading). */
  caseId: string
  kind: 'image'
  altText: string
  rawDestination: string
  /** POSIX destination relative to the fixture DOCUMENT directory. */
  relativeDestination: string
  expectedState: FixtureResourceExpectedState
}

/** Normalize a Markdown destination for manifest comparison. */
export function normalizeFixtureDestination(destination: string): string {
  let value = (destination ?? '').trim()
  if (value === '') return ''
  const hash = value.indexOf('#')
  if (hash >= 0) value = value.slice(0, hash)
  const query = value.indexOf('?')
  if (query >= 0) value = value.slice(0, query)
  value = value.replace(/\\/g, '/')
  while (value.startsWith('./')) value = value.slice(2)
  return value
}

/** §17 — the ONE classification. Never returns UNKNOWN for a non-empty path. */
export function expectedStateForFixtureDestination(destination: string): FixtureResourceExpectedState | null {
  const norm = normalizeFixtureDestination(destination)
  if (norm === '') return null
  const basename = norm.slice(norm.lastIndexOf('/') + 1)
  if (EXPECTED_MISSING_FIGURE_RESOURCES.has(norm) || EXPECTED_MISSING_FIGURE_RESOURCES.has(basename)) {
    return 'MISSING'
  }
  return 'VISIBLE'
}

/** True when the destination is a legacy bare path that must not remain (§43). */
export function isLegacyNonexistentFixturePath(destination: string): boolean {
  const norm = normalizeFixtureDestination(destination)
  return LEGACY_NONEXISTENT_FIXTURE_PATHS.has(norm) || LEGACY_NONEXISTENT_FIXTURE_PATHS.has(norm.split('/').pop() ?? norm)
}

const CASE_HEADING_RE = /^##\s+Case\s+([A-Za-z0-9]+)/
const IMAGE_TOKEN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/**
 * §43 — extract every image reference of the fixture, case-scoped, with its
 * EXPECTED state. Used by the fixture contract tests AND by the runtime
 * preflight; there is exactly ONE parser.
 */
export function extractFixtureImageReferences(markdown: string): FixtureImageReference[] {
  const out: FixtureImageReference[] = []
  let caseId = ''
  for (const line of (markdown ?? '').split('\n')) {
    const heading = CASE_HEADING_RE.exec(line.trim())
    if (heading) {
      caseId = heading[1]
      continue
    }
    IMAGE_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = IMAGE_TOKEN_RE.exec(line)) !== null) {
      const rawDestination = m[2]
      const expectedState = expectedStateForFixtureDestination(rawDestination)
      out.push({
        caseId,
        kind: 'image',
        altText: m[1],
        rawDestination,
        relativeDestination: normalizeFixtureDestination(rawDestination),
        expectedState: expectedState ?? 'VISIBLE',
      })
    }
  }
  return out
}

// ── §19 — per-resource runtime observation ────────────────

export type FixtureResourceDiagnostic = 'NONE' | 'FIGURE_LOCAL_IMAGE_MISSING'

export interface FixtureResourceObservation {
  caseId: string
  rawDestination: string
  relativeDestination: string
  expectedState: FixtureResourceExpectedState
  /** Absolute path of the resolved local file (null when not resolvable). */
  resolvedAbsolutePath: string | null
  fsExists: boolean
  domImgPresent: boolean
  imgComplete: boolean
  naturalWidth: number
  naturalHeight: number
  resourceDiagnostic: FixtureResourceDiagnostic
}

/** True when the observation proves a REAL, decoded `<img>` (§20). */
export function observationProvesRenderedImage(o: FixtureResourceObservation): boolean {
  return o.fsExists && o.domImgPresent && o.imgComplete && o.naturalWidth > 0 && o.naturalHeight > 0
}

// ── §18/§23 — the preflight decision ──────────────────────

export interface FixtureResourcePreflightResult {
  documentKey: string | null
  totalImageReferenceCount: number
  expectedVisibleReferenceCount: number
  expectedMissingReferenceCount: number
  resolvedExistingReferenceCount: number
  resolvedMissingReferenceCount: number
  unexpectedMissingReferences: string[]
  unexpectedExistingExpectedMissingReferences: string[]
  expectedVisibleRenderedImgCount: number
  expectedVisibleDecodedImgCount: number
  unknownPolicyReferences: string[]
  decision: 'PASS' | 'FAIL'
  reason: string
}

/**
 * §23 — PASS requires EVERY expected-visible reference to exist, render and
 * decode, and EVERY expected-missing reference to be really absent.
 */
export function evaluateFixtureResourcePreflight(input: {
  documentKey?: string | null
  references: readonly FixtureImageReference[]
  observations: readonly FixtureResourceObservation[]
}): FixtureResourcePreflightResult {
  const references = input.references ?? []
  const observations = input.observations ?? []
  const byKey = new Map<string, FixtureResourceObservation>()
  for (const o of observations) byKey.set(`${o.caseId}\u0000${o.relativeDestination}`, o)

  const unexpectedMissingReferences: string[] = []
  const unexpectedExistingExpectedMissingReferences: string[] = []
  const unknownPolicyReferences: string[] = []
  let expectedVisible = 0
  let expectedMissing = 0
  let existing = 0
  let missing = 0
  let renderedImg = 0
  let decodedImg = 0

  for (const ref of references) {
    const o = byKey.get(`${ref.caseId}\u0000${ref.relativeDestination}`)
      ?? observations.find(x => x.relativeDestination === ref.relativeDestination)
    if (!o) {
      unknownPolicyReferences.push(`${ref.caseId}:${ref.relativeDestination}:NO_OBSERVATION`)
      continue
    }
    if (o.expectedState === 'VISIBLE') {
      expectedVisible++
      if (o.fsExists) existing++
      else unexpectedMissingReferences.push(`${ref.caseId}:${ref.relativeDestination}`)
      if (o.domImgPresent) renderedImg++
      if (observationProvesRenderedImage(o)) decodedImg++
    } else {
      expectedMissing++
      if (o.fsExists) {
        missing++
        unexpectedExistingExpectedMissingReferences.push(`${ref.caseId}:${ref.relativeDestination}`)
      } else {
        missing++
      }
    }
  }

  const failed = unexpectedMissingReferences.length > 0
    || unexpectedExistingExpectedMissingReferences.length > 0
    || unknownPolicyReferences.length > 0
    || renderedImg < expectedVisible
    || decodedImg < expectedVisible
  return {
    documentKey: input.documentKey ?? null,
    totalImageReferenceCount: references.length,
    expectedVisibleReferenceCount: expectedVisible,
    expectedMissingReferenceCount: expectedMissing,
    resolvedExistingReferenceCount: existing,
    resolvedMissingReferenceCount: missing,
    unexpectedMissingReferences,
    unexpectedExistingExpectedMissingReferences,
    expectedVisibleRenderedImgCount: renderedImg,
    expectedVisibleDecodedImgCount: decodedImg,
    unknownPolicyReferences,
    decision: failed ? 'FAIL' : 'PASS',
    reason: failed
      ? [
        unexpectedMissingReferences.length > 0 ? 'UNEXPECTED_MISSING_VISIBLE_IMAGE' : '',
        unexpectedExistingExpectedMissingReferences.length > 0 ? 'EXPECTED_MISSING_IMAGE_EXISTS' : '',
        unknownPolicyReferences.length > 0 ? 'UNKNOWN_RESOURCE_POLICY' : '',
        renderedImg < expectedVisible ? 'VISIBLE_IMAGE_DOM_MISSING' : '',
        decodedImg < expectedVisible ? 'VISIBLE_IMAGE_DECODE_FAIL' : '',
      ].filter(Boolean).join(',')
      : 'FIXTURE_RESOURCES_OK',
  }
}

// ── §21/§31/§33/§36/§37 — hard gates ──────────────────────

export const FIXTURE_RESOURCE_V1_GATE_KEYS = [
  // resource preflight
  'unexpectedMissingImageInVisibleFixture',
  'unexpectedExistingImageInExpectedMissingCase',
  'visibleFixtureImageDomMissing',
  'visibleFixtureImageDecodeFail',
  'visibleFixtureLocalImageMissingDiagnostic',
  'fixtureResourceUnknownPolicy',
  'legacyNonexistentFixturePathReference',
  'unexpectedFigureLocalImageMissing',
  // rendered occurrence
  'renderedFigureOccurrenceRuntimeUnresolved',
  'renderedFigureOccurrenceNonImgTarget',
  'renderedFigureOccurrenceFallbackUsed',
  'renderedFigureOccurrenceDecodeFail',
  'renderedFigureOccurrenceWrongTarget',
  // duplicate destination
  'duplicateDestinationWrongFirstMatch',
  'duplicateDestinationAmbiguity',
  // missing fallback
  'missingImageFallbackUnresolved',
  'missingImageFallbackWrongBlock',
  'brokenImageFallbackCountedAsRenderedOccurrence',
] as const

export type FixtureResourceV1GateKey = typeof FIXTURE_RESOURCE_V1_GATE_KEYS[number]

export const FIXTURE_RESOURCE_V1_GATE_LABELS: Readonly<Record<FixtureResourceV1GateKey, string>> = {
  unexpectedMissingImageInVisibleFixture: 'UNEXPECTED_MISSING_IMAGE_IN_VISIBLE_FIXTURE_COUNT',
  unexpectedExistingImageInExpectedMissingCase: 'UNEXPECTED_EXISTING_IMAGE_IN_EXPECTED_MISSING_CASE_COUNT',
  visibleFixtureImageDomMissing: 'VISIBLE_FIXTURE_IMAGE_DOM_MISSING_COUNT',
  visibleFixtureImageDecodeFail: 'VISIBLE_FIXTURE_IMAGE_DECODE_FAIL_COUNT',
  visibleFixtureLocalImageMissingDiagnostic: 'VISIBLE_FIXTURE_LOCAL_IMAGE_MISSING_DIAGNOSTIC_COUNT',
  fixtureResourceUnknownPolicy: 'FIXTURE_RESOURCE_UNKNOWN_POLICY_COUNT',
  legacyNonexistentFixturePathReference: 'LEGACY_NONEXISTENT_FIXTURE_PATH_REFERENCE_COUNT',
  unexpectedFigureLocalImageMissing: 'UNEXPECTED_FIGURE_LOCAL_IMAGE_MISSING_COUNT',
  renderedFigureOccurrenceRuntimeUnresolved: 'RENDERED_FIGURE_OCCURRENCE_RUNTIME_UNRESOLVED_COUNT',
  renderedFigureOccurrenceNonImgTarget: 'RENDERED_FIGURE_OCCURRENCE_NON_IMG_TARGET_COUNT',
  renderedFigureOccurrenceFallbackUsed: 'RENDERED_FIGURE_OCCURRENCE_FALLBACK_USED_COUNT',
  renderedFigureOccurrenceDecodeFail: 'RENDERED_FIGURE_OCCURRENCE_DECODE_FAIL_COUNT',
  renderedFigureOccurrenceWrongTarget: 'RENDERED_FIGURE_OCCURRENCE_WRONG_TARGET_COUNT',
  duplicateDestinationWrongFirstMatch: 'DUPLICATE_DESTINATION_WRONG_FIRST_MATCH_COUNT',
  duplicateDestinationAmbiguity: 'DUPLICATE_DESTINATION_AMBIGUITY_COUNT',
  missingImageFallbackUnresolved: 'MISSING_IMAGE_FALLBACK_UNRESOLVED_COUNT',
  missingImageFallbackWrongBlock: 'MISSING_IMAGE_FALLBACK_WRONG_BLOCK_COUNT',
  brokenImageFallbackCountedAsRenderedOccurrence: 'BROKEN_IMAGE_FALLBACK_COUNTED_AS_RENDERED_OCCURRENCE_COUNT',
}

export type FixtureResourceV1Counters = Record<FixtureResourceV1GateKey, number>

export function createFixtureResourceV1Counters(): FixtureResourceV1Counters {
  return FIXTURE_RESOURCE_V1_GATE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FixtureResourceV1Counters)
}

export function formatFixtureResourceV1GateReport(counters: Readonly<FixtureResourceV1Counters>): string[] {
  return FIXTURE_RESOURCE_V1_GATE_KEYS.map(k => `${FIXTURE_RESOURCE_V1_GATE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateFixtureResourceV1Gates(
  counters: Readonly<FixtureResourceV1Counters>,
): { decision: 'PASS' | 'FAIL'; failedChecks: FixtureResourceV1GateKey[] } {
  const failedChecks = FIXTURE_RESOURCE_V1_GATE_KEYS.filter(k => (counters[k] ?? 0) !== 0)
  return { decision: failedChecks.length === 0 ? 'PASS' : 'FAIL', failedChecks }
}

// ── §22/§32/§33/§36 — positive coverage ───────────────────

export const FIXTURE_RESOURCE_V1_COVERAGE_KEYS = [
  'visibleFixtureImageReferenceCount',
  'visibleFixtureRenderedImageDomCount',
  'expectedMissingImageCaseCount',
  'expectedMissingImageDiagnosticCount',
  'renderedFigureOccurrenceLocateRuntimeCount',
  'duplicateDestinationVisibleOccurrenceCount',
  'duplicateDestinationDistinctSourceBlockIdentityCount',
  'duplicateDestinationDistinctOccurrenceIdentityCount',
  'duplicateDestinationDistinctResolvedDomElementCount',
  'missingImageSourceBlockFallbackRuntimeCount',
] as const

export type FixtureResourceV1CoverageKey = typeof FIXTURE_RESOURCE_V1_COVERAGE_KEYS[number]

export const FIXTURE_RESOURCE_V1_COVERAGE_LABELS: Readonly<Record<FixtureResourceV1CoverageKey, string>> = {
  visibleFixtureImageReferenceCount: 'VISIBLE_FIXTURE_IMAGE_REFERENCE_COUNT',
  visibleFixtureRenderedImageDomCount: 'VISIBLE_FIXTURE_RENDERED_IMAGE_DOM_COUNT',
  expectedMissingImageCaseCount: 'EXPECTED_MISSING_IMAGE_CASE_COUNT',
  expectedMissingImageDiagnosticCount: 'EXPECTED_MISSING_IMAGE_DIAGNOSTIC_COUNT',
  renderedFigureOccurrenceLocateRuntimeCount: 'RENDERED_FIGURE_OCCURRENCE_LOCATE_RUNTIME_COUNT',
  duplicateDestinationVisibleOccurrenceCount: 'DUPLICATE_DESTINATION_VISIBLE_OCCURRENCE_COUNT',
  duplicateDestinationDistinctSourceBlockIdentityCount: 'DUPLICATE_DESTINATION_DISTINCT_SOURCE_BLOCK_IDENTITY_COUNT',
  duplicateDestinationDistinctOccurrenceIdentityCount: 'DUPLICATE_DESTINATION_DISTINCT_OCCURRENCE_IDENTITY_COUNT',
  duplicateDestinationDistinctResolvedDomElementCount: 'DUPLICATE_DESTINATION_DISTINCT_RESOLVED_DOM_ELEMENT_COUNT',
  missingImageSourceBlockFallbackRuntimeCount: 'MISSING_IMAGE_SOURCE_BLOCK_FALLBACK_RUNTIME_COUNT',
}

export type FixtureResourceV1CoverageCounters = Record<FixtureResourceV1CoverageKey, number>

/** §22/§32/§33/§36 — the REQUIRED positive minima. */
export const FIXTURE_RESOURCE_V1_COVERAGE_MINIMUMS: Readonly<Record<FixtureResourceV1CoverageKey, number>> = {
  visibleFixtureImageReferenceCount: 9,
  visibleFixtureRenderedImageDomCount: 9,
  expectedMissingImageCaseCount: 1,
  expectedMissingImageDiagnosticCount: 1,
  renderedFigureOccurrenceLocateRuntimeCount: 3,
  duplicateDestinationVisibleOccurrenceCount: 2,
  duplicateDestinationDistinctSourceBlockIdentityCount: 2,
  duplicateDestinationDistinctOccurrenceIdentityCount: 2,
  duplicateDestinationDistinctResolvedDomElementCount: 2,
  missingImageSourceBlockFallbackRuntimeCount: 1,
}

export function createFixtureResourceV1CoverageCounters(): FixtureResourceV1CoverageCounters {
  return FIXTURE_RESOURCE_V1_COVERAGE_KEYS.reduce((acc, k) => {
    acc[k] = 0
    return acc
  }, {} as FixtureResourceV1CoverageCounters)
}

export function formatFixtureResourceV1CoverageReport(
  counters: Readonly<FixtureResourceV1CoverageCounters>,
): string[] {
  return FIXTURE_RESOURCE_V1_COVERAGE_KEYS.map(k => `${FIXTURE_RESOURCE_V1_COVERAGE_LABELS[k]}=${counters[k] ?? 0}`)
}

export function evaluateFixtureResourceV1Coverage(
  counters: Readonly<FixtureResourceV1CoverageCounters>,
  minimums: Readonly<Record<FixtureResourceV1CoverageKey, number>> = FIXTURE_RESOURCE_V1_COVERAGE_MINIMUMS,
): { decision: 'PASS' | 'FAIL'; unmet: FixtureResourceV1CoverageKey[] } {
  const unmet = FIXTURE_RESOURCE_V1_COVERAGE_KEYS.filter(k => (counters[k] ?? 0) < (minimums[k] ?? 1))
  return { decision: unmet.length === 0 ? 'PASS' : 'FAIL', unmet }
}

// ── §27/§38 — the RENDERED occurrence decision (no false acceptance) ──

export type RenderedOccurrenceLocateKind =
  | 'RENDERED_OCCURRENCE'
  | 'SOURCE_BLOCK_STRUCTURE'
  | 'MISSING_IMAGE_FALLBACK'

export interface RenderedOccurrenceFacts {
  resourceExists: boolean | null
  resolvedNodeTag: string | null
  usedSourceBlockFallback: boolean
  imgComplete: boolean
  naturalWidth: number
  naturalHeight: number
  resolveDecision: string
  /** The resolved element is the occurrence's own target (never a sibling). */
  correctOccurrence: boolean
}

/**
 * §38 — the RENDERED occurrence decision. A successful resolution is NOT
 * enough: the resource must exist, the DOM target must be a REAL decoded
 * `<img>`, no fallback may be used, and the occurrence must be the right one.
 */
export function evaluateRenderedOccurrenceLocate(facts: RenderedOccurrenceFacts): {
  decision: 'PASS' | 'FAIL'
  reason: string
  failedChecks: string[]
} {
  const failed: string[] = []
  if (facts.resolveDecision !== 'RESOLVED') failed.push('RUNTIME_UNRESOLVED')
  if (facts.resourceExists !== true) failed.push('RESOURCE_NOT_VISIBLE')
  if ((facts.resolvedNodeTag ?? '').toLowerCase() !== 'img') failed.push('NON_IMG_TARGET')
  if (facts.usedSourceBlockFallback) failed.push('FALLBACK_USED')
  if (!facts.imgComplete || facts.naturalWidth <= 0 || facts.naturalHeight <= 0) failed.push('DECODE_FAIL')
  if (!facts.correctOccurrence) failed.push('WRONG_TARGET')
  return {
    decision: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0 ? 'RENDERED_OCCURRENCE_OK' : failed.join(','),
    failedChecks: failed,
  }
}

/** §27 — the ONLY classification of a figure locate result. */
export function classifyFigureLocateKind(input: {
  ruleCode: string
  usedSourceBlockFallback: boolean
}): RenderedOccurrenceLocateKind {
  if (input.ruleCode === 'FIGURE_BLOCK_STRUCTURE_INVALID') return 'SOURCE_BLOCK_STRUCTURE'
  return input.usedSourceBlockFallback ? 'MISSING_IMAGE_FALLBACK' : 'RENDERED_OCCURRENCE'
}
