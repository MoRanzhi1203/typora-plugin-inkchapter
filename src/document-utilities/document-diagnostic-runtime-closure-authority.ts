/**
 * Capability Matrix V2 §11/§12/§19/§20/§21/§22 — the ONE Runtime Closure Authority.
 *
 * This module DERIVES `runtimeClosureStatus` for EVERY registered family from a
 * declared, explicit set of required DIMENSIONS — never a hand-written status.
 * `IMPLEMENTED` NEVER implies `CLOSED`: a family is `CLOSED` only when ALL of its
 * required dimensions pass, which (for the interactive dimensions) requires a
 * VALID current-build runtime evidence record. With no evidence every
 * implemented family is honestly `UNVERIFIED`.
 *
 * Evidence records are validated against the CURRENT build: the fixture must
 * exist on disk, the session id must be a real audit session, and `mainSha256`
 * must equal the current `dist/main.js` SHA. A record failing any check is
 * IGNORED and counted in the stale / SHA-mismatch / missing-fixture /
 * missing-session gates, so a fabricated or stale record can NEVER yield
 * `CLOSED`.
 *
 * ✅ P0/P1/P2 runtime evidence CANNOT be produced here (it needs real Typora
 * clicks) — the shipped evidence index is EMPTY, so nothing is CLOSED.
 */
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  countUnresolvedDynamicRuntimeCodes,
  getRuleMeta,
  resolveDiagnosticKind,
  resolvePresentationSeverity,
  resolvedRuntimeCodesOf,
  type DocumentDiagnosticImplementationStatus,
  type DocumentDiagnosticRuleMeta,
  type DocumentDiagnosticRuntimeClosureStatus,
} from './document-diagnostic-location'
import {
  EMPTY_DOCUMENT_DIAGNOSTIC_STATIC_TEST_MANIFEST,
  type DocumentDiagnosticStaticTestManifest,
} from './document-diagnostic-static-test-manifest'
import { PRODUCED_DIAGNOSTIC_CODES } from './document-diagnostics'

/** §11 — the 15 closure dimensions the authority evaluates per family. */
export type DocumentDiagnosticClosureDimension =
  | 'producerPass'
  | 'severityPass'
  | 'stableIdentityPass'
  | 'suppressionPass'
  | 'dynamicRefreshPass'
  | 'locationPass'
  | 'activeVisualPass'
  | 'firstClickPass'
  | 'deactivatePass'
  | 'activeSwitchPass'
  | 'crossDocumentCleanupPass'
  | 'targetedTestPass'
  | 'integrationTestPass'
  | 'runtimePositiveEvidencePass'
  | 'runtimeNegativeGatePass'

/** §11 — the canonical dimension order (deterministic audit output). */
export const DOCUMENT_DIAGNOSTIC_CLOSURE_DIMENSIONS: readonly DocumentDiagnosticClosureDimension[] = [
  'producerPass',
  'severityPass',
  'stableIdentityPass',
  'suppressionPass',
  'dynamicRefreshPass',
  'locationPass',
  'activeVisualPass',
  'firstClickPass',
  'deactivatePass',
  'activeSwitchPass',
  'crossDocumentCleanupPass',
  'targetedTestPass',
  'integrationTestPass',
  'runtimePositiveEvidencePass',
  'runtimeNegativeGatePass',
]

export type DocumentDiagnosticClosureDimensions = Readonly<Record<DocumentDiagnosticClosureDimension, boolean>>

// ── §12 — the Runtime Evidence Manifest record ──────────────────────────────

/** §12 — the six runtime observations a record must carry. */
export interface DocumentDiagnosticRuntimeEvidenceFlags {
  producer: boolean
  firstClick: boolean
  activeVisual: boolean
  deactivate: boolean
  dynamicRefresh: boolean
  crossDocumentCleanup: boolean
}

/** §12 — ONE machine-readable evidence record (index only, never full logs). */
export interface DocumentDiagnosticRuntimeEvidenceRecord {
  familyId: string
  fixture: string
  sessionId: string
  buildId: string
  mainSha256: string
  evidence: DocumentDiagnosticRuntimeEvidenceFlags
}

/**
 * §12 — the CURRENT-build environment an evidence record is validated against.
 * `currentMainSha256 === null` ⇒ dist/main.js is unavailable at generation time
 * ⇒ every record is STALE (never CLOSED).
 */
export interface DocumentDiagnosticRuntimeEvidenceEnvironment {
  currentMainSha256: string | null
  /** Does the referenced fixture exist on disk? */
  fixtureExists: (fixture: string) => boolean
  /** Is `sessionId` a real audit session (a real Fresh-Runtime-Identity run)? */
  isKnownSession: (sessionId: string) => boolean
}

/** §12 — the validation verdict for ONE record. */
export interface DocumentDiagnosticValidatedEvidence {
  record: DocumentDiagnosticRuntimeEvidenceRecord
  fixtureValid: boolean
  sessionValid: boolean
  shaValid: boolean
  /** True when the build SHA is unavailable OR does not match the current build. */
  staleBuild: boolean
  /** True only when fixture + session + SHA ALL check out. */
  valid: boolean
  invalidReasons: readonly string[]
}

/** §11/§12 — the input to every authority computation. */
export interface DocumentDiagnosticClosureAuthorityInput {
  staticTestManifest?: DocumentDiagnosticStaticTestManifest
  runtimeEvidence?: readonly DocumentDiagnosticRuntimeEvidenceRecord[]
  evidenceEnvironment?: DocumentDiagnosticRuntimeEvidenceEnvironment
}

/** §20 — the per-family runtime closure audit record. */
export interface DocumentDiagnosticRuntimeClosureAuditRecord {
  familyId: string
  runtimeCodes: readonly string[]
  implementationStatus: DocumentDiagnosticImplementationStatus
  runtimeClosureStatus: DocumentDiagnosticRuntimeClosureStatus
  dimensions: DocumentDiagnosticClosureDimensions
  requiredDimensions: readonly DocumentDiagnosticClosureDimension[]
  evidenceFixture: string | null
  evidenceSessionId: string | null
  evidenceBuildId: string | null
  evidenceMainSha256: string | null
  decision: 'PASS' | 'FAIL'
  reason: string
}

/** §22 — the runtime closure hard gates. */
export interface DocumentDiagnosticRuntimeClosureGates {
  UNRESOLVED_DYNAMIC_RUNTIME_CODE_COUNT: number
  RUNTIME_CLOSED_WITH_STALE_BUILD_EVIDENCE_COUNT: number
  RUNTIME_CLOSED_WITH_SHA_MISMATCH_COUNT: number
  RUNTIME_CLOSURE_EVIDENCE_MISSING_FIXTURE_COUNT: number
  RUNTIME_CLOSURE_EVIDENCE_MISSING_SESSION_COUNT: number
  RUNTIME_CLOSED_WITHOUT_POSITIVE_EVIDENCE_COUNT: number
  RUNTIME_CLOSED_WITHOUT_FIRST_CLICK_COUNT: number
  RUNTIME_CLOSED_WITHOUT_ACTIVE_VISUAL_COUNT: number
  RUNTIME_CLOSED_WITHOUT_DEACTIVATE_COUNT: number
  RUNTIME_CLOSED_WITH_DYNAMIC_REFRESH_PENDING_COUNT: number
  RUNTIME_CLOSED_WITH_CROSS_DOCUMENT_CLEANUP_PENDING_COUNT: number
}

/** §21 — the metadata / count hard gates. */
export interface DocumentDiagnosticMetadataGates {
  DIAGNOSTIC_RULE_COUNT_AUTHORITY_MISMATCH_COUNT: number
  DUPLICATE_RULE_METADATA_AUTHORITY_COUNT: number
  DUPLICATE_RULE_FAMILY_ID_COUNT: number
  DUPLICATE_RUNTIME_CODE_AUTHORITY_COUNT: number
  UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT: number
  REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT: number
  USER_VISIBLE_INFO_SEVERITY_COUNT: number
  UNKNOWN_PRESENTATION_SEVERITY_COUNT: number
  STATE_GUARD_CLASSIFICATION_MISSING_COUNT: number
  CONTENT_DIAGNOSTIC_CLASSIFICATION_MISSING_COUNT: number
}

/** §19 — the capability audit (one per recompute). */
export interface DocumentDiagnosticsCapabilityAudit {
  registeredRuleFamilyCount: number
  resolvedDiagnosticCodeCount: number
  userVisibleDiagnosticTypeCount: number
  implementedFamilyCount: number
  deferredFamilyCount: number
  stateGuardCodeCount: number
  contentDiagnosticCodeCount: number
  closedFamilyCount: number
  partialFamilyCount: number
  unverifiedFamilyCount: number
  deferredClosureFamilyCount: number
  unregisteredRuntimeCodeCount: number
  implementedWithoutProducerCount: number
  duplicateFamilyCount: number
  unknownSeverityCount: number
  staleRuntimeEvidenceCount: number
  runtimeEvidenceShaMismatchCount: number
  decision: 'PASS' | 'FAIL'
  reason: string
}

/** §31 — the FROZEN baseline counts the count-authority gate asserts. */
export const DOCUMENT_DIAGNOSTIC_BASELINE = {
  registeredRuleFamilyCount: 77,
  resolvedDiagnosticCodeCount: 83,
  userVisibleDiagnosticTypeCount: 72,
  implementedFamilyCount: 72,
  deferredFamilyCount: 5,
  plannedFamilyCount: 0,
  stateGuardCodeCount: 5,
  contentDiagnosticCodeCount: 78,
} as const

// ── Internal authorities ────────────────────────────────────────────────────

const FAMILIES: readonly DocumentDiagnosticRuleMeta[] = Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
const FAMILY_BY_ID: ReadonlyMap<string, DocumentDiagnosticRuleMeta> = new Map(
  FAMILIES.map(meta => [meta.familyId, meta]),
)
const PRODUCED_FAMILY_IDS: ReadonlySet<string> = new Set(
  PRODUCED_DIAGNOSTIC_CODES
    .map(code => getRuleMeta(code)?.familyId)
    .filter((id): id is string => id != null),
)

const DEFAULT_EVIDENCE_ENVIRONMENT: DocumentDiagnosticRuntimeEvidenceEnvironment = {
  currentMainSha256: null,
  fixtureExists: () => false,
  isKnownSession: () => false,
}

function familyMeta(familyId: string): DocumentDiagnosticRuleMeta | null {
  return FAMILY_BY_ID.get(familyId) ?? null
}

/**
 * §12 — SHA-256 hex is CASE-INSENSITIVE. The manifest stores the digest in
 * uppercase while the generator's `readCurrentMainSha256()` emits lowercase
 * `digest('hex')`; normalising BOTH sides is what makes a real current-build
 * record validate instead of being mis-read as a SHA_MISMATCH / stale record.
 */
function normalizeSha256(value: string): string {
  return value.trim().toUpperCase()
}

// ── §12 — evidence validation ───────────────────────────────────────────────

/** §12 — validate every record against the CURRENT build (never trust it blindly). */
export function validateRuntimeEvidenceRecords(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticValidatedEvidence[] {
  const env = input.evidenceEnvironment ?? DEFAULT_EVIDENCE_ENVIRONMENT
  return (input.runtimeEvidence ?? []).map(record => {
    const fixtureValid = env.fixtureExists(record.fixture)
    const sessionValid = env.isKnownSession(record.sessionId)
    const buildAvailable = env.currentMainSha256 != null
    const shaValid =
      env.currentMainSha256 != null
      && normalizeSha256(record.mainSha256) === normalizeSha256(env.currentMainSha256)
    const staleBuild = !shaValid
    const invalidReasons: string[] = []
    if (!fixtureValid) invalidReasons.push('MISSING_FIXTURE')
    if (!sessionValid) invalidReasons.push('MISSING_SESSION')
    if (!buildAvailable) invalidReasons.push('BUILD_UNAVAILABLE')
    else if (!shaValid) invalidReasons.push('SHA_MISMATCH')
    return {
      record,
      fixtureValid,
      sessionValid,
      shaValid,
      staleBuild,
      valid: invalidReasons.length === 0,
      invalidReasons,
    }
  })
}

/** §12 — the FIRST valid record for a family (deterministic: sorted by sessionId). */
export function validEvidenceForFamily(
  familyId: string,
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticValidatedEvidence | null {
  const candidates = validateRuntimeEvidenceRecords(input)
    .filter(v => v.valid && v.record.familyId === familyId)
    .sort((a, b) => {
      const ak = `${a.record.sessionId}\u0000${a.record.buildId}\u0000${a.record.fixture}`
      const bk = `${b.record.sessionId}\u0000${b.record.buildId}\u0000${b.record.fixture}`
      return ak < bk ? -1 : ak > bk ? 1 : 0
    })
  return candidates[0] ?? null
}

// ── §11 — required dimensions + per-dimension evaluation ────────────────────

/**
 * §11 — the DECLARED, explicit required-dimension set per family kind.
 *
 * A `STATE_GUARD` (a document-level validation notice) has NO interactive
 * target, so it legitimately requires FEWER dimensions — this is declared here,
 * never silently dropped.
 */
export function requiredClosureDimensionsOf(familyId: string): readonly DocumentDiagnosticClosureDimension[] {
  const meta = familyMeta(familyId)
  if (!meta) return []
  if (meta.implementationStatus !== 'IMPLEMENTED') return []
  if (meta.diagnosticKind === 'STATE_GUARD') {
    return ['producerPass', 'severityPass', 'locationPass', 'runtimePositiveEvidencePass', 'runtimeNegativeGatePass']
  }
  const required = new Set<DocumentDiagnosticClosureDimension>([
    'producerPass',
    'severityPass',
    'stableIdentityPass',
    'locationPass',
    'activeVisualPass',
    'firstClickPass',
    'deactivatePass',
    'targetedTestPass',
    'integrationTestPass',
    'runtimePositiveEvidencePass',
    'runtimeNegativeGatePass',
  ])
  if (meta.suppressionAuthority != null) required.add('suppressionPass')
  if (meta.dynamicRefreshAuthority != null) required.add('dynamicRefreshPass')
  if (meta.interactionMode === 'ORDINARY_MULTI_TARGET' || meta.interactionMode === 'TARGET_GROUP') required.add('activeSwitchPass')
  if (meta.userVisible) required.add('crossDocumentCleanupPass')
  return DOCUMENT_DIAGNOSTIC_CLOSURE_DIMENSIONS.filter(dim => required.has(dim))
}

/** §11 — compute ALL 15 dimensions for ONE family. */
export function computeClosureDimensions(
  meta: DocumentDiagnosticRuleMeta,
  input: DocumentDiagnosticClosureAuthorityInput = {},
  validEvidence: DocumentDiagnosticValidatedEvidence | null,
): DocumentDiagnosticClosureDimensions {
  const manifest = input.staticTestManifest ?? EMPTY_DOCUMENT_DIAGNOSTIC_STATIC_TEST_MANIFEST
  const flags = validEvidence?.record.evidence ?? null
  return {
    producerPass:
      meta.implementationStatus === 'IMPLEMENTED'
      && meta.producerAuthority !== 'NONE'
      && PRODUCED_FAMILY_IDS.has(meta.familyId),
    severityPass: meta.presentationSeverity === resolvePresentationSeverity(meta.internalSeverity),
    stableIdentityPass: meta.stableIdentityAuthority.trim() !== '' && meta.stableIdentityAuthority !== 'NONE',
    suppressionPass: meta.implementationStatus === 'IMPLEMENTED' && meta.suppressionAuthority != null,
    dynamicRefreshPass: flags != null && flags.dynamicRefresh === true,
    locationPass: meta.locationStrategy.trim() !== '',
    activeVisualPass: flags != null && flags.activeVisual === true,
    firstClickPass: flags != null && flags.firstClick === true,
    deactivatePass: flags != null && flags.deactivate === true,
    activeSwitchPass: flags != null && flags.firstClick === true && flags.deactivate === true,
    crossDocumentCleanupPass: flags != null && flags.crossDocumentCleanup === true,
    targetedTestPass: manifest.targetedTestFamilyIds.has(meta.familyId),
    integrationTestPass: manifest.integrationTestFamilyIds.has(meta.familyId),
    runtimePositiveEvidencePass: flags != null && flags.producer === true,
    runtimeNegativeGatePass: validEvidence != null,
  }
}

/**
 * §11 — derive the closure status. `IMPLEMENTED` never implies `CLOSED`.
 *   DEFERRED   — only for `DEFERRED_BY_SPEC`.
 *   UNVERIFIED — implemented but no VALID current-build runtime evidence.
 *   PARTIAL    — evidence present, but a required dimension is not closed.
 *   CLOSED     — ALL required dimensions pass.
 */
export function deriveRuntimeClosureStatus(
  meta: DocumentDiagnosticRuleMeta,
  dimensions: DocumentDiagnosticClosureDimensions,
  required: readonly DocumentDiagnosticClosureDimension[],
  hasValidEvidence: boolean,
): DocumentDiagnosticRuntimeClosureStatus {
  if (meta.implementationStatus === 'DEFERRED_BY_SPEC') return 'DEFERRED'
  if (meta.implementationStatus !== 'IMPLEMENTED') return 'UNVERIFIED'
  if (!hasValidEvidence) return 'UNVERIFIED'
  return required.every(dim => dimensions[dim]) ? 'CLOSED' : 'PARTIAL'
}

// ── §20 — per-family runtime closure audit ──────────────────────────────────

/** §20 — ONE family's runtime closure audit record. */
export function resolveDocumentDiagnosticRuntimeClosureAudit(
  familyId: string,
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticRuntimeClosureAuditRecord | null {
  const meta = familyMeta(familyId)
  if (!meta) return null
  const validEvidence = validEvidenceForFamily(familyId, input)
  const dimensions = computeClosureDimensions(meta, input, validEvidence)
  const requiredDimensions = requiredClosureDimensionsOf(familyId)
  const runtimeClosureStatus = deriveRuntimeClosureStatus(meta, dimensions, requiredDimensions, validEvidence != null)
  const failing = requiredDimensions.filter(dim => !dimensions[dim])
  const reason = runtimeClosureStatus === 'CLOSED'
    ? 'ALL_REQUIRED_DIMENSIONS_PASS'
    : runtimeClosureStatus === 'DEFERRED'
      ? 'DEFERRED_BY_SPEC'
      : runtimeClosureStatus === 'UNVERIFIED'
        ? (meta.implementationStatus === 'IMPLEMENTED' ? 'NO_VALID_CURRENT_BUILD_RUNTIME_EVIDENCE' : 'NOT_IMPLEMENTED')
        : `REQUIRED_DIMENSION_PENDING:${failing.join(',')}`
  return {
    familyId,
    runtimeCodes: resolvedRuntimeCodesOf(meta),
    implementationStatus: meta.implementationStatus,
    runtimeClosureStatus,
    dimensions,
    requiredDimensions,
    evidenceFixture: validEvidence?.record.fixture ?? null,
    evidenceSessionId: validEvidence?.record.sessionId ?? null,
    evidenceBuildId: validEvidence?.record.buildId ?? null,
    evidenceMainSha256: validEvidence?.record.mainSha256 ?? null,
    decision: runtimeClosureStatus === 'CLOSED' ? 'PASS' : 'FAIL',
    reason,
  }
}

/** §20 — every family's audit record (sorted by familyId). */
export function resolveDocumentDiagnosticRuntimeClosureAudits(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticRuntimeClosureAuditRecord[] {
  return [...FAMILIES]
    .map(meta => meta.familyId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(familyId => resolveDocumentDiagnosticRuntimeClosureAudit(familyId, input))
    .filter((r): r is DocumentDiagnosticRuntimeClosureAuditRecord => r != null)
}

/** §20 — the runtime closure audit rendered as deterministic log lines. */
export function formatDocumentDiagnosticRuntimeClosureAudit(
  record: DocumentDiagnosticRuntimeClosureAuditRecord,
): string[] {
  const dims = DOCUMENT_DIAGNOSTIC_CLOSURE_DIMENSIONS
    .map(dim => `${dim}=${record.dimensions[dim] ? 'PASS' : 'OPEN'}`)
  return [
    `DOCUMENT-DIAGNOSTIC-RUNTIME-CLOSURE-AUDIT ${record.familyId}`,
    `runtimeCodes=${record.runtimeCodes.join(',')}`,
    `implementationStatus=${record.implementationStatus}`,
    `runtimeClosureStatus=${record.runtimeClosureStatus}`,
    `requiredDimensions=${record.requiredDimensions.join(',') || 'NONE'}`,
    ...dims,
    `evidenceFixture=${record.evidenceFixture ?? 'NONE'}`,
    `evidenceSessionId=${record.evidenceSessionId ?? 'NONE'}`,
    `evidenceBuildId=${record.evidenceBuildId ?? 'NONE'}`,
    `evidenceMainSha256=${record.evidenceMainSha256 ?? 'NONE'}`,
    `decision=${record.decision} reason=${record.reason}`,
  ]
}

// ── §22 — hard gates ────────────────────────────────────────────────────────

/** §22 — the runtime closure hard gates (all must be 0). */
export function computeRuntimeClosureGates(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticRuntimeClosureGates {
  const audits = resolveDocumentDiagnosticRuntimeClosureAudits(input)
  const validated = validateRuntimeEvidenceRecords(input)
  const closed = audits.filter(a => a.runtimeClosureStatus === 'CLOSED')
  const staleByFamily = new Map<string, boolean>()
  const shaMismatchByFamily = new Map<string, boolean>()
  const currentSha = input.evidenceEnvironment?.currentMainSha256 ?? null
  for (const v of validated) {
    if (v.staleBuild) staleByFamily.set(v.record.familyId, true)
    if (!v.shaValid && (currentSha == null || normalizeSha256(v.record.mainSha256) !== normalizeSha256(currentSha))) {
      shaMismatchByFamily.set(v.record.familyId, true)
    }
  }
  return {
    UNRESOLVED_DYNAMIC_RUNTIME_CODE_COUNT: countUnresolvedDynamicRuntimeCodes(),
    RUNTIME_CLOSED_WITH_STALE_BUILD_EVIDENCE_COUNT: closed.filter(a => staleByFamily.has(a.familyId)).length,
    RUNTIME_CLOSED_WITH_SHA_MISMATCH_COUNT: closed.filter(a => shaMismatchByFamily.has(a.familyId)).length,
    RUNTIME_CLOSURE_EVIDENCE_MISSING_FIXTURE_COUNT: validated.filter(v => !v.fixtureValid).length,
    RUNTIME_CLOSURE_EVIDENCE_MISSING_SESSION_COUNT: validated.filter(v => !v.sessionValid).length,
    RUNTIME_CLOSED_WITHOUT_POSITIVE_EVIDENCE_COUNT: closed.filter(a => !a.dimensions.runtimePositiveEvidencePass).length,
    RUNTIME_CLOSED_WITHOUT_FIRST_CLICK_COUNT: closed.filter(a => !a.dimensions.firstClickPass).length,
    RUNTIME_CLOSED_WITHOUT_ACTIVE_VISUAL_COUNT: closed.filter(a => !a.dimensions.activeVisualPass).length,
    RUNTIME_CLOSED_WITHOUT_DEACTIVATE_COUNT: closed.filter(a => !a.dimensions.deactivatePass).length,
    RUNTIME_CLOSED_WITH_DYNAMIC_REFRESH_PENDING_COUNT: closed.filter(a => !a.dimensions.dynamicRefreshPass).length,
    RUNTIME_CLOSED_WITH_CROSS_DOCUMENT_CLEANUP_PENDING_COUNT: closed.filter(a => !a.dimensions.crossDocumentCleanupPass).length,
  }
}

// ── §21 — metadata / count hard gates ───────────────────────────────────────

/** §21 — the metadata / count hard gates (all must be 0). */
export function computeDocumentDiagnosticMetadataGates(): DocumentDiagnosticMetadataGates {
  const producedFamilyIds = new Set(
    PRODUCED_DIAGNOSTIC_CODES.map(code => getRuleMeta(code)?.familyId).filter((id): id is string => id != null),
  )
  const seenFamilyIds = new Set<string>()
  let duplicateFamilyCount = 0
  const codeAuthorities = new Map<string, Set<string>>()
  const prefixes: Array<{ prefix: string; familyId: string }> = []
  let unknownPresentationSeverityCount = 0
  let userVisibleInfoSeverityCount = 0
  let implementedWithoutProducerCount = 0
  let stateGuardMissing = 0
  let contentMissing = 0
  let registeredFamilyCount = 0
  let resolvedCodeCount = 0
  let implementedFamilyCount = 0
  let deferredFamilyCount = 0
  for (const meta of FAMILIES) {
    registeredFamilyCount++
    if (seenFamilyIds.has(meta.familyId)) duplicateFamilyCount++
    else seenFamilyIds.add(meta.familyId)
    if (meta.implementationStatus === 'IMPLEMENTED') {
      implementedFamilyCount++
      if (meta.producerAuthority.trim() === '' || meta.producerAuthority === 'NONE' || !producedFamilyIds.has(meta.familyId)) {
        implementedWithoutProducerCount++
      }
    } else if (meta.implementationStatus === 'DEFERRED_BY_SPEC') {
      deferredFamilyCount++
    }
    if (meta.presentationSeverity === 'error' || meta.presentationSeverity === 'warning' || meta.presentationSeverity === 'hint') {
      // known
    } else {
      unknownPresentationSeverityCount++
    }
    if (meta.userVisible && meta.internalSeverity === 'info' && meta.presentationSeverity !== 'hint') {
      userVisibleInfoSeverityCount++
    }
    const policy = meta.runtimeCodePolicy
    if (policy.kind === 'EXACT') {
      const set = codeAuthorities.get(policy.code) ?? new Set<string>()
      set.add(meta.familyId)
      codeAuthorities.set(policy.code, set)
    } else if (policy.kind === 'PATTERN') {
      for (const code of policy.codes) {
        const set = codeAuthorities.get(code) ?? new Set<string>()
        set.add(meta.familyId)
        codeAuthorities.set(code, set)
      }
    } else {
      prefixes.push({ prefix: policy.prefix, familyId: meta.familyId })
    }
    for (const code of resolvedRuntimeCodesOf(meta)) {
      resolvedCodeCount++
      const kind = resolveDiagnosticKind(code)
      if (kind === 'STATE_GUARD') {
        // classification present
      } else if (kind === 'CONTENT_DIAGNOSTIC') {
        // classification present
      } else {
        contentMissing++
      }
    }
  }
  // §0.3 — the 5 declared STATE_GUARD codes MUST classify as STATE_GUARD.
  for (const code of [
    'DOCUMENT_INACTIVE',
    'DOCUMENT_EMPTY',
    'DOCUMENT_SOURCE_UNAVAILABLE',
    'STRICT_FIRST_H1_DOCUMENT_EMPTY',
    'STRICT_FIRST_H1_SOURCE_UNAVAILABLE',
  ]) {
    if (resolveDiagnosticKind(code) !== 'STATE_GUARD') stateGuardMissing++
  }
  let duplicateRuntimeCodeAuthorityCount = 0
  for (const [code, authorities] of codeAuthorities) {
    const foreignPrefix = prefixes.some(p => code.startsWith(p.prefix) && !authorities.has(p.familyId))
    if (authorities.size > 1 || foreignPrefix) duplicateRuntimeCodeAuthorityCount++
  }
  const unregisteredRuntimeCodeCount = PRODUCED_DIAGNOSTIC_CODES.filter(code => getRuleMeta(code) == null).length
  let stateGuardCodeCount = 0
  let contentDiagnosticCodeCount = 0
  for (const meta of FAMILIES) {
    for (const code of resolvedRuntimeCodesOf(meta)) {
      if (resolveDiagnosticKind(code) === 'STATE_GUARD') stateGuardCodeCount++
      else contentDiagnosticCodeCount++
    }
  }
  const countMismatch =
    registeredFamilyCount !== DOCUMENT_DIAGNOSTIC_BASELINE.registeredRuleFamilyCount
    || resolvedCodeCount !== DOCUMENT_DIAGNOSTIC_BASELINE.resolvedDiagnosticCodeCount
    || implementedFamilyCount !== DOCUMENT_DIAGNOSTIC_BASELINE.implementedFamilyCount
    || deferredFamilyCount !== DOCUMENT_DIAGNOSTIC_BASELINE.deferredFamilyCount
    || implementedFamilyCount + deferredFamilyCount !== registeredFamilyCount
    || stateGuardCodeCount !== DOCUMENT_DIAGNOSTIC_BASELINE.stateGuardCodeCount
    || contentDiagnosticCodeCount !== DOCUMENT_DIAGNOSTIC_BASELINE.contentDiagnosticCodeCount
    || stateGuardCodeCount + contentDiagnosticCodeCount !== resolvedCodeCount
  return {
    DIAGNOSTIC_RULE_COUNT_AUTHORITY_MISMATCH_COUNT: countMismatch ? 1 : 0,
    // Single-registry invariant: this module reads ONLY
    // `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`; the capability test asserts no second
    // registry export exists.
    DUPLICATE_RULE_METADATA_AUTHORITY_COUNT: 0,
    DUPLICATE_RULE_FAMILY_ID_COUNT: duplicateFamilyCount,
    DUPLICATE_RUNTIME_CODE_AUTHORITY_COUNT: duplicateRuntimeCodeAuthorityCount,
    UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT: unregisteredRuntimeCodeCount,
    REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT: implementedWithoutProducerCount,
    USER_VISIBLE_INFO_SEVERITY_COUNT: userVisibleInfoSeverityCount,
    UNKNOWN_PRESENTATION_SEVERITY_COUNT: unknownPresentationSeverityCount,
    STATE_GUARD_CLASSIFICATION_MISSING_COUNT: stateGuardMissing,
    CONTENT_DIAGNOSTIC_CLASSIFICATION_MISSING_COUNT: contentMissing,
  }
}

// ── §19 — capability audit ──────────────────────────────────────────────────

/** §19 — the ONE capability audit (derived from the registry + closure authority). */
export function resolveDocumentDiagnosticsCapabilityAudit(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticsCapabilityAudit {
  const audits = resolveDocumentDiagnosticRuntimeClosureAudits(input)
  const counts = countFamiliesAndCodes()
  const validated = validateRuntimeEvidenceRecords(input)
  const currentSha = input.evidenceEnvironment?.currentMainSha256 ?? null
  const metadataGates = computeDocumentDiagnosticMetadataGates()
  const runtimeGates = computeRuntimeClosureGates(input)

  let closedFamilyCount = 0
  let partialFamilyCount = 0
  let unverifiedFamilyCount = 0
  let deferredClosureFamilyCount = 0
  for (const a of audits) {
    if (a.runtimeClosureStatus === 'CLOSED') closedFamilyCount++
    else if (a.runtimeClosureStatus === 'PARTIAL') partialFamilyCount++
    else if (a.runtimeClosureStatus === 'UNVERIFIED') unverifiedFamilyCount++
    else deferredClosureFamilyCount++
  }
  const unknownSeverityCount = metadataGates.UNKNOWN_PRESENTATION_SEVERITY_COUNT
  const staleRuntimeEvidenceCount = validated.filter(v => v.staleBuild).length
  const runtimeEvidenceShaMismatchCount = validated.filter(
    v => currentSha != null && normalizeSha256(v.record.mainSha256) !== normalizeSha256(currentSha),
  ).length

  const failing: string[] = []
  const push = (name: string, value: number): void => { if (value !== 0) failing.push(`${name}=${value}`) }
  for (const [name, value] of Object.entries(metadataGates)) push(name, value)
  for (const [name, value] of Object.entries(runtimeGates)) push(name, value)
  if (closedFamilyCount + partialFamilyCount + unverifiedFamilyCount + deferredClosureFamilyCount !== counts.registeredRuleFamilyCount) {
    failing.push('RUNTIME_CLOSURE_COUNT_MISMATCH=1')
  }

  return {
    registeredRuleFamilyCount: counts.registeredRuleFamilyCount,
    resolvedDiagnosticCodeCount: counts.resolvedDiagnosticCodeCount,
    userVisibleDiagnosticTypeCount: counts.userVisibleDiagnosticTypeCount,
    implementedFamilyCount: counts.implementedFamilyCount,
    deferredFamilyCount: counts.deferredFamilyCount,
    stateGuardCodeCount: counts.stateGuardCodeCount,
    contentDiagnosticCodeCount: counts.contentDiagnosticCodeCount,
    closedFamilyCount,
    partialFamilyCount,
    unverifiedFamilyCount,
    deferredClosureFamilyCount,
    unregisteredRuntimeCodeCount: metadataGates.UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT,
    implementedWithoutProducerCount: metadataGates.REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT,
    duplicateFamilyCount: metadataGates.DUPLICATE_RULE_FAMILY_ID_COUNT,
    unknownSeverityCount,
    staleRuntimeEvidenceCount,
    runtimeEvidenceShaMismatchCount,
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    reason: failing.length === 0
      ? 'CAPABILITY_AND_RUNTIME_CLOSURE_GATES_OK'
      : failing.join(','),
  }
}

/** §5/§31 — the family / code counts (single source for every consumer). */
export function countFamiliesAndCodes(): {
  registeredRuleFamilyCount: number
  resolvedDiagnosticCodeCount: number
  userVisibleDiagnosticTypeCount: number
  implementedFamilyCount: number
  deferredFamilyCount: number
  plannedFamilyCount: number
  stateGuardCodeCount: number
  contentDiagnosticCodeCount: number
} {
  let resolvedDiagnosticCodeCount = 0
  let userVisibleDiagnosticTypeCount = 0
  let implementedFamilyCount = 0
  let deferredFamilyCount = 0
  let plannedFamilyCount = 0
  let stateGuardCodeCount = 0
  let contentDiagnosticCodeCount = 0
  for (const meta of FAMILIES) {
    if (meta.userVisible) userVisibleDiagnosticTypeCount++
    if (meta.implementationStatus === 'IMPLEMENTED') implementedFamilyCount++
    else if (meta.implementationStatus === 'DEFERRED_BY_SPEC') deferredFamilyCount++
    else plannedFamilyCount++
    for (const code of resolvedRuntimeCodesOf(meta)) {
      resolvedDiagnosticCodeCount++
      if (resolveDiagnosticKind(code) === 'STATE_GUARD') stateGuardCodeCount++
      else contentDiagnosticCodeCount++
    }
  }
  return {
    registeredRuleFamilyCount: FAMILIES.length,
    resolvedDiagnosticCodeCount,
    userVisibleDiagnosticTypeCount,
    implementedFamilyCount,
    deferredFamilyCount,
    plannedFamilyCount,
    stateGuardCodeCount,
    contentDiagnosticCodeCount,
  }
}

/**
 * §11 — the ONE Runtime Closure Authority surface. It is a plain object (no
 * module init cycle) exposing the pure computations the generator, the capability
 * summary and the runtime audits all consume.
 */
export const documentDiagnosticRuntimeClosureAuthority = {
  baseline: DOCUMENT_DIAGNOSTIC_BASELINE,
  dimensions: DOCUMENT_DIAGNOSTIC_CLOSURE_DIMENSIONS,
  validateEvidence: validateRuntimeEvidenceRecords,
  requiredDimensionsOf: requiredClosureDimensionsOf,
  dimensionsOf: computeClosureDimensions,
  deriveStatus: deriveRuntimeClosureStatus,
  auditFamily: resolveDocumentDiagnosticRuntimeClosureAudit,
  auditAll: resolveDocumentDiagnosticRuntimeClosureAudits,
  formatAudit: formatDocumentDiagnosticRuntimeClosureAudit,
  gates: computeRuntimeClosureGates,
  metadataGates: computeDocumentDiagnosticMetadataGates,
  capabilityAudit: resolveDocumentDiagnosticsCapabilityAudit,
} as const

export type DocumentDiagnosticRuntimeClosureAuthority = typeof documentDiagnosticRuntimeClosureAuthority
