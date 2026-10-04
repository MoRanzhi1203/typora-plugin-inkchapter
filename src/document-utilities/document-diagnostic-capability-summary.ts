/**
 * Capability Matrix V1 (Phase B/D/E) — the READ-ONLY count / matrix authority.
 *
 * This module is DERIVED, never authoritative: every fact comes from the ONE
 * registry in `document-diagnostic-location.ts`. It answers, deterministically:
 *
 *   - how many RULE FAMILIES vs RUNTIME CODES vs USER-VISIBLE TYPES exist;
 *   - STATE_GUARD vs CONTENT_DIAGNOSTIC counts (incl. the STRICT_FIRST_H1 split);
 *   - implemented / deferred / planned coverage;
 *   - Registry ↔ Producer consistency (unregistered codes / producer-less rules);
 *   - duplicate family-id / runtime-code authority collisions.
 *
 * The user-visible Capability Matrix markdown is generated from
 * `formatDocumentDiagnosticCapabilityMatrixMarkdown()` so the doc can never be
 * hand-maintained and can never drift.
 */
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  getRuleMeta,
  resolveDiagnosticKind,
  type DocumentDiagnosticCapabilityCategory,
  type DocumentDiagnosticImplementationStatus,
  type DocumentDiagnosticKind,
  type DocumentDiagnosticPresentationSeverity,
  type DocumentDiagnosticRuleMeta,
  type DocumentDiagnosticRuntimeClosureStatus,
} from './document-diagnostic-location'
// §6 — the producer allow-list (the gate is never vacuous).
import { PRODUCED_DIAGNOSTIC_CODES } from './document-diagnostics'

/** §14 — the ONE capability audit event, emitted once per diagnostics recompute. */
export const DOCUMENT_DIAGNOSTICS_CAPABILITY_AUDIT_EVENT = 'DOCUMENT-DIAGNOSTICS-CAPABILITY-AUDIT'

export interface DocumentDiagnosticCapabilitySummary {
  registeredRuleFamilyCount: number
  resolvedDiagnosticCodeCount: number
  userVisibleDiagnosticTypeCount: number
  stateGuardCount: number
  contentDiagnosticCount: number
  errorFamilyCount: number
  warningFamilyCount: number
  hintFamilyCount: number
  implementedCount: number
  deferredCount: number
  plannedCount: number
  unregisteredProducedCodeCount: number
  implementedWithoutProducerCount: number
  duplicateFamilyCount: number
  duplicateRuntimeCodeAuthorityCount: number
  decision: 'PASS' | 'FAIL'
  failing: string[]
}

export interface DocumentDiagnosticCapabilityMatrixRow {
  familyId: string
  runtimeCode: string
  capabilityCategory: DocumentDiagnosticCapabilityCategory
  diagnosticKind: DocumentDiagnosticKind
  internalSeverity: 'error' | 'warning' | 'info'
  presentationSeverity: DocumentDiagnosticPresentationSeverity
  scope: string
  locationKind: string
  presentationKind: string
  producerAuthority: string
  suppression: string
  runtimeClosureStatus: DocumentDiagnosticRuntimeClosureStatus
  testStatus: string
  implementationStatus: DocumentDiagnosticImplementationStatus
}

/** Deterministic family list (sorted by familyId). */
function collectFamilies(): DocumentDiagnosticRuleMeta[] {
  return Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)
    .slice()
    .sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))
}

/**
 * The RESOLVED runtime codes of a family. PREFIX families yield exactly ONE
 * sentinel (`<prefix>_*`) so `LEVEL_n` never inflates the family / code count.
 */
export function resolvedRuntimeCodesOf(meta: DocumentDiagnosticRuleMeta): string[] {
  const policy = meta.runtimeCodePolicy
  if (policy.kind === 'EXACT') return [policy.code]
  if (policy.kind === 'PATTERN') return [...policy.codes].sort()
  return [`${policy.prefix}_*`]
}

/** §2 — derive the matrix "Test Status" from the implementation / closure state. */
function testStatusOf(meta: DocumentDiagnosticRuleMeta): string {
  if (meta.implementationStatus === 'DEFERRED_BY_SPEC') return 'DEFERRED'
  if (meta.implementationStatus === 'PLANNED') return 'PLANNED'
  return meta.runtimeClosureStatus === 'UNVERIFIED' ? 'UNIT' : 'COVERED'
}

/** §7/§8 — the one suppression token for a family. */
function suppressionOf(meta: DocumentDiagnosticRuleMeta): string {
  if (meta.suppressionParentFamilyId) return `parent:${meta.suppressionParentFamilyId}`
  return meta.suppressionGroup ?? 'none'
}

export function resolveDocumentDiagnosticCapabilitySummary(): DocumentDiagnosticCapabilitySummary {
  const families = collectFamilies()

  let resolvedDiagnosticCodeCount = 0
  let stateGuardCount = 0
  let contentDiagnosticCount = 0
  let errorFamilyCount = 0
  let warningFamilyCount = 0
  let hintFamilyCount = 0
  let implementedCount = 0
  let deferredCount = 0
  let plannedCount = 0
  let userVisibleDiagnosticTypeCount = 0
  let unknownPresentationSeverityCount = 0
  let userVisibleInfoSeverityCount = 0

  const producedFamilyIds = new Set<string>()
  for (const code of PRODUCED_DIAGNOSTIC_CODES) {
    const meta = getRuleMeta(code)
    if (meta) producedFamilyIds.add(meta.familyId)
  }

  const codeAuthorities = new Map<string, Set<string>>()
  const prefixes: Array<{ prefix: string; familyId: string }> = []
  const recordCode = (code: string, familyId: string): void => {
    const set = codeAuthorities.get(code) ?? new Set<string>()
    set.add(familyId)
    codeAuthorities.set(code, set)
  }

  for (const meta of families) {
    resolvedDiagnosticCodeCount += resolvedRuntimeCodesOf(meta).length
    if (meta.userVisible) userVisibleDiagnosticTypeCount++
    if (meta.presentationSeverity === 'error') errorFamilyCount++
    else if (meta.presentationSeverity === 'warning') warningFamilyCount++
    else if (meta.presentationSeverity === 'hint') hintFamilyCount++
    else unknownPresentationSeverityCount++
    if (meta.userVisible && meta.internalSeverity === 'info' && meta.presentationSeverity !== 'hint') {
      userVisibleInfoSeverityCount++
    }
    if (meta.implementationStatus === 'IMPLEMENTED') implementedCount++
    else if (meta.implementationStatus === 'DEFERRED_BY_SPEC') deferredCount++
    else plannedCount++

    const policy = meta.runtimeCodePolicy
    if (policy.kind === 'EXACT') recordCode(policy.code, meta.familyId)
    else if (policy.kind === 'PATTERN') for (const code of policy.codes) recordCode(code, meta.familyId)
    else prefixes.push({ prefix: policy.prefix, familyId: meta.familyId })

    for (const code of resolvedRuntimeCodesOf(meta)) {
      if (resolveDiagnosticKind(code) === 'STATE_GUARD') stateGuardCount++
      else contentDiagnosticCount++
    }
  }

  let duplicateFamilyCount = 0
  const seenFamilyIds = new Set<string>()
  for (const meta of families) {
    if (seenFamilyIds.has(meta.familyId)) duplicateFamilyCount++
    else seenFamilyIds.add(meta.familyId)
  }

  let duplicateRuntimeCodeAuthorityCount = 0
  for (const [code, authorities] of codeAuthorities) {
    const foreignPrefix = prefixes.some(p => code.startsWith(p.prefix) && !authorities.has(p.familyId))
    if (authorities.size > 1 || foreignPrefix) duplicateRuntimeCodeAuthorityCount++
  }

  const unregisteredProducedCodeCount = PRODUCED_DIAGNOSTIC_CODES.filter(code => getRuleMeta(code) == null).length

  let implementedWithoutProducerCount = 0
  for (const meta of families) {
    if (meta.implementationStatus !== 'IMPLEMENTED') continue
    if (meta.producerAuthority.trim() === '' || meta.producerAuthority === 'NONE') {
      implementedWithoutProducerCount++
      continue
    }
    if (!producedFamilyIds.has(meta.familyId)) implementedWithoutProducerCount++
  }

  const failing: string[] = []
  if (unregisteredProducedCodeCount !== 0) failing.push(`UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT=${unregisteredProducedCodeCount}`)
  if (implementedWithoutProducerCount !== 0) failing.push(`REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT=${implementedWithoutProducerCount}`)
  if (duplicateFamilyCount !== 0) failing.push(`DUPLICATE_RULE_FAMILY_ID_COUNT=${duplicateFamilyCount}`)
  if (duplicateRuntimeCodeAuthorityCount !== 0) failing.push(`DUPLICATE_RUNTIME_CODE_AUTHORITY_COUNT=${duplicateRuntimeCodeAuthorityCount}`)
  if (unknownPresentationSeverityCount !== 0) failing.push(`UNKNOWN_PRESENTATION_SEVERITY_COUNT=${unknownPresentationSeverityCount}`)
  if (userVisibleInfoSeverityCount !== 0) failing.push(`USER_VISIBLE_INFO_SEVERITY_COUNT=${userVisibleInfoSeverityCount}`)

  return {
    registeredRuleFamilyCount: families.length,
    resolvedDiagnosticCodeCount,
    userVisibleDiagnosticTypeCount,
    stateGuardCount,
    contentDiagnosticCount,
    errorFamilyCount,
    warningFamilyCount,
    hintFamilyCount,
    implementedCount,
    deferredCount,
    plannedCount,
    unregisteredProducedCodeCount,
    implementedWithoutProducerCount,
    duplicateFamilyCount,
    duplicateRuntimeCodeAuthorityCount,
    decision: failing.length === 0 ? 'PASS' : 'FAIL',
    failing,
  }
}

/** §5 — the deterministic matrix rows (familyId asc, then runtime code asc). */
export function buildDocumentDiagnosticCapabilityMatrixRows(): DocumentDiagnosticCapabilityMatrixRow[] {
  const rows: DocumentDiagnosticCapabilityMatrixRow[] = []
  for (const meta of collectFamilies()) {
    for (const code of resolvedRuntimeCodesOf(meta)) {
      rows.push({
        familyId: meta.familyId,
        runtimeCode: code,
        capabilityCategory: meta.capabilityCategory,
        diagnosticKind: resolveDiagnosticKind(code),
        internalSeverity: meta.internalSeverity,
        presentationSeverity: meta.presentationSeverity,
        scope: meta.scope,
        locationKind: meta.locationStrategy,
        presentationKind: meta.presentationKind,
        producerAuthority: meta.producerAuthority,
        suppression: suppressionOf(meta),
        runtimeClosureStatus: meta.runtimeClosureStatus,
        testStatus: testStatusOf(meta),
        implementationStatus: meta.implementationStatus,
      })
    }
  }
  return rows
}

/**
 * §5/§14 — the deterministic Capability Matrix markdown. Running this twice
 * yields byte-identical output (no timestamps, no randomness): the generator
 * writes exactly this string.
 */
export function formatDocumentDiagnosticCapabilityMatrixMarkdown(): string {
  const summary = resolveDocumentDiagnosticCapabilitySummary()
  const rows = buildDocumentDiagnosticCapabilityMatrixRows()
  const columns = [
    'Family', 'Runtime Code', 'Category', 'Kind', 'Internal Severity', 'UI Severity',
    'Scope', 'Location Kind', 'Presentation Kind', 'Producer', 'Suppression',
    'Runtime Closure', 'Test Status', 'Implementation',
  ]
  const lines: string[] = []
  lines.push('# Document Diagnostics Capability Matrix')
  lines.push('')
  lines.push('> AUTO-GENERATED by `scripts/document-diagnostics/generate-capability-matrix.mjs`.')
  lines.push('> Do NOT edit by hand — every fact derives from `DOCUMENT_DIAGNOSTIC_RULE_REGISTRY`.')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('```text')
  lines.push(`REGISTERED_RULE_FAMILY_COUNT=${summary.registeredRuleFamilyCount}`)
  lines.push(`RESOLVED_DIAGNOSTIC_CODE_COUNT=${summary.resolvedDiagnosticCodeCount}`)
  lines.push(`USER_VISIBLE_DIAGNOSTIC_TYPE_COUNT=${summary.userVisibleDiagnosticTypeCount}`)
  lines.push(`STATE_GUARD_COUNT=${summary.stateGuardCount}`)
  lines.push(`CONTENT_DIAGNOSTIC_COUNT=${summary.contentDiagnosticCount}`)
  lines.push(`IMPLEMENTED_COUNT=${summary.implementedCount}`)
  lines.push(`DEFERRED_COUNT=${summary.deferredCount}`)
  lines.push(`PLANNED_COUNT=${summary.plannedCount}`)
  lines.push(`ERROR_FAMILY_COUNT=${summary.errorFamilyCount}`)
  lines.push(`WARNING_FAMILY_COUNT=${summary.warningFamilyCount}`)
  lines.push(`HINT_FAMILY_COUNT=${summary.hintFamilyCount}`)
  lines.push(`DECISION=${summary.decision}`)
  lines.push('```')
  lines.push('')
  lines.push(`| ${columns.join(' | ')} |`)
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`)
  for (const r of rows) {
    lines.push(`| ${[
      r.familyId, r.runtimeCode, r.capabilityCategory, r.diagnosticKind,
      r.internalSeverity, r.presentationSeverity, r.scope, r.locationKind,
      r.presentationKind, r.producerAuthority, r.suppression,
      r.runtimeClosureStatus, r.testStatus, r.implementationStatus,
    ].join(' | ')} |`)
  }
  lines.push('')
  return lines.join('\n')
}
