/**
 * Capability Matrix V2 §11/§12/§22 — Runtime Evidence → Closure Dimension
 * mapping (one-to-one).
 *
 * Proves the defect fix: a VALID current-build evidence record's booleans are
 * mapped ONE-TO-ONE onto the runtime closure dimensions, so a partially-true
 * record yields PARTIAL (never UNVERIFIED), an all-true record yields CLOSED,
 * an invalid record (missing fixture / unknown session / SHA mismatch) is
 * ignored and can never yield CLOSED, and the SHA comparison is hex
 * case-insensitive (the generator emits lowercase `digest('hex')` while the
 * evidence manifest stores uppercase).
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDocumentDiagnosticRuntimeClosureAudit,
  type DocumentDiagnosticClosureAuthorityInput,
  type DocumentDiagnosticRuntimeEvidenceEnvironment,
  type DocumentDiagnosticRuntimeEvidenceRecord,
} from './document-diagnostic-runtime-closure-authority'
import {
  formatDocumentDiagnosticCapabilityMatrixMarkdown,
  resolveDocumentDiagnosticCapabilitySummary,
} from './document-diagnostic-capability-summary'

const FAMILY = 'EXCESSIVE_INTERNAL_BLANK_LINES'
const FIXTURE = 'test/vault/runtime/smoke/Document-Diagnostics-Block-Gap-Presentation-Extent-Test.md'
const SESSION = 'sess-1791130425821'
// The real manifest stores the digest UPPERCASE; the generator emits lowercase.
const SHA = '817B7327EE102AA132EB0B3E91311274DC30EE9729DE002977D45E6DB3652BC1'

function env(overrides: Partial<DocumentDiagnosticRuntimeEvidenceEnvironment> = {}): DocumentDiagnosticRuntimeEvidenceEnvironment {
  return {
    currentMainSha256: SHA,
    fixtureExists: f => f === FIXTURE,
    isKnownSession: s => s === SESSION,
    ...overrides,
  }
}

function record(
  overrides: Partial<DocumentDiagnosticRuntimeEvidenceRecord['evidence']> = {},
): DocumentDiagnosticRuntimeEvidenceRecord {
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

/** A manifest that marks the family targeted AND integration (CLOSED-capable). */
const CLOSED_MANIFEST = {
  targetedTestFamilyIds: new Set([FAMILY]),
  integrationTestFamilyIds: new Set([FAMILY]),
  matchedFilesByFamily: new Map([[FAMILY, ['synthetic-integration.test.ts']]]),
}

describe('Capability Matrix V2 §11 — evidence booleans map one-to-one to dimensions', () => {
  it('a partially-true valid record ⇒ PARTIAL with the true dims PASS', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [
        record({
          producer: true,
          firstClick: true,
          activeVisual: true,
          deactivate: false,
          dynamicRefresh: false,
          crossDocumentCleanup: false,
        }),
      ],
      evidenceEnvironment: env(),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit).not.toBeNull()
    expect(audit?.runtimeClosureStatus).toBe('PARTIAL')
    expect(audit?.evidenceFixture).toBe(FIXTURE)
    expect(audit?.evidenceSessionId).toBe(SESSION)
    expect(audit?.dimensions.activeVisualPass).toBe(true)
    expect(audit?.dimensions.firstClickPass).toBe(true)
    expect(audit?.dimensions.runtimePositiveEvidencePass).toBe(true)
    // The record says false ⇒ the dimension MUST be false (evidence-driven,
    // never a static registry default).
    expect(audit?.dimensions.dynamicRefreshPass).toBe(false)
    expect(audit?.dimensions.deactivatePass).toBe(false)
    expect(audit?.dimensions.crossDocumentCleanupPass).toBe(false)
  })

  it('a hex-case-different env SHA still validates (lowercase env ↔ uppercase record)', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record({ deactivate: false, dynamicRefresh: false, crossDocumentCleanup: false })],
      evidenceEnvironment: env({ currentMainSha256: SHA.toLowerCase() }),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    // Same digest, different hex case ⇒ the record is VALID (not stale).
    expect(audit?.evidenceFixture).toBe(FIXTURE)
    expect(audit?.runtimeClosureStatus).toBe('PARTIAL')
    expect(audit?.dimensions.activeVisualPass).toBe(true)
    expect(audit?.dimensions.firstClickPass).toBe(true)
  })

  it('an all-true valid record ⇒ CLOSED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record()],
      evidenceEnvironment: env(),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.runtimeClosureStatus).toBe('CLOSED')
    expect(audit?.decision).toBe('PASS')
  })

  it('the summary block reflects the evidence-driven PARTIAL count', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record({ dynamicRefresh: false })],
      evidenceEnvironment: env(),
    }
    const summary = resolveDocumentDiagnosticCapabilitySummary(input)
    expect(summary.closedFamilyCount).toBe(0)
    expect(summary.partialFamilyCount).toBe(1)
    expect(summary.unverifiedFamilyCount).toBe(71)
    expect(summary.deferredClosureFamilyCount).toBe(5)
    expect(
      summary.closedFamilyCount + summary.partialFamilyCount + summary.unverifiedFamilyCount + summary.deferredClosureFamilyCount,
    ).toBe(77)
    const markdown = formatDocumentDiagnosticCapabilityMatrixMarkdown(input)
    expect(markdown).toContain('1 Runtime Partial')
  })
})

describe('Capability Matrix V2 §12/§22 — invalid evidence is ignored and never CLOSED', () => {
  it('missing fixture ⇒ ignored ⇒ UNVERIFIED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ fixtureExists: () => false }),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(audit?.evidenceFixture).toBeNull()
  })

  it('unknown session ⇒ ignored ⇒ UNVERIFIED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ isKnownSession: () => false }),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(audit?.evidenceSessionId).toBeNull()
  })

  it('SHA mismatch ⇒ ignored ⇒ UNVERIFIED (never CLOSED)', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record()],
      evidenceEnvironment: env({ currentMainSha256: 'B'.repeat(64) }),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.runtimeClosureStatus).toBe('UNVERIFIED')
    expect(audit?.runtimeClosureStatus).not.toBe('CLOSED')
  })
})

describe('Capability Matrix V2 §22 — CLOSED is impossible without activeVisual / firstClick', () => {
  it('activeVisual false ⇒ never CLOSED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record({ activeVisual: false })],
      evidenceEnvironment: env(),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.dimensions.activeVisualPass).toBe(false)
    expect(audit?.runtimeClosureStatus).not.toBe('CLOSED')
    expect(audit?.runtimeClosureStatus).toBe('PARTIAL')
  })

  it('firstClick false ⇒ never CLOSED', () => {
    const input: DocumentDiagnosticClosureAuthorityInput = {
      staticTestManifest: CLOSED_MANIFEST,
      runtimeEvidence: [record({ firstClick: false })],
      evidenceEnvironment: env(),
    }
    const audit = resolveDocumentDiagnosticRuntimeClosureAudit(FAMILY, input)
    expect(audit?.dimensions.firstClickPass).toBe(false)
    expect(audit?.runtimeClosureStatus).not.toBe('CLOSED')
    expect(audit?.runtimeClosureStatus).toBe('PARTIAL')
  })
})
