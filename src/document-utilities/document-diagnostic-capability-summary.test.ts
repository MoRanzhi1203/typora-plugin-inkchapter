/**
 * Capability Matrix V1 §6/§18 — the Registry ↔ Producer consistency gate +
 * the Capability Matrix determinism gate (Phase E).
 *
 * This suite asserts the HARD GATES are all 0 and that the ONE registry in
 * `document-diagnostic-location.ts` is the single metadata authority the whole
 * capability surface derives from (no second registry, no drift).
 */
import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_DIAGNOSTIC_RULE_REGISTRY,
  DOCUMENT_DIAGNOSTIC_STATE_GUARD_CODES,
  getRuleMeta,
  resolveDiagnosticKind,
  resolvePresentationSeverity,
  type DocumentDiagnosticRuleMeta,
} from './document-diagnostic-location'
import {
  buildDocumentDiagnosticCapabilityMatrixRows,
  formatDocumentDiagnosticCapabilityMatrixMarkdown,
  resolveDocumentDiagnosticCapabilitySummary,
  resolvedRuntimeCodesOf,
} from './document-diagnostic-capability-summary'
import {
  PRODUCED_DIAGNOSTIC_CODES,
  resolveDocumentDiagnosticSeverity,
} from './document-diagnostics'

const families = (): DocumentDiagnosticRuleMeta[] => Object.values(DOCUMENT_DIAGNOSTIC_RULE_REGISTRY)

// ── §6/§18 — the hard gates ─────────────────────────────────────────────────

describe('Capability Matrix V1 §6/§18 — Registry ↔ Producer hard gates', () => {
  it('all hard-gate counters are 0 and the decision is PASS', () => {
    const s = resolveDocumentDiagnosticCapabilitySummary()
    expect(s.unregisteredProducedCodeCount, 'UNREGISTERED_RUNTIME_DIAGNOSTIC_CODE_COUNT').toBe(0)
    expect(s.implementedWithoutProducerCount, 'REGISTERED_IMPLEMENTED_RULE_WITHOUT_PRODUCER_COUNT').toBe(0)
    expect(s.duplicateFamilyCount, 'DUPLICATE_RULE_FAMILY_ID_COUNT').toBe(0)
    expect(s.duplicateRuntimeCodeAuthorityCount, 'DUPLICATE_RUNTIME_CODE_AUTHORITY_COUNT').toBe(0)
    expect(s.decision).toBe('PASS')
    expect(s.failing).toEqual([])
  })

  it('every PRODUCED_DIAGNOSTIC_CODES entry resolves to a registered family', () => {
    for (const code of PRODUCED_DIAGNOSTIC_CODES) {
      expect(getRuleMeta(code), code).not.toBeNull()
    }
  })

  it('unregistered / invented codes never resolve (gate is not vacuous)', () => {
    expect(getRuleMeta('NOT_A_REAL_DIAGNOSTIC_CODE')).toBeNull()
    expect(getRuleMeta('FIGURE_ORPHAN_CAPTION')).not.toBeNull() // registered (Phase G: IMPLEMENTED)
  })

  it('every IMPLEMENTED family has a producer authority and a produced code', () => {
    const producedFamilyIds = new Set(
      PRODUCED_DIAGNOSTIC_CODES.map(c => getRuleMeta(c)?.familyId).filter((x): x is string => x != null),
    )
    for (const meta of families()) {
      if (meta.implementationStatus !== 'IMPLEMENTED') continue
      expect(meta.producerAuthority, meta.familyId).not.toBe('NONE')
      expect(producedFamilyIds.has(meta.familyId), meta.familyId).toBe(true)
    }
  })
})

// ── §4 — severity authority ─────────────────────────────────────────────────

describe('Capability Matrix V1 §4 — resolvePresentationSeverity', () => {
  it('maps error→error, warning→warning, info→hint (no fourth level)', () => {
    expect(resolvePresentationSeverity('error')).toBe('error')
    expect(resolvePresentationSeverity('warning')).toBe('warning')
    expect(resolvePresentationSeverity('info')).toBe('hint')
  })

  it('every registered family uses a known presentation severity and never shows info', () => {
    for (const meta of families()) {
      expect(['error', 'warning', 'hint'], meta.familyId).toContain(meta.presentationSeverity)
      expect(meta.presentationSeverity).not.toBe('info')
    }
    const s = resolveDocumentDiagnosticCapabilitySummary()
    // user-visible `info` severity is forbidden: it must be presented as `hint`.
    const visibleInfo = families().filter(
      m => m.userVisible && m.internalSeverity === 'info' && m.presentationSeverity !== 'hint',
    )
    expect(visibleInfo).toEqual([])
    expect(s.hintFamilyCount + s.warningFamilyCount + s.errorFamilyCount).toBe(s.registeredRuleFamilyCount)
  })

  it('the registry internalSeverity mirrors the ONE runtime severity authority', () => {
    for (const meta of families()) {
      for (const code of resolvedRuntimeCodesOf(meta)) {
        const strict = resolveDocumentDiagnosticSeverity(code, true)
        const loose = resolveDocumentDiagnosticSeverity(code, false)
        if (meta.modeDependent) {
          // Mode-dependent families record the LOOSE value.
          expect(meta.internalSeverity, `${meta.familyId}:${code}`).toBe(loose)
        } else {
          expect(strict, `${meta.familyId}:${code}`).toBe(loose)
          expect(meta.internalSeverity, `${meta.familyId}:${code}`).toBe(strict)
        }
      }
    }
  })
})

// ── §0.3/§0.4 — guard / content classification ──────────────────────────────

describe('Capability Matrix V1 §0.3/§0.4 — STATE_GUARD vs CONTENT_DIAGNOSTIC', () => {
  it('the 3 document state guards are STATE_GUARD', () => {
    expect(resolveDiagnosticKind('DOCUMENT_INACTIVE')).toBe('STATE_GUARD')
    expect(resolveDiagnosticKind('DOCUMENT_EMPTY')).toBe('STATE_GUARD')
    expect(resolveDiagnosticKind('DOCUMENT_SOURCE_UNAVAILABLE')).toBe('STATE_GUARD')
    expect(DOCUMENT_DIAGNOSTIC_STATE_GUARD_CODES).toContain('DOCUMENT_EMPTY')
  })

  it('STRICT_FIRST_H1 splits: 2 validation states → STATE_GUARD, 5 LEADING_* → CONTENT', () => {
    expect(resolveDiagnosticKind('STRICT_FIRST_H1_DOCUMENT_EMPTY')).toBe('STATE_GUARD')
    expect(resolveDiagnosticKind('STRICT_FIRST_H1_SOURCE_UNAVAILABLE')).toBe('STATE_GUARD')
    for (const code of [
      'STRICT_FIRST_H1_LEADING_PARAGRAPH',
      'STRICT_FIRST_H1_LEADING_EMPTY_LINE',
      'STRICT_FIRST_H1_LEADING_EMPTY_BLOCK',
      'STRICT_FIRST_H1_LEADING_OTHER_HEADING',
      'STRICT_FIRST_H1_LEADING_OTHER_BLOCK',
    ]) {
      expect(resolveDiagnosticKind(code), code).toBe('CONTENT_DIAGNOSTIC')
    }
  })

  it('the STRICT_FIRST_H1 family registers 7 explicit PATTERN codes (no infinite family)', () => {
    const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.STRICT_FIRST_H1_POSITION
    expect(meta.familyId).toBe('STRICT_FIRST_H1')
    expect(meta.runtimeCodePolicy.kind).toBe('PATTERN')
    if (meta.runtimeCodePolicy.kind === 'PATTERN') {
      expect(meta.runtimeCodePolicy.codes).toHaveLength(7)
    }
  })

  it('LATENT_ATX uses a PREFIX policy and never becomes many families', () => {
    const meta = DOCUMENT_DIAGNOSTIC_RULE_REGISTRY.LATENT_ATX_HEADING_MARKER
    expect(meta.familyId).toBe('LATENT_ATX_HEADING_MARKER')
    expect(meta.runtimeCodePolicy).toEqual({ kind: 'PREFIX', prefix: 'LATENT_ATX_HEADING_MARKER' })
    expect(resolvedRuntimeCodesOf(meta)).toHaveLength(1)
  })
})

// ── §0.3 — classification is never missing on a registered family ───────────

describe('Capability Matrix V1 §2 — every family carries the full capability record', () => {
  it('no registered family is missing familyId / policy / status / closure metadata', () => {
    for (const meta of families()) {
      expect(meta.familyId, meta.ruleId).toBeTruthy()
      expect(meta.runtimeCodePolicy, meta.ruleId).toBeTruthy()
      expect(['EXACT', 'PREFIX', 'PATTERN'], meta.ruleId).toContain(meta.runtimeCodePolicy.kind)
      expect(['STATE_GUARD', 'CONTENT_DIAGNOSTIC'], meta.ruleId).toContain(meta.diagnosticKind)
      expect(['error', 'warning', 'info'], meta.ruleId).toContain(meta.internalSeverity)
      expect(['IMPLEMENTED', 'DEFERRED_BY_SPEC', 'PLANNED'], meta.ruleId).toContain(meta.implementationStatus)
      expect(['CLOSED', 'PARTIAL', 'UNVERIFIED'], meta.ruleId).toContain(meta.runtimeClosureStatus)
      expect(meta.presentationKind, meta.ruleId).toBeTruthy()
      expect(meta.reasonChipPolicy, meta.ruleId).toBeTruthy()
      expect(typeof meta.userVisible, meta.ruleId).toBe('boolean')
    }
  })
})

// ── §5 — deterministic matrix generation ────────────────────────────────────

describe('Capability Matrix V1 §5 — generation is deterministic', () => {
  it('the summary is stable across repeated calls', () => {
    expect(resolveDocumentDiagnosticCapabilitySummary()).toEqual(resolveDocumentDiagnosticCapabilitySummary())
  })

  it('matrix rows are sorted (familyId asc, then runtime code asc) and stable', () => {
    const a = buildDocumentDiagnosticCapabilityMatrixRows()
    const b = buildDocumentDiagnosticCapabilityMatrixRows()
    expect(a).toEqual(b)
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]
      const cur = a[i]
      const key = `${prev.familyId}\u0000${prev.runtimeCode}`
      const nextKey = `${cur.familyId}\u0000${cur.runtimeCode}`
      expect(key <= nextKey, `${key} <= ${nextKey}`).toBe(true)
    }
  })

  it('the markdown document is byte-identical across generated runs', () => {
    const first = formatDocumentDiagnosticCapabilityMatrixMarkdown()
    const second = formatDocumentDiagnosticCapabilityMatrixMarkdown()
    expect(first).toBe(second)
    // §5 — the required Summary block keys are present.
    for (const key of [
      'REGISTERED_RULE_FAMILY_COUNT=',
      'RESOLVED_DIAGNOSTIC_CODE_COUNT=',
      'USER_VISIBLE_DIAGNOSTIC_TYPE_COUNT=',
      'STATE_GUARD_COUNT=',
      'CONTENT_DIAGNOSTIC_COUNT=',
      'IMPLEMENTED_COUNT=',
      'DEFERRED_COUNT=',
      'PLANNED_COUNT=',
    ]) {
      expect(first, key).toContain(key)
    }
    // §5 — the required table columns are present.
    expect(first).toContain('| Family | Runtime Code | Category | Kind | Internal Severity | UI Severity | Scope | Location Kind | Presentation Kind | Producer | Suppression | Runtime Closure | Test Status | Implementation |')
  })
})

// ── §0.1 — the split counts are honest (families vs codes vs visible types) ─

describe('Capability Matrix V1 §0.1 — count authority', () => {
  it('exposes the three distinct counts without forcing them equal', () => {
    const s = resolveDocumentDiagnosticCapabilitySummary()
    expect(s.registeredRuleFamilyCount).toBeGreaterThan(0)
    expect(s.resolvedDiagnosticCodeCount).toBeGreaterThanOrEqual(s.registeredRuleFamilyCount)
    expect(s.userVisibleDiagnosticTypeCount).toBeLessThanOrEqual(s.registeredRuleFamilyCount)
    expect(s.implementedCount + s.deferredCount + s.plannedCount).toBe(s.registeredRuleFamilyCount)
    expect(s.stateGuardCount + s.contentDiagnosticCount).toBe(s.resolvedDiagnosticCodeCount)
  })

  it('registers the future families with honest implementation statuses', () => {
    const planned = families().filter(m => m.implementationStatus === 'PLANNED').map(m => m.familyId)
    const deferred = families().filter(m => m.implementationStatus === 'DEFERRED_BY_SPEC').map(m => m.familyId)
    // Phase G closed the 9 caption-integrity families → they are IMPLEMENTED now.
    const implemented = families().filter(m => m.implementationStatus === 'IMPLEMENTED').map(m => m.familyId)
    expect(implemented).toContain('FIGURE_ORPHAN_CAPTION')
    expect(implemented).toContain('TABLE_MULTIPLE_CAPTIONS')
    expect(implemented).toContain('CODE_CAPTION_FORMAT_INVALID')
    expect(planned).not.toContain('FIGURE_ORPHAN_CAPTION')
    // Phase H — the table / code manual-prefix families are IMPLEMENTED.
    expect(implemented).toContain('TABLE_MANUAL_NUMBER_PREFIX')
    expect(implemented).toContain('CODE_MANUAL_NUMBER_PREFIX')
    // Phase I — local anchor + heading-anchor collision are IMPLEMENTED.
    expect(implemented).toContain('LINK_LOCAL_ANCHOR_MISSING')
    expect(implemented).toContain('HEADING_ANCHOR_COLLISION')
    expect(planned).not.toContain('HEADING_ANCHOR_COLLISION')
    // Numbering Integrity V2 §9 — the number duplicate / order / formula
    // families are IMPLEMENTED against the canonical effective-number provider.
    expect(implemented).toContain('FIGURE_NUMBER_DUPLICATE')
    expect(implemented).toContain('TABLE_NUMBER_ORDER_INVALID')
    expect(implemented).toContain('CODE_NUMBER_DUPLICATE')
    expect(implemented).toContain('FORMULA_NUMBER_ORDER_INVALID')
    expect(implemented).toContain('FORMULA_NUMBER_SECTION_MISMATCH')
    expect(deferred).not.toContain('TABLE_NUMBER_ORDER_INVALID')
    expect(deferred).not.toContain('FORMULA_NUMBER_SECTION_MISMATCH')
    // Phase I cross-file anchor + Phase J cross-reference stay DEFERRED.
    expect(deferred).toContain('LINK_LOCAL_FILE_ANCHOR_MISSING')
    expect(deferred.sort()).toEqual([
      'FIGURE_REFERENCE_TARGET_MISSING',
      'FORMULA_REFERENCE_TARGET_MISSING',
      'LINK_LOCAL_FILE_ANCHOR_MISSING',
      'TABLE_REFERENCE_TARGET_MISSING',
    ])
  })
})
