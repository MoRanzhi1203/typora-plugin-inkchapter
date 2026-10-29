/**
 * Capability Matrix V2 §5/§9/§10/§31 — the READ-ONLY count / matrix authority.
 *
 * DERIVED, never authoritative: every fact comes from the ONE registry in
 * `document-diagnostic-location.ts` plus the Runtime Closure Authority. It
 * answers, deterministically:
 *
 *   - family vs runtime-code vs user-visible-type counts (§5, kept SEPARATE);
 *   - STATE_GUARD vs CONTENT_DIAGNOSTIC counts (incl. the STRICT_FIRST_H1 split);
 *   - implemented / deferred / planned coverage;
 *   - closed / partial / unverified / deferred closure coverage, DERIVED from
 *     `documentDiagnosticRuntimeClosureAuthority` (never hand-written).
 *
 * The user-visible Capability Matrix markdown is generated from
 * `formatDocumentDiagnosticCapabilityMatrixMarkdown()` (17 §9 columns + the §31
 * summary block) so the doc can never be hand-maintained and can never drift.
 */
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  resolveDocumentDiagnosticPresentationSeverity,
  resolvedRuntimeCodesOf,
  type DocumentDiagnosticCapabilityCategory,
  type DocumentDiagnosticImplementationStatus,
  type DocumentDiagnosticInteractionAuthorityMode,
  type DocumentDiagnosticKind,
  type DocumentDiagnosticPresentationSeverity,
  type DocumentDiagnosticRuleMeta,
  type DocumentDiagnosticRuntimeClosureStatus,
} from './document-diagnostic-location'
import {
  countFamiliesAndCodes,
  resolveDocumentDiagnosticRuntimeClosureAudit,
  resolveDocumentDiagnosticRuntimeClosureAudits,
  type DocumentDiagnosticClosureAuthorityInput,
} from './document-diagnostic-runtime-closure-authority'
import { EMPTY_DOCUMENT_DIAGNOSTIC_STATIC_TEST_MANIFEST } from './document-diagnostic-static-test-manifest'

// §6 — the Runtime Code Resolver lives in the registry module; re-exported here
// so existing consumers keep a single import site.
export { resolvedRuntimeCodesOf }

/** §14 — the ONE capability audit event, emitted once per diagnostics recompute. */
export const DOCUMENT_DIAGNOSTICS_CAPABILITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTICS-CAPABILITY-AUDIT'

/** §5 — the ONE capability summary. Family counts and code counts stay SEPARATE. */
export interface DocumentDiagnosticCapabilitySummary {
  registeredRuleFamilyCount: number
  resolvedDiagnosticCodeCount: number
  userVisibleDiagnosticTypeCount: number

  implementedFamilyCount: number
  deferredFamilyCount: number
  plannedFamilyCount: number

  stateGuardCodeCount: number
  contentDiagnosticCodeCount: number

  errorFamilyCount: number
  warningFamilyCount: number
  hintFamilyCount: number

  closedFamilyCount: number
  partialFamilyCount: number
  unverifiedFamilyCount: number
  deferredClosureFamilyCount: number
}

export interface DocumentDiagnosticCapabilityMatrixRow {
  familyId: string
  runtimeCode: string
  capabilityCategory: DocumentDiagnosticCapabilityCategory
  diagnosticKind: DocumentDiagnosticKind
  internalSeverity: 'error' | 'warning' | 'info'
  presentationSeverity: DocumentDiagnosticPresentationSeverity
  scope: string
  producerAuthority: string
  stableIdentityAuthority: string
  suppression: string
  dynamicRefresh: string
  locationKind: string
  presentationKind: string
  interactionMode: DocumentDiagnosticInteractionAuthorityMode
  staticTest: string
  runtimeEvidence: string
  closure: DocumentDiagnosticRuntimeClosureStatus
  implementationStatus: DocumentDiagnosticImplementationStatus
}

/** Deterministic family list (sorted by familyId). */
function collectFamilies(): DocumentDiagnosticRuleMeta[] {
  return Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
    .slice()
    .sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))
}

/** §4/§7 — the ONE presentation severity authority (re-exported contract name). */
export { resolveDocumentDiagnosticPresentationSeverity }

/** §7/§8 — the one suppression token for a family. */
function suppressionOf(meta: DocumentDiagnosticRuleMeta): string {
  return meta.suppressionAuthority ?? 'none'
}

export function resolveDocumentDiagnosticCapabilitySummary(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticCapabilitySummary {
  const counts = countFamiliesAndCodes()
  let errorFamilyCount = 0
  let warningFamilyCount = 0
  let hintFamilyCount = 0
  for (const meta of collectFamilies()) {
    if (meta.presentationSeverity === 'error') errorFamilyCount++
    else if (meta.presentationSeverity === 'warning') warningFamilyCount++
    else hintFamilyCount++
  }
  let closedFamilyCount = 0
  let partialFamilyCount = 0
  let unverifiedFamilyCount = 0
  let deferredClosureFamilyCount = 0
  for (const audit of resolveDocumentDiagnosticRuntimeClosureAudits(input)) {
    if (audit.runtimeClosureStatus === 'CLOSED') closedFamilyCount++
    else if (audit.runtimeClosureStatus === 'PARTIAL') partialFamilyCount++
    else if (audit.runtimeClosureStatus === 'UNVERIFIED') unverifiedFamilyCount++
    else deferredClosureFamilyCount++
  }
  return {
    registeredRuleFamilyCount: counts.registeredRuleFamilyCount,
    resolvedDiagnosticCodeCount: counts.resolvedDiagnosticCodeCount,
    userVisibleDiagnosticTypeCount: counts.userVisibleDiagnosticTypeCount,
    implementedFamilyCount: counts.implementedFamilyCount,
    deferredFamilyCount: counts.deferredFamilyCount,
    plannedFamilyCount: counts.plannedFamilyCount,
    stateGuardCodeCount: counts.stateGuardCodeCount,
    contentDiagnosticCodeCount: counts.contentDiagnosticCodeCount,
    errorFamilyCount,
    warningFamilyCount,
    hintFamilyCount,
    closedFamilyCount,
    partialFamilyCount,
    unverifiedFamilyCount,
    deferredClosureFamilyCount,
  }
}

/** §9 — the deterministic matrix rows (familyId asc, then runtime code asc). */
export function buildDocumentDiagnosticCapabilityMatrixRows(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): DocumentDiagnosticCapabilityMatrixRow[] {
  const manifest = input.staticTestManifest ?? EMPTY_DOCUMENT_DIAGNOSTIC_STATIC_TEST_MANIFEST
  const rows: DocumentDiagnosticCapabilityMatrixRow[] = []
  for (const meta of collectFamilies()) {
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(meta.familyId, input)
    const staticTest = manifest.integrationTestFamilyIds.has(meta.familyId)
      ? 'TARGETED+INTEGRATION'
      : manifest.targetedTestFamilyIds.has(meta.familyId) ? 'TARGETED' : 'NONE'
    const runtimeEvidence = audit?.evidenceFixture != null && audit.evidenceSessionId != null
      ? `${audit.evidenceFixture}#${audit.evidenceSessionId}`
      : 'NONE'
    for (const code of resolvedRuntimeCodesOf(meta)) {
      rows.push({
        familyId: meta.familyId,
        runtimeCode: code,
        capabilityCategory: meta.capabilityCategory,
        diagnosticKind: meta.diagnosticKind,
        internalSeverity: meta.internalSeverity,
        presentationSeverity: meta.presentationSeverity,
        scope: meta.scope,
        producerAuthority: meta.producerAuthority,
        stableIdentityAuthority: meta.stableIdentityAuthority,
        suppression: suppressionOf(meta),
        dynamicRefresh: meta.dynamicRefreshAuthority ?? 'none',
        locationKind: meta.locationStrategy,
        presentationKind: meta.presentationKind,
        interactionMode: meta.interactionMode,
        staticTest,
        runtimeEvidence,
        closure: audit?.runtimeClosureStatus ?? meta.runtimeClosureStatus,
        implementationStatus: meta.implementationStatus,
      })
    }
  }
  return rows
}

/** §9 — the 17 columns of the capability matrix. */
const MATRIX_COLUMNS = [
  'Family', 'Runtime Code', 'Kind', 'Category', 'Internal Severity', 'UI Severity', 'Scope',
  'Producer', 'Stable Identity', 'Suppression', 'Dynamic Refresh', 'Location', 'Presentation',
  'Interaction', 'Static Test', 'Runtime Evidence', 'Closure',
] as const

/**
 * §9/§31 — the deterministic Capability Matrix markdown. Running this twice
 * yields byte-identical output (no timestamps, no randomness): the generator
 * writes exactly this string.
 */
export function formatDocumentDiagnosticCapabilityMatrixMarkdown(
  input: DocumentDiagnosticClosureAuthorityInput = {},
): string {
  const summary = resolveDocumentDiagnosticCapabilitySummary(input)
  const rows = buildDocumentDiagnosticCapabilityMatrixRows(input)
  const lines: string[] = []
  lines.push('# Document Diagnostics Capability Matrix')
  lines.push('')
  lines.push('> AUTO-GENERATED by `scripts/document-diagnostics/generate-capability-matrix.mjs`.')
  lines.push('> Do NOT edit by hand — every fact derives from `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`')
  lines.push('> + the Runtime Code Resolver + the Static Test Manifest + the Runtime Evidence Manifest.')
  lines.push('')
  lines.push('## Capability Summary')
  lines.push('')
  lines.push('```text')
  lines.push(`${summary.registeredRuleFamilyCount} Registered Families`)
  lines.push(`${summary.resolvedDiagnosticCodeCount} Resolved Runtime Codes`)
  lines.push(`${summary.userVisibleDiagnosticTypeCount} User-visible Diagnostic Types`)
  lines.push('')
  lines.push(`${summary.implementedFamilyCount} Implemented Families`)
  lines.push(`${summary.deferredFamilyCount} Deferred Families`)
  lines.push('')
  lines.push(`${summary.closedFamilyCount} Runtime Closed`)
  lines.push(`${summary.partialFamilyCount} Runtime Partial`)
  lines.push(`${summary.unverifiedFamilyCount} Runtime Unverified`)
  lines.push(`${summary.deferredClosureFamilyCount} Deferred`)
  lines.push('')
  lines.push(`${summary.stateGuardCodeCount} State Guard Codes`)
  lines.push(`${summary.contentDiagnosticCodeCount} Content Diagnostic Codes`)
  lines.push('```')
  lines.push('')
  lines.push('## Machine-readable Summary')
  lines.push('')
  lines.push('```text')
  lines.push(`REGISTERED_RULE_FAMILY_COUNT=${summary.registeredRuleFamilyCount}`)
  lines.push(`RESOLVED_DIAGNOSTIC_CODE_COUNT=${summary.resolvedDiagnosticCodeCount}`)
  lines.push(`USER_VISIBLE_DIAGNOSTIC_TYPE_COUNT=${summary.userVisibleDiagnosticTypeCount}`)
  lines.push(`IMPLEMENTED_FAMILY_COUNT=${summary.implementedFamilyCount}`)
  lines.push(`DEFERRED_FAMILY_COUNT=${summary.deferredFamilyCount}`)
  lines.push(`PLANNED_FAMILY_COUNT=${summary.plannedFamilyCount}`)
  lines.push(`STATE_GUARD_CODE_COUNT=${summary.stateGuardCodeCount}`)
  lines.push(`CONTENT_DIAGNOSTIC_CODE_COUNT=${summary.contentDiagnosticCodeCount}`)
  lines.push(`ERROR_FAMILY_COUNT=${summary.errorFamilyCount}`)
  lines.push(`WARNING_FAMILY_COUNT=${summary.warningFamilyCount}`)
  lines.push(`HINT_FAMILY_COUNT=${summary.hintFamilyCount}`)
  lines.push(`CLOSED_FAMILY_COUNT=${summary.closedFamilyCount}`)
  lines.push(`PARTIAL_FAMILY_COUNT=${summary.partialFamilyCount}`)
  lines.push(`UNVERIFIED_FAMILY_COUNT=${summary.unverifiedFamilyCount}`)
  lines.push(`DEFERRED_CLOSURE_FAMILY_COUNT=${summary.deferredClosureFamilyCount}`)
  lines.push('```')
  lines.push('')
  lines.push(`| ${MATRIX_COLUMNS.join(' | ')} |`)
  lines.push(`| ${MATRIX_COLUMNS.map(() => '---').join(' | ')} |`)
  for (const r of rows) {
    lines.push(`| ${[
      r.familyId, r.runtimeCode, r.diagnosticKind, r.capabilityCategory,
      r.internalSeverity, r.presentationSeverity, r.scope, r.producerAuthority,
      r.stableIdentityAuthority, r.suppression, r.dynamicRefresh, r.locationKind,
      r.presentationKind, r.interactionMode, r.staticTest, r.runtimeEvidence, r.closure,
    ].join(' | ')} |`)
  }
  lines.push('')
  return lines.join('\n')
}
