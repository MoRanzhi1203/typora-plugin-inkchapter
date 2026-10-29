/**
 * Capability Matrix V2 §21/§22/§31 — the HARD GATES suite.
 *
 * Proves the §21 metadata/count gates, the §22 runtime closure gates, the §31
 * summary identity, the single-registry authority, the Runtime Code Resolver
 * (STRICT_FIRST_H1 PATTERN + LATENT ATX PREFIX), the Static Test Manifest
 * derivation, and — crucially — that a fabricated / stale / SHA-mismatched
 * runtime evidence record can NEVER yield `CLOSED`.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOCUMENT_DIAGNOSTIC_DYNAMIC_RUNTIME_CODES,
  DOCUMENT_DIAGNOSTIC_LATENT_ATX_CODE_PREFIX,
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  DOCUMENT_DIAGNOSTIC_STATE_GUARD_CODES,
  DOCUMENT_DIAGNOSTIC_STRICT_FIRST_H1_CODES,
  countUnresolvedDynamicRuntimeCodes,
  resolveDiagnosticKind,
  resolveDocumentDiagnosticPresentationSeverity,
  resolveRuntimeCodeFamilyId,
} from './document-diagnostic-location'
import {
  DOCUMENT_DIAGNOSTIC_BASELINE,
  computeDocumentDiagnosticMetadataGates,
  computeRuntimeClosureGates,
  documentDiagnosticRuntimeClosureAuthority,
  resolveDocumentDiagnosticRuntimeClosureAudit,
  resolveDocumentDiagnosticsCapabilityAudit,
  type DocumentDiagnosticClosureAuthorityInput,
  type DocumentDiagnosticRuntimeEvidenceEnvironment,
  type DocumentDiagnosticRuntimeEvidenceRecord,
} from './document-diagnostic-runtime-closure-authority'
import { buildDocumentDiagnosticStaticTestManifest } from './document-diagnostic-static-test-manifest'
import {
  buildDocumentDiagnosticCapabilityMatrixRows,
  formatDocumentDiagnosticCapabilityMatrixMarkdown,
  resolveDocumentDiagnosticCapabilitySummary,
} from './document-diagnostic-capability-summary'

const DEFAULT_INPUT: DocumentDiagnosticClosureAuthorityInput = {}

// ── §21 — single registry authority ─────────────────────────────────────────

describe('Capability Matrix V2 §21 — single registry authority', () => {
  it('there is exactly ONE registry and it has the frozen 77 families', () => {
    expect(Object.keys(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)).toHaveLength(77)
    const gates = computeDocumentDiagnosticMetadataGates()
    expect(gates.DUPLICATE_RULE_METADATA_AUTHORITY_COUNT).toBe(0)
    expect(gates.DUPLICATE_RULE_FAMILY_ID_COUNT).toBe(0)
    expect(gates.DUPLICATE_RUNTIME_CODE_AUTHORITY_COUNT).toBe(0)
  })

  it('registry ↔ producer: every produced code resolves to a registered family', () => {
    expect(computeDocumentDiagnosticMetadataGates().UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT).toBe(0)
    expect(computeDocumentDiagnosticMetadataGates().REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT).toBe(0)
  })
})

// ── §21 — count authority (family layer vs code layer) ──────────────────────

describe('Capability Matrix V2 §21 — count authority', () => {
  it('family layer: 72 + 5 = 77; code layer: 5 + 78 = 83', () => {
    const s = resolveDocumentDiagnosticCapabilitySummary()
    expect(s.implementedFamilyCount).toBe(72)
    expect(s.deferredFamilyCount).toBe(5)
    expect(s.plannedFamilyCount).toBe(0)
    expect(s.implementedFamilyCount + s.deferredFamilyCount).toBe(77)
    expect(s.registeredRuleFamilyCount).toBe(77)

    expect(s.stateGuardCodeCount).toBe(5)
    expect(s.contentDiagnosticCodeCount).toBe(78)
    expect(s.stateGuardCodeCount + s.contentDiagnosticCodeCount).toBe(83)
    expect(s.resolvedDiagnosticCodeCount).toBe(83)
    expect(s.userVisibleDiagnosticTypeCount).toBe(72)
    expect(computeDocumentDiagnosticMetadataGates().DIAGNOSTIC_RULE_COUNT_AUTHORITY_MISMATCH_COUNT).toBe(0)
  })

  it('the frozen baseline constant matches the live registry', () => {
    const s = resolveDocumentDiagnosticCapabilitySummary()
    expect(s.registeredRuleFamilyCount).toBe(DOCUMENT_DIAGNOSTIC_BASELINE.registeredRuleFamilyCount)
    expect(s.resolvedDiagnosticCodeCount).toBe(DOCUMENT_DIAGNOSTIC_BASELINE.resolvedDiagnosticCodeCount)
    expect(s.userVisibleDiagnosticTypeCount).toBe(DOCUMENT_DIAGNOSTIC_BASELINE.userVisibleDiagnosticTypeCount)
    expect(s.implementedFamilyCount).toBe(DOCUMENT_DIAGNOSTIC_BASELINE.implementedFamilyCount)
    expect(s.deferredFamilyCount).toBe(DOCUMENT_DIAGNOSTIC_BASELINE.deferredFamilyCount)
  })
})

// ── §7 — info → hint ────────────────────────────────────────────────────────

describe('Capability Matrix V2 §7 — severity authority', () => {
  it('maps error→error, warning→warning, info→hint', () => {
    expect(resolveDocumentDiagnosticPresentationSeverity('error')).toBe('error')
    expect(resolveDocumentDiagnosticPresentationSeverity('warning')).toBe('warning')
    expect(resolveDocumentDiagnosticPresentationSeverity('info')).toBe('hint')
    const gates = computeDocumentDiagnosticMetadataGates()
    expect(gates.USER_VISIBLE_INFO_SEVERITY_COUNT).toBe(0)
    expect(gates.UNKNOWN_PRESENTATION_SEVERITY_COUNT).toBe(0)
  })
})

// ── §8 — guard / content classification (the EXACT 5 guard codes) ───────────

describe('Capability Matrix V2 §8 — STATE_GUARD vs CONTENT_DIAGNOSTIC', () => {
  it('classifies exactly the 5 declared STATE_GUARD codes as STATE_GUARD', () => {
    expect([...DOCUMENT_DIAGNOSTIC_STATE_GUARD_CODES].sort()).toEqual([
      'DOCUMENT_EMPTY',
      'DOCUMENT_INACTIVE',
      'DOCUMENT_SOURCE_UNAVAILABLE',
      'STRICT_FIRST_H1_DOCUMENT_EMPTY',
      'STRICT_FIRST_H1_SOURCE_UNAVAILABLE',
    ])
    for (const code of DOCUMENT_DIAGNOSTIC_STATE_GUARD_CODES) {
      expect(resolveDiagnosticKind(code), code).toBe('STATE_GUARD')
    }
    // The 5 LEADING_* STRICT_FIRST_H1 codes are CONTENT diagnostics.
    for (const code of DOCUMENT_DIAGNOSTIC_STRICT_FIRST_H1_CODES) {
      if (code === 'STRICT_FIRST_H1_DOCUMENT_EMPTY' || code === 'STRICT_FIRST_H1_SOURCE_UNAVAILABLE') continue
      expect(resolveDiagnosticKind(code), code).toBe('CONTENT_DIAGNOSTIC')
    }
    const gates = computeDocumentDiagnosticMetadataGates()
    expect(gates.STATE_GUARD_CLASSIFICATION_MISSING_COUNT).toBe(0)
    expect(gates.CONTENT_DIAGNOSTIC_CLASSIFICATION_MISSING_COUNT).toBe(0)
  })
})

// ── §6 — Runtime Code Resolver ──────────────────────────────────────────────

describe('Capability Matrix V2 §6 — Runtime Code Resolver', () => {
  it('STRICT_FIRST_H1 registers 7 PATTERN codes that all resolve to the family', () => {
    expect(DOCUMENT_DIAGNOSTIC_STRICT_FIRST_H1_CODES).toHaveLength(7)
    for (const code of DOCUMENT_DIAGNOSTIC_STRICT_FIRST_H1_CODES) {
      expect(resolveRuntimeCodeFamilyId(code), code).toBe('STRICT_FIRST_H1')
    }
  })

  it('LATENT ATX is a PREFIX family: a LEVEL change never changes the family', () => {
    expect(resolveRuntimeCodeFamilyId(`${DOCUMENT_DIAGNOSTIC_LATENT_ATX_CODE_PREFIX}_LEVEL_2`)).toBe('LATENT_ATX_HEADING_MARKER')
    expect(resolveRuntimeCodeFamilyId(`${DOCUMENT_DIAGNOSTIC_LATENT_ATX_CODE_PREFIX}_LEVEL_5`)).toBe('LATENT_ATX_HEADING_MARKER')
    // A level change is ONE family, never a new family.
    const familiesFromLevels = new Set(
      [1, 2, 3, 4, 5, 6].map(n => resolveRuntimeCodeFamilyId(`${DOCUMENT_DIAGNOSTIC_LATENT_ATX_CODE_PREFIX}_LEVEL_${n}`)),
    )
    expect(familiesFromLevels.size).toBe(1)
    // Solving the resolver over the whole registry yields the frozen 77 families.
    expect(new Set(Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY).map(m => m.familyId)).size).toBe(77)
  })

  it('UNRESOLVED_DYNAMIC_RUNTIME_CODE_COUNT is 0', () => {
    for (const code of DOCUMENT_DIAGNOSTIC_DYNAMIC_RUNTIME_CODES) {
      expect(resolveRuntimeCodeFamilyId(code), code).not.toBeNull()
    }
    expect(countUnresolvedDynamicRuntimeCodes()).toBe(0)
    expect(computeRuntimeClosureGates(DEFAULT_INPUT).UNRESOLVED_DYNAMIC_RUNTIME_CODE_COUNT).toBe(0)
  })
})

// ── §6 — Static Test Manifest (auto-derived from the repo) ──────────────────

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function collectTestSources(dir: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectTestSources(full))
    else if (name.endsWith('.test.ts')) {
      out.push({ path: path.relative(repoRoot(), full).replace(/\\/g, '/'), content: readFileSync(full, 'utf8') })
    }
  }
  return out
}

describe('Capability Matrix V2 §6 — Static Test Manifest', () => {
  const manifest = buildDocumentDiagnosticStaticTestManifest(collectTestSources(path.join(repoRoot(), 'src')))

  it('is derived automatically and is non-vacuous', () => {
    expect(manifest.targetedTestFamilyIds.size).toBeGreaterThan(0)
    expect(manifest.targetedTestFamilyIds.has('STRICT_FIRST_H1')).toBe(true)
    expect(manifest.targetedTestFamilyIds.has('SECTION_EMPTY')).toBe(true)
  })

  it('integration coverage is a SUBSET of targeted coverage', () => {
    for (const id of manifest.integrationTestFamilyIds) {
      expect(manifest.targetedTestFamilyIds.has(id), id).toBe(true)
    }
  })

  it('is deterministic (same input ⇒ same manifest)', () => {
    const a = buildDocumentDiagnosticStaticTestManifest(collectTestSources(path.join(repoRoot(), 'src')))
    expect([...a.targetedTestFamilyIds].sort()).toEqual([...manifest.targetedTestFamilyIds].sort())
  })
})

// ── §31 — XX + YY + ZZ + 4 = 63 ─────────────────────────────────────────────

describe('Capability Matrix V2 §31 — summary identity', () => {
  it('closed + partial + unverified + deferred == 77', () => {
    const s = resolveDocumentDiagnosticCapabilitySummary()
    expect(s.closedFamilyCount + s.partialFamilyCount + s.unverifiedFamilyCount + s.deferredClosureFamilyCount).toBe(77)
    expect(s.deferredClosureFamilyCount).toBe(5)
    // With NO runtime evidence nothing is CLOSED and every implemented family is
    // honestly UNVERIFIED.
    expect(s.closedFamilyCount).toBe(0)
    expect(s.unverifiedFamilyCount).toBe(72)
  })
})

// ── §10 — matrix determinism ────────────────────────────────────────────────

describe('Capability Matrix V2 §10 — deterministic generation', () => {
  it('the markdown is byte-identical across runs (empty and injected input)', () => {
    expect(formatDocumentDiagnosticCapabilityMatrixMarkdown(DEFAULT_INPUT)).toBe(
      formatDocumentDiagnosticCapabilityMatrixMarkdown(DEFAULT_INPUT),
    )
    const manifest = buildDocumentDiagnosticStaticTestManifest(collectTestSources(path.join(repoRoot(), 'src')))
    const input: DocumentDiagnosticClosureAuthorityInput = { staticTestManifest: manifest }
    expect(formatDocumentDiagnosticCapabilityMatrixMarkdown(input)).toBe(
      formatDocumentDiagnosticCapabilityMatrixMarkdown(input),
    )
  })

  it('rows stay sorted by familyId then runtime code', () => {
    const rows = buildDocumentDiagnosticCapabilityMatrixRows(DEFAULT_INPUT)
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const cur = rows[i]
      expect(`${prev.familyId}\u0000${prev.runtimeCode}` <= `${cur.familyId}\u0000${cur.runtimeCode}`).toBe(true)
    }
  })
})

// ── §22 — runtime closure gates: fabricated / stale evidence can NOT close ──

describe('Capability Matrix V2 §22 — runtime closure gates', () => {
  const FAMILY = 'BLOCKQUOTE_EMPTY'
  const FIXTURE = 'runtime/smoke/Document-Diagnostics-Link-Anchor-Test.md'
  const SESSION = 'session-2026-01-01'
  const SHA = 'A'.repeat(64)

  const manifest = buildDocumentDiagnosticStaticTestManifest(collectTestSources(path.join(repoRoot(), 'src')))

  function env(overrides: Partial<DocumentDiagnosticRuntimeEvidenceEnvironment> = {}): DocumentDiagnosticRuntimeEvidenceEnvironment {
    return {
      currentMainSha256: SHA,
      fixtureExists: (f) => f === FIXTURE,
      isKnownSession: (s) => s === SESSION,
      ...overrides,
    }
  }

  function record(overrides: Partial<DocumentDiagnosticRuntimeEvidenceRecord['evidence']> = {}): DocumentDiagnosticRuntimeEvidenceRecord {
    return {
      familyId: FAMILY,
      fixture: FIXTURE,
      sessionId: SESSION,
      buildId: 'build-1',
      mainSha256: SHA,
      evidence: {
        producer: true,
        firstClick: true,
        activeVisual: true,
        deactivate: true,
        dynamicRefresh: true,
        crossDocumentCleanup: true,
        ...overrides,
      },
    }
  }

  it('a fully valid record CAN reach CLOSED (the gate is not vacuous)', () => {
    // A synthetic manifest that marks the family targeted AND integration — the
    // authority logic must be able to reach CLOSED when EVERY required dimension
    // genuinely passes.
    const closedManifest = {
      targetedTestFamilyIds: new Set([FAMILY]),
      integrationTestFamilyIds: new Set([FAMILY]),
      matchedFilesByFamily: new Map([[FAMILY, ['synthetic.test.ts']]]),
    }
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: closedManifest,
      runtimeEvidence: [record()],
      evidenceEnvironment: env(),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.runtimeClosureStatus).toBe('CLOSED')
    const gates = computeRuntimeClosureGates(input)
    expect(gates.RUNTIME_CLOSED_WITH_STALE_BUILD_EVIDENCE_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITH_SHA_MISMATCH_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITHOUT_POSITIVE_EVIDENCE_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITHOUT_FIRST_CLICK_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITHOUT_ACTIVE_VISUAL_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITHOUT_DEACTIVATE_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITH_DYNAMIC_REFRESH_PENDING_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITH_CROSS_DOCUMENT_CLEANUP_PENDING_COUNT).toBe(0)
  })

  it('no evidence ⇒ UNVERIFIED (never CLOSED)', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = { staticTestManifest: manifest }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)?.runtimeClosureStatus).toBe('UNVERIFIED')
  })

  it('SHA-mismatched evidence is IGNORED ⇒ UNVERIFIED and counted', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: manifest,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ currentMainSha256: 'B'.repeat(64) }),
    }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)?.runtimeClosureStatus).toBe('UNVERIFIED')
    const gates = computeRuntimeClosureGates(input)
    expect(gates.RUNTIME_CLOSED_WITH_SHA_MISMATCH_COUNT).toBe(0)
    expect(gates.RUNTIME_CLOSED_WITH_STALE_BUILD_EVIDENCE_COUNT).toBe(0)
    expect(resolveDocumentDiagnosticsCapabilityAudit(input).runtimeEvidenceShaMismatchCount).toBe(1)
    expect(resolveDocumentDiagnosticsCapabilityAudit(input).staleRuntimeEvidenceCount).toBe(1)
  })

  it('unavailable build (dist absent) ⇒ stale ⇒ UNVERIFIED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: manifest,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ currentMainSha256: null }),
    }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(resolveDocumentDiagnosticsCapabilityAudit(input).staleRuntimeEvidenceCount).toBe(1)
  })

  it('missing fixture / unknown session are counted and ignored', () => {
    const missingFixture: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: manifest,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ fixtureExists: () => false }),
    }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, missingFixture)?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(computeRuntimeClosureGates(missingFixture).RUNTIME_CLOSURE_EVIDENCE_MISSING_FIXTURE_COUNT).toBe(1)

    const unknownSession: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: manifest,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ isKnownSession: () => false }),
    }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, unknownSession)?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(computeRuntimeClosureGates(unknownSession).RUNTIME_CLOSURE_EVIDENCE_MISSING_SESSION_COUNT).toBe(1)
  })

  it('valid evidence with a pending dimension ⇒ PARTIAL (not CLOSED)', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: manifest,
      runtimeEvidence: [record({ firstClick: false })],
      evidenceEnvironment: env(),
    }
    expect(resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)?.runtimeClosureStatus).toBe('PARTIAL')
    expect(computeRuntimeClosureGates(input).RUNTIME_CLOSED_WITHOUT_FIRST_CLICK_COUNT).toBe(0)
  })

  it('the authority surface and the audit agree on the gate counters', () => {
    const gates = computeRuntimeClosureGates(DEFAULT_INPUT)
    for (const value of Object.values(gates)) expect(value).toBe(0)
    expect(documentDiagnosticRuntimeClosureAuthority.gates(DEFAULT_INPUT)).toEqual(gates)
  })
})
